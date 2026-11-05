/* ReadLater Pro - Settings > Data > Export (1.3.0).
 *
 * Every file is built in this page and saved with Blob + <a download>:
 *   backup     full JSON backup: articles with their text, tags, the article -> tag
 *              mapping, highlights and reader settings. Restore it from Import.
 *   markdown   one .md file, front matter per article, text converted to Markdown,
 *              highlights and notes underneath.
 *   highlights every highlight and note, grouped by article (Obsidian / Readwise).
 *   bookmarks  Netscape bookmarks HTML with TAGS, ADD_DATE and Pinboard's TOREAD.
 *   csv        Pocket's columns: title,url,time_added,tags,status (tags pipe-separated).
 * Exports never contain license data (B21).
 */
(function () {
  'use strict';

  var READER_KEYS = ['readerTheme', 'readerFontSize', 'readerWidth', 'readerFontFamily', 'readerLineHeight', 'ttsRate', 'ttsVoice', 'openArticlesIn'];
  var SECRET_KEYS = /^(licenseDataPlain|licenseData|licenseKey|license_key)$/i;

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

  function send(action, payload, timeout) {
    return MessageHelper.send(action, payload, timeout || 60000).then(function (res) {
      if (res && res.success) return res.data;
      throw new Error((res && res.error) || 'Request failed');
    });
  }

  /** Deep copy without any license fields, at any depth. */
  function stripSecrets(value) {
    if (Array.isArray(value)) return value.map(stripSecrets);
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) {
        if (SECRET_KEYS.test(k)) return;
        out[k] = stripSecrets(value[k]);
      });
      return out;
    }
    return value;
  }

  function today() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isoDate(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n <= 0) return '';
    try { return new Date(n).toISOString(); } catch (e) { return ''; }
  }

  function download(text, name, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  /* ---------------- data ---------------- */

  function getArticles(withContent) {
    var opts = { limit: 100000 };
    if (!withContent) {
      opts.fields = ['id', 'url', 'title', 'excerpt', 'domain', 'savedAt', 'isRead', 'isFavorite', 'readAt', 'estimatedReadTime', 'wordCount', 'byline'];
    }
    return send('GET_ARTICLES', opts, 120000).then(function (d) {
      return Array.isArray(d) ? d : (d && d.articles) || [];
    });
  }

  /** { tags: [tag], byArticle: { articleId: [names] } } from GET_TAGS + GET_ARTICLES_BY_TAG. */
  function getTagMap() {
    return send('GET_TAGS').then(function (tags) {
      tags = Array.isArray(tags) ? tags : [];
      var byArticle = {};
      return tags.reduce(function (p, tag) {
        return p.then(function () {
          return send('GET_ARTICLES_BY_TAG', { tagId: tag.id, fields: ['id'] }).then(function (list) {
            (list || []).forEach(function (a) {
              (byArticle[a.id] = byArticle[a.id] || []).push(tag.name);
            });
          });
        });
      }, Promise.resolve()).then(function () {
        Object.keys(byArticle).forEach(function (k) { byArticle[k].sort(); });
        return { tags: tags, byArticle: byArticle };
      });
    });
  }

  function getHighlights() {
    if (typeof HighlightsStore === 'undefined') return Promise.resolve({});
    return HighlightsStore.getAll();
  }

  function pick(list, which) {
    if (which === 'unread') return list.filter(function (a) { return !a.isRead; });
    if (which === 'favorites') return list.filter(function (a) { return a.isFavorite; });
    return list;
  }

  /* ---------------- formats ---------------- */

  function buildBackup() {
    return Promise.all([getArticles(true), getTagMap(), getHighlights(), send('GET_SETTINGS').catch(function () { return {}; })]).then(function (r) {
      var articles = r[0];
      var tm = r[1];
      var settings = {};
      READER_KEYS.forEach(function (k) { if (r[3] && k in r[3]) settings[k] = r[3][k]; });
      var hlCount = 0;
      Object.keys(r[2]).forEach(function (k) { hlCount += (r[2][k].items || []).length; });
      var data = {
        format: 'readlater-pro-backup',
        formatVersion: 2,
        app: 'ReadLater Pro',
        version: chrome.runtime.getManifest().version,
        exportedAt: new Date().toISOString(),
        counts: { articles: articles.length, tags: tm.tags.length, highlights: hlCount },
        articles: articles.map(function (a) { return Object.assign({}, a, { tags: tm.byArticle[a.id] || [] }); }),
        tags: tm.tags,
        articleTags: tm.byArticle,
        highlights: r[2],
        readerSettings: settings
      };
      return {
        text: JSON.stringify(stripSecrets(data), null, 2),
        name: 'readlater-pro-backup-' + today() + '.json',
        type: 'application/json',
        count: articles.length
      };
    });
  }

  function yamlString(s) {
    return JSON.stringify(String(s == null ? '' : s));
  }

  function highlightBlock(items) {
    var lines = [];
    items.forEach(function (h) {
      lines.push('');
      String(h.text || '').split(/\n+/).forEach(function (p) { lines.push('> ' + p); });
      if (h.note) { lines.push(''); lines.push(h.note); }
    });
    return lines.join('\n');
  }

  function buildMarkdown(which, images) {
    return Promise.all([getArticles(true), getTagMap(), getHighlights()]).then(function (r) {
      var articles = pick(r[0], which);
      var tm = r[1];
      var hl = r[2];
      var parts = [];
      parts.push('# ReadLater Pro: ' + t('dataExportMdTitle', 'my reading list'));
      parts.push('');
      parts.push(t('dataExportMdIntro', 'Exported $1. $2 articles.', [today(), num(articles.length)]));
      articles.forEach(function (a) {
        var tags = tm.byArticle[a.id] || [];
        parts.push('');
        parts.push('---');
        parts.push('title: ' + yamlString(a.title || 'Untitled'));
        parts.push('url: ' + yamlString(a.url));
        parts.push('saved: ' + (isoDate(a.savedAt).slice(0, 10) || ''));
        parts.push('tags: [' + tags.map(yamlString).join(', ') + ']');
        parts.push('read: ' + (a.isRead ? 'true' : 'false'));
        if (a.isFavorite) parts.push('favorite: true');
        if (a.byline) parts.push('author: ' + yamlString(a.byline));
        parts.push('---');
        parts.push('');
        parts.push('# ' + ExportMarkdown.escape(String(a.title || 'Untitled').replace(/\s+/g, ' ')));
        parts.push('');
        var body = a.content ? ExportMarkdown.fromHtml(a.content, { images: images }) : '';
        if (!body && a.textContent) body = ExportMarkdown.escape(String(a.textContent).trim());
        if (!body && a.excerpt) body = ExportMarkdown.escape(a.excerpt);
        parts.push(body || '*' + t('dataExportMdNoText', 'No saved text. Read it at the link above.') + '*');
        var items = hl[a.id] && hl[a.id].items;
        if (items && items.length) {
          parts.push('');
          parts.push('## ' + t('dataExportMdHighlights', 'Highlights'));
          parts.push(highlightBlock(items));
        }
      });
      return {
        text: parts.join('\n') + '\n',
        name: 'readlater-pro-articles-' + today() + '.md',
        type: 'text/markdown',
        count: articles.length
      };
    });
  }

  function buildHighlights() {
    return Promise.all([getHighlights(), getArticles(false), getTagMap()]).then(function (r) {
      var hl = r[0];
      var byId = {};
      r[1].forEach(function (a) { byId[a.id] = a; });
      var keys = Object.keys(hl).filter(function (k) { return hl[k] && hl[k].items && hl[k].items.length; });
      keys.sort(function (a, b) { return (hl[b].updatedAt || 0) - (hl[a].updatedAt || 0); });
      var total = 0;
      var parts = ['# ' + t('dataExportHlTitle', 'Highlights from ReadLater Pro'), '', t('dataExportMdIntro', 'Exported $1. $2 articles.', [today(), num(keys.length)])];
      keys.forEach(function (k) {
        var e = hl[k];
        var a = byId[k] || {};
        var items = e.items.slice().sort(function (x, y) { return (x.createdAt || 0) - (y.createdAt || 0); });
        total += items.length;
        parts.push('');
        parts.push('## ' + String(a.title || e.title || 'Untitled').replace(/\s+/g, ' '));
        parts.push('');
        var meta = [];
        var url = a.url || e.url;
        if (url) meta.push('- URL: ' + url);
        if (a.byline) meta.push('- Author: ' + a.byline);
        var tags = r[2].byArticle[k] || [];
        if (tags.length) meta.push('- Tags: ' + tags.map(function (x) { return '#' + x.replace(/\s+/g, '-'); }).join(' '));
        if (a.savedAt) meta.push('- Saved: ' + isoDate(a.savedAt).slice(0, 10));
        parts.push(meta.join('\n'));
        parts.push(highlightBlock(items));
      });
      return {
        text: parts.join('\n') + '\n',
        name: 'readlater-pro-highlights-' + today() + '.md',
        type: 'text/markdown',
        count: total,
        unit: 'highlights'
      };
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildBookmarks(which) {
    return Promise.all([getArticles(false), getTagMap()]).then(function (r) {
      var articles = pick(r[0], which);
      var lines = [
        '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
        '<!-- This is an automatically generated file.',
        '     It will be read and overwritten.',
        '     DO NOT EDIT! -->',
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        '<TITLE>Bookmarks</TITLE>',
        '<H1>Bookmarks</H1>',
        '<DL><p>'
      ];
      articles.forEach(function (a) {
        var tags = r[1].byArticle[a.id] || [];
        var attrs = 'HREF="' + esc(a.url) + '" ADD_DATE="' + Math.floor((Number(a.savedAt) || Date.now()) / 1000) + '"';
        if (tags.length) attrs += ' TAGS="' + esc(tags.join(',')) + '"';
        attrs += ' TOREAD="' + (a.isRead ? '0' : '1') + '"';
        lines.push('    <DT><A ' + attrs + '>' + esc(a.title || a.url) + '</A>');
        if (a.excerpt) lines.push('    <DD>' + esc(String(a.excerpt).replace(/\s+/g, ' ')));
      });
      lines.push('</DL><p>');
      return {
        text: lines.join('\n') + '\n',
        name: 'readlater-pro-bookmarks-' + today() + '.html',
        type: 'text/html',
        count: articles.length
      };
    });
  }

  function buildCsv(which) {
    return Promise.all([getArticles(false), getTagMap()]).then(function (r) {
      var articles = pick(r[0], which);
      var rows = [['title', 'url', 'time_added', 'tags', 'status']];
      articles.forEach(function (a) {
        rows.push([
          String(a.title || '').replace(/\s+/g, ' '),
          a.url,
          String(Math.floor((Number(a.savedAt) || 0) / 1000)),
          (r[1].byArticle[a.id] || []).join('|'),
          a.isRead ? 'archive' : 'unread'
        ]);
      });
      return {
        text: '﻿' + ImportCsv.stringify(rows),
        name: 'readlater-pro-pocket-format-' + today() + '.csv',
        type: 'text/csv',
        count: articles.length
      };
    });
  }

  var BUILDERS = {
    backup: function () { return buildBackup(); },
    markdown: function (o) { return buildMarkdown(o.which, o.images); },
    highlights: function () { return buildHighlights(); },
    bookmarks: function (o) { return buildBookmarks(o.which); },
    csv: function (o) { return buildCsv(o.which); }
  };

  /* ---------------- UI ---------------- */

  function selected(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function sync() {
    var format = selected('export-format');
    var whichRow = document.getElementById('export-which-row');
    var imgRow = document.getElementById('export-images-row');
    if (whichRow) whichRow.hidden = format === 'backup' || format === 'highlights';
    if (imgRow) imgRow.hidden = format !== 'markdown';
  }

  function run() {
    var btn = document.getElementById('btn-export-run');
    var status = document.getElementById('export-status');
    var format = selected('export-format') || 'backup';
    var whichEl = document.getElementById('export-which');
    var imgEl = document.getElementById('export-images');
    var opts = { which: whichEl ? whichEl.value : 'all', images: imgEl ? imgEl.checked : true };
    // Markdown formats are Pro, with one free try for everyone (limits-config.json
    // markdown_export + firstTouchGrace). Every other format stays free.
    var gated = (format === 'markdown' || format === 'highlights') && typeof FeatureGate !== 'undefined' && FeatureGate.gateFeature;
    build(format, opts, btn, status, gated);
  }

  // Asked only once the file has something in it, so an empty export never uses up the free try.
  function gate(status) {
    return new Promise(function (resolve) {
      FeatureGate.gateFeature('markdown_export', function () { resolve(true); }, {
        onBlocked: function () {
          status.className = 'export-status export-status-error';
          status.textContent = t('proExportBlocked', 'Markdown export is part of Pro. Your free try has been used. The full backup, bookmarks and CSV exports stay free.');
          if (typeof Paywall !== 'undefined' && Paywall.show) Paywall.show(t('proExportFeature', 'Markdown export'), { featureId: 'markdown_export', surface: 'options' });
          resolve(false);
        }
      });
    });
  }

  function build(format, opts, btn, status, gated) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    status.className = 'export-status';
    status.textContent = t('dataExportWorking', 'Preparing your file...');
    BUILDERS[format](opts).then(function (file) {
      if (!file.count && format !== 'backup') {
        status.textContent = format === 'highlights'
          ? t('dataExportNoHighlights', 'There are no highlights to export yet.')
          : t('dataExportNothing', 'There are no articles to export with this choice.');
        return;
      }
      return (gated ? gate(status) : Promise.resolve(true)).then(function (allowed) {
        if (!allowed) return;
        download(file.text, file.name, file.type);
        status.className = 'export-status export-status-ok';
        status.textContent = file.unit === 'highlights'
          ? t('dataExportDoneHighlights', 'Saved $1 highlights to $2', [num(file.count), file.name])
          : t('dataExportDone', 'Saved $1 articles to $2', [num(file.count), file.name]);
      });
    }).catch(function (err) {
      status.className = 'export-status export-status-error';
      status.textContent = t('dataExportFailed', 'The export didn\'t work: $1', [err && err.message ? err.message : String(err)]);
    }).then(function () {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    });
  }

  function init() {
    var btn = document.getElementById('btn-export-run');
    if (!btn) return;
    btn.addEventListener('click', run);
    document.querySelectorAll('input[name="export-format"]').forEach(function (r) { r.addEventListener('change', sync); });
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ExportCard = { stripSecrets: stripSecrets, build: BUILDERS };
})();
