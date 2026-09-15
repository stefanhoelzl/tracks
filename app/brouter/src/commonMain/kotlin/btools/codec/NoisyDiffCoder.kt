package btools.codec

/**
 * Encoder/Decoder for signed integers that automatically detects the typical
 * range of these numbers to determine a noisy-bit count as a very simple
 * dictionary
 * 
 * 
 * Adapted for 3-pass encoding (counters -&gt; statistics -&gt; encoding )
 * but doesn't do anything at pass1
 */
class NoisyDiffCoder {
    private var tot = 0
    private var freqs: IntArray? = null
    private var noisybits = 0
    private var bc: StatCoderContext? = null
    private var pass = 0

    /**
     * Create a decoder and read the noisy-bit count from the gibe context
     */
    constructor(bc: StatCoderContext) {
        noisybits = bc.decodeVarBits()
        this.bc = bc
    }

    /**
     * Create an encoder for 3-pass-encoding
     */
    constructor()

    /**
     * encodes a signed int (pass3 only, stats collection in pass2)
     */
    fun encodeSignedValue(value: Int) {
        if (pass == 3) {
            bc!!.encodeNoisyDiff(value, noisybits)
        } else if (pass == 2) {
            count(if (value < 0) -value else value)
        }
    }

    /**
     * decodes a signed int
     */
    fun decodeSignedValue(): Int {
        return bc!!.decodeNoisyDiff(noisybits)
    }

    /**
     * Starts a new encoding pass and (in pass3) calculates the noisy-bit count
     * from the stats collected in pass2 and writes that to the given context
     */
    fun encodeDictionary(bc: StatCoderContext) {
        if (++pass == 3) {
            // how many noisy bits?
            noisybits = 0
            while (noisybits < 14 && tot > 0) {
                if (freqs!![noisybits] < (tot shr 1)) break
                noisybits++
            }
            bc.encodeVarBits(noisybits)
        }
        this.bc = bc
    }

    private fun count(value: Int) {
        if (freqs == null) freqs = IntArray(14)
        var bm = 1
        for (i in 0..13) {
            if (value < bm) break
            else freqs!![i] = freqs!![i] + 1
            bm = bm shl 1
        }
        tot++
    }
}
