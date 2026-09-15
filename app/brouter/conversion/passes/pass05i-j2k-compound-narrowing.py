#!/usr/bin/env python3
"""Fix pass 05i: Java evaluates `floatVar += doubleExpr` as `floatVar = (float)(floatVar + doubleExpr)`; J2K emitted
`floatVar += doubleExpr.toFloat()`, which narrows before adding. The accumulated rounding differs (StdPath energy is
off by 1 J in the messages table; elevation_buffer feeds travel time)."""
import pathlib, sys
p = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools/router/StdPath.kt')
s = p.read_text()
edits = [
    ('elevation_buffer += delta_h.toFloat()', 'elevation_buffer = (elevation_buffer + delta_h).toFloat()'),
    ('stdTotalEnergy += energy.toFloat()', 'stdTotalEnergy = (stdTotalEnergy + energy).toFloat()'),
]
for old, new in edits:
    if s.count(old) != 1:
        print('expected 1x:', old); sys.exit(1)
    s = s.replace(old, new)
p.write_text(s)
print({'translation-bug-compound-narrowing': len(edits)})
