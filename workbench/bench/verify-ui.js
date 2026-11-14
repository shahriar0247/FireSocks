var out = { mode: Services.prefs.getIntPref("browser.speed.mode", -1) };
var win = Services.wm.getMostRecentWindow("navigator:browser");
if (!win) { out.err = "no window"; return out; }
var doc = win.document;
out.win = String(win.location.href);
out.ready = doc.readyState;
out.panelview = !!doc.getElementById("PanelUI-speedmode");
out.button = !!doc.getElementById("speedmode-button");
try {
  var { CustomizableUI } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs");
  var w = CustomizableUI.getWidget("speedmode-button");
  out.widget = w ? { id: w.id, type: w.type, area: CustomizableUI.getPlacementOfWidget("speedmode-button") } : null;
} catch (e) { out.widgetErr = String(e).slice(0, 300); }
try { out.tabs = win.gBrowser.tabs.length; } catch (e) {}
out.typeahead = Services.prefs.getBoolPref("browser.urlbar.speculativeDocumentLoad", false);
return out;
