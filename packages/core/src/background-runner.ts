/**
 * Detached runner for Hub-owned background jobs (Phase 2 of the auto-continuation feature).
 *
 * The hard requirement (see the process-ownership map): the job process must OUTLIVE the one-shot
 * agent turn and must NOT be killed by (a) the turn's `taskkill /T` tree-kill on abort, nor (b) the
 * launcher's orphan reaper. We get there exactly like the auto-updater does:
 *   - spawn via `cmd /c start /b` (Windows) / `sh -c … &` (POSIX) with {detached, stdio:"ignore"} +
 *     unref() — so the worker is NOT a child of the agent's process tree and survives the Hub too;
 *   - the worker is `powershell.exe`/`sh`, never `node.exe`/`claude.exe` with an agent-CLI slug, so the
 *     reaper's command-line filter never matches it;
 *   - because a detached, stdio-ignored process can't be awaited, the worker communicates back through
 *     FILES: it self-registers its REAL pid, streams output to a log, and on exit writes an atomic
 *     result file with the exit code. The Hub polls for that result file (crash-safe: survives a Hub
 *     restart — a job that finishes while the Hub is down is picked up on the next poll).
 *
 * The script builders and the result parser are pure (unit-tested); only spawnDetachedJob touches the
 * OS. Paths live under <dir>/jobs/<jobId>.* so one job never collides with another.
 */
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface JobPaths {
  dir: string;
  wrapper: string;   // the .ps1 / .sh the detached process runs
  command: string;   // the raw agent command, in its own file (no escaping into the wrapper)
  pid: string;       // worker self-registers its real pid here
  log: string;       // combined stdout+stderr
  result: string;    // {"exitCode":N} written atomically on completion
}

export function jobPaths(baseDir: string, jobId: string, platform: NodeJS.Platform = process.platform): JobPaths {
  const dir = join(baseDir, "jobs");
  const safe = jobId.replace(/[^A-Za-z0-9._-]/g, "_");
  const cmdExt = platform === "win32" ? "cmd" : "command.sh";
  return {
    dir,
    wrapper: join(dir, `${safe}.${platform === "win32" ? "ps1" : "sh"}`),
    command: join(dir, `${safe}.${cmdExt}`),
    pid: join(dir, `${safe}.pid.json`),
    log: join(dir, `${safe}.log`),
    result: join(dir, `${safe}.result.json`),
  };
}

/** PowerShell single-quote escape ('' is a literal quote inside a single-quoted PS string). */
function psq(s: string): string { return `'${s.replace(/'/g, "''")}'`; }
/** POSIX single-quote escape. */
function shq(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'`; }

/** Build the wrapper + command-file contents for the platform. Pure — no filesystem/spawn. */
export function buildJobScripts(command: string, cwd: string, paths: JobPaths, platform: NodeJS.Platform = process.platform): { wrapper: string; command: string } {
  if (platform === "win32") {
    // The wrapper self-registers $PID, runs the .cmd (raw command, zero escaping) capturing all
    // streams to the log, then writes the exit code to a temp file and atomically renames it in.
    const wrapper = [
      `$ErrorActionPreference = 'Continue'`,
      `try { ('{"pid":' + $PID + '}') | Set-Content -Path ${psq(paths.pid)} -Encoding UTF8 } catch {}`,
      `Set-Location ${psq(cwd)}`,
      `& cmd.exe /c ${psq(paths.command)} *>> ${psq(paths.log)} 2>&1`,
      `$code = $LASTEXITCODE; if ($null -eq $code) { $code = 0 }`,
      `$tmp = ${psq(paths.result + ".tmp")}`,
      `('{"exitCode":' + $code + '}') | Set-Content -Path $tmp -Encoding UTF8`,
      `Move-Item -Force -Path $tmp -Destination ${psq(paths.result)}`,
      ``,
    ].join("\r\n");
    // `@echo off` keeps the command-echo prompt line out of the log; the raw command follows verbatim.
    return { wrapper, command: `@echo off\r\n${command}\r\n` };
  }
  const wrapper = [
    `#!/bin/sh`,
    `printf '{"pid":%d}' "$$" > ${shq(paths.pid)} 2>/dev/null`,
    `cd ${shq(cwd)} || exit 1`,
    `sh ${shq(paths.command)} > ${shq(paths.log)} 2>&1`,
    `code=$?`,
    `printf '{"exitCode":%d}' "$code" > ${shq(paths.result + ".tmp")} && mv -f ${shq(paths.result + ".tmp")} ${shq(paths.result)}`,
    ``,
  ].join("\n");
  return { wrapper, command: command + "\n" };
}

/** Write the scripts and launch the worker DETACHED (updater pattern). Returns nothing — the worker is
 *  tracked only via its files, never the launcher pid (the `cmd /c start` pid dies immediately). */
export function spawnDetachedJob(command: string, cwd: string, paths: JobPaths, platform: NodeJS.Platform = process.platform): void {
  mkdirSync(paths.dir, { recursive: true });
  const scripts = buildJobScripts(command, cwd, paths, platform);
  writeFileSync(paths.wrapper, scripts.wrapper);
  writeFileSync(paths.command, scripts.command);
  if (platform === "win32") {
    // `cmd /c start "" /b` is what actually detaches from the parent's job/console on Windows — a bare
    // `spawn("powershell", …, {detached})` does NOT survive the Hub reliably (matches update.ts).
    const child = spawn("cmd.exe", ["/c", "start", "", "/b", "powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", paths.wrapper], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  } else {
    const child = spawn("/bin/sh", ["-c", `sh ${shq(paths.wrapper)} &`], { detached: true, stdio: "ignore" });
    child.unref();
  }
}

/** Real pid the worker self-registered, if it got that far. */
export function readJobPid(paths: JobPaths): number | undefined {
  try {
    const pid = Number(JSON.parse(readFileSync(paths.pid, "utf8").replace(/^﻿/, ""))?.pid);
    return Number.isFinite(pid) ? pid : undefined;
  } catch { return undefined; }
}

/** Parse a result file's contents. Pure. Returns undefined if absent/torn (job still running).
 *  Tolerates a leading BOM — PowerShell's `Set-Content -Encoding UTF8` prepends one. */
export function parseJobResult(text: string | undefined): { exitCode: number } | undefined {
  if (!text) return undefined;
  try {
    const code = Number(JSON.parse(text.replace(/^﻿/, ""))?.exitCode);
    return Number.isFinite(code) ? { exitCode: code } : undefined;
  } catch { return undefined; }
}

/** Decode a job log that may be UTF-16LE (PowerShell `*>>` on 5.1), UTF-8, or ANSI. Strips any BOM. */
function decodeLoose(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le").replace(/^﻿/, "");
  let nul = 0; for (let i = 1; i < Math.min(buf.length, 400); i += 2) if (buf[i] === 0) nul++;
  if (nul > 40) return buf.toString("utf16le").replace(/^﻿/, "");
  return buf.toString("utf8").replace(/^﻿/, "");
}

/** Bounded tail of the job log (keeps the END — where errors are — and caps the prompt size). Pure. */
export function jobLogTail(logText: string | undefined, cap = 4000): string {
  if (!logText) return "";
  const t = logText.replace(/\r\n/g, "\n").trimEnd();
  return t.length <= cap ? t : `…(início cortado)\n${t.slice(t.length - cap)}`;
}

/** Poll a job: has it finished? If so, return the exit code + bounded log tail for the store. */
export function readJobCompletion(paths: JobPaths, cap = 4000): { exitCode: number; resultSummary: string } | undefined {
  if (!existsSync(paths.result)) return undefined;
  let resultText: string | undefined;
  try { resultText = readFileSync(paths.result, "utf8"); } catch { return undefined; }
  const parsed = parseJobResult(resultText);
  if (!parsed) return undefined; // result file present but not yet fully written — try again next poll
  let logText = "";
  try { if (existsSync(paths.log)) logText = decodeLoose(readFileSync(paths.log)); } catch { /* best-effort */ }
  return { exitCode: parsed.exitCode, resultSummary: jobLogTail(logText, cap) };
}
