/**
 * Runner <-> Hub protocol (the real, as-built contract).
 *
 * A Runner is a machine (the host itself, or a remote Ubuntu/macOS/Windows box)
 * that executes agents locally and streams results back to the Hub. Runners dial
 * the Hub over an outbound WebSocket and authenticate with an app token; the Hub
 * is the router and the single UI. Transport (Tailscale / VPN / tunnel / LAN) is
 * an external operator choice — this protocol assumes only a WebSocket.
 *
 * Correlation: request-scoped Hub->Runner messages carry a `reqId`; the Runner
 * echoes it on the matching reply so the Hub can route back to the right client.
 */

export type RunnerOS = "linux" | "darwin" | "win32" | string;

/** Sent by the Runner at `register` time and kept in the Hub registry. */
export interface RunnerInfo {
  runnerId: string;
  host: string; // os.hostname()
  os: RunnerOS;
  agents: string[]; // available adapter names, e.g. ["claude-code","codex","mock"]
  version?: string;
  /** friendly name set at install (JARVIS_LABEL); the Hub uses it as the initial label */
  label?: string;
  /** true for the Hub's own embedded runner ("machine 0") */
  local?: boolean;
}

/** One session as listed by a Runner (managed by Jarvis, or a native CLI session). */
export interface RunnerSession {
  id: string;
  title: string;
  agent: string;
  cwd: string;
  updatedAt: number;
  source: "managed" | "native";
  /** native sessions may be read-only depending on the agent */
  writable?: boolean;
}

export interface RunnerMsg {
  role: "user" | "assistant" | "system";
  text: string;
  ts?: number;
}

/** Live activity while an agent works, mirrored to the streaming UI. */
export interface RunnerStreamEvent {
  kind: "start" | "text" | "tool" | "thinking" | "done" | "error";
  text?: string; // text / thinking chunk, or final text on "done"
  name?: string; // tool name (Bash, Edit, Read…)
  summary?: string; // tool one-liner ("Editando foo.ts")
  usage?: { costUsd?: number; inputTokens?: number; outputTokens?: number };
}

// --- Runner -> Hub ---
export type RunnerToHub =
  | { t: "register"; token: string; info: RunnerInfo }
  | { t: "sessions"; sessions: RunnerSession[] }
  | { t: "caps"; agent: string; caps: unknown }
  | {
      t: "history";
      reqId: string;
      sessionId: string;
      title: string;
      agent: string;
      cwd: string;
      writable: boolean;
      messages: RunnerMsg[];
      total: number;
    }
  | { t: "stream"; sessionId: string; ev: RunnerStreamEvent }
  | { t: "message"; sessionId: string; message: RunnerMsg }
  | { t: "runs"; active: string[] }
  | { t: "error"; reqId?: string; message: string }
  | { t: "pong" };

// --- Hub -> Runner ---
export type HubToRunner =
  | { t: "welcome"; runnerId: string }
  | { t: "reject"; reason: string }
  | { t: "open"; reqId: string; sessionId: string }
  | {
      t: "send";
      sessionId: string;
      text: string;
      agent?: string;
      cwd?: string;
      opts?: { model?: string; effort?: string };
    }
  | { t: "list" }
  | { t: "caps"; agent?: string }
  | { t: "stop"; sessionId: string }
  | { t: "ping" };

export type RunnerProtocol = RunnerToHub | HubToRunner;
