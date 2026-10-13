// Log em arquivo do shell desktop.
//
// Por que este teste existe: o log só tem valor se estiver lá na hora da investigação, e as três
// formas de ele NÃO estar são silenciosas — o disco encheu (rotação), o arquivo do dia do incidente
// foi apagado cedo demais (retenção) ou o log vazou um segredo e virou inutilizável para colar num
// chamado (redação). Nenhuma delas aparece no uso normal, então todas vivem aqui.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { createLogger, redact, FILE_RE } = req("./logger.js");

/** Disco em memória: o teste não encosta no filesystem real. */
function fakeDisk(initial = {}) {
  const files = new Map(Object.entries(initial));
  const mtimes = new Map();
  return {
    files,
    mtimes,
    io: {
      mkdir: () => {},
      append: (f, s) => files.set(f, (files.get(f) || "") + s),
      size: (f) => (files.get(f) || "").length,
      rename: (a, b) => { files.set(b, files.get(a) || ""); files.delete(a); },
      remove: (f) => { files.delete(f); mtimes.delete(f); },
      readdir: () => [...files.keys()].map((f) => f.split("/").pop()),
      mtimeMs: (f) => (mtimes.has(f) ? mtimes.get(f) : 0),
    },
  };
}

const silent = { log() {}, warn() {}, error() {} };
const at = (iso) => () => new Date(iso);

test("escreve JSONL com a mesma forma do log do Hub", () => {
  const d = fakeDisk();
  const log = createLogger({ dir: "/logs", io: d.io, now: at("2026-10-13T09:46:47.000Z"), console: silent });
  log.info("app_boot", { version: "0.38.0", arch: "x64" });

  const file = "/logs/jarvis-desktop-20261013.jsonl";
  const lines = (d.files.get(file) || "").trim().split("\n");
  assert.equal(lines.length, 1);
  const o = JSON.parse(lines[0]);
  // `t`/`lvl`/`ev` são o contrato do formato do Hub (apps/hub/src/logger.ts) — trocar a forma aqui
  // quebraria qualquer leitor comum aos dois.
  assert.deepEqual(o, { t: "2026-10-13T09:46:47.000Z", lvl: "info", ev: "app_boot", version: "0.38.0", arch: "x64" });
});

test("o nome do arquivo não colide com o do Hub e casa com o filtro de limpeza", () => {
  const d = fakeDisk();
  const log = createLogger({ dir: "/logs", io: d.io, now: at("2026-10-13T12:00:00.000Z"), console: silent });
  log.info("x");
  const name = [...d.files.keys()][0].split("/").pop();
  // O Hub grava `jarvis-20261013.jsonl` na pasta dele; um prefixo diferente evita confundir os dois
  // numa máquina que hospeda o Hub.
  assert.equal(name, "jarvis-desktop-20261013.jsonl");
  assert.notEqual(name, "jarvis-20261013.jsonl");
  assert.ok(FILE_RE.test(name), "a limpeza por retenção precisa reconhecer o próprio arquivo");
});

test("segredo não chega ao disco — nem em campo, nem em mensagem de erro", () => {
  const d = fakeDisk();
  const log = createLogger({ dir: "/logs", io: d.io, now: at("2026-10-13T12:00:00.000Z"), console: silent });
  // O caso real: o alvo do app vem do runner.env, que é o arquivo do JARVIS_TOKEN. Um erro que cite
  // aquele arquivo levaria o token para um log que o usuário cola num chamado de suporte.
  log.error("hub_unreachable", {
    detail: 'falhou lendo JARVIS_TOKEN=abc123segredo do runner.env',
    url: "https://hub.ts.net/ws?token=xyz789segredo&v=2",
    header: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload",
    nested: { secret: "s3nh4" },
    list: ["JARVIS_TOKEN=outro"],
  });
  const body = d.files.get("/logs/jarvis-desktop-20261013.jsonl");
  for (const leak of ["abc123segredo", "xyz789segredo", "eyJhbGciOiJIUzI1NiJ9", "s3nh4", "outro"]) {
    assert.ok(!body.includes(leak), `vazou: ${leak}`);
  }
  // E o que sobra ainda tem de ser útil: o host e a chave continuam legíveis.
  assert.ok(body.includes("hub.ts.net"));
  assert.ok(body.includes("JARVIS_TOKEN=<oculto>"));
});

test("redact preserva o que não é segredo", () => {
  // Over-redação também é uma falha: um log que apaga o endereço do Hub não serve para nada.
  assert.equal(redact("Hub: https://desktop-abc.tail251e83.ts.net"), "Hub: https://desktop-abc.tail251e83.ts.net");
  assert.equal(redact("erro -128 ao abrir"), "erro -128 ao abrir");
});

test("rotaciona para .1 ao passar do teto e não acumula uma terceira geração", () => {
  const d = fakeDisk();
  const log = createLogger({ dir: "/logs", io: d.io, now: at("2026-10-13T12:00:00.000Z"), console: silent, maxBytes: 200 });
  const file = "/logs/jarvis-desktop-20261013.jsonl";
  const prev = "/logs/jarvis-desktop-20261013.1.jsonl";

  for (let i = 0; i < 12; i++) log.info("enche", { i, pad: "x".repeat(40) });
  assert.ok(d.files.has(prev), "passou do teto e não rotacionou");
  assert.ok(d.files.get(file).length < 200 + 200, "o arquivo corrente devia ter recomeçado");

  // Segunda rotação: o `.1` anterior é DESCARTADO, não vira `.2`. Sem isso o diretório cresceria
  // para sempre, que é exatamente o que a rotação deveria evitar.
  for (let i = 0; i < 24; i++) log.info("enche_de_novo", { i, pad: "y".repeat(40) });
  const generations = [...d.files.keys()].filter((f) => f.startsWith("/logs/jarvis-desktop-20261013"));
  assert.deepEqual(generations.sort(), [prev, file].sort());
});

test("retenção apaga o arquivo velho e preserva o recente", () => {
  const d = fakeDisk();
  const nowMs = Date.parse("2026-10-13T12:00:00.000Z");
  const velho = "/logs/jarvis-desktop-20260901.jsonl";
  const recente = "/logs/jarvis-desktop-20261012.jsonl";
  const alheio = "/logs/outra-coisa.log";
  d.files.set(velho, "{}\n"); d.mtimes.set(velho, nowMs - 40 * 86400000);
  d.files.set(recente, "{}\n"); d.mtimes.set(recente, nowMs - 1 * 86400000);
  d.files.set(alheio, "nao e meu\n"); d.mtimes.set(alheio, nowMs - 400 * 86400000);

  const log = createLogger({ dir: "/logs", io: d.io, now: () => new Date(nowMs), console: silent, retentionDays: 30 });
  assert.equal(log.purgeOld(nowMs), 1);
  assert.ok(!d.files.has(velho));
  assert.ok(d.files.has(recente));
  // Só mexe no que é dele: apagar arquivo alheio numa pasta de logs compartilhada seria destrutivo.
  assert.ok(d.files.has(alheio), "a limpeza não pode tocar em arquivo que não é do app");
});

test("falha de disco não propaga — log nunca derruba o app", () => {
  const explode = () => { throw new Error("EROFS: read-only file system"); };
  const log = createLogger({
    dir: "/logs",
    io: { mkdir: explode, append: explode, size: explode, rename: explode, remove: explode, readdir: explode, mtimeMs: explode },
    now: at("2026-10-13T12:00:00.000Z"),
    console: silent,
  });
  // Um app que não abre porque o log não pôde ser escrito seria pior que não ter log.
  assert.doesNotThrow(() => log.info("app_boot", { version: "0.38.0" }));
  assert.doesNotThrow(() => log.purgeOld());
});

test("nível filtra debug sem filtrar erro", () => {
  const d = fakeDisk();
  const log = createLogger({ dir: "/logs", io: d.io, now: at("2026-10-13T12:00:00.000Z"), console: silent, level: "info" });
  log.debug("barulho");
  log.error("render_process_gone", { reason: "crashed" });
  const body = d.files.get("/logs/jarvis-desktop-20261013.jsonl");
  assert.ok(!body.includes("barulho"));
  assert.ok(body.includes("render_process_gone"));
});

test("espelha no console para quem roda `npm start`", () => {
  const d = fakeDisk();
  const seen = [];
  const con = { log: (m) => seen.push(["log", m]), warn: (m) => seen.push(["warn", m]), error: (m) => seen.push(["error", m]) };
  const log = createLogger({ dir: "/logs", io: d.io, now: at("2026-10-13T12:00:00.000Z"), console: con });
  log.info("hub_target", { url: "https://hub.ts.net" });
  log.error("boom", { detail: "x" });
  assert.deepEqual(seen[0], ["log", "[jarvis] hub_target url=https://hub.ts.net"]);
  assert.equal(seen[1][0], "error");
});
