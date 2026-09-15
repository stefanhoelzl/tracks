package net.stho.tracks.upload

import io.ktor.client.HttpClient
import io.ktor.http.HttpStatusCode
import kotlin.random.Random
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.recording.Entry
import net.stho.tracks.recording.RideFrame
import net.stho.tracks.recording.Rides
import net.stho.tracks.sensors.Fix
import okio.FileSystem

class UploaderTest {
    private val now = 1_783_062_000_000L
    private val dir = FileSystem.SYSTEM_TEMPORARY_DIRECTORY / "tracks-upload-${Random.nextLong().toULong()}"

    @AfterTest
    fun cleanUp() = FileSystem.SYSTEM.deleteRecursively(dir)

    private val rides = Rides(dir / "rides")
    private val sessions = FileSessionStore(dir / "session")
    private val tracks = FakeTracks(now)
    private val uploader = Uploader(rides, TracksApi(HttpClient(tracks.engine), "https://tracks.test"), sessions, clock = { now })

    private fun ride(id: String, saved: Boolean = true) {
        rides.start(Entry.Started(id, now + id.hashCode() % 1000, null, null)).use { journal ->
            (0..3).forEach { s -> journal.append(Entry.Located(Fix(Coordinate(47.0 + s * 0.0001, 11.0), 700.0, null, 5.0, 5.0, now + s * 1000L))) }
            journal.append(Entry.Stopped(now + 4000))
            if (saved) journal.append(Entry.Saved("Ride $id", "bike"))
        }
    }

    private fun waiting() = rides.all().map { it.id }.sorted()

    @Test
    fun everySavedRideIsSentAndThenLeavesThePhone() = runTest {
        sessions.save(tracks.session())
        ride("a")
        ride("b")
        ride("c", saved = false)

        assertEquals(UploadOutcome.Done(uploaded = 2, refused = emptyList()), uploader.upload())
        assertEquals(setOf("a", "b"), tracks.landed.keys)
        assertEquals("tracks", tracks.landed.getValue("a").source)
        assertEquals("Ride a", tracks.landed.getValue("a").title)
        assertEquals(listOf("c"), waiting())
        assertEquals(listOf("POST /api/import/select", "POST /api/import", "POST /api/import"), tracks.requests)
    }

    @Test
    fun aRideThatAlreadyLandedIsNotSentAgain() = runTest {
        sessions.save(tracks.session())
        ride("a")
        tracks.landed["a"] = RideFrame.of(rides.get("a"))

        assertEquals(UploadOutcome.Done(uploaded = 0, refused = emptyList()), uploader.upload())
        assertEquals(listOf("POST /api/import/select"), tracks.requests)
        assertEquals(emptyList(), waiting())
    }

    @Test
    fun withNothingSavedNothingIsAsked() = runTest {
        ride("a", saved = false)
        assertEquals(UploadOutcome.NothingToUpload, uploader.upload())
        assertEquals(emptyList(), tracks.requests)
    }

    @Test
    fun withoutASessionOrWithAnExpiredOneRidesWaitUnsent() = runTest {
        ride("a")
        assertEquals(UploadOutcome.SignInNeeded, uploader.upload())

        sessions.save(Session(tracks.email, "7.$now.signature"))
        assertEquals(UploadOutcome.SignInNeeded, uploader.upload())

        assertEquals(emptyList(), tracks.requests)
        assertEquals(listOf("a"), waiting())
    }

    @Test
    fun aSessionTheServerTurnsAwayIsForgottenAndRidesWait() = runTest {
        sessions.save(Session(tracks.email, "7.9999999999999.from-before-the-password-changed"))
        ride("a")

        assertEquals(UploadOutcome.SignInNeeded, uploader.upload())
        assertNull(sessions.load())
        assertEquals(tracks.email, sessions.lastEmail())
        assertEquals(listOf("a"), waiting())
    }

    @Test
    fun noConnectionKeepsEverything() = runTest {
        sessions.save(tracks.session())
        ride("a")

        tracks.offline = true
        assertIs<UploadOutcome.Unreachable>(uploader.upload())
        tracks.offline = false
        tracks.status = HttpStatusCode.BadGateway
        assertIs<UploadOutcome.Unreachable>(uploader.upload())

        assertEquals(listOf("a"), waiting())
        assertEquals(tracks.session(), sessions.load())
    }

    @Test
    fun aRefusedRideStaysAndDoesNotHoldUpTheRest() = runTest {
        sessions.save(tracks.session())
        ride("a")
        ride("b")
        tracks.refuse += "a"

        assertEquals(
            UploadOutcome.Done(uploaded = 1, refused = listOf(Refusal("a", "Ride a", "altitudes has 3 entries for 4 points"))),
            uploader.upload(),
        )
        assertEquals(listOf("a"), waiting())
    }
}
