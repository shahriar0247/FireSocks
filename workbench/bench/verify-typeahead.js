var out = {};
var win = Services.wm.getMostRecentWindow("navigator:browser");
var doc = win.document;
Services.prefs.setBoolPref("browser.urlbar.speculativeDocumentLoad", true);
try {
  var { TypeaheadLoader } = ChromeUtils.importESModule("moz-src:///browser/components/speedmode/TypeaheadLoader.sys.mjs");
  out.imported = true;
} catch (e) { out.impErr = String(e).slice(0,300); return out; }
var gB = win.gBrowser;
out.tabsBefore = gB.tabs.length;
TypeaheadLoader.noteTopResult(win, { payload: { url: "https://example.com/" } });
out.hiddenTabs = gB.tabs.length - gB.visibleTabs.length;
out.tabsAfter = gB.tabs.length;
var hidden = gB.tabs.filter(t => t.hidden).map(t => t.linkedBrowser && t.linkedBrowser.currentURI ? t.linkedBrowser.currentURI.spec : "?");
out.hiddenURIs = hidden;
return out;
//__MARIO_NEXT__
var out2 = {};
var win = Services.wm.getMostRecentWindow("navigator:browser");
var gB = win.gBrowser;
out2.tabs = gB.tabs.length;
out2.hiddenURIs = gB.tabs.filter(t => t.hidden).map(t => t.linkedBrowser && t.linkedBrowser.currentURI ? t.linkedBrowser.currentURI.spec : "?");
var { TypeaheadLoader } = ChromeUtils.importESModule("moz-src:///browser/components/speedmode/TypeaheadLoader.sys.mjs");
var adopted = TypeaheadLoader.adopt(win, "https://example.com/");
out2.adopted = !!adopted;
return out2;
//__MARIO_NEXT__
var out3 = {};
var win = Services.wm.getMostRecentWindow("navigator:browser");
var gB = win.gBrowser;
out3.currentURI = gB.selectedBrowser.currentURI ? gB.selectedBrowser.currentURI.spec : "?";
out3.tabsAfterAdopt = gB.tabs.length;
out3.hiddenLeft = gB.tabs.filter(t => t.hidden).length;
Services.prefs.clearUserPref("browser.urlbar.speculativeDocumentLoad");
return out3;
