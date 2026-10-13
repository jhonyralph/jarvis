/**
 * Resolução do interpretador Python por plataforma/arquitetura.
 *
 * Por que existe: as quatro pontes de voz usavam `process.env.JARVIS_PYTHON || "python"`, e em
 * macOS NÃO existe binário `python` — então a voz morria com `spawn python ENOENT` no boot, nas
 * quatro, sem nenhuma mensagem que apontasse a causa. A ordem dos candidatos e o texto das
 * mensagens são o conserto; este teste trava os dois, porque ambos são fáceis de "simplificar"
 * depois sem perceber qual máquina quebra.
 *
 * Os casos de resolução usam um SHIM — um script que finge ser um interpretador respondendo no
 * formato do probe. Isso testa a política de escolha de verdade, sem depender do que está
 * instalado na máquina que roda a suíte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pythonCandidates, describePython, pythonBin, resolvePython, resetPythonCache, type PythonProbe } from "./python.js";

const probe = (over: Partial<PythonProbe> = {}): PythonProbe => ({
  executable: "/usr/local/bin/python3.12",
  command: "/usr/local/bin/python3.12",
  version: "3.12.8",
  machine: "x86_64",
  modules: ["piper", "faster_whisper", "openwakeword", "torch", "resemblyzer", "sentence_transformers"],
  core: true,
  fromEnv: false,
  ...over,
});

/** Script que responde como o probe espera: "executable|versão|arquitetura|módulos". */
function shim(dir: string, name: string, modules: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\necho "/fake/${name}|3.12.5|x86_64|${modules}"\n`);
  chmodSync(path, 0o755);
  return path;
}

test("macOS: candidatos são absolutos e o python do Xcode CLT fica em ÚLTIMO", () => {
  const c = pythonCandidates("darwin", "");
  assert.ok(c.length > 5);
  // /usr/bin/python3 existe em TODO Mac. Se ele subir na lista, a busca para nele — que é o 3.9.6
  // sem nenhuma dependência de voz — e nunca alcança o Python que o dono instalou.
  assert.equal(c[c.length - 1], "/usr/bin/python3", "o CLT tem de ser o último recurso");
  // Os dois prefixos do Homebrew: /usr/local no Intel, /opt/homebrew no Apple Silicon. Ter só um
  // acerta uma das duas máquinas e erra a outra.
  assert.ok(c.includes("/usr/local/bin/python3.12"), "prefixo do brew no Intel");
  assert.ok(c.includes("/opt/homebrew/bin/python3.12"), "prefixo do brew no Apple Silicon");
  // 3.12 antes de 3.13+/genérico: é o teto do torch em Mac Intel.
  assert.ok(
    c.indexOf("/usr/local/bin/python3.12") < c.indexOf("/usr/local/bin/python3"),
    "a versão explícita vem antes do python3 genérico, que num Mac novo pode ser 3.14",
  );
});

test("Windows: `python` vem antes de `python3` (que lá é o stub da Store)", () => {
  assert.deepEqual(pythonCandidates("win32", ""), ["python", "python3", "py"]);
});

test("Linux não ganha varredura de caminho absoluto", () => {
  // Distribuição nenhuma concorda sobre onde mora um Python alternativo; chutar caminhos só gastaria
  // sondagem. Lá o jeito de apontar um interpretador é JARVIS_PYTHON.
  assert.deepEqual(pythonCandidates("linux", ""), ["python3", "python"]);
});

test("JARVIS_PYTHON é o primeiro candidato em qualquer plataforma", () => {
  assert.equal(pythonCandidates("darwin", "/opt/py/bin/python3.11")[0], "/opt/py/bin/python3.11");
  assert.equal(pythonCandidates("linux", "/opt/py/bin/python3.11")[0], "/opt/py/bin/python3.11");
});

test("JARVIS_PYTHON tem a palavra FINAL, mesmo sem os módulos do núcleo", async (t) => {
  // O contrato que regrediu: a primeira versão deste resolvedor só paraparava num candidato com
  // `core`, então um JARVIS_PYTHON sem os módulos era DESCARTADO em silêncio e o Hub spawnava outro
  // interpretador — outro site-packages, outro modelo, nada no log. Trocar a escolha explícita do
  // dono por conta própria é pior que falhar no que ele pediu.
  if (process.platform === "win32") return t.skip("o shim é um script sh");
  const dir = mkdtempSync(join(tmpdir(), "jarvis-py-shim-"));
  const original = process.env.JARVIS_PYTHON;
  try {
    const vazio = shim(dir, "python3-vazio", ""); // executa, mas não tem módulo nenhum
    process.env.JARVIS_PYTHON = vazio;
    resetPythonCache();
    const p = await resolvePython();
    assert.equal(p?.command, vazio, "o interpretador apontado pelo dono tem de ser o escolhido");
    assert.equal(p?.core, false);
    assert.equal(p?.fromEnv, true);
    assert.equal(await pythonBin(), vazio);
    // E o diagnóstico tem de dizer que foi escolha explícita, senão a investigação começa errada.
    assert.match(describePython(p).line, /\[JARVIS_PYTHON\]/);
  } finally {
    if (original === undefined) delete process.env.JARVIS_PYTHON; else process.env.JARVIS_PYTHON = original;
    resetPythonCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sem JARVIS_PYTHON, o escolhido é o primeiro com piper + faster_whisper", async (t) => {
  if (process.platform === "win32") return t.skip("o shim é um script sh");
  const dir = mkdtempSync(join(tmpdir(), "jarvis-py-shim-"));
  const original = process.env.JARVIS_PYTHON;
  try {
    // Mesmo com JARVIS_PYTHON apontando para um shim COM núcleo, o resultado tem de ser ele — este
    // caso cobre o caminho "fromEnv e core", que é o normal depois do install-voice.
    const bom = shim(dir, "python3-bom", "piper,faster_whisper");
    process.env.JARVIS_PYTHON = bom;
    resetPythonCache();
    const p = await resolvePython();
    assert.equal(p?.command, bom);
    assert.equal(p?.core, true);
  } finally {
    if (original === undefined) delete process.env.JARVIS_PYTHON; else process.env.JARVIS_PYTHON = original;
    resetPythonCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openwakeword NÃO entra no núcleo — é de outro processo", () => {
  // Os daemons que o Hub sobe são piper_service.py e whisper_service.py; nenhum importa
  // openwakeword (quem importa é o wake_listener.py, lançado separadamente). Exigi-lo aqui fazia o
  // boot pular o warmup e anunciar "voz indisponível" numa máquina com STT e TTS funcionando.
  const d = describePython(probe({ modules: ["piper", "faster_whisper", "torch"] }), "darwin");
  assert.equal(d.ok, true, "sem openwakeword a voz do Hub continua disponível");
  assert.match(d.hint ?? "", /wake word/, "mas o wake word tem de ser reportado como indisponível");
});

test("núcleo completo → ok, sem dica", () => {
  const d = describePython(probe(), "darwin");
  assert.equal(d.ok, true);
  assert.equal(d.hint, undefined);
  assert.match(d.line, /3\.12\.8/);
  assert.match(d.line, /x86_64/);
});

test("Mac Intel com núcleo mas sem torch: ok com ressalva nomeando o teto", () => {
  // Estado NORMAL de um Mac Intel em Python 3.13 — não é defeito, e tratar como falha faria o
  // doctor sair 1 numa máquina que funciona.
  const d = describePython(probe({ version: "3.13.2", modules: ["piper", "faster_whisper", "openwakeword"] }), "darwin");
  assert.equal(d.ok, true);
  assert.match(d.hint ?? "", /identificação de voz e memória semântica/);
  assert.match(d.hint ?? "", /2\.2\.2/, "diz qual é o teto do torch");
});

test("Apple Silicon sem torch NÃO recebe a explicação de teto do Mac Intel", () => {
  // No arm64 o torch é atual; citar o teto de x86_64 aqui mandaria o dono caçar um problema de
  // empacotamento que não existe na máquina dele.
  const d = describePython(probe({ machine: "arm64", modules: ["piper", "faster_whisper", "openwakeword"] }), "darwin");
  assert.equal(d.ok, true);
  assert.match(d.hint ?? "", /identificação de voz/);
  assert.doesNotMatch(d.hint ?? "", /x86_64|2\.2\.2/);
});

test("Mac Intel em Python 3.13+ sem o núcleo: diz que o teto é 3.12 e cita a versão atual", () => {
  const d = describePython(probe({ version: "3.14.1", modules: [], core: false }), "darwin");
  assert.equal(d.ok, false);
  assert.match(d.hint ?? "", /teto é o 3\.12/);
  assert.match(d.hint ?? "", /3\.14\.1/);
});

test("python do Xcode CLT é reconhecido por nome, e SÓ no macOS", () => {
  const clt = probe({ executable: "/usr/bin/python3", version: "3.9.6", modules: [], core: false });
  const mac = describePython(clt, "darwin");
  assert.equal(mac.ok, false);
  assert.match(mac.hint ?? "", /Command Line Tools/);
  // Em Linux /usr/bin/python3 é o Python legítimo da distro — mandar o usuário instalar o Xcode
  // seria conselho absurdo.
  const linux = describePython(clt, "linux");
  assert.doesNotMatch(linux.hint ?? "", /Command Line Tools|Xcode/);
  assert.match(linux.hint ?? "", /faltam/);
});

test("nenhum interpretador: a dica do macOS explica a ausência do binário `python`", () => {
  const mac = describePython(null, "darwin");
  assert.equal(mac.ok, false);
  assert.match(mac.hint ?? "", /não tem binário `python`/);
  const linux = describePython(null, "linux");
  assert.match(linux.hint ?? "", /install:voice/);
});

test("pythonBin nunca devolve string vazia (o spawn precisa de algo para errar com sentido)", async () => {
  resetPythonCache();
  const bin = await pythonBin();
  assert.ok(typeof bin === "string" && bin.length > 0);
  // Em unix o fallback jamais pode ser "python": é exatamente o nome que não existe em macOS e que
  // produzia o ENOENT original.
  if (process.platform !== "win32") assert.notEqual(bin, "python");
});
