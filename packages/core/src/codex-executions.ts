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
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { open as openAsync, readdir as readdirAsync, stat as statAsync } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
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

/* ------------------------------------------------------------------- projeção incremental
 * O parser era "leia o arquivo inteiro, depois projete". Isso custava caro no lugar errado: o
 * coletor roda a cada 750 ms e relia TODO rollout tocado desde o início do turno — numa máquina
 * real, 58 arquivos e 522 MB POR TIQUE, o que sozinho travava o event loop do Hub (um tique de
 * ~1,1 s contra um intervalo de 0,75 s: nunca terminava a tempo).
 *
 * Agora a projeção é um redutor alimentado linha a linha. Isso é o que permite guardar estado por
 * arquivo e consumir só os bytes novos.
 *
 * EQUIVALÊNCIA com o comportamento antigo (`tail = rows.slice(último task_started)`): cada
 * `task_started` ZERA a acumulação, e tudo antes do primeiro é ignorado. O resultado final é
 * idêntico ao do slice — sem precisar ter todas as linhas na mão ao mesmo tempo.
 */
interface ChildProjection {
  seenStart: boolean;
  state: CodexChildState;
  startedAt?: number;
  endedAt?: number;
  summary?: string;
  usage?: AgentReply["usage"];
  activities: StreamEvent[];
  startedTools: Map<string, StreamEvent>;
}

function emptyProjection(): ChildProjection {
  return { seenStart: false, state: "unknown", activities: [], startedTools: new Map() };
}

function cloneProjection(p: ChildProjection): ChildProjection {
  return { ...p, activities: p.activities.slice(), startedTools: new Map(p.startedTools) };
}

function applyRow(p: ChildProjection, row: any): void {
  const payload = row?.payload;
  if (row?.type === "event_msg" && payload?.type === "task_started") {
    p.seenStart = true; p.state = "running";
    p.startedAt = Number(payload.started_at) > 0 ? Number(payload.started_at) * 1000 : undefined;
    p.endedAt = undefined; p.summary = undefined; p.usage = undefined;
    p.activities = []; p.startedTools = new Map();
    return;
  }
  if (!p.seenStart) return;   // histórico do pai antes do turno da criança: ignorado, como antes
  if (row?.type === "response_item") {
    if (payload?.type === "message" && payload.role === "assistant") {
      const text = textContent(payload.content);
      if (text) p.activities.push({ kind: "text", text, providerEvent: "codex_rollout.message" });
    }
    const tool = toolFromResponse(payload);
    if (tool) { p.activities.push(tool); if (tool.toolId) p.startedTools.set(tool.toolId, tool); }
    if (payload?.type === "function_call_output" || payload?.type === "custom_tool_call_output") {
      const callId = String(payload.call_id || "");
      const prior = p.startedTools.get(callId);
      p.activities.push({ kind: "tool", name: prior?.name || "Tool", summary: prior?.summary || "Ferramenta concluída",
        toolId: callId || undefined, status: "completed", providerEvent: `codex_rollout.${payload.type}` });
    }
  }
  if (row?.type !== "event_msg") return;
  if (payload?.type === "token_count") p.usage = usageFromTokenCount(payload) || p.usage;
  if (payload?.type === "task_complete") {
    p.state = "succeeded";
    p.summary = typeof payload.last_agent_message === "string" ? payload.last_agent_message : p.summary;
    p.endedAt = Number(payload.completed_at) > 0 ? Number(payload.completed_at) * 1000 : Date.parse(row.timestamp) || undefined;
  }
  if (payload?.type === "turn_aborted") {
    const reason = String(payload.reason || payload.message || "");
    p.state = /cancel|interrupt/i.test(reason) ? "cancelled" : "failed";
    p.summary = reason || p.summary;
    p.endedAt = Date.parse(row.timestamp) || undefined;
  }
}

function finish(meta: any, p: ChildProjection, file: string, mtimeMs: number): CodexChildRollout | undefined {
  const spawn = meta?.source?.subagent?.thread_spawn;
  const parentId = String(meta?.parent_thread_id || spawn?.parent_thread_id || "");
  const id = String(meta?.id || "");
  if (!id || !parentId || meta?.thread_source !== "subagent") return undefined;
  const agentPath = String(meta.agent_path || spawn?.agent_path || "");
  const nickname = String(meta.agent_nickname || spawn?.agent_nickname || "") || undefined;
  const role = String(spawn?.agent_role || "") || undefined;
  return {
    id, parentId, depth: Math.max(1, Number(spawn?.depth) || 1), path: agentPath, nickname, role,
    // Rótulo do subagente: preferir o que ele FAZ (folha do agent_path, ex. "performance_diag", ou o
    // papel "explorer"/"worker") ao apelido de pessoa que o Codex atribui ("Nietzsche", "Kant"…). O
    // apelido só entra como último recurso, quando não há nenhum descritor de tarefa.
    title: agentPath.split("/").filter(Boolean).at(-1) || role || nickname || "Subagente Codex",
    state: p.state,
    startedAt: p.startedAt,
    endedAt: p.endedAt, summary: p.summary, usage: p.usage,
    // Cópia: o array vive no cache entre tiques e cresce por push. Entregar o interno faria o
    // snapshot já devolvido mudar por baixo de quem o guardou.
    activities: p.activities.slice(),
    file, mtimeMs,
  };
}

/** Parse one child rollout. Forked parent history is ignored: only rows after the latest task start
 * belonging to the child are projected. */
export function parseCodexChildRollout(lines: string[], file = "rollout.jsonl", mtimeMs = 0): CodexChildRollout | undefined {
  const p = emptyProjection();
  let meta: any, metaSeen = false;
  for (const line of lines) {
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }   // cauda incompleta
    if (!metaSeen && row?.type === "session_meta") { metaSeen = true; meta = row.payload; }
    applyRow(p, row);
  }
  return finish(meta, p, file, mtimeMs);
}

/* --------------------------------------------------------------------- cache por arquivo
 * Três economias, em ordem de impacto:
 *   (1) FILTRO ANTES DA LEITURA. `session_meta` é a primeira linha do rollout, então o dono do
 *       arquivo sai de ~4 KB de cabeçalho — não dos 76 MB do corpo. Antes o `parentId` só era
 *       conhecido DEPOIS de ler e parsear o arquivo inteiro, e aí quase tudo era descartado.
 *       Meta é imutável, então isso é resolvido uma vez por arquivo e nunca mais.
 *   (2) CACHE POR (size, mtimeMs). Arquivo que não mudou desde o último tique devolve o snapshot
 *       anterior com ZERO I/O.
 *   (3) LEITURA INCREMENTAL POR OFFSET. Quando mudou, lê só os bytes anexados — mesmo padrão que o
 *       `codexRolloutAppend` vizinho já usava para os patches.
 */
const HEAD_BYTES = 64 * 1024;
const CACHE_LIMIT = 20_000;   // guarda-chuva contra crescimento sem fim; rollouts são milhares

interface FileCache {
  /** `undefined` = ainda não resolvido; `null` = não é rollout de subagente utilizável. */
  meta?: any | null;
  parentId: string;
  size: number;
  mtimeMs: number;
  offset: number;      // bytes já consumidos como linhas COMPLETAS
  carry: string;       // cauda sem \n final: reavaliada a cada tique, nunca commitada
  decoder: StringDecoder;
  projection: ChildProjection;
  snapshot?: CodexChildRollout;
}

const fileCache = new Map<string, FileCache>();

/** Zera o cache de rollouts. Existe para testes e para diagnóstico ao vivo. */
export function resetCodexRolloutCache(): void { fileCache.clear(); }

function newEntry(): FileCache {
  return { parentId: "", size: -1, mtimeMs: -1, offset: 0, carry: "",
    decoder: new StringDecoder("utf8"), projection: emptyProjection() };
}

function entryFor(file: string, size: number): FileCache {
  let entry = fileCache.get(file);
  // Encolheu => arquivo trocado ou rotacionado: o offset não vale mais, recomeça do zero.
  if (entry && size < entry.offset) { fileCache.delete(file); entry = undefined; }
  if (!entry) {
    if (fileCache.size >= CACHE_LIMIT) fileCache.clear();
    entry = newEntry();
    fileCache.set(file, entry);
  }
  return entry;
}

function metaFromText(text: string): any | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }   // linha cortada pelo fim do cabeçalho
    if (row?.type === "session_meta") return row.payload ?? null;
  }
  return undefined;   // não encontrado NESTE trecho
}

function adoptMeta(entry: FileCache, meta: any | null): void {
  const spawn = meta?.source?.subagent?.thread_spawn;
  const owner = String(meta?.parent_thread_id || spawn?.parent_thread_id || "");
  const usable = !!meta && meta.thread_source === "subagent" && !!owner && !!String(meta.id || "");
  entry.meta = usable ? meta : null;
  entry.parentId = usable ? owner : "";
}

function ingest(entry: FileCache, chunk: Buffer): void {
  entry.offset += chunk.length;
  const parts = (entry.carry + entry.decoder.write(chunk)).split(/\r?\n/);
  entry.carry = parts.pop() || "";
  for (const line of parts) {
    if (!line.trim()) continue;
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }
    applyRow(entry.projection, row);
  }
}

function buildSnapshot(entry: FileCache, file: string, size: number, mtimeMs: number): CodexChildRollout | undefined {
  // A cauda sem \n ainda pode crescer no próximo tique, então nunca entra no estado durável — mas
  // precisa aparecer no snapshot, porque era assim que o parser antigo (que lia o arquivo inteiro)
  // enxergava a última linha. Sem isto um `task_complete` final sem \n deixaria a criança presa em
  // "running" para sempre.
  let projected = entry.projection;
  if (entry.carry.trim()) {
    let row: any;
    try { row = JSON.parse(entry.carry); } catch { row = undefined; }
    if (row) { projected = cloneProjection(entry.projection); applyRow(projected, row); }
  }
  entry.size = size; entry.mtimeMs = mtimeMs;
  entry.snapshot = finish(entry.meta, projected, file, mtimeMs);
  return entry.snapshot;
}

function readRange(file: string, start: number, length: number): Buffer {
  if (length <= 0) return Buffer.alloc(0);
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buf, read, length - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    return read === length ? buf : buf.subarray(0, read);
  } finally { closeSync(fd); }
}

async function readRangeAsync(file: string, start: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const handle = await openAsync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buf, read, length - read, start + read);
      if (bytesRead <= 0) break;
      read += bytesRead;
    }
    return read === length ? buf : buf.subarray(0, read);
  } finally { await handle.close(); }
}

function resolveMeta(file: string, size: number): any | null {
  const head = metaFromText(readRange(file, 0, Math.min(size, HEAD_BYTES)).toString("utf8"));
  if (head !== undefined) return head;
  if (size <= HEAD_BYTES) return null;
  // `session_meta` fora do cabeçalho é fora do contrato do Codex, mas ler tudo uma vez é melhor do
  // que descartar em silêncio uma criança de verdade.
  return metaFromText(readRange(file, 0, size).toString("utf8")) ?? null;
}

async function resolveMetaAsync(file: string, size: number): Promise<any | null> {
  const head = metaFromText((await readRangeAsync(file, 0, Math.min(size, HEAD_BYTES))).toString("utf8"));
  if (head !== undefined) return head;
  if (size <= HEAD_BYTES) return null;
  return metaFromText((await readRangeAsync(file, 0, size)).toString("utf8")) ?? null;
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

async function rolloutFilesAsync(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: any[];
    try { entries = await readdirAsync(dir, { withFileTypes: true }) as any[]; } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path); else if (/\.jsonl$/i.test(entry.name)) found.push(path);
    }
  };
  await walk(root); return found;
}

function childSnapshot(file: string, parentThreadId: string, sinceMs?: number): CodexChildRollout | undefined {
  // (1) Dono já conhecido e não é este pai: nem `stat` é preciso. Meta não muda.
  const known = fileCache.get(file);
  if (known?.meta !== undefined && known.parentId !== parentThreadId) return undefined;

  let st: ReturnType<typeof statSync>;
  try { st = statSync(file); } catch { fileCache.delete(file); return undefined; }

  const entry = entryFor(file, st.size);
  if (entry.meta === undefined) adoptMeta(entry, resolveMeta(file, st.size));
  if (entry.meta === null || entry.parentId !== parentThreadId) return undefined;
  if (sinceMs && st.mtimeMs < sinceMs) return undefined;
  // (2) Nada mudou desde a última leitura.
  if (entry.size === st.size && entry.mtimeMs === st.mtimeMs && entry.snapshot) return entry.snapshot;
  // (3) Só o que foi anexado.
  if (st.size > entry.offset) ingest(entry, readRange(file, entry.offset, st.size - entry.offset));
  return buildSnapshot(entry, file, st.size, st.mtimeMs);
}

async function childSnapshotAsync(file: string, parentThreadId: string, sinceMs?: number): Promise<CodexChildRollout | undefined> {
  const known = fileCache.get(file);
  if (known?.meta !== undefined && known.parentId !== parentThreadId) return undefined;

  let st: Awaited<ReturnType<typeof statAsync>>;
  try { st = await statAsync(file); } catch { fileCache.delete(file); return undefined; }

  const entry = entryFor(file, st.size);
  if (entry.meta === undefined) adoptMeta(entry, await resolveMetaAsync(file, st.size));
  if (entry.meta === null || entry.parentId !== parentThreadId) return undefined;
  if (sinceMs && st.mtimeMs < sinceMs) return undefined;
  if (entry.size === st.size && entry.mtimeMs === st.mtimeMs && entry.snapshot) return entry.snapshot;
  if (st.size > entry.offset) ingest(entry, await readRangeAsync(file, entry.offset, st.size - entry.offset));
  return buildSnapshot(entry, file, st.size, st.mtimeMs);
}

const byStart = (a: CodexChildRollout, b: CodexChildRollout): number =>
  (a.startedAt || a.mtimeMs) - (b.startedAt || b.mtimeMs);

/** Snapshot every native child linked to `parentThreadId`. `sinceMs` bounds filesystem work for a
 * live turn while still allowing restart reconciliation when omitted. */
export function codexChildRollouts(parentThreadId: string, opts: { root?: string; sinceMs?: number } = {}): CodexChildRollout[] {
  if (!parentThreadId) return [];
  const root = opts.root || join(homedir(), ".codex", "sessions");
  const out: CodexChildRollout[] = [];
  for (const file of rolloutFiles(root)) {
    const snap = childSnapshot(file, parentThreadId, opts.sinceMs);
    if (snap) out.push(snap);
  }
  return out.sort(byStart);
}

/** Igual ao `codexChildRollouts`, sem bloquear o event loop. É o que a varredura periódica usa; a
 * versão síncrona fica para o flush final do turno, onde a ordem importa mais que a latência. */
export async function codexChildRolloutsAsync(parentThreadId: string, opts: { root?: string; sinceMs?: number } = {}): Promise<CodexChildRollout[]> {
  if (!parentThreadId) return [];
  const root = opts.root || join(homedir(), ".codex", "sessions");
  const out: CodexChildRollout[] = [];
  for (const file of await rolloutFilesAsync(root)) {
    const snap = await childSnapshotAsync(file, parentThreadId, opts.sinceMs);
    if (snap) out.push(snap);
  }
  return out.sort(byStart);
}
