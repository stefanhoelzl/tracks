package net.stho.tracks.ui.offline

import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.time.Clock
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import net.stho.tracks.offline.SegmentHead
import net.stho.tracks.offline.SegmentProgress
import net.stho.tracks.offline.SegmentRecord
import net.stho.tracks.offline.SegmentStore
import net.stho.tracks.offline.SegmentTile
import net.stho.tracks.offline.SegmentTransfer
import net.stho.tracks.ui.net.USER_AGENT
import okio.FileSystem
import okio.Path.Companion.toPath
import platform.Foundation.NSData
import platform.Foundation.NSError
import platform.Foundation.NSFileManager
import platform.Foundation.NSHTTPURLResponse
import platform.Foundation.NSMutableURLRequest
import platform.Foundation.NSNumber
import platform.Foundation.NSOperationQueue
import platform.Foundation.NSURL
import platform.Foundation.NSURLSession
import platform.Foundation.NSURLSessionConfiguration
import platform.Foundation.NSURLSessionDownloadDelegateProtocol
import platform.Foundation.NSURLSessionDownloadTask
import platform.Foundation.NSURLSessionDownloadTaskResumeData
import platform.Foundation.NSURLSessionTask
import platform.Foundation.dataWithContentsOfFile
import platform.Foundation.setValue
import platform.Foundation.writeToFile
import platform.darwin.NSObject

/** The background session's name: iOS relaunches the app under it to hand over downloads that finished meanwhile. */
private const val SESSION = "net.stho.tracks.segments"

/**
 * Segment tiles downloaded by iOS itself, in a background session: a 250 MB tile keeps downloading while the app is
 * suspended, and is finished even if the app was ended — iOS relaunches it in the background to hand the file over.
 *
 * The delegate installs a finished tile itself, with its record, whether or not a [download] is still waiting for it,
 * so a tile that lands while nothing of the app is running is on disk when it starts. A download cut off leaves resume
 * data beside the tile, `E10_N45.rd5.resume`, and the next attempt picks up from it.
 *
 * One per process, made before the first map ([backgroundSegments]): the session must exist when iOS hands over events.
 */
@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
class BackgroundSegments internal constructor(private val store: SegmentStore) : SegmentTransfer {
    private class Waiting(val continuation: CancellableContinuation<SegmentRecord>, val onProgress: (SegmentProgress) -> Unit)

    /** Touched only on the main queue, which is the session's delegate queue. */
    private val waiting = HashMap<String, Waiting>()
    private val finished = HashMap<String, SegmentRecord>()
    private var eventsDone: (() -> Unit)? = null

    private val delegate = Delegate()

    private val session: NSURLSession = NSURLSession.sessionWithConfiguration(
        NSURLSessionConfiguration.backgroundSessionConfigurationWithIdentifier(SESSION).apply {
            // Missing tiles download on any network; a refresh says per request that it waits for an unmetered one.
            setAllowsCellularAccess(true)
            setDiscretionary(false)
            setSessionSendsLaunchEvents(true)
        },
        delegate,
        NSOperationQueue.mainQueue,
    )

    override suspend fun download(
        tile: SegmentTile,
        url: String,
        head: SegmentHead,
        unmeteredOnly: Boolean,
        onProgress: (SegmentProgress) -> Unit,
    ): SegmentRecord = suspendCancellableCoroutine { continuation ->
        val name = tile.fileName
        NSOperationQueue.mainQueue.addOperationWithBlock {
            waiting[name] = Waiting(continuation, onProgress)
            session.getAllTasksWithCompletionHandler { tasks ->
                NSOperationQueue.mainQueue.addOperationWithBlock {
                    val running = tasks.orEmpty().filterIsInstance<NSURLSessionDownloadTask>().any { it.taskDescription == name }
                    if (!running) start(tile, url, unmeteredOnly)
                }
            }
        }
        // Not cancelled with the coroutine: the download is iOS's to finish, and the tile is installed when it does. A
        // tile nothing needs by then is deleted by the next sync.
        continuation.invokeOnCancellation { NSOperationQueue.mainQueue.addOperationWithBlock { waiting.remove(name) } }
    }

    private fun start(tile: SegmentTile, url: String, unmeteredOnly: Boolean) {
        val resumePath = store.resume(tile).toString()
        val resumeData = NSData.dataWithContentsOfFile(resumePath)
        NSFileManager.defaultManager.removeItemAtPath(resumePath, null)
        val task = if (resumeData != null) {
            session.downloadTaskWithResumeData(resumeData)
        } else {
            val request = NSMutableURLRequest(uRL = NSURL(string = url))
            request.setValue(USER_AGENT, forHTTPHeaderField = "User-Agent")
            // A refresh is not worth a metered network, nor Low Data Mode's.
            request.setAllowsExpensiveNetworkAccess(!unmeteredOnly)
            request.setAllowsConstrainedNetworkAccess(!unmeteredOnly)
            session.downloadTaskWithRequest(request)
        }
        task.taskDescription = tile.fileName
        task.resume()
    }

    /** iOS relaunched the app for this session's events; [done] is called once they are all handled. */
    fun handleEvents(identifier: String, done: () -> Unit): Boolean {
        if (identifier != SESSION) return false
        eventsDone = done
        return true
    }

    private fun tileOf(task: NSURLSessionTask): SegmentTile? = task.taskDescription?.let(SegmentTile::parse)

    private inner class Delegate : NSObject(), NSURLSessionDownloadDelegateProtocol {
        override fun URLSession(
            session: NSURLSession,
            downloadTask: NSURLSessionDownloadTask,
            didWriteData: Long,
            totalBytesWritten: Long,
            totalBytesExpectedToWrite: Long,
        ) {
            val tile = tileOf(downloadTask) ?: return
            waiting[tile.fileName]?.onProgress?.invoke(
                SegmentProgress(tile, totalBytesWritten, totalBytesExpectedToWrite.takeIf { it > 0 }),
            )
        }

        override fun URLSession(session: NSURLSession, downloadTask: NSURLSessionDownloadTask, didFinishDownloadingToURL: NSURL) {
            val tile = tileOf(downloadTask) ?: return
            val response = downloadTask.response as? NSHTTPURLResponse
            val status = response?.statusCode?.toInt() ?: 0
            // The file is iOS's and gone once this returns: a tile is moved into place now, or not at all.
            if (status != 200) return
            val headers = response?.allHeaderFields.orEmpty()
            fun header(name: String): String? = headers.entries.firstOrNull { (it.key as? String).equals(name, ignoreCase = true) }?.value as? String

            val part = store.part(tile)
            store.deletePart(tile)
            val moved = NSFileManager.defaultManager.moveItemAtURL(didFinishDownloadingToURL, NSURL.fileURLWithPath(part.toString()), null)
            if (!moved) return
            val bytes = FileSystem.SYSTEM.metadataOrNull(part)?.size ?: 0L
            val record = SegmentRecord(header("ETag"), header("Last-Modified"), bytes, Clock.System.now().toEpochMilliseconds())
            store.complete(tile, record)
            finished[tile.fileName] = record
        }

        override fun URLSession(session: NSURLSession, task: NSURLSessionTask, didCompleteWithError: NSError?) {
            val tile = tileOf(task) ?: return
            val name = tile.fileName
            val record = finished.remove(name)
            val waiter = waiting.remove(name)
            if (record != null) {
                waiter?.continuation?.resume(record)
                return
            }
            (didCompleteWithError?.userInfo?.get(NSURLSessionDownloadTaskResumeData) as? NSData)
                ?.writeToFile(store.resume(tile).toString(), atomically = true)
            val status = (task.response as? NSHTTPURLResponse)?.statusCode?.toInt()
            val message = didCompleteWithError?.localizedDescription
                ?: "brouter.de answered ${status ?: "nothing"} for $name"
            waiter?.continuation?.resumeWithException(IllegalStateException(message))
        }

        override fun URLSessionDidFinishEventsForBackgroundURLSession(session: NSURLSession) {
            eventsDone?.invoke()
            eventsDone = null
        }
    }
}

private var shared: BackgroundSegments? = null

/** The process's background segment session, made on first use: call it before the first map, at launch. */
fun backgroundSegments(): BackgroundSegments =
    shared ?: BackgroundSegments(SegmentStore(segmentsDirectory())).also { shared = it }

/**
 * For the Swift shell's `application(_:handleEventsForBackgroundURLSession:completionHandler:)`: iOS relaunched the app to
 * hand over downloads that finished while it was not running. Returns whether the session was this one.
 */
fun handleBackgroundSegmentEvents(identifier: String, completion: () -> Unit): Boolean =
    backgroundSegments().handleEvents(identifier, completion)
