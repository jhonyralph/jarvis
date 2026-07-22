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
                    • agent CLIs LOCAL       • agent CLIs LOCAL      • agent CLIs LOCAL
                    • native sessions        • native sessions       • native sessions
                    • headless               • headless              • headless
```

## Locked decisions

1. **Runner dials the Hub** (outbound WS), never the reverse. Runners may be
   laptops that sleep, roam networks, or sit behind NAT; the Hub has a stable
   address. Reuses the existing WS infra.
2. **Each Runner uses its own supported local agent CLI**, authenticated on
   that machine. The Hub never proxies inference credentials — only orchestration
   crosses the wire. Keeps the "only inference leaves the machine" property
   per-machine, and isolates blast radius.
3. **The host is Hub + an embedded Runner ("machine 0").** Everything that works
   today keeps working unchanged; remote machines are additive.
4. **Auth lives in the app, transport-agnostic.** Tailscale is *an operator's*
   deployment choice, not an app dependency — others may install without it.
   The app only binds a port; how you reach it (Tailscale / VPN / Cloudflare
   Tunnel / reverse proxy / LAN) is external, but must carry TLS for any non-
   loopback access. Credentials never travel over a non-loopback `ws://`.
4a. **Authentication is MANDATORY (not optional).** The moment Jarvis may be
   shared with other people, "no auth" is untenable: the Hub runs agents with
   full-access flags by default, so access == a shell on the target machine. Auth makes
   that access *accountable and revocable*; it does NOT sandbox it (see 4d).
   - **Auth primitive: device pairing by invite.** Per-device tokens, revocable.
     The owner mints a one-time **invite** (code/link, TTL, role, allowed
     runners); a new device redeems it and receives its own long-lived token.
     No password management; sharing = sending an invite. Optional password can
     be layered later as a 2nd factor.
   - **Token storage:** high-entropy random tokens; the Hub stores only a SHA-256
     **hash** (`~/.jarvis/auth.json`), never plaintext. Client keeps the plaintext
     (localStorage); every WS/HTTP call carries it; WS is gated on a first-message
     `auth`. Static shell (HTML/JS, no data) may load unauthenticated.
   - **Bootstrap:** first run is *unclaimed*; the Hub writes a one-time claim code
     to `~/.jarvis/claim-code.txt` (and logs it). The first device redeems it to
     become **owner**. No loopback auto-trust (unsafe behind a reverse proxy,
     where every client appears as 127.0.0.1). Escape hatch: `JARVIS_AUTH=off`.
   - **Recovery (no devices left):** the Hub exposes a **loopback-only admin API**
     (`127.0.0.1:JARVIS_ADMIN_PORT`, default 4578) — never routed by a proxy, so
     host access == authorization. `scripts/jarvis.ps1 owner` mints an owner
     pairing code even with zero logged-in devices; also `invite` / `status` /
     `revoke` / `revoke-all`. This is the answer to "how do I generate a code if
     I have no device?".
4b. **Authorization:** roles **owner** (admin) and **member**; access is granted
   **per-runner (allowlist)**. Owner sees all runners; members only the machines
   the owner shared. Since each runner is a shell, this grain is the security
   boundary for sharing.
4c. **Connected devices:** the owner sees every device (label, last-seen, IP,
   user-agent) and can revoke one or all; revoking kills that token immediately.
4d. **Containment (the honest limit):** sharing a runner = giving a shell on that
   machine. Chosen posture: **per-machine, explicit + audited** — share only what
   you accept giving shell to; every action is attributed in an append-only audit
   log (`~/.jarvis/audit.log`). `provider-default` omits Jarvis bypass flags, but
   strong containment still requires a sandboxed runner.
4e. **Runner↔Hub auth (infra, separate from users):** per-runner token, minted by
   the owner via "Add machine" and baked into the installer (`runner.env`).
   Revocable per machine. Hub stores only the hash.
5. **Machine identity:** auto from `os.hostname()` at `register`; the Hub stores
   an editable **label** per runner (fallback: hostname) so the user can tell
   machines apart.
6. **UI session views (user choice in settings):** *per-machine* (top selector
   scopes list/new/commands) OR *unified list with a machine badge*; the unified
   view also gets a per-machine **filter**.

## Context, memory and HITL boundaries

- Runner protocol v6 scopes live broadcasts, queues, activity/routing buffers,
  usage, browser caches/drafts, decision state, semantic memory and voice
  staging by `runnerId + sessionId`. Delayed frames carry `runnerId` and cannot
  overwrite an equal-id session after a machine switch.
- Every turn records a context manifest with actor, machine, cwd, continuity,
  prompt hashes/counts and candidate instruction-file hashes. Prompt contents
  are not copied to the audit, and normal chat never injects semantic memory.
- Semantic search defaults to the current machine and project (or exact session
  when no cwd exists). Cross-project/cross-machine search is an explicit UI mode
  and still honors the caller's runner grants and private-note ownership.
- `#note` is a Jarvis-owned two-step HITL operation: exact preview, then a
  short-lived one-time apply token. The preview is shown on every device viewing
  the same session; changed files invalidate it instead of being overwritten.
  Apply and cancel are both one-time operations synchronized to every device;
  cancellation also invalidates the token on a remote Runner.
- Post-turn decision cards are extracted by the Hub, work for every adapter,
  replay when another device opens the session and never block normal input or
  the queue. A newer turn clears stale questions on every device.
- STT/TTS remain Hub services, but confirmed voice turns and staged drafts are
  sent back to the Runner that owns the session.
- The Runner includes the latest unanswered turn's durable `liveActivity` in
  `history`. The Hub replays it after a device returns to the session and clears
  the in-memory copy only after `activity_committed` confirms that the assistant
  reply reached `sessions.json`. A Hub restart is covered by E2E while the Runner
  remains the authoritative journal owner.

## Build phases

- **A — Protocol + doc** (this): `@jarvis/protocol` gains the real Runner↔Hub
  contract (`runner.ts`). No behavior change.
- **B — `@jarvis/core`**: extract `agents.ts` / `native.ts` / `store.ts` (no heavy
  deps) into a shared package the Hub and Runner both import. Hub keeps working.
- **S — Security / auth** (before routing, per decision 4a–4e). Built in slices:
  - **S1 — auth core + WS gate:** `apps/hub/src/auth.ts` (users/devices/invites/
    runner-tokens, all hashed), claim bootstrap, first-message WS auth gate, and
    the client claim/login handshake. `JARVIS_AUTH=off` escape hatch. Tested so
    the owner cannot be locked out.
  - **S2 — invites + devices UI:** mint/redeem invites, device list + revoke,
    per-runner grant model, minimal settings panel.
  - **S3 — audit log:** append-only attribution of actions per device/user.
- **C — `apps/runner`**: headless process, dials the Hub, registers with
  hostname/OS + per-runner token, answers open/send/stream/list/native/stop.
- **D — Hub routing (identity-aware)**: accept runner connections, registry +
  labels, embedded local runner "machine 0", enforce per-user runner grants,
  route client ops to the selected runner.
- **E — UI**: machine selector, online/offline dots, edit-label, settings
  view-mode (per-machine / unified + filter).
- **F — Installers**: `install-runner.sh` (Linux/macOS) + `install-runner.ps1`
  (Windows) with autostart (systemd / launchd / schtasks) + docs.

### Prereqs per runner machine (installer checks, cannot do — interactive)
- The chosen network layer joined (e.g. `tailscale up`), if any.
- At least one supported/authenticated CLI on that machine (`npm run agents:report`).
- Node.js >= 22.

## Negative scope (not in this work)
- No cross-runner session migration or file sync between machines.
- No SSO / OAuth; no password accounts in v1 (device-pairing + optional password
  later). `provider-default` is available, but it is not a Jarvis sandbox (see 4d).
- Voice / STT / TTS / push stay Hub-only; runners are headless.
