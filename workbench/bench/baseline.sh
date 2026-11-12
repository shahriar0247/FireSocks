#!/usr/bin/env bash
# Baseline benchmark harness for our Firefox build.
# Usage: bash bench/baseline.sh [label] [--profile]
# Results → bench/results/<label>-<test>.log
# NOTE: unprofiled by default — the Gecko profiler costs ~11% on Speedometer.
# Pass --profile as 2nd arg to attach the Gecko profiler (analysis runs only).

set -u
# Repo root = two levels up from this script (workbench/bench/).
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(dirname "$0")/results"
LABEL=${1:-baseline}
PROFILE_ARG=""
[ "${2:-}" = "--profile" ] && PROFILE_ARG="--gecko-profile"
mkdir -p "$OUT"
mkdir -p "$SRC/artifacts"

cd "$SRC" || exit 1

run_raptor() {
  local test=$1
  local logf=$SRC/artifacts/raptor-$LABEL-$test.log
  echo "=== raptor $test → $OUT/$LABEL-$test.log ==="
  ./mach raptor -t "$test" $PROFILE_ARG 2>&1 | tee "$logf"
  cp -f "$logf" "$OUT/$LABEL-$test.log"
}

run_raptor_n() {
  local test=$1
  local runs=${2:-3}
  for i in $(seq 1 "$runs"); do
    run_raptor "$test"
    mv -f "$OUT/$LABEL-$test.log" "$OUT/$LABEL-$test.run$i.log" 2>/dev/null || true
  done
}

# Responsiveness — the headline number (higher better), 3 runs
run_raptor_n speedometer3 3

# JS/Wasm throughput (higher better), 3 runs
run_raptor_n jetstream3 3

# Real-page loads (recorded pages; lower better). Single run each —
# add sites as needed: amazon cnn ebay espn google-search reddit twitter youtube
for site in youtube amazon cnn google-search; do
  run_raptor "$site"
done

echo "Done. Results in $OUT and artifacts/"
