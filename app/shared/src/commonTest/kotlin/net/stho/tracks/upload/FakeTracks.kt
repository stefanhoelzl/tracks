package net.stho.tracks.upload

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.importing.ImportFrame

/** Tracks' session and import routes, as far as the app sees them, answered the way `api.ts` answers. */
class FakeTracks(now: Long) {
    val email = "rider@example.test"
    val password = "correct horse"
    val token = "7.${now + 30L * 24 * 60 * 60 * 1000}.signature"

    val landed = mutableMapOf<String, ImportFrame>()
    val refuse = mutableSetOf<String>()

    /** Every answer, when set: the edge failing, or the server. */
    var status: HttpStatusCode? = null
    var offline = false

    /** Answers a sign-in without its `Set-Cookie`, as the pull zone did while `DisableCookies` was on. */
    var stripCookie = false

    val requests = mutableListOf<String>()

    fun session() = Session(email, token)

    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    val engine = MockEngine { request ->
        requests += "${request.method.value} ${request.url.encodedPath}"
        if (offline) error("no route to host")
        status?.let { return@MockEngine failure(it, "bad gateway") }
        val body = (request.body as? TextContent)?.text

        if (request.url.encodedPath == "/api/session") {
            val fields = Json.parseToJsonElement(body!!).jsonObject
            if (fields["password"]?.jsonPrimitive?.content != password) return@MockEngine failure(HttpStatusCode.Unauthorized, "wrong email or password")
            val cookie = "$SESSION_COOKIE=$token; Path=/; Expires=Thu, 15 Oct 2026 12:00:00 GMT; HttpOnly; SameSite=Lax"
            val headers = if (stripCookie) json else headersOf(HttpHeaders.ContentType to listOf("application/json"), HttpHeaders.SetCookie to listOf(cookie))
            return@MockEngine respond("""{"email":"$email"}""", HttpStatusCode.OK, headers)
        }

        if (request.headers[HttpHeaders.Cookie] != "$SESSION_COOKIE=$token") return@MockEngine failure(HttpStatusCode.Unauthorized, "not signed in")
        when (request.url.encodedPath) {
            "/api/import/select" -> {
                val fields = Json.parseToJsonElement(body!!).jsonObject
                val wanted = fields.getValue("ids").jsonArray.map { it.jsonPrimitive.content }.filter { it !in landed }
                respond(buildString { append("""{"wanted":"""); append(JsonArray(wanted.map(::JsonPrimitive))); append("}") }, HttpStatusCode.OK, json)
            }
            "/api/import" -> {
                val frame = ImportFrame.parse(body!!)
                if (frame.externalId in refuse) {
                    failure(HttpStatusCode.BadRequest, "altitudes has 3 entries for 4 points")
                } else {
                    landed[frame.externalId] = frame
                    respond("""{"rejectedTags":[]}""", HttpStatusCode.OK, json)
                }
            }
            else -> failure(HttpStatusCode.NotFound, "no route")
        }
    }

    private fun MockRequestHandleScope.failure(status: HttpStatusCode, message: String): HttpResponseData =
        respond("""{"error":"$message"}""", status, json)
}
