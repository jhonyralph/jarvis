# Jarvis

Self-hosted, **agent-agnostic**, voice-first control plane for coding-agent CLIs.
Drive them from **your phone or any desktop**, with
a **local voice by default** — and keep control-plane data on your own machines.

> Codename `jarvis` = the whole control plane, not just the voice.

## Why this exists

Off-the-shelf options are archived, pre-release, or keep your data on someone
else's servers. This is the opposite:

- **Control-plane data stays local.** Sessions, transcripts and audio stay on your
  machines, as plain files under `~/.jarvis`. The network is **Tailscale only**
  by default — a private WireGuard mesh, nothing exposed publicly.
- **Voice is local by default** (Piper TTS on your hardware). OpenAI TTS is optional for richer voice profiles when you configure your own API key. No ElevenLabs.
- The only application traffic leaving your machine is the **chosen provider
  CLI's own inference/integrations** — subject to that provider's terms and config.
- **It reads supported native sessions.** Claude Code (`~/.claude`) and Codex
  (`~/.codex`) transcripts can be opened and resumed from the same UI; other
  providers remain managed-only until their native format is verified.

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
   Claude/Codex     Gemini/etc.   Cursor/etc.      … N machines
```

- **Hub** — one machine (your always-on desktop). Serves the UI, holds the data,
  authenticates devices, routes work to runners. The Hub is also a runner for
  its own machine.
- **Runner** — any other machine you want to drive. Headless; runs the agent CLI
  locally, so it uses *that* machine's files, repos and agent login.
- **Client** — the web UI, in any mobile or desktop browser. No app store or
  build step; service worker + manifest allow installation as a PWA.

Everything external enters through a swappable adapter (`AgentAdapter`,
`TTSAdapter`, `Transport`) — see [`packages/protocol`](packages/protocol/src) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What you get

| | |
|---|---|
| **Talk to it** | Push-to-talk or wake word; replies spoken back with Piper local voices or optional OpenAI TTS voice profiles. Long replies are summarised aloud instead of read out in full. |
| **Your real sessions** | Reads and continues native Claude Code and Codex sessions. Other adapters expose resume only when their CLI provides a verified session id. |
| **Find sessions fast** | The Histórico sidebar groups conversations by **project** (folder), machine, agent, or date; sorts by recency, name, or **cost**; and each project/machine group has a **＋** to start a session already scoped there. **Archive** conversations to keep the list clean without deleting them (Active / Archived / All filter). Preferences are per-device. |
| **Many machines** | Switch machines in the UI; each runs on its own hardware and agent login. |
| **See the work** | Live tool activity (editing/creating/reading), sub-agents, `+3 −5` line counts, inline diffs, and a file viewer when the provider publishes those events. Native/managed child nodes also get a live inline card linked to the durable **Trabalhos** tree. |
| **Explore & review files** | A file-tree explorer (🗂 in the chat header) browses the session's folder; the file/diff viewer is line-numbered, resizable, has a full-screen mode, a proper tokenizer for syntax colours (regex/template-literal aware), and a **Formatado/Bruto** toggle that renders Markdown. Select a line or a start→end range, attach comments, then send them all to a chosen AI (Orca-style diff annotation). |
| **Compete for the best answer** | **Torneio**: fan the same task out to N candidates in isolated worktrees, a judge scores them, and the winner is promoted automatically (built on `jarvis_delegate`). |
| **Native desktop client** | An optional Electron shell (`desktop/`) loads the live Hub UI and adds Design Mode (grab a web element → send to the agent). Installers for Windows/macOS/Linux build via CI on a version tag. |
| **Tray control center** | The desktop app lives in the **system tray** with a live status icon (Hub/Runner health) and actions: restart Hub, start/stop the Runner, update machines, open logs, offline notification. Auto-adapts to the machine's role (a runner-only box like a headless server hides the Hub controls). Closing minimizes to tray; starts at login. See [docs/updates.md](docs/updates.md#from-the-tray-desktop-app). |
| **Long tasks don't stall the chat** | An agent can hand a long command (build/tests/typecheck) to a **durable background job** with a `` ```jarvis-run `` block. Jarvis runs it OUT of the one-shot turn (it survives the turn and even a Hub restart) and, when it finishes, **auto-continues the session** with the result — no more "I'll get back to you" that never comes. |
| **Ask what's up** | Spoken digest across all sessions and machines, or a summary of one conversation. |
| **Stay in budget** | Context window, typed token/cost history for every adapter that reports usage, and Claude plan-limit (5h / weekly) indicator. |
| **Route automatically** | In Automatic mode, the Hub's configurable routing model chooses an available agent for a new session and the compatible model/effort for every turn; the selected machine never changes. |
| **Locked down** | Device pairing by invite, owner passphrase (2nd factor), expiring access, audit log, rate limiting. |
| **Self-healing** | Hub and runners come back on their own after a crash or reboot; update from the UI. |

## Requirements

- **Node.js >= 22** on every machine.
- **At least one supported agent CLI, installed and authenticated**, on every
  machine that should do work. Run `npm run agents:report`; support is deliberately
  labeled `complete`, `unverified`, `limited`, `unauthenticated` or `not_installed`.
  The exhaustive behavior/model matrix is in
  [docs/agent-parity-matrix.md](docs/agent-parity-matrix.md).
- **[Tailscale](https://tailscale.com)** (recommended) so your devices reach the
  Hub privately.
- Voice (optional): Python + [Piper](https://github.com/rhasspy/piper) for local/offline TTS — see
  [`services/voice`](services/voice). Optional OpenAI TTS profiles require `OPENAI_API_KEY` or
  `JARVIS_OPENAI_API_KEY`.

## Install

### 1. The Hub (one machine)

```sh
git clone https://github.com/jhonyralph/jarvis && cd jarvis
```

**Guided setup (recommended)** — the **same command on every OS**: installs deps, writes config,
registers the autostart service, starts the Hub, prints your **claim code**, and ends with a health
check. `scripts/run.mjs` detects the platform and calls the right `.ps1`/`.sh` for you:

```sh
npm install && npm run setup
```

Every operational script is exposed the same way (run `npm run scripts:list` to see them all):

| Command | Does |
|---|---|
| `npm run setup` | guided Hub install |
| `npm run doctor` | read-only environment check |
| `npm run install:runner` | make this machine a runner |
| `npm run install:desktop` | install/run the Electron client |
| `npm run build:android` | generate the Android debug APK |
| `npm run build:aab` | generate the Android release bundle |
| `npm run build:apple` / `build:ios` | prepare/open the iOS project on macOS |
| `npm run start:hub` / `start:runner` | run in the foreground |
| `npm run jarvis -- update` | admin CLI (update, status…) |

Arguments pass through after `--`, e.g. `npm run doctor -- -Role runner` or
`npm run install:desktop -- --run`. The per-OS scripts under `scripts/` still work if you prefer
calling them directly.

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

Open the printed link on the device. The UI can also mint these: ⚙ Settings →
**🔐 Dispositivos & convites** → **＋ Adicionar máquina**.

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

Runners update from the UI — the target is retained for offline machines, old
protocols get an authenticated update-only path, and completion is verified only
after restart/reconnection. An update **aborts on a dirty git tree**, on purpose:
it will not throw away local changes unless the owner explicitly forces that
online machine.

## Jobs and sub-agents

Jarvis represents background work as one provider-neutral execution graph. A
provider can populate that graph from its native stream/transcript; when a safe
native surface is unavailable, the MCP tool `jarvis_delegate` can submit an
explicit DAG to the Jarvis-managed scheduler. Every request fixes the target
machine up front and validates agent/model/effort and dependencies before spawn.
The default `mode: "wait"` returns the terminal child report to the calling IA;
`mode: "background"` returns the root ID immediately for asynchronous tracking
in **Trabalhos**.

The execution owner writes an fsynced JSONL journal under
`~/.jarvis/executions`. For remote work, the Runner remains authoritative and
the Hub keeps a mirror reconciled by protocol v6 manifest/replay. A network drop
therefore appears as offline/reconciling rather than a fabricated success or
cancellation. Internal sessions used by managed children are hidden from the
normal chat list, search and digest.

### Durable background jobs & auto-continue

Each agent turn is a **one-shot** CLI invocation (`claude -p`, `codex exec`, …): the
model's own "background" tasks die when the turn ends, and nothing re-invokes it — so
"I'll run the build and continue" never continued. Jarvis closes that loop **in-band**:

- The agent asks for a durable long task by emitting a fenced block:

  ~~~
  ```jarvis-run
  npm run typecheck
  ```
  ~~~

  (a system-prompt addendum on non-managed turns teaches this; disable with
  `JARVIS_BG_JOBS=off`).
- The Hub — which already owns the session/cwd — parses the reply, launches the command
  as a **Hub-owned detached process** that outlives the turn (and survives a Hub restart),
  streaming output to a log and recording lifecycle in an fsynced journal
  (`~/.jarvis/hub/background-jobs.jsonl`).
- When it finishes, the Hub **auto-starts a continuation turn** on the origin session with
  the result, so the agent picks up exactly where it left off. Guards: per-session
  anti-loop depth cap, idempotent (never fires twice, even across restarts), and it never
  runs inside managed/sub-agent turns.

Nothing to configure: run a long task, get on with your day, and the conversation
continues itself when the job lands.

The same journal is the recovery source for an unfinished chat turn. Reopening a
session, reconnecting a device or restarting the Hub replays the pending
canonical activity from disk. The live buffer is released only after the
assistant reply is durably present in `sessions.json`; an orphaned process is
shown with its preserved activity and an explicit interruption reason.

Managed execution is fail-closed. The combinations wired today are:

| Adapter | Read-only child | Isolated writer |
|---|---|---|
| Claude Code | provider safe mode + restricted tool allowlist | worktree + provider restrictions; Bash/Task withheld |
| Codex | `--sandbox read-only` | refused until commit prevention is enforceable |
| Aider | refused | worktree + `--no-auto-commits` |
| Mock | test-only when `JARVIS_ENABLE_MOCK=1` | refused |
| Gemini, Cursor, Copilot, OpenCode, Cline, Qwen, Continue, Kiro, Antigravity | refused until that adapter has a certified sandbox boundary | refused until sandbox and commit prevention are certified |

“Fail-closed” means Jarvis rejects an unsupported combination before starting
the child; it does not turn a prompt warning into a security boundary. Claude,
Codex and Aider still rely on the named provider controls. A writer never
merges, rebases, pushes or commits automatically, and failure to create or
validate its worktree aborts the task.

The registry contains an execution profile and a fixture-mapper entry for all
twelve adapters. Unit tests exercise representative synthetic rows for the
providers whose lifecycle mapper is implemented; this is **not** yet a complete,
versioned conformance-fixture corpus for all twelve. Neither kind of fixture proves
the external CLI: an absent or unauthenticated provider remains `fixture_only`,
`unverified` or `unavailable` until a real versioned canary passes. Run
`npm run agents:report` on each machine for the current runtime descriptor; there
is not yet a persisted canary/certification ledger.

Minimal `jarvis_delegate` input (the MCP client sends this object as tool
arguments):

```json
{
  "machine": "runner-id-from-jarvis",
  "title": "Review and verify",
  "mode": "wait",
  "tasks": [
    {
      "id": "review",
      "title": "Read-only review",
      "prompt": "Inspect the change and report concrete findings.",
      "agent": "codex",
      "cwd": "/absolute/path/to/repo",
      "depth": 1,
      "write": false
    },
    {
      "id": "verify",
      "title": "Verify the findings",
      "prompt": "Check the reported findings and summarize the evidence.",
      "agent": "claude-code",
      "cwd": "/absolute/path/to/repo",
      "depth": 1,
      "write": false,
      "dependsOn": ["review"]
    }
  ],
  "policy": { "maxConcurrency": 2, "maxDepth": 3 }
}
```

`machine` is the fixed Runner ID, not an instruction to auto-select hardware.
An optional `rootExecutionId` is a caller-stable seed, not the final global ID:
Jarvis derives the canonical managed root from `machine + seed`, so the same seed
on two Runners cannot collide.
`waitTimeoutMs` can bound synchronous waiting to at most 600000 ms. A timeout
does not cancel the workflow: it remains durable and visible in **Trabalhos**.
After a terminal event, `wait` reads the machine- and root-filtered execution snapshot in
correlated pages of 500 nodes (up to a defensive 100-page limit), deduplicates
overlapping pages and returns bounded, secret-scrubbed child summaries. A snapshot
failure does not rewrite the observed terminal state; the response points to the
durable execution instead.
Task IDs are unique within the DAG; dependencies must reference IDs in the same
request. `model` and `effort` are optional but validated when supplied. Omitted
`write` uses the configured default (read-only by default). Invalid cycles,
unknown fields, unavailable adapters/models, unsafe workspace modes and policy
overruns are rejected before acceptance.

For a child created while its owning chat is open, the browser renders a live
inline card linked to the same execution node. On reload, **Trabalhos** is the
provider-neutral durable source of truth. The chat bubble reconstructs only the
`AgentEvent` activity persisted with that assistant message, so a native provider
event that has no equivalent persisted `AgentEvent` may reappear only in
**Trabalhos**. A temporary Chrome canary passed desktop and 390×844 mobile views,
deep links, inline cards, tree navigation, transcript, files and `+/-`; automated
browser/a11y, two-client and mid-tool restart coverage remain release gates.

## Configuration

Config lives in `~/.jarvis/hub.env` (Hub) and `~/.jarvis/runner.env` (runners).
Environment variables provide bootstrap/default values — no secrets belong in
the repo. Owner-editable execution settings are additionally persisted in
`~/.jarvis/execution-config.json` on the Hub as described below.

> **Nothing personal ships in this repo or in the installers.** The tracked
> `.env.example` is a generic template; your real values (URLs, API keys, tokens)
> go only in `~/.jarvis/hub.env` / `~/.jarvis/runner.env`, which are **gitignored**.
> The desktop/runner installers take your Hub URL/token as an **argument or env
> var** and bake nothing. The **mobile app is server-agnostic** — a single generic
> APK/IPA asks each user for their **own** Hub URL on first launch (see
> [docs/mobile.md](docs/mobile.md#server-url--agnostic-each-user-enters-their-own)).
> So every user configures their own; this repo is safe to keep public.

| Var | Default | What |
|---|---|---|
| `JARVIS_PORT` | `4577` | UI + WebSocket port |
| `JARVIS_ADMIN_PORT` | `4578` | Loopback-only admin API |
| `JARVIS_AGENT` | `claude-code` | Default adapter: `claude-code`, `codex`, `gemini`, `cursor`, `copilot`, `opencode`, `cline`, `qwen`, `continue`, `kiro`, `antigravity` or `aider`. `antigravity` detects the official `agy` TUI but is not executable until a public headless contract exists; `mock` is test-only unless explicitly enabled |
| `JARVIS_AGENT_PERMISSION_MODE` | `full-access` | `full-access` injects the provider's unattended/bypass flags. `provider-default` omits them and delegates sandbox/approval behavior to the CLI (which may refuse or wait in headless mode) |
| `JARVIS_CODEX_PRICE_IN` / `_CACHED` / `_OUT` | estimativa Jarvis v1 | USD por 1M tokens para o equivalente estimado do Codex; defina `JARVIS_CODEX_PRICING_VERSION` para identificar a tabela usada |
| `JARVIS_AUTH` | `on` | Device auth. **Only** turn this off on a trusted private network |
| `JARVIS_CWD` | process cwd | Default working directory for agents |
| `JARVIS_VOICE` | — | Voice id. Piper models use ids like `en_GB-alan-medium`; optional OpenAI profiles use ids like `openai:jarvis-br` |
| `OPENAI_API_KEY` / `JARVIS_OPENAI_API_KEY` | — | Enables optional OpenAI TTS voices in the voice catalog |
| `JARVIS_OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | OpenAI TTS model used for optional cloud voices |
| `JARVIS_SUMMARY_MODEL` | `haiku` | Model for automatic routing, spoken summaries and digest/status (cheap on purpose) |
| `JARVIS_HISTORY_CAP` | `120` | Messages sent when opening a session |
| `JARVIS_SESSION_COST_CAP` | `0` | Per-session **billed USD** cap (`0` = off). Estimates and subscription usage stay visible but do not masquerade as invoice spend or trigger this cap |
| `JARVIS_EXECUTIONS` | enabled (`0` disables) | Enables the Trabalhos view, execution protocol and Jarvis-managed delegation. The minimum fsynced journal for crash-safe chat replay remains active when this UI feature is disabled |
| `JARVIS_EXECUTION_RETENTION_DAYS` | `30` | Age after which terminal roots are compacted on process startup. Tree, summary and aggregate metrics remain; detailed prompt/activity/artifacts are removed and marked truncated |
| `JARVIS_EXECUTION_MAX_EVENTS` | `5000` | In-memory reducer window per execution root (`100..100000`). Durable replay falls back to the append-only JSONL when a cursor predates this window; exceeding it marks the in-memory snapshot as truncated |
| `JARVIS_EXECUTION_MAX_CONCURRENCY` | `6` | Maximum concurrent Jarvis-managed tasks on that process (`1..32`) |
| `JARVIS_EXECUTION_MAX_DEPTH` | `3` | Maximum managed DAG depth (`1..10`) |
| `JARVIS_EXECUTION_DEFAULT_WRITE` | `0` | Default for tasks that omit `write`; keep disabled unless isolated writer behavior is intentional |
| `JARVIS_EXECUTION_WORKTREE_ROOT` | `~/.jarvis/worktrees` | Validated root used for isolated writer worktrees |
| `JARVIS_PUBLIC_URL` | — | Base URL used in invite links |
| `JARVIS_APP_HUB_URL` | — | **Desktop/mobile shells only.** The Hub URL the app loads. Leave **unset** for a generic build (desktop reads it at runtime; the mobile app asks in-app). Set it only to bake a personal build |
| `JARVIS_BG_JOBS` | `on` | Durable background jobs + session auto-continue (the `` ```jarvis-run `` steering + runner). Set `off` to disable the steering/feature |
| `JARVIS_REQUIRE_TLS` / `JARVIS_TRUST_PROXY` | off | Set both when behind a TLS proxy |
| `JARVIS_AUDIT_MAX_MB` | `5` | Audit-log rotation cap. At the size the current `audit.log` becomes `audit.log.1` (one generation kept) and a fresh log starts |
| `JARVIS_HUB` / `JARVIS_TOKEN` / `JARVIS_LABEL` | — | Runner: where to connect, and as whom |

For the Hub, these execution variables seed
`~/.jarvis/execution-config.json`; an owner can change the same values under
**Configurações → Trabalhos e subagentes**, and the saved file then takes
precedence over the environment defaults. Concurrency, depth and default-write
changes apply to new delegations immediately. Enabled state, retention, event
cap and worktree root require a Hub restart, which the UI reports.

Remote Runners do not inherit the Hub's execution settings. Configure the same
variables in each `~/.jarvis/runner.env` and restart that Runner. The Hub still
clamps a remote request to its own concurrency/depth policy, while the Runner
applies its local limits again; the more restrictive effective limit wins.

The Hub also answers an unauthenticated `GET /health` (`/healthz`) on the UI port
returning `{ok,uptime,runners}` — for a monitor, `tailscale serve` health, or a load
balancer. It leaks only coarse status (no hostnames/ids).

The complete generated catalog is in [docs/environment.md](docs/environment.md),
with requirement, scope, default, format, secrecy, provider, cost and every
detected use. Start from [.env.example](.env.example) and validate repository
drift with `node scripts/environment-catalog.mjs --check`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Machine shows **⚠ sem IA** | No supported CLI was both found and usable there. Run `npm run agents:report` on that machine, then authenticate the selected provider. |
| `401 ... OAuth access token has been revoked` | Same thing — that's the agent CLI's login, not a Jarvis token. `claude auth logout && claude auth login`. |
| Update says *"alterações locais não commitadas"* | That machine's clone is dirty. Working as intended: commit, or `git reset --hard origin/main` there. |
| **"Update all machines" does nothing / *"nenhuma máquina foi alterada"*** | The **Hub's own** clone is dirty (uncommitted changes) or ahead of `origin` — the all-machines preflight refuses to proceed so nothing is lost. Commit or `git stash` on the Hub, then retry. Do **not** force (the Hub update does `git reset --hard` and would discard those changes). |
| Desktop app stuck **one version behind** / *"auto-update indisponível"* | You're running the **unpackaged/dev** desktop build, which never self-updates. Install a packaged `Jarvis-Setup-X.Y.Z` (`.exe`/`.dmg`/`.AppImage`/`.deb`) from the GitHub Release once; it auto-updates from then on. |
| Machine version shows **`vX.Y.Z +N`** instead of the tag | Tags weren't fetched on that clone (cosmetic — the code is correct). Fixed automatically by the updater (`git fetch --tags`); `git fetch --tags` clears it immediately. |
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

### Git hooks (release gates)

`npm install` points `core.hooksPath` at [`.githooks/`](.githooks) (same idea as husky, no extra
dependency). Two gates guard the automatic release:

- **`pre-push`** — runs typecheck, the test suite and `node --check apps/hub/web/app.js` before the
  push leaves your machine. A push to `main` cuts a release, so broken code there means no release
  and a red `main` nobody notices.
- **`commit-msg`** — enforces [Conventional Commits](https://www.conventionalcommits.org), because
  the version is derived from the message: a message off-format doesn't fail loudly, it just never
  becomes a release.

Both are bypassable in an emergency with `--no-verify`, and reinstallable with `npm run hooks:install`.

**They don't replace CI.** Hooks run only on *your* OS; the failures that actually broke `main`
recently were Linux-only (a `"C:/"` path that is only absolute on Windows; an ephemeral port the
Linux kernel handed out twice). CI runs Ubuntu **and** Windows — that stays the authority.

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
