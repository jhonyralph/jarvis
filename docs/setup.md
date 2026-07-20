# Setting up Jarvis from scratch (Windows / Linux / macOS)

## The repository

Jarvis is **one repository** — a monorepo at `…/jarvis` (`apps/hub`, `apps/runner`,
`packages/*`). There are **no separate repos**. It lives on a **private git remote**
(`origin` → `github.com/jhonyralph/jarvis`), so a machine **with access** can just
`git clone <url>` and later `git pull` to update (this is what the README shows). If
a machine can't reach the remote, package it instead:

- **Recommended — clone from the remote:** `git clone <url>` then `git pull` to
  update. The repo is private — granting access is your call.
- **No remote access — package it:** on the Hub machine run `scripts/pack.ps1`
  (Windows) or `scripts/pack.sh` (mac/Linux) → produces `jarvis-dist.tgz`
  (committed tree, no node_modules). Copy it to the other machine, `tar -xzf` it,
  done. Update = re-pack and re-extract.
- Or just **copy the folder** (minus `node_modules`) over the network.

## How the pieces fit

- **The Hub = the "main machine".** It **is the server automatically** — you do
  NOT configure anything per secondary machine on it. It: serves the web UI,
  **stores everything locally** (`~/.jarvis/` = auth, devices, runner tokens,
  sessions, audit; `~/.claude` / `~/.codex` = the agents' own native sessions),
  runs supported agent CLIs locally ("machine 0"), and **listens for runners** on `…/runner`.
  There is exactly **one Hub**.
- **Secondary machines = runners.** Each runs the headless `apps/runner`, dials
  the Hub, and runs its own installed agent adapters. To add one you just mint a
  token on the Hub and run the installer on the machine — no Hub-side per-machine
  service to set up.
- **Clients** = any browser (phone/desktop) opening the Hub's URL.

```
   phone / desktop browsers ──► HUB (main machine: UI + store + router + machine 0)
                                     ▲            ▲
                                runner           runner        ← secondary machines
                              (Windows #2)      (Mac / Linux)     dial the Hub
```

## Prerequisites on EVERY machine (a truly fresh box has none of these)

The installers **check** these but do not install them (installing Node/agents is
interactive per-OS):

1. **Node.js ≥ 22** — nodejs.org, or `winget install OpenJS.NodeJS` / `brew install node` / your distro's package.
2. **An agent CLI + login** — choose from the current support matrix and run its
   authentication flow. `npm run agents:report` verifies presence/version without
   spending a turn. **Each machine authenticates its own agent;
   no credentials cross the network.** A machine with no authed agent shows up
   but its agents are greyed out in the picker.
3. **A way to reach the Hub** — same private network. Default: **Tailscale** on
   every machine (`tailscale up`). For public exposure use a TLS proxy (see
   `docs/security.md`).
4. **git** (to clone) — or use the pack tarball above.

## Step 1 — the Hub (do this on ONE machine)

Get the code onto it (clone / pack / copy), then:

| OS | Install the Hub (autostart) |
|----|------------------------------|
| **Windows** | `.\scripts\install-autostart.ps1` (registers the `JarvisHub` scheduled task) |
| **macOS / Linux** | `./scripts/install-hub.sh` (launchd / systemd `--user`) |

The Hub comes up on port **4577**, bound to all interfaces (so Tailscale reaches
it). Expose it how you like — e.g. Tailscale: `tailscale serve --bg http://127.0.0.1:4577`
(tailnet-only; **never `funnel`**).

## Step 2 — first access (no device is logged in yet)

Auth is **on** by default, so the first device must **claim ownership** with a
one-time **claim-code**. With zero devices logged in, get it from the host:

| OS | Get the claim-code |
|----|--------------------|
| **Windows** | it's printed in `~/.jarvis/hub.log` and saved to `~/.jarvis/claim-code.txt` — or `.\scripts\jarvis.ps1 claimcode` |
| **macOS / Linux** | `~/.jarvis/claim-code.txt` — or `./scripts/jarvis.sh claimcode` |

Open the Hub URL on your phone/desktop → the pairing screen appears → paste the
code → you're the **owner**. (Lost all devices later? `jarvis owner` mints a fresh
owner code from the host; `jarvis.* passphrase-clear` removes the 2FA password;
emergency: `JARVIS_AUTH=off`.)

## Step 3 — add a secondary machine (a runner)

**On the Hub**, mint a per-machine token (also prints the exact install command):

```
Windows:    .\scripts\jarvis.ps1 machine -label "MacBook"
mac/Linux:  ./scripts/jarvis.sh machine "MacBook"
```

**On the new machine** (code present, prereqs met), run what it printed:

| OS | Install the runner (autostart) |
|----|--------------------------------|
| **Windows** | `.\scripts\install-runner.ps1 -Hub "wss://<hub>/" -Token "<token>" -Label "…"` (Task Scheduler) |
| **macOS / Linux** | `./scripts/install-runner.sh -h "wss://<hub>/" -t "<token>" -l "…"` (launchd / systemd) |

It writes `~/.jarvis/runner.env`, sets autostart, and connects. The machine then
appears in the Hub's **machine selector** (top of the side panel). Pick it to run
agents there. Rename with the ✏; revoke with `jarvis status` → its runner token.

## Quick reference — same flow, per OS

| Task | Windows | macOS / Linux |
|------|---------|----------------|
| Package (no remote) | `pack.ps1` | `pack.sh` |
| Install **Hub** | `install-autostart.ps1` | `install-hub.sh` |
| Hub launcher | `start-hub.ps1` | `start-hub.sh` |
| Admin / recovery | `jarvis.ps1 …` | `jarvis.sh …` |
| Mint machine token | `jarvis.ps1 machine` | `jarvis.sh machine` |
| Install **runner** | `install-runner.ps1` | `install-runner.sh` |

## Notes

- **Voice (STT/TTS)** is Hub-side and currently tuned for the Windows setup
  (Piper voices in `~/.jarvis/voices`, Python services). A Hub without it runs
  fine in **text mode**; voice is optional extra setup. Runners are always
  headless (no voice).
- **Sandboxed runner** (share a machine without a shell): `docs/runner-sandbox.md`.
- **Exposing publicly**: `docs/security.md` (checklist: TLS, `JARVIS_TRUST_PROXY`,
  `JARVIS_REQUIRE_TLS`, keep auth on).
