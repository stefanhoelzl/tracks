package btools.codec

import btools.util.BitCoderContext
import kotlin.jvm.JvmField
import kotlin.jvm.JvmOverloads

/**
 * Container for some re-usable databuffers for the decoder
 */
class DataBuffers
/**
 * construct a set of databuffers except
 * for 'iobuffer', where the given array is used
 */ @JvmOverloads constructor(@JvmField var iobuffer: ByteArray = ByteArray(65636)) {
    @JvmField
    var tagbuf1: ByteArray = ByteArray(256)
    @JvmField
    var bctx1: BitCoderContext = BitCoderContext(tagbuf1)
    @JvmField
    var bbuf1: ByteArray = ByteArray(65636)
    @JvmField
    var ibuf1: IntArray = IntArray(4096)
    @JvmField
    var ibuf2: IntArray = IntArray(2048)
    @JvmField
    var ibuf3: IntArray = IntArray(2048)
    @JvmField
    var alon: IntArray = IntArray(2048)
    @JvmField
    var alat: IntArray = IntArray(2048)
}
