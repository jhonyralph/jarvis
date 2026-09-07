// O "Testar conexão" da tela de endereço. Roda no main porque de lá não há CORS nem origem; é a
// única resposta objetiva que o usuário tem para "o endereço está certo?", então precisa distinguir
// "ninguém atendeu" de "atendeu e recusou" — e nunca rejeitar, senão a tela trava no botão.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const { probe, friendly } = createRequire(import.meta.url)("./register-setup-ipc.js");

/** Sobe um servidor efêmero em 127.0.0.1 e devolve {url, close}. */
async function serve(handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

test("um Hub vivo responde ok, e o /health é o alvo", async () => {
  const seen = [];
  const s = await serve((req, res) => { seen.push(req.url); res.writeHead(200).end('{"ok":true}'); });
  try {
    const r = await probe(s.url);
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.deepEqual(seen, ["/health"]);
    // Barra final não pode virar "//health".
    assert.equal((await probe(s.url + "/")).ok, true);
    assert.deepEqual(seen, ["/health", "/health"]);
  } finally { await s.close(); }
});

test("401/404 ainda é um Hub vivo — o que o usuário precisa saber aqui é que ALGUÉM atendeu", async () => {
  const s = await serve((_req, res) => res.writeHead(401).end());
  try {
    const r = await probe(s.url);
    assert.equal(r.ok, true, "autenticação pendente não é endereço errado");
    assert.equal(r.status, 401);
  } finally { await s.close(); }
});

test("5xx conta como falha: atendeu, mas não está servindo", async () => {
  const s = await serve((_req, res) => res.writeHead(503).end());
  try {
    const r = await probe(s.url);
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
  } finally { await s.close(); }
});

test("porta fechada devolve o motivo em português, sem rejeitar", async () => {
  const s = await serve((_req, res) => res.end());
  const dead = s.url;
  await s.close();
  const r = await probe(dead, 2000);
  assert.equal(r.ok, false);
  assert.equal(r.url, dead);
  assert.match(r.error, /recusada|sem resposta|inalcançável/);
});

test("endereço inválido não vira exceção", async () => {
  for (const bad of ["", "não é url", "http://", null, undefined]) {
    const r = await probe(String(bad ?? ""), 500);
    assert.equal(r.ok, false, `${bad} deveria falhar limpo`);
    assert.ok(r.error, "sempre há um motivo legível");
  }
});

test("friendly traduz os códigos que aparecem de verdade", () => {
  assert.match(friendly({ code: "ECONNREFUSED" }), /recusada/);
  assert.match(friendly({ code: "ENOTFOUND" }), /Tailscale/);
  assert.match(friendly({ code: "ETIMEDOUT" }), /sem resposta/);
  assert.match(friendly({ code: "CERT_HAS_EXPIRED" }), /certificado/);
  assert.equal(friendly({ message: "coisa estranha" }), "coisa estranha", "desconhecido passa direto");
});
