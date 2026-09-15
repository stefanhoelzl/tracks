#!/usr/bin/env python3
"""Fix pass 05h: J2K translated Java primitive casts `(int) (expr)` into Kotlin type casts `(expr) as Int`, which
throw ClassCastException on a Double at run time (every route fails in waypoint matching). -> `.toInt()`."""
import pathlib, re, sys
ROOT = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools')
files = {'mapaccess/WaypointMatcherImpl.kt': 2, 'router/RoutingContext.kt': 2}
texts, errors, n_total = {}, [], 0
for rel, want in files.items():
    s = (ROOT / rel).read_text()
    new, n = re.subn(r'\(([^()\n]*)\) as (Int|Long|Short|Byte|Float|Double)\b', lambda m: f'({m.group(1)}).to{m.group(2)}()', s)
    if n != want:
        errors.append(f'{rel}: expected {want}, found {n}')
    texts[rel] = new
    n_total += n
if errors:
    print('\n'.join(errors)); sys.exit(1)
for rel, s in texts.items():
    (ROOT / rel).write_text(s)
print({'translation-bug-primitive-cast': n_total})
