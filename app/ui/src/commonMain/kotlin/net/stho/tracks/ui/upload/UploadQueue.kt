package net.stho.tracks.ui.upload

import kotlin.time.Clock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import net.stho.tracks.recording.Ride
import net.stho.tracks.recording.Rides
import net.stho.tracks.upload.ApiException
import net.stho.tracks.upload.RENEW_NOTICE_MS
import net.stho.tracks.upload.Refusal
import net.stho.tracks.upload.SessionStore
import net.stho.tracks.upload.TracksApi
import net.stho.tracks.upload.UploadOutcome
import net.stho.tracks.upload.Uploader

/** With nothing failing, the queue looks again this often, whatever else has told it to. */
const val IDLE_RECHECK_MS = 15 * 60_000L

/** The first retry after Tracks could not be reached; each one after waits twice as long, up to [IDLE_RECHECK_MS]. */
const val FIRST_RETRY_MS = 30_000L

data class QueueState(
    /** Saved rides not yet in Tracks. */
    val waiting: Int = 0,
    val signedInAs: String? = null,
    /** Rides are waiting and there is no session to send them with: ask for the password. */
    val needsSignIn: Boolean = false,
    /** How long the session has left, once that is less than [RENEW_NOTICE_MS]. */
    val sessionEndsInMs: Long? = null,
    val uploading: Boolean = false,
    /** Why the last attempt did not reach Tracks, while rides are waiting. */
    val unreachable: String? = null,
    val refused: List<Refusal> = emptyList(),
)

/**
 * The upload queue: saved rides go to Tracks whenever they can, quietly.
 *
 * It tries when it starts, whenever it is [kick]ed — a ride saved, a sign-in, the network coming back — and otherwise
 * every [IDLE_RECHECK_MS], retrying sooner with a backoff while Tracks cannot be reached. There is no queue to keep
 * beside the rides: what waits is whatever journal on disk says it was saved, so a queue started again after the app
 * died is the same queue.
 *
 * [scope] must be single-threaded, as the UI's is.
 */
class UploadQueue(
    private val rides: Rides,
    private val api: TracksApi,
    private val sessions: SessionStore,
    scope: CoroutineScope,
    private val clock: () -> Long = { Clock.System.now().toEpochMilliseconds() },
) {
    private val uploader = Uploader(rides, api, sessions, clock)
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var last: UploadOutcome? = null

    private val mutableState = MutableStateFlow(QueueState())
    val state: StateFlow<QueueState> = mutableState.asStateFlow()

    val lastEmail: String? get() = sessions.lastEmail()

    init {
        scope.launch { run() }
    }

    /** Try now rather than at the next retry. */
    fun kick() {
        wake.trySend(Unit)
    }

    /**
     * Signs in and sends whatever was waiting. Returns what to tell the person when it did not work, or null.
     *
     * **One short sentence per kind, never the exception's own words.** What a failed request throws
     * is a library's sentence about a host and a domain and a negative number, and there is no length
     * it cannot be; on a sheet that had it above the buttons, it pushed them off the screen. The
     * thrown text is worth having in a log and worth nothing on a phone in the rain.
     */
    suspend fun signIn(email: String, password: String): String? = try {
        sessions.save(api.signIn(email.trim(), password))
        publish(uploading = false)
        kick()
        null
    } catch (e: ApiException.Unauthorized) {
        "Wrong email or password."
    } catch (e: ApiException.Refused) {
        "Tracks refused that (${e.status})."
    } catch (e: ApiException) {
        "No connection to Tracks."
    }

    private suspend fun run() {
        var retry = FIRST_RETRY_MS
        while (true) {
            publish(uploading = true)
            last = uploader.upload()
            val wait = if (last is UploadOutcome.Unreachable) {
                retry.also { retry = minOf(retry * 2, IDLE_RECHECK_MS) }
            } else {
                retry = FIRST_RETRY_MS
                IDLE_RECHECK_MS
            }
            publish(uploading = false)
            withTimeoutOrNull(wait) { wake.receive() }
        }
    }

    private fun publish(uploading: Boolean) {
        val now = clock()
        val waiting = rides.all().count { it.state == Ride.State.Saved }
        val session = sessions.load()?.takeUnless { it.expired(now) }
        val outcome = last
        mutableState.value = QueueState(
            waiting = waiting,
            signedInAs = session?.email,
            needsSignIn = waiting > 0 && session == null,
            sessionEndsInMs = session?.expiresAtMillis?.minus(now)?.takeIf { it <= RENEW_NOTICE_MS },
            uploading = uploading && waiting > 0 && session != null,
            unreachable = (outcome as? UploadOutcome.Unreachable)?.message?.takeIf { waiting > 0 },
            refused = (outcome as? UploadOutcome.Done)?.refused.orEmpty(),
        )
    }
}
