/* ReadLater Pro - feature registry.
 * Descriptive metadata plus the cached tier for UI rendering.
 * The tier is held in memory only. It is refreshed from the service worker,
 * which is the one place that talks to the licence server. Nothing here reads
 * a tier out of chrome.storage, so a storage write cannot grant Pro.
 */
(function () {
  "use strict";

  var TIERS = { FREE: "free", PRO: "pro", UNBUILT: "not_sold" };
  var MAX_FEATURES = 64;

  var FEATURES = {
    one_click_save: {
      id: "one_click_save",
      name: "One-Click Save",
      description: "Save any page to your reading list with a single click or keyboard shortcut",
      category: "core",
      limit: null
    },
    reader_view: {
      id: "reader_view",
      name: "Reader View",
      description: "Distraction-free reading mode that strips ads, navigation, and clutter from saved articles",
      category: "core",
      limit: null
    },
    side_panel_list: {
      id: "side_panel_list",
      name: "Side Panel Reading List",
      description: "Browse and manage your reading list in the side panel without leaving your current tab",
      category: "core",
      limit: null
    },
    tags: {
      id: "tags",
      name: "Tags and Organization",
      description: "Tag saved articles for easy categorization and filtering",
      category: "core",
      limit: null
    },
    pocket_import: {
      id: "pocket_import",
      name: "Pocket Import",
      description: "Import a Pocket HTML export file, including tags and read status",
      category: "data",
      limit: null
    },
    context_menu_save: {
      id: "context_menu_save",
      name: "Right-Click Save",
      description: "Save pages or links from the browser context menu without opening them first",
      category: "core",
      limit: null
    },
    basic_search: {
      id: "basic_search",
      name: "Title and Tag Search",
      description: "Search your reading list by article title, site name or excerpt",
      category: "search",
      limit: null
    },
    reading_progress: {
      id: "reading_progress",
      name: "Reading Progress",
      description: "Tracks scroll position so you can resume reading where you left off",
      category: "core",
      limit: null
    },
    offline_reading: {
      id: "offline_reading",
      name: "Offline Reading",
      description: "Keeps the full article text on your device so it opens with no connection",
      category: "storage",
      limit: null
    },
    full_text_search: {
      id: "full_text_search",
      name: "Full-Text Search",
      description: "Search the complete text of every saved article, not just titles and tags",
      category: "search",
      limit: null
    },
    highlights_notes: {
      id: "highlights_notes",
      name: "Highlights and Notes",
      description: "Highlight passages and attach notes to saved articles",
      unbuilt: true,
      category: "advanced",
      limit: null
    },
    auto_tagging: {
      id: "auto_tagging",
      name: "Smart Auto-Tagging",
      description: "Suggests tags from the article content and your existing tag list",
      unbuilt: true,
      category: "advanced",
      limit: null
    },
    bulk_export: {
      id: "bulk_export",
      name: "Bulk Export",
      description: "Export your whole library as JSON, CSV, or an HTML bookmarks file",
      category: "data",
      limit: null
    },
    reading_stats: {
      id: "reading_stats",
      name: "Reading Statistics",
      description: "Articles finished, estimated reading time, your most-saved sites and reading streaks",
      category: "analytics",
      limit: null
    }
  };

  /* Free allowances are defined in src/features/limits-config.json and are
   * loaded through FeatureGate. This file holds no numbers, so the two cannot
   * drift apart the way config.json and limits-config.json did in v1.1.1. */
  var FREE_CAPS = {};
  var CAP_PERIODS = {};
  var splitReady = false;

  /* Tiers and caps are owned by src/features/limits-config.json and reach this
   * file only through FeatureGate, which loads that file and fails closed on a
   * bad load. FEATURES below owns display name and description, which is copy
   * rather than policy and has no other home. It carries no tier. */
  function loadSplit() {
    if (typeof FeatureGate === "undefined" || !FeatureGate.init) return Promise.resolve(false);
    return FeatureGate.init().then(function () {
      FREE_CAPS = FeatureGate.FREE_LIMITS || {};
      CAP_PERIODS = FeatureGate.CAP_PERIODS || {};
      splitReady = true;
      return true;
    }).catch(function () { return false; });
  }

  /* Returns "free", "pro", "not_sold", or null when the split is not loaded.
   * Null is never treated as free by any caller. */
  function tierOf(featureId) {
    if (!splitReady || typeof FeatureGate === "undefined") return null;
    if (FeatureGate.isNotSold && FeatureGate.isNotSold(featureId)) return TIERS.UNBUILT;
    var tier = FeatureGate.FEATURE_TIERS[featureId];
    if (tier === TIERS.FREE || tier === TIERS.PRO) return tier;
    return TIERS.UNBUILT;
  }

  var currentTier = TIERS.FREE;

  /* ---------------- tier ---------------- */

  function resolveTierFromWorker() {
    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve(TIERS.FREE);
        return;
      }
      try {
        chrome.runtime.sendMessage({ action: "CHECK_TRIAL_AND_LICENSE" }, function (res) {
          if (chrome.runtime.lastError || !res || !res.success || !res.data) {
            resolve(TIERS.FREE);
            return;
          }
          var d = res.data;
          resolve((d.isPro || d.effectivelyPro || d.trialActive) ? TIERS.PRO : TIERS.FREE);
        });
      } catch (e) { resolve(TIERS.FREE); }
    });
  }

  function resolveTierInWorker() {
    if (typeof LicenseManager === "undefined" || !LicenseManager.isPro) return null;
    return LicenseManager.isPro()
      .then(function (pro) { return pro ? TIERS.PRO : TIERS.FREE; })
      .catch(function () { return TIERS.FREE; });
  }

  function init() {
    loadSplit();
    var inWorker = (typeof window === "undefined");
    var job = inWorker ? resolveTierInWorker() : null;
    if (!job) job = resolveTierFromWorker();
    return job.then(function (tier) {
      currentTier = tier === TIERS.PRO ? TIERS.PRO : TIERS.FREE;
      return currentTier;
    });
  }

  function getCurrentTier() { return currentTier; }

  function isPro() { return currentTier === TIERS.PRO; }

  /* In-memory only, and only the service worker should call it after a licence
   * or preview resolution. It grants nothing on its own: every gate re-checks
   * through FeatureGate, which asks the worker, which asks the server. */
  function setTier(tier) {
    currentTier = tier === TIERS.PRO ? TIERS.PRO : TIERS.FREE;
    return Promise.resolve(currentTier);
  }

  /* ---------------- queries ---------------- */

  function checkFeature(featureId) {
    var feature = FEATURES[featureId];
    if (!feature) return { available: false, reason: "Unknown feature: " + featureId, limit: null };
    var tier = tierOf(featureId);
    if (tier === null) {
      return { available: false, reason: "The feature split is not loaded yet.", limit: null, pending: true };
    }
    if (tier === TIERS.UNBUILT) {
      return { available: false, reason: feature.name + " is not built yet.", limit: null, unbuilt: true };
    }
    if (tier === TIERS.FREE) return { available: true, reason: null, limit: feature.limit || null };
    if (currentTier === TIERS.PRO) return { available: true, reason: null, limit: null };
    var cap = FREE_CAPS[featureId];
    if (typeof cap === "number" && cap > 0) {
      var period = CAP_PERIODS[featureId] || "total";
      var reason = period === "daily"
        ? "Free covers " + cap + " a day. Pro removes the limit."
        : "Free covers the first " + cap + ". Pro removes the limit.";
      return { available: true, reason: reason, limit: { count: cap, period: period } };
    }
    return { available: false, reason: feature.name + " is a Pro feature.", limit: null };
  }

  function getFeature(featureId) { return FEATURES[featureId]; }

  function getFeaturesByTier(tier) {
    var ids = Object.keys(FEATURES);
    var out = [];
    var max = ids.length < MAX_FEATURES ? ids.length : MAX_FEATURES;
    for (var i = 0; i < max; i++) {
      if (tierOf(ids[i]) === tier) out.push(FEATURES[ids[i]]);
    }
    return out;
  }

  function getAllFeatures() { return FEATURES; }

  function getFeaturesByCategory() {
    var ids = Object.keys(FEATURES);
    var out = {};
    var max = ids.length < MAX_FEATURES ? ids.length : MAX_FEATURES;
    for (var i = 0; i < max; i++) {
      var f = FEATURES[ids[i]];
      if (!out[f.category]) out[f.category] = [];
      out[f.category].push(f);
    }
    return out;
  }

  function getComparisonTable() {
    var ids = Object.keys(FEATURES);
    var rows = [];
    var max = ids.length < MAX_FEATURES ? ids.length : MAX_FEATURES;
    for (var i = 0; i < max; i++) {
      var f = FEATURES[ids[i]];
      var tier = tierOf(f.id);
      if (tier === null || tier === TIERS.UNBUILT) continue;
      var freeAccess;
      if (tier === TIERS.FREE) {
        freeAccess = true;
      } else {
        var cap = FREE_CAPS[f.id];
        freeAccess = (typeof cap === "number" && cap > 0) ? "limited" : false;
      }
      rows.push({
        id: f.id,
        name: f.name,
        description: f.description,
        freeAccess: freeAccess,
        freeCap: typeof FREE_CAPS[f.id] === "number" ? FREE_CAPS[f.id] : null,
        proAccess: true
      });
    }
    return rows;
  }

  var api = {
    loadSplit: loadSplit,
    tierOf: tierOf,
    TIERS: TIERS,
    FEATURES: FEATURES,
    get FREE_CAPS() { return FREE_CAPS; },
    init: init,
    getCurrentTier: getCurrentTier,
    isPro: isPro,
    setTier: setTier,
    checkFeature: checkFeature,
    getFeature: getFeature,
    getFeaturesByTier: getFeaturesByTier,
    getAllFeatures: getAllFeatures,
    getFeaturesByCategory: getFeaturesByCategory,
    getComparisonTable: getComparisonTable
  };

  if (typeof self !== "undefined") self.FeatureRegistry = api;
  if (typeof window !== "undefined") window.FeatureRegistry = api;
})();
