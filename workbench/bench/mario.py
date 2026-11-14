#!/usr/bin/env python3
"""Minimal Marionette client: launches the browser, drives chrome-context JS.

Usage: mario.py <exe> <script-file> [extra-pref=val ...]
The script file is executed with system privileges in the browser chrome
window's context; `window`, `gBrowser`, `Services`, `document` are available.
Prints the script's return value as JSON.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time


def send_msg(sock, msg):
    data = json.dumps(msg).encode()
    sock.sendall(str(len(data)).encode() + b":" + data)


def recv_msg(sock, buf):
    while b":" not in buf:
        buf += sock.recv(65536)
    length, _, rest = buf.partition(b":")
    n = int(length)
    while len(rest) < n:
        rest += sock.recv(65536)
    return json.loads(rest[:n]), rest[n:]


def main():
    exe, script_path = sys.argv[1], sys.argv[2]
    extra_prefs = sys.argv[3:]
    script = open(script_path, encoding="utf-8").read()
    prof = tempfile.mkdtemp(prefix="mario-")
    userjs = os.path.join(prof, "user.js")
    with open(userjs, "w", encoding="utf-8") as f:
        f.write('user_pref("marionette.enabled", true);\n')
        for p in extra_prefs:
            name, _, val = p.partition("=")
            f.write(f'user_pref("{name}", {val});\n')
    env = dict(os.environ)
    env["MOZ_REMOTE_ALLOW_SYSTEM_ACCESS"] = "1"
    proc = subprocess.Popen(
        [exe, "-no-remote", "-marionette", "-profile", prof, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
    )
    sock = None
    buf = b""
    try:
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                sock = socket.create_connection(("127.0.0.1", 2828), timeout=5)
                break
            except OSError:
                time.sleep(1)
        if not sock:
            raise RuntimeError("marionette never came up")
        _hello, buf = recv_msg(sock, buf)
        send_msg(sock, [0, 1, "WebDriver:NewSession", {"capabilities": {}}])
        resp, buf = recv_msg(sock, buf)
        if resp[2]:
            raise RuntimeError(f"NewSession failed: {resp}")
        send_msg(sock, [0, 2, "Marionette:SetContext", {"value": "chrome"}])
        _r, buf = recv_msg(sock, buf)
        mid = 3
        scripts = script.split("//__MARIO_NEXT__")
        for part in scripts:
            is_async = "//__MARIO_ASYNC__" in part
            part = part.replace("//__MARIO_ASYNC__", "")
            if is_async:
                send_msg(sock, [0, mid, "WebDriver:ExecuteAsyncScript",
                                {"script": part, "args": [], "sandbox": "system"}])
            else:
                send_msg(sock, [0, mid, "WebDriver:ExecuteScript",
                                {"script": part, "args": [], "sandbox": "system"}])
            resp, buf = recv_msg(sock, buf)
            print(json.dumps(resp[3], indent=2, default=str))
            mid += 1
            time.sleep(1.5)
    finally:
        try:
            if sock:
                send_msg(sock, [0, 99, "Marionette:Quit", {}])
                recv_msg(sock, buf)
        except Exception:
            pass
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
