#!/usr/bin/env python3
"""Fix pass 05g: a Java field + an explicit Java accessor method become a Kotlin property whose generated JVM
accessor clashes with the method (JVM backend only). The property accessor gets another JVM name; callers keep
calling the Java-style method."""
import pathlib, re, sys
ROOT = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools')
edits = [
    ('router/RoutingContext.kt', r'^(\s*)(var alternativeIdx: Int = 0.*)$', r'\1@set:kotlin.jvm.JvmName("setAlternativeIdxProperty")\n\1\2'),
    ('router/RoutingEngine.kt', r'^(\s*)(protected var foundTrack: OsmTrack\? = OsmTrack\(\).*)$', r'\1@get:kotlin.jvm.JvmName("getFoundTrackProperty")\n\1\2'),
]
texts, errors = {}, []
for rel, pat, rep in edits:
    s = texts.get(rel) or (ROOT / rel).read_text()
    new, n = re.subn(pat, rep, s, count=1, flags=re.M)
    if n != 1:
        errors.append(f'{rel}: no match for {pat}')
    texts[rel] = new
if errors:
    print('\n'.join(errors)); sys.exit(1)
for rel, s in texts.items():
    (ROOT / rel).write_text(s)
print({'jvm-signature-clash': len(edits)})
