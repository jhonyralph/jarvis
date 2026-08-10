/**
 * Durable defaults for a NEW session's agent, model, effort and permission mode, scoped globally and
 * per project folder. A brand-new project (no prior started session for its cwd) seeds from here; an
 * existing project instead seeds from its last started session (see Store.inheritForCwd). Persisted to
 * ~/.jarvis/session-defaults.json. Deliberately separate from adaptive-policy.json — that governs
 * Jarvis's own action autonomy (a different axis), and mixing the two would muddy both.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { PermissionMode } from "@jarvis/protocol";
import { writeJsonAtomic, readJson } from "./persist.js";

export interface SessionDefaults {
  agent?: string;
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
}

export interface SessionDefaultsProject extends SessionDefaults {
  /** Absolute folder this override applies to (exact match, or a parent of the session cwd). */
  projectRoot: string;
}

export interface SessionDefaultsDocument {
  global?: SessionDefaults;
  projects?: SessionDefaultsProject[];
}

const JARVIS_HOME = process.env.JARVIS_HOME || homedir();
export const SESSION_DEFAULTS_FILE = join(JARVIS_HOME, ".jarvis", "session-defaults.json");

/** Keep only the known, truthy fields — drops `projectRoot` and empty values so merges stay clean. */
function clean(d: SessionDefaults): SessionDefaults {
  const out: SessionDefaults = {};
  if (d.agent) out.agent = d.agent;
  if (d.model) out.model = d.model;
  if (d.effort) out.effort = d.effort;
  if (d.permissionMode) out.permissionMode = d.permissionMode;
  return out;
}

/** True when `cwd` equals `root` or is nested under it (path-segment aware, slash-agnostic). */
export function isWithin(cwd: string, root: string): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const c = norm(cwd), r = norm(root);
  return c === r || c.startsWith(r + "/");
}

/** Merge global with every matching project override, shallow → deep (deeper roots win); each field
 *  falls through when unset. Returns only the resolved fields (no projectRoot). */
export function resolveSessionDefaults(doc: SessionDefaultsDocument | undefined, cwd: string): SessionDefaults {
  const matches = (doc?.projects ?? [])
    .filter((p) => typeof p.projectRoot === "string" && p.projectRoot.length > 0 && isWithin(cwd, p.projectRoot))
    .sort((a, b) => a.projectRoot.length - b.projectRoot.length);
  let out = clean(doc?.global ?? {});
  for (const m of matches) out = { ...out, ...clean(m) };
  return out;
}

export function loadSessionDefaults(file = SESSION_DEFAULTS_FILE): SessionDefaultsDocument {
  return readJson<SessionDefaultsDocument>(file, {});
}

export function saveSessionDefaults(doc: SessionDefaultsDocument, file = SESSION_DEFAULTS_FILE): void {
  writeJsonAtomic(file, doc, { pretty: true });
}
