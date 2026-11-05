/* ReadLater Pro - highlights and notes in the reader (1.3.0).
 *
 * Highlights are stored by HighlightsStore (../shared/highlights-store.js) as
 * a quote plus up to 32 characters of context on each side. They are found
 * again in the rendered body through a whitespace-collapsed text index, so a
 * re-saved copy of the page with different markup or spacing still matches.
 * A quote that can't be found stays in the list, marked "not found in this
 * copy". Nothing here ever deletes a highlight without the user asking.
 */
(function () {
  'use strict';

  var App = window.ReaderApp;
  if (!App || typeof HighlightsStore === 'undefined') return;

  var t = App.t;
  var COLORS = ['yellow', 'green', 'blue', 'pink'];
  var CTX = 32;
  var BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|CAPTION|FIGURE|FIGCAPTION|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|NAV|DL|DT|DD|HR|ADDRESS|DETAILS|SUMMARY|MAIN)$/;
  var NO_INLINE = /^(UL|OL|TABLE|THEAD|TBODY|TFOOT|TR|DL|COLGROUP)$/;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  var body = null;
  var article = null;
  var items = [];
  var placed = {};
  var pendingAdd = {};
  var pendingRemove = {};
  var index = null;
  var lastColor = 'yellow';

  var pop = null;
  var popMode = null;
  var popId = null;
  var noteBox = null;
  var noteFor = null;
  var toastTimer = null;
  var toastAction = null;

  var btn = document.getElementById('btn-highlights');
  var badge = document.getElementById('hl-badge');
  var drawer = document.getElementById('hl-drawer');
  var list = document.getElementById('hl-list');
  var emptyEl = document.getElementById('hl-empty');
  var countEl = document.getElementById('hl-count');
  var actionsEl = document.getElementById('hl-actions');

  function colorName(c) {
    return {
      yellow: t('readerHlColorYellow', 'Yellow'),
      green: t('readerHlColorGreen', 'Green'),
      blue: t('readerHlColorBlue', 'Blue'),
      pink: t('readerHlColorPink', 'Pink')
    }[c] || c;
  }

  function meta() {
    return { title: (article && article.title) || '', url: (article && article.url) || '' };
  }

  function byId(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function cssId(id) {
    return window.CSS && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&');
  }

  function marksFor(id) {
    return body ? body.querySelectorAll('mark.rl-hl[data-hl-id="' + cssId(id) + '"]') : [];
  }

  // ---------------------------------------------------------------------------
  // Text index. One normalized character per visible run: whitespace collapses
  // to a single space, typographic quotes and dashes fold to ASCII, and block
  // boundaries count as a space so "end.Start" across paragraphs still reads
  // as "end. Start", which is what Selection.toString() and imports produce.

  function fold(c) {
    switch (c) {
      case '\u2018': case '\u2019': case '\u201A': case '\u201B': case '\u2032': return "'";
      case '\u201C': case '\u201D': case '\u201E': case '\u201F': case '\u2033': return '"';
      case '\u2010': case '\u2011': case '\u2012': case '\u2013': case '\u2014': case '\u2212': return '-';
      case '\u00AD': case '\u200B': case '\u200C': case '\u200D': case '\uFEFF': return '';
    }
    return c;
  }

  function isSpace(c) {
    return c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f' || c === '\u00A0' ||
      c === '\u2009' || c === '\u202F' || c === '\u2007' || c === '\u3000' || (c > '\u1fff' && c < '\u200b');
  }

  function normalize(str, keepEdges) {
    var out = '';
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      var c = fold(s.charAt(i));
      if (!c) continue;
      if (isSpace(c)) {
        if (out.charAt(out.length - 1) !== ' ') out += ' ';
      } else {
        out += c;
      }
    }
    return keepEdges ? out : out.trim();
  }

  function blockOf(node) {
    var n = node.parentNode;
    while (n && n !== body && !(n.nodeType === 1 && BLOCK.test(n.tagName))) n = n.parentNode;
    return n;
  }

  function buildIndex() {
    var chars = [];
    var nodes = [];
    var offs = [];
    var brk = [];
    var tnodes = [];
    var maps = new Map();
    var lastBlock = null;
    var pending = false;
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    var n;
    function push(c, node, off, isBreak) {
      chars.push(c);
      nodes.push(node);
      offs.push(off);
      brk.push(!!isBreak);
    }
    while ((n = walker.nextNode())) {
      if (n.nodeType === 1) {
        if (n.tagName === 'BR' || n.tagName === 'HR' || n.tagName === 'IMG') pending = true;
        continue;
      }
      var text = n.nodeValue;
      if (!text) continue;
      var blk = blockOf(n);
      if (blk !== lastBlock) {
        if (lastBlock !== null) pending = true;
        lastBlock = blk;
      }
      var map = new Array(text.length + 1);
      for (var j = 0; j < text.length; j++) {
        map[j] = chars.length;
        var c = fold(text.charAt(j));
        if (!c) continue;
        var last = chars.length ? chars[chars.length - 1] : null;
        if (isSpace(c)) {
          if (last !== null && last !== ' ') push(' ', n, j, pending);
          else if (last === ' ' && pending) brk[brk.length - 1] = true;
          if (last !== null) pending = false;
          continue;
        }
        if (pending && last !== null) {
          if (last !== ' ') push(' ', n, j, true);
          else brk[brk.length - 1] = true;
          map[j] = chars.length;
        }
        pending = false;
        push(c, n, j, false);
      }
      map[text.length] = chars.length;
      maps.set(n, map);
      tnodes.push(n);
    }
    var str = chars.join('');
    var lower = str.toLowerCase();
    return {
      text: str,
      lower: lower.length === str.length ? lower : null,
      nodes: nodes,
      offs: offs,
      brk: brk,
      tnodes: tnodes,
      maps: maps
    };
  }

  function getIndex() {
    if (!index) index = buildIndex();
    return index;
  }

  function findAll(hay, needle) {
    var out = [];
    if (!needle) return out;
    var i = hay.indexOf(needle);
    while (i !== -1 && out.length < 500) {
      out.push(i);
      i = hay.indexOf(needle, i + 1);
    }
    return out;
  }

  function contextScore(ix, at, end, prefix, suffix) {
    var score = 0;
    var i;
    for (i = 1; i <= prefix.length && at - i >= 0; i++) {
      if (ix.text.charAt(at - i) !== prefix.charAt(prefix.length - i)) break;
      score++;
    }
    for (i = 0; i < suffix.length && end + i < ix.text.length; i++) {
      if (ix.text.charAt(end + i) !== suffix.charAt(i)) break;
      score++;
    }
    return score;
  }

  /** Where is this highlight in the current body? {s, e} in index space, or null. */
  function locate(h, ix) {
    var q = normalize(h.text);
    if (!q) return null;
    var hits = findAll(ix.text, q);
    if (!hits.length && ix.lower) hits = findAll(ix.lower, q.toLowerCase());
    if (!hits.length) return null;
    var best = hits[0];
    if (hits.length > 1) {
      var pre = normalize(h.prefix, true);
      var suf = normalize(h.suffix, true);
      var top = -1;
      for (var i = 0; i < hits.length; i++) {
        var sc = contextScore(ix, hits[i], hits[i] + q.length, pre, suf);
        if (sc > top) { top = sc; best = hits[i]; }
      }
    }
    return { s: best, e: best + q.length };
  }

  function trimSpan(ix, s, e) {
    while (s < e && ix.text.charAt(s) === ' ') s++;
    while (e > s && ix.text.charAt(e - 1) === ' ') e--;
    return { s: s, e: e };
  }

  /** Wrap index range [s, e) in <mark> elements, one per text node segment. */
  function wrap(s, e, h) {
    var ix = getIndex();
    var sp = trimSpan(ix, s, e);
    if (sp.s >= sp.e) return [];
    var startNode = ix.nodes[sp.s];
    var startOff = ix.offs[sp.s];
    var endNode = ix.nodes[sp.e - 1];
    var endOff = ix.offs[sp.e - 1] + 1;
    var i0 = ix.tnodes.indexOf(startNode);
    var i1 = ix.tnodes.indexOf(endNode);
    var marks = [];
    for (var k = i0; k >= 0 && k <= i1; k++) {
      var node = ix.tnodes[k];
      var len = node.nodeValue.length;
      var a = k === i0 ? startOff : 0;
      var b = k === i1 ? endOff : len;
      if (a >= b) continue;
      var parent = node.parentNode;
      if (!parent) continue;
      if (!node.nodeValue.slice(a, b).trim() && (NO_INLINE.test(parent.tagName) || parent === body)) continue;
      if (b < len) node.splitText(b);
      var target = a > 0 ? node.splitText(a) : node;
      var m = document.createElement('mark');
      m.className = 'rl-hl rl-hl-' + h.color;
      m.setAttribute('data-hl-id', h.id);
      target.parentNode.insertBefore(m, target);
      m.appendChild(target);
      marks.push(m);
    }
    index = null;
    decorate(h);
    return marks;
  }

  function unwrap(id) {
    var ms = marksFor(id);
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      var p = m.parentNode;
      if (!p) continue;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    }
    index = null;
  }

  /** Color, note marker and tooltip on a highlight's marks. */
  function decorate(h) {
    var ms = marksFor(h.id);
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      COLORS.forEach(function (c) { m.classList.toggle('rl-hl-' + c, c === h.color); });
      m.classList.toggle('rl-hl-noted', !!h.note && i === ms.length - 1);
      if (h.note) m.title = h.note;
      else m.removeAttribute('title');
    }
  }

  function place(h) {
    var at = locate(h, getIndex());
    if (!at) { placed[h.id] = -1; return false; }
    placed[h.id] = at.s;
    wrap(at.s, at.e, h);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Selection

  function selectionRange() {
    var sel = window.getSelection();
    if (!body || !sel || sel.isCollapsed || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if (!r.intersectsNode(body)) return null;
    r = r.cloneRange();
    if (!body.contains(r.startContainer)) r.setStart(body, 0);
    if (!body.contains(r.endContainer)) r.setEnd(body, body.childNodes.length);
    if (r.collapsed) return null;
    return r;
  }

  function pointToIndex(ix, container, offset) {
    if (container.nodeType === 3) {
      var map = ix.maps.get(container);
      if (map) return map[Math.min(offset, map.length - 1)];
      return firstAfter(ix, container, true);
    }
    if (offset < container.childNodes.length) return firstAfter(ix, container.childNodes[offset], false);
    return firstAfter(ix, container, true);
  }

  // Index of the first text node at or after `node` (or strictly after it and
  // its subtree when `skipInside`).
  function firstAfter(ix, node, skipInside) {
    for (var i = 0; i < ix.tnodes.length; i++) {
      var tn = ix.tnodes[i];
      if (tn === node && !skipInside) return ix.maps.get(tn)[0];
      var pos = node.compareDocumentPosition(tn);
      if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) {
        if (!skipInside) return ix.maps.get(tn)[0];
      } else if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
        return ix.maps.get(tn)[0];
      }
    }
    return ix.text.length;
  }

  function quoteOf(ix, s, e) {
    var out = '';
    for (var i = s; i < e; i++) out += ix.brk[i] ? '\n' : ix.text.charAt(i);
    return out.replace(/ ?\n ?/g, '\n').trim();
  }

  function selectionSpan() {
    var r = selectionRange();
    if (!r) return null;
    var ix = getIndex();
    var s = pointToIndex(ix, r.startContainer, r.startOffset);
    var e = pointToIndex(ix, r.endContainer, r.endOffset);
    var sp = trimSpan(ix, Math.min(s, e), Math.max(s, e));
    if (sp.s >= sp.e) return null;
    return sp;
  }

  function createFromSelection(color, thenNote) {
    var sp = selectionSpan();
    if (!sp || !article) return null;
    var ix = getIndex();
    var h = {
      id: HighlightsStore.newId(),
      text: quoteOf(ix, sp.s, sp.e),
      prefix: ix.text.slice(Math.max(0, sp.s - CTX), sp.s),
      suffix: ix.text.slice(sp.e, sp.e + CTX),
      color: color || lastColor,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: 'reader'
    };
    lastColor = h.color;
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    items.push(h);
    placed[h.id] = sp.s;
    wrap(sp.s, sp.e, h);
    pendingAdd[h.id] = true;
    hidePop();
    refresh();
    HighlightsStore.add(article.id, meta(), h).then(function (saved) {
      delete pendingAdd[h.id];
      if (saved) h.updatedAt = saved.updatedAt;
      App.touchUpdated();
    }).catch(function (err) {
      delete pendingAdd[h.id];
      console.warn('[Reader] Failed to save highlight:', err);
      unwrap(h.id);
      items = items.filter(function (x) { return x.id !== h.id; });
      refresh();
      App.tip(t('readerHlSaveFailed', "Couldn't save the highlight. Try again."));
    });
    if (thenNote) openNote(h.id);
    return h;
  }

  // ---------------------------------------------------------------------------
  // Floating toolbar

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function buildPop() {
    pop = el('div', 'rl-hl-pop');
    pop.setAttribute('role', 'toolbar');
    pop.setAttribute('aria-label', t('readerHlToolbar', 'Highlight'));
    pop.hidden = true;
    COLORS.forEach(function (c) {
      var b = el('button', 'rl-swatch rl-swatch-' + c);
      b.type = 'button';
      b.setAttribute('data-color', c);
      b.setAttribute('aria-label', t('readerHlColorAria', 'Highlight $1', [colorName(c)]));
      b.title = colorName(c) + (c === 'yellow' ? ' (H)' : '');
      pop.appendChild(b);
    });
    pop.appendChild(el('span', 'rl-hl-pop-sep'));
    var note = el('button', 'rl-hl-pop-btn', t('readerHlAddNote', 'Add note'));
    note.type = 'button';
    note.setAttribute('data-act', 'note');
    var copy = el('button', 'rl-hl-pop-btn', t('readerHlCopy', 'Copy'));
    copy.type = 'button';
    copy.setAttribute('data-act', 'copy');
    var del = el('button', 'rl-hl-pop-btn rl-hl-pop-del', t('readerHlDelete', 'Delete'));
    del.type = 'button';
    del.setAttribute('data-act', 'delete');
    pop.appendChild(note);
    pop.appendChild(copy);
    pop.appendChild(del);
    // Keep the text selection alive while clicking the toolbar.
    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pop.addEventListener('click', onPopClick);
    pop.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var bs = Array.prototype.filter.call(pop.querySelectorAll('button'), function (b) { return !b.hidden; });
      var i = bs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length].focus();
    });
    document.body.appendChild(pop);
  }

  function onPopClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    var color = b.getAttribute('data-color');
    var act = b.getAttribute('data-act');
    if (popMode === 'selection') {
      if (color) createFromSelection(color);
      else if (act === 'note') createFromSelection(lastColor, true);
      else if (act === 'copy') {
        var sel = window.getSelection();
        copyText(sel ? sel.toString().trim() : '');
        hidePop();
      }
      return;
    }
    var h = byId(popId);
    if (!h) { hidePop(); return; }
    if (color) { setColor(h, color); return; }
    if (act === 'note') { var id = h.id; hidePop(); openNote(id); }
    else if (act === 'copy') { copyText(h.text); hidePop(); }
    else if (act === 'delete') { hidePop(); removeHighlight(h); }
  }

  function rectOf(target) {
    if (target && target.getBoundingClientRect) return target.getBoundingClientRect();
    if (target && target.length) {
      var a = target[0].getBoundingClientRect();
      var z = target[target.length - 1].getBoundingClientRect();
      return { top: a.top, left: Math.min(a.left, z.left), right: Math.max(a.right, z.right), bottom: z.bottom, width: Math.max(a.right, z.right) - Math.min(a.left, z.left) };
    }
    return null;
  }

  function toolbarBottom() {
    var tb = document.querySelector('.reader-toolbar');
    return tb ? tb.getBoundingClientRect().bottom : 0;
  }

  function positionFloating(node, rect, preferBelow) {
    var w = node.offsetWidth;
    var hgt = node.offsetHeight;
    var vw = document.documentElement.clientWidth;
    var gap = 8;
    var top;
    var above = rect.top - hgt - gap;
    if (!preferBelow && above > toolbarBottom() + 4) top = above;
    else top = rect.bottom + gap;
    // A selection that runs off screen still gets a toolbar the reader can see.
    top = Math.max(toolbarBottom() + gap, Math.min(top, window.innerHeight - hgt - gap));
    var left = rect.left + (rect.width || 0) / 2 - w / 2;
    left = Math.max(gap, Math.min(left, vw - w - gap));
    node.style.top = Math.round(top + window.scrollY) + 'px';
    node.style.left = Math.round(left + window.scrollX) + 'px';
  }

  function showPop(mode, id, rect, focus) {
    if (!pop) buildPop();
    popMode = mode;
    popId = id || null;
    var h = id ? byId(id) : null;
    var swatches = pop.querySelectorAll('.rl-swatch');
    for (var i = 0; i < swatches.length; i++) {
      var on = !!h && swatches[i].getAttribute('data-color') === h.color;
      swatches[i].setAttribute('aria-pressed', String(on));
    }
    pop.querySelector('[data-act="note"]').textContent = h && h.note ? t('readerHlEditNote', 'Edit note') : t('readerHlAddNote', 'Add note');
    pop.querySelector('[data-act="delete"]').hidden = mode !== 'highlight';
    pop.hidden = false;
    positionFloating(pop, rect, false);
    if (focus) {
      var first = h ? pop.querySelector('.rl-swatch[aria-pressed="true"]') : pop.querySelector('.rl-swatch');
      (first || pop.querySelector('button')).focus();
    }
  }

  function hidePop() {
    if (pop && !pop.hidden) {
      var hadFocus = pop.contains(document.activeElement);
      pop.hidden = true;
      if (hadFocus) {
        var ms = popId ? marksFor(popId) : [];
        if (!ms.length && drawerOpen()) list.focus();
      }
    }
    popMode = null;
    popId = null;
  }

  function maybeShowForSelection() {
    if (noteBox && !noteBox.hidden) return;
    var r = selectionRange();
    if (!r || !window.getSelection().toString().trim()) {
      if (popMode === 'selection') hidePop();
      return;
    }
    showPop('selection', null, r.getBoundingClientRect(), false);
  }

  function openHighlight(id, focus) {
    var ms = marksFor(id);
    if (!ms.length) return;
    showPop('highlight', id, rectOf(ms), focus);
  }

  // ---------------------------------------------------------------------------
  // Edits

  function setColor(h, color) {
    if (h.color === color) { hidePop(); return; }
    h.color = color;
    lastColor = color;
    decorate(h);
    hidePop();
    refresh();
    HighlightsStore.update(article.id, h.id, { color: color }).then(function () {
      App.touchUpdated();
    }).catch(function (err) { console.warn('[Reader] Failed to update highlight:', err); });
  }

  function saveNote(h, text) {
    var note = String(text || '').trim();
    if (note === (h.note || '')) return;
    h.note = note;
    decorate(h);
    refresh();
    HighlightsStore.update(article.id, h.id, { note: note }).then(function () {
      App.touchUpdated();
      App.tip(note ? t('readerHlNoteSaved', 'Note saved') : t('readerHlNoteRemoved', 'Note removed'));
    }).catch(function (err) {
      console.warn('[Reader] Failed to save note:', err);
      App.tip(t('readerHlSaveFailed', "Couldn't save the highlight. Try again."));
    });
  }

  function removeHighlight(h) {
    unwrap(h.id);
    items = items.filter(function (x) { return x.id !== h.id; });
    delete placed[h.id];
    pendingRemove[h.id] = true;
    refresh();
    HighlightsStore.remove(article.id, h.id).then(function () {
      delete pendingRemove[h.id];
      App.touchUpdated();
    }).catch(function (err) {
      delete pendingRemove[h.id];
      console.warn('[Reader] Failed to delete highlight:', err);
    });
    toast(t('readerHlDeleted', 'Highlight deleted'), function () { restore(h); });
  }

  function restore(h) {
    if (byId(h.id)) return;
    items.push(h);
    place(h);
    pendingAdd[h.id] = true;
    refresh();
    HighlightsStore.add(article.id, meta(), h).then(function () {
      delete pendingAdd[h.id];
      App.touchUpdated();
      App.tip(t('readerHlRestored', 'Highlight restored'));
    }).catch(function (err) {
      delete pendingAdd[h.id];
      console.warn('[Reader] Failed to restore highlight:', err);
    });
  }

  // ---------------------------------------------------------------------------
  // Note editor. Floats under the highlight; for a quote that isn't in this
  // copy it opens inside the drawer item instead.

  function buildNote() {
    noteBox = el('div', 'rl-hl-note');
    noteBox.setAttribute('role', 'dialog');
    noteBox.setAttribute('aria-label', t('readerHlNoteLabel', 'Note'));
    noteBox.hidden = true;
    var ta = el('textarea', 'rl-hl-note-input');
    ta.rows = 3;
    ta.maxLength = 20000;
    ta.setAttribute('aria-label', t('readerHlNoteLabel', 'Note'));
    ta.placeholder = t('readerHlNotePlaceholder', 'Write a note...');
    var row = el('div', 'rl-hl-note-row');
    var hint = el('span', 'rl-hl-note-hint', /Mac/i.test(navigator.platform) ? t('readerHlNoteHintMac', 'Cmd+Enter to save') : t('readerHlNoteHint', 'Ctrl+Enter to save'));
    var cancel = el('button', 'rl-btn rl-btn-quiet', t('readerHlCancel', 'Cancel'));
    cancel.type = 'button';
    var save = el('button', 'rl-btn rl-btn-primary', t('readerHlSave', 'Save'));
    save.type = 'button';
    row.appendChild(hint);
    row.appendChild(cancel);
    row.appendChild(save);
    noteBox.appendChild(ta);
    noteBox.appendChild(row);
    cancel.addEventListener('click', function () { closeNote(false); });
    save.addEventListener('click', function () { closeNote(true); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNote(false); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeNote(true); }
    });
    document.body.appendChild(noteBox);
  }

  function openNote(id, inlineHost) {
    var h = byId(id);
    if (!h) return;
    if (!noteBox) buildNote();
    closeNote(false);
    noteFor = id;
    var ta = noteBox.querySelector('textarea');
    ta.value = h.note || '';
    noteBox.classList.toggle('rl-hl-note-inline', !!inlineHost);
    if (inlineHost) {
      noteBox.style.top = noteBox.style.left = '';
      inlineHost.appendChild(noteBox);
      noteBox.hidden = false;
    } else {
      if (noteBox.parentNode !== document.body) document.body.appendChild(noteBox);
      var ms = marksFor(id);
      if (!ms.length) return;
      noteBox.hidden = false;
      var last = ms[ms.length - 1].getClientRects();
      var r = last.length ? last[last.length - 1] : ms[ms.length - 1].getBoundingClientRect();
      positionFloating(noteBox, { top: r.top, bottom: r.bottom, left: r.left, width: r.width }, true);
      var nr = noteBox.getBoundingClientRect();
      if (nr.bottom > window.innerHeight - 8 || nr.top < toolbarBottom()) {
        window.scrollBy({ top: nr.bottom - window.innerHeight + 96, behavior: 'auto' });
      }
    }
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function closeNote(save) {
    if (!noteBox || noteBox.hidden) return;
    var h = byId(noteFor);
    var id = noteFor;
    var hadFocus = noteBox.contains(document.activeElement);
    if (save && h) saveNote(h, noteBox.querySelector('textarea').value);
    noteBox.hidden = true;
    noteFor = null;
    if (noteBox.parentNode !== document.body) document.body.appendChild(noteBox);
    if (hadFocus) {
      var item = drawerOpen() && list.querySelector('[data-hl-item="' + cssId(id) + '"] .rl-hl-item-main');
      if (item) item.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Drawer

  function drawerOpen() {
    return drawer && !drawer.hidden;
  }

  function sorted() {
    return items.slice().sort(function (a, b) {
      var pa = placed[a.id];
      var pb = placed[b.id];
      var fa = typeof pa === 'number' && pa >= 0;
      var fb = typeof pb === 'number' && pb >= 0;
      if (fa && fb) return pa - pb;
      if (fa !== fb) return fa ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function refresh() {
    var n = items.length;
    if (badge) {
      badge.hidden = !n;
      badge.textContent = n > 99 ? '99+' : String(n);
    }
    if (btn) {
      var label = n ? t('readerHlButtonCount', 'Highlights ($1)', [String(n)]) : t('readerHlButton', 'Highlights');
      btn.setAttribute('aria-label', label);
    }
    if (drawerOpen()) renderList();
  }

  function smallBtn(text, act) {
    var b = el('button', 'rl-hl-item-act', text);
    b.type = 'button';
    b.setAttribute('data-act', act);
    return b;
  }

  function renderList() {
    if (noteBox && !noteBox.hidden && noteBox.classList.contains('rl-hl-note-inline')) return;
    var all = sorted();
    countEl.textContent = all.length ? String(all.length) : '';
    emptyEl.hidden = all.length > 0;
    actionsEl.hidden = all.length === 0;
    while (list.firstChild) list.removeChild(list.firstChild);
    all.forEach(function (h) {
      var found = placed[h.id] >= 0;
      var li = el('li', 'rl-hl-item rl-hl-item-' + h.color + (found ? '' : ' rl-hl-item-missing'));
      li.setAttribute('data-hl-item', h.id);
      var main = el(found ? 'button' : 'div', 'rl-hl-item-main');
      if (found) {
        main.type = 'button';
        main.title = t('readerHlJump', 'Show in article');
      }
      main.appendChild(el('span', 'rl-hl-item-quote', h.text));
      if (h.note) main.appendChild(el('span', 'rl-hl-item-note', h.note));
      if (!found) main.appendChild(el('span', 'rl-hl-item-missing-label', t('readerHlNotFound', 'Not found in this copy')));
      li.appendChild(main);
      var acts = el('div', 'rl-hl-item-acts');
      acts.appendChild(smallBtn(h.note ? t('readerHlEditNote', 'Edit note') : t('readerHlAddNote', 'Add note'), 'note'));
      acts.appendChild(smallBtn(t('readerHlCopy', 'Copy'), 'copy'));
      acts.appendChild(smallBtn(t('readerHlDelete', 'Delete'), 'delete'));
      li.appendChild(acts);
      list.appendChild(li);
    });
  }

  function isSheet() {
    return App.isPanel || window.innerWidth < 720;
  }

  function openDrawer() {
    if (!drawer) return;
    App.closeSettings();
    renderList();
    drawer.hidden = false;
    drawer.classList.toggle('rl-sheet', isSheet());
    document.documentElement.classList.add('rl-drawer-open');
    btn && btn.setAttribute('aria-expanded', 'true');
    var first = list.querySelector('.rl-hl-item-main') || document.getElementById('hl-drawer-close');
    if (first && first.focus) first.focus();
  }

  function closeDrawer(returnFocus) {
    if (!drawerOpen()) return;
    closeNote(false);
    drawer.hidden = true;
    document.documentElement.classList.remove('rl-drawer-open');
    btn && btn.setAttribute('aria-expanded', 'false');
    if (returnFocus && btn) btn.focus();
  }

  function flash(id) {
    var ms = marksFor(id);
    for (var i = 0; i < ms.length; i++) {
      ms[i].classList.remove('rl-hl-flash');
      void ms[i].offsetWidth;
      ms[i].classList.add('rl-hl-flash');
    }
    setTimeout(function () {
      for (var j = 0; j < ms.length; j++) ms[j].classList.remove('rl-hl-flash');
    }, 1800);
  }

  function scrollToHighlight(id) {
    var ms = marksFor(id);
    if (!ms.length) return false;
    ms[0].scrollIntoView({ block: 'center', behavior: reduceMotion && reduceMotion.matches ? 'auto' : 'smooth' });
    flash(id);
    return true;
  }

  function onListClick(e) {
    var li = e.target.closest('[data-hl-item]');
    if (!li) return;
    var h = byId(li.getAttribute('data-hl-item'));
    if (!h) return;
    var act = e.target.closest('[data-act]');
    act = act ? act.getAttribute('data-act') : null;
    var found = placed[h.id] >= 0;
    if (act === 'copy') { copyText(h.text); return; }
    if (act === 'delete') {
      var next = li.nextElementSibling || li.previousElementSibling;
      removeHighlight(h);
      var f = next && list.querySelector('[data-hl-item="' + cssId(next.getAttribute('data-hl-item')) + '"] .rl-hl-item-main');
      (f && f.tagName === 'BUTTON' ? f : document.getElementById('hl-drawer-close')).focus();
      return;
    }
    if (act === 'note') {
      if (found && !isSheet()) {
        scrollToHighlight(h.id);
        setTimeout(function () { openNote(h.id); }, reduceMotion && reduceMotion.matches ? 0 : 350);
      } else {
        openNote(h.id, li);
      }
      return;
    }
    if (found && e.target.closest('.rl-hl-item-main')) {
      if (isSheet()) closeDrawer(false);
      scrollToHighlight(h.id);
    }
  }

  function downloadMarkdown() {
    var md = HighlightsStore.toMarkdown(meta(), sorted());
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var slug = String(meta().title || 'highlights').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'article';
    a.href = url;
    a.download = slug + '-highlights.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ---------------------------------------------------------------------------
  // Clipboard and toast

  function copyText(text) {
    if (!text) return;
    var done = function () { App.tip(t('readerHlCopied', 'Copied')); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* nothing else to try */ }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function toast(msg, undo) {
    var box = document.getElementById('rl-toast');
    var act = document.getElementById('rl-toast-action');
    if (!box) return;
    document.getElementById('rl-toast-msg').textContent = msg;
    toastAction = undo || null;
    act.hidden = !undo;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 7000);
  }

  function hideToast() {
    var box = document.getElementById('rl-toast');
    if (box) box.hidden = true;
    toastAction = null;
  }

  // ---------------------------------------------------------------------------
  // Sync with edits made in other pages (side panel Highlights tab, imports).

  function sync(fresh) {
    var map = {};
    fresh.forEach(function (h) { map[h.id] = h; });
    var changed = false;
    items.slice().forEach(function (h) {
      if (!map[h.id] && !pendingAdd[h.id]) {
        unwrap(h.id);
        delete placed[h.id];
        items = items.filter(function (x) { return x.id !== h.id; });
        changed = true;
      }
    });
    fresh.forEach(function (f) {
      if (pendingRemove[f.id]) return;
      var h = byId(f.id);
      if (!h) {
        h = f;
        items.push(h);
        place(h);
        changed = true;
      } else if (h.color !== f.color || (h.note || '') !== (f.note || '')) {
        if (noteFor === h.id) return;
        h.color = f.color;
        h.note = f.note;
        decorate(h);
        changed = true;
      }
    });
    if (changed) refresh();
  }

  // ---------------------------------------------------------------------------
  // Wiring

  function init(a) {
    article = a;
    body = App.body();
    if (!article || !body) return;
    if (btn) btn.disabled = false;
    HighlightsStore.get(article.id).then(function (stored) {
      items = stored;
      index = null;
      var ix = getIndex();
      // Place in document order of where they match so nested wraps are stable.
      var spots = items.map(function (h) { return { h: h, at: locate(h, ix) }; });
      spots.forEach(function (sp) { placed[sp.h.id] = sp.at ? sp.at.s : -1; });
      spots.filter(function (sp) { return sp.at; }).sort(function (x, y) { return y.at.s - x.at.s; }).forEach(function (sp) {
        wrap(sp.at.s, sp.at.e, sp.h);
      });
      refresh();
      var want = new URLSearchParams(window.location.search).get('hl');
      if (want) {
        setTimeout(function () {
          if (!scrollToHighlight(want) && byId(want)) {
            openDrawer();
            App.tip(t('readerHlNotInCopy', "That highlight isn't in this copy of the article"));
            var li = list.querySelector('[data-hl-item="' + cssId(want) + '"]');
            if (li) li.classList.add('rl-hl-item-flash');
          }
        }, 120);
      }
    });
    HighlightsStore.onChange(function (all) {
      var e = all[article.id];
      sync(e && Array.isArray(e.items) ? e.items : []);
    });

    body.addEventListener('click', function (e) {
      var m = e.target.closest && e.target.closest('mark.rl-hl');
      if (!m || e.target.closest('a')) return;
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      e.stopPropagation();
      var id = m.getAttribute('data-hl-id');
      if (popMode === 'highlight' && popId === id) { hidePop(); return; }
      openHighlight(id, e.detail === 0);
    });
  }

  document.addEventListener('rl:rendered', function (e) { init(e.detail && e.detail.article); });

  document.addEventListener('mouseup', function (e) {
    if (pop && pop.contains(e.target)) return;
    if (noteBox && noteBox.contains(e.target)) return;
    setTimeout(maybeShowForSelection, 0);
  });
  document.addEventListener('keyup', function (e) {
    if (e.shiftKey || e.key === 'Shift' || (e.key === 'a' && (e.ctrlKey || e.metaKey))) maybeShowForSelection();
  });
  document.addEventListener('touchend', function () { setTimeout(maybeShowForSelection, 250); });
  document.addEventListener('selectionchange', function () {
    if (popMode !== 'selection') return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) hidePop();
  });
  document.addEventListener('mousedown', function (e) {
    if (pop && !pop.hidden && !pop.contains(e.target) && !(e.target.closest && e.target.closest('mark.rl-hl'))) hidePop();
    if (noteBox && !noteBox.hidden && !noteBox.contains(e.target) && !noteBox.classList.contains('rl-hl-note-inline')) closeNote(true);
  });
  window.addEventListener('resize', function () {
    hidePop();
    if (drawerOpen()) drawer.classList.toggle('rl-sheet', isSheet());
  });

  if (btn) {
    btn.addEventListener('click', function () {
      drawerOpen() ? closeDrawer(true) : openDrawer();
    });
  }
  if (list) list.addEventListener('click', onListClick);
  var closeBtn = document.getElementById('hl-drawer-close');
  if (closeBtn) closeBtn.addEventListener('click', function () { closeDrawer(true); });
  var copyAll = document.getElementById('hl-copy-all');
  if (copyAll) copyAll.addEventListener('click', function () { copyText(HighlightsStore.toMarkdown(meta(), sorted())); });
  var dl = document.getElementById('hl-download');
  if (dl) dl.addEventListener('click', downloadMarkdown);
  var toastBtn = document.getElementById('rl-toast-action');
  if (toastBtn) {
    toastBtn.addEventListener('click', function () {
      var fn = toastAction;
      hideToast();
      if (fn) fn();
    });
  }

  App.onKey('h', function () {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !selectionRange()) return false;
    return !!createFromSelection('yellow');
  });
  App.onEscape(function () {
    if (noteBox && !noteBox.hidden) { closeNote(false); return true; }
    if (pop && !pop.hidden) { hidePop(); return true; }
    if (drawerOpen()) { closeDrawer(true); return true; }
    return false;
  });
  if (drawer) {
    drawer.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !(noteBox && !noteBox.hidden)) { e.preventDefault(); e.stopPropagation(); closeDrawer(true); }
    });
  }
})();
