package net.stho.tracks.offline

import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentLength
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okio.FileSystem
import okio.Path
import okio.buffer
import okio.use

/** Where the app's segment tiles come from: brouter.de's own, which it rebuilds weekly, as the web's routes are. */
const val BROUTER_SEGMENTS = "https://brouter.de/brouter/segments4"

/** A week, brouter.de's rebuild: a tile checked more recently than this is not asked for again. */
const val SEGMENT_REFRESH_MS = 7L * 24 * 60 * 60 * 1000

/** What a download must leave free on the phone. */
const val STORAGE_RESERVE_BYTES = 1_000_000_000L

enum class Network {
    /** Wi-Fi, or anything the system does not count as expensive: refreshes wait for this. */
    Unmetered,

    /** Cellular, or a hotspot: only what is missing is downloaded. */
    Metered,
}

/** A tile this app downloaded: the server's validators for it, and when they were last checked. */
data class SegmentRecord(val etag: String?, val lastModified: String?, val bytes: Long, val checkedAtMillis: Long)

/**
 * The directory the engine reads its tiles from, and what this app downloaded into it.
 *
 * A downloaded tile has its record beside it, `E10_N45.rd5.json`, written only once the tile is whole. A tile without
 * one was put there by hand — the parity snapshot pushed for measuring — and is the engine's to read, never this code's
 * to refresh or delete. A download in progress is `E10_N45.rd5.part`, with the ETag it was started under in
 * `E10_N45.rd5.part.etag`, so that it can resume only onto the same tile.
 */
class SegmentStore(val directory: Path, private val fileSystem: FileSystem = FileSystem.SYSTEM) {
    fun file(tile: SegmentTile): Path = directory / tile.fileName

    internal fun part(tile: SegmentTile): Path = directory / "${tile.fileName}.part"

    private fun partEtagPath(tile: SegmentTile): Path = directory / "${tile.fileName}.part.etag"

    private fun recordPath(tile: SegmentTile): Path = directory / "${tile.fileName}.json"

    /** Whether the engine has this tile, downloaded or not. */
    fun has(tile: SegmentTile): Boolean = fileSystem.exists(file(tile))

    /** The tiles this app downloaded. */
    fun downloaded(): Set<SegmentTile> = names().filter { it.endsWith(".rd5.json") }
        .mapNotNull { SegmentTile.parse(it.removeSuffix(".json")) }.filter(::has).toSet()

    /** Tiles with a download begun and not finished. */
    fun partial(): Set<SegmentTile> = names().filter { it.endsWith(".rd5.part") }
        .mapNotNull { SegmentTile.parse(it.removeSuffix(".part")) }.toSet()

    fun record(tile: SegmentTile): SegmentRecord? {
        val path = recordPath(tile)
        if (!fileSystem.exists(path)) return null
        return runCatching {
            val fields = Json.parseToJsonElement(fileSystem.read(path) { readUtf8() }).jsonObject
            SegmentRecord(
                etag = fields["etag"]?.jsonPrimitive?.contentOrNullString(),
                lastModified = fields["lastModified"]?.jsonPrimitive?.contentOrNullString(),
                bytes = fields.getValue("bytes").jsonPrimitive.long,
                checkedAtMillis = fields.getValue("checkedAtMillis").jsonPrimitive.long,
            )
        }.getOrNull()
    }

    internal fun writeRecord(tile: SegmentTile, record: SegmentRecord) {
        val json = buildJsonObject {
            put("etag", record.etag)
            put("lastModified", record.lastModified)
            put("bytes", record.bytes)
            put("checkedAtMillis", record.checkedAtMillis)
        }
        val temporary = directory / "${tile.fileName}.json.tmp"
        fileSystem.write(temporary) { writeUtf8(json.toString()) }
        fileSystem.atomicMove(temporary, recordPath(tile))
    }

    internal fun partEtag(tile: SegmentTile): String? =
        partEtagPath(tile).takeIf { fileSystem.exists(it) }?.let { path -> fileSystem.read(path) { readUtf8() } }

    internal fun startPart(tile: SegmentTile, etag: String?) {
        fileSystem.createDirectories(directory)
        deletePart(tile)
        etag?.let { fileSystem.write(partEtagPath(tile)) { writeUtf8(it) } }
    }

    internal fun partSize(tile: SegmentTile): Long = fileSystem.metadataOrNull(part(tile))?.size ?: 0L

    internal fun appendToPart(tile: SegmentTile) = fileSystem.appendingSink(part(tile), mustExist = false)

    internal fun deletePart(tile: SegmentTile) {
        fileSystem.delete(part(tile), mustExist = false)
        fileSystem.delete(partEtagPath(tile), mustExist = false)
    }

    /** Puts a whole download in place of the tile, then records it: a crash between the two leaves a tile to re-check. */
    internal fun complete(tile: SegmentTile, record: SegmentRecord) {
        fileSystem.atomicMove(part(tile), file(tile))
        fileSystem.delete(partEtagPath(tile), mustExist = false)
        writeRecord(tile, record)
    }

    /** Removes a downloaded tile and anything begun for it. A tile put there by hand is not this code's to remove. */
    fun delete(tile: SegmentTile) {
        deletePart(tile)
        if (!fileSystem.exists(recordPath(tile))) return
        fileSystem.delete(file(tile), mustExist = false)
        fileSystem.delete(recordPath(tile), mustExist = false)
    }

    private fun names(): List<String> =
        if (fileSystem.exists(directory)) fileSystem.list(directory).map { it.name } else emptyList()
}

private fun JsonPrimitive.contentOrNullString(): String? = if (this is JsonNull) null else content

/** West to east, then south to north: the order tiles are worked through and reported in. */
private val WEST_TO_EAST = compareBy<SegmentTile>({ it.lon }, { it.lat })

sealed interface SegmentProblem {
    /** brouter.de could not be reached, or cut a download short. What was received is kept, to resume from. */
    data class Unreachable(val message: String) : SegmentProblem

    /** A tile would leave less than [STORAGE_RESERVE_BYTES] free. Nothing more is downloaded until there is room. */
    data class StorageFull(val tile: SegmentTile, val bytes: Long) : SegmentProblem
}

data class SegmentProgress(val tile: SegmentTile, val receivedBytes: Long, val totalBytes: Long?)

data class SegmentSyncResult(
    val downloaded: List<SegmentTile>,
    val refreshed: List<SegmentTile>,
    val deleted: List<SegmentTile>,
    /** Needed and still not on the phone. */
    val waiting: List<SegmentTile>,
    val problem: SegmentProblem?,
)

/**
 * Brings the segment directory to what is needed: deletes what nothing needs, downloads what is missing on any network,
 * and on an unmetered one re-checks tiles a week old.
 *
 * Safe to run at any moment and to stop at any moment. A download goes to a `.part` and becomes the tile only when whole,
 * so the engine never reads half a file; a download cut off resumes with a range request, unless the tile was rebuilt in
 * the meantime. A re-check is a conditional request that costs nothing when the tile is unchanged; a rebuilt tile is
 * downloaded whole beside the old one, which the engine keeps reading until the new one replaces it.
 */
class SegmentSync(
    val store: SegmentStore,
    private val client: HttpClient,
    private val clock: () -> Long,
    /** Free bytes on the volume, or null where that is not known. */
    private val freeBytes: () -> Long? = { null },
    base: String = BROUTER_SEGMENTS,
) {
    private val base = base.trimEnd('/')

    suspend fun sync(needed: Set<SegmentTile>, network: Network, onProgress: (SegmentProgress) -> Unit = {}): SegmentSyncResult {
        val deleted = store.downloaded().filter { it !in needed }.sortedWith(WEST_TO_EAST)
        deleted.forEach(store::delete)
        store.partial().filter { it !in needed }.forEach(store::delete)

        val downloaded = mutableListOf<SegmentTile>()
        val refreshed = mutableListOf<SegmentTile>()
        var problem: SegmentProblem? = null
        for (tile in needed.sortedWith(WEST_TO_EAST)) {
            val record = store.record(tile)
            val due = when {
                record == null -> !store.has(tile)
                else -> network == Network.Unmetered && clock() - record.checkedAtMillis >= SEGMENT_REFRESH_MS
            }
            if (!due) continue
            try {
                when (fetch(tile, record, onProgress)) {
                    Fetched.New -> if (record == null) downloaded += tile else refreshed += tile
                    Fetched.Unchanged, Fetched.Absent -> Unit
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: StorageFullException) {
                problem = SegmentProblem.StorageFull(tile, e.bytes)
                break
            } catch (e: Exception) {
                problem = SegmentProblem.Unreachable(e.message ?: e.toString())
                break
            }
        }
        return SegmentSyncResult(downloaded, refreshed, deleted, needed.filterNot(store::has).sortedWith(WEST_TO_EAST), problem)
    }

    private enum class Fetched { New, Unchanged, Absent }

    private class StorageFullException(val bytes: Long) : Exception()

    private suspend fun fetch(tile: SegmentTile, record: SegmentRecord?, onProgress: (SegmentProgress) -> Unit): Fetched {
        // Only a first download resumes: a refresh cut short starts over, since its part may be of either build.
        val partEtag = if (record == null) store.partEtag(tile) else null
        val resumeFrom = if (partEtag != null) store.partSize(tile) else 0L

        return client.prepareGet("$base/${tile.fileName}") {
            if (record != null) {
                record.etag?.let { header(HttpHeaders.IfNoneMatch, it) }
                record.lastModified?.let { header(HttpHeaders.IfModifiedSince, it) }
            }
            if (resumeFrom > 0) {
                header(HttpHeaders.Range, "bytes=$resumeFrom-")
                header(HttpHeaders.IfRange, partEtag)
            }
        }.execute { response ->
            when (response.status) {
                HttpStatusCode.NotModified -> {
                    store.writeRecord(tile, record!!.copy(checkedAtMillis = clock()))
                    return@execute Fetched.Unchanged
                }
                // No such tile: open sea, where there is nothing to route on.
                HttpStatusCode.NotFound -> return@execute Fetched.Absent
                HttpStatusCode.OK, HttpStatusCode.PartialContent -> Unit
                else -> error("brouter.de answered ${response.status} for ${tile.fileName}")
            }

            val resuming = response.status == HttpStatusCode.PartialContent
            val offset = if (resuming) resumeFrom else 0L
            val etag = response.headers[HttpHeaders.ETag]
            val total = response.contentLength()?.plus(offset)
            val free = freeBytes()
            if (total != null && free != null && total - offset > free - STORAGE_RESERVE_BYTES) throw StorageFullException(total)
            if (!resuming) store.startPart(tile, etag)

            var received = offset
            val channel = response.bodyAsChannel()
            val buffer = ByteArray(64 * 1024)
            store.appendToPart(tile).buffer().use { sink ->
                while (true) {
                    val read = channel.readAvailable(buffer, 0, buffer.size)
                    if (read == -1) break
                    sink.write(buffer, 0, read)
                    received += read
                    onProgress(SegmentProgress(tile, received, total))
                }
            }
            if (total != null && received != total) error("${tile.fileName} was cut short at $received of $total bytes")

            store.complete(tile, SegmentRecord(etag, response.headers[HttpHeaders.LastModified], received, clock()))
            Fetched.New
        }
    }
}
