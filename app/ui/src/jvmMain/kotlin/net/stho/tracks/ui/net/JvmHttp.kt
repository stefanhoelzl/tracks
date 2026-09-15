package net.stho.tracks.ui.net

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse.BodyHandlers
import java.time.Duration
import kotlinx.coroutines.future.await
import net.stho.tracks.places.Http
import net.stho.tracks.places.HttpResponse

/** The desktop's GET, through the JDK's own client. */
object JvmHttp : Http {
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()

    override suspend fun get(url: String): HttpResponse {
        val request = HttpRequest.newBuilder(URI(url))
            .header("User-Agent", USER_AGENT)
            .timeout(Duration.ofSeconds(15))
            .build()
        val response = client.sendAsync(request, BodyHandlers.ofString()).await()
        return HttpResponse(response.statusCode(), response.body())
    }
}
