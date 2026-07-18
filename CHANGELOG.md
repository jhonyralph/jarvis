# Changelog

All notable changes to Jarvis. Versions follow the root `package.json`; cut a release with
`scripts/release.ps1 <version>` (bumps → packs → tags).

## [0.1.0] — baseline

The first versioned baseline, after a large production-hardening + product pass. Grouped by theme;
items marked **(device/runtime)** are shipped in code but await the owner's on-device or live testing.

### Reliability
- Remote-runner mid-turn disconnect no longer hangs the client: the Hub ends the turn (synthetic
  `cancelled`), clears stale run state, and reaps half-open sockets via pong liveness.
- Turn resume: a runner buffers turn output during a network blip and replays it on reconnect, so the
  live stream + final reply aren't lost **(device — needs a remote runner to exercise)**.
- Per-session offline banner in the client when the session's machine is down.

### Security & multi-user
- Per-runner authorization is now enforced (was defined but never checked): a member only drives the
  runners in their invite; the owner has all. Machine list + fleet filtered per access.
- Audit log records successful auth and rotates by size (`JARVIS_AUDIT_MAX_MB`).
- Owner passphrase minimum raised 4 → 8.

### Observability & ops
- `GET /health` (`/healthz`) → `{ok,version,uptime,runners}`.
- Fleet dashboard: per-turn latency p50/p95 + error rate per machine, "offline for N min" + a
  prolonged-offline push alert (`JARVIS_OFFLINE_ALERT_MIN`).
- Setup doctor (`scripts/jarvis-doctor.*`) and guided onboarding (`scripts/jarvis-setup.*`).

### Agents & packaging
- Third pluggable agent: **Aider** (`JARVIS_AGENT=aider`), experimental **(needs `aider` + a model key)**.
- Single-source version (`@jarvis/core` VERSION) + release script.
- Sandboxed runner via Docker Compose (`docker-compose.runner.yml`).

### Mobile app (Capacitor shell — foundation + native bridge)
- `mobile/` Capacitor scaffold with an OTA model (loads the live UI from the Hub; native layer via the
  store). Feature-detected client bridge — the browser PWA is untouched.
- Native push (FCM/APNs) alongside web-push, share in/out, biometric app-unlock, and a background
  wake-word plugin contract + wiring. **All (device) — build + test on a real device;** the native
  wake-word detector itself is specced, not written.

### i18n
- pt-BR / en / es for the chrome, voice statuses, high-frequency toasts, and spoken-op statuses. Full
  coverage of the remaining static Settings labels is ongoing.

### Foundations (earlier in the initiative)
- Crash-safe atomic JSON persistence, typecheck + test suite + CI, PWA, turn-lifecycle unification,
  cost guard-rail, cron routines, semantic memory, MCP server, ambient voice, fleet dashboard.
