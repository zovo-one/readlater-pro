(() => {
  (function () {
    "use strict";
    var n = document.getElementById("btn-save"),
      i = document.getElementById("btn-save-text"),
      l = document.getElementById("btn-open-list"),
      m = document.getElementById("popup-page-title"),
      c = document.getElementById("popup-page-url"),
      f = document.getElementById("popup-page-favicon"),
      s = document.getElementById("popup-unread-count"),
      v = document.getElementById("popup-page-info"),
      u = ["chrome://", "chrome-extension://", "about:", "edge://", "devtools://"];
    var savedActions = document.getElementById("popup-saved-actions"),
      openReaderBtn = document.getElementById("btn-open-reader"),
      undoBtn = document.getElementById("btn-undo-save"),
      announcer = document.getElementById("popup-announcer"),
      savedArticleId = null;
    /* Announce state changes for screen readers. The save button changes colour
       and label, which is invisible to assistive technology on its own. */
    function announce(t) {
      announcer && (announcer.textContent = "");
      var e = announcer;
      e &&
        setTimeout(function () {
          e.textContent = t;
        }, 50);
    }
    /* `undoable` is false for a duplicate: that article was saved earlier and
       Undo must never delete something the user did not just create. */
    function showSavedActions(t, e) {
      (savedArticleId = t || null),
        undoBtn && (undoBtn.hidden = !e),
        savedActions && savedArticleId && savedActions.removeAttribute("hidden");
    }
    function hideSavedActions() {
      (savedArticleId = null), savedActions && savedActions.setAttribute("hidden", "");
    }
    function refreshUnreadCount() {
      MessageHelper.send("GET_ARTICLE_COUNT", { isRead: !1 })
        .then(function (t) {
          if (t && t.success && t.data) {
            var e = t.data.count || 0;
            if (e === 0)
              (s.textContent = I18n.get("rlPopupEmptyWelcome")),
                s.classList.add("popup-stat-welcome");
            else {
              s.classList.remove("popup-stat-welcome");
              var o = e === 1 ? "popupUnreadCountSingular" : "popupUnreadCount";
              s.textContent = I18n.get(o, [String(e)]);
            }
          }
        })
        .catch(function (t) {
          console.warn("[Popup] GET_ARTICLE_COUNT failed:", t);
        });
    }
    function g(t) {
      if (!t) return !0;
      for (var e = 0; e < u.length; e++) if (t.indexOf(u[e]) === 0) return !0;
      return !1;
    }
    var a = null,
      isRestricted = !1,
      note = document.getElementById("popup-note"),
      MAX_TAB_SCAN = 200;
    /* The manifest requests no host permissions. The only site access this popup
       ever holds is the activeTab grant Chrome hands over when the user clicks
       the toolbar icon, and that grant covers the ACTIVE tab and nothing else.
       So the active tab is tried first and is the only tab whose body can be
       read. A second ordinary tab is still offered when the user is sitting on
       a browser page, because a reading list entry is worth more than a refusal,
       but that save keeps the link alone and the popup says so afterwards
       instead of implying a full capture. */
    function resolveTab(CB) {
      chrome.tabs.query({ active: !0, currentWindow: !0 }, function (t) {
        chrome.runtime.lastError &&
          console.warn("[Popup] active tab query failed:", chrome.runtime.lastError.message);
        var e0 = t && t[0];
        if (e0 && e0.url && !g(e0.url)) {
          CB(e0);
          return;
        }
        chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, function (w) {
          if (chrome.runtime.lastError) {
            console.warn("[Popup] tab scan failed:", chrome.runtime.lastError.message),
              CB(e0 || null);
            return;
          }
          var list = w || [],
            best = null,
            k,
            x;
          for (k = 0; k < list.length && k < MAX_TAB_SCAN; k++) {
            x = list[k];
            if (!x || !x.url || g(x.url)) continue;
            if (!best || (x.lastAccessed || 0) > (best.lastAccessed || 0)) best = x;
          }
          CB(best || e0 || null);
        });
      });
    }
    /* Left focusable on purpose. A `disabled` button drops out of the tab order,
       so a keyboard or screen reader user gets no signal at all that saving is
       unavailable here. aria-disabled keeps it reachable, and activating it
       says why instead of doing nothing. */
    function markRestricted() {
      (isRestricted = !0),
        n.setAttribute("aria-disabled", "true"),
        n.classList.add("popup-btn-restricted"),
        n.classList.remove("popup-btn-primary"),
        n.setAttribute("title", I18n.get("popupCannotSave")),
        (i.textContent = I18n.get("popupCannotSave")),
        v.classList.add("popup-restricted");
    }
    function showNote(t) {
      note && ((note.textContent = t), note.removeAttribute("hidden")), announce(t);
    }
    function hideNote() {
      note && (note.setAttribute("hidden", ""), (note.textContent = ""));
    }
    /* Injection failed, so there is no body to store. Keep the link with what
       the tab itself already reported rather than losing the save. */
    function metaOnly() {
      return {
        url: a.url,
        title: a.title || I18n.get("rlUntitledPage"),
        content: "",
        textContent: "",
        excerpt: "",
        byline: "",
        leadImageUrl: a.favIconUrl || "",
        wordCount: 0,
        estimatedReadTime: 0,
      };
    }
    resolveTab(function (e) {
      if (!e || !e.url) {
        (m.textContent = I18n.get("rlUntitledPage")), markRestricted();
        return;
      }
      (a = e), (m.textContent = e.title || I18n.get("rlUntitledPage"));
      try {
        var o = new URL(e.url);
        c.textContent = o.hostname;
      } catch {
        c.textContent = e.url || "";
      }
      if (e.favIconUrl) {
        var p = document.createElement("img");
        (p.src = e.favIconUrl),
          (p.alt = ""),
          (p.onerror = function () {
            this.style.display = "none";
          }),
          f.appendChild(p);
      }
      if (g(e.url)) {
        markRestricted();
        return;
      }
      MessageHelper.send("CHECK_URL_SAVED", { url: e.url })
        .then(function (r) {
          r &&
            r.success &&
            r.data &&
            r.data.saved &&
            (n.classList.add("popup-btn-duplicate"),
            n.classList.remove("popup-btn-primary"),
            (i.textContent = I18n.get("popupAlreadySaved")),
            showSavedActions(r.data.article && r.data.article.id, !1));
        })
        .catch(function (r) {
          console.warn("[Popup] CHECK_URL_SAVED failed:", r);
        });
    }),
      refreshUnreadCount(),
      n.addEventListener("click", function () {
        if (isRestricted) {
          showNote(I18n.get("rlPopupCannotSaveWhy"));
          return;
        }
        !a ||
          !a.url ||
          n.disabled ||
          ((n.disabled = !0),
          (i.textContent = I18n.get("rlPopupSaving")),
          announce(I18n.get("rlPopupSaving")),
          chrome.scripting.executeScript(
            {
              target: { tabId: a.id },
              files: [
                "src/utils/sanitize.js",
                "src/utils/message-validator.js",
                "src/content/readability.js",
                "src/content/content.js",
              ],
              world: "ISOLATED",
            },
            function () {
              if (chrome.runtime.lastError) {
                d(metaOnly());
                return;
              }
              chrome.tabs.sendMessage(a.id, { action: "EXTRACT_ARTICLE" }, function (t) {
                if (chrome.runtime.lastError || !t || !t.success) {
                  d(metaOnly());
                  return;
                }
                d(t.data);
              });
            },
          ));
      });
    function saveFailed() {
      n.classList.add("popup-btn-error"),
        n.classList.remove("popup-btn-primary"),
        (i.textContent = I18n.get("popupSaveFailed")),
        (n.disabled = !1),
        hideSavedActions(),
        announce(I18n.get("popupSaveFailed"));
    }
    function d(t) {
      MessageHelper.send("SAVE_ARTICLE", t)
        .then(function (e) {
          if (!e || !e.success) {
            saveFailed();
            return;
          }
          if (e.data && e.data.duplicate) {
            n.classList.add("popup-btn-duplicate"),
              n.classList.remove("popup-btn-primary"),
              (i.textContent = I18n.get("popupAlreadySaved")),
              showSavedActions(e.data.article && e.data.article.id, !1);
            /* A link-only copy just got its full text. Still not undoable:
               the article existed before this click. */
            if (e.data.filled) {
              var fillMsg =
                chrome.i18n.getMessage("core2PopupFilled") ||
                "Added the full text to the copy you already had.";
              showNote(fillMsg);
            } else announce(I18n.get("popupAlreadySaved"));
            return;
          }
          var art = e.data && e.data.article;
          n.classList.add("popup-btn-saved"),
            n.classList.remove("popup-btn-primary"),
            (i.textContent = I18n.get("rlPopupSaved")),
            showSavedActions(art && art.id, !0),
            refreshUnreadCount();
          /* The body is stored or it is not. Reader view would otherwise be the
             one to break the news, several clicks later. */
          art && art.content
            ? (hideNote(), announce(I18n.get("rlPopupSavedAnnouncement")))
            : showNote(
                chrome.i18n.getMessage("corePopupTextNotCaptured") ||
                  "This page didn't let ReadLater read its text, so only the link was saved.",
              );
        })
        .catch(function () {
          saveFailed();
        });
    }
    openReaderBtn &&
      openReaderBtn.addEventListener("click", function () {
        savedArticleId &&
          chrome.tabs.create(
            {
              url:
                chrome.runtime.getURL("src/pages/reader.html") +
                "?id=" +
                encodeURIComponent(savedArticleId),
            },
            function () {
              chrome.runtime.lastError, window.close();
            },
          );
      });
    /* Undo removes the article that was just saved. Only ever acts on the id
       the save call returned, never on a guess. */
    undoBtn &&
      undoBtn.addEventListener("click", function () {
        savedArticleId &&
          ((undoBtn.disabled = !0),
          MessageHelper.send("DELETE_ARTICLE", { id: savedArticleId })
            .then(function () {
              n.classList.remove("popup-btn-saved", "popup-btn-duplicate"),
                n.classList.add("popup-btn-primary"),
                (i.textContent = I18n.get("popupSavePage")),
                (n.disabled = !1),
                (undoBtn.disabled = !1),
                hideSavedActions(),
                hideNote(),
                announce(I18n.get("rlPopupUndone")),
                refreshUnreadCount();
            })
            .catch(function (t) {
              console.warn("[Popup] Undo failed:", t), (undoBtn.disabled = !1);
            }));
      });
    l.addEventListener("click", function () {
      chrome.tabs.query({ active: !0, currentWindow: !0 }, function (t) {
        var e = t && t[0];
        e &&
          chrome.sidePanel.open({ tabId: e.id }).catch(function () {
            chrome.tabs.create({ url: chrome.runtime.getURL("src/sidebar/sidebar.html") });
          }),
          window.close();
      });
    });
  })();
})();
