/* ReadLater Pro - What's new page logic.
 * Loaded after membership/eligibility.js. The page itself makes no network
 * calls: library numbers come from the service worker's GET_STATS (IndexedDB
 * in this browser) and membership from ZovoSubscriptionMembership. */
(() => {
  'use strict';

  const RELEASE = '1.3.0';
  const CAMPAIGN = 'whats-new-1-3-0';
  const MAX_SCAN = 50000;   // article-engine.js MAX_ARTICLE_SCAN; counts stop here

  const hasChrome = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id && chrome.storage);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const nf = new Intl.NumberFormat(undefined);
  let windowId = null;      // fetched at boot so sidePanel.open runs inside the click gesture
  let changesAutoOpened = false;

  /* ---------------- data sources ---------------- */

  const DAY = 864e5;
  const PREVIEW_STATES = {
    free: { kind: 'free', stats: { totalArticles: 214, totalRead: 87, unreadCount: 127, totalReadingTime: 611, savedThisWeek: 9 }, installDate: Date.now() - 196 * DAY, intent: false },
    pro: { kind: 'protected', stats: { totalArticles: 1302, totalRead: 840, unreadCount: 462, totalReadingTime: 5712, savedThisWeek: 23 }, installDate: Date.now() - 410 * DAY, intent: false },
    fresh: { kind: 'free', stats: { totalArticles: 0, totalRead: 0, unreadCount: 0, totalReadingTime: 0, savedThisWeek: 0 }, installDate: null, intent: false },
    lapsed: { kind: 'lapsed', stats: { totalArticles: 388, totalRead: 151, unreadCount: 237, totalReadingTime: 1020, savedThisWeek: 4 }, installDate: Date.now() - 260 * DAY, intent: false }
  };

  function previewState() {
    const p = new URLSearchParams(location.search).get('state');
    return PREVIEW_STATES[p] ? p : 'free';
  }

  const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  function send(action, payload) {
    return withTimeout(new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, payload }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || res.success !== true) return reject(new Error((res && res.error) || 'no response'));
        resolve(res.data);
      });
    }));
  }

  async function readKind() {
    const M = globalThis.ZovoSubscriptionMembership;
    if (!M) return 'unknown';
    const kind = await withTimeout(M.read());
    if (kind === 'free') return 'free';
    if (kind !== 'member') return 'unknown';   // trial, dismissed or unreadable: never pitch
    // A saved key alone isn't proof of an active plan; ask the worker.
    try {
      const status = await send('GET_LICENSE_STATUS');
      if (status && status.valid === true) return 'protected';
      if (status && status.valid === false && status.origin === 'server' && status.licenseKey) return 'lapsed';
    } catch { /* fall through */ }
    return 'unknown';
  }

  async function readState() {
    if (!hasChrome) return { preview: previewState(), ...PREVIEW_STATES[previewState()] };
    const out = { kind: 'unknown', stats: null, installDate: null, intent: false };
    try { out.kind = await readKind(); } catch { out.kind = 'unknown'; }
    try { out.stats = await send('GET_STATS'); } catch { out.stats = null; }
    try {
      const local = await chrome.storage.local.get(['installDate', 'upgradeIntentAt']);
      const d = Number(local.installDate);
      if (Number.isFinite(d) && d > 0 && d <= Date.now()) out.installDate = d;
      out.intent = Number(local.upgradeIntentAt) > 0;
    } catch { /* keep defaults */ }
    return out;
  }

  /* ---------------- rendering ---------------- */

  function setText(sel, text) { const el = $(sel); if (el) el.textContent = text; }
  const count = (n) => (n >= MAX_SCAN ? nf.format(MAX_SCAN) + '+' : nf.format(n));
  const valid = (n) => Number.isFinite(n) && n >= 0;

  function readingTime(minutes) {
    if (!valid(minutes) || minutes === 0) return '';
    if (minutes < 90) return 'about ' + nf.format(minutes) + ' minutes of reading, estimated';
    return 'about ' + nf.format(Math.round(minutes / 60)) + ' hours of reading, estimated';
  }

  function renderVersion() {
    let v = RELEASE;
    try { if (hasChrome) v = chrome.runtime.getManifest().version || RELEASE; } catch { /* keep RELEASE */ }
    $$('[data-version]').forEach(el => {
      if (el.dataset.version === 'release') el.textContent = RELEASE;
      else el.textContent = el.dataset.version === 'v' ? 'v' + v : v;
    });
  }

  function renderHero(state) {
    const s = state.stats;
    const saved = s && Number(s.totalArticles);
    const read = s && Number(s.totalRead);
    if (!valid(saved) || saved === 0) return;
    setText('#heroSaved', count(saved));
    setText('#heroSavedNoun', saved === 1 ? 'article' : 'articles');
    if (valid(read) && read > 0) setText('#heroRead', count(read));
    $('#heroReadPart').hidden = !(valid(read) && read > 0);
    $('#heroLine2Count').hidden = false;
    $('#heroLine2Plain').hidden = true;
  }

  function renderStats(state) {
    // Start from a clean slate so a later refresh can replace an earlier fallback.
    ['#cardSaved', '#cardRead', '#cardWeek'].forEach(sel => { $(sel).hidden = true; });
    $('#stats').hidden = true;

    const s = state.stats;
    const cards = [];
    const saved = s && Number(s.totalArticles);
    const read = s && Number(s.totalRead);
    const unread = s && Number(s.unreadCount);
    const week = s && Number(s.savedThisWeek);
    if (valid(saved) && saved > 0) {
      setText('#statSaved', count(saved));
      setText('#statSavedLabel', saved === 1 ? 'Article in your library' : 'Articles in your library');
      if (valid(unread)) setText('#statSavedNote', unread === 0 ? 'all caught up' : count(unread) + ' still to read');
      cards.push('#cardSaved');
    }
    if (valid(read) && read > 0) {
      setText('#statRead', count(read));
      setText('#statReadLabel', read === 1 ? 'Article finished' : 'Articles finished');
      setText('#statReadNote', readingTime(Number(s.totalReadingTime)));
      cards.push('#cardRead');
    }
    if (valid(week) && (week > 0 || state.installDate)) {
      setText('#statWeek', nf.format(week));
      if (state.installDate) {
        setText('#statWeekNote', 'using ReadLater since ' + new Date(state.installDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }));
      }
      cards.push('#cardWeek');
    }
    if (cards.length >= 2 && cards.includes('#cardSaved')) {
      cards.forEach(sel => { $(sel).hidden = false; });
      $('#stats').hidden = false;
      if (changesAutoOpened) { $('#changes').open = false; changesAutoOpened = false; }
    } else if (!$('#changes').open) {
      // No library numbers to show yet, so the release notes are the main content.
      $('#changes').open = true;
      changesAutoOpened = true;
    }
  }

  async function renderShortcuts() {
    if (!hasChrome || !chrome.commands || !chrome.commands.getAll) return;
    try {
      const cmds = await chrome.commands.getAll();
      cmds.forEach(c => {
        $$('[data-cmd="' + c.name + '"]').forEach(el => {
          el.textContent = c.shortcut || 'Not set';
        });
      });
    } catch { /* keep manifest defaults in the markup */ }
  }

  function applyKind(kind) {
    document.documentElement.dataset.member = kind;
    $$('[data-for]').forEach(el => {
      el.hidden = !el.dataset.for.split(/\s+/).includes(kind);
    });
  }

  /* ---------------- links and actions ---------------- */

  function decorateLinks() {
    $$('a[data-cta]').forEach(a => {
      try {
        const u = new URL(a.getAttribute('href'));
        u.searchParams.set('utm_source', 'readlater-pro');
        u.searchParams.set('utm_medium', 'extension');
        u.searchParams.set('utm_campaign', CAMPAIGN);
        u.searchParams.set('utm_content', a.dataset.cta);
        if (!u.searchParams.has('ref')) u.searchParams.set('ref', 'readlater-pro');
        a.href = u.toString();
      } catch { /* leave the authored href */ }
      a.addEventListener('click', () => {
        if (!hasChrome || !/^plan-/.test(a.dataset.cta)) return;
        chrome.storage.local.set({ upgradeIntentAt: Date.now(), upgradeSource: CAMPAIGN + ':' + a.dataset.cta }).catch(() => {});
      });
    });
  }

  function markNewTabLinks() {
    $$('a[target="_blank"]').forEach(a => {
      const hint = document.createElement('span');
      hint.className = 'sr-only';
      hint.textContent = ' (opens in a new tab)';
      a.append(hint);
    });
  }

  function openTarget(target) {
    if (!hasChrome) {
      toast('In the extension this opens ' + ({ panel: 'the side panel', options: 'Settings', license: 'the license page', shortcuts: 'chrome://extensions/shortcuts', import: 'the import page' }[target] || target) + '.');
      return;
    }
    if (target === 'panel') {
      if (chrome.sidePanel && windowId !== null) {
        chrome.sidePanel.open({ windowId }).catch(() => toast('Click the ReadLater icon in the toolbar, then Reading List.'));
      } else toast('Click the ReadLater icon in the toolbar, then Reading List.');
    } else if (target === 'options') {
      chrome.runtime.openOptionsPage();
    } else if (target === 'license') {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/upgrade.html') });
    } else if (target === 'shortcuts') {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } else if (target === 'import') {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/import.html') });
    }
  }

  function bindActions() {
    $$('[data-open]').forEach(btn => btn.addEventListener('click', () => openTarget(btn.dataset.open)));

    const optout = $('#optout');
    if (optout) {
      if (hasChrome) {
        chrome.storage.sync.get('whatsNewOptOut').then(r => { optout.checked = r.whatsNewOptOut === true; }).catch(() => {});
      }
      optout.addEventListener('change', () => {
        const value = optout.checked;
        if (hasChrome) chrome.storage.sync.set({ whatsNewOptOut: value }).catch(() => {});
        toast(value ? 'Got it. Update pages stay closed from now on.' : 'Update pages are back on.');
      });
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => { t.textContent = ''; }, 250);
    }, 2600);
  }

  function renderPreviewBar(current) {
    const bar = $('#previewBar');
    if (!bar) return;
    bar.hidden = false;
    $$('a[data-preview]', bar).forEach(a => {
      if (a.dataset.preview === current) a.setAttribute('aria-current', 'true');
    });
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    renderVersion();
    decorateLinks();
    markNewTabLinks();
    bindActions();
    renderShortcuts();
    if (hasChrome && chrome.windows) chrome.windows.getCurrent().then(w => { windowId = w.id; }).catch(() => {});
    const state = await readState();
    applyKind(state.kind);
    renderHero(state);
    renderStats(state);
    if (state.kind === 'free' && state.intent) $('#paidNote').hidden = false;
    if (state.preview) renderPreviewBar(state.preview);
    if (hasChrome) chrome.storage.local.set({ whatsNewSeen: RELEASE, whatsNewSeenAt: Date.now() }).catch(() => {});

    // The update tab opens in the background; refresh the numbers the first
    // time someone actually looks at it.
    if (hasChrome && document.visibilityState !== 'visible') {
      document.addEventListener('visibilitychange', async function onShow() {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', onShow);
        const fresh = await readState();
        renderHero(fresh);
        renderStats(fresh);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
