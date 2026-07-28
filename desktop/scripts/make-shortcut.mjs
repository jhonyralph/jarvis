// Cria o atalho do Jarvis no lançador do SO apontando para ESTE checkout.
//
// Por que existe: rodar a partir do código (`npm start`) não deixa nada no menu do sistema — só o
// instalador empacotado (NSIS/deb) cria atalho, e buildar só para ter um ícone clicável é
// desproporcional. Aqui o `install:desktop` termina com o app encontrável: tecla Windows / Spotlight
// / menu de aplicativos → "Jarvis" abre.
//
// Aponta para o binário do Electron do próprio checkout, então o atalho sempre roda o código atual
// (o modelo "reload é o deploy" continua valendo — nada para reempacotar ao mudar a UI).
//
// Uso:  node scripts/make-shortcut.mjs           (cria)
//       node scripts/make-shortcut.mjs --remove  (remove)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url))); // desktop/
const REMOVE = process.argv.includes("--remove");
const NAME = "Jarvis";

/** Binário do Electron deste checkout (o `electron` do npm exporta o caminho do executável). */
function electronBinary() {
  try {
    const mod = join(APP_DIR, "node_modules", "electron", "index.js");
    if (!existsSync(mod)) return null;
    // O módulo exporta o caminho como string via module.exports.
    const path = spawnSync(process.execPath, ["-e", `process.stdout.write(require(${JSON.stringify(mod)}))`], { encoding: "utf8" }).stdout?.trim();
    return path && existsSync(path) ? path : null;
  } catch { return null; }
}

const iconPng = join(APP_DIR, "build", "icon.png"); // opcional: sem ele o SO usa o ícone padrão
const bin = electronBinary();
if (!REMOVE && !bin) {
  console.error("Electron não encontrado — rode a instalação das dependências antes de criar o atalho.");
  process.exit(1);
}

function windows() {
  const programs = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs");
  const link = join(programs, `${NAME}.lnk`);
  if (REMOVE) { rmSync(link, { force: true }); return link; }
  mkdirSync(programs, { recursive: true });
  // Aspas SIMPLES do PowerShell (escapando ' como ''), nunca JSON.stringify: a barra invertida do
  // Windows não é escape no PowerShell, então o `\\` que o JSON produz chegaria literal e o `\"`
  // quebraria o parser.
  const psq = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const ico = join(APP_DIR, "build", "icon.ico");
  // WScript.Shell é a forma suportada de escrever um .lnk sem dependência nativa.
  const ps = [
    "$ws = New-Object -ComObject WScript.Shell",
    `$s = $ws.CreateShortcut(${psq(link)})`,
    `$s.TargetPath = ${psq(bin)}`,
    // O caminho vai entre aspas DUPLAS dentro do argumento: o checkout pode ter espaços no caminho.
    `$s.Arguments = ${psq(`"${APP_DIR}"`)}`,
    `$s.WorkingDirectory = ${psq(APP_DIR)}`,
    `$s.Description = ${psq("Jarvis - control plane for coding agents")}`,
    // O ícone do .lnk precisa de .ico/.exe; sem ele o Windows usa o do electron.exe.
    existsSync(ico) ? `$s.IconLocation = ${psq(ico)}` : "",
    "$s.Save()",
  ].filter(Boolean).join("; ");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "falha ao criar o .lnk");
  return link;
}

function macos() {
  // Um .app mínimo em ~/Applications: é o que o Spotlight indexa (um script solto ele ignora).
  const app = join(homedir(), "Applications", `${NAME}.app`);
  if (REMOVE) { rmSync(app, { recursive: true, force: true }); return app; }
  const macDir = join(app, "Contents", "MacOS");
  mkdirSync(macDir, { recursive: true });
  writeFileSync(join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${NAME}</string>
  <key>CFBundleDisplayName</key><string>${NAME}</string>
  <key>CFBundleIdentifier</key><string>chat.jarvis.desktop.dev</string>
  <key>CFBundleExecutable</key><string>${NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
  const launcher = join(macDir, NAME);
  writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(bin)} ${JSON.stringify(APP_DIR)} "$@"\n`);
  chmodSync(launcher, 0o755);
  return app;
}

function linux() {
  const dir = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "applications");
  const file = join(dir, "jarvis.desktop");
  if (REMOVE) { rmSync(file, { force: true }); return file; }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `[Desktop Entry]
Type=Application
Name=${NAME}
Comment=Voice-first control plane for coding agents
Exec=${bin} ${APP_DIR}
Path=${APP_DIR}
${existsSync(iconPng) ? `Icon=${iconPng}` : ""}
Terminal=false
Categories=Development;
Keywords=jarvis;ai;agent;claude;codex;assistant;
StartupWMClass=Jarvis
`.replace(/\n\n/g, "\n"));
  chmodSync(file, 0o755);
  // Atualiza o cache do menu quando a ferramenta existe; sem ela o arquivo já basta na maioria dos DEs.
  spawnSync("update-desktop-database", [dir], { stdio: "ignore" });
  return file;
}

try {
  const target = process.platform === "win32" ? windows() : process.platform === "darwin" ? macos() : linux();
  console.log(`${REMOVE ? "atalho removido" : "atalho criado"}: ${target}`);
  if (!REMOVE && !existsSync(iconPng)) console.log("  (sem build/icon.png — o atalho usa o ícone padrão; gere com: npm run icon)");
} catch (error) {
  console.error(`não foi possível ${REMOVE ? "remover" : "criar"} o atalho: ${error.message}`);
  process.exit(1);
}
