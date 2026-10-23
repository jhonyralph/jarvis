/**
 * BRW-IDE-00 F3 — regras de segurança do roteamento do editor leve (`createFileEditRouter`).
 * Sem Hub de pé: as dependências são falsas e registram o que o Hub faria (enviar, auditar, gravar).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RUNNER_CAPABILITY_SINCE } from "@jarvis/protocol";
import { createFileEditRouter, type FileEditPendingMeta } from "./fileEdit.js";

interface Sock { id: string; owner: boolean; runners: string[]; active?: string }

function harness() {
  const sent: Array<{ ws: string; frame: any }> = [];
  const audits: Array<{ event: string; info: any }> = [];
  const forwarded: Array<{ runnerId: string; frame: any; meta: FileEditPendingMeta }> = [];
  const writes: any[] = [], searches: any[] = [];
  const machines: Record<string, { online: boolean; protocolVersion: number }> = {
    notebook: { online: true, protocolVersion: RUNNER_CAPABILITY_SINCE.fileWrite },
    velha: { online: true, protocolVersion: RUNNER_CAPABILITY_SINCE.fileWrite - 1 },
    desligada: { online: false, protocolVersion: RUNNER_CAPABILITY_SINCE.fileWrite },
    quebrada: { online: true, protocolVersion: RUNNER_CAPABILITY_SINCE.fileWrite },
  };
  const router = createFileEditRouter<Sock>({
    localId: "local",
    isOwner: (ws) => ws.owner,
    actor: (ws) => ({ userId: "u-" + ws.id, deviceId: "d-" + ws.id }),
    canUseRunner: (ws, rid) => ws.owner || ws.runners.includes(rid),
    defaultRunner: (ws) => ws.active || "local",
    runner: (rid) => machines[rid],
    forward: (_ws, runnerId, frame, meta) => { if (runnerId === "quebrada") return false; forwarded.push({ runnerId, frame, meta }); return true; },
    send: (ws, frame) => sent.push({ ws: ws.id, frame }),
    audit: (event, info) => audits.push({ event, info }),
    writeLocal: async (path, cwd, content, opts) => { writes.push({ path, cwd, content, opts }); return { path: "/abs/" + path, name: path, ok: true, mtimeMs: 123, size: Buffer.byteLength(content) }; },
    searchLocal: async (cwd, query, opts) => { searches.push({ cwd, query, opts }); return { results: [{ path: cwd + "/a.ts", rel: "a.ts", line: 2, col: 3, preview: "x " + query, hl: [2, 2 + query.length] }], truncated: false, engine: "node" }; },
  });
  return { router, sent, audits, forwarded, writes, searches };
}

const dono: Sock = { id: "dono", owner: true, runners: [] };
const membro: Sock = { id: "membro", owner: false, runners: ["local", "notebook"] };

test("membro com grant na máquina NÃO edita nem busca — e a recusa é auditada", async () => {
  const h = harness();
  await h.router.handleClient(membro, { t: "writefile", reqId: "c1", runnerId: "notebook", path: "/p/a.ts", content: "x", expectedMtimeMs: 1 });
  await h.router.handleClient(membro, { t: "searchfiles", reqId: "c2", runnerId: "local", cwd: "/p", query: "segredo" });
  assert.equal(h.writes.length + h.searches.length + h.forwarded.length, 0, "nada chegou ao disco nem à máquina");
  assert.deepEqual(h.sent.map((s) => [s.frame.t, s.frame.reqId, s.frame.ok ?? null]), [["filesaved", "c1", false], ["searchresults", "c2", null]]);
  assert.match(h.sent[0].frame.error, /apenas o dono/);
  assert.match(h.sent[1].frame.error, /apenas o dono/);
  assert.deepEqual(h.audits.map((a) => a.event), ["file_write_denied", "file_search_denied"]);
  assert.equal(h.audits[0].info.userId, "u-membro");
  assert.equal(h.audits[0].info.runnerId, "notebook");
});

test("dono grava na máquina do Hub: resposta com o reqId do cliente e auditoria com caminho+bytes, sem conteúdo", async () => {
  const h = harness();
  await h.router.handleClient(dono, { t: "writefile", reqId: "c9", runnerId: "local", path: "a.ts", cwd: "/p", content: "segredo-do-arquivo", expectedMtimeMs: 10, expectedSize: 3 });
  assert.deepEqual(h.writes[0], { path: "a.ts", cwd: "/p", content: "segredo-do-arquivo", opts: { expectedMtimeMs: 10, expectedSize: 3, force: false, create: false } });
  const f = h.sent[0].frame;
  assert.equal(f.t, "filesaved"); assert.equal(f.reqId, "c9"); assert.equal(f.ok, true); assert.equal(f.mtimeMs, 123); assert.equal(f.runnerId, "local");
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].event, "file_write");
  assert.match(h.audits[0].info.detail, /\/abs\/a\.ts \(18 B\)/);
  assert.doesNotMatch(JSON.stringify(h.audits), /segredo-do-arquivo/, "conteúdo nunca vai para o audit.log");
});

test("sem runnerId, vale a máquina para onde o cliente está roteado", async () => {
  const h = harness();
  await h.router.handleClient({ ...dono, active: "notebook" }, { t: "writefile", reqId: "c3", path: "/p/a.ts", content: "x", expectedMtimeMs: 5 });
  assert.equal(h.forwarded.length, 1);
  assert.equal(h.forwarded[0].runnerId, "notebook");
});

test("máquina remota: encaminha com reqId do HUB, devolve o do cliente e audita só no sucesso", async () => {
  const h = harness();
  await h.router.handleClient(dono, { t: "writefile", reqId: "cliente-7", runnerId: "notebook", path: "/p/a.ts", cwd: "/p", content: "abc", expectedMtimeMs: 5, force: true });
  const fw = h.forwarded[0];
  assert.equal(fw.frame.t, "writefile");
  assert.equal(fw.frame.reqId, undefined, "o reqId do cliente não é usado como chave do Hub");
  assert.equal(fw.frame.force, true);
  assert.deepEqual(fw.meta, { clientReqId: "cliente-7", op: "writefile", filePath: "/p/a.ts", bytes: 3, force: true });
  assert.equal(h.audits.length, 0, "ainda não gravou");
  h.router.deliverRunnerReply(dono, "notebook", fw.meta, { t: "filesaved", reqId: "r-hub", path: "/p/a.ts", ok: true, mtimeMs: 77, size: 3, evil: "<script>" });
  const f = h.sent.at(-1)!.frame;
  assert.equal(f.reqId, "cliente-7"); assert.equal(f.ok, true); assert.equal(f.mtimeMs, 77); assert.equal(f.runnerId, "notebook");
  assert.equal(f.evil, undefined, "campo fora do contrato não passa");
  assert.equal(h.audits[0].event, "file_write");
  assert.match(h.audits[0].info.detail, /\[sobrescrito\]/);
  // conflito: repassa a versão do disco, sem auditar gravação
  h.router.deliverRunnerReply(dono, "notebook", fw.meta, { t: "filesaved", reqId: "r-hub", path: "/p/a.ts", ok: false, conflict: { mtimeMs: 99, size: 4, junk: 1 } });
  assert.deepEqual(h.sent.at(-1)!.frame.conflict, { mtimeMs: 99, size: 4 });
  assert.equal(h.audits.length, 1);
});

test("resposta que chega depois do dono ser rebaixado não vaza", async () => {
  const h = harness();
  h.router.deliverRunnerReply({ ...dono, owner: false }, "notebook", { clientReqId: "x", op: "searchfiles" }, { t: "searchresults", results: [{ path: "/s", line: 1 }] });
  assert.equal(h.sent.length, 0);
});

test("protocolo antigo, offline, desconhecida e falha de envio recusam com motivo", async () => {
  const h = harness();
  for (const runnerId of ["velha", "desligada", "fantasma", "quebrada"]) {
    await h.router.handleClient(dono, { t: "writefile", reqId: runnerId, runnerId, path: "/p/a", content: "x", expectedMtimeMs: 1 });
  }
  const errs = Object.fromEntries(h.sent.map((s) => [s.frame.reqId, s.frame.error]));
  assert.match(errs.velha, new RegExp(`protocolo ${RUNNER_CAPABILITY_SINCE.fileWrite - 1}.*exige ${RUNNER_CAPABILITY_SINCE.fileWrite}`));
  assert.match(errs.desligada, /offline/);
  assert.match(errs.fantasma, /não conheço/);
  assert.match(errs.quebrada, /não foi possível enviar/);
  assert.equal(h.forwarded.length, 0);
  await h.router.handleClient(dono, { t: "searchfiles", reqId: "s-velha", runnerId: "velha", cwd: "/p", query: "x" });
  assert.match(h.sent.at(-1)!.frame.error, /buscar no projeto exige/);
});

test("busca local: audita a consulta, repassa opções e devolve no formato do contrato", async () => {
  const h = harness();
  await h.router.handleClient(dono, { t: "searchfiles", reqId: "s1", runnerId: "local", cwd: "/p", query: "alvo", regex: true, caseSensitive: true, max: 50 });
  assert.deepEqual(h.searches[0], { cwd: "/p", query: "alvo", opts: { regex: true, caseSensitive: true, max: 50 } });
  const f = h.sent[0].frame;
  assert.equal(f.t, "searchresults"); assert.equal(f.reqId, "s1"); assert.equal(f.results.length, 1); assert.equal(f.results[0].line, 2);
  assert.equal(h.audits[0].event, "file_search");
  await h.router.handleClient(dono, { t: "searchfiles", reqId: "s2", runnerId: "local", cwd: "", query: "alvo" });
  assert.match(h.sent.at(-1)!.frame.error, /pasta de trabalho/);
});

test("resultado de busca remoto é saneado (formato e teto)", async () => {
  const h = harness();
  await h.router.handleClient(dono, { t: "searchfiles", reqId: "s3", runnerId: "notebook", cwd: "/p", query: "q" });
  const meta = h.forwarded[0].meta;
  const lixo = [...Array.from({ length: 1500 }, (_, i) => ({ path: "/p/f" + i, rel: "f" + i, line: i + 1, col: 1, preview: "q", hl: [0, 1] })), { path: 3 }, null];
  h.router.deliverRunnerReply(dono, "notebook", meta, { t: "searchresults", cwd: "/p", query: "q", results: lixo, truncated: true });
  const f = h.sent.at(-1)!.frame;
  assert.equal(f.reqId, "s3");
  assert.equal(f.results.length, 1000);
  assert.equal(f.truncated, true);
});
