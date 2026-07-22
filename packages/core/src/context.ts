import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import type { ContextActor, ContextInstructionFile, ContextManifest, SessionContinuity } from "@jarvis/protocol";
import { CONTEXT_MANIFEST_SCHEMA_VERSION } from "@jarvis/protocol";

const MAX_AUDIT_BYTES = 10 * 1024 * 1024;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function instructionFileName(agent?: string): string {
  const name = String(agent || "").toLowerCase();
  if (name.includes("claude")) return "CLAUDE.md";
  if (name.includes("gemini")) return "GEMINI.md";
  return "AGENTS.md";
}

function globalInstructionFile(agent?: string): string | undefined {
  const name = String(agent || "").toLowerCase();
  if (name.includes("claude")) return join(homedir(), ".claude", "CLAUDE.md");
  if (name.includes("gemini")) return join(homedir(), ".gemini", "GEMINI.md");
  if (name.includes("codex")) return join(homedir(), ".codex", "AGENTS.md");
  return undefined;
}

/** Existing provider-instruction files that may affect a turn. This does not claim provider load. */
export function discoverInstructionFiles(cwd: string, agent?: string): ContextInstructionFile[] {
  const out: ContextInstructionFile[] = [];
  const seen = new Set<string>();
  const add = (path: string, scope: ContextInstructionFile["scope"]): void => {
    const key = process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    if (seen.has(key) || !existsSync(path)) return;
    try {
      const content = readFileSync(path, "utf8");
      seen.add(key);
      out.push({ path: resolve(path), size: Buffer.byteLength(content), sha256: sha256(content), scope, providerLoad: "candidate" });
    } catch { /* a transiently unreadable candidate must not block the turn */ }
  };

  const start = resolve(cwd || process.cwd());
  const root = parse(start).root;
  const fileName = instructionFileName(agent);
  let current = start;
  while (true) {
    add(join(current, fileName), current === start ? "cwd" : "ancestor");
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const global = globalInstructionFile(agent);
  if (global) add(global, "global");
  return out;
}

export interface BuildContextManifestInput {
  turnId?: string;
  sessionId: string;
  runnerId: string;
  agent: string;
  cwd: string;
  actor?: ContextActor;
  continuity: SessionContinuity;
  nativeSessionId?: string;
  history?: Array<{ text?: string }>;
  showText: string;
  agentText: string;
  images?: string[];
  files?: Array<{ name: string; content?: string }>;
  createdAt?: number;
}

export function buildContextManifest(input: BuildContextManifestInput): ContextManifest {
  const history = input.history || [];
  const historyChars = history.reduce((sum, message) => sum + String(message?.text || "").length, 0);
  const attachments: ContextManifest["prompt"]["attachments"] = [];
  for (const image of input.images || []) attachments.push({ name: "image", kind: "image", bytes: Buffer.byteLength(image) });
  for (const file of input.files || []) attachments.push({ name: file.name, kind: "file", bytes: file.content == null ? undefined : Buffer.byteLength(file.content) });
  return {
    schemaVersion: CONTEXT_MANIFEST_SCHEMA_VERSION,
    turnId: input.turnId || randomUUID(),
    sessionId: input.sessionId,
    runnerId: input.runnerId,
    agent: input.agent,
    cwd: resolve(input.cwd || process.cwd()),
    createdAt: input.createdAt ?? Date.now(),
    actor: input.actor,
    continuity: {
      kind: input.continuity,
      nativeSessionId: input.nativeSessionId,
      historyMessages: history.length,
      historyChars,
    },
    prompt: {
      userChars: input.showText.length,
      agentChars: input.agentText.length,
      agentSha256: sha256(input.agentText),
      transformed: input.agentText !== input.showText,
      attachments,
    },
    semanticMemory: { injected: false, entryIds: [] },
    instructionFiles: discoverInstructionFiles(input.cwd, input.agent),
  };
}

function rotateJsonl(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size >= MAX_AUDIT_BYTES) {
      const previous = path + ".1";
      try { if (existsSync(previous)) unlinkSync(previous); } catch { /* best effort */ }
      renameSync(path, previous);
    }
  } catch { /* audit rotation must not break a turn */ }
}

/** Append-only audit; manifests intentionally contain hashes/counts, never prompt contents. */
export class ContextManifestStore {
  readonly path: string;
  constructor(dir = join(process.env.JARVIS_HOME || homedir(), ".jarvis"), fileName = "context-manifests.jsonl") {
    this.path = join(dir, fileName);
  }
  append(manifest: ContextManifest): void {
    mkdirSync(dirname(this.path), { recursive: true });
    rotateJsonl(this.path);
    appendFileSync(this.path, JSON.stringify(manifest) + "\n", "utf8");
  }
}
