/* ============================================================
   ReadLater Pro - help and FAQ section
   ============================================================
   No price numbers. Corrected 2026-08-09 against the rewritten
   hard rule 2. Prices live in exactly two places, the onboarding
   final step and zovo.one, because the extension is not their
   source of truth and a compiled-in price goes stale on a
   schedule no shipped package can see. This section describes
   the shape of the offer and hands off with the neutral CTA.
   The one number it does print, the free daily full-text search
   allowance, is read at runtime from limits-config.json, which
   ships in this package and is what the gate itself reads.
   No review solicitation, no store links, no emoji.
   Every user-facing string goes through i18n with an English
   fallback so the section still reads before the merge lands.
   ============================================================ */
(function () {
  'use strict';

  var MAX_CATEGORIES = 40;
  var MAX_QUESTIONS_PER_CATEGORY = 40;
  var SEARCH_DEBOUNCE_MS = 200;
  var LIMITS_CONFIG_PATH = 'src/features/limits-config.json';

  /* The free full-text-search allowance, read from the same file the
     gate reads so the help text cannot drift from the behaviour.
     Null until the read resolves, and null if it fails, in which case
     the answer describes the allowance without asserting a number. */
  var freeSearchCap = null;

  function loadFreeSearchCap() {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) { resolve(null); return; }
      fetch(chrome.runtime.getURL(LIMITS_CONFIG_PATH))
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (config) {
          var cap = config && config.freeCaps ? config.freeCaps.full_text_search : null;
          resolve(typeof cap === 'number' ? cap : null);
        })
        .catch(function () { resolve(null); });
    });
  }

  function t(key, fallback) {
    if (typeof I18n === 'undefined' || !I18n.get) { return fallback; }
    var msg = I18n.get(key);
    return (msg && msg !== key) ? msg : fallback;
  }

  function tf(key, args, fallback) {
    if (typeof I18n === 'undefined' || !I18n.get) { return fallback; }
    var msg = I18n.get(key, args);
    return (msg && msg !== key) ? msg : fallback;
  }

  function searchAnswer() {
    var base = t('faqASearchBase', 'Yes. The search bar at the top of the side panel matches article titles, URLs and tags, with no limit. Full-text search reads inside the article body as well.');
    if (freeSearchCap === null) {
      return base + ' ' + t('faqASearchCapUnknown', 'On the free plan it has a daily allowance.');
    }
    return base + ' ' + tf('faqASearchCap', [String(freeSearchCap)],
      'On the free plan it covers ' + freeSearchCap + ' of those a day.');
  }

  /* ==========================================================
     Content. Answers describe what the code actually does.
     ========================================================== */
  function buildCatalog() {
    return [
      {
        category: t('faqCatGettingStarted', 'Getting started'),
        questions: [
          {
            q: t('faqQSaveArticle', 'How do I save an article'),
            a: t('faqASaveArticle', 'Click the ReadLater Pro icon in your toolbar, or press Ctrl+Shift+S, which is Cmd+Shift+S on a Mac. The page goes straight to your reading list.'),
            tags: ['save', 'setup', 'install', 'begin', 'start']
          },
          {
            q: t('faqQOpenList', 'How do I open my reading list'),
            a: t('faqAOpenList', 'Press Ctrl+Shift+L, which is Cmd+Shift+L on a Mac, to open the side panel. You can also right-click the extension icon and choose Open Reading List.'),
            tags: ['reading list', 'side panel', 'open', 'access']
          },
          {
            q: t('faqQOpenSettings', 'How do I open settings'),
            a: t('faqAOpenSettings', 'Right-click the ReadLater Pro icon in your toolbar and choose Options. This page is where the reader theme, font size, content width and the rest live.'),
            tags: ['settings', 'options', 'configure', 'preferences']
          }
        ]
      },
      {
        category: t('faqCatReading', 'Reading and organizing'),
        questions: [
          {
            q: t('faqQReaderView', 'How do I use reader view'),
            a: t('faqAReaderView', 'Click any article in your reading list. It opens in a clean reader with the fonts, width and theme you set on this page.'),
            tags: ['reader', 'view', 'read', 'clean']
          },
          {
            q: t('faqQTags', 'How do I tag articles'),
            a: t('faqATags', 'Right-click any article in your reading list and choose Add Tag. You can create a new tag or pick an existing one.'),
            tags: ['tags', 'organize', 'categorize', 'label']
          },
          {
            q: t('faqQSearch', 'Can I search my saved articles'),
            a: searchAnswer(),
            tags: ['search', 'find', 'filter', 'lookup', 'full text']
          },
          {
            q: t('faqQFavorites', 'How do I mark an article as a favorite'),
            a: t('faqAFavorites', 'Click the star icon on the article card, or right-click it and choose Toggle Favorite. Favorites get their own tab in the side panel.'),
            tags: ['favorite', 'star', 'bookmark']
          }
        ]
      },
      {
        category: t('faqCatImportExport', 'Importing and exporting'),
        questions: [
          {
            q: t('faqQPocket', 'How do I import from Pocket'),
            a: t('faqAPocket', 'Open Data on this page and choose Import a file. Pocket\'s ZIP export, its CSV and the older HTML export all work. Articles, tags and read status carry over, plus highlights from the ZIP, and the import is free.'),
            tags: ['pocket', 'import', 'migrate', 'transfer']
          },
          {
            q: t('faqQExport', 'Can I export my articles'),
            a: t('faqAExport', 'Yes. Open Data on this page and choose Export Articles, or use Export All Data further down for settings and articles together. Both write a JSON file you can import again later.'),
            tags: ['export', 'backup', 'download', 'save data']
          }
        ]
      },
      {
        category: t('faqCatTrouble', 'Troubleshooting'),
        questions: [
          {
            q: t('faqQNotWorking', 'The extension does not work on this page'),
            a: t('faqANotWorking', 'Chrome blocks extensions on chrome:// pages, the Chrome Web Store and other extension pages. Try a normal website. If it still fails, switch the extension off and on again at chrome://extensions.'),
            tags: ['broken', 'not working', 'error', 'page']
          },
          {
            q: t('faqQNoContent', 'An article saved without its content'),
            a: t('faqANoContent', 'Some sites block content extraction. The URL and title are still saved so the original page stays one click away. A print or reader version of the same page often saves cleanly.'),
            tags: ['empty', 'no content', 'blank', 'missing']
          },
          {
            q: t('faqQReset', 'How do I reset the extension'),
            a: t('faqAReset', 'Scroll to the Danger Zone on this page and choose Clear All Data. That removes every article, tag and setting, and it cannot be undone. Export first if you want a copy.'),
            tags: ['reset', 'defaults', 'clear', 'fresh start']
          },
          {
            q: t('faqQPanel', 'The side panel will not open'),
            a: t('faqAPanel', 'Check that the extension is enabled at chrome://extensions, then click the toolbar icon once to toggle the panel. Removing and reinstalling is the last resort, and it clears your local data, so export first.'),
            tags: ['side panel', 'not opening', 'sidebar', 'broken']
          }
        ]
      },
      {
        category: t('faqCatPrivacy', 'Privacy and data'),
        questions: [
          {
            q: t('faqQCollect', 'What does ReadLater Pro collect'),
            a: t('faqACollect', 'Your articles, tags and settings are written to this browser on this machine and are never uploaded. The extension makes a network call only when you check a license key, and when you send feedback you wrote yourself.'),
            tags: ['privacy', 'data', 'collection', 'tracking', 'security']
          },
          {
            q: t('faqQDelete', 'How do I delete everything'),
            a: t('faqADelete', 'Use Delete All Data in the Your Data section on this page. It clears the article database, the settings and the sync store, and it asks you to confirm first.'),
            tags: ['delete', 'remove', 'data', 'privacy', 'clear']
          },
          {
            q: t('faqQSync', 'Is my reading list synced across devices'),
            a: t('faqASync', 'No. There is no sync and no account. Every device keeps its own list. Moving a list means exporting on one machine and importing on the other.'),
            tags: ['sync', 'devices', 'cross-device', 'cloud']
          }
        ]
      },
      {
        category: t('faqCatPricing', 'Pricing'),
        questions: [
          {
            q: t('faqQFreeIncludes', 'What is free'),
            a: t('faqAFreeIncludes', 'Saving, reader view, the side panel, tags, title search, reading progress, offline copies, right-click save, Pocket import, export and reading stats. All of it, with no cap and no account.'),
            tags: ['free', 'plan', 'included', 'cost']
          },
          {
            q: t('faqQPrice', 'What does an upgrade cost'),
            a: t('faqAPrice', 'There are two ways in, a monthly plan you can cancel at any time and a one-time lifetime plan that never renews. The current figures are on zovo.one rather than in the extension, so what you read is always what you will be charged. Monthly cancels any time. Lifetime is final once your key arrives, and anything faulty gets fixed or refunded.'),
            tags: ['pro', 'price', 'cost', 'upgrade', 'purchase', 'buy', 'subscribe', 'lifetime', 'refund']
          },
          {
            q: t('faqQLicenseKey', 'How do I activate a license key'),
            a: t('faqALicenseKey', 'Open the license page from the upgrade screen, enter the key in the format XXXX-XXXX-XXXX-XXXX and choose Activate. The key is checked on the server, so you need to be online once.'),
            tags: ['license', 'key', 'activate', 'code']
          }
        ]
      },
      {
        category: t('faqCatShortcuts', 'Keyboard shortcuts'),
        questions: [
          {
            q: t('faqQShortcuts', 'Which keyboard shortcuts exist'),
            a: t('faqAShortcuts', 'Ctrl+Shift+S saves the page you are on. Ctrl+Shift+L opens the reading list. On a Mac both use Cmd instead of Ctrl.'),
            tags: ['keyboard', 'shortcuts', 'hotkeys', 'keys']
          },
          {
            q: t('faqQCustomShortcuts', 'Can I change the shortcuts'),
            a: t('faqACustomShortcuts', 'Yes. Open chrome://extensions/shortcuts and set whichever combinations you prefer.'),
            tags: ['customize', 'shortcuts', 'change', 'remap']
          }
        ]
      }
    ];
  }

  var catalog = null;
  var searchTimer = null;
  var allExpanded = false;
  var itemSeq = 0;

  function init() {
    var container = document.getElementById('faq-container');
    if (!container) { return; }
    loadFreeSearchCap().then(function (cap) {
      freeSearchCap = cap;
      catalog = buildCatalog();
      renderList(container, catalog, null);
      wireControls();
    });
  }

  function matches(entry, query) {
    var needle = query.toLowerCase();
    if (entry.q.toLowerCase().indexOf(needle) !== -1) { return true; }
    if (entry.a.toLowerCase().indexOf(needle) !== -1) { return true; }
    if (!entry.tags) { return false; }
    for (var i = 0; i < entry.tags.length; i++) {
      if (entry.tags[i].toLowerCase().indexOf(needle) !== -1) { return true; }
    }
    return false;
  }

  function filterCatalog(source, query) {
    var kept = [];
    var total = 0;
    var shown = 0;
    var catCount = Math.min(source.length, MAX_CATEGORIES);
    for (var i = 0; i < catCount; i++) {
      var group = source[i];
      var qCount = Math.min(group.questions.length, MAX_QUESTIONS_PER_CATEGORY);
      var picked = [];
      total += qCount;
      for (var j = 0; j < qCount; j++) {
        var entry = group.questions[j];
        if (!query || matches(entry, query)) { picked.push(entry); shown++; }
      }
      if (picked.length > 0) { kept.push({ category: group.category, questions: picked }); }
    }
    return { groups: kept, total: total, shown: shown };
  }

  function renderCount(query, result) {
    var node = document.getElementById('faq-results-count');
    if (!node) { return; }
    if (query) {
      node.textContent = tf('faqShowingCount', [String(result.shown), String(result.total)],
        'Showing ' + result.shown + ' of ' + result.total);
      return;
    }
    node.textContent = tf('faqQuestionCount', [String(result.total)], result.total + ' questions');
  }

  function renderList(container, source, query) {
    var result = filterCatalog(source, query);
    container.textContent = '';
    renderCount(query, result);

    if (result.groups.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'faq-no-results';
      empty.textContent = t('faqNoResults', 'No question matches that search. Try a different word.');
      container.appendChild(empty);
      return;
    }

    for (var i = 0; i < result.groups.length; i++) {
      container.appendChild(buildCategory(result.groups[i], query));
    }
  }

  function buildCategory(group, query) {
    var wrap = document.createElement('div');
    wrap.className = 'faq-category';
    var heading = document.createElement('h3');
    heading.className = 'faq-category-heading';
    heading.textContent = group.category;
    wrap.appendChild(heading);
    for (var i = 0; i < group.questions.length; i++) {
      wrap.appendChild(buildItem(group.questions[i], query));
    }
    return wrap;
  }

  function buildChevron() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'faq-chevron');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M9 18l6-6-6-6');
    svg.appendChild(path);
    return svg;
  }

  function buildItem(entry, query) {
    itemSeq++;
    var answerId = 'faq-answer-' + itemSeq;
    var item = document.createElement('div');
    item.className = 'faq-item';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'faq-question';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', answerId);
    var label = document.createElement('span');
    fillHighlighted(label, entry.q, query);
    button.appendChild(label);
    button.appendChild(buildChevron());

    var answer = document.createElement('div');
    answer.className = 'faq-answer';
    answer.id = answerId;
    var body = document.createElement('div');
    body.className = 'faq-answer-content';
    fillHighlighted(body, entry.a, query);
    answer.appendChild(body);

    button.addEventListener('click', function () {
      var open = item.classList.toggle('expanded');
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    item.appendChild(button);
    item.appendChild(answer);
    return item;
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function fillHighlighted(node, text, query) {
    if (!query) { node.appendChild(document.createTextNode(text)); return; }
    var pattern = new RegExp('(' + escapeRegExp(query) + ')', 'gi');
    var parts = text.split(pattern);
    var needle = query.toLowerCase();
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) { continue; }
      if (parts[i].toLowerCase() === needle) {
        var mark = document.createElement('mark');
        mark.className = 'faq-highlight';
        mark.textContent = parts[i];
        node.appendChild(mark);
      } else {
        node.appendChild(document.createTextNode(parts[i]));
      }
    }
  }

  function setExpandAllLabel(button) {
    if (!button) { return; }
    button.textContent = allExpanded
      ? t('buttonCollapseAll', 'Collapse all')
      : t('buttonExpandAll', 'Expand all');
    button.setAttribute('aria-expanded', allExpanded ? 'true' : 'false');
  }

  function toggleAll() {
    allExpanded = !allExpanded;
    var items = document.querySelectorAll('.faq-item');
    for (var i = 0; i < items.length; i++) {
      var button = items[i].querySelector('.faq-question');
      if (allExpanded) { items[i].classList.add('expanded'); } else { items[i].classList.remove('expanded'); }
      if (button) { button.setAttribute('aria-expanded', allExpanded ? 'true' : 'false'); }
    }
    setExpandAllLabel(document.getElementById('faq-expand-all'));
  }

  function wireControls() {
    var search = document.getElementById('faq-search');
    var container = document.getElementById('faq-container');
    var expandAll = document.getElementById('faq-expand-all');

    if (search && container) {
      search.addEventListener('input', function () {
        if (searchTimer) { clearTimeout(searchTimer); }
        searchTimer = setTimeout(function () {
          var query = search.value.trim();
          renderList(container, catalog, query || null);
          allExpanded = false;
          setExpandAllLabel(expandAll);
        }, SEARCH_DEBOUNCE_MS);
      });
    }

    if (expandAll) { expandAll.addEventListener('click', toggleAll); }

    var needHelp = document.getElementById('faq-need-help');
    if (needHelp) {
      needHelp.addEventListener('click', function (event) {
        event.preventDefault();
        var section = document.getElementById('section-feedback');
        if (section) { section.scrollIntoView({ behavior: 'smooth' }); }
      });
    }
  }

  window.FAQSection = { init: init };

  if (document.readyState !== 'loading') { init(); } else { document.addEventListener('DOMContentLoaded', init); }
})();
