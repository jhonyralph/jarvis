// A URL do Hub é o ÚNICO parâmetro do shell desktop: um formato errado não falha alto, o app só
// fica girando no backoff de reconexão numa tela vazia. Estes casos travam o contrato.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { normalizeHubUrl, DEFAULT_HUB_URL } = createRequire(import.meta.url)("./hub-url.js");

test("vazio cai no padrão local, sem tratar como erro", () => {
  for (const value of ["", "   ", undefined, null]) {
    const r = normalizeHubUrl(value);
    assert.equal(r.url, DEFAULT_HUB_URL);
    assert.equal(r.usedFallback, true);
    assert.equal(r.warning, undefined, "não avisar: rodar contra o Hub local é o caso normal");
  }
});

test("normaliza para a origem (barra final e caminho não sobrevivem)", () => {
  for (const value of ["https://jarvis.ts.net", "https://jarvis.ts.net/", "https://jarvis.ts.net/x?y=1"]) {
    assert.equal(normalizeHubUrl(value).url, "https://jarvis.ts.net");
  }
});

test("sem esquema assume http — é o erro de digitação mais comum", () => {
  assert.equal(normalizeHubUrl("jarvis.ts.net").url, "http://jarvis.ts.net");
  assert.equal(normalizeHubUrl("192.168.0.10:4577").url, "http://192.168.0.10:4577");
});

test("ws/wss viram http/https: é o endereço do RUNNER, colado por engano", () => {
  assert.equal(normalizeHubUrl("ws://jarvis.ts.net").url, "http://jarvis.ts.net");
  assert.equal(normalizeHubUrl("wss://jarvis.ts.net").url, "https://jarvis.ts.net");
});

test("esquema sem sentido para carregar a UI é recusado com motivo", () => {
  const r = normalizeHubUrl("file:///c:/x");
  assert.equal(r.url, DEFAULT_HUB_URL);
  assert.equal(r.usedFallback, true);
  assert.match(r.warning, /http\(s\)/);
});

test("lixo não derruba o app — devolve fallback e explica", () => {
  const r = normalizeHubUrl("não é url");
  assert.equal(r.url, DEFAULT_HUB_URL);
  assert.match(r.warning, /inválida/);
});

test("nunca lança, seja qual for a entrada", () => {
  for (const value of [123, {}, [], true, "http://", "://x"]) {
    assert.doesNotThrow(() => normalizeHubUrl(value));
  }
});

/**
 * Descoberta pelo runner. Numa máquina que só roda runner não existe Hub em 127.0.0.1:4577, então
 * o fallback padrão produz uma janela que nunca carrega — e o endereço certo já está no disco,
 * porque é por ele que o runner se conecta.
 */
const { readRunnerHubUrl } = createRequire(import.meta.url)("./hub-url.js");
const fakeHome = (content) => ({ home: "/h", join: (...p) => p.join("/"), readFile: (f) => {
  assert.equal(f, "/h/.jarvis/runner.env", "lê o runner.env do usuário");
  if (content == null) throw new Error("ENOENT");
  return content;
} });

test("lê JARVIS_HUB do runner.env e o normalizador converte ws→http", () => {
  const raw = readRunnerHubUrl(fakeHome('JARVIS_HUB=wss://jarvis.ts.net\nJARVIS_TOKEN=x\nJARVIS_LABEL="Este PC"\n'));
  assert.equal(raw, "wss://jarvis.ts.net");
  assert.equal(normalizeHubUrl(raw).url, "https://jarvis.ts.net");
  assert.equal(normalizeHubUrl(raw).usedFallback, false, "endereço descoberto não é fallback");
});

test("tolera o BOM que o PowerShell 5 escreve com -Encoding UTF8", () => {
  assert.equal(readRunnerHubUrl(fakeHome('﻿JARVIS_HUB=ws://10.0.0.2:4577\n')), "ws://10.0.0.2:4577");
});

test("tolera espaços, aspas e chaves fora de ordem", () => {
  assert.equal(readRunnerHubUrl(fakeHome('JARVIS_TOKEN=abc\n  JARVIS_HUB = "wss://a.ts.net"  \n')), "wss://a.ts.net");
  assert.equal(readRunnerHubUrl(fakeHome("JARVIS_HUB='ws://b.ts.net'\n")), "ws://b.ts.net");
});

test("arquivo ausente, vazio ou sem a chave devolve undefined — nunca lança", () => {
  assert.equal(readRunnerHubUrl(fakeHome(null)), undefined, "ENOENT é o caso normal fora de um runner");
  assert.equal(readRunnerHubUrl(fakeHome("")), undefined);
  assert.equal(readRunnerHubUrl(fakeHome("JARVIS_TOKEN=x\n")), undefined);
  assert.equal(readRunnerHubUrl(fakeHome("JARVIS_HUB=\n")), undefined, "chave vazia não vira URL");
  assert.equal(readRunnerHubUrl(fakeHome('JARVIS_HUB=""\n')), undefined);
  assert.doesNotThrow(() => readRunnerHubUrl(fakeHome(12345)));
});

test("não confunde uma chave parecida com JARVIS_HUB", () => {
  assert.equal(readRunnerHubUrl(fakeHome("JARVIS_HUB_EXTRA=ws://x\n")), undefined);
  assert.equal(readRunnerHubUrl(fakeHome("MEU_JARVIS_HUB=ws://x\nJARVIS_HUB=ws://certo\n")), "ws://certo");
});
