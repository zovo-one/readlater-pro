/* ============================================================
   ReadLater Pro - install attribution capture
   ------------------------------------------------------------
   Reads the query string and fragment the install landed with,
   classifies the referrer, and hands the result to Attribution
   for local storage. Nothing is sent off the device here.
   ------------------------------------------------------------
   Runs before welcome.js and must never block or throw, because
   a failure here would cost a first run over a marketing number.
   ============================================================ */
(function () {
  'use strict';

  var MAX_PARAMS = 24;
  var MAX_VALUE_CHARS = 200;

  var REFERRER_MAP = [
    { needle: 'google.', source: 'google' },
    { needle: 'bing.', source: 'bing' },
    { needle: 'duckduckgo.', source: 'duckduckgo' },
    { needle: 'twitter.', source: 'twitter' },
    { needle: 'x.com', source: 'twitter' },
    { needle: 'producthunt.', source: 'producthunt' },
    { needle: 'reddit.', source: 'reddit' },
    { needle: 'news.ycombinator.', source: 'hackernews' },
    { needle: 'youtube.', source: 'youtube' }
  ];

  function collect(search, hash) {
    var out = {}, count = 0;
    var sources = [new URLSearchParams(search || ''), new URLSearchParams(String(hash || '').replace(/^#/, ''))];
    for (var i = 0; i < sources.length; i++) {
      var pairs = [];
      sources[i].forEach(function (value, name) { pairs.push([name, value]); });
      for (var j = 0; j < pairs.length && count < MAX_PARAMS; j++) {
        out[pairs[j][0]] = String(pairs[j][1]).slice(0, MAX_VALUE_CHARS);
        count++;
      }
    }
    return out;
  }

  function classify(referrer) {
    var host = String(referrer || '').toLowerCase();
    for (var i = 0; i < REFERRER_MAP.length; i++) {
      if (host.indexOf(REFERRER_MAP[i].needle) !== -1) { return REFERRER_MAP[i].source; }
    }
    return '';
  }

  function capture() {
    var params;
    try {
      params = collect(window.location.search, window.location.hash);
    } catch (e) {
      params = {};
    }

    var referrer = '';
    try { referrer = document.referrer || ''; } catch (e2) { referrer = ''; }

    if (referrer) {
      params.referrer = referrer.slice(0, MAX_VALUE_CHARS);
      if (!params.utm_source) {
        var guessed = classify(referrer);
        if (guessed) { params.utm_source = guessed; }
      }
    }

    if (!params.utm_source && !params.ref) {
      params.utm_source = 'organic';
      params.utm_medium = 'chrome_web_store';
    }

    if (params.ref && typeof Referral !== 'undefined' && Referral.recordReferralSource) {
      try { Referral.recordReferralSource(params.ref); } catch (e3) { warn(e3); }
    }

    if (typeof Attribution !== 'undefined' && Attribution.store) {
      try {
        Attribution.store(params).catch(warn);
      } catch (e4) { warn(e4); }
    }
  }

  function warn(err) {
    var text = (err && err.message) ? err.message : String(err);
    if (typeof console !== 'undefined') { console.warn('[attribution] ' + text); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', capture);
  } else {
    capture();
  }
})();
