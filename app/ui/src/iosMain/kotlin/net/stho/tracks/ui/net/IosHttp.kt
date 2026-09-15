package net.stho.tracks.ui.net

import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import net.stho.tracks.places.Http
import net.stho.tracks.places.HttpResponse
import platform.Foundation.NSHTTPURLResponse
import platform.Foundation.NSMutableURLRequest
import platform.Foundation.NSString
import platform.Foundation.NSURL
import platform.Foundation.NSURLSession
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataTaskWithRequest
import platform.Foundation.setValue

/** The phone's GET, through URLSession: no signal is an error thrown, any status is an answer. */
object IosHttp : Http {
    override suspend fun get(url: String): HttpResponse = suspendCancellableCoroutine { continuation ->
        val request = NSMutableURLRequest(uRL = NSURL(string = url))
        request.setValue(USER_AGENT, forHTTPHeaderField = "User-Agent")
        request.setTimeoutInterval(15.0)

        val task = NSURLSession.sharedSession.dataTaskWithRequest(request) { data, response, error ->
            if (error != null) {
                continuation.resumeWithException(IllegalStateException(error.localizedDescription))
                return@dataTaskWithRequest
            }
            val status = (response as? NSHTTPURLResponse)?.statusCode?.toInt() ?: 0
            val body = data?.let { NSString.create(data = it, encoding = NSUTF8StringEncoding)?.toString() } ?: ""
            continuation.resume(HttpResponse(status, body))
        }
        continuation.invokeOnCancellation { task.cancel() }
        task.resume()
    }
}
