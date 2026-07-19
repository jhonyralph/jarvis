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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@jarvis/core";
import { MobilePush } from "./mobilePush.js";

export type NotifyKind = "done" | "error" | "machine";
export interface PushPrefs { events: NotifyKind[]; mode: "each" | "grouped"; everyMin: number }
const DEFAULT_PREFS: PushPrefs = { events: ["done", "error"], mode: "each", everyMin: 15 };

/** Normalize whatever prefs a client sent into a valid PushPrefs — applied at BOTH read and write. */
export function normalizePrefs(sub: any): PushPrefs {
  const p = sub?.prefs || {};
  const events = Array.isArray(p.events) ? p.events.filter((e: string) => ["done", "error", "machine"].includes(e)) : DEFAULT_PREFS.events;
  const everyMin = Math.min(240, Math.max(1, Number(p.everyMin) || DEFAULT_PREFS.everyMin));
  return { events, mode: p.mode === "grouped" ? "grouped" : "each", everyMin };
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
export const cleanText = (s: string): string => (s || "").replace(/[#*`>_~]/g, "").replace(/\s+/g, " ").trim();

export class PushCenter {
  private readonly vapidFile: string;
  private readonly subsFile: string;
  private vapid: { publicKey: string; privateKey: string };
  private subs: any[] = [];
  // Grouped mode: hold events per device and flush on that device's own interval.
  private readonly pending = new Map<string, { at: number; items: Array<{ kind: NotifyKind; title: string; body: string }> }>();
  private readonly mobile: MobilePush;

  constructor(jarvisDir: string) {
    this.vapidFile = join(jarvisDir, "vapid.json");
    this.subsFile = join(jarvisDir, "push-subs.json");
    try { this.vapid = JSON.parse(readFileSync(this.vapidFile, "utf8")); }
    catch { this.vapid = webpush.generateVAPIDKeys(); try { writeJsonAtomic(this.vapidFile, this.vapid); } catch { /* ignore */ } }
    webpush.setVapidDetails("mailto:jarvis@localhost", this.vapid.publicKey, this.vapid.privateKey);
    try { this.subs = JSON.parse(readFileSync(this.subsFile, "utf8")); } catch { this.subs = []; }
    // Native push for the Capacitor app (FCM), ALONGSIDE the browser web-push. No-op unless
    // JARVIS_FCM_SA points at a Firebase service account — additive, opt-in (see mobilePush.ts).
    this.mobile = new MobilePush(jarvisDir);
    setInterval(() => this.flushGrouped(), 30_000).unref?.();
  }

  publicKey(): string { return this.vapid.publicKey; }
  private save(): void { try { writeJsonAtomic(this.subsFile, this.subs); } catch { /* ignore */ } }

  addSub(sub: any, prefs?: unknown): void {
    const clean = sanitizeSub(sub);
    if (!clean) return;
    const existing = this.subs.find((s) => s.endpoint === clean.endpoint);
    if (existing) { if (prefs !== undefined) existing.prefs = normalizePrefs({ prefs }); this.save(); return; }
    this.subs.push({ ...clean, prefs: normalizePrefs({ prefs }) }); this.save();
  }
  setSubPrefs(endpoint: string, prefs: unknown): void {
    const s = this.subs.find((x) => x.endpoint === endpoint);
    if (s) { s.prefs = normalizePrefs({ prefs }); this.save(); }
  }
  removeSub(endpoint: string): void {
    const n = this.subs.length;
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    if (this.subs.length !== n) { this.pending.delete(endpoint); this.save(); }
  }
  private async sendPush(sub: any, payload: object): Promise<void> {
    await webpush.sendNotification(sub, JSON.stringify(payload)).catch((err: any) => {
      // 404/410 = the browser dropped this subscription for good; anything else may be transient.
      if (err?.statusCode === 404 || err?.statusCode === 410) this.removeSub(sub.endpoint);
    });
  }

  /** One event, fanned out to every device that asked for this kind — now or at its next flush. Bound
   *  (arrow field) so the Hub can keep a plain `notifyEvent` reference and call it from anywhere. */
  notifyEvent = (kind: NotifyKind, title: string, body: string, tag?: string): void => {
    for (const sub of [...this.subs]) {
      const p = normalizePrefs(sub);
      if (!p.events.includes(kind)) continue;
      if (p.mode === "each") { void this.sendPush(sub, { title: "Jarvis · " + cleanText(title).slice(0, 60), body: cleanText(body).slice(0, 140), tag: tag || kind }); continue; }
      const q = this.pending.get(sub.endpoint) || { at: Date.now(), items: [] };
      q.items.push({ kind, title: cleanText(title).slice(0, 60), body: cleanText(body).slice(0, 90) });
      if (q.items.length > 50) q.items.shift(); // a stuck flusher must not grow without bound
      this.pending.set(sub.endpoint, q);
    }
    void this.mobile.notify(kind, cleanText(title), cleanText(body), tag);
  };

  /** Flush grouped queues whose interval elapsed. One tick for everyone; each device has its own. */
  private flushGrouped(): void {
    const now = Date.now();
    for (const [endpoint, q] of [...this.pending]) {
      const sub = this.subs.find((s) => s.endpoint === endpoint);
      if (!sub) { this.pending.delete(endpoint); continue; }
      const p = normalizePrefs(sub);
      if (p.mode !== "grouped" || !q.items.length || now - q.at < p.everyMin * 60_000) continue;
      this.pending.delete(endpoint);
      const n = q.items.length;
      const head = n === 1 ? q.items[0].title : `${n} eventos`;
      const body = q.items.slice(-4).map((i) => `${i.kind === "error" ? "⚠" : i.kind === "machine" ? "🖥" : "✓"} ${i.title}`).join(" · ");
      void this.sendPush(sub, { title: "Jarvis · " + head, body: body.slice(0, 200), tag: "jarvis-grouped" });
    }
  }

  /** Handle a push-protocol frame from a client. Returns true if it consumed `msg`. `reply` sends a
   *  frame back to that client (injected, so this module never touches the WebSocket directly). */
  handleMsg(msg: any, reply: (obj: unknown) => void): boolean {
    if (msg.t === "pushkey") { reply({ t: "pushkey", key: this.publicKey() }); return true; }
    if (msg.t === "subscribe" && msg.sub) { this.addSub(msg.sub, msg.prefs); reply({ t: "pushok" }); return true; }
    if (msg.t === "push_prefs" && typeof msg.endpoint === "string") { this.setSubPrefs(msg.endpoint, msg.prefs); reply({ t: "pushok" }); return true; }
    if (msg.t === "unsubscribe" && typeof msg.endpoint === "string") { this.removeSub(msg.endpoint); return true; }
    if (msg.t === "mobile_push_register" && typeof msg.token === "string") { this.mobile.register(msg.token, msg.platform === "ios" ? "ios" : "android", msg.events); reply({ t: "pushok" }); return true; }
    if (msg.t === "mobile_push_unregister" && typeof msg.token === "string") { this.mobile.remove(msg.token); return true; }
    return false;
  }
}
