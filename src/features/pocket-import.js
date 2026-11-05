/* ReadLater Pro - HTML import parser (Pocket legacy export + Netscape bookmarks).
 *
 *   PocketImport.parse(html) -> { articles, tags, errors, kind, skippedInvalid }
 *   articles: [{ url, title, savedAt, isRead, tags[] }]
 *   kind: "pocket" (Pocket's ril_export.html) or "bookmarks" (Chrome, Firefox,
 *         Safari, Raindrop, Pinboard and any other Netscape bookmarks file)
 *
 * Pocket: links after an "Read Archive" heading are read, tags come from the
 * comma-separated TAGS attribute. Bookmarks: every folder on the path to a
 * link becomes a tag (the browser's own root folders are ignored), TAGS is
 * honoured, ADD_DATE is the save date, and Pinboard's TOREAD="1" marks unread
 * items when a file uses it.
 */
(function () {
  'use strict';

  var MAX_IMPORT_CHARS = 32 * 1024 * 1024;
  var MAX_DOC_NODES = 1000000;
  var MAX_IMPORT_LINKS = 50000;
  var MAX_TAGS_PER_ARTICLE = 20;
  var MAX_TAG_LENGTH = 50;
  var MAX_TITLE_LENGTH = 300;
  var MAX_URL_LENGTH = 2048;
  var MAX_ERRORS = 50;
  var MAX_EPOCH_SECONDS = 99999999999;

  var ROOT_FOLDERS = /^(bookmarks|bookmarks bar|bookmarks toolbar|bookmarks menu|bookmark bar|other bookmarks|mobile bookmarks|favorites|favorites bar|favourites|favourites bar|imported|unsorted|reading list|menu|toolbar|unfiled bookmarks)$/i;

  function sanitizer() {
    if (typeof self !== 'undefined' && self.Sanitize) return self.Sanitize;
    if (typeof window !== 'undefined' && window.Sanitize) return window.Sanitize;
    return null;
  }

  function cleanText(value, max) {
    var s = sanitizer();
    if (s && typeof s.sanitizeInput === 'function') return s.sanitizeInput(String(value == null ? '' : value), { maxLength: max });
    var out = String(value == null ? '' : value)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/<[^>]*>/g, '')
      .trim();
    return out.length > max ? out.substring(0, max) : out;
  }

  function cleanUrl(href) {
    if (typeof href !== 'string') return '';
    href = href.trim();
    if (!href || href.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(href)) return '';
    try {
      var u = new URL(href);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  function addTags(list, raw, seen) {
    raw.forEach(function (name) {
      if (list.length >= MAX_TAGS_PER_ARTICLE) return;
      var tag = cleanText(name, MAX_TAG_LENGTH).toLowerCase();
      if (tag && list.indexOf(tag) === -1) {
        list.push(tag);
        seen[tag] = true;
      }
    });
    return list;
  }

  function isReadHeading(text) {
    if (text.indexOf('unread') !== -1) return false;
    return text.indexOf('archive') !== -1 || /(^|\s)read(\s|$)/.test(text);
  }

  // Folder names on the path from the link up to the document root.
  function folderPath(a) {
    var names = [];
    var el = a.parentElement;
    while (el && el.tagName !== 'BODY') {
      if (el.tagName === 'DL') {
        var h = null;
        var prev = el.previousElementSibling;
        if (prev && prev.tagName === 'H3') h = prev;
        else if (el.parentElement && el.parentElement.tagName === 'DT') {
          h = el.parentElement.querySelector(':scope > h3');
        }
        if (h) {
          var isRoot = h.hasAttribute('personal_toolbar_folder') || h.hasAttribute('unfiled_bookmarks_folder');
          var name = (h.textContent || '').trim();
          if (name && !isRoot && !ROOT_FOLDERS.test(name)) names.unshift(name);
        }
      }
      el = el.parentElement;
    }
    return names;
  }

  function epochMs(value) {
    var n = parseInt(value, 10);
    if (!isFinite(n) || n < 1) return 0;
    if (n > MAX_EPOCH_SECONDS) n = Math.floor(n / 1000); // microseconds/milliseconds in some exports
    if (n > MAX_EPOCH_SECONDS) n = Math.floor(n / 1000);
    return n * 1000;
  }

  function detectKind(doc, html) {
    var title = (doc.title || '').toLowerCase();
    if (/netscape-bookmark-file/i.test(html.slice(0, 2000))) return 'bookmarks';
    if (title.indexOf('pocket') !== -1) return 'pocket';
    var heads = doc.querySelectorAll('h1');
    for (var i = 0; i < heads.length; i++) {
      var t = (heads[i].textContent || '').toLowerCase().trim();
      if (t === 'unread' || t === 'read archive') return 'pocket';
    }
    return doc.querySelector('dl h3, dt > h3') ? 'bookmarks' : (doc.querySelector('a[time_added]') ? 'pocket' : 'bookmarks');
  }

  function parse(html) {
    var empty = { articles: [], tags: [], errors: [], kind: 'bookmarks', skippedInvalid: 0 };
    if (!html || typeof html !== 'string') {
      empty.errors.push('The file is empty.');
      return empty;
    }
    if (html.length > MAX_IMPORT_CHARS) {
      empty.errors.push('This file is too large to import (over 32 MB). Split it into smaller files and try again.');
      return empty;
    }
    var doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc || !doc.body) {
      empty.errors.push('This file could not be read as HTML.');
      return empty;
    }
    var kind = detectKind(doc, html);
    var errors = [];
    var seenTags = {};
    var articles = [];
    var skippedInvalid = 0;

    // Pocket marks read items by putting them after a "Read Archive" heading.
    var readStart = null;
    if (kind === 'pocket') {
      var heads = doc.querySelectorAll('h1, h2');
      for (var h = 0; h < heads.length; h++) {
        if (isReadHeading((heads[h].textContent || '').toLowerCase().trim())) { readStart = heads[h]; break; }
      }
    }
    var links = doc.querySelectorAll('a[href]');
    if (doc.querySelectorAll('*').length > MAX_DOC_NODES) {
      errors.push('This file is very large; only part of it was read.');
    }
    var usesToRead = kind === 'bookmarks' && !!doc.querySelector('a[toread]');
    var max = Math.min(links.length, MAX_IMPORT_LINKS);
    for (var i = 0; i < max; i++) {
      var a = links[i];
      var href = a.getAttribute('href');
      try {
        var url = cleanUrl(href);
        if (!url) { skippedInvalid++; continue; }
        var title = cleanText(a.textContent || '', MAX_TITLE_LENGTH) || url;
        var savedAt = epochMs(a.getAttribute('time_added') || a.getAttribute('add_date')) || Date.now();
        var isRead = false;
        if (kind === 'pocket' && readStart) {
          isRead = !!(readStart.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
        } else if (usesToRead) {
          isRead = a.getAttribute('toread') !== '1';
        }
        var tags = [];
        var attr = a.getAttribute('tags');
        if (attr) addTags(tags, attr.split(','), seenTags);
        if (kind === 'bookmarks') addTags(tags, folderPath(a), seenTags);
        articles.push({ url: url, title: title, savedAt: savedAt, isRead: isRead, tags: tags });
      } catch (err) {
        if (errors.length < MAX_ERRORS) {
          errors.push('Could not read the link ' + (href || '(no address)') + ': ' + (err && err.message ? err.message : 'unknown error'));
        }
      }
    }
    if (links.length > MAX_IMPORT_LINKS) {
      errors.push('Only the first ' + MAX_IMPORT_LINKS + ' links in this file were read.');
    }
    return { articles: articles, tags: Object.keys(seenTags).sort(), errors: errors, kind: kind, skippedInvalid: skippedInvalid };
  }

  var PocketImport = {
    parse: parse,
    MAX_IMPORT_CHARS: MAX_IMPORT_CHARS,
    MAX_IMPORT_LINKS: MAX_IMPORT_LINKS,
    MAX_TAGS_PER_ARTICLE: MAX_TAGS_PER_ARTICLE
  };
  if (typeof self !== 'undefined') self.PocketImport = PocketImport;
  if (typeof window !== 'undefined') window.PocketImport = PocketImport;
})();
