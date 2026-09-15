#!/usr/bin/env python3
"""Fix pass 05c: J2K nullability and implicit-conversion defects.

usage: pass05c-j2k-nullability.py <jvm-errors.txt>   (the error list of the build after pass 05b)

Part 1 is text-based (exact text + expected count); part 2 is driven by the error locations. Nothing is
written if any expectation fails. Run from anywhere: paths resolve from this script.
"""
import pathlib
import re
import sys

ROOT = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin')
texts = {}
errors = []
counts = {}

def text(rel):
    if rel not in texts:
        texts[rel] = (ROOT / rel).read_text()
    return texts[rel]

def bump(cat, n=1):
    counts[cat] = counts.get(cat, 0) + n

def edit(cat, rel, old, new, want=1):
    s = text(rel)
    n = s.count(old)
    if n != want:
        errors.append(f'[{cat}] {rel}: expected {want}x, found {n}x: {old[:90]!r}')
        return
    texts[rel] = s.replace(old, new)
    bump(cat, n)

def regex(cat, rel, pattern, repl, want=None):
    s = text(rel)
    new, n = re.subn(pattern, repl, s, flags=re.M)
    if (want is not None and n != want) or n == 0:
        errors.append(f'[{cat}] {rel}: regex expected {want if want is not None else ">0"}x, found {n}x: {pattern!r}')
        return
    texts[rel] = new
    bump(cat, n)

B = 'btools/'
# ---------------------------------------------------------------- part 1: text-based
# Java List<X> of never-null elements: J2K typed them MutableList<X?>; element type follows Java's use
for rel in ['router/RoutingParamCollector.kt', 'router/RoutingContext.kt', 'router/RoutingEngine.kt', 'router/OsmTrack.kt', 'router/FormatKml.kt']:
    regex('list-element-nullability', B + rel, r'\b(MutableList|ArrayList)<OsmNodeNamed\?>', r'\1<OsmNodeNamed>')
for rel in ['router/OsmTrack.kt', 'router/VoiceHintProcessor.kt']:
    regex('list-element-nullability', B + rel, r'\b(MutableList|ArrayList)<VoiceHint\?>', r'\1<VoiceHint>')
regex('list-element-nullability', B + 'router/RoutingEngine.kt', r'\b(MutableList|ArrayList)<(AreaInfo|MatchedWaypoint|OsmNode)\?>', r'\1<\2>')

# Java widens int -> long implicitly; Kotlin does not (OsmNogoPolygon.isWithin/isOnPolyline take Long)
for rel, want in [('router/RoutingContext.kt', None), ('router/AreaReader.kt', None)]:
    regex('implicit-widening', B + rel, r'\.(isWithin|isOnPolyline)\(([^,()]+), ([^()]+)\)', r'.\1(\2.toLong(), \3.toLong())', want)

# platform-typed String/Throwable values J2K left nullable where Java simply used them
edit('non-null-assertion', B + 'router/RoutingEngine.kt', 'var baseFolder = File(routingContext.localFunction).getParentFile()', 'var baseFolder = File(routingContext.localFunction!!).getParentFile()')
edit('non-null-assertion', B + 'router/RoutingEngine.kt', 'fw.write(this.foundInfo)', 'fw.write(this.foundInfo!!)', 2)
edit('non-null-assertion', B + 'router/RoutingEngine.kt', 'val fai = File(routingContext.rawAreaPath)', 'val fai = File(routingContext.rawAreaPath!!)')
edit('non-null-assertion', B + 'router/RoutingEngine.kt', 'throw dirtyMessage\n', 'throw dirtyMessage!!\n')
edit('non-null-assertion', B + 'router/ProfileCache.kt', 'profileDir = File(rc.localFunction).getParentFile()', 'profileDir = File(rc.localFunction!!).getParentFile()')
edit('non-null-assertion', B + 'router/ProfileCache.kt', 'profileFile = File(rc.localFunction)\n', 'profileFile = File(rc.localFunction!!)\n')
edit('non-null-assertion', B + 'router/AreaReader.kt', 'return e1.value!!.compareTo(e2.value)', 'return e1.value!!.compareTo(e2.value!!)')
edit('signature-nullability', B + 'expressions/BExpressionContext.kt',
     'fun parseFile(file: File, readOnlyContext: String?, keyValues: MutableMap<String?, String>? = null)',
     'fun parseFile(file: File, readOnlyContext: String?, keyValues: MutableMap<String?, String?>? = null)')
edit('implicit-widening', B + 'mapaccess/GeometryDecoder.kt', 'var oselev: Int = startnode.sElev', 'var oselev: Int = startnode.sElev.toInt()')

# ---------------------------------------------------------------- part 2: error-location driven
errs = []
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    m = re.match(r'^e: (btools/[^:]+):(\d+):(\d+) (.*)$', line)
    if m and not m.group(1).startswith('btools/kmp/'):
        errs.append((m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)))

lines = {}
def L(rel):
    if rel not in lines:
        lines[rel] = text(rel).split('\n')
    return lines[rel]

done = set()
for rel, ln, col, msg in errs:
    # arrayOfNulls<T>(n) assigned to Array<T>: Java arrays start null and are filled before use
    m = re.search(r"expected 'Array<(\w+)>', actual 'Array<\1\?>'|actual type is 'Array<(\w+)\?>', but 'Array<\2>\??' was expected", msg)
    if m and (rel, ln, 'aon') not in done:
        t = m.group(1) or m.group(2)
        if t == 'LongArray':
            continue  # CompactLongMap/Set, TinyDenseLongMap store null in these arrays: pass 05d makes the element type nullable
        ls = L(rel)
        new, n = re.subn(rf'(arrayOfNulls<{t}\?*>\([^()]*(?:\([^()]*\)[^()]*)*\))(?! as Array)', rf'(\1 as Array<{t}>)', ls[ln - 1], count=1)
        if n:
            ls[ln - 1] = new
            done.add((rel, ln, 'aon'))
            bump('arrayOfNulls-to-non-null-array')
        else:
            errors.append(f'[arrayOfNulls] no arrayOfNulls<{t}> at {rel}:{ln}: {ls[ln - 1].strip()}')
    # a function declared ': OsmTrack' that returns null (Java returns null freely)
    if "Null cannot be a value of a non-null type 'OsmTrack'" in msg:
        ls = L(rel)
        for i in range(ln - 1, -1, -1):
            # the signature line ends the (possibly multi-line) parameter list: `...): OsmTrack {`
            mm = re.match(r'^(.*\)): OsmTrack \{$', ls[i])
            if mm:
                if (rel, i, 'ret') not in done:
                    ls[i] = mm.group(1) + ': OsmTrack? {'
                    done.add((rel, i, 'ret'))
                    bump('nullable-return')
                break
            if re.match(r'^.*\): OsmTrack\? \{$', ls[i]) or re.match(r'^\s*(?:private |protected |public |internal )?fun .*\{$', ls[i]):
                bump('nullable-return-left-for-05d')  # already nullable: the null goes somewhere else
                break

for rel, ls in lines.items():
    texts[rel] = '\n'.join(ls)

if errors:
    print('\n'.join(errors))
    sys.exit(1)
for rel, s in texts.items():
    (ROOT / rel).write_text(s)
print(counts, 'files:', len(texts))
