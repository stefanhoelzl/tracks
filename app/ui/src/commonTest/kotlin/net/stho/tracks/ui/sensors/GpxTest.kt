package net.stho.tracks.ui.sensors

import kotlin.test.Test
import kotlin.test.assertEquals
import net.stho.tracks.codec.Coordinate

class GpxTest {
    @Test
    fun everyTrackAndSegmentInOrder() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
              <wpt lat="1" lon="1"><name>not a track point</name></wpt>
              <trk><trkseg>
                <trkpt lat="46.83" lon="10.51"><ele>1500</ele><time>2026-07-03T07:00:00Z</time></trkpt>
                <trkpt lon="10.56" lat="46.8402">
                  <ele> 1560.5 </ele>
                  <time>2026-07-03T07:12:00.500Z</time>
                </trkpt>
              </trkseg><trkseg>
                <trkpt lat='46.87' lon='10.81'/>
              </trkseg></trk>
              <rte><rtept lat="2" lon="2"/></rte>
            </gpx>
        """.trimIndent()

        assertEquals(
            listOf(
                TrackPoint(Coordinate(46.83, 10.51), 1500.0, 1_783_062_000_000),
                TrackPoint(Coordinate(46.8402, 10.56), 1560.5, 1_783_062_720_500),
                TrackPoint(Coordinate(46.87, 10.81), null, null),
            ),
            Gpx.trackPoints(xml),
        )
    }

    @Test
    fun prefixedNamespaceAndBrokenValues() {
        val xml = """
            <g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg>
              <g:trkpt lat="47.5" lon="11.1"><g:ele>x</g:ele><g:time>yesterday</g:time></g:trkpt>
              <g:trkpt lat="nowhere" lon="11.2"></g:trkpt>
            </g:trkseg></g:trk></g:gpx>
        """.trimIndent()

        assertEquals(listOf(TrackPoint(Coordinate(47.5, 11.1), null, null)), Gpx.trackPoints(xml))
    }
}
