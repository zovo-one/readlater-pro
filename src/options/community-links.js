/* ============================================================
   ReadLater Pro - help and links section
   ============================================================
   Two links, both verified reachable on 2026-08-09:
     https://zovo.one/support            HTTP 200
     https://github.com/theluckystrike   HTTP 200
   The fourth card used to be a store-detail link whose label
   asked the user to rate the extension. Store-detail links are
   banned outright by CWS-COMPLIANCE-RULES and rating requests
   are a metadata violation, so the card was deleted rather than
   reworded. Rewording the label while keeping the mechanism is
   not compliance.
   Every string goes through i18n with an English fallback.
   Icon colour comes from the theme, never a hardcoded hex, so
   contrast holds in light and dark.
   ============================================================ */
(function () {
  'use strict';

  var MAX_CHANNELS = 10;
  var GITHUB_PATH = 'M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z';

  function t(key, fallback) {
    if (typeof I18n === 'undefined' || !I18n.get) { return fallback; }
    var msg = I18n.get(key);
    return (msg && msg !== key) ? msg : fallback;
  }

  function channels() {
    return [
      {
        id: 'support',
        label: t('communitySupportLabel', 'Support'),
        description: t('communitySupportDesc', 'Read the help pages or write to the developer'),
        url: 'https://zovo.one/support',
        iconType: 'message'
      },
      {
        id: 'github',
        label: t('communityGithubLabel', 'GitHub'),
        description: t('communityGithubDesc', 'The code and the person who writes it'),
        url: 'https://github.com/theluckystrike',
        iconPath: GITHUB_PATH
      }
    ];
  }

  function svgEl(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
  }

  function buildIcon(channel) {
    var svg = svgEl('svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    if (channel.iconType === 'message') {
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      var path = svgEl('path');
      path.setAttribute('d', 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z');
      svg.appendChild(path);
      return svg;
    }

    svg.setAttribute('fill', 'currentColor');
    var solid = svgEl('path');
    solid.setAttribute('d', channel.iconPath);
    svg.appendChild(solid);
    return svg;
  }

  function openUrl(url, id) {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url }, function () {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('[community] tabs.create: ' + chrome.runtime.lastError.message);
        }
      });
    } else {
      window.open(url, '_blank', 'noopener');
    }
    if (typeof Analytics !== 'undefined' && Analytics.track) {
      Analytics.track('community_link_click', { channel: id });
    }
  }

  function buildCard(channel) {
    var card = document.createElement('a');
    card.className = 'community__channel-card';
    card.href = channel.url;
    card.target = '_blank';
    card.rel = 'noopener';
    card.setAttribute('aria-label', channel.label + ', ' + channel.description);

    var icon = document.createElement('div');
    icon.className = 'community__channel-icon';
    icon.appendChild(buildIcon(channel));
    card.appendChild(icon);

    var info = document.createElement('div');
    info.className = 'community__channel-info';
    var label = document.createElement('span');
    label.className = 'community__channel-label';
    label.textContent = channel.label;
    info.appendChild(label);
    var desc = document.createElement('span');
    desc.className = 'community__channel-desc';
    desc.textContent = channel.description;
    info.appendChild(desc);
    card.appendChild(info);

    card.addEventListener('click', function (event) {
      event.preventDefault();
      openUrl(channel.url, channel.id);
    });

    return card;
  }

  function extensionName() {
    var name = 'ReadLater Pro';
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
      var declared = chrome.runtime.getManifest().name;
      if (declared && declared.indexOf('__MSG_') !== 0) { name = declared; }
    }
    return name;
  }

  function extensionVersion() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
      return chrome.runtime.getManifest().version;
    }
    return '';
  }

  function render(selector) {
    var host = document.querySelector(selector);
    if (!host) { return; }
    host.textContent = '';

    var root = document.createElement('div');
    root.className = 'community';

    var title = document.createElement('h2');
    title.className = 'community__title';
    title.textContent = t('communityTitle', 'Help and links');
    root.appendChild(title);

    var subtitle = document.createElement('p');
    subtitle.className = 'community__subtitle';
    subtitle.textContent = t('communitySubtitle', 'Where to reach a person when something is wrong');
    root.appendChild(subtitle);

    var grid = document.createElement('div');
    grid.className = 'community__channels';
    var list = channels();
    var count = Math.min(list.length, MAX_CHANNELS);
    for (var i = 0; i < count; i++) { grid.appendChild(buildCard(list[i])); }
    root.appendChild(grid);

    var footer = document.createElement('div');
    footer.className = 'community__footer';
    footer.textContent = extensionName() + ' v' + extensionVersion();
    root.appendChild(footer);

    host.appendChild(root);
  }

  var api = { render: render };
  if (typeof self !== 'undefined') { self.CommunityLinks = api; }
  if (typeof window !== 'undefined') { window.CommunityLinks = api; }
})();
