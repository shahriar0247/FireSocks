#!/usr/bin/env bash
# User-journey measurement matrix (plan 0C). Runs against the objdir build that
# MOZCONFIG resolves to — talos/awsy have no --binary flag.
#
# Usage: journeys.sh <label>
# Env:  HEADFUL=1   also run tp6 recorded pageloads (needs unlocked screen)
#       AWSY=1      also run AWSY memory suite
#       MOZCONFIG   objdir context (default: root mozconfig)
# Logs → artifacts/journeys-<label>-*.log ; manifest → results/<label>-journeys.json
set -uo pipefail
if [ -z "${CAFFEINATED:-}" ]; then
  CAFFEINATED=1 exec caffeinate -dimsu bash "$0" "$@"
fi
LABEL=${1:?usage: journeys.sh <label>}
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$SRC/workbench/bench/results"
ART="$SRC/artifacts"
mkdir -p "$OUT" "$ART"
PY_SHIM=/tmp/py311-bin
mkdir -p "$PY_SHIM"; ln -sf /opt/homebrew/bin/python3.11 "$PY_SHIM/python3" 2>/dev/null || true
export PATH="$PY_SHIM:$PATH"

# Startup / restore / tab journeys — the 'other' suite covers ts_paint,
# sessionrestore(+no_auto_restore+many-windows via suite sessionrestore-many-windows),
# tabpaint, cpstartup, startup_about_home_paint(+cached), twinopen, a11yr,
# cross_origin_pageload, tresize.
echo "=== talos other ==="
./mach talos-test --suite other > "$ART/journeys-$LABEL-talos-other.log" 2>&1
echo "talos rc=$?"

echo "=== talos sessionrestore-many-windows ==="
./mach talos-test --suite sessionrestore-many-windows \
  > "$ART/journeys-$LABEL-talos-srmw.log" 2>&1
echo "srmw rc=$?"

if [ "${HEADFUL:-0}" = "1" ]; then
  for site in youtube amazon google-search cnn; do
    echo "=== raptor tp6 $site ==="
    ./mach raptor -t "$site" > "$ART/journeys-$LABEL-raptor-$site.log" 2>&1
    echo "$site rc=$?"
    rj="$SRC/testing/mozharness/build/blobber_upload_dir/browsertime-results/$site/browsertime.json"
    [ -s "$rj" ] && cp "$rj" "$OUT/$LABEL-$site.browsertime.json"
  done
fi

if [ "${AWSY:-0}" = "1" ]; then
  echo "=== awsy memory ==="
  ./mach awsy-test > "$ART/journeys-$LABEL-awsy.log" 2>&1
  echo "awsy rc=$?"
fi

python3 - "$OUT/$LABEL-journeys.json" <<'EOF'
import json, subprocess, sys, time, os
def sh(*a):
    try: return subprocess.run(a, capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception: return ""
label = os.environ.get("LABEL", "journeys")
json.dump({
  "label": label, "ts": time.time(),
  "git_head": sh("git","-C",os.environ["SRC"],"rev-parse","HEAD"),
  "mozconfig": os.environ.get("MOZCONFIG", os.environ["SRC"] + "/mozconfig"),
  "power_source": sh("pmset","-g","ps"), "therm": sh("pmset","-g","therm"),
  "suites": {"talos": ["other","sessionrestore-many-windows"],
             "raptor_sites": ["youtube","amazon","google-search","cnn"] if os.environ.get("HEADFUL")=="1" else [],
             "awsy": bool(os.environ.get("AWSY")=="1")},
}, open(sys.argv[1], "w"), indent=1)
EOF
echo "manifest → $OUT/$LABEL-journeys.json"
