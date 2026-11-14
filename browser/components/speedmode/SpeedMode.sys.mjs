/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const PREF_MODE = "browser.speed.mode";
const PREF_APPLIED = "browser.speed.applied";

// Pref bundles per mode. Performance favors aggressive speculative networking;
// Fortress favors blocking. Only prefs listed here are managed by SpeedMode —
// anything the user set manually outside this list is left alone, and managed
// prefs a user overwrote after we applied them are not reclaimed.
const MODE_BUNDLES = {
  // 0 = Performance
  0: {
    "network.http.speculative-parallel-limit": 40,
    "network.http.max-persistent-connections-per-server": 10,
    "network.dnsCacheExpiration": 300,
    "network.predictor.enable-hover-on-ssl": true,
    "dom.prefetch_dns_for_anchor_https_document": true,
    "dom.speculation_rules.enabled": true,
    "dom.speculation_rules.hover_prefetch_all": true,
    // Halve the hover→prefetch reaction delay (more false-positive
    // prefetches is the accepted trade-off in this mode).
    "dom.speculation_rules.moderate_hover_delay_ms": 100,
    // Batch cycle-collector work harder: fewer graph walks and purple-buffer
    // rescans during heavy DOM churn, at the cost of garbage living longer.
    "dom.cycle_collector.purple_limit": 2000,
    "dom.cycle_collector.skippable_suspect_growth": 1000,
    // GPU pipeline: precompile WebRender shaders at startup (kills
    // first-frame jank), push more of the SVG/vector raster path off the
    // CPU blob renderer and onto the GPU, and grow the warm caches so
    // images and canvas tiles stay resident instead of re-decoding.
    "gfx.webrender.precache-shaders": true,
    "gfx.webrender.max-partial-present-rects": 4,
    "gfx.webrender.svg-shapes.ellipses": true,
    "gfx.webrender.svg-shapes.strokes": true,
    "gfx.webrender.svg-shapes.gradients": true,
    "gfx.webrender.svg-text": true,
    "gfx.canvas.accelerated.force-enabled": true,
    "gfx.canvas.accelerated.cache-size": 512,
    "gfx.canvas.accelerated.cache-items": 16384,
    "image.mem.surfacecache.max_size_kb": 3145728,
    // Keep more pages in the back/forward cache for instant restores.
    "browser.sessionhistory.max_total_viewers": 16,
    // OS scheduling: foreground content process runs ABOVE_NORMAL,
    // main threads and the compositor run at raised thread priority.
    "dom.ipc.processPriorityManager.foregroundRaisesMainThreadPriority": true,
    "dom.ipc.processPriorityManager.foregroundRaisesProcessPriority": true,
    "gfx.compositor.raise-thread-priority": true,
  },
  // 1 = Balanced — no managed prefs; restores defaults for anything we set.
  1: {},
  // 2 = Fortress — strict tracking protection, no sponsored content,
  // no autoplay, no notification prompts.
  2: {
    "browser.contentblocking.category": "strict",
    "browser.newtabpage.activity-stream.unifiedAds.tiles.enabled": false,
    "browser.newtabpage.activity-stream.unifiedAds.spocs.enabled": false,
    "media.autoplay.default": 5,
    "permissions.default.desktop-notification": 2,
    // No new speculative fetches in Fortress (global record cap 0; any
    // next admission attempt also drains still-in-flight records first).
    "dom.speculation_rules.max_records_global": 0,
  },
  // 3 = Overdrive — everything Performance does, plus request pacing off,
  // deeper connection pools, zero hover delay and urlbar type-ahead
  // document loading. Highest bandwidth and process count.
  3: {
    "network.http.speculative-parallel-limit": 60,
    "network.http.max-connections": 400,
    "network.http.max-persistent-connections-per-server": 16,
    "network.http.request.max-start-delay": 0,
    "network.http.pacing.requests.enabled": false,
    "network.dnsCacheExpiration": 600,
    "network.predictor.enable-hover-on-ssl": true,
    "dom.prefetch_dns_for_anchor_https_document": true,
    "dom.speculation_rules.enabled": true,
    "dom.speculation_rules.hover_prefetch_all": true,
    "dom.speculation_rules.moderate_hover_delay_ms": 0,
    "dom.cycle_collector.purple_limit": 2000,
    "dom.cycle_collector.skippable_suspect_growth": 1000,
    "gfx.webrender.precache-shaders": true,
    "gfx.webrender.max-partial-present-rects": 4,
    "gfx.webrender.svg-shapes.ellipses": true,
    "gfx.webrender.svg-shapes.strokes": true,
    "gfx.webrender.svg-shapes.gradients": true,
    "gfx.webrender.svg-text": true,
    "gfx.canvas.accelerated.force-enabled": true,
    "gfx.canvas.accelerated.cache-size": 512,
    "gfx.canvas.accelerated.cache-items": 16384,
    "image.mem.surfacecache.max_size_kb": 3145728,
    "browser.sessionhistory.max_total_viewers": 16,
    "dom.ipc.processPriorityManager.foregroundRaisesMainThreadPriority": true,
    "dom.ipc.processPriorityManager.foregroundRaisesProcessPriority": true,
    "gfx.compositor.raise-thread-priority": true,
    "dom.ipc.processCount": 16,
    "browser.urlbar.speculativeDocumentLoad": true,
    "browser.speed.startup_warmup": true,
    // Paint as soon as there's anything to show — may flash unstyled
    // content briefly on slow pages.
    "nglayout.initialpaint.delay": 0,
    "nglayout.initialpaint.delay_in_oopif": 0,
  },
  // 4 = NetAggressive — connection and request limits only; no process or
  // GPU changes. For request-heavy dashboards where the bottleneck is
  // server fan-out.
  4: {
    "network.http.speculative-parallel-limit": 40,
    "network.http.max-connections": 400,
    "network.http.max-persistent-connections-per-server": 16,
    "network.http.request.max-start-delay": 0,
    "network.http.pacing.requests.enabled": false,
    "network.dnsCacheExpiration": 300,
    "network.predictor.enable-hover-on-ssl": true,
    "dom.prefetch_dns_for_anchor_https_document": true,
    "dom.speculation_rules.enabled": true,
    "dom.speculation_rules.hover_prefetch_all": true,
    "browser.urlbar.speculativeDocumentLoad": true,
    "browser.speed.startup_warmup": true,
  },
  // 5 = ManyThreads — more content processes and higher scheduling
  // priority for the foreground tab. Higher RAM use.
  5: {
    "dom.ipc.processCount": 16,
    "dom.ipc.processPriorityManager.foregroundRaisesMainThreadPriority": true,
    "dom.ipc.processPriorityManager.foregroundRaisesProcessPriority": true,
    "gfx.compositor.raise-thread-priority": true,
    "browser.sessionhistory.max_total_viewers": 16,
  },
  // 6 = Light — fewer content processes and smaller caches; for battery
  // or low-RAM conditions.
  6: {
    "dom.ipc.processCount": 4,
    "browser.sessionhistory.max_total_viewers": 4,
    "image.mem.surfacecache.max_size_kb": 524288,
  },
  // 7 = Requests — parallel-request tuning only (no speculation): deep
  // per-server pools and pacing off.
  7: {
    "network.http.max-connections": 600,
    "network.http.max-persistent-connections-per-server": 24,
    "network.http.request.max-start-delay": 0,
    "network.http.pacing.requests.enabled": false,
    "network.dnsCacheExpiration": 300,
  },
};

// Mode metadata for UI surfaces (speedmode toolbar panel, about:preferences).
// `restart` marks modes whose bundle contains prefs that only take effect
// on process start (dom.ipc.processCount).
export const SPEED_MODE_INFO = [
  { mode: 0, id: "performance", restart: false },
  { mode: 1, id: "balanced", restart: false },
  { mode: 2, id: "fortress", restart: false },
  { mode: 3, id: "overdrive", restart: true },
  { mode: 4, id: "netaggressive", restart: false },
  { mode: 5, id: "manythreads", restart: true },
  { mode: 6, id: "light", restart: true },
  { mode: 7, id: "requests", restart: false },
];

function readApplied() {
  try {
    return JSON.parse(Services.prefs.getStringPref(PREF_APPLIED, "{}"));
  } catch {
    return {};
  }
}

function setPref(name, value) {
  switch (typeof value) {
    case "boolean":
      Services.prefs.setBoolPref(name, value);
      break;
    case "number":
      Services.prefs.setIntPref(name, value);
      break;
    default:
      Services.prefs.setStringPref(name, value);
  }
}

export const SpeedMode = {
  init() {
    this.apply();
    Services.prefs.addObserver(PREF_MODE, () => this.apply());
  },

  apply() {
    const mode = Services.prefs.getIntPref(PREF_MODE, 1);
    const bundle = MODE_BUNDLES[mode];
    if (!bundle) {
      return;
    }

    const applied = readApplied();

    // Clear prefs we set previously that the new mode doesn't manage, unless
    // the user has since overwritten them.
    for (const [name, value] of Object.entries(applied)) {
      if (!(name in bundle) && Services.prefs.prefHasUserValue(name)) {
        // Only clear if the current value still matches what we wrote;
        // a different user value means the user took it over.
        const current = Services.prefs.getPrefType(name)
          ? this.getPref(name)
          : value;
        if (current === value) {
          Services.prefs.clearUserPref(name);
        }
        delete applied[name];
      }
    }

    for (const [name, value] of Object.entries(bundle)) {
      // Don't clobber a pref the user customized on top of our value.
      if (
        Services.prefs.prefHasUserValue(name) &&
        !(name in applied) &&
        this.getPref(name) !== value
      ) {
        continue;
      }
      setPref(name, value);
      applied[name] = value;
    }

    Services.prefs.setStringPref(PREF_APPLIED, JSON.stringify(applied));
  },

  getPref(name) {
    switch (Services.prefs.getPrefType(name)) {
      case Services.prefs.PREF_BOOL:
        return Services.prefs.getBoolPref(name);
      case Services.prefs.PREF_INT:
        return Services.prefs.getIntPref(name);
      default:
        return Services.prefs.getStringPref(name);
    }
  },
};
