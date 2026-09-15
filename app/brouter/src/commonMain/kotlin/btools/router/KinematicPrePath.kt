/**
 * Simple version of OsmPath just to get angle and priority of first segment
 * 
 * @author ab
 */
package btools.router
import kotlin.jvm.JvmField

internal class KinematicPrePath : OsmPrePath() {
    @JvmField
    var angle: Double = 0.0
    @JvmField
    var priorityclassifier: Int = 0
    @JvmField
    var classifiermask: Int = 0

    override fun initPrePath(origin: OsmPath, rc: RoutingContext) {
        var description = link!!.descriptionBitmap
        if (description == null) {
            //throw new IllegalArgumentException("null description for: " + link);
            description =
                (if (targetNode!!.descriptionBitmap != null) targetNode!!.descriptionBitmap else byteArrayOf(0, 1, 0))
        }

        // extract the 3 positions of the first section
        val lon0 = origin.originLon
        val lat0 = origin.originLat

        val p1 = sourceNode
        val lon1 = p1!!.iLon
        val lat1 = p1.iLat

        val isReverse = link!!.isReverse(sourceNode)

        // evaluate the way tags
        rc.expctxWay.evaluate(rc.inverseDirection xor isReverse, description!!)

        val transferNode = if (link!!.geometry == null)
            null
        else
            rc.geometryDecoder.decodeGeometry(link!!.geometry, p1, targetNode!!, isReverse)

        val lon2: Int
        val lat2: Int

        if (transferNode == null) {
            lon2 = targetNode!!.iLon
            lat2 = targetNode!!.iLat
        } else {
            lon2 = transferNode.ilon
            lat2 = transferNode.ilat
        }

        val dist = rc.calcDistance(lon1, lat1, lon2, lat2)

        angle = rc.anglemeter.calcAngle(lon0, lat0, lon1, lat1, lon2, lat2)
        priorityclassifier = rc.expctxWay.priorityClassifier.toInt()
        classifiermask = rc.expctxWay.classifierMask.toInt()
    }
}
