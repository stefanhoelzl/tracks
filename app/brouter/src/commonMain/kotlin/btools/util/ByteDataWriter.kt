/**
 * fast data-writing to a byte-array
 * 
 * @author ab
 */
package btools.util
import btools.kmp.System


open class ByteDataWriter(byteArray: ByteArray?) : ByteDataReader(byteArray) {
    fun writeInt(v: Int) {
        ab!![aboffset++] = ((v shr 24) and 0xff).toByte()
        ab!![aboffset++] = ((v shr 16) and 0xff).toByte()
        ab!![aboffset++] = ((v shr 8) and 0xff).toByte()
        ab!![aboffset++] = ((v) and 0xff).toByte()
    }

    fun writeLong(v: Long) {
        ab!![aboffset++] = ((v shr 56) and 0xffL).toByte()
        ab!![aboffset++] = ((v shr 48) and 0xffL).toByte()
        ab!![aboffset++] = ((v shr 40) and 0xffL).toByte()
        ab!![aboffset++] = ((v shr 32) and 0xffL).toByte()
        ab!![aboffset++] = ((v shr 24) and 0xffL).toByte()
        ab!![aboffset++] = ((v shr 16) and 0xffL).toByte()
        ab!![aboffset++] = ((v shr 8) and 0xffL).toByte()
        ab!![aboffset++] = ((v) and 0xffL).toByte()
    }

    fun writeBoolean(v: Boolean) {
        ab!![aboffset++] = (if (v) 1 else 0).toByte()
    }

    fun writeByte(v: Int) {
        ab!![aboffset++] = ((v) and 0xff).toByte()
    }

    fun writeShort(v: Int) {
        ab!![aboffset++] = ((v shr 8) and 0xff).toByte()
        ab!![aboffset++] = ((v) and 0xff).toByte()
    }

    fun write(sa: ByteArray) {
        System.arraycopy(sa, 0, ab, aboffset, sa.size)
        aboffset += sa.size
    }

    fun write(sa: ByteArray, offset: Int, len: Int) {
        System.arraycopy(sa, offset, ab, aboffset, len)
        aboffset += len
    }

    fun writeVarBytes(sa: ByteArray?) {
        if (sa == null) {
            writeVarLengthUnsigned(0)
        } else {
            val len = sa.size
            writeVarLengthUnsigned(len)
            write(sa, 0, len)
        }
    }

    fun writeModeAndDesc(isReverse: Boolean, sa: ByteArray?) {
        val len = if (sa == null) 0 else sa.size
        val sizecode = len shl 1 or (if (isReverse) 1 else 0)
        writeVarLengthUnsigned(sizecode)
        if (len > 0) {
            write(sa!!, 0, len)
        }
    }


    fun toByteArray(): ByteArray {
        val c = ByteArray(aboffset)
        System.arraycopy(ab, 0, c, 0, aboffset)
        return c
    }


    /**
     * Just reserves a single byte and return it' offset.
     * Used in conjunction with injectVarLengthUnsigned
     * to efficiently write a size prefix
     * 
     * @return the offset of the placeholder
     */
    fun writeSizePlaceHolder(): Int {
        return aboffset++
    }

    fun injectSize(sizeoffset: Int) {
        var size = 0
        val datasize = aboffset - sizeoffset - 1
        var v = datasize
        do {
            v = v shr 7
            size++
        } while (v != 0)
        if (size > 1) { // doesn't fit -> shift the data after the placeholder
            System.arraycopy(ab, sizeoffset + 1, ab, sizeoffset + size, datasize)
        }
        aboffset = sizeoffset
        writeVarLengthUnsigned(datasize)
        aboffset = sizeoffset + size + datasize
    }

    fun writeVarLengthSigned(v: Int) {
        writeVarLengthUnsigned(if (v < 0) ((-v) shl 1) or 1 else v shl 1)
    }

    fun writeVarLengthUnsigned(v: Int) {
        var v = v
        var i7 = v and 0x7f
        if ((7.let { v = v ushr it; v }) == 0) {
            ab!![aboffset++] = (i7).toByte()
            return
        }
        ab!![aboffset++] = (i7 or 0x80).toByte()

        i7 = v and 0x7f
        if ((7.let { v = v ushr it; v }) == 0) {
            ab!![aboffset++] = (i7).toByte()
            return
        }
        ab!![aboffset++] = (i7 or 0x80).toByte()

        i7 = v and 0x7f
        if ((7.let { v = v ushr it; v }) == 0) {
            ab!![aboffset++] = (i7).toByte()
            return
        }
        ab!![aboffset++] = (i7 or 0x80).toByte()

        i7 = v and 0x7f
        if ((7.let { v = v ushr it; v }) == 0) {
            ab!![aboffset++] = (i7).toByte()
            return
        }
        ab!![aboffset++] = (i7 or 0x80).toByte()

        ab!![aboffset++] = (v).toByte()
    }

    fun size(): Int {
        return aboffset
    }
}
