// pip-inject.js - PiP button, Alt+P shortcut, and window handling for YouTube
// in Pake (macOS/WebKit)
//
// Entering PiP drops the app window to the bottom window level so it sits
// behind everything else, and the PiP overlay's "return to full picture"
// button brings it back to the front.
//
// The window is *not* hidden or minimized, and that is the whole design
// constraint. macOS only completes the PiP-to-inline transition into a window
// that is still ordered in and rendered. With the window hidden (or
// miniaturized) the "return to full picture" button does nothing at all - and
// no presentation-mode event fires either, so there is no signal to react to;
// the transition is queued and only runs once the window is on screen again.
// Both were measured against this app. Dropping the window level keeps it
// rendered, so the transition completes normally and the event arrives.
(function () {
  // A second run would double-bind Alt+P (toggling PiP twice per press) and
  // leak an interval.
  if (window.__pakePipInjected) return;
  window.__pakePipInjected = true;

  // WebKit settles the paused state a moment after the mode change, and that
  // state is what tells the overlay's two buttons apart.
  var EXIT_SETTLE_MS = 250;

  // Whether PiP is active, as far as this script is concerned. Keeps the
  // window transitions idempotent: WebKit's webkitpresentationmodechanged and
  // the standard enter/leave events both fire on the same transition, and the
  // poll below re-checks the same thing every second.
  var inPiP = false;
  // The element that went into PiP, kept so the exit path can read its paused
  // state once WebKit has settled.
  var pipVideo = null;

  function tauriWindow() {
    var api = window.__TAURI__;
    return (api && api.window && api.window.getCurrentWindow && api.window.getCurrentWindow()) || null;
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // YouTube keeps several <video> elements around for hover previews and the
  // miniplayer; the main player's is the one PiP should act on.
  function findMainVideo() {
    return (
      document.querySelector('#movie_player video.html5-main-video') ||
      document.querySelector('video.html5-main-video') ||
      document.querySelector('video')
    );
  }

  function isVideoInPiP(video) {
    return (
      video.webkitPresentationMode === 'picture-in-picture' ||
      document.pictureInPictureElement === video
    );
  }

  async function togglePiP() {
    try {
      var video = findMainVideo();
      if (!video) return;

      if (video.webkitPresentationMode === 'picture-in-picture') {
        video.webkitSetPresentationMode('inline');
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else if (
        video.webkitSupportsPresentationMode &&
        typeof video.webkitSetPresentationMode === 'function'
      ) {
        video.webkitSetPresentationMode('picture-in-picture');
      }
    } catch (error) {
      console.error('Pake PiP: toggle failed:', error);
    }
  }

  // Sinking the window mid-fullscreen-transition confuses macOS, which is why
  // Pake's own close handler exits fullscreen first. WebKit usually drops
  // element fullscreen on PiP entry by itself, but not always.
  async function sinkWindow() {
    var win = tauriWindow();
    if (!win) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        await delay(300);
      }
      await win.setAlwaysOnBottom(true);
    } catch (error) {
      console.error('Pake PiP: failed to lower window:', error);
    }
  }

  // Called for every exit, whichever button was used. Clearing the window
  // level is unconditional - leaving it pinned to the bottom would strand the
  // window behind every other app with no way to raise it.
  //
  // Only "return to full picture" should then bring the window forward; the X
  // button means "done with this video" and shouldn't steal focus. The two are
  // distinguishable only by playback state: X pauses, return keeps playing.
  async function raiseWindow(video) {
    var win = tauriWindow();
    if (!win) return;
    try {
      await win.setAlwaysOnBottom(false);
      await delay(EXIT_SETTLE_MS);
      if (video && video.paused) return;

      // show()/unminimize() cover the window having been closed (Pake hides
      // rather than closes on macOS) or minimized by hand while PiP ran.
      await win.unminimize().catch(function () {});
      await win.show();
      await win.setFocus();
      var app = window.__TAURI__ && window.__TAURI__.app;
      if (app && app.show) await app.show();
    } catch (error) {
      console.error('Pake PiP: failed to restore window:', error);
    }
  }

  function setPiPState(active, video) {
    if (active === inPiP) return;
    inPiP = active;
    if (active) {
      pipVideo = video || pipVideo;
      sinkWindow();
      return;
    }
    var exited = pipVideo;
    pipVideo = null;
    raiseWindow(exited);
  }

  // YouTube swaps the <video> element on SPA navigation, so wiring has to be
  // re-checked rather than done once. The WeakSet keeps it to one listener set
  // per element and lets discarded elements be collected.
  var wired = new WeakSet();

  function wireVideo(video) {
    if (wired.has(video)) return;
    wired.add(video);
    video.addEventListener('webkitpresentationmodechanged', function () {
      setPiPState(video.webkitPresentationMode === 'picture-in-picture', video);
    });
    video.addEventListener('enterpictureinpicture', function () {
      setPiPState(true, video);
    });
    video.addEventListener('leavepictureinpicture', function () {
      setPiPState(false, video);
    });
  }

  function syncVideos() {
    var videos = document.querySelectorAll('video');
    var anyInPiP = false;
    for (var i = 0; i < videos.length; i++) {
      wireVideo(videos[i]);
      if (isVideoInPiP(videos[i])) anyInPiP = true;
    }
    // Backstop for a missed event: an off-screen window has its timers
    // throttled to ~2s, so this reconciles a moment later rather than
    // instantly. Only used on the way out - entering always goes through an
    // event. It runs the same paused check, so it won't pull the window
    // forward behind a PiP the user just closed.
    if (inPiP && !anyInPiP) setPiPState(false);
  }

  function isEditingText(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  window.addEventListener('keydown', function (e) {
    if (!e.altKey || e.code !== 'KeyP') return;
    // Alt+P is a printable character on macOS; leave it alone while typing.
    if (isEditingText(e.target)) return;
    e.preventDefault();
    togglePiP();
  });

  // YouTube can have several .ytp-right-controls in the DOM (main player,
  // miniplayer, inline previews). Pick the one actually rendered on screen.
  function findVisibleControls() {
    var bars = document.querySelectorAll('.ytp-right-controls');
    for (var i = 0; i < bars.length; i++) {
      var rect = bars[i].getBoundingClientRect();
      if (bars[i].offsetParent !== null && rect.width > 0 && rect.height > 0) {
        return bars[i];
      }
    }
    return null;
  }

  // Mirror YouTube's own native PiP button icon exactly (same path + 24x24
  // attributes, fill=currentColor so it matches light/dark). Built with DOM
  // APIs, not innerHTML, to satisfy YouTube's Trusted Types CSP.
  function buildPiPIcon() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('height', '24');
    svg.setAttribute('width', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');

    var path = document.createElementNS(NS, 'path');
    path.setAttribute(
      'd',
      'M1 6a2 2 0 012-2h18a2 2 0 012 2v12a2 2 0 01-2 2H3a2 2 0 01-2-2V6Zm2 0v12h18V6H3Zm16 6h-6v4h6v-4Z',
    );
    svg.appendChild(path);
    return svg;
  }

  function injectPiPButton(controls) {
    var pipButton = document.createElement('button');
    pipButton.id = 'pake-pip-btn';
    pipButton.className = 'ytp-button';
    pipButton.title = 'Picture in Picture (Alt+P)';
    pipButton.appendChild(buildPiPIcon());
    pipButton.addEventListener('click', togglePiP);

    // Place it immediately LEFT of the Fullscreen button. Inserting it into
    // fullscreen's parent (.ytp-right-controls-right) puts it in the same flex
    // group as the native icons, which fixes alignment automatically. Falls
    // back to the front of the bar on older layouts without that structure.
    var fullscreen = controls.querySelector('.ytp-fullscreen-button');
    if (fullscreen && fullscreen.parentNode) {
      fullscreen.parentNode.insertBefore(pipButton, fullscreen);
    } else {
      controls.insertBefore(pipButton, controls.firstChild);
    }
  }

  // Self-healing: once a second, ensure the button exists on watch pages.
  // The getElementById check runs first, so once present this is near-free;
  // if YouTube ever rebuilds the bar and drops it, it reappears within ~1s.
  function ensureButton() {
    if (document.getElementById('pake-pip-btn')) return;
    if (!window.location.pathname.startsWith('/watch')) return;
    var controls = findVisibleControls();
    if (controls) injectPiPButton(controls);
  }

  function tick() {
    ensureButton();
    syncVideos();
  }

  // A page load can never happen mid-PiP (navigating away tears the video
  // down), so an always-on-bottom window at startup is leftover state from a
  // reload that raced a PiP session. Clear it, or the window stays buried.
  function resetWindowLevel() {
    var win = tauriWindow();
    if (win) win.setAlwaysOnBottom(false).catch(function () {});
  }

  resetWindowLevel();
  setInterval(tick, 1000);
  tick();
})();
