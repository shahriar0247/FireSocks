#!/usr/bin/env python3
"""Compare two talos result sets. Usage: compare.py baseline.json candidate.json"""
import json
import sys


def suites(path):
    with open(path) as f:
        data = json.load(f)
    out = {}
    for name, s in data.get("suites", {}).items():
        for sub, v in s.get("subtests", {}).items():
            out[f"{name}/{sub}"] = v.get("value")
        out[name] = s.get("value")
    return out


def main():
    a = suites(sys.argv[1])
    b = suites(sys.argv[2])
    lower_is_better = "tp6" in sys.argv[1] or "tp6" in sys.argv[2]
    rows = []
    for k in sorted(set(a) & set(b)):
        if a[k] is None or b[k] is None or a[k] == 0:
            continue
        pct = (b[k] - a[k]) / a[k] * 100
        # normalize: positive % = faster
        pct = -pct if lower_is_better else pct
        rows.append((k, a[k], b[k], pct))
    rows.sort(key=lambda r: r[3])
    print(f"{'test':60} {'base':>12} {'new':>12} {'faster%':>8}")
    for k, va, vb, p in rows:
        mark = "  <-- REGRESSION" if p < -2 else ("  <-- WIN" if p > 2 else "")
        print(f"{k:60} {va:12.2f} {vb:12.2f} {p:7.2f}%{mark}")


if __name__ == "__main__":
    main()
