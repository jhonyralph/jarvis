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

The window loads the live Hub UI, so a web change you deploy on the Hub is instantly live here —
just reload. Only **native** changes (this shell) need a repackage.

### Where the address comes from

You do **not** have to set an env var. The shell resolves the Hub in this order — the rule lives in
[`src/shared/hub-config.js`](src/shared/hub-config.js) and is unit-tested there:

| # | Source | When it applies |
|---|---|---|
| 1 | **Saved in the app** (`hub-config.json` in Electron's `userData`) | you typed it on the setup screen — the most explicit, most recent action |
| 2 | `JARVIS_APP_HUB_URL` | the env the installer writes with `-HubUrl` |
| 3 | **This machine's runner** (`~/.jarvis/runner.env` → `JARVIS_HUB`) | a runner box already knows the Hub — that's how it connects |
| 4 | `http://127.0.0.1:4577` | last resort: a Hub on this same machine |

A malformed value never consumes its turn — the next valid source wins, and the skipped one is
reported instead of swallowed.

### Fixing the address without leaving the app

If the window can't reach the Hub it now opens **the setup screen** (`src/setup/setup.html`) instead
of a blank window: it shows which address it tried and where that address came from, lists every
candidate it found on the machine, and lets you **type a new one, test it, and reconnect** — no
PowerShell, no reinstall. The same screen is always available from the tray:
**Configurar endereço do Hub…**.

Saving writes `hub-config.json` and reconnects immediately (no restart). **Usar o padrão do sistema**
clears it and hands precedence back to the env/runner/default chain.

> Kept in `src/setup/` on purpose: `electron-builder.yml` packages `main.js`, `preload.js` and
> `src/**/*`. A file at the desktop root would not ship in the installer, so the recovery screen
> would exist only in a dev run.

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

### Finding the app in the OS

**Running from source already gives you a launcher.** `npm run install:desktop` finishes by creating
a shortcut that points at *this checkout*, so you press the Windows key / ⌘+Space / open the app menu,
type "Jarvis", and it opens — no packaging step, and it always runs the current code (the
"reload is the deploy" model still applies).

| OS | What it creates |
|---|---|
| Windows | `Jarvis.lnk` in the per-user Start Menu |
| macOS | a minimal `Jarvis.app` in `~/Applications` (Spotlight only indexes bundles, not scripts) |
| Linux | `~/.local/share/applications/jarvis.desktop` |

Skip it with `--no-shortcut` (`-NoShortcut` on Windows); manage it directly with
`npm run shortcut` / `npm run shortcut:remove` inside `desktop/`.

**Packaged installs** register themselves the usual way — each platform gets there differently:

| OS | Installer | How it's found |
|---|---|---|
| Windows | `Jarvis-Setup-x.y.z.exe` (NSIS) | Start Menu shortcut → **Win key → "jarvis"** |
| macOS | `.dmg` → drag to Applications | Spotlight (**⌘+Space → "jarvis"**), Launchpad |
| Linux | **`.deb`** | registers a `.desktop` entry → app menu / GNOME search |
| Linux | `.AppImage` | **portable, does NOT register itself** — it only shows up in the menu if you use [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher). Prefer the `.deb` if you want it searchable. |

`Keywords` in the Linux desktop entry also match `ai`, `agent`, `claude`, `codex`, `assistant`.

### Icon

`electron-builder` needs a bitmap (it can't use `icon.svg`), and picks up `build/icon.png`
automatically when present. Generate it once from the PWA artwork — no extra dependency, it renders
with the Electron you already have:

```sh
cd desktop && npm run icon    # apps/hub/web/icon.svg -> build/icon.png (1024x1024)
```

Commit `build/icon.png`. Without it the app builds fine but ships the **default Electron icon**.
The script needs a graphical session (it renders in a hidden window), so run it on a desktop
machine, not over a headless SSH/CI shell.

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
