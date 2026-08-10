import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobPaths, buildJobScripts, parseJobResult, jobLogTail, readJobCompletion, spawnDetachedJob, readJobPid, stripPowerShellNativeNoise } from "./background-runner.js";
import { BackgroundJobStore, planJobContinuation } from "./background-jobs.js";

test("stripPowerShellNativeNoise limpa o frame de erro nativo e preserva a saída real", () => {
  const raw = [
    "cmd.exe : ✓ Switched active account for github.com to jonathanvinna",
    "No C:\\Users\\Jonathan\\.jarvis\\hub\\jobs\\job-x.ps1:4 caractere:1",
    "+ & cmd.exe /c 'C:\\Users\\Jonathan\\.jarvis\\hub\\jobs\\job-x.cmd'  ...",
    "+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    "    + CategoryInfo          : NotSpecified: (✓ Switched ac...jonathanvinna:String) [], RemoteException",
    "    + FullyQualifiedErrorId : NativeCommandError",
    " ",
    "Cloning into 'mia-v2'...",
    "DONE_CLONING",
  ].join("\r\n");
  const clean = stripPowerShellNativeNoise(raw);
  assert.match(clean, /✓ Switched active account/, "mantém a mensagem real do gh (desembrulhada)");
  assert.match(clean, /Cloning into 'mia-v2'/);
  assert.match(clean, /DONE_CLONING/);
  assert.ok(!/NativeCommandError/.test(clean), "remove o marcador de erro do PowerShell");
  assert.ok(!/CategoryInfo/.test(clean));
  assert.ok(!/\.ps1:\d+/.test(clean), "remove a linha de posição do frame");
  assert.ok(!/^\s*\+\s*~/m.test(clean), "remove o sublinhado ~~~~");
  assert.ok(!/cmd\.exe :/.test(clean), "desembrulha o prefixo exe :");
});

function dir(): string { return mkdtempSync(join(tmpdir(), "jarvis-bgrun-")); }
async function waitFor(pred: () => boolean, ms = 25_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 150)); }
  return pred();
}

test("jobPaths keeps each job's files isolated under <dir>/jobs and sanitizes the id", () => {
  const p = jobPaths("/base", "job-abc", "win32");
  assert.ok(p.wrapper.endsWith("jobs\\job-abc.ps1") || p.wrapper.endsWith("jobs/job-abc.ps1"));
  assert.match(p.result, /job-abc\.result\.json$/);
  const posix = jobPaths("/base", "weird/../id", "linux");
  assert.match(posix.wrapper, /weird_\.\._id\.sh$/, "path separators in the id are sanitized away");
});

test("buildJobScripts (win): self-registers pid, runs the cmd file, writes an atomic result", () => {
  const p = jobPaths("/base", "j1", "win32");
  const { wrapper, command } = buildJobScripts("npm run typecheck", "C:/w", p, "win32");
  assert.match(wrapper, /\$PID/, "records its real pid");
  assert.match(wrapper, /Set-Location '[^']*C:\/w'/);
  assert.match(wrapper, /cmd\.exe \/c '[^']*j1\.cmd'/, "runs the raw command from its own file");
  assert.match(wrapper, /\*>> '[^']*j1\.log'/, "captures all streams to the log");
  assert.match(wrapper, /Move-Item -Force/, "result is swapped in atomically");
  assert.match(command, /@echo off/, "command echo suppressed so the log is clean");
  assert.match(command, /npm run typecheck/, "the raw command is preserved verbatim");
});

test("buildJobScripts (posix): shell wrapper with pid, cwd, log capture and atomic result", () => {
  const p = jobPaths("/base", "j1", "linux");
  const { wrapper } = buildJobScripts("make test", "/work", p, "linux");
  assert.match(wrapper, /^#!\/bin\/sh/);
  assert.match(wrapper, /\$\$/, "records its real pid ($$)");
  assert.match(wrapper, /cd '\/work'/);
  assert.match(wrapper, /mv -f /, "atomic rename of the result");
});

test("parseJobResult tolerates absent / torn files (job still running)", () => {
  assert.equal(parseJobResult(undefined), undefined);
  assert.equal(parseJobResult('{ "exitCode": '), undefined);
  assert.deepEqual(parseJobResult('{"exitCode":0}'), { exitCode: 0 });
  assert.deepEqual(parseJobResult('{"exitCode":137}'), { exitCode: 137 });
});

test("jobLogTail bounds the output, keeping the tail where errors live", () => {
  assert.equal(jobLogTail(undefined), "");
  assert.equal(jobLogTail("short"), "short");
  const big = "x".repeat(9000) + "ERROR_AT_END";
  const tail = jobLogTail(big, 2000);
  assert.ok(tail.length < 2100);
  assert.match(tail, /ERROR_AT_END/);
  assert.match(tail, /início cortado/);
});

test("readJobCompletion returns undefined until the result file is complete", () => {
  const d = dir();
  try {
    const p = jobPaths(d, "j1");
    assert.equal(readJobCompletion(p), undefined, "no result file yet → still running");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// --- Integration: a real detached worker runs a benign command and reports back through files ---

test("spawnDetachedJob runs a command and reports success via the result file", async () => {
  const d = dir();
  try {
    const p = jobPaths(d, "ok-1");
    spawnDetachedJob("echo jarvis-bg-marker", d, p); // `echo` works in both cmd.exe and sh
    const done = await waitFor(() => existsSync(p.result));
    assert.ok(done, "the detached worker must produce a result file");
    const completion = readJobCompletion(p);
    assert.ok(completion, "completion is readable");
    assert.equal(completion!.exitCode, 0);
    assert.match(completion!.resultSummary, /jarvis-bg-marker/, "captured the command output");
    const pid = readJobPid(p);
    assert.ok(pid && pid > 0, "worker self-registered a real pid");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("full pipeline: store + detached run + poll + planner compose into a continuation", async () => {
  const d = dir();
  try {
    // mirrors exactly what the Hub does: create → spawn → mark running → poll to terminal → plan continue
    const store = new BackgroundJobStore({ dir: d });
    const job = store.create({ originSessionId: "sess-42", command: "echo build-finished", cwd: d });
    const paths = jobPaths(d, job.jobId);
    spawnDetachedJob(job.command, job.cwd, paths);
    store.setStatus(job.jobId, "running");

    // the poll loop: wait for completion, then record the terminal state
    await waitFor(() => existsSync(paths.result));
    const completion = readJobCompletion(paths);
    assert.ok(completion);
    store.setStatus(job.jobId, completion!.exitCode === 0 ? "succeeded" : "failed", completion!);

    // the reconciler's decision
    const pending = store.pendingContinuation();
    assert.deepEqual(pending.map((j) => j.jobId), [job.jobId]);
    const plan = planJobContinuation(pending[0]);
    assert.equal(plan.act, true, "a finished job yields a continuation");
    assert.match(plan.text!, /echo build-finished/, "prompt names the command");
    assert.match(plan.text!, /build-finished/, "prompt carries the real output");
    assert.match(plan.text!, /concluiu com sucesso/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("spawnDetachedJob surfaces a non-zero exit code", async () => {
  const d = dir();
  try {
    const p = jobPaths(d, "fail-1");
    spawnDetachedJob("exit 3", d, p); // `exit 3` works in both cmd.exe and sh
    await waitFor(() => existsSync(p.result));
    const completion = readJobCompletion(p);
    assert.ok(completion, "completion is readable");
    assert.equal(completion!.exitCode, 3, "the job's failure exit code propagates");
  } finally { rmSync(d, { recursive: true, force: true }); }
});
