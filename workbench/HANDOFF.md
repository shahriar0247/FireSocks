# FireSocks — performance workbench handoff

This document is the full state of the Firefox-performance project. Read it
first, then continue the build → benchmark → profile → optimize loop on this
machine.

## What this repo is

`shahriar0247/FireSocks` — a fork of `mozilla-firefox/firefox`.

| Branch | Contents |
|--------|----------|
| `firesocks` | upstream `main` + performance bundle + FireSocks branding + this workbench dir |
| `shahriar0247/perf-speculative-navigation` | upstream `main` + performance bundle only (the upstream-submittable branch) |

- Performance-bundle PR diff: `workbench/patches/upstream-perf-bundle.patch`
- Standalone SpiderMonkey patch: `workbench/patches/regexp-species-fuse.patch`
- Upstream submission went to mozilla-firefox/firefox PR #445 — **auto-closed**:
  Mozilla only takes Phabricator (`moz-phab`) submissions. To re-submit: file a
  Bugzilla bug and run `moz-phab` from a checkout of the perf branch.

## Measured results so far (Windows x64, machine: 31GB RAM, -j8)

| Benchmark | Baseline | Current best | Delta |
|---|---|---|---|
| Speedometer 3 (unprofiled) | 10.5 | **12.08** (PGO+LTO) | +15% |
| JetStream 3 (unprofiled) | 75.3 | **94.03** (PGO+LTO) | +25% |
| RegExp split microbench | — | 6.6–12.5% faster op | fuse patch |
| RegExp matchAll microbench | — | 0.9–7.4% faster op | fuse patch |

**Methodology rule**: `--gecko-profile`/raptor profiling adds ~11% overhead on
Speedometer. NEVER report scores from profiled runs — profile for attribution
only, score unprofiled.

Profile attribution (Speedometer 3, symbolicated): JS 29.1%, Layout 22.7%,
GC/CC 18.6% (mostly idle-deadline, not measured-task), DOM 12.4%, other 11.1%,
graphics 4.5%, network 1.0%. Optimization targets: JS-in-task, layout-in-task,
DOM-in-task.

## Measured results (macOS arm64, paired A/B — session 3, 2026-11-13)

PGO+ThinLTO vs ThinLTO-only control, 6 ABBA blocks, 48/48 runs, immutable
binaries, thermal/load-gated (`workbench/bench/ab.sh` → `report.py pgo-ab`):

| Benchmark | Control | PGO | Delta | CI95 |
|---|---|---|---|---|
| Speedometer 3 | ~37.5 | ~45.4 | +7.91 med (+21.1% mean) | [7.39, 8.38] |
| JetStream 3 | ~246 | ~259 | +13.25 med (+5.6% mean) | [11.53, 15.98] |
| ts_paint (startup) | 784ms | 750ms | ~4.3% | 20 cycles each |

A/A same-binary noise: CI contains 0 (SP3 ±0.6, JS3 ±0.9) — effects are ~8x
above the noise floor. PGO **retained** per the pre-registered rule.
Full numbers: `workbench/docs/perf-report.md`; raw runs + provenance:
`workbench/bench/results/pgo-ab-*`.

0D attribution on the shipping build (SP3 content main thread): JS 20.2%,
Layout 12.0%, GC/CC 11.1%, DOM 5.7%, Graphics 2.4%, Net 0.5% (idle 41.5%
is harness slack). Top jank = CC purple scan — same story as Windows; the
mode dial's CC batching is the intended lever.

Binary size: XUL 242.1MB (ThinLTO) → 248.6MB (PGO), +2.6%.

## Code changes already in `firesocks`

| Change | Files | What it does |
|---|---|---|
| RegExp species fuse | `js/src/vm/{CommonPropertyNames.h,RealmFuses.*,Watchtower.cpp,RegExpObject.cpp,SelfHosting.cpp}`, `js/src/builtin/RegExp.*`, `js/src/jit/{CacheIR.cpp,CacheIRGenerator.h,CompilationDependencyTracker.h,InlinableNatives.*,WarpOracle.cpp,WarpCacheIRTranspiler.cpp}` + `jit-test/tests/basic/testRegExpSpecies.js` | `split`/`matchAll` skip `SpeciesConstructor` when `RegExp.prototype.constructor`/`@@species` are default; fuse pops → slow path. Intrinsic is IC/Warp-inlinable. |
| Urlbar keyboard warm-up | `browser/components/urlbar/UrlbarParentController.sys.mjs` | `speculativeConnect(result, null, "select")` on keyboard selection; private-window check via `PrivateBrowsingUtils` when no context. |
| Hover prefetch | `dom/base/SpeculationRules.{h,cpp}`, `dom/events/EventStateManager.cpp`, `modules/libpref/init/StaticPrefList.yaml` | Pref `dom.speculation_rules.hover_prefetch_all` (default off): documents with no rule sets synthesize a moderate `PrefetchCandidate` for same-origin hovered links → existing `PrefetchRecordParent` activation path = near-instant clicks. |
| Speed-mode dial | `browser/components/speedmode/SpeedMode.sys.mjs` + `moz.build`, `BrowserGlue.sys.mjs`, `browser/components/moz.build`, `browser/app/profile/firefox.js` | `browser.speed.mode` 0=Performance/1=Balanced/2=Fortress; applies pref bundle at startup, tracks applied prefs in `browser.speed.applied` for clean switching. Performance bundle: speculative-parallel-limit 40, 10 conns/server, DNS cache 300s, hover prefetch, speculation rules. |
| Safe global defaults | `browser/app/profile/firefox.js` | `network.predictor.enable-hover-on-ssl`, `dom.prefetch_dns_for_anchor_https_document` on for all modes. |
| Global speculation budget | `modules/libpref/init/StaticPrefList.yaml`, `dom/ipc/PrefetchRecordParent.{h,cpp}`, `browser/components/speedmode/SpeedMode.sys.mjs` | Browser-wide prefetch admission control: `max_records_global` (default 4, 0=off) + `max_transfer_bytes_global` (5MB) caps enforced parent-side in `Init`; oldest in-flight record is evicted when the cap is full so fresh user intent wins; retained bytes accounted across completion/cancel/ActorDestroy. Fortress sets cap=0. Commit `59c69ba7fd`. |
| FireSocks branding | `browser/branding/firesocks/` | Full brand dir (based on `unofficial`): `MOZ_APP_DISPLAYNAME=FireSocks`, flaming-sock logo assets (generated by `workbench/bench/firesocks_logo.py`, PIL). |

## Build recipes

### Windows (proven — see mozconfigs in workbench/)
- `workbench/mozconfig-windows-pgo`: release + `--enable-lto=cross` + `MOZ_PGO=1`
  (3-stage: instrumented → profileserver → `-fprofile-use`). Output `obj-opt`.
- `workbench/mozconfig-firesocks-windows`: same + `--with-branding` +
  `MOZ_APP_BASENAME=FireSocks` + `MOZ_PROFILE_USE=1` reusing
  `obj-opt/instrumented/merged.profdata`.
- `workbench/mozconfig-js`: standalone JS shell for jit-tests + microbenchmarks.

### macOS arm64 (bootstrap DONE 2026-01; build in progress → `artifacts/build.log`)
```bash
./mach --no-interactive bootstrap --application-choice browser --no-system-changes
# ^ --no-interactive is a GLOBAL mach arg — must precede the subcommand.
# Installs Mozilla clang 22.1.8 + MacOSX27.2.sdk + ld64.lld + samply/profiler-cli
# into ~/.mozbuild. Configure auto-picks ~/.mozbuild/clang (LLVM 22 = rustc 1.98
# LLVM 22 → cross-LTO bitcode parity; standalone clang↔rust thin-LTO test passed).
cat > mozconfig <<'EOF'
mk_add_options MOZ_OBJDIR=@TOPSRCDIR@/obj-opt
ac_add_options --enable-release
ac_add_options --enable-optimize
ac_add_options --disable-debug
ac_add_options --enable-debug-symbols
ac_add_options --enable-application=browser
ac_add_options --enable-lto=cross
ac_add_options --with-branding=browser/branding/firesocks
export MOZ_APP_BASENAME=FireSocks
ac_add_options --disable-crashreporter
ac_add_options --disable-updater
mk_add_options MOZ_MAKE_FLAGS="-j4"   # 16GB RAM — keep low
export MOZILLA_OFFICIAL=1
export BUILD_OFFICIAL=1
export MOZ_LD64_KNOWN_GOOD=1          # cross-LTO gate on Darwin (lld is picked anyway)
EOF
./mach build
./mach package             # produces dist/FireSocksNightly.dmg-ish zip
```
On macOS keep parallelism at `-j4` (16GB RAM); ThinLTO link peak ~12–17GB.

### PGO on macOS — DONE, RETAINED (session 3)
Do NOT use `MOZ_PGO=1` — see the landmine below. The working route is the
CI-style `=cross` option values; mozconfigs in `workbench/mozconfigs/`:

```bash
# stage 1: instrumented build into obj-pgo-instr (~27min)
MOZCONFIG=workbench/mozconfigs/mozconfig-pgo-generate ./mach build
# stage 2: package + profileserver (SP3/JS3 workload) → merged.profdata + jarlog
# stage 3: profile-use + ThinLTO into obj-opt
bash workbench/bench/pgo-stage23.sh   # drives stages 2+3 end to end
```

Artifacts: `workbench/pgo-artifacts/merged.profdata` (117MB, 108 profraws)
+ `jarlog/en-US.log` — preserved outside the disposable objdir (gitignored).
A/B vs control: `BLOCKS=6 TESTS=speedometer3,jetstream3 bash ab.sh <label>
<control.app> <treatment.app>` then `python3 report.py <label>`.

## Known landmines (learned the hard way)

- `MOZ_PGO=1` does NOT propagate Rust PGO flags: the env option yields a
  bare flag value while `moz_pgo_rust` requires the literal `("cross",)`
  option value, so `-Cprofile-generate/-Cprofile-use` never reach
  `MOZ_RUSTFLAGS_TARGET_LTOABLE`. RESOLVED by building with explicit
  `--enable-profile-generate=cross` / `--enable-profile-use=cross`
  (verified live in rustc + clang command lines). The older symptom —
  `ProfileSummary conflict` + `wr_*` undefined at the XUL ThinLTO link —
  was this same gap seen from the link side; no spec-JSON patching needed
  on the =cross route.
- Any `modules/libpref/init/StaticPrefList.yaml` change forces a near-full
  rebuild (regenerates pref headers).
- `mach build faster` is unavailable under `MOZ_PGO=1`; JS/frontend-only edits
  to `dist/bin` symlinks are live without rebuild.
- `git status`/`git diff` on this tree is slow (488k files) — always scope
  with paths.
- Never create the PR on GitHub upstream — Phabricator only.
- `./mach bootstrap` takes `--no-interactive` BEFORE the subcommand only;
  after it, bootstrap rejects it.
- `browser/app/distribution/distribution.ini` ships under `MOZILLA_OFFICIAL=1`
  and claims "Mozilla Firefox Official Build" — functional no-op (telemetry
  attribution only), but a branding wrinkle if we ever ship real dists.
- `distribution/extensions/` addon filenames MUST be `<addon-id>.xpi`
  (`getExpectedID` validates the leafName against the manifest id).
- rust-objcopy warns about missing `libLLVM.dylib` paths during Rust crate
  compiles on macOS — cosmetic, build continues.

## Next work items (priority order)

1. **Build + baseline on this Mac**: `./mach build` GREEN (~35min full,
   ~8min incremental — buildid bump relinks XUL), `./mach package` →
   `dist/firesocks-162.0a1.en-US.mac.dmg`. Baselines running via
   `bench/baseline.sh mac-baseline` (needs `PATH` shim: `python3 →
   /opt/homebrew/bin/python3.11` — raptor rejects system Python 3.14).
   Harness now defaults to `--browsertime-arg headless=true` +
   `caffeinate -dimsu` re-exec: a headful run STALLS indefinitely when
   the display locks (occluded page, throttled rAF — observed live).
   `HEADLESS=0` for headful, but keep the session unlocked.

   **macOS baselines (opt build, ThinLTO, headless, unprofiled):**
   Speedometer 3 = **37.04 / 37.42 / 37.00** → median **37.04**
   (headful sanity run scored 36.81 — headless≈headful here).
   JetStream 3 = **243.04 / 233.15 / 223.10** → median **233.15**;
   the −8% run-to-run decline looks like thermal throttle — for
   compare runs, keep ordering consistent or cool between suites.
   tp6 site loads excluded from the default harness: they need a
   compositor (LCP/renderTime missing headless → MissingResultsError).
   `SITES=1 HEADLESS=0` runs them. Summary JSON committed at
   `workbench/bench/results/baseline-summary.json`.
   Compare Windows machine: 10.5 non-PGO / 12.08 PGO — different
   hardware, do not compare across machines.
2. ~~**Settings UI for `browser.speed.mode`**~~ (DONE, commit `8fb77aa`):
   `speed` settings-group in `tabs-browsing.mjs`, `moz-radio-group` 3-stop
   control, Fluent strings, flame icon. Still needs live verification on the
   built app.
3. **Fortress mode real blocking** (IN PROGRESS): Fortress v2 pref bundle
   landed (strict ETP + unifiedAds off + autoplay 5 + notification deny 2).
   uBOL `2026.1110.1816` vendored as `distribution/extensions/` xpi — installs
   silently enabled per-profile, self-updates via AMO. Design call made:
   ad blocking = baseline feature (not mode-gated); Fortress = strict-ETP +
   annoyance layer on top. Still needs live verification of silent install +
   DNR firing once build lands.
4. **Hover-prefetch tests** (tests written, run pending build):
   `browser_speculation_rules_hover_fallback.js` covers same-origin fire,
   mouseout-cancel, cross-origin reject, PB silence, ruleset-present skip,
   record-cap, activation deliveryType. C++ landed: PB gate on
   `HoverPrefetchFallback` (`6d0ae47`) + `max_records_per_document`
   enforcement in `StartPrefetch` (`ea0a0e9`).
4b. **Speculative-activity tab indicator** (landed `f56093a6`, verify on
   build): `SpeculativeLoadActivity.sys.mjs` observes prefetch channels
   (`Sec-Purpose: prefetch` + TYPE_OTHER) → `speculativeload` attr on owning
   tab → `.tab-spec-load-line` sweeping bar (horizontal + vertical tabs,
   reduced-motion safe). Pref: `browser.speed.show_speculative_activity`.
4c. **FireSocks Mods pane** (landed `5e8ca8fc`, SRD-only): per-feature
   toggles for urlbar connect (engine + on-selection), hover prefetch,
   speculation rules, HTTPS hover connect, anchor DNS prefetch, activity
   indicator. NOTE: `network.predictor.enabled` is dead — Predictor module
   removed upstream (`a66a4382`). `dom.speculation_rules.enabled` flipped
   default-true in firefox.js — upstream is Nightly-only (`dc3cca05`).
4d. **Urlbar select-connect gate**: `browser.urlbar.speculativeConnect.select`
   added to UrlbarPrefs schema; `onSelection` connect now independently
   toggleable (`f56093a6`).
5. **Layout/style internals**: 75% of layout samples are RefreshDriver
   interruptible flushes — needs frame-construction/style micro-opts, not
   sync-reflow suppression. Symbol build required for attribution.
6. **JS next targets**: iterator/generator-resume machinery (4.6% of JS3 was
   `self-hosted!next`), promise internals.
7. **Prefetch scheduler**: type-ahead + likely-destination prefetch with
   budget/rate-limit; measure bandwidth waste. (Partially addressed: global
   speculation budget `59c69ba7fd` caps in-flight records + bytes.)
8. **Real-site validation**: cold/warm navigation, hover-to-click latency,
   memory, power/battery, bandwidth cost of speculation.
9. ~~**macOS PGO**~~ DONE + RETAINED (session 3): SP3 +21.1% mean,
   JS3 +5.6% mean, ts_paint ~4.3%, paired ABBA/BAAB, A/A-clean. Use the
   `=cross` mozconfigs — never `MOZ_PGO=1` (see landmines).

## Rules

- Preserve full web compatibility — this is a production browser, not a toy.
- Honest numbers: benchmark-specific wins are not "browser is faster" claims.
- Security trade-offs must be explicit (speed-mode dial), never silent.
- Match surrounding code style; minimal diffs; no drive-by refactors.
- Commit work as you go; push to the `firesocks` branch.
- `docs/investigation.md` + `docs/fix-plan.md` (in `workbench/docs/`) are the
  living logs — keep them current.
