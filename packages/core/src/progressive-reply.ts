/**
 * "ack → process → deliver" — a portable, provider-agnostic pattern for slow voice/agent replies.
 *
 * Problem it solves: a voice assistant that stays silent while it does genuinely slow work (an
 * LLM call over a large context, a multi-step analysis, a cross-session search) feels broken —
 * the user doesn't know if it heard them. The fix is NOT a generic "filler word" to mask network
 * latency; it's an honest, immediate acknowledgment ("entendido, já verifico isso") sent BEFORE the
 * real work starts, followed by the real result once it's actually ready. Two distinct spoken
 * messages in the same turn, not one delayed message.
 *
 * This module has ZERO dependency on Jarvis internals (Hub, sessions, WebSocket) — `speakAck` and
 * `work` are injected by the caller, so this same file (or its logic, ported to another stack) can
 * be reused by any voice/agent product doing the same kind of slow, genuinely-multi-second task.
 *
 * How to decide when to use it (the part that doesn't generalize — use your product's own judgment
 * here): wire `ackThenWork` around operations you ALREADY KNOW are slow (a cross-session search, a
 * multi-source summary, a tool call chain) — not around every reply. Speaking an ack before a reply
 * that was going to be instant anyway just adds noise and delay; the win is specifically for the
 * cases where the user would otherwise wait in silence for several seconds.
 */

/**
 * Speaks `ackText` immediately (fire-and-forget — a failure to speak the ack must never block or
 * fail the real work), then runs `work` and returns its result once it's actually ready.
 *
 * @param speakAck  however your product turns text into an audible/visible acknowledgment (e.g. a
 *                  TTS call, a chat bubble, a push notification) — kept abstract on purpose.
 * @param ackText   a short, honest acknowledgment ("beleza, vou verificar" / "on it, one sec") —
 *                  NOT a vague filler; it should describe what's about to happen when possible.
 * @param work      the actual slow operation. Its resolution is what gets spoken/shown as the real
 *                  reply — the caller is responsible for that second step, same as it would be
 *                  without this helper.
 */
export async function ackThenWork<T>(
  speakAck: (text: string) => Promise<void> | void,
  ackText: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    void Promise.resolve(speakAck(ackText)).catch(() => { /* the ack is best-effort — never blocks or fails the real work */ });
  } catch { /* speakAck may also throw SYNCHRONOUSLY (before returning a promise) — same rule applies */ }
  return work();
}
