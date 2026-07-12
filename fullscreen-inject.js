// fullscreen-inject.js - Fix YouTube fullscreen controls under Pake's polyfill
//
// pake-cli >= 3.14.0 ships a fullscreen polyfill (fullscreen.js) that bridges
// requestFullscreen to native window fullscreen. It works for sites that
// fullscreen their player element, but YouTube requests fullscreen on
// document.documentElement - and for that case the polyfill pins only the
// bare <video> on top of everything, burying YouTube's control bar (the
// "fullscreen with no controls" bug).
//
// Fix: wrap the fullscreen methods so a documentElement/body request is
// redirected to YouTube's player container (.html5-video-player, i.e.
// #movie_player). The polyfill then pins the whole player, controls included.
(function () {
  if (window.__pakeYtFsInjected) return;
  window.__pakeYtFsInjected = true;

  var METHODS = ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen'];

  function redirectTarget(el) {
    if (el !== document.documentElement && el !== document.body) return el;
    var video = document.querySelector('video');
    var player = video && video.closest('.html5-video-player');
    return player || document.getElementById('movie_player') || el;
  }

  function makeWrapper(inner) {
    function wrapper() {
      return inner.apply(redirectTarget(this), arguments);
    }
    wrapper.__pakeYtFsWrapper = true;
    return wrapper;
  }

  // Pake's polyfill installs its overrides asynchronously (it waits for
  // window.__TAURI__ and document.head), and it *replaces* the prototype
  // methods outright - clobbering any wrapper installed earlier. So instead
  // of wrapping once, re-check periodically and re-wrap whatever function is
  // currently installed. End state: wrapper(polyfill), stable from then on.
  function ensureWrapped() {
    for (var i = 0; i < METHODS.length; i++) {
      var name = METHODS[i];
      var current = Element.prototype[name];
      if (typeof current === 'function' && !current.__pakeYtFsWrapper) {
        Element.prototype[name] = makeWrapper(current);
      }
    }
  }

  setInterval(ensureWrapped, 500);
  ensureWrapped();
})();
