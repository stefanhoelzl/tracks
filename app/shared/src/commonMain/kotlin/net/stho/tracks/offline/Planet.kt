package net.stho.tracks.offline

import io.ktor.client.HttpClient
import io.ktor.client.request.head
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import okio.FileSystem
import okio.Path

/**
 * The planet VersaTiles serves its tiles from, as a file: a new planet is a new upload of it, roughly quarterly, and a new
 * upload has a new ETag. It is the one request that says whether every tile changed, where asking the tiles would be
 * thousands of requests. There is no Last-Modified on it; the ETag is what there is.
 */
const val VERSATILES_PLANET = "https://download.versatiles.org/osm.versatiles"

/** A week: often enough to follow a quarterly planet within days, rarely enough to be no load at all. */
const val PLANET_CHECK_MS = 7L * 24 * 60 * 60 * 1000

sealed interface PlanetCheck {
    /** Not a week since the last look, or not on an unmetered network: nothing asked. */
    data object NotDue : PlanetCheck

    /** The first look on this phone: the packs were made from whatever planet this is, so nothing is refreshed. */
    data object FirstSeen : PlanetCheck

    data object Unchanged : PlanetCheck

    /** A new planet: the packs' tiles are out of date, and are to be downloaded again. */
    data object Changed : PlanetCheck

    data class Unreachable(val message: String) : PlanetCheck
}

/**
 * Watches for a new VersaTiles planet: on an unmetered network, at most once a [PLANET_CHECK_MS], one HEAD request.
 *
 * What it last saw is kept in [stateFile], as the ETag and when it was checked, so a watch that starts again after the
 * app was killed neither asks again too soon nor mistakes the planet it already knew for a new one. A planet reported as
 * [PlanetCheck.Changed] is recorded as seen only when [refreshed] is called, so a refresh that did not happen — the app
 * killed, the network gone — is reported again at the next check.
 */
class PlanetWatch(
    private val client: HttpClient,
    private val stateFile: Path,
    private val clock: () -> Long,
    private val fileSystem: FileSystem = FileSystem.SYSTEM,
    private val url: String = VERSATILES_PLANET,
) {
    private var pending: String? = null

    suspend fun check(network: Network?): PlanetCheck {
        if (network != Network.Unmetered) return PlanetCheck.NotDue
        val seen = read()
        if (seen != null && clock() - seen.checkedAtMillis < PLANET_CHECK_MS) return PlanetCheck.NotDue

        val etag = try {
            val response = client.head(url)
            if (!response.status.isSuccess()) return PlanetCheck.Unreachable("download.versatiles.org answered ${response.status}")
            response.headers[HttpHeaders.ETag] ?: return PlanetCheck.Unreachable("download.versatiles.org sent no ETag")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return PlanetCheck.Unreachable(e.message ?: e.toString())
        }

        return when {
            seen == null -> PlanetCheck.FirstSeen.also { write(etag) }
            seen.etag == etag -> PlanetCheck.Unchanged.also { write(etag) }
            else -> PlanetCheck.Changed.also { pending = etag }
        }
    }

    /** The packs were refreshed for the planet the last [PlanetCheck.Changed] reported. */
    fun refreshed() {
        pending?.let(::write)
        pending = null
    }

    private data class Seen(val etag: String, val checkedAtMillis: Long)

    private fun read(): Seen? = runCatching {
        val (etag, at) = fileSystem.read(stateFile) { readUtf8() }.trimEnd('\n').split("\n")
        Seen(etag, at.toLong())
    }.getOrNull()

    private fun write(etag: String) {
        stateFile.parent?.let(fileSystem::createDirectories)
        fileSystem.write(stateFile) { writeUtf8("$etag\n${clock()}\n") }
    }
}
