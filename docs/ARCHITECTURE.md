# Architecture

## Principles

1. **Security first.** No third-party storage. All data local (SQLite + files).
   Transport is **Tailscale only** (private WireGuard, no public exposure).
2. **Agnostic.** Never lock to one agent, one voice engine, or one transport.
   Everything external is behind a swappable **adapter**.
3. **Voice local.** STT + TTS run on the user's machine. The only external
   dependency is the agent's own inference (Claude/Codex).
4. **Multi-client, multi-desktop.** One chat, reachable from the phone and any
   number of desktops. Any client may also be a passive **listener**.

## Topology: Hub + Runners + Clients

- **Hub** — one always-on machine. Owns the local **SQLite** DB (sessions,
  messages, transcripts). Serves the chat **PWA**. Hosts the local **voice**
  services (STT/TTS). Registers Runners and **routes** messages. Reached over
  Tailscale.
- **Runner** — one per desktop. Registers with the Hub and runs `AgentAdapter`s
  locally (Claude Code, Codex). Executes/streams agent sessions on that machine.
  Desktop A can run Claude while Desktop B runs Codex — same chat.
- **Client** — the Hub's PWA (mobile + desktop browsers), later a native app.
  Thin: shows chat, sends text, push-to-talk audio, and can subscribe as a
  **listener** to play spoken (TTS) responses.

## Adapters (the agnostic core) — `packages/protocol`

- `AgentAdapter` — `start` · `send` · `onOutput` · `resume` · `stop`.
  Implementations: `claude-code`, `codex`, … Adding an agent = one adapter.
- `STTAdapter` / `TTSAdapter` — swappable voice engines
  (`faster-whisper`, `piper`, `kokoro`, …), chosen by config.
- `Transport` — Tailscale by default; abstracted so it can change.

## Voice pipeline (local)

```
wake word (openWakeWord "Jarvis")
  → STT (faster-whisper, small)      -- audio → text
  → AgentAdapter (Claude/Codex)      -- text → response
  → TTS (kokoro | piper)             -- response → audio
  → listeners (any subscribed client plays it)
```

An optional **orchestrator** — a headless agent session that interprets voice
intent ("open project X, run tests") and routes — is itself just a special
`AgentAdapter`, and is **not** shown in the chat UI.

## "Listener" mode

TTS audio for a session is a **subscribable channel**. Clients send
`{ t: 'listen', sessionId, audio: true }`; the Hub broadcasts `{ t: 'tts', ... }`
audio chunks to all listeners. This decouples *where the agent runs* and *where
a command is issued* from *where the response is heard* — e.g., issue from
desktop A, hear it on the phone and desktop B.

## Data & security model

- **Storage:** SQLite + local files on the Hub machine. Nothing leaves.
- **Network:** Tailscale tailnet only. No ports exposed publicly.
- **Encryption:** Tailscale (WireGuard) end-to-end on the wire.
- **External calls:** only the agent's inference API (Claude/Codex). Voice is
  fully offline.

## Build phases

1. **Local voice on the machine** — prove STT+TTS locally. *(TTS ✅)*
2. **Hub** — SQLite + WS server + Runner registration + one `ClaudeCodeAdapter`.
3. **PWA** — chat on mobile + desktop over Tailscale; push-to-talk + listener.
4. **Codex adapter + multi-desktop + wake word.**
