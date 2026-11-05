(() => {
  (function () {
    "use strict";
    var C = "http://www.w3.org/2000/svg";
    function u(t, e, n, i) {
      var r = document.createElementNS(C, "svg");
      if (
        (r.setAttribute("width", t),
        r.setAttribute("height", e),
        r.setAttribute("viewBox", "0 0 24 24"),
        r.setAttribute("fill", "none"),
        r.setAttribute("stroke", "currentColor"),
        r.setAttribute("stroke-width", "2"),
        r.setAttribute("stroke-linecap", "round"),
        r.setAttribute("stroke-linejoin", "round"),
        i)
      )
        for (var a in i) i.hasOwnProperty(a) && r.setAttribute(a, i[a]);
      for (var s = 0; s < n.length; s++) {
        var o = n[s],
          p = document.createElementNS(C, o.tag);
        if (o.attrs)
          for (var d in o.attrs) o.attrs.hasOwnProperty(d) && p.setAttribute(d, o.attrs[d]);
        r.appendChild(p);
      }
      return r;
    }
    function T(t, e) {
      return (typeof chrome < "u" &&
        chrome.i18n &&
        chrome.i18n.getMessage &&
        chrome.i18n.getMessage(t)) ||
        e;
    }
    var m = {
        faq: function () {
          return u("20", "20", [
            { tag: "circle", attrs: { cx: "12", cy: "12", r: "10" } },
            { tag: "path", attrs: { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" } },
            { tag: "line", attrs: { x1: "12", y1: "17", x2: "12.01", y2: "17" } },
          ]);
        },
        feedback: function () {
          return u("20", "20", [
            {
              tag: "path",
              attrs: { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
            },
          ]);
        },
        changelog: function () {
          return u("20", "20", [
            { tag: "polyline", attrs: { points: "20 12 20 22 4 22 4 12" } },
            { tag: "rect", attrs: { x: "2", y: "7", width: "20", height: "5" } },
            { tag: "line", attrs: { x1: "12", y1: "22", x2: "12", y2: "7" } },
            { tag: "path", attrs: { d: "M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" } },
            { tag: "path", attrs: { d: "M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" } },
          ]);
        },
        email: function () {
          return u("20", "20", [
            {
              tag: "path",
              attrs: {
                d: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z",
              },
            },
            { tag: "polyline", attrs: { points: "22,6 12,13 2,6" } },
          ]);
        },
        website: function () {
          return u("20", "20", [
            { tag: "circle", attrs: { cx: "12", cy: "12", r: "10" } },
            { tag: "line", attrs: { x1: "2", y1: "12", x2: "22", y2: "12" } },
            {
              tag: "path",
              attrs: {
                d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
              },
            },
          ]);
        },
        rate: function () {
          return u("20", "20", [
            {
              tag: "polygon",
              attrs: {
                points:
                  "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2",
              },
            },
          ]);
        },
        helpButton: function () {
          return u(
            "16",
            "16",
            [
              { tag: "circle", attrs: { cx: "12", cy: "12", r: "10" } },
              { tag: "path", attrs: { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" } },
              { tag: "line", attrs: { x1: "12", y1: "17", x2: "12.01", y2: "17" } },
            ],
            { "aria-hidden": "true", focusable: "false" },
          );
        },
        close: function () {
          return u(
            "16",
            "16",
            [
              { tag: "line", attrs: { x1: "18", y1: "6", x2: "6", y2: "18" } },
              { tag: "line", attrs: { x1: "6", y1: "6", x2: "18", y2: "18" } },
            ],
            { "aria-hidden": "true" },
          );
        },
        arrow: function () {
          return u("12", "12", [{ tag: "polyline", attrs: { points: "9 18 15 12 9 6" } }]);
        },
      },
      v = [
        {
          key: "faq",
          labelKey: "rlSupportFaq",
          labelFallback: "Questions and answers",
          descKey: "rlSupportFaqDesc",
          descFallback: "Browse the common questions",
          action: "openFAQ",
          iconKey: "faq",
        },
        {
          key: "feedback",
          labelKey: "rlSupportFeedback",
          labelFallback: "Send feedback",
          descKey: "rlSupportFeedbackDesc",
          descFallback: "Report a bug or ask for a feature",
          action: "openFeedback",
          iconKey: "feedback",
        },
        {
          key: "changelog",
          labelKey: "rlSupportChangelog",
          labelFallback: "What changed",
          descKey: "rlSupportChangelogDesc",
          descFallback: "See what shipped in this version",
          action: "openChangelog",
          iconKey: "changelog",
        },
        { key: "divider1", divider: !0 },
        {
          key: "email",
          labelKey: "rlSupportEmail",
          labelFallback: "Email support",
          descKey: "rlSupportEmailDesc",
          descFallback: "Write to the people who build this",
          url: "mailto:support@zovo.one",
          iconKey: "email",
        },
        {
          key: "website",
          labelKey: "rlSupportWebsite",
          labelFallback: "Support pages",
          descKey: "rlSupportWebsiteDesc",
          descFallback: "Guides and troubleshooting",
          url: "https://zovo.one/support",
          iconKey: "website",
        },
        {
          key: "rate",
          labelKey: "rlSupportRate",
          labelFallback: "Rate the extension",
          descKey: "rlSupportRateDesc",
          descFallback: "Leave a review on the Chrome Web Store",
          action: "openRate",
          iconKey: "rate",
        },
      ],
      h = !1;
    function b() {
      L(), N(), I();
    }
    function L() {
      var t = document.querySelector(".sidebar-header-actions");
      if (t && !document.getElementById("btn-support")) {
        var e = document.createElement("button");
        (e.className = "btn-icon support-help-btn"),
          (e.id = "btn-support"),
          (e.type = "button"),
          (e.title = T("rlSupportTitle", "Help and support")),
          e.setAttribute("aria-label", T("rlSupportTitle", "Help and support")),
          e.appendChild(m.helpButton());
        var n = document.getElementById("btn-settings");
        n ? t.insertBefore(e, n) : t.appendChild(e);
      }
    }
    function N() {
      if (!document.getElementById("support-menu")) {
        var t = document.createElement("div");
        (t.className = "support-menu-overlay"),
          (t.id = "support-menu-overlay"),
          document.body.appendChild(t);
        var e = document.createElement("div");
        (e.className = "support-menu"),
          (e.id = "support-menu"),
          e.setAttribute("role", "dialog"),
          e.setAttribute("aria-modal", "true"),
          e.setAttribute("aria-label", T("rlSupportTitle", "Help and support"));
        var n = document.createElement("div");
        n.className = "support-menu-header";
        var i = document.createElement("span");
        (i.className = "support-menu-title"),
          (i.textContent = T("rlSupportTitle", "Help and support")),
          n.appendChild(i);
        var r = document.createElement("button");
        (r.className = "support-menu-close"),
          (r.id = "support-menu-close"),
          (r.type = "button"),
          r.setAttribute("aria-label", T("rlClose", "Close")),
          r.appendChild(m.close()),
          n.appendChild(r),
          e.appendChild(n);
        var a = document.createElement("ul");
        a.className = "support-menu-list";
        for (var s = 0; s < v.length; s++) {
          var o = v[s];
          if (o.divider) {
            var p = document.createElement("li");
            (p.className = "support-menu-divider"),
              p.setAttribute("aria-hidden", "true"),
              a.appendChild(p);
            continue;
          }
          var d = document.createElement("li"),
            c = document.createElement("button");
          (c.className = "support-menu-item"),
            (c.type = "button"),
            c.setAttribute("data-support-key", o.key),
            (c.title = T(o.descKey, o.descFallback));
          var g = document.createElement("span");
          (g.className = "support-menu-item-icon"),
            o.iconKey && m[o.iconKey] && g.appendChild(m[o.iconKey]()),
            g.setAttribute("aria-hidden", "true"),
            c.appendChild(g);
          var y = document.createElement("span");
          (y.className = "support-menu-item-label"),
            (y.textContent = T(o.labelKey, o.labelFallback)),
            c.appendChild(y);
          var f = document.createElement("span");
          (f.className = "support-menu-item-arrow"),
            f.setAttribute("aria-hidden", "true"),
            f.appendChild(m.arrow()),
            c.appendChild(f),
            d.appendChild(c),
            a.appendChild(d);
        }
        e.appendChild(a);
        var E = document.createElement("div");
        E.className = "support-menu-footer";
        var k = document.createElement("span");
        (k.className = "support-menu-version"),
          (k.textContent =
            T("appName", "ReadLater Pro") + " " + chrome.runtime.getManifest().version),
          E.appendChild(k),
          e.appendChild(E),
          document.body.appendChild(e);
      }
    }
    function w() {
      var t = document.getElementById("support-menu"),
        e = document.getElementById("support-menu-overlay");
      !t ||
        !e ||
        (t.classList.add("visible"),
        e.classList.add("visible"),
        (h = !0),
        B("menu_opened"),
        setTimeout(function () {
          var n = t.querySelector(".support-menu-item");
          n && n.focus();
        }, 30));
    }
    function l() {
      var t = document.getElementById("support-menu"),
        e = document.getElementById("support-menu-overlay");
      !t || !e || (t.classList.remove("visible"), e.classList.remove("visible"), (h = !1));
    }
    function A() {
      h ? l() : w();
    }
    function x(t) {
      for (var e = null, n = 0; n < v.length; n++)
        if (v[n].key === t) {
          e = v[n];
          break;
        }
      if (e) {
        if ((B(t), e.url))
          e.url.startsWith("mailto:")
            ? window.open(e.url, "_blank")
            : chrome.tabs.create({ url: e.url });
        else if (e.action)
          switch (e.action) {
            case "openFAQ":
              chrome.tabs.create({
                url: chrome.runtime.getURL("src/options/options.html?tab=faq"),
              });
              break;
            case "openFeedback":
              chrome.tabs.create({
                url: chrome.runtime.getURL("src/options/options.html?tab=feedback"),
              });
              break;
            case "openChangelog":
              chrome.tabs.create({
                url: chrome.runtime.getURL("src/options/options.html?tab=changelog"),
              });
              break;
            case "openRate":
              chrome.tabs.create({
                url: "https://chrome.google.com/webstore/detail/" + chrome.runtime.id,
              });
              break;
          }
        l();
      }
    }
    function B(t) {
      chrome.storage.local.get("supportLinkClicks", function (e) {
        if (!(chrome.runtime && chrome.runtime.lastError)) {
          var n = e.supportLinkClicks || {};
          (n[t] = (n[t] || 0) + 1), chrome.storage.local.set({ supportLinkClicks: n });
        }
      }),
        typeof Analytics < "u" && Analytics.track("support_link_click", { link: t });
    }
    function I() {
      var t = document.getElementById("btn-support");
      t && t.addEventListener("click", A);
      var e = document.getElementById("support-menu-close");
      e && e.addEventListener("click", l);
      var n = document.getElementById("support-menu-overlay");
      n && n.addEventListener("click", l);
      var i = document.getElementById("support-menu");
      i &&
        i.addEventListener("click", function (r) {
          var a = r.target.closest(".support-menu-item");
          if (a) {
            var s = a.getAttribute("data-support-key");
            s && x(s);
          }
        }),
        document.addEventListener("keydown", function (r) {
          if (r.key === "Escape" && h) {
            l();
            var a = document.getElementById("btn-support");
            a && a.focus();
          }
        });
    }
    (window.SupportMenu = { init: b, open: w, close: l, toggle: A }),
      document.readyState !== "loading" ? b() : document.addEventListener("DOMContentLoaded", b);
  })();
})();
