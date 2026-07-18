/**
 * Routines — scheduled prompts that run on their own ("every weekday 08:00, run the tests in X and
 * brief me"). The scheduling logic (`isDue`) is a PURE function so it's fully unit-testable; the
 * Hub owns the tick + execution (run via the agent, then push/speak the result). Persisted with the
 * same crash-safe atomic writer as the rest of the store.
 */
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, readJson } from "./persist.js";

export interface Routine {
  id: string;
  name: string;
  /** the instruction sent to the agent when it fires */
  prompt: string;
  hour: number;    // 0–23, local time
  minute: number;  // 0–59
  /** weekdays it may run on (0=Sun … 6=Sat); empty/omitted = every day */
  days?: number[];
  agent?: string;
  model?: string;
  effort?: string;
  cwd?: string;
  /** also speak the result (TTS) in addition to the push notification */
  speak?: boolean;
  enabled: boolean;
  createdAt: number;
  /** epoch ms of the last run — used to guarantee at-most-once per scheduled minute */
  lastRunAt?: number;
}

/** Whether `r` should fire at local time `now`. At-most-once per minute (guards a sub-minute tick). */
export function isDue(r: Routine, now: Date): boolean {
  if (!r.enabled) return false;
  if (now.getHours() !== r.hour || now.getMinutes() !== r.minute) return false;
  if (r.days && r.days.length && !r.days.includes(now.getDay())) return false;
  if (r.lastRunAt !== undefined && sameMinute(new Date(r.lastRunAt), now)) return false; // already ran this minute
  return true;
}

function sameMinute(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    && a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}

/** A short human summary of a routine's schedule, e.g. "seg–sex 08:00" / "todo dia 09:30". */
export function scheduleLabel(r: Routine): string {
  const hh = String(r.hour).padStart(2, "0"), mm = String(r.minute).padStart(2, "0");
  const D = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const days = (r.days && r.days.length) ? [...r.days].sort((a, b) => a - b).map((d) => D[d]).join(",") : "todo dia";
  return `${days} ${hh}:${mm}`;
}

export interface NewRoutine {
  name: string; prompt: string; hour: number; minute: number;
  days?: number[]; agent?: string; model?: string; effort?: string; cwd?: string; speak?: boolean; enabled?: boolean;
}

export class RoutineStore {
  private data: Routine[] = [];
  private readonly file: string;
  constructor(dir?: string) {
    this.file = join(dir || join(process.env.JARVIS_HOME || homedir(), ".jarvis"), "routines.json");
    this.data = readJson<Routine[]>(this.file, []).filter((r) => r && typeof r.id === "string");
  }
  list(): Routine[] { return this.data.map((r) => ({ ...r })); }
  get(id: string): Routine | undefined { const r = this.data.find((x) => x.id === id); return r ? { ...r } : undefined; }

  add(n: NewRoutine): Routine {
    const r: Routine = {
      id: randomBytes(6).toString("hex"),
      name: n.name || "Rotina", prompt: n.prompt || "",
      hour: clamp(n.hour, 0, 23), minute: clamp(n.minute, 0, 59),
      days: Array.isArray(n.days) ? n.days.filter((d) => d >= 0 && d <= 6) : undefined,
      agent: n.agent, model: n.model, effort: n.effort, cwd: n.cwd, speak: !!n.speak,
      enabled: n.enabled !== false, createdAt: Date.now(),
    };
    this.data.push(r); this.flush();
    return { ...r };
  }
  update(id: string, patch: Partial<NewRoutine>): Routine | undefined {
    const r = this.data.find((x) => x.id === id);
    if (!r) return undefined;
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.prompt !== undefined) r.prompt = patch.prompt;
    if (patch.hour !== undefined) r.hour = clamp(patch.hour, 0, 23);
    if (patch.minute !== undefined) r.minute = clamp(patch.minute, 0, 59);
    if (patch.days !== undefined) r.days = Array.isArray(patch.days) ? patch.days.filter((d) => d >= 0 && d <= 6) : undefined;
    for (const k of ["agent", "model", "effort", "cwd"] as const) if (patch[k] !== undefined) (r as any)[k] = patch[k];
    if (patch.speak !== undefined) r.speak = !!patch.speak;
    if (patch.enabled !== undefined) r.enabled = !!patch.enabled;
    this.flush();
    return { ...r };
  }
  /** Stamp a run (sets lastRunAt) — call BEFORE executing so a sub-minute re-tick won't double-fire. */
  markRun(id: string, at: number): void { const r = this.data.find((x) => x.id === id); if (r) { r.lastRunAt = at; this.flush(); } }
  remove(id: string): boolean { const n = this.data.length; this.data = this.data.filter((x) => x.id !== id); if (this.data.length !== n) { this.flush(); return true; } return false; }

  /** Routines due to fire at `now` (pure filter over isDue). */
  due(now: Date): Routine[] { return this.data.filter((r) => isDue(r, now)).map((r) => ({ ...r })); }

  private flush(): void { writeJsonAtomic(this.file, this.data, { pretty: true }); }
}

function clamp(n: number, lo: number, hi: number): number { n = Math.floor(Number(n) || 0); return n < lo ? lo : n > hi ? hi : n; }
