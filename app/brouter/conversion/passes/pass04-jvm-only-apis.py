#!/usr/bin/env python3
"""Fix pass 04: JVM-only library APIs in the converted sources -> common Kotlin (call-site edits).

Each edit names the exact text it replaces and how often it must occur; if any expectation fails nothing is
written. Run from anywhere: paths resolve from this script.
"""
import pathlib
import sys

ROOT = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools')

STACK_SAMPLER_STUB = '''package btools.util

import btools.kmp.io.File

/**
 * Debug tooling: the JVM version is a thread that periodically dumps all thread stacks to a log file, started
 * only when a `stacks.txt` exists next to the profiles. Thread dumps do not exist in common Kotlin; this keeps
 * the API RoutingEngine uses and does nothing.
 */
class StackSampler(@Suppress("UNUSED_PARAMETER") logfile: File, @Suppress("UNUSED_PARAMETER") interval: Int) {
    fun start() {}
    fun close() {}
}
'''

MESSAGE_DATA_COPY = '''    fun copy(): MessageData? {
        val c = MessageData()
        c.linkdist = linkdist
        c.linkelevationcost = linkelevationcost
        c.linkturncost = linkturncost
        c.linknodecost = linknodecost
        c.linkinitcost = linkinitcost
        c.costfactor = costfactor
        c.prio = prio
        c.classifiermask = classifiermask
        c.turnangle = turnangle
        c.wayKeyValues = wayKeyValues
        c.nodeKeyValues = nodeKeyValues
        c.lon = lon
        c.lat = lat
        c.ele = ele
        c.time = time
        c.energy = energy
        c.vmaxExplicit = vmaxExplicit
        c.vmax = vmax
        c.vmin = vmin
        c.vnode0 = vnode0
        c.vnode1 = vnode1
        c.extraTime = extraTime
        return c
    }
'''

# (file, old, new, expected count)
EDITS = [
    # RoutingEngine: not a Thread (the app calls doRun on its own thread); common synchronized
    ('router/RoutingEngine.kt', ') : Thread() {\n', ') {\n', 1),
    ('router/RoutingEngine.kt', '    override fun run() {\n        doRun(0)', '    fun run() {\n        doRun(0)', 1),
    ('router/RoutingEngine.kt', 'import kotlin.jvm.JvmOverloads\n', 'import kotlin.jvm.JvmOverloads\nimport btools.kmp.synchronized\n', 1),
    ('router/RoutingEngine.kt', 'logInfo("********** " + Date())',
     'logInfo("********** " + btools.kmp.TextFormat.isoUtcMillis(System.currentTimeMillis()))', 1),
    ('router/RoutingEngine.kt', '            e.getStackTrace()\n', '', 2),
    ('router/RoutingEngine.kt', 'val keys: SortedSet<Int> = TreeSet<Int>(directMap.keys)', 'val keys: List<Int> = directMap.keys.sorted()', 1),
    # Formatter: SimpleDateFormat in UTC -> hand-written ISO formatter
    ('router/Formatter.kt',
     '            val TIMESTAMP_FORMAT = SimpleDateFormat(dateformat, Locale.US)\n'
     '            TIMESTAMP_FORMAT.setTimeZone(TimeZone.getTimeZone("UTC"))\n'
     '            // yyyy-mm-ddThh:mm:ss.SSSZ\n'
     '            val d = Date((time * 1000f).toLong())\n'
     '            return TIMESTAMP_FORMAT.format(d)\n',
     '            // yyyy-mm-ddThh:mm:ss.SSSZ\n'
     '            return btools.kmp.TextFormat.isoUtcMillis((time * 1000f).toLong())\n', 1),
    # FormatJson: DecimalFormat("0.###") -> hand-written, byte-identical
    ('router/FormatJson.kt',
     '            val decimalFormat = NumberFormat.getInstance(Locale.ENGLISH) as DecimalFormat\n'
     '            decimalFormat.applyPattern("0.###")\n'
     '            for (n in t.nodes) {\n'
     '                sb.append(decimalFormat.format(n.time.toDouble())).append(",")\n',
     '            for (n in t.nodes) {\n'
     '                sb.append(btools.kmp.TextFormat.decimal3(n.time)).append(",")\n', 1),
    # FormatGpx: String.format("%6s;%6d;%10s;%10s;%6d;%s") -> explicit padding
    ('router/FormatGpx.kt',
     '                    String.format(\n'
     '                        "     \\$turn$%6s;%6d;%10s;%10s;%6d;%s$\\n",\n'
     '                        getCommandString(hint!!.cmd, hint.exitNumber, turnInstructionMode),\n'
     '                        hint.indexInTrack,\n'
     '                        formatILon(hint.ilon),\n'
     '                        formatILat(hint.ilat),\n'
     '                        (hint.distanceToNext).toInt(),\n'
     '                        hint.formatGeometry()\n'
     '                    )\n',
     '                    "     \\$turn$" +\n'
     '                        getCommandString(hint!!.cmd, hint.exitNumber, turnInstructionMode).padStart(6) + ";" +\n'
     '                        hint.indexInTrack.toString().padStart(6) + ";" +\n'
     '                        formatILon(hint.ilon).padStart(10) + ";" +\n'
     '                        formatILat(hint.ilat).padStart(10) + ";" +\n'
     '                        (hint.distanceToNext).toInt().toString().padStart(6) + ";" +\n'
     '                        hint.formatGeometry() + "$\\n"\n', 1),
    ('router/FormatGpx.kt', 'val first = StringBuffer()', 'val first = StringBuilder()', 1),
    # OsmTrack: version from the jar manifest -> the release this was converted from
    ('router/OsmTrack.kt', 'val version: String? = OsmTrack::class.java.getPackage().getImplementationVersion()',
     'val version: String? = "1.7.10"', 1),
    # RoutingParamCollector: java.net.URLDecoder, stack frame access
    ('router/RoutingParamCollector.kt', 'import java.net.URLDecoder', 'import btools.kmp.net.URLDecoder', 1),
    ('router/RoutingParamCollector.kt',
     'System.err.println("error " + ex.getStackTrace()[0].getLineNumber() + " " + ex.getStackTrace()[0] + "\\n" + ex)',
     'System.err.println("error " + ex.stackTraceToString())', 1),
    # OsmNode: javaClass
    ('mapaccess/OsmNode.kt', '"unknown cache version: " + mc.javaClass', '"unknown cache version: " + mc::class', 1),
    # MessageData: Cloneable/clone() -> explicit copy
    ('router/MessageData.kt', 'internal class MessageData : Cloneable {', 'internal class MessageData {', 1),
    ('router/MessageData.kt',
     '    fun copy(): MessageData? {\n'
     '        try {\n'
     '            return clone() as MessageData?\n'
     '        } catch (e: CloneNotSupportedException) {\n'
     '            throw RuntimeException(e)\n'
     '        }\n'
     '    }\n', MESSAGE_DATA_COPY, 1),
    # TagValueCoder: java.util.Queue interface type
    ('codec/TagValueCoder.kt',
     'val queue: Queue<TagValueSet> = PriorityQueue<TagValueSet>(2 * identityMap!!.size, FrequencyComparator())',
     'val queue = PriorityQueue<TagValueSet>(2 * identityMap!!.size, FrequencyComparator())', 1),
    ('codec/TagValueCoder.kt', '            val root = queue.poll()\n            root.encode(', '            val root = queue.poll()!!\n            root.encode(', 1),
    # BExpressionContext: NavigableMap, java.util.Random
    ('expressions/BExpressionContext.kt', 'val counts: NavigableMap<String?, String?> = TreeMap<String?, String?>()',
     'val counts = TreeMap<String?, String?>()', 1),
    ('expressions/BExpressionContext.kt', 'counts.lastEntry().key', 'counts.lastEntry()!!.key', 1),
    ('expressions/BExpressionContext.kt', 'fun generateRandomValues(rnd: Random): IntArray', 'fun generateRandomValues(rnd: kotlin.random.Random): IntArray', 1),
]

REMOVE_IMPORTS = {
    'router/Formatter.kt': ['import java.text.SimpleDateFormat'],
    'router/FormatJson.kt': ['import java.text.DecimalFormat', 'import java.text.NumberFormat'],
}

texts = {}
errors = []
for rel, old, new, want in EDITS:
    p = ROOT / rel
    s = texts.get(rel) or p.read_text()
    n = s.count(old)
    if n != want:
        errors.append(f'{rel}: expected {want}x, found {n}x: {old[:80]!r}')
        continue
    texts[rel] = s.replace(old, new)
for rel, imports in REMOVE_IMPORTS.items():
    s = texts.get(rel) or (ROOT / rel).read_text()
    for imp in imports:
        if imp + '\n' not in s:
            errors.append(f'{rel}: import not found: {imp}')
        s = s.replace(imp + '\n', '')
    texts[rel] = s
if errors:
    print('\n'.join(errors))
    sys.exit(1)

for rel, s in texts.items():
    (ROOT / rel).write_text(s)
(ROOT / 'util/StackSampler.kt').write_text(STACK_SAMPLER_STUB)
print(f'{len(EDITS)} edits in {len(texts)} files; StackSampler.kt replaced by a stub')
