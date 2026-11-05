/* ReadLater Pro - feature gate.
 * The one runtime authority for the free/pro split.
 *
 * Numbers live in src/features/limits-config.json and nowhere else. This file
 * carries a tier-only fallback so that a failed config load denies Pro features
 * instead of opening them. It carries no caps, so the caps cannot drift.
 *
 * A gate that runs in the service worker cannot open a modal, so a denial there
 * is written to a pending-wall record and the next UI surface shows it.
 */
(function () {
  "use strict";

  var LIMITS_CONFIG_PATH = "src/features/limits-config.json";
  var USAGE_KEY = "featureGateUsage";
  var TASTE_KEY = "featureGateFirstTouch";
  var PENDING_WALL_KEY = "featureGatePendingWall";
  var MAX_FEATURES = 64;
  var PENDING_WALL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  /* Tier-only mirror of limits-config.json "tiers". No caps here on purpose. */
  var FALLBACK_TIERS = {
    one_click_save: "free",
    reader_view: "free",
    side_panel_list: "free",
    tags: "free",
    pocket_import: "free",
    context_menu_save: "free",
    basic_search: "free",
    reading_progress: "free",
    offline_reading: "free",
    bulk_export: "free",
    reading_stats: "free",
    highlights_notes: "free",
    full_text_search: "pro",
    listen_aloud: "pro",
    markdown_export: "pro"
  };

  var FALLBACK_ALIASES = {
    save_article: "one_click_save",
    read_article: "reader_view",
    basic_tags: "tags",
    highlights: "highlights_notes",
    annotations: "highlights_notes",
    export_articles: "bulk_export",
    unlimited_offline: "offline_reading"
  };

  var tiers = FALLBACK_TIERS;
  var freeCaps = {};
  var dailyResets = [];
  var capPeriods = {};
  var grace = [];
  var aliases = FALLBACK_ALIASES;
  var notSold = {};
  var configPromise = null;
  var configLoaded = false;
  var eventSink = null;

  /* ---------------- config ---------------- */

  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== "object") return;
    if (cfg.tiers && Object.keys(cfg.tiers).length > 0) tiers = cfg.tiers;
    if (cfg.freeCaps && typeof cfg.freeCaps === "object") freeCaps = cfg.freeCaps;
    if (Array.isArray(cfg.dailyResets)) dailyResets = cfg.dailyResets;
    if (cfg.capPeriods && typeof cfg.capPeriods === "object") capPeriods = cfg.capPeriods;
    if (Array.isArray(cfg.firstTouchGrace)) grace = cfg.firstTouchGrace;
    if (cfg.aliases && typeof cfg.aliases === "object") aliases = cfg.aliases;
    if (cfg.notSold && typeof cfg.notSold === "object") notSold = cfg.notSold;
    configLoaded = true;
  }

  function ensureConfig() {
    if (configPromise) return configPromise;
    configPromise = new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.getURL) {
        resolve();
        return;
      }
      fetch(chrome.runtime.getURL(LIMITS_CONFIG_PATH))
        .then(function (res) { return res.json(); })
        .then(function (cfg) { applyConfig(cfg); resolve(); })
        .catch(function (err) {
          console.error("[FeatureGate] limits-config load failed, denying Pro features:", err && err.message);
          resolve();
        });
    });
    return configPromise;
  }

  function canonical(id) {
    if (!id || typeof id !== "string") return "";
    return aliases[id] || id;
  }

  function isNotSold(id) {
    return Object.prototype.hasOwnProperty.call(notSold, id);
  }

  /* ---------------- storage ---------------- */

  function readMap(key) {
    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve({});
        return;
      }
      var query = {};
      query[key] = {};
      chrome.storage.local.get(query, function (out) {
        if (chrome.runtime.lastError) { resolve({}); return; }
        resolve(out[key] || {});
      });
    });
  }

  function writeMap(key, value) {
    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }
      var payload = {};
      payload[key] = value;
      chrome.storage.local.set(payload, function () {
        if (chrome.runtime.lastError) {
          console.warn("[FeatureGate] storage.set error:", chrome.runtime.lastError.message);
        }
        resolve();
      });
    });
  }

  /* Daily caps follow the user's own calendar. The usage map carries the local
   * date its counters belong to; the first read on a new date zeroes the daily
   * counters, so the reset never depends on the worker's alarm having fired.
   * ONCE_KEY remembers what already counted today (Listen counts an article
   * once per day, however often it is reopened). */
  var DAY_KEY = "_day";
  var ONCE_KEY = "_once";
  var MAX_ONCE = 200;

  function localDay() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function readUsage() {
    return ensureConfig().then(function () { return readMap(USAGE_KEY); }).then(function (usage) {
      var today = localDay();
      if (usage[DAY_KEY] === today) return usage;
      var max = dailyResets.length < MAX_FEATURES ? dailyResets.length : MAX_FEATURES;
      for (var i = 0; i < max; i++) {
        if (typeof usage[dailyResets[i]] === "number") usage[dailyResets[i]] = 0;
      }
      usage[DAY_KEY] = today;
      usage[ONCE_KEY] = {};
      return usage;
    });
  }
  function writeUsage(v) { return writeMap(USAGE_KEY, v); }

  /* ---------------- license and preview ---------------- */

  var FREE_STATUS = { tier: "free", expiresAt: null, trial: null };

  /* Worker path. LicenseManager is the only trust root: server verified and TTL
   * bound. No raw storage blob is read, and there is no trial to consult. */
  function localLicenseFallback() {
    if (typeof LicenseManager === "undefined" || !LicenseManager.getFullStatus) {
      return Promise.resolve(FREE_STATUS);
    }
    return LicenseManager.getFullStatus().then(function (lic) {
      if (lic && lic.isPro) return { tier: lic.tier, expiresAt: lic.expiresAt || null, trial: null };
      return { tier: "free", expiresAt: null, trial: null };
    }).catch(function () { return FREE_STATUS; });
  }

  function sendMessage(action) {
    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve(null);
        return;
      }
      try {
        chrome.runtime.sendMessage({ action: action }, function (res) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(res || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  function getLicenseStatus() {
    if (typeof window === "undefined") return localLicenseFallback();
    return sendMessage("CHECK_TRIAL_AND_LICENSE").then(function (res) {
      if (!res || !res.success || !res.data) return localLicenseFallback();
      var d = res.data;
      var pro = !!(d.isPro || d.effectivelyPro || (d.trial && d.trial.trialActive));
      return {
        tier: pro ? "pro" : "free",
        expiresAt: (d.license && d.license.expiresAt) || null,
        trial: d.trial || null
      };
    });
  }

  function isProNow() {
    return getLicenseStatus().then(function (st) {
      return !!(st && (st.tier === "pro" || st.tier === "lifetime"));
    });
  }

  /* ---------------- first touch ---------------- */

  function hasGrace(id) { return grace.indexOf(id) !== -1; }

  function consumeGrace(id) {
    return readMap(TASTE_KEY).then(function (seen) {
      if (seen[id]) return false;
      seen[id] = Date.now();
      return writeMap(TASTE_KEY, seen).then(function () { return true; });
    });
  }

  function graceRemaining(id) {
    if (!hasGrace(id)) return Promise.resolve(false);
    return readMap(TASTE_KEY).then(function (seen) { return !seen[id]; });
  }

  /* ---------------- pending wall ---------------- */

  /* Recorded when a gate denies somewhere that cannot render, such as the
   * service worker. A UI surface calls consumePendingWall on open. */
  function recordPendingWall(id) {
    return writeMap(PENDING_WALL_KEY, { feature: id, at: Date.now() });
  }

  function consumePendingWall() {
    return readMap(PENDING_WALL_KEY).then(function (rec) {
      if (!rec || !rec.feature) return null;
      var stale = (Date.now() - (rec.at || 0)) > PENDING_WALL_TTL_MS;
      return writeMap(PENDING_WALL_KEY, {}).then(function () {
        return stale ? null : rec;
      });
    });
  }

  function clearPendingWall() { return writeMap(PENDING_WALL_KEY, {}); }

  /* ---------------- events ---------------- */

  function setEventSink(fn) { eventSink = typeof fn === "function" ? fn : null; }

  function emit(name, detail) {
    if (!eventSink) return;
    try { eventSink(name, detail || {}); } catch (e) {
      console.warn("[FeatureGate] event sink error:", e && e.message);
    }
  }

  /* ---------------- gating ---------------- */

  function blocked(id, opts) {
    emit("feature_blocked", { feature: id });
    if (typeof opts.onBlocked === "function") { opts.onBlocked(id); return; }
    if (typeof window !== "undefined" && typeof Paywall !== "undefined" && Paywall.show) {
      Paywall.show(formatFeatureName(id), { featureId: id });
      return;
    }
    recordPendingWall(id);
  }

  function gateFreeUser(id, opts, run) {
    var cap = freeCaps[id];
    if (typeof cap === "number" && cap > 0) {
      readUsage().then(function (usage) {
        /* opts.countOnce: a key (an article id) that uses the cap at most once a day. */
        var once = opts.countOnce ? String(opts.countOnce) : "";
        var seen = (usage[ONCE_KEY] && Array.isArray(usage[ONCE_KEY][id])) ? usage[ONCE_KEY][id] : [];
        if (once && seen.indexOf(once) !== -1) { run(); return; }
        var used = usage[id] || 0;
        if (used >= cap) { blocked(id, opts); return; }
        if (opts.skipIncrement) { run(); return; }
        usage[id] = used + 1;
        if (once) {
          if (!usage[ONCE_KEY] || typeof usage[ONCE_KEY] !== "object") usage[ONCE_KEY] = {};
          usage[ONCE_KEY][id] = seen.concat([once]).slice(-MAX_ONCE);
        }
        writeUsage(usage).then(run);
      });
      return;
    }
    if (hasGrace(id)) {
      consumeGrace(id).then(function (granted) {
        if (granted) { emit("feature_taste", { feature: id }); run(); return; }
        blocked(id, opts);
      });
      return;
    }
    blocked(id, opts);
  }

  function gateFeature(featureId, onAllowed, options) {
    var opts = options || {};
    var id = canonical(featureId);
    var run = function () { if (typeof onAllowed === "function") onAllowed(); };
    return ensureConfig().then(function () {
      if (isNotSold(id)) {
        console.warn('[FeatureGate] Feature "' + id + '" is not implemented and is not sold.');
        if (typeof opts.onBlocked === "function") opts.onBlocked(id);
        return;
      }
      if (typeof tiers[id] === "undefined") {
        /* Unknown to a loaded config means it is not a gated feature. Unknown
         * because the config failed to load means we must not open the gate. */
        if (configLoaded) { run(); return; }
        blocked(id, opts);
        return;
      }
      if (tiers[id] === "free") { run(); return; }
      return isProNow().then(function (pro) {
        if (pro) { run(); return; }
        gateFreeUser(id, opts, run);
      });
    });
  }

  function isAvailable(featureId) {
    var id = canonical(featureId);
    return ensureConfig().then(function () {
      if (isNotSold(id)) return false;
      if (typeof tiers[id] === "undefined") return configLoaded;
      if (tiers[id] === "free") return true;
      return isProNow().then(function (pro) {
        if (pro) return true;
        var cap = freeCaps[id];
        if (typeof cap === "number" && cap > 0) {
          return readUsage().then(function (usage) { return (usage[id] || 0) < cap; });
        }
        return graceRemaining(id);
      });
    });
  }

  function getRemainingUses(featureId) {
    var id = canonical(featureId);
    return ensureConfig().then(function () {
      var cap = freeCaps[id];
      if (typeof cap !== "number") return null;
      return readUsage().then(function (usage) {
        var left = cap - (usage[id] || 0);
        return left > 0 ? left : 0;
      });
    });
  }

  function getRequiredTier(featureId) {
    var id = canonical(featureId);
    if (isNotSold(id)) return "not_sold";
    return tiers[id] || "free";
  }

  function getUsage(featureId) {
    var id = canonical(featureId);
    return readUsage().then(function (usage) { return usage[id] || 0; });
  }

  function incrementUsage(featureId) {
    var id = canonical(featureId);
    return readUsage().then(function (usage) {
      usage[id] = (usage[id] || 0) + 1;
      return writeUsage(usage).then(function () { return usage[id]; });
    });
  }

  function resetUsage() {
    return Promise.all([writeUsage({}), writeMap(TASTE_KEY, {}), clearPendingWall()]);
  }

  /* Called by the worker's daily alarm. Only counters whose cap period is
   * daily are zeroed, and only once the local date has changed: the alarm runs
   * 24 hours after install, not at midnight, so it must not reset mid-day. */
  function resetDailyUsage() {
    return readMap(USAGE_KEY).then(function (stored) {
      var before = stored[DAY_KEY];
      return readUsage().then(function (usage) {
        return usage[DAY_KEY] !== before ? writeUsage(usage) : Promise.resolve();
      });
    });
  }

  /* ---------------- display helpers ---------------- */

  function formatFeatureName(featureId) {
    var id = canonical(featureId);
    if (!id) return "";
    if (typeof FeatureRegistry !== "undefined" && typeof FeatureRegistry.getFeature === "function") {
      var f = FeatureRegistry.getFeature(id);
      if (f && f.name) return f.name;
    }
    return id.split("_").map(function (part) {
      return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : "";
    }).join(" ");
  }

  function getFeatureSummary(featureId) {
    var id = canonical(featureId);
    var description = null;
    if (typeof FeatureRegistry !== "undefined" && typeof FeatureRegistry.getFeature === "function") {
      var f = FeatureRegistry.getFeature(id);
      if (f && f.description) description = f.description;
    }
    return ensureConfig().then(function () {
      return Promise.all([isAvailable(id), getRemainingUses(id)]);
    }).then(function (parts) {
      return {
        id: id,
        tier: getRequiredTier(id),
        available: parts[0],
        remainingUses: parts[1],
        limit: typeof freeCaps[id] === "number" ? freeCaps[id] : null,
        displayName: formatFeatureName(id),
        description: description
      };
    });
  }

  function getAllFeatureStatuses() {
    return ensureConfig().then(function () {
      var ids = Object.keys(tiers);
      var jobs = [];
      var max = ids.length < MAX_FEATURES ? ids.length : MAX_FEATURES;
      for (var i = 0; i < max; i++) jobs.push(getFeatureSummary(ids[i]));
      return Promise.all(jobs);
    });
  }

  var api = {
    init: ensureConfig,
    gateFeature: gateFeature,
    isAvailable: isAvailable,
    getRemainingUses: getRemainingUses,
    getRequiredTier: getRequiredTier,
    getUsage: getUsage,
    incrementUsage: incrementUsage,
    resetUsage: resetUsage,
    resetDailyUsage: resetDailyUsage,
    getLicenseStatus: getLicenseStatus,
    formatFeatureName: formatFeatureName,
    getFeatureSummary: getFeatureSummary,
    getAllFeatureStatuses: getAllFeatureStatuses,
    setEventSink: setEventSink,
    canonicalFeatureId: canonical,
    isNotSold: isNotSold,
    recordPendingWall: recordPendingWall,
    consumePendingWall: consumePendingWall,
    clearPendingWall: clearPendingWall,
    get FEATURE_TIERS() { return tiers; },
    get FREE_LIMITS() { return freeCaps; },
    get CAP_PERIODS() { return capPeriods; }
  };

  if (typeof self !== "undefined") self.FeatureGate = api;
  if (typeof window !== "undefined") window.FeatureGate = api;
})();
