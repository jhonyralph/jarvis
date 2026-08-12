/**
 * Ler um pacote de framework direto de uma PASTA da máquina.
 *
 * Por que existe: os dois caminhos de importação que havia eram zip (upload) e GitHub (repositório
 * público). Um framework que vive só como pasta local — sem remote, ou privado — não tinha como
 * entrar; e o zip não aceita subpasta, o que inviabiliza publicar um repositório como VÁRIOS pacotes
 * (um por perfil de stack, cada um com seu `jarvis.pack.json`). Apontar para a pasta resolve os dois
 * casos e, principalmente, torna a reimportação repetível: mudou o framework, importa de novo.
 *
 * Devolve `ArchiveEntry[]` de propósito: daqui para frente é exatamente o mesmo caminho do zip —
 * `extractFrameworkFiles` (projeção, promoção, limites) → prévia → varredura → conformidade. Nenhuma
 * regra de confiança nova; a fronteira continua sendo uma só.
 */
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";
import { MAX_ENTRIES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, type ArchiveEntry } from "./framework-archive.js";

/** Pastas que nunca são conteúdo de framework — ferramental, dependência ou saída de build. Sem isto
 *  uma varredura de repositório levaria `node_modules` e `.git` inteiros no limite de arquivos. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "__pycache__", "venv", ".venv", "target", "vendor"]);

export interface ReadPackDirResult {
  entries: ArchiveEntry[];
  /** caminhos ignorados por limite ou leitura falha, com o motivo — nunca sumiço mudo. */
  skipped: string[];
  /** true quando a varredura parou por bater num teto (o que entrou é um recorte, não o todo). */
  truncated: boolean;
}

/**
 * Varre `root` recursivamente. Aplica os MESMOS tetos do leitor de zip, para que uma pasta não seja
 * uma porta larga em volta dos limites que protegem o pacote.
 *
 * Pasta oculta (começada por `.`) é pulada — mesma regra do resto do importador: `.git` e `.github`
 * são ferramental, não framework. A exceção é o próprio `jarvis.pack.json`, que fica na raiz.
 */
export function readPackDir(root: string, opts: { maxEntries?: number } = {}): ReadPackDirResult {
  const base = resolve(root);
  const st = statSync(base);                                  // deixa estourar: pasta inexistente é erro do chamador
  if (!st.isDirectory()) throw new Error(`não é uma pasta: ${base}`);

  const entries: ArchiveEntry[] = [];
  const skipped: string[] = [];
  const maxEntries = Math.max(1, opts.maxEntries ?? MAX_ENTRIES);
  let total = 0;
  let truncated = false;

  const walk = (dir: string, rel: string): void => {
    if (truncated) return;
    let items: Dirent[];
    try { items = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }); }
    catch { skipped.push(`${rel || "."} (pasta ilegível)`); return; }

    for (const item of items) {
      if (truncated) return;
      const name = item.name;
      if (name.startsWith(".")) continue;                     // ferramental, não conteúdo
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = join(dir, name);

      if (item.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(childAbs, childRel);
        continue;
      }
      if (!item.isFile()) continue;                           // link/socket/dispositivo não entra

      let size = 0;
      try { size = statSync(childAbs).size; } catch { skipped.push(`${childRel} (ilegível)`); continue; }
      if (size > MAX_FILE_BYTES) { skipped.push(`${childRel} (excede ${MAX_FILE_BYTES} bytes)`); continue; }
      if (total + size > MAX_TOTAL_BYTES) { skipped.push(`${childRel} (excede o total permitido do pacote)`); continue; }
      if (entries.length >= maxEntries) { truncated = true; skipped.push(`varredura interrompida em ${maxEntries} arquivos`); return; }

      let data: Buffer;
      try { data = readFileSync(childAbs); } catch { skipped.push(`${childRel} (ilegível)`); continue; }
      total += data.length;
      entries.push({ path: childRel, data });
    }
  };

  walk(base, "");
  // Ordem estável: o mesmo conteúdo em disco tem de gerar sempre o mesmo pacote (e o mesmo hash de
  // origem), independentemente da ordem em que o sistema de arquivos devolveu as entradas.
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, skipped, truncated };
}

/** Rótulo curto da pasta, usado como nome da fonte quando o pacote não traz manifesto. */
export function packDirLabel(root: string): string {
  const parts = resolve(root).replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || resolve(root);
}
