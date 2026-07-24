/**
 * Framework Jarvis — the canonical, provider-agnostic layer of commands/skills/instructions the user
 * configures ONCE and the Hub publishes to every machine, so behavior applies across AIs and hosts
 * without copying files into each provider's config. Jarvis is the source of truth; native provider
 * files (.claude, .codex, .gemini…) are adapters/cache.
 *
 * This module is the pure domain (filesystem + hashing, no network):
 *   - readCanonicalFramework(root)   → the on-disk tree as a hashed manifest
 *   - materializeFramework(manifest) → write a manifest onto a machine, idempotently (version receipt)
 * Distribution (Hub→Runner fan-out, offline queue) lives in the Hub/Runner and rides the protocol.
 * Keeping this side effect surface narrow means it unit-tests without a socket.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persist.js";

/** How a "/name" that exists both natively and in the framework resolves. `ask` = native-first at
 *  expansion; the composer surfaces both tagged and a per-pick override drives the choice. */
export type FrameworkPreference = "native" | "jarvis" | "ask";
export const FRAMEWORK_PREFERENCES: readonly FrameworkPreference[] = ["native", "jarvis", "ask"];
export function normalizeFrameworkPreference(v: unknown): FrameworkPreference {
  return v === "native" || v === "jarvis" || v === "ask" ? v : "ask";
}

/** One canonical file. `path` is POSIX-relative to the framework root and is confined to
 *  `commands/…`, `skills/…` or the top-level `instructions.md` (enforced on read and materialize). */
export interface FrameworkFile {
  path: string;
  content: string;
}

/** A content-addressed snapshot of the framework. `hash` is the identity; `version` is a monotonic
 *  label the Hub bumps on publish so machines can report "which version am I on". */
export interface FrameworkManifest {
  version: number;
  hash: string;
  files: FrameworkFile[];
}

export interface MaterializeResult {
  version: number;
  hash: string;
  /** files written this call (0 when skipped) */
  written: number;
  /** files removed because they left the manifest */
  removed: number;
  /** true when the machine was already on this hash — no disk writes happened */
  skipped: boolean;
}

interface FrameworkReceipt { version: number; hash: string; at: number }

/** Same resolution the rest of ~/.jarvis uses (JARVIS_HOME override), plus a dedicated
 *  JARVIS_FRAMEWORK_HOME for tests. commands.ts resolves the read path identically. */
export function frameworkRoot(): string {
  return process.env.JARVIS_FRAMEWORK_HOME || join(process.env.JARVIS_HOME || homedir(), ".jarvis", "framework");
}

const RECEIPT_FILE = ".receipt.json";

function sha256(text: string): string { return createHash("sha256").update(text).digest("hex"); }

function hashFiles(files: FrameworkFile[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) h.update(f.path).update("\0").update(f.content).update("\0");
  return h.digest("hex");
}

/** Reject anything that could escape the framework root. Manifest paths arrive over the wire, so this
 *  is a security boundary: only POSIX, no absolute, no `..`, and only the three known top-levels. */
function assertSafeRelPath(rel: string): string {
  const posix = String(rel || "").replace(/\\/g, "/");
  const segs = posix.split("/");
  if (!posix || posix.startsWith("/") || /^[A-Za-z]:/.test(posix) || segs.some((s) => s === ".." || s === "." || s === "")) {
    throw new Error(`caminho de framework inválido: ${rel}`);
  }
  if (!(posix === "instructions.md" || segs[0] === "commands" || segs[0] === "skills")) {
    throw new Error(`caminho de framework fora do escopo: ${rel}`);
  }
  return posix;
}

function toAbs(root: string, relPosix: string): string {
  return join(root, ...relPosix.split("/"));
}

function collectDir(dir: string, root: string, out: FrameworkFile[]): void {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    if (d.name.startsWith(".")) continue;
    const abs = join(dir, d.name);
    if (d.isDirectory()) { collectDir(abs, root, out); continue; }
    if (!d.isFile()) continue;
    const rel = abs.slice(root.length + 1).split(sep).join("/");
    let content: string;
    try { content = readFileSync(abs, "utf8"); } catch { continue; }
    out.push({ path: rel, content });
  }
}

/** Read the canonical framework tree (commands/, skills/, optional instructions.md) into a manifest.
 *  `version` is informational — the Hub owns the counter; the hash is what identifies the content. */
export function readCanonicalFramework(root = frameworkRoot(), version = 0): FrameworkManifest {
  const files: FrameworkFile[] = [];
  collectDir(join(root, "commands"), root, files);
  collectDir(join(root, "skills"), root, files);
  const instr = join(root, "instructions.md");
  if (existsSync(instr)) { try { files.push({ path: "instructions.md", content: readFileSync(instr, "utf8") }); } catch { /* unreadable */ } }
  files.sort((a, b) => a.path.localeCompare(b.path));
  // Validate every discovered path so a bad on-disk name can't later escape on a peer machine.
  for (const f of files) assertSafeRelPath(f.path);
  return { version, hash: hashFiles(files), files };
}

function receiptPath(root: string): string { return join(root, RECEIPT_FILE); }
export function readReceipt(root = frameworkRoot()): FrameworkReceipt | null {
  const r = readJson<FrameworkReceipt | null>(receiptPath(root), null);
  return r && typeof r.hash === "string" ? r : null;
}

/** Every framework-owned file currently on disk, as POSIX rel paths (for stale-file pruning). */
function existingRelPaths(root: string): string[] {
  const out: FrameworkFile[] = [];
  collectDir(join(root, "commands"), root, out);
  collectDir(join(root, "skills"), root, out);
  const rels = out.map((f) => f.path);
  if (existsSync(join(root, "instructions.md"))) rels.push("instructions.md");
  return rels;
}

/**
 * Write a manifest onto this machine under `root`. Idempotent: if the machine already carries this
 * hash (per its receipt) nothing is touched. Otherwise it prunes files that left the manifest, writes
 * the rest with crash-safe atomic writes, and records a new receipt. Never writes outside `root`.
 */
export function materializeFramework(manifest: FrameworkManifest, opts: { machineRoot?: string } = {}): MaterializeResult {
  const root = opts.machineRoot ?? frameworkRoot();
  for (const f of manifest.files) assertSafeRelPath(f.path);
  const prior = readReceipt(root);
  if (prior && prior.hash === manifest.hash) {
    return { version: prior.version, hash: prior.hash, written: 0, removed: 0, skipped: true };
  }
  const want = new Set(manifest.files.map((f) => assertSafeRelPath(f.path)));
  let removed = 0;
  for (const rel of existingRelPaths(root)) {
    if (want.has(rel)) continue;
    try { rmSync(toAbs(root, rel), { force: true }); removed++; } catch { /* best effort */ }
  }
  let written = 0;
  for (const f of manifest.files) { writeTextAtomic(toAbs(root, assertSafeRelPath(f.path)), f.content); written++; }
  writeJsonAtomic(receiptPath(root), { version: manifest.version, hash: manifest.hash, at: Date.now() } satisfies FrameworkReceipt, { pretty: true });
  return { version: manifest.version, hash: manifest.hash, written, removed, skipped: false };
}

export interface FrameworkPublishProvenance {
  at: number;
  runnerId: string;
  userId?: string;
  version: number;
  hash: string;
  written: number;
  removed: number;
  skipped: boolean;
}

/** Append-only audit of framework materializations, mirroring MemoryProvenanceStore. */
export class FrameworkProvenanceStore {
  readonly path: string;
  constructor(dir = join(process.env.JARVIS_HOME || homedir(), ".jarvis")) {
    this.path = join(dir, "framework-provenance.jsonl");
  }
  append(record: FrameworkPublishProvenance): void {
    mkdirSync(dirname(this.path), { recursive: true });
    try {
      if (existsSync(this.path) && statSync(this.path).size >= 10 * 1024 * 1024) {
        const previous = this.path + ".1";
        try { if (existsSync(previous)) rmSync(previous, { force: true }); } catch { /* best effort */ }
        renameSync(this.path, previous);
      }
    } catch { /* rotation is best effort */ }
    appendFileSync(this.path, JSON.stringify(record) + "\n", "utf8");
  }
}

/** Utility for provenance/debug: the sha256 of a string (same primitive triggers.ts uses). */
export function frameworkContentHash(text: string): string { return sha256(text); }

/** Write one canonical file (path-guarded). Returns the normalized POSIX rel path actually written. */
export function writeFrameworkFile(relPath: string, content: string, root = frameworkRoot()): string {
  const safe = assertSafeRelPath(relPath);
  writeTextAtomic(toAbs(root, safe), content);
  return safe;
}

/** Delete one canonical file (path-guarded). No-op-safe. */
export function deleteFrameworkFile(relPath: string, root = frameworkRoot()): boolean {
  const safe = assertSafeRelPath(relPath);
  try { rmSync(toAbs(root, safe), { force: true }); return true; } catch { return false; }
}

export interface FrameworkImportResult { imported: string[]; skipped: string[] }

/** Minimal, safe importer: seed instructions.md from this machine's existing global instruction files
 *  (CLAUDE.md / AGENTS.md / GEMINI.md), so a user's current behavior becomes the framework's starting
 *  point. Never overwrites an existing instructions.md. Commands/skills are added via the editor. */
export function importFrameworkFromNative(opts: { root?: string; home?: string } = {}): FrameworkImportResult {
  const root = opts.root ?? frameworkRoot();
  const home = opts.home ?? homedir();
  const imported: string[] = [], skipped: string[] = [];
  const instr = join(root, "instructions.md");
  if (existsSync(instr)) { skipped.push("instructions.md (já existe)"); return { imported, skipped }; }
  const sources: Array<[string, string]> = [
    ["Claude (CLAUDE.md)", join(home, ".claude", "CLAUDE.md")],
    ["AGENTS.md", join(home, ".codex", "AGENTS.md")],
    ["Gemini (GEMINI.md)", join(home, ".gemini", "GEMINI.md")],
  ];
  const parts: string[] = [];
  for (const [label, p] of sources) { try { const c = readFileSync(p, "utf8").trim(); if (c) parts.push(`# ${label}\n\n${c}`); } catch { /* absent */ } }
  if (parts.length) { writeTextAtomic(instr, parts.join("\n\n---\n\n") + "\n"); imported.push("instructions.md"); }
  else skipped.push("instructions.md (nenhuma instrução nativa encontrada)");
  return { imported, skipped };
}
