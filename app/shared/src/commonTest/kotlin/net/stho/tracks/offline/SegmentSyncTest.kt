package net.stho.tracks.offline

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlin.random.Random
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import okio.FileSystem

class SegmentSyncTest {
    private val fs = FileSystem.SYSTEM
    private val dir = FileSystem.SYSTEM_TEMPORARY_DIRECTORY / "tracks-segments-${Random.nextLong().toULong()}"
    private val store = SegmentStore(dir, fs)

    private val garmisch = SegmentTile(10, 45)
    private val west = SegmentTile(5, 45)
    private val day = 24L * 60 * 60 * 1000
    private var now = 1_789_430_400_000L
    private var free: Long? = null

    private class Tile(val bytes: ByteArray, val etag: String, val lastModified: String)

    /** brouter.de's segments4, as its nginx answers: validators, conditional requests, and ranges under If-Range. */
    private val tiles = mutableMapOf(
        garmisch.fileName to Tile(Random(1).nextBytes(300_000), "\"a1\"", "Tue, 15 Sep 2026 01:03:01 GMT"),
        west.fileName to Tile(Random(2).nextBytes(200_000), "\"b1\"", "Tue, 15 Sep 2026 01:03:01 GMT"),
    )
    private val requests = mutableListOf<String>()
    private var offline = false

    private val engine = MockEngine { request ->
        val headers = request.headers
        requests += listOfNotNull(
            request.url.encodedPath,
            headers[HttpHeaders.Range]?.let { "range=$it" },
            headers[HttpHeaders.IfNoneMatch]?.let { "if-none-match=$it" },
        ).joinToString(" ")
        if (offline) error("no route to host")
        val tile = tiles[request.url.encodedPath.substringAfterLast('/')]
            ?: return@MockEngine respond(ByteArray(0), HttpStatusCode.NotFound)
        fun answer(body: ByteArray, status: HttpStatusCode, vararg extra: Pair<String, String>) = respond(
            body, status,
            headersOf(
                *(listOf(
                    HttpHeaders.ETag to tile.etag,
                    HttpHeaders.LastModified to tile.lastModified,
                    HttpHeaders.ContentLength to body.size.toString(),
                ) + extra).map { (k, v) -> k to listOf(v) }.toTypedArray(),
            ),
        )
        if (headers[HttpHeaders.IfNoneMatch] == tile.etag) return@MockEngine answer(ByteArray(0), HttpStatusCode.NotModified)
        val from = headers[HttpHeaders.Range]?.removePrefix("bytes=")?.removeSuffix("-")?.toInt()
        if (from != null && headers[HttpHeaders.IfRange] == tile.etag) {
            answer(
                tile.bytes.copyOfRange(from, tile.bytes.size), HttpStatusCode.PartialContent,
                HttpHeaders.ContentRange to "bytes $from-${tile.bytes.size - 1}/${tile.bytes.size}",
            )
        } else {
            answer(tile.bytes, HttpStatusCode.OK)
        }
    }

    private val sync = SegmentSync(store, HttpClient(engine), clock = { now }, freeBytes = { free }, base = "https://brouter.test/segments4")

    @AfterTest
    fun cleanUp() = fs.deleteRecursively(dir)

    private fun bytesOf(tile: SegmentTile) = fs.read(store.file(tile)) { readByteArray() }

    @Test
    fun missingTilesAreDownloadedIntoTheEnginesDirectory() = runTest {
        val progress = mutableListOf<SegmentProgress>()
        val result = sync.sync(setOf(garmisch, west), Network.Metered) { progress += it }

        assertEquals(listOf(west, garmisch), result.downloaded)
        assertEquals(emptyList(), result.waiting)
        assertNull(result.problem)
        assertContentEquals(tiles.getValue(garmisch.fileName).bytes, bytesOf(garmisch))
        assertEquals(SegmentRecord("\"a1\"", "Tue, 15 Sep 2026 01:03:01 GMT", 300_000, now), store.record(garmisch))
        assertEquals(setOf(garmisch, west), store.downloaded())
        assertEquals(SegmentProgress(garmisch, 300_000, 300_000), progress.last())
        assertEquals(emptySet(), store.partial())
    }

    @Test
    fun aDownloadCutOffResumesWhereItStopped() = runTest {
        val bytes = tiles.getValue(garmisch.fileName).bytes
        store.startPart(garmisch, "\"a1\"")
        fs.write(store.part(garmisch)) { write(bytes, 0, 120_000) }

        val result = sync.sync(setOf(garmisch), Network.Metered)

        assertEquals(listOf("/segments4/E10_N45.rd5 range=bytes=120000-"), requests)
        assertEquals(listOf(garmisch), result.downloaded)
        assertContentEquals(bytes, bytesOf(garmisch))
    }

    @Test
    fun aDownloadOfATileSinceRebuiltStartsOver() = runTest {
        store.startPart(garmisch, "\"a0\"")
        fs.write(store.part(garmisch)) { write(Random(9).nextBytes(120_000)) }

        sync.sync(setOf(garmisch), Network.Metered)

        assertContentEquals(tiles.getValue(garmisch.fileName).bytes, bytesOf(garmisch))
    }

    @Test
    fun aTileCheckedThisWeekIsNotAskedForAgain() = runTest {
        sync.sync(setOf(garmisch), Network.Unmetered)
        requests.clear()
        now += 6 * day

        val result = sync.sync(setOf(garmisch), Network.Unmetered)

        assertEquals(emptyList(), requests)
        assertEquals(emptyList(), result.downloaded + result.refreshed)
    }

    @Test
    fun aWeekOldTileIsCheckedOnlyOnAnUnmeteredNetwork() = runTest {
        sync.sync(setOf(garmisch), Network.Metered)
        requests.clear()
        now += 8 * day

        sync.sync(setOf(garmisch), Network.Metered)
        assertEquals(emptyList(), requests)

        val result = sync.sync(setOf(garmisch), Network.Unmetered)
        assertEquals(listOf("/segments4/E10_N45.rd5 if-none-match=\"a1\""), requests)
        assertEquals(emptyList(), result.refreshed)
        assertEquals(now, store.record(garmisch)?.checkedAtMillis)
    }

    @Test
    fun aRebuiltTileReplacesTheOldOne() = runTest {
        sync.sync(setOf(garmisch), Network.Metered)
        val rebuilt = Random(3).nextBytes(310_000)
        tiles[garmisch.fileName] = Tile(rebuilt, "\"a2\"", "Tue, 22 Sep 2026 01:02:40 GMT")
        now += 8 * day

        val result = sync.sync(setOf(garmisch), Network.Unmetered)

        assertEquals(listOf(garmisch), result.refreshed)
        assertContentEquals(rebuilt, bytesOf(garmisch))
        assertEquals("\"a2\"", store.record(garmisch)?.etag)
    }

    @Test
    fun tilesNothingNeedsAreDeletedButOnesPutThereByHandAreNot() = runTest {
        sync.sync(setOf(garmisch, west), Network.Metered)
        val byHand = SegmentTile(15, 45)
        fs.write(store.file(byHand)) { writeUtf8("the parity snapshot") }
        store.startPart(SegmentTile(0, 45), "\"c1\"")
        fs.write(store.part(SegmentTile(0, 45))) { writeUtf8("half") }

        val result = sync.sync(setOf(garmisch), Network.Metered)

        assertEquals(listOf(west), result.deleted)
        assertFalse(store.has(west))
        assertNull(store.record(west))
        assertTrue(store.has(garmisch))
        assertTrue(store.has(byHand))
        assertEquals(emptySet(), store.partial())
    }

    @Test
    fun aHandPutTileIsUsedAsItIs() = runTest {
        fs.createDirectories(dir)
        fs.write(store.file(garmisch)) { writeUtf8("the parity snapshot") }
        now += 30 * day

        val result = sync.sync(setOf(garmisch), Network.Unmetered)

        assertEquals(emptyList(), requests)
        assertEquals(emptyList(), result.waiting)
    }

    @Test
    fun withoutANetworkWhatIsMissingWaits() = runTest {
        offline = true

        val result = sync.sync(setOf(garmisch, west), Network.Metered)

        assertIs<SegmentProblem.Unreachable>(result.problem)
        assertEquals(listOf(west, garmisch), result.waiting)
        assertEquals(emptyList(), result.downloaded)
    }

    @Test
    fun aTileThatWouldFillThePhoneIsNotDownloaded() = runTest {
        free = STORAGE_RESERVE_BYTES + 250_000

        val result = sync.sync(setOf(garmisch, west), Network.Metered)

        // West (200 kB) fits; Garmisch (300 kB) would eat into the reserve, and stops the sync.
        assertEquals(listOf(west), result.downloaded)
        assertEquals(SegmentProblem.StorageFull(garmisch, 300_000), result.problem)
        assertEquals(listOf(garmisch), result.waiting)
        assertFalse(fs.exists(store.part(garmisch)))
    }

    @Test
    fun aTileTheServerDoesNotHaveIsNotAProblem() = runTest {
        val sea = SegmentTile(-30, 35)

        val result = sync.sync(setOf(sea, garmisch), Network.Metered)

        assertNull(result.problem)
        assertEquals(listOf(garmisch), result.downloaded)
        assertEquals(listOf(sea), result.waiting)
    }
}
