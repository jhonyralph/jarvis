// Mantém desktop/package.json na MESMA versão do package.json raiz durante um release.
//
// Por que existe: o Hub/runner leem a versão do package.json raiz (@jarvis/core VERSION), mas o
// electron-builder e o electron-updater leem a de desktop/package.json — que fica FORA do workspace
// npm, então o bump do semantic-release não a alcança. Sem isto o app desktop ficaria eternamente
// em 0.1.0 e o auto-update nunca veria uma versão nova.
//
// Uso: node scripts/sync-desktop-version.mjs 1.2.3
//      (chamado pelo prepareCmd do @semantic-release/exec; também serve manualmente)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-.+)?$/.test(version)) {
  console.error(`versão inválida: ${version || "(vazia)"} — use semver, ex. 1.2.3`);
  process.exit(1);
}

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(repo, "desktop", "package.json");

const raw = readFileSync(file, "utf8");
// Substituição cirúrgica no texto (em vez de JSON.parse + stringify) para preservar formatação,
// ordem das chaves e o newline final — o arquivo é versionado e não deve virar um diff gigante.
const next = raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
if (next === raw) {
  console.error(`não encontrei o campo "version" em ${file}`);
  process.exit(1);
}
writeFileSync(file, next);
console.log(`desktop/package.json -> ${version}`);
