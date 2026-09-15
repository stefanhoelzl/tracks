package net.stho.tracks.desktop

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

const val VERSATILES = "https://tiles.versatiles.org"

/**
 * tiles.versatiles.org, as far as the screenshot tests need it, served from files on disk over loopback.
 *
 * Every path the map asks for is a file under [root], mirroring the server's own paths. A file that is not there is a
 * miss: answered 404 and remembered, so the test can fail naming it instead of rendering a quietly incomplete map.
 *
 * With [record], a miss is fetched once from VersaTiles and kept — the only time the tests touch the network, run by
 * hand. An answer other than 200 is kept too, as `<path>.status`, so a tile that does not exist upstream is not a miss.
 */
class FixtureServer(private val root: File, private val record: Boolean) : AutoCloseable {
    val misses: MutableList<String> = CopyOnWriteArrayList()

    private val client by lazy { HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build() }

    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { exchange -> exchange.use { answer(it) } }
        executor = Executors.newFixedThreadPool(8)
        start()
    }

    val base: String get() = "http://127.0.0.1:${server.address.port}"

    /** The URL the map should ask instead of [url], or null for one this server does not stand in for. */
    fun rewrite(url: String): String? = if (url.startsWith("$VERSATILES/")) base + url.removePrefix(VERSATILES) else null

    private fun answer(exchange: HttpExchange) {
        val path = exchange.requestURI.rawPath
        val file = root.resolve(path.removePrefix("/"))
        val status = File("${file.path}.status")
        if (record && !file.isFile && !status.isFile) fetch(path, file, status)
        when {
            file.isFile -> file.readBytes().let { body ->
                exchange.responseHeaders.add("Content-Type", contentType(path, body))
                exchange.sendResponseHeaders(200, body.size.toLong())
                exchange.responseBody.write(body)
            }
            status.isFile -> exchange.sendResponseHeaders(status.readText().trim().toInt(), -1)
            else -> {
                misses += path
                exchange.sendResponseHeaders(404, -1)
            }
        }
    }

    @Synchronized
    private fun fetch(path: String, file: File, status: File) {
        if (file.isFile || status.isFile) return
        val response = client.send(
            HttpRequest.newBuilder(URI.create(VERSATILES + path))
                .header("User-Agent", "tracks screenshot fixture (+https://github.com/stefanhoelzl/tracks)")
                .header("Accept-Encoding", "gzip")
                .build(),
            HttpResponse.BodyHandlers.ofByteArray(),
        )
        file.parentFile.mkdirs()
        if (response.statusCode() == 200) {
            val gzipped = response.headers().firstValue("Content-Encoding").orElse("") == "gzip"
            file.writeBytes(if (gzipped) GZIPInputStream(response.body().inputStream()).readBytes() else response.body())
        } else {
            status.writeText("${response.statusCode()}\n")
        }
        println("recorded $path (${response.statusCode()})")
    }

    private fun contentType(path: String, body: ByteArray): String = when {
        path.endsWith(".json") -> "application/json"
        body.startsWith(0x89, 'P'.code, 'N'.code, 'G'.code) -> "image/png"
        body.startsWith('R'.code, 'I'.code, 'F'.code, 'F'.code) -> "image/webp"
        else -> "application/x-protobuf"
    }

    private fun ByteArray.startsWith(vararg bytes: Int) =
        size >= bytes.size && bytes.indices.all { this[it].toInt() and 0xFF == bytes[it] }

    override fun close() = server.stop(0)
}
