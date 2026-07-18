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
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { join } from "node:path";
import { writeJsonAtomic } from "@jarvis/core";

export type MobilePlatform = "android" | "ios";
export type MobileNotifyKind = "done" | "error" | "machine";
interface MobileToken { token: string; platform: MobilePlatform; events: MobileNotifyKind[]; at: number }

const KINDS: MobileNotifyKind[] = ["done", "error", "machine"];
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
    this.file = join(dir, "mobile-push.json");
    try { this.tokens = JSON.parse(readFileSync(this.file, "utf8")); } catch { this.tokens = []; }
  }

  /** Upsert a device's FCM token + which event kinds it wants. */
  register(token: string, platform: MobilePlatform, events?: unknown): void {
    if (!token) return;
    const ev = Array.isArray(events) ? (events.filter((e) => KINDS.includes(e as MobileNotifyKind)) as MobileNotifyKind[]) : (["done", "error"] as MobileNotifyKind[]);
    const ex = this.tokens.find((t) => t.token === token);
    if (ex) { ex.platform = platform; ex.events = ev.length ? ev : ex.events; ex.at = Date.now(); }
    else this.tokens.push({ token, platform, events: ev, at: Date.now() });
    this.save();
  }
  remove(token: string): void {
    const n = this.tokens.length;
    this.tokens = this.tokens.filter((t) => t.token !== token);
    if (this.tokens.length !== n) this.save();
  }
  count(): number { return this.tokens.length; }
  private save(): void { try { writeJsonAtomic(this.file, this.tokens); } catch { /* ignore */ } }

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
  async notify(kind: MobileNotifyKind, title: string, body: string, tag?: string): Promise<void> {
    const targets = this.tokens.filter((t) => t.events.includes(kind));
    if (!targets.length) return;
    const at = await this.accessToken();
    if (!at || !this.sa) return;
    const url = `https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`;
    for (const t of targets) {
      const message = { message: { token: t.token, notification: { title: "Jarvis · " + title.slice(0, 60), body: body.slice(0, 140) }, data: { tag: tag || kind, kind } } };
      try {
        const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${at}`, "content-type": "application/json" }, body: JSON.stringify(message) });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          // A permanently-invalid token (app uninstalled / token rotated) is dropped; other errors are transient.
          if (/UNREGISTERED|registration-token-not-registered|invalid.?argument/i.test(txt)) this.remove(t.token);
        }
      } catch { /* transient network error — try again on the next event */ }
    }
  }
}
