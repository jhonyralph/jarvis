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
import type { AgentEvent } from "./agent.js";
import type { ContextActor, ContextManifest } from "./context.js";
import type { ExecutionHubToRunner, ExecutionRunnerToHub, ExecutionState, ManagedExecutionPlanWire, ManagedExecutionPolicyWire } from "./execution.js";

export type RunnerOS = "linux" | "darwin" | "win32" | string;

/** Increment when a protocol change affects observable turn/history semantics.
 *  v7: framework_publish / framework_published (Framework Jarvis distribution to machines). */
export const RUNNER_PROTOCOL_VERSION = 7;

/** Sent by the Runner at `register` time and kept in the Hub registry. */
export interface RunnerInfo {
  runnerId: string;
  host: string; // os.hostname()
  os: RunnerOS;
  agents: string[]; // available adapter names, e.g. ["claude-code","codex","mock"]
  /** Canonical adapter descriptors. `agents` remains for backward compatibility with v1 Hubs. */
  agentDescriptors?: unknown[];
  /** Account-plan snapshots by adapter; null means the CLI exposes no usable limit data. */
  agentUsage?: Record<string, unknown | null>;
  protocolVersion?: number;
  version?: string;
  /** short git HEAD sha of the runner's checkout ("+dirty" suffix if uncommitted) — lets the Hub
   *  spot a runner drifting behind (or ahead of) the Hub's own build. */
  commit?: string;
  /** Durable proof that dependencies/validation completed for a correlated update before restart. */
  updateReceipt?: { requestId: string; targetCommit: string; current: string; preparedAt: number };
  /** Durable failure/success log produced by an external updater before the runner restarted. */
  updateResult?: { requestId: string; ok: boolean; log?: string; current?: string; restartRequired?: boolean; rolledBack?: boolean; retryable?: boolean; preparedAt?: number };
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
  /** Whether at least one message already exists; agent/cwd are locked once true. */
  started?: boolean;
}

export interface RunnerMsg {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ts?: number;
  /** role:"tool" — the tool name + (file tools) the real path, +/- line counts and diff rows */
  name?: string;
  /** role:"tool" — the FULL command/args behind the row (shown when expanded) */
  detail?: string;
  path?: string;
  adds?: number;
  dels?: number;
  rows?: DiffRowMeta[];
  /** role:"assistant" — the turn's grouped tool/sub-agent activity, so native history renders the
   *  same nested flow shown live (see @jarvis/core HistEvent). Opaque to the protocol layer. */
  activity?: unknown[];
  agent?: string;
  speaker?: string;
  images?: string[];
  files?: Array<{ name: string; content?: string }>;
  contextManifest?: ContextManifest;
  usage?: {
    costUsd?: number;
    costKind?: "billed" | "estimated_api_equivalent" | "subscription_included" | "tokens_only" | "unavailable";
    source?: string;
    model?: string;
    effort?: string;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    contextTokens?: number;
    contextWindowTokens?: number;
  };
}

/** Live activity while an agent works, mirrored to the streaming UI. */
export interface RunnerStreamEvent {
  kind: "start" | "text" | "tool" | "thinking" | "done" | "error" | "cancelled";
  text?: string; // text / thinking chunk, or final text on "done"
  name?: string; // tool name (Bash, Edit, Read…)
  summary?: string; // tool one-liner ("Editando foo.ts")
  detail?: string; // tool FULL command/args (untruncated), shown when the row is expanded
  usage?: RunnerMsg["usage"];
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
  | { t: "update_done"; requestId?: string; ok: boolean; dirty?: boolean; behind?: number; log?: string; current?: string; restartRequired?: boolean; rolledBack?: boolean; retryable?: boolean }
  | { t: "busy"; message: string } // recusa de turno concorrente na mesma sessão
  | { t: "sessions"; sessions: RunnerSession[]; recentDirs?: string[] }
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
      inputTokens?: number;
      contextWindowTokens?: number;
      model?: string;
      effort?: string;
      /** files touched by tools in this session (real paths, for the viewer/diff panel) */
      files?: TouchedFileMeta[];
      /** Durable replay for the latest user turn that does not yet have a stored assistant reply. */
      liveActivity?: AgentEvent[];
      liveState?: ExecutionState;
      liveTurnId?: string;
      liveUpdatedAt?: number;
      liveTruncated?: boolean;
    }
  | { t: "filediff"; reqId: string; path: string; name: string; rows?: DiffRowMeta[]; adds?: number; dels?: number; error?: string }
  /** Canonical AgentEvent lifecycle. New Hubs/Runners must use this; `stream` remains read-only migration input. */
  | { t: "agent_event"; sessionId: string; agent?: string; event: AgentEvent }
  /** Live metadata update for a managed session, e.g. native CLI id discovered during first turn. */
  | { t: "session"; sessionId: string; nativeId?: string }
  /** The assistant reply is now durably present in sessions.json; live replay may be cleared. */
  | { t: "activity_committed"; sessionId: string; turnId: string }
  | { t: "context_manifest"; sessionId: string; manifest: ContextManifest }
  /** @deprecated v1 compatibility during rolling upgrades. */
  | { t: "stream"; sessionId: string; agent?: string; ev: RunnerStreamEvent }
  | { t: "message"; sessionId: string; message: RunnerMsg }
  | { t: "activity"; sessionId: string; name?: string; summary?: string; detail?: string; path?: string; adds?: number; dels?: number; rows?: DiffRowMeta[] }
  | { t: "filecontent"; reqId: string; path: string; name: string; content?: string; size?: number; truncated?: boolean; error?: string }
  /** directory listing for the folder browser (reply to Hub->Runner "listdir") */
  | { t: "dirs"; reqId: string; path: string; parent: string; entries: string[] }
  /** Correlated result of a remote delete. `ids` contains only sessions actually removed. */
  | { t: "deleted"; reqId: string; sessionId?: string; ids: string[]; ok: boolean; okCount: number }
  | { t: "runs"; active: string[] }
  /** available slash-commands / skills on this machine (reply to Hub->Runner "commands") */
  | { t: "command_list"; reqId?: string; commands: unknown[]; cwd?: string }
  /** "@" file-mention matches under a session's cwd (reply to Hub->Runner "mention") */
  | { t: "mention_list"; reqId?: string; files: string[] }
  /** Live account-plan snapshot for one adapter (reply to Hub->Runner "usage"). */
  | { t: "usage_info"; reqId: string; agent: string; plan: unknown | null; planStatus: "available" | "not_reported" | "unsupported" | "error" }
  | { t: "memory_preview"; reqId: string; sessionId?: string; token: string; target: string; note: string; appendText: string; beforeHash: string; exists: boolean; expiresAt: number }
  | { t: "memory_applied"; reqId: string; token: string; sessionId?: string; ok: boolean; target?: string; beforeHash?: string; afterHash?: string; error?: string }
  /** Result of materializing a published Framework Jarvis on this machine (reply to framework_publish). */
  | { t: "framework_published"; requestId: string; ok: boolean; version?: number; hash?: string; written?: number; removed?: number; skipped?: boolean; error?: string }
  | { t: "error"; reqId?: string; message: string }
  | { t: "pong" }
  | ExecutionRunnerToHub;

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
      speaker?: string;
      model?: string;
      effort?: string;
      actor?: ContextActor;
    }
  | { t: "list" }
  /** create a fresh managed session on the runner (reply: history with the new id) */
  | { t: "new"; reqId: string; agent?: string; cwd?: string }
  /** folder browser for the "new conversation" dialog (reply: dirs) */
  | { t: "listdir"; reqId: string; path?: string }
  /** change agent/cwd of a not-yet-started session (reply: history) */
  | { t: "configure"; reqId: string; sessionId: string; agent?: string; cwd?: string }
  | { t: "delete"; reqId: string; sessionId?: string; sessionIds?: string[]; alsoNative?: boolean }
  | { t: "readfile"; reqId: string; path: string; cwd?: string }
  | { t: "readdiff"; reqId: string; sessionId: string; path: string }
  | { t: "caps"; agent?: string }
  /** Query this machine's live account-plan usage for an adapter. */
  | { t: "usage"; reqId: string; agent?: string }
  /** Start a Jarvis Conselho workflow and persist the final synthesis into this managed session. */
  | { t: "council_start"; requestId: string; sessionId: string; requestText: string; mode: "quick" | "technical" | "critical" | "deep"; finalTaskId: string; title?: string; plan: ManagedExecutionPlanWire; policy?: ManagedExecutionPolicyWire }
  /** Publish a Framework Jarvis snapshot to this machine; the Runner materializes it and replies
   *  framework_published. Content-addressed by `hash` — a machine already on that hash is a no-op. */
  | { t: "framework_publish"; requestId: string; version: number; hash: string; files: Array<{ path: string; content: string }> }
  /** enumerate this machine's slash-commands / skills (reply: command_list) */
  | { t: "commands"; reqId: string; sessionId?: string }
  /** "@" file-mention search under a session's cwd (reply: mention_list) */
  | { t: "mention"; reqId: string; q?: string; sessionId?: string }
  /** Preview a provider-instruction write without modifying the runner filesystem. */
  | { t: "memory_preview"; reqId: string; text: string; sessionId?: string; actor?: ContextActor }
  /** Apply a previously previewed, one-time write. */
  | { t: "memory_apply"; reqId: string; token: string }
  /** Invalidate a preview without writing; idempotent cleanup for multi-device HITL. */
  | { t: "memory_cancel"; token: string }
  /** @deprecated v4 compatibility. New Hubs must use preview/apply. */
  | { t: "memory_append"; text: string; sessionId?: string }
  /** Drop the trailing user message from a managed session after a cancelled turn. */
  | { t: "dropLast"; sessionId: string }
  | { t: "stop"; sessionId: string }
  | { t: "cancel"; sessionId: string } // abort a live turn (user hit "parar")
  /** `requestId` correlates a durable Hub deployment; old runners may ignore the extra fields.
   *  force discards local changes on disposable child machines and may be persisted by the Hub
   *  for offline fleet updates. The Hub's own checkout remains conservative unless forced there. */
  | { t: "update"; requestId?: string; targetCommit?: string; force?: boolean }
  | { t: "ping" }
  | ExecutionHubToRunner;

export type RunnerProtocol = RunnerToHub | HubToRunner;
