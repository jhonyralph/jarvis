/**
 * The agnostic core: everything external enters through one of these adapters.
 * Adding an agent / voice engine / transport = implementing an interface here,
 * never touching the Hub's routing.
 */

// ---------------------------------------------------------------------------
// Agents (Claude Code, Codex, …)
// ---------------------------------------------------------------------------

export type Role = "user" | "assistant" | "system";

export interface AgentSession {
  id: string;
  runnerId: string;
  /** adapter name, e.g. "claude-code" | "codex" */
  agent: string;
  cwd: string;
  title?: string;
  createdAt: number;
}

export interface AgentMessage {
  sessionId: string;
  role: Role;
  text: string;
  ts: number;
  /** true while the assistant is still streaming this message */
  partial?: boolean;
}

export interface StartOptions {
  cwd: string;
  /** resume an existing agent session if provided */
  sessionId?: string;
}

export interface AgentAdapter {
  /** stable id, e.g. "claude-code" */
  readonly name: string;
  start(opts: StartOptions): Promise<AgentSession>;
  send(sessionId: string, text: string): Promise<void>;
  /** called by the Runner to stream assistant output back to the Hub */
  onOutput(cb: (msg: AgentMessage) => void): void;
  resume(sessionId: string): Promise<AgentSession>;
  stop(sessionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Voice (local, swappable)
// ---------------------------------------------------------------------------

export interface STTResult {
  text: string;
  lang?: string;
}

export interface STTAdapter {
  readonly name: string; // "faster-whisper", ...
  /** audio in (wav/pcm bytes) -> text */
  transcribe(audio: Uint8Array, opts?: { lang?: string }): Promise<STTResult>;
}

export interface TTSAdapter {
  readonly name: string; // "piper", "kokoro", ...
  /** text -> audio (wav bytes). A streaming variant will be added for low latency. */
  synthesize(text: string, opts?: { voice?: string }): Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// Transport (Tailscale by default)
// ---------------------------------------------------------------------------

export interface Transport {
  readonly name: string; // "tailscale", ...
}
