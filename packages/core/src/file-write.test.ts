/**
 * BRW-IDE-00 F3 — escrita segura do editor leve (`writeProjectFile`).
 *
 * O contrato que estes testes seguram: nunca sobrescrever em silêncio uma versão que o usuário não
 * viu (a IA pode ter editado), nunca gravar a partir de uma leitura com perda, e nunca deixar o
 * arquivo pela metade.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectFile, writeProjectFile, FILE_EDIT_MAX_BYTES } from "./files.js";

function sandbox(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-fwrite-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Garante que o mtime mude de forma observável mesmo em FS de relógio grosso. */
function bumpMtime(p: string, deltaSec = 5): void {
  const st = statSync(p);
  const t = new Date(st.mtimeMs + deltaSec * 1000);
  utimesSync(p, t, t);
}

test("salvar com a versão lida grava e devolve o novo mtime/size", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "a.ts");
    writeFileSync(p, "const a = 1;\n");
    const read = readProjectFile(p);
    assert.equal(read.readOnlyReason, undefined);
    const r = await writeProjectFile(p, undefined, "const a = 2;\n", { expectedMtimeMs: read.mtimeMs, expectedSize: read.size });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(p, "utf8"), "const a = 2;\n");
    assert.equal(r.size, Buffer.byteLength("const a = 2;\n"));
    assert.equal(r.mtimeMs, statSync(p).mtimeMs);
    assert.equal(r.conflict, undefined);
  } finally { done(); }
});

test("arquivo mudou depois da leitura (a IA editou) → conflito, nada é gravado", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "b.md");
    writeFileSync(p, "# v1\n");
    const read = readProjectFile(p);
    writeFileSync(p, "# v2 da IA\n"); bumpMtime(p);
    const r = await writeProjectFile(p, undefined, "# minha versão\n", { expectedMtimeMs: read.mtimeMs, expectedSize: read.size });
    assert.equal(r.ok, false);
    assert.ok(r.conflict, "devia ser conflito");
    assert.equal(r.conflict!.mtimeMs, statSync(p).mtimeMs);
    assert.equal(r.conflict!.size, Buffer.byteLength("# v2 da IA\n"));
    assert.equal(readFileSync(p, "utf8"), "# v2 da IA\n", "a versão da IA ficou intacta");
  } finally { done(); }
});

test("mesmo mtime mas tamanho diferente também é conflito", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "c.txt");
    writeFileSync(p, "abc");
    const read = readProjectFile(p);
    const r = await writeProjectFile(p, undefined, "xyz", { expectedMtimeMs: read.mtimeMs, expectedSize: 99 });
    assert.equal(r.ok, false);
    assert.ok(r.conflict);
    assert.equal(readFileSync(p, "utf8"), "abc");
  } finally { done(); }
});

test("force sobrescreve mesmo com conflito (o usuário escolheu)", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "d.txt");
    writeFileSync(p, "v1");
    const read = readProjectFile(p);
    writeFileSync(p, "v2"); bumpMtime(p);
    const r = await writeProjectFile(p, undefined, "minha", { expectedMtimeMs: read.mtimeMs, force: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(p, "utf8"), "minha");
  } finally { done(); }
});

test("sem expectedMtimeMs não sobrescreve nada", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "e.txt");
    writeFileSync(p, "original");
    const r = await writeProjectFile(p, undefined, "cego", {});
    assert.equal(r.ok, false);
    assert.match(r.error || "", /expectedMtimeMs/);
    assert.equal(readFileSync(p, "utf8"), "original");
  } finally { done(); }
});

test("CRLF é preservado exatamente como veio", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "win.ps1");
    writeFileSync(p, "a\r\nb\r\n");
    const read = readProjectFile(p);
    assert.equal(read.content, "a\r\nb\r\n");
    const r = await writeProjectFile(p, undefined, "a\r\nb\r\nc\r\n", { expectedMtimeMs: read.mtimeMs });
    assert.equal(r.ok, true);
    assert.deepEqual(readFileSync(p), Buffer.from("a\r\nb\r\nc\r\n"));
  } finally { done(); }
});

test("escrita é atômica: nenhum temporário sobra e o conteúdo antigo nunca fica pela metade", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "big.txt");
    writeFileSync(p, "x".repeat(1000));
    let read = readProjectFile(p);
    for (let i = 0; i < 5; i++) {
      const body = String(i).repeat(100_000 + i);
      const r = await writeProjectFile(p, undefined, body, { expectedMtimeMs: read.mtimeMs, expectedSize: read.size });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(readFileSync(p, "utf8"), body);
      read = readProjectFile(p);
    }
    assert.deepEqual(readdirSync(dir), ["big.txt"], "temporários .jarvis-*.tmp não podem sobrar");
  } finally { done(); }
});

test("conflito não deixa temporário para trás", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "f.txt");
    writeFileSync(p, "1");
    const read = readProjectFile(p);
    writeFileSync(p, "22"); bumpMtime(p);
    await writeProjectFile(p, undefined, "3", { expectedMtimeMs: read.mtimeMs });
    assert.deepEqual(readdirSync(dir), ["f.txt"]);
  } finally { done(); }
});

test("arquivo truncado na leitura (>512KB) é recusado — editar destruiria o resto", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "huge.log");
    writeFileSync(p, "a".repeat(FILE_EDIT_MAX_BYTES + 10));
    const read = readProjectFile(p);
    assert.equal(read.truncated, true);
    assert.match(read.readOnlyReason || "", /512 KB/);
    const r = await writeProjectFile(p, undefined, "a", { expectedMtimeMs: read.mtimeMs });
    assert.equal(r.ok, false);
    assert.match(r.error || "", /512 KB/);
    assert.equal(statSync(p).size, FILE_EDIT_MAX_BYTES + 10);
  } finally { done(); }
});

test("conteúdo acima do teto é recusado", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "g.txt");
    writeFileSync(p, "ok");
    const read = readProjectFile(p);
    const r = await writeProjectFile(p, undefined, "z".repeat(FILE_EDIT_MAX_BYTES + 1), { expectedMtimeMs: read.mtimeMs });
    assert.equal(r.ok, false);
    assert.match(r.error || "", /512 KB/);
    assert.equal(readFileSync(p, "utf8"), "ok");
  } finally { done(); }
});

test("binário, imagem, NUL e não-UTF-8 não são editáveis", async () => {
  const { dir, done } = sandbox();
  try {
    const img = join(dir, "logo.png"); writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const ri = readProjectFile(img);
    assert.equal(ri.image, true);
    assert.ok(ri.readOnlyReason);
    assert.equal((await writeProjectFile(img, undefined, "x", { expectedMtimeMs: ri.mtimeMs })).ok, false);

    const nul = join(dir, "sep.js"); writeFileSync(nul, Buffer.from("const s='\0';\n"));
    const rn = readProjectFile(nul);
    assert.match(rn.readOnlyReason || "", /nulos/);
    const wn = await writeProjectFile(nul, undefined, "const s='\\0';\n", { expectedMtimeMs: rn.mtimeMs, expectedSize: rn.size });
    assert.equal(wn.ok, false, "gravar o \\0 escapado trocaria o byte nulo por dois caracteres");
    assert.match(wn.error || "", /nulos/);

    const latin = join(dir, "latin1.txt"); writeFileSync(latin, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])); // "café" em Latin-1
    const rl = readProjectFile(latin);
    assert.match(rl.readOnlyReason || "", /UTF-8/);
    const wl = await writeProjectFile(latin, undefined, "café\n", { expectedMtimeMs: rl.mtimeMs, expectedSize: rl.size });
    assert.equal(wl.ok, false);
    assert.deepEqual(readFileSync(latin), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  } finally { done(); }
});

test("guardas de caminho: .git, relativo sem pasta, pasta no lugar de arquivo", async () => {
  const { dir, done } = sandbox();
  try {
    mkdirSync(join(dir, ".git"));
    const head = join(dir, ".git", "HEAD"); writeFileSync(head, "ref: refs/heads/main\n");
    const rh = readProjectFile(head);
    const w1 = await writeProjectFile(head, undefined, "x", { expectedMtimeMs: rh.mtimeMs });
    assert.equal(w1.ok, false); assert.match(w1.error || "", /\.git/);
    assert.equal(readFileSync(head, "utf8"), "ref: refs/heads/main\n");

    const w2 = await writeProjectFile("relativo.txt", undefined, "x", { create: true });
    assert.equal(w2.ok, false); assert.match(w2.error || "", /relativo/);

    mkdirSync(join(dir, "pasta"));
    const w3 = await writeProjectFile(join(dir, "pasta"), undefined, "x", { expectedMtimeMs: statSync(join(dir, "pasta")).mtimeMs });
    assert.equal(w3.ok, false); assert.match(w3.error || "", /não é um arquivo/);

    const w4 = await writeProjectFile("", dir, "x", {});
    assert.equal(w4.ok, false);
  } finally { done(); }
});

test("caminho relativo resolve contra a pasta da sessão, igual à leitura", async () => {
  const { dir, done } = sandbox();
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "x.ts"), "1");
    const read = readProjectFile("src/x.ts", dir);
    assert.equal(read.path, join(dir, "src", "x.ts"));
    const r = await writeProjectFile("src/x.ts", dir, "2", { expectedMtimeMs: read.mtimeMs });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.path, join(dir, "src", "x.ts"));
    assert.equal(readFileSync(join(dir, "src", "x.ts"), "utf8"), "2");
  } finally { done(); }
});

test("criar: só com create explícito, nunca por cima de arquivo existente", async () => {
  const { dir, done } = sandbox();
  try {
    const novo = join(dir, "novo.md");
    const r = await writeProjectFile(novo, undefined, "# novo\n", { create: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.created, true);
    assert.equal(readFileSync(novo, "utf8"), "# novo\n");
    const again = await writeProjectFile(novo, undefined, "# outro\n", { create: true });
    assert.equal(again.ok, false);
    assert.equal(again.conflict?.exists, true);
    assert.equal(readFileSync(novo, "utf8"), "# novo\n");
    const semPasta = await writeProjectFile(join(dir, "nao", "existe.md"), undefined, "x", { create: true });
    assert.equal(semPasta.ok, false);
    assert.deepEqual(readdirSync(dir).sort(), ["novo.md"]);
  } finally { done(); }
});

test("arquivo apagado desde a leitura → conflito 'missing'; force recria", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "sumiu.txt");
    writeFileSync(p, "v1");
    const read = readProjectFile(p);
    rmSync(p);
    const r = await writeProjectFile(p, undefined, "minha", { expectedMtimeMs: read.mtimeMs });
    assert.equal(r.ok, false);
    assert.equal(r.conflict?.missing, true);
    assert.equal(existsSync(p), false, "não recria sem o usuário pedir");
    const f = await writeProjectFile(p, undefined, "minha", { expectedMtimeMs: read.mtimeMs, force: true });
    assert.equal(f.ok, true, JSON.stringify(f));
    assert.equal(readFileSync(p, "utf8"), "minha");
  } finally { done(); }
});

test("somente leitura no disco é recusado (mesmo com force)", async () => {
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "ro.txt");
    writeFileSync(p, "travado");
    chmodSync(p, 0o444);
    const read = readProjectFile(p);
    assert.match(read.readOnlyReason || "", /somente leitura/);
    const r = await writeProjectFile(p, undefined, "x", { expectedMtimeMs: read.mtimeMs, force: true });
    assert.equal(r.ok, false);
    assert.match(r.error || "", /somente leitura/);
    chmodSync(p, 0o644);
    assert.equal(readFileSync(p, "utf8"), "travado");
  } finally { done(); }
});

test("link simbólico: grava no alvo e o link continua link", async (t) => {
  const { dir, done } = sandbox();
  try {
    const real = join(dir, "real.txt"); writeFileSync(real, "alvo");
    const lnk = join(dir, "atalho.txt");
    try { symlinkSync(real, lnk, "file"); } catch { t.skip("sem permissão para criar symlink nesta máquina"); return; }
    const read = readProjectFile(lnk);
    const r = await writeProjectFile(lnk, undefined, "novo", { expectedMtimeMs: read.mtimeMs });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(real, "utf8"), "novo");
    assert.equal(lstatSync(lnk).isSymbolicLink(), true);
  } finally { done(); }
});

test("POSIX: o modo do arquivo (ex.: script executável) sobrevive ao salvar", async (t) => {
  if (process.platform === "win32") { t.skip("bits de modo POSIX não se aplicam no Windows"); return; }
  const { dir, done } = sandbox();
  try {
    const p = join(dir, "run.sh"); writeFileSync(p, "#!/bin/sh\necho 1\n"); chmodSync(p, 0o755);
    const read = readProjectFile(p);
    const r = await writeProjectFile(p, undefined, "#!/bin/sh\necho 2\n", { expectedMtimeMs: read.mtimeMs });
    assert.equal(r.ok, true);
    assert.equal(statSync(p).mode & 0o777, 0o755);
  } finally { done(); }
});
