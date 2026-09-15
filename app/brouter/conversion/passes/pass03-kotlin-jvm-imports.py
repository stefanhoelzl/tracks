#!/usr/bin/env python3
"""Fix pass 03: kotlin.jvm annotations need explicit imports in common code.

@JvmField, @JvmStatic, @JvmOverloads, @JvmName and @Synchronized are optional expectations: real on the JVM,
ignored on Native. Common source sets do not import kotlin.jvm.* by default, so each file that uses one
gets the import. Run from anywhere: paths resolve from this script.; prints per-annotation counts.
"""
import pathlib
import re

root = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools')
pkgs = ['codec', 'expressions', 'mapaccess', 'router', 'util']
ANNOTATIONS = ['JvmField', 'JvmStatic', 'JvmOverloads', 'JvmName', 'Synchronized']

counts = {a: 0 for a in ANNOTATIONS}
files = 0
for pkg in pkgs:
    for f in sorted((root / pkg).rglob('*.kt')):
        s = f.read_text()
        o = s
        need = []
        for a in ANNOTATIONS:
            n = len(re.findall(rf'@{a}\b', s))
            if n and f'import kotlin.jvm.{a}' not in s:
                need.append(a)
            counts[a] += n
        if need:
            imports = list(re.finditer(r'^import .*$', s, flags=re.M))
            pos = imports[-1].end() if imports else re.search(r'^package .*$', s, flags=re.M).end()
            s = s[:pos] + ''.join(f'\nimport kotlin.jvm.{a}' for a in need) + s[pos:]
        if s != o:
            f.write_text(s)
            files += 1
print({k: v for k, v in counts.items() if v})
print('files changed:', files)
