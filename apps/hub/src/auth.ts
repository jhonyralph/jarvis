/**
 * Jarvis auth — device pairing by invite (decision 4a–4e in docs/multi-runner.md).
 *
 * Access to the Hub == a shell on the target machine (agents run bypassPermissions),
 * so auth is mandatory for any non-loopback access. Model:
 *  - per-DEVICE tokens (high-entropy random); only a SHA-256 hash is stored.
 *  - first run is UNCLAIMED: a one-time claim code (also stored hashed, plaintext
 *    written to ~/.jarvis/claim-code.txt) lets the first device become OWNER.
 *  - owner mints INVITES (role + allowed runners + TTL); a new device redeems one
 *    and gets its own token. No passwords.
 *  - roles: owner (all runners) / member (per-runner allowlist).
 *  - runner<->hub uses separate per-runner tokens (infra, not users).
 *
 * Storage: ~/.jarvis/auth.json (hashes only). Escape hatch: JARVIS_AUTH=off.
 */
import { randomBytes, createHash, timingSafeEqual, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env.JARVIS_HOME || homedir();
const DIR = join(HOME, ".jarvis");
const AUTH_FILE = join(DIR, "auth.json");
const CLAIM_FILE = join(DIR, "claim-code.txt");
const AUDIT_FILE = join(DIR, "audit.log");

// ---- audit (append-only attribution; see docs/multi-runner.md 4d) ----
export function audit(event: string, info: { userId?: string; deviceId?: string; runnerId?: string; ip?: string; detail?: string } = {}): void {
  try { appendFileSync(AUDIT_FILE, JSON.stringify({ ts: Date.now(), event, ...info }) + "\n"); } catch { /* never block on audit */ }
}
export function readAudit(limit = 100): any[] {
  try {
    const lines = readFileSync(AUDIT_FILE, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(limit, 1000))).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  } catch { return []; }
}
try { mkdirSync(DIR, { recursive: true }); } catch { /* ignore */ }

export const AUTH_ENABLED = (process.env.JARVIS_AUTH || "on").toLowerCase() !== "off";
// Opt-in: auto-revoke a device token unused for this many days (0 = never expire).
const DEVICE_TTL_MS = Math.max(0, Number(process.env.JARVIS_DEVICE_TTL_DAYS || 0)) * 86400000;

export type Role = "owner" | "member";
export interface User { id: string; role: Role; name: string; createdAt: number; }
export interface Device { id: string; userId: string; label: string; tokenHash: string; createdAt: number; lastSeen: number; ip?: string; ua?: string; expiresAt?: number; }
export interface Invite { id: string; codeHash: string; role: Role; runners: string[]; expiresAt: number; deviceTtlSec?: number; createdBy: string; createdAt: number; usedAt?: number; usedBy?: string; }
export interface RunnerToken { runnerId: string; label: string; tokenHash: string; createdAt: number; lastSeen: number; }
interface AuthData {
  version: 1;
  claimed: boolean;
  pendingClaimHash?: string;
  users: User[];
  devices: Device[];
  invites: Invite[];
  runnerTokens: RunnerToken[];
  grants: Record<string, string[]>; // userId -> allowed runnerIds (members only)
  passSalt?: string; // owner passphrase (2nd factor), scrypt
  passHash?: string;
}

function fresh(): AuthData {
  return { version: 1, claimed: false, users: [], devices: [], invites: [], runnerTokens: [], grants: {} };
}
function load(): AuthData {
  try {
    const d = JSON.parse(readFileSync(AUTH_FILE, "utf8")) as AuthData;
    // tolerate older/partial files
    return { ...fresh(), ...d, grants: d.grants || {} };
  } catch { return fresh(); }
}
function save(d: AuthData): void { writeFileSync(AUTH_FILE, JSON.stringify(d, null, 2)); }

let data = load();

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url"); // ~43 chars
const newCode = () => randomBytes(18).toString("base64url"); // ~24 chars, human-pasteable
const newId = () => randomBytes(8).toString("hex");
function hashEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- claim (first-run owner bootstrap) ----
export function isClaimed(): boolean { return data.claimed; }

/** Ensure a one-time claim code exists while unclaimed; returns the plaintext (for the log/file). */
export function ensureClaimCode(): string | null {
  if (data.claimed) return null;
  if (data.pendingClaimHash && existsSync(CLAIM_FILE)) {
    try { return readFileSync(CLAIM_FILE, "utf8").trim(); } catch { /* regen below */ }
  }
  const code = newCode();
  data.pendingClaimHash = sha(code);
  save(data);
  try { writeFileSync(CLAIM_FILE, code + "\n"); } catch { /* ignore */ }
  return code;
}

export interface AuthResult { token: string; user: { id: string; role: Role; name: string }; deviceId: string; }

/** Redeem the claim code to create the OWNER + first device. One-time. */
export function claim(code: string, label: string, meta?: { ip?: string; ua?: string }): AuthResult {
  if (data.claimed) throw new Error("já reivindicado");
  if (!data.pendingClaimHash || !hashEq(sha(code), data.pendingClaimHash)) throw new Error("código de claim inválido");
  const user: User = { id: newId(), role: "owner", name: "Owner", createdAt: Date.now() };
  const res = issueDevice(user, label, meta);
  data.claimed = true;
  data.pendingClaimHash = undefined;
  data.users.push(user);
  save(data);
  try { rmSync(CLAIM_FILE, { force: true }); } catch { /* ignore */ }
  audit("claim", { userId: user.id, deviceId: res.deviceId, ip: meta?.ip, detail: `owner "${label}"` });
  return res;
}

// ---- invites (owner shares access) ----
export function mintInvite(byUserId: string, opts: { role?: Role; runners?: string[]; ttlSec?: number }): { code: string; invite: Omit<Invite, "codeHash"> } {
  const code = newCode();
  // ttlSec is the granted-access duration: it's how long the invited DEVICE keeps access AND
  // (capped at 1y) the window to redeem the code. ttlSec 0 = never expires (permanent device).
  const ttl = opts.ttlSec ?? 3600;
  const YEAR = 365 * 24 * 3600;
  const inv: Invite = {
    id: newId(),
    codeHash: sha(code),
    role: opts.role || "member",
    runners: opts.runners || [],
    expiresAt: Date.now() + (ttl > 0 ? Math.min(ttl, YEAR) : YEAR) * 1000,
    deviceTtlSec: ttl > 0 ? ttl : 0,
    createdBy: byUserId,
    createdAt: Date.now(),
  };
  data.invites.push(inv);
  save(data);
  audit("mint_invite", { userId: byUserId, detail: `${inv.role} · ttl ${Math.round((inv.expiresAt - inv.createdAt) / 1000)}s` });
  const { codeHash, ...pub } = inv;
  return { code, invite: pub };
}

export function listInvites(): Array<Omit<Invite, "codeHash">> {
  const now = Date.now();
  return data.invites.filter((i) => !i.usedAt && i.expiresAt > now).map(({ codeHash, ...pub }) => pub);
}
export function revokeInvite(id: string): boolean {
  const before = data.invites.length;
  data.invites = data.invites.filter((i) => i.id !== id);
  if (data.invites.length !== before) { save(data); return true; }
  return false;
}

export function redeem(code: string, label: string, meta?: { ip?: string; ua?: string }): AuthResult {
  const h = sha(code);
  const inv = data.invites.find((i) => !i.usedAt && i.expiresAt > Date.now() && hashEq(i.codeHash, h));
  if (!inv) throw new Error("convite inválido ou expirado");
  const user: User = { id: newId(), role: inv.role, name: label || "Convidado", createdAt: Date.now() };
  const res = issueDevice(user, label, meta, inv.deviceTtlSec);
  if (inv.role === "member") data.grants[user.id] = [...(inv.runners || [])];
  inv.usedAt = Date.now();
  inv.usedBy = user.id;
  data.users.push(user);
  save(data);
  audit("redeem", { userId: user.id, deviceId: res.deviceId, ip: meta?.ip, detail: `${inv.role} "${label}"` });
  return res;
}

function issueDevice(user: User, label: string, meta?: { ip?: string; ua?: string }, deviceTtlSec?: number): AuthResult {
  const token = newToken();
  const dev: Device = {
    id: newId(), userId: user.id, label: label || "Dispositivo",
    tokenHash: sha(token), createdAt: Date.now(), lastSeen: Date.now(), ip: meta?.ip, ua: meta?.ua,
    expiresAt: deviceTtlSec && deviceTtlSec > 0 ? Date.now() + deviceTtlSec * 1000 : undefined,
  };
  data.devices.push(dev);
  // note: caller pushes user + saves (claim/redeem); here we mutate devices in place
  return { token, user: { id: user.id, role: user.role, name: user.name }, deviceId: dev.id };
}

// ---- session auth (every WS connection) ----
export interface Principal { user: User; device: Device; }
export function authenticate(token: string, meta?: { ip?: string; ua?: string }): Principal | null {
  const h = sha(token);
  const device = data.devices.find((d) => hashEq(d.tokenHash, h));
  if (!device) return null;
  // hard access-window expiry (set from the invite's "validade")
  if (device.expiresAt && Date.now() > device.expiresAt) {
    data.devices = data.devices.filter((d) => d.id !== device.id); save(data);
    audit("device_expired", { deviceId: device.id, ip: meta?.ip, detail: "validade do acesso expirou" });
    return null;
  }
  if (DEVICE_TTL_MS && Date.now() - device.lastSeen > DEVICE_TTL_MS) {
    data.devices = data.devices.filter((d) => d.id !== device.id); save(data);
    audit("device_expired", { deviceId: device.id, ip: meta?.ip, detail: `ocioso > ${process.env.JARVIS_DEVICE_TTL_DAYS}d` });
    return null;
  }
  const user = data.users.find((u) => u.id === device.userId);
  if (!user) return null;
  device.lastSeen = Date.now();
  if (meta?.ip) device.ip = meta.ip;
  if (meta?.ua) device.ua = meta.ua;
  save(data);
  return { user, device };
}

// ---- devices management ----
export function listDevices(): Array<Omit<Device, "tokenHash"> & { role: Role; userName: string }> {
  return data.devices.map((d) => {
    const u = data.users.find((x) => x.id === d.userId);
    const { tokenHash, ...pub } = d;
    return { ...pub, role: u?.role || "member", userName: u?.name || "?" };
  });
}
/** Change a device's role (owner/member). Refuses to demote the last owner. */
export function setDeviceRole(deviceId: string, role: Role): boolean {
  const dev = data.devices.find((d) => d.id === deviceId);
  if (!dev) return false;
  const user = data.users.find((u) => u.id === dev.userId);
  if (!user) return false;
  if (user.role === "owner" && role !== "owner") {
    if (data.users.filter((u) => u.role === "owner").length <= 1) return false; // keep at least one owner
  }
  user.role = role;
  if (role === "member" && !data.grants[user.id]) data.grants[user.id] = [];
  save(data);
  audit("set_role", { deviceId, detail: `${dev.label} -> ${role}` });
  return true;
}

export function revokeDevice(deviceId: string): boolean {
  const dev = data.devices.find((d) => d.id === deviceId);
  const before = data.devices.length;
  data.devices = data.devices.filter((d) => d.id !== deviceId);
  if (data.devices.length !== before) { save(data); audit("revoke_device", { deviceId, detail: dev?.label }); return true; }
  return false;
}
export function revokeAllExcept(deviceId: string): number {
  const before = data.devices.length;
  data.devices = data.devices.filter((d) => d.id === deviceId);
  save(data);
  return before - data.devices.length;
}

// ---- authorization (per-runner) ----
export function allowedRunners(userId: string): "*" | string[] {
  const u = data.users.find((x) => x.id === userId);
  if (u?.role === "owner") return "*";
  return data.grants[userId] || [];
}
export function canAccessRunner(userId: string, runnerId: string): boolean {
  const a = allowedRunners(userId);
  return a === "*" || a.includes(runnerId);
}
export function setGrants(userId: string, runners: string[]): void { data.grants[userId] = runners; save(data); }

// ---- runner<->hub tokens (infra) ----
export function mintRunnerToken(runnerId: string, label: string): string {
  const token = newToken();
  data.runnerTokens = data.runnerTokens.filter((r) => r.runnerId !== runnerId); // one active token per runnerId
  data.runnerTokens.push({ runnerId, label, tokenHash: sha(token), createdAt: Date.now(), lastSeen: 0 });
  save(data);
  return token;
}
export function authenticateRunner(token: string): RunnerToken | null {
  const h = sha(token);
  const rt = data.runnerTokens.find((r) => hashEq(r.tokenHash, h));
  if (!rt) return null;
  rt.lastSeen = Date.now();
  save(data);
  return rt;
}
export function listRunnerTokens(): Array<Omit<RunnerToken, "tokenHash">> {
  return data.runnerTokens.map(({ tokenHash, ...pub }) => pub);
}
/** After a runner registers, bind the token it used to the runner's REAL id (+ label) — the
 *  runner picks its own runnerId, so without this the token stays under its mint-time id and
 *  the machines list can never line the two up. */
export function bindRunnerToken(token: string, runnerId: string, label?: string): boolean {
  const rt = data.runnerTokens.find((r) => hashEq(r.tokenHash, sha(token)));
  if (!rt) return false;
  if (rt.runnerId === runnerId && (!label || rt.label === label)) return false;
  data.runnerTokens = data.runnerTokens.filter((r) => r === rt || r.runnerId !== runnerId); // drop stale duplicate
  rt.runnerId = runnerId;
  if (label) rt.label = label;
  save(data);
  return true;
}
export function revokeRunnerToken(runnerId: string): boolean {
  const before = data.runnerTokens.length;
  data.runnerTokens = data.runnerTokens.filter((r) => r.runnerId !== runnerId);
  if (data.runnerTokens.length !== before) { save(data); return true; }
  return false;
}

// ---- owner passphrase (optional 2nd factor) ----
export function hasPassphrase(): boolean { return !!(data.passHash && data.passSalt); }
export function setPassphrase(pass: string): void {
  if (!pass || pass.length < 4) throw new Error("senha muito curta (mín. 4)");
  const salt = randomBytes(16).toString("hex");
  data.passSalt = salt;
  data.passHash = scryptSync(pass, salt, 64).toString("hex");
  save(data);
  audit("passphrase_set", {});
}
export function clearPassphrase(): void { delete data.passSalt; delete data.passHash; save(data); audit("passphrase_clear", {}); }
export function verifyPassphrase(pass: string): boolean {
  if (!hasPassphrase()) return true; // no 2nd factor configured
  if (typeof pass !== "string" || !pass) return false;
  const h = scryptSync(pass, data.passSalt!, 64).toString("hex");
  return hashEq(h, data.passHash!);
}

/** Force a reload from disk (tests). */
export function _reload(): void { data = load(); }
