# Jarvis desktop (Electron shell)

A thin native **client** shell around the **existing** Jarvis web UI. It does not rewrite the
UI — it loads the **live** UI from your Hub (same "OTA / reload is the deploy" model as the
Capacitor app) and adds the native capabilities a browser can't reach. The Hub/Runner stay
authoritative; this window owns no session state.

See [`../docs/specs/DSK-01-12-desktop-design-mode.md`](../docs/specs/DSK-01-12-desktop-design-mode.md)
for the full spec and the phased plan.

> This directory is intentionally **outside** the npm workspace: it has its own toolchain
> (Electron + electron-builder) that you install here, so it **never** touches the Hub/runner
> install or CI. Mirrors `mobile/`.

## Install & run

Use the per-OS installer script — it checks Node/npm versions, installs the dependencies
(`npm ci` when a lockfile exists, `npm install` otherwise), **verifies the Electron binary
actually downloaded** (it fails silently behind a proxy), warns about missing Linux system
libraries, and can build or launch the app:

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -HubUrl "https://jarvis.your-tailnet.ts.net"
powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -Run     # install + launch
powershell -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -Build   # install + build installer
```

```sh
# macOS / Linux
./scripts/install-desktop.sh --hub https://jarvis.your-tailnet.ts.net
./scripts/install-desktop.sh --run      # install + launch
./scripts/install-desktop.sh --build    # install + build installer
```

Manual equivalent (if you prefer):

```sh
cd desktop
npm install            # pulls Electron; verify with `npm run doctor`
JARVIS_APP_HUB_URL="https://jarvis.your-tailnet.ts.net" npm start
```

Without `JARVIS_APP_HUB_URL` it points at `http://127.0.0.1:4577` (a Hub on this machine). The
window loads the live Hub UI, so a web change you deploy on the Hub is instantly live here — just
reload. Only **native** changes (this shell) need a repackage.

### `JARVIS_APP_HUB_URL` format

The value is normalized by [`src/shared/hub-url.js`](src/shared/hub-url.js) — the same rule in the
app **and** in the installer scripts, so a bad value is rejected while you're installing instead of
leaving the app spinning in its reconnect backoff on a blank window:

| You pass | You get | Why |
|---|---|---|
| *(unset)* | `http://127.0.0.1:4577` | Hub on this machine — the normal case, not a warning |
| `https://hub.ts.net/` | `https://hub.ts.net` | trailing slash / path stripped to the origin |
| `hub.ts.net` | `http://hub.ts.net` | missing scheme is the most common typo |
| `ws://hub.ts.net` | `http://hub.ts.net` | that's the **runner** address; the window loads a page |
| `file:///x`, garbage | *default + explicit reason* | never silently broken |

## Privacy (LEI 5)

The shell reaches the Hub **only over your private network** (Tailscale/loopback). There is **no
cloud relay** and no external endpoint — unlike Orca, which falls back to `relay.onorca.dev` off
-LAN. Tailscale already is the "direct" path, so no relay is needed.

## Package + auto-update

```sh
npm run dist           # electron-builder → dist/ (per-OS installers)
```

`electron-builder.yml` configures targets and the auto-update source (GitHub Releases by default;
switch to a `generic` self-hosted provider to keep it private). macOS signing/notarization and
Windows signing are **your build step** — add the certs/env before a public release.

## Status

- **Phase 0 (this):** the shell — loads the live Hub UI, auto-update, `window.jarvis` identity
  bridge. `capabilities.designMode = false`.
- **Phase 1 (next):** Design Mode — embedded `<webview>` per worktree, element grab
  (HTML+CSS+screenshot → agent), preview-URL discovery on the Runner. Flips
  `capabilities.designMode` on and adds `window.jarvis.browser`.

## Bridge contract

The UI feature-detects `window.jarvis` (see [`src/shared/bridge-types.d.ts`](src/shared/bridge-types.d.ts)).
Absent → shell `"browser"`, everything no-op — so the same `apps/hub/web` keeps working unchanged
in a plain browser and in the Capacitor shell.
