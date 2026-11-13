#!/usr/bin/env bash
# FireSocks macOS PGO pipeline, stages 2 (profile) and 3 (profile-use build).
# Stage 1 must have completed in obj-pgo-instr via mozconfig-pgo-generate.
#
#   pgo-stage23.sh package    — package the instrumented build
#   pgo-stage23.sh profile    — run profileserver → obj-pgo-instr/merged.profdata
#   pgo-stage23.sh use        — build obj-opt with --enable-profile-use=cross
#   pgo-stage23.sh all        — package + profile + use
#
# Using explicit --enable-profile-*=cross mozconfigs (the upstream CI path)
# propagates -Cprofile-generate/-Cprofile-use into MOZ_RUSTFLAGS_TARGET_LTOABLE
# at generation time; no post-hoc .cargo-library-spec.json edits needed.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
GEN_CFG="$SRC/workbench/mozconfigs/mozconfig-pgo-generate"
USE_CFG="$SRC/workbench/mozconfigs/mozconfig-pgo-use"
USE_CFG_RESOLVED="$SRC/workbench/mozconfigs/.mozconfig-pgo-use.resolved"
INSTR="$SRC/obj-pgo-instr"
PROFDATA="$SRC/workbench/pgo-artifacts/merged.profdata"
JARLOG="$SRC/workbench/pgo-artifacts/jarlog/en-US.log"
BUILD_PY="$HOME/.mozbuild/srcdirs/firesocks-3773b310c242/_virtualenvs/build/bin/python"
LLVM_PROFDATA="$HOME/.mozbuild/clang/bin/llvm-profdata"
LOGD="$SRC/artifacts/pgo"
mkdir -p "$LOGD"

step=${1:?usage: pgo-stage23.sh package|profile|use|all}

do_package() {
  echo "=== packaging instrumented build ==="
  MOZCONFIG="$GEN_CFG" "$SRC/mach" package 2>&1 | tee "$LOGD/stage2-package.log"
  [ -d "$INSTR/dist/FireSocks.app" ] || { echo "no staged app in $INSTR/dist" >&2; exit 1; }
}

do_profile() {
  echo "=== running profileserver ==="
  mkdir -p "$(dirname "$JARLOG")"
  cd "$INSTR"
  MOZCONFIG="$GEN_CFG" LLVM_PROFDATA="$LLVM_PROFDATA" JARLOG_FILE="$JARLOG" \
    "$BUILD_PY" "$SRC/build/pgo/profileserver.py" 2>&1 | tee "$LOGD/stage2-profileserver.log"
  [ -s "$INSTR/merged.profdata" ] || { echo "merged.profdata missing/empty" >&2; exit 1; }
  # Preserve outside the instrumented objdir so it can be cleaned to
  # reclaim disk without losing the profile.
  mkdir -p "$SRC/workbench/pgo-artifacts"
  cp "$INSTR/merged.profdata" "$PROFDATA"
  if [ -s "$INSTR/jarlog/en-US.log" ]; then
    mkdir -p "$(dirname "$JARLOG")" && cp "$INSTR/jarlog/en-US.log" "$JARLOG"
  else
    echo "WARN: jarlog missing — packing order optimization skipped" >&2
  fi
  echo "profdata: $(du -h "$PROFDATA" | cut -f1), jarlog: $(du -h "$JARLOG" 2>/dev/null | cut -f1)"
}

do_use() {
  echo "=== stage 3: profile-use build ==="
  if [ -s "$JARLOG" ]; then JARLOG_OPT=$JARLOG; else JARLOG_OPT="/dev/null"; fi
  sed -e "s|@PGO_PROFDATA@|$PROFDATA|g" -e "s|@PGO_JARLOG@|$JARLOG_OPT|g" \
      "$USE_CFG" > "$USE_CFG_RESOLVED"
  if [ ! -s "$JARLOG" ]; then
    sed -i '' '/--with-pgo-jarlog/d' "$USE_CFG_RESOLVED"
  fi
  MOZCONFIG="$USE_CFG_RESOLVED" caffeinate -dimsu "$SRC/mach" build 2>&1 | tee "$LOGD/stage3-build.log"
  echo "stage3 done → $SRC/obj-opt/dist/FireSocks.app"
}

case "$step" in
  package) do_package ;;
  profile) do_profile ;;
  use)     do_use ;;
  all)     do_package; do_profile; do_use ;;
  *) echo "unknown step $step" >&2; exit 1 ;;
esac
