# FireSocks optimization execution tracker

Session start: 2026-11-12. Reviewed HEAD `4f024eaa78` (firesocks branch, synced
with origin). Control build: `obj-opt` release+cross-ThinLTO, packaged
`dist/firesocks-162.0a1.en-US.mac.dmg`; immutable control app preserved at
`workbench/controls/FireSocks-control-thinlto.app`.

Environment: macOS arm64, 16GB RAM, 10 cores, ~20.5GB disk free at start.
Python 3.11.18 at /opt/homebrew/bin/python3.11 (raptor shim), system 3.14.
Toolchain: Mozilla clang 22.1.8 + ld64.lld + rustc 1.98.0 (LLVM 22 parity).

Status legend: done / in-progress / deferred(prereq) / blocked(external) /
investigated-no-patch / reverted.

## Phase 0 — measurement infrastructure

| Task | Disposition | Evidence/artifacts |
|---|---|---|
| 0A Paired A/B runner | done | `ab.sh`/`extract.py`/`report.py` — validated: reject-incomplete (exit 2), A/A zero-diff, runid collision fixed |
| 0B Thermal/statistical discipline | done | ab.sh thermal_wait (CPU_Speed_Limit+loadavg gates), caffeinate, counterbalanced suites, bootstrap CIs, provenance JSON |
| 0C User-journey matrix | in-progress | `journeys.sh` (talos other + sessionrestore-many-windows + tp6 headful + AWSY); control talos 'other' suite captured during stage-1 build |
| 0D Critical-path attribution | pending | needs PGO build for fresh profile |

## Phase 1 — build + navigation

| Task | Disposition | Evidence/artifacts |
|---|---|---|
| 1A macOS PGO | in-progress | stage-1 instrumented building in obj-pgo-instr; =cross mozconfigs fix rust propagation at source (see investigation.md) |
| 1B Global speculation budget | pending | scoped: enforcement point = PrefetchRecordParent::Init (parent-side count at IPDL registration) |
| 1C Intent ranking | pending | |

## Phase 2 — predictive navigation

| Task | Disposition | Evidence/artifacts |
|---|---|---|
| 2A Urlbar pause scheduler + document bridge | pending | design exists in investigation.md |
| 2B History/frecency signal adapter | pending | depends 2A |
| 2C Search preview prototype | pending | privacy review required |

## Phase 3 — cache + content

| Task | Disposition | Evidence/artifacts |
|---|---|---|
| 3A HTTP miss census | pending | |
| 3B Bytecode cache coverage | pending | |
| 3C bfcache failure census | pending | |
| 3D Image decode retention/queue | pending | |
| 3E Filtering evaluation | pending | |

## Phase 4 — main-thread engine

| Task | Disposition | Evidence/artifacts |
|---|---|---|
| 4A CC destruction/suspect churn | pending | needs fresh task-vs-idle profile |
| 4B Layout/style invalidation | pending | |
| 4C JS iterator/promise/tiering | pending | |
| 4D DOM binding/allocation hot path | pending | |

## Phase 5 — parallelism/rendering/startup

| Task | Disposition | Evidence/artifacts |
|---|---|---|
| 5A Process-pool utilization | pending | |
| 5B Worker contention census | pending | |
| 5C Graphics/compositor path | pending | |
| 5D Startup/restore responsiveness | pending | |
| 5E Honest immediate feedback | pending | |

## Phase 6 — upstream + research

| Task | Disposition | Evidence/artifacts |
|---|---|---|
| 6A Upstream delta queue | pending | remote freshness check |
| 6B Compiler experiments post-PGO | pending | |
| 6C Prerender/parallel-layout feasibility | pending | doc-only |

## Runbook (resume here)

1. `bash workbench/bench/pgo-stage23.sh all` — package instr build,
   run profileserver (SP3+JS3 local corpus, ports 8000/8001/8888 needed),
   then stage-3 profile-use build into obj-opt. Logs → artifacts/pgo/.
   Requires: merged.profdata non-empty; jarlog optional.
   CAUTION: do not edit engine sources until step 4 finishes.
2. Preserve PGO app for A/B: `rsync -a --delete obj-opt/dist/FireSocks.app/
   workbench/controls/FireSocks-pgo.app/` (only if PGO build succeeds).
3. A/B (quiet machine): `cd workbench/bench &&
   BLOCKS=4 TESTS=speedometer3,jetstream3 bash ab.sh pgo-ab
   ../controls/FireSocks-control-thinlto.app
   ../controls/FireSocks-pgo.app`
   then `python3 report.py pgo-ab --aa` (A/A noise check) and
   `python3 report.py pgo-ab` for the paired report
   (rejects incomplete blocks, exit 2).
   Keep if median diff CI excludes 0 and > +2%; else revert PGO mozconfig.
4. Startup A/B: swap control .app into obj-opt/dist/, run
   `./mach talos-test --activeTests ts_paint` quiet, then run with PGO app;
   restore. (talos has no --binary flag.)
5. Then implement frozen feature work (1B ready: design in investigation.md;
   StaticPrefList additions must be batched — rebuilds much of tree).
6. Final: mode matrix smoke (browser.speed.mode 0/1/2), package
   (`MOZCONFIG=mozconfig ./mach package`), fresh+upgrade profile smoke,
   docs updates, logical commits, push, confirm remote HEAD.
