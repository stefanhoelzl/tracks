package net.stho.tracks.upload

import net.stho.tracks.recording.RECORDED_SOURCE
import net.stho.tracks.recording.Ride
import net.stho.tracks.recording.RideFrame
import net.stho.tracks.recording.Rides

/** A saved ride the server would not take, and what it said. It stays on the phone. */
data class Refusal(val rideId: String, val title: String, val message: String)

sealed interface UploadOutcome {
    data object NothingToUpload : UploadOutcome

    /** No session, an expired one, or one the server turned away: the rides wait for the password. */
    data object SignInNeeded : UploadOutcome

    /** Tracks could not be reached, or did not answer properly: the rides wait, and this is tried again. */
    data class Unreachable(val message: String) : UploadOutcome

    data class Done(val uploaded: Int, val refused: List<Refusal>) : UploadOutcome
}

/**
 * Sends every saved ride to Tracks, the way the web imports: ask which are missing, then one request per ride.
 *
 * That makes it safe to run at any moment and to stop at any moment. A ride whose response was lost is not sent twice,
 * because the next `select` no longer asks for it; and the upsert key is `(user, source, external_id)`, so even a ride
 * that is sent twice lands once. A ride leaves the phone — its journal is deleted — only once the server has it.
 */
class Uploader(
    private val rides: Rides,
    private val api: TracksApi,
    private val sessions: SessionStore,
    private val clock: () -> Long,
) {
    suspend fun upload(): UploadOutcome {
        val waiting = rides.all().filter { it.state == Ride.State.Saved }
        if (waiting.isEmpty()) return UploadOutcome.NothingToUpload
        // An expired session is not worth a request: the server's answer is already known.
        val session = sessions.load()?.takeUnless { it.expired(clock()) } ?: return UploadOutcome.SignInNeeded

        return try {
            val wanted = api.wanted(session, RECORDED_SOURCE, waiting.map { it.id })
            var uploaded = 0
            val refused = mutableListOf<Refusal>()
            for (ride in waiting) {
                if (ride.id in wanted) {
                    val title = ride.saved?.title.orEmpty()
                    try {
                        api.import(session, RideFrame.of(ride))
                        uploaded++
                    } catch (e: ApiException.Refused) {
                        refused += Refusal(ride.id, title, e.message.orEmpty())
                        continue
                    } catch (e: IllegalArgumentException) {
                        refused += Refusal(ride.id, title, e.message.orEmpty())
                        continue
                    }
                }
                // Sent just now, or landed on an earlier attempt whose answer never arrived.
                rides.delete(ride.id)
            }
            UploadOutcome.Done(uploaded, refused)
        } catch (e: ApiException.Unauthorized) {
            sessions.forget()
            UploadOutcome.SignInNeeded
        } catch (e: ApiException.Unavailable) {
            UploadOutcome.Unreachable(e.message.orEmpty())
        } catch (e: ApiException.Refused) {
            // `select` itself refused: nothing about any one ride, so they all wait.
            UploadOutcome.Unreachable(e.message.orEmpty())
        }
    }
}
