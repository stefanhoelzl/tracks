package net.stho.tracks.ui.measure

/**
 * What a measured run switches off, so that the difference against a run without it *is* that path's cost.
 *
 * A global, which nothing else in this codebase is, and deliberately: an ablation has to reach into the middle of
 * `TracksMap` and `Riding` without those gaining a parameter the product does not need. Nothing sets it outside a
 * measured launch, and with none set every check below is false and the app is exactly itself.
 *
 * | | |
 * |---|---|
 * | `NoMap` | The map is not composed: the upper bound of anything the map costs |
 * | `NoHeading` | The compass is never collected: what headings cost, all the way down |
 * | `Idle` | Nothing is recorded and no ride runs: the app's own floor |
 * | `StaticCamera` | `Free` instead of `Follow`, so the camera never moves: what following the rider costs |
 *
 * The investigation used more (a frozen ridden line, no location puck, a bare style, an empty interop view, …); each
 * answered its question and was retired with it; `app/docs/BATTERY.md` has what they found.
 */
enum class Ablation {
    NoMap,
    NoHeading,
    Idle,
    StaticCamera,
    ;

    companion object {
        /** Set once at launch, by [configureMeasurement], and never afterwards. */
        var current: Ablation? = null

        fun of(name: String?): Ablation? = entries.firstOrNull { it.name.equals(name, ignoreCase = true) }

        val noMap: Boolean get() = current == NoMap
        val noHeading: Boolean get() = current == NoHeading
        val idle: Boolean get() = current == Idle
        val staticCamera: Boolean get() = current == StaticCamera
    }
}

/**
 * Values a measured run may set in place of the product's own, so one build can compare several.
 *
 * Unlike [Ablation], these do not switch a path off; they change a number. Null means the product's value, and
 * nothing sets them outside a measured launch. Each is one of the product's battery levers, kept adjustable so the
 * next change to it can be measured against the current value without a second build.
 */
object MeasureOverrides {
    /** How long the riding camera takes to step to each new fix, in ms, in place of `FOLLOW_MS`. */
    var followMs: Long? = null

    /** The map's frame cap while nothing is touching it, in place of `MAX_FPS`; 0 switches the cap off. */
    var maxFps: Int? = null

    /**
     * CoreLocation's `headingFilter` in degrees, in place of the product's 5. Only a real compass shows what it
     * changes — a replay delivers one heading a second whatever the filter is — so pair it with `realHeading`.
     */
    var headingFilter: Double? = null

    /** The riding camera's zoom, in place of `RIDING_ZOOM`. */
    var ridingZoom: Double? = null
}
