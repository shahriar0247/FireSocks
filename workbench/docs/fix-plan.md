# Firefox Speedup Plan — Phases

Companion to `firefox-issues.md`. Rule: measure before/after everything; a change without a benchmark delta is a guess.

## Phase 0 — Infrastructure (Day 0–1)

- Clone `github.com/mozilla-firefox/firefox` → `C:\mozilla\firefox`
- `mach bootstrap` (installs MozillaBuild, clang, mozdeps)
- Write `mozconfig` for **shippable-equivalent** build:
  - `ac_add_options --enable-release`
  - `ac_add_options --enable-lto=cross,full` (what official builds use)
  - `ac_add_options MOZ_PGO=1` → do a 3-stage PGO build (`./mach build` + `instrumented` run + profile)
  - `mk_add_options MOZ_MAKE_FLAGS="-j14"` (leave headroom on 16 threads)
  - strip: crashreporter, telemetry, updater → `ac_add_options --disable-crashreporter --disable-telemetry? (via MOZ_TELEMETRY_REPORTING=)` 
- Verify baseline: `./mach run` works.

**Deliverable**: `obj-*/dist/bin/firefox.exe` + build working end-to-end.

## Phase 1 — Baseline benchmark harness (Day 1)

Script `bench/run.sh` that automates, 5 reps each, median:
- **Speedometer 3.1** (browserbench.org) — main number (responsiveness = what users feel)
- **JetStream 3** — JS/Wasm throughput
- **Page-load set**: example.com, wikipedia.org, github.com, a React app (todoMVC) — measure `load` + LCP via `performance.timing`/`PerformanceObserver` dump
- **Startup**: cold launch → `about:home` painted (ts_paint equivalent via `mach talos-test --suite=sessionrestore` or manual timing loop)
- Capture: `about:support` + `about:processes` memory snapshot

Compare **our build vs official Firefox Nightly/Release** on the same machine — isolates build-config vs source differences.

## Phase 2 — Profile → pick targets (Day 1–2)

- Record profiles on the benchmark set with the Gecko Profiler (`profiler.firefox.com` — our build has `--enable-perf` default in Nightly-channel mozconfig).
- Rank hot stacks by self-time across: JS execution, GC, style flush, reflow, rasterize, main-thread I/O.
- Cross-reference top items against `sm-perf-next` (bug 1943077) dep list and `wr-investigate-perf` (1889279).
- Output: top-5 target list with bug IDs + estimated ceiling.

## Phase 3 — Targeted patches (Days 2+)

Candidate work items, ordered by expected effort→payoff:

| # | Item | Source | Effort |
|---|------|--------|--------|
| 1 | Main-thread I/O removal (890712 `NewFileURI`, others in profile) | Bugzilla | Low–Med |
| 2 | Timer scheduling during load (deprioritize `setTimeout(0)` beyond current behavior) | §5 issues | Med |
| 3 | Pick 2–3 `sm-perf-next` deps that match our profile hotspots | bug 1943077 | Med–High |
| 4 | mozjemalloc arena/cache sizing for 16-thread CPUs | §6 | Med |
| 5 | Content-process/`dom.ipc.processCount` tuning vs workload | §6 | Low |

Each: branch → patch → `./mach build faster` (where possible) → bench delta → keep or revert. Keep only measured wins.

## Phase 4 — Structural experiments (creative, multi-day)

Ordered by feasibility, not glamour:

1. **Page-load scheduler**: extend timer-deprioritization — defer non-critical JS (identified via interaction heuristics) past first-paint. Chrome-class trick, self-contained.
2. **JIT bytecode cache across sessions**: persist compiled Baseline/Warp artifacts (SM already has a JS bytecode cache — check coverage, extend it).
3. **More parallelism in reflow**: investigate partial/parallel reflow for independent frame subtrees (Ladybird moved style+layout off-main-thread entirely in Oct 2026 — proof it's tractable).
4. **Aggressive prefetch/preconnect** on urlbar input (chrome's predictor-lite).
5. **Mid-tier exploration** (moonshot): Maglev-class optimizer for SM is years of work — not attempted; documented only.

## Phase 5 — Regression harness + report

- `bench/compare.py`: baseline JSON vs current JSON → delta table, flag <±2% as noise.
- Final doc: `docs/results.md` — every patch with measured delta, kept/reverted, profile links.

## Phase 6 — Performance Mode (expanded mandate, multi-session)

User brief: go all-in on perceived speed. Speculative loading so clicks/searches
feel instant, warm network, heavy caching, and a user-facing performance dial —
with an explicit feature/security trade-off at the extreme end and uBO-grade
blocking at the other.

### 6.1 Speculative navigation (biggest perceived win)

- **Hover-prerender**: pointer intent on same-origin GET link →
  `SpeculativeLoad`/prerender in a hidden browser → click swaps to live content.
  Target: click→paint ≈ 0ms. Wire via `nsISpeculativeConnect`/`network.prerender`
  + link-glue in `browser/base/content` (linkhover actor).
- **Type-ahead speculative load**: urlbar input → top match is a URL/search →
  preconnect DNS+TLS to the origin immediately; speculative fetch of the page
  into the HTTP cache. Chrome predictor-equivalent.
- **Search prefetch**: same for search suggestions → warm the search endpoint.

### 6.2 Network warm-up + capacity

- `network.predictor.enabled`, raise `speculative-parallel-limit`, larger
  `max-persistent-connections-per-server/proxy`, bigger `dnsCacheEntries`,
  longer `dnsCacheExpiration`, HTTP/3 + Alt-Svc on, `network.http.rcwn` racing.
- Warm pool: keep N idle TLS connections to top-N origins from history.

### 6.3 Caching

- Raise disk cache budget, bytecode-cache coverage for page JS (SM code-cache
  is already per-origin — verify hit rate on SP3 sites), aggressively cache
  subresources with short TTLs in performance mode.

### 6.4 The dial: Performance / Balanced / Fortress

Single `browser.speed.mode` pref (0/1/2) driving a bundle of feature gates:

- **Performance (0)**: telemetry off, shield/nimbus off, Pocket off, CFR/ASRouter
  off, speculative machinery maxed, optional: Safe-Browsing list updates off
  (explicit user trade-off, banner warning on first select), reduced
  session-restore work, process count tuned up.
- **Balanced (1)**: stock-ish defaults + predictor/prerender on.
- **Fortress (2)**: ETP strict, cookie-banner blocker, `dom.disable_open_during_load`,
  annoyance/consent features on, resource-level filter lists for ads/trackers
  (evaluate: ship uBO as a bundled built-in extension vs in-tree DNR engine).

### 6.5 Settings UI

- `about:preferences` section "Speed" — 3-stop slider + explainer of the
  trade-offs + per-mode pref diff table. Front-end patch in
  `browser/components/preferences`.

### 6.6 Order of attack (by feasibility)

1. Pref bundle + `browser.speed.mode` read in `nsBrowserApp`/feature gates.
2. Predictor/prefetch pref values (trivial — wins already on the table).
3. Link-hover speculative connect (small) → hover-prerender (bigger).
4. Urlbar type-ahead preconnect → speculative fetch.
5. Settings UI slider.
6. Fortress blocking (bundled uBO or list-driven filter — research first).

## Honest expectations

- PGO+LTO build alone ≈ official-build speed (the one guaranteed "win").
- Phase 3: realistic single-digit % on specific benchmarks, occasionally more on a pathological site.
- Cumulative felt speedup is plausible; beating Chrome generally is not — the goal is *measurably faster than stock Firefox on your workloads*.

### Phase 6 progress log

- **Done — pref dial landed**: `browser.speed.mode` (0/1/2) in `firefox.js`;
  `browser/components/speedmode/SpeedMode.sys.mjs` applies per-mode pref bundles
  at `_onFirstWindowLoaded` + pref observer, tracks written prefs in
  `browser.speed.applied` so mode switches restore defaults and user-overridden
  prefs are never reclaimed. Verified live on the PGO binary (mode 0 wrote the
  full bundle to prefs.js; mode 1 writes nothing).
- **Done — speculation defaults flipped for all modes**:
  `network.predictor.enable-hover-on-ssl`→true (hover DNS/TLS preconnect on
  HTTPS), `dom.prefetch_dns_for_anchor_https_document`→true.
- **Found — hover speculative connect already exists**:
  `nsDocShell::OnOverLink` → `nsISpeculativeConnect` (was just prefed off on
  HTTPS; now on). Urlbar connect on results-added + mousedown already stock.
- **Found — Speculation-Rules prefetch machinery in-tree (M1, same-origin)**:
  `SpeculationRulesManager`, `PrefetchRecordParent`,
  `DocumentLoadListener::TryActivateFromPrefetch` — activation serves the
  record's cache entry on navigation. A browser-driven hover prefetch could
  synthesize records for same-origin GET links (the near-instant-click win)
  without building Chromium-style prerender. `dom.speculation_rules.enabled`
  is in the Performance bundle (nightly-gated stock).
- **Pending**: urlbar keyboard-selection connect; hover prefetch via
  SpeculationRulesManager (needs `SpeculativeLoadInParent` call path);
  settings UI; Fortress uBO-level blocking; Safe-Browsing-off needs explicit
  warning UI first (not bundled silently).
- **Done — hover prefetch (C++ landed + built)**: new
  `dom.speculation_rules.hover_prefetch_all` pref; `SpeculationRules`
  fallback path synthesizes a same-origin `PrefetchCandidate` after the
  200ms moderate hover delay on any http(s) link when the document has no
  rule candidates; `EventStateManager` materializes the rules object when
  the pref is on. Activation rides the existing
  `TryActivateFromPrefetch` path → near-instant same-origin clicks in
  Performance mode. Built into the PGO binary (HOVERBUILD6 exit 0).
- **Done — urlbar keyboard connect**: `speculativeConnect` gains a
  `"select"` reason fired from `onSelection`, so arrowing through results
  pre-connects like mousedown does.
- **Build lessons**: adding a StaticPrefList pref recompiles most of the
  tree (StaticPrefs_dom.h is nearly universal) — batch future pref adds.
  The `--disable-tests` era left test-module xpidl headers ungenerated;
  delete the stale `.xpt` in `obj-opt/config/makefiles/xpidl/` and run
  `make xpidl` to regenerate. Commit charge is the recurring wall —
  stale `devin acp` processes held ~21GB; killed before builds.
