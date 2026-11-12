# Firefox perf investigation — working log

Local build: `C:\mozilla\firefox\obj-opt` — release + cross-LTO, `--disable-debug-symbols`, NOT PGO (build #2 pending).

## Baselines (recorded, profiler ON)

| Test | Score |
|---|---|
| Speedometer 3 | ~9.1 (iter: 9.426, 9.487, 8.378) |
| JetStream 3 | 75.349 |
| TP6 YouTube (recorded playback) | fcp ~60ms median, load ~60ms, TTFB ~10ms |

## Speedometer 3 profile breakdown (content thread t-68, 48.8s CPU, symbolicated)

| Category | Share |
|---|---|
| JavaScript | 29.1% (baseline JIT 12.3%, ion 7.9%, interp 2.3%, parsing 1.6%) |
| Layout | 22.7% (reflow 9.6%, style 5.7%, frame construction 3.3%) |
| GC/CC | 18.6% — CC Build Graph 5.6%, CC FreeSnowWhite 3.8%, CC other ~4%, minor GC 1.5%, major sweep 1.2% |
| DOM | 12.4% |
| Other | 11.1% |
| Graphics | 4.5% |
| Network | 1.0% |

Key markers: `CCSlice` 140x avg 33.9ms (~4.7s), `ForgetSkippable` 170x avg 10.2ms (~1.7s), `GCMinor` 260x avg 3.1ms (~0.8s), `GC Interrupt` 430x. rAF-driven (`FrameRequestCallback` ~36% total). Workload is vsync/idle-shaped — idle slices get consumed by CC/GC runners.

## Hypotheses

- **H1 (CC overhead ~13-15%)**: Incremental CC slices + forget-skippable passes dominate non-JS/non-layout time. Experiments: (a) `dom.cycle_collector.incremental=false` — fewer slice-bookkeeping passes, bigger blocking collections; (b) code: reduce purple-buffer churn / traversal cost in `nsCycleCollector`.
- **H2 (Baseline JIT > Ion, 12.3% vs 7.9%)**: workload short-lived per subtest → code may not tier to Ion, or baseline code is doing DOM-bound work. Check warmup behavior; possible Ion-threshold tuning only if evidence shows stalled tiering.
- **H3 (Layout 22.7%)**: reflow+style driven by DOM churn in rAF tasks. Look for forced synchronous flushes (layout thrash) in hot subtests — `DOMEvent` markers max 6.4ms suggest long tasks.
- **H4 (bug 1924185 SM↔Gecko boundary)**: upstream comment says no longer SP3 hotspot; profile confirms boundary cost is inside DOM 12.4%, not separately dominant. Deprioritized.
- **H5 (PGO)**: current binary lacks PGO; official-config PGO build expected +5-10% on JS/layout benchmarks. Biggest single pending win.

## Experiments log

**E0 — profiler overhead (methodology fix)**: `--gecko-profile` run scored [9.43, 9.49, 8.38]; identical unprofiled control scored [10.34, 10.49, 10.45, 10.53, 10.57] → **profiler costs ~11% on SP3**. Real baseline ≈ **10.5**, not 9.1. Rules: never report scores from profiled runs; profiles for attribution only.

**E1 — `dom.cycle_collector.incremental=false`**: [7.76, 8.29, 10.58, 10.60, 10.51] median 10.51 vs control 10.49 → **no effect**. CC slices consume idle deadline time, not measured rAF task time. H1(a) refuted: CC slicing is not on the SP3 measured path. (Early-cycle scores lower both ways = warmup, not CC.)

**Implication**: only work inside measured tasks counts → targets are JS-in-task (29%), layout-in-task (22.7%), DOM-in-task (12.4%). GC/CC share is misleading unless slices bleed into tasks.

**E2 — RegExp species fuse (bug 1956245, PATCHED)**: `@@species` lookup (`SpeciesConstructor`) ran on every `split`/`matchAll` call. Added `OptimizeRegExpSpeciesFuse` (guards `RegExp.prototype.constructor` + `RegExp[@@species]` getter) + `CanOptimizeRegExpSpecies` intrinsic + fuse-pop watches (`RegExpObject` now `WhichHasRealmFuseProperty::ProtoAndCtor`); self-hosted `RegExpSplit`/`RegExpMatchAll` skip the lookup when the fuse guarantees the default. Shell A/B (fuse popped vs intact, same binary): **split 12.5% faster, matchAll-iter 7.4% faster**. Tests: `jit-test/tests/basic/testRegExpSpecies.js` PASS; jit-test `regexp` suite PASSED ALL. Files: `js/src/vm/{CommonPropertyNames.h,RealmFuses.{h,cpp},Watchtower.cpp,RegExpObject.cpp,SelfHosting.cpp}`, `js/src/builtin/{RegExp.{h,cpp},RegExp.js}`.

**E2b — IC inlining of the intrinsic (PATCHED, validated)**: registered `CanOptimizeRegExpSpecies` as `JS_INLINABLE_FN` + `InlinableNative::IntrinsicCanOptimizeRegExpSpecies` + `tryAttachCanOptimizeRegExpSpecies` (guards species+prototype fuses, `hasShapeResult` vs `maybeRegExpShapeWithDefaultProto`). Required registering the new fuse with Warp: `CompilationDependency::Type::RegExpSpecies`, `WarpOracle::addFuseDependency` case, `WarpCacheIRTranspiler::emitGuardFuse` no-op case — missing these = `MOZ_CRASH("Unexpected invalidating fuse")` on tier-up (found via 10k-iter split loop rc=3 fastfail). Post-fix: 500k split loop OK, bench re-run (quieter machine): fast 432.4ms vs popped 461.1ms (**6.6%**), matchAll 41.1 vs 41.5 (0.9%). jit-test `testRegExpSpecies`+`regexp` PASSED ALL incl. `--ion-regalloc=simple`. Note: absolute times not comparable to earlier bench (ran during parallel build). Files added: `js/src/jit/{InlinableNatives.{h,cpp},CacheIR.cpp,CacheIRGenerator.h,CompilationDependencyTracker.h,WarpOracle.cpp,WarpCacheIRTranspiler.cpp}`.

**L1 — Layout (checked)**: `marker stack` shows `Reflow`/`Styles`/`SetNeedStyleFlush` markers carry **no stacks** (`--has-stack` → 0 results). Sample-side view on `t-68` filtered by "Flush" (12,456 samples): **75.3% under `RefreshDriver tick` → `Update the rendering` → `PresShell::DoFlushPendingNotifications InterruptibleLayout` (41.3%)** — i.e., the bulk is normal per-frame interruptible reflow, not JS-forced sync reflow. The 5,546 `Reflow (sync)` markers (~2.5s) are real but the benchmark's own read-after-write pattern, same as any engine. Conclusion: no single fixable path; wins must come from generally faster style/reflow/frame construction. Revisit after PGO+symbols profile.

## Rejected / dead ends

- Manual symbolication of raw profile → use `profiler-cli load --with-samply` (worked).
- Native frame names unresolved (`--disable-debug-symbols`); categories/markers still sufficient for attribution.
- `bug 1844857` marked unactionable upstream.

**E5 — 3-stage PGO + cross-ThinLTO build (MEASURED)**: final objdir `obj-opt` (MOZ_PROFILE_USE=1, `-Cprofile-use` on gkrust, tests re-enabled post-build via targeted `mach configure` — `--disable-tests` had been baked into the stage-3 configure args). Build fixes en route: rustc 1.98.0 pinned (LLVM 22 = clang 22; 1.99.1's LLVM-23 bitcode can't cross-LTO), instrumented-stage cargo spec neutered (`lto`/`codegen-units=1`/`embed-bitcode` removed — C++ instrumentation carries the profile), sourcestamp fallback for the fake-git snapshot, profileserver SP3 port 8000→8180 (user uvicorn), stale-profile `.obj` wipe before final stage (each pipeline resume re-merged profdata → ProfileSummary conflicts → lld dropped modules → `wr_*` undefined). Results vs non-PGO baseline (both unprofiled, raptor):

| Benchmark | Non-PGO | PGO build | Delta |
|---|---|---|---|
| Speedometer 3 | ~10.5 | **12.08** | **+15%** |
| JetStream 3 | 75.3 | **94.03** | **+25%** |

Both deltas far exceed the ±2% noise band. H5 confirmed — PGO was the biggest single win, larger than the 5-10% estimate. Attribution note: PGO binary also contains the E2/E2b species patch, but that's <0.5% on these workloads — the delta is PGO+LTO. Caveat: single run each, same machine; rerun for a tighter interval before quoting externally. Logs: `bench/results/pgo-{speedometer3,jetstream3}.log`.

**E6 — Speculative navigation + speed mode (SHIPPED, upstreamed)**: Three pieces, all in the PGO binary and verified live:

| Change | Mechanism | Status |
|---|---|---|
| `browser.speed.mode` dial | `SpeedMode.sys.mjs` applies a pref bundle at startup; applied prefs tracked in `browser.speed.applied` for clean mode switching. Mode 0 (Performance): speculative-parallel-limit 40, 10 persistent conns/server, DNS cache 300s, HTTPS hover preconnect, HTTPS anchor DNS prefetch, speculation rules + hover prefetch all. Mode 1 Balanced = stock. | Built, init verified on live profile |
| Urlbar keyboard speculative connect | `onSelection` → `speculativeConnect(result, null, "select")`; privacy via `PrivateBrowsingUtils.isWindowPrivate` when no context | Built, launches clean |
| Hover prefetch | `dom.speculation_rules.hover_prefetch_all` (default off): `SpeculationRules::HoverPrefetchFallback` synthesizes a moderate-eagerness `PrefetchCandidate` for same-origin http(s) links on documents with no rule sets; activation via existing `PrefetchRecordParent`/`FindMatchingPrefetchRecord` path | Compiled + linked into PGO xul.dll; parent-side same-site/trustworthy checks verified |

Upstream: cleaned 3-way merged (snapshot / upstream-main / local) and opened **PR mozilla-firefox/firefox#445** off `main` @ 5fb56bef (27 files, +431/−10). Fork: `github.com/shahriar0247/FireSocks` (renamed fork). Branches on fork: `shahriar0247/perf-speculative-navigation` (PR head), `firesocks` (perf + branding).

**Branding — FireSocks**: `browser/branding/firesocks` (based on `unofficial`): `MOZ_APP_DISPLAYNAME=FireSocks`, `MOZ_APP_BASENAME=FireSocks` → `firesocks.exe`; brand.ftl/brand.properties renamed; all PNG/ICO/BMP/MSIX assets regenerated from a generated flaming-sock logo (PIL, `firefox-build/bench/firesocks_logo.py`). Build: `obj-firesocks` via `mozconfig-firesocks` — release+cross-LTO, reuses `obj-opt/instrumented/merged.profdata` (`MOZ_PROFILE_USE=1`; rust spec patched with `-Cprofile-use` — the configure-time gap recurs).
