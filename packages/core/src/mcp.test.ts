import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcp, MCP_PROTOCOL_VERSION, type McpTool } from "./mcp.js";

const SERVER = { name: "jarvis", version: "0.0.0" };
const tools: McpTool[] = [
  { name: "echo", description: "echoes", inputSchema: { type: "object", properties: { x: { type: "string" } } }, handler: (a) => "echo:" + a.x },
  { name: "boom", description: "throws", inputSchema: { type: "object" }, handler: () => { throw new Error("kaboom"); } },
];

test("initialize returns the protocol version + serverInfo", async () => {
  const r = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, tools, SERVER);
  assert.equal(r?.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(r?.result.serverInfo, SERVER);
  assert.ok(r?.result.capabilities.tools);
});

test("tools/list lists names, descriptions and schemas", async () => {
  const r = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tools, SERVER);
  assert.deepEqual(r?.result.tools.map((t: any) => t.name), ["echo", "boom"]);
  assert.ok(r?.result.tools[0].inputSchema);
});

test("tools/call runs the handler and wraps the text", async () => {
  const r = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { x: "oi" } } }, tools, SERVER);
  assert.deepEqual(r?.result.content, [{ type: "text", text: "echo:oi" }]);
});

test("tools/call on a throwing tool returns an MCP tool-error (not a thrown exception)", async () => {
  const r = await handleMcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom", arguments: {} } }, tools, SERVER);
  assert.equal(r?.result.isError, true);
  assert.match(r?.result.content[0].text, /kaboom/);
});

test("unknown tool → JSON-RPC error", async () => {
  const r = await handleMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }, tools, SERVER);
  assert.equal(r?.error?.code, -32602);
});

test("notifications (no id) get no reply", async () => {
  assert.equal(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, tools, SERVER), null);
});

test("unknown method with an id → method-not-found", async () => {
  const r = await handleMcp({ jsonrpc: "2.0", id: 6, method: "resources/list" }, tools, SERVER);
  assert.equal(r?.error?.code, -32601);
});

test("ping replies empty", async () => {
  const r = await handleMcp({ jsonrpc: "2.0", id: 7, method: "ping" }, tools, SERVER);
  assert.deepEqual(r?.result, {});
});
