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

The installer: verifies Node >=22, confirms this is a Git clone whose `origin`
is reachable non-interactively, installs from the lockfile, validates the
checkout, writes `~/.jarvis/runner.env` (Hub + token + label), and registers an
autostart service:

- **Windows** — Task Scheduler task `JarvisRunner` (at logon, auto-restart).
- **macOS** — launchd agent `com.jarvis.runner` (`~/Library/LaunchAgents`).
- **Linux** — systemd `--user` unit `jarvis-runner` (`loginctl enable-linger $USER`
  to run without an active login).

The machine then appears in the Hub's machine selector. Pick it to run agents there.

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

## Notes / limits

- The runner is **headless** — no voice/UI there; the single UI is the Hub.
- Sharing a machine normally means giving a shell on it (`full-access` is the default).
  For guests, run the runner in a container/VM. See docs/security.md.
- Full parity with the local machine: browse folders, pick agent/cwd for new
  sessions, open native CLI sessions, and watch them update live. **Voice (STT/TTS)
  stays Hub-only by design** — you drive a remote machine by text/typing.
