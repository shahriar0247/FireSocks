var out = {};
var win = Services.wm.getMostRecentWindow("navigator:browser");
var b = win.gBrowser.selectedBrowser;
b.loadURI(Services.io.newURI("https://example.com/"), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
return { nav1: true };
//__MARIO_NEXT__
var out = {};
var win = Services.wm.getMostRecentWindow("navigator:browser");
var b = win.gBrowser.selectedBrowser;
b.loadURI(Services.io.newURI("https://example.org/"), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
return { nav2: true };
//__MARIO_NEXT__
var out = {};
var win = Services.wm.getMostRecentWindow("navigator:browser");
var b = win.gBrowser.selectedBrowser;
var sh = b.browsingContext.sessionHistory;
out.entries = [];
for (var i = 0; i < sh.count; i++) {
  var e = sh.getEntryAtIndex(i);
  out.entries.push({i:i, inBF: e.isInBFCache, url: e.URI ? e.URI.spec : "?"});
}
return out;
