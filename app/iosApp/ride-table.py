#!/usr/bin/env python3
"""Summarises measured rides (ride-measure.sh's results, or the desktop harness's --measure files): one row per run,
medians of the samples after the first 15 s, and the difference between any pairs asked for.

    ./ride-table.py <results-dir> [base:other ...]

    ./ride-table.py build/ride-measure-20260922 base:cap-off base:base-repeat

What each column is: app/docs/PROFILING.md.
"""
import json
import pathlib
import statistics
import sys

SETTLE_S = 15  # the first samples carry the launch, the style load and the seeded journal's read


def rows(path):
    samples = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    return [s for s in samples if s['elapsedS'] > SETTLE_S]


def med(samples, key):
    v = [s[key] for s in samples if s.get(key) is not None]
    return statistics.median(v) if v else float('nan')


def thread(samples, name):
    return statistics.median([s.get('threads', {}).get(name, 0.0) for s in samples])


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = pathlib.Path(sys.argv[1])
    runs = {p.stem.removeprefix('ride-'): rows(p) for p in sorted(out.glob('*.jsonl'), key=lambda p: p.stat().st_mtime)}
    print(f"{'run':<16}{'n':>3}{'cores':>7}{'mapFps':>7}{'idle/s':>7}{'head/s':>7}  {'recompose R/RS/TM/MLM':<22}"
          f"{'render':>7}{'gcd':>6}{'main':>6}{'mapthr':>7}{'GC':>6}  thermal")
    cores = {}
    for name, r in runs.items():
        if not r:
            print(f'{name:<16} no samples')
            continue
        cores[name] = med(r, 'cpuCores')
        rc = '/'.join(f"{med(r, f'recompose_{k}PerS'):.0f}" for k in ('riding', 'ridingScreen', 'tracksMap', 'mapLibreMap'))
        print(f"{name:<16}{len(r):>3}{cores[name]:>7.3f}{med(r, 'mapFps'):>7.1f}{med(r, 'idlesPerS'):>7.1f}"
              f"{med(r, 'headingsPerS'):>7.1f}  {rc:<22}{thread(r, 'maplibre-compose-render'):>7.3f}"
              f"{thread(r, 'unnamed'):>6.3f}{thread(r, 'main'):>6.3f}{thread(r, 'maplibre-compose-map'):>7.3f}"
              f"{thread(r, 'Main GC thread'):>6.3f}  {','.join(sorted({s['thermal'] for s in r}))}")
    if len(sys.argv) > 2:
        print()
    for pair in sys.argv[2:]:
        a, b = pair.split(':')
        if a in cores and b in cores:
            d = cores[b] - cores[a]
            print(f"  {a} -> {b:<24} {cores[a]:.3f} -> {cores[b]:.3f}  {d:+.3f} cores ({d / cores[a] * 100:+.1f}%)")
        else:
            print(f"  {pair}: no such run")


if __name__ == '__main__':
    main()
