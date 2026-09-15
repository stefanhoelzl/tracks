package net.stho.tracks.ui.offline

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlin.random.Random
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.offline.AroundYou
import net.stho.tracks.offline.MapArea
import net.stho.tracks.offline.Network
import net.stho.tracks.offline.SegmentStore
import net.stho.tracks.offline.SegmentSync
import net.stho.tracks.offline.SegmentTile
import net.stho.tracks.offline.boundsAround
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Heading
import net.stho.tracks.sensors.Pressure
import net.stho.tracks.ui.map.AreaState
import net.stho.tracks.ui.map.OfflineMaps
import net.stho.tracks.ui.map.PackStore
import net.stho.tracks.ui.map.StoredPack
import net.stho.tracks.ui.sensors.Sensors
import okio.FileSystem

class OfflineDataTest {
    private val fs = FileSystem.SYSTEM
    private val dir = FileSystem.SYSTEM_TEMPORARY_DIRECTORY / "tracks-offline-${Random.nextLong().toULong()}"

    @AfterTest
    fun cleanUp() = fs.deleteRecursively(dir)

    private val garmisch = Coordinate(47.4925, 11.0953)
    private val aroundGarmisch = MapArea("around", boundsAround(garmisch, AroundYou.RADIUS_M))
    private val west = SegmentTile(5, 45)
    private val east = SegmentTile(10, 45)

    private fun fix(at: Coordinate) = Fix(at, null, null, null, 5.0, 0)

    private class Pack(override val area: MapArea?, override var state: AreaState = AreaState.Waiting) : StoredPack

    private class Store : PackStore {
        val stored = mutableListOf<Pack>()

        override suspend fun settle() = Unit

        override val packs: List<StoredPack> get() = stored.toList()

        override suspend fun create(area: MapArea): StoredPack = Pack(area).also { stored += it }

        override fun resume(pack: StoredPack) = Unit

        override suspend fun delete(pack: StoredPack) {
            stored -= pack as Pack
        }
    }

    private val requests = mutableListOf<String>()
    private val engine = MockEngine { request ->
        requests += request.url.encodedPath
        val body = request.url.encodedPath.encodeToByteArray()
        respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentLength, body.size.toString()))
    }

    private val fixes = MutableSharedFlow<Fix>(replay = 1)
    private val sensors = object : Sensors {
        override val fixes = this@OfflineDataTest.fixes
        override val headings = emptyFlow<Heading>()
        override val pressures = emptyFlow<Pressure>()
    }
    private val network = MutableStateFlow<Network?>(Network.Metered)
    private val store = Store()
    private val segmentStore = SegmentStore(dir / "segments", fs)

    private fun TestScope.start() = OfflineData(
        sensors = sensors,
        plans = MutableStateFlow(emptyList()),
        network = network,
        maps = OfflineMaps(store),
        segments = SegmentSync(segmentStore, HttpClient(engine), clock = { 0L }, base = "https://brouter.test/segments4"),
        centreFile = dir / "around",
        scope = backgroundScope,
        io = StandardTestDispatcher(testScheduler),
        fileSystem = fs,
    )

    @Test
    fun aFixBringsTheAreaAroundItAndTheTilesUnderIt() = runTest {
        val offline = start()
        fixes.emit(fix(garmisch))

        val state = offline.state.first { "around" in it.areas && segmentStore.has(west) && segmentStore.has(east) && it.downloading == null }

        assertEquals(listOf(aroundGarmisch), store.stored.map { it.area })
        assertEquals(setOf("/segments4/E5_N45.rd5", "/segments4/E10_N45.rd5"), requests.toSet())
        assertNull(state.segmentProblem)
        assertEquals("47.4925 11.0953", fs.read(dir / "around") { readUtf8() }.trim())
    }

    @Test
    fun aSmallMoveLeavesTheAreaWhereItIs() = runTest {
        val offline = start()
        fixes.emit(fix(garmisch))
        offline.state.first { "around" in it.areas }

        fixes.emit(fix(Coordinate(47.6, 11.2)))
        advanceTimeBy(10_000)

        assertEquals(listOf(aroundGarmisch), store.stored.map { it.area })
        assertEquals("47.4925 11.0953", fs.read(dir / "around") { readUtf8() }.trim())
    }

    @Test
    fun withoutANetworkTheTilesWait() = runTest {
        network.value = null
        val offline = start()
        fixes.emit(fix(garmisch))

        assertEquals(listOf(west, east), offline.state.first { it.segmentsWaiting.size == 2 }.segmentsWaiting)
        assertEquals(emptyList(), requests)

        network.value = Network.Metered
        offline.state.first { it.segmentsWaiting.isEmpty() && it.downloading == null }
        assertEquals(2, requests.size)
    }

    @Test
    fun theAreaAroundYouStaysWhereItWasWhenTheAppStartsWithNoFix() = runTest {
        fs.createDirectories(dir)
        fs.write(dir / "around") { writeUtf8("47.4925 11.0953\n") }
        val kept = Pack(aroundGarmisch, AreaState.Ready(500))
        store.stored += kept

        val offline = start()
        val state = offline.state.first { "around" in it.areas }

        assertEquals(AreaState.Ready(500), state.areas["around"])
        assertEquals(listOf(kept), store.stored)
        assertTrue(fixes.replayCache.isEmpty())
    }
}
