/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
).XPCOMUtils.declareLazy({
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const PREF_ENABLED = "browser.urlbar.speculativeDocumentLoad";
const MAX_AGE_MS = 30000;

// Type-ahead document loading: while the user types in the urlbar, load the
// top url result in a hidden background tab. On Enter, if the committed URL
// matches, swap the hidden tab's contents into the selected tab so the page
// appears already loaded. Opt-in per speed mode — the hidden load is a real
// page visit (analytics, cookies) and costs a content process while alive.
export const TypeaheadLoader = {
  _tracked: new WeakMap(), // window -> { tab, url, timer }

  enabled() {
    return Services.prefs.getBoolPref(PREF_ENABLED, false);
  },

  noteTopResult(win, result) {
    if (!this.enabled() || !win?.gBrowser) {
      return;
    }
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(win)) {
      return;
    }

    const url = result?.payload?.url;
    if (!url || !url.startsWith("http")) {
      return;
    }

    const current = this._tracked.get(win);
    if (current?.url == url) {
      return; // already loading the right thing
    }
    this.cancel(win);

    let tab;
    try {
      tab = win.gBrowser.addTab(url, {
        inBackground: true,
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
      win.gBrowser.hideTab(tab);
    } catch {
      return;
    }

    const record = { tab, url, timer: null };
    record.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    record.timer.initWithCallback(
      () => this.cancel(win),
      MAX_AGE_MS,
      Ci.nsITimer.TYPE_ONE_SHOT
    );
    tab.addEventListener("TabClose", () => this._tracked.delete(win), {
      once: true,
    });
    this._tracked.set(win, record);
  },

  adopt(win, url) {
    const record = this._tracked.get(win);
    if (!record) {
      return false;
    }
    this._tracked.delete(win);
    record.timer?.cancel();

    const tab = record.tab;
    const currentSpec = tab.linkedBrowser?.currentURI?.spec;
    const loaded = currentSpec && currentSpec != "about:blank";
    const matches =
      this._urlsMatch(currentSpec, url) || this._urlsMatch(record.url, url);
    if (!loaded || !matches || tab.closing) {
      this._closeTab(win, tab);
      return false;
    }

    const gBrowser = win.gBrowser;
    gBrowser.showTab(tab);
    try {
      gBrowser.swapBrowsersAndCloseOther(gBrowser.selectedTab, tab);
      return true;
    } catch {
      // Fall back to just selecting the loaded tab.
      gBrowser.selectedTab = tab;
      return true;
    }
  },

  cancel(win) {
    const record = this._tracked.get(win);
    if (!record) {
      return;
    }
    this._tracked.delete(win);
    record.timer?.cancel();
    this._closeTab(win, record.tab);
  },

  _closeTab(win, tab) {
    try {
      if (!tab.closing) {
        win.gBrowser.showTab(tab);
        win.gBrowser.removeTab(tab);
      }
    } catch {}
  },

  _urlsMatch(a, b) {
    if (!a || !b) {
      return false;
    }
    const norm = s => s.replace(/\/+$/, "");
    return norm(a) == norm(b);
  },
};
