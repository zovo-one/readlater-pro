/* ReadLater Pro - universal importer: format detection and parsers (1.3.0).
 *
 *   ImportSources.fromFile(file) -> Promise<Plan>
 *
 * A Plan is what the import page previews and then imports:
 *   {
 *     source:   "pocket" | "pocketHtml" | "bookmarks" | "instapaper" | "omnivore" |
 *               "raindrop" | "csv" | "txt" | "backup",
 *     fileName,
 *     items:    [Item],             // unique by normalised URL
 *     errors:   [string],           // parse problems shown to the user (B14)
 *     skipped:  { reason: count },  // "private", "invalidUrl", "notUrl", "limit"
 *     merged:   number,             // rows that repeated a URL already in the file
 *     orphanHighlights: { articleId: {title,url,items} } // backup only
 *     settings: { ... } | null      // backup only: reader settings
 *   }
 *   Item = { url, title, savedAt, isRead, isFavorite, tags[], highlights[],
 *            excerpt?, byline?, leadImageUrl?, content?, textContent?, wordCount?,
 *            readAt?, readProgress?, oldId? }
 *
 * Highlights use HighlightsStore's item shape: { text, note, createdAt, color?, source }.
 */
(function () {
  'use strict';

  var MAX_ITEMS = 50000;
  var MAX_TAGS = 20;
  var MAX_TAG_LENGTH = 50;
  var MAX_TITLE = 300;
  var MAX_URL = 2048;
  var MAX_ERRORS = 50;
  var MAX_CONTENT_CHARS = 2000000;
  var MAX_TEXT_FILE = 64 * 1024 * 1024;
  var MAX_ZIP_FILE = 512 * 1024 * 1024;
  var WPM = 238;

  var TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref'];

  /* ---------------- helpers ---------------- */

  function str(v) { return v == null ? '' : String(v); }

  function cleanText(v, max) {
    var s = str(v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    return max && s.length > max ? s.slice(0, max) : s;
  }

  function cleanUrl(v) {
    var s = str(v).trim();
    if (!s || s.length > MAX_URL || !/^https?:\/\//i.test(s)) return '';
    try {
      var u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  /** Same rules as db-manager: no hash, no tracking params, no trailing slash. */
  function normalizeUrl(v) {
    try {
      var u = new URL(v);
      u.hash = '';
      TRACKING_PARAMS.forEach(function (p) { u.searchParams.delete(p); });
      var s = u.toString();
      if (s.length > 1 && s.charAt(s.length - 1) === '/' && u.pathname !== '/') s = s.slice(0, -1);
      return s;
    } catch (e) {
      return str(v);
    }
  }

  function tagList(raw) {
    var out = [];
    (raw || []).forEach(function (t) {
      if (out.length >= MAX_TAGS) return;
      var name = cleanText(t, MAX_TAG_LENGTH).replace(/^#/, '').toLowerCase();
      if (name && out.indexOf(name) === -1) out.push(name);
    });
    return out;
  }

  /** Seconds, milliseconds or an ISO date -> ms epoch, or 0. */
  function toMs(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' || /^\s*\d+(\.\d+)?\s*$/.test(String(v))) {
      var n = Number(v);
      if (!isFinite(n) || n <= 0) return 0;
      if (n < 1e11) n *= 1000;          // seconds
      else if (n > 1e14) n = n / 1000; // microseconds
      return Math.round(n);
    }
    var d = Date.parse(String(v));
    return isFinite(d) && d > 0 ? d : 0;
  }

  function truthy(v) {
    return v === true || /^(true|1|yes|y)$/i.test(str(v).trim());
  }

  function words(text) {
    var m = str(text).match(/\S+/g);
    return m ? m.length : 0;
  }

  function newPlan(source, fileName) {
    return {
      source: source,
      fileName: fileName || '',
      items: [],
      errors: [],
      skipped: {},
      merged: 0,
      orphanHighlights: null,
      settings: null,
      _byUrl: {}
    };
  }

  function skip(plan, reason, n) {
    plan.skipped[reason] = (plan.skipped[reason] || 0) + (n || 1);
  }

  function error(plan, msg) {
    if (plan.errors.length < MAX_ERRORS) plan.errors.push(msg);
  }

  /** Add an item, merging with an earlier row for the same URL. Returns the stored item or null. */
  function addItem(plan, raw) {
    var url = cleanUrl(raw.url);
    if (!url) { skip(plan, 'invalidUrl'); return null; }
    var key = normalizeUrl(url);
    var existing = plan._byUrl[key];
    var tags = tagList(raw.tags);
    var highlights = (raw.highlights || []).filter(function (h) { return h && cleanText(h.text); });
    if (existing) {
      plan.merged++;
      tags.forEach(function (t) { if (existing.tags.length < MAX_TAGS && existing.tags.indexOf(t) === -1) existing.tags.push(t); });
      existing.highlights = existing.highlights.concat(highlights);
      if (raw.isFavorite) existing.isFavorite = true;
      if (!existing.content && raw.content) {
        ['content', 'textContent', 'wordCount'].forEach(function (k) { existing[k] = raw[k]; });
      }
      return existing;
    }
    if (plan.items.length >= MAX_ITEMS) { skip(plan, 'limit'); return null; }
    var item = {
      url: url,
      key: key,
      title: cleanText(str(raw.title).replace(/\s+/g, ' '), MAX_TITLE) || url,
      savedAt: toMs(raw.savedAt) || Date.now(),
      isRead: !!raw.isRead,
      isFavorite: !!raw.isFavorite,
      tags: tags,
      highlights: highlights
    };
    ['excerpt', 'byline', 'leadImageUrl', 'content', 'textContent', 'wordCount', 'readAt', 'readProgress', 'oldId'].forEach(function (k) {
      if (raw[k] != null && raw[k] !== '') item[k] = raw[k];
    });
    if (item.excerpt) item.excerpt = cleanText(item.excerpt, 300);
    if (item.leadImageUrl && !/^https:\/\//i.test(item.leadImageUrl)) delete item.leadImageUrl;
    plan._byUrl[key] = item;
    plan.items.push(item);
    return item;
  }

  function finish(plan) {
    delete plan._byUrl;
    var tags = {};
    var stats = { total: plan.items.length, unread: 0, read: 0, favorites: 0, tags: 0, highlights: 0, withText: 0 };
    plan.items.forEach(function (it) {
      if (it.isRead) stats.read++; else stats.unread++;
      if (it.isFavorite) stats.favorites++;
      if (it.content) stats.withText++;
      stats.highlights += it.highlights.length;
      it.tags.forEach(function (t) { tags[t] = (tags[t] || 0) + 1; });
    });
    if (plan.orphanHighlights) {
      Object.keys(plan.orphanHighlights).forEach(function (k) {
        var e = plan.orphanHighlights[k];
        stats.highlights += e && e.items ? e.items.length : 0;
      });
    }
    stats.tagNames = Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a] || (a < b ? -1 : 1); });
    stats.tags = stats.tagNames.length;
    plan.stats = stats;
    return plan;
  }

  /* ---------------- HTML article bodies (Omnivore, backups) ---------------- */

  var DROP_TAGS = 'script,style,iframe,object,embed,form,input,textarea,select,button,link,meta,base,applet,frame,frameset,noscript,template,svg';

  /** Sanitise readable HTML and derive its text. Returns { content, textContent, wordCount }. */
  function articleFromHtml(html) {
    var doc = new DOMParser().parseFromString(str(html), 'text/html');
    var root = doc.body;
    if (!root) return { content: '', textContent: '', wordCount: 0 };
    root.querySelectorAll(DROP_TAGS).forEach(function (n) { n.remove(); });
    root.querySelectorAll('*').forEach(function (el) {
      for (var i = el.attributes.length - 1; i >= 0; i--) {
        var name = el.attributes[i].name.toLowerCase();
        var value = el.attributes[i].value;
        if (name.indexOf('on') === 0 || name === 'style' || name === 'srcdoc' || name.indexOf('data-omnivore') === 0) {
          el.removeAttribute(el.attributes[i].name);
        } else if ((name === 'href' || name === 'src' || name === 'action' || name === 'xlink:href') &&
          /^\s*(javascript|vbscript|data:text\/html)/i.test(value)) {
          el.removeAttribute(el.attributes[i].name);
        }
      }
    });
    var content = root.innerHTML.trim();
    var text = blockText(root);
    if (content.length > MAX_CONTENT_CHARS) {
      // Too big for the reader's HTML pass; keep the text as simple paragraphs.
      content = text.split(/\n{2,}/).map(function (p) {
        var div = doc.createElement('p');
        div.textContent = p;
        return div.outerHTML;
      }).join('').slice(0, MAX_CONTENT_CHARS);
    }
    return { content: content, textContent: text, wordCount: words(text) };
  }

  /** Text with paragraph breaks between block elements. */
  function blockText(root) {
    var out = [];
    var BLOCK = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TR|SECTION|ARTICLE|FIGCAPTION|DT|DD|HEADER|FOOTER|ASIDE)$/;
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) out.push(c.nodeValue);
        else if (c.nodeType === 1) {
          if (c.tagName === 'BR') { out.push('\n'); continue; }
          var block = BLOCK.test(c.tagName);
          if (block) out.push('\n\n');
          walk(c);
          if (block) out.push('\n\n');
        }
      }
    })(root);
    return out.join('').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------------- CSV sources ---------------- */

  function col(rec, index, name) {
    var i = index[name];
    return i == null ? '' : str(rec[i]);
  }

  function hasCols(index, names) {
    return names.every(function (n) { return n in index; });
  }

  function detectCsv(index) {
    if (hasCols(index, ['url', 'title', 'selection', 'folder'])) return 'instapaper';
    if (hasCols(index, ['url', 'title', 'excerpt', 'folder', 'tags', 'created'])) return 'raindrop';
    if (hasCols(index, ['url', 'time_added']) && ('status' in index || 'tags' in index)) return 'pocket';
    var urlCol = ['url', 'link', 'href', 'address', 'uri', 'given_url', 'resolved_url'].filter(function (n) { return n in index; })[0];
    return urlCol ? 'csv' : null;
  }

  function splitTags(v, seps) {
    var s = str(v).trim();
    if (!s) return [];
    if (s.charAt(0) === '[') {
      try {
        var arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.map(function (x) { return x && x.name ? x.name : str(x); });
      } catch (e) { /* fall through */ }
    }
    return s.split(seps);
  }

  function parsePocketRows(plan, t) {
    t.records.forEach(function (r) {
      var status = col(r, t.index, 'status').trim().toLowerCase();
      addItem(plan, {
        url: col(r, t.index, 'url'),
        title: col(r, t.index, 'title'),
        savedAt: col(r, t.index, 'time_added'),
        isRead: status === 'archive' || status === 'archived' || status === 'read' || status === '1',
        isFavorite: truthy(col(r, t.index, 'favorite')),
        tags: splitTags(col(r, t.index, 'tags'), '|')
      });
    });
  }

  function parseInstapaperRows(plan, t) {
    t.records.forEach(function (r) {
      var url = col(r, t.index, 'url').trim();
      if (/^instapaper-private:/i.test(url)) { skip(plan, 'private'); return; }
      var folder = col(r, t.index, 'folder').trim();
      var f = folder.toLowerCase();
      var tags = splitTags(col(r, t.index, 'tags'), /[,|]/);
      if (folder && f !== 'unread' && f !== 'archive' && f !== 'starred') tags.push(folder);
      var selection = cleanText(col(r, t.index, 'selection'));
      var savedAt = toMs(col(r, t.index, 'timestamp'));
      addItem(plan, {
        url: url,
        title: col(r, t.index, 'title'),
        savedAt: savedAt,
        isRead: f === 'archive',
        isFavorite: f === 'starred',
        tags: tags,
        highlights: selection ? [{ text: selection, createdAt: savedAt || Date.now(), source: 'instapaper' }] : []
      });
    });
  }

  function raindropHighlights(v, when) {
    var s = str(v).trim();
    if (!s) return [];
    if (s.charAt(0) === '[') {
      try {
        var arr = JSON.parse(s);
        if (Array.isArray(arr)) {
          return arr.map(function (h) {
            return { text: cleanText(h.text || h.quote || h), note: cleanText(h.note), createdAt: toMs(h.created) || when, source: 'raindrop' };
          });
        }
      } catch (e) { /* fall through */ }
    }
    var out = [];
    s.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var note = /^note:\s*(.*)$/i.exec(line);
      if (note && out.length) { out[out.length - 1].note = cleanText(note[1]); return; }
      out.push({ text: cleanText(line.replace(/^(highlight:|-|\*|>)\s*/i, '')), note: '', createdAt: when, source: 'raindrop' });
    });
    return out;
  }

  function parseRaindropRows(plan, t) {
    t.records.forEach(function (r) {
      var savedAt = toMs(col(r, t.index, 'created'));
      var tags = splitTags(col(r, t.index, 'tags'), ',');
      var folder = col(r, t.index, 'folder').trim();
      if (folder && !/^unsorted$/i.test(folder)) tags = tags.concat(folder.split('/'));
      var highlights = raindropHighlights(col(r, t.index, 'highlights'), savedAt || Date.now());
      var note = cleanText(col(r, t.index, 'note'));
      if (note) highlights.push({ text: note, note: '', color: 'blue', createdAt: savedAt || Date.now(), source: 'raindrop' });
      addItem(plan, {
        url: col(r, t.index, 'url'),
        title: col(r, t.index, 'title'),
        savedAt: savedAt,
        isRead: false,
        isFavorite: truthy(col(r, t.index, 'favorite')),
        tags: tags,
        excerpt: col(r, t.index, 'excerpt'),
        leadImageUrl: col(r, t.index, 'cover'),
        highlights: highlights
      });
    });
  }

  function parseGenericRows(plan, t) {
    var urlCol = ['url', 'link', 'href', 'address', 'uri', 'given_url', 'resolved_url'].filter(function (n) { return n in t.index; })[0];
    var titleCol = ['title', 'name', 'resolved_title', 'given_title'].filter(function (n) { return n in t.index; })[0];
    var dateCol = ['time_added', 'created', 'saved', 'savedat', 'added', 'date', 'timestamp', 'created_at'].filter(function (n) { return n in t.index; })[0];
    t.records.forEach(function (r) {
      var status = col(r, t.index, 'status').toLowerCase();
      addItem(plan, {
        url: col(r, t.index, urlCol),
        title: titleCol ? col(r, t.index, titleCol) : '',
        savedAt: dateCol ? col(r, t.index, dateCol) : '',
        isRead: truthy(col(r, t.index, 'read')) || truthy(col(r, t.index, 'isread')) || status === 'archive' || status === 'read',
        isFavorite: truthy(col(r, t.index, 'favorite')) || truthy(col(r, t.index, 'starred')),
        tags: splitTags(col(r, t.index, 'tags'), /[|,]/)
      });
    });
  }

  function parseCsvText(plan, text, forcedSource) {
    var res = ImportCsv.parse(text);
    if (res.error === 'tooLarge') { error(plan, 'This CSV file is too large to import.'); return null; }
    if (res.error === 'tooManyRows') error(plan, 'Only the first ' + ImportCsv.MAX_ROWS + ' rows were read.');
    if (res.error === 'unclosedQuote') error(plan, 'The last row has an unclosed quote, so it may be cut short.');
    if (!res.rows.length) { error(plan, 'The CSV file is empty.'); return null; }
    var t = ImportCsv.toRecords(res.rows);
    var kind = forcedSource || detectCsv(t.index);
    if (!kind) {
      error(plan, 'This CSV has no "url" column, so there\'s nothing to import. Its columns are: ' + t.header.slice(0, 12).join(', '));
      return null;
    }
    var width = t.header.length;
    var ragged = 0;
    t.records.forEach(function (r) { if (r.length !== width) ragged++; });
    if (ragged) error(plan, ragged + ' row' + (ragged === 1 ? ' has' : 's have') + ' a different number of columns than the header. They were read as best as possible.');
    if (kind === 'pocket') parsePocketRows(plan, t);
    else if (kind === 'instapaper') parseInstapaperRows(plan, t);
    else if (kind === 'raindrop') parseRaindropRows(plan, t);
    else parseGenericRows(plan, t);
    return kind;
  }

  /* ---------------- JSON sources ---------------- */

  function parseBackup(plan, data) {
    var tagNamesById = {};
    (Array.isArray(data.tags) ? data.tags : []).forEach(function (t) { if (t && t.id) tagNamesById[t.id] = t.name; });
    var mapping = data.articleTags && typeof data.articleTags === 'object' ? data.articleTags : {};
    var hl = data.highlights && typeof data.highlights === 'object' && !Array.isArray(data.highlights) ? data.highlights : {};
    var used = {};
    data.articles.forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      var tags = Array.isArray(a.tags) ? a.tags : (mapping[a.id] || []);
      tags = tags.map(function (t) { return t && typeof t === 'object' ? (t.name || tagNamesById[t.id]) : (tagNamesById[t] || t); });
      var entry = a.id && hl[a.id];
      if (entry) used[a.id] = true;
      var item = addItem(plan, {
        url: a.originalUrl && !a.url ? a.originalUrl : a.url,
        title: a.title,
        savedAt: a.savedAt,
        isRead: !!a.isRead,
        isFavorite: !!a.isFavorite,
        tags: tags,
        excerpt: a.excerpt,
        byline: a.byline,
        leadImageUrl: a.leadImageUrl,
        content: typeof a.content === 'string' ? a.content : '',
        textContent: typeof a.textContent === 'string' ? a.textContent : '',
        wordCount: Number(a.wordCount) || 0,
        readAt: a.readAt || null,
        readProgress: Number(a.readProgress) || 0,
        oldId: a.id,
        highlights: entry && Array.isArray(entry.items) ? entry.items.map(function (h) {
          return Object.assign({}, h, { source: h.source || 'backup' });
        }) : []
      });
      if (!item && entry) delete used[a.id];
    });
    var orphans = {};
    Object.keys(hl).forEach(function (k) {
      if (!used[k] && hl[k] && Array.isArray(hl[k].items) && hl[k].items.length) orphans[k] = hl[k];
    });
    plan.orphanHighlights = Object.keys(orphans).length ? orphans : null;
    var s = data.readerSettings || null;
    if (!s && data.settings && typeof data.settings === 'object') {
      s = {};
      ['readerTheme', 'readerFontSize', 'readerWidth', 'readerFontFamily', 'readerLineHeight', 'ttsRate', 'ttsVoice', 'openArticlesIn'].forEach(function (k) {
        if (k in data.settings) s[k] = data.settings[k];
      });
    }
    plan.settings = s && Object.keys(s).length ? s : null;
  }

  function parseOmnivoreMeta(plan, list, files) {
    // files: { content: {slug: html}, highlights: {slug: md} } (zip only)
    list.forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      var slug = str(m.slug);
      var labels = Array.isArray(m.labels) ? m.labels.map(function (l) { return l && typeof l === 'object' ? l.name : l; }) : [];
      var raw = {
        url: m.url || m.originalUrl,
        title: m.title,
        savedAt: m.savedAt || m.createdAt,
        isRead: /^archived$/i.test(str(m.state)) || !!m.isArchived,
        tags: labels,
        excerpt: m.description,
        byline: m.author,
        leadImageUrl: m.thumbnail,
        readProgress: Math.max(0, Math.min(100, Math.round(Number(m.readingProgress) || 0))),
        highlights: []
      };
      if (files && slug && files.content[slug] != null) {
        var art = articleFromHtml(files.content[slug]);
        if (art.content) {
          raw.content = art.content;
          raw.textContent = art.textContent;
          raw.wordCount = art.wordCount;
        }
      }
      if (files && slug && files.highlights[slug]) {
        raw.highlights = omnivoreHighlights(files.highlights[slug], toMs(raw.savedAt) || Date.now());
      }
      if (Array.isArray(m.highlights)) {
        m.highlights.forEach(function (h) {
          if (h && h.quote) raw.highlights.push({ text: cleanText(h.quote), note: cleanText(h.annotation), createdAt: toMs(h.createdAt) || Date.now(), source: 'omnivore' });
        });
      }
      addItem(plan, raw);
    });
  }

  /** Omnivore's highlightToMarkdown: "> quote" then optional "#label" line and note, joined by blank lines. */
  function omnivoreHighlights(md, when) {
    var out = [];
    var paras = str(md).replace(/\r\n?/g, '\n').split(/\n{2,}/);
    paras.forEach(function (p) {
      var t = p.trim();
      if (!t) return;
      if (t.charAt(0) === '>') {
        var quote = t.split('\n').map(function (l) { return l.replace(/^>\s?/, ''); }).join('\n').trim();
        out.push({ text: quote, note: '', createdAt: when, source: 'omnivore' });
      } else if (/^(#[^\s#]+\s*)+$/.test(t)) {
        // highlight labels: no place to keep them
      } else if (out.length) {
        var last = out[out.length - 1];
        last.note = last.note ? last.note + '\n\n' + t : t;
      } else {
        out.push({ text: t, note: '', createdAt: when, source: 'omnivore' });
      }
    });
    return out;
  }

  function attachPocketAnnotations(plan, list) {
    var attached = 0;
    list.forEach(function (a) {
      if (!a || !Array.isArray(a.highlights) || !a.highlights.length) return;
      var hs = a.highlights.map(function (h) {
        return { text: cleanText(h && h.quote), note: '', createdAt: toMs(h && h.created_at) || Date.now(), source: 'pocket' };
      }).filter(function (h) { return h.text; });
      if (!hs.length) return;
      var url = cleanUrl(a.url);
      var target = url && plan._byUrl[normalizeUrl(url)];
      if (target) target.highlights = target.highlights.concat(hs);
      else addItem(plan, { url: a.url, title: a.title, isRead: false, highlights: hs });
      attached += hs.length;
    });
    return attached;
  }

  function parseJsonText(plan, text) {
    var data;
    try {
      data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (e) {
      error(plan, 'This JSON file could not be read: ' + (e && e.message ? e.message : 'invalid JSON'));
      return;
    }
    if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.articles)) {
      plan.source = 'backup';
      parseBackup(plan, data);
      return;
    }
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
    if (!list) { error(plan, 'This JSON file isn\'t a ReadLater backup or a list of links.'); return; }
    var first = list.filter(function (x) { return x && typeof x === 'object'; })[0] || {};
    if ('slug' in first && ('labels' in first || 'state' in first)) {
      plan.source = 'omnivore';
      parseOmnivoreMeta(plan, list, null);
      return;
    }
    if (Array.isArray(first.highlights) && first.highlights.length && 'quote' in first.highlights[0]) {
      plan.source = 'pocket';
      attachPocketAnnotations(plan, list);
      return;
    }
    plan.source = 'csv';
    list.forEach(function (x) {
      if (typeof x === 'string') { addItem(plan, { url: x }); return; }
      if (!x || typeof x !== 'object') return;
      addItem(plan, {
        url: x.url || x.link || x.href,
        title: x.title || x.name,
        savedAt: x.savedAt || x.time_added || x.created || x.date,
        isRead: !!(x.isRead || x.read || x.archived),
        isFavorite: !!(x.isFavorite || x.favorite || x.starred),
        tags: Array.isArray(x.tags) ? x.tags : splitTags(x.tags, /[|,]/)
      });
    });
  }

  /* ---------------- text and HTML ---------------- */

  function parseTxt(plan, text) {
    str(text).split(/\r\n|\r|\n/).forEach(function (line) {
      var l = line.trim();
      if (!l || l.charAt(0) === '#') return;
      var m = /https?:\/\/[^\s<>"']+/i.exec(l);
      if (!m) { skip(plan, 'notUrl'); return; }
      var url = m[0].replace(/[),.;]+$/, '');
      var rest = (l.slice(0, m.index) + ' ' + l.slice(m.index + m[0].length)).replace(/^[\s\-*|,]+|[\s\-*|,]+$/g, '').trim();
      addItem(plan, { url: url, title: rest || '', isRead: false });
    });
  }

  function parseHtml(plan, text) {
    var res = PocketImport.parse(text);
    plan.source = res.kind === 'pocket' ? 'pocketHtml' : 'bookmarks';
    res.errors.forEach(function (e) { error(plan, e); });
    if (res.skippedInvalid) skip(plan, 'invalidUrl', res.skippedInvalid);
    res.articles.forEach(function (a) { addItem(plan, a); });
  }

  /* ---------------- zip ---------------- */

  function parseZip(plan, buffer) {
    return ZipReader.open(buffer).then(function (zip) {
      var base = function (n) { return n.split('/').pop(); };
      var visible = zip.entries.filter(function (e) { return !/(^|\/)(__MACOSX|\.)/.test(e.name); });
      var meta = visible.filter(function (e) { return /^metadata_.*\.json$/i.test(base(e.name)); });
      if (meta.length) return parseOmnivoreZip(plan, zip, visible, meta);
      var parts = visible.filter(function (e) { return /\.csv$/i.test(e.name) && !/annotations\//i.test(e.name); });
      var notes = visible.filter(function (e) { return /annotations\/.*\.json$/i.test(e.name); });
      if (parts.length && (notes.length || parts.some(function (e) { return /^part_\d+\.csv$/i.test(base(e.name)); }))) {
        return parsePocketZip(plan, zip, parts, notes);
      }
      // Any other zip: read every supported file inside it.
      var files = visible.filter(function (e) { return /\.(csv|html?|json|txt)$/i.test(e.name); });
      if (!files.length) { error(plan, 'This zip has no files that can be imported (.csv, .html, .json or .txt).'); return; }
      return files.reduce(function (p, e) {
        return p.then(function () {
          return zip.readText(e).then(function (text) { parseByExtension(plan, e.name, text); });
        });
      }, Promise.resolve());
    });
  }

  function parsePocketZip(plan, zip, parts, notes) {
    plan.source = 'pocket';
    parts.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return parts.reduce(function (p, e) {
      return p.then(function () {
        return zip.readText(e).then(function (text) {
          var kind = parseCsvText(plan, text, null);
          if (kind && kind !== 'pocket') error(plan, e.name + ' doesn\'t look like a Pocket list; it was read as a plain CSV.');
        });
      });
    }, Promise.resolve()).then(function () {
      return notes.reduce(function (p, e) {
        return p.then(function () {
          return zip.readText(e).then(function (text) {
            try {
              var list = JSON.parse(text);
              if (Array.isArray(list)) attachPocketAnnotations(plan, list);
            } catch (err) {
              error(plan, 'Highlights file ' + e.name + ' could not be read.');
            }
          });
        });
      }, Promise.resolve());
    });
  }

  function parseOmnivoreZip(plan, zip, entries, meta) {
    plan.source = 'omnivore';
    var files = { content: {}, highlights: {} };
    var slugOf = function (name, ext) {
      var b = name.split('/').pop();
      return b.slice(0, b.length - ext.length);
    };
    var contentEntries = entries.filter(function (e) { return /(^|\/)content\/[^/]+\.html?$/i.test(e.name); });
    var hlEntries = entries.filter(function (e) { return /(^|\/)highlights\/[^/]+\.md$/i.test(e.name); });
    var lists = [];
    var chain = meta.reduce(function (p, e) {
      return p.then(function () {
        return zip.readText(e).then(function (text) {
          try {
            var list = JSON.parse(text);
            if (Array.isArray(list)) lists.push(list);
            else error(plan, e.name + ' isn\'t a list of items.');
          } catch (err) {
            error(plan, e.name + ' could not be read.');
          }
        });
      });
    }, Promise.resolve());
    chain = chain.then(function () {
      return hlEntries.reduce(function (p, e) {
        return p.then(function () {
          return zip.readText(e).then(function (t) { files.highlights[slugOf(e.name, '.md')] = t; });
        });
      }, Promise.resolve());
    });
    // Article bodies are read one by one so a large export doesn't hold every page in memory twice.
    return chain.then(function () {
      var bySlug = {};
      contentEntries.forEach(function (e) { bySlug[slugOf(e.name, /\.htm$/i.test(e.name) ? '.htm' : '.html')] = e; });
      var all = [].concat.apply([], lists);
      return all.reduce(function (p, m) {
        return p.then(function () {
          var slug = m && str(m.slug);
          var entry = slug && bySlug[slug];
          var read = entry ? zip.readText(entry).catch(function () {
            error(plan, 'The saved page for "' + cleanText(m.title, 80) + '" could not be read.');
            return null;
          }) : Promise.resolve(null);
          return read.then(function (html) {
            var one = { content: {}, highlights: files.highlights };
            if (html != null) one.content[slug] = html;
            parseOmnivoreMeta(plan, [m], one);
          });
        });
      }, Promise.resolve());
    });
  }

  /* ---------------- entry points ---------------- */

  function parseByExtension(plan, name, text) {
    var ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    var head = text.slice(0, 2000).replace(/^﻿/, '').trim();
    if (ext === 'json' || (!ext && /^[\[{]/.test(head))) {
      parseJsonText(plan, text);
    } else if (ext === 'html' || ext === 'htm' || (!ext && /^</.test(head))) {
      parseHtml(plan, text);
    } else if (ext === 'csv' || ext === 'tsv') {
      var kind = parseCsvText(plan, text, null);
      if (kind && plan.source === 'unknown') plan.source = kind;
    } else {
      // .txt (or anything else): a CSV-looking file with a url header is read as CSV.
      if (/^[^\n]*\burl\b[^\n]*[,\t;]/i.test(head) && !/^https?:/i.test(head)) {
        var k = parseCsvText(plan, text, null);
        if (k && plan.source === 'unknown') plan.source = k;
      } else {
        parseTxt(plan, text);
        if (plan.source === 'unknown') plan.source = 'txt';
      }
    }
  }

  function fromFile(file) {
    var name = file && file.name ? file.name : '';
    var plan = newPlan('unknown', name);
    var ext = ((/\.([a-z0-9]+)$/i.exec(name) || [])[1] || '').toLowerCase();
    var accepted = ['zip', 'csv', 'tsv', 'html', 'htm', 'json', 'txt', ''];
    if (accepted.indexOf(ext) === -1) {
      error(plan, 'This file type (.' + ext + ') can\'t be imported. Use a .zip, .csv, .html, .json or .txt file.');
      return Promise.resolve(finish(plan));
    }
    var isZip = ext === 'zip';
    if (file.size > (isZip ? MAX_ZIP_FILE : MAX_TEXT_FILE)) {
      error(plan, 'This file is too large to import (' + Math.round(file.size / 1048576) + ' MB).');
      return Promise.resolve(finish(plan));
    }
    return file.arrayBuffer().then(function (buffer) {
      if (isZip || ZipReader.looksLikeZip(buffer)) {
        return parseZip(plan, buffer);
      }
      var text = new TextDecoder('utf-8').decode(buffer);
      parseByExtension(plan, name, text);
    }).catch(function (err) {
      error(plan, err && err.message ? err.message : 'The file could not be read.');
    }).then(function () {
      if (plan.source === 'unknown') plan.source = 'csv';
      return finish(plan);
    });
  }

  var ImportSources = {
    fromFile: fromFile,
    normalizeUrl: normalizeUrl,
    articleFromHtml: articleFromHtml,
    omnivoreHighlights: omnivoreHighlights,
    toMs: toMs,
    WPM: WPM,
    MAX_ITEMS: MAX_ITEMS
  };
  if (typeof self !== 'undefined') self.ImportSources = ImportSources;
  if (typeof window !== 'undefined') window.ImportSources = ImportSources;
})();
