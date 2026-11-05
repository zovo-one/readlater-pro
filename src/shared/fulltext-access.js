/* ReadLater Pro - optional "read pages" access (1.3.0).
 *
 * The manifest lists https://*\/* and http://*\/* as optional host permissions.
 * Nothing is requested at install or update. The user grants it with one click
 * (fetch-text page, side panel save message), which lets ReadLater:
 *   - download a saved link's page and keep its readable text (fetch-text.js)
 *   - read the page in any tab when saving from the side panel (sidebar-save.js)
 *
 * request() MUST be called synchronously from a user click handler, before any
 * await or promise callback, or Chrome rejects it for lack of a user gesture.
 *
 * Exposes window.FulltextAccess = { ORIGINS, has, request, onChange, openPage,
 * countLinkOnly, isLinkOnly }. Elements with [data-rl-fetch-open] open the
 * fetch-text page on click, and [data-rl-fetch-count] hide themselves while
 * every saved article already has its text (used by Settings).
 */
(function () {
  'use strict';

  var ORIGINS = ['https://*/*', 'http://*/*'];
  var PAGE = 'src/pages/fetch-text.html';

  function api() {
    return typeof chrome !== 'undefined' && chrome.permissions ? chrome.permissions : null;
  }

  function has() {
    var p = api();
    if (!p) return Promise.resolve(false);
    return new Promise(function (resolve) {
      try {
        p.contains({ origins: ORIGINS }, function (ok) {
          void chrome.runtime.lastError;
          resolve(!!ok);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  /* Call this first thing in a click handler. Resolves true when granted. */
  function request() {
    var p = api();
    if (!p) return Promise.resolve(false);
    try {
      return p.request({ origins: ORIGINS }).then(function (ok) { return !!ok; }, function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /* cb(granted) whenever the permission is added or removed, from any page or
     from chrome://extensions. Returns an unsubscribe function. */
  function onChange(cb) {
    var p = api();
    if (!p || !p.onAdded) return function () {};
    var fire = function () { has().then(cb); };
    p.onAdded.addListener(fire);
    p.onRemoved.addListener(fire);
    return function () {
      p.onAdded.removeListener(fire);
      p.onRemoved.removeListener(fire);
    };
  }

  /* Opens the fetch-text page, or focuses it when it's already open so two
     tabs never download the same list. */
  function openPage(params) {
    var base = chrome.runtime.getURL(PAGE);
    var url = base + (params ? '?' + params : '');
    try {
      chrome.tabs.query({ url: base + '*' }, function (tabs) {
        void chrome.runtime.lastError;
        var t = tabs && tabs[0];
        if (t) {
          chrome.tabs.update(t.id, { active: true }, function () { void chrome.runtime.lastError; });
          if (chrome.windows && t.windowId != null) {
            chrome.windows.update(t.windowId, { focused: true }, function () { void chrome.runtime.lastError; });
          }
        } else {
          chrome.tabs.create({ url: url }, function () { void chrome.runtime.lastError; });
        }
      });
    } catch (e) {
      window.open(url, '_blank');
    }
  }

  /* An article has no saved body when it isn't offline and has no words.
     Imports (IMPORT_POCKET) and link-only saves store isOffline:false and
     wordCount:0; a plain-text-only save has words, so it isn't counted. */
  function isLinkOnly(a) {
    return !!a && a.isOffline !== true && !(a.wordCount > 0) && /^https?:\/\//i.test(a.url || '');
  }

  var LIST_FIELDS = ['id', 'url', 'title', 'isOffline', 'wordCount'];

  /* Resolves the link-only articles ([{id,url,title}]), oldest first. */
  function listLinkOnly() {
    if (typeof MessageHelper === 'undefined') return Promise.resolve([]);
    return MessageHelper.send('GET_ARTICLES', {
      offset: 0, limit: 100000, sortBy: 'savedAt', sortOrder: 'asc', fields: LIST_FIELDS
    }, 60000).then(function (res) {
      var arr = res && res.success && Array.isArray(res.data) ? res.data : [];
      return arr.filter(isLinkOnly);
    }, function () { return []; });
  }

  function countLinkOnly() {
    return listLinkOnly().then(function (a) { return a.length; });
  }

  function wire() {
    var openers = document.querySelectorAll('[data-rl-fetch-open]');
    Array.prototype.forEach.call(openers, function (b) {
      b.addEventListener('click', function () { openPage(b.getAttribute('data-rl-fetch-open') || ''); });
    });
    var counted = document.querySelectorAll('[data-rl-fetch-count]');
    if (counted.length) {
      countLinkOnly().then(function (n) {
        Array.prototype.forEach.call(counted, function (el) { el.hidden = n === 0; });
      });
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
  }

  window.FulltextAccess = {
    ORIGINS: ORIGINS,
    has: has,
    request: request,
    onChange: onChange,
    openPage: openPage,
    isLinkOnly: isLinkOnly,
    listLinkOnly: listLinkOnly,
    countLinkOnly: countLinkOnly
  };
})();
