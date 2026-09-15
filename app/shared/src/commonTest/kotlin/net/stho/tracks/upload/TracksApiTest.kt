package net.stho.tracks.upload

import io.ktor.client.HttpClient
import kotlin.random.Random
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import okio.FileSystem

class TracksApiTest {
    private val now = 1_783_062_000_000L
    private val tracks = FakeTracks(now)
    private val api = TracksApi(HttpClient(tracks.engine), "https://tracks.test/")

    @Test
    fun signingInKeepsTheCookiesValue() = runTest {
        val session = api.signIn("rider@example.test", "correct horse")
        assertEquals(tracks.session(), session)
        assertEquals(now + 30L * 24 * 60 * 60 * 1000, session.expiresAtMillis)
        assertFalse(session.expired(now))
        assertTrue(session.expired(session.expiresAtMillis!!))
    }

    @Test
    fun aWrongPasswordIsUnauthorized() = runTest {
        val refused = assertFailsWith<ApiException.Unauthorized> { api.signIn("rider@example.test", "wrong horse") }
        assertEquals("wrong email or password", refused.message)
    }

    @Test
    fun aSignInWhoseCookieWasStrippedSaysSo() = runTest {
        tracks.stripCookie = true
        val failure = assertFailsWith<ApiException.Unavailable> { api.signIn("rider@example.test", "correct horse") }
        assertTrue("Set-Cookie" in failure.message!!)
    }

    @Test
    fun theCookieIsFoundHoweverTheHeadersArrive() {
        assertEquals("7.123.abc", sessionToken("tracks_session=7.123.abc; Path=/; HttpOnly"))
        // NSURLSession's join of two headers, with a comma inside the first one's date.
        assertEquals("7.123.a-b_c", sessionToken("other=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT, tracks_session=7.123.a-b_c; Path=/"))
        assertNull(sessionToken("tracks_session=; Max-Age=0; Path=/"))
        assertNull(sessionToken("not_tracks_session=7.123.abc"))
    }

    @Test
    fun failuresAreSortedByWhatToDoAboutThem() = runTest {
        val session = tracks.session()
        assertFailsWith<ApiException.Unauthorized> { api.wanted(Session(tracks.email, "7.1.forged"), "tracks", listOf("a")) }

        tracks.status = io.ktor.http.HttpStatusCode.BadGateway
        assertFailsWith<ApiException.Unavailable> { api.wanted(session, "tracks", listOf("a")) }

        tracks.status = null
        tracks.offline = true
        assertFailsWith<ApiException.Unavailable> { api.wanted(session, "tracks", listOf("a")) }
    }

    private val dir = FileSystem.SYSTEM_TEMPORARY_DIRECTORY / "tracks-session-${Random.nextLong().toULong()}"

    @AfterTest
    fun cleanUp() = FileSystem.SYSTEM.deleteRecursively(dir)

    @Test
    fun aForgottenSessionKeepsItsAddress() {
        val store = FileSessionStore(dir / "session")
        assertNull(store.load())
        store.save(tracks.session())
        assertEquals(tracks.session(), FileSessionStore(dir / "session").load())
        store.forget()
        assertNull(store.load())
        assertEquals(tracks.email, store.lastEmail())
    }
}
