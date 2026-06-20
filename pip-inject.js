// pip.js - PiP button + Alt+P shortcut for YouTube in Pake (macOS/WebKit)
(function () {
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

  setInterval(ensureButton, 1000);
  ensureButton();
})();