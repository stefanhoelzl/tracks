#!/usr/bin/env python3
"""Fix pass 05f: DirectWeaver needs a validator; only the integrity check (MicroCache2 branch) passes null."""
import pathlib, sys
p = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools/mapaccess/OsmFile.kt')
s = p.read_text()
old = 'DirectWeaver(bc, dataBuffers, lonIdx, latIdx, divisor, wayValidator, waypointMatcher, hollowNodes)'
if s.count(old) != 1:
    print('expected 1x:', old); sys.exit(1)
p.write_text(s.replace(old, old.replace('wayValidator,', 'wayValidator!!,')))
print({'non-null-assertion': 1})
