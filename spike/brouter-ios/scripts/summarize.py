#!/usr/bin/env python3
"""Summarize simulator runs: per-route timing and footprint, repeat growth and bundle size.

usage: summarize.py <build-dir>

Reads <build-dir>/results/<candidate>/*.jsonl (the SPIKE lines run-sim.sh kept) and
<build-dir>/<candidate>/size.json, and prints Markdown tables.
"""
import json
import sys
from pathlib import Path


def records(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def main():
    build = Path(sys.argv[1])
    results = build / "results"
    stub = build / "stub" / "size-default.json"
    stub_bytes = json.loads(stub.read_text())["totalBytes"] if stub.exists() else None

    for cand_dir in sorted(p for p in results.iterdir() if p.is_dir()):
        cand = cand_dir.name
        print(f"\n### {cand}\n")
        for size in sorted((build / cand).glob("size-*.json")):
            s = json.loads(size.read_text())
            delta = f", +{(s['totalBytes'] - stub_bytes) / 1e6:.1f} MB over the stub app" if stub_bytes else ""
            print(f"Bundle ({s['variant']}): executable {s['executableBytes'] / 1e6:.1f} MB, "
                  f"frameworks {s['frameworksBytes'] / 1e6:.1f} MB{delta}\n")

        routes, repeats, starts = [], {}, {}
        for f in sorted(cand_dir.glob("*.jsonl")):
            for r in records(f):
                if r.get("event") == "start":
                    starts[f.stem] = r
                elif r.get("event") == "route":
                    routes.append((f.stem, r))
                elif r.get("event") == "repeat":
                    repeats.setdefault(f.stem, []).append(r)

        if routes:
            print("| run | route | pass | ms | footprint before MB | peak during MB | after MB | error |")
            print("|---|---|---|---:|---:|---:|---:|---|")
            for label, r in routes:
                pass_ = "cold" if r["run"] == 0 else "warm"
                print(f"| {label} | {r['route']} | {pass_} | {r['ms']:.0f} | {r['footprintBeforeMB']} | {r['peakDuringMB']} | {r['footprintAfterMB']} | {r.get('error', '')} |")

        for label, rs in repeats.items():
            start = starts.get(label, {})
            settled = [r["footprintSettledMB"] for r in rs]
            ms = [r["ms"] for r in rs]
            errors = sum(1 for r in rs if "error" in r)
            print(f"\n{label}: {len(rs)} runs of {rs[0]['route']}, launch footprint {start.get('footprintMB')} MB, "
                  f"settled after run 1 {settled[0]} MB, after run {len(rs)} {settled[-1]} MB "
                  f"(growth {settled[-1] - settled[0]:+.1f} MB), max peak {max(r['peakDuringMB'] for r in rs)} MB, "
                  f"ms first/median/last {ms[0]:.0f}/{sorted(ms)[len(ms) // 2]:.0f}/{ms[-1]:.0f}, errors {errors}")
            print("settled MB per run: " + " ".join(f"{v:.0f}" for v in settled))


if __name__ == "__main__":
    main()
