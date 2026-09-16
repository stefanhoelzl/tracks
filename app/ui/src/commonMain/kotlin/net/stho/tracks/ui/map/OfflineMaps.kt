package net.stho.tracks.ui.map

import kotlin.time.Clock
import net.stho.tracks.offline.Bounds
import net.stho.tracks.offline.MapArea
import net.stho.tracks.offline.STORAGE_RESERVE_BYTES
import org.maplibre.compose.map.DefaultMapRuntime
import org.maplibre.compose.offline.DownloadProgress
import org.maplibre.compose.offline.DownloadStatus
import org.maplibre.compose.offline.OfflineManager
import org.maplibre.compose.offline.OfflinePack
import org.maplibre.compose.offline.OfflinePackDefinition
import org.maplibre.spatialk.geojson.BoundingBox

/** How far the offline map of one area has come. */
sealed interface AreaState {
    /** Nothing reported yet: a pack just created, or the runtime still reading its database. */
    data object Waiting : AreaState

    data class Downloading(val completedResources: Long, val requiredResources: Long, val bytes: Long) : AreaState {
        val fraction: Double get() = if (requiredResources > 0) completedResources.toDouble() / requiredResources else 0.0
    }

    /** Whole: drawn anywhere in the area with no network. */
    data class Ready(val bytes: Long) : AreaState

    /** The last request failed. MapLibre keeps retrying while the pack is resumed; [message] is what it said. */
    data class Failing(val message: String) : AreaState

    /** Paused: the phone has less room than [STORAGE_RESERVE_BYTES] would leave. It resumes once there is room. */
    data object StorageFull : AreaState
}

/**
 * The map's offline areas, as MapLibre offline packs, used as the library ships them: one pack per area, downloading
 * whatever the style names inside its box, z0–14. Everything a pack holds is stored once however many packs share it —
 * glyphs, the sprite, a tile two areas both reach — and deleting a pack frees only what no other pack holds.
 *
 * Create it after [configureMaps].
 */
class OfflineMaps internal constructor(
    private val store: PackStore,
    private val clock: () -> Long = { Clock.System.now().toEpochMilliseconds() },
    /** Free bytes on the volume the packs are on, or null where that is not known. */
    private val freeBytes: () -> Long? = { null },
) {
    constructor(freeBytes: () -> Long? = { null }) : this(MapLibrePackStore(DefaultMapRuntime.instance.offlineManager), freeBytes = freeBytes)

    private var settled = false

    /** Per area: how far its download had come, and since when it has not moved. */
    private val lastMoved = HashMap<String, Pair<Long, Long>>()

    /**
     * Brings the packs to [areas]: creates what is missing and resumes what is not whole, deletes what nothing needs.
     *
     * A pack whose area moved — the area around you, recentred — stays until the pack for where it is now is whole, so
     * what the two share is not deleted while it is still being downloaded again.
     *
     * With less room on the phone than [STORAGE_RESERVE_BYTES], no pack downloads: how big a pack will be is not known
     * until it is whole, so the reserve is kept by stopping before it is reached rather than by adding up in advance.
     * Unfinished packs are paused and say [AreaState.StorageFull]; whole ones stay, and deleting what nothing needs goes on.
     */
    suspend fun reconcile(areas: List<MapArea>): Map<String, AreaState> {
        if (!settled) {
            store.settle()
            settled = true
        }
        val wanted = areas.associateBy { it.key }
        val packs = store.packs
        val current = mutableMapOf<String, StoredPack>()
        for (pack in packs) pack.area?.takeIf { wanted[it.key] == it }?.let { current.getOrPut(it.key) { pack } }

        for (pack in packs) {
            val area = pack.area
            val keep = when {
                area == null -> false
                current[area.key] === pack -> true
                area.key !in wanted -> false
                area == wanted[area.key] -> false
                else -> current[area.key]?.state !is AreaState.Ready
            }
            if (!keep) store.delete(pack)
        }

        val full = freeBytes()?.let { it < STORAGE_RESERVE_BYTES } == true
        for (area in areas) {
            val pack = current.getOrPut(area.key) { store.create(area) }
            if (pack.state is AreaState.Ready) continue
            if (full) {
                store.pause(pack)
                lastMoved.remove(area.key)
                continue
            }
            if (stalled(area.key, pack.state)) store.pause(pack)
            store.resume(pack)
        }
        lastMoved.keys.retainAll(wanted.keys)
        val states = states(areas)
        return if (full) states.mapValues { (_, state) -> if (state is AreaState.Ready) state else AreaState.StorageFull } else states
    }

    /**
     * Whether a download has made no progress for [PACK_STALL_MS]. On the phone, a pack whose requests failed as the app
     * came back from the background — `-1005`, the connection lost — made no progress again until the app was restarted:
     * MapLibre waits for a change in the network that never comes, and a resume is nothing to a pack already on. Paused and
     * resumed, it starts over from what it has.
     */
    private fun stalled(key: String, state: AreaState): Boolean {
        val done = when (state) {
            is AreaState.Downloading -> state.completedResources
            // Failing is MapLibre reporting a failed request, and says nothing of progress: as far as it had come.
            is AreaState.Failing -> lastMoved[key]?.first ?: -1L
            else -> {
                lastMoved.remove(key)
                return false
            }
        }
        val now = clock()
        val (before, since) = lastMoved[key] ?: (-1L to now)
        if (done != before) {
            lastMoved[key] = done to now
            return false
        }
        if (now - since < PACK_STALL_MS) return false
        lastMoved[key] = done to now
        return true
    }

    /**
     * Downloads again whatever changed in the packs this app made: VersaTiles published a new planet. MapLibre asks for each
     * tile conditionally and keeps what is unchanged, and a pack is drawn from its old tiles until the new ones arrive.
     */
    suspend fun refresh() {
        if (!settled) {
            store.settle()
            settled = true
        }
        for (pack in store.packs) {
            if (pack.area == null) continue
            store.invalidate(pack)
            store.resume(pack)
        }
    }

    /** Where each of [areas] has come to, without changing anything. */
    fun states(areas: List<MapArea>): Map<String, AreaState> {
        val packs = store.packs
        return areas.associate { area -> area.key to (packs.firstOrNull { it.area == area }?.state ?: AreaState.Waiting) }
    }
}

/** The packs of one runtime, as [OfflineMaps] needs them: the rules are tested without MapLibre. */
internal interface PackStore {
    /** Returns once the packs already on disk are listed: the runtime reads them after it starts, and says nothing when done. */
    suspend fun settle()

    val packs: List<StoredPack>

    suspend fun create(area: MapArea): StoredPack

    fun resume(pack: StoredPack)

    fun pause(pack: StoredPack)

    /** Marks everything in [pack] to be checked against the server again. */
    suspend fun invalidate(pack: StoredPack)

    suspend fun delete(pack: StoredPack)
}

internal interface StoredPack {
    /** The area the pack was made for, or null for a pack this app did not make — or made in a shape it no longer reads. */
    val area: MapArea?

    val state: AreaState
}

/** How long a download may make no progress before it is paused and resumed. */
internal const val PACK_STALL_MS = 60_000L

/** Vector tiles end at z14; elevation at z12, which the style says itself. */
private const val PACK_MAX_ZOOM = 14

/** Sprites for a 2× screen, the phone's. */
private const val PACK_PIXEL_RATIO = 2f

/** What browsing may keep beside the packs, MapLibre's own default. */
private const val AMBIENT_CACHE_BYTES = 50L * 1024 * 1024

private const val METADATA_V1 = "tracks-area v1"

/** A pack's metadata: which area it was made for, as text — `Double.toString` reads back to the same double. */
internal fun encodeArea(area: MapArea): ByteArray = with(area.bounds) {
    listOf(METADATA_V1, area.key, south, west, north, east).joinToString("\n").encodeToByteArray()
}

internal fun decodeArea(metadata: ByteArray): MapArea? {
    val lines = metadata.decodeToString().split("\n")
    if (lines.size != 6 || lines[0] != METADATA_V1) return null
    val (south, west, north, east) = lines.drop(2).map { it.toDoubleOrNull() ?: return null }
    return runCatching { MapArea(lines[1], Bounds(south, west, north, east)) }.getOrNull()
}

internal class MapLibrePackStore(private val manager: OfflineManager) : PackStore {
    // Operations run one after another on the runtime's own thread, and listing the packs is the first it is given: an
    // operation queued now completes after the listing has.
    override suspend fun settle() = manager.setMaximumAmbientCacheSize(AMBIENT_CACHE_BYTES)

    override val packs: List<StoredPack> get() = manager.packs.map(::Pack)

    override suspend fun create(area: MapArea): StoredPack = with(area.bounds) {
        val definition = OfflinePackDefinition.TilePyramid(
            styleUrl = PACK_STYLE_URL,
            bounds = BoundingBox(west = west, south = south, east = east, north = north),
            pixelRatio = PACK_PIXEL_RATIO,
            minZoom = 0,
            maxZoom = PACK_MAX_ZOOM,
        )
        Pack(manager.create(definition, encodeArea(area)))
    }

    override fun resume(pack: StoredPack) = manager.resume((pack as Pack).pack)

    override fun pause(pack: StoredPack) = manager.pause((pack as Pack).pack)

    override suspend fun invalidate(pack: StoredPack) = manager.invalidate((pack as Pack).pack)

    override suspend fun delete(pack: StoredPack) = manager.delete((pack as Pack).pack)

    private class Pack(val pack: OfflinePack) : StoredPack {
        override val area: MapArea? get() = pack.metadata?.let(::decodeArea)

        override val state: AreaState
            get() = when (val progress = pack.downloadProgress) {
                DownloadProgress.Unknown -> AreaState.Waiting
                is DownloadProgress.Healthy ->
                    if (progress.status == DownloadStatus.Complete) {
                        AreaState.Ready(progress.completedResourceBytes)
                    } else {
                        AreaState.Downloading(progress.completedResourceCount, progress.requiredResourceCount, progress.completedResourceBytes)
                    }
                is DownloadProgress.Error -> AreaState.Failing(progress.message)
                is DownloadProgress.TileLimitExceeded -> AreaState.Failing("more than ${progress.limit} tiles")
            }
    }
}
