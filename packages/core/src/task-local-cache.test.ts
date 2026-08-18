import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { LocalTaskCache, localTaskSignature, type LocalTaskFsLike } from "./task-local-cache.js";

/** fs falso que CONTA leituras: o valor da feature é não abrir arquivo com cache quente, então a
 *  contagem é o critério de aceite, não um detalhe de implementação. */
function fakeFs(tree: Record<string, Record<string, { text: string; mtimeMs: number }>>) {
  const reads: string[] = [];
  const stats: string[] = [];
  const fs: LocalTaskFsLike = {
    existsSync: (dir) => !!tree[dir],
    readdirSync: (dir) => Object.keys(tree[dir] || {}),
    statSync: (path) => {
      stats.push(path);
      for (const [dir, files] of Object.entries(tree)) {
        for (const [name, file] of Object.entries(files)) if (join(dir, name) === path) return { mtimeMs: file.mtimeMs, size: file.text.length };
      }
      throw new Error("ENOENT: " + path);
    },
    readFileSync: (path) => {
      reads.push(path);
      for (const [dir, files] of Object.entries(tree)) {
        for (const [name, file] of Object.entries(files)) if (join(dir, name) === path) return file.text;
      }
      throw new Error("ENOENT: " + path);
    },
  };
  return { fs, reads, stats };
}

const parse = (content: string, relPath: string) => ({ key: relPath, title: /^#\s+(.+)/m.exec(content)?.[1] || relPath });
type FakeDir = Record<string, { text: string; mtimeMs: number }>;
const ROOT = join("/proj", "docs", "features");
const tree = (): Record<string, FakeDir> => ({ [ROOT]: { "a.md": { text: "# A", mtimeMs: 100 }, "b.md": { text: "# B", mtimeMs: 200 }, "notes.txt": { text: "x", mtimeMs: 300 } } });

test("cache quente não abre nenhum arquivo", () => {
  const { fs, reads } = fakeFs(tree());
  const cache = new LocalTaskCache({ now: () => 1 });

  const first = cache.list("local\u0000" + ROOT, ROOT, parse, fs);
  assert.equal(first.cached, false);
  assert.deepEqual(first.files.map((f) => f.title), ["A", "B"], "só .md, em ordem");
  assert.equal(reads.length, 2, "primeira listagem leu os dois .md");

  reads.length = 0;
  const second = cache.list("local\u0000" + ROOT, ROOT, parse, fs);
  assert.equal(second.cached, true);
  assert.equal(reads.length, 0, "cache quente: zero arquivos abertos");
  assert.deepEqual(second.files, first.files);
  assert.equal(second.scannedAt, first.scannedAt, "a marca de tempo é a da varredura, não a do pedido");
});

test("alterar um arquivo invalida, mesmo mantendo o tamanho", () => {
  const t = tree();
  const { fs, reads } = fakeFs(t);
  const cache = new LocalTaskCache({ now: () => 1 });
  cache.list("k", ROOT, parse, fs);

  reads.length = 0;
  t[ROOT]["a.md"] = { text: "# Z", mtimeMs: 999 }; // mesmo tamanho, conteúdo e mtime diferentes
  const after = cache.list("k", ROOT, parse, fs);

  assert.equal(after.cached, false);
  assert.equal(reads.length, 2, "releu tudo");
  assert.deepEqual(after.files.map((f) => f.title), ["Z", "B"]);
});

test("arquivo novo e arquivo removido invalidam", () => {
  const t = tree();
  const { fs } = fakeFs(t);
  const cache = new LocalTaskCache({ now: () => 1 });
  cache.list("k", ROOT, parse, fs);

  t[ROOT]["c.md"] = { text: "# C", mtimeMs: 400 };
  assert.equal(cache.list("k", ROOT, parse, fs).files.length, 3, "arquivo novo entra");

  delete t[ROOT]["b.md"];
  const shrunk = cache.list("k", ROOT, parse, fs);
  assert.equal(shrunk.cached, false);
  assert.deepEqual(shrunk.files.map((f) => f.title), ["A", "C"], "removido sai");
});

test("refresh explícito ignora o cache", () => {
  const { fs, reads } = fakeFs(tree());
  const cache = new LocalTaskCache({ now: () => 1 });
  cache.list("k", ROOT, parse, fs);

  reads.length = 0;
  const forced = cache.list("k", ROOT, parse, fs, { refresh: true });
  assert.equal(forced.cached, false);
  assert.equal(reads.length, 2, "refresh relê mesmo sem alteração");
});

test("chaves diferentes (máquinas diferentes) não compartilham resultado", () => {
  const { fs, reads } = fakeFs(tree());
  const cache = new LocalTaskCache({ now: () => 1 });
  cache.list("runner-a\u0000" + ROOT, ROOT, parse, fs);

  reads.length = 0;
  const other = cache.list("runner-b\u0000" + ROOT, ROOT, parse, fs);
  assert.equal(other.cached, false, "o resultado de outra máquina não é reaproveitado");
  assert.equal(reads.length, 2);
});

test("pasta inexistente devolve lista vazia e não guarda entrada", () => {
  const { fs } = fakeFs(tree());
  const cache = new LocalTaskCache({ now: () => 1 });
  const missing = cache.list("k", join("/proj", "nao-existe"), parse, fs);
  assert.deepEqual(missing.files, []);
  assert.equal(missing.cached, false);
  assert.equal(cache.size(), 0, "pasta ausente não ocupa espaço no cache");
});

test("erro ao assinar descarta a entrada em vez de servir resultado velho", () => {
  const t = tree();
  const { fs } = fakeFs(t);
  const cache = new LocalTaskCache({ now: () => 1 });
  cache.list("k", ROOT, parse, fs);
  assert.equal(cache.size(), 1);

  const broken: LocalTaskFsLike = { ...fs, statSync: () => { throw new Error("EACCES"); } };
  assert.throws(() => cache.list("k", ROOT, parse, broken), /EACCES/);
  assert.equal(cache.size(), 0, "nunca devolver resultado velho como se fosse atual");
});

test("teto de arquivos: a assinatura ignora o que não entra na lista", () => {
  const dir: FakeDir = {};
  for (let i = 0; i < 105; i++) dir[`f${String(i).padStart(3, "0")}.md`] = { text: `# T${i}`, mtimeMs: 10 };
  const t = { [ROOT]: dir };
  const { fs, reads } = fakeFs(t);
  const cache = new LocalTaskCache({ now: () => 1 });
  const first = cache.list("k", ROOT, parse, fs, { cap: 100 });
  assert.equal(first.files.length, 100);

  reads.length = 0;
  t[ROOT]["f104.md"] = { text: "# mudou", mtimeMs: 555 }; // fora do teto
  assert.equal(cache.list("k", ROOT, parse, fs, { cap: 100 }).cached, true, "mudança fora do teto não invalida");
  assert.equal(reads.length, 0);
});

test("LRU limita o número de pastas guardadas", () => {
  const t: Record<string, FakeDir> = {};
  for (let i = 0; i < 4; i++) t[join("/proj", "p" + i)] = { "a.md": { text: "# A" + i, mtimeMs: i } };
  const { fs } = fakeFs(t);
  const cache = new LocalTaskCache({ now: () => 1, max: 3 });
  for (let i = 0; i < 4; i++) cache.list("k" + i, join("/proj", "p" + i), parse, fs);

  assert.equal(cache.size(), 3, "guarda no máximo 3");
  assert.equal(cache.list("k0", join("/proj", "p0"), parse, fs).cached, false, "a mais antiga foi descartada");
});

test("localTaskSignature não abre arquivo nenhum", () => {
  const { fs, reads } = fakeFs(tree());
  const sig = localTaskSignature(ROOT, fs, 100);
  assert.equal(reads.length, 0, "assinatura é readdir + stat, nunca leitura");
  assert.equal(localTaskSignature(ROOT, fs, 100), sig, "estável entre chamadas sem mudança");
});
