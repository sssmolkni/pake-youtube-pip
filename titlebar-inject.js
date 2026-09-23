// titlebar-inject.js - Tame Pake's window-drag strip
//
// With --hide-title-bar, Pake injects #pake-top-dom: a transparent strip
// pinned to the top of the viewport (position:fixed; top:0; height:20px;
// z-index:99999) carrying -webkit-app-region: drag and a startDragging()
// mousedown handler, so the frameless window can still be moved.
//
// Four things need fixing here.
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
//
// 3. The traffic lights float over the page (y 8-24pt). Pake's style.js pads
//    YouTube's masthead by 12px to make room, which leaves the guide button's
//    40px hover circle touching them, and it doesn't pad the guide drawer's
//    own header row, so opening the guide jumps the button and logo back up.
//    Use one inset for both rows and tell YouTube the masthead is taller, so
//    the page, mini guide and drawer items all start below it.
//
// 4. Guard against a degenerate restored window size. Pake restores the
//    saved size with NSWindow setContentSize:, which ignores the minimum
//    size, so a stale 2x2 entry in .window-state.json makes the app launch
//    with no visible window at all.
(function () {
  if (window.__pakeYtTitlebarInjected) return;
  window.__pakeYtTitlebarInjected = true;

  var STRIP_ID = 'pake-top-dom';
  var STYLE_ID = 'pake-yt-titlebar-style';
  var TITLE_BAR_INSET = 20;
  var MASTHEAD_HEIGHT = 56 + TITLE_BAR_INSET;
  var CSS = [
    ':fullscreen #pake-top-dom,',
    ':-webkit-full-screen #pake-top-dom {',
    '  display: none !important;',
    '}',
    'html, ytd-app {',
    '  --ytd-masthead-height: ' + MASTHEAD_HEIGHT + 'px !important;',
    '}',
    'ytd-masthead > #container.ytd-masthead,',
    'tp-yt-app-drawer #header {',
    '  padding-top: ' + TITLE_BAR_INSET + 'px !important;',
    '}',
    '#background.ytd-masthead {',
    '  height: ' + MASTHEAD_HEIGHT + 'px !important;',
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

  function fixDegenerateWindowSize() {
    if (window.top !== window) return;
    if (window.innerWidth >= 400 && window.innerHeight >= 300) return;
    var api = window.__TAURI__;
    var win = tauriWindow();
    if (!win || !api.dpi || !api.dpi.LogicalSize) return;
    win.setSize(new api.dpi.LogicalSize(1200, 780)).then(function () {
      return win.center();
    }).catch(function () {});
  }

  fixDegenerateWindowSize();

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
