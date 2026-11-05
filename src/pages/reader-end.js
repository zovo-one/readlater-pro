/* ReadLater Pro - end-of-article card (1.3.0).
 *
 * A quiet card under the last paragraph: read state, the next unread article
 * and a way back to the list. "n" opens the next unread article.
 */
(function () {
  'use strict';

  var App = window.ReaderApp;
  if (!App) return;

  var t = App.t;
  var card = document.getElementById('rl-end');
  var stateEl = document.getElementById('rl-end-state');
  var markBtn = document.getElementById('rl-end-mark');
  var unmarkBtn = document.getElementById('rl-end-unmark');
  var backBtn = document.getElementById('rl-end-back');
  var nextLink = document.getElementById('rl-end-next');
  var nextTitle = document.getElementById('rl-end-next-title');
  var nextMeta = document.getElementById('rl-end-next-meta');
  var doneEl = document.getElementById('rl-end-done');
  if (!card) return;

  var nextPromise = null;
  var nextArticle = null;
  var windowId = null;

  function fetchNext() {
    if (nextPromise) return nextPromise;
    var current = App.article();
    nextPromise = MessageHelper.send('GET_ARTICLES', {
      isRead: false,
      limit: 2,
      sortBy: 'savedAt',
      sortOrder: 'desc',
      fields: ['id', 'title', 'estimatedReadTime']
    }).then(function (res) {
      var list = res && res.success && Array.isArray(res.data) ? res.data : [];
      nextArticle = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id && (!current || list[i].id !== current.id)) { nextArticle = list[i]; break; }
      }
      renderNext();
      return nextArticle;
    }).catch(function () {
      nextPromise = null;
      return null;
    });
    return nextPromise;
  }

  function renderNext() {
    if (nextArticle) {
      nextTitle.textContent = nextArticle.title || t('readerEndUntitled', 'Untitled');
      nextMeta.textContent = nextArticle.estimatedReadTime
        ? t('readerEndMinRead', '$1 min read', [String(nextArticle.estimatedReadTime)])
        : '';
      nextLink.href = App.readerUrl(nextArticle.id);
      nextLink.hidden = false;
      doneEl.hidden = true;
    } else {
      nextLink.hidden = true;
      doneEl.hidden = false;
    }
  }

  function renderState() {
    var read = App.isRead();
    stateEl.hidden = !read;
    unmarkBtn.hidden = !read;
    markBtn.hidden = read;
  }

  function goNext() {
    fetchNext().then(function (a) {
      if (a) window.location.href = App.readerUrl(a.id);
      else App.tip(t('readerEndNoneLeft', 'No more unread articles'));
    });
  }

  function backToList() {
    if (App.isPanel) { App.goBack(); return; }
    // In a tab the list lives in the side panel. sidePanel.open needs the
    // click's user gesture, so the window id is looked up ahead of time.
    if (windowId !== null && chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ windowId: windowId }).catch(function () { App.goBack(); });
      return;
    }
    App.goBack();
  }

  document.addEventListener('rl:rendered', function () {
    card.hidden = false;
    renderState();
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) {
          io.disconnect();
          fetchNext();
        }
      }, { rootMargin: '0px 0px 400px 0px' });
      io.observe(card);
    } else {
      fetchNext();
    }
  });
  document.addEventListener('rl:readstate', renderState);

  markBtn.addEventListener('click', function () {
    App.markRead().then(function () {
      renderState();
      var b = unmarkBtn.hidden ? backBtn : unmarkBtn;
      b.focus();
    });
  });
  unmarkBtn.addEventListener('click', function () {
    App.markUnread().then(function () {
      renderState();
      markBtn.focus();
    });
  });
  backBtn.addEventListener('click', backToList);
  nextLink.addEventListener('click', function (e) {
    if (!nextArticle) { e.preventDefault(); goNext(); }
  });

  try {
    if (!App.isPanel && chrome.windows && chrome.windows.getCurrent) {
      chrome.windows.getCurrent(function (w) {
        if (!chrome.runtime.lastError && w) windowId = w.id;
      });
    }
  } catch (e) { /* not available */ }

  App.onKey('n', function () {
    if (!App.article()) return false;
    goNext();
  });
})();
