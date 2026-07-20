# Updates (self-update via git)

"New version" = new commits on `origin/<branch>` of the repo each machine was
cloned from. The Hub checks periodically and offers an update; the owner applies
it, optionally to **all machines** at once.

## Requirements

- The install must be a **git clone** (has `.git` + an `origin` remote). Installs
  made from the **pack tarball or a folder copy have no git history**, so they
  update manually (re-pack / re-copy) — the UI shows "auto-update indisponível".
- Set a remote once (e.g. `git clone https://github.com/<you>/jarvis`).

## How it works

- The Hub runs `git fetch` on boot (after 8s) and every 6h, and on demand
  (Settings → **Verificar agora**). Fetch/pull run **async** so the Hub never
  freezes.
- **Check** = compare `HEAD` to `origin/<branch>` → how many commits behind + the
  latest commit's message.
- **Apply** (owner) first stops accepting new work and drains active local turns.
  It then fast-forwards to the exact deployment commit requested by the Hub,
  performs deterministic dependency installation
  (`npm ci` when a lockfile exists), and `npm run update:verify`. Only a verified
  checkout is restarted by Task Scheduler / launchd / systemd.
- **All machines** is a durable deployment, not a broadcast to whoever happens
  to be online. The target commit is persisted for every known runner. The Hub
  updates and restarts first; runners receive the target when they reconnect.
- An authenticated runner with an older operational protocol enters an
  **update-only quarantine**. It may update and report the result, but cannot run
  sessions/files/tools until it restarts with the current protocol.
- An offline runner remains in the inventory and keeps the pending target across
  Hub restarts. A successful `update_done` is only “prepared”; success becomes
  **verified** after the runner restarts, reconnects cleanly and reports the target
  commit. Same-commit dependency repairs additionally require the durable receipt
  written only after installation and validation complete.
- The queued target remains exact even if `origin` receives newer commits while a
  machine is offline. A later deployment may advance it again; one deployment is
  never silently changed underneath the runner.
- **Safety net**: each checkout records its own full pre-update commit under
  `~/.jarvis/updates/`. If dependency install or validation fails after the pull,
  Git and the previous dependencies are restored automatically. Manual rollback
  remains available.
- A cross-process lock prevents Hub, Runner and recovery CLI from updating the
  same checkout concurrently. Clean-but-divergent local commits are refused just
  like an uncommitted dirty tree.

## From the UI

Settings → **Atualização**:
- Shows "✓ Na última versão" or "🔄 Nova versão (N commits): …".
- Owner: **Atualizar** (double-tap to confirm) with a **"aplicar em todas as
  máquinas"** checkbox. The Hub reboots; your app reconnects on its own.
- Runner repair remains available when the Hub itself is current. Pending
  machines show queued, draining/preparing, awaiting restart, verified or blocked.
- Normal updates may be queued while a machine is offline. **Force is never
  queued**: because it discards local work, the owner must confirm it again while
  that exact machine is online.

## From the host (recovery / no UI)

```
Windows:    .\scripts\jarvis.ps1 update            # check
            .\scripts\jarvis.ps1 update-apply       # pull + restart
            .\scripts\jarvis.ps1 update-rollback    # back to the previous version
mac/Linux:  ./scripts/jarvis.sh  update | update-apply | update-rollback
```

The admin API is loopback-only (`127.0.0.1:4578`), so these work from the host
even with no device logged in.

## Notes / limits

- A runner made from the pack/copy or a container image can't use the Git updater.
  Re-run its install from a clone, or rebuild/redeploy the container image.
- Updating the Hub restarts it (a few seconds offline); runners the same.
- A failed prepare does **not** restart. If Git had moved, rollback is attempted
  immediately. Repeating an update on the same commit still repairs dependencies
  and re-runs validation; “already current” is never an unrepairable dead end.
- Runners with an older protocol are quarantined for upgrade. Runners with a
  newer protocol are refused with an instruction to update the Hub first; the Hub
  never attempts an automatic downgrade.
- Installers require Node >=22, a real `.git` checkout, an `origin` reachable
  without an interactive prompt, and a passing validation before enabling the
  service.
