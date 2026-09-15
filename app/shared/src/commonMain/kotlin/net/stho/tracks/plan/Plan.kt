package net.stho.tracks.plan

import net.stho.tracks.codec.Coordinate
import net.stho.tracks.codec.Polyline

/**
 * The app's five profile words, from `packages/routing/src/router.ts`. They go in the plan
 * fragment, so they are the vocabulary a shared link carries — not any engine's filenames.
 */
enum class Profile(val wire: String) {
    Road("road"),
    Trekking("trekking"),
    Gravel("gravel"),
    Mtb("mtb"),
    Hiking("hiking"),
    ;

    companion object {
        fun of(wire: String): Profile? = entries.firstOrNull { it.wire == wire }
    }
}

/** `poi` is a break the router may turn around at; `routing` is a pass-through. */
enum class WaypointKind { Poi, Routing }

data class Waypoint(val lat: Double, val lon: Double, val kind: WaypointKind, val name: String?)

data class Plan(
    val name: String = "",
    val profile: Profile = DEFAULT_PROFILE,
    val waypoints: List<Waypoint> = emptyList(),
) {
    val isEmpty: Boolean get() = waypoints.isEmpty() && name == ""
}

/** The all-rounder, and the one a plan starts as. Never written to the fragment. */
val DEFAULT_PROFILE = Profile.Trekking

/**
 * The plan fragment from `packages/web/src/lib/plan.ts`: `name`, `profile`, `at` (the
 * waypoints as a polyline at the codec's default precision of 5), `kinds` (`p` or `r` per
 * waypoint) and one `poi` per POI, as `URLSearchParams`.
 *
 * There is no `plan=` key: the fragment *is* the parameters.
 */
object PlanFragment {
    fun format(plan: Plan): String {
        if (plan.isEmpty) return ""

        val params = ArrayList<Pair<String, String>>()
        if (plan.name != "") params.add("name" to plan.name)
        if (plan.profile != DEFAULT_PROFILE) params.add("profile" to plan.profile.wire)

        if (plan.waypoints.isNotEmpty()) {
            params.add("at" to Polyline.encode(plan.waypoints.map { Coordinate(it.lat, it.lon) }))
            params.add("kinds" to plan.waypoints.joinToString("") { if (it.kind == WaypointKind.Poi) "p" else "r" })
            for (waypoint in plan.waypoints) {
                if (waypoint.kind == WaypointKind.Poi) params.add("poi" to (waypoint.name ?: ""))
            }
        }

        return FormUrlEncoded.serialize(params)
    }

    /** Throws on a fragment whose parts disagree, rather than dropping waypoints quietly. */
    fun parse(hash: String): Plan {
        val params = FormUrlEncoded.parse(if (hash.startsWith("#")) hash.substring(1) else hash)
        fun get(key: String): String? = params.firstOrNull { it.first == key }?.second

        val at = get("at")
        if (at == null || at == "") return Plan(name = get("name") ?: "")

        val points = Polyline.decode(at)
        val kinds = get("kinds") ?: ""
        if (kinds.length != points.size) {
            throw IllegalArgumentException("plan has ${points.size} waypoints but ${kinds.length} kinds")
        }

        val names = params.filter { it.first == "poi" }.map { it.second }
        var poi = 0
        val waypoints = points.mapIndexed { index, point ->
            if (kinds[index] != 'p') {
                Waypoint(point.lat, point.lon, WaypointKind.Routing, null)
            } else {
                val name = names.getOrNull(poi++) ?: ""
                Waypoint(point.lat, point.lon, WaypointKind.Poi, name.ifEmpty { null })
            }
        }

        return Plan(
            name = get("name") ?: "",
            profile = get("profile")?.let(Profile::of) ?: DEFAULT_PROFILE,
            waypoints = waypoints,
        )
    }
}
