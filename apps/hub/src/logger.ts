/**
 * Structured, leveled observability log for the Hub. Separate from the audit log (auth.ts, security
 * events) and from ad-hoc console diagnostics: this is machine-readable JSONL for latency/cost/token
 * analysis — "when did a request arrive, how long to resolve, which session/agent/model, tokens and
 * cost". One JSON object per line so it greps and feeds a viewer/Langfuse-style pipeline later.
 *
 * Design goals from the product ask:
 *  - ENABLE/DISABLE and a LEVEL (error < warn < info < debug < trace) — logs get big, so it's tunable.
 *  - RETENTION in days (daily files, old ones purged) + a per-file size guard so nothing grows unbounded.
 *  - Never blocks or throws into the app (best-effort append, like the audit log).
 *  - PRIVACY/SIZE: callers log METADATA (ids, durations, tokens, cost, text LENGTHS), not raw prompt
 *    text; a short truncated snippet belongs only at `trace` level.
 *
 * Config precedence: runtime configure() (settings UI, later) > log-config.json > env > defaults.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
export const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug", "trace"];
export function isLogLevel(v: unknown): v is LogLevel { return typeof v === "string" && v in ORDER; }

export interface LogConfig {
  enabled: boolean;
  level: LogLevel;
  /** delete daily files older than this many days (0 = keep forever). */
  retentionDays: number;
  /** rotate the day's file to `.1` once it passes this size (MB). */
  maxFileMb: number;
}

function boolEnv(v: string | undefined): boolean | undefined {
  if (v == null) return undefined;
  if (/^(1|on|true|yes)$/i.test(v)) return true;
  if (/^(0|off|false|no)$/i.test(v)) return false;
  return undefined;
}

function loadConfig(configFile: string): LogConfig {
  const d: LogConfig = { enabled: true, level: "info", retentionDays: 14, maxFileMb: 50 };
  try { Object.assign(d, JSON.parse(readFileSync(configFile, "utf8"))); } catch { /* defaults */ }
  const envEnabled = boolEnv(process.env.JARVIS_LOG);
  if (envEnabled != null) d.enabled = envEnabled;
  if (isLogLevel(process.env.JARVIS_LOG_LEVEL)) d.level = process.env.JARVIS_LOG_LEVEL;
  const ret = Number(process.env.JARVIS_LOG_RETENTION_DAYS); if (Number.isFinite(ret) && ret >= 0) d.retentionDays = ret;
  const mb = Number(process.env.JARVIS_LOG_MAX_MB); if (Number.isFinite(mb) && mb > 0) d.maxFileMb = mb;
  if (!isLogLevel(d.level)) d.level = "info";
  d.retentionDays = Math.max(0, Math.floor(d.retentionDays));
  d.maxFileMb = Math.max(1, Math.floor(d.maxFileMb));
  d.enabled = !!d.enabled;
  return d;
}

export class HubLogger {
  private readonly logDir: string;
  private readonly configFile: string;
  private cfg: LogConfig;
  private ymd = "";
  private file = "";
  constructor(dir = join(process.env.JARVIS_HOME || homedir(), ".jarvis")) {
    this.logDir = join(dir, "logs");
    this.configFile = join(dir, "log-config.json");
    this.cfg = loadConfig(this.configFile);
  }

  getConfig(): LogConfig { return { ...this.cfg }; }
  /** Runtime reconfigure (settings UI). Missing keys keep their current value. Persists unless told not to. */
  configure(patch: Partial<LogConfig>, persist = true): LogConfig {
    if (patch.enabled != null) this.cfg.enabled = !!patch.enabled;
    if (isLogLevel(patch.level)) this.cfg.level = patch.level;
    if (patch.retentionDays != null && Number.isFinite(patch.retentionDays)) this.cfg.retentionDays = Math.max(0, Math.floor(patch.retentionDays));
    if (patch.maxFileMb != null && Number.isFinite(patch.maxFileMb)) this.cfg.maxFileMb = Math.max(1, Math.floor(patch.maxFileMb));
    if (persist) { try { mkdirSync(join(this.configFile, ".."), { recursive: true }); writeFileSync(this.configFile, JSON.stringify(this.cfg, null, 2)); } catch { /* best effort */ } }
    return this.getConfig();
  }
  isEnabled(level: LogLevel): boolean { return this.cfg.enabled && ORDER[level] <= ORDER[this.cfg.level]; }

  private dayFile(): string {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    if (ymd !== this.ymd) { this.ymd = ymd; this.file = join(this.logDir, `jarvis-${ymd}.jsonl`); }
    return this.file;
  }
  private rotateIfBig(file: string): void {
    try { if (existsSync(file) && statSync(file).size >= this.cfg.maxFileMb * 1024 * 1024) { const prev = file.replace(/\.jsonl$/, ".1.jsonl"); try { if (existsSync(prev)) rmSync(prev, { force: true }); } catch { /* ignore */ } renameSync(file, prev); } } catch { /* rotation is best-effort */ }
  }
  private emit(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    if (!this.isEnabled(level)) return;
    try {
      mkdirSync(this.logDir, { recursive: true });
      const file = this.dayFile();
      this.rotateIfBig(file);
      appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), lvl: level, ev: event, ...(fields || {}) }) + "\n");
    } catch { /* never block the app on logging */ }
  }

  error(event: string, fields?: Record<string, unknown>): void { this.emit("error", event, fields); }
  warn(event: string, fields?: Record<string, unknown>): void { this.emit("warn", event, fields); }
  info(event: string, fields?: Record<string, unknown>): void { this.emit("info", event, fields); }
  debug(event: string, fields?: Record<string, unknown>): void { this.emit("debug", event, fields); }
  trace(event: string, fields?: Record<string, unknown>): void { this.emit("trace", event, fields); }

  /** Delete daily files older than retentionDays. Called at boot and on a daily timer. Returns count removed. */
  purgeOld(now = Date.now()): number {
    if (!this.cfg.retentionDays) return 0;
    const cutoff = now - this.cfg.retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    try {
      for (const name of readdirSync(this.logDir)) {
        if (!/^jarvis-\d{8}(\.1)?\.jsonl$/.test(name)) continue;
        const p = join(this.logDir, name);
        try { if (statSync(p).mtimeMs < cutoff) { rmSync(p, { force: true }); removed++; } } catch { /* ignore one file */ }
      }
    } catch { /* dir may not exist yet */ }
    return removed;
  }
}

/** Singleton — import { log } and call log.info("event", {...}) anywhere in the Hub. */
export const log = new HubLogger();
