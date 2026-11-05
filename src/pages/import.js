/* ReadLater Pro - universal import page (1.3.0).
 *
 * Flow: pick a file -> ImportSources.fromFile() -> preview card -> import.
 * The import sends IMPORT_POCKET in chunks of 500 (so no single message can
 * time out, B13), then looks up the new article ids and fills in what
 * IMPORT_POCKET can't carry: favorites, excerpts, full text (Omnivore and
 * backups), tags on articles that were already saved, and highlights.
 * Parse problems are always shown (B14).
 */
(function () {
  'use strict';

  var CHUNK = 500;
  var CHUNK_TIMEOUT = 180000;
  var UPDATE_PARALLEL = 4;
  var FULL_TEXT_SOURCES = { omnivore: true, backup: true };
  var READER_KEYS = ['readerTheme', 'readerFontSize', 'readerWidth', 'readerFontFamily', 'readerLineHeight', 'ttsRate', 'ttsVoice', 'openArticlesIn'];

  var el = {};
  var plan = null;
  var running = false;
  var windowId = null;
  var existingIndex = null;

  /* ---------------- strings ---------------- */

  function t(key, fallback, subs) {
    var msg = '';
    try { msg = chrome.i18n.getMessage(key, subs || undefined); } catch (e) { msg = ''; }
    if (msg) return msg;
    var out = fallback;
    (subs || []).forEach(function (s, i) { out = out.split('$' + (i + 1)).join(s); });
    return out;
  }

  function num(n) {
    try { return Number(n).toLocaleString(); } catch (e) { return String(n); }
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  /** t() with a singular and a plural message; both take the count as $1. */
  function tn(n, keyOne, one, keyMany, many, subs) {
    var args = [num(n)].concat(subs || []);
    return n === 1 ? t(keyOne, one, args) : t(keyMany, many, args);
  }

  function sourceName(src) {
    switch (src) {
      case 'pocket': return t('dataImportSourcePocket', 'Pocket export');
      case 'pocketHtml': return t('dataImportSourcePocketHtml', 'Pocket export (HTML)');
      case 'bookmarks': return t('dataImportSourceBookmarks', 'Bookmarks file');
      case 'instapaper': return t('dataImportSourceInstapaper', 'Instapaper export');
      case 'omnivore': return t('dataImportSourceOmnivore', 'Omnivore export');
      case 'raindrop': return t('dataImportSourceRaindrop', 'Raindrop.io export');
      case 'txt': return t('dataImportSourceTxt', 'List of links');
      case 'backup': return t('dataImportSourceBackup', 'ReadLater backup');
      default: return t('dataImportSourceCsv', 'Spreadsheet (CSV) of links');
    }
  }

  function skippedLine(reason, n) {
    var c = num(n);
    switch (reason) {
      case 'private': return tn(n, 'dataImportSkipPrivateOne', '$1 Instapaper item was emailed or private (instapaper-private://), so it has no web address to save.',
        'dataImportSkipPrivate', '$1 Instapaper items were emailed or private (instapaper-private://), so they have no web address to save.');
      case 'invalidUrl': return tn(n, 'dataImportSkipInvalidOne', '$1 entry had no valid web address (http or https).',
        'dataImportSkipInvalid', '$1 entries had no valid web address (http or https).');
      case 'notUrl': return tn(n, 'dataImportSkipNotUrlOne', '$1 line didn\'t contain a web address.',
        'dataImportSkipNotUrl', '$1 lines didn\'t contain a web address.');
      case 'limit': return t('dataImportSkipLimit', '$1 items were over the 50,000 item limit for one import. Import the rest in a second file.', [c]);
      default: return c + ' ' + reason;
    }
  }

  function noTextNote(src) {
    var name = { pocket: 'Pocket', pocketHtml: 'Pocket', instapaper: 'Instapaper', raindrop: 'Raindrop.io' }[src];
    if (name) {
      return t('dataImportNoTextNamed', '$1 exports don\'t include the article text, only the links. Your links and tags come over now, plus read state where the file has it. To keep an article\'s full text for offline reading, open it and save it again from its page.', [name]);
    }
    return t('dataImportNoText', 'This file has links only, not the article text. To keep an article\'s full text for offline reading, open it and save it again from its page.');
  }

  /* ---------------- messaging ---------------- */

  function send(action, payload, timeout) {
    return MessageHelper.send(action, payload, timeout || 30000).then(function (res) {
      if (res && res.success) return res.data;
      var err = new Error((res && res.error) || 'Request failed');
      err.code = res && res.code;
      throw err;
    });
  }

  /** Map of normalised URL -> article id for everything already saved. */
  function urlIndex() {
    return send('GET_ARTICLES', { limit: 100000, fields: ['id', 'url'] }, 60000).then(function (list) {
      var arr = Array.isArray(list) ? list : (list && list.articles) || [];
      var map = {};
      arr.forEach(function (a) { if (a && a.url) map[ImportSources.normalizeUrl(a.url)] = a.id; });
      return { map: map, ids: arr.reduce(function (o, a) { o[a.id] = true; return o; }, {}) };
    });
  }

  /* ---------------- UI helpers ---------------- */

  function show(node, on) { if (node) node.hidden = !on; }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function para(parent, text, cls) {
    var p = document.createElement('p');
    p.className = cls || 'import-note';
    p.textContent = text;
    parent.appendChild(p);
    return p;
  }

  function announce(text) {
    var live = document.getElementById('sr-announcements');
    if (!live) return;
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 50);
  }

  function setProgress(pct, text) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    el.bar.style.width = pct + '%';
    el.bar.setAttribute('aria-valuenow', String(pct));
    if (text) {
      el.progressText.textContent = text;
      el.bar.setAttribute('aria-valuetext', pct + '%, ' + text);
    }
  }

  function errorList(parent, errors) {
    if (!errors || !errors.length) return;
    var d = document.createElement('details');
    d.className = 'import-errors';
    if (errors.length <= 3) d.open = true;
    var s = document.createElement('summary');
    s.textContent = t('dataImportProblems', 'Problems found while reading the file ($1)', [num(errors.length)]);
    d.appendChild(s);
    var ul = document.createElement('ul');
    errors.forEach(function (e) {
      var li = document.createElement('li');
      li.textContent = e;
      ul.appendChild(li);
    });
    d.appendChild(ul);
    parent.appendChild(d);
  }

  function resetToStart() {
    plan = null;
    running = false;
    el.fileInput.value = '';
    show(el.preview, false);
    show(el.reading, false);
    el.progress.classList.remove('active');
    el.result.className = 'import-card import-result';
    show(el.resultActions, false);
    show(el.dropzone, true);
    show(el.sources, true);
    el.dropzone.focus();
  }

  function showFailure(title, message, errors) {
    show(el.reading, false);
    show(el.preview, false);
    el.progress.classList.remove('active');
    show(el.dropzone, true);
    show(el.sources, true);
    el.result.className = 'import-card import-result error';
    el.resultTitle.textContent = title;
    clear(el.resultDetails);
    clear(el.resultNotes);
    if (message) {
      var li = document.createElement('li');
      li.textContent = message;
      el.resultDetails.appendChild(li);
    }
    errorList(el.resultNotes, errors);
    show(el.resultActions, false);
    announce(title + '. ' + (message || ''));
  }

  /* ---------------- file -> preview ---------------- */

  function handleFile(file) {
    if (!file || running) return;
    el.result.className = 'import-card import-result';
    show(el.preview, false);
    show(el.dropzone, false);
    show(el.reading, true);
    announce(t('dataImportReading', 'Reading your file...'));
    var indexP = urlIndex().catch(function () { return null; });
    ImportSources.fromFile(file).then(function (p) {
      return indexP.then(function (idx) {
        existingIndex = idx;
        renderPreview(p);
      });
    }).catch(function (err) {
      showFailure(t('dataImportReadFailed', 'This file couldn\'t be read'), err && err.message ? err.message : '', []);
    });
  }

  function renderPreview(p) {
    show(el.reading, false);
    if (!p.items.length && !(p.orphanHighlights && p.stats.highlights)) {
      var skippedText = Object.keys(p.skipped).map(function (k) { return skippedLine(k, p.skipped[k]); }).join(' ');
      showFailure(
        t('dataImportNothingFound', 'Nothing to import in this file'),
        skippedText || t('dataImportNothingFoundHint', 'We couldn\'t find any links in it. Check that it\'s an export from one of the apps listed above.'),
        p.errors
      );
      return;
    }
    plan = p;
    var s = p.stats;
    var already = 0;
    if (existingIndex) {
      p.items.forEach(function (it) { if (existingIndex.map[it.key]) already++; });
    }
    s.already = already;

    el.previewSource.textContent = t('dataImportDetected', 'Detected: $1', [sourceName(p.source)]) + (p.fileName ? ' (' + p.fileName + ')' : '');

    clear(el.previewStats);
    function stat(label, value) {
      var wrap = document.createElement('div');
      wrap.className = 'import-stat';
      var dd = document.createElement('dd');
      dd.className = 'import-stat-value';
      dd.textContent = value;
      var dt = document.createElement('dt');
      dt.className = 'import-stat-label';
      dt.textContent = label;
      wrap.appendChild(dt);
      wrap.appendChild(dd);
      el.previewStats.appendChild(wrap);
    }
    stat(t('dataImportStatItems', 'Articles'), num(s.total));
    stat(t('dataImportStatUnread', 'Unread'), num(s.unread));
    stat(t('dataImportStatRead', 'Read'), num(s.read));
    if (s.favorites) stat(t('dataImportStatFavorites', 'Favorites'), num(s.favorites));
    stat(t('dataImportStatTags', 'Tags'), num(s.tags));
    stat(t('dataImportStatHighlights', 'Highlights'), num(s.highlights));
    if (FULL_TEXT_SOURCES[p.source] || s.withText) stat(t('dataImportStatFullText', 'With full text'), num(s.withText));

    clear(el.previewTags);
    if (s.tagNames.length) {
      var label = document.createElement('span');
      label.className = 'import-tags-label';
      label.textContent = t('dataImportTagsLabel', 'Tags');
      el.previewTags.appendChild(label);
      s.tagNames.slice(0, 12).forEach(function (name) {
        var chip = document.createElement('span');
        chip.className = 'import-tag';
        chip.textContent = name;
        el.previewTags.appendChild(chip);
      });
      if (s.tagNames.length > 12) {
        var more = document.createElement('span');
        more.className = 'import-tag import-tag-more';
        more.textContent = t('dataImportTagsMore', '+$1 more', [num(s.tagNames.length - 12)]);
        el.previewTags.appendChild(more);
      }
    }
    show(el.previewTags, s.tagNames.length > 0);

    clear(el.previewNotes);
    if (already) {
      para(el.previewNotes, already === s.total
        ? t('dataImportAlreadyAll', 'Everything in this file is already in your list. Importing adds any missing tags and highlights and changes nothing else.')
        : t('dataImportAlreadySome', '$1 of these are already in your list. They stay as they are; only missing tags and highlights are added.', [num(already)]));
    }
    if (s.withText === 0) para(el.previewNotes, noTextNote(p.source), 'import-note import-note-info');
    else if (s.withText < s.total) para(el.previewNotes, t('dataImportSomeText', 'Full text is included for $1 of $2 articles, so those are readable offline right away. The others open as links; save them again from their page to keep the text.', [num(s.withText), num(s.total)]), 'import-note import-note-info');
    else para(el.previewNotes, t('dataImportAllText', 'Full text is included for every article, so they\'re readable offline right away.'), 'import-note import-note-info');
    Object.keys(p.skipped).forEach(function (k) {
      para(el.previewNotes, skippedLine(k, p.skipped[k]) + ' ' + t('dataImportWillSkip', 'They\'ll be skipped.'), 'import-note import-note-warn');
    });
    if (p.merged) {
      para(el.previewNotes, tn(p.merged, 'dataImportMergedOne', '$1 row repeated a link that appears earlier in the file, so they were combined into one article.',
        'dataImportMerged', '$1 rows repeated a link that appears earlier in the file. Each was combined with the earlier one.'));
    }
    errorList(el.previewNotes, p.errors);

    show(el.restoreRow, !!p.settings);
    show(el.sources, false);
    show(el.preview, true);
    el.preview.focus();
    announce(el.previewTitle.textContent + '. ' + el.previewSource.textContent + '. ' + t('dataImportAnnounceCount', '$1 articles.', [num(s.total)]));
  }

  /* ---------------- import ---------------- */

  function minimal(it) {
    return { url: it.url, title: it.title, savedAt: it.savedAt, isRead: it.isRead, tags: it.tags };
  }

  function detailUpdates(it) {
    var u = {};
    if (it.isFavorite) u.isFavorite = true;
    if (it.excerpt) u.excerpt = it.excerpt;
    if (it.byline) u.byline = String(it.byline).slice(0, 300);
    if (it.leadImageUrl) u.leadImageUrl = it.leadImageUrl;
    if (it.content || it.textContent) {
      var words = Number(it.wordCount) || (String(it.textContent || '').match(/\S+/g) || []).length;
      if (it.content) u.content = it.content;
      if (it.textContent) u.textContent = it.textContent;
      u.wordCount = words;
      u.estimatedReadTime = Math.max(1, Math.round(words / ImportSources.WPM));
      u.isOffline = !!it.content;
    }
    if (it.readProgress) u.readProgress = Math.max(0, Math.min(100, Math.round(it.readProgress)));
    if (it.isRead) u.readAt = Number(it.readAt) || it.savedAt || Date.now();
    return Object.keys(u).length ? u : null;
  }

  function runPool(tasks, parallel, onStep) {
    var i = 0;
    var done = 0;
    function worker() {
      if (i >= tasks.length) return Promise.resolve();
      var task = tasks[i++];
      return task().catch(function () {}).then(function () {
        done++;
        if (onStep) onStep(done, tasks.length);
        return worker();
      });
    }
    var workers = [];
    for (var w = 0; w < Math.min(parallel, tasks.length); w++) workers.push(worker());
    return Promise.all(workers);
  }

  function startImport() {
    if (!plan || running) return;
    running = true;
    var p = plan;
    var items = p.items;
    var restoreSettings = !!(p.settings && el.restoreSettings.checked);
    var r = { imported: 0, already: 0, failed: 0, highlights: 0, withText: 0, tagged: 0, tagsBefore: 0, tagsAfter: 0, chunkErrors: [] };

    show(el.preview, false);
    el.progress.classList.add('active');
    setProgress(1, t('dataImportStarting', 'Starting...'));
    window.addEventListener('beforeunload', blockUnload);

    var before;
    var after;
    send('GET_TAGS').catch(function () { return []; }).then(function (tags) {
      r.tagsBefore = Array.isArray(tags) ? tags.length : 0;
      return urlIndex();
    }).then(function (idx) {
      before = idx;
      // 1. Create the records, 500 at a time.
      var toCreate = items.filter(function (it) { return !before.map[it.key]; });
      var chunks = [];
      for (var i = 0; i < toCreate.length; i += CHUNK) chunks.push(toCreate.slice(i, i + CHUNK));
      var sent = 0;
      setProgress(3, t('dataImportProgressSaving', 'Saving $1 of $2 articles...', [num(0), num(toCreate.length)]));
      return chunks.reduce(function (prev, chunk, ci) {
        return prev.then(function () {
          return send('IMPORT_POCKET', { articles: chunk.map(minimal) }, CHUNK_TIMEOUT).catch(function (err) {
            r.chunkErrors.push(t('dataImportChunkFailed', 'Part $1 of the import reported a problem: $2', [String(ci + 1), err.message || String(err)]));
          }).then(function () {
            sent += chunk.length;
            setProgress(3 + 67 * (sent / Math.max(1, toCreate.length)), t('dataImportProgressSaving', 'Saving $1 of $2 articles...', [num(sent), num(toCreate.length)]));
          });
        });
      }, Promise.resolve());
    }).then(function () {
      setProgress(71, t('dataImportProgressChecking', 'Checking what was saved...'));
      return urlIndex();
    }).then(function (idx) {
      after = idx;
      // Anything the index can't match (an unusual URL form) is looked up directly.
      var missing = items.filter(function (it) { return !after.map[it.key]; });
      return runPool(missing.map(function (it) {
        return function () {
          return send('CHECK_URL_SAVED', { url: it.url }).then(function (d) {
            if (d && d.saved && d.article) after.map[it.key] = d.article.id;
          });
        };
      }), UPDATE_PARALLEL);
    }).then(function () {
      items.forEach(function (it) {
        it.id = after.map[it.key] || null;
        if (!it.id) r.failed++;
        else if (before.ids[it.id]) { it.existing = true; r.already++; }
        else r.imported++;
      });
      // 2. Details IMPORT_POCKET can't carry, for new articles only.
      var updates = [];
      items.forEach(function (it) {
        if (!it.id || it.existing) return;
        var u = detailUpdates(it);
        if (!u) return;
        if (u.isOffline) r.withText++;
        updates.push(function () { return send('UPDATE_ARTICLE', { id: it.id, updates: u }, 60000); });
      });
      if (!updates.length) return;
      var label = r.withText ? 'dataImportProgressText' : 'dataImportProgressDetails';
      return runPool(updates, UPDATE_PARALLEL, function (done, total) {
        setProgress(72 + 18 * (done / total), label === 'dataImportProgressText'
          ? t('dataImportProgressText', 'Adding full text and details $1 of $2...', [num(done), num(total)])
          : t('dataImportProgressDetails', 'Adding favorites and details $1 of $2...', [num(done), num(total)]));
      });
    }).then(function () {
      // 3. Tags on articles that were already in the list.
      var existingTagged = items.filter(function (it) { return it.existing && it.tags.length; });
      if (!existingTagged.length) return;
      var tagIds = {};
      var tasks = existingTagged.map(function (it) {
        return function () {
          return it.tags.reduce(function (prev, name) {
            return prev.then(function () {
              var idP = tagIds[name] ? Promise.resolve(tagIds[name]) : send('CREATE_TAG', { name: name }).then(function (tag) { tagIds[name] = tag.id; return tag.id; });
              return idP.then(function (tagId) { return send('TAG_ARTICLE', { articleId: it.id, tagId: tagId }); });
            });
          }, Promise.resolve()).then(function () { r.tagged++; });
        };
      });
      return runPool(tasks, 2, function (done, total) {
        setProgress(90 + 5 * (done / total), t('dataImportProgressTags', 'Adding tags to articles already in your list $1 of $2...', [num(done), num(total)]));
      });
    }).then(function () {
      // 4. Highlights.
      var incoming = {};
      var any = false;
      items.forEach(function (it) {
        if (!it.id || !it.highlights.length) return;
        var src = p.source === 'pocketHtml' ? 'pocket' : p.source;
        incoming[it.id] = {
          title: it.title,
          url: it.url,
          items: it.highlights.map(function (h) { return Object.assign({ source: src }, h); })
        };
        any = true;
      });
      if (p.orphanHighlights) {
        Object.keys(p.orphanHighlights).forEach(function (k) {
          if (!incoming[k]) { incoming[k] = p.orphanHighlights[k]; any = true; }
        });
      }
      if (!any || typeof HighlightsStore === 'undefined') return;
      setProgress(96, t('dataImportProgressHighlights', 'Adding highlights...'));
      return HighlightsStore.mergeAll(incoming).then(function (n) { r.highlights = n || 0; });
    }).then(function () {
      if (!restoreSettings) return;
      var s = {};
      READER_KEYS.forEach(function (k) { if (k in p.settings) s[k] = p.settings[k]; });
      if (Object.keys(s).length) return send('SAVE_SETTINGS', s).catch(function () {});
    }).then(function () {
      return send('GET_TAGS').catch(function () { return []; });
    }).then(function (tags) {
      r.tagsAfter = Array.isArray(tags) ? tags.length : r.tagsBefore;
      try { chrome.storage.local.set({ articlesUpdatedAt: Date.now() }); } catch (e) { /* panel refresh is best effort */ }
      setProgress(100, t('dataImportProgressDone', 'Done'));
      finishImport(p, r);
    }).catch(function (err) {
      finishImport(p, r, err);
    });
  }

  function blockUnload(e) {
    e.preventDefault();
    e.returnValue = '';
  }

  function finishImport(p, r, fatal) {
    running = false;
    window.removeEventListener('beforeunload', blockUnload);
    el.progress.classList.remove('active');
    var problems = r.chunkErrors.slice();
    if (fatal) problems.unshift(fatal.message || String(fatal));
    var ok = !fatal && r.failed === 0 && !r.chunkErrors.length;
    el.result.className = 'import-card import-result ' + (ok ? 'success' : (r.imported || r.already ? 'warning' : 'error'));
    el.resultTitle.textContent = ok
      ? t('dataImportDoneTitle', 'Import complete')
      : (r.imported || r.already ? t('dataImportPartialTitle', 'Import finished with some problems') : t('dataImportFailedTitle', 'The import didn\'t finish'));

    clear(el.resultDetails);
    function line(text) {
      var li = document.createElement('li');
      li.textContent = text;
      el.resultDetails.appendChild(li);
    }
    line(t('dataImportResImported', '$1 $2 imported', [num(r.imported), plural(r.imported, t('dataWordArticle', 'article'), t('dataWordArticles', 'articles'))]));
    if (r.already) line(t('dataImportResAlready', '$1 already in your list (left as they were)', [num(r.already)]));
    if (r.tagged) line(t('dataImportResTagged', 'Tags added to $1 of them', [num(r.tagged)]));
    var newTags = Math.max(0, r.tagsAfter - r.tagsBefore);
    if (newTags) line(tn(newTags, 'dataImportResTagsOne', '$1 new tag created', 'dataImportResTags', '$1 new tags created'));
    if (r.highlights || p.stats.highlights) line(tn(r.highlights, 'dataImportResHighlightsOne', '$1 highlight added', 'dataImportResHighlights', '$1 highlights added'));
    if (r.withText) line(tn(r.withText, 'dataImportResTextOne', 'Full text saved for $1 article, readable offline now', 'dataImportResText', 'Full text saved for $1 articles, readable offline now'));
    Object.keys(p.skipped).forEach(function (k) { line(skippedLine(k, p.skipped[k])); });
    if (r.failed) line(t('dataImportResFailed', '$1 couldn\'t be saved. Try importing the file again; anything already saved is skipped.', [num(r.failed)]));

    clear(el.resultNotes);
    /* fetch lane hook: offer to download the text of link-only imports */
    var linkOnly = Math.max(0, r.imported - r.withText);
    var fetchBtn = document.getElementById('btn-fetch-text');
    if (fetchBtn) {
      fetchBtn.hidden = !(linkOnly && typeof FulltextAccess !== 'undefined');
      fetchBtn.textContent = linkOnly === 1
        ? t('fetchImportButtonOne', 'Get the full text for 1 imported article')
        : t('fetchImportButton', 'Get the full text for $1 imported articles', [num(linkOnly)]);
      if (el.btnOpenList) el.btnOpenList.className = fetchBtn.hidden ? 'btn btn-primary' : 'btn btn-secondary';
    }
    if (fetchBtn && !fetchBtn.hidden) para(el.resultNotes, t('fetchImportNote', 'They came over as links only. ReadLater can download each page\'s text from its site, so you can read them offline, highlight them and listen to them.'), 'import-note import-note-info');
    else if (!r.withText && r.imported) para(el.resultNotes, noTextNote(p.source), 'import-note import-note-info');

    errorList(el.resultNotes, problems.concat(p.errors));
    show(el.resultActions, true);
    el.result.focus();
    announce(el.resultTitle.textContent + '. ' + el.resultDetails.textContent);
  }

  /* ---------------- wiring ---------------- */

  function openList() {
    try {
      if (chrome.sidePanel && chrome.sidePanel.open && windowId != null) {
        chrome.sidePanel.open({ windowId: windowId }).catch(function () {
          chrome.tabs.create({ url: chrome.runtime.getURL('src/sidebar/sidebar.html') });
        });
        return;
      }
    } catch (e) { /* fall through */ }
    chrome.tabs.create({ url: chrome.runtime.getURL('src/sidebar/sidebar.html') });
  }

  function init() {
    if (typeof I18n !== 'undefined') I18n.translateDOM();
    ['dropzone', 'file-input', 'reading-status', 'preview-section', 'preview-title', 'preview-source', 'preview-stats', 'preview-tags', 'preview-notes',
      'restore-settings-row', 'restore-settings', 'btn-start', 'btn-cancel', 'progress-section', 'progress-bar', 'progress-text',
      'result-section', 'result-title', 'result-details', 'result-notes', 'result-actions', 'btn-open-list', 'btn-another'].forEach(function (id) {
      el[id.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = document.getElementById(id);
    });
    el.reading = el.readingStatus;
    el.preview = el.previewSection;
    el.restoreRow = el.restoreSettingsRow;
    el.progress = el.progressSection;
    el.bar = el.progressBar;
    el.result = el.resultSection;
    el.sources = document.querySelector('.import-sources');
    if (!el.dropzone || !el.fileInput) return;

    try { chrome.windows.getCurrent(function (w) { windowId = w && w.id; }); } catch (e) { /* no windows API */ }

    el.dropzone.addEventListener('click', function () { el.fileInput.click(); });
    el.dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        el.fileInput.click();
      }
    });
    el.fileInput.addEventListener('change', function () {
      if (el.fileInput.files.length) handleFile(el.fileInput.files[0]);
    });
    el.dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      el.dropzone.classList.add('dragover');
    });
    el.dropzone.addEventListener('dragleave', function () { el.dropzone.classList.remove('dragover'); });
    el.dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      el.dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    // A file dropped anywhere on the page shouldn't navigate away from it.
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!running && !plan && e.dataTransfer && e.dataTransfer.files.length && e.target !== el.dropzone && !el.dropzone.contains(e.target)) {
        handleFile(e.dataTransfer.files[0]);
      }
    });
    el.btnStart.addEventListener('click', startImport);
    el.btnCancel.addEventListener('click', resetToStart);
    el.btnAnother.addEventListener('click', resetToStart);
    el.btnOpenList.addEventListener('click', openList);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
