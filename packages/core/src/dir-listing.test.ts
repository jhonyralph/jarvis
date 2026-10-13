import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBrowsePath, listDirectory } from "./dir-listing.js";

const win = { platform: "win32" as const, home: "C:\\Users\\voce" };
const nix = { platform: "linux" as const, home: "/home/voce" };

test("normalizeBrowsePath: vazio é a home da máquina que lista", () => {
  assert.deepEqual(normalizeBrowsePath("", win), { ok: true, path: "C:\\Users\\voce" });
  assert.deepEqual(normalizeBrowsePath(undefined, nix), { ok: true, path: "/home/voce" });
  assert.deepEqual(normalizeBrowsePath("   ", nix), { ok: true, path: "/home/voce" });
});

test("normalizeBrowsePath: aspas do 'Copiar como caminho' e espaços saem", () => {
  assert.deepEqual(normalizeBrowsePath("  \"C:\\Program Files\\App\"  ", win), { ok: true, path: "C:\\Program Files\\App" });
  assert.deepEqual(normalizeBrowsePath("'/srv/app'", nix), { ok: true, path: "/srv/app" });
});

test("normalizeBrowsePath: ~ vira a home (com / ou \\ no Windows; só / fora dele)", () => {
  assert.deepEqual(normalizeBrowsePath("~", win), { ok: true, path: "C:\\Users\\voce" });
  assert.deepEqual(normalizeBrowsePath("~/Workspace", win), { ok: true, path: "C:\\Users\\voce\\Workspace" });
  assert.deepEqual(normalizeBrowsePath("~\\Workspace\\jarvis", win), { ok: true, path: "C:\\Users\\voce\\Workspace\\jarvis" });
  assert.deepEqual(normalizeBrowsePath("~/proj", nix), { ok: true, path: "/home/voce/proj" });
  assert.equal(normalizeBrowsePath("~\\proj", nix).ok, false, "fora do Windows, ~\\ não é atalho da home");
});

test("normalizeBrowsePath: letra de disco sozinha vira a raiz do disco", () => {
  assert.deepEqual(normalizeBrowsePath("d:", win), { ok: true, path: "d:\\" });
  assert.deepEqual(normalizeBrowsePath("D:\\", win), { ok: true, path: "D:\\" });
});

test("normalizeBrowsePath: barras, '..' e barra final são normalizados; raiz preserva a barra", () => {
  assert.deepEqual(normalizeBrowsePath("C:/Users/voce/", win), { ok: true, path: "C:\\Users\\voce" });
  assert.deepEqual(normalizeBrowsePath("C:\\a\\b\\..\\c", win), { ok: true, path: "C:\\a\\c" });
  assert.deepEqual(normalizeBrowsePath("/srv//app/", nix), { ok: true, path: "/srv/app" });
  assert.deepEqual(normalizeBrowsePath("/", nix), { ok: true, path: "/" });
  assert.deepEqual(normalizeBrowsePath("\\\\nas\\share\\", win), { ok: true, path: "\\\\nas\\share\\" });
});

test("normalizeBrowsePath: caminho relativo é recusado com exemplo da plataforma", () => {
  const w = normalizeBrowsePath("projetos\\x", win);
  assert.equal(w.ok, false);
  assert.match((w as { error: string }).error, /C:\\projetos/);
  const n = normalizeBrowsePath("projetos", nix);
  assert.equal(n.ok, false);
  assert.match((n as { error: string }).error, /\/home\/voce\/projetos/);
});

test("listDirectory: lista pastas (e arquivos só quando pedido) da pasta digitada", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-dirlist-"));
  try {
    mkdirSync(join(root, "b-pasta")); mkdirSync(join(root, "a-pasta")); writeFileSync(join(root, "nota.txt"), "x");
    const only = listDirectory(`"${root}${process.platform === "win32" ? "\\" : "/"}"`);
    assert.equal(only.error, undefined);
    assert.equal(only.path, root);
    assert.deepEqual(only.entries, ["a-pasta", "b-pasta"]);
    assert.equal(only.files, undefined, "o seletor de pasta não recebe arquivos");
    const withFiles = listDirectory(root, { files: true });
    assert.deepEqual(withFiles.files, ["nota.txt"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("listDirectory: erro volta no próprio resultado, legível, sem exceção", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-dirlist-"));
  try {
    const missing = join(root, "nao-existe");
    const r = listDirectory(missing);
    assert.deepEqual(r.entries, []);
    assert.equal(r.path, missing);
    assert.match(r.error || "", /pasta não encontrada/);
    writeFileSync(join(root, "arquivo.txt"), "x");
    assert.match(listDirectory(join(root, "arquivo.txt")).error || "", /não é uma pasta/);
    assert.match(listDirectory("relativo/x").error || "", /caminho absoluto/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("listDirectory: no Windows, a raiz de um disco traz a lista de discos (e só ela)", () => {
  const drives = () => ["C:\\", "D:\\"];
  // A leitura de "Q:\" falha em qualquer máquina de teste — o que importa é os discos virem junto.
  const atRoot = listDirectory("Q:", { platform: "win32", home: "C:\\Users\\voce", drives });
  assert.equal(atRoot.path, "Q:\\");
  assert.equal(atRoot.parent, "Q:\\");
  assert.deepEqual(atRoot.drives, ["C:\\", "D:\\"]);
  const deeper = listDirectory("Q:\\pasta", { platform: "win32", home: "C:\\Users\\voce", drives });
  assert.equal(deeper.drives, undefined);
  assert.equal(listDirectory("/", { platform: "linux", home: "/root", drives }).drives, undefined);
});
