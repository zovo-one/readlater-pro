/* ReadLater Pro - Reading statistics dashboard. */
(function () {
    'use strict';

    var UPGRADE_PAGE = 'src/pages/upgrade.html';

    var MAX_CHART_DAYS = 7;
    var MAX_DOMAIN_ROWS = 5;
    var RESET_LABEL_MS = 2000;

    var el = {};

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

    function isoDay(date) {
        var month = String(date.getMonth() + 1);
        var day = String(date.getDate());
        if (month.length < 2) { month = '0' + month; }
        if (day.length < 2) { day = '0' + day; }
        return date.getFullYear() + '-' + month + '-' + day;
    }

    function announce(kind, text) {
        if (typeof Announcer === 'undefined') { return; }
        if (kind === 'error' && typeof Announcer.error === 'function') { Announcer.error(text); return; }
        if (typeof Announcer.status === 'function') { Announcer.status(text); }
    }

    /* ---------------------------------------------------------------- */
    /* Headline numbers                                                  */
    /* ---------------------------------------------------------------- */

    function renderTotals(stats) {
        if (el.read) { el.read.textContent = String(stats.totalRead || 0); }
        var minutes = stats.totalReadingTime || 0;
        var hours = Math.floor(minutes / 60);
        if (el.time) {
            el.time.textContent = hours > 0 ? hours + 'h ' + (minutes % 60) + 'm' : (minutes % 60) + 'm';
        }
        var streak = stats.readingStreak || 0;
        if (el.streak) {
            var unit = streak === 1
                ? label('dashboardDayUnitSingular', 'day')
                : label('dashboardDayUnit', 'days');
            el.streak.textContent = streak + ' ' + unit;
        }
        if (el.unread) { el.unread.textContent = String(stats.unreadCount || 0); }
    }

    function renderTrend(stats) {
        if (el.trendWeek) { el.trendWeek.textContent = String(stats.savedThisWeek || 0); }
        if (el.trendMonth) { el.trendMonth.textContent = String(stats.savedThisMonth || 0); }
    }

    /* ---------------------------------------------------------------- */
    /* Weekly chart                                                      */
    /* ---------------------------------------------------------------- */

    function buildWeekSeries(history) {
        var series = [];
        var today = new Date();
        for (var back = MAX_CHART_DAYS - 1; back >= 0; back--) {
            var day = new Date(today);
            day.setDate(day.getDate() - back);
            var key = isoDay(day);
            series.push({
                label: day.toLocaleDateString(undefined, { weekday: 'short' }),
                count: history[key] || 0,
                isToday: back === 0
            });
        }
        return series;
    }

    function chartColumn(entry, peak) {
        var column = document.createElement('div');
        column.className = 'weekly-chart-col';
        var wrapper = document.createElement('div');
        wrapper.className = 'weekly-chart-bar-wrapper';
        var bar = document.createElement('div');
        bar.className = 'weekly-chart-bar' + (entry.count === 0 ? ' weekly-chart-bar-empty' : '');
        bar.style.height = entry.count === 0 ? '4px' : Math.round((entry.count / peak) * 100) + '%';
        var tip = document.createElement('span');
        tip.className = 'weekly-chart-bar-tooltip';
        tip.textContent = label('dashboardArticlesSaved', entry.count + ' saved', [String(entry.count)]);
        bar.appendChild(tip);
        wrapper.appendChild(bar);
        column.appendChild(wrapper);
        var day = document.createElement('span');
        day.className = 'weekly-chart-day' + (entry.isToday ? ' today' : '');
        day.textContent = entry.label;
        column.appendChild(day);
        return column;
    }

    function renderChart(history) {
        if (!el.chart) { return; }
        var series = buildWeekSeries(history || {});
        var peak = 1;
        for (var i = 0; i < series.length; i++) {
            if (series[i].count > peak) { peak = series[i].count; }
        }
        while (el.chart.firstChild) { el.chart.removeChild(el.chart.firstChild); }
        var bars = document.createElement('div');
        bars.className = 'weekly-chart-bars';
        for (var j = 0; j < series.length; j++) { bars.appendChild(chartColumn(series[j], peak)); }
        el.chart.appendChild(bars);
    }

    function loadHistory() {
        chrome.storage.local.get('dailyHistory', function (items) {
            var err = chrome.runtime.lastError;
            if (err) { console.warn('[Dashboard] dailyHistory read failed:', err.message); }
            renderChart(items && items.dailyHistory);
        });
    }

    /* ---------------------------------------------------------------- */
    /* Top domains                                                       */
    /* ---------------------------------------------------------------- */

    function domainRow(entry, peak) {
        var row = document.createElement('div');
        row.className = 'domain-row';
        var name = document.createElement('span');
        name.className = 'domain-name';
        name.textContent = String(entry.domain || '');
        name.title = String(entry.domain || '');
        row.appendChild(name);
        var track = document.createElement('div');
        track.className = 'domain-bar-wrapper';
        var fill = document.createElement('div');
        fill.className = 'domain-bar';
        fill.style.width = Math.round(((entry.count || 0) / peak) * 100) + '%';
        track.appendChild(fill);
        row.appendChild(track);
        var count = document.createElement('span');
        count.className = 'domain-count';
        count.textContent = String(entry.count || 0);
        row.appendChild(count);
        return row;
    }

    function renderDomains(stats) {
        if (!el.domains) { return; }
        var list = (stats.topDomains || []).slice(0, MAX_DOMAIN_ROWS);
        while (el.domains.firstChild) { el.domains.removeChild(el.domains.firstChild); }
        if (!list.length) {
            var empty = document.createElement('div');
            empty.className = 'top-domains-empty';
            empty.textContent = label('dashboardNoDomainsYet', 'No domains tracked yet. Save a few articles to see your top sources.');
            el.domains.appendChild(empty);
            return;
        }
        var peak = list[0].count || 1;
        var frag = document.createDocumentFragment();
        for (var i = 0; i < list.length; i++) { frag.appendChild(domainRow(list[i], peak)); }
        el.domains.appendChild(frag);
    }

    /* ---------------------------------------------------------------- */
    /* Tier and member since                                             */
    /* ---------------------------------------------------------------- */

    function loadStats() {
        return MessageHelper.send('GET_STATS').then(function (res) {
            if (!res || !res.success || !res.data) {
                announce('error', label('errorFailedToLoadStats', 'Could not load your statistics.'));
                return;
            }
            renderTotals(res.data);
            renderDomains(res.data);
            renderTrend(res.data);
            announce('status', label('dashboardStatsLoaded', 'Statistics loaded'));
        });
    }

    function loadTier() {
        return MessageHelper.send('CHECK_TRIAL_AND_LICENSE').then(function (res) {
            if (!res || !res.success || !res.data) { return; }
            var pro = res.data.effectivelyPro === true;
            if (el.tierBadge) {
                el.tierBadge.textContent = pro ? label('badgePro', 'Pro') : label('badgeFree', 'Free');
                if (pro) { el.tierBadge.classList.add('pro'); }
                else { el.tierBadge.classList.remove('pro'); }
            }
            if (el.upgradeSection) { el.upgradeSection.style.display = pro ? 'none' : 'block'; }
        });
    }

    function loadMemberSince() {
        if (!el.memberSince) { return; }
        chrome.storage.local.get('installDate', function (items) {
            var err = chrome.runtime.lastError;
            if (err) { console.warn('[Dashboard] installDate read failed:', err.message); }
            var installed = items && items.installDate;
            if (!installed) { el.memberSince.textContent = ''; return; }
            var when = new Date(installed).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
            el.memberSince.textContent = label('dashboardMemberSince', 'Member since ' + when, [when]);
        });
    }

    /* ---------------------------------------------------------------- */
    /* Actions                                                           */
    /* ---------------------------------------------------------------- */

    function flash(button, text, resetKey, resetText) {
        if (!button) { return; }
        button.textContent = text;
        setTimeout(function () { button.textContent = label(resetKey, resetText); }, RESET_LABEL_MS);
    }

    function resetStats(event) {
        event.preventDefault();
        var ok = window.confirm(label('confirmResetStats', 'Reset every reading statistic on this browser? This cannot be undone.'));
        if (!ok) { return; }
        chrome.storage.local.remove(['dailyHistory', 'usageStats'], function () {
            var err = chrome.runtime.lastError;
            if (err) { console.warn('[Dashboard] reset failed:', err.message); return; }
            loadStats();
            loadHistory();
            flash(el.btnReset, label('buttonStatsResetDone', 'Stats reset'), 'buttonResetStats', 'Reset Stats');
            announce('status', label('dashboardStatsReset', 'Statistics have been reset'));
        });
    }

    function downloadJson(payload, filename) {
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function exportStats(event) {
        event.preventDefault();
        MessageHelper.send('GET_STATS').then(function (res) {
            if (!res || !res.success) {
                announce('error', label('errorFailedToLoadStats', 'Could not load your statistics.'));
                return;
            }
            chrome.storage.local.get('dailyHistory', function (items) {
                var err = chrome.runtime.lastError;
                if (err) { console.warn('[Dashboard] export read failed:', err.message); }
                downloadJson({
                    exportedAt: new Date().toISOString(),
                    stats: res.data,
                    dailyHistory: (items && items.dailyHistory) || {}
                }, 'readlater-stats-' + isoDay(new Date()) + '.json');
                flash(el.btnExport, label('buttonExportedDone', 'Exported'), 'buttonExportStats', 'Export Stats');
                announce('status', label('dashboardStatsExported', 'Statistics exported'));
            });
        });
    }

    function openUpgrade() {
        if (!chrome.runtime || !chrome.runtime.getURL) { return; }
        /* No feature parameter. This is a browse, not a cap hit, so the
         * upgrade page must not claim a limit was reached. */
        var url = chrome.runtime.getURL(UPGRADE_PAGE);
        chrome.tabs.create({ url: url }, function () {
            var err = chrome.runtime.lastError;
            if (err) { window.location.href = url; }
        });
    }

    function wire() {
        if (el.btnReset) { el.btnReset.addEventListener('click', resetStats); }
        if (el.btnExport) { el.btnExport.addEventListener('click', exportStats); }
        if (el.btnUpgrade) { el.btnUpgrade.addEventListener('click', openUpgrade); }
        if (el.backLink) {
            el.backLink.addEventListener('click', function (event) {
                event.preventDefault();
                window.close();
            });
        }
    }

    function init() {
        if (typeof I18n !== 'undefined' && typeof I18n.translateDOM === 'function') { I18n.translateDOM(); }
        el.read = byId('stat-read');
        el.time = byId('stat-time');
        el.streak = byId('stat-streak');
        el.unread = byId('stat-unread');
        el.chart = byId('weekly-chart');
        el.domains = byId('top-domains');
        el.trendWeek = byId('trend-week');
        el.trendMonth = byId('trend-month');
        el.tierBadge = byId('tier-badge');
        el.memberSince = byId('member-since');
        el.upgradeSection = byId('upgrade-cta-section');
        el.btnUpgrade = byId('btn-upgrade');
        el.btnReset = byId('btn-reset-stats');
        el.btnExport = byId('btn-export-stats');
        el.backLink = byId('back-link');
        wire();
        loadStats();
        loadHistory();
        loadTier();
        loadMemberSince();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
