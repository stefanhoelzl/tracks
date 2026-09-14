#!/usr/bin/env python3
"""Classify cycle_finder output: which reported cycles run through BRouter's own types.

usage: cycles.py <cycle_finder.txt>

A cycle made only of JRE types is J2ObjC's runtime problem, not ours. A cycle with at least one
btools type is one that translated BRouter code can leak through under ARC-style refcounting.
"""
import re
import sys
from collections import Counter


def main():
    text = open(sys.argv[1]).read()
    blocks = text.split("***** Found reference cycle *****")[1:]
    ours, jre_only = [], 0
    for block in blocks:
        full = block.split("----- Full Types -----")[-1]
        types = re.findall(r"L([\w/$]+)", full)
        own = sorted({t.split("/")[-1] for t in types if t.startswith("btools/")})
        if own:
            path = [line.strip() for line in block.split("----- Full Types -----")[0].strip().splitlines()]
            ours.append((own, path))
        else:
            jre_only += 1
    print(f"{len(blocks)} cycles reported; {len(ours)} involve btools types; {jre_only} are JRE-only")
    counts = Counter(t for own, _ in ours for t in own)
    print("btools types by number of cycles: " + ", ".join(f"{t} {n}" for t, n in counts.most_common()))
    for own, path in ours:
        print("\n- " + " / ".join(own))
        for step in path:
            print("    " + step)


if __name__ == "__main__":
    main()
