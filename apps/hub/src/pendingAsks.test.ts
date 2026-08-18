/**
 * TSK-10: a decisão pendente é da PESSOA e do Hub, não do aparelho e da memória do processo.
 * Antes, `pendingAsk` era um Map em memória: reiniciar o Hub apagava a pergunta para sempre, e o
 * cartão só existia no localStorage de quem estava com a sessão aberta.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PendingAskStore } from "./pendingAsks.js";

const QUESTIONS = [{ question: "Rebase ou merge?", options: [{ label: "rebase" }, { label: "merge" }] }];

function newStore(file: string, now = () => 1000) {
  return new PendingAskStore(file, now);
}

test("uma pergunta pendente sobrevive ao restart do Hub", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-asks-")), "pending-asks.json");
  const store = newStore(file);
  store.set({ runnerId: "local", sessionId: "s-1", principalId: "owner", questions: QUESTIONS });

  const restarted = newStore(file, () => 9999);
  const row = restarted.get("local", "s-1");
  assert.ok(row, "a pendência voltou do disco");
  assert.equal(row.principalId, "owner");
  assert.equal(row.at, 1000, "guarda o instante da pergunta, não o do restart");
  assert.deepEqual(row.questions, QUESTIONS);
});

test("responder remove a pendência, em qualquer aparelho", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-asks-")), "pending-asks.json");
  const store = newStore(file);
  store.set({ runnerId: "local", sessionId: "s-1", principalId: "owner", questions: QUESTIONS });

  assert.equal(store.remove("local", "s-1"), true);
  assert.equal(store.get("local", "s-1"), undefined);
  assert.equal(newStore(file).get("local", "s-1"), undefined, "a remoção também é durável");
  assert.equal(store.remove("local", "s-1"), false, "remover de novo não inventa efeito");
});

test("um turno novo substitui a pergunta antiga da mesma sessão", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-asks-")), "pending-asks.json");
  let clock = 10;
  const store = new PendingAskStore(file, () => clock);
  store.set({ runnerId: "local", sessionId: "s-1", principalId: "owner", questions: QUESTIONS });

  clock = 20;
  const novas = [{ question: "Agora vai?", options: [{ label: "sim" }] }];
  store.set({ runnerId: "local", sessionId: "s-1", principalId: "owner", questions: novas });

  const row = store.get("local", "s-1");
  assert.deepEqual(row?.questions, novas, "vale a pergunta do turno atual");
  assert.equal(row?.at, 20);
  assert.equal(store.list().length, 1, "não acumula duas pendências para a mesma sessão");
});

test("a mesma sessão em máquinas diferentes é pendência diferente", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-asks-")), "pending-asks.json");
  const store = newStore(file);
  store.set({ runnerId: "local", sessionId: "s-1", principalId: "owner", questions: QUESTIONS });
  store.set({ runnerId: "runner-b", sessionId: "s-1", principalId: "owner", questions: QUESTIONS });

  assert.equal(store.list().length, 2);
  store.remove("local", "s-1");
  assert.ok(store.get("runner-b", "s-1"), "remover em uma máquina não apaga a da outra");
});

test("o resumo para a lista não carrega o texto das perguntas", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-asks-")), "pending-asks.json");
  const store = newStore(file);
  store.set({ runnerId: "local", sessionId: "s-1", principalId: "owner", questions: QUESTIONS });

  const resumo = store.summaries("owner");
  assert.deepEqual(resumo, [{ runnerId: "local", sessionId: "s-1", count: 1, at: 1000 }]);
  assert.equal(JSON.stringify(resumo).includes("Rebase"), false, "o conteúdo da decisão não vaza no aviso amplo");
});

test("o resumo é filtrado por identidade", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-asks-")), "pending-asks.json");
  const store = newStore(file);
  store.set({ runnerId: "local", sessionId: "s-dono", principalId: "owner", questions: QUESTIONS });
  store.set({ runnerId: "local", sessionId: "s-membro", principalId: "u:convidado", questions: QUESTIONS });

  assert.deepEqual(store.summaries("owner").map((r) => r.sessionId), ["s-dono"]);
  assert.deepEqual(store.summaries("u:convidado").map((r) => r.sessionId), ["s-membro"]);
});

test("arquivo corrompido não derruba o Hub — começa vazio", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-asks-"));
  const file = join(dir, "pending-asks.json");
  writeFileSync(file, "{ isto nao e json", "utf8");
  const store = newStore(file);
  assert.deepEqual(store.list(), [], "pendência é conveniência: não vale travar a subida por ela");
  store.set({ runnerId: "local", sessionId: "s-1", principalId: "owner", questions: QUESTIONS });
  assert.equal(newStore(file).get("local", "s-1")?.principalId, "owner", "e volta a persistir normalmente");
});

test("pendência sem pergunta nenhuma é recusada", () => {
  const file = join(mkdtempSync(join(tmpdir(), "jarvis-asks-")), "pending-asks.json");
  const store = newStore(file);
  assert.throws(() => store.set({ runnerId: "local", sessionId: "s-1", principalId: "owner", questions: [] }), /sem perguntas/);
  assert.equal(store.list().length, 0);
});
