/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
).XPCOMUtils.declareLazy({
  NewTabUtils: "resource://gre/modules/NewTabUtils.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  UrlbarUtils: "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs",
});

const PREF_ACTIVITY = "browser.speed.show_speculative_activity";
const PREF_WARMUP = "browser.speed.startup_warmup";
const WARMUP_MAX_HOSTS = 3;

// Marks tabs whose speculation-rules prefetch fetches are in flight, so the
// tab bar can show that speculative work is happening for a tab. Listens for
// the prefetch channel (Sec-Purpose: prefetch) created by
// PrefetchRecordParent in the parent process.
export const SpeculativeLoadActivity = {
  _inflight: new Map(), // <browser> -> Set<nsIHttpChannel>
  _enabled: false,

  init() {
    this._enabled = Services.prefs.getBoolPref(PREF_ACTIVITY, true);
    Services.prefs.addObserver(PREF_ACTIVITY, this);
    if (this._enabled) {
      Services.obs.addObserver(this, "http-on-modify-request");
      Services.obs.addObserver(this, "http-on-stop-request");
    }
    if (Services.prefs.getBoolPref(PREF_WARMUP, false)) {
      ChromeUtils.idleDispatch(() => this.warmUpFromHistory());
    }
  },

  // Idle-time warm-up: speculative DNS/TLS connects to the user's top frecent
  // origins so the next navigation to a frequent site skips connect setup.
  async warmUpFromHistory() {
    let win = Services.wm.getMostRecentWindow("navigator:browser");
    if (
      !win?.gBrowser ||
      lazy.PrivateBrowsingUtils.isWindowPrivate(win)
    ) {
      return;
    }
    let links;
    try {
      links = await lazy.NewTabUtils.links.getLinks();
    } catch {
      return;
    }
    let seen = new Set();
    let warmed = 0;
    for (let link of links || []) {
      let url = link?.url;
      if (!url || !url.startsWith("http")) {
        continue;
      }
      let origin;
      try {
        origin = new URL(url).origin;
      } catch {
        continue;
      }
      if (seen.has(origin)) {
        continue;
      }
      seen.add(origin);
      try {
        lazy.UrlbarUtils.setupSpeculativeConnection(origin + "/", win);
      } catch {}
      if (++warmed >= WARMUP_MAX_HOSTS) {
        break;
      }
    }
  },

  observe(subject, topic) {
    if (topic == "nsPref:changed") {
      this.setEnabled(Services.prefs.getBoolPref(PREF_ACTIVITY, true));
      return;
    }

    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    if (topic == "http-on-modify-request") {
      this.onStart(channel);
    } else {
      this.onStop(channel);
    }
  },

  setEnabled(enabled) {
    if (enabled == this._enabled) {
      return;
    }
    this._enabled = enabled;
    const topics = ["http-on-modify-request", "http-on-stop-request"];
    if (enabled) {
      for (const t of topics) {
        Services.obs.addObserver(this, t);
      }
    } else {
      for (const t of topics) {
        Services.obs.removeObserver(this, t);
      }
      for (const browser of this._inflight.keys()) {
        this.getTab(browser)?.removeAttribute("speculativeload");
      }
      this._inflight.clear();
    }
  },

  isPrefetch(channel) {
    if (
      channel.loadInfo?.externalContentPolicyType !=
      Ci.nsIContentPolicy.TYPE_OTHER
    ) {
      return false;
    }
    try {
      return channel.getRequestHeader("Sec-Purpose").startsWith("prefetch");
    } catch {
      return false;
    }
  },

  getBrowser(channel) {
    let bc = channel.loadInfo?.browsingContext;
    if (!bc) {
      const id = channel.loadInfo?.browsingContextID;
      if (id) {
        bc = BrowsingContext.get(id);
      }
    }
    return bc?.top?.embedderElement || null;
  },

  getTab(browser) {
    return browser?.ownerGlobal?.gBrowser?.getTabForBrowser(browser) || null;
  },

  onStart(channel) {
    if (!this.isPrefetch(channel)) {
      return;
    }
    const browser = this.getBrowser(channel);
    if (!browser) {
      return;
    }
    let set = this._inflight.get(browser);
    if (!set) {
      set = new Set();
      this._inflight.set(browser, set);
    }
    set.add(channel);
    this.getTab(browser)?.setAttribute("speculativeload", "true");
  },

  onStop(channel) {
    if (!this._inflight.size) {
      return;
    }
    const browser = this.getBrowser(channel);
    if (browser) {
      const set = this._inflight.get(browser);
      if (set && set.delete(channel)) {
        if (!set.size) {
          this._inflight.delete(browser);
          this.getTab(browser)?.removeAttribute("speculativeload");
        }
        return;
      }
    }
    // Browsing context already torn down (closed tab, crashed process):
    // scan remaining inflight sets so the channel doesn't leak.
    for (const [b, set] of this._inflight) {
      if (set.delete(channel) && !set.size) {
        this._inflight.delete(b);
        this.getTab(b)?.removeAttribute("speculativeload");
        break;
      }
    }
  },
};
