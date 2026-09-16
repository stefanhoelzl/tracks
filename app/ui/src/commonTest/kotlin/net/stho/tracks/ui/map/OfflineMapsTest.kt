package net.stho.tracks.ui.map

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest
import net.stho.tracks.offline.Bounds
import net.stho.tracks.offline.MapArea
import net.stho.tracks.offline.STORAGE_RESERVE_BYTES

class OfflineMapsTest {
    private val garmisch = MapArea("around", Bounds(46.59, 9.74, 48.39, 12.45))
    private val innsbruck = MapArea("around", Bounds(46.37, 10.08, 48.17, 12.73))
    private val plan = MapArea("plan:a", Bounds(47.0, 10.7, 47.7, 11.7))

    private class Pack(override val area: MapArea?, var progress: AreaState = AreaState.Waiting) : StoredPack {
        override val state: AreaState get() = progress
    }

    /** MapLibre's packs, as far as reconciling sees them. */
    private class FakeStore(vararg existing: Pack) : PackStore {
        val stored = existing.toMutableList()
        val log = mutableListOf<String>()
        var settled = false

        override suspend fun settle() {
            settled = true
        }

        override val packs: List<StoredPack>
            get() = check(settled) { "packs read before they were listed" }.let { stored.toList() }

        override suspend fun create(area: MapArea): StoredPack = Pack(area).also {
            stored += it
            log += "create ${area.key} ${area.bounds.south}"
        }

        override fun resume(pack: StoredPack) {
            log += "resume ${pack.area?.key}"
        }

        override suspend fun invalidate(pack: StoredPack) {
            log += "invalidate ${pack.area?.key}"
        }

        override fun pause(pack: StoredPack) {
            log += "pause ${pack.area?.key}"
        }

        override suspend fun delete(pack: StoredPack) {
            stored -= pack as Pack
            log += "delete ${pack.area?.key} ${pack.area?.bounds?.south}"
        }
    }

    @Test
    fun missingAreasArePackedAndStarted() = runTest {
        val store = FakeStore()

        val states = OfflineMaps(store).reconcile(listOf(garmisch, plan))

        assertEquals(listOf("create around 46.59", "resume around", "create plan:a 47.0", "resume plan:a"), store.log)
        assertEquals(mapOf("around" to AreaState.Waiting, "plan:a" to AreaState.Waiting), states)
    }

    @Test
    fun aWholePackIsLeftAloneAndAnUnfinishedOneResumed() = runTest {
        val store = FakeStore(Pack(garmisch, AreaState.Ready(500)), Pack(plan, AreaState.Downloading(10, 100, 5)))

        val states = OfflineMaps(store).reconcile(listOf(garmisch, plan))

        assertEquals(listOf("resume plan:a"), store.log)
        assertEquals(AreaState.Ready(500), states["around"])
    }

    @Test
    fun aPackNothingNeedsIsDeletedAndSoIsOneThisAppDidNotMake() = runTest {
        val store = FakeStore(Pack(garmisch, AreaState.Ready(500)), Pack(plan, AreaState.Ready(40)), Pack(null, AreaState.Ready(1)))

        OfflineMaps(store).reconcile(listOf(garmisch))

        assertEquals(listOf("delete plan:a 47.0", "delete null null"), store.log)
        assertEquals(listOf(garmisch), store.stored.map { it.area })
    }

    @Test
    fun aMovedAreaKeepsItsOldPackUntilTheNewOneIsWhole() = runTest {
        val old = Pack(garmisch, AreaState.Ready(500))
        val store = FakeStore(old)
        val maps = OfflineMaps(store)

        maps.reconcile(listOf(innsbruck))
        assertEquals(listOf("create around 46.37", "resume around"), store.log)
        assertEquals(2, store.stored.size)

        (store.stored.last() as Pack).progress = AreaState.Downloading(300, 600, 200)
        store.log.clear()
        maps.reconcile(listOf(innsbruck))
        assertEquals(listOf("resume around"), store.log)

        (store.stored.last() as Pack).progress = AreaState.Ready(510)
        store.log.clear()
        val states = maps.reconcile(listOf(innsbruck))
        assertEquals(listOf("delete around 46.59"), store.log)
        assertEquals(mapOf("around" to AreaState.Ready(510)), states)
    }

    @Test
    fun aSecondPackOfTheSameAreaIsDeleted() = runTest {
        val store = FakeStore(Pack(plan, AreaState.Ready(40)), Pack(plan, AreaState.Downloading(1, 10, 1)))

        OfflineMaps(store).reconcile(listOf(plan))

        assertEquals(listOf("delete plan:a 47.0"), store.log)
        assertEquals(AreaState.Ready(40), store.stored.single().state)
    }

    @Test
    fun aDownloadThatMakesNoProgressForAMinuteIsPausedAndResumed() = runTest {
        val pack = Pack(plan, AreaState.Downloading(120, 1000, 5))
        val store = FakeStore(pack)
        var now = 0L
        val maps = OfflineMaps(store, clock = { now })

        maps.reconcile(listOf(plan))
        now += 30_000
        // A request failed as the app came back from the background, and MapLibre reports that, not progress.
        pack.progress = AreaState.Failing("The network connection was lost.")
        maps.reconcile(listOf(plan))
        assertEquals(listOf("resume plan:a", "resume plan:a"), store.log)

        now += PACK_STALL_MS
        store.log.clear()
        maps.reconcile(listOf(plan))
        assertEquals(listOf("pause plan:a", "resume plan:a"), store.log, "a minute with nothing: paused and resumed")

        // Moving again, it is left alone; a minute later still moving, still left alone.
        pack.progress = AreaState.Downloading(300, 1000, 50)
        store.log.clear()
        now += 10_000
        maps.reconcile(listOf(plan))
        pack.progress = AreaState.Downloading(600, 1000, 90)
        now += PACK_STALL_MS
        maps.reconcile(listOf(plan))
        assertEquals(listOf("resume plan:a", "resume plan:a"), store.log)
    }

    @Test
    fun aNearlyFullPhonePausesWhatIsUnfinishedAndResumesWhenThereIsRoom() = runTest {
        val whole = Pack(garmisch, AreaState.Ready(500))
        val unfinished = Pack(plan, AreaState.Downloading(10, 100, 5))
        val store = FakeStore(whole, unfinished)
        var free = STORAGE_RESERVE_BYTES - 1
        val maps = OfflineMaps(store, clock = { 0L }, freeBytes = { free })

        val states = maps.reconcile(listOf(garmisch, plan))

        assertEquals(listOf("pause plan:a"), store.log, "a whole pack is left as it is")
        assertEquals(mapOf("around" to AreaState.Ready(500), "plan:a" to AreaState.StorageFull), states)

        free = STORAGE_RESERVE_BYTES + 1
        store.log.clear()
        assertEquals(AreaState.Downloading(10, 100, 5), maps.reconcile(listOf(garmisch, plan))["plan:a"])
        assertEquals(listOf("resume plan:a"), store.log)
    }

    @Test
    fun aNewPlanetDownloadsTheAppsPacksAgainAndLeavesOthersAlone() = runTest {
        val store = FakeStore(Pack(garmisch, AreaState.Ready(500)), Pack(plan, AreaState.Ready(40)), Pack(null, AreaState.Ready(1)))

        OfflineMaps(store).refresh()

        assertEquals(listOf("invalidate around", "resume around", "invalidate plan:a", "resume plan:a"), store.log)
    }

    @Test
    fun anAreaReadsBackFromItsPacksMetadata() {
        val area = MapArea("plan:0b7c", Bounds(47.26927312345, -0.1, 48.1, 12.000000000001))
        assertEquals(area, decodeArea(encodeArea(area)))
        assertNull(decodeArea("garmisch-20km".encodeToByteArray()))
        assertNull(decodeArea("tracks-area v1\naround\n1\n2\n0\n4".encodeToByteArray()))
    }
}
