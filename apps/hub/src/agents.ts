/**
 * Agent adapters — the agnostic seam. v1 ships:
 *  - MockAgentAdapter    : echoes; lets the Hub be tested before `claude /login`.
 *  - ClaudeCodeAdapter   : drives the NATIVE Windows `claude` headless.
 *
 * A Codex adapter (and others) slot in here without touching routing.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentReply {
  text: string;
}

export interface AgentAdapter {
  readonly name: string;
  /** send a user message in a session, get the assistant's reply */
  send(sessionId: string, text: string, cwd: string): Promise<AgentReply>;
}

/** v1 fallback so the server is testable end-to-end before Claude is logged in. */
export class MockAgentAdapter implements AgentAdapter {
  readonly name = "mock";
  async send(_sessionId: string, text: string): Promise<AgentReply> {
    return {
      text:
        `Recebi sua mensagem: "${text}". Sou o agente mock — o Hub, o chat e a voz ` +
        `estão funcionando. Assim que o \`claude\` nativo estiver logado (claude /login), ` +
        `troco pra respostas reais.`,
    };
  }
}

/** Resolve the native claude binary (Windows native installer path, or PATH). */
function claudeBin(): string {
  const local = join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return existsSync(local) ? local : "claude";
}

/** Drives native Claude Code headless. Requires `claude` logged in (claude /login once). */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code";
  private claudeSessions = new Map<string, string>();

  async send(sessionId: string, text: string, cwd: string): Promise<AgentReply> {
    const prev = this.claudeSessions.get(sessionId);
    const args = ["-p", text, "--output-format", "json", "--permission-mode", "bypassPermissions"];
    if (prev) args.unshift("--resume", prev);

    const raw = await run(claudeBin(), args, cwd);
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error("claude: unexpected output: " + raw.slice(0, 200));
    }
    if (json.is_error) throw new Error(json.result || "claude reported an error");
    if (json.session_id) this.claudeSessions.set(sessionId, json.session_id);
    return { text: json.result ?? "" };
  }
}

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (out.trim()) resolve(out);
      else reject(new Error(err.trim() || `${cmd} exited with ${code}`));
    });
  });
}
