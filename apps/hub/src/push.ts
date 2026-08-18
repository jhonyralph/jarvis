/**
 * Web Push (browser, VAPID) + native-app push (FCM via MobilePush), extracted from the Hub god-file
 * as the first decomposition step. It owns ALL of its own state — VAPID keys and per-device
 * subscriptions live locally under ~/.jarvis; prefs live ON each subscription, so every device
 * decides for itself ("each" immediately, or "grouped" flushed on that device's own interval).
 *
 * The Hub keeps calling `push.notifyEvent(...)` exactly as before (a bound arrow method), and the
 * router hands push-protocol frames to `push.handleMsg(...)`. Nothing else escapes this module.
 */
import webpush from "web-push";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@jarvis/core";
import { MobilePush, type MobilePushTarget } from "./mobilePush.js";
import { cleanNotifyText, formatGroupedPushPayload, formatPushPayload, type NotifyKind } from "./notifyFormat.js";

export interface PushPrefs { events: NotifyKind[]; mode: "each" | "grouped"; everyMin: number; v?: number }
export interface PushActor extends MobilePushTarget {}
const DEFAULT_PREFS: PushPrefs = { events: ["done", "error", "ask"], mode: "each", everyMin: 15 };
/** Sobe quando um tipo de evento novo aparece: separa "preferência antiga" de "o usuário desligou". */
const PREFS_VERSION = 2;
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

function authenticatedDeviceSnapshot(devices: Iterable<Required<PushActor>> | null | undefined): { keys: Set<string>; devices: Array<Required<PushActor>> } | null {
  try {
    if (!devices || typeof (devices as any)[Symbol.iterator] !== "function") return null;
    const keys = new Set<string>();
    const snapshot: Array<Required<PushActor>> = [];
    for (const device of devices) {
      const principalId = device?.principalId;
      const deviceId = device?.deviceId;
      const key = deviceKey(principalId, deviceId);
      if (!key) return null;
      keys.add(key);
      snapshot.push({ principalId, deviceId });
    }
    return { keys, devices: snapshot };
  } catch {
    return null;
  }
}

/** Normalize whatever prefs a client sent into a valid PushPrefs — applied at BOTH read and write. */
export function normalizePrefs(sub: any): PushPrefs {
  const p = sub?.prefs || {};
  const known = ["done", "error", "machine", "personal", "ask"];
  const events: NotifyKind[] = Array.isArray(p.events) ? p.events.filter((e: string) => known.includes(e)) : [...DEFAULT_PREFS.events];
  // `ask` nasceu depois. Uma preferência gravada ANTES dele (sem marca de versão) que já aceitava
  // `done` passa a aceitar `ask`: "terminou e precisa de você" é um subconjunto de "terminou", então
  // herdar é fiel à escolha original — e sem isso o aviso entraria mudo em todo aparelho já inscrito.
  // Com a marca de versão, a ausência vira escolha explícita do usuário e é respeitada.
  if ((Number(p.v) || 0) < PREFS_VERSION && events.includes("done") && !events.includes("ask")) events.push("ask");
  const everyMin = Math.min(240, Math.max(1, Number(p.everyMin) || DEFAULT_PREFS.everyMin));
  return { events, mode: p.mode === "grouped" ? "grouped" : "each", everyMin, v: PREFS_VERSION };
}
/** Keep ONLY the canonical web-push fields — a subscription is client-supplied and was persisted
 *  verbatim, so extra keys used to land on disk. Returns null for a malformed sub (endpoint + the
 *  p256dh/auth keys are what web-push actually needs to deliver). */
export function sanitizeSub(sub: any): { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime: number | null } | null {
  if (!sub || typeof sub !== "object") return null;
  const endpoint = sub.endpoint;
  if (typeof endpoint !== "string" || !endpoint || endpoint.length > 2048) return null;
  const keys = sub.keys;
  if (!keys || typeof keys !== "object" || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, expirationTime: typeof sub.expirationTime === "number" ? sub.expirationTime : null };
}
/** Strip markdown so a spoken/short notification body reads cleanly. */
export const cleanText = cleanNotifyText;

export class PushCenter {
  private readonly vapidFile: string;
  private readonly subsFile: string;
  private vapid: { publicKey: string; privateKey: string };
  private subs: any[] = [];
  // Grouped mode: hold events per device and flush on that device's own interval.
  private readonly pending = new Map<string, { at: number; items: Array<{ kind: NotifyKind; title: string; body: string }> }>();
  private readonly mobile: MobilePush;

  constructor(jarvisDir: string) {
    secureDirectory(jarvisDir);
    this.vapidFile = join(jarvisDir, "vapid.json");
    this.subsFile = join(jarvisDir, "push-subs.json");
    securePersistedFile(this.vapidFile);
    securePersistedFile(this.subsFile);
    try { this.vapid = JSON.parse(readFileSync(this.vapidFile, "utf8")); }
    catch { this.vapid = webpush.generateVAPIDKeys(); try { writePrivateJson(this.vapidFile, this.vapid); } catch { /* ignore */ } }
    webpush.setVapidDetails("mailto:jarvis@localhost", this.vapid.publicKey, this.vapid.privateKey);
    try {
      const saved = JSON.parse(readFileSync(this.subsFile, "utf8"));
      this.subs = Array.isArray(saved) ? saved : [];
    } catch { this.subs = []; }
    // Native push for the Capacitor app (FCM), ALONGSIDE the browser web-push. No-op unless
    // JARVIS_FCM_SA points at a Firebase service account — additive, opt-in (see mobilePush.ts).
    this.mobile = new MobilePush(jarvisDir);
    setInterval(() => this.flushGrouped(), 30_000).unref?.();
  }

  publicKey(): string { return this.vapid.publicKey; }
  status(target?: PushActor): object {
    const mobile = this.mobile.status(target);
    const webSubs = target?.principalId ? this.subs.filter((row) => row.principalId === target.principalId && (!target.deviceId || row.deviceId === target.deviceId)).length : this.subs.length;
    return { webSubs, mobileTokens: mobile.tokens, fcmEnvSet: mobile.fcmEnvSet, fcmConfigured: mobile.fcmConfigured, fcmProjectId: mobile.projectId || "" };
  }
  private save(): void { try { writePrivateJson(this.subsFile, this.subs); } catch { /* ignore */ } }

  addSub(sub: any, prefs?: unknown, actor: PushActor = {}): void {
    const clean = sanitizeSub(sub);
    if (!clean) return;
    const existing = this.subs.find((s) => s.endpoint === clean.endpoint);
    if (existing) { if (prefs !== undefined) existing.prefs = normalizePrefs({ prefs }); existing.principalId = actor.principalId; existing.deviceId = actor.deviceId; this.save(); return; }
    this.subs.push({ ...clean, prefs: normalizePrefs({ prefs }), principalId: actor.principalId, deviceId: actor.deviceId }); this.save();
  }
  setSubPrefs(endpoint: string, prefs: unknown, actor?: PushActor): void {
    const s = this.subs.find((x) => x.endpoint === endpoint && (!actor?.principalId || x.principalId === actor.principalId));
    if (s) { s.prefs = normalizePrefs({ prefs }); this.save(); }
  }
  removeSub(endpoint: string, actor?: PushActor): void {
    const n = this.subs.length;
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint || (actor?.principalId !== undefined && s.principalId !== actor.principalId));
    if (this.subs.length !== n) { this.pending.delete(endpoint); this.save(); }
  }
  purgeTarget(target: Required<PushActor>): { webSubs: number; mobileTokens: number } {
    if (!target.principalId || !target.deviceId) return { webSubs: 0, mobileTokens: 0 };
    const removedEndpoints = this.subs
      .filter((sub) => sub.principalId === target.principalId && sub.deviceId === target.deviceId)
      .map((sub) => sub.endpoint);
    if (removedEndpoints.length) {
      const removed = new Set(removedEndpoints);
      this.subs = this.subs.filter((sub) => !removed.has(sub.endpoint));
      for (const endpoint of removed) this.pending.delete(endpoint);
      this.save();
    }
    return { webSubs: removedEndpoints.length, mobileTokens: this.mobile.purgeTarget(target) };
  }
  /** Reconcile persisted registrations against one complete auth snapshot. Auth-off has no
   * authoritative device registry, so it is deliberately a no-op. Missing, malformed, or throwing
   * snapshots also leave storage untouched; an explicitly supplied empty iterable is authoritative. */
  purgeUnknownDevices(authenticatedDevices: Iterable<Required<PushActor>> | null | undefined, authEnabled = true): { webSubs: number; mobileTokens: number } {
    if (!authEnabled) return { webSubs: 0, mobileTokens: 0 };
    const authenticated = authenticatedDeviceSnapshot(authenticatedDevices);
    if (!authenticated) return { webSubs: 0, mobileTokens: 0 };
    const before = this.subs.length;
    const removedEndpoints: string[] = [];
    this.subs = this.subs.filter((sub) => {
      const key = deviceKey(sub?.principalId, sub?.deviceId);
      const keep = key !== null && authenticated.keys.has(key);
      if (!keep && typeof sub?.endpoint === "string") removedEndpoints.push(sub.endpoint);
      return keep;
    });
    if (this.subs.length !== before) {
      for (const endpoint of removedEndpoints) this.pending.delete(endpoint);
      this.save();
    }
    return {
      webSubs: before - this.subs.length,
      mobileTokens: this.mobile.purgeUnknownDevices(authenticated.devices, true),
    };
  }
  private async sendPush(sub: any, payload: object): Promise<boolean> {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      return true;
    } catch (err: any) {
      // 404/410 = the browser dropped this subscription for good; anything else may be transient.
      if (err?.statusCode === 404 || err?.statusCode === 410) this.removeSub(sub.endpoint);
      return false;
    }
  }

  /** One event, fanned out to every device that asked for this kind — now or at its next flush. Bound
   *  (arrow field) so the Hub can keep a plain `notifyEvent` reference and call it from anywhere. */
  notifyEvent = (kind: NotifyKind, title: string, body: string, tag?: string, target?: PushActor): void => {
    // Content-bearing notifications must always have an authenticated destination. The Hub expands
    // owner-wide operational alerts into one principal target at the call boundary.
    if (!target?.principalId) return;
    for (const sub of [...this.subs]) {
      if (target?.principalId && sub.principalId !== target.principalId) continue;
      if (target?.deviceId && sub.deviceId !== target.deviceId) continue;
      const p = normalizePrefs(sub);
      if (!p.events.includes(kind)) continue;
      if (p.mode === "each") { void this.sendPush(sub, formatPushPayload(kind, title, body, tag)); continue; }
      const q = this.pending.get(sub.endpoint) || { at: Date.now(), items: [] };
      q.items.push({ kind, title: cleanText(title), body: cleanText(body) });
      if (q.items.length > 50) q.items.shift(); // a stuck flusher must not grow without bound
      this.pending.set(sub.endpoint, q);
    }
    void this.mobile.notify(kind, title, body, tag, target);
  };

  /** Deliver a proactive suggestion only to its opted-in device. This intentionally bypasses the
   * completion/error preference list because proactive consent is stored separately per device. */
  async notifyPersonal(title: string, body: string, tag: string, url: string, target: Required<PushActor>): Promise<boolean> {
    if (!target.principalId || !target.deviceId) return false;
    const payload = formatPushPayload("personal", title, body, tag, url);
    const webTargets = this.subs.filter((sub) => sub.principalId === target.principalId && (sub.deviceId === target.deviceId || (target.deviceId === "local" && !sub.deviceId)));
    const webResults = await Promise.all(webTargets.map((sub) => this.sendPush(sub, payload)));
    const mobileDelivered = await this.mobile.notifyPayload(payload, target);
    return mobileDelivered || webResults.some(Boolean);
  }

  /** Flush grouped queues whose interval elapsed. One tick for everyone; each device has its own. */
  private flushGrouped(): void {
    const now = Date.now();
    for (const [endpoint, q] of [...this.pending]) {
      const sub = this.subs.find((s) => s.endpoint === endpoint);
      if (!sub) { this.pending.delete(endpoint); continue; }
      const p = normalizePrefs(sub);
      if (p.mode !== "grouped" || !q.items.length || now - q.at < p.everyMin * 60_000) continue;
      this.pending.delete(endpoint);
      void this.sendPush(sub, formatGroupedPushPayload(q.items));
    }
  }

  /** Handle a push-protocol frame from a client. Returns true if it consumed `msg`. `reply` sends a
   *  frame back to that client (injected, so this module never touches the WebSocket directly). */
  handleMsg(msg: any, reply: (obj: unknown) => void, actor: PushActor = {}): boolean {
    if (msg.t === "pushkey") { reply({ t: "pushkey", key: this.publicKey() }); return true; }
    if (msg.t === "push_status") { reply({ t: "push_status", status: this.status(actor) }); return true; }
    if (msg.t === "push_test") {
      const st = this.status(actor);
      const canTry = Boolean((st as any).webSubs) || (Boolean((st as any).mobileTokens) && Boolean((st as any).fcmConfigured));
      if (!canTry) { reply({ t: "push_test", ok: false, status: st, message: "Nenhum canal de push entregável: verifique token do app e FCM do Hub." }); return true; }
      this.notifyEvent("done", "Teste de notificação", "Se você recebeu isto com o app fechado, o push está funcionando.", "jarvis-push-test", actor);
      reply({ t: "push_test", ok: true, status: st, message: "Notificação de teste disparada." });
      return true;
    }
    if (msg.t === "subscribe" && msg.sub) { this.addSub(msg.sub, msg.prefs, actor); reply({ t: "pushok" }); return true; }
    if (msg.t === "push_prefs" && typeof msg.endpoint === "string") { this.setSubPrefs(msg.endpoint, msg.prefs, actor); reply({ t: "pushok" }); return true; }
    if (msg.t === "unsubscribe" && typeof msg.endpoint === "string") { this.removeSub(msg.endpoint, actor); return true; }
    if (msg.t === "mobile_push_register" && typeof msg.token === "string") { this.mobile.register(msg.token, msg.platform === "ios" ? "ios" : "android", msg.events, actor); reply({ t: "pushok" }); return true; }
    if (msg.t === "mobile_push_unregister" && typeof msg.token === "string") { this.mobile.remove(msg.token, actor); return true; }
    return false;
  }
}
