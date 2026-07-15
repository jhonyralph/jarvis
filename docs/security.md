# Jarvis — security model & hardening

Jarvis drives coding agents with `bypassPermissions`, i.e. **arbitrary code
execution** on every machine it controls. Access to the Hub is therefore access
to a shell. This document is the threat model, the layers in place, and the
checklist for exposing it beyond a private network.

## Threat model

Two deployment shapes:

- **Private (default, this repo's setup):** Hub reachable only over a private
  network (Tailscale `serve`, tailnet-only). The network is the outer wall; the
  app auth is the inner wall. Never use Tailscale `funnel` (public).
- **Public server:** Hub reachable from the internet (behind a TLS proxy). The
  network is NOT a wall — **app auth is the only wall** and must withstand active
  attack (brute force, floods, DoS).

Trust boundaries:

- **Clients (UI)** authenticate per-device (pairing tokens). Untrusted until authed.
- **Runners (machines)** authenticate with a per-runner token. Untrusted until registered.
- **Host-local processes** are trusted (they can read `~/.jarvis`, restart the
  hub, etc.) — this is why the recovery admin API is loopback-only.

## Layers in place

| Layer | What it does | Where |
|-------|--------------|-------|
| Device-pairing auth | per-device tokens, SHA-256 hashed at rest, `timingSafeEqual` compare | `auth.ts` |
| WS auth gate | until authed, only `authinfo/claim/redeem/auth` are processed | `index.ts` |
| Per-runner authz | owner/member roles; members limited to allow-listed machines | `auth.ts` |
| Runner token | per-machine token to register a runner; hashed | `auth.ts` |
| Brute-force throttle | per-IP failed-attempt limiter (10/min → exp backoff, ≤15 min) | `guard.ts` |
| Unauth timeout | connections that never authenticate are dropped (20 s) | `index.ts` |
| Connection caps | per-IP + global concurrent-connection limits | `guard.ts` |
| Payload cap | oversized WS frames rejected (default 20 MB) without crashing | `guard.ts` |
| Crash resilience | per-connection + process-level error nets — a stray error can't DoS the hub | `index.ts` |
| Security headers | CSP, `X-Frame-Options: DENY`, `nosniff`, referrer/permissions policy | `index.ts` |
| Origin allowlist | optional Origin check for UI clients | `guard.ts` |
| Audit log | append-only attribution incl. failed/blocked auth with IP | `auth.ts` |
| Loopback admin | recovery/mint API bound to 127.0.0.1 only (never proxied) | `index.ts` |
| Recovery | mint a pairing code from the host with zero logged-in devices | `jarvis.ps1` |

Tokens/codes are high-entropy (pairing codes ~144-bit, device tokens 256-bit),
so brute force is infeasible even before throttling; the throttle is defense in
depth + anti-DoS + intrusion visibility (audited).

## The honest limit (containment)

Auth says *who* and *which machine* — it does **not** sandbox. A member with
access to a runner can make the agent do anything on that machine. So:

- Share a runner **only** with people you'd hand a shell.
- Prefer a **sandbox/VM runner** for guests (not your main box).
- Every action is attributed in the audit log (`jarvis.ps1 audit`).

## Public-server checklist (must-do before exposing to the internet)

1. **TLS in front** — terminate HTTPS/WSS at a proxy (Caddy auto-HTTPS,
   Cloudflare Tunnel, nginx). Never expose plain `ws://` publicly; tokens would
   travel in cleartext. The hub logs a warning if it sees non-loopback plaintext.
2. **`JARVIS_TRUST_PROXY=on`** — so the per-IP throttle and connection caps see
   the real client IP (not the proxy's `127.0.0.1`, which would collapse everyone
   into one bucket).
3. **Keep `JARVIS_AUTH=on`** — obviously. `off` trusts every connection.
4. **`JARVIS_ALLOWED_ORIGINS`** (optional) — restrict which web origins may open a
   UI socket.
5. **Consider `JARVIS_MAX_CONN_PER_IP` / `JARVIS_MAX_CONN`** for your scale.
6. **Watch the audit log** — `auth_fail` / `auth_blocked` / `runner_reject`
   entries with IPs signal intrusion attempts.
7. **Only share sandbox runners** with anyone you don't fully trust.

## Tunables (env)

`JARVIS_AUTH` (on/off) · `JARVIS_TRUST_PROXY` · `JARVIS_MAX_CONN_PER_IP` (40) ·
`JARVIS_MAX_CONN` (800) · `JARVIS_MAX_PAYLOAD_MB` (20) · `JARVIS_ALLOWED_ORIGINS` ·
`JARVIS_ADMIN_PORT` (4578, loopback).

## Residual risks / not done

- **CSP uses `'unsafe-inline'` for scripts** (the UI is one inline script). XSS
  surface is limited (single origin, no 3rd-party scripts, user content escaped),
  but a nonce-based CSP would be stronger.
- **No MFA / password second factor** (device pairing only) — planned optional.
- **No runner sandboxing / restricted-no-bypass mode** yet — containment is
  per-machine sharing + audit only.
- **No TLS enforcement** at the app layer (by design — TLS is the proxy's job);
  the app only warns.
