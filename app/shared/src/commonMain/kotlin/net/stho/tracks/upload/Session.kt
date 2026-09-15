package net.stho.tracks.upload

import okio.FileSystem
import okio.Path

/** The cookie Tracks signs a session into. */
const val SESSION_COOKIE = "tracks_session"

/** How long before a session ends the app says so: long enough to be at home with the password when it does. */
const val RENEW_NOTICE_MS = 3 * 24 * 60 * 60 * 1000L

/**
 * A signed-in session: the cookie's value, and whose it is.
 *
 * The same cookie the web gets from `POST /api/session`, kept by the app rather than a cookie jar and sent by hand. So
 * a password changed on the web ends it here too, because the key that signed it no longer exists: M6's revocation,
 * with nothing added for the phone.
 */
data class Session(val email: String, val token: String) {
    /**
     * When the server stops accepting it. Read from the token — `<userId>.<expiry>.<signature>` — whose expiry the
     * server checks, rather than from the cookie's `Expires`, which is a request to a cookie jar this app does not use.
     */
    val expiresAtMillis: Long? get() = token.split('.').getOrNull(1)?.toLongOrNull()

    fun expired(now: Long): Boolean = expiresAtMillis?.let { it <= now } ?: false
}

/** Where the session is kept between launches: the Keychain on the phone, a file in the harness. */
interface SessionStore {
    fun load(): Session?

    fun save(session: Session)

    /** Forgets the token and keeps the address, so the form asking for the password again is already half filled in. */
    fun forget()

    fun lastEmail(): String?
}

/** A [SessionStore] in a file: for the desktop harness and tests, never for a phone. */
class FileSessionStore(private val path: Path, private val fileSystem: FileSystem = FileSystem.SYSTEM) : SessionStore {
    override fun load(): Session? {
        val (email, token) = read()
        return if (email != null && token != null) Session(email, token) else null
    }

    override fun save(session: Session) = write(session.email, session.token)

    override fun forget() = write(lastEmail(), null)

    override fun lastEmail(): String? = read().first

    private fun read(): Pair<String?, String?> {
        if (!fileSystem.exists(path)) return null to null
        val lines = fileSystem.read(path) { readUtf8() }.lines()
        return lines.getOrNull(0)?.ifEmpty { null } to lines.getOrNull(1)?.ifEmpty { null }
    }

    private fun write(email: String?, token: String?) {
        path.parent?.let(fileSystem::createDirectories)
        val next = path.parent!! / "${path.name}.next"
        fileSystem.write(next) { writeUtf8("${email.orEmpty()}\n${token.orEmpty()}\n") }
        fileSystem.atomicMove(next, path)
    }
}
