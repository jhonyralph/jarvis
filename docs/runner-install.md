# Adding a machine (runner)

Control several machines from one Hub. The Hub stays on your main machine; every
other machine (Windows / macOS / Linux) runs a **runner** that dials the Hub and
runs agents locally. It shows up in the Hub's machine selector.

## 1. On the Hub — mint a machine token

```powershell
.\scripts\jarvis.ps1 machine -label "Meu Mac"
```

Prints a **token**, the **Hub URL**, and the exact install command. (The token is
per-machine and revocable; see docs/security.md.)

## 2. On the new machine — prerequisites

- **Node.js >= 22**.
- **At least one supported agent CLI, authenticated**. Run `npm run agents:report`
  for the complete list and certification state. The
  runner uses the agent installed *on that machine* — no credentials cross the wire.
- **Reach the Hub**: same private network (e.g. Tailscale) or a TLS URL.
- **The repo**: `git clone` the jarvis repo (the runner shares its code).

## 3. On the new machine — install

From the cloned repo:

```powershell
# Windows
.\scripts\install-runner.ps1 -Hub "wss://<hub>/" -Token "<token>" -Label "Meu PC"
```

```sh
# macOS / Linux
./scripts/install-runner.sh -h "wss://<hub>/" -t "<token>" -l "Meu Mac"
```

**The installer runs `npm ci` for you** — you do not need a separate `npm install`
step. Concretely it: verifies Node >=22, confirms this is a Git clone whose
`origin` is reachable non-interactively, runs `npm ci` (or `npm install` when
there is no `package-lock.json`) **from the repo root, not from a sub-package**,
runs `npm run update:verify` to validate the checkout, writes
`~/.jarvis/runner.env` (Hub + token + label), and registers an autostart service:

- **Windows** — Task Scheduler task `JarvisRunner` (at logon, auto-restart).
- **macOS** — launchd agent `com.jarvis.runner` (`~/Library/LaunchAgents`).
- **Linux** — systemd `--user` unit `jarvis-runner` (`loginctl enable-linger $USER`
  to run without an active login).

The machine then appears in the Hub's machine selector. Pick it to run agents there.

### Running it by hand (no service)

Useful to debug a machine that will not register. From the repo root:

```sh
npm install          # or `npm ci` — from the ROOT, once per clone
npm run start:runner # reads ~/.jarvis/runner.env, stays in the foreground
```

`npm run start:runner` is the same entry point the service uses, so if it works
here and not as a service, the problem is the service registration — not the runner.

## What you actually have to configure

Short answer: **three values, and the installer writes all three.** The runner
reads ~25 environment variables, but everything except these has a working default
— you are not expected to set them, and `~/.jarvis/runner.env` is the only file
that normally exists:

| Variable | Required? | Default | What happens if it is missing |
|---|---|---|---|
| `JARVIS_HUB` | **yes** for a remote Hub | `ws://127.0.0.1:4577` | it dials a Hub on *this* machine and never finds yours |
| `JARVIS_TOKEN` | **yes** while Hub auth is on (the default) | *(empty)* | the Hub refuses the registration; the runner logs a warning naming this file |
| `JARVIS_LABEL` | no (cosmetic) | the hostname | the machine shows up with a less friendly name |

Everything else (`JARVIS_AGENT`, `JARVIS_CWD`, `JARVIS_EXECUTION_*`,
`JARVIS_TERMINAL_MAX`, `JARVIS_RUNNER_OUTAGE_ABORT_SEC`, …) is a **tuning knob with
a default** — see [docs/environment.md](environment.md) for the complete table.
Leave them alone unless you have a reason.

### The desktop app on a runner machine

A runner box has **no Hub of its own**, so the desktop app must be told where the
Hub is. It now works this out by itself: with no `JARVIS_APP_HUB_URL` it reads
`JARVIS_HUB` from the very `~/.jarvis/runner.env` the installer just wrote (the
`ws(s)://` address is converted to `http(s)://`). If it still cannot connect, the
app opens a **setup screen** where you type the address, test it and reconnect —
also reachable any time from the tray: **Configurar endereço do Hub…**. See
[desktop/README.md](../desktop/README.md#where-the-address-comes-from).

## Managing

- **Rename**: the ✏ next to a machine in the selector (owner).
- **Revoke a machine**: `.\scripts\jarvis.ps1 status` (see runner tokens) — a
  revoked token stops the runner from reconnecting.
- **Logs**: `~/.jarvis/runner.log` (macOS/Linux) or the Task Scheduler history
  (Windows).
- **Update**: Settings → Atualização in the Hub can target all machines. Offline
  runners retain the target and update on reconnect; runners with an older
  protocol are restricted to the update channel until they restart. For recovery,
  a manual `git pull --ff-only && npm ci && npm run update:verify` followed by a
  task/service restart is equivalent.

## Survive a reboot (start without an interactive login)

Hub and Runner already behave like a **self-restarting service**: a supervisor loop
(`start-hub.ps1` / `start-runner.ps1`) relaunches the process ~3s after any exit, backed by
the scheduled task's `RestartCount` (Windows), launchd `KeepAlive` (macOS) and systemd
`Restart=always` (Linux). So a **crash or a killed process comes back on its own**.

The one gap is a **reboot where nobody logs in**: the services start from a *user session*
(the agent CLIs authenticate in the user's profile, so running as a SYSTEM service would break
them). Close it per OS:

- **Windows — auto-login.** Run **as Administrator**:
  `powershell -ExecutionPolicy Bypass -File scripts\enable-autologin.ps1` (add `-User <conta>` for
  another account; `-Disable` reverts). The session unlocks at boot and the `AtLogOn` tasks start
  the Hub/Runner. ⚠ This unlocks the desktop for anyone with physical access, and the registry
  method stores the password in plaintext. For **encrypted** storage prefer
  [Sysinternals Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon)
  (stores it as an LSA secret). Use only on a trusted machine (e.g. behind Tailscale).
- **Linux — linger (no login at all).** `install-runner.sh` / `install-hub.sh` now run
  `loginctl enable-linger $USER` automatically; if it needed root, run `sudo loginctl enable-linger $USER`.
  With linger the systemd `--user` service starts at boot with **no login** — the preferred headless setup.
- **macOS — auto-login.** System Settings → **Users & Groups** → *Automatically log in as* → pick the
  account. The launchd agent then loads in that GUI session at boot. (No script: Apple stores the
  auto-login secret in `/etc/kcpassword`; set it through the GUI rather than hand-editing it.)

## Notes / limits

- The runner is **headless** — no voice/UI there; the single UI is the Hub.
- Sharing a machine normally means giving a shell on it (`full-access` is the default).
  For guests, run the runner in a container/VM. See docs/security.md.
- Full parity with the local machine: browse folders, pick agent/cwd for new
  sessions, open native CLI sessions, and watch them update live. **Voice (STT/TTS)
  stays Hub-only by design** — you drive a remote machine by text/typing.
