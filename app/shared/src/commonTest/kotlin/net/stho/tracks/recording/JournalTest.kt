package net.stho.tracks.recording

import kotlin.random.Random
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Pressure
import okio.FileSystem
import okio.use

class JournalTest {
    private val t0 = 1_783_062_000_000L

    private val entries = listOf(
        Entry.Started("0b7c", t0, "Über den\tPass \"alt\"\nzurück", "gravel"),
        Entry.Located(Fix(Coordinate(47.4925, 11.0953), 707.25, 91.5, 5.4, 4.7, t0 + 1000)),
        Entry.Located(Fix(Coordinate(47.4926, 11.0954), null, null, null, 12.0, t0 + 2000)),
        Entry.Follows("plan-7\t\"x\"", t0 + 1200),
        Entry.Pressured(Pressure(930.1234, t0 + 1500)),
        Entry.Paused(t0 + 3000),
        Entry.Resumed(t0 + 4000),
        Entry.Follows(null, t0 + 4500),
        Entry.Stopped(t0 + 5000),
        Entry.Saved("Ride\ton 15 Sep", "hike"),
    )

    private val text = entries.joinToString("") { Journal.line(it) + "\n" }

    @Test
    fun everyEntryReadsBackAsItWasWritten() {
        assertEquals(entries, Journal.parse(text))
        assertEquals(Entry.Started("x", 1, null, null), Journal.parse(Journal.line(Entry.Started("x", 1, null, null)) + "\n").single())
    }

    @Test
    fun aTornLastLineIsDropped() {
        val torn = text + Journal.line(entries[1]).take(12)
        assertEquals(entries, Journal.parse(torn))
        assertEquals(text.length, Journal.completeLength(torn))
    }

    @Test
    fun aCompleteLineThatIsWrongIsAnError() {
        assertFailsWith<IllegalArgumentException> { Journal.parse(text + "fix\t1\tnorth\n") }
        assertFailsWith<IllegalArgumentException> { Journal.parse("ride\t2\tx\t1\t\t\n") }
    }

    private val fs = FileSystem.SYSTEM
    private val dir = FileSystem.SYSTEM_TEMPORARY_DIRECTORY / "tracks-rides-${Random.nextLong().toULong()}"

    @AfterTest
    fun cleanUp() = fs.deleteRecursively(dir)

    @Test
    fun aRideIsAppendedToAndReadBack() {
        val rides = Rides(dir)
        rides.start(entries[0] as Entry.Started).use { writer -> entries.drop(1).take(3).forEach(writer::append) }
        assertEquals(Ride.State.Recording, rides.get("0b7c").state)
        assertEquals("plan-7\t\"x\"", rides.get("0b7c").following)

        rides.append("0b7c", Entry.Paused(t0 + 3000))
        assertEquals(Ride.State.Paused, rides.get("0b7c").state)
        rides.append("0b7c", Entry.Stopped(t0 + 5000))
        assertEquals(Ride.State.Stopped, rides.get("0b7c").state)
        rides.append("0b7c", Entry.Follows(null, t0 + 5500))
        assertEquals(Ride.State.Stopped, rides.get("0b7c").state)
        assertEquals(null, rides.get("0b7c").following)
        rides.append("0b7c", Entry.Saved("x", "bike"))
        assertEquals(Ride.State.Saved, rides.all().single().state)

        rides.delete("0b7c")
        assertEquals(emptyList(), rides.all())
    }

    @Test
    fun reopeningCutsATornLineSoTheNextOneIsNotGluedToIt() {
        val rides = Rides(dir)
        rides.start(entries[0] as Entry.Started).close()
        val path = dir / "0b7c.ride"
        // What a kill mid-flush leaves: a line without its end.
        fs.appendingSink(path).use { sink -> okio.Buffer().writeUtf8("fix\t17830620").let { sink.write(it, it.size) } }

        rides.reopen("0b7c").use { it.append(entries[1]) }
        assertEquals(entries.take(2), rides.get("0b7c").entries)
    }

    @Test
    fun anUnreadableJournalDoesNotHideTheOthers() {
        val rides = Rides(dir)
        rides.start(Entry.Started("good", t0, null, null)).close()
        fs.write(dir / "bad.ride") { writeUtf8("nonsense\n") }
        assertEquals(listOf("good"), rides.all().map { it.id })
    }
}
