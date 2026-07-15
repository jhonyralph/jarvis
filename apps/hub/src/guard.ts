/**
 * guard.ts — defensive layers for when the Hub is exposed beyond a private network
 * (e.g. a public server, not just Tailscale). Independent of auth: these blunt
 * brute-force, connection floods, and payload DoS BEFORE the auth gate.
 *
 * Env:
 *   JARVIS_TRUST_PROXY=on     read X-Forwarded-For for the real client IP (set ONLY
 *                             when actually behind a trusted proxy; otherwise spoofable)
 *   JARVIS_MAX_CONN_PER_IP    max concurrent connections per IP (default 40)
 *   JARVIS_MAX_CONN           max concurrent connections total (default 800)
 *   JARVIS_MAX_PAYLOAD_MB     max WS message size in MB (default 20)
 *   JARVIS_ALLOWED_ORIGINS    comma-separated Origin allowlist for UI clients (default: any)
 */
const TRUST_PROXY = /^(on|1|true)$/i.test(process.env.JARVIS_TRUST_PROXY || "");
export const MAX_PAYLOAD = Math.max(1, Number(process.env.JARVIS_MAX_PAYLOAD_MB || 20)) * 1024 * 1024;
const MAX_PER_IP = Number(process.env.JARVIS_MAX_CONN_PER_IP || 40);
const MAX_TOTAL = Number(process.env.JARVIS_MAX_CONN || 800);
const ALLOWED_ORIGINS = (process.env.JARVIS_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

export function clientIp(req: any): string {
  if (TRUST_PROXY) {
    const xff = req?.headers?.["x-forwarded-for"];
    if (typeof xff === "string" && xff) return xff.split(",")[0].trim().replace(/^::ffff:/, "");
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

/** Origin allowlist for UI clients (no-op unless JARVIS_ALLOWED_ORIGINS is set). */
export function originAllowed(req: any): boolean {
  if (!ALLOWED_ORIGINS.length) return true;
  const o = String(req?.headers?.origin || "");
  return !o || ALLOWED_ORIGINS.includes(o);
}

// ---- per-IP brute-force limiter for the auth handshake ----
interface Bucket { fails: number; until: number; first: number; }
const buckets = new Map<string, Bucket>();
const WINDOW = 60_000, MAX_FAILS = 10, BASE_BLOCK = 30_000, MAX_BLOCK = 15 * 60_000;

/** Remaining block time in ms (0 = not blocked). */
export function blockedFor(ip: string): number { const b = buckets.get(ip); return b && b.until > Date.now() ? b.until - Date.now() : 0; }
/** Record a failed auth attempt; returns whether the IP is now blocked and for how long. */
export function recordFail(ip: string): { blocked: boolean; retryMs: number; fails: number } {
  const now = Date.now(); let b = buckets.get(ip);
  if (!b || now - b.first > WINDOW) { b = { fails: 0, until: 0, first: now }; buckets.set(ip, b); }
  b.fails++;
  if (b.fails >= MAX_FAILS) { const over = b.fails - MAX_FAILS; b.until = now + Math.min(BASE_BLOCK * Math.pow(2, over), MAX_BLOCK); return { blocked: true, retryMs: b.until - now, fails: b.fails }; }
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
const t = setInterval(() => { const now = Date.now(); for (const [ip, b] of buckets) if (b.until < now && now - b.first > WINDOW) buckets.delete(ip); }, 5 * 60_000);
(t as any).unref?.();
