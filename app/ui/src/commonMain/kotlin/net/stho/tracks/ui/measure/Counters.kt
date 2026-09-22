package net.stho.tracks.ui.measure

/*
 * Plain counters the product increments where the thing happens and [RideMeasure] turns into rates. Not Compose state:
 * counting must change nothing it counts. Incremented on every build, measured or not — an increment is nothing next
 * to what it counts.
 */

/** MapLibre's own frames, counted from `MapEvent.FrameRendered`: how often the map actually draws. */
object MapFrames {
    var count: Long = 0
}

/** MapLibre's idle events: whether the map ever declares itself done between changes. */
object MapIdles {
    var count: Long = 0
}

/**
 * How often each composable on the riding path recomposes, counted in a `SideEffect`, which runs once after every
 * composition of its scope. Whether something re-runs the whole riding screen is then a number, not an inference.
 */
object RecomposeCounts {
    var riding: Long = 0
    var ridingScreen: Long = 0
    var tracksMap: Long = 0
    var mapLibreMap: Long = 0
}

/** Every heading that reaches the app, counted by [countingHeadings]: how often the compass actually speaks. */
object HeadingCalls {
    var count: Long = 0
}
