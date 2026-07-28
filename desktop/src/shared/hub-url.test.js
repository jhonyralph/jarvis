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
