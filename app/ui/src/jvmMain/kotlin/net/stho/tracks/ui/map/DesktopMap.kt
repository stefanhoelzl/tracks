package net.stho.tracks.ui.map

import androidx.compose.runtime.Composable
import java.awt.Window
import kotlinx.io.files.Path
import org.maplibre.compose.desktop.ProvideMapPresentationHost
import org.maplibre.compose.desktop.rememberAwtComposeMapPresentationHost
import org.maplibre.compose.map.DefaultMapRuntime
import org.maplibre.compose.map.MapRuntimeOptions
import org.maplibre.compose.resource.MapRequestInterceptor

/**
 * MapLibre's process-wide setup on the desktop. It must run before the first map is created, and only once.
 *
 * [cacheFile] is where MapLibre keeps what it downloaded (default: its own place under the user's cache). [rewriteUrl]
 * may send a request somewhere else — the screenshot tests serve their tiles locally — by returning the new URL, or
 * leave it alone by returning null.
 */
fun configureDesktopMap(cacheFile: String? = null, rewriteUrl: (String) -> String? = { null }) {
    DefaultMapRuntime.configure(
        MapRuntimeOptions(
            cacheFile = cacheFile?.let(::Path),
            requestInterceptor = MapRequestInterceptor(rewriteUrl = { rewriteUrl(it.url) }),
        ),
    )
}

/** The desktop's map needs the AWT window it is drawn in; every [TracksMap] inside [content] gets it. */
@Composable
fun DesktopMapHost(window: Window, content: @Composable () -> Unit) {
    ProvideMapPresentationHost(host = rememberAwtComposeMapPresentationHost(window), content = content)
}
