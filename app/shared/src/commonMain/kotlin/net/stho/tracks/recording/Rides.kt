package net.stho.tracks.recording

import okio.BufferedSink
import okio.FileSystem
import okio.Path
import okio.buffer

/** A ride as its journal has it. */
class Ride(val entries: List<Entry>) {
    val started: Entry.Started = entries.firstOrNull() as? Entry.Started
        ?: throw IllegalArgumentException("journal: a ride starts with its 'ride' line")

    val id: String get() = started.id

    val state: State = when (val last = entries.lastOrNull { it !is Entry.Located && it !is Entry.Pressured && it !is Entry.Started }) {
        null, is Entry.Resumed -> State.Recording
        is Entry.Paused -> State.Paused
        is Entry.Stopped -> State.Stopped
        is Entry.Saved -> State.Saved
        else -> error("unreachable: $last")
    }

    val saved: Entry.Saved? get() = entries.lastOrNull() as? Entry.Saved

    val fixes: List<Entry.Located> get() = entries.filterIsInstance<Entry.Located>()

    enum class State {
        /** Being recorded — or, read back when nothing is recording, a ride the app died during. */
        Recording,
        Paused,

        /** Stopped and waiting for the Save sheet's answer. */
        Stopped,

        /** Saved: waiting to upload. */
        Saved,
    }
}

/**
 * The rides on disk, one journal each: the recording and the upload queue in one place.
 *
 * A ride is a file from its first fix until it has landed in Tracks, and nothing else holds it — not memory, not a
 * second queue — so there is nothing to lose when iOS ends the app, and nothing to reconcile when it starts again.
 */
class Rides(private val directory: Path, private val fileSystem: FileSystem = FileSystem.SYSTEM) {
    private fun path(id: String) = directory / "$id.ride"

    /** Every ride on disk, oldest first. A journal that cannot be read is skipped rather than blocking the rest. */
    fun all(): List<Ride> {
        if (!fileSystem.exists(directory)) return emptyList()
        return fileSystem.list(directory).filter { it.name.endsWith(".ride") }
            .mapNotNull { runCatching { read(it) }.getOrNull() }
            .sortedBy { it.started.epochMillis }
    }

    fun get(id: String): Ride = read(path(id))

    /** Creates the journal with its first line, written through before this returns. */
    fun start(started: Entry.Started): JournalWriter {
        fileSystem.createDirectories(directory)
        val path = path(started.id)
        require(!fileSystem.exists(path)) { "a ride ${started.id} exists already" }
        return JournalWriter(fileSystem.sink(path, mustCreate = true).buffer()).apply {
            append(started)
            flush()
        }
    }

    /**
     * Opens an existing journal to append to it.
     *
     * A torn last line is cut off first: appending after it would glue the next line onto it, and turn the one line a
     * kill may cost into an unreadable journal.
     */
    fun reopen(id: String): JournalWriter {
        val path = path(id)
        val text = fileSystem.read(path) { readUtf8() }
        val complete = Journal.completeLength(text)
        if (complete < text.length) {
            val repaired = directory / "$id.ride.repair"
            fileSystem.write(repaired) { writeUtf8(text.substring(0, complete)) }
            fileSystem.atomicMove(repaired, path)
        }
        return JournalWriter(fileSystem.appendingSink(path).buffer())
    }

    /** Appends one entry and writes it through: for the lines that change a ride's state. */
    fun append(id: String, entry: Entry) {
        reopen(id).use { it.append(entry) }
    }

    fun delete(id: String) = fileSystem.delete(path(id), mustExist = false)

    private fun read(path: Path) = Ride(Journal.parse(fileSystem.read(path) { readUtf8() }))
}

/** Appends to one journal. Lines reach the file on [flush] and on [close]; until then they are in memory. */
class JournalWriter internal constructor(private val sink: BufferedSink) : AutoCloseable {
    fun append(entry: Entry) {
        sink.writeUtf8(Journal.line(entry)).writeUtf8("\n")
    }

    /**
     * Hands what is buffered to the operating system.
     *
     * Not an fsync: what survives is the app being killed, which is what iOS does, rather than the phone losing power
     * mid-write, which a flat battery does not — iOS shuts down before it gets there.
     */
    fun flush() = sink.flush()

    override fun close() = sink.close()
}
