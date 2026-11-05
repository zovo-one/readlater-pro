/* ReadLater Pro - "Get the full text of your saved links" (1.3.0).
 *
 * Imported articles (Pocket, Instapaper, Raindrop, bookmarks...) arrive as
 * links with no body. With the optional host permission (FulltextAccess),
 * this page downloads each page from its own site, parses it inertly with
 * DOMParser (no scripts run, nothing loads), runs Readability, sanitizes the
 * result with the same rules as content.js / reader he(), and stores it with
 * UPDATE_ARTICLE. Nothing is sent anywhere else.
 *
 * Queue: 3 downloads at a time, but only one per hostname with a 1 s gap
 * after each, 20 s timeout and a 5 MB cap per page, credentials omitted.
 * http links are fetched over https (the page CSP only allows https).
 *
 * Progress lives in chrome.storage.local.rlFetchState (protected from storage
 * cleanup by the rl prefix): status, done count and the failure list. The
 * queue itself is not stored: it is always "every link-only article that
 * hasn't failed in this run", so closing the tab loses nothing and articles
 * saved or deleted meanwhile are handled for free.
 */
(function () {
  'use strict';

  var STATE_KEY = 'rlFetchState';
  var CONCURRENCY = 3;
  var HOST_GAP_MS = 1000;
  var TIMEOUT_MS = 20000;
  var MAX_BYTES = 5 * 1024 * 1024;
  var MIN_WORDS = 80;
  var MAX_FAILED = 5000;
  var MAX_PARSE_ELEMS = 50000;
  var MAX_SANITIZE_NODES = 20000;
  var MAX_ATTRS_PER_NODE = 32;
  var MAX_WORDCOUNT_CHARS = 500000;
  var SIGNAL_EVERY_MS = 15000;
  var STRIP = 'script, style, iframe, object, embed, form, input, textarea, select, button, link, meta, base, applet, frame, frameset, noscript, template';

  var el = {};
  var state = null;          // persisted part
  var granted = false;
  var items = [];            // link-only articles [{id,url,title}] at load
  var pending = [];          // still to do in this run
  var active = {};           // id -> {item, ctrl}
  var activeCount = 0;
  var hosts = {};            // hostname -> {busy, nextAt}
  var wakeTimer = null;
  var saveTimer = null;
  var lastSignal = 0;
  var lastAnnouncedPct = 0;
  var haveLock = true;
  var autoPausedOffline = false;

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
    try { return Number(n || 0).toLocaleString(); } catch (e) { return String(n || 0); }
  }

  function tn(n, keyOne, one, keyMany, many) {
    return n === 1 ? t(keyOne, one, [num(n)]) : t(keyMany, many, [num(n)]);
  }

  function reasonText(f) {
    switch (f.code) {
      case 'notFound': return t('fetchWhyNotFound', 'Page not found ($1)', [String(f.status || 404)]);
      case 'blocked': return t('fetchWhyBlocked', 'The site blocked the download ($1)', [String(f.status || 403)]);
      case 'server': return t('fetchWhyServer', 'The site had a problem ($1)', [String(f.status || 500)]);
      case 'timeout': return t('fetchWhyTimeout', 'The site took too long to answer');
      case 'network': return t('fetchWhyNetwork', 'Couldn\'t reach the site');
      case 'insecure': return t('fetchWhyInsecure', 'Couldn\'t reach a secure (https) copy of this page');
      case 'tooBig': return t('fetchWhyTooBig', 'The page is over 5 MB');
      case 'notHtml': return t('fetchWhyNotHtml', 'Not a web page (maybe a PDF or a file)');
      case 'notArticle': return t('fetchWhyNotArticle', 'No article found on this page');
      case 'tiny': return t('fetchWhyTiny', 'Only a few lines came through. It may need a sign-in or a subscription.');
      case 'save': return t('fetchWhySave', 'The text couldn\'t be saved');
      default: return t('fetchWhyOther', 'Something went wrong');
    }
  }

  /* ---------------- messaging and storage ---------------- */

  function send(action, payload, timeout) {
    if (typeof MessageHelper === 'undefined') return Promise.resolve(null);
    return MessageHelper.send(action, payload, timeout || 30000).then(function (res) {
      return res && res.success ? { data: res.data } : null;
    }, function () { return null; });
  }

  function freshState() {
    return { v: 1, status: 'idle', done: 0, failed: [], startedAt: 0, updatedAt: 0 };
  }

  function loadState() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(STATE_KEY, function (r) {
          void chrome.runtime.lastError;
          var s = r && r[STATE_KEY];
          if (!s || typeof s !== 'object' || s.v !== 1) s = freshState();
          if (!Array.isArray(s.failed)) s.failed = [];
          s.done = Number(s.done) || 0;
          resolve(s);
        });
      } catch (e) {
        resolve(freshState());
      }
    });
  }

  function writeState() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!haveLock) return;
    state.updatedAt = Date.now();
    var o = {};
    o[STATE_KEY] = state;
    try { chrome.storage.local.set(o, function () { void chrome.runtime.lastError; }); } catch (e) { /* page closing */ }
  }

  function saveSoon() {
    if (!saveTimer) saveTimer = setTimeout(writeState, 800);
  }

  /* The side panel reloads its rows on this key. Throttled: reading times,
     excerpts and images change as articles fill in. */
  function signalPanel(force) {
    var now = Date.now();
    if (!force && now - lastSignal < SIGNAL_EVERY_MS) return;
    lastSignal = now;
    try { chrome.storage.local.set({ articlesUpdatedAt: now }); } catch (e) { /* ignore */ }
  }

  /* ---------------- extraction ---------------- */

  function wordCount(s) {
    if (!s) return 0;
    var a = s.length > MAX_WORDCOUNT_CHARS ? s.slice(0, MAX_WORDCOUNT_CHARS) : s;
    var n = a.split(/\s+/).filter(Boolean).length;
    return s.length > MAX_WORDCOUNT_CHARS ? Math.round(n * (s.length / MAX_WORDCOUNT_CHARS)) : n;
  }

  function badUrl(v) {
    var s = String(v || '').replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
    return s.indexOf('javascript:') === 0 || s.indexOf('vbscript:') === 0 || s.indexOf('data:text/html') === 0;
  }

  /* Same rules as content.js x() and reader he(): drop active and embedding
     elements, every on* attribute and javascript:/data:text/html URLs, and
     1x1 tracking pixels. Stricter in two ways: it checks every attribute's
     value (xlink:href, formaction, srcdoc...), and an oversized document is
     refused instead of being half sanitized. Returns null when refused. */
  function sanitize(html) {
    if (!html) return '';
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var kill = doc.querySelectorAll(STRIP);
    for (var i = kill.length - 1; i >= 0; i--) if (kill[i].parentNode) kill[i].parentNode.removeChild(kill[i]);
    var all = doc.body ? doc.body.querySelectorAll('*') : [];
    if (all.length > MAX_SANITIZE_NODES) return null;
    for (var j = 0; j < all.length; j++) {
      var node = all[j];
      var attrs = node.attributes;
      if (attrs.length > MAX_ATTRS_PER_NODE) {
        for (var k = attrs.length - 1; k >= 0; k--) node.removeAttribute(attrs[k].name);
        continue;
      }
      for (var m = attrs.length - 1; m >= 0; m--) {
        var name = attrs[m].name.toLowerCase();
        if (name.indexOf('on') === 0 || name === 'srcdoc' || name === 'formaction' || badUrl(attrs[m].value)) {
          node.removeAttribute(attrs[m].name);
        }
      }
    }
    var imgs = doc.body ? doc.body.querySelectorAll('img') : [];
    for (var p = imgs.length - 1; p >= 0; p--) {
      var w = parseInt(imgs[p].getAttribute('width'), 10);
      var h = parseInt(imgs[p].getAttribute('height'), 10);
      if (((w >= 0 && w <= 1) || (h >= 0 && h <= 1)) && imgs[p].parentNode) imgs[p].parentNode.removeChild(imgs[p]);
    }
    return doc.body ? doc.body.innerHTML : '';
  }

  function Fail(code, status) {
    this.code = code;
    this.status = status || 0;
  }

  function charsetOf(contentType, bytes) {
    var m = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType || '');
    if (m) return m[1];
    var head = '';
    var n = Math.min(bytes.length, 4096);
    for (var i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
    m = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
    return m ? m[1] : 'utf-8';
  }

  function decode(bytes, label) {
    try { return new TextDecoder(label).decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }

  function readCapped(res, ctrl) {
    var len = Number(res.headers.get('content-length'));
    if (len > MAX_BYTES) { ctrl.abort(); return Promise.reject(new Fail('tooBig')); }
    if (!res.body || !res.body.getReader) {
      return res.arrayBuffer().then(function (b) {
        if (b.byteLength > MAX_BYTES) throw new Fail('tooBig');
        return new Uint8Array(b);
      });
    }
    var reader = res.body.getReader();
    var chunks = [];
    var size = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(size);
          var off = 0;
          chunks.forEach(function (c) { out.set(c, off); off += c.length; });
          return out;
        }
        size += r.value.length;
        if (size > MAX_BYTES) {
          try { reader.cancel(); } catch (e) { /* ignore */ }
          ctrl.abort();
          throw new Fail('tooBig');
        }
        chunks.push(r.value);
        return pump();
      });
    }
    return pump();
  }

  function metaContent(doc, sel) {
    var n = doc.querySelector(sel);
    return n ? (n.getAttribute('content') || '').trim() : '';
  }

  function absolute(u, base) {
    if (!u) return '';
    try {
      var x = new URL(u, base);
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
    } catch (e) { return ''; }
  }

  var URL_ATTRS = ['href', 'src', 'poster', 'cite', 'data-src', 'data-original', 'data-lazy-src'];
  var SET_ATTRS = ['srcset', 'data-srcset'];

  /* The page CSP has base-uri 'none', which also applies to documents made
     with DOMParser here, so a <base href> can't be used. Instead every link
     and image URL is made absolute against the page's own URL before
     Readability runs (Readability then leaves absolute URLs alone). */
  function resolveUrls(doc, base) {
    var sel = '[' + URL_ATTRS.concat(SET_ATTRS).join('],[') + ']';
    Array.prototype.forEach.call(doc.querySelectorAll(sel), function (n) {
      URL_ATTRS.forEach(function (a) {
        var v = n.getAttribute(a);
        if (v == null) return;
        var abs = absolute(v.trim(), base);
        if (abs) n.setAttribute(a, abs);
      });
      SET_ATTRS.forEach(function (a) {
        var v = n.getAttribute(a);
        if (!v) return;
        n.setAttribute(a, v.replace(/(\S+)(\s+[\d.]+[xw])?(\s*(?:,|$))/g, function (m, url, d, sep) {
          return (absolute(url, base) || url) + (d || '') + sep;
        }));
      });
    });
  }

  var PAYWALL_HINT = /subscri|sign in|signin|log in|login|paywall|members only|premium|register to/i;

  function longestParagraph(doc) {
    var best = 0;
    Array.prototype.forEach.call(doc.querySelectorAll('p'), function (p) {
      best = Math.max(best, wordCount(p.textContent || ''));
    });
    return best;
  }

  /* Resolves {content, textContent, excerpt, byline, leadImageUrl, title,
     wordCount} or rejects with a Fail. */
  function download(item, ctrl) {
    var original = item.url;
    var url = original.replace(/^http:/i, 'https:');
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }
    }).then(function (res) {
      if (!res.ok) {
        var s = res.status;
        if (s === 404 || s === 410) throw new Fail('notFound', s);
        if (s === 401 || s === 402 || s === 403 || s === 429 || s === 451) throw new Fail('blocked', s);
        throw new Fail('server', s);
      }
      var type = (res.headers.get('content-type') || '').toLowerCase();
      if (type && type.indexOf('html') === -1) throw new Fail('notHtml');
      return readCapped(res, ctrl).then(function (bytes) {
        return { bytes: bytes, type: type, finalUrl: res.url || url };
      });
    }).then(function (r) {
      clearTimeout(timer);
      var html = decode(r.bytes, charsetOf(r.type, r.bytes));
      // Relative links and images resolve against the page, not this extension.
      // A page's own <base> is honored, then removed before parsing (CSP).
      var baseHref = r.finalUrl;
      var given = /<base\s[^>]*href\s*=\s*["']?([^"'\s>]+)/i.exec(html);
      if (given) baseHref = absolute(given[1], r.finalUrl) || r.finalUrl;
      html = html.replace(/<base\b[^>]*>/gi, '');
      var doc = new DOMParser().parseFromString(html, 'text/html');
      resolveUrls(doc, baseHref);
      var maxPara = longestParagraph(doc);
      var paywallish = PAYWALL_HINT.test((doc.body && doc.body.textContent || '').slice(0, 20000));

      var lead = absolute(metaContent(doc, 'meta[property="og:image"]') || metaContent(doc, 'meta[name="twitter:image"]'), baseHref);
      var docTitle = (doc.title || '').trim();
      if (typeof Readability === 'undefined') throw new Fail('other');
      var art = null;
      try { art = new Readability(doc, { maxElemsToParse: MAX_PARSE_ELEMS }).parse(); } catch (e) { art = null; }
      if (!art || !art.content) throw new Fail('notArticle');
      var words = wordCount(art.textContent || '');
      if (words < MIN_WORDS) throw new Fail(paywallish || maxPara >= 8 ? 'tiny' : 'notArticle');

      var clean = sanitize(art.content);
      if (clean === null || !clean.replace(/<[^>]*>/g, '').trim()) throw new Fail('notArticle');
      return {
        content: clean,
        textContent: art.textContent || '',
        excerpt: (art.excerpt || '').trim().slice(0, 300),
        byline: (art.byline || '').trim().slice(0, 200),
        leadImageUrl: lead,
        title: (art.title || docTitle || '').trim(),
        wordCount: words
      };
    }).catch(function (e) {
      clearTimeout(timer);
      if (e instanceof Fail) throw e;
      if (timedOut) throw new Fail('timeout');
      if (ctrl.signal.aborted) throw new Fail('aborted');
      throw new Fail(/^http:/i.test(original) ? 'insecure' : 'network');
    });
  }

  function isPlaceholderTitle(title, url) {
    var s = (title || '').trim();
    return !s || s === 'Untitled' || s === url || /^https?:\/\//i.test(s);
  }

  /* Fills the stored record. Re-reads it first: it may have been deleted or
     saved with its text from another page in the meantime. */
  function store(item, x) {
    return send('GET_ARTICLE', { id: item.id }).then(function (r) {
      var cur = r && r.data;
      if (!cur) return 'gone';
      if ((cur.content || '').length || cur.wordCount > 0) return 'had';
      var u = {
        content: x.content,
        textContent: x.textContent,
        wordCount: x.wordCount,
        estimatedReadTime: Math.max(1, Math.round(x.wordCount / 238)),
        isOffline: true
      };
      if (!cur.excerpt && x.excerpt) u.excerpt = x.excerpt;
      if (!cur.byline && x.byline) u.byline = x.byline;
      if (!cur.leadImageUrl && x.leadImageUrl) u.leadImageUrl = x.leadImageUrl;
      if (x.title && isPlaceholderTitle(cur.title, cur.url)) u.title = x.title.slice(0, 500);
      return send('UPDATE_ARTICLE', { id: item.id, updates: u }, 60000).then(function (res) {
        if (!res) throw new Fail('save');
        return 'saved';
      });
    });
  }

  /* ---------------- queue ---------------- */

  function hostOf(u) {
    try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
  }

  function hostState(h) {
    if (!hosts[h]) hosts[h] = { busy: false, nextAt: 0 };
    return hosts[h];
  }

  function running() {
    return state && state.status === 'running';
  }

  function pump() {
    clearTimeout(wakeTimer);
    wakeTimer = null;
    if (!running() || !haveLock) { render(); return; }
    if (!navigator.onLine) { autoPausedOffline = true; pause(); return; }
    var now = Date.now();
    var soonest = Infinity;
    for (var i = 0; i < pending.length && activeCount < CONCURRENCY; i++) {
      var it = pending[i];
      var hs = hostState(it.host);
      if (hs.busy) continue;
      if (hs.nextAt > now) { soonest = Math.min(soonest, hs.nextAt); continue; }
      pending.splice(i, 1);
      i--;
      start(it);
    }
    if (activeCount < CONCURRENCY && pending.length && soonest !== Infinity) {
      wakeTimer = setTimeout(pump, Math.max(20, soonest - now));
    }
    if (!activeCount && !pending.length) finish();
    render();
  }

  function start(it) {
    var hs = hostState(it.host);
    hs.busy = true;
    var ctrl = new AbortController();
    active[it.id] = { item: it, ctrl: ctrl };
    activeCount++;
    download(it, ctrl).then(function (x) {
      return store(it, x).then(function (how) { return { ok: how === 'saved', how: how }; });
    }).catch(function (e) {
      return { ok: false, fail: e instanceof Fail ? e : new Fail('other') };
    }).then(function (r) {
      hs.busy = false;
      hs.nextAt = Date.now() + HOST_GAP_MS;
      if (!active[it.id]) return;
      delete active[it.id];
      activeCount--;
      if (state.status === 'stopped') {
        if (r.ok) { state.done++; pending = pending.filter(function (x) { return x.id !== it.id; }); saveSoon(); render(); }
        return;
      }
      if (r.fail && r.fail.code === 'aborted') {
        // Stopped or paused mid-download: back in line, not a failure.
        pending.unshift(it);
      } else if (r.ok) {
        state.done++;
      } else if (r.fail) {
        if (state.failed.length < MAX_FAILED) {
          state.failed.push({ id: it.id, url: it.url, title: (it.title || '').slice(0, 300), code: r.fail.code, status: r.fail.status || 0 });
        }
      }
      if (r.ok) signalPanel(false);
      saveSoon();
      pump();
    });
  }

  function failedIds() {
    var o = {};
    state.failed.forEach(function (f) { o[f.id] = true; });
    return o;
  }

  function buildPending(skipFailed) {
    var skip = skipFailed ? failedIds() : {};
    pending = items.filter(function (it) { return !skip[it.id] && !active[it.id]; });
  }

  function toItems(list) {
    return list.map(function (a) {
      return { id: a.id, url: a.url, title: a.title || '', host: hostOf(a.url.replace(/^http:/i, 'https:')) };
    });
  }

  /* A fresh run re-reads the library, so articles filled in by an earlier
     run (or saved again from their page) aren't downloaded twice. Newest
     saves go first. */
  function begin() {
    if (!granted || !haveLock || running()) return;
    el.btnStart.disabled = true;
    // After Stop, "Get the rest" carries on with the same run and its failures.
    var carryOn = state && state.status === 'stopped';
    FulltextAccess.listLinkOnly().then(function (list) {
      items = toItems(list.reverse());
      if (!carryOn) {
        state = freshState();
        state.startedAt = Date.now();
      }
      state.status = 'running';
      autoPausedOffline = false;
      lastAnnouncedPct = 0;
      buildPending(carryOn);
      writeState();
      announce(t('fetchStartedAnnounce', 'Getting the full text. You can keep using Chrome while this runs.'));
      pump();
      if (el.run) el.run.focus();
    });
  }

  function pause() {
    if (!running()) return;
    state.status = 'paused';
    clearTimeout(wakeTimer);
    writeState();
    render();
    announce(autoPausedOffline ? t('fetchOfflinePaused', 'You\'re offline. This continues when you\'re back online.') : t('fetchPausedAnnounce', 'Paused'));
  }

  function resume() {
    if (!state || state.status !== 'paused' || !granted || !haveLock) return;
    autoPausedOffline = false;
    state.status = 'running';
    writeState();
    pump();
  }

  function stop() {
    if (!state || (state.status !== 'running' && state.status !== 'paused')) return;
    state.status = 'stopped';
    clearTimeout(wakeTimer);
    // In-flight pages go back to "still to do"; their late results are ignored.
    Object.keys(active).forEach(function (id) {
      pending.unshift(active[id].item);
      active[id].ctrl.abort();
    });
    writeState();
    signalPanel(true);
    render();
    if (el.summary) el.summary.focus();
    announce(t('fetchStoppedAnnounce', 'Stopped. Nothing was lost; you can start again any time.'));
  }

  function retryFailed() {
    if (!granted || !haveLock) return;
    var ids = failedIds();
    state.failed = [];
    var again = items.filter(function (it) { return ids[it.id]; });
    if (state.status === 'running') {
      pending = again.concat(pending);
      writeState();
      pump();
      return;
    }
    pending = again.concat(state.status === 'paused' ? pending : []);
    state.status = 'running';
    writeState();
    pump();
  }

  function finish() {
    if (!running()) return;
    state.status = 'done';
    writeState();
    signalPanel(true);
    render();
    if (el.summary) el.summary.focus();
    announce(el.summaryTitle ? el.summaryTitle.textContent : '');
  }

  /* ---------------- rendering ---------------- */

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function show(node, on) { if (node) node.hidden = !on; }

  function announce(text) {
    var live = el.live;
    if (!live || !text) return;
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 50);
  }

  function counts() {
    var left = pending.length + activeCount;
    var failed = state.failed.length;
    return { done: state.done, failed: failed, left: left, total: state.done + failed + left };
  }

  function setStat(id, value) {
    var n = document.getElementById(id);
    if (n) n.textContent = num(value);
  }

  function renderNow() {
    var list = Object.keys(active).map(function (id) { return active[id].item; });
    // Between pages (the 1 s gap per site) keep showing the last ones.
    if (!list.length && running()) return;
    clear(el.now);

    list.forEach(function (it) {
      var li = document.createElement('li');
      var title = document.createElement('span');
      title.className = 'fetch-now-title';
      title.textContent = it.title && !isPlaceholderTitle(it.title, it.url) ? it.title : it.url;
      var host = document.createElement('span');
      host.className = 'fetch-now-host';
      host.textContent = it.host.replace(/^www\./, '');
      li.appendChild(title);
      li.appendChild(host);
      el.now.appendChild(li);
    });
    show(el.nowWrap, list.length > 0 && running());
  }

  var failKey = '';

  function renderFailures() {
    var f = state ? state.failed : [];
    show(el.failures, f.length > 0);
    el.btnRetry.disabled = !haveLock;
    // Rebuilt only when the list changes, so focus on its links survives progress updates.
    var key = f.length + ':' + (f.length ? f[f.length - 1].id : '');
    if (!f.length || key === failKey) { failKey = f.length ? key : ''; return; }
    failKey = key;
    el.failuresTitle.textContent = tn(f.length, 'fetchFailedTitleOne', '$1 page couldn\'t be read', 'fetchFailedTitle', '$1 pages couldn\'t be read');
    clear(el.failList);
    var shown = f.slice(-200).reverse();
    shown.forEach(function (x) {
      var li = document.createElement('li');
      li.className = 'fetch-fail';
      var body = document.createElement('div');
      body.className = 'fetch-fail-body';
      var title = document.createElement('span');
      title.className = 'fetch-fail-title';
      title.textContent = x.title && !isPlaceholderTitle(x.title, x.url) ? x.title : x.url;
      var why = document.createElement('span');
      why.className = 'fetch-fail-why';
      why.textContent = reasonText(x);
      body.appendChild(title);
      body.appendChild(why);
      li.appendChild(body);
      var href = typeof Sanitize !== 'undefined' ? Sanitize.sanitizeUrl(x.url) : '';
      if (href && /^https?:/i.test(href)) {
        var a = document.createElement('a');
        a.className = 'fetch-fail-open';
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = t('fetchOpenPage', 'Open page');
        a.setAttribute('aria-label', t('fetchOpenPageNamed', 'Open "$1" in a new tab', [title.textContent]));
        li.appendChild(a);
      }
      el.failList.appendChild(li);
    });
    show(el.failMore, f.length > shown.length);
    if (f.length > shown.length) el.failMore.textContent = t('fetchFailedMore', 'Showing the latest $1.', [num(shown.length)]);
    el.failHint.textContent = t('fetchFailedHint', 'You can open these pages and save them from there, or try them again later.');
  }


  function render() {
    if (!state) return;
    var c = counts();
    var st = state.status;
    var inRun = st === 'running' || st === 'paused';

    // Intro / summary card
    var intro = !inRun;
    show(el.summary, intro);
    if (intro) {
      var leftNow = pending.length;
      clear(el.summaryNotes);
      if (st === 'done' || st === 'stopped') {
        el.summaryTitle.textContent = st === 'done'
          ? (c.failed ? t('fetchDoneSomeTitle', 'Finished, with a few pages that couldn\'t be read') : t('fetchDoneTitle', 'All done'))
          : t('fetchStoppedTitle', 'Stopped');
        var line = document.createElement('p');
        line.className = 'fetch-lead';
        line.textContent = tn(state.done, 'fetchDoneSavedOne', 'Full text saved for $1 article. It\'s readable offline now.',
          'fetchDoneSaved', 'Full text saved for $1 articles. They\'re readable offline now.');
        el.summaryNotes.appendChild(line);
        if (leftNow) {
          var more = document.createElement('p');
          more.className = 'fetch-lead';
          more.textContent = tn(leftNow, 'fetchStillLinksOne', '$1 article still has no saved text.', 'fetchStillLinks', '$1 articles still have no saved text.');
          el.summaryNotes.appendChild(more);
        }
      } else {
        el.summaryTitle.textContent = leftNow
          ? tn(leftNow, 'fetchCountOne', '$1 article has no saved text', 'fetchCount', '$1 articles have no saved text')
          : t('fetchNoneTitle', 'Every saved article already has its text');
      }
      show(el.explain, leftNow > 0 && st !== 'done' && st !== 'stopped');
      el.btnStart.hidden = leftNow === 0;
      el.btnStart.textContent = granted
        ? (st === 'done' || st === 'stopped' ? t('fetchStartAgain', 'Get the rest') : t('fetchStart', 'Start'))
        : t('fetchAllowStart', 'Allow and start');
      el.btnStart.disabled = !haveLock;
      show(el.permNote, !granted && leftNow > 0);
      show(el.btnList, leftNow === 0 || st === 'done' || st === 'stopped');
    }

    // Progress card
    show(el.run, inRun);
    if (inRun) {
      var pct = c.total ? Math.round(((c.done + c.failed) / c.total) * 100) : 0;
      el.bar.style.width = pct + '%';
      el.bar.setAttribute('aria-valuenow', String(pct));
      el.bar.setAttribute('aria-valuetext', t('fetchProgressValue', '$1 of $2 pages', [num(c.done + c.failed), num(c.total)]));
      setStat('stat-done', c.done);
      setStat('stat-failed', c.failed);
      setStat('stat-left', c.left);
      el.runTitle.textContent = st === 'paused'
        ? (autoPausedOffline ? t('fetchOfflineTitle', 'Waiting for the internet') : t('fetchPausedTitle', 'Paused'))
        : t('fetchRunningTitle', 'Getting the full text...');
      el.runHint.textContent = st === 'paused'
        ? (granted ? t('fetchPausedHint', 'Nothing is downloading. Resume whenever you like.') : t('fetchNeedAccessHint', 'ReadLater no longer has access to read pages. Allow it again to continue.'))
        : t('fetchRunningHint', 'Keep this tab open. If you close it, it picks up where it left off next time you open this page.');
      el.btnPause.textContent = st === 'paused' ? (granted ? t('fetchResume', 'Resume') : t('fetchAllowContinue', 'Allow and continue')) : t('fetchPause', 'Pause');
      el.btnPause.disabled = !haveLock;
      el.btnStop.disabled = !haveLock;
      if (st === 'running' && pct >= lastAnnouncedPct + 25) {
        lastAnnouncedPct = pct - (pct % 25);
        announce(t('fetchProgressAnnounce', '$1 percent done', [String(lastAnnouncedPct)]));
      }
    }
    renderNow();
    renderFailures();
    show(el.lockNote, !haveLock);
  }

  /* ---------------- wiring ---------------- */

  function openList() {
    try {
      chrome.windows.getCurrent(function (w) {
        void chrome.runtime.lastError;
        if (chrome.sidePanel && chrome.sidePanel.open && w) {
          chrome.sidePanel.open({ windowId: w.id }).catch(function () {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/sidebar/sidebar.html') });
          });
        } else {
          chrome.tabs.create({ url: chrome.runtime.getURL('src/sidebar/sidebar.html') });
        }
      });
    } catch (e) {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/sidebar/sidebar.html') });
    }
  }

  /* chrome.permissions.request needs the click's user gesture, so it is the
     first thing these handlers do. */
  function onStart() {
    if (granted) { begin(); return; }
    FulltextAccess.request().then(function (ok) {
      granted = ok;
      if (ok) begin();
      else { render(); announce(t('fetchDenied', 'No problem. Nothing was downloaded. You can allow it any time from this page.')); }
    });
  }

  function onPause() {
    if (state.status === 'running') { pause(); return; }
    if (granted) { resume(); return; }
    FulltextAccess.request().then(function (ok) {
      granted = ok;
      if (ok) resume(); else render();
    });
  }

  function onRetry() {
    if (granted) { retryFailed(); return; }
    FulltextAccess.request().then(function (ok) {
      granted = ok;
      if (ok) retryFailed(); else render();
    });
  }

  function acquireLock() {
    if (!navigator.locks || !navigator.locks.request) return Promise.resolve(true);
    return new Promise(function (resolve) {
      navigator.locks.request('rl-fetch-text', { ifAvailable: true }, function (lock) {
        if (!lock) { resolve(false); return null; }
        resolve(true);
        return new Promise(function () { /* held for the page's lifetime */ });
      }).catch(function () { resolve(true); });
    });
  }

  function init() {
    if (typeof I18n !== 'undefined') I18n.translateDOM();
    ['summary', 'summary-title', 'summary-notes', 'explain', 'perm-note', 'btn-start', 'btn-list', 'run', 'run-title', 'run-hint',
      'bar', 'now-wrap', 'now', 'btn-pause', 'btn-stop', 'failures', 'failures-title', 'fail-list', 'fail-more', 'fail-hint', 'btn-retry',
      'lock-note', 'live', 'loading'].forEach(function (id) {
      el[id.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = document.getElementById(id);
    });

    el.btnStart.addEventListener('click', onStart);
    el.btnPause.addEventListener('click', onPause);
    el.btnStop.addEventListener('click', stop);
    el.btnRetry.addEventListener('click', onRetry);
    el.btnList.addEventListener('click', openList);

    window.addEventListener('online', function () {
      if (autoPausedOffline && state && state.status === 'paused') resume();
    });
    window.addEventListener('offline', function () {
      if (running()) { autoPausedOffline = true; pause(); }
    });
    window.addEventListener('pagehide', function () { if (saveTimer) writeState(); });

    FulltextAccess.onChange(function (ok) {
      granted = ok;
      if (!ok && running()) pause();
      render();
    });

    Promise.all([acquireLock(), FulltextAccess.has(), loadState(), FulltextAccess.listLinkOnly()]).then(function (r) {
      haveLock = r[0];
      granted = r[1];
      state = r[2];
      items = toItems(r[3].reverse());
      buildPending(state.status !== 'idle');

      show(el.loading, false);
      if (state.status === 'running') {
        if (granted && haveLock) {
          announce(t('fetchResumedAnnounce', 'Picking up where you left off.'));
          pump();
        } else {
          state.status = 'paused';
          render();
        }
      } else {
        render();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
