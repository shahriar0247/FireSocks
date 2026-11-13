#!/usr/bin/env python3
"""Paired A/B report over ab.sh results.

Usage: report.py <label> [test ...] [--aa] [--json-only]

Reads workbench/bench/results/<label>-<test>-<side>-b<block>-<seq>.*.
Blocks with any failed/missing run are excluded; if the count of complete
blocks < manifest blocks, the report exits 2 (incomplete data cannot produce
a successful comparison). --aa splits control runs in two halves for a
same-binary noise estimate.
"""
import glob
import json
import math
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from extract import extract  # noqa: E402

RESULTS = os.path.join(HERE, "results")
RUN_RE = re.compile(r"^(?P<label>.+)-(?P<test>.+)-(?P<side>control|treatment)-b(?P<block>\d+)-(?P<seq>.+)\.browsertime\.json$")


def percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def bootstrap_ci(diffs, iters=20000, alpha=0.05, seed=42):
    rng = random.Random(seed)
    n = len(diffs)
    means = sorted(sum(rng.choices(diffs, k=n)) / n for _ in range(iters))
    return means[int(alpha / 2 * iters)], means[int((1 - alpha / 2) * iters)]


def collect(label, test):
    """-> {block: {side: [run scores]}}, failed runids, iter lists."""
    blocks, failed, iters = {}, [], {"control": [], "treatment": []}
    for path in sorted(glob.glob(os.path.join(RESULTS, f"{label}-{test}-*-b*-*.browsertime.json"))):
        m = RUN_RE.match(os.path.basename(path))
        if not m:
            continue
        runid = os.path.basename(path)[: -len(".browsertime.json")]
        if os.path.exists(os.path.join(RESULTS, runid + ".FAILED")):
            failed.append(runid)
            continue
        try:
            data = extract(path)
        except Exception as e:
            failed.append(f"{runid} (extract: {e})")
            continue
        side, block = m.group("side"), int(m.group("block"))
        blocks.setdefault(block, {}).setdefault(side, []).append(data["score"])
        iters[side].extend(data["iterations"])
    return blocks, failed, iters


def subtest_table(label, test, limit=12):
    """Per-subtest mean C vs T across complete runs; top |relative| deltas."""
    agg = {"control": {}, "treatment": {}}
    for path in sorted(glob.glob(os.path.join(RESULTS, f"{label}-{test}-*-b*-*.browsertime.json"))):
        runid = os.path.basename(path)[: -len(".browsertime.json")]
        m = RUN_RE.match(runid)
        if not m or os.path.exists(os.path.join(RESULTS, runid + ".FAILED")):
            continue
        try:
            data = extract(path)
        except Exception:
            continue
        for name, val in data["subtests"].items():
            agg[m.group("side")].setdefault(name, []).append(val)
    rows = []
    for name in set(agg["control"]) & set(agg["treatment"]):
        c = sum(agg["control"][name]) / len(agg["control"][name])
        t = sum(agg["treatment"][name]) / len(agg["treatment"][name])
        if c > 0:
            rows.append((name, c, t, (t - c) / c * 100))
    rows.sort(key=lambda r: -abs(r[3]))
    return rows[:limit]


def analyze(label, test, expected_blocks):
    blocks, failed, iters = collect(label, test)
    complete = {}
    for b, sides in blocks.items():
        if sides.get("control") and sides.get("treatment"):
            complete[b] = sides
    diffs, pcts = [], []
    for b in sorted(complete):
        c = sum(complete[b]["control"]) / len(complete[b]["control"])
        t = sum(complete[b]["treatment"]) / len(complete[b]["treatment"])
        diffs.append(t - c)
        pcts.append((t - c) / c * 100 if c else 0)
    n = len(diffs)
    incomplete = failed or n < expected_blocks
    result = {
        "label": label, "test": test,
        "complete_blocks": n, "expected_blocks": expected_blocks,
        "failed_runs": failed, "status": "INCOMPLETE" if incomplete else "OK",
        "block_diffs": diffs, "block_pcts": pcts,
    }
    if n >= 2:
        mean_d = sum(diffs) / n
        lo, hi = bootstrap_ci(diffs)
        result.update({
            "mean_diff": mean_d, "median_diff": percentile(sorted(diffs), 0.5),
            "ci95": [lo, hi], "ci95_pct": [lo / (sum(diffs) / n - mean_d + sum(diffs) / n) if False else None],
            "mean_pct": sum(pcts) / n,
            "winsor_p95_iters": {
                "control": percentile(sorted(iters["control"]), 0.95),
                "treatment": percentile(sorted(iters["treatment"]), 0.95),
            },
            "verdict": ("improvement" if lo > 0 else "regression" if hi < 0
                        else "inconclusive"),
        })
    return result


def aa_split(label, test):
    """A/A noise: split control runs by block order into two halves."""
    runs = []
    for path in sorted(glob.glob(os.path.join(RESULTS, f"{label}-{test}-control-b*-*.browsertime.json"))):
        runid = os.path.basename(path)[: -len(".browsertime.json")]
        if os.path.exists(os.path.join(RESULTS, runid + ".FAILED")):
            continue
        m = RUN_RE.match(os.path.basename(path))
        try:
            runs.append((int(m.group("block")), extract(path)["score"]))
        except Exception:
            pass
    runs.sort()
    half = len(runs) // 2
    a = [s for _, s in runs[:half]]
    b = [s for _, s in runs[half:2 * half]]
    if len(a) < 2 or len(b) < 2:
        return {"status": "insufficient control runs", "n": len(runs)}
    diffs = [b[i] - a[i] for i in range(min(len(a), len(b)))]
    lo, hi = bootstrap_ci(diffs)
    return {
        "status": "OK", "half_a": a, "half_b": b,
        "mean_diff": sum(diffs) / len(diffs), "ci95": [lo, hi],
        "note": "same binary both halves; CI containing 0 = healthy harness",
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    label = args[0]
    manifest_path = os.path.join(RESULTS, f"{label}.manifest.json")
    if os.path.exists(manifest_path):
        manifest = json.load(open(manifest_path))
        tests = args[1:] or manifest.get("tests", "").split(",")
        expected = manifest.get("blocks", 6)
    else:
        tests = args[1:] or ["speedometer3", "jetstream3"]
        expected = int(os.environ.get("BLOCKS", "6"))
    rc = 0
    reports = {}
    for test in tests:
        r = aa_split(label, test) if "--aa" in flags else analyze(label, test, expected)
        reports[test] = r
        print(f"\n=== {test} ===")
        print(json.dumps(r, indent=2) if "--verbose" in flags else
              {k: v for k, v in r.items() if k not in ("block_diffs", "block_pcts", "failed_runs")})
        if r.get("failed_runs"):
            print("FAILED RUNS:", r["failed_runs"])
        if "--aa" not in flags:
            if r.get("status") == "INCOMPLETE":
                rc = 2
            elif r.get("verdict") == "inconclusive":
                rc = max(rc, 1)
            st = subtest_table(label, test)
            if st:
                print(f"top subtest |delta| (rel %):")
                for name, c, t, pct in st:
                    print(f"  {name:45} {c:12.2f} {t:12.2f} {pct:+7.2f}%")
    out = os.path.join(RESULTS, f"{label}-report.json")
    json.dump(reports, open(out, "w"), indent=2)
    print(f"\nreport → {out}")
    sys.exit(rc)


if __name__ == "__main__":
    main()
