/**
 * Manual-mode approval bridge for the Claude Code adapter.
 *
 * Claude Code, run headless with `--permission-mode manual`, auto-DENIES every tool unless a
 * permission-prompt MCP tool is wired via `--permission-prompt-tool mcp__<server>__<tool>` +
 * `--mcp-config <file>`. This module is that MCP server: a tiny hand-rolled stdio JSON-RPC process
 * (there is no MCP server SDK installed) that, on each `tools/call`, POSTs the request to the Hub
 * and blocks until the user's decision comes back, then returns it to Claude as MCP content.
 *
 * The server script is embedded as a STRING so nothing extra has to ship as a compiled asset; the
 * adapter writes it once (idempotent) to ~/.jarvis/permission-bridge.mjs at spawn time.
 *
 * Fail-closed by construction: missing env, HTTP failure, non-allow decision, or any exception all
 * resolve to `deny`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The stdio MCP server, verified end-to-end against Claude Code 2.1.202 (see docs/permission-modes-plan.md §4).
 *  Reads JARVIS_PERM_URL / JARVIS_PERM_TOKEN / JARVIS_PERM_SESSION from its own env (the adapter injects
 *  them per turn via the temp mcp-config). Never trusts a partial decision: only an explicit
 *  `{behavior:"allow"}` from the Hub lets the tool run; everything else is a deny. */
export const PERMISSION_BRIDGE_SCRIPT = `import { createInterface } from "node:readline";
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const URL_ = process.env.JARVIS_PERM_URL;
const TOKEN = process.env.JARVIS_PERM_TOKEN;
const SESSION = process.env.JARVIS_PERM_SESSION || "";
// A user may take a while to answer; the Hub owns the real timeout (default deny at 5 min). This is
// just an ultimate safety net so the bridge can never hang a turn forever.
const HARD_TIMEOUT_MS = 15 * 60 * 1000;
async function decide(toolName, input, toolUseId) {
  if (!URL_ || !TOKEN) return { behavior: "deny", message: "Jarvis permission bridge not configured" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HARD_TIMEOUT_MS);
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + TOKEN },
      body: JSON.stringify({ token: TOKEN, sessionId: SESSION, toolName, input: input ?? {}, toolUseId }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { behavior: "deny", message: "Jarvis negou (HTTP " + res.status + ")" };
    const d = await res.json();
    if (d && d.behavior === "allow") return { behavior: "allow", updatedInput: (d.updatedInput ?? input) ?? {} };
    return { behavior: "deny", message: (d && d.message) || "Negado pelo usuário" };
  } catch (e) {
    return { behavior: "deny", message: "Jarvis permission bridge error: " + String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}
createInterface({ input: process.stdin }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const { id, method, params } = m;
  if (method === "initialize") send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "jarvisperm", version: "0.0.1" } } });
  else if (method === "notifications/initialized") { /* notification: no reply */ }
  else if (method === "tools/list") send({ jsonrpc: "2.0", id, result: { tools: [{ name: "approve", description: "Jarvis permission prompt", inputSchema: { type: "object" } }] } });
  else if (method === "tools/call") {
    const args = (params && params.arguments) || {};
    decide(args.tool_name, args.input, args.tool_use_id).then((decision) => {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(decision) }] } });
    });
  }
  else if (method === "ping") send({ jsonrpc: "2.0", id, result: {} });
  else if (id !== undefined && id !== null) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
});
`;

/** Path where the bridge script lives on disk. */
export function permissionBridgePath(dir = join(homedir(), ".jarvis")): string {
  return join(dir, "permission-bridge.mjs");
}

/** Write the bridge script to ~/.jarvis/permission-bridge.mjs (idempotent: only rewrites when the
 *  content changed, so an upgrade refreshes it) and return its absolute path. Best-effort: a write
 *  failure still returns the path — a subsequent spawn simply fails closed at the Claude/MCP layer. */
export function ensurePermissionBridge(dir = join(homedir(), ".jarvis")): string {
  const path = permissionBridgePath(dir);
  try {
    mkdirSync(dir, { recursive: true });
    let current = "";
    try { current = readFileSync(path, "utf8"); } catch { /* not written yet */ }
    if (current !== PERMISSION_BRIDGE_SCRIPT) writeFileSync(path, PERMISSION_BRIDGE_SCRIPT);
  } catch { /* best-effort; caller fails closed if node can't run it */ }
  return path;
}
