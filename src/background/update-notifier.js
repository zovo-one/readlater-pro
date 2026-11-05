(()=>{(function(){"use strict";var i={STORAGE_KEY:"pendingUpdateNotification",LAST_SEEN_KEY:"lastSeenVersion",init:function(){chrome.runtime.onInstalled.addListener(function(e){if(e.reason==="install"){var n=chrome.runtime.getManifest().version;chrome.storage.local.set({lastSeenVersion:n})}else if(e.reason==="update"){var t=chrome.runtime.getManifest().version,o=e.previousVersion;chrome.storage.local.set({pendingUpdateNotification:{previousVersion:o,newVersion:t,updateDate:Date.now()}}),console.log("[UpdateNotifier] Extension updated: "+o+" -> "+t)}})},getPending:function(){return new Promise(function(e){chrome.storage.local.get("pendingUpdateNotification",function(n){chrome.runtime.lastError,e(n&&n.pendingUpdateNotification||null)})})},dismiss:function(e){return new Promise(function(n){chrome.storage.local.remove("pendingUpdateNotification",function(){chrome.storage.local.set({lastSeenVersion:e},function(){n()})})})}};typeof self<"u"&&(self.UpdateNotifier=i),typeof window<"u"&&(window.UpdateNotifier=i)})();})();

/* What's new tab (1.3.0). Opens src/pages/whats-new.html once per release
 * with notes, after a real update only, in a background tab. */
(function () {
  "use strict";
  // This file is also loaded by options.html; only the service worker may open tabs.
  if (typeof ServiceWorkerGlobalScope === "undefined" || !(self instanceof ServiceWorkerGlobalScope)) return;
  var RELEASE = "1.3.1";
  var QUIET_DAYS = 2;        // skip people who installed moments ago
  var MIN_GAP_DAYS = 30;     // never more than one update tab a month
  var DAY = 864e5;
  var running = null, rerun = false;

  function cmp(a, b) {
    var pa = String(a || "0").split(".").map(function (n) { return parseInt(n, 10) || 0; });
    var pb = String(b || "0").split(".").map(function (n) { return parseInt(n, 10) || 0; });
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  function openTab() {
    return chrome.windows.getAll({ windowTypes: ["normal"] }).catch(function () { return []; }).then(function (wins) {
      if (!wins.length) return chrome.storage.local.set({ whatsNewPending: RELEASE });
      // Clear the pending flag first so a second window event can't open a copy.
      return chrome.storage.local.remove("whatsNewPending").then(function () {
        return chrome.tabs.create({ url: chrome.runtime.getURL("zovo-whats-new/index.html"), active: false });
      }).catch(function (err) {
        console.warn("[WhatsNew] Deferred:", err && err.message);
        return chrome.storage.local.set({ whatsNewPending: RELEASE });
      });
    });
  }

  function maybeOpen(previousVersion) {
    if (!previousVersion || cmp(previousVersion, RELEASE) >= 0) return Promise.resolve();
    if (cmp(chrome.runtime.getManifest().version, RELEASE) < 0) return Promise.resolve();
    var info = chrome.management && chrome.management.getSelf ? chrome.management.getSelf().catch(function () { return null; }) : Promise.resolve(null);
    return info.then(function (me) {
      // Copies force-installed by an employer get no update tabs.
      if (me && me.installType === "admin") return;
      return Promise.all([
        chrome.storage.sync.get("whatsNewOptOut"),
        chrome.storage.local.get(["whatsNewShown", "whatsNewShownAt", "installDate", "zovoLastUpdateTabAt", "zovoWhatsNewOptOut"])
      ]).then(function (r) {
        var local = r[1] || {};
        if (r[0] && r[0].whatsNewOptOut === true) return;
        if (local.whatsNewShown === RELEASE) return;
        var last = Number(local.whatsNewShownAt);
        if (Number.isFinite(last) && Date.now() - last < MIN_GAP_DAYS * DAY) return;
        // Fleet rule (sprint 1030). One Zovo update tab in 30 days at most, and the page checkbox turns it off.
        if (local.zovoWhatsNewOptOut === true) return;
        var zovoLast = Number(local.zovoLastUpdateTabAt);
        if (Number.isFinite(zovoLast) && zovoLast > 0 && Date.now() - zovoLast < MIN_GAP_DAYS * DAY) return;
        var inst = Number(local.installDate);
        if (Number.isFinite(inst) && inst > 0 && Date.now() - inst < QUIET_DAYS * DAY) return;
        // Written before the tab opens so a crash can never cause a second tab.
        return chrome.storage.local.set({ whatsNewShown: RELEASE, whatsNewShownAt: Date.now(), zovoLastUpdateTabAt: Date.now() }).then(openTab);
      });
    }).catch(function (err) {
      console.warn("[WhatsNew] Skipped:", err && err.message);
    });
  }

  // Several windows can open at once after a restart; one attempt at a time,
  // plus one more pass if a window arrived while an attempt was running.
  function openPending() {
    if (running) { rerun = true; return running; }
    rerun = false;
    running = chrome.storage.local.get(["whatsNewPending", "zovoWhatsNewOptOut"]).then(function (r) {
      if (!r || r.whatsNewPending !== RELEASE) return;
      return chrome.storage.sync.get("whatsNewOptOut").then(function (s) {
        if ((s && s.whatsNewOptOut === true) || r.zovoWhatsNewOptOut === true) return chrome.storage.local.remove("whatsNewPending");
        return openTab();
      });
    }).catch(function (err) {
      console.warn("[WhatsNew] Pending open failed:", err && err.message);
    }).then(function () {
      running = null;
      if (rerun) return openPending();
    });
    return running;
  }

  chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason === "update") maybeOpen(details.previousVersion);
    // A fresh install gets onboarding, not the popup's "New in 1.3" card (popup-whats-new.js),
    // whatever the date it was installed on.
    else if (details.reason === "install") chrome.storage.local.set({ whatsNewPopupSeen: RELEASE });
  });
  chrome.runtime.onStartup.addListener(function () { openPending(); });
  chrome.windows.onCreated.addListener(function (win) {
    if (win && win.type === "normal") openPending();
  });
  self.WhatsNewTrigger = { maybeOpen: maybeOpen, openPending: openPending, RELEASE: RELEASE };
})();
