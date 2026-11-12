#!/usr/bin/env bash
# Baseline benchmark harness for our Firefox build.
# Run inside MozillaBuild shell: bash bench/baseline.sh [label] [--profile]
# Results → bench/results/<label>-<test>.log
# NOTE: unprofiled by default — the Gecko profiler costs ~11% on Speedometer.
# Pass --profile as 2nd arg to attach the Gecko profiler (analysis runs only).

set -u
SRC=/c/mozilla/firefox
OUT="$(dirname "$0")/results"
LABEL=${1:-baseline}
PROFILE_ARG=""
[ "${2:-}" = "--profile" ] && PROFILE_ARG="--gecko-profile"
mkdir -p "$OUT"
mkdir -p /c/mozilla/firefox/artifacts

cd "$SRC" || exit 1

run_raptor() {
  local test=$1
  local logf=/c/mozilla/firefox/artifacts/raptor-$LABEL-$test.log
  echo "=== raptor $test → $OUT/$LABEL-$test.log ==="
  ./mach raptor -t "$test" $PROFILE_ARG 2>&1 | tee "$logf"
  cp -f "$logf" "$OUT/$LABEL-$test.log"
}

# Responsiveness — the headline number (higher better)
run_raptor speedometer3

# JS/Wasm throughput (higher better)
run_raptor jetstream3

# Real-page loads (recorded pages; lower better). Subset keeps runtime sane —
# add sites as needed: amazon cnn ebay espn google-search reddit twitter youtube
for site in youtube amazon cnn google-search; do
  run_raptor "$site"
done

echo "Done. Results in $OUT and artifacts/"
