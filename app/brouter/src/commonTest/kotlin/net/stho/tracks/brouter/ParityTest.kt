package net.stho.tracks.brouter

import okio.FileSystem
import okio.Path.Companion.toPath
import okio.SYSTEM
import kotlin.test.Test
import kotlin.test.fail
import kotlin.time.TimeSource

internal expect fun environment(name: String): String?

/**
 * The release gate: every route in `parity/routes.tsv`, routed here, is the GeoJSON brouter.de answered
 * for the same request, byte for byte, apart from the `creator` line.
 *
 * The fixtures were fetched against the `rd5` snapshot named in `parity/segments.txt`, which Gradle
 * puts in the cache before the tests run. `TRACKS_BROUTER_ROUTES=id,id` narrows the run while working.
 */
class ParityTest {
    @Test
    fun routesWhatBrouterDeRoutes() {
        val segments = required("TRACKS_BROUTER_SEGMENTS")
        val profiles = required("TRACKS_BROUTER_PROFILES")
        val parity = required("TRACKS_BROUTER_PARITY")
        val only = environment("TRACKS_BROUTER_ROUTES")?.split(',')?.map { it.trim() }?.toSet()

        val routes = read("$parity/routes.tsv").lines().filter { it.isNotBlank() }.map { it.split('\t') }
        val failures = ArrayList<String>()
        var checked = 0

        for ((id, profile, lonlats) in routes) {
            if (only != null && id !in only) continue
            val expected = read("$parity/brouter.de/$id.geojson")
            val mark = TimeSource.Monotonic.markNow()
            val actual = try {
                BRouter.route(segments, profiles, profile, lonlats)
            } catch (e: Exception) {
                failures += "$id: ${e::class.simpleName}: ${e.message}"
                continue
            }
            println("parity $id ${mark.elapsedNow()}")
            firstDifference(expected, actual)?.let { failures += "$id: $it" }
            checked++
        }

        if (failures.isNotEmpty()) fail("${failures.size} of ${checked + failures.size} routes differ:\n" + failures.joinToString("\n"))
        if (checked == 0) fail("no routes checked")
    }

    private fun required(name: String): String =
        environment(name) ?: fail("$name is not set — run the parity test through Gradle")

    private fun read(path: String): String = FileSystem.SYSTEM.read(path.toPath()) { readUtf8() }

    /** The first line that differs, ignoring `creator`; null when the two are the same GeoJSON. */
    private fun firstDifference(expected: String, actual: String): String? {
        val e = expected.lines()
        val a = actual.lines()
        for (i in 0 until maxOf(e.size, a.size)) {
            val el = e.getOrNull(i)
            val al = a.getOrNull(i)
            if (el != null && al != null && el.contains("\"creator\":") && al.contains("\"creator\":")) continue
            if (el != al) return "line ${i + 1}: brouter.de has ${el?.take(160)}, we have ${al?.take(160)}"
        }
        return null
    }
}
