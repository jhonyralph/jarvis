// Precedência do endereço do Hub. É a regra que decide para onde a janela aponta, e o custo de
// errar é o app abrir sem carregar nada — o sintoma mais caro que este shell já teve.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { resolveHubTarget, readSavedHubUrl, writeSavedHubUrl, hubConfigPath, FILE_NAME } = req("./hub-config.js");
const { normalizeHubUrl, DEFAULT_HUB_URL } = req("./hub-url.js");

const resolve = (opts) => resolveHubTarget({ normalize: normalizeHubUrl, ...opts });

test("sem nenhuma origem, cai no loopback e se declara padrão", () => {
  const r = resolve({});
  assert.equal(r.url, DEFAULT_HUB_URL);
  assert.equal(r.source, "fallback");
  assert.equal(r.usedFallback, true);
  assert.deepEqual(r.candidates, []);
});

test("precedência: app > env > runner", () => {
  const app = "https://salvo.ts.net", env = "https://env.ts.net", runner = "wss://runner.ts.net";
  assert.equal(resolve({ saved: app, env, runner }).url, "https://salvo.ts.net");
  assert.equal(resolve({ saved: app, env, runner }).source, "app");
  assert.equal(resolve({ env, runner }).url, "https://env.ts.net");
  assert.equal(resolve({ env, runner }).source, "env");
  assert.equal(resolve({ runner }).url, "https://runner.ts.net", "ws(s) do runner vira http(s)");
  assert.equal(resolve({ runner }).source, "runner");
});

test("um valor malformado NÃO consome a vez — a próxima origem válida assume", () => {
  // Se o que foi salvo no app está quebrado e existe uma env boa, cair no loopback perderia a única
  // configuração utilizável da máquina.
  const r = resolve({ saved: "file:///c:/x", env: "https://env.ts.net" });
  assert.equal(r.url, "https://env.ts.net");
  assert.equal(r.source, "env");
  assert.equal(r.usedFallback, false);
  assert.match(r.warning, /configurado no app/, "o valor ignorado é reportado, não engolido");
  const only = resolve({ saved: "file:///c:/x" });
  assert.equal(only.url, DEFAULT_HUB_URL, "sem alternativa válida, aí sim é o padrão");
  assert.equal(only.usedFallback, true);
});

test("candidates lista TODAS as origens e marca a inválida — a tela precisa explicar a escolha", () => {
  const r = resolve({ saved: "não é url", env: "https://env.ts.net", runner: "wss://runner.ts.net" });
  assert.deepEqual(r.candidates.map((c) => c.source), ["app", "env", "runner"]);
  assert.equal(r.candidates.find((c) => c.source === "app").invalid, true);
  assert.equal(r.candidates.find((c) => c.source === "env").invalid, false);
  assert.equal(r.candidates.find((c) => c.source === "runner").url, "https://runner.ts.net");
  assert.equal(r.source, "env");
  assert.ok(r.sourceLabel.includes("JARVIS_APP_HUB_URL"));
});

test("espaço em branco não conta como configuração", () => {
  assert.equal(resolve({ saved: "   ", env: "https://env.ts.net" }).source, "env");
  assert.equal(resolve({ saved: "  ", env: " ", runner: "\t" }).usedFallback, true);
});

test("nunca lança, seja qual for a entrada", () => {
  for (const v of [123, {}, [], true, null, undefined]) {
    assert.doesNotThrow(() => resolve({ saved: v, env: v, runner: v }));
  }
});

// --- persistência ---
const fakeDisk = () => {
  const files = new Map();
  return {
    files,
    io: {
      join: (...p) => p.join("/"),
      readFile: (f) => { if (!files.has(f)) throw new Error("ENOENT"); return files.get(f); },
      writeFile: (f, b) => files.set(f, b),
      mkdir: () => {},
    },
  };
};

test("grava, lê de volta e limpa o endereço escolhido no app", () => {
  const { files, io } = fakeDisk();
  assert.equal(hubConfigPath("/data", io.join), "/data/" + FILE_NAME);
  assert.equal(readSavedHubUrl("/data", io), undefined, "primeira execução não tem arquivo");

  assert.equal(writeSavedHubUrl("/data", "  https://meu.ts.net  ", io), true);
  assert.equal(readSavedHubUrl("/data", io), "https://meu.ts.net", "espaços são aparados");
  assert.match(files.get("/data/" + FILE_NAME), /"hubUrl"/);

  assert.equal(writeSavedHubUrl("/data", "", io), true, "limpar é gravar vazio");
  assert.equal(readSavedHubUrl("/data", io), undefined);
  assert.equal(files.get("/data/" + FILE_NAME).includes("hubUrl"), false, "a chave some do arquivo");
});

test("arquivo corrompido não impede o app de abrir", () => {
  const { files, io } = fakeDisk();
  for (const junk of ["{ isso não é json", "null", "[]", '{"hubUrl":123}', '{"hubUrl":"  "}', ""]) {
    files.set("/data/" + FILE_NAME, junk);
    assert.equal(readSavedHubUrl("/data", io), undefined, `lixo (${junk}) vira undefined`);
  }
});

test("falha de escrita devolve false em vez de derrubar o processo", () => {
  const io = { join: (...p) => p.join("/"), mkdir: () => { throw new Error("EACCES"); }, writeFile: () => {}, readFile: () => "" };
  assert.equal(writeSavedHubUrl("/somente-leitura", "https://x.ts.net", io), false);
});
