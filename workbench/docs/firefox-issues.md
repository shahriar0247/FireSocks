# Firefox Performance Issues — Research Doc

Compiled 2026-11-11. Sources: Bugzilla meta bugs, SpiderMonkey newsletters, Mozilla perf blog, Phoronix/MagicLasso/browserbench 2026 benchmarks, Gecko design docs.

## Executive summary

Firefox's deficit vs Chrome is **not** page loading (network) — it's **JavaScript execution + main-thread scheduling**, in that order. Network fetch is a minority of load time; JS dominates CPU during page load (Mozilla's own finding).

Measured gaps (2026): Speedometer 3.1 — Chrome ~1.24x Firefox; JetStream 3 — ~1.5x on some suites; SM geometric-mean slowdown vs V8 ≈ 1.35x on ordinary programs (academic measurement). Firefox *wins* StyleBench (CSS resolution) and is competitive on Wasm and MotionMark (graphics).

---

## 1. JavaScript engine (SpiderMonkey) — the biggest lever

### 1a. Structural: missing mid-tier optimizer
- V8 tiering: Ignition (interp) → Sparkplug (baseline) → **Maglev (mid optimizer)** → TurboFan (top optimizer).
- SpiderMonkey: C++ interp → Baseline interp → Baseline JIT → WarpMonkey (only ONE optimizer).
- Consequence: mid-hot code (runs often enough to matter, not hot enough for Warp) executes in a weaker tier. This is the single largest architectural gap.
- Replacing SpiderMonkey is **not feasible**: it's bound into Gecko via WebIDL codegen + XPConnect (thousands of call sites). Tuning it is the only real path.

### 1b. GC pauses
- Parallel marking landed (Firefox 124–125): −20–30% GC time, −10% max pause. Still incremental/concurrent work ongoing.
- Store-buffer iteration, sweeping-without-lock improvements landed; more listed in sm-perf-next.

### 1c. Actionable bug list (canonical)
**Bug 1943077 — [sm-perf-next] "THE place to pick your next performance issue"** — maintained by SpiderMonkey team, P1. Parent meta: **sm-js-perf**.

**OPEN items** (fetched via Bugzilla REST, 2026-11-11):

| Bug | Status | Summary |
|---|---|---|
| 1924185 | NEW | Async/await/microtask/promise overhead — **mostly fixed** per Aug 2026 comment ("no longer a hotspot for SP3"); residual overhead = SM↔Gecko boundary crossing + job allocation churn (pool candidates) |
| 1828714 | NEW (meta) | RegExp family too slow on Speedometer (`replace`, `test`, `match`, `exec`) |
| 1844857 | NEW | 2x slower on `findOptimalSegmentationInternal` — **dropped from js-perf-next** (no obvious next step; residual = value-unboxing micro-arch, ~50-90% slower than V8 in Ion code, needs VTune-level work) |
| 1490849 | NEW | Off-main-thread Baseline compilation (JIT) |
| 1914496 | NEW | Slow Ion code in Speedometer3 Angular subtest |
| 1944558 | NEW | `emit-at-uses` for MBox → inefficient codegen |
| 2031946 | NEW | Use fuses to optimize `instanceof` |
| 2037582 | NEW | Add StringConcatList stub (string concat IC) |
| 1892253 | NEW | Shared string buffer type for JS + DOM strings (kills conversions) |
| 1642374 | NEW | Irregexp: evaluate global caching optimization |
| 2041420 | NEW | Closed chrome windows kept alive until shrinking GC (memory) |
| 1913924 | ASSIGNED | Remove VMFunction wrappers |
| 2042395 | ASSIGNED | CacheIR stub for uncachable DOM proxies always fails |

**Recently resolved** (don't redo): 1827914 (eager baseline compile self-hosted), 1844878 (DOM wrapper preservation), 1914502 (scalar replace Object.keys), 1923996 (Vue createReactiveObject 2.8x WeakMap.set StoreBuffer), 1926477 (GetPropertyCached getter), 1962247 (popFuse), 1984472 (LNewTypedArray calls), 2001383 (iterator indices opt), 2001389 (MegamorphicLoadSlotPermissive).

Pattern to note: **Speedometer subtests drive the list** — every fix maps to a measurable benchmark delta. Good for our measure→fix loop.

## 2. Layout / style / reflow

- **Synchronous reflow cost**: Gecko pays more per forced layout flush than Blink — third-party measurement showed 1.5–3x on layout-thrashing JS, scaling with flush count.
- Frame-tree reconstruction propagates from root → dirty frames regardless of change size (documented in Gecko layout docs); batching mitigates but doesn't eliminate.
- Style invalidation granularity: Stylo is strong (parallel, Rust, ex-Servo) — the weakness is downstream in frame/reflow propagation.

## 3. Graphics / compositing (WebRender)

- **Bug 1889279 [wr-investigate-perf]** — meta for "performance bugs we don't fully understand." Open investigations.
- Meta set: `wr-perf`, `wr-low-end-perf`, `speedometer3` deps (see https://wiki.mozilla.org/Platform/GFX/perf_triage).
- Historical: Linux GPU driver issues (resolved mostly); reported graphics regression in 2025 (MagicLasso testing). Windows WebRender is healthy — MotionMark win.

## 4. Startup

- **Bug 890712** — `nsIOService::NewFileURI` does main-thread I/O → jank.
- **Bug 830504** — meta: main-thread SQL still exists (should abort on tryserver).
- about: pages cost: prefs panes always initialized (1533771), fontList jank after about:preferences (1426357), early blank window color (1450626), about:logins slow on Windows (1658766), newtab memory overhead (1529309).

## 5. Main-thread jank / scheduling

- Everything races the 16ms frame budget on the content main thread: JS, style flushes, layout, paint dispatch.
- Chrome deprioritizes `setTimeout(0)` during page load; Firefox historically executed them eagerly — Mozilla fixed ordering partly, pattern generalizable.
- Places/bookmarks async API still meta-open (bug 490714).
- Keyword query: `perf:frontend`, `perf:responsiveness`, `perf:resource-use` on Bugzilla.

## 6. Memory / process model

- Fission (site isolation) shipped; default content-process count lower than Chrome's per-site model — tradeoff chosen for memory, costs on site-isolated workloads.
- Counterintuitive data point: multiple independent tests show Chrome using **less** RAM + ~2W less power under tab load (per-process overhead + JS heap fragmentation in SM).
- mozjemalloc tuning is largely static; arena/cache sizing predates modern core counts.

## 7. Networking / page load

- Load-event delta vs Chrome was ~20% (2020 measurement, improved since via timer scheduling + preload scanner).
- Speculative connect/preload weaker than Chrome's predictor; no equivalent of Chrome's preconnect-aggressiveness on omnibox.

## 8. Build-level issues (the free wins — no engine changes needed)

- Local/developer builds default to `--enable-optimize` but **no PGO/LTO**: official shippable builds use PGO + full/cross-LTO — worth an estimated 5–15% alone.
- `mozconfig` defaults don't target host CPU (`-march` equivalent via RUSTFLAGS/CXXFLAGS).
- Telemetry, crash reporter, norms/updates compiled in even when unused.
- Rust components inside Gecko (Stylo, WebRender glue, mp4parse etc.) built with generic codegen-units defaults.

## 9. Structural opportunities observed in other engines (for the plan doc)

- **Ladybird** (Oct 2026): moved style + layout OFF the main thread entirely; big speedup. Gecko still style+layout on content main thread.
- **Chrome**: Maglev mid-tier, aggressive preconnect, process-per-site, compositor-driven animation everywhere.
- **Servo**: parallel layout was designed in from day one (though unfinished) — its ideas already migrated via Stylo/WebRender.
- **Blitz**: incremental box-tree construction (2025) — only rebuild changed layout subtrees.
