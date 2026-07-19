/**
 * Slash-command / skill discovery + expansion for the composer's "/" autocomplete.
 *
 * Sources are the UNION across the agents Jarvis drives that HAVE a command system — Claude and
 * Codex (Aider has no custom-command files; Cursor is an IDE, not a headless CLI). Per machine:
 *   - Claude: ~/.claude/skills/<name>/SKILL.md, ~/.claude/commands/**\/*.md (namespaced "ns:cmd"),
 *             and the project's .claude/{skills,commands}.
 *   - Codex:  ~/.codex/skills/<name>/SKILL.md (best-effort) and ~/.codex/prompts/*.md.
 * On a NAME CLASH, Claude wins (Claude is mandatory and takes preference); within one agent, a
 * project entry beats a user one. Marketplace plugins are still out of scope (no reliable enabled map).
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

export type CmdAgent = "claude" | "codex";
export interface SlashCommand {
  name: string;              // "flow:discovery" (Claude), "flow-discovery" (Codex), or a skill name
  description: string;
  argHint?: string;
  kind: "skill" | "command";
  agent: CmdAgent;
  source: "user" | "project";
  /** File to read for expansion — internal; stripped by listCommandsPublic before it reaches a client. */
  path: string;
}

// Overridable so tests can point at fixture agent-homes (production leaves them unset).
const claudeHome = (): string => process.env.JARVIS_CLAUDE_HOME || join(homedir(), ".claude");
const codexHome = (): string => process.env.JARVIS_CODEX_HOME || join(homedir(), ".codex");

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
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
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

// Lower = higher priority. Claude beats Codex on a name clash; a project entry beats a user one.
const prio = (c: SlashCommand): number => (c.agent === "claude" ? 0 : 10) + (c.source === "project" ? 0 : 1);
const leafOf = (name: string): string => name.split(":").pop() || name;

/** Map an ADAPTER name (as stored on a session: "claude-code" | "codex" | "aider" | "mock") to the
 *  command-owning agent, or null for adapters with no command system. Used to show/expand only the
 *  selected AI's skills+commands — a Codex turn must not run a Claude command, and vice-versa. */
export function cmdAgentOf(adapterName?: string): CmdAgent | null {
  if (adapterName === "claude-code") return "claude";
  if (adapterName === "codex") return "codex";
  return null;
}

const cache = new Map<string, { key: string; data: SlashCommand[] }>();
/** All available skills + commands for `cwd` across Claude + Codex, deduped by name (Claude wins).
 *  Cached, keyed on the source dirs' mtimes so a newly added command shows up without a restart. */
export function listCommands(cwd?: string): SlashCommand[] {
  const ch = claudeHome(), xh = codexHome();
  const dirs = [join(ch, "skills"), join(ch, "commands"), join(xh, "skills"), join(xh, "prompts")];
  if (cwd) dirs.push(join(cwd, ".claude", "skills"), join(cwd, ".claude", "commands"));
  const key = dirs.map((d) => { try { return d + ":" + statSync(d).mtimeMs; } catch { return d + ":0"; } }).join("|");
  const ck = cwd || "";
  const hit = cache.get(ck);
  if (hit && hit.key === key) return hit.data;
  const out: SlashCommand[] = [];
  scanSkills(join(ch, "skills"), "claude", "user", out);
  scanCommands(join(ch, "commands"), "claude", "user", out);
  scanSkills(join(xh, "skills"), "codex", "user", out);
  scanCommands(join(xh, "prompts"), "codex", "user", out);   // Codex prompts are the equivalent of slash-commands
  if (cwd) { scanSkills(join(cwd, ".claude", "skills"), "claude", "project", out); scanCommands(join(cwd, ".claude", "commands"), "claude", "project", out); }
  out.sort((a, b) => prio(a) - prio(b) || a.name.localeCompare(b.name));
  const byName = new Map<string, SlashCommand>();
  for (const c of out) if (!byName.has(c.name)) byName.set(c.name, c);   // first (highest-priority) wins
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
export function expandCommand(text: string, cwd?: string, agent?: CmdAgent | null): { name: string; expanded: string } | null {
  const m = /^\/([A-Za-z0-9:_.-]+)(?:[ \t]+([\s\S]*))?$/.exec((text || "").trim());
  if (!m) return null;
  const typed = m[1], args = (m[2] || "").trim();
  let all = listCommands(cwd);   // priority-sorted-then-alpha; find() returns the preferred on ties
  if (agent) all = all.filter((c) => c.agent === agent);
  else if (agent === null) return null;   // adapter with no command system → nothing to expand
  const cmd = all.find((c) => c.name === typed) || all.find((c) => leafOf(c.name) === leafOf(typed));
  if (!cmd) return null;
  if (cmd.kind === "skill") return { name: cmd.name, expanded: `Use the "${cmd.name}" skill.` + (args ? ` Context: ${args}` : "") };
  let body = "";
  try { body = splitFrontmatter(readFileSync(cmd.path, "utf8")).body; } catch { return null; }
  const expanded = body
    .replace(/\$ARGUMENTS\b/g, args).replace(/\$\{ARGUMENTS\}/g, args)
    .replace(/\$@/g, args).replace(/\$1\b/g, args)
    .trim();
  return { name: cmd.name, expanded: expanded || (`/${cmd.name}` + (args ? ` ${args}` : "")) };
}
