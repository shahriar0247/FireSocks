#!/usr/bin/env bash
# Paired A/B benchmark harness for FireSocks.
#
# Usage: ab.sh <label> <control-binary> <treatment-binary>
#   binary args: path to .app bundle OR the executable inside it.
# Env:
#   TESTS=speedometer3,jetstream3   tests, comma-separated
#   BLOCKS=6                        paired blocks per test (ABBA)
#   HEADLESS=1                      headless runs (tp6 needs HEADLESS=0)
#   PAUSE=60                        seconds between runs
#   COOLDOWN_MAX=900                max seconds to wait for thermal idle
#   LOADAVG_MAX=4                   required loadavg1 before starting a run
#   MAX_FAIL_STREAK=2               abort after this many consecutive failures
#   MOZCONFIG=...                   objdir context for mach raptor (default: root mozconfig)
#
# Results → workbench/bench/results/<label>-<test>-<side>-b<block>-<seq>.* plus
# <label>.manifest.json. report.py refuses incomplete blocks.

set -euo pipefail
if [ -z "${CAFFEINATED:-}" ]; then
  CAFFEINATED=1 exec caffeinate -dimsu bash "$0" "$@"
fi

LABEL=${1:?usage: ab.sh <label> <control> <treatment>}
CONTROL=${2:?control binary required}
TREATMENT=${3:?treatment binary required}
TESTS=${TESTS:-speedometer3,jetstream3}
BLOCKS=${BLOCKS:-6}
HEADLESS=${HEADLESS:-1}
PAUSE=${PAUSE:-60}
COOLDOWN_MAX=${COOLDOWN_MAX:-900}
LOADAVG_MAX=${LOADAVG_MAX:-4}
MAX_FAIL_STREAK=${MAX_FAIL_STREAK:-2}

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$SRC/workbench/bench/results"
ART="$SRC/artifacts/ab-$LABEL"
RESULTS_DIR="$SRC/testing/mozharness/build/blobber_upload_dir/browsertime-results"
mkdir -p "$OUT" "$ART"

# raptor requires python <=3.13 — shim python3.11 ahead of system python.
PY_SHIM=/tmp/py311-bin
if [ ! -x "$PY_SHIM/python3" ]; then
  mkdir -p "$PY_SHIM"
  ln -sf /opt/homebrew/bin/python3.11 "$PY_SHIM/python3"
fi
export PATH="$PY_SHIM:$PATH"

abspath() {  # make path absolute (raptor resolves -b against its own cwd)
  case "$1" in /*) echo "$1" ;; *) echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" ;; esac
}

resolve_binary() {
  local b=$1
  if [ -d "$b" ] && [[ "$b" == *.app ]]; then
    for exe in firesocks firefox Nightly; do
      [ -x "$b/Contents/MacOS/$exe" ] && { abspath "$b/Contents/MacOS/$exe"; return; }
    done
    echo "ERROR: no executable in $b/Contents/MacOS" >&2; return 1
  elif [ -x "$b" ]; then
    abspath "$b"
  else
    echo "ERROR: binary not found: $b" >&2; return 1
  fi
}

CONTROL_BIN=$(resolve_binary "$CONTROL")
TREATMENT_BIN=$(resolve_binary "$TREATMENT")
echo "control:   $CONTROL_BIN"
echo "treatment: $TREATMENT_BIN"

GIT_HEAD=$(git -C "$SRC" rev-parse HEAD)
GIT_DIRTY=$(git -C "$SRC" status --porcelain -- workbench/bench mozconfig | head -5)
CLANG_VER=$("$HOME/.mozbuild/clang/bin/clang" --version 2>/dev/null | head -1 || true)
OS_VER=$(sw_vers -productVersion 2>/dev/null || true)
HW_MODEL=$(sysctl -n hw.model 2>/dev/null || true)
UBOL_SHA=$(shasum -a 256 "$SRC/browser/app/distribution/extensions/"*.xpi 2>/dev/null | awk '{print $1}' | head -1 || true)

provenance() {  # runid side test block seq
  local runid=$1 side=$2 test=$3 block=$4 seq=$5
  python3 - "$OUT/$runid.prov.json" <<EOF
import json, subprocess, time, os
def sh(*a):
    try: return subprocess.run(a, capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception: return ""
binary = "$CONTROL_BIN" if "$side" == "control" else "$TREATMENT_BIN"
prov = {
  "runid": "$runid", "label": "$LABEL", "test": "$test", "side": "$side",
  "block": $block, "seq": $seq, "ts": time.time(), "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
  "binary": binary, "binary_sha256": sh("shasum","-a","256",binary).split(" ")[0],
  "git_head": "$GIT_HEAD", "git_dirty_bench": """$GIT_DIRTY""",
  "mozconfig_sha256": sh("shasum","-a","256",os.environ.get("MOZCONFIG","$SRC/mozconfig")).split(" ")[0],
  "clang": """$CLANG_VER""", "os": """$OS_VER""", "hw": """$HW_MODEL""",
  "ncpu": sh("sysctl","-n","hw.ncpu"), "memsize": sh("sysctl","-n","hw.memsize"),
  "power_source": sh("pmset","-g","ps"), "therm": sh("pmset","-g","therm"),
  "loadavg": sh("sysctl","-n","vm.loadavg"),
  "lowpowermode": sh("pmset","-g").split("lowpowermode")[1].split("\n")[0] if "lowpowermode" in sh("pmset","-g") else "n/a",
  "ubol_xpi_sha256": "$UBOL_SHA", "headless": "$HEADLESS",
}
json.dump(prov, open("$OUT/$runid.prov.json","w"), indent=1)
EOF
}

speed_limit() {  # current CPU_Speed_Limit (100 = unthrottled)
  pmset -g therm 2>/dev/null | awk -F'=' '/CPU_Speed_Limit/{gsub(/ /,"",$2); print $2; exit}'
}
loadavg1() { sysctl -n vm.loadavg | awk '{print $2}'; }

thermal_wait() {
  local waited=0
  while :; do
    local sl la
    sl=$(speed_limit); la=$(loadavg1)
    if { [ -z "$sl" ] || [ "$sl" -ge 100 ]; } \
       && python3 -c "exit(0 if float('$la' or 0) < $LOADAVG_MAX else 1)"; then
      [ "$waited" -gt 0 ] && echo "  thermal/load clear after ${waited}s (limit=${sl:-?} load=$la)"
      return 0
    fi
    if [ "$waited" -ge "$COOLDOWN_MAX" ]; then
      echo "  WARN: cooldown budget exhausted (limit=${sl:-?} load=$la) — run continues, flagged" >&2
      return 1
    fi
    echo "  waiting for thermal idle (limit=${sl:-?} load=$la)…"
    sleep 30; waited=$((waited+30))
  done
}

validate_run() {  # results json exists, parses, has score
  local rjson=$1
  [ -s "$rjson" ] || return 1
  python3 "$SRC/workbench/bench/extract.py" "$rjson" --check >/dev/null 2>&1
}

FAIL_STREAK=0
FAILED_RUNS=()

run_one() {  # test side block seq
  local test=$1 side=$2 block=$3 seq=$4
  local runid="$LABEL-$test-$side-b$block-$seq"
  local bin; [ "$side" = control ] && bin=$CONTROL_BIN || bin=$TREATMENT_BIN
  echo "=== $runid (block $block) ==="
  thermal_wait || true
  provenance "$runid" "$side" "$test" "$block" "$seq"
  local harg=""
  [ "$HEADLESS" = "1" ] && harg="--browsertime-arg headless=true"
  rm -f "$RESULTS_DIR/$test/browsertime.json"
  local rc=0
  (cd "$SRC" && ./mach raptor -t "$test" -b "$bin" $harg) > "$ART/$runid.log" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] && validate_run "$RESULTS_DIR/$test/browsertime.json"; then
    cp "$RESULTS_DIR/$test/browsertime.json" "$OUT/$runid.browsertime.json"
    echo "  ok — $OUT/$runid.browsertime.json"
    FAIL_STREAK=0
  else
    cp "$RESULTS_DIR/$test/browsertime.json" "$OUT/$runid.browsertime.json" 2>/dev/null || true
    echo "FAIL" > "$OUT/$runid.FAILED"
    FAILED_RUNS+=("$runid rc=$rc")
    echo "  FAILED (rc=$rc) — marked, see $ART/$runid.log"
    FAIL_STREAK=$((FAIL_STREAK+1))
    if [ "$FAIL_STREAK" -ge "$MAX_FAIL_STREAK" ]; then
      echo "ABORT: $FAIL_STREAK consecutive failures" >&2
      write_manifest 3; exit 3
    fi
  fi
  sleep "$PAUSE"
}

write_manifest() {  # exit_code
  python3 - "$1" <<'EOF'
import glob, json, os, sys
label = os.environ["LABEL"]; out = os.environ["OUT"]
runs = {}
for p in glob.glob(os.path.join(out, f"{label}-*.prov.json")):
    runid = os.path.basename(p)[:-10]
    runs[runid] = {"prov": p,
                   "browsertime": os.path.join(out, runid + ".browsertime.json"),
                   "failed": os.path.exists(os.path.join(out, runid + ".FAILED"))}
manifest = {"label": label, "tests": os.environ["TESTS"], "blocks": int(os.environ["BLOCKS"]),
            "control": os.environ["CONTROL_BIN"], "treatment": os.environ["TREATMENT_BIN"],
            "exit_hint": int(sys.argv[1]), "runs": runs}
json.dump(manifest, open(os.path.join(out, f"{label}.manifest.json"), "w"), indent=1)
EOF
}
export LABEL OUT TESTS BLOCKS CONTROL_BIN TREATMENT_BIN

# Block schedule: alternate suite order per block; within each block the first
# suite runs ABBA, the second the mirror (BAAB), counterbalancing drift and
# binary order simultaneously.
IFS=',' read -ra TEST_ARR <<< "$TESTS"
for block in $(seq 1 "$BLOCKS"); do
  if [ $((block % 2)) -eq 1 ]; then order=(0 1); else order=(1 0); fi
  for oi in "${!order[@]}"; do
    test=${TEST_ARR[${order[$oi]}]:-}
    [ -z "$test" ] && continue
    if { [ $((block % 2)) -eq 1 ] && [ "$oi" -eq 0 ]; } \
       || { [ $((block % 2)) -eq 0 ] && [ "$oi" -eq 1 ]; }; then
      seqs=(control treatment treatment control)
    else
      seqs=(treatment control control treatment)
    fi
    for idx in "${!seqs[@]}"; do
      run_one "$test" "${seqs[$idx]}" "$block" "$idx"
    done
  done
done

write_manifest 0
if [ "${#FAILED_RUNS[@]}" -gt 0 ]; then
  echo "Completed with FAILED runs: ${FAILED_RUNS[*]}" >&2
  exit 2
fi
echo "All runs OK → report: python3 workbench/bench/report.py $LABEL"
