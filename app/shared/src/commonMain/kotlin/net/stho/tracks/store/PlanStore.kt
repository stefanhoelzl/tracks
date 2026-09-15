package net.stho.tracks.store

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import net.stho.tracks.codec.Polyline
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.PlanFragment
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.Waypoint
import net.stho.tracks.plan.stretches
import okio.FileSystem
import okio.IOException
import okio.Path
import kotlin.random.Random

/**
 * A plan the phone keeps: the plan as its link carries it, and the legs it was routed into.
 *
 * [legs] has one slot per leg of [plan]; a null slot is a leg that has not been routed — no tiles for it yet.
 */
data class StoredPlan(val id: String, val savedAtMillis: Long, val plan: Plan, val legs: List<Leg?>)

/**
 * Plans on disk, one JSON file each.
 *
 * The plan is stored as its fragment, the same text a shared link carries, so what is kept is exactly what goes back to
 * the web. The legs are stored beside it with their geometry and elevation, because a leg is routed once and kept: a
 * line checked on the web must not move because the phone's tiles are a week newer. Each leg is keyed by the waypoints
 * and profile it was routed for, and a key that no longer matches is a leg that is dropped rather than drawn wrong.
 *
 * The directory should outlive app updates and never be purged by the system: Application Support on iOS, not Caches.
 * A file written by a newer schema, or one that cannot be read, is left where it is and not listed.
 */
class PlanStore(private val directory: Path, private val fileSystem: FileSystem) {
    /** Every readable plan, newest first. */
    fun list(): List<StoredPlan> {
        if (!fileSystem.exists(directory)) return emptyList()
        return fileSystem.list(directory)
            .filter { it.name.endsWith(SUFFIX) }
            .mapNotNull(::read)
            .sortedWith(compareByDescending<StoredPlan> { it.savedAtMillis }.thenBy { it.id })
    }

    fun load(id: String): StoredPlan? = pathOf(id).takeIf { fileSystem.exists(it) }?.let(::read)

    /**
     * Writes [stored] over whatever had its id, atomically: a crash mid-write leaves the old file, never half a new one.
     *
     * The plan must already be the one its link carries (`PlanFragment.parse(PlanFragment.format(plan))`), with its
     * coordinates at the fragment's precision — otherwise the phone would route, and keep, a line the web cannot draw.
     */
    fun save(stored: StoredPlan) {
        val target = pathOf(stored.id)
        require(PlanFragment.parse(PlanFragment.format(stored.plan)) == stored.plan) {
            "a stored plan must be the plan its link carries; pass it through PlanFragment first"
        }
        val stretches = stretches(stored.plan.waypoints)
        require(stored.legs.size == stretches.size) { "${stretches.size} legs expected, ${stored.legs.size} given" }

        val file = PlanFile(
            schemaVersion = SCHEMA_VERSION,
            id = stored.id,
            savedAtMillis = stored.savedAtMillis,
            fragment = PlanFragment.format(stored.plan),
            legs = stored.legs.mapIndexed { index, leg -> leg?.let { LegFile.of(legKey(stretches[index], stored.plan.profile), it) } },
        )

        fileSystem.createDirectories(directory)
        val temporary = directory / "${stored.id}$SUFFIX.tmp"
        fileSystem.write(temporary) { writeUtf8(json.encodeToString(PlanFile.serializer(), file)) }
        fileSystem.atomicMove(temporary, target)
    }

    fun delete(id: String) = fileSystem.delete(pathOf(id), mustExist = false)

    private fun pathOf(id: String): Path {
        require(ID.matches(id)) { "not a plan id: $id" }
        return directory / "$id$SUFFIX"
    }

    private fun read(path: Path): StoredPlan? {
        val file = try {
            json.decodeFromString(PlanFile.serializer(), fileSystem.read(path) { readUtf8() })
        } catch (e: IOException) {
            return null
        } catch (e: SerializationException) {
            return null
        }
        if (file.schemaVersion != SCHEMA_VERSION || !ID.matches(file.id)) return null

        val plan = try {
            PlanFragment.parse(file.fragment)
        } catch (e: IllegalArgumentException) {
            return null
        }
        val legs = stretches(plan.waypoints).mapIndexed { index, stretch ->
            file.legs.getOrNull(index)?.takeIf { it.key == legKey(stretch, plan.profile) }?.toLeg(stretch)
        }
        return StoredPlan(file.id, file.savedAtMillis, plan, legs)
    }

    companion object {
        const val SCHEMA_VERSION = 1
        private const val SUFFIX = ".json"
        private val ID = Regex("[A-Za-z0-9-]{1,64}")
        private val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }

        fun newId(random: Random = Random.Default): String = List(16) { "0123456789abcdef"[random.nextInt(16)] }.joinToString("")
    }
}

/** What a leg was routed for: its waypoints' positions and kinds, and the profile. Names do not move a line. */
private fun legKey(stretch: List<Waypoint>, profile: Profile): String =
    stretch.joinToString("|", prefix = "${profile.wire}|") { "${it.lat},${it.lon},${it.kind}" }

@Serializable
private data class PlanFile(
    val schemaVersion: Int,
    val id: String,
    val savedAtMillis: Long,
    val fragment: String,
    val legs: List<LegFile?>,
)

/** A routed leg's line at precision 6, which is what BRouter writes, so it reads back to the same doubles. */
@Serializable
private data class LegFile(
    val key: String,
    val line: String? = null,
    val altitudeM: List<Double>? = null,
    val distanceM: Double = 0.0,
    val ascentM: Double = 0.0,
    val descentM: Double = 0.0,
    val durationS: Double = 0.0,
    val failed: String? = null,
) {
    fun toLeg(stretch: List<Waypoint>): Leg? {
        val from = stretch.first()
        val to = stretch.last()
        if (failed != null) return FailedLeg(from, to, failed)
        val coordinates = Polyline.decode(line ?: return null, LINE_PRECISION)
        val altitude = altitudeM ?: return null
        if (altitude.size != coordinates.size) return null
        return RoutedLeg(from, to, coordinates, altitude, distanceM, ascentM, descentM, durationS)
    }

    companion object {
        const val LINE_PRECISION = 6

        fun of(key: String, leg: Leg): LegFile = when (leg) {
            is FailedLeg -> LegFile(key = key, failed = leg.reason)
            is RoutedLeg -> LegFile(
                key = key,
                line = Polyline.encode(leg.coordinates, LINE_PRECISION),
                altitudeM = leg.altitudeM,
                distanceM = leg.distanceM,
                ascentM = leg.ascentM,
                descentM = leg.descentM,
                durationS = leg.durationS,
            )
        }
    }
}
