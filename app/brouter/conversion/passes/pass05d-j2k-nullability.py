#!/usr/bin/env python3
"""Fix pass 05d: the remaining J2K nullability defects, one by one (text-based, hand-chosen).

Each edit names exact text and how often it must occur (want=None: at least once); nothing is written if an
expectation fails. Run after pass 05c from anywhere: paths resolve from this script.
"""
import pathlib
import re
import sys

ROOT = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools')
texts, errors, counts = {}, [], {}

def text(rel):
    if rel not in texts:
        texts[rel] = (ROOT / rel).read_text()
    return texts[rel]

def bump(cat, n=1):
    counts[cat] = counts.get(cat, 0) + n

def edit(cat, rel, old, new, want=1):
    s = text(rel)
    n = s.count(old)
    if (want is None and n == 0) or (want is not None and n != want):
        errors.append(f'[{cat}] {rel}: expected {want}x, found {n}x: {old[:100]!r}')
        return
    texts[rel] = s.replace(old, new)
    bump(cat, n)

def regex(cat, rel, pattern, repl, want=None):
    s = text(rel)
    new, n = re.subn(pattern, repl, s, flags=re.M)
    if (want is None and n == 0) or (want is not None and n != want):
        errors.append(f'[{cat}] {rel}: regex expected {want}x, found {n}x: {pattern!r}')
        return
    texts[rel] = new
    bump(cat, n)

# ---- declarations whose nullability J2K got wrong (Java: never null / may be null)
edit('declaration-nullability', 'codec/DataBuffers.kt', '@JvmField var iobuffer: ByteArray? = ByteArray(65636)', '@JvmField var iobuffer: ByteArray = ByteArray(65636)')
edit('declaration-nullability', 'expressions/BExpressionContext.kt', 'fun createNewLookupData(): IntArray {', 'fun createNewLookupData(): IntArray? {')
regex('declaration-nullability', 'expressions/BExpressionContext.kt', r'(MutableList|ArrayList)<Array<BExpressionLookupValue\?>\?>', r'\1<Array<BExpressionLookupValue>>', 2)
edit('declaration-nullability', 'router/OsmPrePath.kt', 'fun init(origin: OsmPath, link: OsmLink, rc: RoutingContext?) {', 'fun init(origin: OsmPath, link: OsmLink, rc: RoutingContext) {')
edit('declaration-nullability', 'router/OsmTrack.kt', 'fun registerDetourForId(id: Long, detour: OsmPathElement) {', 'fun registerDetourForId(id: Long, detour: OsmPathElement?) {')
regex('declaration-nullability', 'router/OsmTrack.kt', r'^(\s*)var node = nodes\.get\(nodeNr\)$', r'\1var node: OsmPathElement? = nodes.get(nodeNr)')
edit('declaration-nullability', 'mapaccess/WaypointMatcherImpl.kt', 'fun updateWayList(ways: MutableList<MatchedWaypoint?>, mw: MatchedWaypoint?) {', 'fun updateWayList(ways: MutableList<MatchedWaypoint>, mw: MatchedWaypoint) {')
edit('declaration-nullability', 'router/VoiceHintProcessor.kt', 'tmpRndAbt.badWays = ArrayList<MessageData?>()', 'tmpRndAbt.badWays = ArrayList<MessageData>()')
# Java arrays of long[] whose slots are cleared with null
edit('declaration-nullability', 'util/CompactLongMap.kt', 'private var al: Array<LongArray>?', 'private var al: Array<LongArray?>?')
edit('declaration-nullability', 'util/CompactLongSet.kt', 'private var al: Array<LongArray>?', 'private var al: Array<LongArray?>?')
edit('declaration-nullability', 'util/TinyDenseLongMap.kt', 'private val al: Array<LongArray>', 'private val al: Array<LongArray?>')

# ---- BExpression.evaluate(null) for constant folding: nullable context, asserted where a variable is read
be = 'expressions/BExpression.kt'
edit('declaration-nullability', be, 'fun evaluate(ctx: BExpressionContext): Float {', 'fun evaluate(ctx: BExpressionContext?): Float {')
for old in ['ASSIGN_EXP -> return ctx.assign(', 'LOOKUP_EXP -> return ctx.getLookupMatch(', 'VARIABLE_EXP -> return ctx.getVariableValue(',
            'FOREIGN_VARIABLE_EXP -> return ctx.getForeignVariableValue(', 'VARIABLE_GET_EXP -> return ctx.getLookupValue(']:
    edit('non-null-assertion', be, old, old.replace('ctx.', 'ctx!!.'))
edit('non-null-assertion', be, 'ctx.lastAssignedExpression.', 'ctx.lastAssignedExpression!!.', None)

# ---- static array field J2K moved into the companion, while the base class declares an abstract property
for rel, cls in [('expressions/BExpressionContextNode.kt', 'BExpressionContextNode'), ('expressions/BExpressionContextWay.kt', 'BExpressionContextWay')]:
    regex('companion-override', rel, rf'^(class {cls}\b.*\{{)$',
          r'\1\n    override val buildInVariableNames: Array<String?>\n        get() = Companion.buildInVariableNames\n', 1)

# ---- platform values J2K left nullable where Java dereferences them directly
edit('non-null-assertion', 'mapaccess/NodesCache.kt', 'cacheSum -= osmf.cleanGhosts()', 'cacheSum -= osmf!!.cleanGhosts()')
edit('non-null-assertion', 'mapaccess/NodesCache.kt', 'cacheSum -= osmf.collectAll()', 'cacheSum -= osmf!!.collectAll()')
edit('non-null-assertion', 'mapaccess/OsmNodesMap.kt', 'val distance = n.calcDistance(destination)', 'val distance = n.calcDistance(destination!!)')
edit('non-null-assertion', 'mapaccess/MatchedWaypoint.kt', 'dos.writeBytes(name)', 'dos.writeBytes(name!!)')
edit('non-null-assertion', 'router/OsmTrack.kt', 'input.distanceToNext = node.calcDistance(node.origin).toDouble()', 'input.distanceToNext = node.calcDistance(node.origin!!).toDouble()')
edit('non-null-assertion', 'router/OsmTrack.kt', 'detourMap = if (source.detourMap == null) null else FrozenLongMap<OsmPathElementHolder?>(source.detourMap)',
     'detourMap = source.detourMap?.let { FrozenLongMap<OsmPathElementHolder?>(it) }')
edit('non-null-assertion', 'router/OsmTrack.kt', 'val v = detourMap.get(id)', 'val v = detourMap!!.get(id)')
edit('non-null-assertion', 'router/OsmTrack.kt', 'val v = source.detourMap.get(id)', 'val v = source.detourMap!!.get(id)')
edit('non-null-assertion', 'router/OsmPath.kt', 'if (rc.ai != null && rc.ai.polygon!!.isWithin(', 'if (rc.ai != null && rc.ai!!.polygon!!.isWithin(')
edit('non-null-assertion', 'router/OsmPath.kt', 'rc.ai.checkAreaInfo(', 'rc.ai!!.checkAreaInfo(')
edit('non-null-assertion', 'router/RoutingEngine.kt', '.calcDistance(listOne.get(0).crosspoint)', '.calcDistance(listOne.get(0).crosspoint!!)', 2)
edit('non-null-assertion', 'router/RoutingEngine.kt', 'dist += tmpPt.calcDistance(startPt)', 'dist += tmpPt.calcDistance(startPt!!)', None)
edit('non-null-assertion', 'router/RoutingEngine.kt', 'dist += n.calcDistance(lastPt)', 'dist += n.calcDistance(lastPt!!)', None)
edit('non-null-assertion', 'router/Formatter.kt', '        bw.write(format(t))\n', '        bw.write(format(t!!)!!)\n')
edit('non-null-assertion', 'codec/TagValueCoder.kt', 'queue.addAll(identityMap!!.values)', 'queue.addAll(identityMap!!.values.map { it!! })')
edit('non-null-assertion', 'router/RoutingEngine.kt', 'val keys: List<Int> = directMap.keys.sorted()', 'val keys: List<Int> = directMap.keys.map { it!! }.sorted()')

# ---- J2K kept a Java getter call on a Kotlin property / missing numeric conversions
edit('property-call', 'mapaccess/OsmNodesMap.kt', 'if (t!!.isHollow()) {', 'if (t!!.isHollow) {')
edit('implicit-conversion', 'router/VoiceHint.kt', 'val oldPrio: Float = if (oldWay == null) 0f else oldWay!!.prio', 'val oldPrio: Float = if (oldWay == null) 0f else oldWay!!.prio.toFloat()')
edit('implicit-conversion', 'util/DenseLongMap.kt', 'block[blockidx] = block[blockidx].toInt() or bitmask', 'block[blockidx] = (block[blockidx].toInt() or bitmask).toByte()')
edit('implicit-conversion', 'util/DenseLongMap.kt', 'block[blockidx] = block[blockidx].toInt() and invmask', 'block[blockidx] = (block[blockidx].toInt() and invmask).toByte()')
edit('arrayOfNulls-to-non-null-array', 'expressions/BExpressionContext.kt', 'val svalues = arrayOfNulls<String>(values.size)', 'val svalues = (arrayOfNulls<String>(values.size) as Array<String>)')

# ---- found after pass 05c
# lateinit contexts cannot keep J2K's @JvmField; the profile cache slots are nullable
edit('declaration-nullability', 'router/RoutingContext.kt', '    @JvmField\n    lateinit var expctxWay: BExpressionContextWay', '    lateinit var expctxWay: BExpressionContextWay')
edit('declaration-nullability', 'router/RoutingContext.kt', '    @JvmField\n    lateinit var expctxNode: BExpressionContextNode', '    lateinit var expctxNode: BExpressionContextNode')
edit('non-null-assertion', 'router/ProfileCache.kt', 'rc.expctxWay = pc.expctxWay\n', 'rc.expctxWay = pc.expctxWay!!\n')
edit('non-null-assertion', 'router/ProfileCache.kt', 'rc.expctxNode = pc.expctxNode\n', 'rc.expctxNode = pc.expctxNode!!\n')
edit('declaration-nullability', 'router/AreaReader.kt', 'fun readAreaInfo(fai: File, wp: MatchedWaypoint, ais: MutableList<AreaInfo?>) {', 'fun readAreaInfo(fai: File, wp: MatchedWaypoint, ais: MutableList<AreaInfo>) {')
edit('non-null-assertion', 'router/RoutingEngine.kt', '                ais.add(rc.ai)\n', '                ais.add(rc.ai!!)\n')
# findTrack returns what tryFindTrack/_findTrack return, which may be null (Java)
edit('nullable-return', 'router/RoutingEngine.kt', 'private fun findTrack(refTracks: Array<OsmTrack?>, lastTracks: Array<OsmTrack?>): OsmTrack {', 'private fun findTrack(refTracks: Array<OsmTrack?>, lastTracks: Array<OsmTrack?>): OsmTrack? {')
edit('nullable-return', 'router/RoutingEngine.kt', '    ): OsmTrack {\n        try {\n            val wpts2', '    ): OsmTrack? {\n        try {\n            val wpts2')
edit('non-null-assertion', 'router/RoutingEngine.kt', 'if (startWp != null) wpts2.add(startWp.waypoint)', 'if (startWp != null) wpts2.add(startWp.waypoint!!)')
edit('non-null-assertion', 'router/RoutingEngine.kt', 'if (endWp != null) wpts2.add(endWp.waypoint)', 'if (endWp != null) wpts2.add(endWp.waypoint!!)')
edit('non-null-assertion', 'router/OsmPath.kt', 'val dir = rc.startDirection * CheapRuler.DEG_TO_RAD', 'val dir = rc.startDirection!! * CheapRuler.DEG_TO_RAD')
regex('declaration-nullability', 'util/StringUtils.kt', r'private val (xmlEsc|jsnEsc): Array<String\?> =', r'private val \1: Array<String> =', 2)
# Java constructors that return early: Kotlin init blocks cannot `return`
edit('init-early-return', 'mapaccess/OsmFile.kt', '            if (fileOffset == index[tileIndex]) return  // empty\n', '            if (fileOffset != index[tileIndex]) { // else: empty\n')
edit('init-early-return', 'mapaccess/OsmFile.kt', '                posIdx[i] = dis.readInt()\n            }\n        }\n    }\n', '                posIdx[i] = dis.readInt()\n            }\n            }\n        }\n    }\n')
edit('init-early-return', 'mapaccess/PhysicalFile.kt', '        if (len == pos) return  // old format o.k.\n', '        if (len != pos) { // else: old format o.k.\n')
edit('init-early-return', 'mapaccess/PhysicalFile.kt', '            elevationType = dis.readByte()\n        } catch (e: Exception) {\n        }\n    }\n', '            elevationType = dis.readByte()\n        } catch (e: Exception) {\n        }\n        }\n    }\n')
# old-format rd5 files never set the header checksums; OsmFile checks them for null
regex('declaration-nullability', 'mapaccess/PhysicalFile.kt', r'^(\s*)(?:lateinit )?var fileHeaderCrcs: IntArray$', r'\1var fileHeaderCrcs: IntArray? = null', 1)
edit('non-null-assertion', 'mapaccess/PhysicalFile.kt', 'fileHeaderCrcs[i] = dis.readInt()', 'fileHeaderCrcs!![i] = dis.readInt()')
edit('non-null-assertion', 'mapaccess/OsmFile.kt', 'if (rafile.fileHeaderCrcs[tileIndex] != headerCrc) {', 'if (rafile.fileHeaderCrcs!![tileIndex] != headerCrc) {')

if errors:
    print('\n'.join(errors))
    sys.exit(1)
for rel, s in texts.items():
    (ROOT / rel).write_text(s)
print(counts, 'files:', len(texts))
