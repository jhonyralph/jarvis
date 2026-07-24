/**
 * Loopback-only admin API (host recovery) — extracted from the Hub god-file as the second
 * decomposition step. Mint pairing codes / manage devices WITHOUT a logged-in device. Bound to
 * 127.0.0.1 so only host-local processes reach it (a reverse proxy forwards to the UI port, never
 * here). This is the answer to "no devices left — how do I get a code?": run scripts/jarvis.ps1 on
 * the host. See docs/multi-runner.md (4a).
 *
 * Behavior is unchanged from the inline version — the Hub-specific state it needs (the runner
 * registry, restart/revoke callbacks) is injected via AdminCtx so this module never reaches back
 * into index.ts. Shared singletons (auth/guard, the git-update helpers) are imported directly.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { updateCheck } from "@jarvis/core";
import * as auth from "./auth.js";
import * as guard from "./guard.js";

/** Everything the admin API needs from the Hub that isn't a shared singleton. */
export interface AdminCtx {
  updateRoot: string;
  /** the UI/WS port — only for the "hub" hint printed with a fresh runner token */
  port: number;
  applyHubUpdate: (force: boolean, allMachines: boolean) => Promise<any>;
  rollbackHubUpdate: () => Promise<any>;
  queueAllRunnerUpdates: () => Promise<any>;
  dropRevoked: () => void;
  refreshPrincipalRole: (deviceId: string, role: auth.Role) => void;
  /** RunnerConn registry (structural: .id / .local / .ws are read) */
  runners: Map<string, { id: string; local: boolean; ws: WebSocket | null }>;
  runnerLabels: Record<string, string>;
  /** Pull a runner's current session list (single-flight safe; [] if it stays silent). Injected as a
   *  function rather than the raw waiter map so the admin purge can't clobber the unified view's
   *  in-flight request — both used to share one slot per runner and starve each other. */
  runnerSessions: (rc: any) => Promise<any[]>;
  sendToRunner: (rc: any, obj: unknown) => boolean;
}

export function startAdminApi(ctx: AdminCtx): void {
  const ADMIN_PORT = Number(process.env.JARVIS_ADMIN_PORT || 4578);
  const PUBLIC_URL = (process.env.JARVIS_PUBLIC_URL || "").replace(/\/+$/, "");
  const inviteLink = (code: string): string | undefined => (PUBLIC_URL ? `${PUBLIC_URL}/#invite=${encodeURIComponent(code)}` : undefined);

  const adminServer = createServer((req, res) => {
    const ra = String(req.socket.remoteAddress || "");
    if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra)) { res.writeHead(403, { "content-type": "application/json" }).end('{"error":"loopback only"}'); return; }
    // anti-CSRF + anti-DNS-rebinding: the recovery CLI never sets Origin/Referer, and always
    // uses a localhost Host. A browser page (even via DNS rebinding) sets Origin and/or a
    // rebound Host — reject those so a visited web page can't drive the admin API.
    if (req.headers.origin || req.headers.referer) { res.writeHead(403, { "content-type": "application/json" }).end('{"error":"browser requests not allowed"}'); return; }
    const host = String(req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (host && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) { res.writeHead(403, { "content-type": "application/json" }).end('{"error":"bad host"}'); return; }
    const url = (req.url || "/").split("?")[0];
    const json = (code: number, obj: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const body = () => new Promise<any>((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
    (async () => {
      try {
        if (req.method === "GET" && url === "/admin/status") return json(200, { claimed: auth.isClaimed(), authEnabled: auth.AUTH_ENABLED, devices: auth.listDevices(), invites: auth.listInvites(), guard: guard.stats() });
        if (req.method === "GET" && url === "/admin/claimcode") return json(200, { claimed: auth.isClaimed(), code: auth.isClaimed() ? null : auth.ensureClaimCode() });
        if (req.method === "GET" && url === "/admin/audit") { const n = Number((req.url || "").split("n=")[1]) || 100; return json(200, { audit: auth.readAudit(n) }); }
        if (req.method === "GET" && url === "/admin/update") { return json(200, await updateCheck(ctx.updateRoot, true)); }
        if (req.method === "POST" && url === "/admin/update") return json(200, await ctx.applyHubUpdate(false, false));
        if (req.method === "POST" && url === "/admin/update/rollback") return json(200, await ctx.rollbackHubUpdate());
        if (req.method === "POST" && url === "/admin/update-runners") return json(200, await ctx.queueAllRunnerUpdates());
        // purge the "ok" probe litter on connected runners via their existing delete handler
        // (no git-pull/restart needed): query the session list, delete the "ok" natives, repeat.
        if (req.method === "POST" && url === "/admin/purge-runner-ok") {
          const results: any[] = [];
          for (const rc of ctx.runners.values()) {
            if (rc.local || !rc.ws || rc.ws.readyState !== WebSocket.OPEN) continue;
            let purged = 0;
            for (let round = 0; round < 60; round++) {
              const sessions: any[] = await ctx.runnerSessions(rc);
              const okIds = sessions.filter((s) => typeof s?.id === "string" && s.source === "native" && String(s.title || "").trim().toLowerCase() === "ok").map((s) => s.id);
              if (!okIds.length) break;
              ctx.sendToRunner(rc, { t: "delete", sessionIds: okIds, alsoNative: true });
              purged += okIds.length;
              await new Promise((r) => setTimeout(r, 900));
            }
            results.push({ runner: ctx.runnerLabels[rc.id] || rc.id, purged });
          }
          return json(200, { ok: true, results });
        }
        if (req.method === "POST" && url === "/admin/invite") {
          const b = await body();
          const role = b.role === "owner" ? "owner" : "member";
          const ttlSec = Math.min(Math.max(Number(b.ttlSec) || 86400, 60), 30 * 86400);
          const { code, invite } = auth.mintInvite("cli", { role, runners: [], ttlSec });
          return json(200, { code, link: inviteLink(code), invite });
        }
        if (req.method === "POST" && url === "/admin/runner-token") {
          const b = await body();
          const label = (typeof b.label === "string" && b.label) ? b.label : "runner";
          const rid = (typeof b.runnerId === "string" && b.runnerId) ? b.runnerId : ("m-" + randomUUID().slice(0, 8));
          const token = auth.mintRunnerToken(rid, label);
          const hubWs = PUBLIC_URL ? PUBLIC_URL.replace(/^http/, "ws") : `ws://<este-host>:${ctx.port}`;
          return json(200, { runnerId: rid, label, token, hub: hubWs });
        }
        if (req.method === "POST" && url === "/admin/passphrase") {
          const b = await body();
          if (b.clear) { auth.clearPassphrase(); return json(200, { ok: true, enabled: false }); }
          if (typeof b.new === "string") { try { auth.setPassphrase(b.new); return json(200, { ok: true, enabled: true }); } catch (e: any) { return json(400, { error: String(e?.message ?? e) }); } }
          return json(200, { enabled: auth.hasPassphrase() });
        }
        if (req.method === "POST" && url === "/admin/revoke") { const b = await body(); const ok = typeof b.deviceId === "string" && auth.revokeDevice(b.deviceId); ctx.dropRevoked(); return json(200, { ok: !!ok }); }
        if (req.method === "POST" && url === "/admin/device-role") { const b = await body(); const role = b.role === "owner" ? "owner" : "member"; const ok = typeof b.deviceId === "string" && auth.setDeviceRole(b.deviceId, role); if (ok) ctx.refreshPrincipalRole(b.deviceId, role); return json(200, { ok: !!ok, role }); }
        if (req.method === "POST" && url === "/admin/revoke-all") { const n = auth.listDevices().length; for (const d of auth.listDevices()) auth.revokeDevice(d.id); ctx.dropRevoked(); return json(200, { revoked: n }); }
        json(404, { error: "not found" });
      } catch (e: any) { json(500, { error: String(e?.message ?? e) }); }
    })();
  });
  adminServer.listen(ADMIN_PORT, "127.0.0.1", () => console.log(`[hub] admin (loopback) http://127.0.0.1:${ADMIN_PORT}  — recovery: scripts/jarvis.ps1`));
}
