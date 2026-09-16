package net.stho.tracks.ui.offline

import kotlin.math.min
import kotlin.time.Clock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.offline.AroundYou
import net.stho.tracks.offline.Network
import net.stho.tracks.offline.OfflineNeeds
import net.stho.tracks.offline.PlanLine
import net.stho.tracks.offline.PlanetCheck
import net.stho.tracks.offline.PlanetWatch
import net.stho.tracks.offline.SegmentProblem
import net.stho.tracks.offline.SegmentProgress
import net.stho.tracks.offline.SegmentStore
import net.stho.tracks.offline.SegmentSync
import net.stho.tracks.offline.SegmentTile
import net.stho.tracks.plan.legGeometries
import net.stho.tracks.store.StoredPlan
import net.stho.tracks.ui.map.AreaState
import net.stho.tracks.ui.map.OfflineMaps
import net.stho.tracks.ui.sensors.Sensors
import okio.FileSystem
import okio.Path

/**
 * The app's offline data: packs in MapLibre's database (so after `configureMaps`), segment tiles from brouter.de into
 * [segmentDirectory], and what it keeps about itself in [directory]. [plans] are the stored plans (M12's library);
 * [onTilesLanded] is told when segment tiles arrive, so legs that had no data can route.
 */
fun offlineData(
    sensors: Sensors,
    plans: Flow<List<StoredPlan>>,
    directory: Path,
    segmentDirectory: Path,
    scope: CoroutineScope,
    freeBytes: () -> Long?,
    onTilesLanded: () -> Unit,
): OfflineData = OfflineData(
    sensors = sensors,
    plans = plans.map { stored -> stored.map(::planLine) },
    network = networkState(scope),
    maps = OfflineMaps(),
    segments = SegmentSync(
        SegmentStore(segmentDirectory),
        downloadHttpClient(),
        clock = { Clock.System.now().toEpochMilliseconds() },
        freeBytes = freeBytes,
    ),
    centreFile = directory / "around",
    scope = scope,
    planet = PlanetWatch(downloadHttpClient(), directory / "planet", clock = { Clock.System.now().toEpochMilliseconds() }),
    onTilesLanded = onTilesLanded,
)

/** A stored plan, as offline data sees it: its stops, and its legs as routed — or as straight stretches until they are. */
fun planLine(stored: StoredPlan): PlanLine = PlanLine(
    stored.id,
    stored.plan.waypoints.map { Coordinate(it.lat, it.lon) } + legGeometries(stored.plan.waypoints, stored.legs).flatten(),
)

/** While a pack is downloading, how often its progress is read: MapLibre reports it only to a running UI. */
const val PACK_POLL_MS = 2_000L

/** With every pack whole, how often they are looked at again anyway. */
const val PACK_RECHECK_MS = 15 * 60_000L

/** With nothing failing, how often segment tiles are brought up to date: a tile is re-checked once it is a week old. */
const val SEGMENT_RECHECK_MS = 60 * 60_000L

/** The first retry after brouter.de could not be reached; each one after waits twice as long, up to [SEGMENT_RECHECK_MS]. */
const val SEGMENT_FIRST_RETRY_MS = 30_000L

/** How often the planet watch is asked: it asks VersaTiles only once a week itself, so this only bounds how late it notices. */
const val PLANET_RECHECK_MS = 60 * 60_000L

data class OfflineState(
    /** What is needed now: the areas, and the segment tiles under them. */
    val needs: OfflineNeeds = OfflineNeeds(emptyList(), emptySet()),
    /** Each area the map keeps offline, by its key: `around`, `plan:<id>`. */
    val areas: Map<String, AreaState> = emptyMap(),
    /** Segment tiles needed and not yet on the phone; null until the directory has been looked at. */
    val segmentsWaiting: List<SegmentTile>? = null,
    /** The segment tile downloading now. */
    val downloading: SegmentProgress? = null,
    val mapProblem: String? = null,
    val segmentProblem: SegmentProblem? = null,
) {
    /** Where the stored plan [id] stands offline, or null for a plan offline data does not know yet. */
    fun plan(id: String): PlanOffline? {
        val area = needs.areas.firstOrNull { it.key == OfflineNeeds.planKey(id) } ?: return null
        val map = areas[area.key] ?: AreaState.Waiting
        val waiting = segmentsWaiting ?: return PlanOffline.Pending
        val tiles = SegmentTile.covering(area.bounds)
        val missing = waiting.filter { it in tiles }
        val tile = downloading?.takeIf { it.tile in tiles }
        return when {
            map is AreaState.Ready && missing.isEmpty() -> PlanOffline.Ready
            (segmentProblem as? SegmentProblem.StorageFull)?.tile?.let { it in tiles } == true -> PlanOffline.PhoneFull
            map is AreaState.Downloading -> PlanOffline.Downloading(map.fraction)
            tile != null -> PlanOffline.Downloading(tile.totalBytes?.let { tile.receivedBytes.toDouble() / it } ?: 0.0)
            else -> PlanOffline.Pending
        }
    }
}

/** A stored plan's offline data, as its row says it. */
sealed interface PlanOffline {
    /** The map of its area and the tiles to route in it are on the phone. */
    data object Ready : PlanOffline

    data class Downloading(val fraction: Double) : PlanOffline

    /** Not yet, and not downloading now: no network, or waiting its turn. */
    data object Pending : PlanOffline

    /** Its tiles would leave the phone with too little room. */
    data object PhoneFull : PlanOffline
}

/**
 * Keeps what the phone holds offline in step with what it needs, without being asked: the map's areas as offline packs,
 * and the segment tiles under them in the engine's directory.
 *
 * What is needed comes from [plans] and from where you are: the area around you follows [sensors], and its centre is
 * kept in [centreFile], so a start with no fix yet — indoors, in airplane mode — keeps the area where it was instead of
 * deleting it. Packs download on any network, as MapLibre does; segment tiles download on any network too, and are
 * re-checked only on an unmetered one, which [SegmentSync] decides from [network]. A tile that lands calls
 * [onTilesLanded]. The packs are downloaded again when [planet] sees VersaTiles publish a new one, and elevation never
 * changes, so nothing else is refreshed.
 *
 * [scope] must be single-threaded, as the UI's is: packs are MapLibre's Compose state. Segment files are written on [io].
 */
class OfflineData(
    sensors: Sensors,
    plans: Flow<List<PlanLine>>,
    network: StateFlow<Network?>,
    private val maps: OfflineMaps,
    private val segments: SegmentSync,
    private val centreFile: Path,
    scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val fileSystem: FileSystem = FileSystem.SYSTEM,
    private val planet: PlanetWatch? = null,
    private val onTilesLanded: () -> Unit = {},
) {
    private val centre = MutableStateFlow(readCentre())
    private val mutableState = MutableStateFlow(OfflineState())
    val state: StateFlow<OfflineState> = mutableState.asStateFlow()

    init {
        scope.launch {
            sensors.fixes.collect { fix ->
                val next = AroundYou.centre(centre.value, fix.at)
                if (next != centre.value) {
                    centre.value = next
                    writeCentre(next)
                }
            }
        }
        val needs = combine(plans, centre) { lines, around -> OfflineNeeds.of(lines, around) }.distinctUntilChanged()
        scope.launch {
            needs.collectLatest { now ->
                mutableState.update { it.copy(needs = now) }
                keepMaps(now)
            }
        }
        scope.launch {
            combine(needs.map { it.segments }.distinctUntilChanged(), network) { tiles, on -> tiles to on }
                .collectLatest { (tiles, on) -> keepSegments(tiles, on) }
        }
        planet?.let { watch ->
            scope.launch {
                network.collectLatest { on ->
                    while (true) {
                        if (withContext(io) { watch.check(on) } == PlanetCheck.Changed) {
                            maps.refresh()
                            withContext(io) { watch.refreshed() }
                        }
                        delay(PLANET_RECHECK_MS)
                    }
                }
            }
        }
    }

    private suspend fun keepMaps(needs: OfflineNeeds) {
        while (true) {
            val states = try {
                maps.reconcile(needs.areas).also { states ->
                    mutableState.update { state ->
                        state.copy(areas = states.mapValues { (key, now) -> steady(state.areas[key], now) }, mapProblem = null)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                mutableState.update { it.copy(mapProblem = e.message ?: e.toString()) }
                null
            }
            // Reconciling again, not only reading: the pack of an area that moved is deleted once its replacement is whole.
            delay(if (states == null || states.values.any { it !is AreaState.Ready }) PACK_POLL_MS else PACK_RECHECK_MS)
        }
    }

    /**
     * A download under way stays one through a failed request or a moment with no progress reported: MapLibre reports
     * each failed request — a Wi-Fi blip, a 404 — as the pack's state until the next status, and retries by itself, so a
     * row flicking between Downloading and not would be saying something that is not so.
     */
    private fun steady(before: AreaState?, now: AreaState): AreaState =
        if (before is AreaState.Downloading && (now is AreaState.Failing || now is AreaState.Waiting)) before else now

    private suspend fun keepSegments(tiles: Set<SegmentTile>, network: Network?) {
        if (network == null) {
            val waiting = withContext(io) { tiles.filterNot(segments.store::has) }
            mutableState.update { it.copy(segmentsWaiting = waiting.sortedWith(compareBy({ t -> t.lon }, { t -> t.lat })), downloading = null) }
            awaitCancellation()
        }
        var retry = SEGMENT_FIRST_RETRY_MS
        while (true) {
            val result = withContext(io) {
                segments.sync(tiles, network) { progress -> mutableState.update { it.copy(downloading = progress) } }
            }
            mutableState.update { it.copy(segmentsWaiting = result.waiting, downloading = null, segmentProblem = result.problem) }
            if (result.downloaded.isNotEmpty() || result.refreshed.isNotEmpty()) onTilesLanded()
            val wait = if (result.problem is SegmentProblem.Unreachable) {
                retry.also { retry = min(retry * 2, SEGMENT_RECHECK_MS) }
            } else {
                retry = SEGMENT_FIRST_RETRY_MS
                SEGMENT_RECHECK_MS
            }
            delay(wait)
        }
    }

    private fun readCentre(): Coordinate? = runCatching {
        val (lat, lon) = fileSystem.read(centreFile) { readUtf8() }.trim().split(" ")
        Coordinate(lat.toDouble(), lon.toDouble())
    }.getOrNull()

    private fun writeCentre(at: Coordinate) {
        centreFile.parent?.let(fileSystem::createDirectories)
        fileSystem.write(centreFile) { writeUtf8("${at.lat} ${at.lon}\n") }
    }
}
