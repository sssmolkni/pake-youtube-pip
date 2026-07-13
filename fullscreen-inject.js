// fullscreen-inject.js - Native-like fullscreen for YouTube in Pake (macOS/WebKit)
//
// pake-cli >= 3.14.0 ships a fullscreen polyfill (fullscreen.js) that CSS-pins
// and reparents DOM elements. That approach is confirmed broken for YouTube
// (Pake issue #1113): YouTube requests fullscreen on document.documentElement,
// its player JS sizes the inner <video> with inline styles, and any DOM
// surgery desyncs its layout (mis-sized video, masthead stuck visible).
//
// This shim takes the opposite approach: NO DOM changes at all. It shadows
// the polyfill entirely and emulates what native documentElement fullscreen
// looks like to the page - flip the Tauri window fullscreen, report
// document.fullscreenElement, dispatch fullscreenchange - and lets YouTube's
// own engine hide the masthead, size the video, and autohide controls.
//
// Pake wraps --inject files in a DOMContentLoaded listener, so this always
// runs after the polyfill installs (it polls for __TAURI__/document.head at
// ~100ms) and can redefine its configurable descriptors. The polyfill stays
// inert: its internal state remains null, so its Esc handler and monitor
// never fire and its pinning code never runs.
(function () {
  if (window.__pakeYtFsInjected) return;
  window.__pakeYtFsInjected = true;

  var fsElement = null; // element reported as fullscreen (YouTube: documentElement)
  var opToken = 0; // invalidates stale enter/exit promises
  var pendingOp = false; // suppress the monitor while enter/exit is in flight
  var enteredAt = 0; // grace period so the macOS animation isn't read as an exit

  function appWindow() {
    return window.__TAURI__ && window.__TAURI__.window
      ? window.__TAURI__.window.getCurrentWindow()
      : null;
  }

  // Native fullscreenchange fires on the transitioned element and bubbles to
  // document, and is async - never fire in the caller's stack, and dispatch
  // only on the target so document-level listeners see exactly one event.
  function dispatchEvents(target, type, webkitType) {
    setTimeout(function () {
      [type, webkitType].forEach(function (name) {
        (target || document).dispatchEvent(new Event(name, { bubbles: true }));
      });
    }, 0);
  }

  function dispatchChange(target) {
    dispatchEvents(target, 'fullscreenchange', 'webkitfullscreenchange');
  }

  function dispatchError(target) {
    dispatchEvents(target, 'fullscreenerror', 'webkitfullscreenerror');
  }

  // The macOS fullscreen transition animates the window resize; nudge
  // YouTube's layout again after it settles.
  function nudgeResize() {
    [50, 600].forEach(function (ms) {
      setTimeout(function () {
        window.dispatchEvent(new Event('resize'));
      }, ms);
    });
  }

  function enterFullscreen(element) {
    var win = appWindow();
    if (!win) {
      return Promise.reject(new TypeError('Tauri window API unavailable'));
    }
    if (fsElement) {
      // Already fullscreen; just report the new element (native behavior).
      fsElement = element;
      dispatchChange(element);
      return Promise.resolve();
    }
    // Set state synchronously: YouTube checks fullscreenElement right after
    // calling requestFullscreen.
    fsElement = element;
    enteredAt = Date.now();
    pendingOp = true;
    var token = ++opToken;
    return win.setFullscreen(true).then(
      function () {
        if (token !== opToken) return;
        pendingOp = false;
        dispatchChange(element);
        nudgeResize();
      },
      function (error) {
        if (token === opToken) {
          pendingOp = false;
          fsElement = null;
          dispatchError(element);
        }
        throw error;
      },
    );
  }

  // skipNative: the window already left fullscreen (green traffic-light
  // button / Cmd+Ctrl+F caught by the monitor) - only sync page state.
  function exitFullscreen(skipNative) {
    if (!fsElement) return Promise.resolve();
    var element = fsElement;
    fsElement = null;
    var token = ++opToken;
    var win = appWindow();
    if (skipNative || !win) {
      dispatchChange(element);
      nudgeResize();
      return Promise.resolve();
    }
    pendingOp = true;
    return win.setFullscreen(false).then(
      function () {
        if (token !== opToken) return;
        pendingOp = false;
        dispatchChange(element);
        nudgeResize();
      },
      function (error) {
        if (token === opToken) {
          // The window is still fullscreen; restore truthful state so the
          // page and the window don't desync.
          pendingOp = false;
          fsElement = element;
          dispatchError(element);
        }
        throw error;
      },
    );
  }

  // Esc exits, like native fullscreen where the browser handles Esc before
  // the page. Stop propagation so YouTube doesn't double-exit against
  // already-cleared state.
  window.addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'Escape' && fsElement) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exitFullscreen();
      }
    },
    true,
  );

  // If the user exits fullscreen natively, sync the page out of its
  // fullscreen UI. Grace period covers the enter animation.
  setInterval(function () {
    if (!fsElement || pendingOp) return;
    if (Date.now() - enteredAt < 1500) return;
    var win = appWindow();
    if (!win) return;
    var token = opToken;
    win
      .isFullscreen()
      .then(function (isFs) {
        // token check: a poll started before a re-enter/exit must not act on
        // the newer state.
        if (!isFs && fsElement && !pendingOp && token === opToken) {
          exitFullscreen(true);
        }
      })
      .catch(function () {});
  }, 500);

  function markedRequest() {
    function requestFullscreen() {
      return enterFullscreen(this);
    }
    requestFullscreen.__pakeYtFs = true;
    return requestFullscreen;
  }

  function markedExit() {
    function docExitFullscreen() {
      return exitFullscreen();
    }
    docExitFullscreen.__pakeYtFs = true;
    return docExitFullscreen;
  }

  function defineGetter(obj, name, getter) {
    var current = Object.getOwnPropertyDescriptor(obj, name);
    if (current && current.get && current.get.__pakeYtFs) return;
    getter.__pakeYtFs = true;
    Object.defineProperty(obj, name, { get: getter, configurable: true });
  }

  // Pake's polyfill installs asynchronously and replaces this whole surface
  // outright, so re-assert instead of installing once. Everything is marked;
  // once we own the surface each tick is a handful of property reads.
  function ensureOverrides() {
    ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen'].forEach(
      function (name) {
        var current = Element.prototype[name];
        if (!current || !current.__pakeYtFs) Element.prototype[name] = markedRequest();
      },
    );
    ['exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen'].forEach(
      function (name) {
        var current = document[name];
        if (!current || !current.__pakeYtFs) document[name] = markedExit();
      },
    );
    ['fullscreenElement', 'webkitFullscreenElement', 'webkitCurrentFullScreenElement'].forEach(
      function (name) {
        defineGetter(document, name, function () {
          return fsElement;
        });
      },
    );
    ['webkitIsFullScreen', 'fullScreen'].forEach(function (name) {
      defineGetter(document, name, function () {
        return !!fsElement;
      });
    });
    ['fullscreenEnabled', 'webkitFullscreenEnabled'].forEach(function (name) {
      defineGetter(document, name, function () {
        return true;
      });
    });
  }

  setInterval(ensureOverrides, 1000);
  ensureOverrides();
})();
