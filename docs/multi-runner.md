# Multi-machine (Hub + Runners)

Manage several machines (Ubuntu / macOS / Windows) from a single Jarvis UI. The
machine that hosts the UI is the **Hub**; every other machine (and the host
itself) runs a **Runner** that executes agents locally and streams back.

> The Runner concept was in the original protocol (`@jarvis/protocol`,
> `messages.ts`: "Clients, the Hub, and Runners") but was never built — the Hub
> grew into a local monolith. This work revives and completes it.

## Topology

```
 Clients (phone/desktop) ──WS──▶ HUB (this machine, permanent)
                                  • serves the PWA + UI
                                  • router + runner registry (~/.jarvis/runners.json)
                                  • voice / TTS / push  (HUB-ONLY)
                                  • embedded LOCAL runner = "machine 0"
                                        │
                                  runners dial the hub (outbound WS)
                                        ▼
                    Ubuntu runner            macOS runner            Windows runner
                    • claude/codex LOCAL     • claude/codex LOCAL    • claude/codex LOCAL
                    • native sessions        • native sessions       • native sessions
                    • headless               • headless              • headless
```

## Locked decisions

1. **Runner dials the Hub** (outbound WS), never the reverse. Runners may be
   laptops that sleep, roam networks, or sit behind NAT; the Hub has a stable
   address. Reuses the existing WS infra.
2. **Each Runner uses its own local agent CLI** (`claude` / `codex`), authed on
   that machine. The Hub never proxies inference credentials — only orchestration
   crosses the wire. Keeps the "only inference leaves the machine" property
   per-machine, and isolates blast radius.
3. **The host is Hub + an embedded Runner ("machine 0").** Everything that works
   today keeps working unchanged; remote machines are additive.
4. **Auth lives in the app, transport-agnostic.** Tailscale is *an operator's*
   deployment choice, not an app dependency — others may install without it.
   - **Runner↔Hub: app token, always on.** Generated on the Hub
     (`~/.jarvis/hub-token`), embedded into the runner install. The Hub rejects
     runners without it. Zero UX cost (machine-to-machine).
   - **Client↔Hub (UI): optional token, off by default.** Env `JARVIS_UI_TOKEN`;
     when set, the UI requires it. For deployments exposed without a private
     network. On by default would add friction to the private (Tailscale) setup.
   - The app only binds a port; how you reach it (Tailscale / VPN / tunnel /
     LAN) is external. **Never expose the UI publicly without `JARVIS_UI_TOKEN`
     set** — the Hub runs agents with `bypassPermissions` (unauth = RCE).
5. **Machine identity:** auto from `os.hostname()` at `register`; the Hub stores
   an editable **label** per runner (fallback: hostname) so the user can tell
   machines apart.
6. **UI session views (user choice in settings):** *per-machine* (top selector
   scopes list/new/commands) OR *unified list with a machine badge*; the unified
   view also gets a per-machine **filter**.

## Build phases

- **A — Protocol + doc** (this): `@jarvis/protocol` gains the real Runner↔Hub
  contract (`runner.ts`). No behavior change.
- **B — `@jarvis/core`**: extract `agents.ts` / `native.ts` / `store.ts` (no heavy
  deps) into a shared package the Hub and Runner both import. Hub keeps working.
- **C — `apps/runner`**: headless process, dials the Hub, registers with
  hostname/OS, answers open/send/stream/list/native/stop. Token auth.
- **D — Hub routing**: accept runner connections, registry + labels, embedded
  local runner "machine 0", route client ops to the selected runner.
- **E — UI**: machine selector, online/offline dots, edit-label, settings
  view-mode (per-machine / unified + filter).
- **F — Installers**: `install-runner.sh` (Linux/macOS) + `install-runner.ps1`
  (Windows) with autostart (systemd / launchd / schtasks) + docs.

### Prereqs per runner machine (installer checks, cannot do — interactive)
- The chosen network layer joined (e.g. `tailscale up`), if any.
- `claude login` / `codex login` on that machine.
- Node.js >= 22.

## Negative scope (not in this work)
- No cross-runner session migration or file sync between machines.
- No auth beyond the app token + optional UI token (no user accounts / SSO).
- Voice / STT / TTS / push stay Hub-only; runners are headless.
