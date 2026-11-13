# FireSocks

A performance-focused Firefox fork. Every speed/security trade-off is explicit
and user-controllable through the **Speed Mode** dial in about:preferences —
nothing is silently weakened.

## Changelog — v3 (macOS arm64, 2026-11-13)

### Build — macOS PGO, measured and kept
- **Three-stage PGO pipeline on macOS**: instrumented build → profileserver
  (Speedometer 3 + JetStream 3 workload) → profile-use + ThinLTO.
  Profile: `merged.profdata` 117 MB (108 profraws) + jarlog.
- **Rust PGO propagation fixed**: upstream `MOZ_PGO=1` silently drops
  `-Cprofile-generate`/`-Cprofile-use` for Rust (env option yields a bare
  flag, not the `cross` value `moz_pgo_rust` requires). Using CI-style
  `--enable-profile-generate=cross` / `--enable-profile-use=cross`
  mozconfigs instead — verified live in rustc and clang command lines.
  No build-system patch needed.

### Measured results — paired A/B vs immutable ThinLTO control
6 ABBA/BAAB blocks, 48/48 runs, thermal+load-gated, per-run provenance +
SHA-256, raw browsertime JSON retained. Harness:
`workbench/bench/{ab.sh,extract.py,report.py}`.

| Benchmark | Control | PGO | Delta | CI95 |
|---|---|---|---|---|
| Speedometer 3 | ~37.5 | ~45.4 | **+7.91 med (+21.1% mean)** | [7.39, 8.38] |
| JetStream 3 | ~246 | ~259 | **+13.25 med (+5.6% mean)** | [11.53, 15.98] |
| Startup (`ts_paint`) | 784 ms | 750 ms | ~4.3% | 20 cycles each |

- A/A same-binary noise check healthy (CIs contain 0; noise ~8x below the
  smallest effect). PGO retained per pre-registered decision rule.
- Binary size: XUL 242.1 → 248.6 MB (+2.6%).
- Profile attribution on the shipping build (SP3 content thread): JS 20.2%,
  Layout 12.0%, GC/CC 11.1%, DOM 5.7%, Graphics 2.4%. Top jank: cycle-
  collector purple scan — Performance mode's CC batching is the lever.
- Caveat: +21% on SP3 is unusually large for PGO — partly because `=cross`
  also guides Rust codegen (which upstream's `MOZ_PGO=1` never did).
  Re-measure before quoting publicly; methodology in
  `workbench/docs/perf-report.md`.

### Global speculation budget (new)
- **Browser-wide prefetch admission control** in the parent process
  (`PrefetchRecordParent`): `dom.speculation_rules.max_records_global`
  (default 4; 0 disables) + `dom.speculation_rules.max_transfer_bytes_global`
  (default 5 MB) bound concurrent fetches and retained bytes.
- **Oldest-first eviction**: at the cap, the oldest in-flight prefetch is
  cancelled so fresh user intent (hover/tap) outranks stale speculation.
- Lifecycle-safe accounting across completion, cancellation and actor
  destruction — no leaks or double-decrements.
- **Fortress mode sets the global cap to 0** — no new speculative fetches.
- Tests: hover-fallback 10/10, hover-delays 2/2, urlbar speculative-connect
  12/13 (1 conditional skip, 0 unexpected failures).

### Validation
- Speed-mode matrix verified on the shipped build: Performance applies the
  full bundle, Balanced restores, Fortress applies strict prefs + cap 0;
  live mode-switching works.
- uBOL silent install on fresh profile, persists across relaunch.
- Packaged `firesocks-162.0a1.en-US.mac.dmg` (113 MB).

## Changelog — v2

### Speed Mode
- Three-way `browser.speed.mode` dial in about:preferences: **Performance**,
  **Balanced** (default), **Fortress**. SpeedMode manages pref bundles per
  mode, tracks what it applied, and never clobbers user-overridden prefs.
- **Performance** bundle: speculative-parallel limit 40, persistent
  connections 10, longer DNS cache, hover preconnect on HTTPS, anchor DNS
  prefetch, Speculation Rules on, hover-prefetch-all on, 100 ms
  hover→prefetch delay, and batched cycle collection (see below).
- **Fortress** bundle: strict ETP (Disconnect lists, partitioned cookies,
  cryptominer/fingerprinter blocking, query stripping, FPP, bounce
  tracking), sponsored New Tab content off, autoplay blocked, desktop
  notifications default-denied.

### Speculative page loading
- **Speculation Rules enabled on all channels** (upstream is Nightly-only;
  flipped via `firefox.js`, mirrors through the pref service).
- **Hover-prefetch fallback**: when a page has no speculation-rules set,
  hovering a same-origin HTTP(S) link synthesizes a moderate-eagerness
  prefetch. Private-browsing gated, record-capped (20/document, 5 MB,
  5 min TTL, 2 s activation wait).
- **Urlbar speculative connects**: preconnect on typed result AND on
  selection/highlight; each independently toggleable
  (`browser.urlbar.speculativeConnect.enabled` / `.select`).
- **`max_records_per_document` is now actually enforced** — the pref was
  declared upstream but never checked.
- Browser test suite `browser_speculation_rules_hover_fallback.js`:
  **11/11 checks green** — same-origin fire, cross-origin reject,
  private-browsing silence, mouseout cancel, ruleset-present skip,
  record cap, and `performance.navigation` deliveryType =
  `navigational-prefetch` on activation.

### Visibility & controls
- **Speculative-load tab indicator**: in-flight prefetch channels
  (`Sec-Purpose: prefetch`, TYPE_OTHER) set a `speculativeload` attribute on
  the owning tab → animated line in the tab bar. Works in horizontal and
  vertical tabs, respects reduced-motion, pref
  `browser.speed.show_speculative_activity`.
- **FireSocks Mods pane** (settings redesign): toggles for urlbar connects,
  hover prefetch, speculation rules, hover-on-SSL connect, anchor DNS
  prefetch, and the activity indicator.

### Ad blocking
- **uBlock Origin Lite** vendored as a `distribution/extensions/` signed XPI:
  installs silently enabled per profile, verified active/visible/signed,
  user-manageable in about:addons, self-updates via AMO. Baseline product
  feature — Fortress layers strict ETP on top rather than gating it.

### Engine tuning
- **Cycle-collector thresholds are now prefs** —
  `dom.cycle_collector.purple_limit` (was `kCCPurpleLimit` = 200) and
  `dom.cycle_collector.skippable_suspect_growth` (was the +100 suspect
  delta). Profiling showed ~19% of Speedometer's content main-thread time
  inside cycle collection; Performance mode batches 10× (2000/1000),
  trading memory for fewer CC graph walks and buffer rescans.

### Benchmarks (macOS, opt + ThinLTO, headless, unprofiled)
- **Speedometer 3: 37.04** median (37.00 / 37.04 / 37.42)
- **JetStream 3: 233.15** median (223.10 / 233.15 / 243.04)
- Harness `workbench/bench/baseline.sh`: headless + caffeinate by default
  (headful stalls when the display locks), `SITES=1 HEADLESS=0` for tp6
  pageload runs, Python ≤3.13 required.

## Changelog — v1 (Windows x64, 2026-11-12)

### Build
- Three-stage PGO + cross-module ThinLTO pipeline brought up from a source
  snapshot: instrumented binary → profileserver run → `-fprofile-use` stage;
  Rust `-Cprofile-use` spec fix; instrumented-stage rust LTO removed to fit
  commit memory.
- Result (unprofiled): Speedometer 3 **10.5 → 12.08 (+15%)**, JetStream 3
  **75.3 → 94.03 (+25%)**.

### SpiderMonkey
- RegExp species fuse (bug 1956245 direction): `OptimizeRegExpSpeciesFuse` +
  `CanOptimizeRegExpSpecies` intrinsic, CacheIR stub, Warp
  `CompilationDependency::Type::RegExpSpecies`. `split`/`matchAll` skip
  `SpeciesConstructor` while `RegExp.prototype.constructor`/`@@species` are
  default. Micro: split ~6.6–12.5%, matchAll ~0.9–7.4%. All jit-tests +
  non262/RegExp pass.

### Speculative navigation
- Urlbar: `speculativeConnect` on keyboard selection; private windows gated
  via `PrivateBrowsingUtils`.
- Hover prefetch (`dom.speculation_rules.hover_prefetch_all`): pages with no
  rule sets synthesize a moderate-eagerness `PrefetchCandidate` on
  same-origin link hover → activation through `PrefetchRecordParent`.
- New defaults: HTTPS hover preconnect, HTTPS anchor DNS prefetch.

### Speed mode
- `browser.speed.mode` dial + `SpeedMode.sys.mjs`: 0 = Performance
  (speculative-parallel 40, 10 conns/server, DNS 300 s, speculation rules +
  hover prefetch), 1 = Balanced (default), 2 = Fortress. Applied prefs
  tracked for clean switching.

### Branding & distribution
- `browser/branding/firesocks/` brand dir + generated flaming-sock logo
  (all PNG/ICO/BMP/MSIX/SVG assets).
- Windows install via binary patch of the PGO build: `firesocks.exe`, all
  icon resource groups replaced, `application.ini` Vendor/Name/
  RemotingName=FireSocks, Desktop + Start Menu shortcuts →
  `%LOCALAPPDATA%\FireSocks`.
- Upstream PR mozilla-firefox/firefox#445 (auto-closed — Phabricator-only);
  patch at `workbench/patches/upstream-perf-bundle.patch`.

---

![Firefox Browser](./docs/readme/readme-banner.svg)

[Firefox](https://firefox.com/) is a fast, reliable and private web browser from the non-profit [Mozilla organization](https://mozilla.org/).

### Contributing

To learn how to contribute to Firefox read the [Firefox Contributors' Quick Reference document](https://firefox-source-docs.mozilla.org/contributing/contribution_quickref.html).

We use [bugzilla.mozilla.org](https://bugzilla.mozilla.org/) as our issue tracker, please file bugs there.

### Resources

* [Firefox Source Docs](https://firefox-source-docs.mozilla.org/) is our primary documentation repository
* Nightly development builds can be downloaded from [Firefox Nightly page](https://www.mozilla.org/firefox/channel/desktop/#nightly)

If you have a question about developing Firefox, and can't find the solution
on [Firefox Source Docs](https://firefox-source-docs.mozilla.org/), you can try asking your question on Matrix at
chat.mozilla.org in the [Introduction channel](https://chat.mozilla.org/#/room/#introduction:mozilla.org).
