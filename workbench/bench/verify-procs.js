//__MARIO_ASYNC__
var done = arguments[arguments.length-1];
var out = {};
out.processCountPref = Services.prefs.getIntPref("dom.ipc.processCount", -1);
var win = Services.wm.getMostRecentWindow("navigator:browser");
var gB = win.gBrowser;
// Open 3 tabs to force process allocation
var urls = ["https://github.com/","https://www.youtube.com/","https://www.shopify.com/"];
var tabs = urls.map(u => gB.addTab(u, {inBackground:true, triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()}));
setTimeout(function(){
  ChromeUtils.requestProcInfo().then(function(info){
    out.procCount = info.children.length + 1;
    out.tabProcs = info.children.filter(p=>p.type=="tab").length;
    out.totalMemGB = ([info,...info.children].reduce((s,p)=>s+(p.memory||0),0)/1073741824).toFixed(2);
    out.types = info.children.map(p=>p.type);
    tabs.forEach(t=>{try{gB.removeTab(t)}catch(e){}});
    done(out);
  }).catch(function(e){ out.e=String(e); done(out); });
}, 15000);
