/* ============================================================
   ReadLater Pro - privacy controls
   ============================================================
   This is the settings-side twin of the first-run dialog in
   src/components/consent.js. It reads and writes the same
   userConsent record, with the same three items and the same
   wording, so a choice made on day one can be changed here
   without the two screens describing the same switch
   differently.

   The old wording said usage counts were "shared" and crash
   reports were "sent". Neither is true. src/utils/analytics.js
   and src/utils/usage-reporter.js write to chrome.storage.local
   and never open a connection, and nothing in the tree reads
   the crashReporting flag to upload anything. The labels now
   say what actually happens, which is that both stay on this
   device until the user pastes them into a report themselves.
   ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'userConsent';
  var CONSENT_VERSION = '1.0';
  var SAVED_FLASH_MS = 1500;

  var OPTIONAL_CONTROLS = [
    {
      id: 'analytics',
      labelKey: 'consentAnalyticsLabel',
      labelText: 'Anonymous usage counts',
      descKey: 'consentAnalyticsDesc',
      descText: 'Counts which features get used, stored locally so you can see them in Settings. Nothing personal, nothing uploaded.',
      defaultValue: false
    },
    {
      id: 'crashReporting',
      labelKey: 'consentCrashLabel',
      labelText: 'Crash reports',
      descKey: 'consentCrashDesc',
      descText: 'Records the error when something breaks, so a bug report you send actually contains the cause.',
      defaultValue: false
    }
  ];

  function t(key, fallback) {
    if (typeof I18n === 'undefined' || !I18n.get) { return fallback; }
    var msg = I18n.get(key);
    return (msg && msg !== key) ? msg : fallback;
  }

  function warn(where, err) {
    var text = (err && err.message) ? err.message : String(err);
    if (typeof console !== 'undefined') { console.warn('[privacy-controls] ' + where + ': ' + text); }
  }

  function getConsent() {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) { resolve(null); return; }
      chrome.storage.local.get(STORAGE_KEY, function (res) {
        if (chrome.runtime.lastError) { warn('storage.get', chrome.runtime.lastError); resolve(null); return; }
        resolve(res ? res[STORAGE_KEY] : null);
      });
    });
  }

  function setConsentValue(id, value) {
    return getConsent().then(function (existing) {
      var record = existing || {
        version: CONSENT_VERSION,
        timestamp: new Date().toISOString(),
        essential: true,
        analytics: false,
        crashReporting: false
      };
      record[id] = value === true;
      record.timestamp = new Date().toISOString();
      return new Promise(function (resolve) {
        var patch = {};
        patch[STORAGE_KEY] = record;
        chrome.storage.local.set(patch, function () {
          if (chrome.runtime.lastError) { warn('storage.set', chrome.runtime.lastError); }
          resolve(record);
        });
      });
    });
  }

  function infoIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    svg.appendChild(circle);
    var stem = document.createElementNS(ns, 'line');
    stem.setAttribute('x1', '12');
    stem.setAttribute('y1', '16');
    stem.setAttribute('x2', '12');
    stem.setAttribute('y2', '12');
    svg.appendChild(stem);
    var dot = document.createElementNS(ns, 'line');
    dot.setAttribute('x1', '12');
    dot.setAttribute('y1', '8');
    dot.setAttribute('x2', '12.01');
    dot.setAttribute('y2', '8');
    svg.appendChild(dot);
    return svg;
  }

  function buildInfo(labelText, labelKey, descText, descKey) {
    var info = document.createElement('div');
    info.className = 'pc-control__info';
    var label = document.createElement('span');
    label.className = 'pc-control__label';
    if (labelKey) { label.setAttribute('data-i18n', labelKey); }
    label.textContent = labelText;
    info.appendChild(label);
    var desc = document.createElement('span');
    desc.className = 'pc-control__desc';
    if (descKey) { desc.setAttribute('data-i18n', descKey); }
    desc.textContent = descText;
    info.appendChild(desc);
    return info;
  }

  function buildToggle(checked, locked, controlId, accessibleName) {
    var wrap = document.createElement(locked ? 'div' : 'label');
    wrap.className = locked ? 'pc-toggle pc-toggle--locked' : 'pc-toggle';
    var input = document.createElement('input');
    input.type = 'checkbox';
    if (checked) { input.checked = true; }
    if (locked) { input.disabled = true; }
    if (controlId) { input.setAttribute('data-control-id', controlId); }
    if (accessibleName) { input.setAttribute('aria-label', accessibleName); }
    wrap.appendChild(input);
    var slider = document.createElement('span');
    slider.className = 'pc-toggle__slider';
    wrap.appendChild(slider);
    return wrap;
  }

  function buildEssentialRow() {
    var row = document.createElement('div');
    row.className = 'pc-control';
    row.appendChild(buildInfo(
      t('consentEssentialLabel', 'Essential storage'), 'consentEssentialLabel',
      t('consentEssentialDesc', 'Where your articles and settings live. It stays on this device and never leaves the browser.'), 'consentEssentialDesc'
    ));
    row.appendChild(buildToggle(true, true, null, t('consentEssentialLabel', 'Essential storage')));
    var badge = document.createElement('span');
    badge.className = 'pc-control__badge';
    badge.setAttribute('data-i18n', 'consentBadgeRequired');
    badge.textContent = t('consentBadgeRequired', 'Required');
    row.appendChild(badge);
    return row;
  }

  function buildOptionalRow(control, consent) {
    var checked = consent ? consent[control.id] === true : control.defaultValue;
    var labelText = t(control.labelKey, control.labelText);
    var row = document.createElement('div');
    row.className = 'pc-control';
    row.appendChild(buildInfo(labelText, control.labelKey, t(control.descKey, control.descText), control.descKey));
    row.appendChild(buildToggle(checked, false, control.id, labelText));

    var input = row.querySelector('input[type="checkbox"]');
    input.addEventListener('change', function (event) {
      var wanted = event.target.checked;
      setConsentValue(control.id, wanted).then(function () {
        flashSaved(row, labelText);
      });
    });
    return row;
  }

  function flashSaved(row, labelText) {
    var label = row.querySelector('.pc-control__label');
    if (!label) { return; }
    label.textContent = labelText + ', ' + t('pcSaved', 'saved');
    label.classList.add('pc-control__label--saved');
    setTimeout(function () {
      label.textContent = labelText;
      label.classList.remove('pc-control__label--saved');
    }, SAVED_FLASH_MS);
  }

  function buildInfoPanel() {
    var panel = document.createElement('div');
    panel.className = 'pc-info';
    panel.appendChild(infoIcon());

    var text = document.createElement('span');
    var lead = document.createElement('span');
    lead.setAttribute('data-i18n', 'pcInfoText');
    lead.textContent = 'Neither switch uploads anything. Both write to this browser only, and the full detail is in the';
    text.appendChild(lead);
    text.appendChild(document.createTextNode(' '));

    var link = document.createElement('a');
    link.href = '../legal/privacy-policy.html';
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('data-i18n', 'linkPrivacyPolicy');
    link.textContent = 'Privacy Policy';
    text.appendChild(link);
    text.appendChild(document.createTextNode(' '));

    var suffix = document.createElement('span');
    suffix.setAttribute('data-i18n', 'pcInfoSuffix');
    suffix.textContent = 'along with every network call the extension makes.';
    text.appendChild(suffix);

    panel.appendChild(text);
    return panel;
  }

  function render(selector) {
    var host = document.querySelector(selector);
    if (!host) { return Promise.resolve(); }

    return getConsent().then(function (consent) {
      host.textContent = '';

      var section = document.createElement('div');
      section.className = 'pc-section';

      var title = document.createElement('h2');
      title.className = 'pc-title';
      title.setAttribute('data-i18n', 'headingPrivacyControls');
      title.textContent = 'Privacy controls';
      section.appendChild(title);

      var subtitle = document.createElement('p');
      subtitle.className = 'pc-subtitle';
      subtitle.setAttribute('data-i18n', 'pcSubtitle');
      subtitle.textContent = 'The same three items you were asked about on the first run. Changing one takes effect straight away.';
      section.appendChild(subtitle);

      var list = document.createElement('div');
      list.className = 'pc-controls';
      list.id = 'pc-controls-list';
      section.appendChild(list);

      section.appendChild(buildInfoPanel());

      list.appendChild(buildEssentialRow());
      for (var i = 0; i < OPTIONAL_CONTROLS.length; i++) {
        list.appendChild(buildOptionalRow(OPTIONAL_CONTROLS[i], consent));
      }

      host.appendChild(section);
      if (typeof I18n !== 'undefined' && I18n.translateDOM) { I18n.translateDOM(host); }
    });
  }

  function isAllowed(id) {
    return getConsent().then(function (consent) { return consent ? consent[id] === true : false; });
  }

  self.PrivacyControls = { render: render, isAllowed: isAllowed };
})();
