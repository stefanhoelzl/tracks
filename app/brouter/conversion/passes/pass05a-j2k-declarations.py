#!/usr/bin/env python3
"""Fix pass 05a: mechanical J2K declaration defects, driven by compiler error locations.

usage: pass05a-j2k-declarations.py <jvm-errors.txt> <linuxX64-errors.txt>

Rules (each checks the source text at the reported line before touching it):
  must-init      'Property must be initialized or be abstract' ->
                 nullable type: `= null`; primitive: its default; other non-null type: `lateinit`
                 (and drop a preceding @JvmField, which lateinit does not allow); `val` becomes `var`
  jvmfield-iface 'This annotation is not applicable to target ...' on @JvmField in an interface -> removed
  override       "'x' hides member of supertype ... needs an 'override' modifier" -> `override` added
  deleteAt       "'deleteCharAt' is deprecated. Use deleteAt" -> deleteAt
  companion-field  `get() = Companion.field` (J2K emits a getter on a companion constant) -> removed
  cycle-getters  getter calls on Kinematic*Model converted before the model (dependency cycle) -> properties
"""
import pathlib
import re
import sys

ROOT = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin')
PRIMITIVE_DEFAULTS = {'Int': '0', 'Long': '0L', 'Short': '0', 'Byte': '0', 'Float': '0f', 'Double': '0.0',
                      'Boolean': 'false', 'Char': "'\\u0000'"}

def parse(path):
    out = []
    for line in pathlib.Path(path).read_text().splitlines():
        m = re.match(r'^e: (btools/[^:]+):(\d+):(\d+) (.*)$', line)
        if m:
            out.append((m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)))
    return out

errors = parse(sys.argv[1]) + [e for e in parse(sys.argv[2]) if 'deleteAt' in e[3]]
errors = [e for e in errors if not e[0].startswith('btools/kmp/')]  # hand-written code is not J2K output
files = {}
def lines_of(rel):
    if rel not in files:
        files[rel] = (ROOT / rel).read_text().split('\n')
    return files[rel]

counts = {}
def count(rule):
    counts[rule] = counts.get(rule, 0) + 1

deletions = {}  # rel -> set of 0-based line indexes to delete
seen = set()
problems = []
for rel, ln, col, msg in errors:
    key = (rel, ln, msg)
    if key in seen:
        continue
    seen.add(key)
    L = lines_of(rel)
    i = ln - 1
    text = L[i]
    if msg.startswith('Property must be initialized'):
        m = re.match(r'^(\s*)((?:(?:private|protected|internal|public|open|override) )*)(var|val) (\w+): (.+?)\s*(//.*)?$', text)
        if not m or '=' in m.group(5):
            problems.append(f'must-init: unexpected text {rel}:{ln}: {text.strip()}')
            continue
        indent, mods, _, name, typ, comment = m.groups()
        comment = ('  ' + comment) if comment else ''
        if typ.endswith('?'):
            L[i] = f'{indent}{mods}var {name}: {typ} = null{comment}'
        elif typ in PRIMITIVE_DEFAULTS:
            L[i] = f'{indent}{mods}var {name}: {typ} = {PRIMITIVE_DEFAULTS[typ]}{comment}'
        else:
            L[i] = f'{indent}{mods}lateinit var {name}: {typ}{comment}'
            if i > 0 and L[i - 1].strip() == '@JvmField':
                deletions.setdefault(rel, set()).add(i - 1)
        count('must-init')
    elif msg.startswith('This annotation is not applicable') and text.strip() == '@JvmField':
        deletions.setdefault(rel, set()).add(i)
        count('jvmfield-iface')
    elif 'hides member of supertype' in msg and "needs an 'override' modifier" in msg:
        m = re.match(r'^(\s*)((?:(?:private|protected|internal|public|open) )*)(var|val) ', text)
        if not m:
            problems.append(f'override: unexpected text {rel}:{ln}: {text.strip()}')
            continue
        L[i] = f'{m.group(1)}{m.group(2)}override {text[m.end(2):]}'
        count('override')
    elif 'deleteAt' in msg and 'deleteCharAt(' in text:
        L[i] = text.replace('deleteCharAt(', 'deleteAt(')
        count('deleteAt')

for rel in ['btools/expressions/BExpressionContextNode.kt', 'btools/expressions/BExpressionContextWay.kt']:
    L = lines_of(rel)
    for i, t in enumerate(L):
        if t.strip() == 'get() = Companion.field':
            deletions.setdefault(rel, set()).add(i)
            count('companion-field')

GETTERS = ['getWayMaxspeedExplicit', 'getWayMaxspeed', 'getWayMinspeed', 'getEffectiveSpeedLimit', 'getNodeMaxspeed']
for rel in ['btools/router/KinematicPath.kt', 'btools/router/KinematicNoCostPath.kt']:
    L = lines_of(rel)
    for i, t in enumerate(L):
        for g in GETTERS:
            prop = g[3].lower() + g[4:]
            new = t.replace(f'km.{g}()', f'km.{prop}')
            if new != t:
                n = t.count(f'km.{g}()')
                t = new
                for _ in range(n):
                    count('cycle-getters')
        L[i] = t

if problems:
    print('\n'.join(problems))
    sys.exit(1)

for rel, L in files.items():
    dels = deletions.get(rel, set())
    (ROOT / rel).write_text('\n'.join(t for i, t in enumerate(L) if i not in dels))
print(counts)
