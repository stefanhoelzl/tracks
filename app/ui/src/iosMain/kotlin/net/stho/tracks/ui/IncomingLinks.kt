package net.stho.tracks.ui

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow

/**
 * Links iOS opened the app with — a tracks.stho.net plan link tapped in Messages or Mail — on their way to the app's
 * intake, where they land in the plan list as a pasted one does.
 *
 * A channel rather than a shared flow: a link that arrives at launch, before the screen is collecting, waits for it, and
 * each link is taken in exactly once however often the screen recomposes.
 */
object IncomingLinks {
    private val channel = Channel<String>(Channel.BUFFERED)

    val links: Flow<String> = channel.receiveAsFlow()

    /** Called by the Swift shell with the link's full URL, fragment included. */
    fun receive(url: String) {
        channel.trySend(url)
    }
}
