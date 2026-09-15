#!/usr/bin/env python3
"""Fix pass 06: OsmNodesMap.cleanupPeninsulas without recursion.

BRouter walks the node graph depth-first to find peninsulas — dead ends it can drop before the search —
recursing once per node along the walk and catching the StackOverflowError when a walk gets too deep.
Kotlin/Native cannot catch a stack overflow: the process dies. So the walk becomes a loop over an explicit
stack of frames, reused across calls.

It is the one change to what BRouter does rather than to how it is written, and it is kept exactly as
narrow as that: the same visit order, `nextLink` read before descending as the Java reads it, the unlink
after the child returns, the same `nodesCreated` bookkeeping. What it cannot keep is giving up part-way
when the JVM's stack runs out — which is the behaviour a byte-parity check against brouter.de would
notice, on a route deep enough to overflow its stack. None of the parity routes are
(see app/brouter/README.md, "The peninsula walk").

Run from anywhere: paths resolve from this script. Refuses to write if the expected text is not found
exactly once.
"""
import pathlib
import sys

path = pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools/mapaccess/OsmNodesMap.kt'
source = path.read_text()

IMPORT = 'import btools.kmp.StackOverflowError\n'
START = '    private fun cleanupPeninsulas(nodes: Array<OsmNode>) {\n'
END = '    fun isInMemoryBounds('

LOOP = '''    private fun cleanupPeninsulas(nodes: Array<OsmNode>) {
        baseID = lastVisitID++
        for (i in nodes.indices) { // loop over nodes again just for housekeeping
            val n = nodes[i]
            if (n.firstlink != null) {
                if (n.visitID == 1) {
                    minVisitIdInSubtree(null, n)
                }
            }
        }
    }

    /** One level of the walk that BRouter's Java does as a recursive call. */
    private class PeninsulaFrame {
        var source: OsmNode? = null
        var n: OsmNode? = null
        var minId = 0
        var link: OsmLink? = null
        /** The link being descended into, while its subtree is walked. */
        var pending: OsmLink? = null
        var pendingTarget: OsmNode? = null
        var nodesCreatedUntilHere = 0
    }

    private val peninsulaFrames = ArrayList<PeninsulaFrame>()

    private fun minVisitIdInSubtree(source: OsmNode?, root: OsmNode): Int {
        var depth = 0
        enterPeninsulaFrame(depth, source, root)
        var returned = 0

        while (true) {
            val frame = peninsulaFrames[depth]
            val n = frame.n!!

            // A subtree has just returned `returned`: finish the loop iteration that descended into it.
            val pending = frame.pending
            if (pending != null) {
                if (returned > n.visitID) { // peninsula ?
                    nodesCreated = frame.nodesCreatedUntilHere
                    n.unlinkLink(pending)
                    frame.pendingTarget!!.unlinkLink(pending)
                }
                if (returned < frame.minId) frame.minId = returned
                frame.pending = null
                frame.pendingTarget = null
            }

            var child: OsmNode? = null
            while (frame.link != null) {
                val l = frame.link!!
                val nextLink = l.getNext(n)

                val t = l.getTarget(n)
                if (t === frame.source) {
                    frame.link = nextLink
                    continue
                }
                if (t!!.isHollow) {
                    frame.link = nextLink
                    continue
                }

                var minIdSub = t.visitID
                if (minIdSub == 1) {
                    minIdSub = baseID
                } else if (minIdSub == 0) {
                    frame.nodesCreatedUntilHere = nodesCreated
                    frame.pending = l
                    frame.pendingTarget = t
                    frame.link = nextLink
                    child = t
                    break
                } else if (minIdSub < baseID) {
                    frame.link = nextLink
                    continue
                } else if (cleanupMode == 2) {
                    minIdSub = baseID // in tree-mode, hitting anything is like a gateway
                }
                if (minIdSub < frame.minId) frame.minId = minIdSub
                frame.link = nextLink
            }

            if (child != null) {
                depth++
                enterPeninsulaFrame(depth, n, child)
                continue
            }

            returned = frame.minId
            frame.source = null
            frame.n = null
            if (depth == 0) return returned
            depth--
        }
    }

    private fun enterPeninsulaFrame(depth: Int, source: OsmNode?, n: OsmNode) {
        if (depth == peninsulaFrames.size) peninsulaFrames.add(PeninsulaFrame())
        if (n.visitID == 1) n.visitID = baseID // border node
        else n.visitID = lastVisitID++
        nodesCreated++
        val frame = peninsulaFrames[depth]
        frame.source = source
        frame.n = n
        frame.minId = n.visitID
        frame.link = n.firstlink
    }


'''

errors = []
if source.count(IMPORT) != 1:
    errors.append(f'import: expected 1, found {source.count(IMPORT)}')
if source.count(START) != 1 or source.count(END) != 1:
    errors.append(f'cleanupPeninsulas: expected 1 start and 1 end, found {source.count(START)} and {source.count(END)}')
elif 'catch (soe: StackOverflowError)' not in source[source.index(START):source.index(END)]:
    errors.append('cleanupPeninsulas: no StackOverflowError catch in the recursive version')
if errors:
    print('\n'.join(errors))
    sys.exit(1)

source = source.replace(IMPORT, '')
start, end = source.index(START), source.index(END)
path.write_text(source[:start] + LOOP + source[end:])
print({'peninsula-loop': 1})
