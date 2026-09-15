package net.stho.tracks.ui.map

import kotlinx.io.files.Path
import net.stho.tracks.ui.resources.Res
import org.maplibre.compose.map.DefaultMapRuntime
import org.maplibre.compose.map.MapRuntimeOptions
import org.maplibre.compose.resource.MapRequestInterceptor
import org.maplibre.compose.resource.MapResourceProvider

/**
 * Where an offline pack reads the app's style from: the app itself, under a scheme of its own.
 *
 * A pack names its style by URL, and the style ships inside the app. A `file://` URL was tried first, on the phone, and a
 * pack given one never got past its style (M13 step 0); a URL a [MapResourceProvider] answers is loaded like any
 * download, which is what a pack does with everything else.
 */
internal const val PACK_STYLE_URL = "tracks://styles/colorful.json"

/**
 * MapLibre's process-wide setup. It must run before the first map is created, and only once.
 *
 * [cacheFile] is where MapLibre keeps what it downloaded, offline packs included (default: its own place under the
 * platform's caches). [rewriteUrl] may send a request somewhere else — the screenshot tests serve their tiles locally —
 * by returning the new URL, or leave it alone by returning null.
 */
fun configureMaps(cacheFile: String? = null, rewriteUrl: (String) -> String? = { null }) {
    DefaultMapRuntime.configure(
        MapRuntimeOptions(
            cacheFile = cacheFile?.let(::Path),
            requestInterceptor = MapRequestInterceptor(rewriteUrl = { rewriteUrl(it.url) }),
            resourceProvider = MapResourceProvider(scheme = "tracks") { request ->
                require(request.url == PACK_STYLE_URL) { "the app serves no ${request.url}" }
                Res.readBytes("files/colorful.json")
            },
        ),
    )
}
