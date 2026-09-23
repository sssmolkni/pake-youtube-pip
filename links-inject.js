// links-inject.js - Send outbound links to the default browser, keep YouTube in-app
//
// YouTube wraps every external link in a description or comment as
// https://www.youtube.com/redirect?...&q=<encoded url>. Pake decides internal
// vs external by comparing root domains (inject/event.js isSameDomain), so it
// sees youtube.com, calls the link internal, and navigates to the third-party
// site inside the app - where there is no browser chrome to get back with.
//
// The same check fails the other way for youtu.be: different root domain, so a
// link to a YouTube *video* gets thrown out to Safari.
//
// Three layers:
//   A. a capture-phase click interceptor that unwraps /redirect and routes by
//      the real destination;
//   B. a bailout on the /redirect page itself, for navigations that never went
//      through an anchor click (window.open, SPA routing);
//   C. a "Back to YouTube" pill on any page that still ends up off-site.
(function () {
  if (window.__pakeYtLinksInjected) return;
  window.__pakeYtLinksInjected = true;

  var HOME = 'https://www.youtube.com/';
  var PILL_ID = 'pake-yt-back-pill';

  // Google's sign-in and consent flows legitimately run inside the app; Pake
  // has its own handling for them (inject/event.js isAuthLink). Treat them as
  // internal so we never eject a half-finished login to the browser.
  var AUTH_HOSTS = [
    'accounts.google.com',
    'accounts.youtube.com',
    'consent.google.com',
    'consent.youtube.com',
    'myaccount.google.com',
  ];

  function isYouTubeHost(hostname) {
    return (
      hostname === 'youtu.be' ||
      /(^|\.)youtube\.com$/.test(hostname) ||
      /(^|\.)youtube-nocookie\.com$/.test(hostname) ||
      /(^|\.)ytimg\.com$/.test(hostname)
    );
  }

  function isInternalHost(hostname) {
    return isYouTubeHost(hostname) || AUTH_HOSTS.indexOf(hostname) !== -1;
  }

  // Peel off YouTube's outbound wrappers: /redirect?q= for external links and
  // the older /attribution_link?u= for internal ones. Recurses once or twice
  // because a wrapped link can point at another YouTube URL.
  function unwrap(url, depth) {
    if (depth >= 3 || !isYouTubeHost(url.hostname)) return url;
    var inner =
      (url.pathname === '/redirect' && url.searchParams.get('q')) ||
      (url.pathname === '/attribution_link' && url.searchParams.get('u'));
    if (!inner) return url;
    try {
      return unwrap(new URL(inner, url.origin), depth + 1);
    } catch (error) {
      return url;
    }
  }

  // youtu.be/ID?t=90 -> www.youtube.com/watch?v=ID&t=90, so short links open in
  // the app instead of being treated as a foreign domain.
  function toWatchUrl(url) {
    if (url.hostname !== 'youtu.be') return null;
    var id = url.pathname.replace(/^\/+/, '').split('/')[0];
    if (!id) return null;
    var watch = new URL('https://www.youtube.com/watch');
    watch.searchParams.set('v', id);
    ['t', 'list', 'index'].forEach(function (key) {
      var value = url.searchParams.get(key);
      if (value) watch.searchParams.set(key, value);
    });
    return watch.href;
  }

  // The destination comes out of a query string, so it can be any scheme -
  // and on the /redirect page it is acted on without a click. Only hand the
  // OS web and mail links; anything else (file:, custom app schemes) is dropped
  // rather than trusting the shell plugin's scope to catch it.
  var EXTERNAL_PROTOCOLS = ['http:', 'https:', 'mailto:'];

  function openExternally(href) {
    var protocol;
    try {
      protocol = new URL(href).protocol;
    } catch (error) {
      return;
    }
    if (EXTERNAL_PROTOCOLS.indexOf(protocol) === -1) {
      console.warn('Pake links: refusing to open non-web link externally:', href);
      return;
    }
    var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    if (!invoke) {
      console.warn('Pake links: Tauri invoke unavailable, cannot open', href);
      return;
    }
    invoke('plugin:shell|open', { path: href }).catch(function (error) {
      console.error('Pake links: failed to open externally:', href, error);
    });
  }

  // ---------------------------------------------------------------------------
  // A. Click interceptor
  // ---------------------------------------------------------------------------

  // composedPath crosses shadow roots, which YouTube's Polymer components use;
  // closest() alone would miss anchors inside them.
  function findAnchor(event) {
    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (node && node.tagName === 'A' && node.href) return node;
    }
    var target = event.target;
    return target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
  }

  function claim(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // Registered on window rather than document: the capture path is
  // Window -> Document -> ... , so this runs before Pake's own click handler
  // (inject/event.js, a document capture listener) gets to classify the link.
  window.addEventListener(
    'click',
    function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      // Leave modified clicks alone - Cmd/Ctrl+click is Pake's download path.
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

      var anchor = findAnchor(event);
      if (!anchor) return;
      var raw = anchor.getAttribute('href') || '';
      if (!raw || raw.charAt(0) === '#' || /^javascript:/i.test(raw)) return;

      var url;
      try {
        url = new URL(anchor.href);
      } catch (error) {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

      var destination = unwrap(url, 0);

      if (isInternalHost(destination.hostname)) {
        var watch = toWatchUrl(destination);
        if (watch) {
          claim(event);
          window.location.assign(watch);
        } else if (destination.href !== url.href) {
          // A YouTube link that was wrapped in /redirect - unwrap it so we
          // don't bounce through the interstitial.
          claim(event);
          window.location.assign(destination.href);
        }
        // Otherwise it's an ordinary in-app link: let YouTube's router and
        // Pake handle it exactly as before.
        return;
      }

      claim(event);
      openExternally(destination.href);
    },
    true,
  );

  // ---------------------------------------------------------------------------
  // B. /redirect bailout
  // ---------------------------------------------------------------------------

  function handleRedirectPage() {
    if (!isYouTubeHost(window.location.hostname)) return;
    if (window.location.pathname !== '/redirect') return;

    var q = new URL(window.location.href).searchParams.get('q');
    if (!q) return;

    var destination;
    try {
      destination = unwrap(new URL(q, window.location.origin), 0);
    } catch (error) {
      return;
    }

    if (isInternalHost(destination.hostname)) {
      window.location.replace(toWatchUrl(destination) || destination.href);
      return;
    }

    openExternally(destination.href);
    if (window.history.length > 1) window.history.back();
    else window.location.replace(HOME);
  }

  // ---------------------------------------------------------------------------
  // C. "Back to YouTube" pill
  // ---------------------------------------------------------------------------

  function goHome() {
    if (window.history.length > 1) window.history.back();
    else window.location.href = HOME;
  }

  // Styled through the CSSOM rather than a <style> element: off-site pages can
  // have a style-src CSP that would drop an injected stylesheet, and inline
  // property assignments aren't subject to it.
  function buildPill() {
    var pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.type = 'button';
    pill.textContent = '← Back to YouTube';
    pill.style.cssText = [
      'position: fixed',
      'top: 24px',
      'left: 12px',
      // Above Pake's #pake-top-dom drag strip (z-index 99999) and anything the
      // host page might stack.
      'z-index: 2147483647',
      'padding: 6px 12px',
      'border: none',
      'border-radius: 18px',
      'background: #0f0f0f',
      'color: #ffffff',
      'font: 500 13px/1.2 system-ui, -apple-system, sans-serif',
      'cursor: pointer',
      'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35)',
      'opacity: 0.9',
    ].join(';');
    pill.addEventListener('click', goHome);
    return pill;
  }

  function ensurePill() {
    var existing = document.getElementById(PILL_ID);
    if (isInternalHost(window.location.hostname)) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    var body = document.body;
    if (!body) return;
    body.appendChild(buildPill());
  }

  handleRedirectPage();
  // Self-healing on the same 1s cadence as the other injects: the host page may
  // rebuild its body, and an SPA can navigate on- or off-site without reloading.
  setInterval(ensurePill, 1000);
  ensurePill();
})();
