#!/usr/bin/env python3
"""Extract suite score, per-iteration scores and subtests from a raptor
browsertime.json. Usage: extract.py <browsertime.json> [--check]"""
import json
import math
import sys


def geomean(vals):
    vals = [v for v in vals if v and v > 0]
    return math.exp(sum(math.log(v) for v in vals) / len(vals)) if vals else None


def load(path):
    with open(path) as f:
        data = json.load(f)
    if not isinstance(data, list) or not data:
        raise ValueError("empty browsertime.json")
    entry = data[0]
    if entry.get("markedAsFailure"):
        raise ValueError("run markedAsFailure: %s" % entry.get("failureMessages"))
    return entry


def extract(path):
    entry = load(path)
    extras = entry.get("extras") or []
    iterations = []      # per-cycle suite scores
    subtests = {}        # name -> list of values across cycles
    cpu_time = None
    wallclock = None

    for ex in extras:
        if not isinstance(ex, dict):
            continue
        cpu_time = cpu_time or (ex.get("cpuTime") or [None])[0]
        wallclock = wallclock or (ex.get("wallclock-for-tracking-only") or [None])[0]
        if "s3" in ex:  # Speedometer 3
            sc = ex["s3"].get("score") or {}
            if sc.get("mean") is not None:
                iterations.append(sc["mean"])
            for it in ex.get("s3_internal") or []:
                for suite, sv in (it.get("tests") or {}).items():
                    total = sv.get("total")
                    if total is not None:
                        subtests.setdefault(suite, []).append(total)
        elif "js3_res" in ex:  # JetStream 3
            res = ex["js3_res"]
            for suite, sv in (res.get("tests") or {}).items():
                cur = ((sv.get("metrics") or {}).get("Score") or {}).get("current")
                if cur:
                    subtests.setdefault(suite, []).append(cur[0])
            if subtests:
                iterations.append(geomean([v[-1] for v in subtests.values()]))
        else:
            for key, val in ex.items():  # generic: first {"score": {"mean": x}}
                if isinstance(val, dict) and isinstance(val.get("score"), dict):
                    if val["score"].get("mean") is not None:
                        iterations.append(val["score"]["mean"])
                        break

    iterations = [i for i in iterations if i is not None]
    if not iterations:
        raise ValueError("no suite score found in %s" % path)
    return {
        "score": sum(iterations) / len(iterations),
        "iterations": iterations,
        "subtests": {k: sum(v) / len(v) for k, v in subtests.items()},
        "cpu_time": cpu_time,
        "wallclock": wallclock,
    }


if __name__ == "__main__":
    try:
        out = extract(sys.argv[1])
    except Exception as e:
        print("extract failed: %s" % e, file=sys.stderr)
        sys.exit(2)
    if "--check" in sys.argv:
        print("OK score=%.3f iters=%d subtests=%d"
              % (out["score"], len(out["iterations"]), len(out["subtests"])))
    else:
        print(json.dumps(out))
