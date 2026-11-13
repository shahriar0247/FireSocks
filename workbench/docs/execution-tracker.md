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
| 0A Paired A/B runner | in-progress | `workbench/bench/ab.sh` + `report.py` |
| 0B Thermal/statistical discipline | in-progress | folded into ab.sh + docs |
| 0C User-journey matrix | pending | subset via raptor/browsertime |
| 0D Critical-path attribution | pending | needs PGO build for fresh profile |

## Phase 1 — build + navigation

| Task | Disposition | Evidence/artifacts |
|---|---|---|
| 1A macOS PGO | in-progress | 3-stage manual pipeline (=cross mozconfigs), disk-risk monitored |
| 1B Global speculation budget | pending | |
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
