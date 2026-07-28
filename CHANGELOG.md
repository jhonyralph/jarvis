## [0.4.1](https://github.com/jhonyralph/jarvis/compare/v0.4.0...v0.4.1) (2026-07-28)


### Bug Fixes

* **hub:** responder um card de decisao nao vira mais 'Nao ha aprovacoes pendentes' ([af15019](https://github.com/jhonyralph/jarvis/commit/af150190732925c9f85c54f114de26dcdb6d9b8b))

# [0.4.0](https://github.com/jhonyralph/jarvis/compare/v0.3.1...v0.4.0) (2026-07-28)


### Features

* **desktop:** app encontravel na busca do sistema nos tres SOs ([5266baa](https://github.com/jhonyralph/jarvis/commit/5266baadfee3104ea3067f294fbb0d5f1bc3b43d))

## [0.3.1](https://github.com/jhonyralph/jarvis/compare/v0.3.0...v0.3.1) (2026-07-28)


### Bug Fixes

* **desktop:** valida e normaliza JARVIS_APP_HUB_URL numa regra unica ([7d41b45](https://github.com/jhonyralph/jarvis/commit/7d41b4558af51cfd9480a7ff579d36c4d231f226))

# [0.3.0](https://github.com/jhonyralph/jarvis/compare/v0.2.1...v0.3.0) (2026-07-28)


### Features

* **scripts:** comando unico multiplataforma para os scripts operacionais ([a3d9530](https://github.com/jhonyralph/jarvis/commit/a3d9530cb54fe69fb833533409b9778d1c515424))

## [0.2.1](https://github.com/jhonyralph/jarvis/compare/v0.2.0...v0.2.1) (2026-07-28)


### Bug Fixes

* **ci:** anexa instaladores na release do semantic-release (releaseType: release) ([ac3967e](https://github.com/jhonyralph/jarvis/commit/ac3967e0efddca3d01d14482cdff564bf362e322))

# [0.2.0](https://github.com/jhonyralph/jarvis/compare/v0.1.0...v0.2.0) (2026-07-28)


### Bug Fixes

* **test:** corrige 3 testes que so falhavam no Linux (CI vermelho desde 22/07) ([72f3f2b](https://github.com/jhonyralph/jarvis/commit/72f3f2b163d782f3d2044fcb2afaafcff1a274ff))
* **test:** e2e de update espera o Hub morrer antes de resubir na mesma porta ([c9aa5bd](https://github.com/jhonyralph/jarvis/commit/c9aa5bdc89bcbc4f1965d7f4b5f199035d22957f))


### Features

* **desktop:** atualizacao do app controlada pela UI web (banner + verificar + instalar) ([b85fed7](https://github.com/jhonyralph/jarvis/commit/b85fed74c4b9a86b79507000068d4a55420a061c))

# Changelog

All notable changes to Jarvis. Versions follow the root `package.json`.

Releases are **automatic**: every push to `main` runs `.github/workflows/release.yml`, which reads the
[Conventional Commits](https://www.conventionalcommits.org) since the last tag, decides the next
semver, updates this file and both `package.json`s (root + `desktop/`), tags, publishes the GitHub
Release and builds the desktop installers for it. `feat:` → minor, `fix:`/`perf:` → patch,
`BREAKING CHANGE:` → major; a push with only `docs:`/`chore:`/`style:` cuts no release.
`scripts/release.ps1` stays available for a manual/offline cut.

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
