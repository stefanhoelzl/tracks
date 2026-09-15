package btools.util

/**
 * a median filter with additional edge reduction
 */
class ReducedMedianFilter(size: Int) {
    private var nsamples = 0
    private val weights: DoubleArray
    private val values: IntArray

    init {
        weights = DoubleArray(size)
        values = IntArray(size)
    }

    fun reset() {
        nsamples = 0
    }

    fun addSample(weight: Double, value: Int) {
        if (weight > 0.0) {
            for (i in 0..<nsamples) {
                if (values[i] == value) {
                    weights[i] += weight
                    return
                }
            }
            weights[nsamples] = weight
            values[nsamples] = value
            nsamples++
        }
    }

    fun calcEdgeReducedMedian(fraction: Double): Double {
        removeEdgeWeight((1.0 - fraction) / 2.0, true)
        removeEdgeWeight((1.0 - fraction) / 2.0, false)

        var totalWeight = 0.0
        var totalValue = 0.0
        for (i in 0..<nsamples) {
            val w = weights[i]
            totalWeight += w
            totalValue += w * values[i]
        }
        return totalValue / totalWeight
    }


    private fun removeEdgeWeight(excessWeight: Double, high: Boolean) {
        var excessWeight = excessWeight
        while (excessWeight > 0.0) {
            // first pass to find minmax value
            var totalWeight = 0.0
            var minmax = 0
            for (i in 0..<nsamples) {
                val w = weights[i]
                if (w > 0.0) {
                    val v = values[i]
                    if (totalWeight == 0.0 || (if (high) v > minmax else v < minmax)) {
                        minmax = v
                    }
                    totalWeight += w
                }
            }

            require(!(totalWeight < excessWeight)) { "ups, not enough weight to remove" }

            // second pass to remove
            for (i in 0..<nsamples) {
                if (values[i] == minmax && weights[i] > 0.0) {
                    if (excessWeight > weights[i]) {
                        excessWeight -= weights[i]
                        weights[i] = 0.0
                    } else {
                        weights[i] -= excessWeight
                        excessWeight = 0.0
                    }
                }
            }
        }
    }
}
