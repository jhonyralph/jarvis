# Progressive disclosure for slow voice/agent replies ("ack → process → deliver")

A reusable conversation-design pattern, implemented here for Jarvis but written to be portable to
any voice or chat product doing genuinely slow work (an LLM call over a large context, a multi-step
analysis, a search across many sources). If you're carrying this pattern to another codebase, the
logic to port is `packages/core/src/progressive-reply.ts` — it has zero dependency on Jarvis
internals (no Hub, no WebSocket, no session model).

## The problem

A voice assistant that stays silent while it does slow work feels broken — the user doesn't know if
it heard them, and pauses to think ("processing...") get mistaken for the assistant being done or
stuck. The naive fixes are both wrong:

- **Say nothing until the final reply.** Fine for sub-second replies; feels broken for anything that
  takes several seconds.
- **A generic filler on every reply** ("hmm, let me think..."). Adds latency and noise to replies
  that were going to be instant anyway, and reads as robotic padding rather than a real update.

## The pattern

Two distinct spoken/shown messages in the same turn, not one delayed message:

1. **Ack** — immediate, honest, and specific when possible ("beleza, vou verificar isso" / "checking
   your sessions, one sec" — NOT a vague "processing..."). Fired *before* the slow work starts.
2. **Deliver** — the real result, spoken once it's actually ready. Nothing about this step changes;
   it's the same "speak the reply" your product already does.

The ack is **best-effort and fire-and-forget**: if it fails to speak (TTS error, disconnected
client), that must never block or fail the real work. See `ackThenWork` below.

## The reusable primitive

```ts
// packages/core/src/progressive-reply.ts
export async function ackThenWork<T>(
  speakAck: (text: string) => Promise<void> | void,
  ackText: string,
  work: () => Promise<T>,
): Promise<T>
```

`speakAck` and `work` are injected by the caller — this file has no opinion on *how* you turn text
into audio (TTS call, chat bubble, push notification). Porting it to another stack means copying
this one function (or re-implementing the same two-line contract: try to ack, swallow ack failures,
always run and return `work()`).

## Where Jarvis uses it (and where it deliberately does NOT)

Wired into the operations that are **already known** to be slow — an LLM call reasoning over
multiple sessions, or a fan-out to every connected machine:

- `runAndSendSearch` (`apps/hub/src/index.ts`) — cross-session search: "Só um instante, deixa eu ver
  nas suas sessões."
- `summarizeAndSpeak` — session summary: "Só um instante, já trago o resumo."
- `digestAndSpeak` — cross-machine status digest: "Só um instante, buscando o status de tudo."

**Deliberately NOT wired into the main per-turn agent reply** (`ctx.speak` / `agentTurn`). Whether a
given agent turn will be fast or slow depends on what the agent decides to do (tool calls, model),
so there's no reliable signal to gate an ack on without either guessing (false positives: an ack
before a reply that turns out to be instant, which is exactly the noise this pattern exists to
avoid) or slowing down every reply. If a future gap wants acks on normal conversation turns too, the
right lever is a real signal — e.g. the agent's own "I'm about to run a tool" event — not a blanket
ack on every voice message.

## Deciding when to use it (the part that does NOT generalize)

This is the one piece of judgment every product has to make for itself: wire `ackThenWork` around
operations you *already know* are slow. Don't try to predict duration heuristically for arbitrary
replies — that's a recipe for the exact "annoying generic filler" failure mode this pattern is
meant to avoid.

## Client wiring (Jarvis-specific, illustrative)

The Hub sends a lightweight `{t: "ack_speak", text, audio}` message distinct from the final reply's
own message type (`summary`, `searchResult`, `tts`, …), so the client can play the ack audio without
touching turn/voice-operation state (`apps/hub/web/app.js`):

```js
else if (m.t === 'ack_speak') { if (m.audio) playAudioOnce(m.audio); }
```

`playAudioOnce` here matters: it must not re-arm the microphone or end the "waiting" UI state — the
real turn is still in flight after the ack plays.
