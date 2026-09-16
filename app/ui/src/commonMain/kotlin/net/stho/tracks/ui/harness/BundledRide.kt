package net.stho.tracks.ui.harness

import net.stho.tracks.ui.resources.Res
import net.stho.tracks.ui.sensors.RideReplay

/** The ride the harness replays when it is given none: the first 6 km out of Garmisch, with one stop. */
suspend fun bundledRide(): RideReplay = RideReplay.gpx(Res.readBytes("files/rides/garmisch.gpx").decodeToString())
