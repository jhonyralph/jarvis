import { test } from "node:test";
import assert from "node:assert/strict";
import { recordFail, blockedFor, recordSuccess, connOpen, connClose, stats, clientIp, isLoopback, originAllowed, forwardedClientIp, parseTrustProxy } from "./guard.js";

// Sem JARVIS_ALLOWED_ORIGINS (o caso de toda instalação normal) o padrão é MESMA ORIGEM: WebSocket
// não passa por CORS, então "qualquer origem" deixava qualquer site que o dono visitasse discar o
// Hub — inclusive o loopback, que a máquina do Hub sempre tem no ar.
test("originAllowed: navegador só entra se a página veio deste Hub", () => {
  const req = (origin: string, host: string) => ({ headers: { origin, host } });
  assert.equal(originAllowed(req("https://hub.exemplo.ts.net", "hub.exemplo.ts.net")), true);
  assert.equal(originAllowed(req("http://127.0.0.1:4577", "127.0.0.1:4577")), true, "a própria UI em loopback");
  assert.equal(originAllowed(req("https://site-do-atacante.example", "127.0.0.1:4577")), false);
  assert.equal(originAllowed(req("http://127.0.0.1:5500", "127.0.0.1:4577")), false, "outra porta é outra origem");
  assert.equal(originAllowed(req("null", "127.0.0.1:4577")), false, "origem opaca (sandbox/file://) não entra");
  assert.equal(originAllowed({ headers: { host: "127.0.0.1:4577" } }), true, "runner/CLI/MCP não mandam Origin");
});

test("clientIp strips the IPv4-mapped IPv6 prefix and falls back to '?'", () => {
  assert.equal(clientIp({ socket: { remoteAddress: "::ffff:1.2.3.4" } }), "1.2.3.4");
  assert.equal(clientIp({ socket: { remoteAddress: "203.0.113.9" } }), "203.0.113.9");
  assert.equal(clientIp({}), "?");
});

test("isLoopback recognises v4 and v6 loopback", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("10.0.0.1"), false);
});

test("brute-force limiter blocks only after the fail threshold, and clears on success", () => {
  const ip = "198.51.100.7"; // unique per test to avoid shared-bucket bleed
  for (let i = 0; i < 9; i++) assert.equal(recordFail(ip).blocked, false, `attempt ${i + 1} should not block yet`);
  const tenth = recordFail(ip);
  assert.equal(tenth.blocked, true, "10th failure should block");
  assert.ok(tenth.retryMs > 0);
  assert.ok(blockedFor(ip) > 0, "the ip is now blocked");
  recordSuccess(ip);
  assert.equal(blockedFor(ip), 0, "a success clears the block");
});

test("connection accounting: open increments, close decrements, loopback is uncapped", () => {
  const before = stats().total;
  assert.equal(connOpen("192.0.2.50"), true);
  assert.equal(stats().total, before + 1);
  connClose("192.0.2.50");
  assert.equal(stats().total, before);
  // loopback ignores the per-IP cap — open many without a single refusal
  for (let i = 0; i < 60; i++) assert.equal(connOpen("127.0.0.1"), true);
  for (let i = 0; i < 60; i++) connClose("127.0.0.1");
});

// Relatado em privado (2026-11-18): a janela de 60 s contada da 1ª falha zerava a contagem, então o
// bloqueio nunca passava de 30–60 s — um atacante que tenta sempre que o bloqueio acaba seguia com
// ~10 senhas a cada 1,5 min, para sempre.
test("brute-force limiter keeps escalating for an attacker who retries every time the block ends", () => {
  const ip = "198.51.100.21";
  let now = 1_000_000_000_000, guesses = 0;
  const end = now + 2 * 60 * 60_000;
  while (now < end) {
    const wait = blockedFor(ip, now);
    if (wait > 0) { now += wait; continue; }
    recordFail(ip, now); guesses++; now += 1000;
  }
  assert.ok(guesses <= 25, `em 2 h o atacante fez ${guesses} tentativas (antes: ~800)`);
  const r = recordFail(ip, now + blockedFor(ip, now));
  assert.equal(r.retryMs, 15 * 60_000, "chega ao teto de 15 min");
});

test("brute-force limiter: after the first block every failure blocks again, doubling", () => {
  const ip = "198.51.100.22";
  let now = 2_000_000_000_000;
  for (let i = 0; i < 9; i++) assert.equal(recordFail(ip, now + i).blocked, false);
  assert.equal(recordFail(ip, now + 10).retryMs, 30_000);
  now += 31_000; // bloqueio acabou e a janela de 60 s ainda não
  assert.equal(recordFail(ip, now).retryMs, 60_000);
  now += 61_000; // já passou a janela de 60 s da 1ª falha — antes isto zerava tudo
  const third = recordFail(ip, now);
  assert.equal(third.blocked, true, "a janela nova não apaga o histórico de bloqueios");
  assert.equal(third.retryMs, 120_000);
});

test("brute-force limiter forgets an IP only after an hour without failures, or on success", () => {
  const ip = "198.51.100.23";
  let now = 3_000_000_000_000;
  for (let i = 0; i < 10; i++) recordFail(ip, now + i);
  now += 61 * 60_000; // uma hora sem falhas
  assert.equal(recordFail(ip, now).blocked, false, "volta a ter 10 tentativas");
  const ip2 = "198.51.100.24";
  for (let i = 0; i < 10; i++) recordFail(ip2, now + i);
  recordSuccess(ip2);
  assert.equal(recordFail(ip2, now + 40_000).blocked, false, "acertar a senha limpa tudo");
});

test("forwardedClientIp trusts only what our proxies appended (rotating the left side changes nothing)", () => {
  assert.equal(forwardedClientIp("203.0.113.5", 1), "203.0.113.5");
  assert.equal(forwardedClientIp("1.1.1.1, 203.0.113.5", 1), "203.0.113.5", "o que o cliente inventou fica à esquerda");
  assert.equal(forwardedClientIp("9.9.9.9, 203.0.113.5", 1), "203.0.113.5", "trocar o valor da esquerda não muda o IP");
  assert.equal(forwardedClientIp("6.6.6.6, 203.0.113.5, 10.0.0.2", 2), "203.0.113.5", "2 proxies: o que o primeiro anotou");
  assert.equal(forwardedClientIp("203.0.113.5", 2), "203.0.113.5", "cadeia mais curta: todos os valores são nossos");
  assert.equal(forwardedClientIp(["1.1.1.1", "::ffff:203.0.113.5"], 1), "203.0.113.5", "cabeçalho repetido e prefixo IPv6");
  assert.equal(forwardedClientIp(" , ", 1), undefined);
  assert.equal(forwardedClientIp(undefined, 1), undefined);
  assert.equal(forwardedClientIp("203.0.113.5", 0), undefined, "sem proxy confiável, o cabeçalho não vale");
});

test("parseTrustProxy: on/true/1 = one proxy, a number = a chain, anything else = off", () => {
  for (const v of ["on", "ON", "true", "1"]) assert.equal(parseTrustProxy(v), 1, v);
  assert.equal(parseTrustProxy("2"), 2);
  for (const v of [undefined, "", "off", "0", "false", "-1", "1.5", "yes"]) assert.equal(parseTrustProxy(v), 0, String(v));
});
