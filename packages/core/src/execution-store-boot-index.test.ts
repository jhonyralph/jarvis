/**
 * Índice de boot do ExecutionStore (2026-10-28).
 *
 * O boot abria os ~4.400 journals de execução, um por um, antes de o Hub responder — 131 s com o disco
 * frio (o "reiniciar não reinicia"). O índice guarda o estado de cada execução num arquivo só; o
 * journal só é reaberto quando mudou. Estes testes provam que o estado vindo do índice é IDÊNTICO ao
 * relido evento a evento, e que nada se perde quando o índice falta, envelhece ou corrompe.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionStore } from "./execution-store.js";
import { NO_EXECUTION_CAPABILITIES, type ExecutionNode } from "@jarvis/protocol";

const node = (id: string, extra: Partial<ExecutionNode> = {}): Omit<ExecutionNode, "schemaVersion" | "journalId"> => ({
  executionId: id, rootExecutionId: id, rootTurnId: "turn-" + id, sessionId: "sessao-1", runnerId: "local",
  dependsOn: [], depth: 0, kind: "turn", origin: "jarvis_managed", certification: "verified",
  state: "queued", title: "Turno " + id, queuedAt: 100, capabilities: { ...NO_EXECUTION_CAPABILITIES }, metrics: { self: {} }, ...extra,
});
const child = (root: string, id: string): Omit<ExecutionNode, "schemaVersion" | "journalId"> => ({
  ...node(root), executionId: id, rootExecutionId: root, parentExecutionId: root, depth: 1, kind: "agent", title: "Filho " + id, state: "running", startedAt: 101,
});

/** Três execuções: uma terminada com filhos e uso, uma ainda rodando, uma que vai ser compactada. */
function seed(dir: string): void {
  let t = 1_000;
  const s = new ExecutionStore({ root: dir, now: () => ++t });
  s.create(node("done"));
  s.append("done", "done", { kind: "state_changed", from: "queued", to: "running" });
  s.appendNode("done", child("done", "done-a"));
  s.append("done", "done-a", { kind: "usage", usage: { inputTokens: 11, outputTokens: 3, costUsd: 0.5, costKind: "billed", source: "fixture" }, measure: "delta", scope: "self" });
  s.append("done", "done-a", { kind: "message", role: "assistant", text: "pronto", published: true });
  s.append("done", "done-a", { kind: "state_changed", from: "running", to: "succeeded" });
  s.append("done", "done", { kind: "state_changed", from: "running", to: "succeeded" });
  s.create(node("live"));
  s.append("live", "live", { kind: "state_changed", from: "queued", to: "running" });
  s.append("live", "live", { kind: "input_requested", inputId: "q1", inputKind: "question", summary: "qual?", choices: ["a", "b"] });
  s.create(node("old"));
  s.append("old", "old", { kind: "state_changed", from: "queued", to: "running" });
  for (let i = 0; i < 5; i++) s.append("old", "old", { kind: "diagnostic", level: "info", code: "R" + i, message: String(i) });
  s.append("old", "old", { kind: "state_changed", from: "running", to: "failed" });
}

// Comparado como JSON — é assim que o estado sai do Hub (aparelhos, runner, disco); campo `undefined`
// some na serialização dos dois lados.
const view = (s: ExecutionStore) => JSON.parse(JSON.stringify({
  roots: s.rootsForSession().map((r) => ({ ...r, generatedAt: 0 })),
  manifest: s.manifest(),
  events: ["done", "live", "old"].map((id) => s.events(id, 0, 1000).events.map((e) => e.seq)),
}));
/** Data exata (segundos inteiros): o Windows arredonda a fração ao restaurar a data de um arquivo. */
const FIXED = new Date("2026-10-28T12:00:00Z");
const pinTimes = (dir: string) => { for (const f of readdirSync(dir)) if (f.endsWith(".jsonl")) utimesSync(join(dir, f), FIXED, FIXED); };

test("o estado vindo do índice é idêntico ao relido evento a evento", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-index-"));
  seed(dir);
  const replay = new ExecutionStore({ root: dir, now: () => 5_000 });     // sem índice: relê tudo e grava o índice
  assert.ok(existsSync(join(dir, "boot-index.json")), "o boot grava o índice");
  const indexed = new ExecutionStore({ root: dir, now: () => 5_000 });    // com índice
  assert.deepEqual(view(indexed), view(replay));
});

test("o boot NÃO abre o journal que não mudou: o estado vem do índice", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-index-"));
  seed(dir);
  pinTimes(dir);
  new ExecutionStore({ root: dir });
  // Corrompe o conteúdo do journal de "done" mantendo tamanho e data: se o boot o abrisse, perderia o estado.
  const file = readdirSync(dir).find((f) => f.endsWith(".jsonl") && readFileSync(join(dir, f), "utf8").includes('"executionId":"done"'))!;
  const path = join(dir, file), st = statSync(path);
  writeFileSync(path, "x".repeat(st.size));
  utimesSync(path, FIXED, FIXED);
  const s = new ExecutionStore({ root: dir });
  assert.equal(s.findNode("done")?.node.state, "succeeded");
  assert.equal(s.findNode("done-a")?.node.metrics.self.inputTokens, 11);
});

test("journal que mudou depois do índice é relido (o índice nunca esconde evento novo)", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-index-"));
  seed(dir);
  const a = new ExecutionStore({ root: dir });
  a.append("live", "live", { kind: "input_resolved", inputId: "q1", state: "answered", answer: "a" });
  a.append("live", "live", { kind: "state_changed", from: "running", to: "succeeded" });
  const b = new ExecutionStore({ root: dir });
  assert.equal(b.findNode("live")?.node.state, "succeeded");
  assert.equal(b.snapshot("live")?.pendingInputs.length, 0);
});

test("índice ausente ou corrompido: o boot relê tudo, como antes", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-index-"));
  seed(dir);
  const good = view(new ExecutionStore({ root: dir, now: () => 5_000 }));
  writeFileSync(join(dir, "boot-index.json"), "{corrompido");
  assert.deepEqual(view(new ExecutionStore({ root: dir, now: () => 5_000 })), good);
});

test("depois de carregar do índice, a execução continua: sequência, eventos e duplicata", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-index-"));
  seed(dir);
  new ExecutionStore({ root: dir });
  const s = new ExecutionStore({ root: dir });
  const ev = s.append("live", "live", { kind: "diagnostic", level: "info", code: "X", message: "x" });
  assert.equal(ev.seq, 4, "segue a sequência do journal");
  assert.equal(s.ingest(ev).status, "duplicate");
  assert.deepEqual(s.events("live", 0, 10).events.map((e) => e.seq), [1, 2, 3, 4], "eventos antigos vêm do journal");
});

test("compactação não roda de novo numa execução já compactada que veio do índice", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-exec-index-"));
  seed(dir);
  const first = new ExecutionStore({ root: dir, now: () => 9_999_999 });
  const c1 = first.compactBefore(9_000_000);
  assert.ok(c1.roots >= 1, "compacta as terminadas antigas");
  const second = new ExecutionStore({ root: dir, now: () => 9_999_999 });
  assert.deepEqual(second.compactBefore(9_000_000), { roots: 0, droppedEvents: 0 }, "já compactada: nada a fazer");
  assert.equal(second.findNode("done")?.node.state, "succeeded");
});
