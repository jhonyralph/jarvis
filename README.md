# Jarvis

Self-hosted, **agent-agnostic**, voice-first control plane for coding agents
(Claude Code, Codex, …) — controllable from **mobile and multiple desktops**,
with a **local "Jarvis" voice** (talk & listen, never read).

> Codename `jarvis` = the whole control plane, not just the voice.

## Why this exists

Off-the-shelf options (Happy/Happier) are archived / pre-release / store data on
third parties. This project is the opposite:

- **Security first — nothing on third parties.** All data (sessions, transcripts,
  audio) stays on your machines (SQLite + files). Network is **Tailscale only**
  (private WireGuard, no public exposure).
- **Voice is 100% local** (STT + TTS on your hardware). No ElevenLabs.
- The only external is the **agent's own inference** (Claude/Codex) — which you
  already use, and which does not store/train on API data.

## Architecture (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md))

```
CLIENTS (one web PWA on mobile + every desktop; push-to-talk / wake word)
   │  can also be a passive "listener" (subscribe to hear TTS)
   ▼            Tailscale (private)
 HUB  — local DB (SQLite) · serves the chat PWA · local voice (STT/TTS) · routing
   │            (each desktop registers as a Runner)
   ├── RUNNER A (Claude Code adapter)
   └── RUNNER B (Codex adapter)          … N desktops
```

Everything external enters through a **swappable adapter**
(`AgentAdapter`, `STTAdapter`, `TTSAdapter`, `Transport`) — see
[`packages/protocol`](packages/protocol/src).

## Layout

| Path | What |
|---|---|
| `packages/protocol/` | Shared TS contracts: adapter interfaces + WS protocol (the agnostic core) |
| `services/voice/` | Python: local STT/TTS. **Working now:** Piper TTS |
| `apps/hub/` | (next) TS Hub server |
| `apps/runner/` | (next) TS agent runner + adapters |
| `apps/web/` | (next) chat PWA |

## Status

- **Phase 1 — local voice on the machine:** ✅ TTS working (Piper).
  See `services/voice`. Next: STT (faster-whisper) → close the voice loop.
- Phase 2: Hub. Phase 3: PWA (mobile + desktop). Phase 4: Codex adapter + multi-desktop + wake word.

## Stack

TypeScript Hub/Runner/Web + Python voice service, over local WebSocket.

## License

TBD (personal project).
