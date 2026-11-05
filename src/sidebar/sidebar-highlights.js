/* ReadLater Pro - side panel Highlights tab (1.3.0).
 *
 * Lists every highlight in HighlightsStore grouped by article, newest first,
 * with a free client-side filter over quote, note and article title. Rows have
 * variable height, so this is a plain list that renders in chunks instead of
 * going through the fixed-row virtual scroller.
 *
 * Exposes window.SidebarHighlights:
 *   init(opts)  opts = { root, toast(msg, actionLabel, onAction), openArticle(id, hlId),
 *                        openUrl(url), copy(text), onSummary(text), onClearSearch() }
 *   show(), hide(), setQuery(q), getScroll(), setScroll(y), refresh()
 */
(function () {
  'use strict';

  var CHUNK = 150;
  var SVG = 'http://www.w3.org/2000/svg';

  function t(key, fallback, subs) {
    var msg = '';
    try { msg = chrome.i18n.getMessage(key, subs ? subs.map(String) : undefined) || ''; } catch (e) { msg = ''; }
    if (msg) return msg;
    var out = fallback;
    (subs || []).forEach(function (v, i) { out = out.split('$' + (i + 1)).join(String(v)); });
    return out;
  }

  function icon(paths, size) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('width', size || 14);
    s.setAttribute('height', size || 14);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    paths.forEach(function (p) {
      var el = document.createElementNS(SVG, p[0]);
      Object.keys(p[1]).forEach(function (k) { el.setAttribute(k, p[1][k]); });
      s.appendChild(el);
    });
    return s;
  }

  var ICONS = {
    open: [['path', { d: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' }], ['path', { d: 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' }]],
    copy: [['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' }], ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]],
    del: [['polyline', { points: '3 6 5 6 21 6' }], ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]],
    download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '7 10 12 15 17 10' }], ['line', { x1: '12', y1: '15', x2: '12', y2: '3' }]],
    pen: [['path', { d: 'M12 20h9' }], ['path', { d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z' }]],
    search: [['circle', { cx: '11', cy: '11', r: '8' }], ['line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' }]]
  };

  var opts = null;
  var root = null, listEl = null, countEl = null, exportBtn = null, emptyEl = null, moreBtn = null;
  var all = {};
  var groups = [];          // filtered, sorted
  var totalItems = 0, totalArticles = 0, shownItems = 0;
  var query = '';
  var visible = false;
  var loaded = false;
  var renderedUpTo = 0;     // index into the flat render queue
  var queue = [];           // flat list of {type:'group'|'item', ...}
  var observer = null;

  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function fmtDate(ms) {
    try {
      return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return ''; }
  }

  function build() {
    var q = query.toLowerCase();
    var out = [];
    totalItems = 0;
    totalArticles = 0;
    shownItems = 0;
    Object.keys(all).forEach(function (aid) {
      var e = all[aid];
      if (!e || !Array.isArray(e.items) || !e.items.length) return;
      totalArticles++;
      totalItems += e.items.length;
      var title = e.title || t('panelHlUntitled', 'Untitled article');
      var titleHit = q && title.toLowerCase().indexOf(q) !== -1;
      var items = e.items.filter(function (h) {
        if (!q || titleHit) return true;
        return String(h.text || '').toLowerCase().indexOf(q) !== -1 ||
          String(h.note || '').toLowerCase().indexOf(q) !== -1;
      }).slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      if (!items.length) return;
      shownItems += items.length;
      out.push({
        articleId: aid,
        title: title,
        url: e.url || '',
        domain: domainOf(e.url || ''),
        newest: items[0].createdAt || e.updatedAt || 0,
        items: items
      });
    });
    out.sort(function (a, b) { return b.newest - a.newest; });
    groups = out;
    queue = [];
    groups.forEach(function (g) {
      queue.push({ type: 'group', g: g });
      g.items.forEach(function (h) { queue.push({ type: 'item', g: g, h: h }); });
    });
  }

  function summaryText() {
    if (query) {
      return shownItems === 1
        ? t('panelHlMatchOne', '1 highlight matches')
        : t('panelHlMatchMany', '$1 highlights match', [shownItems]);
    }
    if (totalItems === 0) return '';
    var hl = totalItems === 1 ? t('panelHlCountOne', '1 highlight') : t('panelHlCountMany', '$1 highlights', [totalItems]);
    var ar = totalArticles === 1 ? t('panelHlFromOne', 'from 1 article') : t('panelHlFromMany', 'from $1 articles', [totalArticles]);
    return hl + ' ' + ar;
  }

  function mkBtn(cls, label, iconName, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-label', label);
    b.title = label;
    if (iconName) b.appendChild(icon(ICONS[iconName], 14));
    b.addEventListener('click', onClick);
    return b;
  }

  function groupNode(g) {
    var head = document.createElement('div');
    head.className = 'hl-group';
    var title = document.createElement('button');
    title.type = 'button';
    title.className = 'hl-group-title';
    title.textContent = g.title;
    title.title = t('panelHlOpenArticle', 'Open article');
    title.addEventListener('click', function () { openHighlight(g, null); });
    head.appendChild(title);
    var meta = document.createElement('div');
    meta.className = 'hl-group-meta';
    var dom = document.createElement('span');
    dom.textContent = g.domain;
    meta.appendChild(dom);
    var n = document.createElement('span');
    n.textContent = g.items.length === 1 ? t('panelHlCountOne', '1 highlight') : t('panelHlCountMany', '$1 highlights', [g.items.length]);
    if (g.domain) {
      var dot = document.createElement('span');
      dot.textContent = '·';
      dot.setAttribute('aria-hidden', 'true');
      meta.appendChild(dot);
    }
    meta.appendChild(n);
    head.appendChild(meta);
    return head;
  }

  function itemNode(g, h) {
    var el = document.createElement('article');
    el.className = 'hl-item hl-color-' + (h.color || 'yellow');
    el.setAttribute('data-hl-id', h.id);
    var quote = document.createElement('blockquote');
    quote.className = 'hl-quote';
    quote.textContent = h.text || '';
    el.appendChild(quote);
    if (h.note) {
      var note = document.createElement('p');
      note.className = 'hl-note';
      note.textContent = h.note;
      el.appendChild(note);
    }
    var foot = document.createElement('div');
    foot.className = 'hl-item-foot';
    var date = document.createElement('span');
    date.className = 'hl-date';
    date.textContent = fmtDate(h.createdAt);
    foot.appendChild(date);
    var actions = document.createElement('div');
    actions.className = 'hl-actions';
    actions.appendChild(mkBtn('hl-action', t('panelHlOpen', 'Open in article'), 'open', function () { openHighlight(g, h); }));
    actions.appendChild(mkBtn('hl-action', t('panelHlCopy', 'Copy highlight'), 'copy', function () { copyHighlight(g, h); }));
    actions.appendChild(mkBtn('hl-action hl-action-danger', t('panelHlDelete', 'Delete highlight'), 'del', function () { deleteHighlight(g, h, el); }));
    foot.appendChild(actions);
    el.appendChild(foot);
    return el;
  }

  function renderMore() {
    if (!listEl) return;
    var frag = document.createDocumentFragment();
    var items = 0;
    while (renderedUpTo < queue.length && items < CHUNK) {
      var q = queue[renderedUpTo++];
      if (q.type === 'group') frag.appendChild(groupNode(q.g));
      else { frag.appendChild(itemNode(q.g, q.h)); items++; }
    }
    // Never leave a group header dangling at the end of a chunk.
    while (renderedUpTo < queue.length && queue[renderedUpTo].type === 'item' && frag.lastChild && frag.lastChild.className === 'hl-group') {
      frag.appendChild(itemNode(queue[renderedUpTo].g, queue[renderedUpTo].h));
      renderedUpTo++;
    }
    listEl.appendChild(frag);
    var rest = queue.length - renderedUpTo;
    if (moreBtn) {
      moreBtn.hidden = rest <= 0;
      moreBtn.textContent = t('panelHlShowMore', 'Show more highlights');
    }
  }

  function render(keepScroll) {
    if (!root) return;
    var y = root.scrollTop;
    build();
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    renderedUpTo = 0;
    var empty = queue.length === 0;
    emptyEl.hidden = !empty;
    listEl.hidden = empty;
    exportBtn.hidden = totalItems === 0;
    if (empty) {
      fillEmpty();
      if (moreBtn) moreBtn.hidden = true;
    } else {
      renderMore();
      if (keepScroll) {
        // Render enough chunks to get back to where the reader was.
        while (renderedUpTo < queue.length && root.scrollHeight < y + root.clientHeight) renderMore();
        root.scrollTop = y;
      }
    }
    var s = summaryText();
    countEl.textContent = s;
    countEl.hidden = !s;
    if (opts.onSummary) opts.onSummary(s);
  }

  function fillEmpty() {
    while (emptyEl.firstChild) emptyEl.removeChild(emptyEl.firstChild);
    var ill = document.createElement('div');
    ill.className = 'sidebar-empty-illustration illus-search';
    ill.appendChild(icon(query ? ICONS.search : ICONS.pen, 48));
    emptyEl.appendChild(ill);
    var h = document.createElement('p');
    h.className = 'sidebar-empty-text';
    var p = document.createElement('p');
    p.className = 'sidebar-empty-hint';
    if (query) {
      h.textContent = t('panelHlNoMatchTitle', 'No highlights match');
      p.textContent = t('panelHlNoMatchHint', 'Try another word. Search looks at quotes, notes and article titles.');
    } else {
      h.textContent = t('panelHlEmptyTitle', 'No highlights yet');
      p.textContent = t('panelHlEmptyHint', 'Open any saved article in reader view, select a sentence you like and pick a color. Every highlight and note you make shows up here.');
    }
    emptyEl.appendChild(h);
    emptyEl.appendChild(p);
    if (query) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sidebar-empty-action';
      b.textContent = t('rlEmptyClearSearch', 'Clear search');
      b.addEventListener('click', function () { if (opts.onClearSearch) opts.onClearSearch(); });
      emptyEl.appendChild(b);
    }
  }

  function openHighlight(g, h) {
    if (typeof MessageHelper === 'undefined') return;
    MessageHelper.send('GET_ARTICLE', { id: g.articleId }).then(function (r) {
      if (r && r.success && r.data) {
        opts.openArticle(g.articleId, h ? h.id : null);
        return;
      }
      if (g.url) {
        opts.openUrl(g.url);
        opts.toast(t('panelHlArticleGone', "That article isn't in your list anymore, so the original page opened."));
      } else {
        opts.toast(t('panelHlArticleGoneNoUrl', "That article isn't in your list anymore."));
      }
    });
  }

  function copyHighlight(g, h) {
    var parts = [h.text || ''];
    if (h.note) parts.push(h.note);
    parts.push(g.title + (g.url ? '\n' + g.url : ''));
    opts.copy(parts.join('\n\n'));
    opts.toast(t('panelHlCopied', 'Highlight copied'));
  }

  function touchArticles() {
    try { chrome.storage.local.set({ articlesUpdatedAt: Date.now() }); } catch (e) { /* ignore */ }
  }

  function deleteHighlight(g, h, el) {
    var meta = { title: g.title, url: g.url };
    var copy = JSON.parse(JSON.stringify(h));
    if (el) el.classList.add('hl-removing');
    HighlightsStore.remove(g.articleId, h.id).then(function () {
      touchArticles();
      opts.toast(t('panelHlDeleted', 'Highlight deleted'), t('panelUndo', 'Undo'), function () {
        HighlightsStore.add(g.articleId, meta, copy).then(function () {
          touchArticles();
          opts.toast(t('panelHlRestored', 'Highlight restored'));
        });
      });
    }).catch(function () {
      if (el) el.classList.remove('hl-removing');
      opts.toast(t('panelHlDeleteFailed', "Couldn't delete that highlight. Try again."));
    });
  }

  function exportAll() {
    HighlightsStore.getAll().then(function (data) {
      var ids = Object.keys(data).filter(function (k) { return data[k] && data[k].items && data[k].items.length; });
      // Checked before the Pro gate so an empty export never uses up the free try.
      if (!ids.length) { opts.toast(t('panelHlNothingToExport', 'There are no highlights to export yet.')); return; }
      if (typeof FeatureGate === 'undefined' || !FeatureGate.gateFeature) { doExportAll(data, ids); return; }
      FeatureGate.gateFeature('markdown_export', function () { doExportAll(data, ids); }, {
        onBlocked: function () {
          opts.toast(t('proExportBlockedShort', 'Markdown export is part of Pro, and your free try has been used.'));
          if (typeof Paywall !== 'undefined' && Paywall.show) Paywall.show(t('proExportFeature', 'Markdown export'), { featureId: 'markdown_export', surface: 'sidebar' });
        }
      });
    });
  }

  function doExportAll(data, ids) {
    ids.sort(function (a, b) { return (data[b].updatedAt || 0) - (data[a].updatedAt || 0); });
    var d = new Date();
    var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var out = ['# ' + t('panelHlExportHeading', 'ReadLater highlights'), '', t('panelHlExportedOn', 'Exported $1', [stamp]), ''];
    var n = 0;
    ids.forEach(function (aid) {
      var e = data[aid];
      var items = e.items.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      n += items.length;
      out.push(HighlightsStore.toMarkdown({ title: e.title, url: e.url }, items));
    });
    var blob = new Blob([out.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'readlater-highlights-' + stamp + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    opts.toast(n === 1 ? t('panelHlExportedOne', 'Exported 1 highlight') : t('panelHlExportedMany', 'Exported $1 highlights', [n]));
  }

  function load(keepScroll) {
    if (typeof HighlightsStore === 'undefined') { all = {}; render(false); return; }
    HighlightsStore.getAll().then(function (data) {
      all = data || {};
      loaded = true;
      if (visible) render(keepScroll);
    });
  }

  var api = {
    init: function (o) {
      opts = o;
      root = o.root;
      var bar = document.createElement('div');
      bar.className = 'hl-toolbar';
      countEl = document.createElement('span');
      countEl.className = 'hl-count';
      countEl.setAttribute('aria-live', 'polite');
      bar.appendChild(countEl);
      exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'hl-export';
      exportBtn.id = 'hl-export';
      exportBtn.appendChild(icon(ICONS.download, 14));
      var lab = document.createElement('span');
      lab.textContent = t('panelHlExport', 'Export highlights');
      exportBtn.appendChild(lab);
      exportBtn.title = t('panelHlExportTitle', 'Download every highlight as one Markdown file');
      exportBtn.addEventListener('click', exportAll);
      bar.appendChild(exportBtn);
      root.appendChild(bar);
      listEl = document.createElement('div');
      listEl.className = 'hl-list';
      // A labelled group, not a list: it mixes article group headers and highlight cards.
      listEl.setAttribute('role', 'group');
      listEl.setAttribute('aria-label', t('panelHlListLabel', 'Highlights'));
      root.appendChild(listEl);
      moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'hl-more';
      moreBtn.hidden = true;
      moreBtn.addEventListener('click', renderMore);
      root.appendChild(moreBtn);
      emptyEl = document.createElement('div');
      emptyEl.className = 'sidebar-empty hl-empty';
      emptyEl.hidden = true;
      root.appendChild(emptyEl);
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { if (en.isIntersecting && visible && !moreBtn.hidden) renderMore(); });
        }, { root: root, rootMargin: '400px' });
        observer.observe(moreBtn);
      }
      if (typeof HighlightsStore !== 'undefined') {
        HighlightsStore.onChange(function (data) {
          all = data || {};
          if (visible) render(true);
        });
      }
    },
    show: function (scrollY) {
      visible = true;
      root.hidden = false;
      var y = typeof scrollY === 'number' ? scrollY : null;
      function apply(tries) {
        if (y === null || !visible) return;
        while (renderedUpTo < queue.length && root.scrollHeight < y + root.clientHeight) renderMore();
        root.scrollTop = y;
        // The first layout after navigating back can clamp; retry briefly.
        if (Math.abs(root.scrollTop - y) > 1 && (tries || 0) < 25) setTimeout(function () { apply((tries || 0) + 1); }, 20);
      }
      if (loaded) { render(false); root.scrollTop = 0; apply(); }
      if (typeof HighlightsStore === 'undefined') { render(false); return; }
      HighlightsStore.getAll().then(function (data) {
        all = data || {};
        var first = !loaded;
        loaded = true;
        if (!visible) return;
        render(!first);
        if (first) apply();
      });
    },
    hide: function () {
      visible = false;
      if (root) root.hidden = true;
    },
    setQuery: function (q) {
      query = String(q || '').trim();
      if (visible) { render(false); root.scrollTop = 0; }
    },
    getScroll: function () { return root ? root.scrollTop : 0; },
    refresh: function () { load(true); },
    summary: function () { return summaryText(); },
    exportAll: exportAll
  };

  window.SidebarHighlights = api;
})();
