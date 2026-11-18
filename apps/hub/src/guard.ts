/**
 * guard.ts — defensive layers for when the Hub is exposed beyond a private network
 * (e.g. a public server, not just Tailscale). Independent of auth: these blunt
 * brute-force, connection floods, and payload DoS BEFORE the auth gate.
 *
 * Env:
 *   JARVIS_TRUST_PROXY=on     read X-Forwarded-For for the real client IP (set ONLY
 *                             when actually behind a trusted proxy; otherwise spoofable).
 *                             A number N = N trusted proxies in a chain (on/true/1 = one).
 *   JARVIS_MAX_CONN_PER_IP    max concurrent connections per IP (default 40)
 *   JARVIS_MAX_CONN           max concurrent connections total (default 800)
 *   JARVIS_MAX_PAYLOAD_MB     max WS message size in MB (default 20)
 *   JARVIS_ALLOWED_ORIGINS    comma-separated Origin allowlist for UI clients (default: only
 *                             the Hub's own origin; clients with no Origin header are unaffected)
 */
/** Quantos proxies confiáveis estão à frente do Hub: "on"/"true"/"1" = 1, um número N = N em cadeia, resto = 0. */
export function parseTrustProxy(raw: string | undefined): number {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "on" || v === "true") return 1;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 10) : 0;
}
export const TRUST_PROXY_HOPS = parseTrustProxy(process.env.JARVIS_TRUST_PROXY);
const REQUIRE_TLS = /^(on|1|true)$/i.test(process.env.JARVIS_REQUIRE_TLS || "");
export const MAX_PAYLOAD = Math.max(1, Number(process.env.JARVIS_MAX_PAYLOAD_MB || 20)) * 1024 * 1024;
const MAX_PER_IP = Number(process.env.JARVIS_MAX_CONN_PER_IP || 40);
const MAX_TOTAL = Number(process.env.JARVIS_MAX_CONN || 800);
const ALLOWED_ORIGINS = (process.env.JARVIS_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * O cliente segundo o X-Forwarded-For, confiando só no que os `hops` proxies NOSSOS escreveram.
 *
 * Cada proxy ACRESCENTA no fim o IP de quem falou com ele; tudo antes disso veio do próprio cliente e
 * pode ser inventado. Pegar o PRIMEIRO valor (como era) deixava o atacante trocar de "IP" a cada
 * tentativa só mudando o cabeçalho e escapar do limitador de senha. O certo é o `hops`-ésimo a partir do
 * fim: com 1 proxy, o último; com N em cadeia, o que o primeiro deles anotou. Cadeia mais curta que o
 * configurado (não passou por todos) → todos os valores são de proxies nossos: vale o primeiro.
 */
export function forwardedClientIp(xff: string | string[] | undefined, hops: number): string | undefined {
  const raw = Array.isArray(xff) ? xff.join(",") : xff;
  if (typeof raw !== "string" || hops < 1) return undefined;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  const ip = parts.length >= hops ? parts[parts.length - hops] : parts[0];
  return ip.replace(/^::ffff:/, "");
}

export function clientIp(req: any): string {
  if (TRUST_PROXY_HOPS > 0) {
    const ip = forwardedClientIp(req?.headers?.["x-forwarded-for"], TRUST_PROXY_HOPS);
    if (ip) return ip;
  }
  return String(req?.socket?.remoteAddress || "").replace(/^::ffff:/, "") || "?";
}
export function isLoopback(ip: string): boolean { return ip === "127.0.0.1" || ip === "::1"; }

/** True if the request likely arrived over plaintext (no TLS) from a non-local peer. */
export function isInsecurePublic(req: any): boolean {
  const ip = clientIp(req);
  if (isLoopback(ip)) return false;
  const proto = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  return proto !== "https"; // behind TLS-terminating proxy this header is https
}
/** With JARVIS_REQUIRE_TLS=on, non-loopback plaintext connections are refused (fail-closed). */
export function tlsRequiredButMissing(req: any): boolean { return REQUIRE_TLS && isInsecurePublic(req); }

/**
 * Quem pode ABRIR um socket de UI.
 *
 * WebSocket nao passa por CORS: qualquer pagina que o dono visitar consegue discar o Hub (inclusive
 * `ws://127.0.0.1:4577`) e o navegador manda a conexao normalmente. A resposta ate fica invisivel
 * para o site, mas o ENVIO nao — e mandar ja e o suficiente para qualquer rota que nao exija login.
 * Por isso o padrao aqui deixou de ser "qualquer origem": um cliente de navegador so entra se a
 * pagina dele veio DESTE Hub.
 *
 * Cliente que nao e navegador (runner, CLI, ponte MCP, o app Electron carregando a UI) nao manda
 * `Origin` — esse caso continua liberado, senao a maquina remota nao registra.
 * `JARVIS_ALLOWED_ORIGINS` continua sendo a lista explicita para quem serve a UI de outro nome.
 */
export function originAllowed(req: any): boolean {
  const o = String(req?.headers?.origin || "");
  if (!o) return true; // sem Origin = nao e navegador
  if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.includes(o);
  const host = String(req?.headers?.host || "");
  if (!host) return false; // sem Host nao da para comparar: fecha
  try { return new URL(o).host === host; } catch { return false; } // "null" (sandbox/file://) cai aqui
}

// ---- per-IP brute-force limiter for the auth handshake ----
//
// 10 falhas em 60 s bloqueiam 30 s; DEPOIS disso cada nova falha bloqueia de novo com o dobro do tempo,
// até 15 min. A marca de "já bloqueado" (`strikes`) só some com um acerto ou após STRIKE_MEMORY sem
// nenhuma falha. Antes a escalada nunca saía do lugar: a janela de 60 s contada da 1ª falha zerava a
// contagem (e a limpeza periódica apagava o IP assim que o bloqueio vencia) — ~10 senhas a cada 1,5 min,
// para sempre. Agora, no regime de ataque, sobra 1 tentativa a cada 15 min.
interface Bucket { fails: number; until: number; first: number; strikes: number; last: number; }
const buckets = new Map<string, Bucket>();
const WINDOW = 60_000, MAX_FAILS = 10, BASE_BLOCK = 30_000, MAX_BLOCK = 15 * 60_000;
const STRIKE_MEMORY = 60 * 60_000;

/** Remaining block time in ms (0 = not blocked). */
export function blockedFor(ip: string, now = Date.now()): number { const b = buckets.get(ip); return b && b.until > now ? b.until - now : 0; }
/** Record a failed auth attempt; returns whether the IP is now blocked and for how long. */
export function recordFail(ip: string, now = Date.now()): { blocked: boolean; retryMs: number; fails: number } {
  let b = buckets.get(ip);
  if (!b || now - b.last > STRIKE_MEMORY) { b = { fails: 0, until: 0, first: now, strikes: 0, last: now }; buckets.set(ip, b); }
  if (now - b.first > WINDOW) { b.fails = 0; b.first = now; } // a JANELA reinicia; os strikes, não
  b.last = now;
  b.fails++;
  if (b.strikes > 0 || b.fails >= MAX_FAILS) {
    b.strikes++;
    b.until = now + Math.min(BASE_BLOCK * Math.pow(2, b.strikes - 1), MAX_BLOCK);
    return { blocked: true, retryMs: b.until - now, fails: b.fails };
  }
  return { blocked: false, retryMs: 0, fails: b.fails };
}
export function recordSuccess(ip: string): void { buckets.delete(ip); }

// ---- concurrent-connection caps (per IP + global) ----
const perIp = new Map<string, number>();
let total = 0;
export function connOpen(ip: string): boolean {
  if (total >= MAX_TOTAL) return false;
  const c = perIp.get(ip) || 0;
  if (!isLoopback(ip) && c >= MAX_PER_IP) return false;
  perIp.set(ip, c + 1); total++; return true;
}
export function connClose(ip: string): void {
  const c = (perIp.get(ip) || 1) - 1;
  if (c <= 0) perIp.delete(ip); else perIp.set(ip, c);
  total = Math.max(0, total - 1);
}
export function stats(): { total: number; ips: number; blocked: number } {
  const now = Date.now(); let blocked = 0; for (const b of buckets.values()) if (b.until > now) blocked++;
  return { total, ips: perIp.size, blocked };
}

// periodic cleanup of stale buckets
// Só sai quem está sem bloqueio E sem falha há STRIKE_MEMORY — apagar antes zerava a escalada.
const t = setInterval(() => { const now = Date.now(); for (const [ip, b] of buckets) if (b.until < now && now - b.last > STRIKE_MEMORY) buckets.delete(ip); }, 5 * 60_000);
(t as any).unref?.();
