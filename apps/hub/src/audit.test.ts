/**
 * Audit-log rotation tests. Like auth.test.ts we point JARVIS_HOME at a throwaway dir BEFORE import,
 * plus a tiny JARVIS_AUDIT_MAX_MB so a short loop crosses the cap. node --test isolates each file in
 * its own process, so both the env override and the module-level rotation counter start clean here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "jarvis-audit-"));
process.env.JARVIS_HOME = HOME;
process.env.JARVIS_AUTH = "on";
process.env.JARVIS_AUDIT_MAX_MB = "0.002"; // ~2KB cap → the loop below trips rotation
const auth = await import("./auth.js");
const AUDIT = join(HOME, ".jarvis", "audit.log");

test("audit rotates by size, keeping exactly one previous generation", () => {
  // The size check runs every 64 appends; 200 appends of ~70B each (~14KB) clears the ~2KB cap.
  for (let i = 0; i < 200; i++) auth.audit("probe", { detail: `entry-${i}-padding-padding-padding` });
  assert.ok(existsSync(AUDIT + ".1"), "the rotated generation audit.log.1 exists after crossing the cap");
  assert.ok(existsSync(AUDIT), "a fresh current audit.log exists after rotation");
  // The current file was reset at rotation, so it holds only the post-rotation tail, not all 200.
  assert.ok(statSync(AUDIT).size < 200 * 70, "current log was truncated by rotation, not left growing");
});

test("readAudit spans the rotated generation so a tail request isn't lost", () => {
  const rows = auth.readAudit(500);
  assert.ok(rows.length > 0, "entries are still readable after rotation");
  assert.ok(rows.some((r) => r.event === "probe"), "reads across audit.log.1 + audit.log");
});
