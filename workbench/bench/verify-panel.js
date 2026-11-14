var out = {};
var win = Services.wm.getMostRecentWindow("navigator:browser");
var doc = win.document;
var btn = doc.getElementById("speedmode-button");
win.PanelUI.showSubView("PanelUI-speedmode", btn);
return { shown: true };
//__MARIO_NEXT__
var out2 = {};
var win = Services.wm.getMostRecentWindow("navigator:browser");
var doc = win.document;
var pv = doc.getElementById("PanelUI-speedmode");
if (!pv) { out2.err = "no panelview"; return out2; }
var list = pv.querySelector("#speedmode-mode-list");
var btns = Array.from(list.querySelectorAll("toolbarbutton"));
out2.modeButtons = btns.length;
out2.checked = list.querySelectorAll("toolbarbutton[checked]").length;
out2.modes = btns.map(b => b.getAttribute("data-speed-mode"));
out2.labels = btns.map(b => b.label || b.getAttribute("label") || "");
var t = btns.find(b => b.getAttribute("data-speed-mode") == "4");
if (t) { t.click(); out2.modeAfterClick = Services.prefs.getIntPref("browser.speed.mode", -1); }
var b1 = btns.find(b => b.getAttribute("data-speed-mode") == "1");
if (b1) { b1.click(); out2.modeRestored = Services.prefs.getIntPref("browser.speed.mode", -1); }
try { win.PanelUI.hide(); } catch (e) {}
return out2;
