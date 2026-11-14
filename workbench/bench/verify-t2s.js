var out = {};
try {
  var { UrlbarProviderTabToSearch } = ChromeUtils.importESModule("moz-src:///browser/components/urlbar/UrlbarProviderTabToSearch.sys.mjs");
  out.provider = true;
  out.active = UrlbarProviderTabToSearch.isActive ? UrlbarProviderTabToSearch.isActive() : "?";
} catch (e) { out.impErr = String(e).slice(0,300); }
try {
  var { UrlbarPrefs } = ChromeUtils.importESModule("moz-src:///browser/components/urlbar/UrlbarPrefs.sys.mjs");
  out.suggestEngines = UrlbarPrefs.get("suggest.engines");
  out.tabToSearch = UrlbarPrefs.get("tabToSearch.onboard.interactionsleft");
} catch (e) { out.pErr = String(e).slice(0,300); }
return out;
