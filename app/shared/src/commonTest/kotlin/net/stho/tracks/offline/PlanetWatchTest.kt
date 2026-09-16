package net.stho.tracks.offline

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlinx.coroutines.test.runTest
import okio.Path.Companion.toPath
import okio.fakefilesystem.FakeFileSystem

class PlanetWatchTest {
    private val fileSystem = FakeFileSystem()
    private val state = "/offline/planet".toPath()
    private val day = 24L * 60 * 60 * 1000
    private var now = 1_789_430_400_000L

    private var etag: String? = "\"a-9065\""
    private var offline = false
    private val requests = mutableListOf<String>()

    private val engine = MockEngine { request ->
        requests += "${request.method.value} ${request.url}"
        if (offline) error("no route to host")
        respond(ByteArray(0), HttpStatusCode.OK, etag?.let { headersOf(HttpHeaders.ETag, it) } ?: headersOf())
    }

    private fun watch() = PlanetWatch(HttpClient(engine), state, clock = { now }, fileSystem = fileSystem)

    @Test
    fun theFirstLookRecordsThePlanetAndRefreshesNothing() = runTest {
        assertEquals(PlanetCheck.FirstSeen, watch().check(Network.Unmetered))
        assertEquals(listOf("HEAD https://download.versatiles.org/osm.versatiles"), requests)
    }

    @Test
    fun onlyAnUnmeteredNetworkAsksAndOnlyOnceAWeek() = runTest {
        val watch = watch()
        assertEquals(PlanetCheck.NotDue, watch.check(Network.Metered))
        assertEquals(PlanetCheck.NotDue, watch.check(null))
        assertEquals(emptyList(), requests)

        watch.check(Network.Unmetered)
        now += 6 * day
        assertEquals(PlanetCheck.NotDue, watch().check(Network.Unmetered), "a watch started again remembers when it looked")
        now += 2 * day
        assertEquals(PlanetCheck.Unchanged, watch.check(Network.Unmetered))
        assertEquals(2, requests.size)
    }

    @Test
    fun aNewPlanetIsReportedUntilItsRefreshIsDone() = runTest {
        watch().check(Network.Unmetered)
        etag = "\"b-9120\""
        now += 8 * day

        val watch = watch()
        assertEquals(PlanetCheck.Changed, watch.check(Network.Unmetered))
        // The app was killed before the packs were refreshed: next week, it is still new.
        now += 8 * day
        assertEquals(PlanetCheck.Changed, watch().check(Network.Unmetered))

        val again = watch()
        assertEquals(PlanetCheck.Changed, again.check(Network.Unmetered))
        again.refreshed()
        now += 8 * day
        assertEquals(PlanetCheck.Unchanged, watch().check(Network.Unmetered))
    }

    @Test
    fun anAnswerWithoutAnETagOrNoAnswerIsNotAChange() = runTest {
        watch().check(Network.Unmetered)
        now += 8 * day

        etag = null
        assertIs<PlanetCheck.Unreachable>(watch().check(Network.Unmetered))
        offline = true
        assertIs<PlanetCheck.Unreachable>(watch().check(Network.Unmetered))

        offline = false
        etag = "\"a-9065\""
        assertEquals(PlanetCheck.Unchanged, watch().check(Network.Unmetered))
    }
}
