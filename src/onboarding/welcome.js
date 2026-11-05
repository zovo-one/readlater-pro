/* ============================================================
   ReadLater Pro - first run controller
   ------------------------------------------------------------
   Drives the six step flow. Step count, labels and roles are
   read from the DOM, so adding or removing a <section class="step">
   needs no change here.
   ------------------------------------------------------------
   Failure policy. The service worker may be asleep, busy, or
   never answer at all. Every chrome call reads lastError and
   every message carries a timeout, and when one fails the page
   stays usable and says what happened in plain words. Nothing
   here claims an article was saved unless the database said so.
   ------------------------------------------------------------
   No eval, no innerHTML, no remote code. Dynamic text is set
   with textContent. Loops over browser data are capped.
   ============================================================ */
(function () {
  'use strict';

  var MAX_TAB_CHOICES = 6;
  var MAX_TITLE_CHARS = 120;
  var MSG_TIMEOUT_MS = 4000;
  var TABS_TIMEOUT_MS = 2500;
  var STORAGE_TIMEOUT_MS = 2500;

  var KEY_DONE = 'onboardingComplete';
  var KEY_DONE_AT = 'onboarding_completed_at';
  var KEY_DONE_FLEET = 'zovo_onboardingComplete';
  var KEY_PREFS = 'zovo_onboardingPrefs';
  var KEY_FIRST_VALUE = 'zovo_firstValueAt';
  var KEY_INTENT_AT = 'zovo_upgradeIntentAt';
  var KEY_INTENT_PLAN = 'zovo_upgradePlan';

  var steps = toArray(document.querySelectorAll('.step'));
  var dots = toArray(document.querySelectorAll('.dot'));
  var TOTAL = steps.length || 1;
  var current = 1;
  var plan = 'lifetime';
  var chosenTab = null;
  var saved = false;

  function $(id) { return document.getElementById(id); }
  function toArray(list) { return Array.prototype.slice.call(list || []); }
  function hasChrome() { return typeof chrome !== 'undefined' && !!chrome.runtime; }
  function hasStorage() { return hasChrome() && !!chrome.storage && !!chrome.storage.local; }

  /* ---------- i18n ---------- */
  function t(key, fallback) {
    if (!key) { return fallback || ''; }
    if (typeof I18n === 'undefined' || !I18n.get) { return fallback || key; }
    var msg = I18n.get(key);
    return (msg && msg !== key) ? msg : (fallback || key);
  }

  function tSub(key, subs, fallback) {
    if (typeof I18n === 'undefined' || !I18n.get) { return fallback; }
    var msg = I18n.get(key, subs);
    return (msg && msg !== key) ? msg : fallback;
  }

  function applyI18n() {
    if (typeof I18n !== 'undefined' && I18n.translateDOM) {
      try { I18n.translateDOM(); } catch (e) { logWarn('i18n', e); }
    }
  }

  function logWarn(where, err) {
    var text = (err && err.message) ? err.message : String(err);
    if (typeof console !== 'undefined') { console.warn('[welcome] ' + where + ': ' + text); }
  }

  /* ---------- chrome bridges, every one guarded ---------- */
  function send(action, payload, timeoutMs) {
    var wait = timeoutMs || MSG_TIMEOUT_MS;
    if (typeof MessageHelper !== 'undefined' && MessageHelper.send) {
      return MessageHelper.send(action, payload, wait);
    }
    return Promise.resolve({ success: false, error: 'Messaging unavailable', code: 'ERR_NO_HELPER' });
  }

  function storageSet(patch) {
    return new Promise(function (resolve) {
      if (!hasStorage()) { resolve(false); return; }
      var settled = false;
      var timer = setTimeout(function () { if (!settled) { settled = true; resolve(false); } }, STORAGE_TIMEOUT_MS);
      try {
        chrome.storage.local.set(patch, function () {
          if (settled) { return; }
          settled = true; clearTimeout(timer);
          if (chrome.runtime.lastError) { logWarn('storage.set', chrome.runtime.lastError); resolve(false); return; }
          resolve(true);
        });
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timer); logWarn('storage.set', e); resolve(false); }
      }
    });
  }

  function queryTabs() {
    return new Promise(function (resolve) {
      if (!hasChrome() || !chrome.tabs || !chrome.tabs.query) { resolve([]); return; }
      var settled = false;
      var timer = setTimeout(function () { if (!settled) { settled = true; resolve([]); } }, TABS_TIMEOUT_MS);
      try {
        chrome.tabs.query({}, function (list) {
          if (settled) { return; }
          settled = true; clearTimeout(timer);
          if (chrome.runtime.lastError) { logWarn('tabs.query', chrome.runtime.lastError); resolve([]); return; }
          resolve(list || []);
        });
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timer); logWarn('tabs.query', e); resolve([]); }
      }
    });
  }

  function currentTabId() {
    return new Promise(function (resolve) {
      if (!hasChrome() || !chrome.tabs || !chrome.tabs.getCurrent) { resolve(null); return; }
      var settled = false;
      var timer = setTimeout(function () { if (!settled) { settled = true; resolve(null); } }, TABS_TIMEOUT_MS);
      try {
        chrome.tabs.getCurrent(function (tab) {
          if (settled) { return; }
          settled = true; clearTimeout(timer);
          if (chrome.runtime.lastError) { logWarn('tabs.getCurrent', chrome.runtime.lastError); resolve(null); return; }
          resolve(tab && tab.id != null ? tab.id : null);
        });
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timer); logWarn('tabs.getCurrent', e); resolve(null); }
      }
    });
  }

  function openUrl(url) {
    if (hasChrome() && chrome.tabs && chrome.tabs.create) {
      try {
        chrome.tabs.create({ url: url }, function () { void chrome.runtime.lastError; });
        return;
      } catch (e) { logWarn('tabs.create', e); }
    }
    try { window.open(url, '_blank', 'noopener'); } catch (e2) { logWarn('window.open', e2); }
  }

  /* ---------- step meta ---------- */
  function stepEl(n) { return document.querySelector('.step[data-step="' + n + '"]'); }
  function stepRole(n) { var s = stepEl(n); return s ? (s.getAttribute('data-role') || '') : ''; }

  function nextText(n) {
    var s = stepEl(n);
    if (!s) { return t('buttonNext', 'Next'); }
    var key = s.getAttribute('data-i18n-next');
    var literal = s.getAttribute('data-next') || t('buttonNext', 'Next');
    return t(key, literal);
  }

  function stepHeading(n) {
    var s = stepEl(n);
    return s ? s.querySelector('h1, h2') : null;
  }

  /* ---------- render ---------- */
  function render(shouldFocus) {
    var i;
    for (i = 0; i < steps.length; i++) {
      var on = Number(steps[i].getAttribute('data-step')) === current;
      steps[i].classList.toggle('active', on);
      if (on) { steps[i].removeAttribute('aria-hidden'); } else { steps[i].setAttribute('aria-hidden', 'true'); }
    }
    for (i = 0; i < dots.length; i++) {
      var n = Number(dots[i].getAttribute('data-step'));
      dots[i].classList.toggle('active', n === current);
      dots[i].classList.toggle('done', n < current);
      if (n === current) { dots[i].setAttribute('aria-current', 'step'); } else { dots[i].removeAttribute('aria-current'); }
    }
    renderChrome();
    if (shouldFocus) { focusStep(); }
    announceStep();
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }

  function renderChrome() {
    var counter = $('counter'), fill = $('progressFill'), track = $('progressTrack');
    var back = $('backBtn'), label = $('nextLabel'), arrow = $('nextArrow');
    if (counter) { counter.textContent = pad(current) + ' / ' + pad(TOTAL); }
    if (fill) { fill.style.width = ((current / TOTAL) * 100) + '%'; }
    if (track) { track.setAttribute('aria-valuenow', String(current)); }
    if (back) { back.hidden = current === 1; }
    if (label) { label.textContent = nextText(current); }
    if (arrow) { arrow.style.display = stepRole(current) === 'pricing' ? 'none' : ''; }
  }

  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }

  function focusStep() {
    var h = stepHeading(current);
    if (!h) { return; }
    h.setAttribute('tabindex', '-1');
    try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
  }

  function announceStep() {
    var out = $('stepAnnounce');
    if (!out) { return; }
    var h = stepHeading(current);
    var title = h ? String(h.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var where = tSub('announcerStepOfTotal', [String(current), String(TOTAL)],
      'Step ' + current + ' of ' + TOTAL);
    out.textContent = where + (title ? '. ' + title : '');
  }

  function go(n, shouldFocus) {
    var target = Math.max(1, Math.min(TOTAL, n));
    if (target === current) { return; }
    current = target;
    render(shouldFocus !== false);
  }

  /* ---------- navigation ---------- */
  function onNext() {
    var role = stepRole(current);
    if (role === 'setup') { saveSetup(); }
    if (role === 'pricing') { convert(); return; }
    if (current >= TOTAL) { finish(); return; }
    go(current + 1, true);
  }

  function bindNav() {
    var next = $('nextBtn'), back = $('backBtn');
    if (next) { next.addEventListener('click', onNext); }
    if (back) { back.addEventListener('click', function () { go(current - 1, true); }); }
    for (var i = 0; i < dots.length; i++) { bindDot(dots[i]); }
    document.addEventListener('keydown', onGlobalKey);
  }

  function bindDot(dot) {
    dot.addEventListener('click', function () { go(Number(dot.getAttribute('data-step')), true); });
  }

  function isTypingTarget(el) {
    if (!el || !el.tagName) { return false; }
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') { return true; }
    return el.isContentEditable === true;
  }

  function onGlobalKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) { return; }
    if (isTypingTarget(e.target)) { return; }
    if (e.target && e.target.closest && e.target.closest('[role="radiogroup"]')) { return; }
    if (e.key === 'ArrowRight' && current < TOTAL) { go(current + 1, true); }
    if (e.key === 'ArrowLeft' && current > 1) { go(current - 1, true); }
  }

  /* ---------- radiogroups, shared by the tab list, theme, size and plan ---------- */
  function selectRadio(group, chosen) {
    var all = toArray(group.querySelectorAll('[role="radio"]'));
    for (var i = 0; i < all.length; i++) {
      var on = all[i] === chosen;
      all[i].setAttribute('aria-checked', on ? 'true' : 'false');
      all[i].setAttribute('tabindex', on ? '0' : '-1');
      all[i].classList.toggle('on', on);
    }
  }

  function bindRadioGroup(group, onPick) {
    if (!group) { return; }
    group.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[role="radio"]') : null;
      if (!btn || !group.contains(btn)) { return; }
      selectRadio(group, btn);
      onPick(btn);
    });
    group.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') { return; }
      var all = toArray(group.querySelectorAll('[role="radio"]'));
      if (!all.length) { return; }
      var at = all.indexOf(document.activeElement);
      var forward = (e.key === 'ArrowRight' || e.key === 'ArrowDown');
      var to = all[(((at < 0 ? 0 : at) + (forward ? 1 : -1)) + all.length) % all.length];
      e.preventDefault();
      selectRadio(group, to);
      to.focus();
      onPick(to);
    });
  }

  /* ---------- step 2, the real save ---------- */
  function usableTab(tab, selfId) {
    if (!tab || !tab.url || tab.id === selfId) { return false; }
    var url = String(tab.url);
    return url.indexOf('http://') === 0 || url.indexOf('https://') === 0;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }

  function clip(text, max) {
    var s = String(text || '').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function loadTabs() {
    var list = $('sdTabList'), meta = $('sdTabCount'), empty = $('sdEmpty');
    if (!list) { return; }
    currentTabId().then(function (selfId) {
      return queryTabs().then(function (tabs) {
        var picked = [], seen = {};
        for (var i = 0; i < tabs.length && picked.length < MAX_TAB_CHOICES; i++) {
          var tab = tabs[i];
          if (!usableTab(tab, selfId) || seen[tab.url]) { continue; }
          seen[tab.url] = true;
          picked.push({ url: tab.url, title: clip(tab.title || hostOf(tab.url), MAX_TITLE_CHARS) });
        }
        renderTabs(picked, list, meta, empty);
      });
    }).catch(function (e) { logWarn('loadTabs', e); renderTabs([], list, meta, empty); });
  }

  function renderTabs(picked, list, meta, empty) {
    list.textContent = '';
    if (!picked.length) {
      if (meta) { meta.textContent = t('obTabsNone', 'nothing to pick'); }
      if (empty) { empty.hidden = false; }
      setStatus(hasChrome()
        ? t('obSaveNoTabs', 'Nothing to save from here yet, and that is fine. The toolbar icon does the same job on any page.')
        : t('obNoBrowserApi', 'This page is running outside the extension, so saving is switched off here.'), !hasChrome());
      return;
    }
    if (empty) { empty.hidden = true; }
    if (meta) { meta.textContent = String(picked.length) + ' ' + t('obTabsPickOne', 'to pick from'); }
    for (var i = 0; i < picked.length; i++) { list.appendChild(tabRow(picked[i], i === 0)); }
    chosenTab = picked[0];
    var btn = $('sdSaveBtn');
    if (btn) { btn.disabled = false; }
  }

  function tabRow(entry, first) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sd-tab';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', first ? 'true' : 'false');
    btn.setAttribute('tabindex', first ? '0' : '-1');
    var mark = document.createElement('span');
    mark.className = 'sd-mark';
    mark.setAttribute('aria-hidden', 'true');
    var tx = document.createElement('span');
    tx.className = 'sd-tx';
    var title = document.createElement('span');
    title.className = 'sd-t';
    title.textContent = entry.title;
    var host = document.createElement('span');
    host.className = 'sd-h';
    host.textContent = hostOf(entry.url);
    tx.appendChild(title); tx.appendChild(host);
    btn.appendChild(mark); btn.appendChild(tx);
    btn.setAttribute('data-url', entry.url);
    return btn;
  }

  function setStatus(text, isError) {
    var el = $('sdStatus');
    if (!el) { return; }
    el.textContent = text;
    el.classList.toggle('is-err', !!isError);
  }

  function doSave() {
    var btn = $('sdSaveBtn');
    if (!chosenTab || !btn || btn.disabled) { return; }
    btn.disabled = true;
    setStatus(t('obSaveWorking', 'Saving it now'), false);
    send('SAVE_ARTICLE', { url: chosenTab.url, title: chosenTab.title, savedAt: Date.now() })
      .then(function (res) {
        if (!res || res.success !== true) {
          btn.disabled = false;
          setStatus(t('obSaveFailed', 'That one did not save. The background worker did not answer, so try again or use the toolbar icon on the page itself.'), true);
          return;
        }
        onSaved(res.data && res.data.duplicate === true);
      })
      .catch(function (e) {
        logWarn('SAVE_ARTICLE', e);
        btn.disabled = false;
        setStatus(t('obSaveFailed', 'That one did not save. The background worker did not answer, so try again or use the toolbar icon on the page itself.'), true);
      });
  }

  function onSaved(duplicate) {
    saved = true;
    renderSavedItem(chosenTab);
    setStatus(duplicate
      ? t('obSaveDuplicate', 'That one was already on your list, so nothing was duplicated.')
      : t('obSaveDone', 'Saved. It is in your reading list on this machine, and it stays there.'), false);
    var open = $('sdOpenPanel');
    if (open) { open.hidden = false; }
    var patch = {};
    patch[KEY_FIRST_VALUE] = Date.now();
    storageSet(patch);
  }

  function renderSavedItem(entry) {
    var list = $('sdSavedList'), count = $('sdSavedCount');
    if (!list || !entry) { return; }
    list.textContent = '';
    var row = document.createElement('div');
    row.className = 'sd-item';
    var tx = document.createElement('span');
    tx.className = 'sd-tx';
    var title = document.createElement('span');
    title.className = 'sd-t';
    title.textContent = entry.title;
    var host = document.createElement('span');
    host.className = 'sd-h';
    host.textContent = hostOf(entry.url);
    tx.appendChild(title); tx.appendChild(host);
    var badge = document.createElement('span');
    badge.className = 'sd-badge';
    badge.textContent = t('obSavedBadge', 'saved');
    row.appendChild(tx); row.appendChild(badge);
    list.appendChild(row);

    /* SAVE_ARTICLE stores the link, not the article body. Only the toolbar,
       the shortcut and the context menu can read a page, because those are
       the gestures that grant activeTab. Say so here rather than let the
       reader view be the one to break the news. */
    var note = document.createElement('p');
    note.className = 'sd-ph sd-fulltext';
    note.textContent = t('obSavedFullText', 'The full text comes with it when you save from the page itself, with the toolbar icon or the shortcut.');
    list.appendChild(note);

    if (count) { count.textContent = t('obPanelOneSaved', '1 article'); }
  }

  function openPanel() {
    setStatus(t('obPanelOpening', 'Opening the side panel'), false);
    send('OPEN_SIDE_PANEL', {}).then(function (res) {
      if (res && res.success === true) {
        setStatus(t('obPanelOpened', 'The side panel is open on the right, with your article in it.'), false);
        return;
      }
      setStatus(t('obPanelFailed', 'The side panel would not open from here. Press the reading list shortcut on any normal page and it will.'), true);
    }).catch(function (e) {
      logWarn('OPEN_SIDE_PANEL', e);
      setStatus(t('obPanelFailed', 'The side panel would not open from here. Press the reading list shortcut on any normal page and it will.'), true);
    });
  }

  function bindSaveDemo() {
    var btn = $('sdSaveBtn'), open = $('sdOpenPanel');
    if (btn) { btn.addEventListener('click', doSave); }
    if (open) { open.addEventListener('click', openPanel); }
    bindRadioGroup($('sdTabList'), function (picked) {
      var url = picked.getAttribute('data-url');
      var title = picked.querySelector('.sd-t');
      if (url) { chosenTab = { url: url, title: title ? title.textContent : url }; }
    });
    loadTabs();
  }

  /* ---------- step 3, real reader settings ---------- */
  function pickedValue(groupId, fallback) {
    var group = $(groupId);
    if (!group) { return fallback; }
    var on = group.querySelector('[role="radio"][aria-checked="true"]');
    return on ? on.getAttribute('data-setting-value') : fallback;
  }

  function collectSettings() {
    var markRead = $('markReadOnOpen'), notify = $('showNotifications');
    return {
      readerTheme: pickedValue('themeSeg', 'light'),
      readerFontSize: Number(pickedValue('sizeSeg', '18')) || 18,
      markReadOnOpen: markRead ? !!markRead.checked : true,
      showNotifications: notify ? !!notify.checked : false
    };
  }

  function saveSetup() {
    var settings = collectSettings();
    var prefs = {};
    prefs[KEY_PREFS] = { fields: [settings.readerTheme], toggles: { markReadOnOpen: settings.markReadOnOpen, showNotifications: settings.showNotifications } };
    storageSet(prefs);
    send('SAVE_SETTINGS', settings).then(function (res) {
      if (res && res.success === true) { setSetupStatus(t('obSetupSaved', 'Saved to your settings.')); return; }
      storageSet(settings).then(function (ok) {
        setSetupStatus(ok
          ? t('obSetupSaved', 'Saved to your settings.')
          : t('obSetupFailed', 'These could not be written just now. Settings has the same controls whenever you want them.'));
      });
    }).catch(function (e) {
      logWarn('SAVE_SETTINGS', e);
      storageSet(settings);
    });
  }

  function setSetupStatus(text) {
    var el = $('setupStatus');
    if (el) { el.textContent = text; }
  }

  function bindSetup() {
    bindRadioGroup($('themeSeg'), function () { });
    bindRadioGroup($('sizeSeg'), function () { });
  }

  /* ---------- step 5, the offer ----------
     This is the only surface in the package allowed to show a price, so it is
     also the only place a price can go stale. Each figure therefore resolves
     from exactly one i18n key, named by the plan button, and the break-even
     month count is derived from those two figures instead of being written
     down anywhere. Raising the lifetime tier is a one-key edit. */

  function planKey(btn, attr) {
    return btn ? (btn.getAttribute(attr) || '') : '';
  }

  function planButton(name) {
    var seg = $('planSeg');
    return seg ? seg.querySelector('[data-plan="' + name + '"]') : null;
  }

  /* Reads a price figure from its single source. Returns '' when the key is
     missing, so the page renders an empty slot rather than a stale number. */
  function tOrBlank(key) {
    if (!key || typeof I18n === 'undefined' || !I18n.get) { return ''; }
    var msg = I18n.get(key);
    return (msg && msg !== key) ? msg : '';
  }

  function priceText(btn) {
    return tOrBlank(planKey(btn, 'data-amount-i18n'));
  }

  function priceNumber(btn) {
    var raw = priceText(btn).replace(/[^0-9.]/g, '');
    var value = parseFloat(raw);
    return isFinite(value) && value > 0 ? value : 0;
  }

  /* Months after which one payment costs less than the recurring stream.
     Derived, never stored, so it cannot disagree with the two amounts. */
  function breakevenMonths() {
    var once = priceNumber(planButton('lifetime'));
    var monthly = priceNumber(planButton('monthly'));
    if (!once || !monthly) { return 0; }
    return Math.ceil(once / monthly);
  }

  /* The month count is written into its own span and the surrounding words
     come from a separate key, so no message anywhere carries a substitution
     token or a currency figure. Two keys in the package hold a price, and
     both are named on the plan buttons. */
  function applyBreakeven(btn) {
    var el = $('breakeven'), num = $('breakevenMonths');
    if (!el || !num) { return; }
    var months = btn && btn.hasAttribute('data-breakeven') ? breakevenMonths() : 0;
    if (!months) { el.hidden = true; num.textContent = ''; return; }
    num.textContent = String(months);
    el.hidden = false;
  }

  function applyPlan(btn) {
    if (!btn) { return; }
    setText('priceAmt', priceText(btn));
    setText('pricePer', tOrBlank(planKey(btn, 'data-per-i18n')));
    setText('priceSub', tOrBlank(planKey(btn, 'data-sub-i18n')));
    setText('reassure1', tOrBlank(planKey(btn, 'data-reassure-i18n')));
    applyBreakeven(btn);
  }

  function setText(id, value) {
    var el = $(id);
    if (el && typeof value === 'string') { el.textContent = value; }
  }

  function bindPricing() {
    var seg = $('planSeg');
    if (!seg) { return; }
    bindRadioGroup(seg, function (btn) {
      plan = btn.getAttribute('data-plan') || 'lifetime';
      applyPlan(btn);
      renderChrome();
    });
    applyPlan(seg.querySelector('[data-plan][aria-checked="true"]') || planButton('lifetime'));
    loadFreeCap();
  }

  /* The free allowance is stated on the pricing step, so it is read from
     src/features/limits-config.json, the file that declares itself the only
     place the split and the caps are defined and the same file the gate loads.
     Hard-coding the number here would be the D2 drift all over again. If the
     read fails the line stays hidden rather than guessing. */
  function loadFreeCap() {
    var row = $('freeCap'), num = $('freeCapCount');
    if (!row || !num) { return; }
    if (!hasChrome() || !chrome.runtime.getURL || typeof fetch !== 'function') { return; }
    var url;
    try { url = chrome.runtime.getURL('src/features/limits-config.json'); } catch (e) { logWarn('getURL', e); return; }
    fetch(url)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cfg) {
        var caps = cfg && cfg.freeCaps;
        var cap = caps ? caps.full_text_search : null;
        if (typeof cap !== 'number' || cap <= 0) { return; }
        num.textContent = String(cap);
        row.hidden = false;
      })
      .catch(function (e) { logWarn('limits-config', e); });
  }

  function bindFAQ() {
    var items = toArray(document.querySelectorAll('.faq-item'));
    for (var i = 0; i < items.length; i++) { bindFAQItem(items[i]); }
  }

  function bindFAQItem(item) {
    var q = item.querySelector('.faq-q'), a = item.querySelector('.faq-a');
    if (!q || !a) { return; }
    q.addEventListener('click', function () {
      var open = item.classList.toggle('open');
      q.setAttribute('aria-expanded', open ? 'true' : 'false');
      a.style.maxHeight = open ? (a.scrollHeight + 'px') : '0';
    });
  }

  function upgradeUrl() {
    var seg = $('planSeg');
    var fromSeg = seg ? seg.getAttribute('data-upgrade-url') : '';
    /* Kept as one unbroken literal so a static URL audit can match it. */
    return fromSeg || document.body.getAttribute('data-upgrade-url') ||
      'https://zovo.one/pricing?utm_source=readlater_pro&utm_medium=extension&utm_campaign=upgrade&utm_content=onboarding';
  }

  function convert() {
    var patch = {};
    patch[KEY_INTENT_AT] = Date.now();
    patch[KEY_INTENT_PLAN] = plan;
    storageSet(patch);
    openUrl(upgradeUrl());
    if (current < TOTAL) { go(current + 1, true); }
  }

  /* ---------- finish ---------- */
  function finish() {
    var patch = {};
    patch[KEY_DONE] = true;
    patch[KEY_DONE_AT] = Date.now();
    patch[KEY_DONE_FLEET] = true;
    storageSet(patch).then(closeTab);
  }

  function closeTab() {
    currentTabId().then(function (id) {
      if (id != null && hasChrome() && chrome.tabs && chrome.tabs.remove) {
        try { chrome.tabs.remove(id, function () { void chrome.runtime.lastError; }); return; } catch (e) { logWarn('tabs.remove', e); }
      }
      try { window.close(); } catch (e2) { logWarn('window.close', e2); }
    });
  }

  /* ---------- platform touch ups ---------- */
  function localiseModifier() {
    var isMac = false;
    try { isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || ''); } catch (e) { isMac = false; }
    if (!isMac) { return; }
    var keys = toArray(document.querySelectorAll('kbd[data-key="mod"]'));
    for (var i = 0; i < keys.length; i++) { keys[i].textContent = t('obKeyCommand', 'Cmd'); }
  }

  /* ---------- init ---------- */
  var started = false;

  function init() {
    if (started) { return; }
    started = true;
    applyI18n();
    localiseModifier();
    bindNav();
    bindSaveDemo();
    bindSetup();
    bindPricing();
    bindFAQ();
    render(false);
    if (!hasChrome()) {
      setStatus(t('obNoBrowserApi', 'This page is running outside the extension, so saving is switched off here.'), true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* exposed for the QA harness only, no behaviour depends on it */
  if (typeof window !== 'undefined') {
    window.ReadLaterOnboarding = {
      stepCount: function () { return TOTAL; },
      currentStep: function () { return current; },
      didSave: function () { return saved; }
    };
  }
})();
