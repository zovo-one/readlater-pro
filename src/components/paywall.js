/* ReadLater Pro - paywall modal.
 * ZERO price numbers. Lifetime auto-advances by cumulative buyer count on the
 * backend across four tiers, so any price compiled into the package goes
 * stale and needs a store review cycle to correct. Prices live in exactly two
 * places, the onboarding final step and zovo.one. This surface carries the
 * extension's own value, the real refund line, and one neutral CTA out.
 * No ratings, no counts, no scarcity, no competitor price.
 */
(function () {
  "use strict";

  var CHECKOUT_BASE = "https://zovo.one/pricing";
  var UTM = "utm_source=readlater_pro&utm_medium=extension&utm_campaign=upgrade";

  /* utm_content must be one of: popup, options, sidebar, paywall, caphit,
   * onboarding, store. */
  var ALLOWED_SURFACES = ["popup", "options", "sidebar", "paywall", "caphit", "onboarding", "store"];

  var DEFAULTS = {
    showRefundTerms: true,
    surface: "paywall",
    /* Value statement, no figure of any kind. It names no competitor, prints
     * no competitor price, and prints no Zovo price, so nothing in it can go
     * stale when the lifetime tier advances. */
    reframe: null
  };

  var MAX_IMPRESSIONS = 100;
  var MAX_ROWS = 24;

  /* Free vs Pro. Mirrors src/features/limits-config.json. Nothing that is not
   * implemented in src/ appears here. auto_tagging is deliberately absent: no
   * code produces it, so selling it would be the "advertised but not built" defect. */
  var COMPARISON = [
    { key: "featureSaveReadArticles", fallback: "Save and read articles", free: "check", pro: "check" },
    { key: "featureOfflineArticles", fallback: "Offline copies", free: "check", pro: "check" },
    { key: "featureReaderView", fallback: "Reader view", free: "check", pro: "check" },
    { key: "featureTagsBasicSearch", fallback: "Tags and title search", free: "check", pro: "check" },
    { key: "featurePocketImport", fallback: "Pocket import", free: "check", pro: "check" },
    { key: "featureHighlightsNotes", fallback: "Highlights and notes", free: "check", pro: "check" },
    { key: "featureExportFreeFormats", fallback: "Backup, CSV and bookmarks export", free: "check", pro: "check" },
    { key: "featureReadingStats", fallback: "Reading statistics", free: "check", pro: "check" },
    { key: "featureFullTextSearch", fallback: "Full-text search", free: "20/day", pro: "unlimited" },
    { key: "featureListenAloud", fallback: "Listen to articles", free: "3/day", pro: "unlimited" },
    { key: "featureMarkdownExport", fallback: "Markdown export", free: "1 try", pro: "check" }
  ];

  var VALUE_STACK = [
    { key: "paywallStackSearch", fallback: "Search the words inside every article you saved, with no daily limit" },
    { key: "paywallStackListen", fallback: "Listen to as many articles as you like, every day" },
    { key: "paywallStackMarkdown", fallback: "Export articles and highlights to Markdown for Obsidian and other notes apps" },
    { key: "paywallStackMembership", fallback: "One membership covers this and the rest of the Zovo tools at zovo.one" },
    { key: "paywallStackUpdates", fallback: "Every future update included, with no repeat billing on the one-time plan" }
  ];

  var overlay = null;
  var stylesChecked = false;
  var previousOverflow = "";
  var activeOpts = {};
  var globalOpts = {};

  /* ---------------- helpers ---------------- */

  function t(key, fallback, substitutions) {
    if (typeof I18n === "undefined" || !I18n.get) return fallback;
    var out = substitutions ? I18n.get(key, substitutions) : I18n.get(key);
    return out || fallback;
  }

  function opt(name) {
    if (Object.prototype.hasOwnProperty.call(activeOpts, name)) return activeOpts[name];
    if (Object.prototype.hasOwnProperty.call(globalOpts, name)) return globalOpts[name];
    return DEFAULTS[name];
  }

  function emit(name, detail) {
    var sink = activeOpts.onEvent || globalOpts.onEvent;
    if (typeof sink !== "function") return;
    try { sink(name, detail || {}); } catch (e) {
      console.warn("[Paywall] event sink error:", e && e.message);
    }
  }

  function checkoutUrl(surface, featureId) {
    var name = ALLOWED_SURFACES.indexOf(surface) !== -1 ? surface : DEFAULTS.surface;
    var url = CHECKOUT_BASE + "?" + UTM + "&utm_content=" + encodeURIComponent(name);
    if (featureId) url += "&feature=" + encodeURIComponent(featureId);
    return url;
  }

  function openCheckout(url) {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url }, function () {
        if (chrome.runtime.lastError) {
          console.warn("[Paywall] tabs.create error:", chrome.runtime.lastError.message);
        }
      });
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* ---------------- rendering ---------------- */

  function buildComparisonRow(row) {
    var tr = document.createElement("tr");
    tr.appendChild(el("td", null, t(row.key, row.fallback)));

    var freeCell = document.createElement("td");
    var freeMark = el("span");
    if (row.free === "check") { freeMark.className = "pw-check"; freeMark.textContent = "Yes"; }
    else if (row.free === "cross") { freeMark.className = "pw-cross"; freeMark.textContent = "No"; }
    else { freeMark.className = "pw-limit"; freeMark.textContent = row.free; }
    freeCell.appendChild(freeMark);
    tr.appendChild(freeCell);

    var proCell = document.createElement("td");
    var proMark = el("span");
    if (row.pro === "check") { proMark.className = "pw-check"; proMark.textContent = "Yes"; }
    else { proMark.className = "pw-unlimited"; proMark.textContent = t("paywallUnlimited", "Unlimited"); }
    proCell.appendChild(proMark);
    tr.appendChild(proCell);
    return tr;
  }

  function buildComparison() {
    var table = el("table", "pw-table");
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    headRow.appendChild(el("th", null, t("paywallFeature", "Feature")));
    headRow.appendChild(el("th", null, t("paywallFree", "Free")));
    headRow.appendChild(el("th", null, t("paywallPro", "Pro")));
    head.appendChild(headRow);
    table.appendChild(head);

    var body = document.createElement("tbody");
    var count = COMPARISON.length < MAX_ROWS ? COMPARISON.length : MAX_ROWS;
    for (var i = 0; i < count; i++) body.appendChild(buildComparisonRow(COMPARISON[i]));
    table.appendChild(body);
    return table;
  }

  function buildValueStack() {
    var list = el("ul", "pw-stack");
    var count = VALUE_STACK.length < MAX_ROWS ? VALUE_STACK.length : MAX_ROWS;
    for (var i = 0; i < count; i++) {
      list.appendChild(el("li", null, t(VALUE_STACK[i].key, VALUE_STACK[i].fallback)));
    }
    return list;
  }

  function buildLicenseForm(modal) {
    var toggle = el("button", "pw-license-toggle", t("upgradeAlreadyHaveLicense", "Already have a licence key?"));
    toggle.type = "button";
    toggle.setAttribute("data-action", "license-toggle");
    modal.appendChild(toggle);

    var form = el("div", "pw-license-form");
    form.id = "pw-license-form";
    var input = el("input", "pw-license-input");
    input.id = "pw-license-input";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", t("labelLicenseKey", "Licence key"));
    form.appendChild(input);
    var submit = el("button", "pw-license-submit", t("buttonActivate", "Activate"));
    submit.type = "button";
    submit.setAttribute("data-action", "license-submit");
    form.appendChild(submit);
    modal.appendChild(form);

    var error = el("div", "pw-license-error");
    error.id = "pw-license-error";
    error.setAttribute("role", "alert");
    modal.appendChild(error);

    var success = el("div", "pw-license-success");
    success.id = "pw-license-success";
    success.setAttribute("role", "status");
    modal.appendChild(success);
  }

  function buildHeader(modal, featureName) {
    var close = el("button", "pw-close", t("buttonClose", "Close"));
    close.type = "button";
    close.setAttribute("data-action", "close");
    close.setAttribute("aria-label", t("labelClosePaywall", "Close upgrade dialog"));
    modal.appendChild(close);

    modal.appendChild(el("div", "pw-badge", t("paywallProBadge", "Pro")));

    var title = el("h2", "pw-title", t("upgradePaywallTitle", "Unlock " + featureName, [featureName]));
    title.id = "pw-modal-title";
    modal.appendChild(title);

    // Speak to the limit the user just hit.
    var fid = opt("featureId");
    var sub = fid === "listen_aloud"
      ? t("paywallSubtitleListen", "You've used today's 3 free listens. Pro lets you listen to as many articles as you like.")
      : fid === "markdown_export"
        ? t("paywallSubtitleMarkdown", "Your free Markdown export is used. Pro exports articles and highlights whenever you like. Backup, CSV and bookmarks stay free.")
        : t("upgradePaywallSubtitle", "Keep every article on your device and search all of it.");
    modal.appendChild(el("p", "pw-subtitle", sub));
  }

  function buildActions(modal) {
    var cta = el("button", "pw-cta pw-cta-primary", t("paywallSeePlans", "See both plans at zovo.one"));
    cta.type = "button";
    cta.setAttribute("data-action", "checkout");
    modal.appendChild(cta);
  }

  function buildFooter(modal) {
    var reframe = opt("reframe");
    if (reframe === null || reframe === undefined) {
      reframe = t("paywallReframe",
        "The tools this replaces bill you every month. Here you can pay monthly or once.");
    }
    if (reframe) modal.appendChild(el("p", "pw-reframe", reframe));

    if (opt("showRefundTerms") !== false) {
      modal.appendChild(el("p", "pw-guarantee",
        t("paywallGuarantee", "Monthly cancels any time. Lifetime is final once your key arrives, and anything faulty gets fixed or refunded.")));
    }
  }

  function buildModal(featureName) {
    var modal = el("div", "pw-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "pw-modal-title");

    buildHeader(modal, featureName);
    modal.appendChild(buildValueStack());
    modal.appendChild(buildComparison());
    buildActions(modal);
    buildFooter(modal);
    buildLicenseForm(modal);
    return modal;
  }

  /* ---------------- licence activation ---------------- */

  function showError(root, message) {
    var box = root.querySelector("#pw-license-error");
    if (box) { box.textContent = message; box.classList.add("visible"); }
  }

  function clearError(root) {
    var box = root.querySelector("#pw-license-error");
    if (box) { box.textContent = ""; box.classList.remove("visible"); }
  }

  function showSuccess(root, message) {
    var box = root.querySelector("#pw-license-success");
    if (box) { box.textContent = message; box.classList.add("visible"); }
  }

  function submitLicense(root) {
    var input = root.querySelector("#pw-license-input");
    var button = root.querySelector('[data-action="license-submit"]');
    if (!input || !button) return;
    var key = input.value.trim();
    if (!key) {
      showError(root, t("errorPleaseEnterLicenseKey", "Enter your licence key."));
      return;
    }
    button.disabled = true;
    button.textContent = t("buttonActivating", "Checking");
    clearError(root);
    chrome.runtime.sendMessage({ action: "ACTIVATE_LICENSE", payload: { licenseKey: key } }, function (res) {
      button.disabled = false;
      button.textContent = t("buttonActivate", "Activate");
      if (chrome.runtime.lastError || !res || !res.success || !res.data) {
        showError(root, t("errorFailedToConnect", "Could not reach the licence server. Try again."));
        return;
      }
      var data = res.data;
      if (!data.valid) {
        /* Branch on the stable code, never on the shape of the payload. */
        if (data.code === "ERR_NETWORK") {
          showError(root, t("errorFailedToConnect", "Could not reach the licence server. Try again."));
        } else if (data.code === "ERR_INPUT") {
          showError(root, t("errorPleaseEnterLicenseKey", "Enter your licence key."));
        } else {
          showError(root, t("errorInvalidLicenseKeyPaywall", "That licence key is not valid."));
        }
        return;
      }
      emit("key_verified", { tier: data.tier });
      showSuccess(root, t("upgradeLicenseActivated", "Licence active. Reloading."));
      input.style.display = "none";
      button.style.display = "none";
      setTimeout(function () { dismiss(root, true); window.location.reload(); }, 1200);
    });
  }

  /* ---------------- instrumentation ---------------- */

  function recordImpression(featureId) {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get({ paywallImpressions: [] }, function (out) {
      if (chrome.runtime.lastError) return;
      var log = out.paywallImpressions || [];
      log.push({ feature: featureId || "unknown", timestamp: Date.now() });
      if (log.length > MAX_IMPRESSIONS) log = log.slice(log.length - MAX_IMPRESSIONS);
      chrome.storage.local.set({ paywallImpressions: log }, function () {
        if (chrome.runtime.lastError) {
          console.warn("[Paywall] impression write error:", chrome.runtime.lastError.message);
        }
      });
    });
  }

  function getImpressionCount() {
    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) { resolve(0); return; }
      chrome.storage.local.get({ paywallImpressions: [] }, function (out) {
        resolve(chrome.runtime.lastError ? 0 : (out.paywallImpressions || []).length);
      });
    });
  }

  function getImpressionStats() {
    return new Promise(function (resolve) {
      var empty = { totalImpressions: 0, topFeatures: [], lastShown: null };
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) { resolve(empty); return; }
      chrome.storage.local.get({ paywallImpressions: [] }, function (out) {
        if (chrome.runtime.lastError) { resolve(empty); return; }
        var log = out.paywallImpressions || [];
        var counts = {};
        var last = null;
        for (var i = 0; i < log.length; i++) {
          var name = log[i].feature || "unknown";
          counts[name] = (counts[name] || 0) + 1;
          if (!last || log[i].timestamp > last) last = log[i].timestamp;
        }
        var top = Object.keys(counts).map(function (name) {
          return { name: name, count: counts[name] };
        }).sort(function (a, b) { return b.count - a.count; });
        resolve({ totalImpressions: log.length, topFeatures: top, lastShown: last });
      });
    });
  }

  /* ---------------- open and close ---------------- */

  function humanize(name) {
    if (!name || name.indexOf("_") === -1) return name;
    return name.split("_").map(function (part) {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join(" ");
  }

  function wireEvents(root, featureId) {
    root.addEventListener("click", function (event) {
      if (event.target === root) { dismiss(root); return; }
      var trigger = event.target.closest("[data-action]");
      if (!trigger) return;
      var action = trigger.getAttribute("data-action");
      if (action === "close") { dismiss(root); return; }
      if (action === "checkout") {
        emit("cta_click", { plan: "plans", feature: featureId });
        if (typeof activeOpts.onUpgrade === "function") activeOpts.onUpgrade("plans", featureId);
        openCheckout(checkoutUrl(opt("surface"), featureId));
        return;
      }
      if (action === "license-toggle") {
        var form = root.querySelector("#pw-license-form");
        if (!form) return;
        form.classList.toggle("visible");
        if (form.classList.contains("visible")) {
          var input = root.querySelector("#pw-license-input");
          if (input) input.focus();
        }
        return;
      }
      if (action === "license-submit") submitLicense(root);
    });
  }

  function trapFocus(root) {
    var modal = root.querySelector(".pw-modal");
    if (typeof FocusManager !== "undefined" && modal) {
      root._focusTrap = FocusManager.trapFocus(modal);
      root._escapeHandler = FocusManager.onEscape(modal, function () { dismiss(root); });
      return;
    }
    root._keyHandler = function (event) { if (event.key === "Escape") dismiss(root); };
    document.addEventListener("keydown", root._keyHandler);
    var close = root.querySelector(".pw-close");
    if (close) close.focus();
  }

  /* options.html and sidebar.html link paywall.css. Any other surface that
   * loads paywall.js without the stylesheet gets a minimal usable fallback. */
  function ensureStyles() {
    if (stylesChecked) return;
    stylesChecked = true;
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].href && links[i].href.indexOf("paywall.css") !== -1) return;
    }
    if (document.querySelector("style[data-paywall-css]")) return;
    var style = document.createElement("style");
    style.setAttribute("data-paywall-css", "fallback");
    style.textContent = [
      ".pw-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 250ms ease}",
      ".pw-overlay.visible{opacity:1}",
      ".pw-modal{background:var(--color-bg,#fff);color:var(--color-text,#111);border-radius:16px;max-width:420px;width:90vw;max-height:90vh;overflow-y:auto;padding:24px;position:relative}",
      ".pw-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px}",
      ".pw-table th,.pw-table td{padding:5px 8px;text-align:left;border-bottom:1px solid rgba(128,128,128,.25)}",
      ".pw-cta{width:100%;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px}",
      ".pw-license-form{display:none}.pw-license-form.visible{display:flex;gap:8px}",
      ".pw-license-error,.pw-license-success{display:none}.pw-license-error.visible,.pw-license-success.visible{display:block}"
    ].join("");
    document.head.appendChild(style);
  }

  /* Shows a wall that a non-rendering context, such as the service worker,
   * recorded earlier. UI surfaces call this once on open. */
  function showPendingWall(options) {
    if (typeof FeatureGate === "undefined" || !FeatureGate.consumePendingWall) {
      return Promise.resolve(null);
    }
    return FeatureGate.consumePendingWall().then(function (rec) {
      if (!rec || !rec.feature) return null;
      var opts = options || {};
      opts.featureId = rec.feature;
      opts.surface = opts.surface || "caphit";
      return show(rec.feature, opts);
    });
  }

  function show(featureName, options) {
    ensureStyles();
    activeOpts = options || {};
    var featureId = activeOpts.featureId || featureName || null;
    var label = humanize(featureName) || t("proFeaturesHeader", "Pro");
    if (overlay) dismiss(overlay, true);

    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    var root = el("div", "pw-overlay");
    root.appendChild(buildModal(label));
    document.body.appendChild(root);
    void root.offsetHeight;
    root.classList.add("visible");
    overlay = root;
    wireEvents(root, featureId);
    trapFocus(root);
    recordImpression(featureId);
    emit("paywall_shown", { feature: featureId, surface: opt("surface") });
    if (typeof Announcer !== "undefined") {
      Announcer.status(t("announcerUpgradeDialogOpened", "Upgrade dialog opened"));
    }
    return Promise.resolve(root);
  }

  function dismiss(root, silent) {
    var target = root || overlay || document.querySelector(".pw-overlay");
    if (!target) return;
    if (target._focusTrap) { target._focusTrap.deactivate(); target._focusTrap = null; }
    if (target._escapeHandler) { target._escapeHandler.remove(); target._escapeHandler = null; }
    if (target._keyHandler) {
      document.removeEventListener("keydown", target._keyHandler);
      target._keyHandler = null;
    }
    document.body.style.overflow = previousOverflow || "";
    previousOverflow = "";
    if (!silent) {
      emit("paywall_dismissed", { feature: activeOpts.featureId || null });
      if (typeof activeOpts.onDismiss === "function") activeOpts.onDismiss();
    }
    target.classList.remove("visible");
    setTimeout(function () {
      if (target.parentNode) target.parentNode.removeChild(target);
    }, 250);
    if (overlay === target) overlay = null;
    if (!silent) activeOpts = {};
  }

  function configure(options) {
    globalOpts = options || {};
  }

  var api = {
    show: show,
    showPendingWall: showPendingWall,
    dismiss: dismiss,
    configure: configure,
    checkoutUrl: checkoutUrl,
    getImpressionCount: getImpressionCount,
    getImpressionStats: getImpressionStats,
    CHECKOUT_URL: CHECKOUT_BASE + "?" + UTM,
    DEFAULTS: DEFAULTS
  };

  if (typeof window !== "undefined") window.Paywall = api;
})();
