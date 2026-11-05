(() => {
  (function () {
    "use strict";
    typeof ErrorHandler < "u" && ErrorHandler.initGlobalHandler("Reader"),
      typeof Analytics < "u" && Analytics.init("reader");
    var i = null,
      a = {
        readerFontSize: 18,
        readerTheme: "auto",
        readerWidth: 680,
        readerFontFamily: "serif",
        readerLineHeight: 1.7,
      },
      rawSettings = {},
      F = 0,
      w = !1,
      z = null,
      M = null,
      $ = !1,
      Y = 230,
      k = ["auto", "light", "sepia", "dark"],
      FONTS = ["serif", "sans", "readable", "mono", "system"],
      LINE_HEIGHTS = [1.4, 1.6, 1.8, 2],
      isPanel = new URLSearchParams(window.location.search).get("panel") === "1",
      darkQuery = typeof window.matchMedia == "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null,
      escHandlers = [],
      keyHandlers = {},
      D = [560, 680, 800],
      P = null,
      I = null,
      l = null,
      B = null,
      H = null,
      b = null,
      W = null,
      S = null,
      C = null,
      T = null,
      p = null,
      _ = null,
      s = null,
      v = null;
    isPanel && document.documentElement.classList.add("rl-panel");
    /* The small surface reader-highlights.js, reader-tts.js and reader-end.js
       build on. They load after this file and listen for "rl:rendered". */
    window.ReaderApp = {
      isPanel: isPanel,
      article: function () {
        return i;
      },
      body: function () {
        return l;
      },
      setting: function (e) {
        return e in a ? a[e] : rawSettings[e];
      },
      saveSettings: function (e) {
        for (var n in e) rawSettings[n] = e[n];
        return MessageHelper.send("SAVE_SETTINGS", e).catch(function () {});
      },
      tip: function (e) {
        E(e);
      },
      t: function (e, n, r) {
        return tx(e, n, r);
      },
      onEscape: function (e) {
        escHandlers.push(e);
      },
      onKey: function (e, n) {
        keyHandlers[e] = n;
      },
      touchUpdated: touchUpdated,
      goBack: goBack,
      isRead: function () {
        return !!(i && i.isRead);
      },
      markRead: function () {
        return (readMarked = !1), Ke();
      },
      markUnread: function () {
        return i
          ? MessageHelper.send("UPDATE_ARTICLE", { id: i.id, updates: { isRead: !1, readAt: null } }).then(function (e) {
              return (
                e && e.success && ((i.isRead = !1), (readMarked = !0), touchUpdated(), document.dispatchEvent(new CustomEvent("rl:readstate"))),
                e
              );
            })
          : Promise.resolve(null);
      },
      readerUrl: function (e) {
        return "reader.html?id=" + encodeURIComponent(e) + (isPanel ? "&panel=1" : "");
      },
      closeSettings: function () {
        b && b.style.display !== "none" && ((b.style.display = "none"), Te(!1));
      },
    };
    function X() {
      (P = document.getElementById("article-title")),
        (I = document.getElementById("article-meta")),
        (l = document.getElementById("article-body")),
        (B = document.getElementById("toolbar-title")),
        (H = document.getElementById("progress-bar")),
        (b = document.getElementById("font-settings")),
        (W = document.getElementById("font-size-value")),
        (S = document.getElementById("time-remaining")),
        (C = document.getElementById("shortcut-tooltip")),
        (T = document.getElementById("reader-toc")),
        (p = document.getElementById("toc-list")),
        (_ = document.getElementById("btn-favorite")),
        (s = document.querySelectorAll(".reader-theme-btn")),
        (v = document.querySelectorAll(".reader-width-btn"));
    }
    function J() {
      typeof I18n < "u" && I18n.translateDOM(), X();
      var e = new URLSearchParams(window.location.search),
        n = e.get("id");
      if (!n) {
        l &&
          (l.textContent =
            typeof I18n < "u" ? I18n.get("errorNoArticleId") : "No article ID provided.");
        return;
      }
      Q().then(function () {
        g(), Z(n);
      }),
        le(),
        de(),
        watchSettings();
    }
    /* Keep the page in step with the desktop (theme "auto") and with changes
       made in Options or in another reader tab. */
    function watchSettings() {
      if (darkQuery) {
        var e = function () {
          a.readerTheme === "auto" && g();
        };
        darkQuery.addEventListener ? darkQuery.addEventListener("change", e) : darkQuery.addListener(e);
      }
      try {
        chrome.storage.onChanged.addListener(function (n, t) {
          if (t !== "local") return;
          var r = {},
            o = !1;
          ["readerFontSize", "readerTheme", "readerWidth", "readerFontFamily", "readerLineHeight", "ttsRate", "ttsVoice"].forEach(
            function (d) {
              n[d] && ((r[d] = n[d].newValue), (rawSettings[d] = n[d].newValue), (o = !0));
            },
          );
          o && (readSettings(r), g());
        });
      } catch (d) {}
    }
    function xe() {
      return darkQuery && darkQuery.matches ? "dark" : "light";
    }
    /* "auto" follows the desktop, live. A missing or unknown theme is auto. */
    function effectiveTheme() {
      return a.readerTheme === "auto" ? xe() : a.readerTheme;
    }
    /* Options used to store CSS stacks ("Georgia, serif", "Inter, sans-serif").
       Map those and anything unknown onto the five named families. */
    function normFont(e) {
      var n = String(e || "").toLowerCase();
      if (FONTS.indexOf(n) >= 0) return n;
      if (n.indexOf("inter") >= 0) return "sans";
      if (n.indexOf("system-ui") >= 0) return "system";
      return "serif";
    }
    function normTheme(e) {
      return k.indexOf(e) >= 0 ? e : "auto";
    }
    function normLineHeight(e) {
      var n = parseFloat(e);
      return isFinite(n) ? Math.max(1.4, Math.min(2, Math.round(n * 100) / 100)) : 1.7;
    }
    function normSize(e) {
      var n = parseInt(e, 10);
      return isFinite(n) ? Math.max(12, Math.min(28, n - (n % 2))) : 18;
    }
    function normWidth(e) {
      var n = parseInt(e, 10);
      return D.indexOf(n) >= 0 ? n : 680;
    }
    function readSettings(e) {
      e.readerFontSize !== void 0 && (a.readerFontSize = normSize(e.readerFontSize)),
        e.readerTheme !== void 0 && (a.readerTheme = normTheme(e.readerTheme)),
        e.readerWidth !== void 0 && (a.readerWidth = normWidth(e.readerWidth)),
        e.readerFontFamily !== void 0 && (a.readerFontFamily = normFont(e.readerFontFamily)),
        e.readerLineHeight !== void 0 && (a.readerLineHeight = normLineHeight(e.readerLineHeight));
    }
    function Q() {
      return MessageHelper.send("GET_SETTINGS").then(function (e) {
        e && e.success && e.data && ((rawSettings = e.data), readSettings(e.data));
      });
    }
    function Z(e) {
      MessageHelper.send("GET_ARTICLE", { id: e })
        .then(function (n) {
          if (!n || !n.success || !n.data) {
            l &&
              (l.textContent =
                typeof I18n < "u" ? I18n.get("errorArticleNotFound") : "Article not found.");
            return;
          }
          (i = n.data),
            j(),
            re(),
            oe(),
            typeof Analytics < "u" &&
              Analytics.track("article_read", {
                articleId: i.id,
                title: i.title,
                wordCount: i.wordCount || 0,
              }),
            te(),
            be(),
            document.dispatchEvent(new CustomEvent("rl:rendered", { detail: { article: i } })),
            typeof Announcer < "u" &&
              Announcer.loadComplete(
                typeof I18n < "u" ? I18n.get("announcerArticleLoaded") : "Article loaded",
                i.title || "",
              );
        })
        .catch(function (n) {
          console.error("[Reader] Failed to load article:", n),
            l &&
              (l.textContent =
                typeof I18n < "u"
                  ? I18n.get("errorFailedToLoadArticle")
                  : "Failed to load article. Please try again."),
            typeof Announcer < "u" &&
              Announcer.error(
                typeof I18n < "u" ? I18n.get("errorFailedToLoadArticle") : "Failed to load article",
              );
        });
    }
    function j() {
      (document.title = i.title + " - ReadLater Pro"),
        P && (P.textContent = i.title),
        B && (B.textContent = i.title);
      var e = [];
      if (
        (i.byline && e.push(i.byline),
        i.domain && e.push(i.domain),
        i.estimatedReadTime &&
          e.push(
            typeof I18n < "u"
              ? I18n.get("readerMinRead", [String(i.estimatedReadTime)])
              : i.estimatedReadTime + " min read",
          ),
        i.savedAt)
      ) {
        var n = new Date(i.savedAt);
        e.push(
          typeof I18n < "u"
            ? I18n.get("readerSaved", [n.toLocaleDateString()])
            : "Saved " + n.toLocaleDateString(),
        );
      }
      if (I) {
        for (; I.firstChild; ) I.removeChild(I.firstChild);
        for (var t = 0; t < e.length; t++) {
          if (t > 0) {
            var r = document.createElement("span");
            (r.className = "reader-meta-sep"), (r.textContent = " · "), I.appendChild(r);
          }
          var o = document.createElement("span");
          (o.textContent = e[t]), I.appendChild(o);
        }
      }
      if (l)
        if (i.content) l.innerHTML = he(i.content);
        else if (i.textContent && String(i.textContent).trim()) renderText(i.textContent);
        else {
          for (; l.firstChild; ) l.removeChild(l.firstChild);
          var d = document.createElement("p");
          (d.className = "reader-no-content"),
            d.appendChild(
              document.createTextNode(
                (typeof I18n < "u"
                  ? I18n.get("readerNoContent")
                  : "No content available for this article.") + " ",
              ),
            );
          var u = document.createElement("a");
          (u.href = typeof Sanitize < "u" ? Sanitize.sanitizeUrl(i.url || "") : i.url || ""),
            (u.target = "_blank"),
            (u.rel = "noopener noreferrer"),
            (u.textContent =
              typeof I18n < "u" ? I18n.get("readerViewOriginalPage") : "View original page"),
            d.appendChild(u),
            l.appendChild(d);
        }
      (F = ee((l && l.textContent) || "")), N(), q(0);
    }
    /* Fallback extractions store only plain text. Blank lines separate
       paragraphs; when there are none, single newlines do. */
    function renderText(e) {
      for (; l.firstChild; ) l.removeChild(l.firstChild);
      var n = String(e).replace(/\r\n?/g, "\n").trim(),
        t = /\n[ \t]*\n/.test(n) ? n.split(/\n[ \t]*\n+/) : n.split(/\n+/),
        r = document.createDocumentFragment();
      t.forEach(function (o) {
        var d = o.replace(/\s+/g, " ").trim();
        if (d) {
          var u = document.createElement("p");
          (u.textContent = d), r.appendChild(u);
        }
      }),
        l.appendChild(r),
        l.classList.add("reader-body-text");
    }
    function N() {
      if (!(!i || !_)) {
        var e = _.querySelector("svg");
        e &&
          (i.isFavorite
            ? (e.setAttribute("fill", "currentColor"), _.classList.add("active"))
            : (e.setAttribute("fill", "none"), _.classList.remove("active")));
      }
    }
    function ee(e) {
      if (!e) return 0;
      var n = e.trim();
      return n ? n.split(/\s+/).length : 0;
    }
    function q(e) {
      if (S) {
        if (!F || F < 10) {
          S.textContent = "";
          return;
        }
        var n = Math.max(0, Math.min(1, e / 100)),
          t = Math.round(F * (1 - n)),
          r = Math.ceil(t / Y);
        n >= 0.98
          ? (S.textContent = typeof I18n < "u" ? I18n.get("readerFinished") : "Finished")
          : r < 1
            ? (S.textContent =
                typeof I18n < "u" ? I18n.get("readerLessThan1Min") : "< 1 min remaining")
            : (S.textContent =
                typeof I18n < "u"
                  ? I18n.get("readerMinRemaining", [String(r)])
                  : r + " min remaining");
      }
    }
    function te() {
      if (!$) {
        $ = !0;
        var e = i && i.readProgress;
        !e ||
          e <= 0 ||
          requestAnimationFrame(function () {
            var n = document.documentElement.scrollHeight - window.innerHeight;
            if (n > 0) {
              var t = (e / 100) * n;
              window.scrollTo({ top: t, behavior: "auto" });
            }
          });
      }
    }
    function ne(e) {
      M && clearTimeout(M),
        (M = setTimeout(function () {
          i &&
            (MessageHelper.send("UPDATE_READ_PROGRESS", {
              id: i.id,
              progress: Math.round(e),
            }).catch(function (n) {
              console.warn("[Reader] Failed to save progress:", n);
            }),
            e > 90 && Ke());
        }, 3e3));
    }
    function re() {
      if (!(!l || !p)) {
        var e = l.querySelectorAll("h2, h3"),
          n = document.getElementById("btn-toc");
        if (e.length < 3) {
          n && (n.style.display = "none");
          return;
        }
        for (n && (n.style.display = ""); p.firstChild; ) p.removeChild(p.firstChild);
        for (var t = 0; t < e.length; t++) {
          var r = e[t];
          r.id || (r.id = "heading-" + t);
          var o = document.createElement("li"),
            d = r.tagName.toLowerCase();
          d === "h3" && (o.className = "toc-h3");
          var u = document.createElement("a");
          (u.href = "#" + r.id),
            (u.textContent = r.textContent),
            u.setAttribute("data-heading-id", r.id),
            u.addEventListener("click", function (A) {
              A.preventDefault();
              var f = this.getAttribute("data-heading-id"),
                m = document.getElementById(f);
              m && m.scrollIntoView({ behavior: "smooth", block: "start" });
            }),
            o.appendChild(u),
            p.appendChild(o);
        }
      }
    }
    function ie() {
      (w = !w), T && (T.style.display = w ? "block" : "none");
    }
    function U() {
      (w = !1), T && (T.style.display = "none");
    }
    function ae() {
      if (!(!w || !l || !p)) {
        var e = l.querySelectorAll("h2, h3");
        if (!(e.length < 3)) {
          for (var n = window.scrollY + 80, t = null, r = 0; r < e.length; r++)
            e[r].offsetTop <= n && (t = e[r].id);
          for (var o = p.querySelectorAll("a"), d = 0; d < o.length; d++)
            o[d].classList.toggle("active", o[d].getAttribute("data-heading-id") === t);
        }
      }
    }
    function oe() {
      l &&
        l.addEventListener("click", function (e) {
          for (var n = e.target; n && n !== l && n.tagName !== "A"; ) n = n.parentElement;
          if (!(!n || n.tagName !== "A")) {
            var t = n.getAttribute("href");
            if (t) {
              if ((e.preventDefault(), e.stopPropagation(), t.charAt(0) === "#")) {
                var r = t.substring(1),
                  o = document.getElementById(r);
                o && o.scrollIntoView({ behavior: "smooth", block: "start" });
                return;
              }
              var d = typeof Sanitize < "u" ? Sanitize.sanitizeUrl(t) : t;
              d && window.open(d, "_blank", "noopener,noreferrer");
            }
          }
        });
    }
    function de() {
      document.addEventListener("keydown", function (e) {
        var n = e.target.tagName;
        if (!(n === "INPUT" || n === "TEXTAREA" || n === "SELECT") && !e.target.isContentEditable) {
          var t = e.key,
            mod = e.ctrlKey || e.metaKey || e.altKey;
          if (t === "Escape") {
            e.preventDefault();
            for (var x = 0; x < escHandlers.length; x++) if (escHandlers[x]()) return;
            if (b && b.style.display !== "none") {
              (b.style.display = "none"), Te(!1);
              return;
            }
            if (w) {
              U();
              return;
            }
            goBack();
            return;
          }
          if (mod) return;
          var kh = keyHandlers[String(t).toLowerCase()];
          if (kh && kh(e) !== !1) {
            e.preventDefault();
            return;
          }
          if (t === "f" || t === "F") {
            e.preventDefault(), G();
            return;
          }
          if (t === "+" || t === "=") {
            e.preventDefault(),
              (a.readerFontSize = Math.min(28, a.readerFontSize + 2)),
              g(),
              y(),
              E(
                typeof I18n < "u"
                  ? I18n.get("readerFontSizeChanged", [String(a.readerFontSize)])
                  : "Font size: " + a.readerFontSize + "px",
              );
            return;
          }
          if (t === "-") {
            e.preventDefault(),
              (a.readerFontSize = Math.max(12, a.readerFontSize - 2)),
              g(),
              y(),
              E(
                typeof I18n < "u"
                  ? I18n.get("readerFontSizeChanged", [String(a.readerFontSize)])
                  : "Font size: " + a.readerFontSize + "px",
              );
            return;
          }
          if (t === "t" || t === "T") {
            e.preventDefault();
            var r = k.indexOf(a.readerTheme),
              o = (r + 1) % k.length;
            (a.readerTheme = k[o]), g(), y();
            var d = themeName(a.readerTheme);
            E(typeof I18n < "u" ? I18n.get("readerThemeChanged", [d]) : "Theme: " + d),
              typeof Announcer < "u" &&
                Announcer.status(
                  typeof I18n < "u" ? I18n.get("readerThemeChanged", [d]) : "Theme changed to " + d,
                );
            return;
          }
          if ((t === "w" || t === "W") && !isPanel) {
            e.preventDefault();
            var u = D.indexOf(a.readerWidth),
              A = (u + 1) % D.length;
            (a.readerWidth = D[A]), g(), y();
            var f =
              a.readerWidth === 560
                ? typeof I18n < "u"
                  ? I18n.get("widthNarrow")
                  : "Narrow"
                : a.readerWidth === 680
                  ? typeof I18n < "u"
                    ? I18n.get("widthMedium")
                    : "Medium"
                  : typeof I18n < "u"
                    ? I18n.get("widthWide")
                    : "Wide";
            E(
              typeof I18n < "u"
                ? I18n.get("readerWidthChanged", [f, String(a.readerWidth)])
                : "Width: " + f + " (" + a.readerWidth + "px)",
            );
            return;
          }
        }
      });
    }
    function G() {
      i &&
        MessageHelper.send("TOGGLE_FAVORITE", { id: i.id })
          .then(function (e) {
            if (e && e.success && e.data) {
              (i.isFavorite = e.data.isFavorite), N(), touchUpdated();
              var n = i.isFavorite
                ? typeof I18n < "u"
                  ? I18n.get("readerFavoriteAdded")
                  : "Added to favorites"
                : typeof I18n < "u"
                  ? I18n.get("readerFavoriteRemoved")
                  : "Removed from favorites";
              E(n), typeof Announcer < "u" && Announcer.status(n);
            }
          })
          .catch(function (e) {
            console.warn("[Reader] Failed to toggle favorite:", e);
          });
    }
    function E(e) {
      C &&
        (z && clearTimeout(z),
        (C.textContent = e),
        C.classList.add("visible"),
        (z = setTimeout(function () {
          C.classList.remove("visible"), (z = null);
        }, 1200)),
        typeof FocusManager < "u" && FocusManager.announce && FocusManager.announce(e));
    }
    function g() {
      if (
        /* The attribute has to land on <html> as well. design-system.css scopes
           its prefers-color-scheme block to :root:not([data-theme="light"]),
           so with the attribute only on <body> a system-dark desktop forced the
           reader dark even when the reader had Light selected. */
        (document.documentElement.setAttribute("data-theme", effectiveTheme()),
        document.body.setAttribute("data-theme", effectiveTheme()),
        document.documentElement.setAttribute("data-theme-pref", a.readerTheme),
        document.documentElement.setAttribute("data-font", a.readerFontFamily),
        document.documentElement.style.setProperty("--reader-line-height", String(a.readerLineHeight)),
        document.documentElement.style.setProperty("--reader-font-size", a.readerFontSize + "px"),
        W && (W.textContent = a.readerFontSize),
        document.documentElement.style.setProperty("--reader-width", a.readerWidth + "px"),
        s)
      )
        for (var e = 0; e < s.length; e++) {
          var n = s[e].getAttribute("data-theme") === a.readerTheme;
          s[e].classList.toggle("active", n), s[e].setAttribute("aria-checked", String(n));
        }
      if (v)
        for (var t = 0; t < v.length; t++) {
          var r = parseInt(v[t].getAttribute("data-width")) === a.readerWidth;
          v[t].classList.toggle("active", r), v[t].setAttribute("aria-checked", String(r));
        }
      for (var c = document.querySelectorAll(".reader-font-btn"), x = 0; x < c.length; x++) {
        var m = c[x].getAttribute("data-font") === a.readerFontFamily;
        c[x].classList.toggle("active", m), c[x].setAttribute("aria-checked", String(m));
      }
      /* Options also offers 1.7, so the closest step shows as selected. */
      for (var L = 0, z2 = 1; z2 < LINE_HEIGHTS.length; z2++)
        Math.abs(LINE_HEIGHTS[z2] - a.readerLineHeight) < Math.abs(LINE_HEIGHTS[L] - a.readerLineHeight) - 1e-9 && (L = z2);
      for (var lh = document.querySelectorAll(".reader-lh-btn"), K = 0; K < lh.length; K++) {
        var O = K === L;
        lh[K].classList.toggle("active", O), lh[K].setAttribute("aria-checked", String(O));
      }
    }
    function themeName(e) {
      return e === "auto"
        ? tx("readerThemeAuto", "Auto")
        : typeof I18n < "u" && I18n.get("theme" + e.charAt(0).toUpperCase() + e.slice(1)) !== "theme" + e.charAt(0).toUpperCase() + e.slice(1)
          ? I18n.get("theme" + e.charAt(0).toUpperCase() + e.slice(1))
          : e.charAt(0).toUpperCase() + e.slice(1);
    }
    function tx(e, n, r) {
      var o = "";
      try {
        o = chrome.i18n.getMessage(e, r);
      } catch (d) {}
      if (o) return o;
      var u = String(n);
      return (
        r &&
          [].concat(r).forEach(function (A, f) {
            u = u.split("$" + (f + 1)).join(String(A));
          }),
        u
      );
    }
    function touchUpdated() {
      try {
        chrome.storage.local.set({ articlesUpdatedAt: Date.now() });
      } catch (e) {}
    }
    function goBack() {
      isPanel
        ? (window.location.href = "../sidebar/sidebar.html")
        : window.history.length > 1
          ? window.history.back()
          : window.close();
    }
    function y() {
      MessageHelper.send("SAVE_SETTINGS", {
        readerFontSize: a.readerFontSize,
        readerTheme: a.readerTheme,
        readerWidth: a.readerWidth,
        readerFontFamily: a.readerFontFamily,
        readerLineHeight: a.readerLineHeight,
      }).catch(function (e) {
        console.warn("[Reader] Failed to save settings:", e);
      });
    }
    function h(e, n) {
      var t = document.getElementById(e);
      t && t.addEventListener("click", n);
    }
    function Te(e) {
      var n = document.getElementById("btn-font-settings");
      n && n.setAttribute("aria-expanded", String(!!e));
    }
    function le() {
      if (
        (h("btn-back", function () {
          goBack();
        }),
        h("btn-favorite", function () {
          G();
        }),
        h("btn-print", function () {
          window.print();
        }),
        h("btn-original", function () {
          if (i && i.url) {
            var t = typeof Sanitize < "u" ? Sanitize.sanitizeUrl(i.url) : i.url;
            t && window.open(t, "_blank", "noopener,noreferrer");
          }
        }),
        h("btn-toc", function () {
          ie();
        }),
        h("btn-toc-close", function () {
          U();
        }),
        h("btn-font-settings", function () {
          if (b) {
            var t = b.style.display === "none";
            (b.style.display = t ? "block" : "none"), Te(t);
          }
        }),
        s)
      )
        for (var e = 0; e < s.length; e++)
          s[e].addEventListener("click", function () {
            if (
              ((a.readerTheme = this.getAttribute("data-theme")), g(), y(), typeof Announcer < "u")
            ) {
              var t = themeName(a.readerTheme);
              Announcer.status(
                typeof I18n < "u" ? I18n.get("readerThemeChanged", [t]) : "Theme changed to " + t,
              );
            }
          });
      for (var c = document.querySelectorAll(".reader-font-btn"), x = 0; x < c.length; x++)
        c[x].addEventListener("click", function () {
          (a.readerFontFamily = this.getAttribute("data-font")), g(), y();
          typeof Announcer < "u" && Announcer.status(this.textContent.trim());
        });
      for (var lh = document.querySelectorAll(".reader-lh-btn"), K = 0; K < lh.length; K++)
        lh[K].addEventListener("click", function () {
          (a.readerLineHeight = parseFloat(this.getAttribute("data-lh"))), g(), y();
        });
      if (
        (h("btn-size-down", function () {
          (a.readerFontSize = Math.max(12, a.readerFontSize - 2)), g(), y();
        }),
        h("btn-size-up", function () {
          (a.readerFontSize = Math.min(28, a.readerFontSize + 2)), g(), y();
        }),
        v)
      )
        for (var n = 0; n < v.length; n++)
          v[n].addEventListener("click", function () {
            (a.readerWidth = parseInt(this.getAttribute("data-width"))), g(), y();
          });
      window.addEventListener(
        "scroll",
        pe(function () {
          var t = document.documentElement.scrollHeight - window.innerHeight,
            r = t > 0 ? (window.scrollY / t) * 100 : 0;
          H &&
            ((H.style.width = r + "%"),
            H.setAttribute("aria-valuenow", String(Math.round(r)))),
            q(r),
            ae(),
            i && r > 0 && ne(r);
        }, 250),
      );
    }
    var READ_DWELL_MS = 4e3;
    var readMarked = !1;
    /* Marking an article read the instant it opened emptied the Unread tab on a
       glance. Read means read: the reader either scrolled past 90 percent, or
       the article fits on one screen and stayed open long enough to read it. */
    function be() {
      !i ||
        readMarked ||
        setTimeout(function () {
          document.documentElement.scrollHeight - window.innerHeight <= 8 && Ke();
        }, READ_DWELL_MS);
    }
    function Ke() {
      if (!i || readMarked) return Promise.resolve(null);
      return (
        (readMarked = !0),
        MessageHelper.send("MARK_AS_READ", { id: i.id })
          .then(function (e) {
            return (
              e && e.success && ((i.isRead = !0), touchUpdated(), document.dispatchEvent(new CustomEvent("rl:readstate"))),
              e
            );
          })
          .catch(function (e) {
            console.warn("[Reader] Failed to mark as read:", e);
          })
      );
    }
    /* Reader view, theme, width and font size are part of the core promise and
       are never gated, so the reader asks nothing about tier. The previous
       version read licenseDataPlain out of chrome.storage.local and treated it
       as tier authority, which let a console write dress the page up as Pro. */
    /* Article bodies are real now. Lane E found that readability.js never
       reached global scope, so every record saved before this build had an
       empty content field; a saved article is roughly 31.6 KB of HTML and can
       reach a few hundred KB. This walks every element and every attribute, so
       it needs bounds.
       The caps refuse rather than truncate. Stopping a sanitiser halfway leaves
       unsanitised nodes in the document, so an oversized document falls back to
       plain text, which is the safe direction and still readable. */
    var MAX_CONTENT_CHARS = 2e6;
    var MAX_SANITIZE_NODES = 2e4;
    var MAX_ATTRS_PER_NODE = 32;
    function Ce(e) {
      return String(e).replace(/<[^>]*>/g, "");
    }
    function he(e) {
      if (!e) return "";
      if (e.length > MAX_CONTENT_CHARS)
        return (
          console.warn("[Reader] Content over cap, rendering as text:", e.length), Ce(e)
        );
      try {
        for (
          var n = new DOMParser(),
            t = n.parseFromString(e, "text/html"),
            r = t.querySelectorAll(
              "script, style, iframe, object, embed, form, input, textarea, select, button, link, meta, base, applet, frame, frameset",
            ),
            o = r.length - 1;
          o >= 0;
          o--
        )
          r[o].parentNode && r[o].parentNode.removeChild(r[o]);
        var d = t.body ? t.body.querySelectorAll("*") : [];
        if (d.length > MAX_SANITIZE_NODES)
          return (
            console.warn("[Reader] Node count over cap, rendering as text:", d.length), Ce(e)
          );
        for (var u = 0; u < d.length; u++) {
          var A = d[u],
            f = A.attributes;
          if (f.length > MAX_ATTRS_PER_NODE) {
            for (var S = f.length - 1; S >= 0; S--) A.removeAttribute(f[S].name);
            continue;
          }
          for (var m = f.length - 1; m >= 0; m--) {
            var L = f[m].name.toLowerCase();
            if (
              (L.indexOf("on") === 0 && A.removeAttribute(f[m].name),
              L === "href" || L === "src" || L === "action")
            ) {
              var K = (f[m].value || "").trim().toLowerCase();
              (K.indexOf("javascript:") === 0 || K.indexOf("data:text/html") === 0) &&
                A.removeAttribute(f[m].name);
            }
          }
        }
        for (var O = t.body ? t.body.querySelectorAll("img") : [], R = 0; R < O.length; R++)
          O[R].setAttribute("loading", "lazy"), O[R].setAttribute("decoding", "async");
        return t.body ? t.body.innerHTML : "";
      } catch {
        return Ce(e);
      }
    }
    function me(e) {
      if (!e) return "";
      var n = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return String(e).replace(/[&<>"']/g, function (t) {
        return n[t];
      });
    }
    function ye(e) {
      return me(e);
    }
    function pe(e, n) {
      var t = 0;
      return function () {
        var r = Date.now();
        r - t >= n && ((t = r), e.apply(this, arguments));
      };
    }
    document.addEventListener("DOMContentLoaded", J);
  })();
})();
