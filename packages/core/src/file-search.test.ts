/**
 * BRW-IDE-00 F3 — busca de conteúdo no projeto (`searchProjectFiles`).
 *
 * Os dois caminhos são testados: a worker (sem ripgrep — o caso comum no Windows) e o ripgrep,
 * aqui por um rg FALSO (script node que imprime o `--json` do rg) para o teste não depender de
 * binário instalado; com `JARVIS_RG` apontando para um rg de verdade, o último teste o exercita.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { parseRgJsonLine, searchProjectFiles } from "./file-search.js";

function project(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-fsearch-"));
  mkdirSync(join(dir, "src", "deep"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "lib"), { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "const alpha = 1;\nexport function findMe() { return alpha; }\n");
  writeFileSync(join(dir, "src", "deep", "b.md"), "# Título\r\nlinha com FindMe aqui\r\n");
  writeFileSync(join(dir, "node_modules", "lib", "x.js"), "findMe in deps\n");
  writeFileSync(join(dir, ".git", "config"), "findMe in git\n");
  writeFileSync(join(dir, "img.png"), Buffer.from("findMe"));
  writeFileSync(join(dir, "blob.dat2"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from("findMe")]));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("worker: acha o termo, ignora node_modules/.git/binários e devolve linha/coluna/preview", async () => {
  const { dir, done } = project();
  try {
    const r = await searchProjectFiles(dir, "findme", { engine: "node" });
    assert.equal(r.engine, "node");
    assert.equal(r.error, undefined);
    assert.deepEqual(r.results.map((h) => `${h.rel}:${h.line}:${h.col}`), ["src/a.ts:2:17", "src/deep/b.md:2:11"]);
    const md = r.results[1];
    assert.equal(md.path, join(dir, "src", "deep", "b.md"));
    assert.equal(md.preview, "linha com FindMe aqui", "sem o \\r do CRLF");
    assert.equal(md.preview.slice(md.hl[0], md.hl[1]), "FindMe");
    assert.equal(r.truncated, false);
  } finally { done(); }
});

test("worker: caseSensitive e regex", async () => {
  const { dir, done } = project();
  try {
    const cs = await searchProjectFiles(dir, "FindMe", { engine: "node", caseSensitive: true });
    assert.deepEqual(cs.results.map((h) => h.rel), ["src/deep/b.md"]);
    const rx = await searchProjectFiles(dir, "const\\s+\\w+\\s*=", { engine: "node", regex: true });
    assert.deepEqual(rx.results.map((h) => `${h.rel}:${h.line}`), ["src/a.ts:1"]);
    assert.equal(rx.results[0].preview.slice(rx.results[0].hl[0], rx.results[0].hl[1]), "const alpha =");
    const bad = await searchProjectFiles(dir, "(", { engine: "node", regex: true });
    assert.match(bad.error || "", /regular inválida/);
  } finally { done(); }
});

test("worker: teto de resultados corta e marca truncated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-fsearch-max-"));
  try {
    writeFileSync(join(dir, "many.txt"), Array.from({ length: 50 }, (_, i) => `hit ${i}`).join("\n"));
    const r = await searchProjectFiles(dir, "hit", { engine: "node", max: 7 });
    assert.equal(r.results.length, 7);
    assert.equal(r.truncated, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("worker: regex catastrófica NÃO trava o event loop — o teto de tempo encerra a thread", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-fsearch-redos-"));
  const h = monitorEventLoopDelay({ resolution: 10 });
  try {
    writeFileSync(join(dir, "evil.txt"), "a".repeat(40) + "!\n");
    h.enable();
    const t0 = Date.now();
    // Mede o loop ENQUANTO a worker queima CPU: um tique de 20 ms precisa continuar rodando.
    let ticks = 0; const ticker = setInterval(() => { ticks++; }, 20);
    const r = await searchProjectFiles(dir, "^(a+)+$", { engine: "node", regex: true, timeoutMs: 600 });
    clearInterval(ticker);
    h.disable();
    const took = Date.now() - t0;
    assert.equal(r.truncated, true, "estourou o tempo → truncated");
    assert.ok(took < 5000, `encerrou no teto (${took} ms)`);
    assert.ok(ticks >= 10, `o loop principal seguiu rodando (${ticks} tiques)`);
    assert.ok(h.max / 1e6 < 300, `atraso máximo do loop ${Math.round(h.max / 1e6)} ms`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("entrada inválida volta como erro, nunca exceção", async () => {
  assert.match((await searchProjectFiles("relativa", "x")).error || "", /inválida/);
  assert.match((await searchProjectFiles(join(tmpdir(), "nao-existe-" + Date.now()), "x")).error || "", /não existe/);
  assert.match((await searchProjectFiles(tmpdir(), "   ")).error || "", /digite/);
  assert.match((await searchProjectFiles(tmpdir(), "x".repeat(600))).error || "", /longa/);
});

test("parseRgJsonLine converte offsets de BYTES do rg em colunas de caractere", () => {
  const root = join(tmpdir(), "proj");
  const line = JSON.stringify({ type: "match", data: { path: { text: "./src/ação.ts" }, lines: { text: "const ação = 'olá mundo';\r\n" }, line_number: 3, absolute_offset: 0,
    submatches: [{ match: { text: "mundo" }, start: Buffer.byteLength("const ação = 'olá "), end: Buffer.byteLength("const ação = 'olá mundo") }] } });
  const hit = parseRgJsonLine(line, root)!;
  assert.equal(hit.path, join(root, "src", "ação.ts"));
  assert.equal(hit.rel, "src/ação.ts");
  assert.equal(hit.line, 3);
  assert.equal(hit.col, "const ação = 'olá ".length + 1);
  assert.equal(hit.preview, "const ação = 'olá mundo';");
  assert.equal(hit.preview.slice(hit.hl[0], hit.hl[1]), "mundo");
  assert.equal(parseRgJsonLine(JSON.stringify({ type: "begin", data: {} }), root), null);
  assert.equal(parseRgJsonLine(JSON.stringify({ type: "match", data: { path: { bytes: "AAA=" }, lines: { text: "x" }, line_number: 1, submatches: [] } }), root), null, "caminho não-UTF-8 é pulado");
  assert.equal(parseRgJsonLine("lixo", root), null);
});

test("caminho rg (falso): streaming, teto de resultados mata o processo, erro do rg vira mensagem", async () => {
  const { dir, done } = project();
  const fake = join(dir, "fake-rg.mjs");
  writeFileSync(fake, [
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { console.log('ripgrep 14.1.0 (fake)'); process.exit(0); }",
    "const q = args[args.indexOf('--') + 1];",
    "if (q === 'BAD') { console.error('regex parse error: unclosed group'); process.exit(2); }",
    "const fixed = args.includes('--fixed-strings');",
    "console.log(JSON.stringify({ type: 'begin', data: { path: { text: './src/a.ts' } } }));",
    "for (let i = 1; i <= 500; i++) console.log(JSON.stringify({ type: 'match', data: { path: { text: './src/a.ts' }, lines: { text: (fixed ? 'F ' : 'R ') + q + ' ' + i + '\\n' }, line_number: i, submatches: [{ start: 2, end: 2 + q.length }] } }));",
    "setTimeout(() => {}, 30000);", // finge rg lento: só o teto encerra
  ].join("\n"));
  try {
    const opts = { engine: "rg" as const, rgPath: process.execPath, rgPrefixArgs: [fake], max: 5, timeoutMs: 8000 };
    const t0 = Date.now();
    const r = await searchProjectFiles(dir, "alvo", opts);
    assert.equal(r.engine, "rg");
    assert.equal(r.results.length, 5);
    assert.equal(r.truncated, true);
    assert.ok(Date.now() - t0 < 6000, "o teto de resultados encerrou o rg sem esperar o tempo");
    assert.equal(r.results[0].preview, "F alvo 1", "busca literal manda --fixed-strings");
    assert.equal(r.results[0].preview.slice(r.results[0].hl[0], r.results[0].hl[1]), "alvo");
    const bad = await searchProjectFiles(dir, "BAD", { ...opts, regex: true });
    assert.match(bad.error || "", /regex parse error/);
  } finally { done(); }
});

test("ripgrep de verdade (só com JARVIS_RG ou rg no PATH)", async (t) => {
  const rg = process.env.JARVIS_RG;
  if (!rg) { t.skip("defina JARVIS_RG para exercitar um ripgrep real"); return; }
  const { dir, done } = project();
  try {
    const r = await searchProjectFiles(dir, "findme", { engine: "rg", rgPath: rg });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.results.map((h) => `${h.rel}:${h.line}:${h.col}`), ["src/a.ts:2:17", "src/deep/b.md:2:11"]);
  } finally { done(); }
});
