package btools.router

import btools.mapaccess.MatchedWaypoint
import btools.router.OsmPathElement.Companion.create
import btools.util.StringUtils
import btools.kmp.io.*
import btools.kmp.util.*

class FormatGpx(rc: RoutingContext?) : Formatter(rc) {
    public override fun format(t: OsmTrack): String? {
        try {
            val sw = StringWriter(8192)
            val bw = BufferedWriter(sw)
            formatAsGpx(bw, t)
            bw.close()
            return sw.toString()
        } catch (e: Exception) {
            throw RuntimeException(e)
        }
    }

    @Throws(IOException::class)
    fun formatAsGpx(sb: BufferedWriter, t: OsmTrack): String? {
        val turnInstructionMode = if (t.voiceHints != null) t.voiceHints!!.turnInstructionMode else 0

        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        if (turnInstructionMode != 9) {
            for (i in t.messageList!!.indices.reversed()) {
                var message = t.messageList!!.get(i)
                if (i < t.messageList!!.size - 1) message = "(alt-index " + i + ": " + message + " )"
                if (message != null) sb.append("<!-- ").append(message).append(" -->\n")
            }
        }

        if (turnInstructionMode == 4) { // comment style
            sb.append("<!-- \$transport-mode$").append(t.voiceHints!!.getTransportMode()).append("$ -->\n")
            sb.append("<!--          cmd    idx        lon        lat d2next  geometry -->\n")
            sb.append("<!-- \$turn-instruction-start$\n")
            for (hint in t.voiceHints!!.list) {
                sb.append(
                    "     \$turn$" +
                        getCommandString(hint!!.cmd, hint.exitNumber, turnInstructionMode).padStart(6) + ";" +
                        hint.indexInTrack.toString().padStart(6) + ";" +
                        formatILon(hint.ilon).padStart(10) + ";" +
                        formatILat(hint.ilat).padStart(10) + ";" +
                        (hint.distanceToNext).toInt().toString().padStart(6) + ";" +
                        hint.formatGeometry() + "$\n"
                )
            }
            sb.append("    \$turn-instruction-end$ -->\n")
        }
        sb.append("<gpx \n")
        sb.append(" xmlns=\"http://www.topografix.com/GPX/1/1\" \n")
        sb.append(" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" \n")
        if (turnInstructionMode == 9) { // BRouter style
            sb.append(" xmlns:brouter=\"Not yet documented\" \n")
        }
        if (turnInstructionMode == 7) { // old locus style
            sb.append(" xmlns:locus=\"http://www.locusmap.eu\" \n")
        }
        sb.append(" xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\" \n")

        if (turnInstructionMode == 3) {
            sb.append(" creator=\"OsmAndRouter\" version=\"1.1\">\n")
        } else {
            sb.append(" creator=\"BRouter-" + OsmTrack.version + "\" version=\"1.1\">\n")
        }
        if (turnInstructionMode == 9) {
            sb.append(" <metadata>\n")
            sb.append("  <name>").append(t.name).append("</name>\n")
            sb.append("  <extensions>\n")
            sb.append("   <brouter:info>").append(t.messageList!!.get(0)).append("</brouter:info>\n")
            if (t.params != null && t.params!!.size > 0) {
                sb.append("   <brouter:params><![CDATA[")
                var i = 0
                for (e in t.params!!.entries) {
                    if (i++ != 0) sb.append("&")
                    sb.append(e.key).append("=").append(e.value)
                }
                sb.append("]]></brouter:params>\n")
            }
            sb.append("  </extensions>\n")
            sb.append(" </metadata>\n")
        }
        if (turnInstructionMode == 3 || turnInstructionMode == 8) { // osmand style, cruiser
            var lastRteTime = 0f

            sb.append(" <rte>\n")

            var rteTime = t.getVoiceHintTime(0)
            val first = StringBuilder()
            // define start point
            run {
                first.append("  <rtept lat=\"").append(formatILat(t.nodes.get(0).iLat)).append("\" lon=\"")
                    .append(formatILon(t.nodes.get(0).iLon)).append("\">\n")
                    .append("   <desc>start</desc>\n   <extensions>\n")
                if (rteTime != lastRteTime) { // add timing only if available
                    val ti = (rteTime - lastRteTime).toDouble()
                    first.append("    <time>").append("" + (ti + 0.5).toInt()).append("</time>\n")
                    lastRteTime = rteTime
                }
                first.append("    <offset>0</offset>\n  </extensions>\n </rtept>\n")
            }
            if (turnInstructionMode == 8) {
                if (t.matchedWaypoints!!.get(0).wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT && t.voiceHints!!.list.get(
                        0
                    )!!.indexInTrack == 0
                ) {
                    // has a voice hint do nothing, voice hint will do
                } else {
                    sb.append(first.toString())
                }
            } else {
                sb.append(first.toString())
            }

            for (i in t.voiceHints!!.list.indices) {
                val hint = t.voiceHints!!.list.get(i)
                sb.append("  <rtept lat=\"").append(formatILat(hint!!.ilat)).append("\" lon=\"")
                    .append(formatILon(hint.ilon)).append("\">\n")
                    .append("   <desc>")
                    .append(
                        if (turnInstructionMode == 3) getMessageString(
                            hint.cmd,
                            hint.exitNumber,
                            turnInstructionMode
                        ) else getCruiserMessageString(hint.cmd, hint.exitNumber)
                    )
                    .append("</desc>\n   <extensions>\n")

                rteTime = t.getVoiceHintTime(i + 1)

                if (rteTime != lastRteTime) { // add timing only if available
                    val ti = (rteTime - lastRteTime).toDouble()
                    sb.append("    <time>").append("" + (ti + 0.5).toInt()).append("</time>\n")
                    lastRteTime = rteTime
                }
                sb.append("    <turn>")
                    .append(
                        if (turnInstructionMode == 3) getCommandString(
                            hint.cmd,
                            hint.exitNumber,
                            turnInstructionMode
                        ) else getCruiserCommandString(hint.cmd, hint.exitNumber)
                    )
                    .append("</turn>\n    <turn-angle>").append("" + hint.angle.toInt())
                    .append("</turn-angle>\n    <offset>").append("" + hint.indexInTrack)
                    .append("</offset>\n  </extensions>\n </rtept>\n")
            }
            sb.append("  <rtept lat=\"").append(formatILat(t.nodes.get(t.nodes.size - 1).iLat)).append("\" lon=\"")
                .append(formatILon(t.nodes.get(t.nodes.size - 1).iLon)).append("\">\n")
                .append("   <desc>destination</desc>\n   <extensions>\n")
            sb.append("    <time>0</time>\n")
            sb.append("    <offset>").append("" + (t.nodes.size - 1)).append("</offset>\n  </extensions>\n </rtept>\n")

            sb.append("</rte>\n")
        }

        if (turnInstructionMode == 7) { // old locus style
            var lastRteTime = t.getVoiceHintTime(0)

            for (i in t.voiceHints!!.list.indices) {
                val hint = t.voiceHints!!.list.get(i)
                sb.append(" <wpt lon=\"").append(formatILon(hint!!.ilon)).append("\" lat=\"")
                    .append(formatILat(hint.ilat)).append("\">")
                    .append(if (hint.selev == Short.MIN_VALUE) "" else "<ele>" + (hint.selev / 4.0) + "</ele>")
                    .append("<name>")
                    .append(getMessageString(hint.cmd, hint.exitNumber, turnInstructionMode))
                    .append("</name>")
                    .append("<extensions><locus:rteDistance>").append("" + hint.distanceToNext)
                    .append("</locus:rteDistance>")
                val rteTime = t.getVoiceHintTime(i + 1)
                if (rteTime != lastRteTime) { // add timing only if available
                    val ti = (rteTime - lastRteTime).toDouble()
                    val speed = hint.distanceToNext / ti
                    sb.append("<locus:rteTime>").append("" + ti).append("</locus:rteTime>")
                        .append("<locus:rteSpeed>").append("" + speed).append("</locus:rteSpeed>")
                    lastRteTime = rteTime
                }
                sb.append("<locus:rtePointAction>").append("" + getLocusAction(hint.cmd, hint.exitNumber))
                    .append("</locus:rtePointAction></extensions>")
                    .append("</wpt>\n")
            }
        }
        if (turnInstructionMode == 5) { // gpsies style
            for (hint in t.voiceHints!!.list) {
                sb.append(" <wpt lon=\"").append(formatILon(hint!!.ilon)).append("\" lat=\"")
                    .append(formatILat(hint.ilat)).append("\">")
                    .append("<name>").append(getMessageString(hint.cmd, hint.exitNumber, turnInstructionMode))
                    .append("</name>")
                    .append("<sym>").append(
                        getSymbolString(
                            hint.cmd,
                            hint.exitNumber,
                            turnInstructionMode
                        ).lowercase()
                    ).append("</sym>")
                    .append("<type>").append(getSymbolString(hint.cmd, hint.exitNumber, turnInstructionMode))
                    .append("</type>")
                    .append("</wpt>\n")
            }
        }

        if (turnInstructionMode == 6) { // orux style
            for (hint in t.voiceHints!!.list) {
                sb.append(" <wpt lat=\"").append(formatILat(hint!!.ilat)).append("\" lon=\"")
                    .append(formatILon(hint.ilon)).append("\">")
                    .append(if (hint.selev == Short.MIN_VALUE) "" else "<ele>" + (hint.selev / 4.0) + "</ele>")
                    .append(
                        "<extensions>\n" +
                                "  <om:oruxmapsextensions xmlns:om=\"http://www.oruxmaps.com/oruxmapsextensions/1/0\">\n" +
                                "   <om:ext type=\"ICON\" subtype=\"0\">"
                    ).append("" + getOruxAction(hint.cmd, hint.exitNumber))
                    .append(
                        "</om:ext>\n" +
                                "  </om:oruxmapsextensions>\n" +
                                "  </extensions>\n" +
                                " </wpt>\n"
                    )
            }
        }

        for (i in 0..t.pois.size - 1) {
            val poi = t.pois.get(i)
            formatWaypointGpx(sb, poi!!, "poi")
        }

        if (t.exportWaypoints) {
            for (i in 0..t.matchedWaypoints!!.size - 1) {
                val wt = t.matchedWaypoints!!.get(i)
                if (i == 0) {
                    formatWaypointGpx(
                        sb,
                        wt,
                        if (wt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT) "beeline" else "via"
                    )
                } else if (i == t.matchedWaypoints!!.size - 1) {
                    formatWaypointGpx(sb, wt, "via")
                } else {
                    if (wt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT) {
                        formatWaypointGpx(sb, wt, "beeline")
                    } else if (wt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_MEETING) {
                        formatWaypointGpx(sb, wt, "via")
                    } else {
                        formatWaypointGpx(sb, wt, "shaping")
                    }
                }
            }
        }
        if (t.exportCorrectedWaypoints) {
            sb.append("\n")
            for (i in 0..t.matchedWaypoints!!.size - 1) {
                val wt = t.matchedWaypoints!!.get(i)
                if (wt.correctedpoint != null) {
                    val n = OsmNodeNamed(wt.correctedpoint!!)
                    n.name = wt.name + "_corr"
                    formatWaypointGpx(sb, n, "shaping")
                }
            }
            sb.append("\n")
        }

        sb.append(" <trk>\n")
        if (turnInstructionMode == 9 || turnInstructionMode == 2 || turnInstructionMode == 8 || turnInstructionMode == 4) { // Locus, comment, cruise, brouter style
            sb.append("  <src>").append(t.name).append("</src>\n")
            sb.append("  <type>").append(t.voiceHints!!.getTransportMode()).append("</type>\n")
        } else {
            sb.append("  <name>").append(t.name).append("</name>\n")
        }

        if (turnInstructionMode == 7) {
            sb.append("  <extensions>\n")
            sb.append("   <locus:rteComputeType>").append("" + t.voiceHints!!.locusRouteType)
                .append("</locus:rteComputeType>\n")
            sb.append("   <locus:rteSimpleRoundabouts>1</locus:rteSimpleRoundabouts>\n")
            sb.append("  </extensions>\n")
        }


        // all points
        sb.append("  <trkseg>\n")
        var lastway = ""
        var bNextDirect = false
        var nn: OsmPathElement? = null
        var aSpeed: String?

        for (idx in t.nodes.indices) {
            val n = t.nodes.get(idx)
            var sele = if (n.sElev == Short.MIN_VALUE) "" else "<ele>" + n.elev + "</ele>"
            val hint = t.getVoiceHint(idx)
            val mwpt = t.getMatchedWaypoint(idx)

            if (t.showTime) {
                sele += "<time>" + getFormattedTime3(n.time) + "</time>"
            }
            if (turnInstructionMode == 8) {
                if (mwpt != null && !mwpt.name!!.startsWith("via") && !mwpt.name!!.startsWith("from") && !mwpt.name!!.startsWith(
                        "to"
                    )
                ) {
                    sele += "<name>" + mwpt.name + "</name>"
                }
            }
            var bNeedHeader = false
            if (turnInstructionMode == 9) { // trkpt/sym style

                if (hint != null) {
                    if (mwpt != null && !mwpt.name!!.startsWith("via") && !mwpt.name!!.startsWith("from") && !mwpt.name!!.startsWith(
                            "to"
                        )
                    ) {
                        sele += "<name>" + mwpt.name + "</name>"
                    }
                    sele += "<desc>" + getCruiserMessageString(hint.cmd, hint.exitNumber) + "</desc>"
                    sele += "<sym>" + getCommandString(hint.cmd, hint.exitNumber, turnInstructionMode) + "</sym>"
                    if (mwpt != null) {
                        if (mwpt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_MEETING) {
                            sele += "<type>via</type>"
                        } else {
                            sele += "<type>shaping</type>"
                        }
                    }
                    sele += "<extensions>"
                    if (t.showspeed) {
                        var speed = 0.0
                        if (nn != null) {
                            val dist = n.calcDistance(nn)
                            val dt = n.time - nn.time
                            if (dt != 0f) {
                                speed = ((3.6f * dist) / dt + 0.5)
                            }
                        }
                        sele += "<brouter:speed>" + (((speed * 10).toInt()) / 10f) + "</brouter:speed>"
                    }

                    sele += "<brouter:voicehint>" + getCommandString(
                        hint.cmd,
                        hint.exitNumber,
                        turnInstructionMode
                    ) + ";" + (hint.distanceToNext).toInt() + "," + hint.formatGeometry() + "</brouter:voicehint>"
                    if (n.message != null && n.message!!.wayKeyValues != null && (n.message!!.wayKeyValues != lastway)) {
                        sele += "<brouter:way>" + n.message!!.wayKeyValues + "</brouter:way>"
                        lastway = n.message!!.wayKeyValues!!
                    }
                    if (n.message != null && n.message!!.nodeKeyValues != null) {
                        sele += "<brouter:node>" + n.message!!.nodeKeyValues + "</brouter:node>"
                    }
                    sele += "</extensions>"
                }
                if (idx == 0 && hint == null) {
                    if (mwpt != null && mwpt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT) {
                        sele += "<desc>beeline</desc>"
                    } else {
                        sele += "<desc>start</desc>"
                    }
                    sele += "<type>via</type>"
                } else if (idx == t.nodes.size - 1 && hint == null) {
                    sele += "<desc>end</desc>"
                    sele += "<type>via</type>"
                } else {
                    if (mwpt != null && hint == null) {
                        if (mwpt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT) {
                            // bNextDirect = true;
                            sele += "<desc>beeline</desc>"
                        } else {
                            sele += "<desc>" + mwpt.name + "</desc>"
                        }
                        if (mwpt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_MEETING) {
                            sele += "<type>via</type>"
                        } else {
                            sele += "<type>shaping</type>"
                        }
                        bNextDirect = false
                    }
                }


                if (hint == null) {
                    bNeedHeader =
                        (t.showspeed || (n.message != null && n.message!!.wayKeyValues != null && (n.message!!.wayKeyValues != lastway))) ||
                                (n.message != null && n.message!!.nodeKeyValues != null)
                    if (bNeedHeader) {
                        sele += "<extensions>"
                        if (t.showspeed) {
                            var speed = 0.0
                            if (nn != null) {
                                val dist = n.calcDistance(nn)
                                val dt = n.time - nn.time
                                if (dt != 0f) {
                                    speed = ((3.6f * dist) / dt + 0.5)
                                }
                            }
                            sele += "<brouter:speed>" + (((speed * 10).toInt()) / 10f) + "</brouter:speed>"
                        }
                        if (n.message != null && n.message!!.wayKeyValues != null && (n.message!!.wayKeyValues != lastway)) {
                            sele += "<brouter:way>" + n.message!!.wayKeyValues + "</brouter:way>"
                            lastway = n.message!!.wayKeyValues!!
                        }
                        if (n.message != null && n.message!!.nodeKeyValues != null) {
                            sele += "<brouter:node>" + n.message!!.nodeKeyValues + "</brouter:node>"
                        }
                        sele += "</extensions>"
                    }
                }
            }

            if (turnInstructionMode == 2) { // locus style new
                if (hint != null) {
                    if (mwpt != null) {
                        if (!mwpt.name!!.startsWith("via") && !mwpt.name!!.startsWith("from") && !mwpt.name!!.startsWith(
                                "to"
                            ) && !mwpt.name!!.startsWith("rt")
                        ) {
                            sele += "<name>" + mwpt.name + "</name>"
                        }
                        if (mwpt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT && bNextDirect) {
                            sele += "<src>" + getLocusSymbolString(
                                hint.cmd,
                                hint.exitNumber
                            ) + "</src><sym>pass_place</sym><type>Shaping</type>"
                            // bNextDirect = false;
                        } else if (mwpt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT) {
                            if (idx == 0) sele += "<sym>pass_place</sym><type>Via</type>"
                            else sele += "<sym>pass_place</sym><type>Shaping</type>"
                            bNextDirect = true
                        } else if (bNextDirect) {
                            sele += "<src>beeline</src><sym>" + getLocusSymbolString(
                                hint.cmd,
                                hint.exitNumber
                            ) + "</sym><type>Shaping</type>"
                            bNextDirect = false
                        } else {
                            sele += "<sym>" + getLocusSymbolString(hint.cmd, hint.exitNumber) + "</sym><type>Via</type>"
                        }
                    } else {
                        sele += "<sym>" + getLocusSymbolString(hint.cmd, hint.exitNumber) + "</sym>"
                    }
                } else {
                    if (idx == 0 && hint == null) {
                        val pos = sele.indexOf("<sym")
                        if (pos != -1) {
                            sele = sele.substring(0, pos)
                        }
                        if (mwpt != null && !mwpt.name!!.startsWith("from")) sele += "<name>" + mwpt.name + "</name>"
                        if (mwpt != null && mwpt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT) {
                            bNextDirect = true
                        }
                        sele += "<sym>pass_place</sym>"
                        sele += "<type>Via</type>"
                    } else if (idx == t.nodes.size - 1 && hint == null) {
                        val pos = sele.indexOf("<sym")
                        if (pos != -1) {
                            sele = sele.substring(0, pos)
                        }
                        if (mwpt != null && mwpt.name != null && !mwpt.name!!.startsWith("to")) sele += "<name>" + mwpt.name + "</name>"
                        if (bNextDirect) {
                            sele += "<src>beeline</src>"
                        }
                        sele += "<sym>pass_place</sym>"
                        sele += "<type>Via</type>"
                    } else {
                        if (mwpt != null) {
                            if (!mwpt.name!!.startsWith("via") && !mwpt.name!!.startsWith("from") && !mwpt.name!!.startsWith(
                                    "to"
                                ) && !mwpt.name!!.startsWith("rt")
                            ) {
                                sele += "<name>" + mwpt.name + "</name>"
                            }
                            if (mwpt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT && bNextDirect) {
                                sele += "<src>beeline</src><sym>pass_place</sym><type>Shaping</type>"
                            } else if (mwpt.wpttype == MatchedWaypoint.WAYPOINT_TYPE_DIRECT) {
                                if (idx == 0) sele += "<sym>pass_place</sym><type>Via</type>"
                                else sele += "<sym>pass_place</sym><type>Shaping</type>"
                                bNextDirect = true
                            } else if (bNextDirect) {
                                sele += "<src>beeline</src><sym>pass_place</sym><type>Shaping</type>"
                                bNextDirect = false
                            } else if (mwpt.name!!.startsWith("via") ||
                                mwpt.name!!.startsWith("from") ||
                                mwpt.name!!.startsWith("to") ||
                                mwpt.name!!.startsWith("rt")
                            ) {
                                if (bNextDirect) {
                                    sele += "<src>beeline</src><sym>pass_place</sym><type>Shaping</type>"
                                } else {
                                    sele += "<sym>pass_place</sym><type>Shaping</type>"
                                }
                                bNextDirect = false
                            } else {
                                sele += "<name>" + mwpt.name + "</name>"
                                sele += "<sym>pass_place</sym><type>Via</type>"
                            }
                        }
                    }
                }
            }
            sb.append("   <trkpt lon=\"").append(formatILon(n.iLon)).append("\" lat=\"")
                .append(formatILat(n.iLat)).append("\">").append(sele).append("</trkpt>\n")

            nn = n
        }

        sb.append("  </trkseg>\n")
        sb.append(" </trk>\n")
        sb.append("</gpx>\n")

        return sb.toString()
    }

    fun formatAsWaypoint(n: OsmNodeNamed): String? {
        try {
            val sw = StringWriter(8192)
            val bw = BufferedWriter(sw)
            formatGpxHeader(bw)
            formatWaypointGpx(bw, n, null)
            formatGpxFooter(bw)
            bw.close()
            sw.close()
            return sw.toString()
        } catch (e: Exception) {
            throw RuntimeException(e)
        }
    }

    @Throws(IOException::class)
    fun formatGpxHeader(sb: BufferedWriter) {
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        sb.append("<gpx \n")
        sb.append(" xmlns=\"http://www.topografix.com/GPX/1/1\" \n")
        sb.append(" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" \n")
        sb.append(" xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\" \n")
        sb.append(" creator=\"BRouter-" + OsmTrack.version + "\" version=\"1.1\">\n")
    }

    @Throws(IOException::class)
    fun formatGpxFooter(sb: BufferedWriter) {
        sb.append("</gpx>\n")
    }

    @Throws(IOException::class)
    fun formatWaypointGpx(sb: BufferedWriter, n: OsmNodeNamed, type: String?) {
        sb.append(" <wpt lon=\"").append(formatILon(n.iLon)).append("\" lat=\"")
            .append(formatILat(n.iLat)).append("\">")
        if (n.sElev != Short.MIN_VALUE) {
            sb.append("<ele>").append("" + n.elev).append("</ele>")
        }
        if (n.name != null) {
            sb.append("<name>").append(StringUtils.escapeXml10(n.name!!)).append("</name>")
        }
        if (n.nodeDescription != null && rc != null) {
            sb.append("<desc>").append(rc!!.expctxWay!!.getKeyValueDescription(false, n.nodeDescription!!))
                .append("</desc>")
        }
        if (type != null) {
            sb.append("<type>").append(type).append("</type>")
        }
        sb.append("</wpt>\n")
    }

    @Throws(IOException::class)
    fun formatWaypointGpx(sb: BufferedWriter, wp: MatchedWaypoint, type: String?) {
        sb.append(" <wpt lon=\"").append(formatILon(wp.waypoint!!.iLon)).append("\" lat=\"")
            .append(formatILat(wp.waypoint!!.iLat)).append("\">")
        if (wp.waypoint!!.sElev != Short.MIN_VALUE) {
            sb.append("<ele>").append("" + wp.waypoint!!.elev).append("</ele>")
        }
        if (wp.name != null) {
            sb.append("<name>").append(StringUtils.escapeXml10(wp.name!!)).append("</name>")
        }
        if (type != null) {
            sb.append("<type>").append(type).append("</type>")
        }
        sb.append("</wpt>\n")
    }

    @Throws(Exception::class)
    public override fun read(filename: String): OsmTrack? {
        val f = File(filename)
        if (!f.exists()) {
            return null
        }
        val track = OsmTrack()
        val br = BufferedReader(InputStreamReader(FileInputStream(f)))

        while (true) {
            val line = br.readLine()
            if (line == null) break

            var idx0 = line.indexOf("<trkpt ")
            if (idx0 >= 0) {
                idx0 = line.indexOf(" lon=\"")
                idx0 += 6
                val idx1 = line.indexOf('"', idx0)
                val ilon = ((line.substring(idx0, idx1).toDouble() + 180.0) * 1000000.0 + 0.5).toInt()
                var idx2 = line.indexOf(" lat=\"")
                if (idx2 < 0) {
                    continue
                }
                idx2 += 6
                val idx3 = line.indexOf('"', idx2)
                val ilat = ((line.substring(idx2, idx3).toDouble() + 90.0) * 1000000.0 + 0.5).toInt()
                track.nodes.add(create(ilon, ilat, 0.toShort(), null))
            }
        }
        br.close()
        return track
    }

    companion object {
        fun getWaypoint(ilon: Int, ilat: Int, name: String?, desc: String?): String {
            return "<wpt lon=\"" + formatILon(ilon) + "\" lat=\"" + formatILat(ilat) + "\"><name>" + name + "</name>" + (if (desc != null) "<desc>" + desc + "</desc>" else "") + "</wpt>"
        }
    }
}
