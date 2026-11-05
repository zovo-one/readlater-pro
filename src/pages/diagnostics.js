/* ReadLater Pro - Diagnostics.
 * Reads only this extension's own error and event logs from local storage.
 * Nothing here changes settings, licensing or policy.
 */
(function () {
    'use strict';

    var MAX_ROWS = 300;
    var MAX_MESSAGE_CHARS = 200;
    var MAX_STACK_CHARS = 100;
    var MAX_TAG_CHARS = 30;
    var MAX_PROPS_CHARS = 150;
    var STORAGE_QUOTA_BYTES = 10485760;
    var RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
    var TOAST_MS = 3000;

    var errorLogs = [];
    var eventLogs = [];

    function byId(id) { return document.getElementById(id); }

    function t(key, subs) {
        if (typeof I18n !== 'undefined' && typeof I18n.get === 'function') {
            var value = I18n.get(key, subs);
            if (value && value !== key) { return value; }
        }
        return null;
    }

    function label(key, fallback, subs) {
        var value = t(key, subs);
        return value === null ? fallback : value;
    }

    function setText(id, text) {
        var node = byId(id);
        if (node) { node.textContent = text; }
    }

    function formatTime(value) {
        if (!value) { return '--'; }
        var date = new Date(value);
        if (isNaN(date.getTime())) { return '--'; }
        return date.toLocaleString();
    }

    function formatBytes(bytes) {
        if (typeof bytes !== 'number' || bytes <= 0) { return '0 B'; }
        var units = ['B', 'KB', 'MB', 'GB'];
        var index = 0;
        var value = bytes;
        while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
        return (index === 0 ? value : value.toFixed(1)) + ' ' + units[index];
    }

    function truncate(text, max) {
        if (typeof text !== 'string') { return ''; }
        return text.length <= max ? text : text.substring(0, max) + '...';
    }

    function toast(message, kind) {
        var node = byId('toast');
        if (node) {
            node.textContent = message;
            node.className = 'toast' + (kind ? ' toast-' + kind : '');
            node.classList.add('visible');
            setTimeout(function () { node.classList.remove('visible'); }, TOAST_MS);
        }
        var region = byId('sr-announcements');
        if (region) { region.textContent = message; }
    }

    function readLocal(keys) {
        return new Promise(function (resolve) {
            chrome.storage.local.get(keys, function (items) {
                var err = chrome.runtime.lastError;
                if (err) { console.warn('[Diagnostics] storage read failed:', err.message); }
                resolve(items || {});
            });
        });
    }

    function writeLocal(payload) {
        return new Promise(function (resolve) {
            chrome.storage.local.set(payload, function () {
                var err = chrome.runtime.lastError;
                if (err) { console.warn('[Diagnostics] storage write failed:', err.message); }
                resolve();
            });
        });
    }

    /* ---------------------------------------------------------------- */
    /* Extension info                                                    */
    /* ---------------------------------------------------------------- */

    function renderExtensionInfo() {
        try {
            var manifest = chrome.runtime.getManifest();
            setText('ext-name', manifest.name || '--');
            setText('ext-version', manifest.version || '--');
            setText('ext-id', chrome.runtime.id || '--');
        } catch (e) {
            setText('ext-name', '--');
            setText('ext-version', '--');
            setText('ext-id', '--');
        }
        var match = (navigator.userAgent || '').match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
        setText('chrome-version', match ? match[1] : label('diagUnknown', 'Unknown'));
        setText('ext-platform', navigator.platform || label('diagUnknown', 'Unknown'));
    }

    /* ---------------------------------------------------------------- */
    /* Health score                                                      */
    /* ---------------------------------------------------------------- */

    function scoreBand(score) {
        if (score >= 90) { return { text: label('diagHealthExcellent', 'Excellent'), css: 'health-excellent' }; }
        if (score >= 70) { return { text: label('diagHealthGood', 'Good'), css: 'health-good' }; }
        if (score >= 50) { return { text: label('diagHealthFair', 'Fair'), css: 'health-fair' }; }
        return { text: label('diagHealthNeedsAttention', 'Needs attention'), css: 'health-poor' };
    }

    function renderHealth(errors, events) {
        var cutoff = Date.now() - RECENT_WINDOW_MS;
        var recent = errors.filter(function (entry) {
            return new Date(entry.timestamp || 0).getTime() >= cutoff;
        });
        var kinds = {};
        recent.forEach(function (entry) { kinds[entry.type || entry.name || 'unknown'] = true; });
        var uniqueKinds = Object.keys(kinds).length;
        var ratio = events.length > 0 ? errors.length / events.length : 0;
        var recentPenalty = Math.min(recent.length * 5, 50);
        var ratioPenalty = Math.min(Math.round(ratio * 100), 30);
        var kindPenalty = Math.min(uniqueKinds * 4, 20);
        var score = Math.max(0, Math.min(100, 100 - recentPenalty - ratioPenalty - kindPenalty));
        var band = scoreBand(score);

        setText('score-value', String(score));
        setText('score-label', band.text);
        var card = byId('health-score');
        if (card) {
            card.classList.remove('health-excellent', 'health-good', 'health-fair', 'health-poor');
            card.classList.add(band.css);
            var meter = card.querySelector('[role="meter"]');
            if (meter) {
                meter.setAttribute('aria-valuenow', String(score));
                meter.setAttribute('aria-valuetext', score + ' / 100, ' + band.text);
            }
        }
        renderHealthDetails(recent.length, recentPenalty, ratio, ratioPenalty, uniqueKinds, kindPenalty);
    }

    function renderHealthDetails(recentCount, recentPenalty, ratio, ratioPenalty, kinds, kindPenalty) {
        var box = byId('health-details');
        if (!box) { return; }
        var lines = [];
        if (recentPenalty > 0) {
            lines.push(label('diagRecentErrorsLine', 'Errors in the last 24 hours: ' + recentCount, [String(recentCount), String(recentPenalty)]));
        }
        if (ratioPenalty > 0) {
            lines.push(label('diagErrorRatioLine', 'Error to event ratio: ' + (ratio * 100).toFixed(1) + '%', [(ratio * 100).toFixed(1), String(ratioPenalty)]));
        }
        if (kindPenalty > 0) {
            lines.push(label('diagUniqueErrorsLine', 'Distinct error types: ' + kinds, [String(kinds), String(kindPenalty)]));
        }
        if (!lines.length) {
            lines.push(label('diagNoIssues', 'No issues recorded in the last 24 hours.'));
        }
        box.textContent = '';
        lines.forEach(function (line) {
            var p = document.createElement('p');
            p.textContent = line;
            box.appendChild(p);
        });
    }

    /* ---------------------------------------------------------------- */
    /* Storage stats                                                     */
    /* ---------------------------------------------------------------- */

    function renderStorage(items) {
        setText('error-count', String((items.errorLogs || []).length));
        setText('event-count', String((items.analyticsEvents || []).length));
        setText('runtime-count', String((items.runtimeLogs || []).length));
        chrome.storage.local.getBytesInUse(null, function (bytes) {
            var err = chrome.runtime.lastError;
            if (err) { console.warn('[Diagnostics] byte usage read failed:', err.message); return; }
            setText('storage-size', formatBytes(bytes));
            var percent = Math.min(Math.round((bytes / STORAGE_QUOTA_BYTES) * 100), 100);
            var fill = byId('storage-fill');
            var bar = byId('storage-bar');
            if (fill) { fill.style.width = percent + '%'; }
            if (bar) { bar.setAttribute('aria-valuenow', String(percent)); }
            setText('storage-percent', percent + '%');
        });
    }

    /* ---------------------------------------------------------------- */
    /* Tables                                                            */
    /* ---------------------------------------------------------------- */

    function cell(text, className, title) {
        var td = document.createElement('td');
        td.className = className;
        td.textContent = text;
        if (title) { td.title = title; }
        return td;
    }

    function tagCell(text, tagClass) {
        var td = document.createElement('td');
        var span = document.createElement('span');
        span.className = 'tag ' + tagClass;
        span.textContent = truncate(text, MAX_TAG_CHARS);
        td.appendChild(span);
        return td;
    }

    function renderErrors(rows) {
        var body = byId('error-tbody');
        var empty = byId('no-errors');
        if (!body) { return; }
        while (body.firstChild) { body.removeChild(body.firstChild); }
        if (!rows.length) { if (empty) { empty.classList.add('visible'); } return; }
        if (empty) { empty.classList.remove('visible'); }
        var limit = Math.min(rows.length, MAX_ROWS);
        for (var i = 0; i < limit; i++) {
            var entry = rows[i];
            var tr = document.createElement('tr');
            tr.appendChild(cell(formatTime(entry.timestamp), 'time-cell'));
            tr.appendChild(tagCell(entry.context || 'unknown', 'tag-context'));
            tr.appendChild(tagCell(entry.type || entry.name || 'Error', 'tag-error'));
            tr.appendChild(cell(truncate(entry.message || '', MAX_MESSAGE_CHARS), 'message-cell', entry.message || ''));
            tr.appendChild(cell(truncate(entry.stack || '', MAX_STACK_CHARS), 'stack-cell', entry.stack || ''));
            body.appendChild(tr);
        }
    }

    function renderEvents(rows) {
        var body = byId('event-tbody');
        var empty = byId('no-events');
        if (!body) { return; }
        while (body.firstChild) { body.removeChild(body.firstChild); }
        if (!rows.length) { if (empty) { empty.classList.add('visible'); } return; }
        if (empty) { empty.classList.remove('visible'); }
        var limit = Math.min(rows.length, MAX_ROWS);
        for (var i = 0; i < limit; i++) {
            var entry = rows[i];
            var tr = document.createElement('tr');
            tr.appendChild(cell(formatTime(entry.timestamp), 'time-cell'));
            tr.appendChild(tagCell(entry.event || entry.name || 'unknown', 'tag-info'));
            tr.appendChild(tagCell(entry.context || '--', 'tag-context'));
            var props = '{}';
            try { props = JSON.stringify(entry.properties || entry.data || {}); } catch (e) { props = '{}'; }
            tr.appendChild(cell(truncate(props, MAX_PROPS_CHARS), 'props-cell', props));
            body.appendChild(tr);
        }
    }

    function sortErrors(rows, mode) {
        var copy = rows.slice();
        if (mode === 'timestamp-asc') {
            copy.sort(function (a, b) { return new Date(a.timestamp || 0) - new Date(b.timestamp || 0); });
        } else if (mode === 'context') {
            copy.sort(function (a, b) { return String(a.context || '').localeCompare(String(b.context || '')); });
        } else if (mode === 'type') {
            copy.sort(function (a, b) { return String(a.type || '').localeCompare(String(b.type || '')); });
        } else {
            copy.sort(function (a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });
        }
        return copy;
    }

    function filterErrors() {
        var search = byId('error-search');
        var sort = byId('error-sort');
        var term = search ? search.value.toLowerCase().trim() : '';
        var matched = errorLogs.filter(function (entry) {
            if (!term) { return true; }
            return String(entry.message || '').toLowerCase().indexOf(term) !== -1
                || String(entry.type || entry.name || '').toLowerCase().indexOf(term) !== -1
                || String(entry.context || '').toLowerCase().indexOf(term) !== -1;
        });
        renderErrors(sortErrors(matched, sort ? sort.value : 'timestamp-desc'));
    }

    function filterEvents() {
        var search = byId('event-search');
        var filter = byId('event-filter');
        var term = search ? search.value.toLowerCase().trim() : '';
        var kind = filter ? filter.value : 'all';
        var matched = eventLogs.filter(function (entry) {
            var name = String(entry.event || entry.name || '');
            if (kind !== 'all' && name !== kind) { return false; }
            if (!term) { return true; }
            var props = '';
            try { props = JSON.stringify(entry.properties || entry.data || {}).toLowerCase(); } catch (e) { props = ''; }
            return name.toLowerCase().indexOf(term) !== -1
                || props.indexOf(term) !== -1
                || String(entry.context || '').toLowerCase().indexOf(term) !== -1;
        });
        renderEvents(matched);
    }

    /* ---------------------------------------------------------------- */
    /* Export                                                            */
    /* ---------------------------------------------------------------- */

    function exportReport() {
        readLocal(['errorLogs', 'analyticsEvents', 'runtimeLogs']).then(function (items) {
            var payload = {
                exportedAt: new Date().toISOString(),
                extension: {},
                errors: items.errorLogs || [],
                events: items.analyticsEvents || [],
                runtimeLogs: items.runtimeLogs || []
            };
            try {
                var manifest = chrome.runtime.getManifest();
                payload.extension = { name: manifest.name, version: manifest.version, id: chrome.runtime.id, userAgent: navigator.userAgent };
            } catch (e) {
                payload.extension = {};
            }
            var text = JSON.stringify(payload, null, 2);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () {
                    toast(label('toastDebugReportCopied', 'Debug report copied to clipboard'), 'success');
                }).catch(function () { downloadReport(text); });
                return;
            }
            downloadReport(text);
        });
    }

    function downloadReport(text) {
        var blob = new Blob([text], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'readlater-debug-report-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast(label('toastDebugReportDownloaded', 'Debug report downloaded'), 'success');
    }

    /* ---------------------------------------------------------------- */
    /* Loading and wiring                                                */
    /* ---------------------------------------------------------------- */

    function loadAll() {
        return readLocal(['errorLogs', 'analyticsEvents', 'runtimeLogs']).then(function (items) {
            errorLogs = items.errorLogs || [];
            eventLogs = (items.analyticsEvents || []).slice().sort(function (a, b) {
                return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
            });
            renderHealth(errorLogs, eventLogs);
            renderStorage(items);
            filterErrors();
            filterEvents();
        });
    }

    function clearErrors() {
        writeLocal({ errorLogs: [] }).then(function () {
            errorLogs = [];
            renderErrors([]);
            setText('error-count', '0');
            renderHealth(errorLogs, eventLogs);
            toast(label('toastErrorLogCleared', 'Error log cleared'), 'success');
        });
    }

    function clearEvents() {
        writeLocal({ analyticsEvents: [] }).then(function () {
            eventLogs = [];
            renderEvents([]);
            setText('event-count', '0');
            renderHealth(errorLogs, eventLogs);
            toast(label('toastEventLogCleared', 'Event log cleared'), 'success');
        });
    }

    function on(id, event, handler) {
        var node = byId(id);
        if (node) { node.addEventListener(event, handler); }
    }

    function init() {
        if (typeof I18n !== 'undefined' && typeof I18n.translateDOM === 'function') { I18n.translateDOM(); }
        renderExtensionInfo();
        loadAll();
        on('export-btn', 'click', exportReport);
        on('clear-errors-btn', 'click', clearErrors);
        on('clear-events-btn', 'click', clearEvents);
        on('error-search', 'input', filterErrors);
        on('error-sort', 'change', filterErrors);
        on('event-search', 'input', filterEvents);
        on('event-filter', 'change', filterEvents);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
