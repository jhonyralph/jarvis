/**
 * Listagem de pasta do seletor "Pasta de trabalho" — a MESMA regra no Hub (máquina local) e no Runner
 * (máquina remota), porque quem lista é sempre a máquina dona da sessão.
 *
 * O seletor aceita caminho digitado/colado, então a entrada deixa de ser só o que a própria UI montou:
 *  - aspas em volta saem ("Copiar como caminho" do Explorer entrega assim);
 *  - `~` vira a home DA MÁQUINA QUE LISTA (o navegador não sabe qual é);
 *  - `C:` vira `C:\` — sem a barra, o Node lê o diretório corrente do processo naquele disco;
 *  - caminho relativo é recusado: resolveria contra o cwd do Hub/Runner, que não significa nada para
 *    quem está escolhendo a pasta.
 *
 * Não há restrição de raiz: o `listdir` nunca teve (o acesso é por máquina, `canUseRunner`), e digitar
 * o endereço não alcança nada que a navegação pasta a pasta já não alcançasse.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export interface BrowsePathOpts {
  home?: string;
  platform?: NodeJS.Platform;
}

export type NormalizedBrowsePath = { ok: true; path: string } | { ok: false; error: string };

function pathApi(platform: NodeJS.Platform): typeof posix { return platform === "win32" ? win32 : posix; }

export function normalizeBrowsePath(input: unknown, opts: BrowsePathOpts = {}): NormalizedBrowsePath {
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  const P = pathApi(platform);
  let s = typeof input === "string" ? input.trim() : "";
  if (s.length >= 2 && ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'")))) s = s.slice(1, -1).trim();
  if (!s) return { ok: true, path: home };
  if (s === "~") s = home;
  else if (s.startsWith("~/") || (platform === "win32" && s.startsWith("~\\"))) s = P.join(home, s.slice(2));
  if (platform === "win32" && /^[a-zA-Z]:$/.test(s)) s += "\\";
  if (!P.isAbsolute(s)) {
    return { ok: false, error: `use um caminho absoluto (ex.: ${platform === "win32" ? "C:\\projetos" : "/home/voce/projetos"} ou ~/projetos)` };
  }
  let out = P.normalize(s);
  const root = P.parse(out).root;
  while (out.length > root.length && /[\\/]$/.test(out)) out = out.slice(0, -1);
  return { ok: true, path: out };
}

/** Discos do Windows que existem agora. `existsSync` num mapeamento de rede desconectado pode levar
 *  alguns segundos — por isso só é chamado quando o seletor está na raiz de um disco. */
export function listWindowsDrives(): string[] {
  const drives: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const d = `${String.fromCharCode(c)}:\\`;
    try { if (existsSync(d)) drives.push(d); } catch { /* disco indisponível: só não aparece */ }
  }
  return drives;
}

export interface DirListing {
  path: string;
  parent: string;
  entries: string[];
  files?: string[];
  /** Só no Windows, na raiz de um disco: é por aqui que se troca de `C:\` para `D:\`. */
  drives?: string[];
  /** Mensagem para mostrar NO seletor (não no chat). Com erro, `entries` vem vazio. */
  error?: string;
}

function describeError(e: any, path: string): string {
  const code = String(e?.code || "");
  if (code === "ENOENT") return `pasta não encontrada: ${path}`;
  if (code === "ENOTDIR") return `não é uma pasta: ${path}`;
  if (code === "EACCES" || code === "EPERM") return `sem permissão para ler: ${path}`;
  return `não foi possível ler a pasta: ${String(e?.message ?? e)}`;
}

export function listDirectory(input: unknown, opts: BrowsePathOpts & { files?: boolean; drives?: () => string[] } = {}): DirListing {
  const platform = opts.platform ?? process.platform;
  const P = pathApi(platform);
  const norm = normalizeBrowsePath(input, opts);
  if (!norm.ok) {
    const raw = typeof input === "string" ? input.trim() : "";
    return { path: raw, parent: raw, entries: [], error: norm.error };
  }
  const path = norm.path;
  const parent = P.dirname(path);
  const atDriveRoot = platform === "win32" && /^[a-zA-Z]:\\$/.test(path);
  const drives = atDriveRoot ? (opts.drives ?? listWindowsDrives)() : undefined;
  try {
    const all = readdirSync(path, { withFileTypes: true });
    const byName = (a: string, b: string): number => a.localeCompare(b);
    const entries = all.filter((e) => e.isDirectory()).map((e) => e.name).sort(byName);
    // `files` só quando o cliente pede — o seletor de pasta não pede e segue vendo só pastas; a árvore
    // de arquivos (Orca #1) pede e recebe os dois.
    const files = opts.files ? all.filter((e) => e.isFile()).map((e) => e.name).sort(byName) : undefined;
    return { path, parent, entries, ...(files ? { files } : {}), ...(drives ? { drives } : {}) };
  } catch (e) {
    return { path, parent, entries: [], error: describeError(e, path), ...(drives ? { drives } : {}) };
  }
}
