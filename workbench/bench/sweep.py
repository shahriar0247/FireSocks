#!/usr/bin/env python3
"""Preset A/B sweep: runs navtiming.py per speed mode and aggregates.

Each run launches a fresh temp profile with browser.speed.mode=N; SpeedMode
applies its bundle at startup, so this measures the full preset effect.

Usage: sweep.py --exe <path> [--modes 1,0,3] [--sites u,u] [--runs 2]
"""

import argparse
import json
import statistics
import subprocess
import sys

NAVTIMING = sys.path[0] + "/navtiming.py"
MODE_NAMES = {
    0: "performance", 1: "balanced", 2: "fortress", 3: "overdrive",
    4: "netaggressive", 5: "manythreads", 6: "light", 7: "requests",
}


def run_mode(exe, mode, sites, runs):
    cmd = [sys.executable, NAVTIMING, "--exe", exe,
           "--pref", f"browser.speed.mode={mode}",
           "--runs", str(runs)]
    for s in sites:
        cmd += ["--url", s]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    rows = []
    for line in out.stdout.splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


def med(vals):
    vals = [v for v in vals if isinstance(v, (int, float))]
    return round(statistics.median(vals)) if vals else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--modes", default="1,0,3,4,7")
    ap.add_argument("--sites", default="https://github.com/,https://www.youtube.com/")
    ap.add_argument("--runs", type=int, default=2)
    args = ap.parse_args()
    sites = args.sites.split(",")
    modes = [int(m) for m in args.modes.split(",")]

    for mode in modes:
        name = MODE_NAMES.get(mode, str(mode))
        rows = run_mode(args.exe, mode, sites, args.runs)
        for site in sites:
            rs = [r for r in rows if r.get("url") == site and "dcl" in r]
            if not rs:
                print(f"mode={name} site={site} no data")
                continue
            print(json.dumps({
                "mode": name, "site": site, "n": len(rs),
                "dns": med([r["dns"] for r in rs]),
                "tcp": med([r["tcp"] for r in rs]),
                "tls": med([r["tls"] for r in rs]),
                "ttfb": med([r["ttfb"] for r in rs]),
                "dcl": med([r["dcl"] for r in rs]),
                "load": med([r["load"] for r in rs]),
                "res": med([r["resources"] for r in rs]),
            }), flush=True)


if __name__ == "__main__":
    main()
