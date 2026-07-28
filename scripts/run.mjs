// Dispatcher único dos scripts operacionais: um mesmo comando funciona em Windows, macOS e Linux.
//
// Por que existe: cada ação tem duas implementações (.ps1 e .sh) e, até aqui, quem instalava
// precisava saber qual invocar e com qual sintaxe (`powershell -ExecutionPolicy Bypass -File ...`
// vs `sh ...`). Isso vazava detalhe de SO para o README, para a doc e para a memória de quem opera.
// Aqui o SO é detectado uma vez e o npm script fica igual nos três: `npm run setup`, `npm run doctor`…
//
// Node é a única dependência — e ele já é obrigatório para rodar o Jarvis, então não adiciona nada.
//
// Uso:  node scripts/run.mjs <ação> [args...]
//       node scripts/run.mjs --list

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const IS_WIN = process.platform === "win32";

// Cada ação aponta para o script de cada plataforma. `null` = não existe naquele SO (a mensagem de
// erro diz o que fazer em vez de falhar com "arquivo não encontrado").
const ACTIONS = {
  setup: { win: "jarvis-setup.ps1", unix: "jarvis-setup.sh", help: "instalação guiada (deps, config, autostart, claim code)" },
  doctor: { win: "jarvis-doctor.ps1", unix: "jarvis-doctor.sh", help: "diagnóstico do ambiente (somente leitura)" },
  // No Windows quem registra o Hub como serviço é o install-autostart (tarefa agendada JarvisHub);
  // no Unix o papel equivalente é do install-hub.
  "install-hub": { win: "install-autostart.ps1", unix: "install-hub.sh", help: "instala esta máquina como Hub (autostart)" },
  "install-runner": { win: "install-runner.ps1", unix: "install-runner.sh", help: "instala esta máquina como runner" },
  "install-desktop": { win: "install-desktop.ps1", unix: "install-desktop.sh", help: "instala/roda o cliente desktop (Electron)" },
  "build-android": { node: "build-mobile.mjs", nodeArgs: ["android"], help: "gera APK Android debug do app mobile" },
  "build-android-release": { node: "build-mobile.mjs", nodeArgs: ["android-release"], help: "gera APK Android release (requer signing config)" },
  "build-aab": { node: "build-mobile.mjs", nodeArgs: ["aab"], help: "gera Android App Bundle release (Play Store)" },
  "build-ios": { node: "build-mobile.mjs", nodeArgs: ["ios"], help: "prepara/abre build iOS no macOS; -- --archive tenta archive Xcode" },
  "build-apple": { node: "build-mobile.mjs", nodeArgs: ["apple"], help: "alias de build-ios para Apple/iOS" },
  "start-hub": { win: "start-hub.ps1", unix: "start-hub.sh", help: "sobe o Hub em foreground" },
  "start-runner": { win: "start-runner.ps1", unix: "start-runner.sh", help: "sobe o runner em foreground" },
  "restart-hub": { win: "restart-hub.ps1", unix: null, help: "reinicia o Hub (Windows: tarefa agendada)" },
  "uninstall-autostart": { win: "uninstall-autostart.ps1", unix: null, help: "remove o autostart (Windows)" },
  pack: { win: "pack.ps1", unix: "pack.sh", help: "gera o tarball offline" },
  release: { win: "release.ps1", unix: "release.sh", help: "corta release manual (o automático é o CI)" },
  jarvis: { win: "jarvis.ps1", unix: "jarvis.sh", help: "CLI de administração (update, status…)" },
};

function list() {
  const width = Math.max(...Object.keys(ACTIONS).map((k) => k.length));
  console.log("\nAções disponíveis (node scripts/run.mjs <ação> [args]):\n");
  for (const [name, spec] of Object.entries(ACTIONS)) {
    const only = spec.node ? "" : !spec.win ? "  (só Unix)" : !spec.unix ? "  (só Windows)" : "";
    console.log(`  ${name.padEnd(width)}  ${spec.help}${only}`);
  }
  console.log("");
}

const [action, ...args] = process.argv.slice(2);
if (!action || action === "--list" || action === "-l" || action === "--help") { list(); process.exit(action ? 0 : 1); }

const spec = ACTIONS[action];
if (!spec) { console.error(`ação desconhecida: ${action}`); list(); process.exit(1); }

if (spec.node) {
  const path = join(SCRIPTS, spec.node);
  if (!existsSync(path)) { console.error(`script não encontrado: ${path}`); process.exit(1); }
  const child = spawn(process.execPath, [path, ...(spec.nodeArgs || []), ...args], { stdio: "inherit", cwd: join(SCRIPTS, "..") });
  child.on("error", (error) => { console.error(`falha ao executar ${spec.node}: ${error.message}`); process.exit(1); });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
} else {
  const file = IS_WIN ? spec.win : spec.unix;
  if (!file) {
    console.error(`\n"${action}" não existe em ${process.platform}: ${spec.help}\n` +
      (IS_WIN ? "" : "  (esta ação é específica do Windows)\n"));
    process.exit(1);
  }

  const path = join(SCRIPTS, file);
  if (!existsSync(path)) { console.error(`script não encontrado: ${path}`); process.exit(1); }

  // Shell certo para cada script: PowerShell no Windows; no Unix respeitamos o shebang (alguns scripts
  // pedem bash de verdade, outros sh POSIX) — chamar sh num script bash quebraria em sintaxe válida.
  let cmd, cmdArgs;
  if (IS_WIN) {
    cmd = "powershell.exe";
    cmdArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path, ...args];
  } else {
    let shebang = "";
    try { shebang = readFileSync(path, "utf8").split("\n", 1)[0]; } catch { /* usa o padrão */ }
    cmd = /\bbash\b/.test(shebang) ? "bash" : "sh";
    cmdArgs = [path, ...args];
  }

  const child = spawn(cmd, cmdArgs, { stdio: "inherit", cwd: join(SCRIPTS, "..") });
  child.on("error", (error) => { console.error(`falha ao executar ${file}: ${error.message}`); process.exit(1); });
  // Propaga o código de saída — um `npm run doctor` que falhou precisa falhar de verdade (CI/scripts).
  child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
}
