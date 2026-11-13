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

## macOS build (2026-01, in progress)

`./mach bootstrap --no-interactive --application-choice browser --no-system-changes` installed Mozilla clang 22.1.8 + `MacOSX27.2.sdk` + `ld64.lld` + samply/profiler-cli into `~/.mozbuild`. Root `mozconfig`: release+opt+cross-LTO, firesocks branding, `-j4`, `MOZ_LD64_KNOWN_GOOD=1` belt-and-suspenders (lld actually selected → gate moot). Configure picked `~/.mozbuild/clang` automatically (mozbuild clang dir is prepended to CC search path), `MOZ_LTO_RUST_CROSS=thin`, lld — LLVM 22 on both sides of cross-LTO (rustc 1.98.0). Verified beforehand with a standalone clang↔rustc thin-LTO link test (earlier Apple-clang test also worked, but Mozilla clang removes all doubt). Full `./mach build` running → `artifacts/build.log`.

## Fortress mode + page-level ad blocking (evaluated, partial land)

`browser.contentblocking.category=strict` already activates the full strict feature bundle from `firefox.js` (`browser.contentblocking.features.strict`): Disconnect lvl2 tracker blocking, cookie partitioning, cryptomining, fingerprinting (FPP), social/email tracking protection, query-param stripping, bounce tracking, referrer restrictions, local-network restrictions. `consentmanagerSkip` is a compat-*easing* flag (ON = don't block consent-manager resources) — correctly left OFF in strict.

Fortress bundle v2 (landed in `SpeedMode.sys.mjs`, commit `8fb77aa`): strict ETP + `unifiedAds.{tiles,spocs}.enabled=false` (sponsored newtab) + `media.autoplay.default=5` (block all) + `permissions.default.desktop-notification=2` (deny prompts).

**Real page-level ad blocking — options evaluated:**

| Mechanism | Packaging | Disableable | Ruleset updates | Verdict |
|---|---|---|---|---|
| in-tree list-driven engine | new C++/JS engine | — | — | Rejected: no ad-list engine exists in-tree; building one is a project, not a patch. ETP lists are tracker-format, not EasyList-format |
| `builtin-addons/` omni.ja (webcompat path) | unpacked dir + jar.mn, auto-registered by `gen_built_in_addons.py` | No — location is `hidden`/`locked`/`isSystem` | Frozen at build time | Viable but weakest |
| **`distribution/extensions/<id>.xpi`** | xpi file + `FINAL_TARGET_FILES["distribution.extensions"]` | Yes (profile-scope install) | **Self-updates via AMO** | **Chosen** |

`XPIProvider.installDistributionAddons` reads `distribution/extensions/*.xpi` (filename must be `<addon-id>.xpi`), `installDistributionAddon` copies into profile extensions dir, **silently enabled** (OEM mechanism — no opt-in prompt), requires signed state (AMO-signed xpi ships as-is). Version-compared on upgrade; `extensions.installedDistroAddon.<id>` pref prevents resurrection between updates.

Vendored uBlock Origin Lite `2026.1110.1816` Firefox signed xpi (9.3MB; unpacked would be 34MB — 28MB rulesets) → `browser/app/distribution/extensions/uBOLiteRedux@raymondhill.net.xpi`. Manifest: MV3, event-page background (`background.scripts`, module), perms = standard DNR stack (`declarativeNetRequest`, `scripting`, `storage`, `alarms`, `activeTab`, `unlimitedStorage`, `<all_urls>`), 6 rulesets enabled by default (uBlock filters, EasyList, EasyPrivacy, Peter Lowe's, badware, urlhaus) + opt-in annoyance/regional lists toggled per-user via its dashboard. `data_collection_permissions: ["none"]` avoids the data-consent prompt.

Design consequence: **ad blocking is a baseline FireSocks feature, not a mode** — always-on is also perf-positive (DNR matching is native code; blocked requests = less page work). Fortress differentiates via strict ETP + annoyance controls layered on top. Per-mode gating of the addon remains technically possible (profile-scope addon → `AddonManager` `userDisabled` toggle) but is not implemented — would need policy for users who disable it manually.

**Not yet verified** (pending build): xpi lands at `Contents/Resources/distribution/extensions/` on macOS (`XRE_APP_DISTRIBUTION_DIR` = `NS_GRE_DIR/distribution` → RESPATH ✓); silent install on fresh profile; DNR blocking actually fires (test: `https://ublockorigin.github.io/uBOL-home/tests/test-filters.html`).

## Speculative-activity tab indicator + FireSocks Mods pane (macOS session)

**Tab indicator** (`f56093a6`): `SpeculativeLoadActivity.sys.mjs` observes `http-on-modify-request`/`http-on-stop-request` in the parent, matches prefetch channels by `loadInfo.externalContentPolicyType == TYPE_OTHER` + `Sec-Purpose: prefetch`, resolves `loadInfo.browsingContext.top.embedderElement` → tab, and sets/removes a `speculativeload` attribute. New `.tab-spec-load-line` element in `.tab-background` renders a 2px sweeping bar (horizontal) / inline-end bar (vertical tabs), `prefers-reduced-motion`-safe. Gated by `browser.speed.show_speculative_activity` (default on). Zero new C++ — rides the channels `PrefetchRecordParent` already creates. BrowsingContext-torn-down edge case handled with a fallback inflight-set scan.

**Urlbar select gate**: `onSelection` speculative connect now behind `browser.urlbar.speculativeConnect.select` (UrlbarPrefs schema, default on) — independently toggleable from `speculativeConnect.enabled`.

**FireSocks Mods pane** (`5e8ca8fc`, SRD-only): `CONFIG_PANES.firesocksMods` → `config/firesocks-mods.mjs`, 3 groups — page-load speculation (hover prefetch, site speculation rules, HTTPS hover connect, HTTPS anchor DNS prefetch), address bar (engine preconnect, on-selection connect), indicators (tab activity bar). Each toggle binds its underlying pref directly via `moz-checkbox`; SpeedMode bundles still apply on mode switch (their `applied` tracking respects user-overridden values, so Mods toggles survive mode switches).

**Dead-pref find**: `network.predictor.enabled` is gone — upstream removed the Predictor module (the `nsINetworkPredictor` LRU-learning service); only `network.predictor.enable-hover-on-ssl` survives, consumed directly by `nsDocShell` → `SpeculativeConnect`. Initially added a dead toggle; removed in `a66a4382`. All other SpeedMode/Mods prefs verified live (speculative-parallel-limit and max-persistent-connections are `HTTP_PREF` runtime prefs in `nsHttpHandler`).

**Hover-prefetch C++ fixes** (`6d0ae47`, `ea0a0e9`): (1) PB gate — `HoverPrefetchFallback` now returns early on `OriginAttributesRef().IsPrivateBrowsing()` so the browser-level fallback never prefetches in private windows (upstream rule-set behavior untouched — rule-set prefetches still run in the private partition). (2) `dom.speculation_rules.max_records_per_document` was declared but never enforced — wired the check into `SpeculationRulesManager::StartPrefetch` before record creation.

**Test** (uncommitted, pending built binary): `dom/base/test/browser_speculation_rules_hover_fallback.js` + `file_speculation_rules_fallback_source.html` — SJS `?count=` token accounting for: same-origin hover prefetch fires, mouseout-before-delay cancels (no request), cross-origin rejected, private window silent, duplicate suppression (rule-set + fallback), record-cap enforcement, activation via `deliveryType == "navigational-prefetch"`. Registered in `browser.toml`.

**Verification queue for green build**: `./mach package` → dist xpi at `Contents/Resources/distribution/extensions/` → fresh profile silent-install + DNR fires → run hover-fallback mochitest → unprofiled Speedometer3/JetStream3 ×3 → tab indicator live-check → Mods pane render check.

## macOS build + verification (2026-01-12)

**Build**: green — `obj-opt` release+cross-ThinLTO, Mozilla clang 22.1.8 + ld64.lld, rustc 1.98.0 (LLVM 22 both sides). Wall ~35min full, ~8min per incremental (buildid.h bump forces XUL relink). `mach package` → `dist/firesocks-162.0a1.en-US.mac.dmg`. Fixes needed: `MOZ_SOURCE_REPO`/`MOZ_SOURCE_CHANGESET` env in mozconfig (git clone → empty source-repo.h → packager died on 'no preprocessor directives'); `FINAL_TARGET_FILES["distribution"].extensions` — dotted *string* keys are literal, subdirs are attribute syntax.

**uBOL verified on built app**: fresh headless profile → `extensions/uBOLiteRedux@raymondhill.net.xpi` installed, `active:true`, `visible:true`, `userDisabled:false`, `signedState:2`, `location:app-profile`, v2026.1110.1816. Silent install + manageability confirmed. DNR live-firing on the uBOL test page still pending a windowed check.

**Hover-fallback test suite green**: `browser_speculation_rules_hover_fallback.js` — 11/11 checks pass on the built binary (`./mach test ... --headless`). Verifies: same-origin prefetch fires, mouseout cancels, cross-origin rejected, private-window silent (PB gate works), ruleset-present skips fallback, record cap drops second prefetch, activation reports `deliveryType=navigational-prefetch` with exactly one server hit. One fix: `http-on-stop-request`, not modify-request — modify fires before the request reaches the server so the SJS counter raced to 0.

**Raptor on macOS needs Python ≤3.13**: system `python3` is 3.14 → `PythonVersionException`. Workaround: `PATH=/tmp/py311-bin:$PATH` with `python3 → /opt/homebrew/bin/python3.11` (creates fresh 3.11 mach venvs on first run). Baseline `mac-baseline` running: speedometer3 ×3, jetstream3 ×3, youtube/amazon/cnn/google-search ×1.

## Prefetch scheduler design (urlbar document prefetch — deferred)

Goal: prefetch the urlbar heuristic/top result's document so Enter = near-instant load. Findings:

- Prefetch records are IPDL-managed on the WGP (`ManagedPPrefetchRecordParent`) — no chrome-JS entry point exists today; `WindowGlobalActors.webidl` exposes nothing prefetch-related.
- Feasible path without new IPDL: `[ChromeOnly] void Document.startPrefetch(DOMString url)` → synthesize a moderate `PrefetchCandidate` (reuse `HoverPrefetchFallback`'s construction) → `EnsureSpeculationRulesManager()->StartPrefetch` (inherits dedup + cap + same-site checks for free).
- Chrome reaches it via a JSWindowActor query: urlbar controller → `browser.browsingContext.currentWindowGlobal` actor → child calls `content.document.startPrefetch(url)`.
- Rate-limit: only on selection-confirming signals (e.g. autofill result present + user pause), never per keystroke. Bandwidth cost is real; gate behind `browser.speed.mode` or a new `browser.urlbar.speculativeConnect.prefetch` pref.
- Alternative considered and rejected: parent-side `PrefetchRecordParent` construction bypasses IPDL — actor registration is IPC-bound (Managed* list), so it would need an IPDL factory change too; document-side path reuses everything.

Other checked-and-deferred knobs: `dom.ipc.processPrelaunch` already on (3 procs, 1s delay); bfcache `max_total_viewers=-1` auto (pinning risks memory); early hints + h3 + HTTPS-RR defaults already upstream-tuned; `network.predictor.*` family removed upstream except hover-on-ssl.

## Cycle-collector cost on Speedometer 3 (profiled 2026-11-12)

Gecko-profile of `speedometer3` (headless, iteration-2 profile,
`--gecko-profile` run — samply's dyld wrapper breaks geckodriver, use the
in-tree profiler). Content GeckoMain, 16.4s active / 29.3s wall:

- JavaScript 26.3% | **GC/CC 26.1%** | Layout 20.0% | DOM 13.6%
- CC alone ~19%: Free Snow White 10.3% (`SnowWhiteKiller::Visit` self 3.9%,
  reached via `AsyncFreeSnowWhite` idle runnables) + Build Graph 7.3%.
- Trigger path: `IsCCNeeded` fires `MANY_SUSPECTED` at purple>200, and
  `ShouldForgetSkippable` runs on every +100 suspects — constant churn
  under DOM-heavy workloads.

**Landed:** both thresholds are now StaticPrefs
(`dom.cycle_collector.purple_limit`, `...skippable_suspect_growth`,
defaults = old constants). Performance bundle sets 2000/1000.
A/B result: ~+0.5-1% — inside run-order drift (controls drifted
37.2→38.3 across successive runs). Kept because the mechanism is real
and Performance mode explicitly trades memory for fewer pauses; treat
as a real-world jank dial more than a benchmark win.

**A/B methodology lesson:** run-order drift on this machine is ~±1pt —
future A/B must interleave C/T/C/T, not batch controls then treatments.
JetStream showed the inverse: −8% decline across back-to-back runs
(thermal throttle). Let the machine cool between suites.

## Execution session 2 (2026-11-12 →)

### PGO propagation root cause (verified at source)
`MOZ_PGO=1 mach build` appends env `MOZ_PROFILE_GENERATE=1`/`MOZ_PROFILE_USE=1`.
For env-backed configure options, value "1" maps to `PositiveOptionValue()` —
an EMPTY tuple (python/mozbuild/mozbuild/configure/options.py:456). But
`moz_pgo_rust` (build/moz.configure/lto-pgo.configure:226) requires the literal
value `"cross"` → `want_cross` false → `rust_pgo_flags` returns [] →
`MOZ_RUSTFLAGS_TARGET_LTOABLE` never receives `-Cprofile-use` → generated
`.cargo-library-spec.json` lacks it → rust objects embed a default
ProfileSummary → ThinLTO link ProfileSummary conflict. This is why the Windows
run needed hand-edited spec JSON.

**Fix at the generator, not the generated file**: invoke configure the way CI
does — `--enable-profile-generate=cross` / `--enable-profile-use=cross`
(browser/config/mozconfigs/*/profile-generate, build/mozconfig.common:27).
Value `("cross",)` passes `want_cross` → rust gets `-Cprofile-generate`/
`-Cprofile-use=<path>` in the spec at generation time. No tree patch needed.
Mozconfigs: `workbench/mozconfigs/mozconfig-pgo-{generate,use}`,
driver `workbench/bench/pgo-stage23.sh`.

### 1B scope note (global speculation budget)
Enforcement point found: `SpeculationRulesManager::StartPrefetch`
(dom/base/SpeculationRulesManager.cpp:26) — per-document cap already enforced
(`mPrefetchRecords.Length() >= max_records_per_document`). Records are
`PrefetchRecordChild` actors created via `WindowGlobalChild` IPDL
(`SendPPrefetchRecordConstructor`); the PARENT side is `PrefetchRecordParent`
registered on the WGP's ManagedPPrefetchRecordParent list. A browser-wide
budget would count outstanding parent actors — feasible in parent process,
needs a shared counter (per tab + global) in `PrefetchRecordParent::Init`/
destruction + admission check at construction. M effort confirmed.

### Repo/upstream facts
- Shallow clone: root `be3b973f` = snapshot boundary (no upstream history).
  Version 162.0a1, snapshot ≈ mozilla main 2026-11-11/12.
- Upstream HEAD at session start: `09b865211` — essentially current.
- Control binary preserved: `workbench/controls/FireSocks-control-thinlto.app`
  (adhoc-signed app copy of the opt+ThinLTO build, from packaged DMG source).

### 1B design (frozen until stage-3 lands)
- New pref `dom.speculation_rules.max_records_global` (RelaxedAtomicUint32,
  mirror:always). Default 32 across the whole browser (per-document cap is
  already 20; a few tabs of speculation stays allowed). SpeedMode bundle:
  Performance leaves default; Fortress sets 0 (kills all speculative fetch —
  privacy-consistent, compat-safe since prefetch is only a hint).
- Enforcement in `PrefetchRecordParent::Init` right before `AsyncOpen`:
  if a static `Atomic<uint32_t>` of live records >= cap → `mState=Canceled`,
  return (identical to the same_site_only rejection path; no status event,
  no fetch, child keeps its record until teardown — matching existing
  Init-time rejection semantics).
- Increment on `AsyncOpen` success only (mOutcome=Incomplete), decrement in
  `ActorDestroy` behind a `mCountedInGlobal` flag → counts every live record
  (in-flight fetches + completed records holding cache entries until expiry
  or activation) = true outstanding-resource budget.
- Parent-side, single main thread → check-then-act is race-free; counter is
  global, not per-WGP, so multi-tab budget comes free.
- 1C note: eagerness-based admission ranking would need an eagerness field
  added to `SpeculativePrefetchArgs` (IPDL) — defer; cap alone already
  bounds unbounded growth, and hover-fallback is always Moderate anyway.
- Indicator truthfulness: SpeculativeLoadActivity marks tabs with in-flight
  fetches — budget-rejected records never open a channel, so no activity
  is shown. Correct.

### Control-side talos `other` suite (2026-11-13, obj-opt = control build)
- a11yr: OK (60s). ts_paint: OK — 20 cycles raw:
  1070,1145,1157,1414,1418,1642,1718,1729,1763,1765,1768,1828,1831,1840,1860,
  1900,1933,2034,2145,2203 ms; median ≈ 1767 ms.
  MEASURED UNDER STAGE-1 BUILD CONTENTION — archive only, not an A/B number.
- twinopen: TEST-UNEXPECTED-ERROR timeout (browser launched with test addons
  sat idle 5 min; window-open driver did not drive — likely this terminal
  session cannot present/focus windows). Suite ended after timeout.
- For a fair startup A/B later: talos has no --binary flag, so swap the
  preserved control .app into obj-opt/dist/ and run ts_paint with the machine
  quiet, then restore the PGO .app. Plan recorded for post-stage-3.
- Nimbus "main/nimbus-desktop-experiments has not been synced" console error
  and sandbox_extension_issue_file_to_process warnings are environmental
  noise observed in every launch; not failures.
