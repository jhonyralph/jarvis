/**
 * Minimal frontmatter reader for Framework Jarvis files. These files use only flat `key: value`
 * YAML frontmatter (name/description/argument-hint/allowed-tools…), so a full YAML parser would be
 * overkill and a new dependency. This reads the leading `---`…`---` block into a flat string map and
 * hands back the body plus the 1-based line where the body starts (so scanners can report file lines).
 * Unknown/nested YAML is preserved as raw text on the key — callers only rely on the flat scalars.
 */
export interface Frontmatter {
  /** Flat `key -> value` pairs from the frontmatter block (values trimmed, quotes stripped). */
  data: Record<string, string>;
  /** Everything after the closing `---` (or the whole file when there is no frontmatter). */
  body: string;
  /** true when a well-formed leading `---`…`---` block was found. */
  hasFrontmatter: boolean;
  /** 1-based line number of the first body line, so line offsets map back to the original file. */
  bodyStartLine: number;
}

function stripQuotes(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) return t.slice(1, -1);
  return t;
}

export function parseFrontmatter(content: string): Frontmatter {
  const text = String(content ?? "");
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { data: {}, body: text, hasFrontmatter: false, bodyStartLine: 1 };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { end = i; break; }
  }
  if (end === -1) return { data: {}, body: text, hasFrontmatter: false, bodyStartLine: 1 };
  const data: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (m) data[m[1].toLowerCase()] = stripQuotes(m[2]);
  }
  return { data, body: lines.slice(end + 1).join("\n"), hasFrontmatter: true, bodyStartLine: end + 2 };
}
