package net.stho.tracks.upload

import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.content.TextContent
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import net.stho.tracks.importing.ImportFrame

/** Why a request to Tracks did not do what it was sent to. */
sealed class ApiException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** No session, or one the server no longer accepts: thirty days passed, or the password changed on the web. */
    class Unauthorized(message: String) : ApiException(message)

    /** Refused for what it carried: sent again unchanged, it gets the same answer. */
    class Refused(val status: Int, message: String) : ApiException(message)

    /** No answer worth acting on — no network, a timeout, the server or the edge failing. Try again later. */
    class Unavailable(message: String, cause: Throwable? = null) : ApiException(message, cause)
}

/**
 * The three routes the phone uses, exactly as the web uses them, and nothing on the server added for it.
 *
 * The session travels as a `Cookie` header written here, never through a cookie jar: the client this runs on keeps
 * none, and on iOS NSURLSession's is switched off. A jar would decide by the cookie's attributes whether to send it —
 * `Secure` on the dev server's plain http, for one, is a cookie a jar keeps and never sends — and the app already
 * knows everything a jar would.
 */
class TracksApi(private val client: HttpClient, server: String) {
    private val server = server.trimEnd('/')

    /** `POST /api/session`: the session the server set, read out of its `Set-Cookie`. */
    suspend fun signIn(email: String, password: String): Session {
        val response = send {
            client.post("$server/api/session") {
                json(buildJsonObject {
                    put("email", email)
                    put("password", password)
                }.toString())
            }
        }
        val token = response.headers.getAll(HttpHeaders.SetCookie).orEmpty().firstNotNullOfOrNull(::sessionToken)
            ?: throw ApiException.Unavailable(
                "signed in, but no session cookie came back: something between the app and Tracks removed Set-Cookie",
            )
        return Session(body(response)["email"]?.jsonPrimitive?.content ?: email, token)
    }

    /** `POST /api/import/select`: which of [ids] the server has no track for. */
    suspend fun wanted(session: Session, source: String, ids: List<String>): Set<String> {
        val response = send {
            client.post("$server/api/import/select") {
                cookie(session)
                json(buildJsonObject {
                    put("source", source)
                    put("ids", JsonArray(ids.map(::JsonPrimitive)))
                }.toString())
            }
        }
        return body(response).getValue("wanted").jsonArray.map { it.jsonPrimitive.content }.toSet()
    }

    /** `POST /api/import`: one activity, written or refused. */
    suspend fun import(session: Session, frame: ImportFrame) {
        send {
            client.post("$server/api/import") {
                cookie(session)
                json(frame.encode())
            }
        }
    }

    private suspend fun send(request: suspend () -> HttpResponse): HttpResponse {
        val response = try {
            request()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw ApiException.Unavailable(e.message ?: e.toString(), e)
        }
        if (response.status.isSuccess()) return response

        val message = runCatching { body(response)["error"]?.jsonPrimitive?.content }.getOrNull() ?: response.status.toString()
        throw when (response.status.value) {
            401 -> ApiException.Unauthorized(message)
            408, 425, 429, in 500..599 -> ApiException.Unavailable(message)
            else -> ApiException.Refused(response.status.value, message)
        }
    }

    private suspend fun body(response: HttpResponse): JsonObject = Json.parseToJsonElement(response.bodyAsText()).jsonObject

    private fun HttpRequestBuilder.cookie(session: Session) = header(HttpHeaders.Cookie, "$SESSION_COOKIE=${session.token}")

    private fun HttpRequestBuilder.json(text: String) = setBody(TextContent(text, ContentType.Application.Json))
}

private val sessionCookie = Regex("""(?:^|[,;]\s*)$SESSION_COOKIE=([^;,\s]+)""")

/**
 * The session token in one `Set-Cookie` header, or null.
 *
 * NSURLSession joins several `Set-Cookie` headers into one with commas, and an `Expires` date has a comma of its own,
 * so this looks for the cookie's name at the start or after a separator rather than splitting. A cleared cookie
 * (`tracks_session=; Max-Age=0`) has no value and is not a session.
 */
fun sessionToken(setCookie: String): String? = sessionCookie.find(setCookie)?.groupValues?.get(1)
