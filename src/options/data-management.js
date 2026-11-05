/* ============================================================
   ReadLater Pro - your data, export and delete
   ============================================================
   Both halves of this file were wrong in a way that loses data.

   Export read chrome.storage.local and nothing else. Articles
   live in IndexedDB, so the file labelled "Export All Data"
   contained settings and no articles at all. It now pulls the
   articles, the tags and the settings through the background
   worker as well, and writes the article count into the file so
   the user can check it before trusting it.

   Delete cleared chrome.storage.local and chrome.storage.sync
   and never touched IndexedDB, so "Yes, delete everything" left
   every saved article on disk while telling the user their data
   was gone. It now sends CLEAR_ALL_DATA first, which drops the
   article database, and only reports success if that half
   actually succeeded.
   ============================================================ */
(function () {
  'use strict';

  var MAX_ARTICLES = 100000;

  function t(key, fallback) {
    if (typeof I18n === 'undefined' || !I18n.get) { return fallback; }
    var msg = I18n.get(key);
    return (msg && msg !== key) ? msg : fallback;
  }

  function tf(key, args, fallback) {
    if (typeof I18n === 'undefined' || !I18n.get) { return fallback; }
    var msg = I18n.get(key, args);
    return (msg && msg !== key) ? msg : fallback;
  }

  function warn(where, err) {
    var text = (err && err.message) ? err.message : String(err);
    if (typeof console !== 'undefined') { console.warn('[data-management] ' + where + ': ' + text); }
  }

  /* ================ reads ================ */

  function storageBytes() {
    return new Promise(function (resolve) {
      chrome.storage.local.getBytesInUse(null, function (bytes) {
        if (chrome.runtime.lastError) { warn('getBytesInUse', chrome.runtime.lastError); resolve(0); return; }
        resolve(bytes || 0);
      });
    });
  }

  function localStore() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(null, function (all) {
        if (chrome.runtime.lastError) { warn('storage.local.get', chrome.runtime.lastError); resolve({}); return; }
        resolve(all || {});
      });
    });
  }

  function syncStore() {
    return new Promise(function (resolve) {
      if (!chrome.storage.sync) { resolve({}); return; }
      chrome.storage.sync.get(null, function (all) {
        if (chrome.runtime.lastError) { warn('storage.sync.get', chrome.runtime.lastError); resolve({}); return; }
        resolve(all || {});
      });
    });
  }

  function send(action, payload) {
    return new Promise(function (resolve) {
      if (typeof MessageHelper === 'undefined') { resolve(null); return; }
      MessageHelper.send(action, payload)
        .then(function (res) { resolve(res && res.success ? res.data : null); })
        .catch(function (e) { warn(action, e); resolve(null); });
    });
  }

  function articleList() {
    return send('GET_ARTICLES', { limit: MAX_ARTICLES }).then(function (data) {
      if (!data) { return null; }
      if (Array.isArray(data)) { return data; }
      if (Array.isArray(data.articles)) { return data.articles; }
      return null;
    });
  }

  function formatBytes(bytes) {
    if (!bytes) { return '0 B'; }
    var units = ['B', 'KB', 'MB', 'GB'];
    var index = Math.floor(Math.log(bytes) / Math.log(1024));
    if (index >= units.length) { index = units.length - 1; }
    return parseFloat((bytes / Math.pow(1024, index)).toFixed(2)) + ' ' + units[index];
  }

  /* ================ export ================ */

  // B21: the license key (plain in licenseDataPlain) must never end up in a file.
  var SECRET_KEYS = /^(licenseDataPlain|licenseData|licenseKey|license_key)$/i;

  function stripSecrets(value) {
    if (Array.isArray(value)) { return value.map(stripSecrets); }
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (key) {
        if (!SECRET_KEYS.test(key)) { out[key] = stripSecrets(value[key]); }
      });
      return out;
    }
    return value;
  }

  function exportAllData() {
    return Promise.all([localStore(), syncStore(), articleList(), send('GET_TAGS'), send('GET_SETTINGS')])
      .then(function (parts) {
        var articles = parts[2];
        var manifest = chrome.runtime.getManifest();
        var payload = {
          extensionName: manifest.name,
          extensionVersion: manifest.version,
          exportDate: new Date().toISOString(),
          articleCount: articles ? articles.length : 0,
          articlesIncluded: articles !== null,
          articles: articles || [],
          tags: parts[3] || [],
          settings: parts[4] || {},
          storageLocal: parts[0],
          storageSync: parts[1]
        };
        payload = stripSecrets(payload);
        var text = JSON.stringify(payload, null, 2);
        var blob = new Blob([text], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'readlater-pro-full-data-export-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        return payload;
      });
  }

  /* ================ delete ================ */

  function clearArea(area) {
    return new Promise(function (resolve) {
      if (!area) { resolve(true); return; }
      area.clear(function () {
        if (chrome.runtime.lastError) { warn('storage.clear', chrome.runtime.lastError); resolve(false); return; }
        resolve(true);
      });
    });
  }

  function deleteAllData() {
    var databaseCleared = false;
    return new Promise(function (resolve) {
      if (typeof MessageHelper === 'undefined') { resolve(false); return; }
      MessageHelper.send('CLEAR_ALL_DATA')
        .then(function (res) { resolve(!!(res && res.success)); })
        .catch(function (e) { warn('CLEAR_ALL_DATA', e); resolve(false); });
    }).then(function (ok) {
      databaseCleared = ok;
      return Promise.all([clearArea(chrome.storage.local), clearArea(chrome.storage.sync)]);
    }).then(function (results) {
      return {
        databaseCleared: databaseCleared,
        localCleared: results[0],
        syncCleared: results[1],
        complete: databaseCleared && results[0] && results[1]
      };
    });
  }

  /* ================ icons ================ */

  function svgEl(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
  }

  function strokeSvg(size) {
    var svg = svgEl('svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    return svg;
  }

  function shape(svg, name, attrs) {
    var node = svgEl(name);
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) { node.setAttribute(key, attrs[key]); }
    }
    svg.appendChild(node);
    return svg;
  }

  function downloadIcon() {
    var svg = strokeSvg(16);
    shape(svg, 'path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' });
    shape(svg, 'polyline', { points: '7 10 12 15 17 10' });
    shape(svg, 'line', { x1: '12', y1: '15', x2: '12', y2: '3' });
    return svg;
  }

  function trashIcon() {
    var svg = strokeSvg(16);
    shape(svg, 'polyline', { points: '3 6 5 6 21 6' });
    shape(svg, 'path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' });
    return svg;
  }

  function checkIcon() {
    var svg = strokeSvg(16);
    shape(svg, 'polyline', { points: '20 6 9 17 4 12' });
    return svg;
  }

  /* ================ render helpers ================ */

  function statTile(value, labelKey, labelText, valueId) {
    var tile = document.createElement('div');
    tile.className = 'dm-stat';
    var number = document.createElement('span');
    number.className = 'dm-stat__value';
    number.id = valueId;
    number.textContent = value;
    tile.appendChild(number);
    var label = document.createElement('span');
    label.className = 'dm-stat__label';
    label.setAttribute('data-i18n', labelKey);
    label.textContent = labelText;
    tile.appendChild(label);
    return tile;
  }

  function actionButton(id, className, icon, labelKey, labelText) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'dm-btn ' + className;
    button.id = id;
    button.appendChild(icon);
    var label = document.createElement('span');
    label.setAttribute('data-i18n', labelKey);
    label.textContent = labelText;
    button.appendChild(label);
    return button;
  }

  function buildConfirm() {
    var wrap = document.createElement('div');
    wrap.className = 'dm-confirm';
    wrap.id = 'dm-confirm';
    wrap.style.display = 'none';

    var card = document.createElement('div');
    card.className = 'dm-confirm__card';
    card.setAttribute('role', 'group');

    var title = document.createElement('p');
    title.className = 'dm-confirm__title';
    title.setAttribute('data-i18n', 'dmConfirmTitle');
    title.textContent = 'Delete everything on this device';
    card.appendChild(title);

    var text = document.createElement('p');
    text.className = 'dm-confirm__text';
    text.setAttribute('data-i18n', 'dmConfirmText');
    text.textContent = 'This removes every saved article and its offline copy, every tag, and every setting. It cannot be undone, and there is no copy anywhere else. Export first if you want one.';
    card.appendChild(text);

    var actions = document.createElement('div');
    actions.className = 'dm-confirm__actions';
    var confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'dm-btn dm-btn--danger';
    confirm.id = 'dm-confirm-delete';
    confirm.setAttribute('data-i18n', 'dmConfirmDelete');
    confirm.textContent = 'Delete everything';
    actions.appendChild(confirm);
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dm-btn dm-btn--cancel';
    cancel.id = 'dm-confirm-cancel';
    cancel.setAttribute('data-i18n', 'dmConfirmCancel');
    cancel.textContent = 'Keep my data';
    actions.appendChild(cancel);
    card.appendChild(actions);

    wrap.appendChild(card);
    return wrap;
  }

  /* ================ render ================ */

  function render(selector) {
    var host = document.querySelector(selector);
    if (!host) { return Promise.resolve(); }

    return Promise.all([storageBytes(), articleList()]).then(function (parts) {
      var bytes = parts[0];
      var articles = parts[1];
      host.textContent = '';

      var section = document.createElement('div');
      section.className = 'dm-section';

      var title = document.createElement('h2');
      title.className = 'dm-title';
      title.setAttribute('data-i18n', 'headingYourData');
      title.textContent = 'Your data';
      section.appendChild(title);

      var subtitle = document.createElement('p');
      subtitle.className = 'dm-subtitle';
      subtitle.setAttribute('data-i18n', 'dmSubtitle');
      subtitle.textContent = 'Take a copy of everything ReadLater Pro holds, or remove all of it';
      section.appendChild(subtitle);

      var stats = document.createElement('div');
      stats.className = 'dm-stats';
      stats.appendChild(statTile(formatBytes(bytes), 'dmStorageUsed', 'Settings storage', 'dm-usage'));
      stats.appendChild(statTile(
        articles === null ? '?' : String(articles.length),
        'dmArticleCount', 'Saved articles', 'dm-articles'
      ));
      section.appendChild(stats);

      var actions = document.createElement('div');
      actions.className = 'dm-actions';
      var exportBtn = actionButton('dm-export', 'dm-btn--export', downloadIcon(), 'dmExportAllData', 'Export all data');
      actions.appendChild(exportBtn);
      var deleteBtn = actionButton('dm-delete', 'dm-btn--delete', trashIcon(), 'dmDeleteAllData', 'Delete all data');
      actions.appendChild(deleteBtn);
      section.appendChild(actions);

      var confirm = buildConfirm();
      section.appendChild(confirm);

      var note = document.createElement('p');
      note.className = 'dm-note';
      note.id = 'dm-note';
      note.setAttribute('role', 'status');
      note.setAttribute('data-i18n', 'dmNote');
      note.textContent = 'The export is a single JSON file in your downloads folder, holding your articles with their offline text, your settings and raw storage. To bring back tags and highlights, use Full backup above.';
      section.appendChild(note);

      host.appendChild(section);
      if (typeof I18n !== 'undefined' && I18n.translateDOM) { I18n.translateDOM(host); }

      wireActions(selector, host, exportBtn, deleteBtn, confirm);
    });
  }

  function wireActions(selector, host, exportBtn, deleteBtn, confirm) {
    var originalChildren = [];
    for (var i = 0; i < exportBtn.childNodes.length; i++) {
      originalChildren.push(exportBtn.childNodes[i].cloneNode(true));
    }

    exportBtn.addEventListener('click', function () {
      exportBtn.disabled = true;
      exportAllData().then(function (payload) {
        while (exportBtn.firstChild) { exportBtn.removeChild(exportBtn.firstChild); }
        exportBtn.appendChild(checkIcon());
        var count = payload.articlesIncluded ? String(payload.articleCount) : '0';
        exportBtn.appendChild(document.createTextNode(' ' + tf('dmExported', [count], 'Saved, ' + count + ' articles')));
        setTimeout(function () {
          while (exportBtn.firstChild) { exportBtn.removeChild(exportBtn.firstChild); }
          for (var j = 0; j < originalChildren.length; j++) { exportBtn.appendChild(originalChildren[j].cloneNode(true)); }
          exportBtn.disabled = false;
        }, 2500);
      }).catch(function (e) {
        warn('export', e);
        exportBtn.disabled = false;
        setNote(host, t('dmExportFailed', 'The export did not finish. Nothing was changed.'), false);
      });
    });

    deleteBtn.addEventListener('click', function () {
      confirm.style.display = 'block';
      var yes = document.getElementById('dm-confirm-delete');
      if (yes) { yes.focus(); }
    });

    var yesBtn = confirm.querySelector('#dm-confirm-delete');
    var noBtn = confirm.querySelector('#dm-confirm-cancel');

    if (yesBtn) {
      yesBtn.addEventListener('click', function () {
        yesBtn.disabled = true;
        deleteAllData().then(function (result) {
          confirm.style.display = 'none';
          render(selector).then(function () {
            if (result.complete) {
              setNote(host, t('dmDataDeleted', 'Everything is gone. The extension is back to how it started.'), true);
              return;
            }
            setNote(host, t('dmDeletePartial', 'Some of it could not be removed. Your articles may still be on this device. Try again, and use Clear All Data in the Danger Zone if it keeps failing.'), false);
          });
        });
      });
    }

    if (noBtn) {
      noBtn.addEventListener('click', function () {
        confirm.style.display = 'none';
        if (deleteBtn) { deleteBtn.focus(); }
      });
    }
  }

  function setNote(host, text, good) {
    var note = host.querySelector('.dm-note');
    if (!note) { return; }
    note.textContent = text;
    note.classList.remove('dm-note--good', 'dm-note--bad');
    note.classList.add(good ? 'dm-note--good' : 'dm-note--bad');
  }

  self.DataManagement = { render: render, exportAllData: exportAllData, deleteAllData: deleteAllData };
})();
