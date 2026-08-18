/**
 * Cache da varredura de tarefas locais (`docs/features/*.md` por padrão).
 *
 * O caminho antigo lia e parseava TODOS os arquivos a cada pedido, no event loop do Hub. Aqui a
 * validade é decidida por uma assinatura barata da pasta — nome + mtime + tamanho de cada `.md`,
 * obtida com `readdir` + `stat`, sem abrir conteúdo. Bate a assinatura, devolve o resultado guardado.
 *
 * Duas regras que valem mais que a economia:
 *  - o cache nunca mente: se a assinatura não puder ser calculada, a entrada é DESCARTADA e o erro
 *    sobe — servir uma lista velha como se fosse atual seria pior do que não ter cache;
 *  - a chave é do chamador (máquina + pasta absoluta), porque a mesma pasta relativa em máquinas
 *    diferentes é outro projeto.
 *
 * Nenhum agente/LLM participa deste caminho, por decisão de produto: listar tarefa não pode consumir
 * crédito. O `fs` é injetável para o teste conseguir CONTAR leituras — a contagem é o critério.
 */
import { join, resolve, sep } from "node:path";

/** Pasta padrão de tarefas locais de quem não usa gerenciador. */
export const DEFAULT_FEATURES_DIR = "docs/features";

/** Resolve a pasta de features de um projeto e CONTÉM o caminho dentro dele.
 *
 *  Vive no core porque Hub e runner precisam da mesma decisão: quando cada lado carregava a sua
 *  cópia, um deles ficava para trás — foi assim que a listagem remota passou a ler o disco do Hub e
 *  devolver as features do projeto errado, em silêncio. Uma função, os dois chamadores.
 *  Lança quando a pasta escapa do projeto (`..`, caminho absoluto de outro lugar). */
export function resolveFeaturesRoot(cwd: string, featuresDir?: string): { rel: string; root: string } {
  const rel = String(featuresDir || DEFAULT_FEATURES_DIR).replace(/\\/g, "/").replace(/\/+$/, "") || DEFAULT_FEATURES_DIR;
  const base = resolve(cwd);
  const root = resolve(base, rel);
  if (root !== base && !root.startsWith(base + sep)) throw new Error("pasta de features fora do projeto");
  return { rel, root };
}

export interface LocalTaskFsLike {
  existsSync(path: string): boolean;
  readdirSync(dir: string): string[];
  statSync(path: string): { mtimeMs: number; size: number };
  readFileSync(path: string, encoding?: "utf8"): string;
}

export interface LocalTaskFile { key: string; title: string; description?: string }
export interface LocalTaskListing { files: LocalTaskFile[]; cached: boolean; scannedAt: number }
export type LocalTaskParse = (content: string, relPath: string) => LocalTaskFile;

export interface LocalTaskListOpts { refresh?: boolean; cap?: number; relPrefix?: string }

interface LocalTaskCacheEntry { signature: string; files: LocalTaskFile[]; scannedAt: number }

/** Teto de arquivos por pasta — o mesmo de antes do cache, mantido para não mudar comportamento. */
export const LOCAL_TASK_FILE_CAP = 100;
/** Quantas pastas ficam guardadas ao mesmo tempo (LRU). */
export const LOCAL_TASK_CACHE_MAX = 20;

function markdownNames(root: string, fs: LocalTaskFsLike, cap: number): string[] {
  return fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".md")).sort().slice(0, cap);
}

/** Assinatura da pasta: `readdir` + `stat`, nunca leitura de conteúdo. Só considera os arquivos que
 *  cabem no teto — mudança em arquivo que jamais entra na lista não pode invalidar o cache. */
export function localTaskSignature(root: string, fs: LocalTaskFsLike, cap = LOCAL_TASK_FILE_CAP): string {
  return markdownNames(root, fs, cap)
    .map((name) => { const stat = fs.statSync(join(root, name)); return `${name}:${stat.mtimeMs}:${stat.size}`; })
    .join("|");
}

export class LocalTaskCache {
  private readonly rows = new Map<string, LocalTaskCacheEntry>();

  constructor(private readonly opts: { now?: () => number; max?: number } = {}) {}

  size(): number { return this.rows.size; }
  clear(key?: string): void { if (key === undefined) this.rows.clear(); else this.rows.delete(key); }

  list(key: string, root: string, parse: LocalTaskParse, fs: LocalTaskFsLike, opts: LocalTaskListOpts = {}): LocalTaskListing {
    const now = this.opts.now || Date.now;
    const cap = opts.cap ?? LOCAL_TASK_FILE_CAP;

    // Pasta ausente é resposta legítima (o projeto pode não usar features locais), mas não vira
    // entrada: guardar "vazio" faria a criação da pasta demorar um pedido a mais para aparecer.
    if (!fs.existsSync(root)) { this.rows.delete(key); return { files: [], cached: false, scannedAt: now() }; }

    let signature: string;
    try { signature = localTaskSignature(root, fs, cap); }
    catch (error) { this.rows.delete(key); throw error; }

    const hit = this.rows.get(key);
    if (!opts.refresh && hit && hit.signature === signature) {
      this.rows.delete(key); this.rows.set(key, hit); // LRU: usar é rejuvenescer
      return { files: hit.files.map((file) => ({ ...file })), cached: true, scannedAt: hit.scannedAt };
    }

    const files: LocalTaskFile[] = [];
    for (const name of markdownNames(root, fs, cap)) {
      const relPath = opts.relPrefix ? `${opts.relPrefix}/${name}` : name;
      try { files.push(parse(fs.readFileSync(join(root, name), "utf8"), relPath)); }
      catch { /* um arquivo ilegível não derruba a lista (comportamento preservado) */ }
    }

    const scannedAt = now();
    this.rows.delete(key);
    this.rows.set(key, { signature, files, scannedAt });
    const max = this.opts.max ?? LOCAL_TASK_CACHE_MAX;
    while (this.rows.size > max) {
      const oldest = this.rows.keys().next().value;
      if (oldest === undefined) break;
      this.rows.delete(oldest);
    }
    return { files: files.map((file) => ({ ...file })), cached: false, scannedAt };
  }
}
