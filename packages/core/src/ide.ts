/**
 * IDE completa por máquina (BRW-IDE-00 F4) — code-server (Coder, MIT) baixado sob demanda, conferido
 * por SHA-256 fixado no código, e executado só em `127.0.0.1` (lei §3.2 da spec).
 *
 * Quem hospeda: o runner de cada máquina e o Hub (para a máquina dele, LOCAL), igual ao browser da F1.
 * Este módulo NÃO sabe de rede nem de auth: quem chega no code-server é o proxy do Hub (direto, para a
 * máquina do Hub; pelo túnel `ide-tunnel.ts`, para as outras), que já checou que é o dono.
 *
 * Decisões (detalhes no §17 da spec):
 * - Versão fixada (4.141.0, a do F0, que é também a última publicada em 2026-10-19). O hash de cada
 *   build vem do campo `digest` da API de releases do GitHub e mora AQUI — um download adulterado,
 *   truncado ou de outra versão é recusado antes de extrair qualquer byte.
 * - Extração com o `tar` do sistema (bsdtar no Windows 10+, GNU/bsdtar em Linux/macOS), num processo
 *   filho: o build tem milhares de arquivos, links simbólicos e bits de execução, e descompactar 644 MB
 *   dentro do processo do Hub disputaria o event loop (INC-01..03). Um leitor de tar próprio teria de
 *   reimplementar nomes longos (PAX/GNU), links e modos — risco sem ganho.
 * - Instalação atômica: baixa para `.download-*.partial`, confere, extrai em `.staging-*` e só então
 *   renomeia para `code-server-<versão>/` (com `.jarvis-install.json` dentro). Pasta presente =
 *   instalação completa; queda no meio deixa só lixo com prefixo `.`, limpo na próxima tentativa.
 * - `HOME`/`USERPROFILE` NÃO são trocados: o terminal integrado precisa do git/ssh/credenciais do
 *   usuário. Efeito colateral aceito e documentado: o code-server cria `~/.vscode-oss-shared`.
 * - Um code-server por máquina, desligado sozinho sem cliente (`idleMs`), pidfile + recolhimento de
 *   órfão pela linha de comando (mesma disciplina do Chrome da F1) e morte por árvore.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { get as httpGet, request as httpRequest } from "node:http";
import { get as httpsGet } from "node:https";
import { createServer } from "node:net";
import { arch as osArch, platform as osPlatform } from "node:os";
import { join } from "node:path";
import type { IdeStateInfo } from "@jarvis/protocol";
import { killProcessTree, killProcessTreeSync, listProcesses } from "./browser.js";

// ===================================================================== versão e builds (puro)

export const CODE_SERVER_VERSION = "4.141.0";

export interface CodeServerAsset {
  /** chave do build (`windows-amd64`, `linux-arm64`…) */
  key: string;
  /** nome do arquivo no release */
  name: string;
  /** bytes do .tar.gz */
  size: number;
  /** SHA-256 em hex — do campo `digest` da API do GitHub (gh api repos/coder/code-server/releases/tags/v4.141.0) */
  sha256: string;
  url: string;
  version: string;
}

const RELEASE = `https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}`;
/** Builds publicados do 4.141.0 (conferidos em 2026-10-19 pela API de releases). */
const ASSETS: Record<string, { size: number; sha256: string }> = {
  "windows-amd64": { size: 218_475_701, sha256: "8dc8beabdaa29218dc23b2aafaa67d9a777fb27006e32778153b16b1be58769b" },
  "macos-amd64": { size: 231_091_669, sha256: "b133e002c2a1a4f22b2ec42c5f233147f342b592e2eadcacc51703a86f447f77" },
  "macos-arm64": { size: 210_608_428, sha256: "ab45ad960725bdcdfb92998ef54feb2f479079224315ce44a4f49c54093453c9" },
  "linux-amd64": { size: 239_926_515, sha256: "65bcd20b524d03eb1b5adb7f360244599ef0e5b74089a46a982d32c074b97a29" },
  "linux-arm64": { size: 234_587_826, sha256: "e5cc78da1d631c6cf6162f9b18eeaa8ee9d3239e1a88bb99d0602cdc5fa1852d" },
};

/** Chave do build para este SO/arquitetura; null = o code-server não publica (ex.: Windows ARM). */
export function codeServerAssetKey(platform: string = osPlatform(), arch: string = osArch()): string | null {
  const a = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : null;
  if (!a) return null;
  if (platform === "win32") return a === "amd64" ? "windows-amd64" : null;
  if (platform === "darwin") return `macos-${a}`;
  if (platform === "linux") return `linux-${a}`;
  return null;
}

export function codeServerAsset(platform: string = osPlatform(), arch: string = osArch()): CodeServerAsset | null {
  const key = codeServerAssetKey(platform, arch);
  const pinned = key ? ASSETS[key] : undefined;
  if (!key || !pinned) return null;
  const name = `code-server-${CODE_SERVER_VERSION}-${key}.tar.gz`;
  return { key, name, size: pinned.size, sha256: pinned.sha256, url: `${RELEASE}/${name}`, version: CODE_SERVER_VERSION };
}

/** Todos os builds fixados (para teste/documentação). */
export function pinnedCodeServerAssets(): CodeServerAsset[] {
  return Object.keys(ASSETS).map((key) => {
    const name = `code-server-${CODE_SERVER_VERSION}-${key}.tar.gz`;
    return { key, name, ...ASSETS[key], url: `${RELEASE}/${name}`, version: CODE_SERVER_VERSION };
  });
}

/** Kill switch: `JARVIS_IDE=0` (ou off/false/no) desliga a capacidade na máquina. Padrão: disponível. */
export function ideDisabledByEnv(env: Record<string, string | undefined> = process.env): boolean {
  return /^(0|off|false|no)$/i.test(String(env.JARVIS_IDE ?? "").trim());
}

/**
 * Pasta no formato que o code-server entende em `?folder=`. No Windows tem de ser URI (`/c:/Users/…`):
 * com `C:\…` ou `C:/…` o Explorer abre a raiz VAZIA (F0, §13.2). Caminho UNC vira `//servidor/…`.
 */
export function codeServerFolderParam(folder: string, os: string): string {
  const f = String(folder || "").trim();
  if (!f) return "";
  if (os === "win32") {
    const fwd = f.replace(/\\/g, "/");
    const drive = /^([a-zA-Z]):(\/.*)?$/.exec(fwd);
    if (drive) return "/" + drive[1].toLowerCase() + ":" + (drive[2] || "/");
    return fwd; // UNC (//servidor/share) ou relativo: entrega como veio
  }
  return f;
}

export interface CodeServerArgsInput { port: number; userDataDir: string; extensionsDir: string }
export function codeServerArgs(installDir: string, i: CodeServerArgsInput): string[] {
  return [
    installDir,
    "--bind-addr", `127.0.0.1:${i.port}`,
    // A auth é a do Jarvis, no proxy do Hub (cookie de sessão por máquina). O code-server só escuta
    // em loopback, então ninguém de fora chega nele sem passar pelo Hub.
    "--auth", "none",
    "--disable-telemetry",
    "--disable-update-check",
    "--disable-workspace-trust",
    "--user-data-dir", i.userDataDir,
    "--extensions-dir", i.extensionsDir,
  ];
}

export function codeServerNodePath(installDir: string, platform: string = osPlatform()): string {
  return join(installDir, "lib", platform === "win32" ? "node.exe" : "node");
}

function normPath(p: string, platform: string): string {
  let s = String(p || "").replace(/^"|"$/g, "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (platform === "win32") s = s.toLowerCase();
  return s;
}

/**
 * Este processo é o code-server PRINCIPAL desta instância? Exige as duas coisas na linha de comando: o
 * `node` embutido da instalação E a pasta de dados desta instância. (Os filhos — o servidor de verdade
 * em `out/node/entry`, ptyHost, extension host — recebem a configuração por ambiente/IPC e NÃO trazem
 * `--user-data-dir`; ver `ideReapVictims`.)
 */
export function matchesIdeCmdline(cmdline: string, installDir: string, userDataDir: string, platform: string = osPlatform()): boolean {
  if (!cmdline || !installDir || !userDataDir) return false;
  const c = normPath(cmdline, platform);
  return c.includes(normPath(installDir, platform)) && c.includes(normPath(userDataDir, platform));
}

/**
 * Quem matar ao recolher órfãos desta instância (pura, sobre a lista de processos):
 *  1. o principal (binário da instalação + NOSSA pasta de dados) e toda a descendência dele;
 *  2. processos do binário da instalação SEM `--user-data-dir` cujo pai já morreu (no Windows: o PPID
 *     não está mais na lista; em POSIX: adotado pelo init/PID 1) — são filhos de um principal que
 *     morreu à força (o caso do watchdog matando o Hub), e a descendência deles.
 * Nunca entra: processo com OUTRO `--user-data-dir` (outra instância usando a mesma instalação, via
 * `JARVIS_IDE_CODE_SERVER`) nem filho de um principal vivo de outra instância.
 */
export function ideReapVictims(rows: Array<{ pid: number; ppid?: number; cmdline: string }>, installDir: string, userDataDir: string, platform: string = osPlatform(), exclude: number[] = []): number[] {
  const inst = normPath(installDir, platform), data = normPath(userDataDir, platform);
  const skip = new Set(exclude.filter((p) => p > 0));
  const alive = new Set(rows.map((r) => r.pid));
  const victims = new Set<number>();
  for (const r of rows) {
    if (skip.has(r.pid)) continue;
    const c = normPath(r.cmdline, platform);
    if (!c.includes(inst)) continue;
    const hasDataFlag = c.includes("--user-data-dir");
    if (hasDataFlag && c.includes(data)) { victims.add(r.pid); continue; }
    if (hasDataFlag) continue; // outra instância
    const orphan = !r.ppid || !alive.has(r.ppid) || (platform !== "win32" && r.ppid === 1);
    if (orphan) victims.add(r.pid);
  }
  // descendência (pelo PPID) de quem já é vítima
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (!victims.has(r.pid) && !skip.has(r.pid) && r.ppid && victims.has(r.ppid)) { victims.add(r.pid); grew = true; }
  }
  return [...victims];
}

/** Ambiente do code-server: o do usuário (git/ssh no terminal), menos o que quebraria o node embutido. */
export function codeServerEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    // NODE_OPTIONS do host (ex.: --import tsx) quebraria o node embutido; VSCODE_* de um VS Code de
    // fora (o Jarvis rodando dentro do terminal dele) faria o `code` do terminal integrado falar com
    // o editor errado.
    if (/^NODE_OPTIONS$/i.test(k) || /^VSCODE_/i.test(k) || /^ELECTRON_RUN_AS_NODE$/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// ============================================================================ download + extração

export interface DownloadProgress { received: number; total: number }

/**
 * Baixa `url` para `dest`, seguindo redirecionamentos (o GitHub manda para o CDN), calculando o SHA-256
 * no caminho, e confere tamanho + hash no fim. Arquivo que não confere é apagado e vira erro.
 */
export async function downloadVerified(url: string, dest: string, opts: { size: number; sha256: string; onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal; idleTimeoutMs?: number; userAgent?: string }): Promise<void> {
  const idle = opts.idleTimeoutMs ?? 60_000;
  const hash = createHash("sha256");
  let received = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (e?: Error) => { if (settled) return; settled = true; e ? reject(e) : resolve(); };
    const fetchUrl = (u: string, redirects: number) => {
      if (opts.signal?.aborted) { done(new Error("download cancelado")); return; }
      let parsed: URL; try { parsed = new URL(u); } catch { done(new Error("URL inválida no redirecionamento")); return; }
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(parsed.host.replace(/:\d+$/, "")))) { done(new Error("download só por https")); return; }
      const getter = parsed.protocol === "https:" ? httpsGet : httpGet;
      const req = getter(parsed, { headers: { "user-agent": opts.userAgent || "jarvis-ide", accept: "application/octet-stream" } }, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (redirects >= 8) { done(new Error("redirecionamentos demais")); return; }
          fetchUrl(new URL(res.headers.location, parsed).toString(), redirects + 1);
          return;
        }
        if (code !== 200) { res.resume(); done(new Error(`download falhou: HTTP ${code}`)); return; }
        const out = createWriteStream(dest);
        const fail = (e: Error) => { res.unpipe(out); res.destroy(); req.destroy(); out.destroy(); done(e); };
        let lastTick = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          hash.update(chunk);
          if (received > opts.size) { fail(new Error(`download maior que o esperado (${opts.size} bytes)`)); return; }
          const now = Date.now();
          if (opts.onProgress && now - lastTick > 250) { lastTick = now; try { opts.onProgress({ received, total: opts.size }); } catch { /* ignore */ } }
        });
        res.on("error", (e) => fail(e));
        res.on("close", () => { if (!res.complete) fail(new Error("conexão interrompida no meio do download")); });
        out.on("error", (e) => fail(e));
        // o arquivo só conta depois de fechado (no Windows, apagar/renomear com o handle aberto falha)
        out.on("close", () => { if (res.complete) done(); });
        res.pipe(out);
      });
      req.setTimeout(idle, () => req.destroy(new Error(`download parado há ${Math.round(idle / 1000)} s`)));
      req.on("error", (e) => done(e));
      opts.signal?.addEventListener("abort", () => { req.destroy(new Error("download cancelado")); done(new Error("download cancelado")); }, { once: true });
    };
    fetchUrl(url, 0);
  }).catch((e) => { try { unlinkSync(dest); } catch { /* ok */ } throw e; });
  opts.onProgress?.({ received, total: opts.size });
  const digest = hash.digest("hex");
  if (received !== opts.size) { try { unlinkSync(dest); } catch { /* ok */ } throw new Error(`download incompleto: ${received} de ${opts.size} bytes`); }
  if (digest !== opts.sha256.toLowerCase()) { try { unlinkSync(dest); } catch { /* ok */ } throw new Error(`SHA-256 não confere (esperado ${opts.sha256.slice(0, 12)}…, veio ${digest.slice(0, 12)}…) — download recusado`); }
}

/** Confere um arquivo já baixado (cache de teste, reinstalação). Streaming: não lê 218 MB de uma vez. */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => { const s = createReadStream(file); s.on("data", (c) => hash.update(c)); s.on("error", reject); s.on("end", () => resolve()); });
  return hash.digest("hex");
}

/** O `tar` do sistema. No Windows, o bsdtar do System32 explicitamente: o `tar` do Git Bash (GNU)
 *  no PATH entende `C:` como host remoto. */
export function systemTar(platform: string = osPlatform(), env: Record<string, string | undefined> = process.env): string {
  if (platform === "win32") {
    const sys = join(env.SystemRoot || env.windir || "C:\\Windows", "System32", "tar.exe");
    if (existsSync(sys)) return sys;
  }
  return "tar";
}

export async function extractTarGz(archive: string, destDir: string, opts: { platform?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<void> {
  const platform = opts.platform ?? osPlatform();
  mkdirSync(destDir, { recursive: true });
  const tar = systemTar(platform);
  await new Promise<void>((resolve, reject) => {
    let err = "";
    const child = spawn(tar, ["-xzf", archive, "-C", destDir], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => { void killProcessTree(child.pid || 0); reject(new Error("extração demorou demais")); }, opts.timeoutMs ?? 15 * 60_000);
    timer.unref?.();
    const onAbort = () => { void killProcessTree(child.pid || 0); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`não consegui rodar o tar do sistema (${tar}): ${e.message}`)); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) { reject(new Error("instalação cancelada")); return; }
      code === 0 ? resolve() : reject(new Error(`tar saiu com código ${code}: ${err.trim().slice(-400)}`));
    });
  });
}

export function freeBytes(dir: string): number | null {
  try { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

// ================================================================================== gerenciador

export interface IdeManagerOptions {
  /** raiz: binário, dados e extensões (padrão do host: `~/.jarvis/ide`) */
  rootDir: string;
  /** desliga sem cliente nenhum por este tempo (padrão 30 min; 0 = nunca) */
  idleMs?: number;
  onState?: (state: IdeStateInfo) => void;
  log?: (event: string, data?: Record<string, unknown>) => void;
  env?: Record<string, string | undefined>;
  platform?: string;
  arch?: string;
  /** code-server já instalado fora do Jarvis (`JARVIS_IDE_CODE_SERVER`): pula download e hash */
  binDir?: string;
  /** troca o build (testes) */
  asset?: CodeServerAsset | null;
  /** troca o download (testes / cache) — deve gravar em `dest` e chamar `onProgress` */
  download?: (asset: CodeServerAsset, dest: string, onProgress: (p: DownloadProgress) => void, signal: AbortSignal) => Promise<void>;
  startTimeoutMs?: number;
  /** espaço livre mínimo para instalar (padrão: 2 × tamanho do .tar.gz + 700 MB) */
  minFreeBytes?: number;
}

const MARKER = ".jarvis-install.json";

export class IdeManager {
  readonly rootDir: string;
  readonly installDir: string;
  readonly userDataDir: string;
  readonly extensionsDir: string;
  readonly pidfile: string;
  readonly asset: CodeServerAsset | null;
  readonly platform: string;
  private readonly disabled: boolean;
  private child: ChildProcess | null = null;
  private port = 0;
  private status: IdeStateInfo["status"] = "stopped";
  private reason: string | undefined;
  private progress: IdeStateInfo["progress"];
  private startedAt: number | undefined;
  private starting: Promise<number> | null = null;
  private installing: Promise<void> | null = null;
  private installAbort: AbortController | null = null;
  private stopping: Promise<void> | null = null;
  private clients = 0;
  private lastActivity = Date.now();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private outTail = "";
  private lastEmit = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly o: IdeManagerOptions) {
    this.platform = o.platform ?? osPlatform();
    this.rootDir = o.rootDir;
    this.asset = o.asset !== undefined ? o.asset : codeServerAsset(this.platform, o.arch ?? osArch());
    const env = o.env ?? process.env;
    this.disabled = ideDisabledByEnv(env);
    this.installDir = o.binDir || join(o.rootDir, `code-server-${this.asset?.version || CODE_SERVER_VERSION}`);
    this.userDataDir = join(o.rootDir, "user-data");
    this.extensionsDir = join(o.rootDir, "extensions");
    this.pidfile = join(o.rootDir, "code-server.pid");
  }

  /** A capacidade existe nesta máquina (SO com build publicado e sem `JARVIS_IDE=0`). */
  get available(): boolean { return !this.disabled && (!!this.asset || !!this.o.binDir); }
  get unavailableReason(): string | undefined {
    if (this.disabled) return "desligado nesta máquina (JARVIS_IDE=0)";
    if (!this.asset && !this.o.binDir) return `o code-server não publica build para ${this.platform}/${this.o.arch ?? osArch()}`;
    return undefined;
  }
  get installed(): boolean {
    if (!existsSync(codeServerNodePath(this.installDir, this.platform)) || !existsSync(join(this.installDir, "package.json"))) return false;
    return !!this.o.binDir || existsSync(join(this.installDir, MARKER));
  }
  get running(): boolean { return !!this.child && this.child.exitCode === null && this.status === "running"; }
  /** porta do code-server em 127.0.0.1 (só faz sentido com `running`) */
  get listenPort(): number { return this.running ? this.port : 0; }
  get pid(): number | undefined { return this.child?.pid; }

  state(): IdeStateInfo {
    let status = this.status;
    if (!this.available) status = "unavailable";
    else if (this.installing) status = "installing";
    else if (status !== "running" && status !== "starting" && status !== "error" && !this.installed) status = "not_installed";
    return {
      status,
      version: this.asset?.version || CODE_SERVER_VERSION,
      installed: this.available && this.installed,
      ...(this.asset ? { sizeBytes: this.asset.size } : {}),
      ...(status === "installing" && this.progress ? { progress: { ...this.progress } } : {}),
      ...(status === "running" && this.startedAt ? { startedAt: this.startedAt } : {}),
      ...((this.reason || this.unavailableReason) && status !== "running" ? { reason: this.reason || this.unavailableReason } : {}),
      ...(this.o.binDir ? { external: true } : {}),
    };
  }

  private log(event: string, data?: Record<string, unknown>): void { try { this.o.log?.(event, data); } catch { /* log não derruba */ } }
  /** Estado para o host, com teto de ~4/s (o progresso do download chega bem mais rápido). */
  private emit(now = false): void {
    if (!this.o.onState) return;
    const fire = () => { this.emitTimer = null; this.lastEmit = Date.now(); try { this.o.onState?.(this.state()); } catch { /* host com bug */ } };
    if (now) { if (this.emitTimer) { clearTimeout(this.emitTimer); this.emitTimer = null; } fire(); return; }
    if (this.emitTimer) return;
    const wait = Math.max(0, 250 - (Date.now() - this.lastEmit));
    this.emitTimer = setTimeout(fire, wait);
    this.emitTimer.unref?.();
  }

  // -------------------------------------------------------------------------------- instalação
  /** Baixa, confere e instala (uma vez por vez). Resolve quando instalado; erro vira `status:error`. */
  install(): Promise<void> {
    if (!this.available) return Promise.reject(new Error(this.unavailableReason || "IDE indisponível"));
    if (this.o.binDir) return this.installed ? Promise.resolve() : Promise.reject(new Error(`JARVIS_IDE_CODE_SERVER aponta para ${this.o.binDir}, que não tem um code-server`));
    if (this.installed) return Promise.resolve();
    if (this.installing) return this.installing;
    const ctrl = new AbortController();
    this.installAbort = ctrl;
    this.reason = undefined;
    this.progress = { phase: "download", received: 0, total: this.asset!.size };
    this.installing = this.doInstall(ctrl.signal).then(() => {
      this.status = "stopped"; this.reason = undefined;
      this.log("ide_installed", { version: this.asset!.version, dir: this.installDir });
    }, (e) => {
      this.status = "error"; this.reason = ctrl.signal.aborted ? "instalação cancelada" : String((e as Error)?.message ?? e);
      this.log("ide_install_failed", { error: this.reason });
      throw e;
    }).finally(() => { this.installing = null; this.installAbort = null; this.progress = undefined; this.emit(true); });
    this.emit(true);
    return this.installing;
  }

  cancelInstall(): void { this.installAbort?.abort(); }

  private async doInstall(signal: AbortSignal): Promise<void> {
    const asset = this.asset!;
    const t0 = Date.now();
    mkdirSync(this.rootDir, { recursive: true });
    await this.cleanLeftovers();
    const need = this.o.minFreeBytes ?? asset.size * 2 + 700 * 1024 * 1024;
    const free = freeBytes(this.rootDir);
    if (free !== null && free < need) throw new Error(`espaço insuficiente em ${this.rootDir}: ${Math.round(free / 1048576)} MB livres, precisa de ~${Math.round(need / 1048576)} MB`);
    const partial = join(this.rootDir, `.download-${randomBytes(4).toString("hex")}-${asset.name}.partial`);
    const staging = join(this.rootDir, `.staging-${randomBytes(4).toString("hex")}`);
    try {
      const onProgress = (p: DownloadProgress) => { this.progress = { phase: "download", received: p.received, total: p.total || asset.size }; this.emit(); };
      if (this.o.download) {
        await this.o.download(asset, partial, onProgress, signal);
        if (signal.aborted) throw new Error("instalação cancelada");
        this.progress = { phase: "verify", received: asset.size, total: asset.size }; this.emit();
        const st = statSync(partial);
        if (st.size !== asset.size) throw new Error(`download incompleto: ${st.size} de ${asset.size} bytes`);
        const digest = await sha256File(partial);
        if (digest !== asset.sha256) throw new Error(`SHA-256 não confere (esperado ${asset.sha256.slice(0, 12)}…, veio ${digest.slice(0, 12)}…) — download recusado`);
      } else {
        await downloadVerified(asset.url, partial, { size: asset.size, sha256: asset.sha256, onProgress, signal });
      }
      const tDown = Date.now();
      this.progress = { phase: "extract", received: asset.size, total: asset.size }; this.emit(true);
      await extractTarGz(partial, staging, { platform: this.platform, signal });
      const tops = readdirSync(staging).filter((n) => !n.startsWith("."));
      const top = tops.length === 1 ? join(staging, tops[0]) : staging;
      if (!existsSync(codeServerNodePath(top, this.platform)) || !existsSync(join(top, "package.json"))) throw new Error("o pacote extraído não tem o code-server esperado (lib/node + package.json)");
      writeFileSync(join(top, MARKER), JSON.stringify({ version: asset.version, asset: asset.name, sha256: asset.sha256, installedAt: Date.now() }, null, 2));
      if (existsSync(this.installDir)) {
        // pasta sem marcador (instalação velha/manual): sai do caminho antes do rename atômico
        const trash = join(this.rootDir, `.trash-${randomBytes(4).toString("hex")}`);
        renameSync(this.installDir, trash);
        void rm(trash, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* lixo fica para a próxima limpeza */ });
      }
      await renameWithRetry(top, this.installDir);
      this.log("ide_install_timing", { downloadMs: tDown - t0, extractMs: Date.now() - tDown });
    } finally {
      try { unlinkSync(partial); } catch { /* ok */ }
      await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* limpeza na próxima */ });
    }
  }

  /** Lixo de instalações interrompidas (`.download-*`, `.staging-*`, `.trash-*`). Assíncrono: um
   *  `.staging-*` de uma extração interrompida tem milhares de arquivos, e apagar isso síncrono no
   *  processo do Hub congelaria o event loop (INC-01..03). */
  private async cleanLeftovers(): Promise<void> {
    let names: string[] = [];
    try { names = readdirSync(this.rootDir); } catch { return; }
    for (const n of names) if (/^\.(download|staging|trash)-/.test(n)) await rm(join(this.rootDir, n), { recursive: true, force: true, maxRetries: 2 }).catch(() => { /* em uso: fica */ });
  }

  // ------------------------------------------------------------------------------- ciclo de vida
  /** Sobe (se preciso) e devolve a porta em 127.0.0.1. Lança se não instalado/indisponível. */
  ensureRunning(): Promise<number> {
    this.touch();
    if (!this.available) return Promise.reject(new Error(this.unavailableReason || "IDE indisponível"));
    if (this.running) return Promise.resolve(this.port);
    if (this.starting) return this.starting;
    if (this.installing) return Promise.reject(new Error("o VS Code ainda está sendo instalado nesta máquina"));
    if (!this.installed) return Promise.reject(Object.assign(new Error("o VS Code não está instalado nesta máquina"), { code: "not_installed" }));
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start(): Promise<number> {
    if (this.stopping) await this.stopping.catch(() => {});
    this.status = "starting"; this.reason = undefined; this.emit(true);
    try {
      await this.guardOtherHost();
      // Pidfile sobrando = a instância anterior não encerrou direito (host morto à força): recolhe
      // antes de subir. Sem pidfile não há o que recolher aqui (o boot do host já varreu) — e a
      // consulta de processos custa 1–2 s no Windows, que iriam para toda abertura.
      if (existsSync(this.pidfile)) await this.reapNow("start");
      mkdirSync(this.userDataDir, { recursive: true });
      mkdirSync(this.extensionsDir, { recursive: true });
      let lastErr: Error | null = null;
      // A porta livre é escolhida antes do spawn: se outro processo a pegar no meio, tenta outra.
      for (let attempt = 0; attempt < 2; attempt++) {
        try { return await this.spawnOnce(await pickFreePort()); }
        catch (e) { lastErr = e as Error; if (!(e as any)?.retryable) break; }
      }
      throw lastErr || new Error("o code-server não subiu");
    } catch (e) {
      this.status = "error"; this.reason = String((e as Error)?.message ?? e); this.emit(true);
      throw e;
    }
  }

  private async spawnOnce(port: number): Promise<number> {
    const t0 = Date.now();
    const node = codeServerNodePath(this.installDir, this.platform);
    const args = codeServerArgs(this.installDir, { port, userDataDir: this.userDataDir, extensionsDir: this.extensionsDir });
    const child = spawn(node, args, { cwd: this.installDir, env: codeServerEnv(this.o.env ?? process.env), stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: this.platform !== "win32" });
    this.child = child; this.port = port; this.outTail = "";
    const tail = (d: Buffer) => { this.outTail = (this.outTail + d.toString()).slice(-4000); };
    child.stdout?.on("data", tail); child.stderr?.on("data", tail);
    let spawnErr: Error | null = null;
    child.on("error", (e) => { spawnErr = e; this.log("ide_spawn_error", { error: String(e?.message ?? e) }); });
    child.once("exit", (code, signal) => this.onChildExit(child, code, signal));
    try { writeFileSync(this.pidfile, JSON.stringify({ pid: child.pid, host: process.pid, port, installDir: this.installDir, userDataDir: this.userDataDir, startedAt: Date.now() })); } catch { /* pidfile é ajuda */ }
    const deadline = Date.now() + (this.o.startTimeoutMs ?? 90_000);
    for (;;) {
      if (spawnErr) throw spawnErr;
      if (child.exitCode !== null || this.child !== child) {
        const tailTxt = this.outTail.trim().slice(-600);
        throw Object.assign(new Error(`o code-server saiu ao subir (código ${child.exitCode}): ${tailTxt}`), { retryable: /EADDRINUSE|address already in use/i.test(tailTxt) });
      }
      if (await healthz(port)) break;
      if (Date.now() > deadline) { await this.killChild(); throw new Error(`o code-server não respondeu em ${Math.round((this.o.startTimeoutMs ?? 90_000) / 1000)} s: ${this.outTail.trim().slice(-400)}`); }
      await sleep(150);
    }
    this.status = "running"; this.startedAt = Date.now(); this.reason = undefined;
    this.lastActivity = Date.now();
    this.startIdleTimer();
    this.log("ide_started", { ms: Date.now() - t0, pid: child.pid, port });
    this.emit(true);
    return port;
  }

  private onChildExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    this.child = null; this.port = 0;
    try { unlinkSync(this.pidfile); } catch { /* ok */ }
    this.stopIdleTimer();
    if (!this.stopping && this.status === "running") {
      this.status = "error"; this.reason = `o code-server encerrou (código ${code ?? signal})`;
      this.log("ide_exited", { code, signal, tail: this.outTail.slice(-400) });
      this.emit(true);
      // os filhos (ptyHost, extension host, shells) não morrem sozinhos no Windows
      void this.reapNow("exit").catch(() => {});
    }
  }

  /** Outro processo Jarvis desta máquina (pidfile com host vivo) usando a MESMA pasta: recusa. */
  private async guardOtherHost(): Promise<void> {
    try {
      const pf = JSON.parse(readFileSync(this.pidfile, "utf8"));
      const host = Number(pf?.host) || 0;
      if (host && host !== process.pid && pidAlive(host) && pidAlive(Number(pf?.pid) || 0)) {
        throw new Error(`o VS Code desta máquina já está aberto por outro processo do Jarvis (pid ${host})`);
      }
    } catch (e) { if (/outro processo/.test(String((e as Error)?.message))) throw e; }
  }

  /** Recolhe code-server órfão DESTA instância (host anterior morto à força). Devolve os PIDs. */
  private async reapNow(at: string): Promise<number[]> {
    const rows = await listProcesses(this.platform === "win32" ? "node.exe" : undefined, this.platform);
    if (!rows) return [];
    const pidsToKill = new Set(ideReapVictims(rows, this.installDir, this.userDataDir, this.platform, [process.pid, this.child?.pid || 0]));
    const victims = rows.filter((r) => pidsToKill.has(r.pid));
    if (!victims.length) return [];
    const pids = new Set(victims.map((v) => v.pid));
    const roots = victims.filter((v) => !v.ppid || !pids.has(v.ppid));
    for (const r of roots) await killProcessTree(r.pid, this.platform);
    for (const v of victims) if (!roots.includes(v) && pidAlive(v.pid)) await killProcessTree(v.pid, this.platform);
    const deadline = Date.now() + 5000;
    while (victims.some((v) => pidAlive(v.pid)) && Date.now() < deadline) await sleep(100);
    this.log("ide_reaped", { pids: victims.map((v) => v.pid), at });
    return victims.map((v) => v.pid);
  }

  /** No boot do host: recolhe órfão sem esperar o primeiro uso. Não mexe se outro host vivo é o dono. */
  async reapOrphans(): Promise<number[]> {
    if (!this.available || this.child || this.starting || !existsSync(this.rootDir)) return [];
    try {
      const pf = JSON.parse(readFileSync(this.pidfile, "utf8"));
      const host = Number(pf?.host) || 0;
      if (host && host !== process.pid && pidAlive(host)) return [];
    } catch { /* sem pidfile: varre mesmo assim */ }
    const pids = await this.reapNow("boot");
    try { unlinkSync(this.pidfile); } catch { /* ok */ }
    return pids;
  }

  /** Encerra (árvore inteira) e confere que nada da instância sobrou. */
  stop(reason = "pedido do dono"): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this.starting) await this.starting.catch(() => {});
      if (!this.child) { if (this.status !== "error") this.status = "stopped"; return; }
      this.stopIdleTimer();
      await this.killChild();
      await this.reapNow("stop").catch(() => []);
      this.status = "stopped"; this.reason = reason; this.startedAt = undefined;
      this.log("ide_stopped", { reason });
    })().finally(() => { this.stopping = null; this.emit(true); });
    return this.stopping;
  }

  private async killChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null; this.port = 0;
    if (child.exitCode === null && child.pid) { await killProcessTree(child.pid, this.platform); await waitExit(child, 4000); }
    try { unlinkSync(this.pidfile); } catch { /* ok */ }
  }

  /** Saída do processo hospedeiro: só dá para ser síncrono. */
  stopSync(): void {
    this.installAbort?.abort();
    const child = this.child;
    this.child = null; this.port = 0; this.stopIdleTimer();
    if (child?.pid && child.exitCode === null) killProcessTreeSync(child.pid, this.platform);
    try { unlinkSync(this.pidfile); } catch { /* ok */ }
  }

  // ------------------------------------------------------------------------- clientes e ocioso
  /** Uma requisição/WebSocket passou pelo proxy agora. */
  touch(): void { this.lastActivity = Date.now(); }
  /** Uma conexão (HTTP em andamento ou WebSocket) abriu; `release` quando fechar. */
  retain(): void { this.clients++; this.touch(); }
  release(): void { this.clients = Math.max(0, this.clients - 1); this.touch(); }
  get openClients(): number { return this.clients; }

  private startIdleTimer(): void {
    const idleMs = this.o.idleMs ?? 30 * 60_000;
    if (this.idleTimer || !(idleMs > 0)) return;
    this.idleTimer = setInterval(() => {
      if (!this.running || this.clients > 0) return;
      if (Date.now() - this.lastActivity >= idleMs) void this.stop("ocioso (nenhuma aba aberta)");
    }, Math.min(30_000, Math.max(200, Math.floor(idleMs / 3))));
    this.idleTimer.unref?.();
  }
  private stopIdleTimer(): void { if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null; } }

  /** Saída do log do code-server (diagnóstico). */
  get outputTail(): string { return this.outTail; }
}

// ======================================================================================== util

async function renameWithRetry(from: string, to: string): Promise<void> {
  // Windows: o antivírus segura arquivos recém-extraídos por instantes (EPERM/EBUSY no rename).
  // Espera assíncrona: no Hub isto roda no event loop do servidor.
  for (let i = 0; ; i++) {
    try { renameSync(from, to); return; }
    catch (e: any) { if (i >= 20 || !/EPERM|EBUSY|EACCES/.test(String(e?.code))) throw e; await sleep(250); }
  }
}

export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const a = s.address(); const p = typeof a === "object" && a ? a.port : 0; s.close(() => resolve(p)); });
  });
}

function healthz(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/healthz", timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
    req.end();
  });
}

function pidAlive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}

function waitExit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); child.once("exit", () => { clearTimeout(t); resolve(); }); });
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

