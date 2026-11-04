/** Codex tool activity shared by stdout, rollout polling, native history and child rollouts.
 * Supports the legacy patch envelope and the item_completed format observed in CLI 0.154.0.
 * Never reads files or executes commands. Successful command output is not copied to activity. */
import { posix, win32 } from "node:path";
import type { StreamEvent } from "./agents.js";
import type { DiffRow } from "./native.js";

export type CodexToolEvent = StreamEvent & { kind: "tool"; name: string; summary: string };
const base = (path: string): string => path.split(/[\\/]/).pop() || path;
const detailOf = (value: string): string | undefined => value ? value.length > 4000 ? value.slice(0, 4000) + "\n… (truncado)" : value : undefined;

function localPath(value: string): string {
  if (!value.startsWith("file://")) return value;
  try {
    const u = new URL(value);
    const path = decodeURIComponent(u.pathname);
    return u.hostname ? `//${u.hostname}${path}` : path.replace(/^\/([a-z]:\/)/i, "$1");
  } catch { return value; }
}

function absolutePath(path: string, cwd?: string): string {
  path = localPath(path);
  if (typeof cwd !== "string" || !cwd || /^(?:[a-z]:[\\/]|[\\/])/i.test(path)) return path;
  const dir = localPath(cwd);
  if (!/^(?:[a-z]:[\\/]|[\\/])/i.test(dir)) return path;
  return /^[a-z]:[\\/]/i.test(dir) ? win32.resolve(dir, path).replace(/\\/g, "/") : posix.resolve(dir, path);
}

function commandText(command: unknown): string {
  if (Array.isArray(command)) {
    const args = command.filter((v): v is string => typeof v === "string");
    const flag = args.findIndex(v => /^(?:-command|-c|-lc)$/i.test(v));
    return flag >= 0 ? args.slice(flag + 1).join(" ") : args.map(a => /\s/.test(a) ? "'" + a.replace(/'/g, "''") + "'" : a).join(" ");
  }
  const raw = typeof command === "string" ? command.trim() : "";
  const wrapper = /^(?:"[^"]*(?:pwsh|powershell|bash|sh)(?:\.exe)?"|\S*(?:pwsh|powershell|bash|sh)(?:\.exe)?)\s+.*?-(?:Command|lc|c)\s+([\s\S]+)$/i.exec(raw);
  const body = wrapper?.[1] || raw;
  return wrapper && /^(["'])[\s\S]*\1$/.test(body) ? body.slice(1, -1) : body;
}

/** A conservative lexer for literal shell operations, NOT an evaluator. Quoted strings stay
 * opaque; here-strings, blocks and substitutions fall back to a command row. In particular a
 * script printing "Get-Content ..." must not invent a Read. */
function literalCommands(command: string): string[][] {
  if (/@['"]|<<|[{}]|\$\(|`/.test(command)) return [];
  const parts: string[][] = [], tokens: string[] = [];
  let token = "", quote = "";
  const flush = () => { if (token) tokens.push(token); token = ""; };
  const part = () => { flush(); if (tokens.length) parts.push(tokens.splice(0)); };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) {
        if (command[i + 1] === quote) { token += c; i++; } else quote = "";
      } else token += c;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "#") { while (i < command.length && command[i] !== "\n") i++; part(); }
    else if (/[;|&\n]/.test(c)) part();
    else if (/\s/.test(c)) flush();
    else token += c;
  }
  if (quote) return [];
  part(); return parts;
}

type CommandActivity = Pick<CodexToolEvent, "name" | "summary" | "detail" | "path">;
function commandActivities(command: string, cwd?: string): CommandActivity[] {
  const cmd = commandText(command), parts = literalCommands(cmd), reads: CommandActivity[] = [];
  const detail = detailOf(cmd);
  let changedCwd = false;
  for (const tokens of parts) {
    const tool = tokens[0].toLowerCase();
    if (/^(?:cd|set-location|push-location|pushd)$/.test(tool)) changedCwd = true;
    if (!/^(?:get-content|cat|type)$/.test(tool)) continue;
    // Only these flags have known arity here. Everything else degrades without a clickable path.
    const args = tokens.slice(1).filter(v => !/^(?:-raw|-literalpath|-path)$/i.test(v));
    const paths = args.length && args.every(v => !/^[-$]/.test(v) && !/[,$*?<>()[\]]/.test(v)) ? args : [];
    for (const path of paths) {
      if (changedCwd && !/^(?:[a-z]:[\\/]|[\\/])/i.test(path)) continue;
      reads.push({ name: "Read", summary: `Lendo ${base(path)}`, path: absolutePath(path, cwd), detail });
    }
    if (!paths.length) reads.push({ name: "Read", summary: "Lendo arquivo(s)", detail });
  }
  if (reads.length) {
    const seen = new Set<string | undefined>();
    return reads.filter(r => { if (seen.has(r.path)) return false; seen.add(r.path); return true; });
  }
  const names = parts.map(p => p[0].toLowerCase());
  if (names.some(n => n === "rg" || n === "select-string")) return [{ name: "Grep", summary: "Buscando no projeto", detail: detailOf(cmd) }];
  if (names.some(n => /^(?:get-childitem|ls|dir|find)$/.test(n))) return [{ name: "Glob", summary: "Listando arquivos", detail: detailOf(cmd) }];
  return [{ name: "Bash", summary: "Bash: " + cmd.replace(/\s+/g, " ").slice(0, 90), detail: cmd.length > 90 ? detailOf(cmd) : undefined }];
}

export function codexCommandActivity(command: string): CommandActivity {
  return commandActivities(command)[0];
}

export function codexChangeRows(change: any): DiffRow[] {
  if ((change?.type === "add" || change?.type === "delete") && typeof change.content === "string") {
    const lines = change.content.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop(); // a final newline is not an extra source line
    return lines.map((s: string) => ({ t: change.type === "add" ? "+" : "-", s }));
  }
  if (Array.isArray(change?.rows)) return change.rows.filter((r: any) => r && [" ", "+", "-", "@"].includes(r.t) && typeof r.s === "string");
  const rows: DiffRow[] = [];
  let inHunk = false;
  for (const line of String(change?.unified_diff || change?.diff || "").split(/\r?\n/)) {
    if (line.startsWith("@@")) { inHunk = true; rows.push({ t: "@", s: line }); }
    else if (!inHunk && /^(?:\+\+\+|---) /.test(line)) continue;
    else if (line.startsWith("+")) rows.push({ t: "+", s: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ t: "-", s: line.slice(1) });
    else if (line.startsWith(" ")) rows.push({ t: " ", s: line.slice(1) });
  }
  return rows;
}

export function codexToolItemEvents(item: any, completed = true, rowLimit = 300): CodexToolEvent[] {
  if (!item || typeof item !== "object") return [];
  const failed = completed && (item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0) || !!item.error);
  const status = completed ? failed ? "failed" : "completed" : "started";
  const error = failed ? detailOf(String(item.error?.message || item.error || item.stderr || item.aggregated_output || "ferramenta falhou")) : undefined;
  const common = { status, error, toolId: typeof item.id === "string" ? item.id : undefined } as const;
  if (item.type === "CommandExecution" || item.type === "command_execution") {
    const cmd = commandText(item.command);
    if (!cmd) return [];
    const detail = detailOf(cmd);
    const parsedReads = Array.isArray(item.parsed_cmd) ? item.parsed_cmd.filter((p: any) => p?.type === "read" && typeof p.path === "string") : [];
    const activities: CommandActivity[] = parsedReads.length
      ? parsedReads.map((p: any) => ({ name: "Read", summary: `Lendo ${base(p.path)}`, path: absolutePath(p.path, item.cwd), detail }))
      : commandActivities(cmd, item.cwd);
    // Legacy native clients inflect Read/Edit as successful operations. A failed attempt must
    // remain a generic error row there as well as carrying the canonical failed status.
    return activities.map(a => ({ kind: "tool", ...a, ...common, name: failed ? "Tool" : a.name,
      summary: failed ? `Falhou: ${a.summary}` : a.summary, detail: failed ? detailOf(`${cmd}\n${error}`) : a.detail,
      toolId: common.toolId && activities.length > 1 ? `${common.toolId}:${a.path || a.name}` : common.toolId }));
  }
  if (["FileChange", "file_change", "patch", "apply_patch"].includes(item.type)) {
    const changes = item.changes || item.files || (item.path ? [{ ...item }] : []);
    const entries: Array<[string, any]> = Array.isArray(changes)
      ? changes.filter(c => c && typeof (c.path || c.file) === "string").map(c => [c.path || c.file, c])
      : typeof changes === "object" ? Object.entries(changes) : [];
    return entries.flatMap(([path, change]) => {
      if (!path || !change || typeof change !== "object") return [];
      // Stdout commonly announces only paths: wait for rollout metadata instead of a duplicate.
      if (typeof change.content !== "string" && typeof change.unified_diff !== "string" && typeof change.diff !== "string" && !Array.isArray(change.rows)) return [];
      const write = /^(?:add|create|new)$/.test(change.type || change.kind || "");
      const rows = codexChangeRows({ ...change, type: write ? "add" : change.type || change.kind });
      return [{ kind: "tool", ...common, name: failed ? "Tool" : write ? "Write" : "Edit", summary: `${failed ? "Falha ao alterar" : write ? "Criando" : "Editando"} ${base(path)}`,
        detail: failed ? error : undefined,
        path, toolId: common.toolId ? `${common.toolId}:${path}` : undefined,
        adds: rows.filter(r => r.t === "+").length, dels: rows.filter(r => r.t === "-").length,
        rows: rows.length <= rowLimit ? rows : undefined } as CodexToolEvent];
    });
  }
  if (item.type === "ImageView" && typeof item.path === "string") {
    const path = localPath(item.path);
    return [{ kind: "tool", ...common, name: "Read", summary: `Lendo ${base(path)}`, path }];
  }
  if (item.type === "Extension" && item.kind === "web.search") return [{ kind: "tool", ...common, name: "WebSearch", summary: `Pesquisando: ${String(item.query || "").slice(0, 60)}`, detail: detailOf(String(item.query || "")) }];
  return [];
}

export function codexRolloutToolEvents(row: any, rowLimit = 300): CodexToolEvent[] {
  if (row?.type !== "event_msg") return [];
  const p = row.payload;
  if (p?.type === "item_completed") return codexToolItemEvents(p.item, true, rowLimit).map(e => ({ ...e, providerEvent: `codex_rollout.${p.item.type}` }));
  if (p?.type === "patch_apply_end") return codexToolItemEvents({ ...p, type: "FileChange", id: p.call_id, status: p.success === false ? "failed" : "completed" }, true, rowLimit).map(e => ({ ...e, providerEvent: "patch_apply_end" }));
  if (p?.type === "web_search_end") return [{ kind: "tool", name: "WebSearch", summary: `Pesquisando: ${String(p.query || "").slice(0, 60)}`, toolId: p.call_id, status: "completed" }];
  return [];
}

export function codexResponseToolEvent(payload: any): CodexToolEvent | undefined {
  if (!payload || !["function_call", "custom_tool_call"].includes(payload.type)) return undefined;
  const name = String(payload.name || "Tool"), raw = String(payload.arguments || payload.input || "");
  let args: any; try { args = JSON.parse(raw); } catch { /* custom tools accept plain text */ }
  const shellTool = /(?:^|[._])(?:exec|exec_command|shell|shell_command|bash)$/.test(name);
  const command = shellTool ? args?.cmd || args?.command || (name === "exec" && !/\b(?:await|const|let)\b|\btools\.|\btext\s*\(/.test(raw) ? raw : "") : "";
  const path = typeof args?.file_path === "string" ? args.file_path : typeof args?.path === "string" ? args.path : undefined;
  const activity = typeof command === "string" && command ? codexCommandActivity(command)
    : { name, summary: path ? `${name}: ${base(path)}` : `Ferramenta: ${name}`, detail: detailOf(raw), path };
  return { kind: "tool", ...activity, toolId: payload.call_id || payload.id, status: "started", providerEvent: `codex_rollout.${payload.type}` };
}
