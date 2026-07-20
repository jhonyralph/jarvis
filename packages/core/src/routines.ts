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
  /** Standard five-field cron expression. When present it supersedes legacy hour/minute/days. */
  cron?: string;
  /** weekdays it may run on (0=Sun … 6=Sat); empty/omitted = every day */
  days?: number[];
  /** Machine that owns execution. Omitted/"local" means the Hub machine. */
  runnerId?: string;
  agent?: string;
  model?: string;
  effort?: string;
  auto?: { agent?: boolean; model?: boolean; effort?: boolean };
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
  if (r.cron) { const parsed = parseCron(r.cron); if (!parsed.ok || !cronMatches(parsed.fields, now)) return false; }
  else {
    if (now.getHours() !== r.hour || now.getMinutes() !== r.minute) return false;
    if (r.days && r.days.length && !r.days.includes(now.getDay())) return false;
  }
  if (r.lastRunAt !== undefined && sameMinute(new Date(r.lastRunAt), now)) return false; // already ran this minute
  return true;
}

function sameMinute(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    && a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}

/** A short human summary of a routine's schedule, e.g. "seg–sex 08:00" / "todo dia 09:30". */
export function scheduleLabel(r: Routine): string {
  if (r.cron) return cronDescription(r.cron);
  const hh = String(r.hour).padStart(2, "0"), mm = String(r.minute).padStart(2, "0");
  const D = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const days = (r.days && r.days.length) ? [...r.days].sort((a, b) => a - b).map((d) => D[d]).join(",") : "todo dia";
  return `${days} ${hh}:${mm}`;
}

export interface NewRoutine {
  name: string; prompt: string; hour: number; minute: number;
  cron?: string; days?: number[]; runnerId?: string; agent?: string; model?: string; effort?: string; auto?: { agent?: boolean; model?: boolean; effort?: boolean }; cwd?: string; speak?: boolean; enabled?: boolean;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MACROS: Record<string, string> = { "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *" };
type CronFields = { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean };
export type CronValidation = { ok: true; expression: string; description: string } | { ok: false; error: string };

function parseCron(raw: string): ({ ok: true; expression: string; fields: CronFields } | { ok: false; error: string }) {
  let expression = String(raw || "").trim().replace(/\s+/g, " ");
  expression = MACROS[expression.toLowerCase()] || expression;
  const parts = expression.split(" ");
  if (parts.length !== 5) return { ok: false, error: "Use 5 campos: minuto hora dia-do-mês mês dia-da-semana." };
  const specs: Array<[string, number, number, Record<string, number>?, boolean?]> = [
    ["minuto", 0, 59], ["hora", 0, 23], ["dia do mês", 1, 31], ["mês", 1, 12, MONTHS], ["dia da semana", 0, 7, DAYS, true],
  ];
  const values: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const [label, min, max, aliases, sunday] = specs[i];
    const parsed = parseCronField(parts[i], min, max, aliases, sunday);
    if (typeof parsed === "string") return { ok: false, error: `${label}: ${parsed}` };
    values.push(parsed);
  }
  return { ok: true, expression, fields: { minute: values[0], hour: values[1], dom: values[2], month: values[3], dow: values[4], domAny: parts[2] === "*", dowAny: parts[4] === "*" } };
}

function parseCronField(raw: string, min: number, max: number, aliases: Record<string, number> = {}, sunday = false): Set<number> | string {
  const out = new Set<number>();
  const valueOf = (s: string): number => aliases[s.toLowerCase()] ?? Number(s);
  for (const segment of raw.split(",")) {
    if (!segment) return "lista incompleta";
    const [base, stepRaw, ...extra] = segment.split("/");
    if (extra.length) return `passo inválido “${segment}”`;
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) return `passo inválido “${stepRaw}”`;
    let start = min, end = max;
    if (base !== "*") {
      const range = base.split("-");
      if (range.length > 2) return `intervalo inválido “${base}”`;
      start = valueOf(range[0]); end = range.length === 2 ? valueOf(range[1]) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return `valor fora de ${min}–${max}: “${base}”`;
    }
    for (let n = start; n <= end; n += step) out.add(sunday && n === 7 ? 0 : n);
  }
  return out;
}

function cronMatches(f: CronFields, now: Date): boolean {
  const dom = f.dom.has(now.getDate()), dow = f.dow.has(now.getDay());
  const dayMatches = f.domAny && f.dowAny ? true : f.domAny ? dow : f.dowAny ? dom : dom || dow;
  return f.minute.has(now.getMinutes()) && f.hour.has(now.getHours()) && f.month.has(now.getMonth() + 1) && dayMatches;
}

export function validateCron(raw: string): CronValidation {
  const p = parseCron(raw); return p.ok ? { ok: true, expression: p.expression, description: describeExpression(p.expression) } : p;
}
export function cronDescription(raw: string): string {
  const p = validateCron(raw); return p.ok ? p.description : `Cron inválido · ${String(raw || "")}`;
}
function describeExpression(e: string): string {
  const p = e.split(" "), hh = /^\d+$/.test(p[1]) ? String(Number(p[1])).padStart(2, "0") : "", mm = /^\d+$/.test(p[0]) ? String(Number(p[0])).padStart(2, "0") : "";
  if (/^\*\/\d+$/.test(p[0]) && p.slice(1).every((x) => x === "*")) return `A cada ${p[0].slice(2)} minutos`;
  if (mm && hh && p[2] === "*" && p[3] === "*" && p[4] === "1-5") return `Seg–sex às ${hh}:${mm}`;
  if (mm && hh && p.slice(2).every((x) => x === "*")) return `Todo dia às ${hh}:${mm}`;
  if (mm && hh && p[2] === "*" && p[3] === "*" && /^\d$/.test(p[4])) return `${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][Number(p[4])]} às ${hh}:${mm}`;
  if (mm && hh && p[2] === "1" && p[3] === "*") return `Todo dia 1 às ${hh}:${mm}`;
  return `Cron · ${e}`;
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
    const cron = n.cron ? validateCron(n.cron) : undefined;
    if (cron && !cron.ok) throw new Error(cron.error);
    const r: Routine = {
      id: randomBytes(6).toString("hex"),
      name: n.name || "Rotina", prompt: n.prompt || "",
      hour: clamp(n.hour, 0, 23), minute: clamp(n.minute, 0, 59), cron: cron?.expression,
      days: Array.isArray(n.days) ? n.days.filter((d) => d >= 0 && d <= 6) : undefined,
      runnerId: n.runnerId, agent: n.agent, model: n.model, effort: n.effort, auto: n.auto ? { ...n.auto } : undefined, cwd: n.cwd, speak: !!n.speak,
      enabled: n.enabled !== false, createdAt: Date.now(),
    };
    this.data.push(r); this.flush();
    return { ...r };
  }
  update(id: string, patch: Partial<NewRoutine>): Routine | undefined {
    const r = this.data.find((x) => x.id === id);
    if (!r) return undefined;
    const cron = patch.cron !== undefined && patch.cron ? validateCron(patch.cron) : undefined;
    if (cron && !cron.ok) throw new Error(cron.error);
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.prompt !== undefined) r.prompt = patch.prompt;
    if (patch.hour !== undefined) r.hour = clamp(patch.hour, 0, 23);
    if (patch.minute !== undefined) r.minute = clamp(patch.minute, 0, 59);
    if (patch.cron !== undefined) r.cron = cron?.expression;
    if (patch.days !== undefined) r.days = Array.isArray(patch.days) ? patch.days.filter((d) => d >= 0 && d <= 6) : undefined;
    for (const k of ["runnerId", "agent", "model", "effort", "cwd"] as const) if (patch[k] !== undefined) (r as any)[k] = patch[k];
    if (patch.auto !== undefined) r.auto = { ...patch.auto };
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
