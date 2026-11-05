/* ============================================================
   ReadLater Pro - what's new dialog
   ------------------------------------------------------------
   Shown once after an update, driven by pendingUpdateNotification
   and src/shared/release-notes.json. Every string goes through
   i18n, every chrome callback reads lastError, and the dialog is
   a real modal with a focus trap and an Escape key.
   ============================================================ */
(function () {
  'use strict';

  var MAX_HIGHLIGHTS = 12;
  var STORAGE_PENDING = 'pendingUpdateNotification';
  var STORAGE_SEEN = 'lastSeenVersion';

  var overlay = null;
  var lastFocus = null;

  function t(key, fallback) {
    if (typeof I18n === 'undefined' || !I18n.get) { return fallback; }
    var msg = I18n.get(key);
    return (msg && msg !== key) ? msg : fallback;
  }

  function warn(where, err) {
    var text = (err && err.message) ? err.message : String(err);
    if (typeof console !== 'undefined') { console.warn('[whats-new] ' + where + ': ' + text); }
  }

  function storageGet(key) {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) { resolve(null); return; }
      try {
        chrome.storage.local.get(key, function (res) {
          if (chrome.runtime.lastError) { warn('storage.get', chrome.runtime.lastError); resolve(null); return; }
          resolve(res ? res[key] : null);
        });
      } catch (e) { warn('storage.get', e); resolve(null); }
    });
  }

  function loadNotes() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) { return Promise.resolve(null); }
    var url = chrome.runtime.getURL('src/shared/release-notes.json');
    return fetch(url)
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function (e) { warn('release-notes', e); return null; });
  }

  function findVersion(notes, version) {
    if (!notes || !Array.isArray(notes.versions)) { return null; }
    for (var i = 0; i < notes.versions.length; i++) {
      if (notes.versions[i] && notes.versions[i].version === version) { return notes.versions[i]; }
    }
    return null;
  }

  function dismiss(version) {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) { resolve(); return; }
      try {
        chrome.storage.local.remove(STORAGE_PENDING, function () {
          void chrome.runtime.lastError;
          var patch = {};
          patch[STORAGE_SEEN] = version;
          chrome.storage.local.set(patch, function () { void chrome.runtime.lastError; resolve(); });
        });
      } catch (e) { warn('dismiss', e); resolve(); }
    });
  }

  function typeLabel(type) {
    var key = 'whatsNewType' + String(type || '').charAt(0).toUpperCase() + String(type || '').slice(1);
    return t(key, String(type || ''));
  }

  function buildItem(highlight) {
    var item = document.createElement('div');
    item.className = 'whats-new-item';
    var tag = document.createElement('span');
    tag.className = 'whats-new-item-type ' + (highlight.type || '');
    tag.textContent = typeLabel(highlight.type);
    var title = document.createElement('p');
    title.className = 'whats-new-item-title';
    title.textContent = highlight.title || '';
    var desc = document.createElement('p');
    desc.className = 'whats-new-item-desc';
    desc.textContent = highlight.description || '';
    item.appendChild(tag);
    item.appendChild(title);
    item.appendChild(desc);
    return item;
  }

  // A short personal note from the developer under the list (release-notes.json "note").
  function buildNote(note) {
    var box = document.createElement('div');
    box.className = 'whats-new-note';
    if (note.title) {
      var h = document.createElement('p');
      h.className = 'whats-new-note-title';
      h.textContent = note.title;
      box.appendChild(h);
    }
    String(note.body).split(/\n\n+/).forEach(function (para) {
      var p = document.createElement('p');
      p.className = 'whats-new-note-body';
      p.textContent = para;
      box.appendChild(p);
    });
    if (note.signature) {
      var sig = document.createElement('p');
      sig.className = 'whats-new-note-sig';
      sig.textContent = note.signature;
      box.appendChild(sig);
    }
    return box;
  }

  function buildHeader(version, titleId) {
    var head = document.createElement('div');
    head.className = 'whats-new-header';
    var heading = document.createElement('h2');
    heading.id = titleId;
    heading.textContent = t('whatsNewTitle', "What's new");
    var tag = document.createElement('span');
    tag.className = 'whats-new-version';
    tag.textContent = 'v' + version;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'whats-new-close';
    close.id = 'whats-new-close';
    close.setAttribute('aria-label', t('whatsNewClose', 'Close'));
    close.textContent = '×';
    head.appendChild(heading);
    head.appendChild(tag);
    head.appendChild(close);
    return head;
  }

  function build(notes) {
    var titleId = 'whats-new-title';
    var wrap = document.createElement('div');
    wrap.id = 'whats-new-overlay';
    wrap.className = 'whats-new-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', titleId);
    var modal = document.createElement('div');
    modal.className = 'whats-new-modal';
    modal.appendChild(buildHeader(notes.version, titleId));
    var body = document.createElement('div');
    body.className = 'whats-new-body';
    var count = Math.min(notes.highlights.length, MAX_HIGHLIGHTS);
    for (var i = 0; i < count; i++) { body.appendChild(buildItem(notes.highlights[i])); }
    if (notes.note && notes.note.body) { body.appendChild(buildNote(notes.note)); }
    modal.appendChild(body);
    var foot = document.createElement('div');
    foot.className = 'whats-new-footer';
    if (notes.page) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'whats-new-more';
      more.id = 'whats-new-more';
      more.textContent = t('whatsNewSeeAll', 'See the full page');
      foot.appendChild(more);
    }
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'whats-new-dismiss';
    ok.id = 'whats-new-dismiss';
    ok.textContent = t('whatsNewGotIt', 'Got it');
    foot.appendChild(ok);
    modal.appendChild(foot);
    wrap.appendChild(modal);
    return wrap;
  }

  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'));
  }

  function trap(e, root) {
    if (e.key !== 'Tab') { return; }
    var items = focusables(root);
    if (!items.length) { return; }
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function show(notes) {
    lastFocus = document.activeElement;
    overlay = build(notes);
    document.body.appendChild(overlay);

    function close() {
      dismiss(notes.version);
      if (overlay && overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
      overlay = null;
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { warn('refocus', e); } }
    }

    overlay.querySelector('#whats-new-close').addEventListener('click', close);
    overlay.querySelector('#whats-new-dismiss').addEventListener('click', close);
    var more = overlay.querySelector('#whats-new-more');
    if (more) {
      more.addEventListener('click', function () {
        try { chrome.tabs.create({ url: chrome.runtime.getURL(notes.page) }); } catch (e) { warn('open page', e); }
        close();
      });
    }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) { close(); } });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      trap(e, overlay);
    });
    overlay.querySelector('#whats-new-dismiss').focus();
  }

  function check() {
    return storageGet(STORAGE_PENDING).then(function (pending) {
      if (!pending || !pending.newVersion) { return false; }
      return loadNotes().then(function (notes) {
        var found = findVersion(notes, pending.newVersion);
        if (!found || !Array.isArray(found.highlights) || !found.highlights.length) {
          return dismiss(pending.newVersion).then(function () { return false; });
        }
        show(found);
        return true;
      });
    }).catch(function (e) { warn('check', e); return false; });
  }

  var api = { check: check };
  if (typeof self !== 'undefined') { self.WhatsNew = api; }
  if (typeof window !== 'undefined') { window.WhatsNew = api; }
})();
