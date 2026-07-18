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
  /** short git HEAD sha of the runner's checkout ("+dirty" suffix if uncommitted) — lets the Hub
   *  spot a runner drifting behind (or ahead of) the Hub's own build. */
  commit?: string;
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
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ts?: number;
  /** role:"tool" — the tool name + (file tools) the real path, +/- line counts and diff rows */
  name?: string;
  path?: string;
  adds?: number;
  dels?: number;
  rows?: DiffRowMeta[];
}

/** Live activity while an agent works, mirrored to the streaming UI. */
export interface RunnerStreamEvent {
  kind: "start" | "text" | "tool" | "thinking" | "done" | "error" | "cancelled";
  text?: string; // text / thinking chunk, or final text on "done"
  name?: string; // tool name (Bash, Edit, Read…)
  summary?: string; // tool one-liner ("Editando foo.ts")
  usage?: { costUsd?: number; inputTokens?: number; outputTokens?: number };
  /** tool_use id — lets sub-agent (Task) activity be correlated to a parent block */
  toolId?: string;
  /** parent_tool_use_id — set when this event happens INSIDE a spawned sub-agent (Task) */
  parentId?: string;
  /** for file tools: the real (usually absolute) file path, so the UI can open it */
  path?: string;
  /** for edits: line counts of this change */
  adds?: number;
  dels?: number;
  /** for edits: the diff rows of THIS specific change (for the inline expand) */
  rows?: DiffRowMeta[];
}

/** A file touched by tools in a session (real path + action + +/- line counts). */
export interface TouchedFileMeta { path: string; action: "read" | "edit" | "write" | string; adds: number; dels: number; }
/** One row of a rendered diff: ' ' context, '+' add, '-' del, '@' section marker. */
export interface DiffRowMeta { t: " " | "+" | "-" | "@" | string; s: string; }

// --- Runner -> Hub ---
export type RunnerToHub =
  | { t: "register"; token: string; info: RunnerInfo }
  /** Resultado do update NESTA máquina. Sem isso o Hub só sabia que enviou o pedido, e um
   *  update abortado (repo sujo) ficava invisível — o dono achava que tinha atualizado. */
  | { t: "update_done"; ok: boolean; dirty?: boolean; behind?: number; log?: string }
  | { t: "busy"; message: string } // recusa de turno concorrente na mesma sessão
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
      /** underlying native session id (e.g. the real claude session, for `claude --resume`) */
      nativeId?: string;
      /** files touched by tools in this session (real paths, for the viewer/diff panel) */
      files?: TouchedFileMeta[];
    }
  | { t: "filediff"; reqId: string; path: string; name: string; rows?: DiffRowMeta[]; adds?: number; dels?: number; error?: string }
  | { t: "stream"; sessionId: string; ev: RunnerStreamEvent }
  | { t: "message"; sessionId: string; message: RunnerMsg }
  | { t: "activity"; sessionId: string; name?: string; summary?: string; path?: string; adds?: number; dels?: number; rows?: DiffRowMeta[] }
  | { t: "filecontent"; reqId: string; path: string; name: string; content?: string; size?: number; truncated?: boolean; error?: string }
  /** directory listing for the folder browser (reply to Hub->Runner "listdir") */
  | { t: "dirs"; reqId: string; path: string; parent: string; entries: string[] }
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
      /** idempotency key — the Runner executes a given turnId at most once (dedupes re-delivery:
       *  client resend on reconnect, queue re-flush, WS redelivery). See @jarvis/core createSeenSet. */
      turnId?: string;
      /** attachments carried by a queue flush (top-level model/effort accompany them) */
      attachments?: Array<{ name: string; content: string; image?: boolean }>;
      model?: string;
      effort?: string;
    }
  | { t: "list" }
  | { t: "delete"; sessionId?: string; sessionIds?: string[]; alsoNative?: boolean }
  | { t: "readfile"; reqId: string; path: string; cwd?: string }
  | { t: "readdiff"; reqId: string; sessionId: string; path: string }
  | { t: "caps"; agent?: string }
  | { t: "stop"; sessionId: string }
  | { t: "cancel"; sessionId: string } // abort a live turn (user hit "parar")
  /** force: descarta alterações locais (git reset --hard) antes de atualizar — só sob pedido explícito do dono. */
  | { t: "update"; force?: boolean }
  | { t: "ping" };

export type RunnerProtocol = RunnerToHub | HubToRunner;
