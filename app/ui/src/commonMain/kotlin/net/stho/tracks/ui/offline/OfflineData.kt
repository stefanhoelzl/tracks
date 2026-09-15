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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.offline.AroundYou
import net.stho.tracks.offline.Network
import net.stho.tracks.offline.OfflineNeeds
import net.stho.tracks.offline.PlanLine
import net.stho.tracks.offline.SegmentProblem
import net.stho.tracks.offline.SegmentProgress
import net.stho.tracks.offline.SegmentStore
import net.stho.tracks.offline.SegmentSync
import net.stho.tracks.offline.SegmentTile
import net.stho.tracks.ui.map.AreaState
import net.stho.tracks.ui.map.OfflineMaps
import net.stho.tracks.ui.sensors.Sensors
import okio.FileSystem
import okio.Path

/**
 * The app's offline data: packs in MapLibre's database (so after `configureMaps`), segment tiles from brouter.de into
 * [segmentDirectory], and what it keeps about itself in [directory]. No plans yet: M12 stores them.
 */
fun offlineData(sensors: Sensors, directory: Path, segmentDirectory: Path, scope: CoroutineScope, freeBytes: () -> Long?): OfflineData =
    OfflineData(
        sensors = sensors,
        plans = MutableStateFlow(emptyList()),
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
    )

/** While a pack is downloading, how often its progress is read: MapLibre reports it only to a running UI. */
const val PACK_POLL_MS = 2_000L

/** With every pack whole, how often they are looked at again anyway. */
const val PACK_RECHECK_MS = 15 * 60_000L

/** With nothing failing, how often segment tiles are brought up to date: a tile is re-checked once it is a week old. */
const val SEGMENT_RECHECK_MS = 60 * 60_000L

/** The first retry after brouter.de could not be reached; each one after waits twice as long, up to [SEGMENT_RECHECK_MS]. */
const val SEGMENT_FIRST_RETRY_MS = 30_000L

data class OfflineState(
    /** Each area the map keeps offline, by its key: `around`, `plan:<id>`. */
    val areas: Map<String, AreaState> = emptyMap(),
    /** Segment tiles needed and not yet on the phone. */
    val segmentsWaiting: List<SegmentTile> = emptyList(),
    /** The segment tile downloading now. */
    val downloading: SegmentProgress? = null,
    val mapProblem: String? = null,
    val segmentProblem: String? = null,
)

/**
 * Keeps what the phone holds offline in step with what it needs, without being asked: the map's areas as offline packs,
 * and the segment tiles under them in the engine's directory.
 *
 * What is needed comes from [plans] and from where you are: the area around you follows [sensors], and its centre is
 * kept in [centreFile], so a start with no fix yet — indoors, in airplane mode — keeps the area where it was instead of
 * deleting it. Packs download on any network, as MapLibre does; segment tiles download on any network too, and are
 * re-checked only on an unmetered one, which [SegmentSync] decides from [network].
 *
 * [scope] must be single-threaded, as the UI's is: packs are MapLibre's Compose state. Segment files are written on [io].
 */
class OfflineData(
    sensors: Sensors,
    plans: StateFlow<List<PlanLine>>,
    network: StateFlow<Network?>,
    private val maps: OfflineMaps,
    private val segments: SegmentSync,
    private val centreFile: Path,
    scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val fileSystem: FileSystem = FileSystem.SYSTEM,
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
        scope.launch { needs.collectLatest(::keepMaps) }
        scope.launch {
            combine(needs, network) { it, on -> it.segments to on }.distinctUntilChanged()
                .collectLatest { (tiles, on) -> keepSegments(tiles, on) }
        }
    }

    private suspend fun keepMaps(needs: OfflineNeeds) {
        while (true) {
            val states = try {
                maps.reconcile(needs.areas).also { states -> mutableState.update { it.copy(areas = states, mapProblem = null) } }
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
            mutableState.update {
                it.copy(segmentsWaiting = result.waiting, downloading = null, segmentProblem = result.problem?.let(::describe))
            }
            val wait = if (result.problem is SegmentProblem.Unreachable) {
                retry.also { retry = min(retry * 2, SEGMENT_RECHECK_MS) }
            } else {
                retry = SEGMENT_FIRST_RETRY_MS
                SEGMENT_RECHECK_MS
            }
            delay(wait)
        }
    }

    private fun describe(problem: SegmentProblem): String = when (problem) {
        is SegmentProblem.Unreachable -> problem.message
        is SegmentProblem.StorageFull -> "${problem.tile.name} needs ${problem.bytes / 1_000_000} MB, and the phone is nearly full"
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
