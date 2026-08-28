import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, closeSync, mkdtempSync, mkdirSync, openSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexChildRollouts, codexChildRolloutsAsync, parseCodexChildRollout, resetCodexRolloutCache } from "./codex-executions.js";

const meta = (id = "child-1", parent = "parent-1") => JSON.stringify({
  type: "session_meta", payload: { id, session_id: parent, thread_source: "subagent", parent_thread_id: parent,
    agent_path: "/root/reviewer", agent_nickname: "Nash", source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: "/root/reviewer" } } } },
});

test("Codex child rollout ignores forked history and projects only the latest child turn", () => {
  const lines = [
    meta(),
    JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 1 } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "histórico do pai" }] } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete", completed_at: 2, last_agent_message: "antigo" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 10 } }),
    JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "c1", input: JSON.stringify({ command: "npm test" }) } }),
    JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c1", output: "ok" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "revisão pronta" }] } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 3 }, model_context_window: 100 } } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete", completed_at: 12, last_agent_message: "feito" } }),
  ];
  const child = parseCodexChildRollout(lines)!;
  assert.equal(child.id, "child-1"); assert.equal(child.parentId, "parent-1"); assert.equal(child.title, "reviewer");
  assert.equal(child.state, "succeeded"); assert.equal(child.startedAt, 10_000); assert.equal(child.endedAt, 12_000);
  assert.deepEqual(child.activities.map((event) => event.kind), ["tool", "tool", "text"]);
  assert.equal(child.activities.find((event) => event.kind === "text")?.text, "revisão pronta");
  assert.equal(child.usage?.inputTokens, 12); assert.equal(child.usage?.contextWindowTokens, 100);
});

test("Codex child rollout exposes honest running/cancelled states and rejects ordinary rollouts", () => {
  assert.equal(parseCodexChildRollout([JSON.stringify({ type: "session_meta", payload: { id: "normal", thread_source: "user" } })]), undefined);
  const running = parseCodexChildRollout([meta(), JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 3 } })])!;
  assert.equal(running.state, "running");
  const cancelled = parseCodexChildRollout([meta(), JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 3 } }), JSON.stringify({ timestamp: "2026-07-20T12:00:00Z", type: "event_msg", payload: { type: "turn_aborted", reason: "interrupted by user" } })])!;
  assert.equal(cancelled.state, "cancelled");
});

test("Codex child discovery filters by parent and accepts incomplete JSONL tails", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-codex-child-"));
  const day = join(root, "2026", "07", "20"); mkdirSync(day, { recursive: true });
  writeFileSync(join(day, "one.jsonl"), [meta("one", "wanted"), JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 1 } }), "{incomplete"].join("\n"));
  writeFileSync(join(day, "two.jsonl"), [meta("two", "other"), JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: 2 } })].join("\n"));
  const children = codexChildRollouts("wanted", { root });
  assert.deepEqual(children.map((child) => child.id), ["one"]);
});

/* --------------------------------------------------------------------------------------------
 * Coleta incremental. Estes testes não checam só o resultado: eles provam que o atalho ACONTECEU.
 * A técnica é sabotar a parte do arquivo que o coletor não deveria mais ler — se ele reler, o
 * resultado quebra de forma visível.
 * Contexto: a versão anterior relia todo rollout tocado desde o início do turno, a cada 750 ms —
 * 522 MB por tique numa máquina real, o que travava o event loop do Hub inteiro.
 * ------------------------------------------------------------------------------------------ */

const started = (at = 1) => JSON.stringify({ type: "event_msg", payload: { type: "task_started", started_at: at } });
const completed = (msg = "feito", at = 2) => JSON.stringify({ type: "event_msg", payload: { type: "task_complete", completed_at: at, last_agent_message: msg } });

const rolloutDir = (): string => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-codex-inc-"));
  mkdirSync(join(root, "2026", "07", "20"), { recursive: true });
  return root;
};
const rolloutPath = (root: string, name: string): string => join(root, "2026", "07", "20", name);

test("cache por (size, mtime): arquivo intocado não é relido", () => {
  resetCodexRolloutCache();
  const root = rolloutDir(), file = rolloutPath(root, "a.jsonl");
  writeFileSync(file, [meta("kid", "p1"), started(1), completed("primeiro")].join("\n") + "\n");

  const first = codexChildRollouts("p1", { root })[0];
  assert.equal(first.summary, "primeiro");

  // Troca o conteúdo por lixo do MESMO tamanho e devolve o mtime original: para o `stat`, nada
  // mudou. Se o coletor reler, o parse falha e a criança some.
  const before = statSync(file);
  writeFileSync(file, "x".repeat(before.size));
  utimesSync(file, before.atime, before.mtime);

  const second = codexChildRollouts("p1", { root });
  assert.equal(second.length, 1, "snapshot deveria vir do cache, sem tocar no disco");
  assert.equal(second[0].summary, "primeiro");
});

test("leitura incremental: só os bytes anexados desde o último tique são lidos", () => {
  resetCodexRolloutCache();
  const root = rolloutDir(), file = rolloutPath(root, "b.jsonl");
  const head = meta("kid", "p1");
  writeFileSync(file, [head, started(1)].join("\n") + "\n");

  assert.equal(codexChildRollouts("p1", { root })[0].state, "running");

  // Sabota o PREFIXO já consumido, preservando o tamanho em bytes, e anexa o fim do turno.
  // Uma releitura completa não acharia mais o session_meta e devolveria nada.
  const fd = openSync(file, "r+");
  try { writeSync(fd, Buffer.alloc(Buffer.byteLength(head), 0x78), 0, Buffer.byteLength(head), 0); } finally { closeSync(fd); }
  appendFileSync(file, completed("fim") + "\n");

  const after = codexChildRollouts("p1", { root });
  assert.equal(after.length, 1, "o prefixo sabotado não deveria ter sido relido");
  assert.equal(after[0].state, "succeeded");
  assert.equal(after[0].summary, "fim");
});

test("a última linha sem \\n final é projetada, e não duplica quando o \\n chega depois", () => {
  resetCodexRolloutCache();
  const root = rolloutDir(), file = rolloutPath(root, "c.jsonl");
  // Sem quebra no fim: era assim que o parser antigo (arquivo inteiro) enxergava a última linha.
  // Sem o overlay da cauda, um task_complete final sem \n deixaria a criança presa em "running".
  writeFileSync(file, [meta("kid", "p1"), started(1), completed("na cauda")].join("\n"));
  const first = codexChildRollouts("p1", { root })[0];
  assert.equal(first.state, "succeeded");
  assert.equal(first.summary, "na cauda");

  // O \n chega e a linha vira definitiva: o estado é o mesmo, sem eventos repetidos.
  appendFileSync(file, "\n");
  const second = codexChildRollouts("p1", { root })[0];
  assert.equal(second.state, "succeeded");
  assert.equal(second.activities.length, first.activities.length);
});

test("rollout de outro pai continua fora, tique após tique, mesmo crescendo", () => {
  resetCodexRolloutCache();
  const root = rolloutDir();
  writeFileSync(rolloutPath(root, "mine.jsonl"), [meta("meu", "p1"), started(1)].join("\n") + "\n");
  const alheio = rolloutPath(root, "theirs.jsonl");
  writeFileSync(alheio, [meta("outro", "p2"), started(1)].join("\n") + "\n");

  assert.deepEqual(codexChildRollouts("p1", { root }).map((c) => c.id), ["meu"]);
  appendFileSync(alheio, completed("nada a ver") + "\n");
  assert.deepEqual(codexChildRollouts("p1", { root }).map((c) => c.id), ["meu"]);
  // E continua visível para o dono legítimo.
  assert.deepEqual(codexChildRollouts("p2", { root }).map((c) => c.id), ["outro"]);
});

test("arquivo que encolhe (rotacionado/trocado) é reparseado do zero", () => {
  resetCodexRolloutCache();
  const root = rolloutDir(), file = rolloutPath(root, "d.jsonl");
  writeFileSync(file, [meta("velho", "p1"), started(1), completed("antigo")].join("\n") + "\n");
  assert.equal(codexChildRollouts("p1", { root })[0].id, "velho");

  writeFileSync(file, [meta("novo", "p1"), started(9)].join("\n") + "\n");   // menor que o anterior
  const after = codexChildRollouts("p1", { root });
  assert.equal(after.length, 1);
  assert.equal(after[0].id, "novo");
  assert.equal(after[0].state, "running");
});

test("a varredura assíncrona devolve exatamente o mesmo que a síncrona", async () => {
  resetCodexRolloutCache();
  const root = rolloutDir();
  writeFileSync(rolloutPath(root, "one.jsonl"), [meta("um", "p1"), started(1), completed("a")].join("\n") + "\n");
  writeFileSync(rolloutPath(root, "two.jsonl"), [meta("dois", "p1"), started(5)].join("\n") + "\n");
  writeFileSync(rolloutPath(root, "alheio.jsonl"), [meta("tres", "p9"), started(2)].join("\n") + "\n");

  const sync = codexChildRollouts("p1", { root });
  resetCodexRolloutCache();
  const async_ = await codexChildRolloutsAsync("p1", { root });
  assert.deepEqual(async_.map((c) => [c.id, c.state, c.summary]), sync.map((c) => [c.id, c.state, c.summary]));
  assert.deepEqual(sync.map((c) => c.id), ["um", "dois"]);   // ordenado por startedAt
});

test("sinceMs continua excluindo rollouts parados antes do início do turno", () => {
  resetCodexRolloutCache();
  const root = rolloutDir(), file = rolloutPath(root, "e.jsonl");
  writeFileSync(file, [meta("antigo", "p1"), started(1)].join("\n") + "\n");
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(file, old, old);
  assert.deepEqual(codexChildRollouts("p1", { root, sinceMs: Date.now() - 60_000 }), []);
  assert.deepEqual(codexChildRollouts("p1", { root }).map((c) => c.id), ["antigo"]);
});
