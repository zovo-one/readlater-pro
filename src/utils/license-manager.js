/* ReadLater Pro - license manager.
 * The server is the only authority. A cached record grants Pro only when it
 * carries a server verification stamp, the licence key it was issued for is
 * still on disk, and the stamp is inside MAX_TRUST_MS. Anything written into
 * chrome.storage by hand fails those checks and is purged by the watchdog.
 */
(function () {
  "use strict";

  /* activateLicense resolve contract, stable for callers.
   *   success  { valid:true,  code:null, tier, features, expiresAt, licenseKey, verifiedAt }
   *   failure  { valid:false, code:<ERR_CODE>, error:<human string>, tier:"free" }
   * ERR_CODES:
   *   ERR_INPUT        empty, non-string, or over MAX_KEY_LENGTH. Never sent to the server.
   *   ERR_INVALID_KEY  the server answered valid:false (HTTP 2xx, or a 4xx with that JSON body).
   *   ERR_NETWORK      unreachable, timed out, 5xx, 429, or any answer without a valid flag.
   *                    checkLicense/refreshLicense never demote a stored licence on this path.
   * Callers must branch on `code`, never on the presence of `tier`. */
  var ERR_CODES = {
    INPUT: "ERR_INPUT",
    INVALID_KEY: "ERR_INVALID_KEY",
    NETWORK: "ERR_NETWORK"
  };

  var REFRESH_ALARM_NAME = "licenseRefresh";
  var EXPIRY_WARNING_DAYS = 7;
  var MAX_KEY_LENGTH = 128;
  /* A request that hangs is an outage, not an answer about the key. Kept under the 10 s
   * MessageHelper.send timeout so a page never gives up before the worker answers. */
  var VERIFY_TIMEOUT_MS = 8000;

  var CONFIG = {
    apiUrl: "https://zgubxqomnbmxgbdhvwja.supabase.co/functions/v1/verify-extension-license",
    anonKey: "sb_publishable_RG4IVO9Qm23_xPzdQjdFPQ_QHBwbOLv",
    extensionKey: "readlater_pro",
    cacheDuration: 30 * 60 * 1000,
    maxTrustMs: 24 * 60 * 60 * 1000,
    storageKey: "licenseData",
    licenseKeyKey: "licenseKey",
    plainKey: "licenseDataPlain",
    defaultTier: "free"
  };

  var FREE_FEATURES = [
    "one_click_save", "reader_view", "side_panel_list", "tags",
    "pocket_import", "context_menu_save", "basic_search", "reading_progress"
  ];
  var PRO_FEATURES = FREE_FEATURES.concat([
    "offline_reading", "full_text_search", "highlights_notes",
    "auto_tagging", "bulk_export", "reading_stats"
  ]);
  var TIER_FEATURES = { free: FREE_FEATURES, pro: PRO_FEATURES, lifetime: PRO_FEATURES };

  var internalWrites = 0;
  var watchdogArmed = false;

  /* ---------------- storage ---------------- */

  function readPlain() {
    return chrome.storage.local.get(CONFIG.plainKey).then(function (out) {
      return out[CONFIG.plainKey] || null;
    }).catch(function () { return null; });
  }

  function getCachedLicense() {
    if (typeof SecureStorage === "undefined") return readPlain();
    return SecureStorage.getSecure(CONFIG.storageKey).then(function (rec) {
      return rec || readPlain();
    }).catch(readPlain);
  }

  function getStoredKey() {
    if (typeof SecureStorage !== "undefined") {
      return SecureStorage.getSecure(CONFIG.licenseKeyKey).then(function (k) {
        return k || null;
      }).catch(function () { return null; });
    }
    return chrome.storage.local.get(CONFIG.licenseKeyKey).then(function (out) {
      return out[CONFIG.licenseKeyKey] || null;
    }).catch(function () { return null; });
  }

  function writeCache(record) {
    internalWrites += 1;
    var payload = {};
    payload[CONFIG.plainKey] = record;
    var plain = chrome.storage.local.set(payload).catch(function (err) {
      console.error("[LicenseManager] Cache write error:", err);
    });
    var secure = (typeof SecureStorage !== "undefined")
      ? SecureStorage.setSecure(CONFIG.storageKey, record).catch(function (err) {
          console.error("[LicenseManager] Secure cache write error:", err);
        })
      : Promise.resolve();
    return Promise.all([plain, secure]).then(function () {
      internalWrites -= 1;
      return record;
    }, function () {
      internalWrites -= 1;
    });
  }

  /* Drops the cached verification record only. The licence key stays so a
   * genuine buyer who has been offline can re-verify when the network returns. */
  function clearCacheRecord() {
    internalWrites += 1;
    var jobs = [chrome.storage.local.remove([CONFIG.plainKey, CONFIG.storageKey])];
    if (typeof SecureStorage !== "undefined") jobs.push(SecureStorage.removeSecure(CONFIG.storageKey));
    return Promise.all(jobs).catch(function (err) {
      console.error("[LicenseManager] Cache clear error:", err);
    }).then(function () { internalWrites -= 1; });
  }

  /* Full sign-out. Drops the record and the key. */
  function clearAll() {
    internalWrites += 1;
    var jobs = [chrome.storage.local.remove([CONFIG.plainKey, CONFIG.storageKey, CONFIG.licenseKeyKey])];
    if (typeof SecureStorage !== "undefined") {
      jobs.push(SecureStorage.removeSecure(CONFIG.storageKey));
      jobs.push(SecureStorage.removeSecure(CONFIG.licenseKeyKey));
    }
    return Promise.all(jobs).catch(function (err) {
      console.error("[LicenseManager] Cache clear error:", err);
    }).then(function () { internalWrites -= 1; });
  }

  /* ---------------- trust ---------------- */

  function freeRecord() {
    return {
      valid: false,
      tier: CONFIG.defaultTier,
      features: TIER_FEATURES[CONFIG.defaultTier],
      expiresAt: null,
      licenseKey: null,
      origin: "local",
      cachedAt: Date.now(),
      verifiedAt: null
    };
  }

  function stampExpired(record) {
    if (!record.expiresAt) return false;
    var at = typeof record.expiresAt === "number" ? record.expiresAt : new Date(record.expiresAt).getTime();
    return !isNaN(at) && at < Date.now();
  }

  /* A record is trusted only if the server issued it, the stamp is fresh, and
   * the key it was issued for is the key still on disk. */
  function isTrusted(record, storedKey) {
    if (!record || record.valid !== true) return false;
    if (record.origin !== "server") return false;
    if (typeof record.verifiedAt !== "number") return false;
    if (Date.now() - record.verifiedAt > CONFIG.maxTrustMs) return false;
    if (!record.licenseKey || record.licenseKey !== storedKey) return false;
    if (stampExpired(record)) return false;
    return record.tier === "pro" || record.tier === "lifetime";
  }

  function trustedCache() {
    return Promise.all([getCachedLicense(), getStoredKey()]).then(function (parts) {
      return isTrusted(parts[0], parts[1]) ? parts[0] : null;
    });
  }

  /* ---------------- server ---------------- */

  function networkError(message) {
    var err = new Error(message);
    err.code = ERR_CODES.NETWORK;
    return err;
  }

  function verifyOnServer(licenseKey) {
    return fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CONFIG.anonKey,
        "Authorization": "Bearer " + CONFIG.anonKey
      },
      body: JSON.stringify({ license_key: licenseKey, extension: CONFIG.extensionKey }),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(VERIFY_TIMEOUT_MS) : undefined
    }).then(function (res) {
      /* A 4xx carrying {valid:false} is the server's verdict on the key. Every other non-2xx
       * (5xx, 429, 408, a gateway page, a missing function) says nothing about the key. */
      if (!res.ok) {
        var status = res.status;
        var failed = function () { throw networkError("The licence server returned status " + status); };
        if (status < 400 || status >= 500 || status === 408 || status === 429) failed();
        return res.text().then(function (text) {
          var body = null;
          try { body = JSON.parse(text); } catch (e) {}
          if (!body || body.valid !== false) failed();
          return text;
        }, failed);
      }
      return res.text();
    }, function (err) {
      throw networkError(err && err.message ? err.message : "The licence server could not be reached");
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) {
        throw networkError("The licence server returned a response we could not read");
      }
      /* Only an explicit valid:false demotes a stored licence. */
      if (!data || typeof data !== "object" || (!data.valid && data.valid !== false)) {
        throw networkError("The licence server returned a response we could not read");
      }
      var tier = data.valid ? (data.tier || CONFIG.defaultTier) : CONFIG.defaultTier;
      return {
        valid: !!data.valid,
        tier: tier,
        features: data.features || TIER_FEATURES[tier] || TIER_FEATURES[CONFIG.defaultTier],
        expiresAt: data.expiresAt || null,
        licenseKey: licenseKey,
        origin: "server",
        cachedAt: Date.now(),
        verifiedAt: Date.now()
      };
    });
  }

  /* The server answer always overwrites the cache, including a "not valid"
   * answer. That is what demotes a hand-written pro record. */
  function verifyAndStore(licenseKey) {
    return verifyOnServer(licenseKey).then(function (record) {
      return writeCache(record).then(function () { return record; });
    }).catch(function (err) {
      console.warn("[LicenseManager] Verify failed, falling back to trusted cache:", err.message);
      return trustedCache().then(function (cached) {
        if (cached) return cached;
        var rec = freeRecord();
        rec.code = ERR_CODES.NETWORK;
        return rec;
      });
    });
  }

  function checkLicense(licenseKey, forceRefresh) {
    var keyPromise = licenseKey ? Promise.resolve(licenseKey) : getStoredKey();
    return keyPromise.then(function (key) {
      if (!key) return purgeIfUntrusted().then(freeRecord);
      if (forceRefresh) return verifyAndStore(key);
      return getCachedLicense().then(function (cached) {
        var fresh = cached && cached.origin === "server" &&
          typeof cached.verifiedAt === "number" &&
          (Date.now() - cached.verifiedAt) < CONFIG.cacheDuration &&
          cached.licenseKey === key;
        if (fresh) return cached;
        return verifyAndStore(key);
      });
    });
  }

  function refreshLicense() {
    return getStoredKey().then(function (key) {
      if (!key) return purgeIfUntrusted().then(freeRecord);
      return verifyAndStore(key);
    });
  }

  /* ---------------- public reads ---------------- */

  function isPro() {
    return trustedCache().then(function (rec) { return !!rec; });
  }

  function getTier() {
    return trustedCache().then(function (rec) {
      return rec ? rec.tier : CONFIG.defaultTier;
    });
  }

  function hasFeature(featureId) {
    return trustedCache().then(function (rec) {
      var list = rec && rec.features ? rec.features : TIER_FEATURES[CONFIG.defaultTier];
      return Array.isArray(list) ? list.indexOf(featureId) !== -1 : !!list[featureId];
    });
  }

  function getFullStatus() {
    return Promise.all([getCachedLicense(), getStoredKey()]).then(function (parts) {
      var rec = parts[0];
      var trusted = isTrusted(rec, parts[1]);
      if (!trusted) {
        return {
          valid: false, tier: CONFIG.defaultTier, isPro: false,
          features: TIER_FEATURES[CONFIG.defaultTier], expiresAt: null,
          cachedAt: rec && rec.cachedAt ? rec.cachedAt : null,
          verifiedAt: rec && rec.verifiedAt ? rec.verifiedAt : null,
          cacheAge: rec && rec.verifiedAt ? Date.now() - rec.verifiedAt : 0
        };
      }
      return {
        valid: true, tier: rec.tier, isPro: true,
        features: rec.features || TIER_FEATURES[rec.tier],
        expiresAt: rec.expiresAt || null,
        cachedAt: rec.cachedAt || null,
        verifiedAt: rec.verifiedAt,
        cacheAge: Date.now() - rec.verifiedAt
      };
    });
  }

  function isExpiringSoon() {
    return trustedCache().then(function (rec) {
      if (!rec || !rec.expiresAt) return false;
      var at = typeof rec.expiresAt === "number" ? rec.expiresAt : new Date(rec.expiresAt).getTime();
      if (isNaN(at)) return false;
      var left = at - Date.now();
      return left > 0 && left <= EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
    });
  }

  /* ---------------- activation ---------------- */

  function activationFailure(code, message) {
    return { valid: false, code: code, error: message, tier: CONFIG.defaultTier };
  }

  function activateLicense(rawKey) {
    if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) {
      return Promise.resolve(activationFailure(ERR_CODES.INPUT, "Enter your licence key."));
    }
    var key = rawKey.trim();
    if (key.length > MAX_KEY_LENGTH) {
      return Promise.resolve(activationFailure(ERR_CODES.INPUT, "That key is not a valid licence key."));
    }
    return verifyOnServer(key).then(function (record) {
      if (!record.valid) {
        return activationFailure(ERR_CODES.INVALID_KEY, "That licence key is not valid.");
      }
      return storeKey(key).then(function () {
        return writeCache(record);
      }).then(function () {
        record.code = null;
        return record;
      });
    }, function (err) {
      var code = (err && err.code === ERR_CODES.NETWORK) ? ERR_CODES.NETWORK : ERR_CODES.INVALID_KEY;
      var message = code === ERR_CODES.NETWORK
        ? "Could not reach the licence server. Try again."
        : "That licence key is not valid.";
      return activationFailure(code, message);
    });
  }

  function storeKey(key) {
    internalWrites += 1;
    var job;
    if (typeof SecureStorage !== "undefined") {
      job = SecureStorage.setSecure(CONFIG.licenseKeyKey, key);
    } else {
      var payload = {};
      payload[CONFIG.licenseKeyKey] = key;
      job = chrome.storage.local.set(payload);
    }
    return job.then(function () { internalWrites -= 1; }, function (e) {
      internalWrites -= 1;
      throw e;
    });
  }

  function deactivateLicense() {
    return clearAll().then(function () {
      return { success: true, tier: CONFIG.defaultTier };
    });
  }

  /* ---------------- tamper watchdog ---------------- */

  function purgeIfUntrusted() {
    return Promise.all([getCachedLicense(), getStoredKey()]).then(function (parts) {
      if (!parts[0]) return null;
      if (isTrusted(parts[0], parts[1])) return null;
      console.warn("[LicenseManager] Discarding untrusted licence record");
      return clearCacheRecord();
    });
  }

  /* A console or storage write to any licence key is reconciled against the
   * server immediately, not on the next 30 minute tick. */
  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    if (internalWrites > 0) return;
    var watched = [CONFIG.plainKey, CONFIG.storageKey, CONFIG.licenseKeyKey, "userTier"];
    var hit = false;
    for (var i = 0; i < watched.length; i++) {
      if (Object.prototype.hasOwnProperty.call(changes, watched[i])) { hit = true; break; }
    }
    if (!hit) return;
    getStoredKey().then(function (key) {
      if (!key) return purgeIfUntrusted();
      return verifyAndStore(key);
    }).catch(function (err) {
      console.warn("[LicenseManager] Reconcile after storage change failed:", err && err.message);
    });
  }

  function armWatchdog() {
    if (watchdogArmed) return;
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener(onStorageChanged);
    watchdogArmed = true;
  }

  var api = {
    CONFIG: CONFIG,
    ERR_CODES: ERR_CODES,
    EXTENSION_KEY: CONFIG.extensionKey,
    REFRESH_ALARM_NAME: REFRESH_ALARM_NAME,
    TIER_FEATURES: TIER_FEATURES,
    checkLicense: checkLicense,
    isPro: isPro,
    getTier: getTier,
    hasFeature: hasFeature,
    activateLicense: activateLicense,
    deactivateLicense: deactivateLicense,
    getCachedLicense: getCachedLicense,
    refreshLicense: refreshLicense,
    getFullStatus: getFullStatus,
    isExpiringSoon: isExpiringSoon,
    purgeIfUntrusted: purgeIfUntrusted,
    armWatchdog: armWatchdog
  };

  if (typeof self !== "undefined") self.LicenseManager = api;
  if (typeof window !== "undefined") window.LicenseManager = api;

  if (typeof self !== "undefined" && typeof window === "undefined") {
    armWatchdog();
    purgeIfUntrusted();
  }
})();
