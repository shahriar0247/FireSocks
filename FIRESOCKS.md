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
