# Jarvis

Self-hosted, **agent-agnostic**, voice-first control plane for coding agents
(Claude Code, Codex). Drive your agents from **your phone or any desktop**, with
a **local voice** — and keep every byte on your own machines.

> Codename `jarvis` = the whole control plane, not just the voice.

## Why this exists

Off-the-shelf options are archived, pre-release, or keep your data on someone
else's servers. This is the opposite:

- **Nothing on third parties.** Sessions, transcripts and audio stay on your
  machines, as plain files under `~/.jarvis`. The network is **Tailscale only**
  by default — a private WireGuard mesh, nothing exposed publicly.
- **Voice is local** (Piper TTS on your hardware). No ElevenLabs.
- The only thing leaving your machine is the **agent's own inference** (Claude /
  Codex) — which you already use directly today.
- **It reads your real sessions.** Jarvis doesn't invent its own history: it
  opens the same `~/.claude` sessions your terminal uses, so a conversation
  started in the CLI continues on your phone, and vice-versa.

## How it works

```
 phone / any browser  ─┐
                       │  Tailscale (private)
                       ▼
                   ┌────────┐   serves the web UI · local voice (TTS)
                   │  HUB   │   auth + audit · routing · local files
                   └────────┘   ONE per setup
                       │
        ┌──────────────┼──────────────┐   (each machine registers as a Runner)
        ▼              ▼              ▼
    RUNNER A       RUNNER B       RUNNER C
   claude-code      codex        claude-code      … N machines
```

- **Hub** — one machine (your always-on desktop). Serves the UI, holds the data,
  authenticates devices, routes work to runners. The Hub is also a runner for
  its own machine.
- **Runner** — any other machine you want to drive. Headless; runs the agent CLI
  locally, so it uses *that* machine's files, repos and agent login.
- **Client** — the web UI, in any mobile or desktop browser. No app store, no
  build step. (A service worker powers push notifications; there's no manifest,
  so it isn't an installable PWA — you just open the URL.)

Everything external enters through a swappable adapter (`AgentAdapter`,
`TTSAdapter`, `Transport`) — see [`packages/protocol`](packages/protocol/src) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What you get

| | |
|---|---|
| **Talk to it** | Push-to-talk or wake word; replies spoken back with a local voice. Long replies are summarised aloud instead of read out in full. |
| **Your real sessions** | Reads and continues native `claude` sessions. Start in the terminal, continue on the phone. |
| **Many machines** | Switch machines in the UI; each runs on its own hardware and agent login. |
| **See the work** | Live tool activity (editing/creating/reading), sub-agents, `+3 −5` line counts, inline diffs, and a file viewer with syntax highlighting. |
| **Ask what's up** | Spoken digest across all sessions and machines, or a summary of one conversation. |
| **Stay in budget** | Context window + plan-limit (5h / weekly) indicator. |
| **Locked down** | Device pairing by invite, owner passphrase (2nd factor), expiring access, audit log, rate limiting. |
| **Self-healing** | Hub and runners come back on their own after a crash or reboot; update from the UI. |

## Requirements

- **Node.js >= 22** on every machine.
- **An agent CLI, logged in**, on every machine that should do work:
  `claude` ([Claude Code](https://claude.com/claude-code)) and/or `codex`.
  Verify with `claude -p "ok"` — if that fails, Jarvis can't run it either.
- **[Tailscale](https://tailscale.com)** (recommended) so your devices reach the
  Hub privately.
- Voice (optional): Python + [Piper](https://github.com/rhasspy/piper) — see
  [`services/voice`](services/voice).

## Install

### 1. The Hub (one machine)

```sh
git clone https://github.com/jhonyralph/jarvis && cd jarvis
```

**Guided setup (recommended)** — one command that installs deps, writes config,
registers the autostart service, starts the Hub, prints your **claim code**, and
ends with a health check:

```sh
# macOS / Linux
sh scripts/jarvis-setup.sh
```
```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\jarvis-setup.ps1
```

Or do it by hand:

```sh
# macOS / Linux
sh scripts/install-hub.sh
```

```powershell
# Windows
npm install
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
Start-ScheduledTask -TaskName JarvisHub
```

This installs dependencies, writes `~/.jarvis/hub.env`, and registers a service
that starts the Hub at logon and brings it back if it dies. The UI is on
**http://localhost:4577**.

Not sure a machine is set up right? Run the read-only doctor — it checks the
runtime, agent CLI, ports, config, `/health`, autostart, Tailscale and the voice
deps, and prints a fix for anything missing:

```sh
./scripts/jarvis-doctor.sh          # or `runner` on a runner box
```
```powershell
powershell -ExecutionPolicy Bypass -File scripts\jarvis-doctor.ps1
```

Reach it from your other devices with Tailscale:

```sh
tailscale serve --bg http://127.0.0.1:4577
```

Read [docs/security.md](docs/security.md) before exposing it any other way.

### 2. Pair your phone / laptop

The first device to connect claims ownership. After that, invite devices:

```sh
sh scripts/jarvis.sh owner      # invite for you (owner)
sh scripts/jarvis.sh invite     # invite for another device
```
```powershell
powershell -File scripts\jarvis.ps1 owner
```

Open the printed link on the device. The UI can also mint these: 🔐 → **＋
Adicionar máquina**.

### 3. More machines (runners)

On the **Hub**, mint a token; then set up the other machine:

```sh
sh scripts/jarvis.sh machine "Laptop"        # prints the token
```

```sh
# on the OTHER machine
git clone https://github.com/jhonyralph/jarvis && cd jarvis
sh scripts/install-runner.sh --hub "wss://<hub-host>/" --token "<token>" --label "Laptop"
```
```powershell
powershell -File scripts\install-runner.ps1 -Hub "wss://<hub-host>/" -Token "<token>" -Label "Laptop"
```

The installer registers a background service (launchd / systemd / Scheduled
Task), stops anything already running, and starts it — it should appear in the
machine selector within seconds. Details in
[docs/runner-install.md](docs/runner-install.md).

## Day to day

The `jarvis` CLI talks to the Hub's **loopback-only** admin API, so it works only
from the Hub machine itself — which is what makes it a safe recovery path.

| Command | What |
|---|---|
| `jarvis.sh owner` / `invite` | New device invite (owner / member) |
| `jarvis.sh machine "<label>"` | Runner token for another machine |
| `jarvis.sh status` | Devices, invites, guard stats |
| `jarvis.sh audit [n]` | Audit log |
| `jarvis.sh update` / `update-apply` / `update-rollback` | Update the Hub (it restarts) |
| `jarvis.sh revoke <deviceId>` | Kill a device's access |
| `jarvis.sh passphrase-clear` | Forgot the owner passphrase |
| `jarvis.sh claimcode` | Claim code, if nobody claimed it yet |

Windows: `powershell -File scripts\jarvis.ps1 <same command>`.

Runners update from the UI — they pull and restart themselves. An update
**aborts on a dirty git tree**, on purpose: it will not throw away local changes.

## Configuration

Config lives in `~/.jarvis/hub.env` (Hub) and `~/.jarvis/runner.env` (runners).
Everything is an env var — no secrets in the repo.

| Var | Default | What |
|---|---|---|
| `JARVIS_PORT` | `4577` | UI + WebSocket port |
| `JARVIS_ADMIN_PORT` | `4578` | Loopback-only admin API |
| `JARVIS_AGENT` | `mock` | Default agent (`claude-code`, `codex`, `mock`). The installer writes `claude-code` into `hub.env`, so that's what you get in practice |
| `JARVIS_AUTH` | `on` | Device auth. **Only** turn this off on a trusted private network |
| `JARVIS_CWD` | process cwd | Default working directory for agents |
| `JARVIS_VOICE` | — | Piper voice model |
| `JARVIS_SUMMARY_MODEL` | `haiku` | Model for spoken summaries/digest (cheap on purpose) |
| `JARVIS_HISTORY_CAP` | `120` | Messages sent when opening a session |
| `JARVIS_SESSION_COST_CAP` | `0` | Per-session USD spend cap (`0` = off). A turn is refused before it runs once the session's cumulative cost reaches this — a runaway can't keep spending unattended |
| `JARVIS_PUBLIC_URL` | — | Base URL used in invite links |
| `JARVIS_REQUIRE_TLS` / `JARVIS_TRUST_PROXY` | off | Set both when behind a TLS proxy |
| `JARVIS_AUDIT_MAX_MB` | `5` | Audit-log rotation cap. At the size the current `audit.log` becomes `audit.log.1` (one generation kept) and a fresh log starts |
| `JARVIS_HUB` / `JARVIS_TOKEN` / `JARVIS_LABEL` | — | Runner: where to connect, and as whom |

The Hub also answers an unauthenticated `GET /health` (`/healthz`) on the UI port
returning `{ok,uptime,runners}` — for a monitor, `tailscale serve` health, or a load
balancer. It leaks only coarse status (no hostnames/ids).

More knobs (rate limits, TTS tuning, wake word, voice gate) are read straight
from the environment — `grep -r JARVIS_ apps packages` for the full list.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Machine shows **⚠ sem IA** | The agent isn't authenticated *there*. Run `claude auth login` on that machine and confirm with `claude -p "ok"`. |
| `401 ... OAuth access token has been revoked` | Same thing — that's the agent CLI's login, not a Jarvis token. `claude auth logout && claude auth login`. |
| Update says *"alterações locais não commitadas"* | That machine's clone is dirty. Working as intended: commit, or `git reset --hard origin/main` there. |
| Switching sessions is slow on a remote machine | Usually the network, not the code. `tailscale status`: if the peer says `relay` instead of `direct`, traffic is bouncing through a DERP relay. `tailscale netcheck` on both ends shows which side blocks UDP. |
| A runner terminal window won't go away | It's being started by hand. Use the service (`Start-ScheduledTask JarvisRunner` / `systemctl --user start jarvis-runner`) and close the terminal. |

## Development

```sh
npm install
npm --prefix apps/hub start        # Hub    (tsx, no build step)
npm --prefix apps/runner start     # Runner
```

The run path uses `tsx`, which strips types without checking them, so type
errors only surface if you ask. Do that before pushing (CI runs the same on
every push/PR — see `.github/workflows/ci.yml`):

```sh
npm run typecheck   # tsc --noEmit across every package + app
npm test            # node --test (persistence, store, native parsers, auth, guard)
npm run check       # both of the above
```

State is persisted as **crash-safe JSON** via `writeJsonAtomic`
([`packages/core/src/persist.ts`](packages/core/src/persist.ts)): temp-file +
fsync + atomic rename with a `.bak`, so a crash mid-write can't corrupt or lose
a session file (it recovers from the backup). Not SQLite — no native deps, which
keeps `npm install` trivial across a heterogeneous runner fleet.

The web client is a single hand-written
[`apps/hub/web/index.html`](apps/hub/web/index.html) — no framework, no bundler.
It's served with no-cache, so **reloading is the deploy**. Server code needs a
service restart (tsx does not hot-reload).

| Path | What |
|---|---|
| `packages/protocol/` | Shared contracts: adapter interfaces + WS protocol |
| `packages/core/` | Agents, session store, native-session reader, diffing, updates |
| `apps/hub/` | Hub server + the web client (`web/index.html`) |
| `apps/runner/` | Headless runner |
| `services/voice/` | Python: local Piper TTS |
| `scripts/` | Installers, launchers, `jarvis` admin CLI |
| `docs/` | [architecture](docs/ARCHITECTURE.md) · [setup](docs/setup.md) · [security](docs/security.md) · [runners](docs/runner-install.md) · [multi-runner](docs/multi-runner.md) · [sandbox](docs/runner-sandbox.md) · [updates](docs/updates.md) |

## Security

Auth is on by default: devices pair by invite, the owner can require a passphrase
as a second factor, access can expire, and everything is audited. The admin API
binds to loopback only. Read [docs/security.md](docs/security.md) before exposing
the Hub beyond Tailscale.

Found a security problem? Please open an issue — without a working exploit in it.

## Status & license

Personal project, used daily, built in the open. Expect rough edges, and
Portuguese in the UI and in some scripts' output. Issues and PRs welcome.

No license yet, which legally means **all rights reserved**: you can read it and
try it, but no usage rights are granted until a license lands.
