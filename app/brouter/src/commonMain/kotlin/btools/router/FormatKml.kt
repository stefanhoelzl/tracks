package btools.router

import btools.mapaccess.MatchedWaypoint
import btools.util.StringUtils.escapeXml10

class FormatKml(rc: RoutingContext?) : Formatter(rc) {
    public override fun format(t: OsmTrack): String? {
        val sb = StringBuilder(8192)

        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")

        sb.append("<kml xmlns=\"http://earth.google.com/kml/2.0\">\n")
        sb.append("  <Document>\n")
        sb.append("    <name>KML Samples</name>\n")
        sb.append("    <open>1</open>\n")
        sb.append("    <distance>3.497064</distance>\n")
        sb.append("    <traveltime>872</traveltime>\n")
        sb.append("    <description>To enable simple instructions add: 'instructions=1' as parameter to the URL</description>\n")
        sb.append("    <Folder>\n")
        sb.append("      <name>Paths</name>\n")
        sb.append("      <visibility>0</visibility>\n")
        sb.append("      <description>Examples of paths.</description>\n")
        sb.append("      <Placemark>\n")
        sb.append("        <name>Tessellated</name>\n")
        sb.append("        <visibility>0</visibility>\n")
        sb.append("        <description><![CDATA[If the <tessellate> tag has a value of 1, the line will contour to the underlying terrain]]></description>\n")
        sb.append("        <LineString>\n")
        sb.append("          <tessellate>1</tessellate>\n")
        sb.append("         <coordinates>")

        for (n in t.nodes) {
            sb.append(formatILon(n.iLon)).append(",").append(formatILat(n.iLat)).append("\n")
        }

        sb.append("          </coordinates>\n")
        sb.append("        </LineString>\n")
        sb.append("      </Placemark>\n")
        sb.append("    </Folder>\n")
        if (t.exportWaypoints || t.exportCorrectedWaypoints || !t.pois.isEmpty()) {
            if (!t.pois.isEmpty()) {
                sb.append("    <Folder>\n")
                sb.append("      <name>poi</name>\n")
                for (i in t.pois.indices) {
                    val poi = t.pois.get(i)
                    createPlaceMark(sb, poi!!.name!!, poi.iLat, poi.iLon)
                }
                sb.append("    </Folder>\n")
            }

            if (t.exportWaypoints) {
                val size = t.matchedWaypoints!!.size
                createFolder(sb, "start", t.matchedWaypoints!!.subList(0, 1))
                if (t.matchedWaypoints!!.size > 2) {
                    createFolder(sb, "via", t.matchedWaypoints!!.subList(1, size - 1))
                }
                createFolder(sb, "end", t.matchedWaypoints!!.subList(size - 1, size))
            }
            if (t.exportCorrectedWaypoints) {
                val list: MutableList<OsmNodeNamed> = ArrayList<OsmNodeNamed>()
                for (i in t.matchedWaypoints!!.indices) {
                    val wp = t.matchedWaypoints!!.get(i)
                    if (wp.correctedpoint != null) {
                        val n = OsmNodeNamed(wp.correctedpoint!!)
                        n.name = wp.name + "_corr"
                        list.add(n)
                    }
                }
                val size = list.size
                createViaFolder(sb, "via_corr", list.subList(0, size))
            }
        }
        sb.append("  </Document>\n")
        sb.append("</kml>\n")

        return sb.toString()
    }

    private fun createFolder(sb: StringBuilder, type: String?, waypoints: MutableList<MatchedWaypoint>) {
        sb.append("    <Folder>\n")
        sb.append("      <name>" + type + "</name>\n")
        for (i in waypoints.indices) {
            val wp = waypoints.get(i)
            createPlaceMark(sb, wp.name!!, wp.waypoint!!.iLat, wp.waypoint!!.iLon)
        }
        sb.append("    </Folder>\n")
    }

    private fun createViaFolder(sb: StringBuilder, type: String?, waypoints: MutableList<OsmNodeNamed>) {
        if (waypoints.isEmpty()) return
        sb.append("    <Folder>\n")
        sb.append("      <name>" + type + "</name>\n")
        for (i in waypoints.indices) {
            val wp = waypoints.get(i)
            createPlaceMark(sb, wp.name!!, wp.iLat, wp.iLon)
        }
        sb.append("    </Folder>\n")
    }

    private fun createPlaceMark(sb: StringBuilder, name: String, ilat: Int, ilon: Int) {
        sb.append("      <Placemark>\n")
        sb.append("        <name>" + escapeXml10(name) + "</name>\n")
        sb.append("        <Point>\n")
        sb.append("         <coordinates>" + formatILon(ilon) + "," + formatILat(ilat) + "</coordinates>\n")
        sb.append("        </Point>\n")
        sb.append("      </Placemark>\n")
    }
}
