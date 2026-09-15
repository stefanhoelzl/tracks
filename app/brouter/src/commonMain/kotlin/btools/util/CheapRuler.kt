package btools.util

import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.jvm.JvmField
import kotlin.jvm.JvmStatic

object CheapRuler {
    /**
     * Cheap-Ruler Java implementation
     * See
     * https://blog.mapbox.com/fast-geodesic-approximations-with-cheap-ruler-106f229ad016
     * for more details.
     * 
     * 
     * Original code is at https://github.com/mapbox/cheap-ruler under ISC license.
     * 
     * 
     * This is implemented as a Singleton to have a unique cache for the cosine
     * values across all the code.
     */
    // Conversion constants
    const val ILATLNG_TO_LATLNG: Double = 1e-6 // From integer to degrees
    const val KILOMETERS_TO_METERS: Int = 1000
    @JvmField
    val DEG_TO_RAD: Double = kotlin.math.PI / 180.0

    // Scale cache constants
    private const val SCALE_CACHE_LENGTH = 1800
    private const val SCALE_CACHE_INCREMENT = 100000

    // SCALE_CACHE_LENGTH cached values between 0 and COS_CACHE_MAX_DEGREES degrees.
    private val SCALE_CACHE: Array<DoubleArray> = (arrayOfNulls<DoubleArray>(SCALE_CACHE_LENGTH) as Array<DoubleArray>)

    /**
     * build the cache of cosine values.
     */
    init {
        for (i in 0..<SCALE_CACHE_LENGTH) {
            SCALE_CACHE[i] = calcKxKyFromILat(i * SCALE_CACHE_INCREMENT + SCALE_CACHE_INCREMENT / 2)
        }
    }

    private fun calcKxKyFromILat(ilat: Int): DoubleArray {
        val lat = DEG_TO_RAD * (ilat * ILATLNG_TO_LATLNG - 90)
        val cos = cos(lat)
        val cos2 = 2 * cos * cos - 1
        val cos3 = 2 * cos * cos2 - cos
        val cos4 = 2 * cos * cos3 - cos2
        val cos5 = 2 * cos * cos4 - cos3

        // Multipliers for converting integer longitude and latitude into distance
        // (http://1.usa.gov/1Wb1bv7)
        val kxky = DoubleArray(2)
        kxky[0] = (111.41513 * cos - 0.09455 * cos3 + 0.00012 * cos5) * ILATLNG_TO_LATLNG * KILOMETERS_TO_METERS
        kxky[1] = (111.13209 - 0.56605 * cos2 + 0.0012 * cos4) * ILATLNG_TO_LATLNG * KILOMETERS_TO_METERS
        return kxky
    }

    /**
     * Calculate the degree-&gt;meter scale for given latitude
     * 
     * @return [lon-&gt;meter,lat-&gt;meter]
     */
    @JvmStatic
    fun getLonLatToMeterScales(ilat: Int): DoubleArray {
        return SCALE_CACHE[ilat / SCALE_CACHE_INCREMENT]
    }

    /**
     * Compute the distance (in meters) between two points represented by their
     * (integer) latitude and longitude.
     * 
     * @param ilon1 Integer longitude for the start point. this is (longitude in degrees + 180) * 1e6.
     * @param ilat1 Integer latitude for the start point, this is (latitude + 90) * 1e6.
     * @param ilon2 Integer longitude for the end point, this is (longitude + 180) * 1e6.
     * @param ilat2 Integer latitude for the end point, this is (latitude + 90) * 1e6.
     * @return The distance between the two points, in meters.
     * 
     * 
     * Note:
     * Integer longitude is ((longitude in degrees) + 180) * 1e6.
     * Integer latitude is ((latitude in degrees) + 90) * 1e6.
     */
    @JvmStatic
    fun distance(ilon1: Int, ilat1: Int, ilon2: Int, ilat2: Int): Double {
        val kxky = getLonLatToMeterScales((ilat1 + ilat2) shr 1)
        val dlon = (ilon1 - ilon2) * kxky[0]
        val dlat = (ilat1 - ilat2) * kxky[1]
        return sqrt(dlat * dlat + dlon * dlon) // in m
    }

    @JvmStatic
    fun destination(lon1: Int, lat1: Int, distance: Double, angle: Double): IntArray {
        var angle = angle
        val lonlat2m = getLonLatToMeterScales(lat1)
        val lon2m = lonlat2m[0]
        val lat2m = lonlat2m[1]
        angle = 90.0 - angle
        val st = sin(angle * kotlin.math.PI / 180.0)
        val ct = cos(angle * kotlin.math.PI / 180.0)

        val lon2 = (0.5 + lon1 + ct * distance / lon2m).toInt()
        val lat2 = (0.5 + lat1 + st * distance / lat2m).toInt()
        val ret = IntArray(2)
        ret[0] = lon2
        ret[1] = lat2
        return ret
    }
}
