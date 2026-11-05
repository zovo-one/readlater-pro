/* ReadLater Pro - "New in 1.3" card in the toolbar popup (1.3.0).
 * Shown to people who installed before this release, until they open the
 * What's new page, close the card, or have seen it 6 times. Reads and writes
 * chrome.storage.local only; no network. */
(function () {
  'use strict';

  var RELEASE = '1.3.0';
  var RELEASED_AT = Date.parse('2026-10-10T00:00:00Z');
  var MAX_SHOWS = 6;
  var SEEN_KEY = 'whatsNewPopupSeen';
  var SHOWS_KEY = 'whatsNewPopupShows';

  function t(key, fallback) {
    try { return (chrome.i18n && chrome.i18n.getMessage(key)) || fallback; } catch (e) { return fallback; }
  }

  function done(card) {
    var out = {};
    out[SEEN_KEY] = RELEASE;
    chrome.storage.local.set(out);
    if (card) card.remove();
    document.body.classList.remove('rl-wn-active');
  }

  function build() {
    var card = document.createElement('section');
    card.className = 'rl-wn-card';
    card.setAttribute('aria-label', t('popupWnAria', "What's new in ReadLater 1.3"));

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'rl-wn-close';
    close.setAttribute('aria-label', t('popupWnClose', 'Hide this note'));
    close.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    close.addEventListener('click', function () { done(card); });

    var eyebrow = document.createElement('span');
    eyebrow.className = 'rl-wn-eyebrow';
    eyebrow.textContent = t('popupWnEyebrow', 'New in 1.3');

    var title = document.createElement('strong');
    title.className = 'rl-wn-title';
    title.textContent = t('popupWnTitle', 'Highlights, Listen mode and a smarter side panel');

    var body = document.createElement('p');
    body.className = 'rl-wn-body';
    body.textContent = t('popupWnBody', "It's the biggest update yet, and nearly all of it is free. Here's what changed and why.");

    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'rl-wn-open';
    open.textContent = t('popupWnOpen', "See what's new");
    open.addEventListener('click', function () {
      done(card);
      chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/whats-new.html?from=popup') });
      window.close();
    });

    card.appendChild(close);
    card.appendChild(eyebrow);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(open);
    return card;
  }

  function init() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get([SEEN_KEY, SHOWS_KEY, 'installDate'], function (r) {
      if (chrome.runtime.lastError || !r) return;
      if (r[SEEN_KEY] === RELEASE) return;
      var installed = Number(r.installDate);
      // People who installed this release fresh get onboarding, not a "what changed" note.
      if (Number.isFinite(installed) && installed >= RELEASED_AT) return;
      var shows = Number(r[SHOWS_KEY]) || 0;
      if (shows >= MAX_SHOWS) return;
      var out = {};
      out[SHOWS_KEY] = shows + 1;
      chrome.storage.local.set(out);

      var anchor = document.querySelector('.popup-header');
      if (!anchor || !anchor.parentNode) return;
      var card = build();
      anchor.parentNode.insertBefore(card, anchor.nextSibling);
      document.body.classList.add('rl-wn-active');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
