/**
 * UPD-01 Fase 1 — crash-loop rollback ("if the update breaks it, restore the old version").
 *
 * The existing prep-time rollback (packages/core update.ts + the detached updater) covers a git/npm
 * failure WHILE applying. The gap is a RUNTIME failure: the new commit applies fine, the runner
 * restarts on it, and then it crash-loops (a real bug in the new code). Nothing rolled that back.
 *
 * This closes it with a systemd-style "boot confirmation": the runner writes a boot-state marker
 * when it boots AND reaches the Hub (proof the running commit actually works). The launcher
 * (start-runner.ps1) watches for a commit that crash-loops WITHOUT ever confirming, and rolls the
 * checkout back to the last commit that DID confirm. The decision below is the shared, unit-tested
 * spec; start-runner.ps1 re-implements the exact same rule in PowerShell (it can't call TS).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export interface BootState {
  /** short sha the runner last confirmed a healthy boot on. */
  commit?: string;
  /** the last commit that reached the Hub — the rollback target for a later bad commit. */
  lastGood?: string;
  at?: number;
}

export function bootStateFile(): string {
  return join(process.env.JARVIS_HOME || homedir(), ".jarvis", "boot-state.json");
}
export function readBootState(file = bootStateFile()): BootState {
  try { const v = JSON.parse(readFileSync(file, "utf8")); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  catch { return {}; }
}
export function writeBootState(state: BootState, file = bootStateFile()): void {
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(state)); }
  catch { /* best-effort: losing the marker only forgoes rollback, never breaks the runner */ }
}

/** The runner booted and reached the Hub → the running commit is KNOWN-GOOD. */
export function confirmBoot(cur: string, now: number): BootState {
  return { commit: cur, lastGood: cur, at: now };
}

/**
 * Launcher decision. A commit that crash-loops (>= maxCrashes quick exits) WITHOUT ever confirming a
 * healthy boot is a bad update → roll back to the last known-good commit. NOT triggered when:
 *  - it hasn't crashed enough yet;
 *  - there is no known-good commit to fall back to;
 *  - the crashing commit IS the last-good one (that's dependency corruption, which the launcher
 *    repairs with `npm ci` — rolling back to the same commit would be pointless);
 *  - we already rolled back FROM this commit (never rollback-loop on the same bad commit).
 */
export function bootRollbackDecision(input: {
  cur: string; lastGood?: string; quickCrashes: number; rolledBackFrom?: string; maxCrashes: number;
}): { rollback: boolean; target?: string } {
  const { cur, lastGood, quickCrashes, rolledBackFrom, maxCrashes } = input;
  if (quickCrashes < maxCrashes || !cur || !lastGood) return { rollback: false };
  if (cur === lastGood || rolledBackFrom === cur) return { rollback: false };
  return { rollback: true, target: lastGood };
}
