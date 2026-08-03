// pip.js - PiP button + Alt+P shortcut for YouTube in Pake (macOS/WebKit)
//
// Entering PiP also hides the app window, and leaving PiP brings it back. Pake
// keeps the webview alive when the window goes away (macOS `hide_on_close`
// hides instead of closing), so the video keeps playing either way; without
// this, the full-size window just sits on top of the PiP overlay, and coming
// back from PiP returns the video to a window you can't see.
(function () {
  // Whether PiP is currently active, as far as this script is concerned. Used
  // to make hide/show idempotent - WebKit and the standard API both fire on the
  // same transition, and the poll below re-checks it once a second.
  var inPiP = false;

  function tauri() {
    return window.__TAURI__;
  }

  function appWindow() {
    var api = tauri();
    return (api && api.window && api.window.getCurrentWindow && api.window.getCurrentWindow()) || null;
  }

  // Hiding the window mid-fullscreen-transition leaves macOS with an empty
  // Space, which is why Pake's own close handler exits fullscreen first. WebKit
  // usually drops element fullscreen on PiP entry by itself, but not always.
  async function hideAppWindow() {
    var win = appWindow();
    if (!win) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      await win.hide();
    } catch (error) {
      console.error('Pake PiP: failed to hide window:', error);
    }
  }

  // unminimize() covers a window the user sent to the Dock; app.show() is
  // needed on macOS because show() alone won't bring forward an application
  // AppKit considers hidden.
  async function showAppWindow() {
    var win = appWindow();
    if (!win) return;
    try {
      await win.unminimize().catch(() => {});
      await win.show();
      await win.setFocus();
      var api = tauri();
      if (api && api.app && api.app.show) await api.app.show();
    } catch (error) {
      console.error('Pake PiP: failed to restore window:', error);
    }
  }

  function setPiPState(active) {
    if (active === inPiP) return;
    inPiP = active;
    if (active) hideAppWindow();
    else showAppWindow();
  }

  function isVideoInPiP(video) {
    return (
      video.webkitPresentationMode === 'picture-in-picture' ||
      document.pictureInPictureElement === video
    );
  }

  async function togglePiP() {
    try {
      const video = document.querySelector('video');
      if (!video) return;

      if (video.webkitPresentationMode === "picture-in-picture") {
        video.webkitSetPresentationMode("inline");
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else if (video.webkitSupportsPresentationMode && typeof video.webkitSetPresentationMode === "function") {
        video.webkitSetPresentationMode("picture-in-picture");
      }
    } catch (error) {
      console.error("Pake PiP Error:", error);
    }
  }

  // YouTube swaps the <video> element on SPA navigation, so wiring has to be
  // re-checked rather than done once. The WeakSet keeps it to one listener set
  // per element and lets discarded elements be collected.
  var wired = new WeakSet();

  function wireVideo(video) {
    if (wired.has(video)) return;
    wired.add(video);
    video.addEventListener('webkitpresentationmodechanged', () => {
      setPiPState(video.webkitPresentationMode === 'picture-in-picture');
    });
    video.addEventListener('enterpictureinpicture', () => setPiPState(true));
    video.addEventListener('leavepictureinpicture', () => setPiPState(false));
  }

  function wireVideos() {
    var videos = document.querySelectorAll('video');
    var anyInPiP = false;
    for (var i = 0; i < videos.length; i++) {
      wireVideo(videos[i]);
      if (isVideoInPiP(videos[i])) anyInPiP = true;
    }
    // Backstop for a missed event: WebKit throttles a hidden window, so if the
    // presentation-mode event never lands, this reconciles within a second.
    // Only ever used to restore - entering PiP always goes through an event.
    if (inPiP && !anyInPiP) setPiPState(false);
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyP') {
      e.preventDefault();
      togglePiP();
    }
  });

  // YouTube can have several .ytp-right-controls in the DOM (main player,
  // miniplayer, inline previews). Pick the one actually rendered on screen.
  function findVisibleControls() {
    const bars = document.querySelectorAll('.ytp-right-controls');
    for (const bar of bars) {
      const rect = bar.getBoundingClientRect();
      if (bar.offsetParent !== null && rect.width > 0 && rect.height > 0) {
        return bar;
      }
    }
    return null;
  }

  // Mirror YouTube's own native PiP button icon exactly (same path + 24x24
  // attributes, fill=currentColor so it matches light/dark). Built with DOM
  // APIs, not innerHTML, to satisfy YouTube's Trusted Types CSP.
  function buildPiPIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('height', '24');
    svg.setAttribute('width', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M1 6a2 2 0 012-2h18a2 2 0 012 2v12a2 2 0 01-2 2H3a2 2 0 01-2-2V6Zm2 0v12h18V6H3Zm16 6h-6v4h6v-4Z');
    svg.appendChild(path);
    return svg;
  }

  function injectPiPButton(controls) {
    const pipButton = document.createElement('button');
    pipButton.id = 'pake-pip-btn';
    pipButton.className = 'ytp-button';
    pipButton.title = 'Picture in Picture (Alt+P)';
    pipButton.appendChild(buildPiPIcon());
    pipButton.addEventListener('click', togglePiP);

    // Place it immediately LEFT of the Fullscreen button. Inserting it into
    // fullscreen's parent (.ytp-right-controls-right) puts it in the same flex
    // group as the native icons, which fixes alignment automatically. Falls
    // back to the front of the bar on older layouts without that structure.
    const fullscreen = controls.querySelector('.ytp-fullscreen-button');
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
    const controls = findVisibleControls();
    if (controls) injectPiPButton(controls);
  }

  function tick() {
    ensureButton();
    wireVideos();
  }

  setInterval(tick, 1000);
  tick();
})();
