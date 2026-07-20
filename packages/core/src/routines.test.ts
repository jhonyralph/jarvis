import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDue, scheduleLabel, validateCron, RoutineStore, type Routine } from "./routines.js";

function routine(over: Partial<Routine> = {}): Routine {
  return { id: "r1", name: "Testes noturnos", prompt: "rode os testes", hour: 8, minute: 0, enabled: true, createdAt: 0, ...over };
}
// A specific local time: Wed 2026-07-15 08:00. getDay(): 0=Sun … 3=Wed.
const wed0800 = () => new Date(2026, 6, 15, 8, 0, 0);

test("isDue: fires at the exact hour+minute", () => {
  assert.equal(isDue(routine(), wed0800()), true);
  assert.equal(isDue(routine(), new Date(2026, 6, 15, 8, 1, 0)), false, "one minute off → no");
  assert.equal(isDue(routine(), new Date(2026, 6, 15, 9, 0, 0)), false, "wrong hour → no");
});

test("isDue: disabled routines never fire", () => {
  assert.equal(isDue(routine({ enabled: false }), wed0800()), false);
});

test("isDue: weekday filter restricts the days", () => {
  assert.equal(isDue(routine({ days: [1, 2, 3, 4, 5] }), wed0800()), true, "Wed is in seg–sex");
  assert.equal(isDue(routine({ days: [0, 6] }), wed0800()), false, "Wed not in weekend");
  assert.equal(isDue(routine({ days: [] }), wed0800()), true, "empty days = every day");
});

test("isDue: at most once per minute (guards a sub-minute re-tick)", () => {
  const now = wed0800();
  const r = routine({ lastRunAt: now.getTime() });   // already ran this minute
  assert.equal(isDue(r, now), false);
  const r2 = routine({ lastRunAt: new Date(2026, 6, 15, 7, 59, 0).getTime() }); // ran the previous minute
  assert.equal(isDue(r2, now), true);
});

test("scheduleLabel is human-readable", () => {
  assert.equal(scheduleLabel(routine({ hour: 8, minute: 5 })), "todo dia 08:05");
  assert.equal(scheduleLabel(routine({ days: [1, 2, 3, 4, 5], hour: 9, minute: 30 })), "seg,ter,qua,qui,sex 09:30");
});

test("cron supports steps, ranges, lists, aliases and common macros", () => {
  assert.equal(isDue(routine({ cron: "*/15 8-10 * * MON-FRI" }), new Date(2026, 6, 15, 9, 30)), true);
  assert.equal(isDue(routine({ cron: "*/15 8-10 * * MON-FRI" }), new Date(2026, 6, 15, 9, 31)), false);
  assert.equal(isDue(routine({ cron: "0 8,12 * JAN,JUL *" }), new Date(2026, 6, 15, 12, 0)), true);
  assert.equal(isDue(routine({ cron: "@weekly" }), new Date(2026, 6, 19, 0, 0)), true, "Sunday midnight");
});

test("cron follows standard day-of-month OR day-of-week semantics", () => {
  const r = routine({ cron: "0 8 15 * 1" });
  assert.equal(isDue(r, new Date(2026, 6, 15, 8, 0)), true, "the 15th matches even on Wednesday");
  assert.equal(isDue(r, new Date(2026, 6, 20, 8, 0)), true, "Monday matches even when it is not the 15th");
  assert.equal(isDue(r, new Date(2026, 6, 21, 8, 0)), false);
});

test("cron validation returns normalized descriptions and actionable field errors", () => {
  assert.deepEqual(validateCron("  0   8 * * 1-5 "), { ok: true, expression: "0 8 * * 1-5", description: "Seg–sex às 08:00" });
  assert.deepEqual(validateCron("@daily"), { ok: true, expression: "0 0 * * *", description: "Todo dia às 00:00" });
  const badMinute = validateCron("60 8 * * *"), badFields = validateCron("0 8 * *"), badStep = validateCron("*/0 * * * *");
  assert.match(badMinute.ok ? "" : badMinute.error, /minuto.*0–59/);
  assert.match(badFields.ok ? "" : badFields.error, /5 campos/);
  assert.match(badStep.ok ? "" : badStep.error, /passo inválido/);
});

test("cron keeps the at-most-once guard and has readable labels", () => {
  const now = new Date(2026, 6, 15, 8, 0);
  assert.equal(isDue(routine({ cron: "0 8 * * *", lastRunAt: now.getTime() }), now), false);
  assert.equal(scheduleLabel(routine({ cron: "*/15 * * * *" })), "A cada 15 minutos");
});

test("RoutineStore: CRUD round-trips and persists", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-routines-"));
  try {
    const s = new RoutineStore(dir);
    const r = s.add({ name: "Manhã", prompt: "resumo", hour: 9, minute: 0, cron: "0 9 * * 1-5", days: [1, 2, 3, 4, 5], runnerId: "machine-2", agent: "gemini", model: "auto", auto: { effort: true }, cwd: "/repo", speak: true });
    assert.ok(r.id);
    assert.equal(r.enabled, true);
    assert.equal(s.list().length, 1);
    assert.equal(r.runnerId, "machine-2");
    assert.equal(r.agent, "gemini");
    assert.equal(r.cron, "0 9 * * 1-5");
    assert.equal(r.auto?.effort, true);
    s.update(r.id, { minute: 30, enabled: false });
    assert.equal(s.get(r.id)?.minute, 30);
    assert.equal(s.get(r.id)?.enabled, false);
    // survives a reload from disk
    assert.equal(new RoutineStore(dir).get(r.id)?.minute, 30);
    assert.equal(new RoutineStore(dir).get(r.id)?.runnerId, "machine-2");
    assert.equal(s.remove(r.id), true);
    assert.equal(s.list().length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("RoutineStore.due + markRun: fires once, then not again in the same minute", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-routines-"));
  try {
    const s = new RoutineStore(dir);
    const r = s.add({ name: "x", prompt: "p", hour: 8, minute: 0 });
    const now = wed0800();
    assert.deepEqual(s.due(now).map((x) => x.id), [r.id], "due at 08:00");
    s.markRun(r.id, now.getTime());
    assert.deepEqual(s.due(now).map((x) => x.id), [], "not due again in the same minute");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("RoutineStore clamps out-of-range hour/minute", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-routines-"));
  try {
    const r = new RoutineStore(dir).add({ name: "x", prompt: "p", hour: 99, minute: -5 });
    assert.equal(r.hour, 23);
    assert.equal(r.minute, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("RoutineStore rejects invalid cron without partially mutating a routine", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-routines-"));
  try {
    const s = new RoutineStore(dir), r = s.add({ name: "original", prompt: "p", hour: 8, minute: 0, cron: "0 8 * * *" });
    assert.throws(() => s.add({ name: "bad", prompt: "p", hour: 0, minute: 0, cron: "99 * * * *" }), /minuto/);
    assert.throws(() => s.update(r.id, { name: "mutated", cron: "bad" }), /5 campos/);
    assert.equal(s.get(r.id)?.name, "original");
    assert.equal(s.list().length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
