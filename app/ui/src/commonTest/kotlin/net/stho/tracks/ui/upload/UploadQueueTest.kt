package net.stho.tracks.ui.upload

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlin.random.Random
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.importing.ImportFrame
import net.stho.tracks.recording.Entry
import net.stho.tracks.recording.Rides
import net.stho.tracks.sensors.Fix
import net.stho.tracks.upload.FileSessionStore
import net.stho.tracks.upload.Session
import net.stho.tracks.upload.TracksApi
import okio.FileSystem

@OptIn(ExperimentalCoroutinesApi::class)
class UploadQueueTest {
    private val now = 1_783_062_000_000L
    private val day = 24 * 60 * 60 * 1000L
    private val dir = FileSystem.SYSTEM_TEMPORARY_DIRECTORY / "tracks-queue-${Random.nextLong().toULong()}"

    @AfterTest
    fun cleanUp() = FileSystem.SYSTEM.deleteRecursively(dir)

    private val rides = Rides(dir / "rides")
    private val sessions = FileSessionStore(dir / "session")
    private val email = "rider@example.test"
    private val token = "7.${now + 30 * day}.signature"

    private var reachable = true
    private val landed = mutableListOf<String>()

    private val engine = MockEngine { request ->
        val json = headersOf(HttpHeaders.ContentType, "application/json")
        if (!reachable) return@MockEngine respond("""{"error":"bad gateway"}""", HttpStatusCode.BadGateway, json)
        val body = (request.body as? TextContent)?.text.orEmpty()
        when (request.url.encodedPath) {
            "/api/session" ->
                if ("\"password\":\"correct horse\"" in body) {
                    respond("""{"email":"$email"}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType to listOf("application/json"), HttpHeaders.SetCookie to listOf("tracks_session=$token; Path=/")))
                } else {
                    respond("""{"error":"wrong email or password"}""", HttpStatusCode.Unauthorized, json)
                }
            "/api/import/select" -> respond("""{"wanted":${Json.parseToJsonElement(body).jsonObject["ids"]}}""", HttpStatusCode.OK, json)
            "/api/import" -> {
                landed += ImportFrame.parse(body).externalId
                respond("""{"rejectedTags":[]}""", HttpStatusCode.OK, json)
            }
            else -> respond("""{"error":"no route"}""", HttpStatusCode.NotFound, json)
        }
    }

    private fun TestScope.queue() =
        UploadQueue(rides, TracksApi(HttpClient(engine), "https://tracks.test"), sessions, backgroundScope, clock = { now + testScheduler.currentTime })

    private fun saved(id: String) {
        rides.start(Entry.Started(id, now, null, null)).use { journal ->
            journal.append(Entry.Located(Fix(Coordinate(47.0, 11.0), 700.0, null, 5.0, 5.0, now + 1000)))
            journal.append(Entry.Stopped(now + 2000))
            journal.append(Entry.Saved("Ride $id", "bike"))
        }
    }

    @Test
    fun aRideWaitsForThePasswordAndThenUploads() = runTest {
        saved("a")
        val queue = queue()
        queue.state.first { it.needsSignIn && it.waiting == 1 }

        assertEquals("Wrong email or password.", queue.signIn(email, "wrong horse"))
        assertNull(queue.signIn(" $email ", "correct horse"))

        val done = queue.state.first { it.waiting == 0 && !it.uploading }
        assertEquals(email, done.signedInAs)
        assertEquals(listOf("a"), landed)
    }

    @Test
    fun withNoConnectionItTriesAgainLater() = runTest {
        sessions.save(Session(email, token))
        saved("a")
        reachable = false
        val queue = queue()
        queue.state.first { it.unreachable != null && it.waiting == 1 }

        reachable = true
        advanceTimeBy(FIRST_RETRY_MS - 1000)
        runCurrent()
        assertEquals(emptyList(), landed)

        advanceTimeBy(2000)
        queue.state.first { it.waiting == 0 }
        assertEquals(listOf("a"), landed)
    }

    @Test
    fun aSavedRideGoesAsSoonAsTheQueueIsTold() = runTest {
        sessions.save(Session(email, token))
        val queue = queue()
        runCurrent()

        saved("b")
        queue.kick()
        queue.state.first { it.waiting == 0 && landed.isNotEmpty() }
        assertEquals(listOf("b"), landed)
    }

    @Test
    fun aSessionAboutToEndIsSaidThreeDaysAhead() = runTest {
        sessions.save(Session(email, "7.${now + 2 * day}.signature"))
        val ending = queue().state.first { it.signedInAs != null }.sessionEndsInMs
        assertTrue(ending != null && ending in (2 * day - 1000)..(2 * day), "ends in $ending")

        sessions.save(Session(email, token))
        assertNull(queue().state.first { it.signedInAs != null }.sessionEndsInMs)
    }
}
