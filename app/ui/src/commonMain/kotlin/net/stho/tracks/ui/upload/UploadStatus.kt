package net.stho.tracks.ui.upload

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import net.stho.tracks.ui.harness.Button
import net.stho.tracks.ui.harness.Field
import net.stho.tracks.ui.harness.Label
import net.stho.tracks.ui.harness.Pill
import net.stho.tracks.ui.harness.Sheet
import net.stho.tracks.ui.harness.Title

private const val DAY_MS = 24 * 60 * 60 * 1000L

/**
 * What the queue is doing, when there is something to say: rides waiting, a password needed, a session about to end,
 * a ride Tracks would not take. Quiet otherwise.
 *
 * Its own component, because where it lives is the home screen's sheet (M12), beside the plans.
 */
@Composable
fun UploadStatus(queue: UploadQueue) {
    val state by queue.state.collectAsState()
    var signingIn by remember { mutableStateOf(false) }
    if (signingIn) {
        SignInSheet(queue, onClose = { signingIn = false })
        return
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        state.refused.forEach { Pill { Label("“${it.title}” was not accepted: ${it.message}") } }

        val rides = if (state.waiting == 1) "1 ride" else "${state.waiting} rides"
        val ending = state.sessionEndsInMs
        when {
            state.needsSignIn -> {
                Pill { Label("$rides waiting · sign in to upload") }
                Button("Sign in") { signingIn = true }
            }
            ending != null -> {
                val days = ((ending + DAY_MS - 1) / DAY_MS).coerceAtLeast(1)
                Pill { Label("Signed in for ${if (days == 1L) "1 more day" else "$days more days"} · sign in again to stay signed in") }
                Button("Sign in again", quiet = true) { signingIn = true }
            }
            state.waiting > 0 -> Pill {
                Label(
                    when {
                        state.uploading -> "Uploading $rides…"
                        state.unreachable != null -> "$rides waiting to upload · no connection to Tracks"
                        else -> "$rides waiting to upload"
                    },
                )
            }
        }
    }
}

/** The web's sign-in, on the phone: an address and a password, sent once and never kept. */
@Composable
fun SignInSheet(queue: UploadQueue, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf(queue.lastEmail.orEmpty()) }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    Sheet {
        Title("Sign in to Tracks")
        Field(email, onValueChange = { email = it }, label = "Email")
        Field(password, onValueChange = { password = it }, label = "Password", secret = true)
        error?.let { Label(it) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            Button("Cancel", quiet = true, onClick = onClose)
            Button(if (busy) "Signing in…" else "Sign in") {
                if (busy) return@Button
                busy = true
                error = null
                scope.launch {
                    val failure = queue.signIn(email, password)
                    busy = false
                    if (failure == null) onClose() else error = failure
                }
            }
        }
    }
}
