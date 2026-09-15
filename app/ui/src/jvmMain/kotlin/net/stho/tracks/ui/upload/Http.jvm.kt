package net.stho.tracks.ui.upload

import io.ktor.client.HttpClient
import io.ktor.client.engine.java.Java
import io.ktor.client.plugins.HttpTimeout

/**
 * The JDK's client, which keeps no cookies unless it is given a CookieHandler — and it is not.
 *
 * HTTP/1.1, because over plain http the JDK asks to upgrade to HTTP/2 on every request, and a POST carrying that
 * `Upgrade: h2c` is one Vite's dev server never answers: the harness against `pnpm dev:local` would time out signing in.
 */
actual fun tracksHttpClient(): HttpClient = HttpClient(Java) {
    install(HttpTimeout) { tracksTimeouts() }
    engine {
        protocolVersion = java.net.http.HttpClient.Version.HTTP_1_1
    }
}
