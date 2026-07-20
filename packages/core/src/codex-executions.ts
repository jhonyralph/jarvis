/**
 * Read-only collector for Codex native child rollouts.
 *
 * `codex exec --json` does not currently publish the collaboration tree on stdout, but Codex writes
 * one rollout per child. Its `session_meta` contains stable `id`, `parent_thread_id`, `agent_path`,
 * nickname and depth. This collector turns that documented-on-disk boundary into snapshots; callers
 * diff snapshots and emit the provider-neutral execution lifecycle. It never scrapes terminal text.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { AgentReply, StreamEvent } from "./agents.js";

export type CodexChildState = "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export interface CodexChildRollout {
  id: string;
  parentId: string;
  depth: number;
  path: string;
  nickname?: string;
  role?: string;
  title: string;
  state: CodexChildState;
  startedAt?: number;
  endedAt?: number;
  summary?: string;
  usage?: AgentReply["usage"];
  activities: StreamEvent[];
  file: string;
  mtimeMs: number;
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function toolFromResponse(payload: any): StreamEvent | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (payload.type !== "function_call" && payload.type !== "custom_tool_call") return undefined;
  const name = String(payload.name || "Tool");
  const raw = String(payload.arguments || payload.input || "");
  let args: any = {};
  try { args = raw ? JSON.parse(raw) : {}; } catch { args = { input: raw }; }
  const command = String(args.command || args.cmd || (name === "exec" ? raw : ""));
  const normalized = /exec|shell|command|terminal|bash/i.test(name) ? "Bash" : name;
  const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
  const summary = normalized === "Bash"
    ? `Bash: ${command.replace(/\s+/g, " ").slice(0, 90)}`
    : `${normalized}${path ? `: ${path.split(/[\\/]/).pop()}` : ""}`;
  return { kind: "tool", name: normalized, summary, detail: command.length > 90 ? command : undefined,
    toolId: String(payload.call_id || payload.id || "") || undefined, status: "started", path,
    providerEvent: `codex_rollout.${payload.type}` };
}

function usageFromTokenCount(payload: any): AgentReply["usage"] | undefined {
  const u = payload?.info?.last_token_usage;
  if (!u) return undefined;
  const input = Number(u.input_tokens) || 0, cached = Number(u.cached_input_tokens) || 0, output = Number(u.output_tokens) || 0;
  if (!input && !output) return undefined;
  return {
    inputTokens: input || undefined,
    cachedInputTokens: cached || undefined,
    outputTokens: output || undefined,
    contextTokens: input || undefined,
    contextWindowTokens: Number(payload?.info?.model_context_window) || undefined,
    costKind: "tokens_only",
    source: "Codex child rollout token_count.last_token_usage",
  };
}

/** Parse one child rollout. Forked parent history is ignored: only rows after the latest task start
 * belonging to the child are projected. */
export function parseCodexChildRollout(lines: string[], file = "rollout.jsonl", mtimeMs = 0): CodexChildRollout | undefined {
  const rows: any[] = [];
  for (const line of lines) { try { rows.push(JSON.parse(line)); } catch { /* incomplete tail */ } }
  const meta = rows.find((row) => row?.type === "session_meta")?.payload;
  const spawn = meta?.source?.subagent?.thread_spawn;
  const parentId = String(meta?.parent_thread_id || spawn?.parent_thread_id || "");
  const id = String(meta?.id || "");
  if (!id || !parentId || meta?.thread_source !== "subagent") return undefined;

  let start = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.type === "event_msg" && rows[i]?.payload?.type === "task_started") { start = i; break; }
  }
  const tail = start >= 0 ? rows.slice(start) : [];
  const started = tail[0]?.payload;
  let state: CodexChildState = start >= 0 ? "running" : "unknown";
  let endedAt: number | undefined, summary: string | undefined, usage: AgentReply["usage"];
  const activities: StreamEvent[] = [];
  const startedTools = new Map<string, StreamEvent>();

  for (const row of tail) {
    const payload = row?.payload;
    if (row?.type === "response_item") {
      if (payload?.type === "message" && payload.role === "assistant") {
        const text = textContent(payload.content); if (text) activities.push({ kind: "text", text, providerEvent: "codex_rollout.message" });
      }
      const tool = toolFromResponse(payload);
      if (tool) { activities.push(tool); if (tool.toolId) startedTools.set(tool.toolId, tool); }
      if (payload?.type === "function_call_output" || payload?.type === "custom_tool_call_output") {
        const callId = String(payload.call_id || "");
        const prior = startedTools.get(callId);
        activities.push({ kind: "tool", name: prior?.name || "Tool", summary: prior?.summary || "Ferramenta concluída",
          toolId: callId || undefined, status: "completed", providerEvent: `codex_rollout.${payload.type}` });
      }
    }
    if (row?.type !== "event_msg") continue;
    if (payload?.type === "token_count") usage = usageFromTokenCount(payload) || usage;
    if (payload?.type === "task_complete") {
      state = "succeeded"; summary = typeof payload.last_agent_message === "string" ? payload.last_agent_message : summary;
      endedAt = Number(payload.completed_at) > 0 ? Number(payload.completed_at) * 1000 : Date.parse(row.timestamp) || undefined;
    }
    if (payload?.type === "turn_aborted") {
      const reason = String(payload.reason || payload.message || "");
      state = /cancel|interrupt/i.test(reason) ? "cancelled" : "failed";
      summary = reason || summary; endedAt = Date.parse(row.timestamp) || undefined;
    }
  }

  const agentPath = String(meta.agent_path || spawn?.agent_path || "");
  const nickname = String(meta.agent_nickname || spawn?.agent_nickname || "") || undefined;
  const role = String(spawn?.agent_role || "") || undefined;
  return {
    id, parentId, depth: Math.max(1, Number(spawn?.depth) || 1), path: agentPath, nickname, role,
    title: agentPath.split("/").filter(Boolean).at(-1) || nickname || role || "Subagente Codex",
    state,
    startedAt: Number(started?.started_at) > 0 ? Number(started.started_at) * 1000 : undefined,
    endedAt, summary, usage, activities, file, mtimeMs,
  };
}

function rolloutFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: ReturnType<typeof readdirSync> = [] as any;
    try { entries = readdirSync(dir, { withFileTypes: true }) as any; } catch { return; }
    for (const entry of entries as any[]) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path); else if (/\.jsonl$/i.test(entry.name)) found.push(path);
    }
  };
  walk(root); return found;
}

/** Snapshot every native child linked to `parentThreadId`. `sinceMs` bounds filesystem work for a
 * live turn while still allowing restart reconciliation when omitted. */
export function codexChildRollouts(parentThreadId: string, opts: { root?: string; sinceMs?: number } = {}): CodexChildRollout[] {
  if (!parentThreadId) return [];
  const root = opts.root || join(homedir(), ".codex", "sessions");
  const out: CodexChildRollout[] = [];
  for (const file of rolloutFiles(root)) {
    let stat: ReturnType<typeof statSync>;
    try { stat = statSync(file); } catch { continue; }
    if (opts.sinceMs && stat.mtimeMs < opts.sinceMs) continue;
    let parsed: CodexChildRollout | undefined;
    try { parsed = parseCodexChildRollout(readFileSync(file, "utf8").split(/\r?\n/), file, stat.mtimeMs); } catch { continue; }
    if (parsed?.parentId === parentThreadId) out.push(parsed);
  }
  return out.sort((a, b) => (a.startedAt || a.mtimeMs) - (b.startedAt || b.mtimeMs));
}
