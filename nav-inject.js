// nav-inject.js - Back button + navigation shortcuts for YouTube in Pake (macOS/WebKit)
(function () {
  // Guard against double injection: a second run would double-fire the
  // shortcut listeners (navigating back twice per keypress) and leak intervals.
  if (window.__pakeNavInjected) return;
  window.__pakeNavInjected = true;

  function goBack() {
    window.history.back();
  }

  function goForward() {
    window.history.forward();
  }

  function isEditingText(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  // Cmd+Left / Cmd+Right, matching Safari. Skipped while typing, where
  // Cmd+Left means "beginning of line" on macOS. Pake's own Cmd+[ / Cmd+]
  // bindings are unaffected. Capture phase so YouTube's own handlers can't
  // swallow the event with stopPropagation() before it reaches us.
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
    const key = e.code || e.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    if (isEditingText(e.target)) return;
    e.preventDefault();
    if (key === 'ArrowLeft') goBack();
    else goForward();
  }, true);

  // Mouse back/forward buttons (buttons 4/5, reported as e.button 3/4).
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) {
      e.preventDefault();
      goBack();
    } else if (e.button === 4) {
      e.preventDefault();
      goForward();
    }
  }, true);

  function injectStyle() {
    if (document.getElementById('pake-nav-style')) return;
    const style = document.createElement('style');
    style.id = 'pake-nav-style';
    style.textContent = `
      #pake-back-btn {
        width: 40px;
        height: 40px;
        margin-right: 4px;
        padding: 8px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--yt-spec-icon-inactive, #606060);
        cursor: pointer;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #pake-back-btn:hover {
        background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
      }
      #pake-back-btn[disabled] {
        opacity: 0.3;
        cursor: default;
        background: transparent;
      }
    `;
    document.head.appendChild(style);
  }

  // Material "arrow back" icon, same 24x24 sizing as YouTube's masthead icons,
  // fill=currentColor so it follows light/dark. Built with DOM APIs, not
  // innerHTML, to satisfy YouTube's Trusted Types CSP.
  function buildBackIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('height', '24');
    svg.setAttribute('width', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z');
    svg.appendChild(path);
    return svg;
  }

  // Dim the button when the session has nowhere to go back to. The Navigation
  // API isn't available in all WebKit builds, so fall back to always-enabled
  // (clicking is then a harmless no-op at the start of history).
  function updateBackState(button) {
    if (window.navigation && typeof window.navigation.canGoBack === 'boolean') {
      button.toggleAttribute('disabled', !window.navigation.canGoBack);
    }
  }

  function injectBackButton(start) {
    injectStyle();

    const backButton = document.createElement('button');
    backButton.id = 'pake-back-btn';
    backButton.type = 'button';
    backButton.title = 'Back (⌘←)';
    backButton.setAttribute('aria-label', 'Back');
    backButton.appendChild(buildBackIcon());
    backButton.addEventListener('click', goBack);
    updateBackState(backButton);

    // Place it between the guide (hamburger) button and the YouTube logo.
    const logo = start.querySelector('ytd-topbar-logo-renderer');
    if (logo) {
      start.insertBefore(backButton, logo);
    } else {
      start.appendChild(backButton);
    }
  }

  // Self-healing: once a second, ensure the button exists in the masthead.
  // The getElementById check runs first, so once present this is near-free;
  // if YouTube ever rebuilds the masthead and drops it, it reappears within ~1s.
  function ensureButton() {
    const existing = document.getElementById('pake-back-btn');
    if (existing) {
      updateBackState(existing);
      return;
    }
    const start = document.querySelector('ytd-masthead #start');
    if (start) injectBackButton(start);
  }

  setInterval(ensureButton, 1000);
  ensureButton();
})();
