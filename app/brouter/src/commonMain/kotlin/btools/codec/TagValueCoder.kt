package btools.codec

import btools.codec.TagValueCoder.TagValueSet.FrequencyComparator
import btools.util.BitCoderContext
import btools.kmp.util.*
import btools.kmp.System

/**
 * Encoder/Decoder for way-/node-descriptions
 * 
 * 
 * It detects identical descriptions and sorts them
 * into a huffman-tree according to their frequencies
 * 
 * 
 * Adapted for 3-pass encoding (counters -&gt; statistics -&gt; encoding )
 * but doesn't do anything at pass1
 */
class TagValueCoder {
    private var identityMap: MutableMap<TagValueSet?, TagValueSet?>? = null
    private var tree: Any? = null
    private var bc: BitCoderContext? = null
    private var pass = 0
    private var nextTagValueSetId = 0

    fun encodeTagValueSet(data: ByteArray?) {
        if (pass == 1) {
            return
        }
        val tvsProbe = TagValueSet(nextTagValueSetId)
        tvsProbe.data = data
        var tvs = identityMap!!.get(tvsProbe)
        if (pass == 3) {
            bc!!.encodeBounded(tvs!!.range - 1, tvs.code)
        } else if (pass == 2) {
            if (tvs == null) {
                tvs = tvsProbe
                nextTagValueSetId++
                identityMap!!.put(tvs, tvs)
            }
            tvs.frequency++
        }
    }

    fun decodeTagValueSet(): TagValueWrapper? {
        var node = tree
        while (node is TreeNode) {
            val tn = node
            val nextBit = bc!!.decodeBit()
            node = if (nextBit) tn.child2 else tn.child1
        }
        return node as TagValueWrapper?
    }

    fun encodeDictionary(bc: BitCoderContext) {
        if (++pass == 3) {
            if (identityMap!!.size == 0) {
                val dummy = TagValueSet(nextTagValueSetId++)
                identityMap!!.put(dummy, dummy)
            }
            val queue = PriorityQueue<TagValueSet>(2 * identityMap!!.size, FrequencyComparator())
            queue.addAll(identityMap!!.values.map { it!! })
            while (queue.size > 1) {
                val node = TagValueSet(nextTagValueSetId++)
                node.child1 = queue.poll()
                node.child2 = queue.poll()
                node.frequency = node.child1!!.frequency + node.child2!!.frequency
                queue.add(node)
            }
            val root = queue.poll()!!
            root.encode(bc, 1, 0)
        }
        this.bc = bc
    }

    constructor(bc: BitCoderContext, buffers: DataBuffers, validator: TagValueValidator?) {
        tree = decodeTree(bc, buffers, validator)
        this.bc = bc
    }

    constructor() {
        identityMap = HashMap<TagValueSet?, TagValueSet?>()
    }

    private fun decodeTree(bc: BitCoderContext, buffers: DataBuffers, validator: TagValueValidator?): Any? {
        val isNode = bc.decodeBit()
        if (isNode) {
            val node = TreeNode()
            node.child1 = decodeTree(bc, buffers, validator)
            node.child2 = decodeTree(bc, buffers, validator)
            return node
        }

        val buffer = buffers.tagbuf1
        val ctx = buffers.bctx1
        ctx.reset(buffer)

        var inum = 0
        var lastEncodedInum = 0

        var hasdata = false
        while (true) {
            val delta = bc.decodeVarBits()
            if (!hasdata) {
                if (delta == 0) {
                    return null
                }
            }
            if (delta == 0) {
                ctx.encodeVarBits(0)
                break
            }
            inum += delta

            val data = bc.decodeVarBits()

            if (validator == null || validator.isLookupIdxUsed(inum)) {
                hasdata = true
                ctx.encodeVarBits(inum - lastEncodedInum)
                ctx.encodeVarBits(data)
                lastEncodedInum = inum
            }
        }

        val res: ByteArray?
        val len = ctx.closeAndGetEncodedLength()
        if (validator == null) {
            res = ByteArray(len)
            System.arraycopy(buffer, 0, res, 0, len)
        } else {
            res = validator.unify(buffer, 0, len)
        }

        val accessType = if (validator == null) 2 else validator.accessType(res!!)
        if (accessType > 0) {
            val w = TagValueWrapper()
            w.data = res
            w.accessType = accessType
            return w
        }
        return null
    }

    class TreeNode {
        var child1: Any? = null
        var child2: Any? = null
    }

    class TagValueSet(// serial number to make the comparator well defined in case of equal frequencies
        private val id: Int
    ) {
        var data: ByteArray? = null
        var frequency: Int = 0
        var code: Int = 0
        var range: Int = 0
        var child1: TagValueSet? = null
        var child2: TagValueSet? = null

        fun encode(bc: BitCoderContext, range: Int, code: Int) {
            this.range = range
            this.code = code
            val isNode = child1 != null
            bc.encodeBit(isNode)
            if (isNode) {
                child1!!.encode(bc, range shl 1, code)
                child2!!.encode(bc, range shl 1, code + range)
            } else {
                if (data == null) {
                    bc.encodeVarBits(0)
                    return
                }
                val src = BitCoderContext(data!!)
                while (true) {
                    val delta = src.decodeVarBits()
                    bc.encodeVarBits(delta)
                    if (delta == 0) {
                        break
                    }
                    val data = src.decodeVarBits()
                    bc.encodeVarBits(data)
                }
            }
        }

        override fun equals(o: Any?): Boolean {
            if (o is TagValueSet) {
                val tvs = o
                if (data == null) {
                    return tvs.data == null
                }
                if (tvs.data == null) {
                    return data == null
                }
                if (data!!.size != tvs.data!!.size) {
                    return false
                }
                for (i in data!!.indices) {
                    if (data!![i] != tvs.data!![i]) {
                        return false
                    }
                }
                return true
            }
            return false
        }

        override fun hashCode(): Int {
            if (data == null) {
                return 0
            }
            var h = 17
            for (i in data!!.indices) {
                h = (h shl 8) + data!![i]
            }
            return h
        }

        class FrequencyComparator : Comparator<TagValueSet> {
            override fun compare(tvs1: TagValueSet, tvs2: TagValueSet): Int {
                if (tvs1.frequency < tvs2.frequency) return -1
                if (tvs1.frequency > tvs2.frequency) return 1

                // to avoid ordering instability, decide on the id if frequency is equal
                if (tvs1.id < tvs2.id) return -1
                if (tvs1.id > tvs2.id) return 1

                if (tvs1 !== tvs2) {
                    throw RuntimeException("identity corruption!")
                }
                return 0
            }
        }
    }
}
