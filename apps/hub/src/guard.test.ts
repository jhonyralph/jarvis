import { test } from "node:test";
import assert from "node:assert/strict";
import { recordFail, blockedFor, recordSuccess, connOpen, connClose, stats, clientIp, isLoopback, originAllowed } from "./guard.js";

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
