// titlebar-inject.js - Tame Pake's window-drag strip
//
// With --hide-title-bar, Pake injects #pake-top-dom: a transparent strip
// pinned to the top of the viewport (position:fixed; top:0; height:20px;
// z-index:99999) carrying -webkit-app-region: drag and a startDragging()
// mousedown handler, so the frameless window can still be moved.
//
// Two things need fixing there.
//
// 1. YouTube requests fullscreen on document.documentElement, so that strip is
//    a descendant of the fullscreen element and keeps painting in fullscreen -
//    right on top of YouTube's title/share overlay, where it swallows clicks
//    and offers a grab cursor for dragging a window that can't be moved
//    anyway. Hide it while any element is fullscreen; the rule is a no-op
//    otherwise.
//
// 2. Pake also binds dblclick on the strip to a native fullscreen toggle
//    (src-tauri/src/inject/event.js). That is not what a title bar does on
//    macOS - a double-click there zooms the window - and it collides with
//    YouTube's own fullscreen, which is now driven by WebKit. Swallow the
//    event and zoom instead.
(function () {
  if (window.__pakeYtTitlebarInjected) return;
  window.__pakeYtTitlebarInjected = true;

  var STRIP_ID = 'pake-top-dom';
  var STYLE_ID = 'pake-yt-titlebar-style';
  var CSS = [
    ':fullscreen #pake-top-dom,',
    ':-webkit-full-screen #pake-top-dom {',
    '  display: none !important;',
    '}',
  ].join('\n');

  // Self-healing, matching the other injects: YouTube rebuilds large parts of
  // the DOM as you navigate, and the getElementById check keeps the tick free
  // once the style is in place.
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var head = document.head || document.documentElement;
    if (!head) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    head.appendChild(style);
  }

  setInterval(ensureStyle, 1000);
  ensureStyle();

  function tauriWindow() {
    var api = window.__TAURI__;
    return (api && api.window && api.window.getCurrentWindow && api.window.getCurrentWindow()) || null;
  }

  // Pake's handler sits on the strip itself, so a capture-phase listener on
  // the document runs first and can stop the event before it ever reaches it.
  // That also survives Pake re-creating the strip, which a listener bound to
  // the element would not.
  function onDoubleClick(event) {
    var strip = document.getElementById(STRIP_ID);
    if (!strip || !event.target || !strip.contains(event.target)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    // Zoom, the macOS default for a title-bar double-click. Drop this call to
    // make the gesture do nothing at all.
    var win = tauriWindow();
    if (win && win.toggleMaximize) win.toggleMaximize();
  }

  document.addEventListener('dblclick', onDoubleClick, true);
})();
