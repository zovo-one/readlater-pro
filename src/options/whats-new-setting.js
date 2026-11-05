/* Options > Notifications > "Show what's new after an update".
 * Stored in its own sync key so saving the main settings can never reset it. */
(() => {
  'use strict';
  const toggle = document.getElementById('whatsnew-toggle');
  if (!toggle) return;
  chrome.storage.sync.get('whatsNewOptOut').then(r => {
    toggle.checked = r.whatsNewOptOut !== true;
  }).catch(() => {});
  toggle.addEventListener('change', () => {
    chrome.storage.sync.set({ whatsNewOptOut: !toggle.checked }).catch(() => {});
  });
})();
