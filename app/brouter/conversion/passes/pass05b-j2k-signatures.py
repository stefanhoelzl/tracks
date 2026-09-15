#!/usr/bin/env python3
"""Fix pass 05b: J2K signature, nullability, visibility and translation defects (hand-chosen edits).

Every edit names the exact text and how often it must occur; nothing is written if an expectation fails.
Run from anywhere: paths resolve from this script.
"""
import pathlib
import re
import sys

ROOT = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools')
texts = {}
errors = []
counts = {}

def text(rel):
    if rel not in texts:
        texts[rel] = (ROOT / rel).read_text()
    return texts[rel]

def edit(category, rel, old, new, want=1):
    s = text(rel)
    n = s.count(old)
    if n != want:
        errors.append(f'[{category}] {rel}: expected {want}x, found {n}x: {old[:90]!r}')
        return
    texts[rel] = s.replace(old, new)
    counts[category] = counts.get(category, 0) + n

def regex(category, rel, pattern, repl, want):
    s = text(rel)
    new, n = re.subn(pattern, repl, s, flags=re.M)
    if n != want:
        errors.append(f'[{category}] {rel}: regex expected {want}x, found {n}x: {pattern!r}')
        return
    texts[rel] = new
    counts[category] = counts.get(category, 0) + n

# --- bogus explicit imports of kotlin operators/types (J2K per-file output)
for rel, want in [('router/RoutingContext.kt', 9), ('router/OsmNodeNamed.kt', 5), ('mapaccess/WaypointMatcherImpl.kt', 4)]:
    regex('bogus-kotlin-imports', rel,
          r'^import kotlin\.(?:div|times|plus|minus|compareTo|hashCode|String|Int|Long|collections\.plus|collections\.indices)\n', '', want)

# --- package-private Java classes that public API exposes: internal -> public
edit('visibility', 'router/MessageData.kt', 'internal class MessageData {', 'class MessageData {')
edit('visibility', 'router/OsmPathModel.kt', 'internal abstract class OsmPathModel {', 'abstract class OsmPathModel {')
edit('visibility', 'router/OsmPath.kt', 'internal abstract class OsmPath : OsmLinkHolder {', 'abstract class OsmPath : OsmLinkHolder {')
edit('visibility', 'expressions/BExpression.kt', 'internal class BExpression {', 'class BExpression {')
edit('visibility', 'expressions/BExpressionLookupValue.kt', 'internal class BExpressionLookupValue(', 'class BExpressionLookupValue(')

# --- translation bugs
# Java: for (int i = isClosed ? 0 : 1; i <= i_last; i++)  -- J2K dropped the parentheses
edit('translation-bug', 'router/OsmNogoPolygon.kt', 'for (i in if (isClosed) 0 else 1..i_last) {', 'for (i in (if (isClosed) 0 else 1)..i_last) {', 2)
# Java: return ilon + "," + ilat + ...  (string concatenation starting with an int)
edit('translation-bug', 'router/OsmNodeNamed.kt', 'return iLon + "," + iLat + "," + name + "," + nogoWeight', 'return "" + iLon + "," + iLat + "," + name + "," + nogoWeight')
edit('translation-bug', 'router/OsmNodeNamed.kt', 'return iLon + "," + iLat + "," + name\n', 'return "" + iLon + "," + iLat + "," + name\n')

# getter calls to members converted earlier in the dependency order (now properties)
edit('cycle-getters', 'expressions/BExpression.kt', 'ctx.getMinWriteIdx()', 'ctx.minWriteIdx')
edit('cycle-getters', 'router/OsmPath.kt', 'rc.expctxWay.getIsTrafficBackbone()', 'rc.expctxWay.isTrafficBackbone')
# Collections.sort with nested generic type arguments (pass 02's pattern did not match)
edit('jvm-only-api', 'router/AreaReader.kt', 'Collections.sort<MutableMap.MutableEntry<Long?, String?>?>(', 'btools.kmp.util.JCollections.sort(')

# --- java.lang.String constructors
edit('jvm-only-api', 'mapaccess/MatchedWaypoint.kt', 'mwp.name = String(bytes)', 'mwp.name = bytes.decodeToString()')
edit('jvm-only-api', 'router/Formatter.kt', 'return String(ac, i + 1, 11 - i)', 'return ac.concatToString(i + 1, 12)')
edit('jvm-only-api', 'mapaccess/OsmNodesMap.kt', 'package btools.mapaccess\n', 'package btools.mapaccess\n\nimport btools.kmp.StackOverflowError\n')

# --- @Synchronized on companion functions: deprecated-as-error on Native -> synchronized(this) { } bodies
pc = text('router/ProfileCache.kt')
for fn in ['fun setSize(size: Int) {', 'fun parseProfile(rc: RoutingContext): Boolean {', 'fun releaseProfile(rc: RoutingContext) {']:
    head = f'        @Synchronized\n        {fn}\n'
    i = pc.find(head)
    if i < 0:
        errors.append(f'[synchronized] ProfileCache: {fn} not found')
        continue
    j = i + len(head)
    end = pc.find('\n        }\n', j)
    body = pc[j:end + 1]
    body = ''.join('    ' + l if l.strip() else l for l in body.splitlines(True))
    pc = pc[:i] + f'        {fn}\n            synchronized(this) {{\n' + body + '            }\n' + pc[end + 1:]
    counts['synchronized'] = counts.get('synchronized', 0) + 1
texts['router/ProfileCache.kt'] = pc
edit('synchronized', 'router/ProfileCache.kt', 'import kotlin.jvm.Synchronized\n', 'import btools.kmp.synchronized\n')

# --- expression contexts are always set before routing: lateinit instead of nullable
edit('nullability', 'router/RoutingContext.kt', 'var expctxWay: BExpressionContextWay? = null', 'lateinit var expctxWay: BExpressionContextWay')
edit('nullability', 'router/RoutingContext.kt', 'var expctxNode: BExpressionContextNode? = null', 'lateinit var expctxNode: BExpressionContextNode')
# releaseProfile nulls them for the garbage collector; the cache slot keeps them anyway
edit('nullability', 'router/ProfileCache.kt', '                rc.expctxWay = null\n', '')
edit('nullability', 'router/ProfileCache.kt', '                rc.expctxNode = null\n', '')
edit('nullability', 'router/RoutingEngine.kt', 'if (hasInfo() && routingContext.expctxWay != null) {', 'if (hasInfo()) {')

# --- base signatures follow their overrides (J2K made base parameters nullable, overrides non-null)
edit('override-signature', 'router/OsmPath.kt', '    protected abstract fun processWaySection(\n        rc: RoutingContext?,', '    protected abstract fun processWaySection(\n        rc: RoutingContext,')
edit('override-signature', 'router/OsmPath.kt', 'protected abstract fun processTargetNode(rc: RoutingContext?): Double', 'protected abstract fun processTargetNode(rc: RoutingContext): Double')
edit('override-signature', 'router/OsmPath.kt', 'protected open fun computeKinematic(rc: RoutingContext?, dist: Double', 'protected open fun computeKinematic(rc: RoutingContext, dist: Double')
edit('override-signature', 'router/OsmPrePath.kt', 'protected abstract fun initPrePath(origin: OsmPath?, rc: RoutingContext?)', 'protected abstract fun initPrePath(origin: OsmPath, rc: RoutingContext)')
edit('override-signature', 'router/OsmPathModel.kt', '        expctxWay: BExpressionContextWay?,\n        expctxNode: BExpressionContextNode?,', '        expctxWay: BExpressionContextWay,\n        expctxNode: BExpressionContextNode,')
edit('override-signature', 'router/StdModel.kt', '        expctxWay: BExpressionContextWay?,\n        expctxNode: BExpressionContextNode?,', '        expctxWay: BExpressionContextWay,\n        expctxNode: BExpressionContextNode,')
edit('override-signature', 'router/Formatter.kt', 'abstract fun format(t: OsmTrack?): String?', 'abstract fun format(t: OsmTrack): String?')
edit('override-signature', 'router/Formatter.kt', 'open fun read(filename: String?): OsmTrack? {', 'open fun read(filename: String): OsmTrack? {')
edit('override-signature', 'codec/TagValueValidator.kt', 'fun accessType(tagValueSet: ByteArray?): Int', 'fun accessType(tagValueSet: ByteArray): Int')
edit('override-signature', 'codec/TagValueValidator.kt', 'fun unify(tagValueSet: ByteArray?, offset: Int, len: Int): ByteArray?', 'fun unify(tagValueSet: ByteArray, offset: Int, len: Int): ByteArray?')
edit('override-signature', 'util/IByteArrayUnifier.kt', 'fun unify(ab: ByteArray?, offset: Int, len: Int): ByteArray?', 'fun unify(ab: ByteArray, offset: Int, len: Int): ByteArray?')
edit('override-signature', 'mapaccess/OsmPos.kt', 'fun calcDistance(p: OsmPos?): Int', 'fun calcDistance(p: OsmPos): Int')
edit('override-signature', 'codec/MicroCache.kt', 'open fun encodeMicroCache(buffer: ByteArray?): Int {', 'open fun encodeMicroCache(buffer: ByteArray): Int {')
# overrides follow Kotlin's declarations
edit('override-signature', 'mapaccess/OsmNode.kt', 'override fun equals(o: Any): Boolean {', 'override fun equals(o: Any?): Boolean {')
edit('override-signature', 'codec/TagValueCoder.kt', 'class FrequencyComparator : Comparator<TagValueSet?> {', 'class FrequencyComparator : Comparator<TagValueSet> {')
edit('override-signature', 'router/RoutingEngine.kt', 'object : Comparator<AreaInfo?> {', 'object : Comparator<AreaInfo> {', 3)
edit('override-signature', 'mapaccess/WaypointMatcherImpl.kt', 'private val comparator: Comparator<MatchedWaypoint?>?', 'private val comparator: Comparator<MatchedWaypoint>')
edit('override-signature', 'mapaccess/WaypointMatcherImpl.kt', 'comparator = object : Comparator<MatchedWaypoint?> {', 'comparator = object : Comparator<MatchedWaypoint> {')
edit('override-signature', 'router/AreaReader.kt', 'object : Comparator<MutableMap.MutableEntry<Long?, String?>?> {', 'object : Comparator<MutableMap.MutableEntry<Long?, String?>> {')

# --- StdPath: private float fields collided with OsmPath's open totalTime/totalEnergy properties
sp = 'router/StdPath.kt'
edit('override-signature', sp, '    private override var totalTime = 0f // travel time (seconds)\n', '    private var stdTotalTime = 0f // travel time (seconds)\n')
edit('override-signature', sp, '    private override var totalEnergy = 0f // total route energy (Joule)\n', '    private var stdTotalEnergy = 0f // total route energy (Joule)\n')
edit('override-signature', sp, 'this.totalTime = origin.totalTime', 'this.stdTotalTime = origin.stdTotalTime')
edit('override-signature', sp, 'this.totalEnergy = origin.totalEnergy', 'this.stdTotalEnergy = origin.stdTotalEnergy')
edit('override-signature', sp, '        totalTime = 0f\n        totalEnergy = 0f\n', '        stdTotalTime = 0f\n        stdTotalEnergy = 0f\n')
edit('override-signature', sp, '        totalTime += dt\n', '        stdTotalTime += dt\n')
edit('override-signature', sp, '            totalEnergy += energy.toFloat()\n', '            stdTotalEnergy += energy.toFloat()\n')
edit('override-signature', sp, '    public override fun getTotalTime(): Double {\n        return totalTime.toDouble()\n    }\n',
     '    override val totalTime: Double\n        get() = stdTotalTime.toDouble()\n')
edit('override-signature', sp, '    public override fun getTotalEnergy(): Double {\n        return totalEnergy.toDouble()\n    }\n',
     '    override val totalEnergy: Double\n        get() = stdTotalEnergy.toDouble()\n')

if errors:
    print('\n'.join(errors))
    sys.exit(1)
for rel, s in texts.items():
    (ROOT / rel).write_text(s)
print(counts, 'files:', len(texts))
