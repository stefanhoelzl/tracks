#!/usr/bin/env python3
"""Compare BRouter GeoJSON tracks route by route.

usage: compare.py <reference-dir> <candidate-dir> [--json]

For every <id>.geojson in the reference dir, reports whether the candidate's
geometry is identical (same points, same elevations, same order) and, when it
is not, how far apart the two lines are (discrete Hausdorff distance in metres).
Numeric properties are compared exactly, since the same engine on the same rd5
should produce the same integers.
"""
import json
import math
import sys
from pathlib import Path

PROPS = ["track-length", "filtered ascend", "plain-ascend", "total-time", "total-energy", "cost"]
CELL_M = 100.0


def load(path):
    feature = json.loads(path.read_text())["features"][0]
    return feature["geometry"]["coordinates"], feature["properties"]


def metres(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    dx = (a[0] - b[0]) * 111320.0 * math.cos(lat)
    dy = (a[1] - b[1]) * 110540.0
    return math.hypot(dx, dy)


def cell(p):
    return (int(p[0] * 111320.0 * math.cos(math.radians(p[1])) // CELL_M), int(p[1] * 110540.0 // CELL_M))


def directed(src, dst):
    grid = {}
    for p in dst:
        grid.setdefault(cell(p), []).append(p)
    worst = 0.0
    for p in src:
        cx, cy = cell(p)
        best = math.inf
        for ring in range(0, 50):
            for x in range(cx - ring, cx + ring + 1):
                for y in range(cy - ring, cy + ring + 1):
                    if max(abs(x - cx), abs(y - cy)) != ring:
                        continue
                    for q in grid.get((x, y), ()):
                        best = min(best, metres(p, q))
            # a point found in ring r is at most (r+1) cells away; one more ring settles it
            if best <= ring * CELL_M:
                break
        worst = max(worst, best)
    return worst


def compare(ref_path, cand_path):
    ref, ref_props = load(ref_path)
    cand, cand_props = load(cand_path)
    result = {
        "points": [len(ref), len(cand)],
        "identical_geometry": ref == cand,
        "props": {k: [ref_props.get(k), cand_props.get(k)] for k in PROPS},
    }
    result["props_equal"] = all(a == b for a, b in result["props"].values())
    # "creator" carries OsmTrack.version, read from jar metadata that neither iOS runtime has
    # (J2ObjC prints null, MobiVM 0.0); every other byte is expected to match.
    strip = lambda p: [l for l in p.read_text().splitlines() if '"creator":' not in l]
    result["bytes_identical_except_creator"] = strip(ref_path) == strip(cand_path)
    if not result["identical_geometry"]:
        result["hausdorff_m"] = round(max(directed(ref, cand), directed(cand, ref)), 1)
    return result


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ref_dir, cand_dir = Path(args[0]), Path(args[1])
    out = {}
    for ref_path in sorted(ref_dir.glob("*.geojson")):
        cand_path = cand_dir / ref_path.name
        out[ref_path.stem] = compare(ref_path, cand_path) if cand_path.exists() else {"missing": True}
    if "--json" in sys.argv:
        print(json.dumps(out, indent=2))
        return
    for rid, r in out.items():
        if r.get("missing"):
            print(f"{rid:32} MISSING")
            continue
        geo = "identical" if r["identical_geometry"] else f"differs (hausdorff {r['hausdorff_m']} m, points {r['points'][0]} vs {r['points'][1]})"
        diffs = ", ".join(f"{k} {a}->{b}" for k, (a, b) in r["props"].items() if a != b) or "all equal"
        print(f"{rid:32} geometry {geo}; props {diffs}")
    sys.exit(0 if all(not r.get("missing") and r["identical_geometry"] and r["props_equal"] for r in out.values()) else 1)


if __name__ == "__main__":
    main()
