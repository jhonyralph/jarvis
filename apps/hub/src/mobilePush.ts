/**
 * Native push for the Capacitor app (Android via FCM, iOS via FCM→APNs). Runs ALONGSIDE the browser
 * web-push/VAPID path — the Capacitor shell registers its FCM token here; browsers keep using
 * web-push. Uses the FCM HTTP v1 API with a service account (JARVIS_FCM_SA = path to the Firebase
 * service-account JSON). If that env is unset, this whole module NO-OPs (with one log line) so the
 * Hub runs exactly as before — native push is purely additive and opt-in.
 *
 * NOTE: authored without a live FCM project to test against (per the user's "develop it all, I'll
 * test later"). The OAuth2 JWT-bearer flow + v1 payload are written to Google's documented spec;
 * VERIFY end-to-end on a device with a real service account before relying on it. iOS delivery needs
 * the APNs key uploaded to the Firebase project (standard FCM-on-iOS setup) — see docs/mobile.md.
 */
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { join } from "node:path";
import { writeJsonAtomic } from "@jarvis/core";
import { formatPushPayload, type NotifyKind, type PushNotificationPayload } from "./notifyFormat.js";

export type MobilePlatform = "android" | "ios";
export type MobileNotifyKind = NotifyKind;
export interface MobilePushTarget { principalId?: string; deviceId?: string }
interface MobileToken extends MobilePushTarget { token: string; platform: MobilePlatform; events: MobileNotifyKind[]; at: number }
export interface MobilePushStatus { tokens: number; fcmEnvSet: boolean; fcmConfigured: boolean; projectId?: string }

const KINDS: MobileNotifyKind[] = ["done", "error", "machine", "personal"];
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function secureDirectory(dir: string): void {
  try { mkdirSync(dir, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }); } catch { /* persistence remains best-effort */ }
  try { chmodSync(dir, PRIVATE_DIRECTORY_MODE); } catch { /* chmod is unavailable or unsupported */ }
}

function securePersistedFile(file: string): void {
  for (const candidate of [file, `${file}.bak`, `${file}.tmp`]) {
    try { chmodSync(candidate, PRIVATE_FILE_MODE); } catch { /* missing or unsupported */ }
  }
}

function writePrivateJson(file: string, value: unknown): void {
  try { writeJsonAtomic(file, value); }
  finally { securePersistedFile(file); }
}

function deviceKey(principalId: unknown, deviceId: unknown): string | null {
  if (typeof principalId !== "string" || !principalId.trim() || typeof deviceId !== "string" || !deviceId.trim()) return null;
  return JSON.stringify([principalId, deviceId]);
}

function authenticatedDeviceKeys(devices: Iterable<Required<MobilePushTarget>> | null | undefined): Set<string> | null {
  try {
    if (!devices || typeof (devices as any)[Symbol.iterator] !== "function") return null;
    const keys = new Set<string>();
    for (const device of devices) {
      const key = deviceKey(device?.principalId, device?.deviceId);
      if (!key) return null;
      keys.add(key);
    }
    return keys;
  } catch {
    return null;
  }
}

function b64url(x: string | Buffer): string {
  return Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class MobilePush {
  private file: string;
  private tokens: MobileToken[] = [];
  private sa?: { client_email: string; private_key: string; project_id: string };
  private saTried = false;
  private access?: { token: string; exp: number };

  constructor(dir: string) {
    secureDirectory(dir);
    this.file = join(dir, "mobile-push.json");
    securePersistedFile(this.file);
    try {
      const saved = JSON.parse(readFileSync(this.file, "utf8"));
      this.tokens = Array.isArray(saved) ? saved : [];
    } catch { this.tokens = []; }
  }

  /** Upsert a device's FCM token + which event kinds it wants. */
  register(token: string, platform: MobilePlatform, events?: unknown, target: MobilePushTarget = {}): void {
    if (!token) return;
    const ev = Array.isArray(events) ? (events.filter((e) => KINDS.includes(e as MobileNotifyKind)) as MobileNotifyKind[]) : (["done", "error"] as MobileNotifyKind[]);
    const ex = this.tokens.find((t) => t.token === token);
    if (ex) { ex.platform = platform; ex.events = ev.length ? ev : ex.events; ex.at = Date.now(); ex.principalId = target.principalId; ex.deviceId = target.deviceId; }
    else this.tokens.push({ token, platform, events: ev, at: Date.now(), principalId: target.principalId, deviceId: target.deviceId });
    this.save();
  }
  remove(token: string, target?: MobilePushTarget): void {
    const n = this.tokens.length;
    this.tokens = this.tokens.filter((t) => t.token !== token || (target?.principalId !== undefined && t.principalId !== target.principalId));
    if (this.tokens.length !== n) this.save();
  }
  purgeTarget(target: Required<MobilePushTarget>): number {
    if (!target.principalId || !target.deviceId) return 0;
    const before = this.tokens.length;
    this.tokens = this.tokens.filter((token) => token.principalId !== target.principalId || token.deviceId !== target.deviceId);
    if (this.tokens.length !== before) this.save();
    return before - this.tokens.length;
  }
  /** Reconcile persisted tokens against one complete auth snapshot. Auth-off has no authoritative
   * device registry, so it is deliberately a no-op. Missing, malformed, or throwing snapshots also
   * leave storage untouched; an explicitly supplied empty iterable is valid and removes everything. */
  purgeUnknownDevices(authenticatedDevices: Iterable<Required<MobilePushTarget>> | null | undefined, authEnabled = true): number {
    if (!authEnabled) return 0;
    const known = authenticatedDeviceKeys(authenticatedDevices);
    if (!known) return 0;
    const before = this.tokens.length;
    this.tokens = this.tokens.filter((token) => {
      const key = deviceKey(token?.principalId, token?.deviceId);
      return key !== null && known.has(key);
    });
    if (this.tokens.length !== before) this.save();
    return before - this.tokens.length;
  }
  count(): number { return this.tokens.length; }
  status(target?: MobilePushTarget): MobilePushStatus {
    const env = !!process.env.JARVIS_FCM_SA;
    const ok = this.loadSa();
    const tokens = target?.principalId ? this.tokens.filter((row) => row.principalId === target.principalId && (!target.deviceId || row.deviceId === target.deviceId)).length : this.tokens.length;
    return { tokens, fcmEnvSet: env, fcmConfigured: ok, projectId: this.sa?.project_id };
  }
  private save(): void { try { writePrivateJson(this.file, this.tokens); } catch { /* ignore */ } }

  private loadSa(): boolean {
    if (this.saTried) return !!this.sa;
    this.saTried = true;
    const p = process.env.JARVIS_FCM_SA;
    if (!p) { console.log("[push] JARVIS_FCM_SA não definido — push nativo (FCM) desativado; web-push segue normal."); return false; }
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (!j.client_email || !j.private_key || !j.project_id) throw new Error("service account sem client_email/private_key/project_id");
      this.sa = { client_email: j.client_email, private_key: j.private_key, project_id: j.project_id };
      console.log(`[push] FCM ativo (projeto ${this.sa.project_id}).`);
      return true;
    } catch (e: unknown) { console.warn("[push] falha ao ler JARVIS_FCM_SA:", String((e as Error)?.message ?? e)); return false; }
  }

  /** OAuth2 access token via the service-account JWT-bearer grant. Cached until ~1min before expiry. */
  private async accessToken(): Promise<string | null> {
    if (!this.loadSa() || !this.sa) return null;
    if (this.access && Date.now() < this.access.exp - 60_000) return this.access.token;
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64url(JSON.stringify({ iss: this.sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
    const signer = createSign("RSA-SHA256"); signer.update(`${head}.${claim}`); signer.end();
    const jwt = `${head}.${claim}.${b64url(signer.sign(this.sa.private_key))}`;
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
      });
      const j: any = await res.json();
      if (!j.access_token) { console.warn("[push] OAuth FCM falhou:", JSON.stringify(j).slice(0, 200)); return null; }
      this.access = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
      return this.access.token;
    } catch (e: unknown) { console.warn("[push] OAuth FCM erro de rede:", String((e as Error)?.message ?? e)); return null; }
  }

  /** Fan an event out to every registered device that asked for this kind (v1: "each" only — no
   *  grouped batching yet; the web-push path still has grouped). No-op if FCM isn't configured. */
  private async deliver(payload: PushNotificationPayload, target?: MobilePushTarget, respectPreferences = true): Promise<boolean> {
    const targets = this.tokens.filter((t) => (!respectPreferences || t.events.includes(payload.kind))
      && (!target?.principalId || t.principalId === target.principalId)
      && (!target?.deviceId || t.deviceId === target.deviceId || (target.deviceId === "local" && !t.deviceId)));
    if (!targets.length) return false;
    const at = await this.accessToken();
    if (!at || !this.sa) return false;
    const url = `https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`;
    let delivered = false;
    for (const t of targets) {
      const message = {
        message: {
          token: t.token,
          notification: { title: payload.title, body: payload.body },
          data: { tag: payload.tag, kind: payload.kind, sid: payload.sid || "", url: payload.url || "" },
          android: { notification: { tag: payload.tag } },
        },
      };
      try {
        const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${at}`, "content-type": "application/json" }, body: JSON.stringify(message) });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          // A permanently-invalid token (app uninstalled / token rotated) is dropped; other errors are transient.
          if (/UNREGISTERED|registration-token-not-registered|invalid.?argument/i.test(txt)) this.remove(t.token);
        } else delivered = true;
      } catch { /* transient network error — try again on the next event */ }
    }
    return delivered;
  }

  async notify(kind: MobileNotifyKind, title: string, body: string, tag?: string, target?: MobilePushTarget): Promise<void> {
    await this.deliver(formatPushPayload(kind, title, body, tag), target, true);
  }

  async notifyPayload(payload: PushNotificationPayload, target: MobilePushTarget): Promise<boolean> {
    return this.deliver(payload, target, false);
  }
}
