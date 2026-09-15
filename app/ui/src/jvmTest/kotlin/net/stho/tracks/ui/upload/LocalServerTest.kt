package net.stho.tracks.ui.upload

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import java.io.File
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.recording.Rides
import net.stho.tracks.ui.recording.Recorder
import net.stho.tracks.ui.recording.RecorderState
import net.stho.tracks.ui.sensors.ReplaySensors
import net.stho.tracks.ui.sensors.RideReplay
import net.stho.tracks.ui.sensors.shared
import net.stho.tracks.upload.FileSessionStore
import net.stho.tracks.upload.SESSION_COOKIE
import net.stho.tracks.upload.TracksApi
import net.stho.tracks.upload.UploadOutcome
import net.stho.tracks.upload.Uploader
import okio.Path.Companion.toOkioPath

/**
 * The whole of recording and the upload against a real Tracks: the bundled ride replayed into the recorder, saved,
 * uploaded through the real routes, and read back.
 *
 * CI's `ui` job and .ship/gates.sh run it against a throwaway server started for the run, and on CI a missing server
 * fails it rather than skipping it:
 *
 *     app/scripts/local-tracks.sh ./gradlew :ui:jvmTest --tests '*LocalServerTest*'
 *
 * Or against a `pnpm dev:local` already running, at `TRACKS_E2E_SERVER='http://[::1]:5173'` — Vite's `localhost` is
 * IPv6 loopback only here, and Java tries 127.0.0.1 first. Given neither, outside CI, it does nothing.
 *
 * It signs in as the account migration 0004 seeds, which the dev server claims with the password `password`. Against
 * `data/dev.db`, every run lands one more activity. It refuses tracks.stho.net: a test never writes to production.
 */
class LocalServerTest {
    private val server = System.getenv("TRACKS_E2E_SERVER")
    private val email = System.getenv("TRACKS_E2E_EMAIL") ?: "you@example.com"
    private val password = System.getenv("TRACKS_E2E_PASSWORD") ?: "password"

    @Test
    fun aReplayedRideLandsInALocalTracks() = runBlocking {
        if (server == null) {
            check(System.getenv("CI") == null) { "TRACKS_E2E_SERVER is not set: CI runs the UI tests through app/scripts/local-tracks.sh" }
            return@runBlocking println("LocalServerTest: TRACKS_E2E_SERVER is not set, so nothing ran")
        }
        require("tracks.stho.net" !in server) { "a test never uploads to production" }

        val dir = File(System.getProperty("java.io.tmpdir"), "tracks-e2e-${Random.nextLong().toULong()}")
        val ui = Dispatchers.Default.limitedParallelism(1)
        val scope = CoroutineScope(ui + SupervisorJob())
        try {
            val rides = Rides((dir.resolve("rides")).toOkioPath())
            val sessions = FileSessionStore(dir.resolve("session").toOkioPath())
            val client = tracksHttpClient()
            val api = TracksApi(client, server)
            sessions.save(api.signIn(email, password))

            val xml = File("src/commonMain/composeResources/files/rides/garmisch.gpx").readText()
            val recorder = withContext(ui) {
                Recorder(rides, ReplaySensors(RideReplay.gpx(xml), speedup = 1000.0).shared(scope), scope, dateTitle = { "unused" })
            }
            withContext(ui) { recorder.start() }
            withTimeout(2.minutes) {
                recorder.state.first { (it as? RecorderState.Recording)?.distanceM?.let { m -> m > 5_900 } == true }
            }
            delay(1_000)
            val title = "Garmisch, replayed ${Random.nextInt(1000)}"
            withContext(ui) {
                recorder.stop()
                recorder.save(title, "bike")
            }

            assertEquals(
                UploadOutcome.Done(uploaded = 1, refused = emptyList()),
                Uploader(rides, api, sessions, clock = System::currentTimeMillis).upload(),
            )
            assertEquals(emptyList(), rides.all())

            val listed = client.get("${server.trimEnd('/')}/api/activities") {
                header(HttpHeaders.Cookie, "$SESSION_COOKIE=${sessions.load()!!.token}")
            }.bodyAsText()
            val row = Json.parseToJsonElement(listed).jsonObject.getValue("activities").jsonArray
                .map { it.jsonObject }
                .single { it["title"]?.jsonPrimitive?.content == title }
            println("LocalServerTest: $row")

            assertEquals("tracks", row.getValue("source").jsonPrimitive.content)
            val tags = row.getValue("tags").jsonArray.map { it.jsonPrimitive.content }
            assertTrue("sport:bike" in tags && "source:tracks" in tags, "tags $tags")
            assertTrue(row.getValue("distanceM").jsonPrimitive.double in 5_800.0..6_050.0, "distance ${row["distanceM"]}")
            assertTrue(row.getValue("elevationGainM").jsonPrimitive.double in 180.0..230.0, "ascent ${row["elevationGainM"]}")
            assertEquals(7200, row.getValue("utcOffset").jsonPrimitive.content.toInt(), "Garmisch in summer is UTC+2")
        } finally {
            scope.cancel()
            dir.deleteRecursively()
        }
    }
}
