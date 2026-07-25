// titlebar-inject.js - Keep Pake's window-drag strip out of fullscreen video
//
// With --hide-title-bar, Pake injects #pake-top-dom: a transparent strip
// pinned to the top of the viewport (position:fixed; top:0; height:20px;
// z-index:99999) carrying -webkit-app-region: drag and a startDragging()
// mousedown handler, so the frameless window can still be moved.
//
// YouTube requests fullscreen on document.documentElement, so that strip is a
// descendant of the fullscreen element and keeps painting in fullscreen -
// right on top of YouTube's title/share overlay, where it swallows clicks and
// offers a grab cursor for dragging a window that can't be moved anyway.
// Hide it while any element is fullscreen; the rule is a no-op otherwise.
(function () {
  if (window.__pakeYtTitlebarInjected) return;
  window.__pakeYtTitlebarInjected = true;

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
})();
