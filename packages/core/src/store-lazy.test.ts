/**
 * Histórico de sessão sob demanda (2026-10-28).
 *
 * O boot lia o histórico de TODAS as sessões (279 arquivos, 271 MB, ~51 s a frio) só para a lista.
 * Agora a lista vem de um resumo salvo com os metadados e o histórico só é lido no primeiro acesso.
 * Estes testes provam que a lista e o digest ficam IDÊNTICOS e que o resumo acompanha cada mudança.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";

const DEF = { agent: "mock", cwd: "/work" };
const dir = () => mkdtempSync(join(tmpdir(), "jarvis-store-lazy-"));
const usage = (costUsd: number) => ({ costUsd, model: "m1", effort: "high" }) as never;

function seed(d: string): Store {
  const s = new Store(DEF, d);
  s.add("a", { role: "user", text: "pergunta A " + "x".repeat(300), ts: 1 });
  s.add("a", { role: "assistant", text: "resposta A", ts: 2, usage: usage(0.25) });
  s.add("b", { role: "user", text: "pergunta B", ts: 3 });
  s.add("b", { role: "assistant", text: "resposta B", ts: 4, usage: usage(0.5) });
  s.add("b", { role: "user", text: "de novo B", ts: 5 });
  s.ensure("vazia", { cwd: "/outra" });
  return s;
}
const view = (s: Store) => ({ list: s.list().map((m) => ({ ...m })), digest: s.digest(10) });

test("lista e digest vindos do resumo são idênticos aos calculados do histórico", () => {
  const d = dir();
  try {
    const fresh = seed(d);
    const expected = view(fresh);
    const reopened = new Store(DEF, d);
    assert.deepEqual(view(reopened), expected);
    assert.equal(reopened.isLoaded("a") || reopened.isLoaded("b"), false, "a lista não lê histórico");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("o histórico só é lido no primeiro acesso e chega completo", () => {
  const d = dir();
  try {
    seed(d);
    const s = new Store(DEF, d);
    assert.equal(s.isLoaded("b"), false);
    assert.deepEqual(s.history("b").map((m) => m.text), ["pergunta B", "resposta B", "de novo B"]);
    assert.equal(s.isLoaded("b"), true);
    assert.equal(s.isLoaded("a"), false, "acessar uma sessão não carrega as outras");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("gravar metadados (flush) não carrega o histórico de ninguém", () => {
  const d = dir();
  try {
    seed(d);
    const s = new Store(DEF, d);
    s.setArchived("a", true);
    s.ensure("nova");
    assert.equal(s.isLoaded("a"), false);
    assert.equal(s.isLoaded("b"), false);
    const meta = JSON.parse(readFileSync(join(d, "sessions.json"), "utf8"));
    assert.equal(meta.a.messages, undefined, "sessions.json continua sem mensagens");
    assert.equal(meta.a.stats.count, 2, "o resumo vai junto dos metadados");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("o resumo acompanha add, dropLastUser, insertRestored e reset — e sobrevive ao reload", () => {
  const d = dir();
  try {
    seed(d);
    const s = new Store(DEF, d);
    s.add("a", { role: "user", text: "terceira", ts: 10 });          // add sem carregar antes
    assert.equal(s.dropLastUser("b"), true);
    s.insertRestored("a", [{ role: "assistant", text: "restaurada", ts: 1.5, usage: usage(1) }]);
    s.add("vazia", { role: "user", text: "primeira", ts: 20 });
    const expected = view(s);
    // O resumo de cada sessão é o que se calcularia do histórico inteiro.
    const a = s.list().find((m) => m.id === "a")!;
    assert.equal(a.count, 4);
    assert.equal(a.cost, 1.25);
    assert.equal(a.lastMessage, "terceira");
    assert.equal(s.list().find((m) => m.id === "b")!.count, 2);
    assert.deepEqual(view(new Store(DEF, d)), expected);
    s.reset("a", { agent: "mock", cwd: "/work" });
    const r = new Store(DEF, d).list().find((m) => m.id === "a")!;
    assert.equal(r.count, 0);
    assert.equal(r.cost, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("sessions.json antigo (sem resumo): calcula uma vez, grava e o boot seguinte não lê histórico", () => {
  const d = dir();
  try {
    const expected = view(seed(d));
    const file = join(d, "sessions.json");
    const meta = JSON.parse(readFileSync(file, "utf8"));
    for (const v of Object.values(meta) as Array<Record<string, unknown>>) delete v.stats;
    writeFileSync(file, JSON.stringify(meta));
    const migrated = new Store(DEF, d);
    assert.deepEqual(view(migrated), expected);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).b.stats.count, 3, "resumo gravado na migração");
    const next = new Store(DEF, d);
    assert.deepEqual(view(next), expected);
    assert.equal(next.isLoaded("b"), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("resumo corrompido é recalculado do histórico", () => {
  const d = dir();
  try {
    const expected = view(seed(d));
    const file = join(d, "sessions.json");
    const meta = JSON.parse(readFileSync(file, "utf8"));
    meta.a.stats = { count: "dois" };
    writeFileSync(file, JSON.stringify(meta));
    assert.deepEqual(view(new Store(DEF, d)), expected);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("herança por pasta e reconfigure usam o resumo sem quebrar a regra de sessão nova", () => {
  const d = dir();
  try {
    seed(d);
    const s = new Store(DEF, d);
    assert.equal(s.reconfigure("b", { agent: "outro" }), false, "sessão com mensagens não muda de agente");
    assert.equal(s.reconfigure("vazia", { agent: "outro" }), true);
    assert.deepEqual(s.inheritForCwd("/work"), { agent: "mock", model: "m1", effort: "high", permissionMode: undefined });
  } finally { rmSync(d, { recursive: true, force: true }); }
});
