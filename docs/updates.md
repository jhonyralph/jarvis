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
- **Apply** (owner) = `git pull --ff-only` + `npm install`, then the service
  manager restarts the process with the new code (Task Scheduler / launchd /
  systemd). Fast-forward only, and it **refuses a dirty working tree** — a local
  edit blocks the update instead of clobbering it.
- **All machines**: the Hub sends each connected runner an `update` message; each
  runner pulls + restarts itself independently, then reconnects.
- **Safety net**: the pre-update commit is saved to `~/.jarvis/update-prev`; if a
  bad version breaks things, roll back.

## From the UI

Settings → **Atualização**:
- Shows "✓ Na última versão" or "🔄 Nova versão (N commits): …".
- Owner: **Atualizar** (double-tap to confirm) with a **"aplicar em todas as
  máquinas"** checkbox. The Hub reboots; your app reconnects on its own.

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

- A runner made from the pack/copy can't self-update; re-run its install from a
  fresh copy, or switch it to a git clone.
- Updating the Hub restarts it (a few seconds offline); runners the same.
- If `npm install` fails, the restart does **not** happen (you stay on the code
  that's on disk) — check the result/log, fix, retry, or roll back.
