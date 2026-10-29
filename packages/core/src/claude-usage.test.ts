/**
 * Limites do plano do Claude (2026-10-28): o endpoint /api/oauth/usage é MUITO restrito — medido, ~6
 * consultas próximas = 429 com `retry-after: 300`. O painel mostrava "erro ao consultar o provedor"
 * com frequência porque cada abertura consultava de novo (falha sem cache) e estendia o bloqueio.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter, CLAUDE_USAGE_TTL_MS } from "./agents.js";

const home = mkdtempSync(join(tmpdir(), "jarvis-claude-usage-"));
mkdirSync(join(home, ".claude"), { recursive: true });
writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "token-falso" } }));
process.env.USERPROFILE = home; process.env.HOME = home;

const ok = () => new Response(JSON.stringify({ five_hour: { utilization: 46, resets_at: "2026-10-29T03:40:00Z" }, seven_day: { utilization: 12 } }), { status: 200 });
const limited = () => new Response(JSON.stringify({ error: { type: "rate_limit_error" } }), { status: 429, headers: { "retry-after": "300" } });

function withFetch(responses: Array<() => Response>) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => { calls.push(String(url)); const next = responses.shift(); if (!next) throw new Error("fetch inesperado"); return next(); }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("429 depois de uma leitura boa: devolve o último valor com a idade, e não consulta de novo durante o bloqueio", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-28T20:00:00Z") });
  const f = withFetch([ok, limited]);
  try {
    const a = new ClaudeCodeAdapter();
    const first = await a.usage();
    assert.equal(first?.fiveHour?.pct, 46);
    assert.equal(first?.stale, undefined);
    assert.equal((await a.usage())?.fiveHour?.pct, 46);
    assert.equal(f.calls.length, 1, "dentro do cache: nenhuma consulta nova");
    mock.timers.tick(CLAUDE_USAGE_TTL_MS + 1);
    const stale = await a.usage();
    assert.equal(stale?.stale, true, "o provedor recusou: serve o valor anterior em vez de erro");
    assert.equal(stale?.fiveHour?.pct, 46);
    assert.equal(stale?.fetchedAt, "2026-10-28T20:00:00.000Z");
    assert.match(String(stale?.staleReason), /limitou as consultas/);
    mock.timers.tick(60_000);
    assert.equal((await a.usage())?.stale, true);
    assert.equal(f.calls.length, 2, "durante o bloqueio de 5 min nem tenta — cada tentativa estenderia o bloqueio");
  } finally { f.restore(); mock.timers.reset(); }
});

test("429 sem leitura anterior: o erro diz a causa e quando tentar de novo", async () => {
  const f = withFetch([limited]);
  try {
    const a = new ClaudeCodeAdapter();
    await assert.rejects(a.usage(), /limitou as consultas de limites — nova tentativa em 5 min/);
    await assert.rejects(a.usage(), /limitou as consultas/);
    assert.equal(f.calls.length, 1);
  } finally { f.restore(); }
});

test("vários aparelhos abrindo o painel juntos fazem UMA consulta", async () => {
  const f = withFetch([ok]);
  try {
    const a = new ClaudeCodeAdapter();
    const all = await Promise.all([a.usage(), a.usage(), a.usage()]);
    assert.deepEqual(all.map((u) => u?.fiveHour?.pct), [46, 46, 46]);
    assert.equal(f.calls.length, 1);
  } finally { f.restore(); }
});

test("token vencido (401) tem mensagem própria", async () => {
  const f = withFetch([() => new Response("{}", { status: 401 })]);
  try { await assert.rejects(new ClaudeCodeAdapter().usage(), /token do Claude vencido/); } finally { f.restore(); }
});
