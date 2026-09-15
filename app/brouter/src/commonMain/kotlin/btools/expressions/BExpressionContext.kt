// context for simple expression
// context means:
// - the local variables
// - the local variable names
// - the lookup-input variables
package btools.expressions

import btools.expressions.BExpression.Companion.createAssignExpressionFromKeyValue
import btools.expressions.BExpression.Companion.parse
import btools.util.BitCoderContext
import btools.util.Crc32.crc
import btools.util.IByteArrayUnifier
import btools.util.LruMap
import btools.kmp.io.BufferedReader
import btools.kmp.io.File
import btools.kmp.io.FileReader
import btools.kmp.util.*
import kotlin.math.abs
import btools.kmp.System
import kotlin.jvm.JvmField
import kotlin.jvm.JvmOverloads

abstract class BExpressionContext protected constructor(context: String?, hashSize: Int, meta: BExpressionMetaData?) :
    IByteArrayUnifier {
    private var context: String?
    private var _inOurContext = false
    private var _br: BufferedReader? = null
    private var _readerDone = false

    @JvmField
    var _modelClass: String? = null

    private val lookupNumbers: MutableMap<String?, Int?> = HashMap<String?, Int?>()
    private val lookupValues: MutableList<Array<BExpressionLookupValue>> =
        ArrayList<Array<BExpressionLookupValue>>()
    private val lookupNames: MutableList<String?> = ArrayList<String?>()
    private val lookupHistograms: MutableList<IntArray> = ArrayList<IntArray>()
    private lateinit var lookupIdxUsed: BooleanArray

    private var lookupDataFrozen = false

    private var lookupData = IntArray(0)

    private val abBuf = ByteArray(256)
    private val ctxEndode = BitCoderContext(abBuf)
    private val ctxDecode = BitCoderContext(ByteArray(0))

    private val variableNumbers: MutableMap<String?, Int?> = HashMap<String?, Int?>()

    var lastAssignedExpression: MutableList<BExpression?>? = ArrayList<BExpression?>()
    @JvmField
    var skipConstantExpressionOptimizations: Boolean = false
    @JvmField
    var expressionNodeCount: Int = 0

    private var variableData: FloatArray? = null


    // hash-cache for function results
    private val probeCacheNode = CacheNode()
    private var cache: LruMap? = null

    private val probeVarSet = VarWrapper()
    private var resultVarCache: LruMap? = null

    private var expressionList: MutableList<BExpression?>? = null

    var minWriteIdx: Int = 0
        private set

    // build-in variable indexes for fast access
    private lateinit var buildInVariableIdx: IntArray
    private var nBuildInVars = 0

    private var currentVars: FloatArray? = null
    private var currentVarOffset = 0

    private var foreignContext: BExpressionContext? = null

    var noStartWays: IntArray = IntArray(0)

    var showErrors: Boolean = System.getBoolean("showErrors")

    protected fun setInverseVars() {
        currentVarOffset = nBuildInVars
    }

    abstract val buildInVariableNames: Array<String?>

    fun getBuildInVariable(idx: Int): Float {
        return currentVars!![idx + currentVarOffset]
    }

    private var linenr = 0

    @JvmField
    var meta: BExpressionMetaData?
    private var lookupDataValid = false

    protected constructor(context: String?, meta: BExpressionMetaData?) : this(context, 4096, meta)

    /**
     * encode internal lookup data to a byte array
     */
    fun encode(): ByteArray? {
        require(lookupDataValid) { "internal error: encoding undefined data?" }
        return encode(lookupData)
    }

    fun encode(ld: IntArray): ByteArray? {
        val ctx = ctxEndode
        ctx.reset()

        var skippedTags = 0
        var nonNullTags = 0

        // (skip first bit ("reversedirection") )

        // all others are generic
        for (inum in 1..<lookupValues.size) { // loop over lookup names
            val d = ld[inum]
            if (d == 0) {
                skippedTags++
                continue
            }
            ctx.encodeVarBits(skippedTags + 1)
            nonNullTags++
            skippedTags = 0

            // 0 excluded already, 1 (=unknown) we rotate up to 8
            // to have the good code space for the popular values
            val dd = if (d < 2) 7 else (if (d < 9) d - 2 else d - 1)
            ctx.encodeVarBits(dd)
        }
        ctx.encodeVarBits(0)

        if (nonNullTags == 0) return null

        val len = ctx.closeAndGetEncodedLength()
        val ab = ByteArray(len)
        System.arraycopy(abBuf, 0, ab, 0, len)


        // crosscheck: decode and compare
        val ld2 = IntArray(lookupValues.size)
        decode(ld2, false, ab)
        for (inum in 1..<lookupValues.size) { // loop over lookup names (except reverse dir)
            if (ld2[inum] != ld[inum]) throw RuntimeException(
                "assertion failed encoding inum=" + inum + " val=" + ld[inum] + " " + getKeyValueDescription(
                    false,
                    ab
                )
            )
        }

        return ab
    }


    /**
     * decode byte array to internal lookup data
     */
    fun decode(ab: ByteArray) {
        decode(lookupData, false, ab)
        lookupDataValid = true
    }


    /**
     * decode a byte-array into a lookup data array
     */
    fun decode(ld: IntArray, inverseDirection: Boolean, ab: ByteArray) {
        val ctx = ctxDecode
        ctx.reset(ab)

        // start with first bit hardwired ("reversedirection")
        ld[0] = if (inverseDirection) 2 else 0

        // all others are generic
        var inum = 1
        while (true) {
            var delta = ctx.decodeVarBits()
            if (delta == 0) break
            if (inum + delta > ld.size) break // higher minor version is o.k.


            while (delta-- > 1) ld[inum++] = 0

            // see encoder for value rotation
            val dd = ctx.decodeVarBits()
            var d = if (dd == 7) 1 else (if (dd < 7) dd + 2 else dd + 1)
            if (d >= lookupValues.get(inum)!!.size && d < 1000) d = 1 // map out-of-range to unknown

            ld[inum++] = d
        }
        while (inum < ld.size) ld[inum++] = 0
    }

    fun getKeyValueDescription(inverseDirection: Boolean, ab: ByteArray): String {
        val sb = StringBuilder(200)
        decode(lookupData, inverseDirection, ab)
        for (inum in lookupValues.indices) { // loop over lookup names
            val va = lookupValues.get(inum)!!
            val `val` = lookupData[inum]
            val value = if (`val` >= 1000) ((`val` - 1000) / 100f).toString() else va[`val`].toString()
            if (value != null && value.length > 0) {
                if (sb.length > 0) sb.append(' ')
                sb.append(lookupNames.get(inum) + "=" + value)
            }
        }
        return sb.toString()
    }

    fun getKeyValueList(inverseDirection: Boolean, ab: ByteArray): MutableList<String?> {
        val res: MutableList<String?> = ArrayList<String?>()
        decode(lookupData, inverseDirection, ab)
        for (inum in lookupValues.indices) { // loop over lookup names
            val va = lookupValues.get(inum)!!
            val `val` = lookupData[inum]
            // no negative values
            val value = if (`val` >= 1000) ((`val` - 1000) / 100f).toString() else va[`val`].toString()
            if (value != null && value.length > 0) {
                res.add(lookupNames.get(inum))
                res.add(value)
            }
        }
        return res
    }

    fun getLookupKey(name: String?): Int {
        var res = -1
        try {
            res = lookupNumbers.get(name)!!
        } catch (e: Exception) {
        }
        return res
    }

    fun getLookupValue(key: Int): Float {
        var res = 0f
        val `val` = lookupData[key]
        if (`val` == 0) return Float.NaN
        if (`val` < 900) {
            try {
                val va = lookupValues.get(key)!!
                val sval = va[`val`].toString()
                res = sval.toFloat()
            } catch (e: NumberFormatException) {
                res = 0f
            }
        } else {
            res = (`val` - 1000) / 100f
        }
        return res
    }

    fun getLookupValue(inverseDirection: Boolean, ab: ByteArray, key: Int): Float {
        var res = 0f
        decode(lookupData, inverseDirection, ab)
        val `val` = lookupData[key]
        if (`val` == 0) return Float.NaN
        res = (`val` - 1000) / 100f
        return res
    }

    private var parsedLines = 0
    private var fixTagsWritten = false

    fun parseMetaLine(line: String) {
        parsedLines++
        val tk = StringTokenizer(line, " ")
        var name = tk.nextToken()
        val value = tk.nextToken()
        val idx = name.indexOf(';')
        if (idx >= 0) name = name.substring(0, idx)

        if (!fixTagsWritten) {
            fixTagsWritten = true
            if ("way" == context) addLookupValue("reversedirection", "yes", null)
            else if ("node" == context) addLookupValue("nodeaccessgranted", "yes", null)
        }
        if ("reversedirection" == name) return  // this is hardcoded

        if ("nodeaccessgranted" == name) return  // this is hardcoded

        val newValue = addLookupValue(name, value, null)

        // add aliases
        while (newValue != null && tk.hasMoreTokens()) newValue.addAlias(tk.nextToken())
    }

    fun finishMetaParsing() {
        require(!(parsedLines == 0 && "global" != context)) { "lookup table does not contain data for context " + context + " (old version?)" }

        // post-process metadata:
        lookupDataFrozen = true

        lookupIdxUsed = BooleanArray(lookupValues.size)
    }

    fun evaluate(lookupData2: IntArray) {
        lookupData = lookupData2
        evaluate()
    }

    private fun evaluate() {
        val n = expressionList!!.size
        for (expidx in 0..<n) {
            expressionList!!.get(expidx)!!.evaluate(this)
        }
    }

    private var requests: Long = 0
    private var requests2: Long = 0
    private var cachemisses: Long = 0

    fun cacheStats(): String {
        return "requests=" + requests + " requests2=" + requests2 + " cachemisses=" + cachemisses
    }

    private var lastCacheNode: CacheNode? = CacheNode()

    // @Override
    override fun unify(ab: ByteArray, offset: Int, len: Int): ByteArray? {
        probeCacheNode.ab = null // crc based cache lookup only
        probeCacheNode.hash = crc(ab, offset, len)

        var cn = cache!!.get(probeCacheNode) as CacheNode?
        if (cn != null) {
            val cab = cn.ab
            if (cab!!.size == len) {
                for (i in 0..<len) {
                    if (cab[i] != ab[i + offset]) {
                        cn = null
                        break
                    }
                }
                if (cn != null) {
                    lastCacheNode = cn
                    return cn.ab
                }
            }
        }
        val nab = ByteArray(len)
        System.arraycopy(ab, offset, nab, 0, len)
        return nab
    }


    fun evaluate(inverseDirection: Boolean, ab: ByteArray) {
        requests++
        lookupDataValid = false // this is an assertion for a nasty pifall

        if (cache == null) {
            decode(lookupData, inverseDirection, ab)
            if (currentVars == null || currentVars!!.size != nBuildInVars) {
                currentVars = FloatArray(nBuildInVars)
            }
            evaluateInto(currentVars!!, 0)
            currentVarOffset = 0
            return
        }

        var cn: CacheNode?
        if (lastCacheNode!!.ab == ab) {
            cn = lastCacheNode
        } else {
            probeCacheNode.ab = ab
            probeCacheNode.hash = crc(ab, 0, ab.size)
            cn = cache!!.get(probeCacheNode) as CacheNode?
        }

        if (cn == null) {
            cachemisses++

            cn = cache!!.removeLru() as CacheNode?
            if (cn == null) {
                cn = CacheNode()
            }
            cn.hash = probeCacheNode.hash
            cn.ab = ab
            cache!!.put(cn)

            if (probeVarSet.vars == null) {
                probeVarSet.vars = FloatArray(2 * nBuildInVars)
            }

            // forward direction
            decode(lookupData, false, ab)
            evaluateInto(probeVarSet.vars!!, 0)

            // inverse direction
            lookupData[0] = 2 // inverse shortcut: reuse decoding
            evaluateInto(probeVarSet.vars!!, nBuildInVars)

            probeVarSet.hash = probeVarSet.vars.contentHashCode()

            // unify the result variable set
            var vw = resultVarCache!!.get(probeVarSet) as VarWrapper?
            if (vw == null) {
                vw = resultVarCache!!.removeLru() as VarWrapper?
                if (vw == null) {
                    vw = VarWrapper()
                }
                vw.hash = probeVarSet.hash
                vw.vars = probeVarSet.vars
                probeVarSet.vars = null
                resultVarCache!!.put(vw)
            }
            cn.vars = vw.vars
        } else {
            if (ab == cn.ab) requests2++

            cache!!.touch(cn)
        }

        currentVars = cn.vars
        currentVarOffset = if (inverseDirection) nBuildInVars else 0
    }

    private fun evaluateInto(vars: FloatArray, offset: Int) {
        evaluate()
        for (vi in 0..<nBuildInVars) {
            val idx = buildInVariableIdx[vi]
            vars[vi + offset] = if (idx == -1) 0f else variableData!![idx]
        }
    }


    fun dumpStatistics() {
        val counts = TreeMap<String?, String?>()
        // first count
        for (name in lookupNumbers.keys) {
            var cnt = 0
            val inum: Int = lookupNumbers.get(name)!!
            val histo = lookupHistograms.get(inum)
            //    if ( histo.length == 500 ) continue;
            for (i in 2..<histo.size) {
                cnt += histo[i]
            }
            counts.put("" + (1000000000 + cnt) + "_" + name, name)
        }

        while (counts.size > 0) {
            val key = counts.lastEntry()!!.key
            val name = counts.get(key)
            counts.remove(key)
            val inum: Int = lookupNumbers.get(name)!!
            val values = lookupValues.get(inum)!!
            val histo = lookupHistograms.get(inum)
            if (values.size == 1000) continue
            val svalues = (arrayOfNulls<String>(values.size) as Array<String>)
            for (i in values.indices) {
                var scnt = "0000000000" + histo[i]
                scnt = scnt.substring(scnt.length - 10)
                svalues[i] = scnt + " " + values[i].toString()
            }
            btools.kmp.util.JCollections.sortArray(svalues)
            for (i in svalues.indices.reversed()) {
                println(name + ";" + svalues[i])
            }
        }
    }

    /**
     * @return a new lookupData array, or null if no metadata defined
     */
    fun createNewLookupData(): IntArray? {
        if (lookupDataFrozen) {
            return IntArray(lookupValues.size)
        }
        return null
    }

    /**
     * generate random values for regression testing
     */
    fun generateRandomValues(rnd: kotlin.random.Random): IntArray {
        val data = createNewLookupData()!!
        data[0] = 2 * rnd.nextInt(2) // reverse-direction = 0 or 2
        for (inum in 1..<data.size) {
            val nvalues = lookupValues.get(inum)!!.size
            data[inum] = 0
            if (inum > 1 && rnd.nextInt(10) > 0) continue  // tags other than highway only 10%

            data[inum] = rnd.nextInt(nvalues)
        }
        lookupDataValid = true
        return data
    }

    fun assertAllVariablesEqual(other: BExpressionContext) {
        val nv = variableData!!.size
        val nv2 = other.variableData!!.size
        if (nv != nv2) throw RuntimeException("mismatch in variable-count: " + nv + "<->" + nv2)
        for (i in 0..<nv) {
            if (variableData!![i] != other.variableData!![i]) {
                throw RuntimeException(
                    ("mismatch in variable " + variableName(i) + " " + variableData!![i] + "<->" + other.variableData!![i]
                            + "\ntags = " + getKeyValueDescription(false, encode()!!))
                )
            }
        }
    }

    fun variableName(idx: Int): String? {
        for (e in variableNumbers.entries) {
            if (e.value == idx) {
                return e.key
            }
        }
        throw RuntimeException("no variable for index" + idx)
    }

    /**
     * add a new lookup-value for the given name to the given lookupData array.
     * If no array is given (null value passed), the value is added to
     * the context-binded array. In that case, unknown names and values are
     * created dynamically.
     * 
     * @return a newly created value element, if any, to optionally add aliases
     */
    fun addLookupValue(name: String?, value: String, lookupData2: IntArray?): BExpressionLookupValue? {
        var value = value
        var newValue: BExpressionLookupValue? = null
        var num = lookupNumbers.get(name)
        if (num == null) {
            if (lookupData2 != null) {
                // do not create unknown name for external data array
                return newValue
            }

            // unknown name, create
            num = lookupValues.size
            lookupNumbers.put(name, num)
            lookupNames.add(name)
            lookupValues.add(
                arrayOf<BExpressionLookupValue>(
                    BExpressionLookupValue(""),
                    BExpressionLookupValue("unknown")
                )
            )
            lookupHistograms.add(IntArray(2))
            val ndata = IntArray(lookupData.size + 1)
            System.arraycopy(lookupData, 0, ndata, 0, lookupData.size)
            lookupData = ndata
        }

        // look for that value
        var values = lookupValues.get(num)
        var histo = lookupHistograms.get(num)
        var i = 0
        var bFoundAsterix = false
        while (i < values.size) {
            val v = values[i]
            if (v.equals("*")) bFoundAsterix = true
            if (v.matches(value)) break
            i++
        }
        if (i == values.size) {
            if (lookupData2 != null) {
                // do not create unknown value for external data array,
                // record as 'unknown' instead
                lookupData2[num] = 1 // 1 == unknown
                if (bFoundAsterix) {
                    // found value for lookup *
                    //System.out.println( "add unknown " + name + "  " + value );
                    val org: String? = value
                    try {
                        // remove some unused characters
                        value = value.replace(",".toRegex(), ".")
                        value = value.replace(">".toRegex(), "")
                        value = value.replace("_".toRegex(), "")
                        value = value.replace(" ".toRegex(), "")
                        value = value.replace("~".toRegex(), "")
                        value = value.replace(8217.toChar(), '\'')
                        value = value.replace(8221.toChar(), '"')
                        if (value.indexOf("-") == 0) value = value.substring(1)
                        if (value.contains("-")) {
                            // replace eg. 1.4-1.6 m to 1.4m
                            // but also 1'-6" to 1'
                            // keep the unit of measure
                            val tmp = value.substring(value.indexOf("-") + 1).replace("[0-9.,-]".toRegex(), "")
                            value = value.substring(0, value.indexOf("-"))
                            if (value.matches("\\d+(\\.\\d+)?".toRegex())) value += tmp
                        }
                        value = value.lowercase()

                        // do some value conversion
                        if (value.contains("ft")) {
                            var feet = 0f
                            var inch = 0
                            val sa = value.split("ft".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size >= 1) feet = sa[0].toFloat()
                            if (sa.size == 2) {
                                value = sa[1]
                                if (value.indexOf("in") > 0) value = value.substring(0, value.indexOf("in"))
                                inch = value.toInt()
                                feet += inch / 12f
                            }
                            value = btools.kmp.TextFormat.fixed1Width3(feet * 0.3048f)
                        } else if (value.contains("'")) {
                            var feet = 0f
                            var inch = 0
                            val sa = value.split("'".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size >= 1) feet = sa[0].toFloat()
                            if (sa.size == 2) {
                                value = sa[1]
                                if (value.indexOf("''") > 0) value = value.substring(0, value.indexOf("''"))
                                if (value.indexOf("\"") > 0) value = value.substring(0, value.indexOf("\""))
                                inch = value.toInt()
                                feet += inch / 12f
                            }
                            value = btools.kmp.TextFormat.fixed1Width3(feet * 0.3048f)
                        } else if (value.contains("in") || value.contains("\"")) {
                            var inch = 0f
                            if (value.indexOf("in") > 0) value = value.substring(0, value.indexOf("in"))
                            if (value.indexOf("\"") > 0) value = value.substring(0, value.indexOf("\""))
                            inch = value.toFloat()
                            value = btools.kmp.TextFormat.fixed1Width3(inch * 0.0254f)
                        } else if (value.contains("feet") || value.contains("foot")) {
                            var feet = 0f
                            val s = value.substring(0, value.indexOf("f"))
                            feet = s.toFloat()
                            value = btools.kmp.TextFormat.fixed1Width3(feet * 0.3048f)
                        } else if (value.contains("fathom") || value.contains("fm")) {
                            val s = value.substring(0, value.indexOf("f"))
                            val fathom = s.toFloat()
                            value = btools.kmp.TextFormat.fixed1Width3(fathom * 1.8288f)
                        } else if (value.contains("cm")) {
                            val sa = value.split("cm".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size >= 1) value = sa[0]
                            val cm = value.toFloat()
                            value = btools.kmp.TextFormat.fixed1Width3(cm / 100f)
                        } else if (value.contains("metre") || value.contains("meter")) {
                            value = value.substring(0, value.indexOf("m"))
                        } else if (value.contains("mph")) {
                            val sa = value.split("mph".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size >= 1) value = sa[0]
                            val mph = value.toFloat()
                            value = btools.kmp.TextFormat.fixed1Width3(mph * 1.609344f)
                        } else if (value.contains("knot")) {
                            val sa = value.split("knot".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size >= 1) value = sa[0]
                            val nm = value.toFloat()
                            value = btools.kmp.TextFormat.fixed1Width3(nm * 1.852f)
                        } else if (value.contains("kmh") || value.contains("km/h") || value.contains("kph")) {
                            val sa = value.split("k".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size > 1) value = sa[0]
                        } else if (value.contains("m")) {
                            value = value.substring(0, value.indexOf("m"))
                        } else if (value.contains("(")) {
                            value = value.substring(0, value.indexOf("("))
                        } else if (value.contains("st")) {
                            val sa = value.split("st".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size >= 1) value = sa[0]
                            val st = value.toFloat()
                            value = btools.kmp.TextFormat.fixed1Width3(st * 0.907f)
                        } else if (value.contains("kg")) {
                            val sa = value.split("kg".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size >= 1) value = sa[0]
                            val kg = value.toFloat()
                            value = btools.kmp.TextFormat.fixed1Width3(kg / 1000f)
                        } else if (value.contains("lbs")) {
                            val sa = value.split("lbs".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size >= 1) value = sa[0]
                            val lbs = value.toFloat()
                            value = btools.kmp.TextFormat.fixed1Width3(lbs / 2204f)
                        } else if (value.contains("t")) {
                            val sa = value.split("t".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            if (sa.size >= 1) value = sa[0]
                        }
                        // found negative maxdraft values
                        // no negative values
                        // values are float with 2 decimals
                        lookupData2[num] = 1000 + (abs(value.toFloat()) * 100f).toInt()
                    } catch (e: Exception) {
                        // ignore errors
                        if (showErrors) System.err.println("error for " + name + "  " + org + " trans " + value + " " + e.message)
                        lookupData2[num] = 0
                    }
                }
                return newValue
            }

            if (i == 499) {
                // System.out.println( "value limit reached for: " + name );
            }
            if (i == 500) {
                return newValue
            }
            // unknown value, create
            val nvalues: Array<BExpressionLookupValue> = (arrayOfNulls<BExpressionLookupValue>(values.size + 1) as Array<BExpressionLookupValue>)
            val nhisto = IntArray(values.size + 1)
            System.arraycopy(values, 0, nvalues, 0, values.size)
            System.arraycopy(histo, 0, nhisto, 0, histo.size)
            values = nvalues
            histo = nhisto
            newValue = BExpressionLookupValue(value)
            values[i] = newValue
            lookupHistograms.set(num, histo)
            lookupValues.set(num, values)
        }

        histo[i]++

        // finally remember the actual data
        if (lookupData2 != null) lookupData2[num] = i
        else lookupData[num] = i
        return newValue
    }

    /**
     * add a value-index to to internal array
     * value-index means 0=unknown, 1=other, 2=value-x, ...
     */
    fun addLookupValue(name: String?, valueIndex: Int) {
        val num = lookupNumbers.get(name)
        if (num == null) {
            return
        }

        // look for that value
        val nvalues = lookupValues.get(num)!!.size
        require(!(valueIndex < 0 || valueIndex >= nvalues)) { "value index out of range for name " + name + ": " + valueIndex }
        lookupData[num] = valueIndex
    }


    /**
     * special hack for yes/proposed relations:
     * add a lookup value if not yet a smaller, &gt; 1 value was added
     * add a 2=yes if the provided value is out of range
     * value-index means here 0=unknown, 1=other, 2=yes, 3=proposed
     */
    fun addSmallestLookupValue(name: String?, valueIndex: Int) {
        var valueIndex = valueIndex
        val num = lookupNumbers.get(name)
        if (num == null) {
            return
        }

        // look for that value
        val nvalues = lookupValues.get(num)!!.size
        val oldValueIndex = lookupData[num]
        if (oldValueIndex > 1 && oldValueIndex < valueIndex) {
            return
        }
        if (valueIndex >= nvalues) {
            valueIndex = nvalues - 1
        }
        require(valueIndex >= 0) { "value index out of range for name " + name + ": " + valueIndex }
        lookupData[num] = valueIndex
    }

    fun getBooleanLookupValue(name: String?): Boolean {
        val num = lookupNumbers.get(name)
        return num != null && lookupData[num] == 2
    }

    fun getOutputVariableIndex(name: String?, mustExist: Boolean): Int {
        val idx = getVariableIdx(name, false)
        if (idx < 0) {
            require(!mustExist) { "unknown variable: " + name }
        } else require(idx >= minWriteIdx) { "bad access to global variable: " + name }
        for (i in 0..<nBuildInVars) {
            if (buildInVariableIdx[i] == idx) {
                return i
            }
        }
        val extended = IntArray(nBuildInVars + 1)
        System.arraycopy(buildInVariableIdx, 0, extended, 0, nBuildInVars)
        extended[nBuildInVars] = idx
        buildInVariableIdx = extended
        return nBuildInVars++
    }

    fun setForeignContext(foreignContext: BExpressionContext) {
        this.foreignContext = foreignContext
    }

    fun getForeignVariableValue(foreignIndex: Int): Float {
        return foreignContext!!.getBuildInVariable(foreignIndex)
    }

    fun getForeignVariableIdx(context: String, name: String?): Int {
        require(!(foreignContext == null || context != foreignContext!!.context)) { "unknown foreign context: " + context }
        return foreignContext!!.getOutputVariableIndex(name, true)
    }

    @JvmOverloads
    fun parseFile(file: File, readOnlyContext: String?, keyValues: MutableMap<String?, String?>? = null) {
        require(file.exists()) { "profile " + file.getName() + " does not exist" }
        try {
            if (readOnlyContext != null) {
                linenr = 1
                val realContext = context
                context = readOnlyContext
                expressionList = _parseFile(file, keyValues)
                variableData = FloatArray(variableNumbers.size)
                evaluate(lookupData) // lookupData is dummy here - evaluate just to create the variables
                context = realContext
            }
            linenr = 1
            minWriteIdx = if (variableData == null) 0 else variableData!!.size
            expressionList = _parseFile(file, null)
            lastAssignedExpression = null

            // determine the build-in variable indices
            val varNames = this.buildInVariableNames
            nBuildInVars = varNames.size
            buildInVariableIdx = IntArray(nBuildInVars)
            for (vi in varNames.indices) {
                buildInVariableIdx[vi] = getVariableIdx(varNames[vi], false)
            }

            val readOnlyData = variableData
            variableData = FloatArray(variableNumbers.size)
            for (i in 0..<minWriteIdx) {
                variableData!![i] = readOnlyData!![i]
            }
        } catch (e: IllegalArgumentException) {
            throw IllegalArgumentException("ParseException " + file.getName() + " at line " + linenr + ": " + e.message)
        } catch (e: Exception) {
            throw RuntimeException(e)
        }
        require(expressionList!!.size != 0) {
            (file.getName()
                    + " does not contain expressions for context " + context + " (old version?)")
        }
    }

    @Throws(Exception::class)
    private fun _parseFile(file: File, keyValues: MutableMap<String?, String?>?): MutableList<BExpression?> {
        _br = BufferedReader(FileReader(file))
        _readerDone = false
        val result: MutableList<BExpression?> = ArrayList<BExpression?>()

        // if injected keyValues are present, create assign expressions for them
        if (keyValues != null) {
            for (key in keyValues.keys) {
                val value: String = keyValues.get(key)!!
                result.add(createAssignExpressionFromKeyValue(this, key, value))
            }
        }

        while (true) {
            val exp = parse(this, 0)
            if (exp == null) break
            result.add(exp)
        }
        _br!!.close()
        _br = null
        return result
    }

    fun setVariableValue(name: String?, value: Float, create: Boolean) {
        var num = variableNumbers.get(name)
        if (num != null) {
            variableData!![num] = value
        } else if (create) {
            num = getVariableIdx(name, create)
            val readOnlyData = variableData
            val minWriteIdx = readOnlyData!!.size
            variableData = FloatArray(variableNumbers.size)
            for (i in 0..<minWriteIdx) {
                variableData!![i] = readOnlyData[i]
            }
            variableData!![num] = value
        }
    }

    fun getVariableValue(name: String?, defaultValue: Float): Float {
        val num = variableNumbers.get(name)
        return if (num == null) defaultValue else getVariableValue(num)
    }

    fun getVariableValue(variableIdx: Int): Float {
        return variableData!![variableIdx]
    }

    fun getVariableIdx(name: String?, create: Boolean): Int {
        var num = variableNumbers.get(name)
        if (num == null) {
            if (create) {
                num = variableNumbers.size
                variableNumbers.put(name, num)
                lastAssignedExpression!!.add(null)
            } else {
                return -1
            }
        }
        return num
    }

    fun getLookupMatch(nameIdx: Int, valueIdxArray: IntArray): Float {
        for (i in valueIdxArray.indices) {
            if (lookupData[nameIdx] == valueIdxArray[i]) {
                return 1.0f
            }
        }
        return 0.0f
    }

    fun getLookupNameIdx(name: String?): Int {
        val num = lookupNumbers.get(name)
        return if (num == null) -1 else num
    }

    fun markLookupIdxUsed(idx: Int) {
        lookupIdxUsed[idx] = true
    }

    fun isLookupIdxUsed(idx: Int): Boolean {
        return idx < lookupIdxUsed.size && lookupIdxUsed[idx]
    }

    fun setAllTagsUsed() {
        for (i in lookupIdxUsed.indices) {
            lookupIdxUsed[i] = true
        }
    }

    fun usedTagList(): String {
        val sb = StringBuilder()
        for (inum in lookupValues.indices) {
            if (lookupIdxUsed[inum]) {
                if (sb.length > 0) {
                    sb.append(',')
                }
                sb.append(lookupNames.get(inum))
            }
        }
        return sb.toString()
    }

    fun getLookupValueIdx(nameIdx: Int, value: String?): Int {
        val values = lookupValues.get(nameIdx)!!
        for (i in values.indices) {
            if (values[i]!!.equals(value)) return i
        }
        return -1
    }


    @Throws(Exception::class)
    fun parseToken(): String? {
        while (true) {
            val token = _parseToken()
            if (token == null) return null
            if (token.startsWith(CONTEXT_TAG)) {
                _inOurContext = token.substring(CONTEXT_TAG.length) == context
            } else if (token.startsWith(MODEL_TAG)) {
                _modelClass = token.substring(MODEL_TAG.length).trim { it <= ' ' }
            } else if (_inOurContext) {
                return token
            }
        }
    }


    @Throws(Exception::class)
    private fun _parseToken(): String? {
        val sb = StringBuilder(32)
        val sbcom = StringBuilder(32)
        var inComment = false
        while (true) {
            val ic = if (_readerDone) -1 else _br!!.read()
            if (ic < 0) {
                if (sb.length == 0) return null
                _readerDone = true
                return sb.toString()
            }
            val c = ic.toChar()
            if (c == '\n') linenr++

            if (inComment) {
                sbcom.append(c)
                if (c == '\r' || c == '\n') inComment = false
                if (!inComment) {
                    val num = variableNumbers.get("check_start_way")
                    if (num != null && noStartWays.size == 0 && sbcom.toString().contains("noStartWay")) {
                        var `var` = sbcom.toString().trim { it <= ' ' }
                        val savar = `var`.split("\\|".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                        if (savar.size == 4) {
                            `var` = savar[3].substring(savar[3].indexOf("=") + 1).trim { it <= ' ' }
                            val sa = `var`.split(";".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                            for (s in sa) {
                                val sa2 = s.split(",".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
                                val name: String? = sa2[0]
                                val value: String? = sa2[1]
                                val nidx = getLookupNameIdx(name)
                                if (nidx == -1) break
                                val vidx = getLookupValueIdx(nidx, value)
                                val tmp = IntArray(noStartWays.size + 2)
                                if (noStartWays.size > 0) System.arraycopy(noStartWays, 0, tmp, 0, noStartWays.size)
                                noStartWays = tmp
                                noStartWays[noStartWays.size - 2] = nidx
                                noStartWays[noStartWays.size - 1] = vidx
                            }
                        }
                    }
                    sbcom.setLength(0)
                }
                continue
            }
            if (btools.kmp.JMath.isWhitespace(c)) {
                if (sb.length > 0) return sb.toString()
                else {
                    continue
                }
            }
            if (c == '#' && sb.length == 0) inComment = true
            else sb.append(c)
        }
    }

    fun assign(variableIdx: Int, value: Float): Float {
        variableData!![variableIdx] = value
        return value
    }

    var ld2: IntArray = IntArray(512)

    /**
     * Create an Expression-Context for the given node
     * 
     * @param context  global, way or node - context of that instance
     * @param hashSize size of hashmap for result caching
     */
    init {
        var hashSize = hashSize
        this.context = context
        this.meta = meta

        if (meta != null) meta.registerListener(context, this)

        if (System.getBoolean("disableExpressionCache")) hashSize = 1

        // create the expression cache
        if (hashSize > 0) {
            cache = LruMap(4 * hashSize, hashSize)
            resultVarCache = LruMap(4096, 4096)
        }
    }

    fun checkStartWay(ab: ByteArray?): Boolean {
        if (ab == null) return true
        btools.kmp.util.JCollections.fill(ld2, 0)
        decode(ld2, false, ab)
        var i = 0
        while (i < noStartWays.size) {
            val key = noStartWays[i]
            val value = noStartWays[i + 1]
            if (ld2[key] == value) return false
            i += 2
        }
        return true
    }

    fun freeNoWays() {
        noStartWays = IntArray(0)
    }

    companion object {
        private const val CONTEXT_TAG = "---context:"
        private const val MODEL_TAG = "---model:"
    }
}
