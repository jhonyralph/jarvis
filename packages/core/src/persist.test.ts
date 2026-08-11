import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, readJson, jsonExists, cleanupOrphanBackups } from "./persist.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "jarvis-persist-"));
}

test("round-trips an object", () => {
  const dir = tmp();
  try {
    const f = join(dir, "a.json");
    writeJsonAtomic(f, { hello: "world", n: 1 });
    assert.deepEqual(readJson(f, null), { hello: "world", n: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("creates the parent directory if missing", () => {
  const dir = tmp();
  try {
    const f = join(dir, "nested", "deep", "b.json");
    writeJsonAtomic(f, [1, 2, 3]);
    assert.deepEqual(readJson(f, null), [1, 2, 3]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("leaves no .tmp file behind", () => {
  const dir = tmp();
  try {
    const f = join(dir, "c.json");
    writeJsonAtomic(f, { ok: true });
    assert.equal(existsSync(f + ".tmp"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a corrupt primary file falls back to the .bak snapshot", () => {
  const dir = tmp();
  try {
    const f = join(dir, "d.json");
    writeJsonAtomic(f, { v: 1 });          // first good write (no .bak yet)
    writeJsonAtomic(f, { v: 2 });          // second write snapshots v:1 into .bak, primary now v:2
    assert.deepEqual(readJson(f, null), { v: 2 });
    writeFileSync(f, "{ this is not valid json");  // simulate a torn/corrupt primary
    assert.deepEqual(readJson(f, null), { v: 1 }, "should recover the last backup");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a corrupt primary with no backup returns the caller default (never throws)", () => {
  const dir = tmp();
  try {
    const f = join(dir, "e.json");
    writeFileSync(f, "garbage");
    assert.deepEqual(readJson(f, { fallback: true }), { fallback: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("backup:false skips the .bak copy", () => {
  const dir = tmp();
  try {
    const f = join(dir, "f.json");
    writeJsonAtomic(f, { v: 1 }, { backup: false });
    writeJsonAtomic(f, { v: 2 }, { backup: false });
    assert.equal(existsSync(f + ".bak"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pretty option indents the output", () => {
  const dir = tmp();
  try {
    const f = join(dir, "g.json");
    writeJsonAtomic(f, { a: 1 }, { pretty: true });
    assert.ok(readFileSync(f, "utf8").includes("\n  "), "pretty output should contain indented newlines");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("jsonExists sees primary or backup", () => {
  const dir = tmp();
  try {
    const f = join(dir, "h.json");
    assert.equal(jsonExists(f), false);
    writeJsonAtomic(f, { v: 1 });
    assert.equal(jsonExists(f), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("o .bak não é envenenado quando algo externo corrompe o primário", () => {
  const dir = tmp();
  try {
    const file = join(dir, "state.json");
    writeJsonAtomic(file, { v: 1 });
    writeJsonAtomic(file, { v: 2 });                       // .bak = {v:1}
    assert.deepEqual(JSON.parse(readFileSync(file + ".bak", "utf8")), { v: 1 });

    writeFileSync(file, "{lixo corrompido");               // corrupção externa (antivírus/edição)
    writeJsonAtomic(file, { v: 3 });                       // a escrita seguinte NÃO pode copiar o lixo
    const bak = readFileSync(file + ".bak", "utf8");
    assert.doesNotThrow(() => JSON.parse(bak), "o .bak continua sendo JSON válido");
    assert.deepEqual(JSON.parse(bak), { v: 2 }, "guarda o último estado BOM, não o corrompido");
    assert.deepEqual(readJson(file, null), { v: 3 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readJson: allowStale:false recusa o .bak e avisa em vez de restaurar estado velho", () => {
  const dir = tmp();
  try {
    const file = join(dir, "pending.json");
    writeJsonAtomic(file, { a: 1 });
    writeJsonAtomic(file, { a: 2 });
    writeFileSync(file, "truncad");                        // primário ilegível

    const seen: Array<{ path: string; used: boolean }> = [];
    const stale = readJson(file, { fallback: true } as any, { onFallback: (i) => seen.push(i) });
    assert.deepEqual(stale, { a: 1 }, "por padrão recupera do .bak");
    assert.equal(seen.at(-1)?.used, true, "e avisa (antes era silencioso)");

    const fresh = readJson(file, { fallback: true } as any, { allowStale: false, onFallback: (i) => seen.push(i) });
    assert.deepEqual(fresh, { fallback: true }, "com allowStale:false usa o padrão, não o .bak");
    assert.equal(seen.at(-1)?.used, false, "avisa que ignorou o backup");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("backup:false não cria .bak (caminho quente)", () => {
  const dir = tmp();
  try {
    const file = join(dir, "hot.json");
    writeJsonAtomic(file, { n: 1 }, { backup: false });
    writeJsonAtomic(file, { n: 2 }, { backup: false });
    assert.equal(existsSync(file + ".bak"), false);
    assert.deepEqual(readJson(file, null), { n: 2 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cleanupOrphanBackups remove só órfãos antigos e preserva a rede de segurança", () => {
  const dir = tmp();
  try {
    const live = join(dir, "live.json");
    writeJsonAtomic(live, { a: 1 }); writeJsonAtomic(live, { a: 2 });   // live.json + live.json.bak
    writeFileSync(join(dir, "gone.json.bak"), "{}");                    // órfão (sem primário)
    writeFileSync(join(dir, "half.json.tmp"), "{}");                    // sobra de escrita interrompida

    const novo = cleanupOrphanBackups(dir);                             // idade mínima padrão: 24h
    assert.deepEqual(novo, [], "arquivos recém-escritos não são tocados");

    const removed = cleanupOrphanBackups(dir, { minAgeMs: 0 });
    assert.ok(removed.some((p) => p.endsWith("gone.json.bak")), "órfão removido");
    assert.ok(removed.some((p) => p.endsWith("half.json.tmp")), ".tmp esquecido removido");
    assert.equal(existsSync(live + ".bak"), true, "o .bak de um arquivo VIVO permanece");
    assert.equal(existsSync(live), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
