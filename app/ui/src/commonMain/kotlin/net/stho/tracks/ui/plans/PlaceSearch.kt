package net.stho.tracks.ui.plans

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.places.PhotonGeocoder
import net.stho.tracks.places.Place
import net.stho.tracks.ui.theme.Shapes
import net.stho.tracks.ui.theme.Tokens
import net.stho.tracks.ui.theme.Type

/** Long enough that a fast typist sends one request, short enough to feel immediate. */
private val DEBOUNCE = 250.milliseconds

/**
 * Finding a place by name, through Photon, while there is a signal.
 *
 * One request per pause, and the one in flight is abandoned when another keystroke supersedes it — photon.komoot.io is
 * keyless and public. Without a signal it says so, and what to do instead: tap the map, where a stop takes its name
 * from the label under it. Picking a result raises the same dialog a tap does.
 */
@Composable
fun PlaceSearch(geocoder: PhotonGeocoder, near: () -> Coordinate?, onPick: (Place) -> Unit, modifier: Modifier = Modifier) {
    var query by remember { mutableStateOf("") }
    var places by remember { mutableStateOf(emptyList<Place>()) }
    var offline by remember { mutableStateOf(false) }
    val currentNear by rememberUpdatedState(near)

    LaunchedEffect(query) {
        if (query.isBlank()) {
            places = emptyList()
            offline = false
            return@LaunchedEffect
        }
        delay(DEBOUNCE)
        try {
            places = geocoder.search(query, currentNear())
            offline = false
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            places = emptyList()
            offline = true
        }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        BasicTextField(
            value = query,
            onValueChange = { query = it },
            singleLine = true,
            textStyle = Type.body,
            cursorBrush = SolidColor(Tokens.accent),
            decorationBox = { field ->
                Box(Modifier.fillMaxWidth().background(Tokens.sunk, Shapes.control).padding(horizontal = 12.dp, vertical = 10.dp)) {
                    if (query.isEmpty()) BasicText("Search for a place", style = Type.body.copy(color = Tokens.muted))
                    field()
                }
            },
        )
        if (offline) {
            BasicText("No connection for search. Tap the map instead — a stop takes its name from the map.", style = Type.note)
        }
        for (place in places) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable {
                        onPick(place)
                        // The list has answered the question it was asked.
                        query = ""
                    }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                BasicText(place.name, style = Type.body)
                if (place.context.isNotEmpty()) BasicText(place.context, style = Type.mono)
            }
        }
    }
}
