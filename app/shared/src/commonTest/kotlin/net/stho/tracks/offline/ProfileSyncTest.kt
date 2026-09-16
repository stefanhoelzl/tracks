package net.stho.tracks.offline

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest
import okio.Path.Companion.toPath
import okio.fakefilesystem.FakeFileSystem

class ProfileSyncTest {
    private val fs = FakeFileSystem()
    private val bundled = "/bundle/profiles".toPath()
    private val directory = "/app/profiles".toPath()
    private val day = 24L * 60 * 60 * 1000
    private var now = 1_789_430_400_000L

    private fun profile(tag: String) = "# $tag\n---context:global\nassign x = 1\n"
    private val lookups11 = "---lookupversion:11\n---minorversion:2\n"

    /** brouter.de's profiles2, as its nginx answers: the same file for HEAD and GET, with an ETag per version. */
    private val served = PROFILE_FILES.associateWith { name -> (if (name == "lookups.dat") lookups11 else profile(name)) to "\"v1-$name\"" }
        .toMutableMap()
    private val requests = mutableListOf<String>()

    private val engine = MockEngine { request ->
        val name = request.url.encodedPath.substringAfterLast('/')
        requests += "${request.method.value} $name"
        val (body, etag) = served.getValue(name)
        val bytes = if (request.method == HttpMethod.Head) ByteArray(0) else body.encodeToByteArray()
        respond(bytes, HttpStatusCode.OK, headersOf(HttpHeaders.ETag, etag))
    }

    private val sync = ProfileSync(directory, HttpClient(engine), clock = { now }, fileSystem = fs, base = "https://brouter.test/profiles2")

    private fun seedBundle() {
        fs.createDirectories(bundled)
        for ((name, file) in served) fs.write(bundled / name) { writeUtf8(file.first) }
    }

    private fun onPhone(name: String) = fs.read(directory / name) { readUtf8() }

    @Test
    fun theBundledProfilesAreThereBeforeAnyNetwork() = runTest {
        seedBundle()
        sync.seed(bundled)

        assertEquals(profile("trekking.brf"), onPhone("trekking.brf"))
        assertEquals(ProfileSyncResult(emptyList(), null), sync.sync(Network.Metered))
        assertEquals(emptyList(), requests, "only an unmetered network asks brouter.de")
    }

    @Test
    fun aProfileChangedOnBrouterDeReplacesTheBundledOne() = runTest {
        seedBundle()
        sync.seed(bundled)
        served["hiking-mountain.brf"] = profile("SAC_access_penalty 999") to "\"v2\""

        val result = sync.sync(Network.Unmetered)

        assertEquals(listOf("hiking-mountain.brf"), result.updated, "the others were fetched once and found the same")
        assertNull(result.problem)
        assertEquals(profile("SAC_access_penalty 999"), onPhone("hiking-mountain.brf"))
        assertEquals("\"v2\"", sync.record("hiking-mountain.brf")?.etag)
    }

    @Test
    fun aWeekLaterAnUnchangedProfileCostsOneHead() = runTest {
        seedBundle()
        sync.seed(bundled)
        sync.sync(Network.Unmetered)
        requests.clear()

        now += 6 * day
        sync.sync(Network.Unmetered)
        assertEquals(emptyList(), requests)

        now += 2 * day
        assertEquals(emptyList(), sync.sync(Network.Unmetered).updated)
        assertEquals(PROFILE_FILES.map { "HEAD $it" }, requests)
    }

    @Test
    fun whatIsNotAProfileOrAnotherLookupVersionIsNotInstalled() = runTest {
        seedBundle()
        sync.seed(bundled)
        served["trekking.brf"] = "<html>502 Bad Gateway</html>" to "\"broken\""

        val broken = sync.sync(Network.Unmetered)
        assertNotNull(broken.problem)
        assertEquals(profile("trekking.brf"), onPhone("trekking.brf"))

        served["trekking.brf"] = profile("trekking.brf") to "\"v1-trekking.brf\""
        served["lookups.dat"] = "---lookupversion:12\n" to "\"v12\""
        now += 8 * day
        val newer = sync.sync(Network.Unmetered)
        assertNotNull(newer.problem)
        assertEquals(lookups11, onPhone("lookups.dat"), "the engine and its tiles keep agreeing")
    }
}
