#!/usr/bin/env python3
"""Nav-timing benchmark over WebDriver BiDi (Gecko) or CDP (Chromium).

Drives a browser exe against URLs (or a click-through page sequence),
reporting Navigation Timing breakdown + resource count per load.

Usage:
  navtiming.py --exe <path> --url <u> [--url <u>] [--runs N] [--pref k=v ...]
  navtiming.py --exe <path> --clickthrough <u> [<u> ...] [--runs N]
  navtiming.py --exe <path> --cdp --url <u>
"""

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time

import websockets

import os
PORT = int(os.environ.get("NAVBENCH_PORT", "29333"))
LAUNCH_WAIT_S = 8
LOAD_TIMEOUT_S = 60

TIMING_JS = """
(() => {
  const n = performance.getEntriesByType('navigation')[0];
  if (!n || n.loadEventEnd === 0) return null;
  return {
    dns: n.domainLookupEnd - n.domainLookupStart,
    tcp: n.connectEnd - n.connectStart,
    tls: n.secureConnectionStart > 0 ? n.connectEnd - n.secureConnectionStart : 0,
    ttfb: n.responseStart - n.requestStart,
    download: n.responseEnd - n.responseStart,
    dcl: n.domContentLoadedEventEnd - n.startTime,
    load: n.loadEventEnd - n.startTime,
    transfer: n.transferSize,
    resources: performance.getEntriesByType('resource').length,
  };
})()
"""


def unwrap(v):
    if isinstance(v, list):
        try:
            return {k: unwrap(x) for k, x in v}
        except (TypeError, ValueError):
            return [unwrap(x) for x in v]
    if isinstance(v, dict):
        if "value" in v and set(v) <= {"type", "value"}:
            return unwrap(v["value"])
        return {k: unwrap(x) for k, x in v.items()}
    return v


async def bidi(ws, method, params=None, _id=[0]):
    _id[0] += 1
    await ws.send(json.dumps({"id": _id[0], "method": method, "params": params or {}}))
    while True:
        msg = json.loads(await ws.recv())
        if msg.get("id") == _id[0]:
            if "error" in msg:
                raise RuntimeError(f"{method}: {msg['error']} {msg.get('message')}")
            return msg.get("result", {})


async def timed_load(ws, ctx, url):
    await bidi(ws, "browsingContext.navigate", {"context": ctx, "url": url, "wait": "none"})
    deadline = time.time() + LOAD_TIMEOUT_S
    await asyncio.sleep(0.5)
    while time.time() < deadline:
        res = await bidi(
            ws,
            "script.evaluate",
            {"expression": TIMING_JS, "target": {"context": ctx}, "awaitPromise": True},
        )
        val = unwrap(res.get("result", {}).get("value"))
        if val:
            return val
        await asyncio.sleep(0.5)
    return {"timeout": True}


async def cdp(ws, method, params=None, _id=[1000], session=None):
    _id[0] += 1
    msg = {"id": _id[0], "method": method, "params": params or {}}
    if session:
        msg["sessionId"] = session
    await ws.send(json.dumps(msg))
    while True:
        m = json.loads(await ws.recv())
        if m.get("id") == _id[0]:
            if "error" in m:
                raise RuntimeError(f"{method}: {m['error']}")
            return m.get("result", {})


async def timed_load_cdp(ws, session, url):
    await cdp(ws, "Page.navigate", {"url": url}, session=session)
    deadline = time.time() + LOAD_TIMEOUT_S
    await asyncio.sleep(0.5)
    while time.time() < deadline:
        res = await cdp(
            ws,
            "Runtime.evaluate",
            {"expression": TIMING_JS, "returnByValue": True},
            session=session,
        )
        val = res.get("result", {}).get("value")
        if val:
            return val
        await asyncio.sleep(0.5)
    return {"timeout": True}


def make_profile(prefs):
    prof = tempfile.mkdtemp(prefix="navbench-")
    if prefs:
        with open(os.path.join(prof, "user.js"), "w", encoding="utf-8") as f:
            for kv in prefs:
                name, _, val = kv.partition("=")
                if val == "true" or val == "false":
                    v = val
                else:
                    try:
                        int(val)
                        v = val
                    except ValueError:
                        v = json.dumps(val)
                f.write(f'user_pref("{name}", {v});\n')
    return prof


def launch_gecko(exe, prof):
    return subprocess.Popen(
        [
            exe, "-no-remote", "-profile", prof,
            f"-remote-debugging-port={PORT}",
            "-remote-allow-origins", "*",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def kill_by_port(port):
    """Kill the process tree owning the debug port listener.

    Firefox's launcher re-execs into a real browser process, so terminating
    the Popen handle leaves the browser (and its BiDi session) alive."""
    import re
    try:
        out = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True, text=True, timeout=15,
        ).stdout
        pids = set()
        for line in out.splitlines():
            if f":{port} " in line and "LISTENING" in line:
                pids.add(line.split()[-1])
        for pid in pids:
            subprocess.run(["taskkill", "/PID", pid, "/T", "/F"],
                           capture_output=True)
    except Exception:
        pass


async def run_gecko(exe, urls, runs, prefs, clickthrough):
    prof = make_profile(prefs)
    proc = launch_gecko(exe, prof)
    try:
        await asyncio.sleep(LAUNCH_WAIT_S)
        for _ in range(20):
            try:
                ws = await websockets.connect(
                    f"ws://127.0.0.1:{PORT}/session", max_size=50 * 1024 * 1024
                )
                break
            except Exception:
                await asyncio.sleep(1)
        else:
            raise RuntimeError("BiDi endpoint never came up")
        async with ws:
            try:
                await bidi(ws, "session.end", {})
            except Exception:
                pass
            await bidi(ws, "session.new", {"capabilities": {"alwaysMatch": {}}})
            ctx = (await bidi(ws, "browsingContext.create", {"type": "tab"}))["context"]
            if clickthrough:
                for i in range(runs):
                    for step, url in enumerate(urls):
                        try:
                            r = await timed_load(ws, ctx, url)
                            print(json.dumps({"run": i + 1, "step": step + 1, "url": url, **r}))
                        except Exception as e:
                            print(json.dumps({"run": i + 1, "step": step + 1, "url": url, "error": str(e)}))
            else:
                for url in urls:
                    for i in range(runs):
                        try:
                            r = await timed_load(ws, ctx, url)
                            print(json.dumps({"url": url, "run": i + 1, **r}))
                        except Exception as e:
                            print(json.dumps({"url": url, "run": i + 1, "error": str(e)}))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        kill_by_port(PORT)


async def run_cdp(exe, urls, runs):
    import urllib.request

    prof = tempfile.mkdtemp(prefix="navbench-")
    proc = subprocess.Popen(
        [
            exe, "--no-first-run",
            f"--remote-debugging-port={PORT}",
            f"--user-data-dir={prof}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        ver = None
        for _ in range(30):
            try:
                ver = json.loads(
                    urllib.request.urlopen(
                        f"http://127.0.0.1:{PORT}/json/version", timeout=1
                    ).read()
                )
                break
            except Exception:
                await asyncio.sleep(1)
        if not ver:
            raise RuntimeError("CDP endpoint never came up")
        async with websockets.connect(
            ver["webSocketDebuggerUrl"], max_size=50 * 1024 * 1024
        ) as ws:
            tid = (await cdp(ws, "Target.createTarget", {"url": "about:blank"}))["targetId"]
            session = (await cdp(ws, "Target.attachToTarget", {"targetId": tid, "flatten": True}))["sessionId"]
            await cdp(ws, "Page.enable", session=session)
            for url in urls:
                for i in range(runs):
                    try:
                        r = await timed_load_cdp(ws, session, url)
                        print(json.dumps({"url": url, "run": i + 1, **r}))
                    except Exception as e:
                        print(json.dumps({"url": url, "run": i + 1, "error": str(e)}))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--url", action="append", default=[])
    ap.add_argument("--clickthrough", nargs="+", default=None,
                    help="Sequence of URLs navigated in order per run (click-through session)")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--pref", action="append", default=[],
                    help="k=v written to user.js of the temp profile")
    ap.add_argument("--cdp", action="store_true")
    args = ap.parse_args()
    if args.cdp:
        asyncio.run(run_cdp(args.exe, args.url, args.runs))
    else:
        urls = args.clickthrough or args.url
        if not urls:
            ap.error("--url or --clickthrough required")
        asyncio.run(run_gecko(args.exe, urls, args.runs, args.pref, bool(args.clickthrough)))


if __name__ == "__main__":
    main()
