/* ============================================================
   ReadLater Pro - feedback form
   ============================================================
   This form used to POST to a feedback endpoint on the API
   subdomain and, when that failed, open a feedback page under
   the product path on the marketing site. Both were tested on
   2026-08-09 with curl. The first answered 404 to GET and to
   POST. The second answered 301 to a 404. So every message
   written here went nowhere while the page said it had been
   submitted. Both URLs are named in _reports/lane-h.md.
   The network call is gone. Nothing now claims a message was
   received. What the form does instead is assemble the report,
   keep a copy on this device, put it on the clipboard, and open
   a mail draft addressed to support@zovo.one. The address is
   printed in plain text as well, so the flow still works when
   no mail client is registered.
   ============================================================ */
(function () {
  'use strict';

  var DRAFT_KEY = 'feedbackDraft';
  var HISTORY_KEY = 'feedbackSubmissions';
  var MAX_HISTORY = 50;
  var MAX_SUBJECT = 100;
  var MAX_DESCRIPTION = 2000;
  var MAX_ERRORS_ATTACHED = 20;
  var MAX_MAILTO_BODY = 1800;
  var DRAFT_DEBOUNCE_MS = 500;
  var SUPPORT_EMAIL = 'support@zovo.one';
  var SUPPORT_PAGE = 'https://zovo.one/support';

  var typeEl = null;
  var subjectEl = null;
  var descriptionEl = null;
  var emailEl = null;
  var charCountEl = null;
  var submitEl = null;
  var successEl = null;
  var formEl = null;
  var draftIndicatorEl = null;
  var diagnosticsEl = null;
  var diagToggleEl = null;
  var diagPreviewEl = null;
  var diagPreviewPreEl = null;
  var includeDiagEl = null;
  var draftTimer = null;
  var diagnostics = null;

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

  function warn(where, err) {
    var text = (err && err.message) ? err.message : String(err);
    if (typeof console !== 'undefined') { console.warn('[feedback] ' + where + ': ' + text); }
  }

  function init() {
    typeEl = document.getElementById('feedback-type');
    subjectEl = document.getElementById('feedback-subject');
    descriptionEl = document.getElementById('feedback-description');
    emailEl = document.getElementById('feedback-email');
    charCountEl = document.getElementById('feedback-char-count');
    submitEl = document.getElementById('feedback-submit');
    successEl = document.getElementById('feedback-success');
    formEl = document.getElementById('feedback-form');
    draftIndicatorEl = document.getElementById('feedback-draft-indicator');
    diagnosticsEl = document.getElementById('feedback-diagnostics');
    diagToggleEl = document.getElementById('feedback-diag-toggle');
    diagPreviewEl = document.getElementById('feedback-diag-preview');
    diagPreviewPreEl = document.getElementById('feedback-diag-preview-pre');
    includeDiagEl = document.getElementById('feedback-include-diag');
    if (!formEl) { return; }
    restoreDraft();
    wire();
    updateCharCount();
    updateDiagnosticsVisibility();
  }

  /* ================ draft ================ */

  function restoreDraft() {
    chrome.storage.local.get(DRAFT_KEY, function (res) {
      if (chrome.runtime.lastError) { warn('storage.get', chrome.runtime.lastError); return; }
      var draft = res ? res[DRAFT_KEY] : null;
      if (!draft) { return; }
      if (draft.type && typeEl) { typeEl.value = draft.type; }
      if (draft.subject && subjectEl) { subjectEl.value = draft.subject; }
      if (draft.description && descriptionEl) { descriptionEl.value = draft.description; }
      if (draft.email && emailEl) { emailEl.value = draft.email; }
      updateCharCount();
      updateDiagnosticsVisibility();
      flashDraftIndicator(t('feedbackDraftRestored', 'Draft restored'), 2000);
    });
  }

  function flashDraftIndicator(text, ms) {
    if (!draftIndicatorEl) { return; }
    draftIndicatorEl.textContent = text;
    setTimeout(function () { if (draftIndicatorEl) { draftIndicatorEl.textContent = ''; } }, ms);
  }

  function saveDraft() {
    if (draftTimer) { clearTimeout(draftTimer); }
    draftTimer = setTimeout(function () {
      var draft = {
        type: typeEl ? typeEl.value : '',
        subject: subjectEl ? subjectEl.value : '',
        description: descriptionEl ? descriptionEl.value : '',
        email: emailEl ? emailEl.value : ''
      };
      chrome.storage.local.set({ feedbackDraft: draft }, function () {
        if (chrome.runtime.lastError) { warn('storage.set', chrome.runtime.lastError); return; }
        flashDraftIndicator(t('feedbackDraftSaved', 'Draft saved'), 1500);
      });
    }, DRAFT_DEBOUNCE_MS);
  }

  function clearDraft() {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    chrome.storage.local.remove(DRAFT_KEY, function () {
      if (chrome.runtime.lastError) { warn('storage.remove', chrome.runtime.lastError); }
    });
  }

  /* ================ validation ================ */

  function setFieldError(field, message) {
    var wrap = field ? field.closest('.feedback-field') : null;
    var slot = wrap ? wrap.querySelector('.feedback-error') : null;
    if (message) {
      if (wrap) { wrap.classList.add('has-error'); }
      if (field) { field.setAttribute('aria-invalid', 'true'); }
      if (slot) { slot.textContent = message; slot.classList.add('visible'); }
      return;
    }
    if (wrap) { wrap.classList.remove('has-error'); }
    if (field) { field.removeAttribute('aria-invalid'); }
    if (slot) { slot.classList.remove('visible'); }
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validate() {
    var ok = true;

    if (!subjectEl || !subjectEl.value.trim()) {
      setFieldError(subjectEl, t('feedbackErrSubjectRequired', 'A subject is required'));
      ok = false;
    } else if (subjectEl.value.length > MAX_SUBJECT) {
      setFieldError(subjectEl, tf('feedbackErrSubjectLong', [String(MAX_SUBJECT)],
        'The subject has to fit in ' + MAX_SUBJECT + ' characters'));
      ok = false;
    } else { setFieldError(subjectEl, null); }

    if (!descriptionEl || !descriptionEl.value.trim()) {
      setFieldError(descriptionEl, t('feedbackErrDescRequired', 'A description is required'));
      ok = false;
    } else if (descriptionEl.value.length > MAX_DESCRIPTION) {
      setFieldError(descriptionEl, tf('feedbackErrDescLong', [String(MAX_DESCRIPTION)],
        'The description has to fit in ' + MAX_DESCRIPTION + ' characters'));
      ok = false;
    } else { setFieldError(descriptionEl, null); }

    if (emailEl && emailEl.value.trim() && !isEmail(emailEl.value.trim())) {
      setFieldError(emailEl, t('feedbackErrEmail', 'That does not look like an email address'));
      ok = false;
    } else { setFieldError(emailEl, null); }

    return ok;
  }

  function updateCharCount() {
    if (!descriptionEl || !charCountEl) { return; }
    var used = descriptionEl.value.length;
    charCountEl.textContent = used + ' / ' + MAX_DESCRIPTION;
    if (used > MAX_DESCRIPTION) { charCountEl.classList.add('over-limit'); } else { charCountEl.classList.remove('over-limit'); }
  }

  /* ================ diagnostics ================ */

  function updateDiagnosticsVisibility() {
    if (!typeEl || !diagnosticsEl) { return; }
    if (typeEl.value === 'bug') { diagnosticsEl.classList.add('visible'); collectDiagnostics(); return; }
    diagnosticsEl.classList.remove('visible');
    diagnostics = null;
  }

  function readErrorLogs() {
    return new Promise(function (resolve) {
      if (typeof MessageHelper === 'undefined') { resolve([]); return; }
      MessageHelper.send('GET_ERROR_LOGS')
        .then(function (res) { resolve(res && res.success ? (res.data || []).slice(-MAX_ERRORS_ATTACHED) : []); })
        .catch(function () { resolve([]); });
    });
  }

  function readStorageBytes() {
    return new Promise(function (resolve) {
      chrome.storage.local.getBytesInUse(null, function (bytes) {
        if (chrome.runtime.lastError) { warn('getBytesInUse', chrome.runtime.lastError); resolve(0); return; }
        resolve(bytes || 0);
      });
    });
  }

  function readPermissions() {
    return new Promise(function (resolve) {
      try {
        chrome.permissions.getAll(function (perms) {
          if (chrome.runtime.lastError) { warn('permissions.getAll', chrome.runtime.lastError); resolve({}); return; }
          resolve(perms || {});
        });
      } catch (e) { warn('permissions.getAll', e); resolve({}); }
    });
  }

  function collectDiagnostics() {
    diagnostics = null;
    var manifest = chrome.runtime.getManifest();
    var system = {
      extensionVersion: manifest.version,
      extensionName: manifest.name,
      browserVersion: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      timestamp: Date.now()
    };
    Promise.all([readErrorLogs(), readStorageBytes(), readPermissions()]).then(function (parts) {
      diagnostics = {
        system: system,
        errors: parts[0],
        storageUsed: parts[1],
        permissions: parts[2],
        generatedAt: new Date().toISOString()
      };
      if (diagPreviewPreEl) { diagPreviewPreEl.textContent = JSON.stringify(diagnostics, null, 2); }
    });
  }

  function toggleDiagnosticsPreview() {
    if (!diagToggleEl || !diagPreviewEl) { return; }
    var open = diagToggleEl.classList.toggle('expanded');
    if (open) { diagPreviewEl.classList.add('visible'); } else { diagPreviewEl.classList.remove('visible'); }
    diagToggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function flashButton(button, text) {
    if (!button) { return; }
    var original = button.textContent;
    button.textContent = text;
    setTimeout(function () { button.textContent = original; }, 1500);
  }

  function copyDiagnostics() {
    if (!diagnostics) { return; }
    var text = JSON.stringify(diagnostics, null, 2);
    navigator.clipboard.writeText(text)
      .then(function () { flashButton(document.getElementById('feedback-diag-copy'), t('buttonCopied', 'Copied')); })
      .catch(function (e) { warn('clipboard', e); });
  }

  function downloadJson(text, filename) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function downloadDiagnostics() {
    if (!diagnostics) { return; }
    var stamp = new Date().toISOString().slice(0, 10);
    downloadJson(JSON.stringify(diagnostics, null, 2), 'readlater-pro-bug-report-' + stamp + '.json');
  }

  /* ================ report assembly ================ */

  function collectReport() {
    var manifest = chrome.runtime.getManifest();
    var report = {
      type: typeEl ? typeEl.value : 'general',
      subject: subjectEl.value.trim(),
      description: descriptionEl.value.trim(),
      email: emailEl ? emailEl.value.trim() : '',
      timestamp: Date.now(),
      extensionVersion: manifest.version,
      browserVersion: navigator.userAgent
    };
    if (report.type === 'bug' && includeDiagEl && includeDiagEl.checked && diagnostics) {
      report.diagnostics = diagnostics;
    }
    return report;
  }

  function reportToText(report) {
    var lines = [];
    lines.push('Product: ReadLater Pro ' + report.extensionVersion);
    lines.push('Type: ' + report.type);
    lines.push('Subject: ' + report.subject);
    if (report.email) { lines.push('Reply to: ' + report.email); }
    lines.push('');
    lines.push(report.description);
    if (report.diagnostics) {
      lines.push('');
      lines.push('Diagnostics');
      lines.push(JSON.stringify(report.diagnostics, null, 2));
    }
    return lines.join('\n');
  }

  function keepLocalCopy(report) {
    chrome.storage.local.get(HISTORY_KEY, function (res) {
      if (chrome.runtime.lastError) { warn('storage.get', chrome.runtime.lastError); return; }
      var history = (res && res[HISTORY_KEY]) || [];
      history.push(report);
      if (history.length > MAX_HISTORY) { history = history.slice(history.length - MAX_HISTORY); }
      var patch = {};
      patch[HISTORY_KEY] = history;
      chrome.storage.local.set(patch, function () {
        if (chrome.runtime.lastError) { warn('storage.set', chrome.runtime.lastError); }
      });
    });
  }

  function openMailDraft(report, text) {
    var subject = '[ReadLater Pro] ' + report.subject;
    var body = text.length > MAX_MAILTO_BODY ? text.slice(0, MAX_MAILTO_BODY) : text;
    var href = 'mailto:' + SUPPORT_EMAIL
      + '?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(body);
    var anchor = document.createElement('a');
    anchor.href = href;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  /* ================ submit ================ */

  function handleSubmit(event) {
    if (event) { event.preventDefault(); }
    if (!validate()) { return; }

    submitEl.disabled = true;
    var restoreLabel = submitEl.textContent;
    submitEl.textContent = t('feedbackPreparing', 'Preparing');

    var report = collectReport();
    var text = reportToText(report);

    keepLocalCopy(report);

    navigator.clipboard.writeText(text)
      .then(function () { finishSubmit(report, text, true); })
      .catch(function (e) { warn('clipboard', e); finishSubmit(report, text, false); })
      .then(function () {
        submitEl.disabled = false;
        submitEl.textContent = restoreLabel;
      });
  }

  function finishSubmit(report, text, copied) {
    clearDraft();
    openMailDraft(report, text);
    showHandoff(text, copied);
    if (typeof Analytics !== 'undefined' && Analytics.track) {
      Analytics.track('feedback_submitted', { type: report.type, method: 'mail' });
    }
  }

  function showHandoff(text, copied) {
    if (!successEl) { return; }
    if (formEl) { formEl.style.display = 'none'; }
    successEl.textContent = '';

    var heading = document.createElement('p');
    heading.className = 'feedback-handoff-title';
    heading.textContent = t('feedbackHandoffTitle', 'Your report is ready to send');
    successEl.appendChild(heading);

    var body = document.createElement('p');
    body.className = 'feedback-handoff-text';
    body.textContent = copied
      ? t('feedbackHandoffCopied', 'A mail draft to support@zovo.one should have opened, and the full report is on your clipboard. If no draft appeared, paste it into a message to support@zovo.one yourself.')
      : t('feedbackHandoffPlain', 'A mail draft to support@zovo.one should have opened. If no draft appeared, use the copy button below and paste the report into a message to support@zovo.one.');
    successEl.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'feedback-handoff-actions';

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'feedback-diag-btn';
    copyBtn.textContent = t('buttonCopyReport', 'Copy report');
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(text)
        .then(function () { flashButton(copyBtn, t('buttonCopied', 'Copied')); })
        .catch(function (e) { warn('clipboard', e); });
    });
    actions.appendChild(copyBtn);

    var supportLink = document.createElement('a');
    supportLink.className = 'feedback-diag-btn';
    supportLink.href = SUPPORT_PAGE;
    supportLink.target = '_blank';
    supportLink.rel = 'noopener';
    supportLink.textContent = t('buttonOpenSupport', 'Open the support page');
    actions.appendChild(supportLink);

    var again = document.createElement('button');
    again.type = 'button';
    again.className = 'feedback-diag-btn';
    again.textContent = t('buttonWriteAnother', 'Write another');
    again.addEventListener('click', resetForm);
    actions.appendChild(again);

    successEl.appendChild(actions);
    successEl.classList.add('visible');
  }

  function resetForm() {
    if (typeEl) { typeEl.value = 'bug'; }
    if (subjectEl) { subjectEl.value = ''; }
    if (descriptionEl) { descriptionEl.value = ''; }
    if (emailEl) { emailEl.value = ''; }
    if (successEl) { successEl.classList.remove('visible'); successEl.textContent = ''; }
    if (formEl) { formEl.style.display = ''; }
    if (submitEl) { submitEl.disabled = false; }
    updateCharCount();
    updateDiagnosticsVisibility();
    var errors = document.querySelectorAll('.feedback-error');
    for (var i = 0; i < errors.length; i++) { errors[i].classList.remove('visible'); }
    var fields = document.querySelectorAll('.feedback-field');
    for (var j = 0; j < fields.length; j++) { fields[j].classList.remove('has-error'); }
    if (subjectEl) { subjectEl.focus(); }
  }

  /* ================ wiring ================ */

  function wire() {
    if (descriptionEl) {
      descriptionEl.addEventListener('input', function () { updateCharCount(); saveDraft(); });
    }
    if (subjectEl) { subjectEl.addEventListener('input', saveDraft); }
    if (emailEl) { emailEl.addEventListener('input', saveDraft); }
    if (typeEl) {
      typeEl.addEventListener('change', function () { updateDiagnosticsVisibility(); saveDraft(); });
    }
    if (submitEl) { submitEl.addEventListener('click', handleSubmit); }
    if (diagToggleEl) { diagToggleEl.addEventListener('click', toggleDiagnosticsPreview); }
    var copyBtn = document.getElementById('feedback-diag-copy');
    if (copyBtn) { copyBtn.addEventListener('click', copyDiagnostics); }
    var downloadBtn = document.getElementById('feedback-diag-download');
    if (downloadBtn) { downloadBtn.addEventListener('click', downloadDiagnostics); }
  }

  window.FeedbackForm = { init: init };

  if (document.readyState !== 'loading') { init(); } else { document.addEventListener('DOMContentLoaded', init); }
})();
