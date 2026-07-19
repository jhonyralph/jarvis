/**
 * Slash-command / skill discovery + expansion for the composer's "/" autocomplete.
 *
 * Sources (per machine — each runner has its own ~/.claude): user skills (~/.claude/skills/<name>/
 * SKILL.md), user commands (~/.claude/commands/**\/*.md, name = "ns:cmd"), and the project's own
 * .claude/{skills,commands}. Marketplace PLUGINS are intentionally out of scope for now: there's no
 * reliable on-disk "enabled" map, and scanning every marketplace plugin would list hundreds of
 * disabled ones.
 *
 * Expansion (the chosen "(b)" behavior): a command's markdown body IS its prompt template, so we
 * substitute $ARGUMENTS ourselves and send the expanded prompt to the agent — this works even in
 * headless `claude -p`, where slash-command expansion isn't guaranteed. Skills are model-invoked
 * (the Skill tool), so we send a short instruction to use the named skill. The chat still shows the
 * raw "/name" the user typed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

export interface SlashCommand {
  name: string;              // "flow:discovery" (command) or "evidence-driven-delivery" (skill)
  description: string;
  argHint?: string;          // from a command's `argument-hint` frontmatter
  kind: "skill" | "command";
  source: "user" | "project";
  /** File to read for expansion — internal; stripped by listCommandsPublic before it reaches a client. */
  path: string;
}

// Overridable so tests can point at a fixture ~/.claude (production leaves it unset).
const claudeHome = (): string => process.env.JARVIS_CLAUDE_HOME || join(homedir(), ".claude");

/** Split a markdown file into its YAML frontmatter map + the body after it. */
function splitFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { fm: {}, body: text };
  return { fm: parseFrontmatter(m[1]), body: m[2] };
}
/** Minimal YAML frontmatter: `key: value` (optionally quoted) and folded/literal block scalars
 *  (`>-`, `>`, `|`, or an empty value followed by indented lines). Enough for name/description/hint. */
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
      if (v === "" || v === ">-" || v === ">" || v === "|" || v === "|-") folded = true;   // value on following indented lines
      else buf = [v.replace(/^["']|["']$/g, "")];
    } else if (key && folded && /^\s+\S/.test(raw)) {
      buf.push(raw.trim());
    }
  }
  flush();
  return out;
}

function scanSkills(dir: string, source: SlashCommand["source"], out: SlashCommand[]): void {
  if (!existsSync(dir)) return;
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const f = join(dir, d.name, "SKILL.md");
    if (!existsSync(f)) continue;
    let fm: Record<string, string>;
    try { fm = splitFrontmatter(readFileSync(f, "utf8")).fm; } catch { continue; }
    out.push({ name: fm.name || d.name, description: (fm.description || "").slice(0, 300), kind: "skill", source, path: f });
  }
}
function scanCommands(dir: string, source: SlashCommand["source"], out: SlashCommand[], prefix = ""): void {
  if (!existsSync(dir)) return;
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    if (d.isDirectory()) { scanCommands(join(dir, d.name), source, out, prefix + d.name + ":"); continue; }
    if (!d.name.endsWith(".md")) continue;
    const f = join(dir, d.name);
    let fm: Record<string, string> = {};
    try { fm = splitFrontmatter(readFileSync(f, "utf8")).fm; } catch { /* keep name-only */ }
    out.push({ name: prefix + basename(d.name, ".md"), description: (fm.description || "").slice(0, 300), argHint: fm["argument-hint"], kind: "command", source, path: f });
  }
}

const cache = new Map<string, { key: string; data: SlashCommand[] }>();
/** All available skills + commands for `cwd` (project overrides user on a name clash). Cached, keyed
 *  on the source dirs' mtimes so a newly added skill shows up without a restart. */
export function listCommands(cwd?: string): SlashCommand[] {
  const home = claudeHome();
  const dirs = [join(home, "skills"), join(home, "commands")];
  if (cwd) dirs.push(join(cwd, ".claude", "skills"), join(cwd, ".claude", "commands"));
  const key = dirs.map((d) => { try { return d + ":" + statSync(d).mtimeMs; } catch { return d + ":0"; } }).join("|");
  const ck = cwd || "";
  const hit = cache.get(ck);
  if (hit && hit.key === key) return hit.data;
  const out: SlashCommand[] = [];
  scanSkills(join(home, "skills"), "user", out);
  scanCommands(join(home, "commands"), "user", out);
  if (cwd) { scanSkills(join(cwd, ".claude", "skills"), "project", out); scanCommands(join(cwd, ".claude", "commands"), "project", out); }
  const byName = new Map<string, SlashCommand>();
  for (const c of out) { const ex = byName.get(c.name); if (!ex || (c.source === "project" && ex.source === "user")) byName.set(c.name, c); }
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
 *  chat still shows the raw "/name"). null when it isn't one — the caller then sends `text` as-is. */
export function expandCommand(text: string, cwd?: string): { name: string; expanded: string } | null {
  const m = /^\/([A-Za-z0-9:_.-]+)(?:[ \t]+([\s\S]*))?$/.exec((text || "").trim());
  if (!m) return null;
  const name = m[1], args = (m[2] || "").trim();
  const cmd = listCommands(cwd).find((c) => c.name === name);
  if (!cmd) return null;
  if (cmd.kind === "skill") return { name, expanded: `Use the "${name}" skill.` + (args ? ` Context: ${args}` : "") };
  let body = "";
  try { body = splitFrontmatter(readFileSync(cmd.path, "utf8")).body; } catch { return null; }
  const expanded = body.replace(/\$ARGUMENTS/g, args).replace(/\$\{ARGUMENTS\}/g, args).trim();
  return { name, expanded: expanded || (`/${name}` + (args ? ` ${args}` : "")) };
}
