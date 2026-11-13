# FireSocks performance optimization plan

Review baseline: branch `firesocks`, HEAD `38c5fab6bc`. This is a task backlog, not a claim of measured improvements. No benchmark was run for this document. Expected ranges below are experiment priors, not promises, and must not be added together.

## Findings and scope

Read README, HANDOFF, investigation and fix-plan, then inspected the changed SpeedMode/settings, speculation, collector and urlbar surfaces, benchmark runner, ScriptLoader, DecodePool and CacheEntry. Searchfox queries confirmed upstream script-bytecode, decode-pool and cache machinery; local files were checked because upstream search results alone cannot establish fork behavior. This is a broad systems review, not an exhaustive audit of every Gecko implementation. Deep engine patches require a second, focused source investigation before implementation.

Already delivered, excluded from the backlog: ThinLTO, Windows PGO, RegExp species fuse, prelaunch pool, bfcache auto sizing, cache auto sizing, early hints/fetchpriority/H3, hover preconnect, typed/selected urlbar connect, same-origin hover prefetch, record cap, private-window guard, activity indicator, SpeedMode/settings, bundled uBOL, Fortress ETP and CC threshold batching. README currently contains v2 only; HANDOFF and commit history supply earlier work. Historical speculative fix-plan statements are not authoritative: Predictor is removed, persistent JIT code is not the existing bytecode cache, and prefetch is not prerender.

The largest demonstrated CPU categories are JS (~26%), layout (~20%), DOM (~14%) and CC (~19%). CC share includes idle destruction, so eliminating that share would not translate directly to benchmark gain. Existing CC threshold results are within drift. Network has little relevance to Speedometer, but is central to real navigation. There is no single measured bottleneck spanning all sites. Highest practical priorities: reliable experiments, macOS PGO, navigation hit-rate and cache-miss attribution, then targeted critical-path engine work.

## Execution contract

Tasks use S (roughly 1–2 days), M (3–7 days), L (multiple weeks including validation). Real = user workloads; Bench = synthetic suites; Both = plausible relevance to both, requiring separate proof. Mode 0 permits bounded resource trades; mode 1 remains conservative; mode 2 disables new browser-driven predictions by default. Existing feature behavior must be handled explicitly during migration rather than silently changing the dial. Semantics-preserving fixes can apply to all modes. No mode bypasses TLS, sandboxing, site isolation, CSP, SRI, cookie partitioning, cache-control or permissions.

Every task produces a scoped patch, raw results, profile comparison, memory/power report, compatibility tests and keep/revert decision. Read applicable subsystem AGENTS/skills first; use searchfox-cli for discovery and local reads to verify the checked-out implementation. New APIs/prefs below are proposals, not existing capabilities. Batch StaticPrefList additions: they rebuild much of the tree. Budget ~8 minutes for incremental build/XUL relink; avoid unrelated relinks. Do not submit Phabricator patches without approval.

## Phase 0 — trustworthy measurements (must precede optimization)

- [ ] **0A Paired A/B runner** — `workbench/bench/baseline.sh`, proposed comparison script and result schema. Replace grouped three-run suites with balanced randomized ABBA/BAAB blocks of immutable control/treatment binaries; at least 6 paired blocks initially, extend if confidence interval is inconclusive. Record hash, mozconfig, compiler, OS, hardware, mode, applied/user prefs, extension/filter versions, workload seed and cache state. Save every subtest and raw browsertime JSON. Fail on failed/missing tests: current runner uses `set -u`, and tee can mask the mach exit status. Give every artifact a unique run ID (current artifacts path is overwritten between repeats). Effect: no speed claim; prevents false wins. Measurement: deliberately fail one run, verify rejection; rerun unchanged A/A and estimate noise. S; all modes; Both; no resource trade.
- [ ] **0B Thermal and statistical discipline** — runner/results docs. Use py3.11 PATH shim; unprofiled headless SP3/JS3; compositor-dependent tp6 headful, unlocked, same viewport/refresh rate. Keep caffeinate; cool between suites to a stable idle/thermal condition, record AC power, low-power mode, temperature/thermal pressure where available and background load. Do not assume caffeinate prevents throttling. Interleave within each suite, counterbalance suite order, report paired median ratios and bootstrap intervals plus p95 latency. Do not compare Windows and Mac or profiled and unprofiled scores. S; all; Both.
- [ ] **0C User-journey matrix** — new workbench fixtures and raptor/browsertime scenarios. Cold process/profile, warm process/cold HTTP cache, warm HTTP/bytecode, back-forward, session restore, 1/10/40 tabs, ad-heavy pages, SPA interaction, image galleries and weak-network playback. Measure click/Enter-to-first-paint/LCP, input latency, long tasks, dropped frames, RSS/private memory, swap, CPU time, bytes and energy per completed journey. Separate live-site drift from deterministic recorded playback. S/M; all; Real. No effect claimed.
- [ ] **0D Critical-path attribution** — Gecko profiler with `MOZ_HEADLESS=1` and `--gecko-profile`, symbolicated builds, navigation/cache/speculation markers. Attribute task-time separately from idle CC; distinguish CPU self-time, blocked waits and queue delay. Profile startup, tab switch and first interaction too. Avoid broken samply wrapper. Establish per-site cache rejection and prefetch activation reasons. M; all; Both.

Exit: A/A noise understood, failures reliable, paired reports reproducible; a p95 regression or memory growth cannot hide behind a better geometric mean. Proposed initial ship gate: interval supports improvement on primary metric, no reproducible >2% aggregate suite regression, no material p95 regression, no leaks, and agreed resource budgets. Tighten after observing A/A variability.

## Phase 1 — build quality and high-confidence navigation wins

- [ ] **1A macOS PGO** — workbench mozconfigs, `build/pgo/`, Rust profile-use propagation. Run existing three-stage PGO path using representative browsing as well as default training; fix propagation at its generator rather than relying permanently on generated JSON edits. Mechanism: compiler layout/inlining guided by actual execution. Prior 0–10% Both, guess informed by Windows PGO+LTO improvement but Windows does not isolate PGO and is not transferable. Validate held-out SP3/JS3, startup and tp6 against identical ThinLTO control; check binary size and build reproducibility. M; all modes; no intentional runtime-memory trade; new C++ API unnecessary.
- [ ] **1B Global speculation budget** — `browser/components/speedmode/`, `dom/base/SpeculationRules*`, prefetch-record lifecycle and urlbar controller. Existing caps are per document, not a complete multi-tab resource policy. Add shared admission/cancellation accounting before adding predictors: outstanding requests, actual bytes including redirects, completed retained bytes, age and tab visibility. Initial experimental budget: one browser-driven fetch per active tab, two browser-wide, 5 MB aggregate retained payload; treat these as tunable starting points. Stop new admissions on pressure, foreground contention, offline/metered conditions when reliably detectable. New cross-process C++/IPC plumbing likely. Effect: 0–5% navigation latency on contended workloads (guess); chiefly lower waste and tail risk. M/L; mode 0 fetching, mode 1 existing conservative behavior, mode 2 no new predictions; Real. Measure useful-byte ratio, activation rate, LCP, peak RSS and cancellation completion across many tabs.
- [ ] **1C Intent ranking above existing hover** — speculation rules and urlbar modules. Combine dwell, pointer approach and link visibility as admission evidence, not permission to fetch every visible link. Reuse existing link tracking and hover timer; avoid synchronous layout or a document-wide scan. Pointer-down can prioritize an existing candidate but offers little lead time. Estimate 0–100 ms incremental click latency improvement on eligible hits, guess; report all-click weighted benefit. M; mode 0; Real; speculative bytes/CPU rise. Browser tests: mouseout, scrolling, hidden frames, ruleset coexistence, PB, cancellation, redirects and activation. Do not reimplement landed hover fallback.

## Phase 2 — deliberate predictive navigation

- [ ] **2A Urlbar pause scheduler and bridge** — `UrlbarParentController.sys.mjs`, proposed scheduler under speedmode, `dom/webidl/Document.webidl`, Document implementation, SpeculationRulesManager and existing prefetch actors. After a stable autofill/history URL and configurable 250–400 ms pause, score a single candidate; typing, selection change, Escape and mode change invalidate it. Existing `speculativeConnect` only warms transport. The documented `[ChromeOnly] Document.startPrefetch` bridge is NEW C++/WebIDL plumbing and must preserve actor ownership, principal, triggering context, origin attributes and activation matching. The active page principal cannot simply authorize an arbitrary cross-origin history destination. Start with eligible same-origin cases; cross-origin requires a separately reviewed design, otherwise preconnect only. Guess 50–300 ms saved on successful network-bound hits, 0 on misses; M/L; mode 0 opt-in; Real; bandwidth/RSS/energy cost. Measure typed-query-to-Enter, Enter-to-paint, cancellation waste and hit rate with privacy/containers/PB tests.
- [ ] **2B History/bookmark/frecency signal adapter** — existing urlbar result metadata, Places providers and scheduler. Use locally supplied result ordering and selected destinations; do not build a second history database or start background top-sites fetches. Bookmarks indicate preference, not next-click certainty. DNS for weak intent, existing preconnect for medium intent, bounded fetch only for strong eligible intent. Guess 0–150 ms on qualifying navigations; M; mode 0, preconnect-only conservative experiment in mode 1; Real. Test cold/warm DNS/TLS separately, accuracy by signal, connection churn, bytes and idle socket cost. No new C++ for scoring; fetch bridge as 2A dependency.
- [ ] **2C Search preview prototype** — urlbar scheduler and preferences UI. The user's request to prepare a search and show it only after acceptance must not execute a hidden live results tab. Initially debounce existing permitted suggestion/search transport warming; fetching query results sends private text before Enter and may bill/count searches. Require an explicit opt-in and provider-compatible, reviewed fetch/activation route before any result prefetch. Cancel on edits; preserve search suggestions settings and PB silence. Effect unknown, target 50–300 ms eligible latency reduction; M/L; mode 0 separate toggle; Real; privacy/bandwidth/power trade stated in UI. Measure requests per accepted query, wasted bytes, result freshness and no requests after cancellation. Block fetch implementation if partition-safe reuse cannot be demonstrated.

## Phase 3 — cache efficiency and content cost

- [ ] **3A HTTP miss census before sizing** — `netwerk/cache2/CacheEntry.cpp`, `CacheFileIOManager`, HTTP channel validation paths. Existing disk sizing is automatic. Classify capacity eviction, validation, Vary, partition mismatch, no-store, service worker and disk queue delay using controlled fixtures. Implement only demonstrated redundant I/O/revalidation bookkeeping or eviction defects, preserving HTTP semantics. Guess 0–5% warm-load aggregate, potentially larger affected sites; M; all for correctness fixes, mode 0 only for bounded extra capacity experiment. Real; disk/RAM/writes trade. Raptor cold/warm/revalidated loads plus cache correctness and interrupted-write tests. Do not call every miss fixable.
- [ ] **3B Bytecode cache coverage** — `dom/script/ScriptLoader.cpp`, `ScriptCompression.cpp`, cache alternate-data plumbing. Verified `PreferAlternativeDataType`, disk-cache strategy and inline-script exclusion exist. Count cache source/fallback reasons and parse/decode CPU, distinguish classic/module/SRI paths; adjust admission only when repeated scripts amortize encoding. Persisted native JIT code is outside this task. Guess 0–5% repeat-navigation CPU and 0% cold benefit; M; all for defects, mode 0 for more eager admission; Real/Both only if suite actually exercises reload caching. More disk writes/space. Validate restart, invalidation, integrity and partition isolation; test hit and corrupt/fallback paths.
- [ ] **3C bfcache failure census** — docshell/session-history and Document lifecycle (entry points to inspect before edits). Auto capacity already exists; log concrete not-restored reasons and tab memory. Only repair browser-caused eligibility defects preserving page lifecycle; do not force-cache forbidden pages. Guess 0–100s ms to seconds on newly eligible back navigation, no aggregate estimate; M/L; all for correctness; Real; retained RAM. Validate pageshow/pagehide, unload policy, forms, media, websocket/service-worker and cross-process history behavior in relevant existing tests.
- [ ] **3D Image decode retention and queueing** — `image/DecodePool.cpp`, image surface-cache/decoder callers. Pool already initializes from core count. Measure synchronous decode on LCP, queue wait, repeated decodes after eviction, requested image dimensions and upload latency. Prioritize critical visible decode or adjust bounded retention only after traces; never force every image to full resolution. Guess 0–10% image-heavy LCP, zero elsewhere; M; all for queue fixes, mode 0 for RAM budget; Real. Gallery/scroll/LCP fixtures, decoder tests, peak RSS, memory pressure and energy. CPU worker work exists; thread-count increase is an experiment, not a missing feature.
- [ ] **3E Filtering evaluation** — existing signed distribution extension and SpeedMode/settings. Compare current uBOL default with user-authorized stronger supported modes/lists, then separately evaluate full uBO packaging and update compatibility. No automatic replacement of user extensions or dual blockers. Network blocking avoids downloads/execution; cosmetic hiding alone often does not. Guess 0–30% affected ad-heavy page CPU/bytes, no SP3 benefit; M; baseline unchanged, optional mode 2 annoyance bundle and explicit per-site bypass. Real; filter parsing/RAM and breakage cost. Test login, checkout, video, consent, layout/screenshots and extension cold startup. Include filter update/version reproducibility; never enable every experimental list by default.

## Phase 4 — measured main-thread engine work

These are investigation-to-patch tasks, not verified patch recipes. The verified evidence establishes the subsystem and existing mechanism, not a safe optimization yet. Require exact local hot function, invariant and microbenchmark before proposing code changes. Read subsystem AGENTS via the required Read tool before working inside protected directories.

- [ ] **4A CC destruction and suspect churn** — `dom/base/CCGCScheduler.{h,cpp}`, `xpcom/base/nsCycleCollector.cpp`, DOM participant/unbinder callers. Preserve landed 2000/1000 mode-0 bundle as control. Separate AsyncFreeSnowWhite destruction, BuildGraph and ForgetSkippable from measured input tasks; investigate redundant traversal/refcount churn and bounded destruction scheduling rather than raising limits again. Guess 0–3% SP3, possible p95 improvements; M/L; all for equivalent algorithms, mode 0 for scheduling/memory trade. Both. DOM churn microbench, task-correlated profiles, long browsing/leak/memory-pressure tests; enforce forced collection and shutdown progress. Reject if lower frequency merely postpones larger pauses.
- [ ] **4B Layout/style invalidation** — DOM mutation callers and layout/style hot functions discovered in profiles. Existing research attributes much layout to RefreshDriver interruptible flushes; suppressing synchronous reflow is not a fix. Count repeated dirtying, redundant style recalculation and frame reconstruction per subtest; patch a proven duplicate operation with unchanged invalidation semantics. Guess 0–4% SP3, workload-specific real benefit; L; all; Both. DOM/CSS mutation microbench, style/reflow counters, reftests and relevant WPT; memory-neutral preferred. No general parallel-layout promise.
- [ ] **4C JS iterator/promise/tiering attribution** — `js/src/` generator/iterator, promise and JIT paths after local instruction review. Historical JS3 next/resume (~4.6% of JS3 profile) is a lead, not current proof. Establish self-time, allocations, IC misses, bailout causes and compile queue wait; choose one redundant operation or missed specialization. Do not re-propose RegExp fuse. Guess 0–3% suite, larger individual microbench; L; all for semantics-preserving patches; Both with JS-heavy site proof. jit-tests, differential interpreter/JIT runs, fuzzing and held-out workloads; compile time/code-size/RSS tracked. Warmup threshold experiments gated mode 0 only if proven beneficial across short and long workloads.
- [ ] **4D DOM binding/allocation hot path** — hot DOM methods and binding conversion code, identified by 0D. Profile 14% DOM category into actual functions; eliminate redundant conversions/allocations with exact observable behavior and exception ordering. Guess 0–2% SP3; L; all; Both. Targeted microbench plus relevant DOM WPT, GC stress and leak checks. Moving arbitrary DOM access to workers is not compatible with current thread ownership.

## Phase 5 — parallelism, rendering and startup

- [ ] **5A Process-pool utilization experiment** — prelaunch/process selection and Fission allocation paths (verify exact callers before edits), SpeedMode. Pool of three is already enabled. Measure process allocation waits, site count, idle RSS and tab-switch p95 across 1/10/40 tabs; test bounded alternate pool sizes rather than globally raising process count. Guess 0–100 ms on cold process creation only; M; mode 0 resource experiment; Real; substantial RAM/energy risk. Retain isolation, pressure eviction and user prefs; never force one process per tab or coalesce sites for scores.
- [ ] **5B Worker contention census** — existing DecodePool, off-thread JS compilation, style workers and compositor/raster queues. Map worker occupancy and queue wait on M-series efficiency/performance cores; identify saturation versus serialized dependency. Test one bounded pool adjustment at a time; leave OS scheduling intact. Guess 0–5% relevant throughput, possibly negative; L; mode 0 experimental resource policy, all for contention bug fixes; Both. CPU-time, energy, foreground p95, swap and battery tests alongside suites. Additional workers cannot parallelize dependency-bound JS/layout.
- [ ] **5C Graphics/compositor critical path** — gfx/WebRender/APZ pipeline, after relevant instruction review. Capture headful scrolling/animation plus GPU timings, uploads, renderer backlog, frame pacing and software fallback in about:support. Correct proven fallback or redundant upload/raster invalidation; retain driver blocklists. Guess 0% SP3 where graphics share is small; target 10–30% fewer missed frames on a demonstrated affected case, hypothesis only. L; all for safe fixes; Real. MotionMark as supplemental, not proof of pageload; image/canvas/video reftests, GPU reset and multi-display tests. Track VRAM and power.
- [ ] **5D Startup/restore and browser responsiveness** — BrowserGlue, speedmode observers, extension startup and session-restore tasks. Profile cold/warm first paint, urlbar-ready, first tab and post-paint input; defer only work proven unnecessary before those milestones. Existing activity observer fast path is already landed. Guess 0–10% startup, no SP3 gain; M; all; Real. Startup profiler, startup/restore Talos where available, large-session fixtures, crash recovery and extension readiness. Deferral must not make first interaction slower or delay security/filter initialization.
- [ ] **5E Honest immediate feedback** — tab/urlbar UI and speculation activity. Preserve existing indicator; prototype pending-navigation feedback measured from input to next frame without implying completion or activation. Avoid added animation/observers on idle tabs; reduced-motion support. Effect: no load-time reduction, target feedback within one frame; S/M; all optional UI; Real. Input/frame markers, accessibility review and screenshot tests; negligible resource budget required.

## Phase 6 — upstream maintenance and conditional research

- [ ] **6A Upstream delta queue** — compare pinned local upstream base with current fetched upstream, without merging during measurement. Reproduce candidate optimization from its actual patch and tests; ensure not already present or abandoned. Rank only matching profile signatures. No unverified bug-number shopping list. M ongoing; all; Both; unknown effect until paired test. Check security-update cadence separately from performance. Remote-tracking freshness was not established in this review; refresh before implementation, and suggest updating if behind.
- [ ] **6B Build experiments after PGO** — compiler config/mozconfigs. Thorium's public build sources show PGO/LTO and architecture-specific tuning, useful experiment categories rather than evidence of transferable gains. Compare supported compiler settings one at a time on arm64; no x86 AVX transplant or unsupported minimum CPU. Guess -3% to +3%, S/M each; all per supported binary; Both; code size/compile time/power tracked. BOLT/Polly require demonstrated platform/toolchain support first; do not make them production dependencies speculatively.
- [ ] **6C Prerender/parallel layout feasibility only** — no implementation scheduled. Chrome has a lifecycle-aware prerender system, whereas this fork's verified path is prefetch activation. Servo documents parallel layout with algorithmic boundaries; it is not a drop-in Gecko patch. Inventory lifecycle, service worker, permission, network side-effect, process swap and memory requirements before any prototype. L/research; mode 0 opt-in if ever implemented; Real; high RAM/energy/compatibility risk; no expected aggregate gain assigned. A separate design review and realistic workload evidence are prerequisites.

Phase ordering reflects expected value divided by engineering cost: scaffolding first, compiler training and bounded navigation next, cache/content instrumentation next, then expensive core changes. Reorder individual engine tasks when fresh task-time profiles justify it. Do not run all expensive investigations before shipping one defensible win.

## External research and evidence limits

Sources checked during this review; upstream search is not a substitute for local verification:

- [Firefox benchmarking guidance](https://firefox-source-docs.mozilla.org/performance/Benchmarking.html): use comparable build/runtime conditions.
- [Thorium compiler configuration](https://github.com/Alex313031/thorium/blob/main/src/build/config/compiler_opt.gni) and [optimization discussion](https://thorium.rocks/optimizations): categories for controlled build experiments, not accepted speed claims for FireSocks.
- [Chrome prerender architecture and behavior](https://developer.chrome.com/docs/web-platform/prerender-pages): prerender requires more than fetching HTML; latency examples are Chrome-specific and not estimates for this fork.
- [Servo layout design](https://book.servo.org/design-documentation/layout.html): parallelism is conditional on formatting/layout dependencies. Rust alone does not establish faster browsing. The older plan's claim about Ladybird moving all style/layout off-main-thread was not verified and must not drive work.
- [uBO filter-list guidance](https://github.com/gorhill/uBlock/wiki/Dashboard%3A-Filter-lists/a947fe5748b20d4617d9da4b79e41e1b60696b43): additional lists can increase breakage; full-uBO guidance is not proof of uBOL feature parity.

## Do not do

- Re-add removed Predictor learning/prefs: no implementing module; hover-on-SSL is the documented survivor.
- Re-propose shipped hover, urlbar connects, prelaunch, H3, cache auto sizing or CC threshold prefs: already landed.
- Claim 19% SP3 improvement from CC's sample share: much is idle work; threshold A/B is inside noise.
- Disable incremental CC globally: prior experiment found no score benefit and raises pause risk.
- Cache past no-store/expiry, bypass validators or merge cache partitions: stale/private-content and compatibility violations.
- Persist raw JIT machine code as if bytecode caching already supported it: relocations, guards, invalidation and security require a separate architecture.
- Fetch all visible links, bookmarks or popular history in the background: low-confidence bandwidth, privacy, battery and server-side cost.
- Execute hidden results pages while typing by default: queries leak before submission and page side effects are observable.
- Treat same-origin GET as side-effect-free: endpoints can mutate state; speculation must retain eligibility rules, explicit controls and conservative exclusions.
- Construct parent prefetch actors directly from JS: bypasses required document/IPC lifecycle; use the documented bridge design.
- Call prefetch prerender or promise instant rendering: activation avoids fetch work but parsing, JS, layout and paint can remain.
- Turn on all experimental ad/annoyance lists: breakage conflicts with compatibility; provide curated opt-in and site bypass.
- Disable Safe Browsing, TLS checks, sandbox, Fission or driver safety blocklists: unsupported speed/security trade and no demonstrated benefit.
- Globally delay site timers/scripts, skip layout flushes, remove website components or rewrite page design: observable behavior breaks applications.
- Maximize process/thread counts, pin cores or allocate all RAM: contention, thermal throttling and swap can worsen latency.
- Force GPU rendering indiscriminately: unsupported paths and uploads can be slower; verify existing acceleration first.
- Port Servo layout, a new JS mid-tier or broad Rust rewrites as near-term tasks: architectural projects without fork-specific payoff evidence.
- Remove telemetry/updater/crash reporting merely to claim performance: no critical-path evidence; update/security policy needs separate treatment.
- Compare sequential benchmark batches, profiled scores or different hardware: known drift and overhead invalidate attribution.
- Promise fastest-browser status: requires same-machine cross-browser, multiple real journeys, compatibility and energy evidence; one synthetic score cannot establish it.

---

## Task dispositions (session 2, 2026-11-13)

Status: done / in-progress / deferred(prereq) / investigated-no-patch /
blocked(external). Details in investigation.md.

- **0A** done — ab.sh/extract.py/report.py: ABBA blocks, unique runids,
  provenance, failure-marking + streak abort, per-subtest JSON, bootstrap
  CIs. Validated: reject-incomplete (exit 2), A/A zero-diff, real failure
  caught (relative -b path bug found & fixed).
- **0B** done — thermal_wait (CPU_Speed_Limit + loadavg<4 gates), caffeinate,
  counterbalanced suite order, py3.11 shim, provenance JSON incl. power/
  therm/uBOL sha/mozconfig+clang+binary hashes.
- **0C** in-progress — journeys.sh; control ts_paint captured (median ~1767ms,
  under build contention — archived); twinopen timed out in this env
  (window driver could not present — limitation recorded); ts_paint A/B
  planned via app swap (talos lacks --binary).
- **0D** pending — attribution profile via raptor --gecko-profile on the
  preserved apps after A/B (uses bundle, not source tree).
- **1A** in-progress — full 3-stage PGO DONE building: merged.profdata 117MB
  + jarlog; PGO app preserved. Rust -Cprofile-* propagation fixed at
  generator (CI-style =cross option values; MOZ_PGO=1 env path drops them —
  documented). A/B pgo-ab in flight → keep/revert by paired CI.
- **1B/1C** implemented-pending-validation — global in-flight cap (4),
  5MB retained-byte cap, oldest-eviction intent ranking
  (PrefetchRecordParent), Fortress cap=0 drain. Unbuilt until A/B ends
  (CPU quiet); tests: hover_fallback/hover_delays/urlbar speculative_connect.
- **2A** evaluated — same-origin-only subset via Document.startPrefetch +
  JSWindowActor is architecturally possible but hit-rate is small
  (urlbar destinations are ~always cross-origin to current doc;
  same_site_only rejects them at Init). Deferring implementation unless
  journey data shows same-origin share worth it.
- **2B** investigated-no-patch — urlbar results already carry ordering;
  existing speculativeConnect on autofill/heuristic covers the
  medium-intent tier; DNS-only for weak intent exists. Second history DB
  explicitly rejected by plan — nothing left to add.
- **2C** deferred — search result prefetch sends typed text before Enter
  (privacy) and needs provider-compatible activation; plan requires opt-in
  + reviewed route. Prereq: explicit user opt-in setting + provider terms.
- **3A–3E** pending — census methodology defined; runs on final build
  profiles (needs 0D first); patch only proven defects.
- **4A–4D** pending — need 0D attribution on the final binary first;
  historical attribution says JS/layout/GC-CC/DOM.
- **5A** investigated-no-patch — prelaunch pool of 3 already landed;
  raising pool size is the only lever and needs a RAM/p95 experiment —
  deferred to the A/B-free machine window (low expected value).
- **5B/5C/5D** pending — profile-driven (0D prerequisite).
- **5E** evaluated — SpeculativeLoadActivity indicator landed and truthful;
  pending-navigation feedback (input→next frame) is additive UI, not a
  perf mechanism — deferred as optional UI polish, not plan-critical.
- **6A** done — shallow snapshot ≈ upstream main 2026-11-11/12 (162.0a1);
  upstream HEAD 09b8652 essentially current; no meaningful delta queue.
- **6B** partial — PGO is the dominant compiler experiment (in flight);
  arm64 sub-arch tuning has no safe supported knob (no runtime dispatch);
  documented as investigated-limited.
- **6C** deferred — prerender needs lifecycle/SW/permission/process-swap
  inventory + design review; parallel layout is not a drop-in patch;
  feasibility doc note in HANDOFF.
