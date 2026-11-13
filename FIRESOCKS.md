# FireSocks

A performance-first Firefox build: upstream Gecko + SpiderMonkey with a
speculation-heavy networking layer, a user-facing speed-mode dial, and
SpiderMonkey micro-optimizations — wrapped in its own brand.

## What's different from Firefox

- **RegExp species fuse** — `split`/`matchAll` skip `SpeciesConstructor` when
  `RegExp.prototype.constructor`/`@@species` are untouched (6–12% faster ops).
- **Hover prefetch** — hovering a same-origin link prefetches the document
  through the speculation-rules machinery; clicks land near-instant.
- **Urlbar warm-up** — arrowing through address-bar results opens speculative
  connections to the selected destination.
- **Speed-mode dial** (`browser.speed.mode`): 0 = Performance (aggressive
  speculative networking), 1 = Balanced (stock), 2 = Fortress (strict privacy).
- **PGO + cross-module ThinLTO** build: +15% Speedometer 3, +25% JetStream 3 vs
  the same tree built without PGO.

## Build

See `workbench/HANDOFF.md` — proven Windows recipe plus a macOS arm64 one.
Requires `--with-branding=browser/branding/firesocks` + `MOZ_APP_BASENAME=FireSocks`.

## Layout

- `browser/branding/firesocks/` — brand name, strings, flaming-sock icon set.
- `workbench/` — docs (issue list, fix plan, investigation log), benchmark
  harnesses, standalone patches, logo generator, mozconfigs.

## Changelog

### v1 — Performance bundle + brand (2026-11-12)

**Build**

- Three-stage PGO + cross-module ThinLTO build pipeline brought up from a
  source snapshot: instrumented binary → profileserver run → `-fprofile-use`
  stage, including Rust `-Cprofile-use` spec fix and instrumented-stage rust
  LTO removal to fit commit memory.
- Result: Speedometer 3 **10.5 → 12.08 (+15%)**, JetStream 3 **75.3 →
  94.03 (+25%)**, both unprofiled runs.

**SpiderMonkey**

- RegExp species fuse (`bug 1956245` direction): new
  `OptimizeRegExpSpeciesFuse` + `CanOptimizeRegExpSpecies` intrinsic,
  CacheIR stub, Warp `CompilationDependency::Type::RegExpSpecies`.
  `split`/`matchAll` skip `SpeciesConstructor` while
  `RegExp.prototype.constructor`/`@@species` are default; fuse pop restores
  the slow path. Micro: split ~6.6–12.5% faster, matchAll ~0.9–7.4%.
  All jit-tests + non262/RegExp pass.

**Speculative navigation**

- Urlbar: `speculativeConnect` on keyboard selection (`"select"`), with
  private-window detection via `PrivateBrowsingUtils` when no query context
  exists.
- Hover prefetch: new `dom.speculation_rules.hover_prefetch_all` pref —
  documents with no rule sets synthesize a moderate-eagerness
  `PrefetchCandidate` for hovered same-origin http(s) links, activating
  through the existing `PrefetchRecordParent` path (near-instant clicks).
- New safe defaults: HTTPS hover preconnect
  (`network.predictor.enable-hover-on-ssl`) and HTTPS anchor DNS prefetch.

**Speed mode**

- `browser.speed.mode` dial + `SpeedMode.sys.mjs` startup applier:
  0 = Performance (speculative-parallel-limit 40, 10 persistent conns/server,
  DNS cache 300 s, speculation rules + hover prefetch), 1 = Balanced
  (default/stock), 2 = Fortress (strict privacy; blocking engine pending).
  Applied prefs tracked in `browser.speed.applied` so mode switches restore
  cleanly.

**Branding — FireSocks**

- `browser/branding/firesocks/`: full brand directory (display name, ftl
  strings, installer art), generated flaming-sock logo
  (`workbench/bench/firesocks_logo.py`) across all PNG/ICO/BMP/MSIX/SVG assets.
- Windows install produced by binary patch of the PGO build: renamed
  `firesocks.exe`, all 15 icon resource groups × 7 sizes replaced,
  `application.ini` Vendor/Name/RemotingName=FireSocks, VisualElements tiles,
  Desktop + Start Menu shortcuts → `%LOCALAPPDATA%\FireSocks`.
- Real branded rebuild configured (`mozconfig-firesocks-windows`,
  `obj-firesocks`, reuses the same merged.profdata).

**Distribution**

- Fork `shahriar0247/FireSocks`: `firesocks` = perf + branding + workbench;
  `shahriar0247/perf-speculative-navigation` = perf-only, upstream-clean.
- Upstream PR mozilla-firefox/firefox#445 opened with full tables —
  auto-closed by Mozilla policy (Phabricator-only); equivalent patch kept at
  `workbench/patches/upstream-perf-bundle.patch`.
- `workbench/` added: HANDOFF.md, docs, bench harness, patches, mozconfigs.
