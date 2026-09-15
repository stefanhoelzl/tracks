package btools.router

import btools.mapaccess.MatchedWaypoint
import btools.util.StringUtils.escapeJson
import btools.kmp.io.BufferedWriter
import btools.kmp.io.StringWriter
import btools.kmp.util.*

class FormatJson(rc: RoutingContext?) : Formatter(rc) {
    public override fun format(t: OsmTrack): String? {
        val turnInstructionMode = if (t.voiceHints != null) t.voiceHints!!.turnInstructionMode else 0

        val sb = StringBuilder(8192)

        sb.append("{\n")
        sb.append("  \"type\": \"FeatureCollection\",\n")
        sb.append("  \"features\": [\n")
        sb.append("    {\n")
        sb.append("      \"type\": \"Feature\",\n")
        sb.append("      \"properties\": {\n")
        sb.append("        \"creator\": \"BRouter-" + OsmTrack.version + "\",\n")
        sb.append("        \"name\": \"").append(t.name).append("\",\n")
        sb.append("        \"track-length\": \"").append(t.distance).append("\",\n")
        sb.append("        \"filtered ascend\": \"").append(t.ascend).append("\",\n")
        sb.append("        \"plain-ascend\": \"").append(t.plainAscend).append("\",\n")
        sb.append("        \"total-time\": \"").append(t.totalSeconds).append("\",\n")
        sb.append("        \"total-energy\": \"").append(t.energy).append("\",\n")
        sb.append("        \"cost\": \"").append(t.cost).append("\",\n")
        if (t.voiceHints != null && !t.voiceHints!!.list.isEmpty()) {
            sb.append("        \"voicehints\": [\n")
            for (hint in t.voiceHints!!.list) {
                sb.append("          [")
                sb.append(hint!!.indexInTrack)
                sb.append(',').append(getJsonCommandIndex(hint.cmd, turnInstructionMode))
                sb.append(',').append(hint.exitNumber)
                sb.append(',').append(hint.distanceToNext)
                sb.append(',').append(hint.angle.toInt())

                // not always include geometry because longer and only needed for comment style
                if (turnInstructionMode == 4 || turnInstructionMode == 9) { // comment style
                    sb.append(",\"").append(hint.formatGeometry()).append("\"")
                }

                sb.append("],\n")
            }
            sb.deleteAt(sb.lastIndexOf(","))
            sb.append("        ],\n")
        }
        if (t.showSpeedProfile) { // set in profile
            val sp = t.aggregateSpeedProfile()
            if (sp.size > 0) {
                sb.append("        \"speedprofile\": [\n")
                for (i in sp.indices.reversed()) {
                    sb.append("          [").append(sp.get(i)).append(if (i > 0) "],\n" else "]\n")
                }
                sb.append("        ],\n")
            }
        }
        //  ... traditional message list
        run {
            sb.append("        \"messages\": [\n")
            sb.append("          [\"").append(MESSAGES_HEADER.replace("\t".toRegex(), "\", \"")).append("\"],\n")
            for (m in t.aggregateMessages()) {
                sb.append("          [\"").append(m!!.replace("\t".toRegex(), "\", \"")).append("\"],\n")
            }
            sb.deleteAt(sb.lastIndexOf(","))
            sb.append("        ],\n")
        }

        if (t.totalSeconds > 0) {
            sb.append("        \"times\": [")
            for (n in t.nodes) {
                sb.append(btools.kmp.TextFormat.decimal3(n.time)).append(",")
            }
            sb.deleteAt(sb.lastIndexOf(","))
            sb.append("]\n")
        } else {
            sb.deleteAt(sb.lastIndexOf(","))
        }

        sb.append("      },\n")

        if (t.iternity != null) {
            sb.append("      \"iternity\": [\n")
            for (s in t.iternity) {
                sb.append("        \"").append(s).append("\",\n")
            }
            sb.deleteAt(sb.lastIndexOf(","))
            sb.append("        ],\n")
        }
        sb.append("      \"geometry\": {\n")
        sb.append("        \"type\": \"LineString\",\n")
        sb.append("        \"coordinates\": [\n")

        var nn: OsmPathElement? = null
        for (n in t.nodes) {
            var sele = if (n.sElev == Short.MIN_VALUE) "" else ", " + n.elev
            if (t.showspeed) { // hack: show speed instead of elevation
                var speed = 0.0
                if (nn != null) {
                    val dist = n.calcDistance(nn)
                    val dt = n.time - nn.time
                    if (dt != 0f) {
                        speed = ((3.6f * dist) / dt + 0.5)
                    }
                }
                sele = ", " + (((speed * 10).toInt()) / 10f)
            }
            sb.append("          [").append(formatILon(n.iLon)).append(", ").append(formatILat(n.iLat))
                .append(sele).append("],\n")
            nn = n
        }
        sb.deleteAt(sb.lastIndexOf(","))

        sb.append("        ]\n")
        sb.append("      }\n")
        if (t.exportWaypoints || t.exportCorrectedWaypoints || !t.pois.isEmpty()) {
            sb.append("    },\n")
            for (i in 0..t.pois.size - 1) {
                val poi = t.pois.get(i)
                addFeature(sb, "poi", poi!!.name!!, poi.iLat, poi.iLon, poi.sElev)
                if (i < t.pois.size - 1) {
                    sb.append(",")
                }
                sb.append("    \n")
            }
            if (t.exportWaypoints) {
                if (!t.pois.isEmpty()) sb.append("    ,\n")
                for (i in 0..t.matchedWaypoints!!.size - 1) {
                    val wp = t.matchedWaypoints!!.get(i)
                    val type: String?
                    when (wp.wpttype) {
                        MatchedWaypoint.WAYPOINT_TYPE_DIRECT -> type = "beeline"
                        MatchedWaypoint.WAYPOINT_TYPE_MEETING -> type = "via"
                        else -> type = "shaping"
                    }
                    addFeature(sb, type, wp.name!!, wp.waypoint!!.iLat, wp.waypoint!!.iLon, wp.waypoint!!.sElev)
                    if (i < t.matchedWaypoints!!.size - 1) {
                        sb.append(",")
                    }
                    sb.append("    \n")
                }
            }
            if (t.exportCorrectedWaypoints) {
                if (t.exportWaypoints) sb.append("    ,\n")
                var hasCorrPoints = false
                for (i in 0..t.matchedWaypoints!!.size - 1) {
                    val type = "via_corr"

                    val wp = t.matchedWaypoints!!.get(i)
                    if (wp.correctedpoint != null) {
                        if (hasCorrPoints) {
                            sb.append(",")
                        }
                        addFeature(
                            sb,
                            type,
                            wp.name + "_corr",
                            wp.correctedpoint!!.iLat,
                            wp.correctedpoint!!.iLon,
                            wp.correctedpoint!!.sElev
                        )
                        sb.append("    \n")
                        hasCorrPoints = true
                    }
                }
            }
        } else {
            sb.append("    }\n")
        }
        sb.append("  ]\n")
        sb.append("}\n")

        return sb.toString()
    }

    private fun addFeature(sb: StringBuilder, type: String?, name: String, ilat: Int, ilon: Int, selev: Short) {
        sb.append("    {\n")
        sb.append("      \"type\": \"Feature\",\n")
        sb.append("      \"properties\": {\n")
        sb.append("        \"name\": \"" + escapeJson(name) + "\",\n")
        sb.append("        \"type\": \"" + type + "\"\n")
        sb.append("      },\n")
        sb.append("      \"geometry\": {\n")
        sb.append("        \"type\": \"Point\",\n")
        sb.append("        \"coordinates\": [\n")
        sb.append("          " + formatILon(ilon) + ",\n")
        sb.append("          " + formatILat(ilat) + (if (selev != Short.MIN_VALUE) ",\n          " + selev / 4.0 else "") + "\n")
        sb.append("        ]\n")
        sb.append("      }\n")
        sb.append("    }")
    }

    fun formatAsWaypoint(n: OsmNodeNamed): String? {
        try {
            val sw = StringWriter(8192)
            val bw = BufferedWriter(sw)
            addJsonHeader(bw)
            addJsonFeature(
                bw,
                "info",
                "wpinfo",
                n.iLon,
                n.iLat,
                n.elev,
                (if (n.nodeDescription != null) rc!!.expctxWay!!.getKeyValueDescription(
                    false,
                    n.nodeDescription!!
                ) else null)
            )
            addJsonFooter(bw)
            bw.close()
            sw.close()
            return sw.toString()
        } catch (e: Exception) {
            throw RuntimeException(e)
        }
    }

    private fun addJsonFeature(
        sb: BufferedWriter,
        type: String?,
        name: String,
        ilon: Int,
        ilat: Int,
        elev: Double,
        desc: String?
    ) {
        try {
            sb.append("    {\n")
            sb.append("      \"type\": \"Feature\",\n")
            sb.append("      \"properties\": {\n")
            sb.append("        \"creator\": \"BRouter-" + OsmTrack.version + "\",\n")
            sb.append("        \"name\": \"" + escapeJson(name) + "\",\n")
            sb.append("        \"type\": \"" + type + "\"")
            if (desc != null) {
                sb.append(",\n        \"message\": \"" + desc + "\"\n")
            } else {
                sb.append("\n")
            }
            sb.append("      },\n")
            sb.append("      \"geometry\": {\n")
            sb.append("        \"type\": \"Point\",\n")
            sb.append("        \"coordinates\": [\n")
            sb.append("          " + formatILon(ilon) + ",\n")
            sb.append("          " + formatILat(ilat) + ",\n")
            sb.append("          " + elev + "\n")
            sb.append("        ]\n")
            sb.append("      }\n")
            sb.append("    }\n")
        } catch (e: Exception) {
            throw RuntimeException(e)
        }
    }

    companion object {
        private fun addJsonHeader(sb: BufferedWriter) {
            try {
                sb.append("{\n")
                sb.append("  \"type\": \"FeatureCollection\",\n")
                sb.append("  \"features\": [\n")
            } catch (e: Exception) {
                throw RuntimeException(e)
            }
        }

        private fun addJsonFooter(sb: BufferedWriter) {
            try {
                sb.append("  ]\n")
                sb.append("}\n")
            } catch (e: Exception) {
                throw RuntimeException(e)
            }
        }
    }
}
