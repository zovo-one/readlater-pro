/* ReadLater Pro - Settings > Reader (1.3.0).
 *
 * Owns the reader controls on the Settings page. Each control saves only its
 * own key with SAVE_SETTINGS, as a number where the reader expects a number,
 * so changing one setting can never reset another (options.js no longer
 * writes these keys). Values the reader stored that aren't in a list (an old
 * line height of 1.7, say) are shown as they are instead of a blank select (B3).
 */
(function () {
  'use strict';

  // 1.2.x stored CSS stacks. Order matters: "Inter, system-ui, sans-serif" is sans.
  var LEGACY_FONTS = [
    [/georgia|merriweather/i, 'serif'],
    [/\binter\b/i, 'sans'],
    [/system-ui/i, 'system']
  ];
  var FONTS = ['serif', 'sans', 'readable', 'mono', 'system'];
  var THEMES = ['auto', 'light', 'sepia', 'dark'];

  var CONTROLS = {
    readerTheme: { id: 'rs-theme', type: 'string', fallback: 'auto' },
    readerFontSize: { id: 'rs-font-size', type: 'number', fallback: 18 },
    readerWidth: { id: 'rs-width', type: 'number', fallback: 680 },
    readerLineHeight: { id: 'rs-line-height', type: 'number', fallback: 1.7 },
    readerFontFamily: { id: 'rs-font-family', type: 'string', fallback: 'serif' },
    openArticlesIn: { id: 'rs-open-in', type: 'string', fallback: 'tab' }
  };

  var toastTimer = null;

  function t(key, fallback, subs) {
    var msg = '';
    try { msg = chrome.i18n.getMessage(key, subs || undefined); } catch (e) { msg = ''; }
    if (msg) return msg;
    var out = fallback;
    (subs || []).forEach(function (s, i) { out = out.split('$' + (i + 1)).join(s); });
    return out;
  }

  function toast(text, kind) {
    var el = document.getElementById('toast');
    if (!el) return;
    if (toastTimer) clearTimeout(toastTimer);
    el.className = 'toast' + (kind === 'error' ? ' toast-error' : '');
    el.textContent = text;
    void el.offsetWidth;
    el.classList.add('visible');
    toastTimer = setTimeout(function () { el.classList.remove('visible'); }, 2500);
  }

  /** Map any stored font value (including 1.2.x CSS stacks) to one of FONTS. */
  function fontKey(v) {
    var s = String(v || '').trim();
    if (FONTS.indexOf(s) !== -1) return s;
    for (var i = 0; i < LEGACY_FONTS.length; i++) {
      if (LEGACY_FONTS[i][0].test(s)) return LEGACY_FONTS[i][1];
    }
    return 'serif';
  }

  function display(key, value) {
    if (key === 'readerFontFamily') return fontKey(value);
    if (key === 'readerTheme') return THEMES.indexOf(value) !== -1 ? value : 'auto';
    if (key === 'openArticlesIn') return value === 'panel' ? 'panel' : 'tab';
    return value;
  }

  /** Select the option whose number equals value; add one if the value isn't listed. */
  function selectNumber(select, value) {
    var n = Number(value);
    if (!isFinite(n)) return;
    var opts = select.options;
    for (var i = 0; i < opts.length; i++) {
      if (Number(opts[i].value) === n) { select.selectedIndex = i; return; }
    }
    var extra = select.querySelector('option[data-extra]');
    if (extra) extra.remove();
    var opt = document.createElement('option');
    opt.value = String(n);
    opt.setAttribute('data-extra', '1');
    opt.textContent = select.id === 'rs-font-size'
      ? t('dataSettingsCurrentPx', '$1 px (current)', [String(n)])
      : t('dataSettingsCurrent', '$1 (current)', [String(n)]);
    var before = null;
    for (var j = 0; j < opts.length; j++) {
      if (Number(opts[j].value) > n) { before = opts[j]; break; }
    }
    select.insertBefore(opt, before);
    opt.selected = true;
  }

  function apply(settings) {
    Object.keys(CONTROLS).forEach(function (key) {
      var c = CONTROLS[key];
      var el = document.getElementById(c.id);
      if (!el) return;
      var v = settings && settings[key] != null && settings[key] !== '' ? settings[key] : c.fallback;
      v = display(key, v);
      if (c.type === 'number') selectNumber(el, v);
      else el.value = String(v);
    });
  }

  function save(key, el) {
    var c = CONTROLS[key];
    var value = c.type === 'number' ? Number(el.value) : el.value;
    if (c.type === 'number' && !isFinite(value)) return;
    var payload = {};
    payload[key] = value;
    MessageHelper.send('SAVE_SETTINGS', payload).then(function (res) {
      if (res && res.success) toast(t('toastSettingsSaved', 'Settings saved'));
      else toast(t('toastFailedToSaveSettings', 'Couldn\'t save settings'), 'error');
    }).catch(function () {
      toast(t('toastFailedToSaveSettings', 'Couldn\'t save settings'), 'error');
    });
  }

  function load() {
    if (typeof MessageHelper === 'undefined') return;
    MessageHelper.send('GET_SETTINGS').then(function (res) {
      if (res && res.success) apply(res.data || {});
    }).catch(function () {});
  }

  function init() {
    Object.keys(CONTROLS).forEach(function (key) {
      var el = document.getElementById(CONTROLS[key].id);
      if (el) el.addEventListener('change', function () { save(key, el); });
    });
    load();
    // Keep in step with the reader and side panel (and with "Clear all data").
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      var patch = null;
      Object.keys(CONTROLS).forEach(function (key) {
        if (changes[key]) { patch = patch || {}; patch[key] = changes[key].newValue; }
      });
      if (!patch) return;
      Object.keys(patch).forEach(function (key) {
        var c = CONTROLS[key];
        var el = document.getElementById(c.id);
        if (!el || document.activeElement === el) return;
        var v = display(key, patch[key] != null ? patch[key] : c.fallback);
        if (c.type === 'number') selectNumber(el, v);
        else el.value = String(v);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ReaderSettings = { fontKey: fontKey };
})();
