# Architecture

The implementation and validation source of truth for cross-agent/model parity is
[`agent-parity-matrix.md`](agent-parity-matrix.md). An adapter is not considered
fully supported merely because it can return a final answer; it must satisfy the
streaming, persistence, history, model and local/remote conformance contract
defined there.

## Principles

1. **Security first.** Jarvis state is local (crash-safe JSON snapshots + files;
   see `packages/core/src/persist.ts`). Provider CLIs still call their own cloud
   services. Tailscale/private networking is recommended; TLS proxy exposure is
   supported only with the documented auth/proxy controls.
2. **Agnostic.** Never lock to one agent, one voice engine, or one transport.
   Everything external is behind a swappable **adapter**.
3. **Voice local.** STT + TTS run on the user's machine. The only external
   dependency is the selected agent CLI's own inference and configured integrations.
4. **Multi-client, multi-desktop.** One chat, reachable from the phone and any
   number of desktops. Any client may also be a passive **listener**.

## Topology: Hub + Runners + Clients

- **Hub** — one always-on machine. Owns the local store (sessions, messages,
  transcripts) as **atomic JSON snapshots** under `~/.jarvis` — every write is
  temp-file + fsync + rename with a `.bak`, so a crash can't corrupt or lose it.
  Serves the chat **PWA**. Hosts the local **voice**
  services (STT/TTS). Registers Runners and **routes** messages. Reached over
  Tailscale.
- **Runner** — one per desktop. Registers with the Hub and runs `AgentAdapter`s
  locally. Executes/streams supported agent sessions on that machine. Desktop A
  can run Claude while Desktop B runs Gemini or Cursor Agent — same lifecycle.
- **Client** — the Hub's PWA (mobile + desktop browsers), later a native app.
  Thin: shows chat, sends text, push-to-talk audio, and can subscribe as a
  **listener** to play spoken (TTS) responses.

## Adapters (the agnostic core) — `packages/core`

- `AgentAdapter` — `capabilities` · `available` · `send(onEvent)` · `oneShot`
  plus optional native binding/usage/descriptor. Implementations and support
  levels are enumerated in the parity matrix.
- `packages/core/src/turn.ts` — managed lifecycle shared by Hub and Runner.
- `packages/core/src/activity-replay.ts` — reconstructs only the latest unanswered
  turn from the fsynced execution journal. A stored assistant message closes the
  replay window, preventing duplicate completed responses.
- `packages/core/src/agent-contract.ts` — descriptors, models, usage and event
  schema; the current web transport still carries the compatible `stream` shape.
- `packages/protocol/src/runner.ts` — actual Hub↔Runner WebSocket contract.

## Voice pipeline (local)

```
wake word (openWakeWord "Jarvis")
  → STT (faster-whisper, small)      -- audio → text
  → AgentAdapter + canonical event contract -- text → live events → response
  → TTS (Piper)                       -- response → audio
  → clients viewing the target session
```

An optional **orchestrator** — a headless agent session that interprets voice
intent ("open project X, run tests") and routes — is itself just a special
`AgentAdapter`, and is **not** shown in the chat UI.

## Audio delivery

TTS is generated on the Hub and broadcast to clients subscribed to the target
chat session. The wake/voice session can additionally receive the same audio
when it is controlling another conversation. There is no separate public
`listen` protocol today.

## Data & security model

- **Storage:** crash-safe (atomic) JSON snapshots + local files on each machine
  that owns sessions; pending activity is an append-only fsynced execution
  journal and survives Hub/Runner restart. Provider-native transcripts remain
  in provider homes.
- **Network:** private Tailscale is recommended; reverse proxy/TLS is optional.
- **Encryption:** supplied by Tailscale or the operator's TLS proxy.
- **External calls:** the selected provider CLI's inference/integrations. Voice is
  fully offline.

## Current implementation milestones

1. Local voice, PWA, auth, push and managed sessions.
2. Hub + multi-machine Runner protocol v6, including durable execution journals,
   manifest/replay and provider-neutral subprocess trees.
3. Shared provider-neutral turn lifecycle and typed usage ledger.
4. Claude/Codex native integration plus registered adapters/status for the wider
   CLI matrix. External adapters remain unverified until their installed version
   passes the real probe gate.
