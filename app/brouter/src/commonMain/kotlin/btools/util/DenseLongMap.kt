package btools.util
import btools.kmp.System
import kotlin.jvm.JvmOverloads

/**
 * Special Memory efficient Map to map a long-key to
 * a "small" value (some bits only) where it is expected
 * that the keys are dense, so that we can use more or less
 * a simple array as the best-fit data model (except for
 * the 32-bit limit of arrays!)
 * 
 * 
 * Target application are osm-node ids which are in the
 * range 0...3 billion and basically dense (=only few
 * nodes deleted)
 * 
 * @author ab
 */
open class DenseLongMap @JvmOverloads constructor(blocksize: Int = 512) {
    private val blocklist: MutableList<ByteArray?> = ArrayList<ByteArray?>(4096)

    private val blocksize: Int // bytes per bitplane in one block
    private val blocksizeBits: Int
    private val blocksizeBitsMask: Long
    private val maxvalue = 254 // fixed due to 8 bit lookup table
    private val bitplaneCount = IntArray(8)
    private var putCount = 0L
    private var getCount = 0L

    /**
     * Creates a DenseLongMap for the given block size
     * 
     * @param blocksize bytes per bit-plane
     */
    /**
     * Creates a DenseLongMap for the default block size
     * ( 512 bytes per bitplane, covering a key range of 4096 keys )
     * Note that one value range is limited to 0..254
     */
    init {
        var bits = 4
        while (bits < 28 && (1 shl bits) != blocksize) {
            bits++
        }
        if (bits == 28) {
            throw RuntimeException("not a valid blocksize: " + blocksize + " ( expected 1 << bits with bits in (4..27) )")
        }
        blocksizeBits = bits + 3
        blocksizeBitsMask = (1L shl blocksizeBits) - 1
        this.blocksize = blocksize
    }

    open fun put(key: Long, value: Int) {
        putCount++

        require(!(value < 0 || value > maxvalue)) { "value out of range (0.." + maxvalue + "): " + value }

        val blockn = (key shr blocksizeBits).toInt()
        val offset = (key and blocksizeBitsMask).toInt()

        var block = if (blockn < blocklist.size) blocklist.get(blockn) else null

        var valuebits = 1
        if (block == null) {
            block = ByteArray(sizeForBits(valuebits))
            bitplaneCount[0]++

            while (blocklist.size < blockn + 1) {
                blocklist.add(null)
            }
            blocklist.set(blockn, block)
        } else {
            // check how many bitplanes we have from the arraysize
            while (sizeForBits(valuebits) < block.size) {
                valuebits++
            }
        }
        var headersize = 1 shl valuebits

        val v = (value + 1).toByte() // 0 is reserved (=unset)

        // find the index in the lookup table or the first entry
        var idx = 1
        while (idx < headersize) {
            if (block[idx].toInt() == 0) {
                block[idx] = v // create new entry
            }
            if (block[idx] == v) {
                break
            }
            idx++
        }
        if (idx == headersize) {
            block = expandBlock(block, valuebits)
            block[idx] = v // create new entry
            blocklist.set(blockn, block)
            valuebits++
            headersize = 1 shl valuebits
        }

        val bitmask = 1 shl (offset and 0x7)
        val invmask = bitmask xor 0xff
        var probebit = 1
        var blockidx = (offset shr 3) + headersize

        for (i in 0..<valuebits) {
            if ((idx and probebit) != 0) {
                block[blockidx] = (block[blockidx].toInt() or bitmask).toByte()
            } else {
                block[blockidx] = (block[blockidx].toInt() and invmask).toByte()
            }
            probebit = probebit shl 1
            blockidx += blocksize
        }
    }


    private fun sizeForBits(bits: Int): Int {
        // size is lookup table + datablocks
        return (1 shl bits) + blocksize * bits
    }

    private fun expandBlock(block: ByteArray, valuebits: Int): ByteArray {
        bitplaneCount[valuebits]++
        val newblock = ByteArray(sizeForBits(valuebits + 1))
        val headersize = 1 shl valuebits
        System.arraycopy(block, 0, newblock, 0, headersize) // copy header
        System.arraycopy(block, headersize, newblock, 2 * headersize, block.size - headersize) // copy data
        return newblock
    }

    open fun getInt(key: Long): Int {
        // bit-stats on first get
        if (getCount++ == 0L) {
            println("**** DenseLongMap stats ****")
            println("putCount=" + putCount)
            for (i in 0..7) {
                println(i.toString() + "-bitplanes=" + bitplaneCount[i])
            }
            println("****************************")
        }

        /* actual stats for the 30x45 raster and 512 blocksize with filtered nodes:
     *
     **** DenseLongMap stats ****
     putCount=858518399
     0-bitplanes=783337
     1-bitplanes=771490
     2-bitplanes=644578
     3-bitplanes=210767
     4-bitplanes=439
     5-bitplanes=0
     6-bitplanes=0
     7-bitplanes=0
     *
     * This is a total of 1,2 GB
     * (1.234.232.832+7.381.126+15.666.740 for body/header/object-overhead )
    */
        if (key < 0) {
            return -1
        }
        val blockn = (key shr blocksizeBits).toInt()
        val offset = (key and blocksizeBitsMask).toInt()

        val block = if (blockn < blocklist.size) blocklist.get(blockn) else null

        if (block == null) {
            return -1
        }

        // check how many bitplanes we have from the arrayzize
        var valuebits = 1
        while (sizeForBits(valuebits) < block.size) {
            valuebits++
        }
        val headersize = 1 shl valuebits

        val bitmask = 1 shl (offset and 7)
        var probebit = 1
        var blockidx = (offset shr 3) + headersize
        var idx = 0 // 0 is reserved (=unset)

        for (i in 0..<valuebits) {
            if ((block[blockidx].toInt() and bitmask) != 0) {
                idx = idx or probebit
            }
            probebit = probebit shl 1
            blockidx += blocksize
        }

        // lookup that value in the lookup header
        return ((256 + block[idx]) and 0xff) - 1
    }
}
