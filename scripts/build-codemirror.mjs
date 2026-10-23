#!/usr/bin/env node
// Gera o bundle do CodeMirror 6 vendorizado do editor leve (BRW-IDE-00 F3).
//
//   node scripts/build-codemirror.mjs            # build reprodutível (npm ci a partir do lock)
//   node scripts/build-codemirror.mjs --keep     # mantém a pasta temporária (depurar)
//
// Por que fora do repositório: o node_modules do repo é compartilhado (worktrees ligadas por
// junction) e o app web não tem build. Então NADA é instalado aqui: o script cria uma pasta
// temporária no %TEMP%/$TMPDIR, copia scripts/codemirror/{package.json,package-lock.json,entry.js},
// roda `npm ci` + esbuild LÁ, e traz de volta só o resultado:
//   apps/hub/web/vendor/codemirror/codemirror.js            (IIFE minificado → window.JarvisCM)
//   apps/hub/web/vendor/codemirror/THIRD_PARTY_LICENSES.txt (MIT de cada pacote embutido)
// As versões ficam fixadas em scripts/codemirror/package.json + package-lock.json. Para atualizar:
// mude as versões, rode com `--update-lock` (usa `npm install` e copia o lock novo de volta) e
// confira o bundle no navegador.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "scripts", "codemirror");
const outDir = join(root, "apps", "hub", "web", "vendor", "codemirror");
const keep = process.argv.includes("--keep");
const updateLock = process.argv.includes("--update-lock");

const scratch = mkdtempSync(join(tmpdir(), "jarvis-cm-build-"));
console.log(`[cm] pasta temporária: ${scratch}`);
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: scratch, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} falhou (${r.status})`);
};
try {
  for (const f of ["package.json", "entry.js"]) cpSync(join(src, f), join(scratch, f));
  const lock = join(src, "package-lock.json");
  if (existsSync(lock) && !updateLock) { cpSync(lock, join(scratch, "package-lock.json")); run("npm", ["ci", "--no-audit", "--no-fund"]); }
  else { run("npm", ["install", "--no-audit", "--no-fund"]); cpSync(join(scratch, "package-lock.json"), lock); console.log("[cm] lock atualizado"); }

  const pkg = JSON.parse(readFileSync(join(scratch, "package.json"), "utf8"));
  const pins = Object.entries(pkg.dependencies).filter(([n]) => n !== "esbuild").map(([n, v]) => `${n}@${v}`).join(", ");
  const banner = `/*! Jarvis — CodeMirror 6 (MIT) vendorizado para o editor leve. Gerado por scripts/build-codemirror.mjs. Pacotes: ${pins}. Licenças: THIRD_PARTY_LICENSES.txt */`;
  const esbuild = (await import(new URL(`file:///${join(scratch, "node_modules", "esbuild", "lib", "main.js").replace(/\\/g, "/")}`).href)).default;
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "codemirror.js");
  await esbuild.build({
    entryPoints: [join(scratch, "entry.js")], bundle: true, format: "iife", minify: true, target: "es2020",
    legalComments: "none", banner: { js: banner }, outfile: outFile, logLevel: "info",
  });
  // O serviço do esbuild é um processo filho (esbuild.exe) que segura o binário aberto: sem parar,
  // a faxina da pasta temporária falha com EPERM no Windows.
  await esbuild.stop?.();
  // O placeholder "__BUILD__" está entre aspas na entrada: troca pelo resumo das versões.
  writeFileSync(outFile, readFileSync(outFile, "utf8").replace(/"__BUILD__"/g, JSON.stringify(pins)));

  // Licenças de TODO pacote que entrou no bundle (diretos e transitivos), menos o esbuild.
  const mods = join(scratch, "node_modules");
  const seen = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      if (name.startsWith("@")) { visit(p); continue; }
      if (name === "esbuild" || p.includes("@esbuild")) continue;
      const pj = join(p, "package.json"); if (!existsSync(pj)) continue;
      const meta = JSON.parse(readFileSync(pj, "utf8"));
      const lic = readdirSync(p).find((f) => /^licen[sc]e/i.test(f));
      seen.push(`==== ${meta.name}@${meta.version} (${meta.license || "?"}) ====\n${lic ? readFileSync(join(p, lic), "utf8").trim() : "(sem arquivo de licença no pacote)"}\n`);
    }
  };
  visit(mods);
  writeFileSync(join(outDir, "THIRD_PARTY_LICENSES.txt"), seen.sort().join("\n"));
  const kb = (statSync(outFile).size / 1024).toFixed(1);
  console.log(`[cm] ok: ${outFile} (${kb} KB), ${seen.length} licenças`);
} finally {
  if (keep) console.log(`[cm] mantida: ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
