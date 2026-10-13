/**
 * Resolução do interpretador Python — uma só, compartilhada pelas quatro pontes de voz
 * (stt.ts, tts.ts, speaker.ts, embed.ts).
 *
 * Por que existe: as pontes faziam `process.env.JARVIS_PYTHON || "python"`. Em macOS NÃO existe
 * binário `python` — a Apple removeu o Python 2 do sistema e nunca criou o alias —, então as quatro
 * pontes morriam com `spawn python ENOENT` já no pré-aquecimento do boot:
 *
 *     [stt] pré-aquecimento falhou (seguirá sob demanda no 1º uso): spawn python ENOENT
 *     [tts] pré-aquecimento falhou (seguirá sob demanda no 1º uso): spawn python ENOENT
 *
 * Voz inteira morta num Mac, com uma mensagem que não aponta a causa. Trocar o literal por
 * "python3" consertaria o ENOENT e criaria dois problemas piores:
 *
 *  1. `/usr/bin/python3` existe em todo Mac e é o 3.9.6 do Xcode Command Line Tools — abaixo do
 *     piso 3.10 da stack de voz e sem nenhuma das dependências. Resolver para ele dá
 *     "ModuleNotFoundError: piper" em vez de ENOENT: o mesmo buraco com outro nome.
 *  2. Sob launchd o PATH é só `/usr/bin:/bin:/usr/sbin:/sbin` (ver install-hub.sh), então um nome
 *     relativo encontra EXATAMENTE esse 3.9.6 e nunca o Python que o dono instalou. O prefixo do
 *     Homebrew ainda muda por arquitetura: /usr/local no Intel, /opt/homebrew no Apple Silicon.
 *
 * Daí a escolha: candidatos ABSOLUTOS, em ordem de preferência, validados por sondagem real do
 * interpretador (quais módulos de voz ele tem), com o resultado cacheado no processo.
 *
 * A sondagem é ASSÍNCRONA. A primeira versão disto usava spawnSync e congelava o event loop por
 * ~1,2 s (medido: 4 interpretadores sondados), com a porta do Hub JÁ ABERTA — ou seja, o Hub
 * aceitava conexões e não respondia nenhuma. Num servidor isso é inaceitável, e as quatro pontes
 * já viviam dentro de funções que devolvem Promise, então esperar não custou nada de arquitetura.
 *
 * `JARVIS_PYTHON` tem a palavra FINAL: se estiver definido e o interpretador executar, é ele, mesmo
 * sem os módulos — quem escolheu à mão merece ver o erro da sua escolha, não uma troca silenciosa.
 * Grave-o em ~/.jarvis/hub.env, que o start-hub.sh já exporta antes de subir o Hub (`set -a`).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const pExecFile = promisify(execFile);

/**
 * Módulos que os daemons DO HUB exigem: piper_service.py importa `piper` e whisper_service.py
 * importa `faster_whisper`. É este o conjunto que decide se vale subir o pré-aquecimento.
 *
 * `openwakeword` ficou DE FORA de propósito: quem o importa é services/voice/wake_listener.py, um
 * processo separado que o Hub nunca lança. Exigi-lo aqui fazia o warmup de STT/TTS ser pulado numa
 * máquina onde os dois funcionam perfeitamente — e o boot anunciar "voz indisponível" por causa de
 * um módulo que nenhum dos dois daemons carrega.
 */
const CORE_MODULES = ["piper", "faster_whisper"] as const;
/** Wake word: processo separado (wake_listener.py). Reportado, nunca exigido. */
const WAKE_MODULE = "openwakeword";
/** Identificação de voz e memória semântica. Dependem de torch, que tem teto em Mac Intel. */
const OPTIONAL_MODULES = ["torch", "resemblyzer", "sentence_transformers"] as const;

/** Teto por candidato. Era 20 s; com 14 candidatos o pior caso era absurdo. */
const PROBE_TIMEOUT_MS = 8_000;

export interface PythonProbe {
  /** Caminho que o próprio interpretador reporta (sys.executable), não o que tentamos spawnar. */
  executable: string;
  /** Como ele foi invocado — é isto que vai no spawn(). */
  command: string;
  version: string;
  /** platform.machine() do INTERPRETADOR: num Mac Intel tem de ser x86_64 (ver o aviso do doctor). */
  machine: string;
  modules: string[];
  /** Tem piper + faster_whisper, os dois que os daemons do Hub carregam? */
  core: boolean;
  /** Veio de JARVIS_PYTHON? Então foi escolha explícita e não é substituível. */
  fromEnv: boolean;
}

/**
 * Sonda barata: `find_spec` em vez de `import`. Importar faster_whisper puxa ctranslate2 e custa
 * segundos; para ESCOLHER o interpretador basta saber que o módulo está instalado. Quebra de ABI
 * (o caso torch 2.2.2 + NumPy 2.x em Mac Intel) é problema de diagnóstico, não de escolha — quem
 * importa de verdade é o doctor, e o serviço reporta o erro quando acontece.
 */
const PROBE = [
  "import sys, platform, importlib.util as u",
  `mods = [m for m in ${JSON.stringify([...CORE_MODULES, WAKE_MODULE, ...OPTIONAL_MODULES])} if u.find_spec(m)]`,
  'print("|".join([sys.executable, ".".join(map(str, sys.version_info[:3])), platform.machine(), ",".join(mods)]))',
].join("\n");

async function probe(command: string, fromEnv: boolean): Promise<PythonProbe | null> {
  let stdout: string;
  try {
    // execFile sem shell: o `command` pode ser um caminho com espaço sem precisar de citação, e
    // nada do PATH é reinterpretado. Rejeita em ENOENT, em falta de permissão de execução, em
    // binário de outra arquitetura e em status != 0 — todos querem o mesmo tratamento: "não serve".
    ({ stdout } = await pExecFile(command, ["-c", PROBE], { timeout: PROBE_TIMEOUT_MS, windowsHide: true }));
  } catch {
    return null;
  }
  const [executable, version, machine, mods] = String(stdout || "").trim().split("|");
  if (!executable || !version) return null;
  const modules = (mods || "").split(",").filter(Boolean);
  return {
    executable,
    command,
    version,
    machine: machine || "",
    modules,
    core: CORE_MODULES.every((m) => modules.includes(m)),
    fromEnv,
  };
}

export function pythonCandidates(platform: string = process.platform, fromEnvOverride?: string): string[] {
  return candidates(platform, fromEnvOverride);
}

/**
 * Candidatos em ordem de preferência. Absolutos primeiro: sob launchd/systemd o PATH é pobre, e um
 * nome relativo acha o Python errado (ou nenhum).
 *
 * No macOS `/usr/bin/python3` fica DELIBERADAMENTE por último: ele sempre existe, então colocá-lo
 * mais acima faria a busca parar nele e nunca chegar ao Python que o dono instalou. Ele continua na
 * lista porque, quando é o único, nomeá-lo é o que torna o erro legível.
 */
function candidates(platform: string = process.platform, fromEnvOverride?: string): string[] {
  const fromEnv = (fromEnvOverride ?? process.env.JARVIS_PYTHON)?.trim();
  const out: string[] = fromEnv ? [fromEnv] : [];
  if (platform === "win32") {
    // No Windows o `python3` é o stub da Microsoft Store (abre a loja em vez de rodar), por isso
    // `python` vem primeiro — é o inverso do unix, e de propósito.
    out.push("python", "python3", "py");
    return out;
  }
  if (platform === "darwin") {
    // 3.12 é o TETO em Mac Intel: torch (via resemblyzer) não publica wheel macOS x86_64 desde a
    // 2.2.2, que cobre até cp312, e onnxruntime (via openwakeword) parou o x86_64 na 1.23.2. Por
    // isso a varredura prefere 3.12 → 3.11 → 3.10 em vez do `python3` genérico, que num Mac novo
    // pode ser 3.13/3.14 e não resolve nenhuma das duas.
    const versions = ["3.12", "3.11", "3.10"];
    // /usr/local = Homebrew no Intel; /opt/homebrew = Homebrew no Apple Silicon. Os dois entram
    // sempre: a máquina pode ter o Node por pkg/nvm e as deps por brew, em qualquer combinação.
    for (const prefix of ["/usr/local/bin", "/opt/homebrew/bin"]) {
      for (const v of versions) out.push(`${prefix}/python${v}`);
    }
    // Instalador oficial do python.org (o caminho realista num Mac Intel, onde o Homebrew trata
    // x86_64 como Tier 3).
    for (const v of versions) out.push(`/Library/Frameworks/Python.framework/Versions/${v}/bin/python3`);
    for (const prefix of ["/usr/local/bin", "/opt/homebrew/bin"]) out.push(`${prefix}/python3`);
    out.push("python3", "python"); // PATH do shell interativo, quando o Hub não roda sob launchd
    out.push("/usr/bin/python3");  // 3.9.6 do CLT — último recurso, só para o erro ter nome
    return out;
  }
  // Linux: sem varredura absoluta. Distribuição nenhuma concorda sobre onde mora um Python
  // alternativo (/usr/bin, /usr/local/bin, pyenv, conda, venv), e chutar caminhos geraria sondagem
  // à toa. Em Linux o jeito de apontar um interpretador específico é JARVIS_PYTHON — é o que a
  // documentação manda, e o install-voice.sh grava a linha.
  out.push("python3", "python");
  return out;
}

let resolved: PythonProbe | null | undefined;
let resolving: Promise<PythonProbe | null> | null = null;

/**
 * O interpretador escolhido, ou `null` quando nenhum candidato roda. Cacheado: a sondagem acontece
 * uma vez por processo, e chamadas concorrentes compartilham a MESMA promessa (quatro pontes subindo
 * ao mesmo tempo no boot não devem sondar quatro vezes).
 *
 * Preferência: JARVIS_PYTHON, se executar, ganha sempre. Depois, o primeiro candidato com os
 * módulos do núcleo. Se nenhum tem, o primeiro que ao menos EXECUTA — para a mensagem de erro citar
 * um caminho real em vez de um nome.
 */
export function resolvePython(): Promise<PythonProbe | null> {
  if (resolved !== undefined) return Promise.resolve(resolved);
  resolving ??= (async () => {
    const list = candidates();
    const envCandidate = process.env.JARVIS_PYTHON?.trim();
    let fallback: PythonProbe | null = null;
    for (const c of list) {
      // Caminho absoluto inexistente: pula sem pagar o spawn. Nomes relativos vão para o execFile,
      // que é quem sabe consultar o PATH.
      if ((c.startsWith("/") || /^[A-Za-z]:[\\/]/.test(c)) && !existsSync(c)) continue;
      const fromEnv = !!envCandidate && c === envCandidate;
      const p = await probe(c, fromEnv);
      if (!p) continue;
      // Escolha explícita do dono vence mesmo sem os módulos: trocar por outro interpretador em
      // silêncio é pior que falhar no que ele pediu — e no Windows, onde os candidatos são
      // python/python3/py, a troca silenciosa mudaria de site-packages sem nada no log.
      if (p.fromEnv) return p;
      if (p.core) return p;
      fallback ??= p;
    }
    return fallback;
  })().then((p) => {
    resolved = p;
    resolving = null;
    return p;
  });
  return resolving;
}

/** O comando a passar para `spawn`. Espera a resolução; nunca bloqueia o event loop. */
export async function pythonBin(): Promise<string> {
  const p = await resolvePython();
  // O fallback jamais é "python" em unix: é exatamente o nome que não existe em macOS e que
  // produzia o ENOENT original.
  return p?.command || process.env.JARVIS_PYTHON || (process.platform === "win32" ? "python" : "python3");
}

/** Esquece o resultado — para testes e para o doctor reavaliar depois de uma instalação. */
export function resetPythonCache(): void {
  resolved = undefined;
  resolving = null;
}

/**
 * Uma linha dizendo o que foi escolhido e, quando a voz não vai funcionar, POR QUE — com o
 * caminho absoluto e o que fazer. É o que o boot loga e o que o doctor imprime.
 */
export async function pythonDiagnostics(): Promise<{ ok: boolean; line: string; hint?: string }> {
  return describePython(await resolvePython());
}

/**
 * A mensagem, separada da resolução para ser testável sem sondar interpretadores de verdade.
 * É aqui que vive o conhecimento específico de Mac Intel — e é o que o boot do Hub, o doctor e o
 * install-voice imprimem.
 */
export function describePython(
  p: PythonProbe | null,
  platform: string = process.platform,
): { ok: boolean; line: string; hint?: string } {
  if (!p) {
    return {
      ok: false,
      line: "Python não encontrado em nenhum candidato.",
      hint: platform === "darwin"
        ? "macOS não tem binário `python`, e o `python3` do sistema é o 3.9.6 do Xcode CLT — abaixo do piso 3.10 da stack de voz. Instale o Python 3.12 (python.org ou brew) e, se preciso, grave JARVIS_PYTHON=/caminho/para/python3.12 em ~/.jarvis/hub.env."
        : "Instale o Python 3.10-3.12 e rode `npm run install:voice`.",
    };
  }
  const [major, minor] = p.version.split(".").map(Number);
  const intelMac = platform === "darwin" && p.machine === "x86_64";
  const missing = CORE_MODULES.filter((m) => !p.modules.includes(m));
  const line = `${p.executable} (${p.version}, ${p.machine || "?"})${p.fromEnv ? " [JARVIS_PYTHON]" : ""} módulos [${p.modules.join(", ") || "nenhum"}]`;
  if (p.core) {
    // Núcleo ok. O que ainda pode faltar é o wake word (processo separado) e o ramo do torch, que
    // em Mac Intel tem teto de verdade. Dizer isso aqui evita que "identificação de voz não
    // funciona" seja investigado como bug.
    const faltas: string[] = [];
    if (!p.modules.includes(WAKE_MODULE)) faltas.push("wake word (openwakeword)");
    if (!p.modules.includes("torch")) {
      faltas.push(intelMac
        ? "identificação de voz e memória semântica (torch não publica wheel macOS x86_64 desde a 2.2.2, cujo teto é o cp312 — use Python 3.10-3.12)"
        : "identificação de voz e memória semântica (torch)");
    }
    if (faltas.length) return { ok: true, line, hint: `indisponível: ${faltas.join("; ")}. Rode \`npm run install:voice\`.` };
    return { ok: true, line };
  }
  if (platform === "darwin" && (p.executable.includes("/CommandLineTools/") || p.executable === "/usr/bin/python3")) {
    return { ok: false, line, hint: "esse é o Python 3.9 do Xcode Command Line Tools, abaixo do piso 3.10 da stack de voz; instalar nele só suja ~/Library/Python/3.9 e não resolve. Instale o Python 3.12 e aponte JARVIS_PYTHON para ele em ~/.jarvis/hub.env." };
  }
  if (intelMac && major === 3 && minor >= 13) {
    return { ok: false, line, hint: `voz indisponível neste Python: num Mac Intel o onnxruntime (openwakeword) não tem wheel x86_64 acima da 1.23.2 e nenhuma delas cobre cp3${minor} — o teto é o 3.12, e você está no ${p.version}. Instale o 3.12 e aponte JARVIS_PYTHON para ele.` };
  }
  return { ok: false, line, hint: `faltam [${missing.join(", ")}] — rode \`npm run install:voice\`.` };
}

// Executável direto (`node --import tsx apps/hub/src/python.ts`) para o jarvis-doctor.sh e os
// instaladores não reimplementarem esta busca em shell e divergirem dela.
//   sem flag → diagnóstico legível (linha + dica); sai 1 quando a voz não tem como funcionar.
//   --path   → só o comando resolvido, e SÓ quando ele tem os módulos do núcleo. Sem isso o
//              install-hub.sh fixava em JARVIS_PYTHON o primeiro interpretador que meramente
//              executa (aqui: um 3.14 sem nenhum módulo) e o install-voice.sh não conseguia mais
//              corrigir o pin.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const run = async () => {
    if (process.argv.includes("--path")) {
      const p = await resolvePython();
      if (p?.core) { console.log(p.executable || p.command); process.exit(0); }
      process.exit(1);
    }
    const d = await pythonDiagnostics();
    console.log(d.line);
    if (d.hint) console.log(d.hint);
    process.exit(d.ok ? 0 : 1);
  };
  void run();
}
