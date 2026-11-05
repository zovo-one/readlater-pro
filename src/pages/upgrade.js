/* ReadLater Pro - Upgrade page controller.
 * One canonical checkout URL. Pro is granted only by a server-verified license,
 * and this page never reads a tier out of storage.
 */
(function () {
    'use strict';

    /* The single checkout URL allowed anywhere in this build. utm_content names
     * the surface, and this page is two surfaces: a cap-hit landing when the
     * gate sent the user here, a browsed paywall otherwise. */
    var CHECKOUT_BASE = 'https://zovo.one/pricing?utm_source=readlater_pro&utm_medium=extension&utm_campaign=upgrade';
    var SURFACE_CAPHIT = 'caphit';
    var SURFACE_PAYWALL = 'paywall';

    /* Named caps so no loop can run away on external data. */
    var MAX_COMPARISON_ROWS = 40;
    var MAX_BANNER_CHARS = 240;
    var MAX_LICENSE_KEY_CHARS = 64;

    /* Tiers that count as paid. A valid but free-tier record grants nothing. */
    var PAID_TIERS = { pro: true, lifetime: true };

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

    function byId(id) { return document.getElementById(id); }

    /* ---------------------------------------------------------------- */
    /* Free vs Pro table                                                 */
    /* ---------------------------------------------------------------- */

    /* The free/pro split and the caps come from FeatureGate, which reads
     * src/features/limits-config.json and is the one runtime authority. This
     * page keeps no copy of either. FeatureRegistry supplies the display name
     * and the description only, which are copy rather than policy.
     *
     * There is deliberately no local fallback table. FeatureGate already fails
     * closed on a bad config load, and a second copy here would disagree with
     * the gate the first time anyone edits the config. That is how D2 started. */
    function buildRows() {
        if (typeof FeatureGate === 'undefined') { return []; }
        var tiers = FeatureGate.FEATURE_TIERS || {};
        var caps = FeatureGate.FREE_LIMITS || {};
        var meta = (typeof FeatureRegistry !== 'undefined' && FeatureRegistry.FEATURES) || {};
        var ids = Object.keys(tiers);
        var rows = [];
        var limit = Math.min(ids.length, MAX_COMPARISON_ROWS);
        for (var i = 0; i < limit; i++) {
            var id = ids[i];
            if (typeof FeatureGate.isNotSold === 'function' && FeatureGate.isNotSold(id)) { continue; }
            var info = meta[id] || {};
            if (info.implemented === false) { continue; }
            var cap = typeof caps[id] === 'number' ? caps[id] : null;
            rows.push({
                id: id,
                name: info.name || FeatureGate.formatFeatureName(id),
                description: info.description || '',
                freeAccess: tiers[id] === 'free' ? true : (cap > 0 ? 'limited' : false),
                freeCap: cap
            });
        }
        return rows;
    }

    function icon(isLine) {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width', '13');
        svg.setAttribute('height', '13');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '3');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        var shape = document.createElementNS(ns, isLine ? 'line' : 'polyline');
        if (isLine) {
            shape.setAttribute('x1', '6');
            shape.setAttribute('y1', '12');
            shape.setAttribute('x2', '18');
            shape.setAttribute('y2', '12');
        } else {
            shape.setAttribute('points', '20 6 9 17 4 12');
        }
        svg.appendChild(shape);
        return svg;
    }

    function limitedText(cap) {
        if (typeof cap === 'number' && cap > 0) {
            return label('diagLimitedPerDay', cap + ' a day', [String(cap)]);
        }
        return label('diagLimitedAccess', 'Limited');
    }

    function accessCell(access, cap) {
        var cell = document.createElement('td');
        var mark = document.createElement('span');
        if (access === 'limited') {
            mark.className = 'upgrade-limited';
            mark.textContent = limitedText(cap);
            cell.appendChild(mark);
            return cell;
        }
        var included = access === true;
        mark.className = included ? 'upgrade-check' : 'upgrade-cross';
        mark.setAttribute('role', 'img');
        mark.setAttribute('aria-label', included
            ? label('diagIncluded', 'Included')
            : label('diagNotIncluded', 'Not included'));
        mark.appendChild(icon(!included));
        cell.appendChild(mark);
        return cell;
    }

    function buildRow(row) {
        var tr = document.createElement('tr');
        var nameCell = document.createElement('td');
        var name = document.createElement('span');
        name.className = 'upgrade-table-feature-name';
        name.textContent = String(row.name || '');
        nameCell.appendChild(name);
        if (row.description) {
            var desc = document.createElement('span');
            desc.className = 'upgrade-table-feature-desc';
            desc.textContent = String(row.description);
            nameCell.appendChild(desc);
        }
        tr.appendChild(nameCell);
        tr.appendChild(accessCell(row.freeAccess, row.freeCap));
        tr.appendChild(accessCell(true));
        return tr;
    }

    /* With no gate there is no authority for the split, so the section is
     * removed rather than filled with a guess. An absent table is honest, a
     * stale one is not. */
    function renderComparison() {
        var body = byId('comparison-body');
        var section = byId('comparison-section');
        if (!body) { return; }
        var rows = buildRows();
        if (!rows.length) {
            if (section) { section.hidden = true; }
            console.warn('[Upgrade] FeatureGate unavailable, comparison table not rendered');
            return;
        }
        if (section) { section.hidden = false; }
        while (body.firstChild) { body.removeChild(body.firstChild); }
        var frag = document.createDocumentFragment();
        for (var i = 0; i < rows.length; i++) { frag.appendChild(buildRow(rows[i])); }
        body.appendChild(frag);
        renderSearchCap(rows);
    }

    /* The one sold feature's real free cap, read from the gate rather than typed. */
    function renderSearchCap(rows) {
        var node = byId('outcome-search-body');
        if (!node) { return; }
        var cap = null;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].id === 'full_text_search' && typeof rows[i].freeCap === 'number') {
                cap = rows[i].freeCap;
                break;
            }
        }
        if (cap === null) { return; }
        var text = t('upgradeOutcomeSearchBody', [String(cap)]);
        if (text) { node.textContent = text; }
    }

    /* ---------------------------------------------------------------- */
    /* Limit banner                                                      */
    /* ---------------------------------------------------------------- */

    /* Last resort only. FeatureGate.formatFeatureName already prefers the
     * registry name, so this runs only when the gate itself is missing. */
    function titleCase(raw) {
        return String(raw || '').split('_').map(function (word) {
            return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
        }).join(' ');
    }

    function featureName(id) {
        if (typeof FeatureGate !== 'undefined' && typeof FeatureGate.formatFeatureName === 'function') {
            return FeatureGate.formatFeatureName(id) || titleCase(id);
        }
        return titleCase(id);
    }

    function renderLimitBanner() {
        var params = new URLSearchParams(window.location.search);
        var feature = params.get('feature');
        var reason = params.get('reason');
        if (!feature && !reason) { return; }
        var banner = byId('limit-banner');
        var text = byId('limit-banner-text');
        if (!banner || !text) { return; }
        var name = featureName(feature);
        var message = reason || label(
            'upgradeLimitReached',
            'You have reached the free limit for ' + name + '. Pro removes the cap.',
            [name]
        );
        text.textContent = String(message).slice(0, MAX_BANNER_CHARS);
        banner.style.display = '';
    }

    /* ---------------------------------------------------------------- */
    /* Messages                                                          */
    /* ---------------------------------------------------------------- */

    function showMessage(text, kind) {
        var section = byId('license-section');
        if (section) { section.hidden = false; }
        var box = byId('license-message');
        if (!box) { return; }
        box.textContent = text;
        box.className = 'upgrade-license-message ' + (kind || 'error');
        box.hidden = false;
        if (typeof Announcer !== 'undefined') {
            if (kind === 'error' && typeof Announcer.error === 'function') { Announcer.error(text); }
            else if (typeof Announcer.status === 'function') { Announcer.status(text); }
        }
    }

    function clearMessage() {
        var box = byId('license-message');
        if (!box) { return; }
        box.textContent = '';
        box.className = 'upgrade-license-message';
        box.hidden = true;
    }

    /* ---------------------------------------------------------------- */
    /* Checkout                                                          */
    /* ---------------------------------------------------------------- */

    /* A cap hit and a browse convert at very different rates, so they must not
     * land in the same UTM bucket. */
    function checkoutUrl() {
        var params = new URLSearchParams(window.location.search);
        var fromCap = !!(params.get('feature') || params.get('reason'));
        return CHECKOUT_BASE + '&utm_content=' + (fromCap ? SURFACE_CAPHIT : SURFACE_PAYWALL);
    }

    function openCheckout() {
        var url = checkoutUrl();
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url: url }, function () {
                var err = chrome.runtime && chrome.runtime.lastError;
                if (err) { window.open(url, '_blank', 'noopener'); }
            });
            return;
        }
        window.open(url, '_blank', 'noopener');
    }

    /* ---------------------------------------------------------------- */
    /* License                                                           */
    /* ---------------------------------------------------------------- */

    function isPaid(data) {
        if (!data || data.valid !== true) { return false; }
        return PAID_TIERS[data.tier] === true;
    }

    /* Every activation result carries a tier, so the tier alone cannot tell an
     * outage from a bad key. LicenseManager marks an unreachable, timed out or
     * 5xx/429 server with code ERR_NETWORK: a connection problem, not a bad key. */
    function reachedServer(data) {
        if (!data || data.code === 'ERR_NETWORK') { return false; }
        return typeof data.tier === 'string' || data.origin === 'server';
    }

    function setBusy(button, busy, busyKey, busyText, idleKey, idleText) {
        if (!button) { return; }
        button.disabled = busy;
        button.textContent = busy ? label(busyKey, busyText) : label(idleKey, idleText);
    }

    function restorePurchase() {
        var button = byId('btn-restore');
        setBusy(button, true, 'buttonChecking', 'Checking', 'buttonRestorePurchase', 'Restore Purchase');
        MessageHelper.send('CHECK_LICENSE').then(function (res) {
            setBusy(button, false, 'buttonChecking', 'Checking', 'buttonRestorePurchase', 'Restore Purchase');
            if (res && res.success && isPaid(res.data)) { showSuccess(); return; }
            if (res && res.success && reachedServer(res.data)) {
                showMessage(label('errorNoProSubscription', 'No paid license is attached to this browser yet.'), 'error');
                return;
            }
            showMessage(label('errorLicenseServerUnreachable',
                'Could not reach the license server, so Pro was not turned on. Check your connection and try again.'), 'error');
        });
    }

    function submitLicense() {
        var input = byId('license-input');
        if (!input) { return; }
        var key = input.value.trim().slice(0, MAX_LICENSE_KEY_CHARS);
        if (!key) {
            showMessage(label('errorPleaseEnterLicenseKey', 'Enter a license key first.'), 'error');
            input.focus();
            return;
        }
        activateLicense(key);
    }

    function activateLicense(key) {
        var button = byId('btn-license-submit');
        var input = byId('license-input');
        clearMessage();
        setBusy(button, true, 'buttonActivating', 'Activating', 'buttonActivate', 'Activate');
        if (input) { input.disabled = true; }
        MessageHelper.send('ACTIVATE_LICENSE', { licenseKey: key }).then(function (res) {
            setBusy(button, false, 'buttonActivating', 'Activating', 'buttonActivate', 'Activate');
            if (input) { input.disabled = false; }
            finishActivation(res);
        });
    }

    function finishActivation(res) {
        if (res && res.success && isPaid(res.data)) { showSuccess(); return; }
        if (!res || !res.success || !reachedServer(res.data)) {
            showMessage(label('errorLicenseServerUnreachable',
                'Could not reach the license server, so Pro was not turned on. Check your connection and try again.'), 'error');
            return;
        }
        showMessage(label('errorInvalidLicenseKey', 'That key was not accepted. Check it and try again.'), 'error');
    }

    /* ---------------------------------------------------------------- */
    /* Success dialog                                                    */
    /* ---------------------------------------------------------------- */

    function successIcon() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width', '28');
        svg.setAttribute('height', '28');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        var line = document.createElementNS(ns, 'polyline');
        line.setAttribute('points', '20 6 9 17 4 12');
        svg.appendChild(line);
        return svg;
    }

    function buildSuccessModal() {
        var modal = document.createElement('div');
        modal.className = 'upgrade-success-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'success-title');
        var icon = document.createElement('div');
        icon.className = 'upgrade-success-icon';
        icon.appendChild(successIcon());
        modal.appendChild(icon);
        var title = document.createElement('h2');
        title.className = 'upgrade-success-title';
        title.id = 'success-title';
        title.textContent = label('upgradeSuccessTitleClean', 'You are on Pro');
        modal.appendChild(title);
        var text = document.createElement('p');
        text.className = 'upgrade-success-text';
        text.textContent = label('upgradeSuccessTextClean', 'Full-text search is unlimited on this browser from now on.');
        modal.appendChild(text);
        var close = document.createElement('button');
        close.className = 'upgrade-success-btn';
        close.id = 'btn-success-close';
        close.type = 'button';
        close.textContent = label('buttonGetStarted', 'Get Started');
        modal.appendChild(close);
        return modal;
    }

    function showSuccess() {
        var overlay = document.createElement('div');
        overlay.className = 'upgrade-success-overlay';
        var modal = buildSuccessModal();
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.classList.add('visible');
        if (typeof Announcer !== 'undefined' && typeof Announcer.status === 'function') {
            Announcer.status(label('upgradeSuccessAnnouncementClean', 'License activated. Full-text search is now unlimited.'));
        }
        var trap = null;
        var dismiss = function () {
            if (trap && typeof trap.deactivate === 'function') { trap.deactivate(); }
            overlay.classList.remove('visible');
            if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
            goBack();
        };
        var close = modal.querySelector('#btn-success-close');
        if (close) { close.addEventListener('click', dismiss); }
        if (typeof FocusManager !== 'undefined' && typeof FocusManager.trapFocus === 'function') {
            trap = FocusManager.trapFocus(modal);
            if (typeof FocusManager.onEscape === 'function') { FocusManager.onEscape(modal, dismiss); }
        } else if (close) {
            close.focus();
        }
    }

    /* ---------------------------------------------------------------- */
    /* Wiring                                                            */
    /* ---------------------------------------------------------------- */

    function goBack() {
        if (window.history.length > 1) { window.history.back(); return; }
        window.close();
    }

    function toggleLicenseSection() {
        var section = byId('license-section');
        var toggle = byId('btn-license-key');
        if (!section) { return; }
        var opening = section.hidden;
        section.hidden = !opening;
        if (toggle) { toggle.setAttribute('aria-expanded', opening ? 'true' : 'false'); }
        if (opening) {
            var input = byId('license-input');
            if (input) { input.focus(); }
        }
    }

    function on(id, event, handler) {
        var el = byId(id);
        if (el) { el.addEventListener(event, handler); }
    }

    function wire() {
        on('btn-see-plans', 'click', openCheckout);
        on('btn-restore', 'click', restorePurchase);
        on('btn-license-key', 'click', toggleLicenseSection);
        on('btn-license-submit', 'click', submitLicense);
        on('btn-back', 'click', goBack);
        on('license-input', 'keydown', function (event) {
            if (event.key === 'Enter') { event.preventDefault(); submitLicense(); }
        });
    }

    /* Everything that names a feature or a cap waits for the gate, so the page
     * can never paint a split the gate does not agree with. */
    function render() {
        renderLimitBanner();
        renderComparison();
    }

    function init() {
        if (typeof I18n !== 'undefined' && typeof I18n.translateDOM === 'function') { I18n.translateDOM(); }
        wire();
        if (typeof FeatureGate === 'undefined' || typeof FeatureGate.init !== 'function') {
            render();
            return;
        }
        FeatureGate.init().then(render, render);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
