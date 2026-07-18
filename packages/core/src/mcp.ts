/**
 * Minimal MCP (Model Context Protocol) server core — hand-rolled JSON-RPC 2.0, no SDK dependency.
 * This is the PURE protocol layer (initialize / tools/list / tools/call / ping); the transport
 * (stdio) and the tools themselves (which talk to the Hub) live in apps/mcp. Kept pure so the
 * handshake + dispatch are unit-testable without any I/O.
 *
 * Lets an MCP client (Claude Desktop, Claude Code, …) drive the Jarvis fleet as tools — list
 * machines/sessions, read fleet status, kick off a task on a machine.
 */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>): Promise<string> | string;
}

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}

function result(id: JsonRpcMessage["id"], r: unknown): JsonRpcMessage { return { jsonrpc: "2.0", id, result: r }; }
function error(id: JsonRpcMessage["id"], code: number, message: string): JsonRpcMessage { return { jsonrpc: "2.0", id, error: { code, message } }; }

/**
 * Handle one JSON-RPC message. Returns the response to write back, or `null` for notifications
 * (no `id`) and anything that needs no reply. Never throws — a failing tool becomes an MCP
 * tool-error result so the client sees it instead of the stream dying.
 */
export async function handleMcp(msg: JsonRpcMessage, tools: McpTool[], serverInfo: { name: string; version: string }): Promise<JsonRpcMessage | null> {
  const { method, id } = msg;
  if (method === "initialize") {
    return result(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo });
  }
  if (method === "tools/list") {
    return result(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === "tools/call") {
    const tool = tools.find((t) => t.name === msg.params?.name);
    if (!tool) return error(id, -32602, `ferramenta desconhecida: ${msg.params?.name}`);
    try {
      const text = await tool.handler((msg.params?.arguments as Record<string, unknown>) || {});
      return result(id, { content: [{ type: "text", text: String(text) }] });
    } catch (e: any) {
      return result(id, { content: [{ type: "text", text: "erro: " + String(e?.message ?? e) }], isError: true });
    }
  }
  if (method === "ping") return result(id, {});
  // notifications (no id) and unknown methods
  if (id === undefined || id === null) return null; // notification → no reply
  return error(id, -32601, `método não suportado: ${method}`);
}
