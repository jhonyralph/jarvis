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
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env.JARVIS_HOME || homedir();
const DIR = join(HOME, ".jarvis");
const AUTH_FILE = join(DIR, "auth.json");
const CLAIM_FILE = join(DIR, "claim-code.txt");
try { mkdirSync(DIR, { recursive: true }); } catch { /* ignore */ }

export const AUTH_ENABLED = (process.env.JARVIS_AUTH || "on").toLowerCase() !== "off";

export type Role = "owner" | "member";
export interface User { id: string; role: Role; name: string; createdAt: number; }
export interface Device { id: string; userId: string; label: string; tokenHash: string; createdAt: number; lastSeen: number; ip?: string; ua?: string; }
export interface Invite { id: string; codeHash: string; role: Role; runners: string[]; expiresAt: number; createdBy: string; createdAt: number; usedAt?: number; usedBy?: string; }
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
  return res;
}

// ---- invites (owner shares access) ----
export function mintInvite(byUserId: string, opts: { role?: Role; runners?: string[]; ttlSec?: number }): { code: string; invite: Omit<Invite, "codeHash"> } {
  const code = newCode();
  const inv: Invite = {
    id: newId(),
    codeHash: sha(code),
    role: opts.role || "member",
    runners: opts.runners || [],
    expiresAt: Date.now() + (opts.ttlSec ?? 3600) * 1000,
    createdBy: byUserId,
    createdAt: Date.now(),
  };
  data.invites.push(inv);
  save(data);
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
  const res = issueDevice(user, label, meta);
  if (inv.role === "member") data.grants[user.id] = [...(inv.runners || [])];
  inv.usedAt = Date.now();
  inv.usedBy = user.id;
  data.users.push(user);
  save(data);
  return res;
}

function issueDevice(user: User, label: string, meta?: { ip?: string; ua?: string }): AuthResult {
  const token = newToken();
  const dev: Device = {
    id: newId(), userId: user.id, label: label || "Dispositivo",
    tokenHash: sha(token), createdAt: Date.now(), lastSeen: Date.now(), ip: meta?.ip, ua: meta?.ua,
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
export function revokeDevice(deviceId: string): boolean {
  const before = data.devices.length;
  data.devices = data.devices.filter((d) => d.id !== deviceId);
  if (data.devices.length !== before) { save(data); return true; }
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
export function revokeRunnerToken(runnerId: string): boolean {
  const before = data.runnerTokens.length;
  data.runnerTokens = data.runnerTokens.filter((r) => r.runnerId !== runnerId);
  if (data.runnerTokens.length !== before) { save(data); return true; }
  return false;
}

/** Force a reload from disk (tests). */
export function _reload(): void { data = load(); }
