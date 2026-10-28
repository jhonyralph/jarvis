/**
 * Browser remoto (BRW-IDE-00 F1) — um Chromium headless por PERFIL nesta máquina, dirigido por CDP cru.
 *
 * Quem hospeda: o runner de cada máquina e o Hub (para a máquina dele, LOCAL). O host injeta a fábrica
 * de WebSocket (o core não depende de `ws`), recebe frames já codificados (`onFrame`) e o estado das
 * abas (`onState`), e decide quando ligar/desligar o screencast de cada aba (`view`) — quem conta
 * espectadores é o Hub, não este módulo.
 *
 * Leis da spec que este arquivo implementa:
 *   §3.1 cookies/storage nunca saem: daqui só saem frames, metadados (URL/título/abas) e erros.
 *   §3.2 CDP só em loopback: `--remote-debugging-address=127.0.0.1` e a conexão é sempre 127.0.0.1.
 *   §3.5 screencast só com espectador: `view(on:false)` para o Chrome de codificar.
 *   §10  Chrome órfão: pidfile por perfil + recolhe, antes de abrir, qualquer Chrome com o MESMO
 *        `--user-data-dir`; encerramento mata a árvore; desliga sozinho sem espectador (idle).
 *   §13.1 "o mais recente vence" no produtor: o Chrome é confirmado na hora e o frame é despachado no
 *        ritmo do teto de fps — o intermediário é substituído, nunca enfileirado.
 *
 * Tudo que dá para testar sem Chrome está em funções puras exportadas (descoberta do executável,
 * argumentos, casamento de linha de comando, codec do frame, parse rápido do CDP, mapa de teclas,
 * normalização de URL, controle de qualidade).
 */
import { spawn, execFile, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { basename, join } from "node:path";
import type { BrowserInput, BrowserPageInfo, BrowserProfileName, BrowserStateInfo } from "@jarvis/protocol";

// ================================================================================ descoberta (pura)

export type BrowserSource = "env" | "chrome" | "edge" | "chromium" | "playwright";
export interface BrowserCandidate { path: string; source: BrowserSource }
export interface BrowserDiscoveryInput {
  env?: Record<string, string | undefined>;
  platform?: string;
  home?: string;
  exists?: (path: string) => boolean;
  listDir?: (path: string) => string[];
}
export interface BrowserDiscovery { path: string | null; source?: BrowserSource; disabled?: boolean; reason?: string }

/** `JARVIS_BROWSER=0` (ou off/false/no) desliga o browser remoto nesta máquina — capacidade some. */
export function browserDisabledByEnv(env: Record<string, string | undefined> = process.env): boolean {
  return ["0", "off", "false", "no"].includes(String(env.JARVIS_BROWSER ?? "").trim().toLowerCase());
}

/** Chromium baixado pelo Playwright (último recurso). Pastas `chromium-<build>`, a maior primeiro. */
function playwrightCandidates(platform: string, env: Record<string, string | undefined>, home: string, listDir: (p: string) => string[]): string[] {
  const root = env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== "0"
    ? env.PLAYWRIGHT_BROWSERS_PATH
    : platform === "win32" ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "ms-playwright")
      : platform === "darwin" ? join(home, "Library", "Caches", "ms-playwright")
        : join(home, ".cache", "ms-playwright");
  let dirs: string[] = [];
  try { dirs = listDir(root).filter((d) => /^chromium-\d+$/.test(d)); } catch { return []; }
  dirs.sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  const tails = platform === "win32" ? [["chrome-win64", "chrome.exe"], ["chrome-win", "chrome.exe"]]
    : platform === "darwin" ? [["chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"], ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"]]
      : [["chrome-linux64", "chrome"], ["chrome-linux", "chrome"]];
  return dirs.flatMap((d) => tails.map((t) => join(root, d, ...t)));
}

/** Candidatos na ordem pedida: Chrome → Edge → Chromium (Playwright por último). */
export function browserCandidates(input: BrowserDiscoveryInput = {}): BrowserCandidate[] {
  const env = input.env ?? process.env;
  const platform = input.platform ?? osPlatform();
  const home = input.home ?? homedir();
  const listDir = input.listDir ?? ((p: string) => readdirSync(p));
  const out: BrowserCandidate[] = [];
  const add = (source: BrowserSource, ...paths: string[]) => { for (const p of paths) out.push({ path: p, source }); };
  if (platform === "win32") {
    const pf = env.ProgramFiles || env.PROGRAMFILES || "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] || env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA || join(home, "AppData", "Local");
    add("chrome", join(pf, "Google", "Chrome", "Application", "chrome.exe"), join(pf86, "Google", "Chrome", "Application", "chrome.exe"), join(local, "Google", "Chrome", "Application", "chrome.exe"));
    add("edge", join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"), join(pf, "Microsoft", "Edge", "Application", "msedge.exe"));
    add("chromium", join(local, "Chromium", "Application", "chrome.exe"));
  } else if (platform === "darwin") {
    add("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", join(home, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"));
    add("edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
    add("chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    add("chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome");
    add("edge", "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable");
    add("chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium");
  }
  add("playwright", ...playwrightCandidates(platform, env, home, listDir));
  return out;
}

/**
 * Qual navegador usar. `JARVIS_BROWSER_PATH` manda; se apontar para um arquivo que não existe a
 * capacidade fica DESLIGADA com o motivo (cair em silêncio para outro navegador surpreenderia quem
 * configurou de propósito).
 */
export function resolveBrowserExecutable(input: BrowserDiscoveryInput = {}): BrowserDiscovery {
  const env = input.env ?? process.env;
  const exists = input.exists ?? existsSync;
  if (browserDisabledByEnv(env)) return { path: null, disabled: true, reason: "desligado por JARVIS_BROWSER=0" };
  const forced = String(env.JARVIS_BROWSER_PATH ?? "").trim();
  if (forced) return exists(forced) ? { path: forced, source: "env" } : { path: null, reason: `JARVIS_BROWSER_PATH não existe: ${forced}` };
  for (const c of browserCandidates(input)) if (exists(c.path)) return { path: c.path, source: c.source };
  return { path: null, reason: "nenhum Chrome/Edge/Chromium encontrado nesta máquina" };
}

// ================================================================================ argumentos (pura)

export interface ChromeArgsInput { userDataDir: string; width?: number; height?: number; isRoot?: boolean; extraArgs?: string[] }

export function buildChromeArgs(input: ChromeArgsInput): string[] {
  const w = clampInt(input.width, 1280, 320, 3840), h = clampInt(input.height, 800, 240, 3840);
  return [
    "--headless=new",
    // CDP só em loopback (lei §3.2). A porta é efêmera e lida do DevToolsActivePort.
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${input.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${w},${h}`,
    // Áudio está fora da F1: uma aba remota tocando som no PC de alguém seria uma surpresa ruim.
    "--mute-audio",
    // Chrome como root (servidor Linux) só sobe sem sandbox.
    ...(input.isRoot ? ["--no-sandbox"] : []),
    ...(input.extraArgs || []),
    "about:blank",
  ];
}

/** O headless se anuncia como "HeadlessChrome" e há site que bloqueia login por isso (§10). */
export function headfulUserAgent(ua: string): string {
  return String(ua || "").replace(/HeadlessChrome/g, "Chrome");
}

// ============================================================ processos órfãos: casamento (pura)

/** Valor de cada `--user-data-dir=` na linha de comando (com ou sem aspas). */
export function userDataDirsInCmdline(cmdline: string): string[] {
  const out: string[] = [];
  const key = "--user-data-dir=";
  let i = cmdline.indexOf(key);
  while (i >= 0) {
    let j = i + key.length, value: string;
    if (cmdline[j] === "\"") { const end = cmdline.indexOf("\"", j + 1); value = cmdline.slice(j + 1, end < 0 ? undefined : end); }
    else { const m = /^\S*/.exec(cmdline.slice(j)); value = m ? m[0] : ""; }
    out.push(value);
    i = cmdline.indexOf(key, j);
  }
  return out;
}

function normDir(p: string, platform: string): string {
  let s = String(p || "").replace(/^"|"$/g, "");
  if (platform === "win32") s = s.replace(/\\/g, "/").toLowerCase();
  return s.replace(/\/+$/, "");
}

/** Este processo é um Chrome usando EXATAMENTE este perfil? (`owner` não casa com `owner2`). */
export function matchesProfileCmdline(cmdline: string, userDataDir: string, platform: string = osPlatform()): boolean {
  if (!cmdline || !userDataDir) return false;
  const want = normDir(userDataDir, platform);
  return userDataDirsInCmdline(cmdline).some((v) => normDir(v, platform) === want);
}

// ============================================================================ frame binário (pura)

export const BROWSER_FRAME_KIND = 0x42; // 'B'
export const BROWSER_FRAME_VERSION = 1;
const FRAME_FIXED = 20;
export interface BrowserFrameHeader { pageId: string; seq: number; t0: number; width: number; height: number; quality: number }

/** [kind][ver][L][q][seq u32][t0 f64][w u16][h u16][pageId L][JPEG] — ver protocol/runner.ts. */
export function encodeBrowserFrame(h: BrowserFrameHeader, jpeg: Buffer): Buffer {
  const id = Buffer.from(String(h.pageId), "latin1");
  if (!id.length || id.length > 64) throw new Error("pageId inválido para o frame");
  const head = Buffer.allocUnsafe(FRAME_FIXED + id.length);
  head.writeUInt8(BROWSER_FRAME_KIND, 0);
  head.writeUInt8(BROWSER_FRAME_VERSION, 1);
  head.writeUInt8(id.length, 2);
  head.writeUInt8(clampInt(h.quality, 0, 0, 100), 3);
  head.writeUInt32BE(clampInt(h.seq, 0, 0, 0xffffffff), 4);
  head.writeDoubleBE(Number.isFinite(h.t0) ? h.t0 : 0, 8);
  head.writeUInt16BE(clampInt(h.width, 0, 0, 0xffff), 16);
  head.writeUInt16BE(clampInt(h.height, 0, 0, 0xffff), 18);
  id.copy(head, FRAME_FIXED);
  return Buffer.concat([head, jpeg]);
}

/** Só o pageId — é tudo que o Hub lê para rotear (repasse opaco, §3.5). null = não é frame válido. */
export function peekBrowserFramePageId(buf: Buffer): string | null {
  if (!Buffer.isBuffer(buf) || buf.length < FRAME_FIXED + 1) return null;
  if (buf[0] !== BROWSER_FRAME_KIND || buf[1] !== BROWSER_FRAME_VERSION) return null;
  const len = buf[2];
  if (!len || len > 64 || buf.length < FRAME_FIXED + len) return null;
  return buf.toString("latin1", FRAME_FIXED, FRAME_FIXED + len);
}

export function decodeBrowserFrame(buf: Buffer): { header: BrowserFrameHeader; jpeg: Buffer } | null {
  const pageId = peekBrowserFramePageId(buf);
  if (pageId == null) return null;
  return {
    header: { pageId, quality: buf[3], seq: buf.readUInt32BE(4), t0: buf.readDoubleBE(8), width: buf.readUInt16BE(16), height: buf.readUInt16BE(18) },
    jpeg: buf.subarray(FRAME_FIXED + buf[2]),
  };
}

// ================================================================== parse rápido do CDP (pura)

export interface CdpMessage {
  id?: number;
  method?: string;
  params?: any;
  sessionId?: string;
  result?: any;
  error?: { message?: string; code?: number };
  /** Page.screencastFrame: os bytes BASE64 do JPEG, ainda sem decodificar (fatia do buffer recebido) */
  frameData?: Buffer;
}
const FRAME_METHOD = Buffer.from("\"method\":\"Page.screencastFrame\"");
const DATA_KEY = Buffer.from("\"data\":\"");

/**
 * Parse de uma mensagem do CDP. O frame do screencast chega como JSON de centenas de KB (o JPEG em
 * base64); dar JSON.parse nisso a até 60 fps é o tipo de trabalho síncrono que já travou o Hub
 * (INC-01..03). Caminho rápido: tira o campo `data` do texto SEM parsear, guarda a fatia base64 e
 * parseia só o resto (metadados + sessionId). Decodificar fica para o despacho — e só para o frame
 * que vence; os substituídos nunca são decodificados.
 */
export function parseCdpMessage(raw: Buffer | string): CdpMessage | null {
  const buf = typeof raw === "string" ? Buffer.from(raw) : raw;
  try {
    if (buf.length > 2048 && buf.subarray(0, 160).indexOf(FRAME_METHOD) >= 0) {
      const d = buf.indexOf(DATA_KEY);
      const start = d + DATA_KEY.length;
      const end = d >= 0 ? buf.indexOf(0x22, start) : -1;
      if (d >= 0 && end > start) {
        const rest = buf.toString("utf8", 0, start) + buf.toString("utf8", end);
        const msg = JSON.parse(rest) as CdpMessage;
        if (msg && msg.method === "Page.screencastFrame") { msg.frameData = buf.subarray(start, end); return msg; }
      }
    }
    const msg = JSON.parse(buf.toString("utf8"));
    return msg && typeof msg === "object" ? msg as CdpMessage : null;
  } catch { return null; }
}

// ========================================================================= input (puras)

/** Bitmask do CDP: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function cdpModifiers(m: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean }): number {
  return (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
}

interface KeyDef { code: string; vk: number; text?: string }
/** Teclas não imprimíveis (layout US, como o Puppeteer). Enter leva "\r" para disparar o submit. */
export const SPECIAL_KEYS: Readonly<Record<string, KeyDef>> = {
  Backspace: { code: "Backspace", vk: 8 }, Tab: { code: "Tab", vk: 9 }, Enter: { code: "Enter", vk: 13, text: "\r" },
  Shift: { code: "ShiftLeft", vk: 16 }, Control: { code: "ControlLeft", vk: 17 }, Alt: { code: "AltLeft", vk: 18 },
  Pause: { code: "Pause", vk: 19 }, CapsLock: { code: "CapsLock", vk: 20 }, Escape: { code: "Escape", vk: 27 },
  PageUp: { code: "PageUp", vk: 33 }, PageDown: { code: "PageDown", vk: 34 }, End: { code: "End", vk: 35 }, Home: { code: "Home", vk: 36 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 }, ArrowUp: { code: "ArrowUp", vk: 38 }, ArrowRight: { code: "ArrowRight", vk: 39 }, ArrowDown: { code: "ArrowDown", vk: 40 },
  Insert: { code: "Insert", vk: 45 }, Delete: { code: "Delete", vk: 46 }, Meta: { code: "MetaLeft", vk: 91 }, ContextMenu: { code: "ContextMenu", vk: 93 },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, { code: `F${i + 1}`, vk: 112 + i }])),
};
const CODE_VK: Readonly<Record<string, number>> = {
  Space: 32, Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191, Backquote: 192,
  BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222, IntlBackslash: 226,
};

function printableVk(key: string, code?: string): number {
  if (code) {
    if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
    if (/^Digit\d$/.test(code)) return code.charCodeAt(5);
    if (/^Numpad\d$/.test(code)) return 96 + Number(code.slice(6));
    if (CODE_VK[code]) return CODE_VK[code];
  }
  if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^\d$/.test(key)) return key.charCodeAt(0);
  if (key === " ") return 32;
  return 0;
}

export interface CdpCommand { method: string; params: Record<string, unknown> }

/**
 * Tecla do espectador → comandos CDP. Imprimível sem Ctrl/Alt/Meta vai como `keyDown` COM `text`
 * (gera keydown/keypress/input reais — sites com atalho/autocomplete dependem disso); com Ctrl/Meta
 * vai como `rawKeyDown` sem texto (atalho). Teclas especiais usam o mapa acima. Texto pronto do
 * teclado do celular/IME vem como `kind:"text"` e vira Input.insertText (ver `browserInputCommands`).
 * Tecla que o navegador não identificou ("Unidentified", "Dead", "Process") é ignorada.
 */
export function keyEventsFor(ev: { type: "down" | "up"; key: string; code?: string; modifiers?: number }): CdpCommand[] {
  const key = String(ev.key ?? "");
  const modifiers = clampInt(ev.modifiers, 0, 0, 15);
  const chord = (modifiers & (1 | 2 | 4)) !== 0; // Alt, Ctrl ou Meta
  const special = Object.prototype.hasOwnProperty.call(SPECIAL_KEYS, key) ? SPECIAL_KEYS[key] : undefined;
  const printable = !special && [...key].length === 1;
  if (!special && !printable) return [];
  const code = typeof ev.code === "string" && ev.code ? ev.code : special ? special.code : "";
  const vk = special ? special.vk : printableVk(key, code);
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  if (ev.type === "up") return [{ method: "Input.dispatchKeyEvent", params: { type: "keyUp", ...base } }];
  const text = special ? special.text : key;
  if (text && !chord) return [{ method: "Input.dispatchKeyEvent", params: { type: "keyDown", ...base, text, unmodifiedText: text } }];
  return [{ method: "Input.dispatchKeyEvent", params: { type: "rawKeyDown", ...base } }];
}

const MOUSE_TYPE = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" } as const;
const BUTTON_BIT: Record<string, number> = { left: 1, right: 2, middle: 4 };

/** Input do espectador → comandos CDP. Coordenadas em px CSS; valores absurdos são grampeados. */
export function browserInputCommands(input: BrowserInput): CdpCommand[] {
  const x = clampNum((input as any).x, 0, -100000, 100000), y = clampNum((input as any).y, 0, -100000, 100000);
  switch (input?.kind) {
    case "mouse": {
      const type = MOUSE_TYPE[input.type];
      if (!type) return [];
      const button = ["left", "middle", "right", "none"].includes(String(input.button)) ? input.button! : input.type === "move" ? "none" : "left";
      const buttons = Number.isFinite(input.buttons) ? clampInt(input.buttons, 0, 0, 31) : input.type === "down" ? (BUTTON_BIT[button] || 0) : 0;
      const clickCount = input.type === "move" ? 0 : clampInt(input.clickCount, 1, 1, 3);
      return [{ method: "Input.dispatchMouseEvent", params: { type, x, y, button, buttons, clickCount, modifiers: clampInt(input.modifiers, 0, 0, 15) } }];
    }
    case "wheel":
      return [{ method: "Input.dispatchMouseEvent", params: { type: "mouseWheel", x, y, deltaX: clampNum(input.dx, 0, -10000, 10000), deltaY: clampNum(input.dy, 0, -10000, 10000), modifiers: clampInt(input.modifiers, 0, 0, 15) } }];
    case "key":
      return keyEventsFor(input);
    case "text": {
      const text = String(input.text ?? "").slice(0, 10000);
      return text ? [{ method: "Input.insertText", params: { text } }] : [];
    }
    default:
      return [];
  }
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)(:\d+)?(\/|$|\?|#)/i;
const ALLOWED_SCHEME = /^(https?|file|about|data|chrome|view-source):/i;

/**
 * O que o dono digitou na barra → URL. Sem esquema: https (http para localhost/rede privada, onde
 * dev server raramente tem TLS). Texto com espaço, ou sem ponto, vira busca. `javascript:` e esquemas
 * estranhos são recusados (null) — a barra é para navegar, não para executar.
 */
export function normalizeNavUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim().slice(0, 4096);
  if (!s) return null;
  if (ALLOWED_SCHEME.test(s)) return s;
  if (/^(javascript|vbscript):/i.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;
  if (PRIVATE_HOST.test(s)) return "http://" + s;
  if (/\s/.test(s) || !/[.:]/.test(s)) return "https://www.google.com/search?q=" + encodeURIComponent(s);
  return "https://" + s;
}

// ================================================================== qualidade adaptativa (pura)

export interface QualityOptions { max?: number; min?: number; downStep?: number; upStep?: number; recoverAfter?: number; threshold?: number }

/**
 * Qualidade JPEG adaptativa (§13.1: "a qualidade cai quando o crédito esgota"). Uma janela ≈ 1 s:
 * descarte ≥ threshold → desce `downStep`; janela limpa (≤ 5% de descarte) `recoverAfter` vezes
 * seguidas → sobe `upStep`. Janela quase vazia (página parada) não conta nem para um lado nem para o
 * outro: tela parada não é sinal de rede boa nem ruim.
 */
export class QualityController {
  readonly max: number;
  readonly min: number;
  private q: number;
  private delivered = 0;
  private dropped = 0;
  private healthy = 0;
  private readonly downStep: number;
  private readonly upStep: number;
  private readonly recoverAfter: number;
  private readonly threshold: number;
  constructor(opts: QualityOptions = {}) {
    this.max = clampInt(opts.max, 60, 10, 95);
    this.min = Math.min(this.max, clampInt(opts.min, 30, 5, 95));
    this.q = this.max;
    this.downStep = clampInt(opts.downStep, 15, 1, 50);
    this.upStep = clampInt(opts.upStep, 5, 1, 50);
    this.recoverAfter = clampInt(opts.recoverAfter, 3, 1, 60);
    this.threshold = clampNum(opts.threshold, 0.25, 0.01, 1);
  }
  get quality(): number { return this.q; }
  record(delivered: number, dropped: number): void {
    this.delivered += Math.max(0, Number(delivered) || 0);
    this.dropped += Math.max(0, Number(dropped) || 0);
  }
  /** Fecha a janela. Devolve a qualidade NOVA quando muda; null quando fica igual. */
  evaluate(): number | null {
    const total = this.delivered + this.dropped, ratio = total ? this.dropped / total : 0;
    this.delivered = 0; this.dropped = 0;
    if (total < 2) return null;
    let next = this.q;
    if (ratio >= this.threshold) { this.healthy = 0; next = Math.max(this.min, this.q - this.downStep); }
    else if (ratio <= 0.05) { this.healthy++; if (this.healthy >= this.recoverAfter) { this.healthy = 0; next = Math.min(this.max, this.q + this.upStep); } }
    else this.healthy = 0;
    if (next === this.q) return null;
    this.q = next;
    return next;
  }
}

// ======================================================================= processos (com efeito)

export interface ProcessRow { pid: number; ppid?: number; cmdline: string }

function execFileText(cmd: string, args: string[], timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => err ? reject(err) : resolve(String(stdout || "")));
  });
}

/** Processos da máquina com a linha de comando. `exeName` filtra no Windows (CIM inteiro é lento).
 *  null = não deu para listar (sem PowerShell/ps) — quem chama decide o que fazer sem a lista. */
export async function listProcesses(exeName?: string, platform: string = osPlatform()): Promise<ProcessRow[] | null> {
  try {
    if (platform === "win32") {
      const name = exeName && /^[\w .()-]+\.exe$/i.test(exeName) ? exeName : "";
      const filter = name ? ` -Filter "Name='${name}'"` : "";
      const script = `Get-CimInstance -ClassName Win32_Process${filter} | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`;
      // -EncodedCommand: nada de aspas atravessando o argv do Windows.
      const out = (await execFileText("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")])).trim();
      if (!out) return [];
      const parsed = JSON.parse(out);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((r: any) => ({ pid: Number(r.ProcessId), ppid: Number(r.ParentProcessId), cmdline: String(r.CommandLine || "") })).filter((r) => r.pid > 0);
    }
    const out = await execFileText("ps", ["-axww", "-o", "pid=,ppid=,command="]);
    return out.split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmdline: m[3] }));
  } catch { return null; }
}

export async function killProcessTree(pid: number, platform: string = osPlatform()): Promise<void> {
  if (!(pid > 0)) return;
  if (platform === "win32") { await execFileText("taskkill", ["/PID", String(pid), "/T", "/F"], 10000).catch(() => {}); return; }
  try { process.kill(-pid, "SIGKILL"); } catch { /* sem grupo próprio */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* já morreu */ }
}

export function killProcessTreeSync(pid: number, platform: string = osPlatform()): void {
  if (!(pid > 0)) return;
  if (platform === "win32") { try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 10000 }); } catch { /* já morreu */ } return; }
  try { process.kill(-pid, "SIGKILL"); } catch { /* sem grupo */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* já morreu */ }
}

function pidAlive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}

/**
 * Recolhe Chrome órfão deste perfil (§10): todo processo cuja linha de comando tem EXATAMENTE este
 * `--user-data-dir`. O pidfile entra só como candidato — o PID dele só é morto se a linha de comando
 * confirmar (PID reaproveitado pelo Windows não pode virar vítima). Devolve os PIDs mortos.
 */
export async function reapProfileProcesses(userDataDir: string, opts: { exeName?: string; pidfile?: string; platform?: string; selfPid?: number } = {}): Promise<number[]> {
  const platform = opts.platform ?? osPlatform();
  const rows = await listProcesses(opts.exeName, platform);
  if (!rows) return [];
  const hinted = (() => { try { return Number(JSON.parse(readFileSync(opts.pidfile || "", "utf8")).pid) || 0; } catch { return 0; } })();
  const victims = rows.filter((r) => r.pid !== (opts.selfPid ?? process.pid) && matchesProfileCmdline(r.cmdline, userDataDir, platform));
  // Mata primeiro quem não tem o pai na lista (o processo browser); a árvore leva os filhos junto.
  const pids = new Set(victims.map((v) => v.pid));
  const roots = victims.filter((v) => !v.ppid || !pids.has(v.ppid) || v.pid === hinted);
  for (const r of roots) await killProcessTree(r.pid, platform);
  for (const v of victims) if (!roots.includes(v) && pidAlive(v.pid)) await killProcessTree(v.pid, platform);
  // O Windows demora um pouco para soltar o lock do perfil depois do taskkill.
  const deadline = Date.now() + 5000;
  while (victims.some((v) => pidAlive(v.pid)) && Date.now() < deadline) await sleep(100);
  // Segunda passada: o Chrome pode ter aberto um filho ENTRE a listagem e o kill (visto na suíte sob
  // carga em 2026-10-28: dois processos do perfil vivos depois do recolhimento). Esse filho não estava
  // em `victims` e seguraria o lock do perfil para o próximo Chrome.
  const again = victims.length ? await listProcesses(opts.exeName, platform) : null;
  const late = (again ?? []).filter((r) => r.pid !== (opts.selfPid ?? process.pid) && !pids.has(r.pid) && matchesProfileCmdline(r.cmdline, userDataDir, platform));
  for (const r of late) if (pidAlive(r.pid)) await killProcessTree(r.pid, platform);
  const lateDeadline = Date.now() + 5000;
  while (late.some((v) => pidAlive(v.pid)) && Date.now() < lateDeadline) await sleep(100);
  return [...victims, ...late].map((v) => v.pid);
}

// ============================================================================== conexão CDP

/** O mínimo que o core precisa de um WebSocket (o `ws` do Node atende). Injetado pelo host. */
export interface CdpSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}
export type CdpSocketFactory = (url: string) => CdpSocketLike;

class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; method: string }>();
  closed = false;
  constructor(private readonly sock: CdpSocketLike, private readonly onEvent: (msg: CdpMessage) => void, private readonly onClose: () => void) {
    sock.on("message", (data: unknown) => this.handle(data));
    sock.on("close", () => this.fail("conexão CDP fechou"));
    sock.on("error", () => { /* o close vem em seguida */ });
  }
  call(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 15000): Promise<any> {
    if (this.closed || this.sock.readyState !== 1) return Promise.reject(new Error("CDP desconectado"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} sem resposta em ${timeoutMs} ms`)); }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.sock.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }
  close(): void { try { this.sock.close(); } catch { /* ok */ } this.fail("conexão CDP encerrada"); }
  private handle(data: unknown): void {
    const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data as Buffer[]) : typeof data === "string" ? Buffer.from(data) : Buffer.from(data as ArrayBuffer);
    const msg = parseCdpMessage(buf);
    if (!msg) return;
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message || "erro do CDP"}`)); else p.resolve(msg.result ?? {});
      return;
    }
    if (msg.method) { try { this.onEvent(msg); } catch { /* um handler com bug não derruba a conexão */ } }
  }
  private fail(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    this.pending.clear();
    this.onClose();
  }
}

// ============================================================================ o gerenciador

export interface BrowserFrameMeta { pageId: string; seq: number; bytes: number; quality: number; width: number; height: number }

export interface BrowserManagerOptions {
  /** fábrica de WebSocket para o CDP (o host passa o `ws`) */
  connect: CdpSocketFactory;
  /** raiz dos perfis; padrão `~/.jarvis/browser` (perfil = subpasta; pidfile = `<perfil>.pid`) */
  rootDir?: string;
  /** undefined = descobre (env → Chrome → Edge → Chromium); null = sem navegador */
  executablePath?: string | null;
  /** perfis liberados neste host. Padrão: só "owner"; os hosts da F2 ligam também "agent" (perfil de
   *  SISTEMA da IA, separado, sem logins do dono). */
  allowedProfiles?: BrowserProfileName[];
  onState?: (state: BrowserStateInfo) => void;
  /** frame JÁ codificado (cabeçalho + JPEG cru), pronto para ir como mensagem binária */
  onFrame?: (frame: Buffer, meta: BrowserFrameMeta) => void;
  /** o link até o próximo salto escoou? false = segura o frame (o mais recente vence) */
  canSend?: () => boolean;
  log?: (event: string, data?: Record<string, unknown>) => void;
  /** desliga o Chrome após este tempo sem espectador nem ação (padrão 10 min; 0 = nunca) */
  idleMs?: number;
  maxFps?: number;
  /** teto da qualidade JPEG (a adaptativa desce a partir daqui) */
  quality?: number;
  minQuality?: number;
  window?: { width: number; height: number };
  maxPages?: number;
  launchTimeoutMs?: number;
  extraArgs?: string[];
}

interface PageRec {
  info: BrowserPageInfo;
  sessionId?: string;
  attaching?: Promise<string>;
  seq: number;
  view?: { maxWidth: number; maxHeight: number; quality: number; timer: ReturnType<typeof setInterval>; ticks: number; active?: boolean };
  latest: { data: Buffer; w: number; h: number; t0: number; blocked: boolean } | null;
  qc: QualityController;
  navTimer?: ReturnType<typeof setTimeout>;
  stats: { frames: number; sent: number; coalesced: number; blockedDrops: number };
}

/** Um Chrome (um perfil). O `BrowserManager` abaixo é a fachada que os hosts usam. */
class ProfileBrowser {
  private child: ChildProcess | null = null;
  private cdp: CdpConnection | null = null;
  private launching: Promise<void> | null = null;
  private stopping = false;
  private readonly pages = new Map<string, PageRec>();
  private readonly bySession = new Map<string, string>();
  private activePageId: string | undefined;
  private userAgent = "";
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = Date.now();
  private lastReason: string | undefined;
  private stderrTail = "";
  /** este processo já subiu um Chrome neste perfil (a varredura pós-kill só faz sentido então) */
  private launchedHere = false;
  /** kill em andamento: um launch novo espera, senão a varredura pós-kill mataria o Chrome NOVO */
  private killing: Promise<void> | null = null;
  readonly dir: string;
  readonly pidfile: string;

  constructor(readonly profile: BrowserProfileName, private readonly exe: string, private readonly o: Required<Pick<BrowserManagerOptions, "connect" | "rootDir" | "idleMs" | "maxFps" | "quality" | "minQuality" | "window" | "maxPages" | "launchTimeoutMs">> & BrowserManagerOptions) {
    this.dir = join(o.rootDir, profile);
    this.pidfile = join(o.rootDir, `${profile}.pid`);
  }

  get running(): boolean { return !!this.cdp && !this.cdp.closed; }
  get pid(): number | undefined { return this.child?.pid; }

  state(): BrowserStateInfo {
    return {
      profile: this.profile, running: this.running,
      pages: [...this.pages.values()].map((p) => ({ ...p.info, viewing: !!p.view })),
      ...(this.activePageId && this.pages.has(this.activePageId) ? { activePageId: this.activePageId } : {}),
      ...(this.lastReason && !this.running ? { reason: this.lastReason } : {}),
    };
  }
  hasPage(pageId: string): boolean { return this.pages.has(pageId); }

  private log(event: string, data?: Record<string, unknown>): void { try { this.o.log?.(event, { profile: this.profile, ...data }); } catch { /* log não derruba nada */ } }
  private touch(): void { this.lastActivity = Date.now(); }
  private scheduleState(): void {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => { this.stateTimer = null; this.emitStateNow(); }, 80);
    this.stateTimer.unref?.();
  }
  private emitStateNow(): void {
    if (this.stateTimer) { clearTimeout(this.stateTimer); this.stateTimer = null; }
    try { this.o.onState?.(this.state()); } catch { /* host com bug não derruba o browser */ }
  }

  async ensureRunning(): Promise<void> {
    this.touch();
    if (this.running) return;
    if (this.launching) return this.launching;
    this.launching = this.launch().finally(() => { this.launching = null; });
    return this.launching;
  }

  private async launch(): Promise<void> {
    if (this.killing) await this.killing.catch(() => {});
    const t0 = Date.now();
    this.stopping = false;
    mkdirSync(this.dir, { recursive: true });
    const reaped = await reapProfileProcesses(this.dir, { exeName: basename(this.exe), pidfile: this.pidfile });
    if (reaped.length) this.log("browser_reaped", { pids: reaped });
    const portFile = join(this.dir, "DevToolsActivePort");
    // Perfil persistente: o DevToolsActivePort da última execução continua no disco e apontaria
    // para uma porta morta.
    try { unlinkSync(portFile); } catch { /* não existia */ }
    const args = buildChromeArgs({ userDataDir: this.dir, width: this.o.window.width, height: this.o.window.height, isRoot: typeof process.getuid === "function" && process.getuid() === 0, extraArgs: this.o.extraArgs });
    const child = spawn(this.exe, args, { stdio: ["ignore", "ignore", "pipe"], detached: osPlatform() !== "win32", windowsHide: true });
    this.child = child;
    this.launchedHere = true;
    this.stderrTail = "";
    child.stderr?.on("data", (d: Buffer) => { this.stderrTail = (this.stderrTail + d.toString()).slice(-2000); });
    child.on("error", (e) => this.log("browser_spawn_error", { error: String(e?.message ?? e) }));
    child.once("exit", (code, signal) => this.onChildExit(child, code, signal));
    try { writeFileSync(this.pidfile, JSON.stringify({ pid: child.pid, exe: this.exe, userDataDir: this.dir, startedAt: Date.now(), host: process.pid })); } catch { /* pidfile é ajuda, não requisito */ }
    try {
      const { port, path } = await waitForDevToolsPort(portFile, child, this.o.launchTimeoutMs, () => this.stderrTail);
      const sock = this.o.connect(`ws://127.0.0.1:${port}${path}`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("CDP não respondeu ao conectar")), 10000);
        sock.on("open", () => { clearTimeout(timer); resolve(); });
        sock.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
      });
      const cdp = new CdpConnection(sock, (m) => this.onEvent(m), () => this.onCdpClosed(cdp));
      this.cdp = cdp;
      await cdp.call("Target.setDiscoverTargets", { discover: true });
      const ver = await cdp.call("Browser.getVersion").catch(() => ({}));
      this.userAgent = /Headless/.test(String(ver.userAgent || "")) ? headfulUserAgent(String(ver.userAgent)) : "";
      const { targetInfos = [] } = await cdp.call("Target.getTargets");
      for (const ti of targetInfos) if (ti?.type === "page") this.addPage(ti);
      if (!this.pages.size) await this.createTarget("about:blank");
      await Promise.all([...this.pages.values()].map((p) => this.attach(p).catch(() => "")));
      if (!this.activePageId || !this.pages.has(this.activePageId)) this.activePageId = this.pages.keys().next().value;
      this.lastReason = undefined;
      this.startIdleTimer();
      this.log("browser_launched", { ms: Date.now() - t0, pid: child.pid, exe: basename(this.exe), pages: this.pages.size });
      this.emitStateNow();
    } catch (e) {
      this.log("browser_launch_failed", { error: String((e as Error)?.message ?? e), stderr: this.stderrTail.slice(-400) });
      this.lastReason = "falha ao abrir: " + String((e as Error)?.message ?? e);
      // `stopping` evita que o exit/close do Chrome que estamos matando vire um segundo "encerrou".
      this.stopping = true;
      this.teardown();
      await this.kill();
      throw e;
    }
  }

  private onChildExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    this.child = null;
    try { unlinkSync(this.pidfile); } catch { /* ok */ }
    if (!this.stopping) {
      this.log("browser_exited", { code, signal });
      this.lastReason = "o Chrome encerrou";
      this.teardown();
      this.emitStateNow();
    }
  }
  private onCdpClosed(cdp: CdpConnection): void {
    if (this.cdp !== cdp) return;
    this.cdp = null;
    if (!this.stopping) {
      // O CDP caiu e o processo ficou? Sem CDP ele é só um órfão — mata.
      this.lastReason = "conexão com o Chrome caiu";
      this.log("browser_cdp_closed", {});
      void this.kill();
      this.teardown();
      this.emitStateNow();
    }
  }

  private teardown(): void {
    for (const p of this.pages.values()) { if (p.view) clearInterval(p.view.timer); if (p.navTimer) clearTimeout(p.navTimer); }
    this.pages.clear();
    this.bySession.clear();
    this.activePageId = undefined;
    if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null; }
  }

  private kill(): Promise<void> {
    if (this.killing) return this.killing;
    this.killing = this.killNow().finally(() => { this.killing = null; });
    return this.killing;
  }
  private async killNow(): Promise<void> {
    const child = this.child;
    try { this.cdp?.close(); } catch { /* ok */ }
    this.cdp = null;
    if (child && child.exitCode === null && child.pid) {
      await killProcessTree(child.pid);
      await waitExit(child, 3000);
    }
    this.child = null;
    // Varredura final pela linha de comando: um auxiliar que o Chrome cria no meio do taskkill escapa
    // da árvore (medido: o utilitário "quarantine" sobreviveu ao kill do Hub). Ninguém mais usa este
    // perfil agora, então tudo que ainda o carrega é órfão.
    if (this.launchedHere) await reapProfileProcesses(this.dir, { exeName: basename(this.exe), platform: osPlatform() }).catch(() => []);
    try { unlinkSync(this.pidfile); } catch { /* ok */ }
  }

  /** No boot do host: recolhe Chrome órfão deste perfil (host anterior morto à força) SEM esperar o
   *  primeiro `open`. Não mexe se o pidfile aponta um host ainda vivo (outro processo usa o perfil). */
  async reapOrphans(): Promise<number[]> {
    if (this.child || this.launching || !existsSync(this.dir)) return [];
    try {
      const pf = JSON.parse(readFileSync(this.pidfile, "utf8"));
      const host = Number(pf?.host) || 0;
      if (host && host !== process.pid && pidAlive(host)) return [];
    } catch { /* sem pidfile: segue para a varredura */ }
    const pids = await reapProfileProcesses(this.dir, { exeName: basename(this.exe), pidfile: this.pidfile });
    try { unlinkSync(this.pidfile); } catch { /* ok */ }
    if (pids.length) this.log("browser_reaped", { pids, at: "boot" });
    return pids;
  }

  /** Encerramento normal: Browser.close dá ao Chrome a chance de gravar cookies (login persiste);
   *  se não sair em 3 s, mata a árvore. O perfil fica no disco. */
  async shutdown(reason = "shutdown"): Promise<void> {
    if (this.launching) await this.launching.catch(() => {});
    if (!this.child && !this.cdp) return;
    this.stopping = true;
    const child = this.child;
    this.teardown();
    try { await this.cdp?.call("Browser.close", {}, undefined, 2000); } catch { /* segue para o kill */ }
    if (child) await waitExit(child, 3000);
    await this.kill();
    this.lastReason = reason;
    this.log("browser_stopped", { reason });
    this.emitStateNow();
  }

  /** Saída do processo hospedeiro: só dá para ser síncrono. */
  shutdownSync(): void {
    this.stopping = true;
    const pid = this.child?.pid;
    this.teardown();
    try { this.cdp?.close(); } catch { /* ok */ }
    this.cdp = null;
    if (pid && this.child?.exitCode === null) killProcessTreeSync(pid);
    this.child = null;
    try { unlinkSync(this.pidfile); } catch { /* ok */ }
  }

  private startIdleTimer(): void {
    if (this.idleTimer || !(this.o.idleMs > 0)) return;
    this.idleTimer = setInterval(() => {
      if (!this.running || [...this.pages.values()].some((p) => p.view)) return;
      if (Date.now() - this.lastActivity >= this.o.idleMs) void this.shutdown("idle");
    }, Math.min(30000, Math.max(1000, Math.floor(this.o.idleMs / 2))));
    this.idleTimer.unref?.();
  }

  // ---------------------------------------------------------------------------- páginas
  private addPage(ti: any): PageRec | undefined {
    const id = String(ti?.targetId || "");
    if (!id) return undefined;
    let p = this.pages.get(id);
    if (!p) {
      p = { info: { pageId: id, url: String(ti.url || ""), title: String(ti.title || "") }, seq: 0, latest: null, qc: new QualityController({ max: this.o.quality, min: this.o.minQuality }), stats: { frames: 0, sent: 0, coalesced: 0, blockedDrops: 0 } };
      if (ti.openerId) p.info.openerId = String(ti.openerId);
      this.pages.set(id, p);
    }
    return p;
  }

  private async createTarget(url: string): Promise<string> {
    const { targetId } = await this.call("Target.createTarget", { url });
    const p = this.addPage({ targetId, url, title: "" });
    if (p) await this.attach(p).catch(() => "");
    return String(targetId);
  }

  private async attach(p: PageRec): Promise<string> {
    if (p.sessionId) return p.sessionId;
    if (p.attaching) return p.attaching;
    p.attaching = (async () => {
      const { sessionId } = await this.call("Target.attachToTarget", { targetId: p.info.pageId, flatten: true });
      const sid = String(sessionId);
      this.bySession.set(sid, p.info.pageId);
      p.sessionId = sid;
      await Promise.all([
        this.call("Page.enable", {}, sid),
        this.userAgent ? this.call("Emulation.setUserAgentOverride", { userAgent: this.userAgent }, sid).catch(() => {}) : Promise.resolve(),
      ]);
      this.refreshNav(p, 0);
      return sid;
    })().finally(() => { p.attaching = undefined; });
    return p.attaching;
  }

  private call(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs?: number): Promise<any> {
    if (!this.cdp) return Promise.reject(new Error("browser não está aberto"));
    return this.cdp.call(method, params, sessionId, timeoutMs);
  }

  private page(pageId: string): PageRec {
    const p = this.pages.get(pageId);
    if (!p) throw new Error("aba não encontrada (fechada?)");
    return p;
  }

  private refreshNav(p: PageRec, delay = 120): void {
    if (p.navTimer) clearTimeout(p.navTimer);
    p.navTimer = setTimeout(async () => {
      p.navTimer = undefined;
      if (!p.sessionId || !this.pages.has(p.info.pageId)) return;
      try {
        // O Chrome não manda targetInfoChanged quando a página troca `document.title` por JS — o
        // título é relido aqui (carga, navegação e, para aba assistida, ~1/s pelo tick).
        const [h, ti] = await Promise.all([
          this.call("Page.getNavigationHistory", {}, p.sessionId),
          this.call("Target.getTargetInfo", { targetId: p.info.pageId }).catch(() => null),
        ]);
        const idx = Number(h.currentIndex), n = Array.isArray(h.entries) ? h.entries.length : 0;
        const back = idx > 0, fwd = idx >= 0 && idx < n - 1;
        let changed = false;
        if (back !== !!p.info.canGoBack || fwd !== !!p.info.canGoForward) { p.info.canGoBack = back; p.info.canGoForward = fwd; changed = true; }
        const info = ti?.targetInfo;
        if (info && (info.url !== p.info.url || info.title !== p.info.title)) { p.info.url = String(info.url || ""); p.info.title = String(info.title || ""); changed = true; }
        if (changed) this.scheduleState();
      } catch { /* aba fechando */ }
    }, delay);
    p.navTimer.unref?.();
  }

  private onEvent(m: CdpMessage): void {
    const params = m.params || {};
    switch (m.method) {
      case "Target.targetCreated":
      case "Target.targetInfoChanged": {
        const ti = params.targetInfo;
        if (ti?.type !== "page") return;
        const known = this.pages.has(ti.targetId);
        const p = this.addPage(ti);
        if (!p) return;
        if (p.info.url !== ti.url || p.info.title !== ti.title) { p.info.url = String(ti.url || ""); p.info.title = String(ti.title || ""); this.scheduleState(); }
        if (!known) { this.scheduleState(); if (this.running && !this.stopping) this.attach(p).catch(() => {}); }
        return;
      }
      case "Target.targetDestroyed": {
        const p = this.pages.get(params.targetId);
        if (!p) return;
        if (p.view) clearInterval(p.view.timer);
        if (p.navTimer) clearTimeout(p.navTimer);
        if (p.sessionId) this.bySession.delete(p.sessionId);
        this.pages.delete(params.targetId);
        if (this.activePageId === params.targetId) this.activePageId = this.pages.keys().next().value;
        // A última aba sumiu (window.close() da própria página): sem aba o painel fica sem o que mostrar.
        if (!this.pages.size && this.running && !this.stopping) this.createTarget("about:blank").then((id) => { this.activePageId = id; this.scheduleState(); }).catch(() => {});
        this.scheduleState();
        return;
      }
      case "Target.detachedFromTarget": {
        const pid = this.bySession.get(params.sessionId);
        if (!pid) return;
        this.bySession.delete(params.sessionId);
        const p = this.pages.get(pid);
        if (p) { p.sessionId = undefined; if (p.view) { clearInterval(p.view.timer); p.view = undefined; p.latest = null; this.scheduleState(); } }
        return;
      }
    }
    const pid = m.sessionId ? this.bySession.get(m.sessionId) : undefined;
    const p = pid ? this.pages.get(pid) : undefined;
    if (!p) return;
    switch (m.method) {
      case "Page.screencastFrame": this.onFrame(p, m); return;
      case "Page.frameNavigated": if (!params.frame?.parentId) this.refreshNav(p); return;
      case "Page.domContentEventFired":
      case "Page.loadEventFired": this.refreshNav(p, 0); return;
      case "Page.navigatedWithinDocument": if (params.frameId === p.info.pageId) this.refreshNav(p); return;
      case "Page.frameStartedLoading": if (params.frameId === p.info.pageId && !p.info.loading) { p.info.loading = true; this.scheduleState(); } return;
      case "Page.frameStoppedLoading": if (params.frameId === p.info.pageId && p.info.loading) { p.info.loading = false; this.scheduleState(); } return;
      case "Page.javascriptDialogOpening":
        p.info.dialog = { type: String(params.type || "alert"), message: String(params.message || "").slice(0, 2000), ...(params.type === "prompt" ? { defaultPrompt: String(params.defaultPrompt || "").slice(0, 2000) } : {}) };
        this.emitStateNow();
        return;
      case "Page.javascriptDialogClosed": if (p.info.dialog) { delete p.info.dialog; this.scheduleState(); } return;
    }
  }

  // -------------------------------------------------------------------------- screencast
  private onFrame(p: PageRec, m: CdpMessage): void {
    const params = m.params || {};
    // Confirma na hora: o Chrome não espera o ack frame a frame (medido no F0) e segurar o ack
    // não serve de teto. Quem limita o ritmo é o despacho abaixo.
    if (p.sessionId) this.cdp?.call("Page.screencastFrameAck", { sessionId: params.sessionId }, p.sessionId).catch(() => {});
    if (!p.view) return;
    const data = m.frameData ?? (typeof params.data === "string" ? Buffer.from(params.data, "latin1") : null);
    if (!data || !data.length) return;
    p.stats.frames++;
    if (p.latest) {
      if (p.latest.blocked) { p.stats.blockedDrops++; p.qc.record(0, 1); } else p.stats.coalesced++;
    }
    const md = params.metadata || {};
    p.latest = { data, w: Math.round(Number(md.deviceWidth) || 0), h: Math.round(Number(md.deviceHeight) || 0), t0: Date.now(), blocked: false };
  }

  private tick(p: PageRec): void {
    const v = p.view;
    if (!v) return;
    v.ticks++;
    if (v.ticks % Math.max(1, Math.round(this.o.maxFps)) === 0) {
      this.refreshNav(p, 0);
      const q = p.qc.evaluate();
      if (q != null && q !== v.quality) { v.quality = q; this.log("browser_quality", { pageId: p.info.pageId, quality: q }); this.startScreencast(p).catch(() => {}); }
    }
    const f = p.latest;
    if (!f) return;
    let ok = true;
    try { ok = this.o.canSend ? this.o.canSend() !== false : true; } catch { ok = true; }
    if (!ok) { f.blocked = true; return; }
    p.latest = null;
    const jpeg = Buffer.from(f.data.toString("latin1"), "base64");
    const header: BrowserFrameHeader = { pageId: p.info.pageId, seq: ++p.seq, t0: f.t0, width: f.w, height: f.h, quality: v.quality };
    const frame = encodeBrowserFrame(header, jpeg);
    p.stats.sent++;
    try { this.o.onFrame?.(frame, { pageId: p.info.pageId, seq: header.seq, bytes: frame.length, quality: v.quality, width: f.w, height: f.h }); } catch { /* host com bug */ }
  }

  private async startScreencast(p: PageRec): Promise<void> {
    const v = p.view;
    if (!v || !p.sessionId) return;
    // Trocar qualidade/largura com o screencast ligado: o Chrome recusa um segundo start ("Screencast
    // is already active"), então é parar e ligar de novo. O start manda um frame na hora, o que também
    // garante a tela atualizada para quem acabou de chegar.
    if (v.active) { v.active = false; await this.call("Page.stopScreencast", {}, p.sessionId).catch(() => {}); }
    await this.call("Page.startScreencast", { format: "jpeg", quality: v.quality, maxWidth: v.maxWidth, maxHeight: v.maxHeight, everyNthFrame: 1 }, p.sessionId);
    if (p.view === v) v.active = true;
  }

  async view(pageId: string, on: boolean, dims: { maxWidth?: number; maxHeight?: number } = {}): Promise<void> {
    this.touch();
    const p = this.page(pageId);
    if (!on) {
      if (!p.view) return;
      clearInterval(p.view.timer);
      p.view = undefined; p.latest = null;
      if (p.sessionId) await this.call("Page.stopScreencast", {}, p.sessionId).catch(() => {});
      this.log("browser_view_off", { pageId, ...p.stats });
      this.scheduleState();
      return;
    }
    await this.attach(p);
    const maxWidth = clampInt(dims.maxWidth, this.o.window.width, 160, 3840);
    const maxHeight = clampInt(dims.maxHeight, Math.max(maxWidth, this.o.window.height), 120, 3840);
    if (p.view && p.view.maxWidth === maxWidth && p.view.maxHeight === maxHeight) return;
    if (!p.view) {
      p.stats = { frames: 0, sent: 0, coalesced: 0, blockedDrops: 0 };
      p.view = { maxWidth, maxHeight, quality: p.qc.quality, ticks: 0, timer: setInterval(() => this.tick(p), Math.max(15, Math.round(1000 / this.o.maxFps))) };
      p.view.timer.unref?.();
    } else { p.view.maxWidth = maxWidth; p.view.maxHeight = maxHeight; }
    try { await this.startScreencast(p); }
    catch (e) { if (p.view) { clearInterval(p.view.timer); p.view = undefined; } throw e; }
    this.scheduleState();
  }

  feedback(pageId: string, delivered: number, dropped: number): void {
    const p = this.pages.get(pageId);
    if (p?.view) p.qc.record(delivered, dropped);
  }

  stopAllViews(): void {
    for (const p of this.pages.values()) if (p.view) void this.view(p.info.pageId, false).catch(() => {});
  }

  // ------------------------------------------------------------------------- abas e navegação
  async newTab(url?: string): Promise<string> {
    this.touch();
    if (this.pages.size >= this.o.maxPages) throw new Error(`limite de ${this.o.maxPages} abas atingido nesta máquina`);
    const target = url ? normalizeNavUrl(url) : "about:blank";
    if (!target) throw new Error("endereço inválido");
    const id = await this.createTarget(target);
    this.activePageId = id;
    this.emitStateNow();
    return id;
  }

  async closeTab(pageId: string): Promise<void> {
    this.touch();
    this.page(pageId);
    // Nunca fica sem aba: o painel sempre tem algo para mostrar e o Chrome não sai sozinho.
    if (this.pages.size === 1) await this.createTarget("about:blank");
    await this.call("Target.closeTarget", { targetId: pageId });
  }

  activate(pageId: string): void {
    this.touch();
    this.page(pageId);
    this.activePageId = pageId;
    this.call("Target.activateTarget", { targetId: pageId }).catch(() => {});
    this.scheduleState();
  }

  async navigate(pageId: string, nav: { url?: string; action?: string }): Promise<void> {
    this.touch();
    const p = this.page(pageId);
    const sid = await this.attach(p);
    if (typeof nav.url === "string") {
      const url = normalizeNavUrl(nav.url);
      if (!url) throw new Error("endereço inválido");
      await this.call("Page.navigate", { url }, sid);
      return;
    }
    if (nav.action === "reload") { await this.call("Page.reload", {}, sid); return; }
    if (nav.action === "stop") { await this.call("Page.stopLoading", {}, sid); return; }
    if (nav.action === "back" || nav.action === "forward") {
      const h = await this.call("Page.getNavigationHistory", {}, sid);
      const entry = Array.isArray(h.entries) ? h.entries[Number(h.currentIndex) + (nav.action === "back" ? -1 : 1)] : undefined;
      if (entry) await this.call("Page.navigateToHistoryEntry", { entryId: entry.id }, sid);
      return;
    }
    throw new Error("navegação inválida");
  }

  /** Input é disparo-e-esquece, na ORDEM de chegada (o CDP processa em ordem por sessão). */
  input(pageId: string, ev: BrowserInput): void {
    this.touch();
    const p = this.page(pageId);
    if (!p.sessionId) throw new Error("aba ainda conectando");
    for (const c of browserInputCommands(ev)) this.cdp?.call(c.method, c.params, p.sessionId).catch((e) => this.log("browser_input_error", { error: String(e?.message ?? e) }));
  }

  async setViewport(pageId: string, v: { width?: number; height?: number; mobile?: boolean; scale?: number } | null): Promise<void> {
    this.touch();
    const p = this.page(pageId);
    const sid = await this.attach(p);
    if (!v || !(Number(v.width) > 0)) {
      await this.call("Emulation.clearDeviceMetricsOverride", {}, sid);
      delete p.info.viewport;
    } else {
      const width = clampInt(v.width, 390, 200, 3840), height = clampInt(v.height, 800, 200, 3840), mobile = v.mobile === true;
      await this.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: clampNum(v.scale, 1, 1, 3), mobile }, sid);
      p.info.viewport = { width, height, mobile };
    }
    this.scheduleState();
  }

  async dialog(pageId: string, accept: boolean, promptText?: string): Promise<void> {
    this.touch();
    const p = this.page(pageId);
    const sid = await this.attach(p);
    await this.call("Page.handleJavaScriptDialog", { accept: !!accept, ...(typeof promptText === "string" ? { promptText: promptText.slice(0, 10000) } : {}) }, sid);
    delete p.info.dialog;
    this.scheduleState();
  }

  /** F2 — comando CDP na sessão da aba. USO INTERNO (ferramentas da IA com nível já checado, seleção de
   *  pontos do dono): nunca é exposto cru a ninguém — CDP cru = controle total do perfil (cookies, JS). */
  async pageCommand(pageId: string, method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<any> {
    this.touch();
    const p = this.page(pageId);
    const sid = await this.attach(p);
    return this.call(method, params, sid, timeoutMs);
  }
  pageInfo(pageId: string): BrowserPageInfo | undefined { const p = this.pages.get(pageId); return p ? { ...p.info } : undefined; }
}

async function waitForDevToolsPort(file: string, child: ChildProcess, timeoutMs: number, tail: () => string): Promise<{ port: number; path: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null || child.signalCode) throw new Error(`o Chrome saiu ao abrir (código ${child.exitCode ?? child.signalCode}) — perfil em uso por outra instância?${tail() ? " " + tail().trim().split("\n").slice(-2).join(" | ") : ""}`);
    // Chrome ≥ 136 recusa o CDP quando acha que o perfil é o "padrão" — e no Windows isso acontece
    // mesmo com --user-data-dir quando o USERPROFILE do processo não é o do usuário (medido: conta de
    // serviço / USERPROFILE trocado). Sem este aviso o erro seria um timeout de 20 s sem explicação.
    if (/requires a non-default data directory/i.test(tail())) throw new Error("o Chrome recusou o debug remoto neste ambiente (USERPROFILE do processo diferente do perfil do usuário — comum em conta de serviço). Rode o Hub/runner na conta do usuário.");
    try {
      const [portLine, pathLine] = readFileSync(file, "utf8").trim().split(/\r?\n/);
      const port = Number(portLine);
      if (port > 0 && port < 65536 && pathLine?.startsWith("/devtools/browser/")) return { port, path: pathLine };
    } catch { /* ainda não escreveu */ }
    if (Date.now() > deadline) throw new Error(`o Chrome não abriu o CDP em ${Math.round(timeoutMs / 1000)} s`);
    await sleep(50);
  }
}

function waitExit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
    child.once("exit", () => { clearTimeout(t); resolve(); });
  });
}

/**
 * Fachada usada pelo runner e pelo Hub: um `ProfileBrowser` por perfil, sob demanda (o Chrome só sobe
 * no primeiro `open`). Operações de página acham o perfil pelo `pageId`.
 */
export class BrowserManager {
  readonly executablePath: string | null;
  readonly unavailableReason: string | undefined;
  private readonly profiles = new Map<BrowserProfileName, ProfileBrowser>();
  private readonly o: ConstructorParameters<typeof ProfileBrowser>[2];
  private readonly allowed: Set<BrowserProfileName>;

  constructor(opts: BrowserManagerOptions) {
    const found: BrowserDiscovery = opts.executablePath === undefined ? resolveBrowserExecutable() : opts.executablePath ? { path: opts.executablePath } : { path: null, reason: "sem navegador" };
    this.executablePath = found.path;
    this.unavailableReason = found.path ? undefined : found.reason;
    this.allowed = new Set(opts.allowedProfiles?.length ? opts.allowedProfiles : ["owner"]);
    this.o = {
      ...opts,
      rootDir: opts.rootDir || join(homedir(), ".jarvis", "browser"),
      idleMs: opts.idleMs ?? 10 * 60 * 1000,
      maxFps: clampNum(opts.maxFps, 15, 1, 60),
      quality: clampInt(opts.quality, 60, 10, 95),
      minQuality: clampInt(opts.minQuality, 30, 5, 95),
      window: { width: clampInt(opts.window?.width, 1280, 320, 3840), height: clampInt(opts.window?.height, 800, 240, 3840) },
      maxPages: clampInt(opts.maxPages, 12, 1, 50),
      launchTimeoutMs: clampInt(opts.launchTimeoutMs, 20000, 1000, 120000),
    };
  }

  get available(): boolean { return !!this.executablePath; }

  private profile(name: BrowserProfileName): ProfileBrowser {
    if (!this.executablePath) throw new Error(this.unavailableReason || "browser indisponível nesta máquina");
    if (!this.allowed.has(name)) throw new Error(`perfil "${name}" não está liberado nesta versão`);
    let p = this.profiles.get(name);
    if (!p) { p = new ProfileBrowser(name, this.executablePath, this.o); this.profiles.set(name, p); }
    return p;
  }
  private byPage(pageId: string): ProfileBrowser {
    for (const p of this.profiles.values()) if (p.hasPage(pageId)) return p;
    throw new Error("aba não encontrada (fechada?)");
  }

  /** Sobe o Chrome do perfil se preciso (lazy) e devolve o estado. */
  async open(profile: BrowserProfileName = "owner"): Promise<BrowserStateInfo> {
    const p = this.profile(profile);
    await p.ensureRunning();
    return p.state();
  }
  state(profile: BrowserProfileName = "owner"): BrowserStateInfo {
    const p = this.profiles.get(profile);
    return p ? p.state() : { profile, running: false, pages: [] };
  }
  isRunning(profile: BrowserProfileName = "owner"): boolean { return !!this.profiles.get(profile)?.running; }
  /** Chame no boot do host (assíncrono, fora do caminho crítico): recolhe Chrome órfão dos perfis
   *  liberados que já existem no disco. Devolve os PIDs mortos. */
  async reapOrphans(): Promise<number[]> {
    if (!this.executablePath) return [];
    const out: number[] = [];
    for (const name of this.allowed) out.push(...await this.profile(name).reapOrphans().catch(() => [] as number[]));
    return out;
  }
  pid(profile: BrowserProfileName = "owner"): number | undefined { return this.profiles.get(profile)?.pid; }
  userDataDir(profile: BrowserProfileName = "owner"): string { return join(this.o.rootDir, profile); }

  async tab(op: "new" | "close" | "activate", args: { pageId?: string; url?: string; profile?: BrowserProfileName } = {}): Promise<string | undefined> {
    if (op === "new") { const p = this.profile(args.profile || "owner"); await p.ensureRunning(); return p.newTab(args.url); }
    if (!args.pageId) throw new Error("aba não informada");
    const p = this.byPage(args.pageId);
    if (op === "close") { await p.closeTab(args.pageId); return undefined; }
    if (op === "activate") { p.activate(args.pageId); return args.pageId; }
    throw new Error("operação de aba inválida");
  }
  navigate(pageId: string, nav: { url?: string; action?: string }): Promise<void> { return this.byPage(pageId).navigate(pageId, nav); }
  input(pageId: string, ev: BrowserInput): void { this.byPage(pageId).input(pageId, ev); }
  /** Liga/desliga o screencast. Desligar uma aba que já sumiu não é erro (o espectador só saiu). */
  async view(pageId: string, on: boolean, dims: { maxWidth?: number; maxHeight?: number } = {}): Promise<void> {
    let p: ProfileBrowser;
    try { p = this.byPage(pageId); } catch (e) { if (!on) return; throw e; }
    await p.view(pageId, on, dims);
  }
  feedback(pageId: string, delivered: number, dropped: number): void { for (const p of this.profiles.values()) if (p.hasPage(pageId)) p.feedback(pageId, delivered, dropped); }
  setViewport(pageId: string, v: { width?: number; height?: number; mobile?: boolean; scale?: number } | null): Promise<void> { return this.byPage(pageId).setViewport(pageId, v); }
  dialog(pageId: string, accept: boolean, promptText?: string): Promise<void> { return this.byPage(pageId).dialog(pageId, accept, promptText); }
  /** F2 — o perfil liberado neste host? (o host decide: F1 só "owner"; F2 liga também "agent") */
  allows(profile: BrowserProfileName): boolean { return this.allowed.has(profile); }
  /** F2 — de qual perfil é esta aba (undefined = não existe). É o que impede um pageId do perfil do dono
   *  de entrar por uma ferramenta liberada só para o perfil do agente. */
  profileOf(pageId: string): BrowserProfileName | undefined { for (const [name, p] of this.profiles) if (p.hasPage(pageId)) return name; return undefined; }
  pageInfo(pageId: string): BrowserPageInfo | undefined { for (const p of this.profiles.values()) { const i = p.pageInfo(pageId); if (i) return i; } return undefined; }
  /** F2 — CDP interno na aba (ver `ProfileBrowser.pageCommand`). Quem chama já aplicou o nível. */
  pageCommand(pageId: string, method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<any> { return this.byPage(pageId).pageCommand(pageId, method, params, timeoutMs); }
  /** Ninguém mais consegue assistir (o Hub caiu): para todo screencast; o idle cuida do resto. */
  stopAllViews(): void { for (const p of this.profiles.values()) p.stopAllViews(); }
  async shutdown(profile?: BrowserProfileName, reason = "shutdown"): Promise<void> {
    const list = profile ? [this.profiles.get(profile)].filter((p): p is ProfileBrowser => !!p) : [...this.profiles.values()];
    await Promise.all(list.map((p) => p.shutdown(reason)));
  }
  shutdownSync(): void { for (const p of this.profiles.values()) p.shutdownSync(); }
}

// ================================================================================== util

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}
function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
