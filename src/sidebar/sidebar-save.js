/* ReadLater Pro - "Save this page" and "Save all tabs" from the side panel (1.3.0).
 *
 * The panel is an extension page, so it can only read a tab's body when the
 * extension holds activeTab for that tab (granted when the user clicks the
 * toolbar icon, uses the save shortcut or the context menu on that page) or a
 * host permission. A click inside the panel is not one of those gestures, so
 * injection is attempted first and, when Chrome refuses it, the link and title
 * are saved instead and the caller is told so. If the same page was saved
 * earlier as a link and the body can be read now, the stored record is filled
 * in rather than reported as a duplicate.
 *
 * 1.3.0: with the optional "read pages" host permission (FulltextAccess in
 * src/shared/fulltext-access.js) every http(s) tab can be read, so "Save all
 * tabs" reads each one in turn. Without it, linkHelp() gives the caller a
 * one-click "Allow reading pages" action whose click requests the permission.
 * This file also runs the panel's link-only banner (#rl-fetch-banner) and
 * menu item (#rl-fetch-menu), which open the fetch-text page.
 *
 * Exposes window.SidebarSave = { saveCurrentTab, saveAllTabs, deleteSaved,
 * resolveTab, linkHelp, tabsLinkHelp, progressText }.
 */
(function () {
  'use strict';

  var INJECT_FILES = [
    'src/utils/sanitize.js',
    'src/utils/message-validator.js',
    'src/content/readability.js',
    'src/content/content.js'
  ];
  var MAX_TABS = 200;
  var BANNER_DISMISS_KEY = 'rlFetchBannerDismissed';
  var BANNER_RESHOW_AFTER = 10;

  function t(key, fallback, subs) {
    var msg = '';
    try { msg = chrome.i18n.getMessage(key, subs || undefined); } catch (e) { msg = ''; }
    if (msg) return msg;
    var out = fallback;
    (subs || []).forEach(function (s, i) { out = out.split('$' + (i + 1)).join(s); });
    return out;
  }

  function num(n) {
    try { return Number(n || 0).toLocaleString(); } catch (e) { return String(n || 0); }
  }

  function access() {
    return typeof FulltextAccess !== 'undefined' ? FulltextAccess.has() : Promise.resolve(false);
  }

  function lastError() {
    return chrome.runtime && chrome.runtime.lastError;
  }

  function isWebUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
  }

  function send(action, payload, timeout) {
    if (typeof MessageHelper === 'undefined') {
      return Promise.resolve({ success: false, error: 'MessageHelper missing' });
    }
    return MessageHelper.send(action, payload, timeout).catch(function (e) {
      return { success: false, error: String(e && e.message || e) };
    });
  }

  /* The active tab of the panel's own window. When the panel page is open in
     a normal tab (popup fallback), that tab is our own page, so fall back to
     the most recently used web tab, the same rule the popup follows. */
  function resolveTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        lastError();
        var t = tabs && tabs[0];
        if (t && isWebUrl(t.url)) { resolve(t); return; }
        var self = t && t.url && t.url.indexOf(chrome.runtime.getURL('')) === 0;
        if (t && !self) { resolve(t); return; }
        chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, function (all) {
          if (lastError()) { resolve(t || null); return; }
          var best = null;
          (all || []).slice(0, MAX_TABS).forEach(function (x) {
            if (!x || !isWebUrl(x.url)) return;
            if (!best || (x.lastAccessed || 0) > (best.lastAccessed || 0)) best = x;
          });
          resolve(best || t || null);
        });
      });
    });
  }

  function linkOnly(tab) {
    return {
      url: tab.url,
      title: tab.title || '',
      content: '',
      textContent: '',
      excerpt: '',
      byline: '',
      leadImageUrl: '',
      wordCount: 0,
      estimatedReadTime: 0
    };
  }

  /* Resolves the extracted article data, or null when the page can't be read. */
  function extract(tab) {
    return new Promise(function (resolve) {
      try {
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, files: INJECT_FILES, world: 'ISOLATED' },
          function () {
            if (lastError()) { resolve(null); return; }
            var done = false;
            var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 15000);
            chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_ARTICLE' }, function (res) {
              var err = lastError();
              if (done) return;
              done = true;
              clearTimeout(timer);
              if (err || !res || !res.success || !res.data) { resolve(null); return; }
              resolve(res.data);
            });
          }
        );
      } catch (e) {
        resolve(null);
      }
    });
  }

  function hasBody(a) {
    return !!(a && (a.content || '').length);
  }

  /* status: "saved" (full text), "link" (saved as link only), "filled" (an
     existing link-only save got its full text), "duplicate" (already saved
     with its text), "text" (saved, but only plain text could be read),
     "duplicate-link" (already saved, still link-only and the
     body can't be read right now), "restricted" (browser page), "failed". */
  function saveTab(tab, tryExtract) {
    if (!tab || !isWebUrl(tab.url)) {
      return Promise.resolve({ status: 'restricted', tab: tab || null });
    }
    return send('CHECK_URL_SAVED', { url: tab.url }).then(function (chk) {
      var existing = chk && chk.success && chk.data && chk.data.saved ? chk.data.article : null;
      if (existing && hasBody(existing)) {
        return { status: 'duplicate', article: existing, tab: tab };
      }
      var body = tryExtract ? extract(tab) : Promise.resolve(null);
      return body.then(function (data) {
        var full = data && hasBody(data) ? data : null;
        if (existing) {
          if (!full) return { status: 'duplicate-link', article: existing, tab: tab };
          var updates = {
            content: full.content,
            textContent: full.textContent || '',
            excerpt: full.excerpt || existing.excerpt || '',
            byline: full.byline || existing.byline || '',
            leadImageUrl: full.leadImageUrl || existing.leadImageUrl || '',
            wordCount: full.wordCount || 0,
            estimatedReadTime: full.estimatedReadTime ||
              Math.max(1, Math.round((full.wordCount || 0) / 238)),
            isOffline: true
          };
          if (full.title && (!existing.title || existing.title === 'Untitled')) updates.title = full.title;
          return send('UPDATE_ARTICLE', { id: existing.id, updates: updates }).then(function (r) {
            if (!r || !r.success) return { status: 'duplicate-link', article: existing, tab: tab };
            return { status: 'filled', article: r.data || existing, tab: tab };
          });
        }
        var payload = full || (data ? data : linkOnly(tab));
        if (!payload.url) payload.url = tab.url;
        if (!payload.title) payload.title = tab.title || '';
        return send('SAVE_ARTICLE', payload, 30000).then(function (r) {
          if (!r || !r.success || !r.data) return { status: 'failed', tab: tab, error: r && r.error };
          if (r.data.duplicate) {
            return { status: hasBody(r.data.article) ? 'duplicate' : 'duplicate-link', article: r.data.article, tab: tab };
          }
          return { status: full ? 'saved' : (data ? 'text' : 'link'), article: r.data.article, tab: tab };
        });
      });
    }).catch(function (e) {
      return { status: 'failed', tab: tab, error: String(e && e.message || e) };
    });
  }

  function saveCurrentTab() {
    return Promise.all([resolveTab(), access()]).then(function (r) {
      return saveTab(r[0], true).then(function (res) {
        res.access = r[1];
        return res;
      });
    });
  }

  /* Every web tab in the panel's window, one at a time. Without the read
     pages permission only the active tab can possibly be read, so the rest go
     in as links without trying. onProgress(done, total, tab) is optional. */
  function saveAllTabs(onProgress) {
    return access().then(function (granted) { return saveAll(granted, onProgress); });
  }

  function saveAll(granted, onProgress) {
    return new Promise(function (resolve) {
      chrome.tabs.query({ currentWindow: true }, function (tabs) {
        lastError();
        var list = (tabs || []).filter(function (t) { return t && isWebUrl(t.url); }).slice(0, MAX_TABS);
        var seen = {};
        list = list.filter(function (t) {
          if (seen[t.url]) return false;
          seen[t.url] = true;
          return true;
        });
        var out = { total: list.length, saved: 0, full: 0, links: 0, duplicate: 0, failed: 0, savedIds: [], access: granted };
        var i = 0;
        (function next() {
          if (i >= list.length) { resolve(out); return; }
          var tab = list[i++];
          if (onProgress) { try { onProgress(i, list.length, tab); } catch (e) { /* ignore */ } }
          saveTab(tab, granted || !!tab.active).then(function (r) {
            if (r.status === 'duplicate-link') out.links++;
            if (r.status === 'saved' || r.status === 'link' || r.status === 'text') {
              out.saved++;
              if (r.status !== 'link') out.full++; else out.links++;
              if (r.article && r.article.id) out.savedIds.push(r.article.id);
            } else if (r.status === 'filled') {
              out.duplicate++;
              out.full++;
            } else if (r.status === 'duplicate' || r.status === 'duplicate-link') {
              out.duplicate++;
            } else {
              out.failed++;
            }
            next();
          });
        })();
      });
    });
  }

  /* Undo for a save made from the panel. Only ever removes ids this module
     just created. */
  function deleteSaved(ids) {
    return Promise.all((ids || []).map(function (id) {
      return send('DELETE_ARTICLE', { id: id });
    }));
  }

  /* ---------- Messages for link-only results ---------- */

  /* What to tell the user when a page went in as a link only. Without the
     permission, the action's run() must stay synchronous up to the request:
     it is called straight from the status button's click. */
  function allowAction(retry) {
    if (typeof FulltextAccess === 'undefined') return null;
    return {
      label: t('fetchAllowReading', 'Allow reading pages'),
      run: function () {
        FulltextAccess.request().then(function (ok) {
          if (ok && typeof retry === 'function') retry();
        });
      }
    };
  }

  function linkHelp(result, retry) {
    if (result && result.access) {
      return { note: t('fetchPanelUnreadable', 'This page couldn\'t be read, so its link was saved. Chrome doesn\'t let extensions read some pages, like PDFs and the Chrome Web Store.'), action: null };
    }
    var action = allowAction(retry);
    if (!action) return null;
    return { note: t('fetchPanelAllowNote', 'Allow ReadLater to read pages and it keeps the full text of anything you save here, ready offline.'), action: action };
  }

  function tabsLinkHelp(result, retry) {
    if (!result || !result.links) return null;
    if (result.access) {
      return { note: result.links === 1
        ? t('fetchTabsUnreadableOne', '1 tab couldn\'t be read, so its link was saved.')
        : t('fetchTabsUnreadable', '$1 tabs couldn\'t be read, so their links were saved.', [num(result.links)]), action: null };
    }
    var action = allowAction(retry);
    if (!action) return null;
    return { note: t('fetchTabsAllowNote', 'Tabs were saved as links. Allow ReadLater to read pages to keep their full text.'), action: action };
  }

  function progressText(done, total) {
    return t('fetchTabsProgress', 'Tab $1 of $2', [num(done), num(total)]);
  }

  /* ---------- Link-only banner and menu item ---------- */

  var banner = null;
  var bannerTimer = null;
  var bannerBusy = false;

  function openFetchPage() {
    if (typeof FulltextAccess !== 'undefined') FulltextAccess.openPage('from=panel');
  }

  function readLocal(keys) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(keys, function (r) { void chrome.runtime.lastError; resolve(r || {}); });
      } catch (e) { resolve({}); }
    });
  }

  function refreshBanner() {
    if (!banner || bannerBusy || typeof FulltextAccess === 'undefined') return;
    bannerBusy = true;
    Promise.all([FulltextAccess.countLinkOnly(), readLocal([BANNER_DISMISS_KEY, 'rlFetchState'])]).then(function (r) {
      bannerBusy = false;
      var n = r[0];
      var dismissed = r[1][BANNER_DISMISS_KEY];
      var job = r[1].rlFetchState;
      var inJob = job && (job.status === 'running' || job.status === 'paused') && n > 0;
      var menu = document.getElementById('rl-fetch-menu');
      if (menu) {
        menu.hidden = n === 0;
        var ml = document.getElementById('rl-fetch-menu-text');
        if (ml) ml.textContent = t('fetchMenuItem', 'Get full text for saved links ($1)', [num(n)]);
      }
      var hide = n === 0 || (!inJob && dismissed && n < (Number(dismissed.count) || 0) + BANNER_RESHOW_AFTER);
      banner.hidden = !!hide;
      if (hide) return;
      document.getElementById('rl-fetch-banner-text').textContent = inJob
        ? t('fetchBannerRunning', 'Getting full text, $1 left', [num(n)])
        : (n === 1 ? t('fetchBannerOne', '1 article has no saved text') : t('fetchBanner', '$1 articles have no saved text', [num(n)]));
      document.getElementById('rl-fetch-banner-go').textContent = inJob
        ? t('fetchBannerShow', 'Show progress')
        : t('fetchBannerAction', 'Get the full text');
      banner.dataset.count = String(n);
    }, function () { bannerBusy = false; });
  }

  function refreshSoon() {
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(refreshBanner, 1500);
  }

  function initBanner() {
    banner = document.getElementById('rl-fetch-banner');
    var menu = document.getElementById('rl-fetch-menu');
    if (menu) {
      menu.addEventListener('click', function () {
        var vm = document.getElementById('view-menu');
        if (vm && !vm.hidden) vm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        openFetchPage();
      });
    }
    if (!banner) return;
    document.getElementById('rl-fetch-banner-go').addEventListener('click', openFetchPage);
    document.getElementById('rl-fetch-banner-close').addEventListener('click', function () {
      var o = {};
      o[BANNER_DISMISS_KEY] = { count: Number(banner.dataset.count) || 0, at: Date.now() };
      try { chrome.storage.local.set(o); } catch (e) { /* ignore */ }
      banner.hidden = true;
    });
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && (changes.articlesUpdatedAt || changes.rlFetchState)) refreshSoon();
      });
    } catch (e) { /* no storage events */ }
    refreshBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBanner);
  else initBanner();

  window.SidebarSave = {
    saveCurrentTab: saveCurrentTab,
    saveAllTabs: saveAllTabs,
    deleteSaved: deleteSaved,
    resolveTab: resolveTab,
    linkHelp: linkHelp,
    tabsLinkHelp: tabsLinkHelp,
    progressText: progressText,
    refreshBanner: refreshSoon
  };

})();
