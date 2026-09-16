package net.stho.tracks.ui.recording

import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.Terrain
import net.stho.tracks.recording.Entry
import net.stho.tracks.recording.JournalWriter
import net.stho.tracks.recording.MAX_ACCURACY_M
import net.stho.tracks.recording.Ride
import net.stho.tracks.recording.Rides
import net.stho.tracks.recording.Tally
import net.stho.tracks.recording.sportFor
import net.stho.tracks.ui.sensors.Sensors

/** How often recorded lines are handed to the file system: what a kill can cost, at most. */
const val FLUSH_MS = 5_000L

sealed interface RecorderState {
    data object Idle : RecorderState

    data class Recording(
        val id: String,
        val paused: Boolean,
        val distanceM: Double,
        /** Null without a barometer. */
        val climbedM: Double?,
        /** The id of the plan the ride follows; null for a ride with no plan. */
        val planId: String? = null,
    ) : RecorderState

    /** A ride the app died during, found when it started again: continue it, or stop it here. */
    data class Interrupted(val id: String, val distanceM: Double) : RecorderState

    /** Stopped, and the Save sheet is up, filled in with what the ride was started from. */
    data class Stopped(val id: String, val title: String, val sport: String) : RecorderState
}

/**
 * Records a ride from [sensors] into [rides]: the one object between the screen and a journal.
 *
 * Every fix no worse than [MAX_ACCURACY_M] and every pressure is appended as it arrives, and handed to the file system
 * every [FLUSH_MS] and at every change of state. GPS keeps running through a pause — the fixes are just not kept — so
 * resuming is immediate.
 *
 * Nothing is held that the journal does not also hold. Started again after the app died, the recorder finds the ride on
 * disk and offers to continue it, and the numbers on the screen are the journal read back.
 *
 * [scope] must be single-threaded, as the UI's is: the collectors and the buttons take turns at the same writer.
 */
class Recorder(
    private val rides: Rides,
    private val sensors: Sensors,
    private val scope: CoroutineScope,
    /** The title of a ride with no plan: its date, as the platform writes one. */
    private val dateTitle: (epochMillis: Long) -> String = { Instant.fromEpochMilliseconds(it).toString().take(10) },
    /** A ride was saved: the upload queue's cue to try now. */
    private val onSaved: () -> Unit = {},
    private val clock: () -> Long = { Clock.System.now().toEpochMilliseconds() },
    @OptIn(ExperimentalUuidApi::class)
    private val newId: () -> String = { Uuid.random().toString() },
) {
    private val mutableState = MutableStateFlow(next())
    val state: StateFlow<RecorderState> = mutableState.asStateFlow()

    private val mutableTrack = MutableStateFlow<List<Coordinate>>(emptyList())
    private val mutableElevation = MutableStateFlow<Terrain?>(null)

    /** The ride's height against distance ridden, so far: what a ride with no plan draws as its profile. */
    val elevation: StateFlow<Terrain?> = mutableElevation.asStateFlow()

    /** Where the ride has been: every fix kept, from the start — or the journal, when continued — until it is saved or discarded. */
    val track: StateFlow<List<Coordinate>> = mutableTrack.asStateFlow()

    private var id: String? = null
    private var writer: JournalWriter? = null
    private var collecting: Job? = null
    private var tally = Tally()
    private var paused = false
    private var following: String? = null
    private var heights = 0
    private var flushedAt = 0L

    /**
     * Starts a ride; [plan] and [profile] are the plan's name and routing profile, and [planId] the stored plan it
     * follows, when it has one.
     */
    fun start(plan: String? = null, profile: String? = null, planId: String? = null) {
        check(state.value == RecorderState.Idle) { "already recording" }
        val started = Entry.Started(newId(), clock(), plan, profile)
        writer = rides.start(started).apply {
            if (planId != null) {
                append(Entry.Follows(planId, started.epochMillis))
                flush()
            }
        }
        record(started.id, Tally(), emptyList(), paused = false, planId = planId)
    }

    fun pause() = mark(Entry.Paused(clock()), paused = true)

    fun resume() = mark(Entry.Resumed(clock()), paused = false)

    /** Stops the ride being recorded, or the one that was interrupted, and puts the Save sheet up. */
    fun stop() {
        val ride = when (val current = state.value) {
            is RecorderState.Recording -> current.id.also {
                collecting?.cancel()
                writer?.append(Entry.Stopped(clock()))
                writer?.close()
                writer = null
                id = null
            }
            is RecorderState.Interrupted -> current.id.also { rides.append(it, Entry.Stopped(clock())) }
            else -> error("nothing to stop")
        }.let(rides::get)

        if (ride.fixes.isEmpty()) {
            // Stopped before the first fix: there is no ride to ask about.
            rides.delete(ride.id)
            clear()
            mutableState.value = next()
        } else {
            mutableState.value = draft(ride)
        }
    }

    /** Picks an interrupted ride up where the journal left it, paused if it was paused. */
    fun continueRide() {
        val interrupted = state.value as? RecorderState.Interrupted ?: error("nothing to continue")
        val ride = rides.get(interrupted.id)
        writer = rides.reopen(ride.id)
        record(ride.id, Tally.of(ride.entries), ride.fixes.map { it.fix.at }, paused = ride.state == Ride.State.Paused, planId = ride.following)
    }

    /** Queues the stopped ride for upload. */
    fun save(title: String, sport: String) {
        val stopped = state.value as? RecorderState.Stopped ?: error("nothing to save")
        rides.append(stopped.id, Entry.Saved(title.trim().ifEmpty { stopped.title }, sport))
        clear()
        mutableState.value = next()
        onSaved()
    }

    /** Deletes the stopped ride's journal. */
    fun discard() {
        val stopped = state.value as? RecorderState.Stopped ?: error("nothing to discard")
        rides.delete(stopped.id)
        clear()
        mutableState.value = next()
    }

    /** Writes through whatever is buffered: for the moment the app goes to the background. */
    fun flush() {
        writer?.flush()
        flushedAt = clock()
    }

    private fun record(rideId: String, from: Tally, track: List<Coordinate>, paused: Boolean, planId: String?) {
        id = rideId
        tally = from
        mutableTrack.value = track
        heights = -1
        this.paused = paused
        following = planId
        flushedAt = clock()
        publish()
        collecting = scope.launch {
            launch {
                sensors.fixes.collect { fix ->
                    if (fix.accuracyM?.let { it <= MAX_ACCURACY_M } == true) append(Entry.Located(fix))
                }
            }
            launch { sensors.pressures.collect { append(Entry.Pressured(it)) } }
        }
    }

    private fun append(entry: Entry) {
        val writer = writer ?: return
        if (paused) return
        writer.append(entry)
        tally.add(entry)
        // A copy a second: fine for a harness, and for M14 to make incremental when the riding screen draws it.
        if (entry is Entry.Located) mutableTrack.value = mutableTrack.value + entry.fix.at
        if (clock() - flushedAt >= FLUSH_MS) flush()
        publish()
    }

    private fun mark(entry: Entry, paused: Boolean) {
        val writer = checkNotNull(writer) { "not recording" }
        if (this.paused == paused) return
        writer.append(entry)
        tally.add(entry)
        this.paused = paused
        flush()
        publish()
    }

    private fun publish() {
        mutableState.value = RecorderState.Recording(
            id = checkNotNull(id),
            paused = paused,
            distanceM = tally.odometer.distanceM,
            climbedM = tally.climb.gainM.takeIf { tally.barometric },
            planId = following,
        )
        // Measured again only when there is a new height: every 25 m, not every second.
        if (tally.elevation.size != heights) {
            heights = tally.elevation.size
            mutableElevation.value = tally.elevation.terrain()
        }
    }

    private fun clear() {
        mutableTrack.value = emptyList()
        mutableElevation.value = null
    }

    /** What the screen should offer when nothing is being recorded: the oldest ride still waiting for an answer. */
    private fun next(): RecorderState {
        val ride = rides.all().firstOrNull { it.state != Ride.State.Saved } ?: return RecorderState.Idle
        return when (ride.state) {
            Ride.State.Stopped -> draft(ride)
            else -> RecorderState.Interrupted(ride.id, Tally.of(ride.entries).odometer.distanceM)
        }
    }

    private fun draft(ride: Ride) = RecorderState.Stopped(
        id = ride.id,
        title = ride.started.plan ?: dateTitle(ride.started.epochMillis),
        sport = sportFor(ride.started.profile),
    )
}
