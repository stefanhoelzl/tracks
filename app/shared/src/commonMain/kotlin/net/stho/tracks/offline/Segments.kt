package net.stho.tracks.offline

import io.ktor.client.HttpClient
import io.ktor.client.request.head
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

    fun part(tile: SegmentTile): Path = directory / "${tile.fileName}.part"

    private fun partEtagPath(tile: SegmentTile): Path = directory / "${tile.fileName}.part.etag"

    private fun recordPath(tile: SegmentTile): Path = directory / "${tile.fileName}.json"

    /** Whether the engine has this tile, downloaded or not. */
    fun has(tile: SegmentTile): Boolean = fileSystem.exists(file(tile))

    /** The tiles this app downloaded. */
    fun downloaded(): Set<SegmentTile> = names().filter { it.endsWith(".rd5.json") }
        .mapNotNull { SegmentTile.parse(it.removeSuffix(".json")) }.filter(::has).toSet()

    /** Tiles with a download begun and not finished. */
    fun partial(): Set<SegmentTile> = names().filter { it.endsWith(".rd5.part") || it.endsWith(".rd5.resume") }
        .mapNotNull { SegmentTile.parse(it.removeSuffix(".part").removeSuffix(".resume")) }.toSet()

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

    fun partEtag(tile: SegmentTile): String? =
        partEtagPath(tile).takeIf { fileSystem.exists(it) }?.let { path -> fileSystem.read(path) { readUtf8() } }

    fun startPart(tile: SegmentTile, etag: String?) {
        fileSystem.createDirectories(directory)
        deletePart(tile)
        etag?.let { fileSystem.write(partEtagPath(tile)) { writeUtf8(it) } }
    }

    fun partSize(tile: SegmentTile): Long = fileSystem.metadataOrNull(part(tile))?.size ?: 0L

    fun appendToPart(tile: SegmentTile) = fileSystem.appendingSink(part(tile), mustExist = false)

    fun deletePart(tile: SegmentTile) {
        fileSystem.delete(part(tile), mustExist = false)
        fileSystem.delete(partEtagPath(tile), mustExist = false)
        fileSystem.delete(resume(tile), mustExist = false)
    }

    /** What a transfer the system runs keeps to resume a download it was cut off in: `E10_N45.rd5.resume`. */
    fun resume(tile: SegmentTile): Path = directory / "${tile.fileName}.resume"

    /** Puts a whole download in place of the tile, then records it: a crash between the two leaves a tile to re-check. */
    fun complete(tile: SegmentTile, record: SegmentRecord) {
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

/** What a tile's HEAD said: whether it exists, and what the download would be. */
data class SegmentHead(val etag: String?, val lastModified: String?, val bytes: Long?)

/**
 * Where a tile's bytes come from. The rules — what is due, whether it changed, whether it fits — are [SegmentSync]'s;
 * a transfer only moves the bytes of one tile into [SegmentStore] and installs it there with its record.
 */
interface SegmentTransfer {
    /**
     * Downloads [url] whole and installs it as [tile]; returns its record. [unmeteredOnly] is a refresh, which must not
     * spend a metered network. Throws when the download failed; what it got so far is kept to resume from.
     */
    suspend fun download(tile: SegmentTile, url: String, head: SegmentHead, unmeteredOnly: Boolean, onProgress: (SegmentProgress) -> Unit): SegmentRecord
}

/**
 * Downloads in the process, over [client]: a `.part` that becomes the tile only when whole, resumed with a range request
 * after a cut, unless the tile was rebuilt in the meantime. It stops with the app; on the phone a background transfer
 * keeps downloading while the app is suspended.
 */
class InProcessSegmentTransfer(
    private val store: SegmentStore,
    private val client: HttpClient,
    private val clock: () -> Long,
) : SegmentTransfer {
    override suspend fun download(
        tile: SegmentTile,
        url: String,
        head: SegmentHead,
        unmeteredOnly: Boolean,
        onProgress: (SegmentProgress) -> Unit,
    ): SegmentRecord {
        // Only onto the same build: a part started under another ETag is of a tile since rebuilt.
        val partEtag = store.partEtag(tile)?.takeIf { it == head.etag }
        val resumeFrom = if (partEtag != null) store.partSize(tile) else 0L

        return client.prepareGet(url) {
            if (resumeFrom > 0) {
                header(HttpHeaders.Range, "bytes=$resumeFrom-")
                header(HttpHeaders.IfRange, partEtag)
            }
        }.execute { response ->
            if (response.status != HttpStatusCode.OK && response.status != HttpStatusCode.PartialContent) {
                error("brouter.de answered ${response.status} for ${tile.fileName}")
            }
            val resuming = response.status == HttpStatusCode.PartialContent
            val offset = if (resuming) resumeFrom else 0L
            val etag = response.headers[HttpHeaders.ETag]
            val total = response.contentLength()?.plus(offset)
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

            SegmentRecord(etag, response.headers[HttpHeaders.LastModified], received, clock()).also { store.complete(tile, it) }
        }
    }
}

/**
 * Brings the segment directory to what is needed: deletes what nothing needs, downloads what is missing on any network,
 * and on an unmetered one re-checks tiles a week old.
 *
 * Safe to run at any moment and to stop at any moment. Every tile that is due is asked for with a HEAD first: it says
 * whether the tile exists at all (open sea does not), whether a tile checked before has changed — a week-old tile that has
 * not costs that one request —, and how big it is, which must fit. Only then does [transfer] move the bytes; a rebuilt
 * tile is downloaded whole beside the old one, which the engine keeps reading until the new one replaces it.
 */
class SegmentSync(
    val store: SegmentStore,
    private val client: HttpClient,
    private val clock: () -> Long,
    /** Free bytes on the volume, or null where that is not known. */
    private val freeBytes: () -> Long? = { null },
    base: String = BROUTER_SEGMENTS,
    private val transfer: SegmentTransfer = InProcessSegmentTransfer(store, client, clock),
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
        val url = "$base/${tile.fileName}"
        val response = client.head(url)
        val head = when (response.status) {
            // No such tile: open sea, where there is nothing to route on.
            HttpStatusCode.NotFound -> return Fetched.Absent
            HttpStatusCode.OK -> SegmentHead(response.headers[HttpHeaders.ETag], response.headers[HttpHeaders.LastModified], response.contentLength())
            else -> error("brouter.de answered ${response.status} for ${tile.fileName}")
        }

        if (record != null && unchanged(record, head)) {
            store.writeRecord(tile, record.copy(checkedAtMillis = clock()))
            return Fetched.Unchanged
        }

        val already = if (store.partEtag(tile)?.let { it == head.etag } == true) store.partSize(tile) else 0L
        val free = freeBytes()
        if (head.bytes != null && free != null && head.bytes - already > free - STORAGE_RESERVE_BYTES) {
            throw StorageFullException(head.bytes)
        }

        transfer.download(tile, url, head, unmeteredOnly = record != null, onProgress)
        return Fetched.New
    }

    /** The same build: its ETag when both have one, its Last-Modified when not. */
    private fun unchanged(record: SegmentRecord, head: SegmentHead): Boolean = when {
        record.etag != null && head.etag != null -> record.etag == head.etag
        record.lastModified != null && head.lastModified != null -> record.lastModified == head.lastModified
        else -> false
    }
}
