/* ReadLater Pro - Listen mode for the reader (1.3.0).
 *
 * window.speechSynthesis. Voices installed on the computer (localService) are
 * listed first and picked automatically, so Listen works offline; Chrome's
 * online voices stay available, marked "(online)".
 * Reads paragraph by paragraph. Each paragraph is split into sentence chunks
 * under ~220 characters, because Chrome cuts long utterances off after about
 * 15 seconds with some voices. Pause cancels and resumes from the current
 * chunk, which behaves the same on every platform (speechSynthesis.pause()
 * does not).
 */
(function () {
  'use strict';

  var App = window.ReaderApp;
  if (!App) return;

  var t = App.t;
  var synth = window.speechSynthesis;
  var hasApi = !!(synth && window.SpeechSynthesisUtterance);
  var RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  var MAX_CHUNK = 220;
  var CANDIDATES = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  var btn = document.getElementById('btn-listen');
  var bar = document.getElementById('tts-bar');
  var playBtn = document.getElementById('tts-play');
  var prevBtn = document.getElementById('tts-prev');
  var nextBtn = document.getElementById('tts-next');
  var rateSel = document.getElementById('tts-rate');
  var voiceSel = document.getElementById('tts-voice');
  var statusEl = document.getElementById('tts-status');
  var closeBtn = document.getElementById('tts-close');
  if (!btn || !bar) return;

  var paras = [];
  var cur = -1;
  var chunks = [];
  var chunkIdx = 0;
  var playing = false;
  var finished = false;
  var gen = 0;
  var errors = 0;
  var voices = [];
  var voice = null;
  var lang = '';
  var rate = 1;
  var speakTimer = null;

  // ---------------------------------------------------------------------------
  // Paragraphs

  function ownText(el) {
    var out = '';
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 1 && n !== el && n.matches(CANDIDATES)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.tagName === 'BR') out += ' ';
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function collect() {
    var body = App.body();
    var list = [];
    var title = document.getElementById('article-title');
    if (title && title.textContent.trim()) list.push(title);
    if (body) {
      var els = body.querySelectorAll(CANDIDATES);
      for (var i = 0; i < els.length; i++) {
        if (els[i].closest('pre') || !ownText(els[i])) continue;
        list.push(els[i]);
      }
    }
    paras = list;
  }

  // ---------------------------------------------------------------------------
  // Chunking

  function splitLong(s) {
    var out = [];
    var parts = s.split(/(?<=[,;:])\s+/);
    var buf = '';
    parts.forEach(function (p) {
      if (p.length > MAX_CHUNK) {
        if (buf) { out.push(buf); buf = ''; }
        p.split(' ').forEach(function (w) {
          if (buf && (buf + ' ' + w).length > MAX_CHUNK) { out.push(buf); buf = w; }
          else buf = buf ? buf + ' ' + w : w;
        });
      } else if (buf && (buf + ' ' + p).length > MAX_CHUNK) {
        out.push(buf);
        buf = p;
      } else {
        buf = buf ? buf + ' ' + p : p;
      }
    });
    if (buf) out.push(buf);
    return out;
  }

  function sentences(text) {
    if (window.Intl && Intl.Segmenter) {
      try {
        var seg = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' });
        return Array.from(seg.segment(text), function (x) { return x.segment; });
      } catch (e) { /* fall through */ }
    }
    return text.match(/[^.!?]+(?:[.!?]+["')\]”’]*\s*|$)/g) || [text];
  }

  function chunk(text) {
    if (text.length <= MAX_CHUNK) return [text];
    var out = [];
    var buf = '';
    sentences(text).forEach(function (s) {
      s = s.trim();
      if (!s) return;
      if (s.length > MAX_CHUNK) {
        if (buf) { out.push(buf); buf = ''; }
        out = out.concat(splitLong(s));
      } else if (buf && (buf + ' ' + s).length > MAX_CHUNK) {
        out.push(buf);
        buf = s;
      } else {
        buf = buf ? buf + ' ' + s : s;
      }
    });
    if (buf) out.push(buf);
    return out.length ? out : [text];
  }

  // ---------------------------------------------------------------------------
  // Voices and language

  var STOP = {
    en: ' the and of to is in that it for with was on are as this be ',
    de: ' der die und das ist nicht ein eine zu den mit sich auch ',
    fr: ' le la les et des est une pas que pour dans qui sur avec ',
    es: ' el la los las y que de en un una es por con para del ',
    it: ' il di che e la per un una non sono della con del gli ',
    pt: ' o a os as e que de do da em um uma para com não ',
    nl: ' de het een en van is dat niet op te zijn met voor ',
    sv: ' och att det som en på är av för med inte till den '
  };

  function guessLang() {
    var body = App.body();
    var tagged = body && body.querySelector('[lang]');
    if (tagged && tagged.getAttribute('lang')) return tagged.getAttribute('lang');
    var words = ((body && body.textContent) || '').slice(0, 4000).toLowerCase().split(/[^a-zÀ-ɏ]+/);
    var best = '';
    var top = 0;
    Object.keys(STOP).forEach(function (k) {
      var n = 0;
      for (var i = 0; i < words.length; i++) if (words[i] && STOP[k].indexOf(' ' + words[i] + ' ') >= 0) n++;
      if (n > top) { top = n; best = k; }
    });
    var nav = (navigator.language || 'en').toLowerCase();
    if (top < 8) return nav;
    // Keep the user's region when it is the same language (en-GB reader, English article).
    return nav.split('-')[0] === best ? nav : best;
  }

  function primary(l) {
    return String(l || '').toLowerCase().replace('_', '-').split('-')[0];
  }

  function langName(l) {
    try {
      return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(primary(l));
    } catch (e) {
      return primary(l);
    }
  }

  function sortVoices(list) {
    var want = primary(lang);
    var region = String(lang || '').toLowerCase().replace('_', '-');
    // Local voices always come first: they work offline and the text never leaves the computer.
    function rank(v) {
      var r = 0;
      if (v.localService) r -= 8;
      if (v.lang && v.lang.toLowerCase().replace('_', '-') === region) r -= 4;
      if (v.default) r -= 1;
      return r;
    }
    var match = [];
    var other = [];
    list.forEach(function (v) { (primary(v.lang) === want ? match : other).push(v); });
    match.sort(function (a, b) { return rank(a) - rank(b) || a.name.localeCompare(b.name); });
    other.sort(function (a, b) { return String(a.lang).localeCompare(String(b.lang)) || (b.localService ? 1 : 0) - (a.localService ? 1 : 0) || a.name.localeCompare(b.name); });
    return { match: match, other: other };
  }

  function loadVoices() {
    if (!hasApi) return;
    voices = synth.getVoices() || [];
    fillVoices();
    if (bar && !bar.hidden && bar.classList.contains('rl-tts-novoice') && voices.length) {
      bar.classList.remove('rl-tts-novoice');
      setStatus('');
    }
    updateButton();
  }

  function whenVoices(ms) {
    return new Promise(function (resolve) {
      if (!hasApi) { resolve(false); return; }
      loadVoices();
      if (voices.length) { resolve(true); return; }
      var waited = 0;
      var iv = setInterval(function () {
        loadVoices();
        waited += 100;
        if (voices.length || waited >= ms) {
          clearInterval(iv);
          resolve(voices.length > 0);
        }
      }, 100);
    });
  }

  function opt(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function fillVoices() {
    if (!voiceSel) return;
    if (!lang) lang = guessLang();
    var saved = App.setting('ttsVoice') || '';
    var groups = sortVoices(voices);
    while (voiceSel.firstChild) voiceSel.removeChild(voiceSel.firstChild);
    voiceSel.appendChild(opt('', t('readerTtsVoiceAuto', 'Automatic voice')));
    function group(label, vs) {
      if (!vs.length) return;
      var g = document.createElement('optgroup');
      g.label = label;
      vs.forEach(function (v) {
        g.appendChild(opt(v.voiceURI, v.name + (v.lang ? ' (' + v.lang + ')' : '') + (v.localService ? '' : ' ' + t('polishTtsOnline', '(online)'))));
      });
      voiceSel.appendChild(g);
    }
    group(langName(lang) || t('readerTtsVoicesArticle', 'Article language'), groups.match);
    group(t('readerTtsVoicesOther', 'Other languages'), groups.other);
    var found = null;
    if (saved) voices.forEach(function (v) { if (v.voiceURI === saved) found = v; });
    voiceSel.value = found ? saved : '';
    voice = found || groups.match[0] || null;
  }

  function fillRates() {
    if (!rateSel) return;
    var r = parseFloat(App.setting('ttsRate'));
    rate = isFinite(r) && r >= 0.5 && r <= 2.5 ? r : 1;
    var list = RATES.slice();
    if (list.indexOf(rate) < 0) {
      list.push(rate);
      list.sort(function (a, b) { return a - b; });
    }
    while (rateSel.firstChild) rateSel.removeChild(rateSel.firstChild);
    list.forEach(function (x) {
      rateSel.appendChild(opt(String(x), t('readerTtsRate', '$1x', [String(x)])));
    });
    rateSel.value = String(rate);
    rateSel.setAttribute('aria-label', t('readerTtsSpeed', 'Speed'));
  }

  // ---------------------------------------------------------------------------
  // Playback

  function setStatus(s) {
    if (statusEl) statusEl.textContent = s;
  }

  function updateUi() {
    bar.classList.toggle('rl-tts-playing', playing);
    playBtn.setAttribute('aria-label', playing ? t('readerTtsPause', 'Pause') : t('readerTtsPlay', 'Play'));
    playBtn.title = (playing ? t('readerTtsPause', 'Pause') : t('readerTtsPlay', 'Play')) + ' (L)';
    btn.setAttribute('aria-pressed', String(!bar.hidden));
    btn.classList.toggle('rl-on', !bar.hidden);
    prevBtn.disabled = cur <= 0;
    nextBtn.disabled = cur < 0 || cur >= paras.length - 1;
    if (cur >= 0 && paras.length) {
      setStatus(finished ? t('readerTtsFinished', 'Finished') : t('readerTtsProgress', '$1 of $2', [String(cur + 1), String(paras.length)]));
    }
  }

  function toolbarBottom() {
    var tb = document.querySelector('.reader-toolbar');
    return tb ? tb.getBoundingClientRect().bottom : 0;
  }

  function keepInView(el) {
    var r = el.getBoundingClientRect();
    var top = toolbarBottom() + 12;
    var bottom = window.innerHeight - (bar.hidden ? 0 : bar.offsetHeight) - 12;
    if (r.top >= top && r.bottom <= bottom) return;
    var y = window.scrollY + r.top - top - Math.max(0, Math.min(80, (bottom - top - r.height) / 3));
    window.scrollTo({ top: Math.max(0, y), behavior: reduceMotion && reduceMotion.matches ? 'auto' : 'smooth' });
  }

  function markCurrent() {
    var old = document.querySelectorAll('.rl-tts-current');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('rl-tts-current');
    var el = paras[cur];
    if (el) {
      el.classList.add('rl-tts-current');
      keepInView(el);
    }
  }

  function goTo(i, speak) {
    if (!paras.length) return;
    cur = Math.max(0, Math.min(i, paras.length - 1));
    finished = false;
    var el = paras[cur];
    chunks = chunk(el.id === 'article-title' ? el.textContent.replace(/\s+/g, ' ').trim() : ownText(el));
    chunkIdx = 0;
    markCurrent();
    updateUi();
    if (speak && playing) speakChunk();
  }

  function speakChunk() {
    var myGen = ++gen;
    clearTimeout(speakTimer);
    var text = chunks[chunkIdx];
    if (!text) { advance(myGen); return; }
    var u = new SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else if (lang) {
      u.lang = lang;
    }
    u.rate = rate;
    u.onstart = function () { errors = 0; };
    u.onend = function () {
      if (myGen === gen && playing) advance(myGen);
    };
    u.onerror = function (ev) {
      if (myGen !== gen || !playing) return;
      if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return;
      console.warn('[Reader] Speech error:', ev && ev.error);
      if (++errors >= 3) {
        pause();
        App.tip(t('readerTtsError', "Couldn't play this voice. Try another one."));
        return;
      }
      advance(myGen);
    };
    // Chrome sometimes drops a speak() issued right after cancel().
    if (synth.speaking || synth.pending) {
      synth.cancel();
      speakTimer = setTimeout(function () { if (myGen === gen && playing) synth.speak(u); }, 60);
    } else {
      synth.speak(u);
    }
  }

  function advance(myGen) {
    if (myGen !== gen || !playing) return;
    if (chunkIdx + 1 < chunks.length) {
      chunkIdx++;
      speakChunk();
    } else if (cur + 1 < paras.length) {
      goTo(cur + 1, true);
    } else {
      playing = false;
      finished = true;
      gen++;
      updateUi();
    }
  }

  function firstVisible() {
    if (window.scrollY < 40) return 0;
    var top = toolbarBottom() + 4;
    for (var i = 0; i < paras.length; i++) {
      var r = paras[i].getBoundingClientRect();
      if (r.bottom > top && r.top < window.innerHeight) return i;
    }
    return 0;
  }

  function noVoices() {
    openBar();
    bar.classList.add('rl-tts-novoice');
    setStatus(hasApi
      ? t('readerTtsNoVoices', "No voices are installed. Add a voice in your system's speech settings, then try again.")
      : t('readerTtsUnsupported', "This browser can't read articles aloud."));
    closeBtn.focus();
  }

  function openBar() {
    bar.hidden = false;
    document.documentElement.classList.add('rl-tts-open');
    updateUi();
  }

  // Listen is free for 3 articles a day and unlimited with Pro (limits-config.json
  // listen_aloud). An article counts once per local day, however often it's
  // paused or reopened; the count starts over at local midnight (feature-gate.js).
  var listenAllowed = false, gating = false;
  function gateListen(next) {
    if (gating) return;
    if (typeof FeatureGate === 'undefined' || !FeatureGate.gateFeature) { listenAllowed = true; next(); return; }
    gating = true;
    FeatureGate.gateFeature('listen_aloud', function () {
      gating = false;
      listenAllowed = true;
      next();
    }, {
      countOnce: (App.article() && App.article().id) || location.href,
      onBlocked: function () {
        gating = false;
        openBar();
        bar.classList.add('rl-tts-novoice');
        setStatus(t('proListenCap', "You've listened to 3 articles today on the free plan. Listen is back tomorrow, or unlimited with Pro."));
        closeBtn.focus();
        if (typeof Paywall !== 'undefined' && Paywall.show) Paywall.show(t('proListenFeature', 'Unlimited Listen'), { featureId: 'listen_aloud', surface: 'caphit' });
      }
    });
  }

  function play() {
    if (!listenAllowed) {
      whenVoices(voices.length ? 0 : 1500).then(function (ok) { if (ok) gateListen(play); else noVoices(); });
      return;
    }
    whenVoices(voices.length ? 0 : 1500).then(function (ok) {
      if (!ok) { noVoices(); return; }
      bar.classList.remove('rl-tts-novoice');
      if (!paras.length || !document.contains(paras[paras.length - 1])) collect();
      if (!paras.length) return;
      var wasOpen = !bar.hidden;
      openBar();
      playing = true;
      errors = 0;
      if (cur < 0 || finished) goTo(finished ? 0 : firstVisible(), false);
      updateUi();
      speakChunk();
      if (!wasOpen && !bar.contains(document.activeElement)) playBtn.focus();
    });
  }

  function pause() {
    playing = false;
    gen++;
    clearTimeout(speakTimer);
    if (hasApi) synth.cancel();
    updateUi();
  }

  function toggle() {
    playing ? pause() : play();
  }

  function close() {
    var hadFocus = bar.contains(document.activeElement);
    pause();
    bar.hidden = true;
    bar.classList.remove('rl-tts-novoice');
    document.documentElement.classList.remove('rl-tts-open');
    var old = document.querySelectorAll('.rl-tts-current');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('rl-tts-current');
    cur = -1;
    finished = false;
    setStatus('');
    updateUi();
    if (hadFocus) btn.focus();
  }

  function updateButton() {
    var label = !hasApi || (voicesChecked && !voices.length)
      ? t('readerTtsNoVoicesShort', 'Listen (no voices installed)')
      : t('readerTtsListen', 'Listen');
    btn.setAttribute('aria-label', label);
    btn.title = label + ' (L)';
  }

  // ---------------------------------------------------------------------------
  // Wiring

  var voicesChecked = false;
  if (hasApi) {
    if (synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
    else synth.onvoiceschanged = loadVoices;
  }
  setTimeout(function () {
    whenVoices(2000).then(function () { voicesChecked = true; updateButton(); });
  }, 0);

  document.addEventListener('rl:rendered', function () {
    lang = guessLang();
    fillRates();
    loadVoices();
    collect();
  });

  btn.addEventListener('click', function () {
    if (bar.hidden) play();
    else close();
  });
  playBtn.addEventListener('click', toggle);
  prevBtn.addEventListener('click', function () {
    if (cur > 0) goTo(cur - 1, true);
  });
  nextBtn.addEventListener('click', function () {
    if (cur < paras.length - 1) goTo(cur + 1, true);
  });
  closeBtn.addEventListener('click', close);
  rateSel && rateSel.addEventListener('change', function () {
    rate = parseFloat(rateSel.value) || 1;
    App.saveSettings({ ttsRate: rate });
    if (playing) { chunkIdx = chunkIdx || 0; speakChunk(); }
  });
  voiceSel && voiceSel.addEventListener('change', function () {
    var uri = voiceSel.value;
    App.saveSettings({ ttsVoice: uri });
    voice = null;
    voices.forEach(function (v) { if (v.voiceURI === uri) voice = v; });
    if (!voice) voice = sortVoices(voices).match[0] || null;
    if (playing) speakChunk();
  });

  // Clicking a paragraph while playing jumps there.
  document.addEventListener('click', function (e) {
    if (!playing || bar.hidden) return;
    var tgt = e.target;
    if (!tgt.closest || tgt.closest('a, button, mark.rl-hl, .rl-hl-pop, .rl-hl-note, #tts-bar')) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    for (var n = tgt; n && n !== document.body; n = n.parentNode) {
      var i = paras.indexOf(n);
      if (i >= 0) {
        if (i !== cur) goTo(i, true);
        return;
      }
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && playing) pause();
  });
  window.addEventListener('pagehide', function () {
    if (hasApi) synth.cancel();
  });

  App.onKey('l', function () {
    if (bar.hidden) play();
    else if (bar.classList.contains('rl-tts-novoice')) close();
    else toggle();
  });
  App.onEscape(function () {
    if (bar.hidden) return false;
    close();
    return true;
  });

  fillRates();
  updateButton();
})();
