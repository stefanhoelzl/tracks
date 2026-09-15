package btools.router

import btools.mapaccess.MatchedWaypoint
import btools.kmp.io.UnsupportedEncodingException
import btools.kmp.net.URLDecoder
import btools.kmp.util.*
import btools.kmp.System

class RoutingParamCollector {
    /**
     * get a list of points and optional extra info for the points
     * 
     * @param lonLats  linked list separated by ';' or '|'
     * @return         a list
     */
    fun getWayPointList(lonLats: String): MutableList<OsmNodeNamed> {
        requireNotNull(lonLats) { "lonlats parameter not set" }

        val coords =
            lonLats.split(";|\\|".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray() // use both variantes
        require(!(coords.size < 1 || !coords[0].contains(","))) { "we need one lat/lon point at least!" }

        val wplist: MutableList<OsmNodeNamed> = ArrayList<OsmNodeNamed>()
        for (i in coords.indices) {
            val lonLat = coords[i].split(",".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
            require(lonLat.size >= 1) { "we need one lat/lon point at least!" }
            wplist.add(readPosition(lonLat[0], lonLat[1], "via" + i))
            if (lonLat.size > 2) {
                if (lonLat[2] == "d") {
                    wplist.get(wplist.size - 1)!!.wpttype = MatchedWaypoint.WAYPOINT_TYPE_DIRECT
                } else if (lonLat[2] == "m") {
                    wplist.get(wplist.size - 1)!!.wpttype = MatchedWaypoint.WAYPOINT_TYPE_MEETING
                } else {
                    wplist.get(wplist.size - 1)!!.name = lonLat[2]
                    wplist.get(wplist.size - 1)!!.wpttype = MatchedWaypoint.WAYPOINT_TYPE_MEETING
                }
            }
        }

        if (wplist.get(0)!!.name!!.startsWith("via")) wplist.get(0)!!.name = "from"
        if (wplist.get(wplist.size - 1)!!.name!!.startsWith("via")) {
            wplist.get(wplist.size - 1)!!.name = "to"
        }

        return wplist
    }

    /**
     * get a list of points (old style, positions only)
     * 
     * @param lons  array with longitudes
     * @param lats  array with latitudes
     * @return      a list
     */
    fun readPositions(lons: DoubleArray?, lats: DoubleArray?): MutableList<OsmNodeNamed> {
        val wplist: MutableList<OsmNodeNamed> = ArrayList<OsmNodeNamed>()

        if (lats == null || lats.size < 2 || lons == null || lons.size < 2) {
            return wplist
        }

        var i = 0
        while (i < lats.size && i < lons.size) {
            val n = OsmNodeNamed()
            n.name = "via" + i
            n.iLon = ((lons[i] + 180.0) * 1000000.0 + 0.5).toInt()
            n.iLat = ((lats[i] + 90.0) * 1000000.0 + 0.5).toInt()
            wplist.add(n)
            i++
        }

        if (wplist.get(0)!!.name!!.startsWith("via")) wplist.get(0)!!.name = "from"
        if (wplist.get(wplist.size - 1)!!.name!!.startsWith("via")) {
            wplist.get(wplist.size - 1)!!.name = "to"
        }

        return wplist
    }

    private fun readPosition(vlon: String, vlat: String, name: String?): OsmNodeNamed {
        requireNotNull(vlon) { "lon " + name + " not found in input" }
        requireNotNull(vlat) { "lat " + name + " not found in input" }

        return readPosition(vlon.toDouble(), vlat.toDouble(), name)
    }

    private fun readPosition(lon: Double, lat: Double, name: String?): OsmNodeNamed {
        val n = OsmNodeNamed()
        n.name = name
        n.iLon = ((lon + 180.0) * 1000000.0 + 0.5).toInt()
        n.iLat = ((lat + 90.0) * 1000000.0 + 0.5).toInt()
        return n
    }

    /**
     * read a url like parameter list linked with '&'
     * 
     * @param url  parameter list
     * @return     a hashmap of the parameter
     * @throws     UnsupportedEncodingException
     */
    @Throws(UnsupportedEncodingException::class)
    fun getUrlParams(url: String): MutableMap<String?, String?> {
        val params: MutableMap<String?, String?> = HashMap<String?, String?>()
        val decoded = URLDecoder.decode(url, "UTF-8")
        val tk = StringTokenizer(decoded, "?&")
        while (tk.hasMoreTokens()) {
            val t = tk.nextToken()
            val tk2 = StringTokenizer(t, "=")
            if (tk2.hasMoreTokens()) {
                val key = tk2.nextToken()
                if (tk2.hasMoreTokens()) {
                    val value = tk2.nextToken()
                    params.put(key, value)
                }
            }
        }
        return params
    }

    /**
     * fill a parameter map into the routing context
     * 
     * @param rctx    the context
     * @param wplist  the list of way points needed for 'straight' parameter
     * @param params  the list of parameters
     */
    fun setParams(rctx: RoutingContext, wplist: MutableList<OsmNodeNamed>, params: MutableMap<String?, String?>?) {
        if (params != null) {
            if (params.size == 0) return

            // prepare nogos extra
            if (params.containsKey("profile")) {
                rctx.localFunction = params.get("profile")
            }
            if (params.containsKey("nogoLats") && params.get("nogoLats")!!.length > 0) {
                val nogoList = readNogos(params.get("nogoLons"), params.get("nogoLats"), params.get("nogoRadi"))
                if (nogoList != null) {
                    RoutingContext.prepareNogoPoints(nogoList)
                    if (rctx.nogopoints == null) {
                        rctx.nogopoints = nogoList
                    } else {
                        rctx.nogopoints!!.addAll(nogoList)
                    }
                }
                params.remove("nogoLats")
                params.remove("nogoLons")
                params.remove("nogoRadi")
            }
            if (params.containsKey("nogos")) {
                val nogoList = readNogoList(params.get("nogos"))
                if (nogoList != null) {
                    RoutingContext.prepareNogoPoints(nogoList)
                    if (rctx.nogopoints == null) {
                        rctx.nogopoints = nogoList
                    } else {
                        rctx.nogopoints!!.addAll(nogoList)
                    }
                }
                params.remove("nogos")
            }
            if (params.containsKey("polylines")) {
                val result: MutableList<OsmNodeNamed> = ArrayList<OsmNodeNamed>()
                parseNogoPolygons(params.get("polylines"), result, false)
                if (rctx.nogopoints == null) {
                    rctx.nogopoints = result
                } else {
                    rctx.nogopoints!!.addAll(result)
                }
                params.remove("polylines")
            }
            if (params.containsKey("polygons")) {
                val result: MutableList<OsmNodeNamed> = ArrayList<OsmNodeNamed>()
                parseNogoPolygons(params.get("polygons"), result, true)
                if (rctx.nogopoints == null) {
                    rctx.nogopoints = result
                } else {
                    rctx.nogopoints!!.addAll(result)
                }
                params.remove("polygons")
            }

            for (e in params.entries) {
                val key: String = e.key!!
                val value: String = e.value!!
                if (DEBUG) println("params " + key + " " + value)

                if (key == "straight") {
                    try {
                        val sa = value.split(",".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                        for (i in sa.indices) {
                            val v = sa[i].toInt()
                            if (wplist.size > v) wplist.get(v)!!.wpttype = MatchedWaypoint.WAYPOINT_TYPE_DIRECT
                        }
                    } catch (ex: Exception) {
                        System.err.println("error " + ex.stackTraceToString())
                    }
                } else if (key == "pois") {
                    rctx.poipoints = readPoisList(value)
                } else if (key == "heading") {
                    rctx.startDirection = value.toInt()
                    rctx.forceUseStartDirection = true
                } else if (key == "direction") {
                    rctx.startDirection = value.toInt()
                } else if (key == "roundTripDistance") {
                    rctx.roundTripDistance = value.toInt()
                } else if (key == "roundTripDirectionAdd") {
                    rctx.roundTripDirectionAdd = value.toInt()
                } else if (key == "roundTripPoints") {
                    rctx.roundTripPoints = value.toInt()
                    if (rctx.roundTripPoints == null || rctx.roundTripPoints!! < 3 || rctx.roundTripPoints!! > 20) {
                        rctx.roundTripPoints = 5
                    }
                } else if (key == "allowSamewayback") {
                    rctx.allowSamewayback = value.toInt() == 1
                } else if (key == "alternativeidx") {
                    rctx.setAlternativeIdx(value.toInt())
                } else if (key == "turnInstructionMode") {
                    rctx.turnInstructionMode = value.toInt()
                } else if (key == "timode") {
                    rctx.turnInstructionMode = value.toInt()
                } else if (key == "turnInstructionFormat") {
                    if ("osmand".equals(value, ignoreCase = true)) {
                        rctx.turnInstructionMode = 3
                    } else if ("locus".equals(value, ignoreCase = true)) {
                        rctx.turnInstructionMode = 2
                    }
                } else if (key == "exportWaypoints") {
                    rctx.exportWaypoints = (value.toInt() == 1)
                } else if (key == "exportCorrectedWaypoints") {
                    rctx.exportCorrectedWaypoints = (value.toInt() == 1)
                } else if (key == "format") {
                    rctx.outputFormat = value.lowercase()
                } else if (key == "trackFormat") {
                    rctx.outputFormat = value.lowercase()
                } else if (key.startsWith("profile:")) {
                    if (rctx.keyValues == null) rctx.keyValues = HashMap<String?, String?>()
                    rctx.keyValues!!.put(key.substring(8), value)
                }
                // ignore other params
            }
        }
    }

    /**
     * fill profile parameter list
     * 
     * @param rctx    the routing context
     * @param params  the list of parameters
     */
    fun setProfileParams(rctx: RoutingContext, params: MutableMap<String?, String?>?) {
        if (params != null) {
            if (params.size == 0) return
            if (rctx.keyValues == null) rctx.keyValues = HashMap<String?, String?>()
            for (e in params.entries) {
                val key = e.key
                val value = e.value
                if (DEBUG) println("params " + key + " " + value)
                rctx.keyValues!!.put(key, value)
            }
        }
    }

    private fun parseNogoPolygons(polygons: String?, result: MutableList<OsmNodeNamed>, closed: Boolean) {
        if (polygons != null) {
            val polygonList = polygons.split("\\|".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
            for (i in polygonList.indices) {
                val lonLatList = polygonList[i].split(",".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                if (lonLatList.size > 1) {
                    val polygon = OsmNogoPolygon(closed)
                    var j: Int
                    j = 0
                    while (j < 2 * (lonLatList.size / 2) - 1) {
                        val slon = lonLatList[j++]
                        val slat = lonLatList[j++]
                        val lon = ((slon.toDouble() + 180.0) * 1000000.0 + 0.5).toInt()
                        val lat = ((slat.toDouble() + 90.0) * 1000000.0 + 0.5).toInt()
                        polygon.addVertex(lon, lat)
                    }

                    var nogoWeight = "NaN"
                    if (j < lonLatList.size) {
                        nogoWeight = lonLatList[j]
                    }
                    polygon.nogoWeight = nogoWeight.toDouble()
                    if (polygon.points.size > 0) {
                        polygon.calcBoundingCircle()
                        result.add(polygon)
                    }
                }
            }
        }
    }

    fun readPoisList(pois: String?): MutableList<OsmNodeNamed>? {
        // lon,lat,name|...
        if (pois == null) return null

        val lonLatNameList = pois.split("\\|".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()

        val poisList: MutableList<OsmNodeNamed> = ArrayList<OsmNodeNamed>()
        for (i in lonLatNameList.indices) {
            val lonLatName = lonLatNameList[i].split(",".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()

            if (lonLatName.size != 3) continue

            val n = OsmNodeNamed()
            n.iLon = ((lonLatName[0].toDouble() + 180.0) * 1000000.0 + 0.5).toInt()
            n.iLat = ((lonLatName[1].toDouble() + 90.0) * 1000000.0 + 0.5).toInt()
            n.name = lonLatName[2]
            poisList.add(n)
        }

        return poisList
    }

    fun readNogoList(nogos: String?): MutableList<OsmNodeNamed>? {
        // lon,lat,radius[,weight]|...

        if (nogos == null) return null

        val lonLatRadList = nogos.split("\\|".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()

        val nogoList: MutableList<OsmNodeNamed> = ArrayList<OsmNodeNamed>()
        for (i in lonLatRadList.indices) {
            val lonLatRad = lonLatRadList[i].split(",".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
            var nogoWeight = "NaN"
            if (lonLatRad.size > 3) {
                nogoWeight = lonLatRad[3]
            }
            nogoList.add(readNogo(lonLatRad[0], lonLatRad[1], lonLatRad[2], nogoWeight))
        }

        return nogoList
    }

    fun readNogos(nogoLons: String?, nogoLats: String?, nogoRadi: String?): MutableList<OsmNodeNamed>? {
        if (nogoLons == null || nogoLats == null || nogoRadi == null) return null
        val nogoList: MutableList<OsmNodeNamed> = ArrayList<OsmNodeNamed>()

        val lons = nogoLons.split(",".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
        val lats = nogoLats.split(",".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
        val radi = nogoRadi.split(",".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
        val nogoWeight = "undefined"
        var i = 0
        while (i < lons.size && i < lats.size && i < radi.size) {
            val n =
                readNogo(lons[i].trim { it <= ' ' }, lats[i].trim { it <= ' ' }, radi[i].trim { it <= ' ' }, nogoWeight)
            nogoList.add(n)
            i++
        }
        return nogoList
    }


    private fun readNogo(lon: String, lat: String, radius: String, nogoWeight: String): OsmNodeNamed {
        val weight = if ("undefined" == nogoWeight) Double.NaN else nogoWeight.toDouble()
        return readNogo(lon.toDouble(), lat.toDouble(), radius.toDouble().toInt(), weight)
    }

    private fun readNogo(lon: Double, lat: Double, radius: Int, nogoWeight: Double): OsmNodeNamed {
        val n = OsmNodeNamed()
        n.name = "nogo" + radius
        n.iLon = ((lon + 180.0) * 1000000.0 + 0.5).toInt()
        n.iLat = ((lat + 90.0) * 1000000.0 + 0.5).toInt()
        n.isNogo = true
        n.nogoWeight = nogoWeight
        return n
    }


    companion object {
        const val DEBUG: Boolean = false
    }
}
