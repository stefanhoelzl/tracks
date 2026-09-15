package net.stho.tracks.ui.map

import androidx.compose.runtime.Composable
import java.awt.Window
import org.maplibre.compose.desktop.ProvideMapPresentationHost
import org.maplibre.compose.desktop.rememberAwtComposeMapPresentationHost

/** MapLibre's process-wide setup on the desktop: [configureMaps], as the phone's. */
fun configureDesktopMap(cacheFile: String? = null, rewriteUrl: (String) -> String? = { null }) = configureMaps(cacheFile, rewriteUrl)

/** The desktop's map needs the AWT window it is drawn in; every [TracksMap] inside [content] gets it. */
@Composable
fun DesktopMapHost(window: Window, content: @Composable () -> Unit) {
    ProvideMapPresentationHost(host = rememberAwtComposeMapPresentationHost(window), content = content)
}
