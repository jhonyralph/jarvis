/**
 * BRW-IDE-00 F2 — prova que a ponte `jarvisbrowser` chega MESMO à sessão da IA pelo caminho de
 * produção dos adaptadores: o Claude Code recebe o servidor no `--mcp-config` do turno (e o
 * `--allowedTools` fora do modo manual) e o Codex recebe os `-c mcp_servers.jarvisbrowser.*` — incluindo
 * a travessia das aspas pelo shim `.cmd` do Windows (o codex instalado pelo npm é um `codex.cmd`).
 * As CLIs são FALSAS (gravam o argv e o mcp-config num arquivo); HOME/USERPROFILE apontam para uma
 * pasta temporária, então nada aqui encosta no ~/.jarvis, ~/.claude ou ~/.codex de verdade.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "jarvis-brw-adapters-"));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
delete process.env.JARVIS_TASK_URL; delete process.env.JARVIS_TASK_TOKEN; delete process.env.JARVIS_PERM_URL; delete process.env.JARVIS_PERM_TOKEN;
// O shim `.cmd` da CLI falsa corta argumento com quebra de linha (o claude de verdade é um .exe nativo):
// desliga o --append-system-prompt multilinha, que não é o que este teste mede.
process.env.JARVIS_BG_JOBS = "off";
after(() => rmSync(HOME, { recursive: true, force: true }));

const { ClaudeCodeAdapter, CodexAdapter } = await import("./agents.js");

const FAKE = `import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const i = argv.indexOf("--mcp-config");
let mcp = null; try { if (i >= 0) mcp = JSON.parse(readFileSync(argv[i + 1], "utf8")); } catch {}
writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv, mcp }));
if (process.env.FAKE_KIND === "codex") {
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "ok" } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n");
} else process.stdout.write(JSON.stringify({ type: "result", result: "ok", is_error: false }));
`;

function fakeCli(name: string): string {
  const dir = mkdtempSync(join(HOME, "bin-"));
  writeFileSync(join(dir, "fake-cli.mjs"), FAKE);
  if (process.platform === "win32") {
    const p = join(dir, name + ".cmd");
    writeFileSync(p, `@node "%~dp0fake-cli.mjs" %*\r\n`);
    return p;
  }
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\nexec node "$(dirname "$0")/fake-cli.mjs" "$@"\n`);
  chmodSync(p, 0o755);
  return p;
}
const NO_CAPS = { at: Date.now(), caps: { models: [], defaultModel: undefined } };
const access = { url: "http://127.0.0.1:65000/internal/browser", token: "tok-abc123" };

test("Claude Code: --mcp-config do turno leva o jarvisbrowser com URL+token; --allowedTools fora do modo manual", async () => {
  const bin = fakeCli("claude");
  for (const mode of ["bypass", "manual"] as const) {
    const out = join(HOME, `claude-${mode}.json`);
    process.env.FAKE_OUT = out; process.env.FAKE_KIND = "claude";
    const a = new ClaudeCodeAdapter() as any;
    a.bin = bin; a.capsCache = NO_CAPS;
    await a.send("sess-" + mode, "olá", HOME, { permissionMode: mode, browserTools: access });
    const got = JSON.parse(readFileSync(out, "utf8"));
    const srv = got.mcp?.mcpServers?.jarvisbrowser;
    assert.ok(srv, `${mode}: jarvisbrowser no mcp-config: ${JSON.stringify(got)}`);
    assert.equal(srv.command, "node");
    assert.match(srv.args[0], /browser-bridge\.mjs$/);
    assert.equal(srv.env.JARVIS_BROWSER_URL, access.url);
    assert.equal(srv.env.JARVIS_BROWSER_TOKEN, access.token);
    // a ponte foi escrita na HOME do processo (temporária aqui)
    assert.match(readFileSync(srv.args[0], "utf8"), /jarvisbrowser/);
    const allowed = got.argv.indexOf("--allowedTools");
    if (mode === "manual") assert.equal(allowed, -1, "no manual cada chamada passa pela aprovação do dono");
    else assert.equal(got.argv[allowed + 1], "mcp__jarvisbrowser");
  }
  // sem browserTools (turno de membro / máquina sem browser): nada de jarvisbrowser
  const out = join(HOME, "claude-none.json");
  process.env.FAKE_OUT = out;
  const a = new ClaudeCodeAdapter() as any;
  a.bin = bin; a.capsCache = NO_CAPS;
  await a.send("sess-none", "olá", HOME, { permissionMode: "bypass" });
  const got = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(!got.mcp?.mcpServers?.jarvisbrowser);
  assert.ok(!got.argv.includes("--allowedTools"));
});

test("Codex: -c mcp_servers.jarvisbrowser.* atravessa o shim e chega intacto ao argv da CLI", async () => {
  const bin = fakeCli("codex");
  process.env.PATH = join(bin, "..") + (process.platform === "win32" ? ";" : ":") + process.env.PATH;
  const out = join(HOME, "codex.json");
  process.env.FAKE_OUT = out; process.env.FAKE_KIND = "codex";
  const a = new CodexAdapter() as any;
  a.capsCache = NO_CAPS;
  await a.send("sess-codex", "olá", HOME, { permissionMode: "bypass", browserTools: access }, () => {});
  const got = JSON.parse(readFileSync(out, "utf8"));
  const cfg = got.argv.filter((_: string, i: number, arr: string[]) => arr[i - 1] === "-c");
  assert.ok(cfg.includes('mcp_servers.jarvisbrowser.command="node"'), JSON.stringify(got.argv));
  assert.ok(cfg.some((c: string) => /^mcp_servers\.jarvisbrowser\.args=\[".*browser-bridge\.mjs"\]$/.test(c)), JSON.stringify(cfg));
  assert.ok(cfg.includes(`mcp_servers.jarvisbrowser.env.JARVIS_BROWSER_URL="${access.url}"`));
  assert.ok(cfg.includes(`mcp_servers.jarvisbrowser.env.JARVIS_BROWSER_TOKEN="${access.token}"`));
  assert.ok(cfg.includes('mcp_servers.jarvisbrowser.default_tools_approval_mode="approve"'));
  // execução gerenciada (subagente) nunca recebe a ponte
  const out2 = join(HOME, "codex-managed.json");
  process.env.FAKE_OUT = out2;
  const b = new CodexAdapter() as any;
  b.capsCache = NO_CAPS;
  await b.send("sess-managed", "olá", HOME, { managed: { workspaceAccess: "read_only", preventCommits: true }, browserTools: access }, () => {}).catch(() => {});
  try { assert.ok(!readFileSync(out2, "utf8").includes("jarvisbrowser")); } catch (e: any) { if (e?.code !== "ENOENT") throw e; }
});
