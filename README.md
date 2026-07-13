# pake-youtube-pip

Adds a **Picture-in-Picture button**, an **`Alt+P` keyboard shortcut**, and
**back/forward navigation** (button + shortcuts) to a
[Pake](https://github.com/tw93/Pake)-wrapped YouTube desktop app on macOS.

![screenshot placeholder](docs/screenshot.png)
<!-- TODO: replace docs/screenshot.png with a real screenshot of the PiP button
     in the YouTube player control bar. -->

## Why

Pake wraps web apps in a native WebView. When YouTube runs inside that WebView,
Safari's usual native Picture-in-Picture triggers (the right-click PiP menu and
the built-in PiP button) aren't exposed the way they are in a normal Safari tab,
so there's no obvious way to pop the video out. This injects a PiP control that
calls the WebKit/standard PiP APIs directly, restoring that capability.

## What it does

### Picture-in-Picture ([`pip-inject.js`](pip-inject.js))

- Adds a PiP button to YouTube's player control bar, immediately left of the
  fullscreen button, using YouTube's own icon styling so it looks native.
- Binds **`Alt+P`** to toggle Picture-in-Picture from anywhere in the app.
- Toggles correctly in both directions, using `webkitSetPresentationMode`
  (WebKit) with a fallback to the standard `requestPictureInPicture()` API.

### Back/forward navigation ([`nav-inject.js`](nav-inject.js))

Pake's WebView has no browser chrome, so once you click into a video there is
no obvious way back. This adds:

- A **back button** in YouTube's top bar, between the hamburger menu and the
  logo, styled like YouTube's own icon buttons. Where the WebView supports the
  Navigation API it dims when there's nothing to go back to; otherwise it stays
  enabled and clicking at the start of history is a harmless no-op.
- **`Cmd+←` / `Cmd+→`** for back/forward, matching Safari. Disabled while
  typing in a text field, where `Cmd+←` means "beginning of line".
  (Pake itself also binds **`Cmd+[` / `Cmd+]`** out of the box.)
- **Mouse back/forward buttons** (buttons 4/5 on multi-button mice).

### Fullscreen with controls ([`fullscreen-inject.js`](fullscreen-inject.js))

Fullscreening a video used to show only the bare `<video>` — no YouTube
control bar, and only `Esc` to get out. Pake ≥ 3.14.0 ships a fullscreen
polyfill, but it doesn't help YouTube: YouTube requests fullscreen on
`document.documentElement`, and for that case the polyfill CSS-pins and
reparents the raw `<video>`, which buries the control bar and desyncs
YouTube's layout (mis-sized video, masthead stuck visible). Upstream calls
DOM-moving approaches broken for YouTube
([Pake #1113](https://github.com/tw93/Pake/issues/1113)).

[`fullscreen-inject.js`](fullscreen-inject.js) instead makes that polyfill
inert and **emulates native fullscreen with zero DOM changes**: it flips the
Tauri window fullscreen, reports `document.fullscreenElement`, and dispatches
`fullscreenchange` — the same signals the page gets in a real browser.
YouTube's own engine then hides the masthead, sizes the video, shows and
auto-hides its controls as usual. Exit works via YouTube's button, `Esc`, or
leaving macOS fullscreen natively (a small monitor keeps the page in sync).

Result: the fullscreen button (and `F`) behaves exactly like YouTube in a
normal browser. Requires pake-cli ≥ 3.14.0 only because that's the version
whose polyfill this script is written to override.

## How it works (self-healing injection)

YouTube is a single-page app that constantly rebuilds its DOM (navigating
between videos, entering/leaving fullscreen, miniplayer, etc.), so a button
injected once tends to disappear. Both [`pip-inject.js`](pip-inject.js) and
[`nav-inject.js`](nav-inject.js) handle this the same way:

- A `setInterval` runs once a second and re-adds the button if it's missing.
  The check is a cheap `getElementById` first, so once the button exists the
  tick is near-free; if YouTube rebuilds the control bar (or masthead) and
  drops it, the button reappears within ~1 second.
- The PiP script only injects on `/watch` pages, and picks the **visible**
  `.ytp-right-controls` bar (YouTube keeps several in the DOM for the main
  player, miniplayer, and inline previews).
- The icons are built with DOM APIs (`createElementNS`), not `innerHTML`, to
  satisfy YouTube's Trusted Types Content-Security-Policy.

## Install (prebuilt app)

Download `YouTube.dmg` from the [Releases](../../releases) page, open it, and
drag the app to Applications.

> **Security note:** the released `.dmg` is an **unsigned, ad-hoc build** — it is
> not notarized with an Apple Developer ID. macOS Gatekeeper will warn that the
> app "cannot be opened because the developer cannot be verified." To open it:
> right-click the app → **Open** → **Open**, or allow it under
> **System Settings → Privacy & Security**. If you'd rather not trust a prebuilt
> binary, build it yourself with the steps below — the source is right here.

## Build it yourself

The app is produced with the [Pake](https://github.com/tw93/Pake) CLI, injecting
[`pip-inject.js`](pip-inject.js), [`nav-inject.js`](nav-inject.js), and
[`fullscreen-inject.js`](fullscreen-inject.js) into a YouTube wrapper.

1. Install the Pake CLI (requires Rust + Node; see Pake's docs for
   prerequisites). **Use pake-cli 3.14.0 or newer** — older versions lack the
   fullscreen polyfill, so fullscreen video loses YouTube's controls:

   ```sh
   npm install -g pake-cli@latest
   ```

2. Build the app, injecting all three scripts:

   ```sh
   pake https://www.youtube.com/ --inject pip-inject.js,nav-inject.js,fullscreen-inject.js --hide-title-bar
   ```

   This produces `YouTube.dmg` in the working directory.

See the [Pake CLI documentation](https://github.com/tw93/Pake/blob/master/bin/README.md)
for all available flags (icon, window size, user agent, etc.).

## Credits

This project distributes an application built with
**[Pake](https://github.com/tw93/Pake)** by [tw93](https://github.com/tw93).

Pake is open source under **GPL-3.0**. Its README states:

> "Pake is open source under GPL-3.0, see LICENSE and Pake Output Exception;
> apps you build with Pake are entirely yours to use and distribute."

Under that **Pake Output Exception**, applications you build with Pake (such as
the `YouTube.dmg` distributed here) are not bound by GPL-3.0 and are yours to
use and distribute. See Pake's [LICENSE](https://github.com/tw93/Pake/blob/master/LICENSE).

"YouTube" is a trademark of Google LLC. This project is not affiliated with,
endorsed by, or sponsored by Google or YouTube.

## License

The original injection scripts ([`pip-inject.js`](pip-inject.js),
[`nav-inject.js`](nav-inject.js), [`fullscreen-inject.js`](fullscreen-inject.js))
are licensed
**MIT** — see [LICENSE](LICENSE). The bundled `YouTube.dmg` is a Pake build
output, covered by the Pake Output Exception described above, not by this MIT
license.
