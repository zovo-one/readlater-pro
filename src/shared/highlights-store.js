/* ReadLater Pro - highlights and notes store (1.3.0).
 *
 * One chrome.storage.local key, "rlHighlights", shaped like
 *   { [articleId]: { title, url, updatedAt, items: [Highlight] } }
 * where a Highlight is
 *   { id, text, prefix, suffix, color, note, createdAt, updatedAt, source }
 *   color:  "yellow" | "green" | "blue" | "pink"
 *   prefix/suffix: up to 32 chars of text around the quote, used to find it again
 *   source: "reader" | "pocket" | "omnivore" | "instapaper" | "raindrop" | "backup"
 *
 * Highlights outlive their article on purpose: deleting an article keeps its
 * highlights (with title and url) until the user deletes them.
 * Pages use this file; the service worker never needs it.
 */
(function () {
  'use strict';

  var KEY = 'rlHighlights';
  var COLORS = ['yellow', 'green', 'blue', 'pink'];
  var queue = Promise.resolve();

  function now() { return Date.now(); }

  function newId() {
    return 'h' + now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function readAll() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(KEY, function (res) {
          if (chrome.runtime.lastError) { resolve({}); return; }
          var v = res && res[KEY];
          resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
        });
      } catch (e) { resolve({}); }
    });
  }

  function writeAll(all) {
    return new Promise(function (resolve, reject) {
      var out = {};
      out[KEY] = all;
      chrome.storage.local.set(out, function () {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        resolve(all);
      });
    });
  }

  // Serialise read-modify-write cycles within one page so two quick edits
  // can't overwrite each other.
  function mutate(fn) {
    var run = queue.then(function () {
      return readAll().then(function (all) {
        var result = fn(all);
        return writeAll(all).then(function () { return result; });
      });
    });
    queue = run.catch(function () {});
    return run;
  }

  function clean(item) {
    var h = item || {};
    return {
      id: h.id || newId(),
      text: String(h.text || '').slice(0, 20000),
      prefix: String(h.prefix || '').slice(-32),
      suffix: String(h.suffix || '').slice(0, 32),
      color: COLORS.indexOf(h.color) >= 0 ? h.color : 'yellow',
      note: String(h.note || '').slice(0, 20000),
      createdAt: Number(h.createdAt) || now(),
      updatedAt: Number(h.updatedAt) || now(),
      source: h.source || 'reader'
    };
  }

  function entryFor(all, articleId, meta) {
    var e = all[articleId];
    if (!e || !Array.isArray(e.items)) {
      e = all[articleId] = { title: '', url: '', updatedAt: now(), items: [] };
    }
    if (meta) {
      if (meta.title) e.title = String(meta.title).slice(0, 500);
      if (meta.url) e.url = String(meta.url).slice(0, 4000);
    }
    return e;
  }

  var HighlightsStore = {
    KEY: KEY,
    COLORS: COLORS,

    /** Everything, as { articleId: {title,url,updatedAt,items} }. */
    getAll: readAll,

    /** Items for one article (newest last, in document order if the caller sorted them). */
    get: function (articleId) {
      return readAll().then(function (all) {
        var e = all[articleId];
        return e && Array.isArray(e.items) ? e.items.slice() : [];
      });
    },

    /** Add one highlight. meta = {title, url} of the article. Resolves the stored item. */
    add: function (articleId, meta, item) {
      return mutate(function (all) {
        var e = entryFor(all, articleId, meta);
        var h = clean(item);
        e.items.push(h);
        e.updatedAt = now();
        return h;
      });
    },

    /** Add many at once (importers). Skips items whose text already exists for that article. */
    addMany: function (articleId, meta, items) {
      return mutate(function (all) {
        var e = entryFor(all, articleId, meta);
        var seen = {};
        e.items.forEach(function (h) { seen[h.text] = true; });
        var added = 0;
        (items || []).forEach(function (it) {
          var h = clean(it);
          if (!h.text || seen[h.text]) return;
          seen[h.text] = true;
          e.items.push(h);
          added++;
        });
        e.updatedAt = now();
        if (!e.items.length) delete all[articleId];
        return added;
      });
    },

    /** Patch fields (color, note) of one highlight. */
    update: function (articleId, highlightId, patch) {
      return mutate(function (all) {
        var e = all[articleId];
        if (!e || !Array.isArray(e.items)) return null;
        for (var i = 0; i < e.items.length; i++) {
          if (e.items[i].id === highlightId) {
            var h = e.items[i];
            if (patch && patch.color && COLORS.indexOf(patch.color) >= 0) h.color = patch.color;
            if (patch && typeof patch.note === 'string') h.note = patch.note.slice(0, 20000);
            h.updatedAt = now();
            e.updatedAt = now();
            return h;
          }
        }
        return null;
      });
    },

    remove: function (articleId, highlightId) {
      return mutate(function (all) {
        var e = all[articleId];
        if (!e || !Array.isArray(e.items)) return false;
        var before = e.items.length;
        e.items = e.items.filter(function (h) { return h.id !== highlightId; });
        if (!e.items.length) delete all[articleId];
        else e.updatedAt = now();
        return e.items ? before !== e.items.length : true;
      });
    },

    removeArticle: function (articleId) {
      return mutate(function (all) {
        var had = !!all[articleId];
        delete all[articleId];
        return had;
      });
    },

    /** Replace the whole store (backup restore). Merges by article, de-duplicating by text. */
    mergeAll: function (incoming) {
      return mutate(function (all) {
        var added = 0;
        Object.keys(incoming || {}).forEach(function (aid) {
          var src = incoming[aid];
          if (!src || !Array.isArray(src.items)) return;
          var e = entryFor(all, aid, src);
          var seen = {};
          e.items.forEach(function (h) { seen[h.text] = true; });
          src.items.forEach(function (it) {
            var h = clean(it);
            if (!h.text || seen[h.text]) return;
            seen[h.text] = true;
            e.items.push(h);
            added++;
          });
          if (!e.items.length) delete all[aid];
        });
        return added;
      });
    },

    /** Total number of highlights. */
    count: function () {
      return readAll().then(function (all) {
        var n = 0;
        Object.keys(all).forEach(function (k) { n += (all[k] && all[k].items ? all[k].items.length : 0); });
        return n;
      });
    },

    /** Call fn(all) whenever the store changes in any page. Returns an unsubscribe function. */
    onChange: function (fn) {
      function listener(changes, area) {
        if (area === 'local' && changes[KEY]) fn(changes[KEY].newValue || {});
      }
      chrome.storage.onChanged.addListener(listener);
      return function () { chrome.storage.onChanged.removeListener(listener); };
    },

    /** Markdown for one article's highlights (used by exports and "Copy highlights"). */
    toMarkdown: function (meta, items) {
      var lines = [];
      lines.push('## ' + (meta && meta.title ? meta.title : 'Untitled'));
      if (meta && meta.url) lines.push('', meta.url);
      (items || []).forEach(function (h) {
        lines.push('');
        String(h.text || '').split(/\n+/).forEach(function (p) { lines.push('> ' + p); });
        if (h.note) { lines.push(''); lines.push(h.note); }
      });
      return lines.join('\n') + '\n';
    },

    newId: newId
  };

  if (typeof self !== 'undefined') self.HighlightsStore = HighlightsStore;
  if (typeof window !== 'undefined') window.HighlightsStore = HighlightsStore;
})();
