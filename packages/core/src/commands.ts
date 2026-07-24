/**
 * Slash-command / skill discovery + expansion for the composer's "/" autocomplete.
 *
 * Sources are the union across adapters that expose discoverable local command/skill files.
 *   - Claude: ~/.claude/skills/<name>/SKILL.md, ~/.claude/commands/**\/*.md (namespaced "ns:cmd"),
 *             and the project's .claude/{skills,commands}.
 *   - Codex:  ~/.codex/skills/<name>/SKILL.md (best-effort) and ~/.codex/prompts/*.md.
 * Homonyms from different providers coexist; within one provider, project beats user/builtin.
 * Directories not documented by a provider are best-effort and never imply runtime certification.
 *
 * Expansion ("(b)"): a command's markdown body IS its prompt template, so we substitute the args
 * ($ARGUMENTS / $@ / $1) ourselves and send the expanded prompt to the agent — works even headless.
 * Skills are model-invoked, so we send a short "use the <name> skill" instruction. The chat still
 * shows the raw "/name". Matching is name-tolerant: "/discovery" resolves the Claude-preferred entry
 * whose leaf name is "discovery" even if it lives under a namespace ("flow:discovery").
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { frameworkRoot, type FrameworkPreference } from "./framework.js";

/** "jarvis" is the universal, provider-agnostic framework source — it is not a real adapter, so it is
 *  offered alongside whatever AI is active (see expandCommand), not selected by cmdAgentOf. */
export type CmdAgent = "jarvis" | "claude" | "codex" | "gemini" | "cursor" | "copilot" | "opencode" | "cline" | "qwen" | "continue" | "kiro" | "antigravity" | "aider";
export interface SlashCommand {
  name: string;              // "flow:discovery" (Claude), "flow-discovery" (Codex), or a skill name
  description: string;
  argHint?: string;
  kind: "skill" | "command" | "mcp" | "builtin";
  agent: CmdAgent;
  source: "user" | "project" | "builtin";
  /** File to read for expansion — internal; stripped by listCommandsPublic before it reaches a client. */
  path: string;
}

// Overridable so tests can point at fixture agent-homes (production leaves them unset).
const claudeHome = (): string => process.env.JARVIS_CLAUDE_HOME || join(homedir(), ".claude");
const codexHome = (): string => process.env.JARVIS_CODEX_HOME || join(homedir(), ".codex");
const claudeJson = (): string => process.env.JARVIS_CLAUDE_JSON || join(homedir(), ".claude.json");

function splitFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { fm: {}, body: text };
  return { fm: parseFrontmatter(m[1]), body: m[2] };
}
/** Minimal YAML frontmatter: `key: value` (optionally quoted) and folded/literal block scalars. */
function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key: string | null = null, folded = false, buf: string[] = [];
  const flush = (): void => { if (key) out[key] = buf.join(" ").replace(/\s+/g, " ").trim(); key = null; buf = []; folded = false; };
  for (const raw of block.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(raw);
    if (kv && !/^\s/.test(raw)) {
      flush();
      key = kv[1];
      const v = kv[2].trim();
      if (v === "" || v === ">-" || v === ">" || v === "|" || v === "|-") folded = true;
      else buf = [v.replace(/^["']|["']$/g, "")];
    } else if (key && folded && /^\s+\S/.test(raw)) {
      buf.push(raw.trim());
    }
  }
  flush();
  return out;
}
/** A description for a command lacking a frontmatter one: its first non-empty, non-heading body line. */
function firstLine(body: string): string {
  for (const ln of body.split(/\r?\n/)) { const t = ln.trim(); if (t && !t.startsWith("#") && !t.startsWith("---")) return t.slice(0, 200); }
  return "";
}

function scanSkills(dir: string, agent: CmdAgent, source: SlashCommand["source"], out: SlashCommand[]): void {
  if (!existsSync(dir)) return;
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    if (d.name === ".system") { scanSkills(join(dir, d.name), agent, source, out); continue; }
    if (d.name.startsWith(".")) continue;
    const f = join(dir, d.name, "SKILL.md");
    if (!existsSync(f)) continue;
    let fm: Record<string, string>;
    try { fm = splitFrontmatter(readFileSync(f, "utf8")).fm; } catch { continue; }
    out.push({ name: fm.name || d.name, description: (fm.description || "").slice(0, 300), kind: "skill", agent, source, path: f });
  }
}
function scanCommands(dir: string, agent: CmdAgent, source: SlashCommand["source"], out: SlashCommand[], prefix = ""): void {
  if (!existsSync(dir)) return;
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    if (d.isDirectory()) { if (!d.name.startsWith(".")) scanCommands(join(dir, d.name), agent, source, out, prefix + d.name + ":"); continue; }
    if (!d.name.endsWith(".md")) continue;
    const f = join(dir, d.name);
    let parsed: { fm: Record<string, string>; body: string } = { fm: {}, body: "" };
    try { parsed = splitFrontmatter(readFileSync(f, "utf8")); } catch { /* name-only */ }
    out.push({ name: prefix + basename(d.name, ".md"), description: (parsed.fm.description || firstLine(parsed.body)).slice(0, 300), argHint: parsed.fm["argument-hint"], kind: "command", agent, source, path: f });
  }
}

/** Configured MCP servers (Claude): global ~/.claude.json `mcpServers` + this project's entry + a
 *  project .mcp.json. Listed for discovery (kind:"mcp") — the model invokes the actual tools; there's
 *  no reliable static tool catalog without connecting to each server. */
function scanMcp(cwd: string | undefined, out: SlashCommand[]): void {
  const add = (servers: any, source: SlashCommand["source"], origin: string): void => {
    if (!servers || typeof servers !== "object") return;
    for (const name of Object.keys(servers)) {
      const s = servers[name] || {};
      const kind = s.type || (s.url ? "http" : s.command ? "stdio" : "");
      out.push({ name, description: `Servidor MCP${kind ? ` (${kind})` : ""}${origin ? ` · ${origin}` : ""}`, kind: "mcp", agent: "claude", source, path: "" });
    }
  };
  try {
    const j = JSON.parse(readFileSync(claudeJson(), "utf8"));
    add(j.mcpServers, "user", "global");
    if (cwd && j.projects && j.projects[cwd]) add(j.projects[cwd].mcpServers, "project", "projeto");
  } catch { /* no ~/.claude.json */ }
  if (cwd) { try { const j = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf8")); add(j.mcpServers || j, "project", ".mcp.json"); } catch { /* none */ } }
}
/** Codex MCP servers from ~/.codex/config.toml — minimal TOML: just the `[mcp_servers.<name>]`
 *  section headers (name is enough for discovery; the model invokes the tools). */
function scanCodexMcp(out: SlashCommand[]): void {
  let raw: string;
  try { raw = readFileSync(process.env.JARVIS_CODEX_CONFIG || join(codexHome(), "config.toml"), "utf8"); } catch { return; }
  const seen = new Set<string>();
  for (const ln of raw.split(/\r?\n/)) {
    const h = /^\s*\[mcp_servers\.(?:"([^"]+)"|([^.\]]+))\]/.exec(ln);
    const name = h && (h[1] || h[2]);
    if (name && !seen.has(name)) { seen.add(name); out.push({ name, description: "Servidor MCP · codex", kind: "mcp", agent: "codex", source: "user", path: "" }); }
  }
}

function scanJsonMcp(path: string, agent: CmdAgent, source: SlashCommand["source"], label: string, out: SlashCommand[]): void {
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    const servers = json.mcpServers || json.mcp || json.servers;
    if (!servers || typeof servers !== "object") return;
    for (const name of Object.keys(servers)) out.push({ name, description: `Servidor MCP · ${label}`, kind: "mcp", agent, source, path: "" });
  } catch { /* absent or provider-owned non-JSON config */ }
}

// Claude Code's BUILT-IN slash-commands are baked into the binary (not files) and aren't enumerable,
// so this is a small CURATED set of the useful headless ones. They PASS THROUGH unexpanded — inside
// `claude -p`, "/name" resolves as a built-in skill (verified via `claude --help`: "Skills still
// resolve via /skill-name"). Curated on purpose; may drift with Claude Code versions.
const BUILTIN_CLAUDE: Array<{ name: string; description: string }> = [
  { name: "code-review", description: "Revisar o diff atual (correção + limpeza)" },
  { name: "review", description: "Revisar um pull request do GitHub" },
  { name: "security-review", description: "Revisão de segurança das mudanças pendentes" },
  { name: "init", description: "Gerar/atualizar o CLAUDE.md do projeto" },
];
function scanBuiltins(out: SlashCommand[]): void {
  for (const b of BUILTIN_CLAUDE) out.push({ name: b.name, description: b.description, kind: "builtin", agent: "claude", source: "builtin", path: "" });
}

// Lower = higher priority within one provider: project > user > builtin.
const prio = (c: SlashCommand): number => (c.source === "project" ? 0 : c.source === "user" ? 1 : 2);
const leafOf = (name: string): string => name.split(":").pop() || name;
/** Resolve the typed "/name" against the eligible pool. Exact name wins over a leaf-name match. When a
 *  name exists BOTH natively and in the Jarvis framework, `preference` decides: "jarvis" picks the
 *  universal one, "native"/"ask" prefer the AI's own (the composer surfaces both tags for "ask"). With
 *  no framework homonym in play this is the legacy first-match, preserving provider priority. */
function pickCommand(pool: SlashCommand[], typed: string, preference: FrameworkPreference): SlashCommand | undefined {
  const exact = pool.filter((c) => c.name === typed);
  const matches = exact.length ? exact : pool.filter((c) => leafOf(c.name) === leafOf(typed));
  if (matches.length <= 1) return matches[0];
  const jarvisM = matches.find((c) => c.agent === "jarvis");
  const nativeM = matches.find((c) => c.agent !== "jarvis");
  if (!jarvisM) return matches[0];        // e.g. claude vs codex homonym — keep priority order
  if (!nativeM) return jarvisM;
  return preference === "jarvis" ? jarvisM : nativeM;
}
/** The prompt a matched command/skill/mcp expands to. null = pass the raw "/name" through unchanged
 *  (built-ins — Claude resolves them itself; or an unreadable command file). */
function expandOne(cmd: SlashCommand, args: string): string | null {
  if (cmd.kind === "builtin") return null;
  if (cmd.kind === "skill") {
    // Native skills are model-invoked by name (the provider loads the file). A Jarvis universal skill
    // may run on an AI that has no such skill, so we INLINE its SKILL.md body — that is what makes it
    // work anywhere. Fall back to the name-only hint if the body is unreadable/empty.
    if (cmd.agent === "jarvis" && cmd.path) {
      let body = "";
      try { body = splitFrontmatter(readFileSync(cmd.path, "utf8")).body; } catch { body = ""; }
      const sub = body.replace(/\$ARGUMENTS\b/g, args).replace(/\$\{ARGUMENTS\}/g, args).replace(/\$@/g, args).replace(/\$1\b/g, args).trim();
      if (sub) return `Use a competência "${cmd.name}" do Framework Jarvis.\nInstruções:\n\n${sub}` + (args && sub === body.trim() ? `\n\nContexto: ${args}` : "");
    }
    return `Use the "${cmd.name}" skill.` + (args ? ` Context: ${args}` : "");
  }
  if (cmd.kind === "mcp") return `Use the "${cmd.name}" MCP server's tools.` + (args ? ` ${args}` : "");
  let body = "";
  try { body = splitFrontmatter(readFileSync(cmd.path, "utf8")).body; } catch { return null; }
  return body.replace(/\$ARGUMENTS\b/g, args).replace(/\$\{ARGUMENTS\}/g, args).replace(/\$@/g, args).replace(/\$1\b/g, args).trim()
    || (`/${cmd.name}` + (args ? ` ${args}` : ""));
}

/** Map an adapter id to the provider that owns its local command system.
 *  command-owning agent, or null for adapters with no command system. Used to show/expand only the
 *  selected AI's skills+commands — a Codex turn must not run a Claude command, and vice-versa. */
export function cmdAgentOf(adapterName?: string): CmdAgent | null {
  if (adapterName === "claude-code") return "claude";
  if (adapterName && ["codex", "gemini", "cursor", "copilot", "opencode", "cline", "qwen"].includes(adapterName)) return adapterName as CmdAgent;
  return null;
}

const cache = new Map<string, { key: string; data: SlashCommand[] }>();
/** All available skills + commands for `cwd`, deduped by (provider,name).
 *  Cached, keyed on the source dirs' mtimes so a newly added command shows up without a restart. */
export function listCommands(cwd?: string): SlashCommand[] {
  const ch = claudeHome(), xh = codexHome();
  const ah = join(homedir(), ".agents");
  const jf = frameworkRoot(); // universal "Framework Jarvis" source, shared across every AI
  const providerDirs: Array<[CmdAgent, string, string]> = [
    ["gemini", join(homedir(), ".gemini", "skills"), join(homedir(), ".gemini", "commands")],
    ["cursor", join(homedir(), ".cursor", "skills"), join(homedir(), ".cursor", "commands")],
    ["copilot", join(homedir(), ".copilot", "skills"), join(homedir(), ".copilot", "commands")],
    ["opencode", join(homedir(), ".opencode", "skills"), join(homedir(), ".opencode", "commands")],
    ["cline", join(homedir(), ".cline", "data", "settings", "skills"), join(homedir(), ".cline", "commands")],
    ["qwen", join(homedir(), ".qwen", "skills"), join(homedir(), ".qwen", "commands")],
  ];
  const dirs = [join(ch, "skills"), join(ch, "commands"), join(xh, "skills"), join(xh, "prompts"), join(ah, "skills"), join(jf, "skills"), join(jf, "commands"), claudeJson(), process.env.JARVIS_CODEX_CONFIG || join(xh, "config.toml"), ...providerDirs.flatMap((x) => [x[1], x[2]])];
  if (cwd) dirs.push(join(cwd, ".claude", "skills"), join(cwd, ".claude", "commands"), join(cwd, ".agents", "skills"), join(cwd, ".jarvis", "framework", "skills"), join(cwd, ".jarvis", "framework", "commands"), join(cwd, ".mcp.json"), join(cwd, ".cline", "mcp.json"), join(cwd, ".cursor", "mcp.json"));
  const key = dirs.map((d) => { try { return d + ":" + statSync(d).mtimeMs; } catch { return d + ":0"; } }).join("|");
  const ck = cwd || "";
  const hit = cache.get(ck);
  if (hit && hit.key === key) return hit.data;
  const out: SlashCommand[] = [];
  scanSkills(join(ch, "skills"), "claude", "user", out);
  scanCommands(join(ch, "commands"), "claude", "user", out);
  scanSkills(join(xh, "skills"), "codex", "user", out);
  scanSkills(join(ah, "skills"), "codex", "user", out); // official cross-agent/Codex skill home
  scanCommands(join(xh, "prompts"), "codex", "user", out);   // Codex prompts are the equivalent of slash-commands
  for (const [agent, skills, commands] of providerDirs) { scanSkills(skills, agent, "user", out); scanCommands(commands, agent, "user", out); }
  scanSkills(join(jf, "skills"), "jarvis", "user", out);   // universal skills — offered under every AI
  scanCommands(join(jf, "commands"), "jarvis", "user", out);
  scanMcp(cwd, out);
  scanCodexMcp(out);
  scanBuiltins(out);
  if (cwd) {
    scanSkills(join(cwd, ".claude", "skills"), "claude", "project", out); scanCommands(join(cwd, ".claude", "commands"), "claude", "project", out);
    scanSkills(join(cwd, ".agents", "skills"), "codex", "project", out);
    scanSkills(join(cwd, ".jarvis", "framework", "skills"), "jarvis", "project", out);
    scanCommands(join(cwd, ".jarvis", "framework", "commands"), "jarvis", "project", out);
    scanSkills(join(cwd, ".cline", "skills"), "cline", "project", out);
    scanSkills(join(cwd, ".qwen", "skills"), "qwen", "project", out);
    scanCommands(join(cwd, ".cursor", "commands"), "cursor", "project", out);
    scanCommands(join(cwd, ".opencode", "commands"), "opencode", "project", out);
    scanJsonMcp(join(cwd, ".mcp.json"), "copilot", "project", ".mcp.json", out);
    scanJsonMcp(join(cwd, ".cursor", "mcp.json"), "cursor", "project", ".cursor/mcp.json", out);
    scanJsonMcp(join(cwd, ".cline", "mcp.json"), "cline", "project", ".cline/mcp.json", out);
    scanJsonMcp(join(cwd, ".gemini", "settings.json"), "gemini", "project", ".gemini/settings.json", out);
    scanJsonMcp(join(cwd, ".qwen", "settings.json"), "qwen", "project", ".qwen/settings.json", out);
  }
  out.sort((a, b) => prio(a) - prio(b) || a.name.localeCompare(b.name));
  const byName = new Map<string, SlashCommand>();
  for (const c of out) { const key = `${c.agent}\0${c.name}`; if (!byName.has(key)) byName.set(key, c); }
  const data = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (cache.size > 16) cache.clear();
  cache.set(ck, { key, data });
  return data;
}
/** UI-facing list — no filesystem paths leak to the client. */
export function listCommandsPublic(cwd?: string): Array<Omit<SlashCommand, "path">> {
  return listCommands(cwd).map(({ path, ...pub }) => pub);
}

/** If `text` is "/name [args]" for a known skill/command, return the prompt to send the agent (the
 *  chat still shows the raw "/name"). Name-tolerant: falls back to a leaf-name match. When `agent` is
 *  given, ONLY that agent's entries are considered (a Codex turn never runs a Claude command); pass
 *  the session's adapter name via cmdAgentOf. null when it isn't one — the caller sends `text` as-is. */
export function expandCommand(text: string, cwd?: string, agent?: CmdAgent | null, opts?: { preference?: FrameworkPreference }): { name: string; expanded: string } | null {
  const preference = opts?.preference ?? "ask";
  const all = listCommands(cwd);     // priority-sorted-then-alpha
  // Eligible pool: the active AI's own entries PLUS the universal Jarvis framework, which is offered
  // under every AI. `agent === undefined` is the legacy unscoped view (all providers). `agent === null`
  // is an adapter with no native command system — it still gets Jarvis universal commands.
  const pool = agent === undefined ? all
    : agent === null ? all.filter((c) => c.agent === "jarvis")
    : all.filter((c) => c.agent === agent || c.agent === "jarvis");
  // A "/command" may sit after whitespace on ANY line, including mid-message. Expand the first such
  // token whose command has a prompt; surrounding text is kept as context. Built-ins
  // (expandOne → null) are left raw so `claude -p` resolves "/name" itself.
  const lines = (text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /(^|[\s(])\/([A-Za-z0-9:_.-]+)(?:[ \t]+(.*))?$/.exec(lines[i]);
    if (!m) continue;
    const cmd = pickCommand(pool, m[2], preference);
    if (!cmd) continue;
    const exp = expandOne(cmd, (m[3] || "").trim());
    if (exp == null) continue;   // built-in / unreadable → leave the line raw, keep scanning
    const out = [...lines]; out[i] = lines[i].slice(0, m.index + m[1].length) + exp;
    return { name: cmd.name, expanded: out.join("\n").trim() };
  }
  return null;
}
