(() => {
  (function () {
    "use strict";
    typeof ErrorHandler < "u" && ErrorHandler.initGlobalHandler("Sidebar"),
      typeof Analytics < "u" && Analytics.init("sidebar");
    var Me = performance.now(),
      n = {
        articles: [],
        tags: [],
        activeTab: "unread",
        activeTag: null,
        searchTerm: "",
        sortBy: "savedAt",
        sortOrder: "desc",
        offset: 0,
        pageSize: 50,
        loading: !1,
        hasMore: !0,
        focusedIndex: -1,
        selectionMode: !1,
        selectedIds: {},
        contextArticleId: null,
        pullRefreshActive: !1,
        isPro: !1,
        lengthFilter: null,
        rawCount: 0,
        openIn: "tab",
        summary: null,
        restoreCount: 0,
        restoreScroll: 0,
      },
      s = null,
      b = null,
      m = null,
      E = null,
      q = null,
      P = null,
      Y = null,
      g = null,
      W = null,
      C = null,
      j = null,
      Z = null,
      J = null,
      Q = null,
      ee = null,
      A = null,
      p = null,
      x = null,
      y = null,
      N = null,
      te = null,
      ne = null,
      O = null,
      Pe = null,
      ae = null,
      D = null,
      re = null,
      ie = null,
      B = null,
      M = null,
      k = null,
      I = null,
      w = null;
    /* Row geometry. Every list row is exactly ROW_HEIGHT_PX tall (enforced in
       sidebar.css by .swipe-container) so the virtual scroller can place rows
       by index without measuring. Change both together or rows will overlap. */
    var ROW_HEIGHT_PX = 104;
    var ROW_OVERSCAN = 6;
    var MAX_ARTICLES = 5e3;
    /* Storage keys that should refresh the list. Anything else written to
       chrome.storage.local (analytics counters, support-menu click counts,
       consent flags) must not reset the list under the user. */
    var RELOAD_KEYS = [
      "licenseDataPlain",
      "licenseData",
      "trialData",
      "articlesUpdatedAt",
      "totalArticlesSaved",
      "totalArticlesRead",
    ];
    var MAX_RELOAD_KEYS = 16;
    var Re_reloadTimer = null;
    var RELOAD_DEBOUNCE_MS = 400;
    function fe() {
      typeof PerfMonitor < "u" && PerfMonitor.record("sidebar.domReady", performance.now() - Me),
        (s = document.getElementById("article-list")),
        (b = document.getElementById("empty-state")),
        (m = document.getElementById("search-input")),
        (E = document.getElementById("tag-chips")),
        (q = document.getElementById("article-count")),
        (P = document.getElementById("toast")),
        (Y = document.getElementById("btn-dashboard")),
        (g = document.getElementById("btn-import")),
        (W = document.getElementById("btn-settings")),
        (C = document.getElementById("sort-select")),
        (j = document.getElementById("batch-bar")),
        (Z = document.getElementById("batch-bar-count")),
        (J = document.getElementById("batch-bar-close")),
        (Q = document.getElementById("batch-mark-read")),
        (ee = document.getElementById("batch-delete")),
        (A = document.getElementById("context-menu")),
        (p = document.getElementById("pull-to-refresh")),
        (x = document.getElementById("sidebar-footer")),
        (y = document.getElementById("tier-badge")),
        (N = document.getElementById("pro-badge")),
        (te = document.getElementById("upgrade-banner")),
        (ne = document.getElementById("upgrade-banner-link")),
        (O = document.getElementById("trial-banner")),
        (Pe = document.getElementById("trial-days-left")),
        (ae = document.getElementById("trial-upgrade-link")),
        (D = document.getElementById("manage-subscription-link")),
        (re = document.getElementById("usage-counter")),
        (ie = document.getElementById("usage-count")),
        (B = document.getElementById("search-clear")),
        (M = document.getElementById("search-count")),
        (k = document.querySelectorAll(".sidebar-tab")),
        typeof I18n < "u" && I18n.translateDOM(),
        Vt(),
        Bt(),
        rt(),
        $e(),
        qe(),
        Oe(),
        Ke(),
        Ge(),
        Ve(),
        tt(),
        nt(),
        je(),
        ze(),
        Ue(),
        Ze(),
        We(),
        pe(),
        Ie(),
        vt(),
        it(),
        panelInit(),
        R(),
        kt(),
        typeof WhatsNew < "u" && WhatsNew.check();
    }
    function v() {
      fetchList(n.offset === 0 ? "reset" : "more");
    }
    /* The eleven fields a list row draws. Nothing here touches content or
       textContent, which is the whole point: a saved record is roughly 31.6 KB
       and a 520-article library is 15.30 MB whole against 0.16 MB projected.
       This list is used twice. It goes to db-manager as `fields`, which is
       opt-in by design because options.js and data-management.js call the same
       action to build the full backup and must keep the article bodies. It is
       also applied again on arrival by Ot2(), so the panel cannot retain a body
       even if a caller forgets the parameter or a handler drops it. */
    var ROW_FIELDS = [
      "id",
      "url",
      "title",
      "excerpt",
      "domain",
      "savedAt",
      "estimatedReadTime",
      "isRead",
      "isFavorite",
      "readProgress",
      "leadImageUrl",
    ];
    function Ot2(e) {
      for (var t = [], a = 0; a < e.length; a++) {
        var r = e[a];
        if (r) {
          for (var i = {}, l = 0; l < ROW_FIELDS.length; l++) i[ROW_FIELDS[l]] = r[ROW_FIELDS[l]];
          t.push(i);
        }
      }
      return t;
    }
    var FTS_MIN_WORDS = 2;
    /* Full-text search is the one metered Pro capability in the build. Two rules
       shape this.
       The gate is consulted once per distinct query, never once per render, so
       sorting, switching tabs, deleting an article or a background refresh can
       never spend one of the twenty daily units. Only a query the user has not
       run before costs anything.
       On the free plan a single word is answered by title search, which is free
       and uncapped, so it never reaches the gate (Pro gets full text at any
       length). The wall can only appear once somebody
       has run twenty multi-word searches in a day, which is a real cap hit and
       not a greeting. */
    function Lt(e, t) {
      var a = e && e.trim();
      if (!a || (a.split(/\s+/).length < FTS_MIN_WORDS && !n.isPro) || typeof FeatureGate > "u") {
        t(!1);
        return;
      }
      if (n.ftsTerm === a) {
        t(n.ftsAllowed === !0);
        return;
      }
      if (ftsAlreadyPaid(a)) {
        (n.ftsTerm = a), (n.ftsAllowed = !0), t(!0);
        return;
      }
      (n.ftsTerm = a),
        (n.ftsAllowed = !1),
        FeatureGate.gateFeature(
          "full_text_search",
          function () {
            (n.ftsAllowed = !0), ftsMarkPaid(a), t(!0);
          },
          {
            onBlocked: function (r) {
              /* Never a dead end. Title search still runs and still fills the
                 list, so the wall sits on top of a working result set. */
              (n.ftsAllowed = !1), t(!1), Tt(r);
            },
          },
        );
    }
    /* One unit per committed search, not per debounced keystroke. A query already run in this
       panel session is free, and so is a query that only extends or trims the last one that ran
       (the user is still typing or refining it). A different query costs one unit as before. */
    var FTS_SESSION_MAX = 256,
      ftsSession = {},
      ftsSessionSize = 0,
      ftsAnchor = "";
    function ftsAlreadyPaid(a) {
      var k = a.toLowerCase();
      return ftsSession[k] === !0 ||
        (ftsAnchor !== "" && (k.indexOf(ftsAnchor) === 0 || ftsAnchor.indexOf(k) === 0))
        ? (ftsMarkPaid(a), !0)
        : !1;
    }
    function ftsMarkPaid(a) {
      var k = a.toLowerCase();
      ftsSessionSize >= FTS_SESSION_MAX && ((ftsSession = {}), (ftsSessionSize = 0));
      ftsSession[k] !== !0 && ((ftsSession[k] = !0), ftsSessionSize++);
      (ftsAnchor !== "" && ftsAnchor.indexOf(k) === 0) || (ftsAnchor = k);
    }
    var Et = !1;
    /* Once per panel session. Past the cap every further multi-word query would
       otherwise re-open the wall, which turns one honest cap notice into a nag.
       The allowance resets daily, so a new session can show it again. */
    function Tt(e) {
      Et ||
        ((Et = !0),
        typeof Paywall < "u" && Paywall.show
          ? Paywall.show(e, { featureId: e, surface: "caphit" })
          : Jt("full_text_search_cap"));
    }
    /* A gate that trips inside the service worker cannot open a modal, so it
       leaves a record behind. The first UI surface to open shows it. */
    function kt() {
      typeof Paywall < "u" &&
        Paywall.showPendingWall &&
        setTimeout(function () {
          Paywall.showPendingWall();
        }, 800);
    }
    function R() {
      MessageHelper.send("GET_TAGS")
        .then(function (e) {
          !e || !e.success || ((n.tags = e.data || []), oe());
        })
        .catch(function (e) {
          console.warn("[Sidebar] Failed to load tags:", e);
        });
    }
    /* Create the virtual scroller exactly once and keep it for the lifetime of
       the panel. VirtualScroll.create() attaches a scroll listener that its own
       destroy() does not remove, so creating one per render leaked a listener
       per page of infinite scroll. */
    function Vt() {
      if (!(!s || w || typeof VirtualScroll > "u"))
        w = VirtualScroll.create({
          container: s,
          itemHeight: ROW_HEIGHT_PX,
          overscan: ROW_OVERSCAN,
          renderItem: function (e) {
            return ve(e);
          },
        });
    }
    function Ht() {
      if (s)
        for (var e = s.querySelectorAll(".skeleton-card"), t = 0; t < e.length; t++)
          e[t].parentNode && e[t].parentNode.removeChild(e[t]);
    }
    /* Paint the list. Rows go through the virtual scroller when it is available
       so a 500-article list only ever holds one viewport of nodes. */
    function Xt(e) {
      if (w) {
        w.setItems(e);
        return;
      }
      for (var t = document.createDocumentFragment(), a = 0; a < e.length; a++) {
        var r = ve(e[a]);
        a < 8 && (r.classList.add("card-enter"), (r.style.animationDelay = a * 0.04 + "s")),
          t.appendChild(r);
      }
      for (; s.firstChild; ) s.removeChild(s.firstChild);
      s.appendChild(t);
    }
    function pe() {
      if (!(!s || !b)) {
        (s.style.display = "block"), (b.style.display = "none"), Xt([]), Ht();
        for (var e = 0; e < 3; e++) {
          var t = document.createElement("div");
          t.className = "skeleton-card";
          var a = document.createElement("div");
          (a.className = "skeleton-bone skeleton-thumb"), t.appendChild(a);
          var r = document.createElement("div");
          r.className = "skeleton-body";
          var i = document.createElement("div");
          (i.className = "skeleton-bone skeleton-title"), r.appendChild(i);
          var l = document.createElement("div");
          (l.className = "skeleton-bone skeleton-title-short"), r.appendChild(l);
          var o = document.createElement("div");
          (o.className = "skeleton-bone skeleton-excerpt"), r.appendChild(o);
          var u = document.createElement("div");
          (u.className = "skeleton-bone skeleton-meta"),
            r.appendChild(u),
            t.appendChild(r),
            s.appendChild(t);
        }
      }
    }
    function le(keepY) {
      var e = performance.now();
      if (n.activeTab === "highlights") return;
      var kf = captureFocus();
      if (!(!s || !b)) {
        if (((n.focusedIndex = -1), Ht(), n.articles.length === 0)) {
          Xt([]),
            (s.style.display = "none"),
            (b.style.display = "flex"),
            at(),
            se(0),
            q && (q.textContent = ""),
            typeof Announcer < "u" && Announcer.countUpdate("articles", 0);
          return;
        }
        (s.style.display = "block"), (b.style.display = "none"), se(n.articles.length);
        var t =
          n.articles.length > MAX_ARTICLES ? n.articles.slice(0, MAX_ARTICLES) : n.articles;
        Xt(t),
          typeof keepY == "number" && restoreScroll(keepY),
          restoreFocus(kf),
          renderFooter(),
          lastAnnouncedCount !== n.articles.length &&
          (lastAnnouncedCount = n.articles.length) >= 0 &&
          typeof Announcer < "u" && Announcer.countUpdate("articles", n.articles.length),
          typeof PerfMonitor < "u" && PerfMonitor.record("sidebar.render", performance.now() - e);
      }
    }
    function ve(e) {
      var t = document.createElement("div");
      t.className = "swipe-container";
      var a = document.createElement("div");
      a.className = "swipe-action-bg";
      var r = document.createElement("span");
      (r.className = "swipe-label"),
        r.appendChild(De("polyline", { points: "3 6 5 6 21 6" }, 16)),
        r.appendChild(document.createTextNode(I18n.get("swipeDelete"))),
        a.appendChild(r),
        t.appendChild(a);
      var i = document.createElement("div");
      (i.className =
        "article-card" + (e.isRead ? " read" : "") + (n.selectedIds[e.id] ? " selected" : "")),
        i.setAttribute("data-id", e.id || ""),
        i.setAttribute("data-url", e.url || ""),
        i.setAttribute("tabindex", "0");
      var l = document.createElement("div");
      if (
        ((l.className = "article-card-checkbox"),
        l.setAttribute("data-checkbox", "true"),
        l.appendChild(Be(12, 3)),
        i.appendChild(l),
        e.leadImageUrl)
      ) {
        var o = document.createElement("img");
        (o.className = "article-card-thumb"),
          (o.src = typeof Sanitize < "u" ? Sanitize.sanitizeUrl(e.leadImageUrl) : e.leadImageUrl),
          (o.alt = ""),
          (o.loading = "lazy"),
          o.addEventListener("error", function () {
            this.style.display = "none";
          }),
          i.appendChild(o);
      } else {
        var u = document.createElement("div");
        (u.className = "article-card-thumb-placeholder"),
          (u.textContent = (e.title || "?").charAt(0).toUpperCase()),
          i.appendChild(u);
      }
      var c = document.createElement("div");
      c.className = "article-card-body";
      var d = document.createElement("div");
      if (
        ((d.className = "article-card-title"),
        (d.textContent = e.title || ""),
        c.appendChild(d),
        e.excerpt)
      ) {
        var f = document.createElement("div");
        (f.className = "article-card-excerpt"), (f.textContent = e.excerpt), c.appendChild(f);
      }
      var h = document.createElement("div");
      if (((h.className = "article-card-meta"), e.domain)) {
        var T = document.createElement("img");
        (T.className = "article-card-favicon"),
          (T.src = chrome.runtime.getURL(
            "/_favicon/?pageUrl=" + encodeURIComponent("https://" + e.domain) + "&size=32",
          )),
          (T.alt = ""),
          (T.loading = "lazy"),
          (T.width = 14),
          (T.height = 14),
          T.addEventListener("error", function () {
            this.style.display = "none";
          }),
          h.appendChild(T);
      }
      var de = document.createElement("span");
      (de.className = "article-card-domain"), (de.textContent = e.domain || ""), h.appendChild(de);
      var Le = e.estimatedReadTime ? I18n.get("readTimeMin", [String(e.estimatedReadTime)]) : "";
      if (Le) {
        var Te = document.createElement("span");
        (Te.textContent = "·"), h.appendChild(Te);
        var xe = document.createElement("span");
        (xe.textContent = Le), h.appendChild(xe);
      }
      var ke = document.createElement("span");
      (ke.textContent = "·"), h.appendChild(ke);
      var we = document.createElement("span");
      (we.textContent = ot(e.savedAt)), h.appendChild(we), c.appendChild(h);
      var K = document.createElement("div");
      K.className = "article-card-actions";
      var U = document.createElement("button");
      (U.className = "article-card-action" + (e.isFavorite ? " favorite-active" : "")),
        U.setAttribute("data-action", "favorite"),
        (U.title = I18n.get("actionFavorite")),
        U.appendChild(Re(14, e.isFavorite)),
        K.appendChild(U);
      var $ = document.createElement("button");
      if (
        (($.className = "article-card-action"),
        $.setAttribute("data-action", "delete"),
        ($.title = I18n.get("buttonDelete")),
        $.appendChild(Fe(14)),
        K.appendChild($),
        c.appendChild(K),
        i.appendChild(c),
        e.readProgress > 0 && e.readProgress < 100)
      ) {
        var _e = document.createElement("div");
        (_e.className = "article-card-progress-bg"), i.appendChild(_e);
        var ue = document.createElement("div");
        (ue.className = "article-card-progress"),
          (ue.style.width = Math.min(e.readProgress, 100) + "%"),
          i.appendChild(ue);
      }
      return t.appendChild(i), t;
    }
    var S = "http://www.w3.org/2000/svg";
    function F(e, t) {
      var a = document.createElementNS(S, "svg");
      return (
        a.setAttribute("width", e),
        a.setAttribute("height", t),
        a.setAttribute("viewBox", "0 0 24 24"),
        a.setAttribute("fill", "none"),
        a.setAttribute("stroke", "currentColor"),
        a.setAttribute("stroke-width", "2"),
        a.setAttribute("stroke-linecap", "round"),
        a.setAttribute("stroke-linejoin", "round"),
        a
      );
    }
    function De(e, t, a) {
      var r = F(a || 16, a || 16),
        i = document.createElementNS(S, e);
      for (var l in t) t.hasOwnProperty(l) && i.setAttribute(l, t[l]);
      return r.appendChild(i), r;
    }
    function Be(e, t) {
      var a = F(e, e);
      a.setAttribute("stroke-width", String(t || 2));
      var r = document.createElementNS(S, "polyline");
      return r.setAttribute("points", "20 6 9 17 4 12"), a.appendChild(r), a;
    }
    function Re(e, t) {
      var a = F(e, e);
      a.setAttribute("fill", t ? "currentColor" : "none");
      var r = document.createElementNS(S, "polygon");
      return (
        r.setAttribute(
          "points",
          "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2",
        ),
        a.appendChild(r),
        a
      );
    }
    function Fe(e) {
      var t = F(e, e),
        a = document.createElementNS(S, "polyline");
      a.setAttribute("points", "3 6 5 6 21 6"), t.appendChild(a);
      var r = document.createElementNS(S, "path");
      return (
        r.setAttribute(
          "d",
          "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
        ),
        t.appendChild(r),
        t
      );
    }
    function oe() {
      if (E) {
        for (; E.firstChild; ) E.removeChild(E.firstChild);
        if (n.tags.length !== 0 && n.activeTab !== "highlights") {
          var e = document.createDocumentFragment();
          function chip(id, label) {
            var c = document.createElement("button");
            return (
              (c.type = "button"),
              (c.className = "chip" + ((n.activeTag || "") === id ? " active" : "")),
              c.setAttribute("data-tag", id),
              c.setAttribute("aria-pressed", String((n.activeTag || "") === id)),
              (c.textContent = label),
              c
            );
          }
          e.appendChild(chip("", I18n.get("tabAll")));
          for (var a = 0; a < n.tags.length; a++)
            e.appendChild(chip(n.tags[a].id || "", n.tags[a].name || ""));
          E.appendChild(e);
        }
      }
    }
    function Ue() {
      E &&
        E.addEventListener("click", function (e) {
          var t = e.target.closest(".chip");
          if (t) {
            var a = t.getAttribute("data-tag") || null,
              r = t.textContent || I18n.get("tabAll");
            (n.activeTag = a),
              (n.offset = 0),
              s && (s.scrollTop = 0),
              fetchList("reset"),
              oe(),
              typeof Announcer < "u" && Announcer.status(I18n.get("announcerFilteredByTag", [r]));
          }
        });
    }
    function $e() {
      if (k)
        for (var e = 0; e < k.length; e++)
          k[e].addEventListener("click", function () {
            switchTab(this.getAttribute("data-tab"));
          });
    }
    function qe() {
      if (m) {
        var e = null;
        m.addEventListener("input", function () {
          ge(),
            clearTimeout(e),
            (e = setTimeout(function () {
              (n.searchTerm = m.value.trim()),
                (n.offset = 0),
                n.searchTerm &&
                  typeof Analytics < "u" &&
                  Analytics.trackFeature("search", { queryLength: n.searchTerm.length }),
                n.activeTab === "highlights" ? hlApi() && hlApi().setQuery(n.searchTerm) : v();
            }, 200));
        }),
          m.addEventListener("keydown", function (t) {
            t.key === "Escape" &&
              (t.preventDefault(), t.stopPropagation(), m.value && me(), m.blur());
          });
      }
    }
    function Oe() {
      B &&
        B.addEventListener("click", function () {
          me(), m.focus();
        });
    }
    function me() {
      m &&
        ((m.value = ""),
        (n.searchTerm = ""),
        (n.offset = 0),
        ge(),
        se(0),
        n.activeTab === "highlights" ? hlApi() && hlApi().setQuery("") : v(),
        typeof FocusManager < "u" && FocusManager.announce(I18n.get("readerSearchCleared")));
    }
    function ge() {
      if (!(!B || !m)) {
        var e = m.value.length > 0;
        (B.style.display = e ? "flex" : "none"), m.classList.toggle("has-value", e);
      }
    }
    function se(e) {
      if (M) {
        if (!n.searchTerm || n.activeTab === "highlights") {
          M.style.display = "none";
          return;
        }
        (M.style.display = "inline"),
          e === 1
            ? (M.textContent = I18n.get("searchResultCountSingle"))
            : (M.textContent = I18n.get("searchResultCount", [String(e)]));
      }
    }
    function Ge() {
      s &&
        s.addEventListener("scroll", function () {
          if (!(!n.hasMore || n.loading)) {
            var e = s.scrollHeight - s.scrollTop - s.clientHeight;
            e < 100 && fetchList("more");
          }
        });
    }
    function Ve() {
      Y &&
        Y.addEventListener("click", function () {
          chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/dashboard.html") });
        }),
        g &&
          g.addEventListener("click", function () {
            chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/import.html") });
          }),
        W &&
          W.addEventListener("click", function () {
            chrome.runtime.openOptionsPage();
          });
    }
    function ze() {
      s &&
        (s.addEventListener("click", function (e) {
          var t = e.target.closest(".article-card");
          if (t) {
            if (n.selectionMode) {
              e.stopPropagation(), he(t);
              return;
            }
            if (e.target.closest("[data-checkbox]")) {
              e.stopPropagation();
              return;
            }
            var a = e.target.closest("[data-action]");
            if (a) {
              e.stopPropagation();
              var r = t.getAttribute("data-id"),
                i = a.getAttribute("data-action");
              i === "favorite"
                ? MessageHelper.send("TOGGLE_FAVORITE", { id: r }).then(function () {
                    touchArticles(),
                      scheduleRefresh(0),
                      typeof Announcer < "u" &&
                        Announcer.status(I18n.get("announcerFavoriteToggled"));
                  })
                : i === "delete" && G(t);
              return;
            }
            openArticle(t.getAttribute("data-id"));
          }
        }),
        Xe());
    }
    function Xe() {
      if (s) {
        var e = null,
          t = 500,
          a = 0,
          r = 0,
          i = 0,
          l = !1,
          o = !1,
          u = 80,
          c = null;
        s.addEventListener("pointerdown", function (d) {
          var f = d.target.closest(".article-card");
          f &&
            (d.target.closest("[data-action]") ||
              d.target.closest("[data-checkbox]") ||
              (d.button === 0 &&
                ((c = f),
                (a = d.clientX),
                (r = d.clientY),
                (i = 0),
                (l = !1),
                (o = !1),
                n.selectionMode ||
                  (e = setTimeout(function () {
                    (e = null), n.selectionMode || Ye(), he(c);
                  }, t)),
                f.setPointerCapture(d.pointerId))));
        }),
          s.addEventListener("pointermove", function (d) {
            if (
              c &&
              (e && (clearTimeout(e), (e = null)), !(a === 0 && r === 0) && !o && !n.selectionMode)
            ) {
              var f = d.clientX - a,
                h = d.clientY - r;
              if (!l && !o) {
                if (Math.abs(h) > Math.abs(f) && Math.abs(h) > 5) {
                  o = !0;
                  return;
                }
                Math.abs(f) > 5 && ((l = !0), c.classList.add("swiping"));
              }
              l &&
                ((i = Math.min(0, f)),
                (c.style.transform = "translateX(" + i + "px)"),
                d.preventDefault());
            }
          }),
          s.addEventListener("pointerup", function (d) {
            if ((e && (clearTimeout(e), (e = null)), !!c)) {
              var f = c;
              if (!l) {
                (c = null), (a = 0), (r = 0);
                return;
              }
              f.classList.remove("swiping"),
                Math.abs(i) > u
                  ? G(f)
                  : (f.classList.add("snap-back"),
                    (f.style.transform = "translateX(0)"),
                    setTimeout(function () {
                      f.classList.remove("snap-back");
                    }, 250)),
                (c = null),
                (a = 0),
                (r = 0),
                (i = 0),
                (l = !1),
                (o = !1);
            }
          }),
          s.addEventListener("pointercancel", function () {
            if ((e && (clearTimeout(e), (e = null)), c)) {
              c.classList.remove("swiping"),
                c.classList.add("snap-back"),
                (c.style.transform = "translateX(0)");
              var d = c;
              setTimeout(function () {
                d.classList.remove("snap-back");
              }, 250);
            }
            (c = null), (a = 0), (r = 0), (i = 0), (l = !1), (o = !1);
          });
      }
    }
    /* Sorting is not gated. `domain_sort` appears in no tier map, no notSold map
       and no alias in limits-config.json, and the settled offer has exactly one
       Pro feature, full-text search. Charging for a sort that the tier config
       has never heard of was selling something that does not exist. */
    function Ke() {
      C &&
        C.addEventListener("change", function () {
          var e = C.value,
            t = e.lastIndexOf("-");
          (n.sortBy = e.substring(0, t)),
            (n.sortOrder = e.substring(t + 1) || "desc"),
            (n.offset = 0),
            persistSetting({ sidebarSortBy: n.sortBy, sidebarSortOrder: n.sortOrder }),
            s && (s.scrollTop = 0),
            fetchList("reset");
        });
    }
    function G(e) {
      deleteWithUndo([e.getAttribute("data-id")], e);
    }
    function Ye() {
      (n.selectionMode = !0),
        (n.selectedIds = {}),
        s.classList.add("selection-mode"),
        (j.style.display = "flex"),
        x && x.classList.add("batch-active"),
        ye();
    }
    function V() {
      (n.selectionMode = !1),
        (n.selectedIds = {}),
        s.classList.remove("selection-mode"),
        (j.style.display = "none"),
        x && x.classList.remove("batch-active");
      for (var e = s.querySelectorAll(".article-card.selected"), t = 0; t < e.length; t++)
        e[t].classList.remove("selected");
    }
    function he(e) {
      var t = e.getAttribute("data-id");
      n.selectedIds[t]
        ? (delete n.selectedIds[t], e.classList.remove("selected"))
        : ((n.selectedIds[t] = !0), e.classList.add("selected")),
        ye();
    }
    function ye() {
      var e = Object.keys(n.selectedIds).length;
      Z && (Z.textContent = I18n.get("batchSelectedCount", [String(e)]));
    }
    function We() {
      !J ||
        !Q ||
        !ee ||
        (J.addEventListener("click", function () {
          V();
        }),
        Q.addEventListener("click", function () {
          var e = Object.keys(n.selectedIds);
          if (e.length !== 0) {
            var t = e.map(function (a) {
              return MessageHelper.send("MARK_AS_READ", { id: a }).catch(function (r) {
                return console.warn("[Sidebar] Batch mark-read failed for article:", a, r), null;
              });
            });
            Promise.all(t).then(function () {
              V(), touchArticles(), fetchList("refresh");
              var a = I18n.get("toastArticlesMarkedRead", [String(e.length)]);
              _(a),
                typeof Announcer < "u" && Announcer.status(a),
                e.length >= 3 && Jt("batch_cleared");
            });
          }
        }),
        ee.addEventListener("click", function () {
          var e = Object.keys(n.selectedIds);
          e.length !== 0 && (V(), deleteWithUndo(e, null));
        }));
    }
    function je() {
      if (!(!s || !p)) {
        var e = 0,
          t = !1,
          a = 60;
        s.addEventListener(
          "touchstart",
          function (r) {
            s.scrollTop <= 0 && r.touches.length === 1 && ((e = r.touches[0].clientY), (t = !1));
          },
          { passive: !0 },
        ),
          s.addEventListener(
            "touchmove",
            function (r) {
              if (e !== 0 && !n.pullRefreshActive) {
                var i = r.touches[0].clientY - e;
                if (i > 0 && s.scrollTop <= 0) {
                  t = !0;
                  var l = Math.min(i / a, 1);
                  p.classList.add("visible"),
                    (p.querySelector(".pull-to-refresh-text").textContent =
                      i > a ? I18n.get("releaseToRefresh") : I18n.get("pullToRefresh")),
                    (p.style.height = Math.min(i * 0.5, 50) + "px");
                }
              }
            },
            { passive: !0 },
          ),
          s.addEventListener(
            "touchend",
            function () {
              if (!t) {
                e = 0;
                return;
              }
              var r = parseInt(p.style.height, 10) || 0;
              r > a * 0.4
                ? ((n.pullRefreshActive = !0),
                  p.classList.remove("visible"),
                  p.classList.add("refreshing"),
                  (p.querySelector(".pull-to-refresh-text").textContent = I18n.get("refreshing")),
                  (p.style.height = "40px"),
                  (n.offset = 0),
                  (n.articles = []),
                  setTimeout(function () {
                    (n.pullRefreshActive = !1),
                      p.classList.remove("refreshing"),
                      (p.style.height = "0"),
                      fetchList("reset"),
                      R();
                  }, 400))
                : (p.classList.remove("visible"), (p.style.height = "0")),
                (e = 0),
                (t = !1);
            },
            { passive: !0 },
          );
      }
    }
    function Ze() {
      !s ||
        !A ||
        (s.addEventListener("contextmenu", function (e) {
          var t = e.target.closest(".article-card");
          t && (e.preventDefault(), openCtxMenu(t, e.clientX, e.clientY, !1));
        }),
        A.addEventListener("click", function (e) {
          var t = e.target.closest("[data-ctx-action]");
          t && runCtxAction(t.getAttribute("data-ctx-action"), e.clientX, e.clientY);
        }),
        A.addEventListener("keydown", function (e) {
          var t = Array.prototype.filter.call(A.querySelectorAll("[data-ctx-action]"), function (a) {
              return !a.hidden;
            }),
            a = t.indexOf(document.activeElement);
          if (e.key === "ArrowDown" || e.key === "ArrowUp")
            e.preventDefault(),
              (a = e.key === "ArrowDown" ? (a + 1) % t.length : (a - 1 + t.length) % t.length),
              t[a] && t[a].focus();
          else if (e.key === "Home" || e.key === "End")
            e.preventDefault(), t.length && t[e.key === "Home" ? 0 : t.length - 1].focus();
          else if (e.key === "Enter" || e.key === " ") {
            if ((e.preventDefault(), a >= 0)) {
              var r = t[a].getBoundingClientRect();
              runCtxAction(t[a].getAttribute("data-ctx-action"), r.left, r.top);
            }
          } else e.key === "Escape" ? (e.preventDefault(), e.stopPropagation(), z(!0)) : e.key === "Tab" && z(!0);
        }),
        document.addEventListener("click", function (e) {
          A.contains(e.target) || z();
        }),
        s.addEventListener("scroll", function () {
          z();
        }),
        document.addEventListener("keydown", function (e) {
          e.key === "Escape" && (z(), H(), n.selectionMode && V());
        }));
    }
    var ctxReturnFocus = null;
    function z(e) {
      var t = A.style.display !== "none";
      (A.style.display = "none"), (n.contextArticleId = null);
      var a = ctxReturnFocus;
      (ctxReturnFocus = null), e && t && a && document.contains(a) && a.focus();
    }
    function Je(e) {
      for (var t = 0; t < n.articles.length; t++) if (n.articles[t].id === e) return n.articles[t];
      return null;
    }
    function Qe(e) {
      if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(e).catch(function (t) {
          console.warn("[Sidebar] Clipboard write failed:", t);
        });
      else {
        var t = document.createElement("textarea");
        (t.value = e),
          (t.style.position = "fixed"),
          (t.style.opacity = "0"),
          document.body.appendChild(t),
          t.select(),
          document.execCommand("copy"),
          document.body.removeChild(t);
      }
    }
    var L = null;
    function et(e, t, a) {
      H();
      var r = document.createElement("div");
      (r.className = "tag-input-prompt"), (r.style.left = e + "px"), (r.style.top = t + "px");
      var i = document.createElement("label");
      (i.textContent = I18n.get("labelTagName")), r.appendChild(i);
      var l = document.createElement("input");
      (l.type = "text"),
        (l.id = "tag-prompt-input"),
        (l.placeholder = I18n.get("placeholderTagInput")),
        l.setAttribute("autofocus", ""),
        r.appendChild(l),
        document.body.appendChild(r),
        (L = r);
      var o = r.getBoundingClientRect();
      o.right > window.innerWidth && (r.style.left = window.innerWidth - o.width - 4 + "px"),
        o.bottom > window.innerHeight && (r.style.top = window.innerHeight - o.height - 4 + "px");
      var u = r.querySelector("input");
      setTimeout(function () {
        u.focus();
      }, 50),
        u.addEventListener("keydown", function (c) {
          if (c.key === "Enter") {
            var d = u.value.trim();
            d &&
              MessageHelper.send("CREATE_TAG", { name: d }).then(function (f) {
                if (f && f.success && f.data) {
                  var h = f.data.id || f.data;
                  MessageHelper.send("TAG_ARTICLE", { articleId: a, tagId: h }).then(function () {
                    R(),
                      touchArticles(),
                      _(I18n.get("toastTagAdded", [d])),
                      typeof Analytics < "u" && Analytics.trackFeature("tag_add", { tagName: d });
                  });
                }
              }),
              H();
          } else c.key === "Escape" && H();
        }),
        setTimeout(function () {
          document.addEventListener("click", be);
        }, 100);
    }
    function be(e) {
      L && !L.contains(e.target) && H();
    }
    function H() {
      L && (L.parentNode && L.parentNode.removeChild(L), (L = null)),
        document.removeEventListener("click", be);
    }
    function tt() {
      document.addEventListener("keydown", function (e) {
        var ae = document.activeElement,
          t = ae ? ae.tagName : "",
          a = t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || (ae && ae.isContentEditable);
        if (e.key === "Escape" && I) {
          e.preventDefault(), Ee();
          return;
        }
        /* Browser and OS shortcuts (Cmd/Ctrl+F, Cmd+Backspace, Alt+arrows) belong
           to Chrome. The one exception is Cmd/Ctrl+Z while an undo is on offer. */
        if (e.ctrlKey || e.metaKey || e.altKey) {
          !a &&
            !e.altKey &&
            !e.shiftKey &&
            (e.key === "z" || e.key === "Z") &&
            toastAction &&
            (e.preventDefault(), runToastAction());
          return;
        }
        if (!a && e.key === "/") {
          e.preventDefault(), m && m.focus();
          return;
        }
        if (!a && e.key === "?") {
          e.preventDefault(), Ae();
          return;
        }
        if (a || n.activeTab === "highlights" || n.articles.length === 0) return;
        if (A && A.style.display !== "none") return;
        if (L || (viewMenu && !viewMenu.hidden)) return;
        /* A focused button or link handles its own Enter and Space. */
        var onCard = ae && ae.classList && ae.classList.contains("article-card");
        if ((t === "BUTTON" || t === "A") && !onCard && (e.key === "Enter" || e.key === " ")) return;
        if (e.key === "ArrowDown" || e.key === "j") e.preventDefault(), Ce(1);
        else if (e.key === "ArrowUp" || e.key === "k") e.preventDefault(), Ce(-1);
        else {
          var r = focusedArticleId();
          if (!r) return;
          if (e.key === "Enter") e.preventDefault(), openArticle(r);
          else if (e.key === "f")
            e.preventDefault(),
              MessageHelper.send("TOGGLE_FAVORITE", { id: r }).then(function () {
                touchArticles(),
                  scheduleRefresh(0),
                  typeof Announcer < "u" && Announcer.status(I18n.get("announcerFavoriteToggled"));
              });
          else if (e.key === "d" || e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            var u = s.querySelector('.article-card[data-id="' + cssEsc(r) + '"]');
            deleteWithUndo([r], u);
          } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            var c = s.querySelector('.article-card[data-id="' + cssEsc(r) + '"]');
            if (c) {
              var d = c.getBoundingClientRect();
              openCtxMenu(c, d.left + 24, d.top + 24, !0);
            }
          }
        }
      });
    }
    /* Make sure row `e` exists in the DOM before we try to focus it. The virtual
       scroller only paints its current window, and it repaints on a scroll frame,
       so a keyboard jump has to bring the row in and render it synchronously. */
    function Wt(e) {
      w &&
        (e >= w.visibleStart && e < w.visibleEnd) === !1 &&
        w.scrollToIndex(Math.max(0, e - 1)),
        w && w._render && w._render();
    }
    function Ce(e) {
      var t = n.articles.length;
      if (t !== 0) {
        for (var a = s.querySelectorAll(".article-card.keyboard-focused"), r = 0; r < a.length; r++)
          a[r].classList.remove("keyboard-focused");
        var i = n.focusedIndex + e;
        i < 0 && (i = 0),
          i >= t && (i = t - 1),
          (n.focusedIndex = i),
          Wt(i),
          requestAnimationFrame(function () {
            for (var l = s.querySelectorAll(".article-card"), o = 0; o < l.length; o++)
              if (l[o].getAttribute("data-id") === n.articles[i].id) {
                if (
                  (l[o].classList.add("keyboard-focused"),
                  l[o].focus(),
                  l[o].scrollIntoView({ block: "nearest", behavior: "smooth" }),
                  typeof FocusManager < "u" && FocusManager.announce)
                ) {
                  var u = n.articles[i],
                    c = I18n.get("announcerArticleNavigation", [
                      String(i + 1),
                      String(t),
                      u.title || "",
                    ]);
                  FocusManager.announce(c);
                }
                break;
              }
          });
      }
    }
    function nt() {
      document.addEventListener("visibilitychange", function () {
        document.visibilityState === "visible" && (scheduleRefresh(0), R());
      }),
        window.addEventListener("pageshow", function (e) {
          e.persisted && (scheduleRefresh(0), R());
        }),
        window.addEventListener("pagehide", saveSession);
    }
    var EMPTY_MAX_PATHS = 8;
    var Gt = null;
    /* Switch filter tab from code, keeping the tab strip in sync with state. */
    function qt(e) {
      switchTab(e);
    }
    /* Describe why the list is empty. Each case gets its own illustration,
       headline, hint and next action, because "no search results" and "you have
       not saved anything yet" are different problems with different fixes. */
    function Ot() {
      return n.searchTerm
        ? {
            tone: "search",
            paths: [
              { tag: "circle", attrs: { cx: "11", cy: "11", r: "8" } },
              { tag: "line", attrs: { x1: "21", y1: "21", x2: "16.65", y2: "16.65" } },
            ],
            titleKey: "emptyStateSearchTitle",
            hintKey: "rlEmptySearchHint",
            shortcut: !1,
            actionKey: "rlEmptyClearSearch",
            run: me,
          }
        : n.lengthFilter
          ? {
              tone: "search",
              paths: [
                { tag: "circle", attrs: { cx: "12", cy: "12", r: "10" } },
                { tag: "polyline", attrs: { points: "12 6 12 12 16 14" } },
              ],
              titleKey: n.lengthFilter === "quick" ? "panelEmptyQuickTitle" : "panelEmptyLongTitle",
              hintKey: "panelEmptyLengthHint",
              shortcut: !1,
              actionKey: "panelClearLength",
              run: function () {
                setLengthFilter(null);
              },
            }
        : n.activeTag
          ? {
              tone: "tag",
              paths: [
                {
                  tag: "path",
                  attrs: {
                    d: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z",
                  },
                },
                { tag: "line", attrs: { x1: "7", y1: "7", x2: "7.01", y2: "7" } },
              ],
              titleKey: "emptyStateTagTitle",
              hintKey: "rlEmptyTagHint",
              shortcut: !1,
              actionKey: "rlEmptyShowAll",
              run: function () {
                qt("all");
              },
            }
          : n.activeTab === "unread"
            ? {
                tone: "success",
                paths: [
                  { tag: "path", attrs: { d: "M22 11.08V12a10 10 0 1 1-5.93-9.14" } },
                  { tag: "polyline", attrs: { points: "22 4 12 14.01 9 11.01" } },
                ],
                titleKey: "rlEmptyUnreadTitle",
                hintKey: "rlEmptyUnreadHint",
                shortcut: !1,
                actionKey: "rlEmptyShowAll",
                run: function () {
                  qt("all");
                },
              }
            : n.activeTab === "favorites"
              ? {
                  tone: "favorite",
                  paths: [
                    {
                      tag: "polygon",
                      attrs: {
                        points:
                          "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2",
                      },
                    },
                  ],
                  titleKey: "emptyStateFavoritesTitle",
                  hintKey: "rlEmptyFavoritesHint",
                  shortcut: !1,
                  actionKey: "rlEmptyShowAll",
                  run: function () {
                    qt("all");
                  },
                }
              : {
                  tone: "",
                  paths: null,
                  titleKey: "emptyStateTitle",
                  hintKey: "rlEmptyFirstHint",
                  shortcut: !0,
                  actionKey: null,
                  run: null,
                };
    }
    function Pt(e, t) {
      var a = b.querySelector(".sidebar-empty-illustration");
      if (a) {
        Gt || (Gt = a.cloneNode(!0)),
          (a.className = "sidebar-empty-illustration" + (t ? " illus-" + t : ""));
        for (; a.firstChild; ) a.removeChild(a.firstChild);
        if (!e) {
          for (var r = Gt.childNodes, i = 0; i < r.length; i++) a.appendChild(r[i].cloneNode(!0));
          return;
        }
        var l = document.createElementNS(S, "svg");
        l.setAttribute("width", "64"),
          l.setAttribute("height", "64"),
          l.setAttribute("viewBox", "0 0 24 24"),
          l.setAttribute("fill", "none"),
          l.setAttribute("stroke", "currentColor"),
          l.setAttribute("stroke-width", "1.25"),
          l.setAttribute("stroke-linecap", "round"),
          l.setAttribute("stroke-linejoin", "round"),
          l.setAttribute("aria-hidden", "true"),
          l.setAttribute("focusable", "false");
        for (var o = 0; o < e.length && o < EMPTY_MAX_PATHS; o++) {
          var u = document.createElementNS(S, e[o].tag);
          for (var c in e[o].attrs)
            e[o].attrs.hasOwnProperty(c) && u.setAttribute(c, e[o].attrs[c]);
          l.appendChild(u);
        }
        a.appendChild(l);
      }
    }
    function At(e, t) {
      var a = b.querySelector(".sidebar-empty-action");
      if (!e) {
        a && a.parentNode && a.parentNode.removeChild(a);
        return;
      }
      a ||
        ((a = document.createElement("button")),
        (a.className = "sidebar-empty-action"),
        (a.type = "button"),
        b.appendChild(a)),
        (a.textContent = tx(e)),
        (a.onclick = t);
    }
    function at() {
      if (b) {
        var e = Ot();
        Pt(e.paths, e.tone);
        var t = b.querySelector(".sidebar-empty-text"),
          a = b.querySelector(".sidebar-empty-hint"),
          r = b.querySelector(".sidebar-empty-shortcut");
        t && (t.textContent = tx(e.titleKey)),
          a && (a.textContent = tx(e.hintKey)),
          r && (r.style.display = e.shortcut ? "flex" : "none"),
          At(e.actionKey, e.run);
      }
    }
    function Ae() {
      if (!I) {
        var e = document.createElement("div");
        e.className = "shortcuts-overlay";
        var t = document.createElement("div");
        t.className = "shortcuts-panel";
        var a = document.createElement("div");
        (a.className = "shortcuts-panel-title"),
          (a.textContent = I18n.get("keyboardShortcutsTitle")),
          t.appendChild(a);
        for (
          var r = [
              {
                keys: ["↑", "↓"],
                label: I18n.get("shortcutNavigateUp") + " / " + I18n.get("shortcutNavigateDown"),
              },
              { keys: ["Enter"], label: I18n.get("shortcutOpenArticle") },
              { keys: ["f"], label: I18n.get("shortcutToggleFavorite") },
              { keys: ["d"], label: I18n.get("shortcutDeleteArticle") },
              { keys: ["/"], label: I18n.get("shortcutFocusSearch") },
              { keys: ["Esc"], label: I18n.get("shortcutClosePanel") },
            ],
            i = 0;
          i < r.length;
          i++
        ) {
          var l = document.createElement("div");
          l.className = "shortcuts-panel-row";
          var o = document.createElement("span");
          (o.className = "shortcuts-panel-label"), (o.textContent = r[i].label), l.appendChild(o);
          var u = document.createElement("div");
          u.className = "shortcuts-panel-keys";
          for (var c = 0; c < r[i].keys.length; c++) {
            var d = document.createElement("kbd");
            (d.className = "shortcuts-panel-key"), (d.textContent = r[i].keys[c]), u.appendChild(d);
          }
          l.appendChild(u), t.appendChild(l);
        }
        e.appendChild(t),
          document.body.appendChild(e),
          (I = e),
          e.addEventListener("click", function (f) {
            f.target === e && Ee();
          });
      }
    }
    function Ee() {
      I && I.parentNode && I.parentNode.removeChild(I), (I = null);
    }
    function rt() {
      var e = navigator.platform && navigator.platform.indexOf("Mac") !== -1;
      if (!e)
        for (
          var t = document.querySelectorAll(".sidebar-empty-shortcut kbd"), a = 0;
          a < t.length;
          a++
        )
          t[a].textContent === "Cmd" && (t[a].textContent = "Ctrl");
    }
    function it() {
      if (x) {
        var e = document.createElement("button");
        (e.type = "button"),
          (e.className = "sidebar-footer-shortcut-hint"),
          (e.textContent = I18n.get("keyboardShortcutsHint")),
          e.addEventListener("click", function () {
            Ae();
          }),
          x.appendChild(e);
        /* The one neutral fleet surface allowed in the extension UI. No sibling
           extension is named, listed or linked anywhere in this build. */
        var t = document.createElement("button");
        (t.type = "button"),
          (t.className = "sidebar-footer-manage-link"),
          (t.textContent = I18n.get("rlManageAtZovo")),
          t.addEventListener("click", function () {
            openTab(ACCOUNT_URL);
          }),
          x.appendChild(t);
      }
    }
    function ot(e) {
      var t = Date.now() - e,
        a = Math.floor(t / 1e3),
        r = Math.floor(a / 60),
        i = Math.floor(r / 60),
        l = Math.floor(i / 24);
      return l > 30
        ? I18n.get("timeAgoMonths", [String(Math.floor(l / 30))])
        : l > 0
          ? I18n.get("timeAgoDays", [String(l)])
          : i > 0
            ? I18n.get("timeAgoHours", [String(i)])
            : r > 0
              ? I18n.get("timeAgoMinutes", [String(r)])
              : I18n.get("timeAgoNow");
    }
    var toastTimer = null,
      toastAction = null;
    function _(e, t, a, r) {
      if (P) {
        var i = P.querySelector(".toast-text"),
          l = P.querySelector(".toast-action");
        i ? (i.textContent = e) : (P.textContent = e),
          l &&
            (t && a
              ? ((l.textContent = t), (l.hidden = !1), (toastAction = a), P.classList.add("has-action"))
              : ((l.hidden = !0), (toastAction = null), P.classList.remove("has-action"))),
          P.classList.add("visible"),
          clearTimeout(toastTimer),
          (toastTimer = setTimeout(hideToast, r || (a ? 8e3 : 2500)));
        var o = t && a ? e + ". " + tx("panelUndoHint", "Press Cmd+Z or choose Undo to bring it back.") : e;
        typeof FocusManager < "u" && FocusManager.announce
          ? FocusManager.announce(o)
          : typeof Announcer < "u" && Announcer.status(o);
      }
    }
    function hideToast() {
      clearTimeout(toastTimer),
        (toastTimer = null),
        P && P.contains(document.activeElement) && document.activeElement.blur(),
        P && P.classList.remove("visible", "has-action"),
        (toastAction = null);
    }
    function runToastAction() {
      var e = toastAction;
      hideToast(), e && e();
    }
    /* CHECK_TRIAL_AND_LICENSE is the only tier authority this surface consults.
       The previous fallback read licenseDataPlain straight out of
       chrome.storage.local and trusted it, so a console write could dress the
       panel up as Pro. A failed check now resolves to free, which is the safe
       direction. */
    function Ie() {
      MessageHelper.send("CHECK_TRIAL_AND_LICENSE")
        .then(function (e) {
          if (e && e.success && e.data) {
            var t = e.data;
            (n.isPro = !!(t.effectivelyPro || t.isPro || t.trialActive)),
              (n.tier = t.tier || "free"),
              (n.trialActive = !!t.trialActive),
              (n.trialDaysLeft = t.trialDaysLeft || 0),
              (n.isLicensed = !!(t.license && t.license.isPro));
          } else xt();
          ce();
        })
        .catch(function (e) {
          console.warn("[Sidebar] Failed to check pro status:", e), xt(), ce();
        });
    }
    function xt() {
      (n.isPro = !1),
        (n.tier = "free"),
        (n.trialActive = !1),
        (n.trialDaysLeft = 0),
        (n.isLicensed = !1);
    }
    function ce() {
      var e = n.tier;
      y &&
        (e === "lifetime"
          ? ((y.textContent = I18n.get("badgeLifetime")),
            (y.className = "tier-badge tier-lifetime"))
          : e === "trial"
            ? ((y.textContent = I18n.get("badgeTrial")), (y.className = "tier-badge tier-trial"))
            : e === "pro" || n.isPro
              ? ((y.textContent = I18n.get("badgePro")), (y.className = "tier-badge tier-pro"))
              : ((y.textContent = I18n.get("badgeFree")), (y.className = "tier-badge tier-free")),
        (y.style.display = "inline-block"));
      var t = n.isLicensed || e === "pro" || e === "lifetime";
      if (
        (N &&
          (t ? N.classList.add("visible") : N.classList.remove("visible"),
          (N.style.display = t ? "inline-block" : "none")),
        O)
      )
        if (n.trialActive && e === "trial") {
          O.style.display = "flex";
          var a = document.getElementById("trial-banner-text");
          a && (a.textContent = I18n.get("trialBannerText", [String(n.trialDaysLeft)]));
        } else O.style.display = "none";
      ae &&
        (ae.onclick = function (r) {
          r.preventDefault(), X();
        }),
        (n.isPro || e !== "free") && te && (te.style.display = "none"),
        ne &&
          (ne.onclick = function (r) {
            r.preventDefault(), X();
          }),
        D &&
          (n.isLicensed || e === "pro" || e === "lifetime"
            ? ((D.style.display = "inline"),
              (D.onclick = function (r) {
                r.preventDefault(), openTab(ACCOUNT_URL);
              }))
            : (D.style.display = "none")),
        st();
    }
    /* Pocket import is part of the core promise and is never gated. The previous
       build locked it behind Pro, which contradicted the free-tier promise. */
    function st() {
      if (g) {
        g.classList.remove("feature-locked"), (g.title = I18n.get("tooltipImport"));
        var e = g.querySelector(".lock-icon");
        e && g.removeChild(e), (g.onclick = null);
      }
    }
    /* Title search is part of the core promise and stays free at any query
       length. Full-text search runs too, metered at twenty a day, so there is
       nothing to nudge about while the user is inside their allowance. The only
       search-time upgrade moment is the cap itself, handled by Tt(). */
    /* Corrected hard rule 1 and 2. The side panel carries no price number and
       one neutral CTA, and it opens the canonical checkout directly so the UTM
       survives rather than being lost through an interstitial. */
    var CHECKOUT_URL =
      "https://zovo.one/pricing?utm_source=readlater_pro&utm_medium=extension&utm_campaign=upgrade&utm_content=sidebar";
    var ACCOUNT_URL = "https://zovo.one/";
    function openTab(e) {
      chrome.tabs.create({ url: e }, function () {
        chrome.runtime && chrome.runtime.lastError;
      });
    }
    function X() {
      openTab(CHECKOUT_URL);
    }
    var UPGRADE_HINT_KEY = "upgradeHintDismissedAt";
    var UPGRADE_HINT_QUIET_MS = 30 * 24 * 60 * 60 * 1e3;
    var Yt = !1;
    /* The upgrade affordance is shown once, only at a point where the user just
       reached for something Pro covers, and it can be dismissed for good. There
       is deliberately no always-on banner. */
    function Jt(e) {
      !n.isPro &&
        !Yt &&
        te &&
        te.style.display !== "flex" &&
        chrome.storage.local.get(UPGRADE_HINT_KEY, function (t) {
          if (!(chrome.runtime && chrome.runtime.lastError)) {
            var a = (t && t[UPGRADE_HINT_KEY]) || 0;
            Date.now() - a < UPGRADE_HINT_QUIET_MS ||
              ((Yt = !0),
              (te.style.display = "flex"),
              typeof Analytics < "u" && Analytics.trackFeature("upgrade_hint_shown", { at: e }));
          }
        });
    }
    function Ut() {
      te && (te.style.display = "none");
      var e = {};
      (e[UPGRADE_HINT_KEY] = Date.now()),
        chrome.storage.local.set(e, function () {
          chrome.runtime && chrome.runtime.lastError;
        });
    }
    function Bt() {
      var e = document.getElementById("upgrade-banner-dismiss");
      e &&
        e.addEventListener("click", function (t) {
          t.preventDefault(), Ut();
        });
    }
    function vt() {
      MessageHelper.send("GET_USAGE_STATS")
        .then(function (e) {
          if (!(!e || !e.success)) {
            var t = e.data || {},
              a = t.actions && t.actions.article_save ? t.actions.article_save : 0;
            mt(a);
          }
        })
        .catch(function (e) {
          console.warn("[Sidebar] Failed to load usage stats:", e);
        });
    }
    /* usageStats.actions.article_save is a cumulative all-time counter. The
       previous label called it "this week", which the data never supported. */
    function mt(e) {
      !re || !ie || ((re.style.display = e > 0 ? "block" : "none"), (ie.textContent = e));
    }
    function bt(e, t, a, r) {
      if (!e) return;
      if (t === a) {
        e.textContent = a;
        return;
      }
      var i = null,
        l = a - t;
      function o(u) {
        i || (i = u);
        var c = u - i,
          d = Math.min(c / r, 1),
          f = 1 - (1 - d) * (1 - d),
          h = Math.round(t + l * f);
        (e.textContent = h),
          d < 1
            ? requestAnimationFrame(o)
            : ((e.textContent = a),
              e.classList.add("bump"),
              setTimeout(function () {
                e.classList.remove("bump");
              }, 400));
      }
      requestAnimationFrame(o);
    }
    function gt(e, t) {
      if (e) {
        var a = document.createElement("div");
        (a.className = "feature-error"), a.setAttribute("role", "alert");
        var r = document.createElement("p");
        r.textContent = I18n.get("errorFeatureUnavailable");
        var i = document.createElement("p");
        i.textContent = I18n.get("errorTryReloading");
        var l = document.createElement("button");
        (l.className = "btn"),
          (l.textContent = I18n.get("buttonRetry")),
          l.addEventListener("click", function () {
            window.location.reload();
          }),
          a.appendChild(r),
          a.appendChild(i),
          a.appendChild(l),
          e.appendChild(a);
      }
    }
    function Ct(e, t, a) {
      try {
        t();
      } catch (r) {
        console.error('[Sidebar] Feature "' + e + '" failed to initialize:', r),
          typeof ErrorHandler < "u" &&
            ErrorHandler.reportError("Sidebar." + e, r, "feature_init_error"),
          gt(a || document.body, e);
      }
    }
    /* Only a short allow-list of keys should rebuild the list. The previous
       version reloaded on every chrome.storage.local write, so analytics
       counters and support-menu click counts reset the panel to page one while
       the user was scrolling it. */
    /* ===== 1.3.0 reading companion: list loading, highlights tab, read in
       panel, save from the panel, undo. ===== */
    var STR = {
      panelUndo: "Undo",
      panelUndoHint: "Press Cmd+Z or choose Undo to bring it back.",
      panelListSummary: "$1, about $2",
      panelDurHM: "$1 h $2 min",
      panelDurH: "$1 h",
      panelDurM: "$1 min",
      panelEmptyQuickTitle: "No quick reads here",
      panelEmptyLongTitle: "No long reads here",
      panelEmptyLengthHint: "Nothing in this view matches that length. Try another tab or show every length.",
      panelClearLength: "Show every length",
      panelDeleteFailed: "Couldn't delete that. Try again.",
      panelRestoredOne: "Article restored",
      panelRestoredMany: "$1 articles restored",
      panelRestoreFailed: "Some articles couldn't be restored.",
      panelMarkRead: "Mark as read",
      panelMarkUnread: "Mark as unread",
      panelMarkedRead: "Marked as read",
      panelMarkedUnread: "Marked as unread",
      panelRemoveTagNamed: 'Remove tag "$1"',
      panelRemoveTagMany: "Remove a tag",
      panelRemoveWhichTag: "Remove which tag?",
      panelTagRemoved: 'Removed tag "$1"',
      panelTagRestored: "Tag restored",
      panelUntagFailed: "Couldn't remove that tag. Try again.",
      panelRediscoverNone: "Nothing unread to rediscover. Nice work.",
      panelRediscoverOpened: 'Opened "$1" in a new tab',
      panelSaving: "Saving this page...",
      panelSavedFull: "Saved with full text",
      panelSavedText: "Saved",
      panelSavedTextNote: "Only the plain text of this page could be kept.",
      panelSavedFilled: "Full text added",
      panelSavedLink: "Saved as a link",
      panelAlreadySaved: "Already in your list",
      panelAlreadySavedLink: "Already saved as a link",
      panelLinkNote: "Chrome lets ReadLater read a page only after you click the ReadLater icon on it. Do that, then save again here to add the full text.",
      panelCantSave: "This page can't be saved",
      panelCantSaveNote: "Browser pages and local files can't be saved. Switch to a web page and try again.",
      panelSaveFailed: "Couldn't save this page",
      panelSaveFailedNote: "Something went wrong. Try again in a moment.",
      panelTryAgain: "Try again",
      panelReadNow: "Read now",
      panelSavingTabs: "Saving tabs...",
      panelNoTabs: "There are no web pages to save in this window.",
      panelSavedTabsOne: "Saved 1 tab",
      panelSavedTabsMany: "Saved $1 tabs",
      panelSavedTabsNone: "Nothing new to save",
      panelTabsDupOne: "1 was already in your list.",
      panelTabsDupMany: "$1 were already in your list.",
      panelTabsFailOne: "1 couldn't be saved.",
      panelTabsFailMany: "$1 couldn't be saved.",
      panelTabsLinkNoteOther: "Other tabs are saved as links. To add a page's full text, click the ReadLater icon on it, then save again here.",
      panelTabsLinkNoteAll: "Tabs are saved as links. To add a page's full text, click the ReadLater icon on it, then save again here.",
      panelTabsUndoneOne: "Removed the tab you just saved",
      panelTabsUndoneMany: "Removed the $1 tabs you just saved",
      panelHlSearchPlaceholder: "Search highlights...",
      panelHlSearchLabel: "Search highlights",
      panelOpenInChangedTab: "Articles will open in a new tab",
      panelOpenInChangedPanel: "Articles will open in this panel",
      panelLengthAll: "Showing every length",
      panelLengthQuick: "Showing quick reads, 5 min or less",
      panelLengthLong: "Showing long reads, 15 min or more",
      panelTabHighlights: "Highlights",
    };
    function tx(e, t, a) {
      var r = "";
      try {
        r = chrome.i18n.getMessage(e, a ? a.map(String) : void 0) || "";
      } catch (i) {
        r = "";
      }
      if (r) return r;
      var l = t || STR[e];
      if (!l) return typeof I18n < "u" ? I18n.get(e, a) : e;
      for (var o = 0; a && o < a.length; o++) l = l.split("$" + (o + 1)).join(String(a[o]));
      return l;
    }
    function cssEsc(e) {
      return window.CSS && CSS.escape ? CSS.escape(e) : String(e).replace(/["\\]/g, "\\$&");
    }
    function hlApi() {
      return typeof SidebarHighlights < "u" ? SidebarHighlights : null;
    }
    /* COMMON contract: any page that changes read, favorite, tag or highlight
       state writes this key so every open panel refreshes. */
    function touchArticles() {
      try {
        chrome.storage.local.set({ articlesUpdatedAt: Date.now() }, function () {
          chrome.runtime && chrome.runtime.lastError;
        });
      } catch (e) {}
    }
    function persistSetting(e) {
      MessageHelper.send("SAVE_SETTINGS", e).catch(function () {});
    }
    var TABS = ["unread", "all", "favorites", "highlights"],
      SORT_KEYS = ["savedAt", "title", "estimatedReadTime", "domain"],
      QUICK_MAX_MIN = 5,
      LONG_MIN_MIN = 15,
      LENGTH_SCAN_PAGE = 200,
      LENGTH_MIN_FILL = 25,
      LENGTH_MAX_LOOPS = 50,
      SUMMARY_LIMIT = 1e5,
      reqSeq = 0;
    function lengthOk(e) {
      if (!n.lengthFilter) return !0;
      var t = Number(e && e.estimatedReadTime) || 0;
      return n.lengthFilter === "quick" ? t > 0 && t <= QUICK_MAX_MIN : t >= LONG_MIN_MIN;
    }
    /* GET_ARTICLES_BY_TAG returns the tag's whole set with no other filter, so
       tab, search, length and sort are applied here (B15). */
    function tagRowOk(e) {
      if (n.activeTab === "unread" && e.isRead) return !1;
      if (n.activeTab === "favorites" && !e.isFavorite) return !1;
      if (n.searchTerm) {
        var t = ((e.title || "") + " " + (e.domain || "") + " " + (e.excerpt || "")).toLowerCase();
        if (t.indexOf(n.searchTerm.toLowerCase()) === -1) return !1;
      }
      return lengthOk(e);
    }
    function sortRows(e) {
      var t = n.sortBy,
        a = n.sortOrder === "asc" ? 1 : -1;
      return e.sort(function (r, i) {
        var l = r[t],
          o = i[t];
        return t === "title" || t === "domain"
          ? ((l = String(l || "").toLowerCase()), (o = String(o || "").toLowerCase()), l < o ? -a : l > o ? a : 0)
          : ((Number(l) || 0) - (Number(o) || 0)) * a;
      });
    }
    /* mode "reset": first page, scroll to top. "more": next page. "refresh":
       reload as many rows as are loaded and keep the scroll position. A
       sequence number drops responses that a newer request has superseded. */
    function fetchList(e) {
      if (n.activeTab === "highlights") {
        n.loading = !1;
        return;
      }
      if (!(e === "more" && (n.loading || !n.hasMore))) {
        var t = ++reqSeq;
        n.loading = !0;
        var a = e === "refresh" && s ? s.scrollTop : e === "reset" ? 0 : null;
        e === "reset" && n.articles.length === 0 && !n.restoreCount && pe();
        var r = e === "more" ? n.rawCount : 0,
          i = n.pageSize;
        e === "refresh" && (i = Math.max(n.pageSize, n.rawCount)),
          e === "reset" &&
            n.restoreCount &&
            ((i = Math.max(i, n.restoreCount)), (a = n.restoreScroll || 0), (n.restoreCount = 0)),
          n.lengthFilter && (i = Math.max(i, LENGTH_SCAN_PAGE));
        var l = { sortBy: n.sortBy, sortOrder: n.sortOrder, fields: ROW_FIELDS };
        n.activeTab === "unread" && (l.isRead = !1), n.activeTab === "favorites" && (l.isFavorite = !0);
        var o = function (u) {
          t === reqSeq &&
            ((n.loading = !1),
            console.warn("[Sidebar] Failed to load articles:", u),
            typeof Announcer < "u" && Announcer.error(I18n.get("errorFailedToLoadArticles")));
        };
        if (n.activeTag) {
          MessageHelper.send("GET_ARTICLES_BY_TAG", { tagId: n.activeTag, fields: ROW_FIELDS })
            .then(function (u) {
              if (t === reqSeq && ((n.loading = !1), u && u.success)) {
                var c = Ot2(u.data || []);
                (n.rawCount = c.length),
                  (n.hasMore = !1),
                  (n.summary = null),
                  (n.articles = sortRows(c.filter(tagRowOk))),
                  le(a);
              }
            })
            .catch(o);
          return;
        }
        var c = function () {
          var u = [],
            d = 0;
          (function f(h) {
            var T = Object.assign({}, l, { offset: h, limit: i });
            MessageHelper.send("GET_ARTICLES", T)
              .then(function (de) {
                if (t === reqSeq) {
                  if (!de || !de.success) {
                    n.loading = !1;
                    return;
                  }
                  var Le = Ot2(de.data || []),
                    Te = Le.length === i,
                    xe = h + Le.length;
                  if (
                    ((u = u.concat(n.lengthFilter ? Le.filter(lengthOk) : Le)),
                    n.lengthFilter && Te && u.length < LENGTH_MIN_FILL && ++d < LENGTH_MAX_LOOPS)
                  ) {
                    f(xe);
                    return;
                  }
                  (n.loading = !1),
                    (n.rawCount = xe),
                    (n.hasMore = Te),
                    (n.articles = e === "more" ? n.articles.concat(u) : u),
                    e !== "more" && (n.summary = null),
                    le(e === "more" ? null : a),
                    e !== "more" && updateSummary(l, t);
                }
              })
              .catch(o);
          })(r);
        };
        n.searchTerm
          ? Lt(n.searchTerm, function (u) {
              t === reqSeq && (u ? (l.fullTextSearch = n.searchTerm) : (l.search = n.searchTerm), c());
            })
          : c();
      }
    }
    /* Footer total for the whole filtered list, not just the loaded pages.
       The projection keeps it to two small fields per article. */
    function updateSummary(e, t) {
      if (!n.hasMore) return;
      var a = Object.assign({}, e, { offset: 0, limit: SUMMARY_LIMIT, fields: ["id", "estimatedReadTime"] });
      MessageHelper.send("GET_ARTICLES", a, 2e4).then(function (r) {
        if (t === reqSeq && r && r.success && Array.isArray(r.data)) {
          var i = n.lengthFilter ? r.data.filter(lengthOk) : r.data,
            l = 0;
          i.forEach(function (o) {
            l += Number(o.estimatedReadTime) || 0;
          }),
            (n.summary = { count: i.length, minutes: l }),
            renderFooter();
        }
      });
    }
    function fmtDuration(e) {
      var t = Math.floor(e / 60),
        a = e % 60;
      return t && a ? tx("panelDurHM", null, [t, a]) : t ? tx("panelDurH", null, [t]) : tx("panelDurM", null, [e]);
    }
    function renderFooter() {
      if (q) {
        if (n.activeTab === "highlights") {
          q.textContent = hlApi() ? hlApi().summary() : "";
          return;
        }
        var e = 0,
          t = 0;
        if (n.summary) (e = n.summary.count), (t = n.summary.minutes);
        else {
          e = n.articles.length;
          for (var a = 0; a < n.articles.length; a++) t += Number(n.articles[a].estimatedReadTime) || 0;
        }
        if (!e) {
          q.textContent = "";
          return;
        }
        var r = String(e),
          i = e !== 1 ? I18n.get("statusArticleCountPlural", [r]) : I18n.get("statusArticleCount", [r]);
        q.textContent = t > 0 ? tx("panelListSummary", null, [i, fmtDuration(t)]) : i;
      }
    }
    /* Right after the panel navigates back from the reader, the first layout
       can briefly report a shorter list and clamp scrollTop. Re-apply for a
       few frames until it sticks; any user scroll or key press wins. */
    var scrollFix = null,
      lastAnnouncedCount = -1;
    function restoreScroll(e) {
      if (s) {
        var t = 0;
        clearTimeout(scrollFix),
          (function a() {
            (s.scrollTop = e), w && w._render && w._render(),
              Math.abs(s.scrollTop - e) > 1 && ++t < 25 && (scrollFix = setTimeout(a, 20));
          })();
      }
    }
    /* A refresh repaints every row node. Keep keyboard focus (and the j/k
       position) on the same article instead of dropping it to the page. */
    function captureFocus() {
      var e = document.activeElement,
        t = e && s && s.contains(e) && e.closest ? e.closest(".article-card") : null;
      return {
        id: t ? t.getAttribute("data-id") : null,
        onCard: !!t && t === e,
        kb: !!t && t.classList.contains("keyboard-focused"),
        idx: n.focusedIndex >= 0 && n.articles[n.focusedIndex] ? n.articles[n.focusedIndex].id : null,
      };
    }
    function restoreFocus(e) {
      if (e && (e.id || e.idx)) {
        if (e.idx)
          for (var t = 0; t < n.articles.length; t++)
            if (n.articles[t].id === e.idx) {
              n.focusedIndex = t;
              break;
            }
        if (e.id && (!document.activeElement || document.activeElement === document.body)) {
          var a = s.querySelector('.article-card[data-id="' + cssEsc(e.id) + '"]');
          a && (e.kb && a.classList.add("keyboard-focused"), a.focus({ preventScroll: !0 }));
        }
      }
    }
    function cancelScrollFix() {
      clearTimeout(scrollFix), (scrollFix = null);
    }
    /* ----- Session state: survives navigating the panel to the reader and back. */
    var SESSION_KEY = "rlPanelState";
    function saveSession() {
      try {
        var e = hlApi();
        sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            tab: n.activeTab,
            tag: n.activeTag,
            search: n.searchTerm,
            length: n.lengthFilter,
            sortBy: n.sortBy,
            sortOrder: n.sortOrder,
            scroll: n.activeTab !== "highlights" && s ? s.scrollTop : 0,
            hlScroll: e && n.activeTab === "highlights" ? e.getScroll() : 0,
            count: n.rawCount,
            fts: Object.keys(ftsSession).slice(0, 64),
            at: Date.now(),
          }),
        );
      } catch (t) {}
    }
    function readSession() {
      try {
        var e = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
        return e && typeof e == "object" ? e : null;
      } catch (t) {
        return null;
      }
    }
    var searchPlaceholder = "",
      searchAria = "",
      viewMenu = null,
      viewBtn = null,
      saveBtn = null,
      statusEl = null,
      statusTimer = null,
      hlView = null,
      lengthBtns = [];
    function panelInit() {
      initPanelUi();
      var e = readSession();
      e &&
        Array.isArray(e.fts) &&
        e.fts.forEach(function (t) {
          typeof t == "string" && ftsMarkPaid(t);
        }),
        MessageHelper.send("GET_SETTINGS").then(function (t) {
          var a = (t && t.success && t.data) || {};
          n.openIn = a.openArticlesIn === "panel" ? "panel" : "tab";
          var r = a.sidebarTab,
            i = a.sidebarSortBy,
            l = a.sidebarSortOrder,
            o = null;
          e &&
            ((r = e.tab),
            (i = e.sortBy),
            (l = e.sortOrder),
            (n.activeTag = e.tag || null),
            (n.searchTerm = typeof e.search == "string" ? e.search : ""),
            (n.lengthFilter = e.length === "quick" || e.length === "long" ? e.length : null),
            (n.restoreCount = Math.min(Number(e.count) || 0, MAX_ARTICLES)),
            (n.restoreScroll = Number(e.scroll) || 0),
            (o = Number(e.hlScroll) || 0)),
            TABS.indexOf(r) >= 0 && (n.activeTab = r),
            SORT_KEYS.indexOf(i) >= 0 && (n.sortBy = i),
            (l === "asc" || l === "desc") && (n.sortOrder = l),
            C &&
              ((C.value = n.sortBy + "-" + n.sortOrder),
              C.value !== n.sortBy + "-" + n.sortOrder &&
                ((C.value = "savedAt-desc"), (n.sortBy = "savedAt"), (n.sortOrder = "desc"))),
            m && n.searchTerm && ((m.value = n.searchTerm), ge()),
            syncTabs(),
            syncLengthChips(),
            syncOpenIn(),
            oe(),
            n.activeTab === "highlights" ? enterHighlights(o) : fetchList("reset");
        });
    }
    function syncTabs() {
      if (k)
        for (var e = 0; e < k.length; e++) {
          var t = k[e].getAttribute("data-tab") === n.activeTab;
          k[e].classList.toggle("active", t), k[e].setAttribute("aria-selected", String(t));
        }
    }
    function syncLengthChips() {
      lengthBtns.forEach(function (e) {
        var t = e.getAttribute("data-length") === n.lengthFilter;
        e.classList.toggle("active", t), e.setAttribute("aria-pressed", String(t));
      });
    }
    function syncOpenIn() {
      if (viewMenu)
        for (var e = viewMenu.querySelectorAll('input[name="open-in"]'), t = 0; t < e.length; t++)
          e[t].checked = e[t].value === n.openIn;
    }
    function setLengthFilter(e) {
      (n.lengthFilter = e === "quick" || e === "long" ? e : null),
        syncLengthChips(),
        (n.offset = 0),
        s && (s.scrollTop = 0),
        fetchList("reset");
      var t = n.lengthFilter === "quick" ? "panelLengthQuick" : n.lengthFilter === "long" ? "panelLengthLong" : "panelLengthAll";
      typeof Announcer < "u" && Announcer.status(tx(t));
    }
    function switchTab(e) {
      if (TABS.indexOf(e) !== -1) {
        var t = n.activeTab;
        n.selectionMode && V(),
          z(),
          (n.activeTab = e),
          (n.activeTag = null),
          (n.offset = 0),
          syncTabs(),
          persistSetting({ sidebarTab: e }),
          e === "highlights"
            ? enterHighlights()
            : (t === "highlights" && leaveHighlights(), s && (s.scrollTop = 0), fetchList("reset")),
          oe();
        var a = document.querySelector('.sidebar-tab[data-tab="' + e + '"]');
        typeof Announcer < "u" &&
          a &&
          Announcer.status(I18n.get("announcerTabSelected", [a.textContent.trim()]));
      }
    }
    function enterHighlights(e) {
      document.body.classList.add("hl-mode"),
        reqSeq++,
        (n.loading = !1),
        s && (s.style.display = "none"),
        b && (b.style.display = "none"),
        m &&
          ((m.placeholder = tx("panelHlSearchPlaceholder")),
          m.setAttribute("aria-label", tx("panelHlSearchLabel"))),
        se(0);
      var t = hlApi();
      t && (t.setQuery(n.searchTerm), t.show(typeof e == "number" ? e : void 0)), renderFooter();
    }
    function leaveHighlights() {
      document.body.classList.remove("hl-mode");
      var e = hlApi();
      e && e.hide(),
        m && ((m.placeholder = searchPlaceholder), m.setAttribute("aria-label", searchAria)),
        s && (s.style.display = "block");
    }
    /* Opens the reader for one article. "panel" swaps this page for the
       reader inside the side panel (its back button returns here, and the
       list state comes back from sessionStorage); "tab" opens a new tab. */
    function openArticle(e, t) {
      if (e) {
        t = t || {};
        var a = t.where || n.openIn,
          r =
            "src/pages/reader.html?id=" +
            encodeURIComponent(e) +
            (a === "panel" ? "&panel=1" : "") +
            (t.hl ? "&hl=" + encodeURIComponent(t.hl) : "");
        typeof Analytics < "u" && Analytics.trackFeature("article_open", { where: a }),
          a === "panel"
            ? (saveSession(), window.location.assign(chrome.runtime.getURL(r)))
            : chrome.tabs.create({ url: chrome.runtime.getURL(r) }, function () {
                chrome.runtime && chrome.runtime.lastError;
              });
      }
    }
    function focusedArticleId() {
      var e = document.activeElement,
        t = e && e.closest ? e.closest(".article-card") : null;
      return t && s && s.contains(t)
        ? t.getAttribute("data-id")
        : n.focusedIndex >= 0 && n.focusedIndex < n.articles.length
          ? n.articles[n.focusedIndex].id
          : null;
    }
    /* ----- Delete with undo (B16). The full record and its tags are read
       before anything is deleted; an article that can't be read back first is
       not deleted at all. Undo saves the same record (same id, so highlights
       and reading state come back) and re-applies the tags. */
    function deleteWithUndo(e, t) {
      if (((e = (e || []).filter(Boolean)), !!e.length)) {
        var a = t && t.closest ? t.closest(".swipe-container") : null;
        t &&
          (t.classList.add("swipe-deleting"),
          setTimeout(function () {
            a && ((a.style.maxHeight = a.offsetHeight + "px"), a.offsetHeight, a.classList.add("collapsing"));
          }, 300));
        var r = new Promise(function (l) {
            setTimeout(l, t ? 600 : 0);
          }),
          i = Promise.all(
            e.map(function (l) {
              return Promise.all([
                MessageHelper.send("GET_ARTICLE", { id: l }),
                MessageHelper.send("GET_ARTICLE_TAGS", { articleId: l }),
              ]).then(function (o) {
                return {
                  id: l,
                  rec: o[0] && o[0].success ? o[0].data : null,
                  tags: o[1] && o[1].success && Array.isArray(o[1].data) ? o[1].data : [],
                };
              });
            }),
          );
        Promise.all([i, r]).then(function (l) {
          var o = l[0].filter(function (u) {
            return u.rec && u.rec.url;
          });
          if (!o.length) {
            fetchList("refresh"), _(tx("panelDeleteFailed"));
            return;
          }
          return Promise.all(
            o.map(function (u) {
              return MessageHelper.send("DELETE_ARTICLE", { id: u.id });
            }),
          ).then(function () {
            var u = {},
              c = 0;
            o.forEach(function (h) {
              (u[h.id] = !0), (c += Number(h.rec.estimatedReadTime) || 0);
            });
            var d = n.articles.length;
            (n.articles = n.articles.filter(function (h) {
              return !u[h.id];
            })),
              (n.rawCount = Math.max(0, n.rawCount - (d - n.articles.length))),
              n.summary &&
                ((n.summary.count = Math.max(0, n.summary.count - o.length)),
                (n.summary.minutes = Math.max(0, n.summary.minutes - c))),
              le(s ? s.scrollTop : 0),
              touchArticles();
            var f =
              o.length === 1
                ? I18n.get("toastArticleDeleted")
                : I18n.get("toastArticlesDeleted", [String(o.length)]);
            _(f, tx("panelUndo"), function () {
              restoreDeleted(o);
            });
          });
        });
      }
    }
    function restoreDeleted(e) {
      var t = 0;
      e.reduce(function (a, r) {
        return a.then(function () {
          var i = Object.assign({}, r.rec, { url: r.rec.originalUrl || r.rec.url });
          return MessageHelper.send("SAVE_ARTICLE", i, 3e4).then(function (l) {
            var o = l && l.success && l.data && l.data.article ? l.data.article.id : null;
            if (!o) {
              t++;
              return;
            }
            return Promise.all(
              r.tags.map(function (u) {
                return MessageHelper.send("TAG_ARTICLE", { articleId: o, tagId: u.id });
              }),
            );
          });
        });
      }, Promise.resolve()).then(function () {
        touchArticles(),
          (tagsDirty = !0),
          scheduleRefresh(0),
          _(t ? tx("panelRestoreFailed") : e.length === 1 ? tx("panelRestoredOne") : tx("panelRestoredMany", null, [e.length]));
      });
    }
    /* ----- Context menu */
    var ctxTags = [];
    function placeCtx(e, t) {
      var a = A.getBoundingClientRect(),
        r = window.innerWidth,
        i = window.innerHeight;
      e + a.width > r && (e = r - a.width - 4),
        t + a.height > i && (t = i - a.height - 4),
        (A.style.left = Math.max(4, e) + "px"),
        (A.style.top = Math.max(4, t) + "px");
    }
    function openCtxMenu(e, t, a, r) {
      var i = e.getAttribute("data-id"),
        l = Je(i);
      H(), closeViewMenu(!1), (n.contextArticleId = i), (ctxReturnFocus = e), (ctxTags = []);
      var o = A.querySelector(".ctx-read-label");
      o && (o.textContent = l && l.isRead ? tx("panelMarkUnread") : tx("panelMarkRead"));
      var u = A.querySelector('[data-ctx-action="remove-tag"]');
      u && (u.hidden = !0), (A.style.display = "block"), placeCtx(t, a);
      var c = A.querySelector("[data-ctx-action]");
      r && c && c.focus(),
        MessageHelper.send("GET_ARTICLE_TAGS", { articleId: i }).then(function (d) {
          if (!(n.contextArticleId !== i || !u || !d || !d.success || !Array.isArray(d.data) || !d.data.length)) {
            (ctxTags = d.data), (u.hidden = !1);
            var f = u.querySelector(".ctx-untag-label");
            f &&
              (f.textContent =
                ctxTags.length === 1 ? tx("panelRemoveTagNamed", null, [ctxTags[0].name]) : tx("panelRemoveTagMany")),
              placeCtx(t, a);
          }
        });
    }
    function runCtxAction(e, t, a) {
      var r = n.contextArticleId,
        i = ctxTags;
      if ((z(e !== "add-tag" && e !== "remove-tag"), !!r)) {
        var l = Je(r);
        if (e === "read-panel" || e === "open-reader") openArticle(r, { where: "panel" });
        else if (e === "open-tab") openArticle(r, { where: "tab" });
        else if (e === "open-original") {
          if (l && l.url) {
            var o = typeof Sanitize < "u" ? Sanitize.sanitizeUrl(l.url) : l.url;
            o && chrome.tabs.create({ url: o });
          }
        } else if (e === "copy-url") l && l.url && (Qe(l.url), _(I18n.get("toastUrlCopied")));
        else if (e === "toggle-read") {
          var u = !!(l && l.isRead);
          (u
            ? MessageHelper.send("UPDATE_ARTICLE", { id: r, updates: { isRead: !1, readAt: null } })
            : MessageHelper.send("MARK_AS_READ", { id: r })
          ).then(function () {
            touchArticles(), scheduleRefresh(0), _(tx(u ? "panelMarkedUnread" : "panelMarkedRead"));
          });
        } else if (e === "toggle-favorite")
          MessageHelper.send("TOGGLE_FAVORITE", { id: r }).then(function () {
            touchArticles(), scheduleRefresh(0);
          });
        else if (e === "add-tag") et(t, a, r);
        else if (e === "remove-tag") i.length === 1 ? untag(r, i[0]) : i.length > 1 && tagChooser(t, a, r, i);
        else if (e === "delete") {
          var c = s.querySelector('.article-card[data-id="' + cssEsc(r) + '"]');
          deleteWithUndo([r], c);
        }
      }
    }
    function untag(e, t) {
      MessageHelper.send("UNTAG_ARTICLE", { articleId: e, tagId: t.id }).then(function (a) {
        if (!a || !a.success) {
          _(tx("panelUntagFailed"));
          return;
        }
        touchArticles(),
          scheduleRefresh(0),
          _(tx("panelTagRemoved", null, [t.name]), tx("panelUndo"), function () {
            MessageHelper.send("TAG_ARTICLE", { articleId: e, tagId: t.id }).then(function () {
              touchArticles(), scheduleRefresh(0), _(tx("panelTagRestored"));
            });
          });
      });
    }
    function tagChooser(e, t, a, r) {
      H();
      var i = document.createElement("div");
      (i.className = "tag-input-prompt tag-chooser"),
        i.setAttribute("role", "dialog"),
        i.setAttribute("aria-label", tx("panelRemoveWhichTag")),
        (i.style.left = e + "px"),
        (i.style.top = t + "px");
      var l = document.createElement("div");
      (l.className = "tag-chooser-label"), (l.textContent = tx("panelRemoveWhichTag")), i.appendChild(l);
      var o = document.createElement("div");
      (o.className = "tag-chooser-list"),
        r.forEach(function (c) {
          var d = document.createElement("button");
          (d.type = "button"),
            (d.className = "chip"),
            (d.textContent = c.name),
            d.addEventListener("click", function () {
              H(), untag(a, c);
            }),
            o.appendChild(d);
        }),
        i.appendChild(o),
        i.addEventListener("keydown", function (c) {
          c.key === "Escape" && (c.preventDefault(), c.stopPropagation(), H());
        }),
        document.body.appendChild(i),
        (L = i);
      var u = i.getBoundingClientRect();
      u.right > window.innerWidth && (i.style.left = Math.max(4, window.innerWidth - u.width - 4) + "px"),
        u.bottom > window.innerHeight && (i.style.top = Math.max(4, window.innerHeight - u.height - 4) + "px"),
        o.firstChild && o.firstChild.focus(),
        setTimeout(function () {
          document.addEventListener("click", be);
        }, 100);
    }
    /* ----- Rediscover: a random unread article saved more than a week ago. */
    var lastRediscover = null;
    function rediscover() {
      MessageHelper.send("GET_ARTICLES", {
        isRead: !1,
        offset: 0,
        limit: 2e4,
        sortBy: "savedAt",
        sortOrder: "asc",
        fields: ["id", "savedAt", "title"],
      }).then(function (e) {
        var t = e && e.success && Array.isArray(e.data) ? e.data : [];
        if (!t.length) {
          _(tx("panelRediscoverNone"));
          return;
        }
        var a = Date.now() - 7 * 864e5,
          r = t.filter(function (o) {
            return (o.savedAt || 0) < a;
          }),
          i = r.length ? r : t;
        i.length > 1 &&
          lastRediscover &&
          (i = i.filter(function (o) {
            return o.id !== lastRediscover;
          }));
        var l = i[Math.floor(Math.random() * i.length)];
        (lastRediscover = l.id),
          n.openIn !== "panel" && _(tx("panelRediscoverOpened", null, [l.title || I18n.get("rlUntitledPage")])),
          openArticle(l.id);
      });
    }
    /* ----- Save this page / Save all tabs, with inline feedback. */
    var savingPage = !1;
    function showStatus(e, t, a, r, s) {
      if (statusEl) {
        clearTimeout(statusTimer),
          (statusEl.className = "save-status save-status-" + e),
          (statusEl.hidden = !1),
          (document.getElementById("save-status-text").textContent = t);
        var i = document.getElementById("save-status-note");
        (i.textContent = a || ""), (i.hidden = !a);
        var l = document.getElementById("save-status-action");
        r ? ((l.textContent = r.label), (l.hidden = !1), (l.onclick = r.run)) : ((l.hidden = !0), (l.onclick = null));
        var o = document.getElementById("save-status-action2");
        o && (s ? ((o.textContent = s.label), (o.hidden = !1), (o.onclick = s.run)) : ((o.hidden = !0), (o.onclick = null))),
          (statusEl.dataset.ttl = e === "busy" || e === "error" ? "0" : a ? "20000" : "6000"),
          armStatus();
      }
    }
    function armStatus() {
      clearTimeout(statusTimer);
      var e = Number(statusEl.dataset.ttl) || 0;
      e && (statusTimer = setTimeout(hideStatus, e));
    }
    function hideStatus() {
      clearTimeout(statusTimer),
        statusEl && (statusEl.contains(document.activeElement) && saveBtn && saveBtn.focus(), (statusEl.hidden = !0));
    }
    function readAction(e) {
      return e
        ? {
            label: tx("panelReadNow"),
            run: function () {
              hideStatus(), openArticle(e);
            },
          }
        : null;
    }
    function onSavePage() {
      if (!(savingPage || typeof SidebarSave > "u")) {
        (savingPage = !0),
          saveBtn && (saveBtn.setAttribute("aria-busy", "true"), saveBtn.classList.add("is-busy")),
          showStatus("busy", tx("panelSaving"));
        SidebarSave.saveCurrentTab().then(function (e) {
          (savingPage = !1),
            saveBtn && (saveBtn.removeAttribute("aria-busy"), saveBtn.classList.remove("is-busy"));
          var t = (e.tab && e.tab.title) || "",
            a = e.article && e.article.id,
            r = e.status;
          r === "saved"
            ? showStatus("success", tx("panelSavedFull"), t, readAction(a))
            : r === "text"
              ? showStatus("success", tx("panelSavedText"), tx("panelSavedTextNote"), readAction(a))
              : r === "filled"
                ? showStatus("success", tx("panelSavedFilled"), t, readAction(a))
                : r === "link"
                  ? showStatus("info", tx("panelSavedLink"), linkHelp(e).note, linkHelp(e).action)
                  : r === "duplicate"
                    ? showStatus("info", tx("panelAlreadySaved"), t, readAction(a))
                    : r === "duplicate-link"
                      ? showStatus("info", tx("panelAlreadySavedLink"), linkHelp(e).note, linkHelp(e).action)
                      : r === "restricted"
                        ? showStatus("warn", tx("panelCantSave"), tx("panelCantSaveNote"))
                        : showStatus("error", tx("panelSaveFailed"), tx("panelSaveFailedNote"), {
                            label: tx("panelTryAgain"),
                            run: onSavePage,
                          }),
            (r === "saved" || r === "text" || r === "link" || r === "filled") && scheduleRefresh(0);
        });
      }
    }
    /* fetch lane hook: link-only help ("Allow reading pages") from sidebar-save.js */
    function linkHelp(e, retry) {
      var h = SidebarSave.linkHelp ? SidebarSave.linkHelp(e, retry || onSavePage) : null;
      return h || { note: tx("panelLinkNote"), action: null };
    }
    function onSaveAll() {
      typeof SidebarSave > "u" ||
        (closeViewMenu(!1),
        showStatus("busy", tx("panelSavingTabs")),
        /* fetch lane hook: per-tab progress */
        SidebarSave.saveAllTabs(function (d, n) {
          n > 1 && SidebarSave.progressText && showStatus("busy", tx("panelSavingTabs"), SidebarSave.progressText(d, n));
        }).then(function (e) {
          if (!e.total) {
            showStatus("warn", tx("panelNoTabs"));
            return;
          }
          var t = e.saved
              ? e.saved === 1
                ? tx("panelSavedTabsOne")
                : tx("panelSavedTabsMany", null, [e.saved])
              : tx("panelSavedTabsNone"),
            a = [],
            fh = null;
          e.duplicate && a.push(e.duplicate === 1 ? tx("panelTabsDupOne") : tx("panelTabsDupMany", null, [e.duplicate])),
            e.failed && a.push(e.failed === 1 ? tx("panelTabsFailOne") : tx("panelTabsFailMany", null, [e.failed])),
            /* fetch lane hook: "Allow reading pages" replaces the click-the-icon note */
            (fh = SidebarSave.tabsLinkHelp ? SidebarSave.tabsLinkHelp(e, onSaveAll) : null),
            e.links && a.push(fh ? fh.note : tx(e.full ? "panelTabsLinkNoteOther" : "panelTabsLinkNoteAll"));
          var r = e.savedIds.slice();

          showStatus(
            e.failed && !e.saved ? "error" : "success",
            t,
            a.join(" "),
            r.length
              ? {
                  label: tx("panelUndo"),
                  run: function () {
                    SidebarSave.deleteSaved(r).then(function () {
                      touchArticles(),
                        scheduleRefresh(0),
                        showStatus(
                          "info",
                          r.length === 1 ? tx("panelTabsUndoneOne") : tx("panelTabsUndoneMany", null, [r.length]),
                        );
                    });
                  },
                }
              : null,
            /* "Allow reading pages" sits under the note so Undo stays available */
            fh && fh.action ? fh.action : null,
          ),
            scheduleRefresh(0);
        }));
    }
    /* ----- View options menu */
    function openViewMenu() {
      if (viewMenu && viewBtn) {
        z(), H(), (viewMenu.hidden = !1), viewBtn.setAttribute("aria-expanded", "true");
        var e = viewBtn.getBoundingClientRect();
        var a = viewMenu.offsetWidth,
          r = Math.min(e.right - a, window.innerWidth - a - 8);
        (viewMenu.style.top = Math.round(e.bottom + 4) + "px"), (viewMenu.style.left = Math.max(8, Math.round(r)) + "px");
        var t = viewMenu.querySelector('input[name="open-in"]:checked') || viewMenu.querySelector("input, button");
        t && t.focus();
      }
    }
    function closeViewMenu(e) {
      !viewMenu ||
        viewMenu.hidden ||
        ((viewMenu.hidden = !0), viewBtn.setAttribute("aria-expanded", "false"), e && viewBtn.focus());
    }
    function initPanelUi() {
      (viewMenu = document.getElementById("view-menu")),
        (viewBtn = document.getElementById("btn-view-options")),
        (saveBtn = document.getElementById("btn-save-page")),
        (statusEl = document.getElementById("save-status")),
        (hlView = document.getElementById("highlights-view")),
        (lengthBtns = Array.prototype.slice.call(document.querySelectorAll(".chip-length"))),
        m && ((searchPlaceholder = m.placeholder), (searchAria = m.getAttribute("aria-label") || ""));
      var e = hlApi();
      e &&
        hlView &&
        e.init({
          root: hlView,
          toast: _,
          openArticle: function (c, d) {
            openArticle(c, { hl: d });
          },
          openUrl: function (c) {
            var d = typeof Sanitize < "u" ? Sanitize.sanitizeUrl(c) : c;
            d && chrome.tabs.create({ url: d });
          },
          copy: Qe,
          onSummary: function (c) {
            n.activeTab === "highlights" && q && (q.textContent = c);
          },
          onClearSearch: function () {
            me();
          },
        }),
        saveBtn && saveBtn.addEventListener("click", onSavePage),
        viewBtn &&
          viewBtn.addEventListener("click", function (c) {
            c.stopPropagation(), viewMenu.hidden ? openViewMenu() : closeViewMenu(!0);
          }),
        viewMenu &&
          (viewMenu.addEventListener("keydown", function (c) {
            c.key === "Escape" && (c.preventDefault(), c.stopPropagation(), closeViewMenu(!0));
          }),
          viewMenu.addEventListener("focusout", function (c) {
            c.relatedTarget && !viewMenu.contains(c.relatedTarget) && c.relatedTarget !== viewBtn && closeViewMenu(!1);
          }),
          viewMenu.addEventListener("change", function (c) {
            var d = c.target;
            d &&
              d.name === "open-in" &&
              ((n.openIn = d.value === "panel" ? "panel" : "tab"),
              persistSetting({ openArticlesIn: n.openIn }),
              typeof Announcer < "u" &&
                Announcer.status(tx(n.openIn === "panel" ? "panelOpenInChangedPanel" : "panelOpenInChangedTab")));
          }),
          document.addEventListener("click", function (c) {
            !viewMenu.hidden && !viewMenu.contains(c.target) && c.target !== viewBtn && closeViewMenu(!1);
          }));
      var t = document.getElementById("btn-save-all-tabs");
      t && t.addEventListener("click", onSaveAll);
      var a = document.getElementById("btn-export-highlights");
      a &&
        a.addEventListener("click", function () {
          closeViewMenu(!1), hlApi() && hlApi().exportAll();
        }),
        g &&
          g.addEventListener("click", function () {
            closeViewMenu(!1);
          });
      var r = document.getElementById("save-status-close");
      r && r.addEventListener("click", hideStatus),
        statusEl &&
          (statusEl.addEventListener("mouseenter", function () {
            clearTimeout(statusTimer);
          }),
          statusEl.addEventListener("mouseleave", armStatus),
          statusEl.addEventListener("focusin", function () {
            clearTimeout(statusTimer);
          }),
          statusEl.addEventListener("focusout", function (c) {
            statusEl.contains(c.relatedTarget) || armStatus();
          })),
        lengthBtns.forEach(function (c) {
          c.addEventListener("click", function () {
            var d = c.getAttribute("data-length");
            setLengthFilter(n.lengthFilter === d ? null : d);
          });
        });
      s &&
        ["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (c) {
          s.addEventListener(c, cancelScrollFix, { passive: !0 });
        });
      var i = document.getElementById("btn-rediscover");
      i && i.addEventListener("click", rediscover);
      var l = P && P.querySelector(".toast-action");
      l && l.addEventListener("click", runToastAction),
        P &&
          (P.addEventListener("mouseenter", function () {
            clearTimeout(toastTimer);
          }),
          P.addEventListener("mouseleave", function () {
            P.classList.contains("visible") && (clearTimeout(toastTimer), (toastTimer = setTimeout(hideToast, 4e3)));
          }),
          P.addEventListener("focusin", function () {
            clearTimeout(toastTimer);
          }));
      var o = document.querySelector(".sidebar-tabs");
      o &&
        o.addEventListener("keydown", function (c) {
          if (c.key === "ArrowRight" || c.key === "ArrowLeft") {
            var d = TABS.indexOf(n.activeTab),
              f = (d + (c.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
            c.preventDefault(), switchTab(TABS[f]);
            var h = o.querySelector('[data-tab="' + TABS[f] + '"]');
            h && h.focus();
          }
        });
    }
    function Zt(e) {
      e.openArticlesIn &&
        ((n.openIn = e.openArticlesIn.newValue === "panel" ? "panel" : "tab"), syncOpenIn());
      for (var t = !1, a = 0, r = 0; r < RELOAD_KEYS.length && a < MAX_RELOAD_KEYS; r++, a++)
        if (e[RELOAD_KEYS[r]]) {
          t = !0;
          break;
        }
      t &&
        ((e.licenseDataPlain || e.licenseData || e.trialData) && Ie(), scheduleRefresh(), (tagsDirty = !0));
    }
    var tagsDirty = !1;
    /* One debounced refresh for every source (storage signal, own action,
       visibility). It reloads as many rows as are already loaded and puts the
       scroll position back, so a background change never throws the reader
       back to the top. */
    function scheduleRefresh(e) {
      Re_reloadTimer && clearTimeout(Re_reloadTimer),
        (Re_reloadTimer = setTimeout(
          function () {
            if (((Re_reloadTimer = null), n.selectionMode)) return;
            tagsDirty && ((tagsDirty = !1), R()),
              n.activeTab !== "highlights" && fetchList("refresh");
          },
          typeof e == "number" ? e : RELOAD_DEBOUNCE_MS,
        ));
    }
    chrome.storage.onChanged.addListener(function (e, t) {
      t === "local" && s && Zt(e);
    }),
      document.addEventListener("DOMContentLoaded", function () {
        fe();
      });
  })();
})();
