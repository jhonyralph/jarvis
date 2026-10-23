/**
 * BRW-IDE-00 F3 — roteamento do editor leve no Hub: `writefile` (gravar) e `searchfiles` (buscar).
 *
 * Fica fora do `index.ts` de propósito: as regras aqui são de SEGURANÇA e merecem teste de unidade
 * sem subir um Hub inteiro (o `index.ts` só injeta as dependências reais).
 *
 * Regras (spec §3, lei 3 — "Browser e IDE são owner-only"):
 *   - só o DONO edita ou busca, em qualquer máquina, mesmo que um membro tenha grant nela; a recusa
 *     é auditada (`file_write_denied` / `file_search_denied`);
 *   - toda gravação bem-sucedida é auditada (`file_write`) com caminho + bytes — NUNCA o conteúdo;
 *   - máquina remota em protocolo anterior à capacidade é recusada com motivo, em vez de receber um
 *     frame que morreria em silêncio do outro lado (feature-detect, lei 6);
 *   - o `reqId` do cliente nunca vira chave no registro de pendências do Hub (colisão entre
 *     clientes); o Hub cunha o seu e devolve o do cliente na resposta.
 */
import { RUNNER_CAPABILITY_SINCE } from "@jarvis/protocol";
import type { FileSearchOptions, FileSearchResult, FileWriteOptions, FileWriteResult } from "@jarvis/core";

export interface FileEditRunner { online: boolean; protocolVersion: number }
export interface FileEditActor { userId?: string | null; deviceId?: string | null }
export interface FileEditPendingMeta { clientReqId: string; op: "writefile" | "searchfiles"; filePath?: string; bytes?: number; force?: boolean }

export interface FileEditDeps<S> {
  localId: string;
  isOwner(ws: S): boolean;
  actor(ws: S): FileEditActor;
  canUseRunner(ws: S, runnerId: string): boolean;
  /** máquina para onde o cliente está roteado quando o frame não diz `runnerId` */
  defaultRunner(ws: S): string;
  runner(runnerId: string): FileEditRunner | undefined;
  /** registra a pendência e envia ao runner; false = não deu para enviar */
  forward(ws: S, runnerId: string, frame: Record<string, unknown> & { t: string }, meta: FileEditPendingMeta): boolean;
  send(ws: S, frame: Record<string, unknown>): void;
  audit(event: string, info: FileEditActor & { runnerId?: string; detail?: string }): void;
  writeLocal(path: string, cwd: string | undefined, content: string, opts: FileWriteOptions): Promise<FileWriteResult>;
  searchLocal(cwd: string, query: string, opts: FileSearchOptions): Promise<FileSearchResult>;
}

export const FILE_EDIT_CLIENT_OPS = new Set(["writefile", "searchfiles"]);
const MAX_RESULTS_WIRE = 1000;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function cleanConflict(c: unknown): Record<string, unknown> | undefined {
  if (!c || typeof c !== "object") return undefined;
  const x = c as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (num(x.mtimeMs) !== undefined) out.mtimeMs = x.mtimeMs;
  if (num(x.size) !== undefined) out.size = x.size;
  if (x.missing === true) out.missing = true;
  if (x.exists === true) out.exists = true;
  return out;
}

/** Resposta do runner é dado NÃO confiável: só passa adiante o que tem o formato do contrato. */
function cleanHits(v: unknown): unknown[] {
  if (!Array.isArray(v)) return [];
  const out: unknown[] = [];
  for (const h of v) {
    if (out.length >= MAX_RESULTS_WIRE) break;
    if (!h || typeof h !== "object") continue;
    const x = h as Record<string, unknown>;
    if (typeof x.path !== "string" || typeof x.line !== "number") continue;
    const hl = Array.isArray(x.hl) && x.hl.length === 2 && x.hl.every((n) => typeof n === "number") ? x.hl : [0, 0];
    out.push({ path: x.path, rel: str(x.rel) ?? x.path, line: x.line, col: num(x.col) ?? 1, preview: (str(x.preview) ?? "").slice(0, 400), hl });
  }
  return out;
}

export function createFileEditRouter<S>(deps: FileEditDeps<S>) {
  function savedFrame(clientReqId: string, runnerId: string, r: Partial<FileWriteResult> & { path?: string }): Record<string, unknown> {
    return {
      t: "filesaved", reqId: clientReqId, runnerId, path: r.path ?? "", name: r.name, ok: r.ok === true,
      mtimeMs: num(r.mtimeMs), size: num(r.size), created: r.created === true ? true : undefined,
      conflict: cleanConflict(r.conflict), error: str(r.error)?.slice(0, 300),
    };
  }
  function resultsFrame(clientReqId: string, runnerId: string, cwd: string, query: string, r: Partial<FileSearchResult>): Record<string, unknown> {
    return { t: "searchresults", reqId: clientReqId, runnerId, cwd, query, results: cleanHits(r.results), truncated: r.truncated === true, engine: r.engine, error: str(r.error)?.slice(0, 300) };
  }
  function auditWrite(ws: S, runnerId: string, path: string, bytes: number | undefined, r: { created?: boolean; force?: boolean }): void {
    const tags = (r.force ? " [sobrescrito]" : "") + (r.created ? " [criado]" : "");
    deps.audit("file_write", { ...deps.actor(ws), runnerId, detail: `${path} (${bytes ?? "?"} B)${tags}` });
  }
  /** Máquina alvo + guardas comuns. Devolve o motivo da recusa, ou null se pode seguir. */
  function gate(ws: S, runnerId: string, capability: "fileWrite" | "fileSearch", what: string): string | null {
    if (!deps.canUseRunner(ws, runnerId)) return "sem acesso a esta máquina";
    if (runnerId === deps.localId) return null;
    const rc = deps.runner(runnerId);
    if (!rc) return "não conheço esta máquina";
    if (!rc.online) return "máquina offline";
    const need = RUNNER_CAPABILITY_SINCE[capability];
    if ((rc.protocolVersion || 1) < need) return `esta máquina está no protocolo ${rc.protocolVersion || 1}; ${what} exige ${need} — atualize-a`;
    return null;
  }

  async function handleWrite(ws: S, msg: Record<string, unknown>): Promise<void> {
    const clientReqId = str(msg.reqId) ?? "";
    const runnerId = str(msg.runnerId) || deps.defaultRunner(ws);
    const path = str(msg.path) ?? "";
    const reply = (r: Partial<FileWriteResult>): void => deps.send(ws, savedFrame(clientReqId, runnerId, { path, ...r }));
    if (!deps.isOwner(ws)) {
      deps.audit("file_write_denied", { ...deps.actor(ws), runnerId, detail: path.slice(0, 300) });
      reply({ ok: false, error: "apenas o dono pode editar arquivos" }); return;
    }
    if (!path.trim() || typeof msg.content !== "string") { reply({ ok: false, error: "pedido de gravação inválido" }); return; }
    const refused = gate(ws, runnerId, "fileWrite", "editar arquivos");
    if (refused) { reply({ ok: false, error: refused }); return; }
    const content = msg.content;
    const opts: FileWriteOptions = { expectedMtimeMs: num(msg.expectedMtimeMs), expectedSize: num(msg.expectedSize), force: msg.force === true, create: msg.create === true };
    const cwd = str(msg.cwd) || undefined;
    if (runnerId === deps.localId) {
      const r = await deps.writeLocal(path, cwd, content, opts);
      if (r.ok) auditWrite(ws, runnerId, r.path, r.size, { created: r.created, force: opts.force });
      deps.send(ws, savedFrame(clientReqId, runnerId, r));
      return;
    }
    const bytes = Buffer.byteLength(content, "utf8");
    const ok = deps.forward(ws, runnerId, { t: "writefile", path, cwd, content, ...opts }, { clientReqId, op: "writefile", filePath: path, bytes, force: opts.force });
    if (!ok) reply({ ok: false, error: "não foi possível enviar o pedido à máquina" });
  }

  async function handleSearch(ws: S, msg: Record<string, unknown>): Promise<void> {
    const clientReqId = str(msg.reqId) ?? "";
    const runnerId = str(msg.runnerId) || deps.defaultRunner(ws);
    const cwd = str(msg.cwd) ?? "", query = str(msg.query) ?? "";
    const reply = (r: Partial<FileSearchResult>): void => deps.send(ws, resultsFrame(clientReqId, runnerId, cwd, query, r));
    if (!deps.isOwner(ws)) {
      deps.audit("file_search_denied", { ...deps.actor(ws), runnerId, detail: `${cwd}: ${query.slice(0, 80)}` });
      reply({ error: "apenas o dono pode buscar no projeto" }); return;
    }
    if (!cwd) { reply({ error: "abra uma sessão com pasta de trabalho para buscar" }); return; }
    if (!query.trim()) { reply({ error: "digite o que procurar" }); return; }
    const refused = gate(ws, runnerId, "fileSearch", "buscar no projeto");
    if (refused) { reply({ error: refused }); return; }
    const opts: FileSearchOptions = { regex: msg.regex === true, caseSensitive: msg.caseSensitive === true, max: num(msg.max) };
    deps.audit("file_search", { ...deps.actor(ws), runnerId, detail: `${cwd}: ${query.slice(0, 80)}` });
    if (runnerId === deps.localId) { reply(await deps.searchLocal(cwd, query, opts)); return; }
    const ok = deps.forward(ws, runnerId, { t: "searchfiles", cwd, query, regex: opts.regex, caseSensitive: opts.caseSensitive, max: opts.max }, { clientReqId, op: "searchfiles" });
    if (!ok) reply({ error: "não foi possível enviar o pedido à máquina" });
  }

  return {
    /** true se o frame do CLIENTE é deste módulo (e já foi tratado). */
    async handleClient(ws: S, msg: Record<string, unknown>): Promise<boolean> {
      if (msg.t === "writefile") { await handleWrite(ws, msg); return true; }
      if (msg.t === "searchfiles") { await handleSearch(ws, msg); return true; }
      return false;
    },
    /** Resposta de um runner remoto, já casada com a pendência pelo Hub. */
    deliverRunnerReply(ws: S, runnerId: string, meta: FileEditPendingMeta, frame: Record<string, unknown>): void {
      // O dono que pediu pode ter sido rebaixado no meio do caminho: a resposta não vaza para membro.
      if (!deps.isOwner(ws)) return;
      if (meta.op === "writefile" && frame.t === "filesaved") {
        const r = frame as Partial<FileWriteResult>;
        if (r.ok === true) auditWrite(ws, runnerId, str(r.path) || meta.filePath || "?", num(r.size) ?? meta.bytes, { created: r.created === true, force: meta.force });
        deps.send(ws, savedFrame(meta.clientReqId, runnerId, { ...r, path: str(r.path) || meta.filePath }));
        return;
      }
      if (meta.op === "searchfiles" && frame.t === "searchresults") {
        deps.send(ws, resultsFrame(meta.clientReqId, runnerId, str(frame.cwd) ?? "", str(frame.query) ?? "", frame as Partial<FileSearchResult>));
      }
    },
  };
}
