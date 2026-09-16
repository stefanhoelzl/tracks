package net.stho.tracks.recording

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.sensors.Fix
import net.stho.tracks.sensors.Pressure

/** One line of a ride's journal. */
sealed interface Entry {
    /** The first line: which ride this is, and what it was started from. */
    data class Started(
        /** The ride's `externalId` in Tracks, fixed when recording starts so a retried upload finds the same row. */
        val id: String,
        val epochMillis: Long,
        /** The plan's name, for the title; null for a ride with no plan. */
        val plan: String?,
        /** The plan's routing profile — road, trekking, gravel, mtb, hiking — for the sport; null without a plan. */
        val profile: String?,
    ) : Entry

    data class Located(val fix: Fix) : Entry
    data class Pressured(val pressure: Pressure) : Entry
    data class Paused(val epochMillis: Long) : Entry
    data class Resumed(val epochMillis: Long) : Entry
    data class Stopped(val epochMillis: Long) : Entry

    /**
     * The plan the ride follows from here on, by its id on the phone; null for none. Written as navigation starts — so
     * a ride the app died during continues on its plan — and whenever the plan it follows becomes another.
     */
    data class Follows(val planId: String?, val epochMillis: Long) : Entry

    /** What the Save sheet said. A journal ending in one is a ride waiting to upload. */
    data class Saved(val title: String, val sport: String) : Entry
}

/**
 * A ride on disk: one line per [Entry], appended as it happens and never rewritten.
 *
 * Text, tab-separated, one kind per line, because the only reader that matters is this one and the only failure that
 * matters is the app dying mid-write. A line is complete when its newline is written, so a journal that does not end
 * in one has a torn last line, and [parse] drops it — that, and nothing else, is what surviving a kill takes. Ten hours
 * at 1 Hz is ~36k fixes and as many pressures, a few megabytes: no reason for a database.
 *
 * Free text (a title, a plan's name) is written as a JSON string, so a tab or a newline in it cannot end the field.
 */
object Journal {
    private const val VERSION = "1"

    fun line(entry: Entry): String = when (entry) {
        is Entry.Started -> fields("ride", VERSION, entry.id, entry.epochMillis, entry.plan?.let(::quote), entry.profile)
        is Entry.Located -> with(entry.fix) {
            fields("fix", epochMillis, at.lat, at.lon, altitudeM, accuracyM, speedMps, courseDeg)
        }
        is Entry.Pressured -> fields("hpa", entry.pressure.epochMillis, entry.pressure.hPa)
        is Entry.Paused -> fields("pause", entry.epochMillis)
        is Entry.Resumed -> fields("resume", entry.epochMillis)
        is Entry.Stopped -> fields("stop", entry.epochMillis)
        is Entry.Follows -> fields("follow", entry.epochMillis, entry.planId?.let(::quote))
        is Entry.Saved -> fields("save", quote(entry.title), entry.sport)
    }

    /** Every complete line of [text], in order. Throws [IllegalArgumentException] for a line that is complete and wrong. */
    fun parse(text: String): List<Entry> {
        val complete = text.substring(0, text.lastIndexOf('\n') + 1)
        return complete.lineSequence().filter { it.isNotEmpty() }.map(::entry).toList()
    }

    /** The length of [text] up to and including its last newline: what is left once a torn line is cut off. */
    fun completeLength(text: String): Int = text.lastIndexOf('\n') + 1

    private fun entry(line: String): Entry {
        val f = line.split('\t')
        fun long(i: Int) = f.getOrNull(i)?.toLongOrNull() ?: invalid(line)
        fun double(i: Int) = f.getOrNull(i)?.toDoubleOrNull() ?: invalid(line)
        fun optional(i: Int) = f.getOrNull(i)?.takeIf { it.isNotEmpty() }?.let { it.toDoubleOrNull() ?: invalid(line) }
        fun text(i: Int) = f.getOrNull(i)?.takeIf { it.isNotEmpty() }
        return when (f[0]) {
            "ride" -> {
                if (f.getOrNull(1) != VERSION) invalid(line)
                Entry.Started(text(2) ?: invalid(line), long(3), text(4)?.let(::unquote), text(5))
            }
            "fix" -> Entry.Located(Fix(Coordinate(double(2), double(3)), optional(4), optional(7), optional(6), optional(5), long(1)))
            "hpa" -> Entry.Pressured(Pressure(double(2), long(1)))
            "pause" -> Entry.Paused(long(1))
            "resume" -> Entry.Resumed(long(1))
            "stop" -> Entry.Stopped(long(1))
            "follow" -> Entry.Follows(text(2)?.let(::unquote), long(1))
            "save" -> Entry.Saved(unquote(text(1) ?: invalid(line)), text(2) ?: invalid(line))
            else -> invalid(line)
        }
    }

    private fun fields(vararg values: Any?) = values.joinToString("\t") { it?.toString() ?: "" }

    private fun quote(text: String) = JsonPrimitive(text).toString()

    private fun unquote(field: String) = Json.parseToJsonElement(field).jsonPrimitive.content

    private fun invalid(line: String): Nothing = throw IllegalArgumentException("journal: unreadable line '$line'")
}
