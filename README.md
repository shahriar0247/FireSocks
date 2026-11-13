# FireSocks

A performance-focused Firefox fork. Every speed/security trade-off is explicit
and user-controllable through the **Speed Mode** dial in about:preferences —
nothing is silently weakened.

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
