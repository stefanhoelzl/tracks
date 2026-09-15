package btools.mapaccess

import btools.codec.*
import btools.util.ByteDataWriter
import btools.kmp.System

/**
 * DirectWeaver does the same decoding as MicroCache2, but decodes directly
 * into the instance-graph, not into the intermediate nodes-cache
 */
class DirectWeaver(
    bc: StatCoderContext,
    dataBuffers: DataBuffers,
    lonIdx: Int,
    latIdx: Int,
    divisor: Int,
    wayValidator: TagValueValidator,
    waypointMatcher: WaypointMatcher?,
    hollowNodes: OsmNodesMap
) : ByteDataWriter(null) {
    private val id64Base: Long

    init {
        val cellsize = 1000000 / divisor
        id64Base = ((lonIdx * cellsize).toLong()) shl 32 or (latIdx * cellsize).toLong()

        val wayTagCoder = TagValueCoder(bc, dataBuffers, wayValidator)
        val nodeTagCoder = TagValueCoder(bc, dataBuffers, null)
        val nodeIdxDiff = NoisyDiffCoder(bc)
        val nodeEleDiff = NoisyDiffCoder(bc)
        val extLonDiff = NoisyDiffCoder(bc)
        val extLatDiff = NoisyDiffCoder(bc)
        val transEleDiff = NoisyDiffCoder(bc)

        val size = bc.decodeNoisyNumber(5)

        val faid = if (size > dataBuffers.ibuf2.size) IntArray(size) else dataBuffers.ibuf2

        bc.decodeSortedArray(faid, 0, size, 29, 0)

        val nodes: Array<OsmNode> = (arrayOfNulls<OsmNode>(size) as Array<OsmNode>)
        for (n in 0..<size) {
            val id = expandId(faid[n])
            val ilon = (id shr 32).toInt()
            val ilat = (id and 0xffffffffL).toInt()
            var node = hollowNodes.get(ilon, ilat)
            if (node == null) {
                node = OsmNode(ilon, ilat)
            } else {
                node.visitID = 1
                hollowNodes.remove(node)
            }
            nodes[n] = node
        }

        val netdatasize = bc.decodeNoisyNumber(10) // (not needed for direct weaving)
        ab = dataBuffers.bbuf1
        aboffset = 0

        var selev = 0
        for (n in 0..<size) { // loop over nodes
            val node = nodes[n]
            val ilon = node.iLon
            val ilat = node.iLat

            // future escapes (turn restrictions?)
            var trExceptions: Short = 0
            while (true) {
                val featureId = bc.decodeVarBits()
                if (featureId == 0) break
                val bitsize = bc.decodeNoisyNumber(5)

                if (featureId == 2) { // exceptions to turn-restriction
                    trExceptions = bc.decodeBounded(1023).toShort()
                } else if (featureId == 1) { // turn-restriction
                    val tr = TurnRestriction()
                    tr.exceptions = trExceptions
                    trExceptions = 0
                    tr.isPositive = bc.decodeBit()
                    tr.fromLon = ilon + bc.decodeNoisyDiff(10)
                    tr.fromLat = ilat + bc.decodeNoisyDiff(10)
                    tr.toLon = ilon + bc.decodeNoisyDiff(10)
                    tr.toLat = ilat + bc.decodeNoisyDiff(10)
                    node.addTurnRestriction(tr)
                } else {
                    for (i in 0..<bitsize) bc.decodeBit() // unknown feature, just skip
                }
            }

            selev += nodeEleDiff.decodeSignedValue()
            node.sElev = selev.toShort()
            val nodeTags = nodeTagCoder.decodeTagValueSet()
            node.nodeDescription = if (nodeTags == null) null else nodeTags.data // TODO: unified?

            val links = bc.decodeNoisyNumber(1)
            for (li in 0..<links) {
                val nodeIdx = n + nodeIdxDiff.decodeSignedValue()

                var dlon_remaining: Int
                var dlat_remaining: Int

                var isReverse = false
                if (nodeIdx != n) { // internal (forward-) link
                    dlon_remaining = nodes[nodeIdx].iLon - ilon
                    dlat_remaining = nodes[nodeIdx].iLat - ilat
                } else {
                    isReverse = bc.decodeBit()
                    dlon_remaining = extLonDiff.decodeSignedValue()
                    dlat_remaining = extLatDiff.decodeSignedValue()
                }

                val wayTags = wayTagCoder.decodeTagValueSet()

                val linklon = ilon + dlon_remaining
                val linklat = ilat + dlat_remaining
                aboffset = 0
                if (!isReverse) { // write geometry for forward links only
                    var matcher = if (wayTags == null || wayTags.accessType < 2) null else waypointMatcher
                    val ilontarget = ilon + dlon_remaining
                    val ilattarget = ilat + dlat_remaining
                    if (matcher != null) {
                        val useAsStartWay = wayTags == null || wayValidator.checkStartWay(wayTags.data)
                        if (!matcher.start(ilon, ilat, ilontarget, ilattarget, useAsStartWay)) {
                            matcher = null
                        }
                    }

                    val transcount = bc.decodeVarBits()
                    var count = transcount + 1
                    for (i in 0..<transcount) {
                        val dlon = bc.decodePredictedValue(dlon_remaining / count)
                        val dlat = bc.decodePredictedValue(dlat_remaining / count)
                        dlon_remaining -= dlon
                        dlat_remaining -= dlat
                        count--
                        val elediff = transEleDiff.decodeSignedValue()
                        if (wayTags != null) {
                            writeVarLengthSigned(dlon)
                            writeVarLengthSigned(dlat)
                            writeVarLengthSigned(elediff)
                        }

                        if (matcher != null) matcher.transferNode(
                            ilontarget - dlon_remaining,
                            ilattarget - dlat_remaining
                        )
                    }
                    if (matcher != null) matcher.end()
                }

                if (wayTags != null) {
                    var geometry: ByteArray? = null
                    if (aboffset > 0) {
                        geometry = ByteArray(aboffset)
                        System.arraycopy(ab, 0, geometry, 0, aboffset)
                    }

                    if (nodeIdx != n) { // valid internal (forward-) link
                        val node2 = nodes[nodeIdx]
                        var link: OsmLink? = if (node.isLinkUnused) node else (if (node2.isLinkUnused) node2 else null)
                        if (link == null) {
                            link = OsmLink()
                        }
                        link.descriptionBitmap = wayTags.data
                        link.geometry = geometry
                        node.addLink(link, isReverse, node2)
                    } else { // weave external link
                        node.addLink(linklon, linklat, wayTags.data, geometry, hollowNodes, isReverse)
                        node.visitID = 1
                    }
                }
            } // ... loop over links
        } // ... loop over nodes


        hollowNodes.cleanupAndCount(nodes)
    }

    fun expandId(id32: Int): Long {
        return id64Base + id32_00[id32 and 1023] + id32_10[(id32 shr 10) and 1023] + id32_20[(id32 shr 20) and 1023]
    }

    companion object {
        private val id32_00 = LongArray(1024)
        private val id32_10 = LongArray(1024)
        private val id32_20 = LongArray(1024)

        init {
            for (i in 0..1023) {
                id32_00[i] = _expandId(i)
                id32_10[i] = _expandId(i shl 10)
                id32_20[i] = _expandId(i shl 20)
            }
        }

        private fun _expandId(id32: Int): Long {
            var id32 = id32
            var dlon = 0
            var dlat = 0

            var bm = 1
            while (bm < 0x8000) {
                if ((id32 and 1) != 0) dlon = dlon or bm
                if ((id32 and 2) != 0) dlat = dlat or bm
                id32 = id32 shr 2
                bm = bm shl 1
            }
            return (dlon.toLong()) shl 32 or dlat.toLong()
        }
    }
}
