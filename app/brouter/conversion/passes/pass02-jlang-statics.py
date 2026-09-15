#!/usr/bin/env python3
"""Fix pass 02: java.lang statics and java.util helpers -> common Kotlin, at the call sites.

Mechanical and deterministic; Run from anywhere: paths resolve from this script. Prints per-rule counts.
"""
import pathlib
import re

root = (pathlib.Path(__file__).resolve().parents[2] / 'src/commonMain/kotlin/btools')
pkgs = ['codec', 'expressions', 'mapaccess', 'router', 'util']

# (name, pattern, replacement, imports needed when it fires)
RULES = [
    ('Math.max/min/abs', r'(?<![\w.])Math\.(max|min|abs)\(', r'\1(', lambda m: {f'kotlin.math.{m.group(1)}'}),
    # JDK: toDegrees(x) = x * RADIANS_TO_DEGREES, toRadians(x) = x * DEGREES_TO_RADIANS (exact constants)
    ('Math.toDegrees', r'(?<![\w.])Math\.toDegrees\(', r'btools.kmp.JMath.toDegrees(', lambda m: set()),
    ('Math.toRadians', r'(?<![\w.])Math\.toRadians\(', r'btools.kmp.JMath.toRadians(', lambda m: set()),
    # Java Math.round(float) -> int, Math.round(double) -> long; ties toward +infinity like roundToInt/roundToLong
    ('Math.round', r'(?<![\w.])Math\.round\(', r'btools.kmp.JMath.round(', lambda m: set()),
    ('Math.random', r'(?<![\w.])Math\.random\(\)', r'kotlin.random.Random.nextDouble()', lambda m: set()),
    ('Math.PI', r'(?<![\w.])Math\.PI\b', r'kotlin.math.PI', lambda m: set()),
    ('Math.sqrt/cos/sin/atan2/...', r'(?<![\w.])Math\.(sqrt|cos|sin|tan|atan|atan2|asin|acos|exp|ln|log|pow|floor|ceil)\(', r'kotlin.math.\1(', lambda m: set()),
    ('Boolean.getBoolean', r'(?<![\w.])(?:java\.lang\.)?Boolean\.getBoolean\(', r'System.getBoolean(', lambda m: {'btools.kmp.System'}),
    ('Double.isNaN(x)', r'(?<![\w.])(?:java\.lang\.)?Double\.isNaN\(', r'btools.kmp.JMath.isNaN(', lambda m: set()),
    ('Double.compare', r'(?<![\w.])(?:java\.lang\.)?Double\.compare\(', r'btools.kmp.JMath.compare(', lambda m: set()),
    ('Character.isWhitespace', r'(?<![\w.])Character\.isWhitespace\(', r'btools.kmp.JMath.isWhitespace(', lambda m: set()),
    ('Integer.MAX_VALUE/MIN_VALUE', r'(?<![\w.])Integer\.(MAX_VALUE|MIN_VALUE)\b', r'Int.\1', lambda m: set()),
    ('Collections.sort(list, cmp)', r'(?<![\w.])Collections\.sort(?:<[^>(]*>)?\(', r'btools.kmp.util.JCollections.sort(', lambda m: set()),
    ('Arrays.sort', r'(?<![\w.])Arrays\.sort\(', r'btools.kmp.util.JCollections.sortArray(', lambda m: set()),
    ('Arrays.fill', r'(?<![\w.])Arrays\.fill\(', r'btools.kmp.util.JCollections.fill(', lambda m: set()),
    ('lowercase(Locale.getDefault())', r'\.lowercase\(Locale\.getDefault\(\)\)', r'.lowercase()', lambda m: set()),
    ('uppercase(Locale.getDefault())', r'\.uppercase\(Locale\.getDefault\(\)\)', r'.uppercase()', lambda m: set()),
    ('String.format(Locale.US, "%3.1f", f)', r'String\.format\(Locale\.US, "%3\.1f", ([^\n]*?)\)(\s*$)', r'btools.kmp.TextFormat.fixed1Width3(\1)\2', lambda m: set()),
]

counts = {name: 0 for name, *_ in RULES}
files = 0
for pkg in pkgs:
    for f in sorted((root / pkg).rglob('*.kt')):
        s = f.read_text()
        o = s
        need = set()
        for name, pat, rep, imps in RULES:
            def sub(m, rep=rep, imps=imps, name=name):
                need.update(imps(m))
                counts[name] += 1
                return m.expand(rep)
            s = re.sub(pat, sub, s, flags=re.M)
        for imp in sorted(need):
            if f'import {imp}' not in s:
                imports = list(re.finditer(r'^import .*$', s, flags=re.M))
                pos = imports[-1].end() if imports else re.search(r'^package .*$', s, flags=re.M).end()
                s = s[:pos] + f'\nimport {imp}' + s[pos:]
        if s != o:
            f.write_text(s)
            files += 1
print({k: v for k, v in counts.items() if v})
print('files changed:', files)
