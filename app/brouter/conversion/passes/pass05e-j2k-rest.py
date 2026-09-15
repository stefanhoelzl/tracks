#!/usr/bin/env python3
"""Fix pass 05e: the last J2K defects found by compiling after pass 05d (text-based, hand-chosen).

Each edit names exact text and how often it must occur (want=None: at least once); nothing is written if an
expectation fails. Run after pass 05d from anywhere: paths resolve from this script.
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

# PhysicalFile's integrity check decodes without a validator (MicroCache2 already accepts null)
regex('declaration-nullability', 'mapaccess/OsmFile.kt', r'wayValidator: TagValueValidator,', 'wayValidator: TagValueValidator?,', 2)
# parseFile's key/value overrides (nullable values, as Java's Map<String,String>) pass through to _parseFile
regex('declaration-nullability', 'expressions/BExpressionContext.kt', r'(fun _parseFile\(file: File, keyValues: MutableMap<String\?, )String(>\?)', r'\1String?\2', 1)

# doRouting dereferences the track right away (Java NPE if null); findTrack itself stays nullable
edit('non-null-assertion', 'router/RoutingEngine.kt', '                track = findTrack(refTracks, lastTracks)\n', '                track = findTrack(refTracks, lastTracks)!!\n')
# createNewLookupData() is null only without metadata; these callers use it directly (Java NPE)
edit('non-null-assertion', 'expressions/BExpressionContext.kt', '        val data = createNewLookupData()\n', '        val data = createNewLookupData()!!\n')
edit('non-null-assertion', 'router/AreaInfo.kt', 'val ld2 = expctxWay.createNewLookupData()\n', 'val ld2 = expctxWay.createNewLookupData()!!\n')
edit('non-null-assertion', 'codec/MicroCache2.kt', 'val b = u.unify(ab, aboffset, len)', 'val b = u.unify(ab!!, aboffset, len)')
edit('non-null-assertion', 'codec/TagValueCoder.kt', 'validator.accessType(res)', 'validator.accessType(res!!)')
regex('declaration-nullability', 'util/StringUtils.kt', r'(fun escape\([^)]*): Array<String\?>', r'\1: Array<String>', 1)
regex('declaration-nullability', 'mapaccess/MatchedWaypoint.kt', r'(MutableList|ArrayList)<MatchedWaypoint\?>', r'\1<MatchedWaypoint>', 2)
regex('declaration-nullability', 'mapaccess/PhysicalFile.kt', r'^(\s*)var creationTime: Long$', r'\1var creationTime: Long = 0', 1)

# long[] slots are nullable (the code tests them for null); reads of a slot get !! (Java NPE if null)
errlist = sys.argv[1] if len(sys.argv) > 1 else 'results/kmp/05d-j2k-nullability-jvm-errors.txt'
slot_lines = {}
for line in pathlib.Path(errlist).read_text().splitlines():
    m = re.match(r"^e: btools/(util/(?:CompactLongMap|CompactLongSet|TinyDenseLongMap)\.kt):(\d+):\d+ Only safe .* type 'LongArray\?'", line)
    if m:
        slot_lines.setdefault(m.group(1), set()).add(int(m.group(2)))
for rel, lns in sorted(slot_lines.items()):
    ls = text(rel).split('\n')
    for ln in sorted(lns):
        new, n = re.subn(r'\bal(!!)?\[([^\[\]]+)\](?!!!)(?=[\[.])', r'al\1[\2]!!', ls[ln - 1])
        if n:
            ls[ln - 1] = new
            bump('non-null-assertion', n)
            continue
        # the line reads a local `a` that holds the slot: assert once where it is assigned
        for i in range(ln - 2, max(ln - 16, -1), -1):
            m2 = re.match(r'^(\s*val a = al(?:!!)?\[idx\])$', ls[i])
            if m2:
                ls[i] = m2.group(1) + '!!'
                bump('non-null-assertion')
                break
            if re.match(r'^\s*val a = al(?:!!)?\[idx\]!!$', ls[i]):
                break
        else:
            errors.append(f'[slot-read] no al[..] read or slot local at {rel}:{ln}: {ls[ln - 1].strip()}')
    texts[rel] = '\n'.join(ls)

if errors:
    print('\n'.join(errors))
    sys.exit(1)
for rel, s in texts.items():
    (ROOT / rel).write_text(s)
print(counts, 'files:', len(texts))
