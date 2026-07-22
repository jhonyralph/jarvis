/**
 * Jarvis Runner — headless. Runs agents LOCALLY on this machine and streams to the
 * Hub over an outbound WebSocket. No UI, no voice. Reuses @jarvis/core.
 *
 * The Hub is the single UI + router; a Runner is one machine it can drive. Runners
 * dial the Hub (outbound), so laptops behind NAT / that sleep / roam still work.
 *
 * Env:
 *   JARVIS_HUB     ws(s)://<hub-host>:<port>   (required; "/runner" is appended)
 *   JARVIS_TOKEN   per-runner token minted by the owner (required if Hub auth on)
 *   JARVIS_AGENT   default agent (default: claude-code)
 *   JARVIS_CWD     default cwd for new sessions (default: homedir)
 *   JARVIS_LABEL   friendly hint (the Hub stores/overrides the label)
 */
import WebSocket from "ws";
import { hostname, homedir, platform } from "node:os";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  AgentRegistry, MockAgentAdapter, ClaudeCodeAdapter, CodexAdapter, AiderAdapter, GeminiCliAdapter, CursorAgentAdapter, CopilotCliAdapter, OpenCodeAdapter, ClineCliAdapter, QwenCodeAdapter, ContinueCliAdapter, KiroCliAdapter, AntigravityCliAdapter, ABORTED,
  listNative, nativeHistory, nativeInfo, isNativeId, nativeFilePath, nativeIdForAgent, filterUnboundNativeSessions, parseNativeEvents, deleteNative, sessionFiles, sessionFileDiff, purgeProbeJunk, purgeScratch, Store,
  updateCheck, updateApply, restartService, runnerSelfUpdateDecision, readProjectFile, repoCommit, createSeenSet, VERSION, Outbox,
  listCommandsPublic, expandCommand, cmdAgentOf, listMentionFiles, expandBang,
  previewMemoryAppend, applyMemoryAppend, MemoryProvenanceStore, ContextManifestStore, buildContextManifest,
  buildTurnAttachments, imageDataUrl, runManagedTurn, touchedFilesFromMessages, fileDiffFromMessages, createAgentEventBridge, createEventSequencer,
  ExecutionStore, ExecutionTracker, ManagedWorktreeManager, EXECUTION_ADAPTER_PROFILES, isProviderExecutionEvent, redactProviderExecutionActivity, executionRootId, writeJsonAtomic,
  pendingActivityReplay,
  type AgentAdapter, type SendOpts, type TurnCtx, type AgentEvent, type ManagedExecutionPlan, type ManagedExecutionPolicyInput, type UpdateResult, type MemoryAppendPreview,
} from "@jarvis/core";
import { ManagedExecutionService, type ManagedExecutionSecurity } from "@jarvis/core";

const RUNNER_ROOT = fileURLToPath(new URL("../../../", import.meta.url)); // repo root from apps/runner/src
import { RUNNER_PROTOCOL_VERSION, type ContextActor, type HubToRunner, type RunnerInfo, type RunnerSession, type RunnerToHub } from "@jarvis/protocol";

const HUB = (process.env.JARVIS_HUB || "ws://127.0.0.1:4577").replace(/\/+$/, "");
const HUB_URL = HUB + "/runner";
const TOKEN = process.env.JARVIS_TOKEN || "";
const DEFAULT_AGENT = process.env.JARVIS_AGENT || "claude-code";
const CWD = process.env.JARVIS_CWD || homedir();
const JDIR = join(process.env.JARVIS_HOME || homedir(), ".jarvis");
try { mkdirSync(JDIR, { recursive: true }); } catch { /* ignore */ }
const ID_FILE = join(JDIR, "runner-id");
const UPDATE_RECEIPT_FILE = join(JDIR, "update-receipt.json");
const UPDATE_RESULT_FILE = join(JDIR, "update-result.json");
const UPDATE_LOCK_FILE = join(JDIR, "runner-update.lock");

function runnerId(): string {
  try { const v = readFileSync(ID_FILE, "utf8").trim(); if (v) return v; } catch { /* new */ }
  const id = randomUUID();
  try { writeFileSync(ID_FILE, id); } catch { /* ignore */ }
  return id;
}
const RUNNER_ID = runnerId();
function updateReceipt(): RunnerInfo["updateReceipt"] {
  try { const value = JSON.parse(readFileSync(UPDATE_RECEIPT_FILE, "utf8")); return value && typeof value.requestId === "string" && typeof value.targetCommit === "string" && typeof value.current === "string" ? value : undefined; }
  catch { return undefined; }
}
function readUpdateResult(): RunnerInfo["updateResult"] | undefined {
  try {
    const value = JSON.parse(readFileSync(UPDATE_RESULT_FILE, "utf8"));
    return value && typeof value.requestId === "string" && typeof value.ok === "boolean" ? value : undefined;
  } catch { return undefined; }
}
function clearUpdateResult(): void {
  try { unlinkSync(UPDATE_RESULT_FILE); } catch { /* ignore */ }
}
function cleanupRunnerUpdateScripts(): void {
  try {
    const files = readdirSync(JDIR)
      .filter((name) => /^runner-update-\d+\.ps1$/.test(name))
      .map((name) => ({ name, path: join(JDIR, name), mtime: statSync(join(JDIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const file of files) try { unlinkSync(file.path); } catch { /* ignore locked/stale */ }
  } catch { /* ignore */ }
}
const EXECUTIONS_ENABLED = process.env.JARVIS_EXECUTIONS !== "0";
const EXECUTION_RETENTION_DAYS = Math.max(1, Math.min(3650, Number(process.env.JARVIS_EXECUTION_RETENTION_DAYS || 30)));
const EXECUTION_MAX_EVENTS = Math.max(100, Math.min(100_000, Number(process.env.JARVIS_EXECUTION_MAX_EVENTS || 5_000)));
const EXECUTION_MAX_CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.JARVIS_EXECUTION_MAX_CONCURRENCY || 6)));
const EXECUTION_MAX_DEPTH = Math.max(1, Math.min(10, Number(process.env.JARVIS_EXECUTION_MAX_DEPTH || 3)));
const EXECUTION_DEFAULT_WRITE = process.env.JARVIS_EXECUTION_DEFAULT_WRITE === "1";
const EXECUTION_WORKTREE_ROOT = process.env.JARVIS_EXECUTION_WORKTREE_ROOT || join(JDIR, "worktrees");

const agents = new AgentRegistry(DEFAULT_AGENT)
  .register(new ClaudeCodeAdapter())
  .register(new CodexAdapter())
  .register(new AiderAdapter())
  .register(new GeminiCliAdapter())
  .register(new CursorAgentAdapter())
  .register(new CopilotCliAdapter())
  .register(new OpenCodeAdapter())
  .register(new ClineCliAdapter())
  .register(new QwenCodeAdapter())
  .register(new ContinueCliAdapter())
  .register(new KiroCliAdapter())
  .register(new AntigravityCliAdapter())
  .register(new MockAgentAdapter());
const store = new Store({ agent: DEFAULT_AGENT, cwd: CWD });
const contextManifests = new ContextManifestStore(JDIR);
const memoryProvenance = new MemoryProvenanceStore(JDIR);
const nativeBindingCollisions = agents.nativeBindingCollisions();
if (nativeBindingCollisions.length) console.error("[runner] colisões de sessão nativa detectadas; turnos afetados serão bloqueados:", JSON.stringify(nativeBindingCollisions));
const executionStore = new ExecutionStore({ root: join(JDIR, "executions"), maxEventsPerRoot: EXECUTION_MAX_EVENTS });
const compactedExecutions = executionStore.compactBefore(Date.now() - EXECUTION_RETENTION_DAYS * 86_400_000);
if (compactedExecutions.roots) console.log(`[runner] retenção de trabalhos: ${compactedExecutions.roots} diário(s) compactado(s), ${compactedExecutions.droppedEvents} evento(s) detalhado(s) removido(s)`);
for (const snapshot of executionStore.rootsForSession()) for (const node of snapshot.nodes) {
  if (node.state !== "queued" && node.state !== "running" && node.state !== "waiting_input") continue;
  try {
    executionStore.append(node.rootExecutionId, node.executionId, { kind: "state_changed", from: node.state, to: "orphaned", reason: "Runner reiniciou sem binding verificável para este processo" });
    executionStore.append(node.rootExecutionId, node.executionId, { kind: "diagnostic", level: "warning", code: "PROCESS_BINDING_LOST", message: "Estado preservado como órfão; nenhum terminal foi inferido" });
  } catch { /* leave the last valid projection available for reconciliation */ }
}
const activeRuns = new Set<string>();
const managedRuns = new Set<string>();
let updateInProgress = false;
const RUNNER_SELF_UPDATE_MS = (() => {
  const raw = process.env.JARVIS_RUNNER_SELF_UPDATE_MS;
  if (raw === "0") return 0;
  const n = Number(raw || 10 * 60_000);
  return Number.isFinite(n) ? Math.max(60_000, Math.min(24 * 60 * 60_000, n)) : 10 * 60_000;
})();
let lastSelfUpdateCheckAt = 0;
// Idempotency: turnIds already executed here. `activeRuns` only blocks a CONCURRENT duplicate;
// this makes a re-delivered send (reconnect resend / queue re-flush / WS redelivery) run at most once.
const seenTurns = createSeenSet();

let ws: WebSocket | null = null;
// Outbound resilience (turn resume): while the socket is down a mid-turn agent keeps running here
// (only an explicit cancel aborts it), so without this its live stream AND its final reply would be
// silently dropped by send() — the turn finishes into the local store but a viewer on the Hub never
// sees it (it only reappears if they re-open the session). Buffer the turn-OUTPUT messages emitted
// during an outage and replay them on reconnect, so the Hub re-forwards them to whoever's watching.
// Bounded ring (newest kept) so a long turn over a long outage can't grow unbounded — dropping the
// OLDEST preserves the terminal 'done'/'error', which is the one event that must survive. Control/list
// messages (register/pong/sessions/caps/runs) are regenerated on reconnect, so they're never buffered.
const outbox = new Outbox<RunnerToHub>(3000);
function send(m: RunnerToHub): void {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return; }
  if (m.t === "agent_event" || m.t === "context_manifest" || m.t === "execution_event" || m.t === "execution_usage_record" || m.t === "execution_delegate_result" || m.t === "stream" || m.t === "message") outbox.push(m);
}
/** Replay turn output buffered during an outage. Called right after a reconnect's `welcome` (socket
 *  OPEN again), before the fresh session/caps push, so the resumed stream lands in order. */
function flushOutbox(): void {
  if (!outbox.size) return;
  const pending = outbox.drain();
  console.log(`[runner] reconectado — reenviando ${pending.length} evento(s) de turno bufferizados`);
  for (const m of pending) send(m);
}

async function maybeSelfUpdate(reason: string, forceCheck = false): Promise<void> {
  if (RUNNER_SELF_UPDATE_MS <= 0) return;
  const now = Date.now();
  if (!forceCheck && now - lastSelfUpdateCheckAt < Math.min(RUNNER_SELF_UPDATE_MS, 60_000)) return;
  lastSelfUpdateCheckAt = now;
  let status;
  try { status = await updateCheck(RUNNER_ROOT, true); }
  catch (error: any) { console.warn(`[runner] auto-update (${reason}): check falhou: ${String(error?.message ?? error).slice(0, 160)}`); return; }
  const decision = runnerSelfUpdateDecision(status, {
    busy: activeRuns.size > 0 || managedRuns.size > 0,
    updateInProgress,
  });
  if (!decision.update) {
    if (decision.retryable || /rejeit|desconect/i.test(reason)) console.warn(`[runner] auto-update (${reason}): ${decision.reason}`);
    return;
  }
  updateInProgress = true;
  const requestId = `self:${Date.now()}`;
  console.warn(`[runner] auto-update (${reason}): ${decision.reason}; alvo ${decision.targetCommit}`);
  let result: UpdateResult;
  try { result = await updateApply(RUNNER_ROOT, { targetCommit: decision.targetCommit }); }
  catch (error: any) { result = { ok: false, retryable: true, log: "falha inesperada no auto-update: " + String(error?.message ?? error) }; }
  console.log("[runner] auto-update:", result.ok ? "ok" : "falhou", "-", result.log.replace(/\n/g, " ").slice(0, 180));
  if (result.ok) {
    try {
      writeJsonAtomic(UPDATE_RECEIPT_FILE, {
        requestId, targetCommit: String(decision.targetCommit || result.current || ""),
        current: String(result.current || await repoCommit(RUNNER_ROOT)).replace("+dirty", ""),
        preparedAt: Date.now(), autonomous: true, reason,
      }, { pretty: true });
    } catch (error: any) {
      result = { ok: false, log: result.log + "\nERRO ao persistir comprovante do auto-update: " + String(error?.message ?? error), behind: result.behind };
    }
  }
  send({ t: "update_done", requestId, ok: result.ok, dirty: !!result.dirty, behind: result.behind ?? 0, log: result.log.slice(0, 600), current: result.current, restartRequired: result.restartRequired, rolledBack: result.rolledBack, retryable: result.retryable });
  if (result.ok && result.restartRequired !== false) void drainAndExit();
  else updateInProgress = false;
}

function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function detachedWindowsRunnerUpdateScript(input: { requestId: string; targetCommit: string; root: string; resultFile: string; receiptFile: string; logFile: string; pid: number; force: boolean }): string {
  return `
$ErrorActionPreference = 'Stop'
$Root = ${psQuote(input.root)}
$RequestId = ${psQuote(input.requestId)}
$Target = ${psQuote(input.targetCommit)}
$ResultFile = ${psQuote(input.resultFile)}
$ReceiptFile = ${psQuote(input.receiptFile)}
$RunnerLogFile = ${psQuote(input.logFile)}
$LockFile = ${psQuote(UPDATE_LOCK_FILE)}
$RunnerPid = ${input.pid}
$Force = ${input.force ? "$true" : "$false"}
$TaskName = 'JarvisRunner'
$Log = New-Object System.Collections.Generic.List[string]

function Add-Log([string]$Text) { $script:Log.Add($Text) }
function Add-Progress([string]$Text) {
  Add-Log $Text
  try { Add-Content -Path $RunnerLogFile -Value ("[updater] {0} {1}" -f (Get-Date -Format o), $Text) } catch {}
}
function Run-Step([string]$Exe, [string[]]$Args) {
  $cmd = $Exe + " " + ($Args -join " ")
  Add-Progress ("> " + $cmd)
  $out = & $Exe @Args 2>&1
  $code = $LASTEXITCODE
  foreach ($line in $out) { Add-Log ([string]$line) }
  if ($code -ne 0) {
    Add-Progress ("falhou: " + $cmd + " (codigo " + $code + ")")
    throw ($Exe + " saiu com código " + $code)
  }
  Add-Progress ("ok: " + $cmd)
}
function Git([string[]]$Args) { Run-Step "git" $Args }
function Npm([string[]]$Args) { Run-Step "npm.cmd" $Args }
function Git-Out([string[]]$Args) {
  $out = & git @Args 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 0) { foreach ($line in $out) { Add-Log ([string]$line) }; throw ("git " + ($Args -join " ") + " saiu com código " + $code) }
  return (($out | Out-String).Trim())
}
function Dependency-Manifests-Changed([string]$From, [string]$To) {
  $files = & git diff --name-only $From $To -- package.json package-lock.json npm-shrinkwrap.json 'apps/*/package.json' 'packages/*/package.json'
  if ($LASTEXITCODE -ne 0) { return $true }
  return [bool]($files | Where-Object { $_ })
}
function Verify-Or-Repair([bool]$DepsChanged) {
  if (-not $DepsChanged) {
    try { Npm @("run", "update:verify", "--if-present"); return } catch { Add-Log ("verificação inicial falhou; tentando npm ci: " + $_) }
  }
  Npm @("ci")
  Npm @("run", "update:verify", "--if-present")
}
function Write-Result([bool]$Ok, [bool]$RolledBack, [string]$Current) {
  $lines = @($Log.ToArray())
  if ($lines.Count -gt 240) {
    $head = @($lines | Select-Object -First 80)
    $tail = @($lines | Select-Object -Last 160)
    $lines = @($head + ("... log truncado: " + $lines.Count + " linhas; mantendo início e fim ...") + $tail)
  }
  $obj = [ordered]@{
    requestId = $RequestId
    ok = $Ok
    rolledBack = $RolledBack
    current = $Current
    targetCommit = $Target
    restartRequired = $true
    preparedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    log = ($lines -join "\`n")
  }
  $dir = Split-Path -Parent $ResultFile
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $obj | ConvertTo-Json -Depth 5 | Set-Content -Path $ResultFile -Encoding UTF8
}
function Start-Runner() {
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($task.State -eq "Running") {
      Add-Progress ("scheduled task ja esta em execucao: " + $TaskName)
      return
    }
  } catch {
    Add-Progress ("consulta da scheduled task falhou; tentando iniciar: " + $_)
  }
  try {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    Add-Progress ("scheduled task iniciado: " + $TaskName)
  } catch {
    Add-Progress ("Start-ScheduledTask falhou; fallback npm start: " + $_)
    Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory (Join-Path $Root "apps\\runner") -WindowStyle Hidden | Out-Null
  }
}

$previous = ""
$current = ""
$rolledBack = $false
try {
  Add-Progress "parando runner antes do upgrade"
  # The launcher is the scheduled task. Keep it alive: the update lock makes it wait while this
  # detached updater owns the checkout. Stopping the task here can also terminate this script and
  # leave a stale runner-update.lock behind.
  try { Stop-Process -Id $RunnerPid -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Seconds 2
  Set-Location $Root
  try { & git config --global --add safe.directory $Root 2>$null } catch {}
  $branch = Git-Out @("rev-parse", "--abbrev-ref", "HEAD")
  Git @("fetch", "--quiet", "origin", $branch)
  $desired = Git-Out @("rev-parse", ($Target + "^{commit}"))
  $previous = Git-Out @("rev-parse", "HEAD")
  $depsChanged = Dependency-Manifests-Changed $previous $desired
  if ($Force) {
    Git @("reset", "--hard", $desired)
    Git @("clean", "-fd")
  } else {
    $dirty = Git-Out @("status", "--porcelain")
    if ($dirty) { throw "checkout com alterações locais; update sem force recusado" }
    $counts = Git-Out @("rev-list", "--left-right", "--count", ("HEAD..." + $desired))
    $ahead = [int](($counts -split "\\s+")[0])
    if ($ahead -gt 0) { throw ("checkout possui " + $ahead + " commit(s) locais fora do alvo") }
    Git @("merge", "--ff-only", $desired)
  }
  Verify-Or-Repair $depsChanged
  $current = Git-Out @("rev-parse", "--short", "HEAD")
  $receipt = [ordered]@{ requestId = $RequestId; targetCommit = $Target; current = $current; preparedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -Path $ReceiptFile -Encoding UTF8
} catch {
  Add-Progress ("ERRO na preparação: " + $_)
  if ($previous) {
    try {
      Set-Location $Root
      Git @("reset", "--hard", $previous)
      Git @("clean", "-fd")
      Npm @("ci")
      Npm @("run", "update:verify", "--if-present")
      $rolledBack = $true
      Add-Progress "rollback automático concluído"
    } catch {
      Add-Progress ("ERRO também no rollback: " + $_)
    }
  }
  try { $current = Git-Out @("rev-parse", "--short", "HEAD") } catch { $current = "" }
  Write-Result $false $rolledBack $current
} finally {
  try { Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue } catch {}
  Start-Runner
  try { if ($PSCommandPath) { Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue } } catch {}
}
`;
}

async function handoffWindowsRunnerUpdate(m: any): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const requestId = typeof m.requestId === "string" && m.requestId ? m.requestId : `update:${Date.now()}`;
  const targetCommit = typeof m.targetCommit === "string" && m.targetCommit ? m.targetCommit.replace("+dirty", "") : (await repoCommit(RUNNER_ROOT)).replace("+dirty", "");
  const scriptPath = join(JDIR, `runner-update-${Date.now()}.ps1`);
  cleanupRunnerUpdateScripts();
  try {
    writeFileSync(UPDATE_LOCK_FILE, JSON.stringify({ requestId, targetCommit, pid: process.pid, at: Date.now() }), "utf8");
    writeFileSync(scriptPath, detachedWindowsRunnerUpdateScript({ requestId, targetCommit, root: RUNNER_ROOT, resultFile: UPDATE_RESULT_FILE, receiptFile: UPDATE_RECEIPT_FILE, logFile: join(JDIR, "runner.log"), pid: process.pid, force: !!m.force }), "utf8");
    spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch (error: any) {
    try { unlinkSync(UPDATE_LOCK_FILE); } catch { /* ignore */ }
    console.warn("[runner] update externo Windows indisponível:", String(error?.message ?? error).slice(0, 160));
    return false;
  }
  console.log("[runner] update entregue ao script externo; encerrando processo para liberar node_modules");
  setTimeout(() => process.exit(0), 500).unref();
  return true;
}

// --- live mirror of native CLI sessions: tail the jsonl and push new turns as an
//     EXTERNAL Claude Code (or us) appends them, so the Hub UI updates without refresh. ---
interface Tail { path: string; claude: boolean; offset: number; buf: string; paused: boolean; timer: ReturnType<typeof setInterval>; }
const tails = new Map<string, Tail>();
const MAX_TAILS = 4;
function pollTail(sid: string): void {
  const t = tails.get(sid); if (!t || t.paused) return;
  let size = 0; try { size = statSync(t.path).size; } catch { return; }
  if (size <= t.offset) return;
  const len = size - t.offset; const fd = openSync(t.path, "r"); const b = Buffer.alloc(len);
  try { readSync(fd, b, 0, len, t.offset); } finally { closeSync(fd); }
  t.offset = size; t.buf += b.toString("utf8");
  const lines = t.buf.split("\n"); t.buf = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    for (const e of parseNativeEvents(line, t.claude)) {
      if (e.kind === "message") send({ t: "message", sessionId: sid, message: { role: e.role, text: e.text, ts: e.ts } });
      else send({ t: "activity", sessionId: sid, name: e.name, summary: e.summary, path: e.path, adds: e.adds, dels: e.dels, rows: e.rows });
    }
  }
}
function startTail(sid: string): void {
  if (tails.has(sid)) return;
  const f = nativeFilePath(sid); if (!f) return;
  if (tails.size >= MAX_TAILS) { const oldest = tails.keys().next().value; if (oldest) stopTail(oldest); }
  let size = 0; try { size = statSync(f.path).size; } catch { /* new file */ }
  tails.set(sid, { path: f.path, claude: f.claude, offset: size, buf: "", paused: false, timer: setInterval(() => pollTail(sid), 1000) });
}
function stopTail(sid: string): void { const t = tails.get(sid); if (t) { clearInterval(t.timer); tails.delete(sid); } }

// Availability is cached because register runs on every reconnect. Probes are read-only
// version/login-status checks and must never create an inference turn or throwaway session.
// A negative result must NOT stick: probing right before the user runs `claude auth login` would
// otherwise pin the machine to "no AI" for the whole TTL. Success is cached for an hour, failure
// only long enough to avoid a probe storm, so the machine recovers on its own after a login.
let agentsCache: { at: number; list: string[] } | null = null;
const OK_TTL = 3_600_000, FAIL_TTL = 30_000;
async function availableAgents(): Promise<string[]> {
  if (agentsCache && Date.now() - agentsCache.at < (agentsCache.list.length ? OK_TTL : FAIL_TTL)) return agentsCache.list;
  const out: string[] = [];
  for (const n of agents.names()) { try { if (await agents.get(n).available()) out.push(n); } catch { /* skip */ } }
  // Report HONESTLY: an empty list means nothing here is usable (e.g. `claude login` missing /
  // token expired → 401). The old fallback listed every agent anyway, which made the machine
  // look healthy in the UI and turned a clear auth problem into a mystery 401 on send.
  if (!out.length) console.warn('[runner] nenhuma IA disponível — autentique nesta máquina (ex.: `claude login`)');
  agentsCache = { at: Date.now(), list: out };
  return out;
}

function allSessions(): RunnerSession[] {
  const own = store.list().map((s: any) => ({ id: s.id, title: s.title, agent: s.agent, cwd: s.cwd, updatedAt: s.updatedAt, source: "managed" as const, writable: true, started: s.count > 0 }));
  const native = filterUnboundNativeSessions(listNative(), own, (s) => {
    try {
      const nid = agents.get(s.agent).nativeSessionId?.(s.id);
      return nid ? nativeIdForAgent(s.agent, nid) : null;
    } catch { return null; }
  }).map((n) => ({ id: n.id, title: n.title, agent: n.agent, cwd: n.cwd, updatedAt: n.updatedAt, source: "native" as const, writable: n.agent === "claude-code" || n.agent === "codex", started: true }));
  return [...own, ...native].sort((a, b) => b.updatedAt - a.updatedAt);
}
function recentDirsList(sessions: RunnerSession[], n = 10): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const s of sessions) {
    const d = (s.cwd || "").trim();
    if (!d || seen.has(d)) continue;
    seen.add(d); out.push(d);
    if (out.length >= n) break;
  }
  return out;
}
function pushSessions(): void {
  const sessions = allSessions();
  send({ t: "sessions", sessions, recentDirs: recentDirsList(sessions) });
}
function pushRuns(): void { send({ t: "runs", active: [...activeRuns, ...managedRuns] }); }
function pushExecutionManifest(reqId: string): void {
  send({ t: "execution_manifest", reqId, entries: EXECUTIONS_ENABLED ? executionStore.manifest() : [] });
}
function pushExecutionEvents(reqId: string, rootExecutionId: string, afterSeq: number, limit?: number): void {
  if (!EXECUTIONS_ENABLED) { send({ t: "error", reqId, message: "acompanhamento de execuções desativado neste Runner" }); return; }
  const entry = executionStore.manifest().find((item) => item.rootExecutionId === rootExecutionId);
  if (!entry) { send({ t: "error", reqId, message: "execução não encontrada neste Runner" }); return; }
  const page = executionStore.events(rootExecutionId, afterSeq, limit);
  if (page.events.length && page.events[0].seq !== afterSeq + 1) {
    send({ t: "error", reqId, message: `replay indisponível: primeiro evento retido é ${page.events[0].seq}, esperado ${afterSeq + 1}` });
    return;
  }
  send({ t: "execution_events", reqId, rootExecutionId, journalId: entry.journalId,
    events: page.events, nextSeq: page.nextSeq });
}

async function doHistory(reqId: string, sessionId: string): Promise<void> {
  if (isNativeId(sessionId)) {
    const h = nativeHistory(sessionId);
    if (!h) { send({ t: "error", reqId, message: "sessão nativa não encontrada" }); return; }
    const live = pendingActivityReplay(executionStore, sessionId, h.messages);
    send({ t: "history", reqId, sessionId, title: h.title, agent: h.agent, cwd: h.cwd, writable: h.agent === "claude-code" || h.agent === "codex", inputTokens: h.inputTokens, contextWindowTokens: h.contextWindowTokens, model: h.model, effort: h.effort, total: h.messages.length, messages: h.messages.map((m) => ({ role: m.role, text: m.text, ts: m.ts, name: m.name, detail: m.detail, path: m.path, adds: m.adds, dels: m.dels, rows: m.rows, activity: m.activity })), files: sessionFiles(sessionId), liveActivity: live?.events, liveState: live?.state, liveTurnId: live?.turnId, liveUpdatedAt: live?.updatedAt, liveTruncated: live?.truncated });
    startTail(sessionId); // live-mirror new turns (external CLI) to the Hub
  } else {
    if (store.isHidden(sessionId)) { send({ t: "error", reqId, message: "sessão interna não pode ser aberta pelo chat" }); return; }
    const s = store.ensure(sessionId);
    reconcileFromNative(s);
    const all = store.history(s.id);
    const nid = agents.get(s.agent).nativeSessionId?.(s.id);
    const nativeKey = nid ? nativeIdForAgent(s.agent, nid) : null, nh = nativeKey ? nativeHistory(nativeKey) : null, lastUsage = [...all].reverse().find((m: any) => m.usage)?.usage;
    const nativeFiles = nativeKey ? sessionFiles(nativeKey) : [], derivedFiles = touchedFilesFromMessages(all), paths = new Set(nativeFiles.map((f) => f.path));
    const live = pendingActivityReplay(executionStore, s.id, all);
    send({
      t: "history", reqId, sessionId: s.id, title: s.title, agent: s.agent, cwd: s.cwd,
      writable: true, total: all.length, nativeId: nid, inputTokens: nh?.inputTokens, contextWindowTokens: nh?.contextWindowTokens, model: nh?.model || lastUsage?.model, effort: nh?.effort || lastUsage?.effort,
      messages: all.map((m: any) => ({
        role: m.role, text: m.text, ts: m.ts, agent: m.agent, speaker: m.speaker,
        images: m.images, files: m.files, activity: m.activity, usage: m.usage, contextManifest: m.contextManifest,
      })),
      files: [...nativeFiles, ...derivedFiles.filter((f) => !paths.has(f.path))],
      liveActivity: live?.events, liveState: live?.state, liveTurnId: live?.turnId,
      liveUpdatedAt: live?.updatedAt, liveTruncated: live?.truncated,
    });
  }
}

/** cwd / agent of a session on THIS machine (managed or native), for "@" search, "!" and "#" memory. */
function sessCwd(sid?: string): string { if (!sid) return CWD; if (isNativeId(sid)) return nativeInfo(sid)?.cwd || CWD; return store.get(sid)?.cwd || CWD; }
function sessAgent(sid?: string): string | undefined { if (!sid) return undefined; if (isNativeId(sid)) return nativeInfo(sid)?.agent; return store.get(sid)?.agent; }

interface PendingMemoryPreview {
  preview: MemoryAppendPreview;
  sessionId?: string;
  actor?: ContextActor;
  agent?: string;
  cwd: string;
  expiresAt: number;
}
const pendingMemoryPreviews = new Map<string, PendingMemoryPreview>();
const MEMORY_PREVIEW_TTL_MS = 5 * 60_000;
function cleanExpiredMemoryPreviews(): void {
  const now = Date.now();
  for (const [token, pending] of pendingMemoryPreviews) if (pending.expiresAt <= now) pendingMemoryPreviews.delete(token);
}

// Live turns on this machine, so a {t:cancel} from the Hub can kill the actual agent process.
const runAborts = new Map<string, AbortController>();
// Canonical execution controls are keyed by the exact root, never just by session: cancelling an
// old turn must not accidentally abort a newer turn that happens to reuse the same conversation.
const executionAborts = new Map<string, AbortController>();

function runnerManagedSecurity(agent: string, write: boolean): ManagedExecutionSecurity | undefined {
  if (agent === "mock" && process.env.JARVIS_ENABLE_MOCK === "1" && !write) return { commitPrevention: "provider_config", readOnlyEnforcement: "provider_sandbox" };
  if (agent === "claude-code") return { commitPrevention: "provider_config", readOnlyEnforcement: write ? undefined : "provider_sandbox" };
  if (agent === "codex" && !write) return { commitPrevention: "provider_config", readOnlyEnforcement: "provider_sandbox" };
  if (agent === "aider" && write) return { commitPrevention: "provider_config" };
  return undefined;
}
const runnerManagedExecution = new ManagedExecutionService({
  runnerId: RUNNER_ID, store: executionStore, agents, worktrees: new ManagedWorktreeManager(EXECUTION_WORKTREE_ROOT),
  hiddenSessions: {
    async create(input) {
      const existing = store.get(input.idHint);
      if (existing) {
        if (!store.isHidden(input.idHint) || existing.rootExecutionId !== input.rootExecutionId || existing.executionId !== input.executionId || existing.agent !== input.agent || existing.cwd !== input.cwd) {
          throw new Error(`binding de sessão interna divergente para ${input.idHint}`);
        }
      } else store.ensure(input.idHint, { title: input.title, agent: input.agent, cwd: input.cwd, hidden: true, rootExecutionId: input.rootExecutionId, executionId: input.executionId });
      return { sessionId: input.idHint };
    },
    append(sessionId, message) { store.add(sessionId, { role: message.role, text: message.text, ts: message.at }); },
  },
  securityFor: (task) => runnerManagedSecurity(task.agent, task.write === true),
  invoke: async (input) => {
    const reply = await input.adapter.send(input.sessionId, input.prompt, input.cwd, {
      model: input.task.model, effort: input.task.effort, signal: input.signal,
      managed: { workspaceAccess: input.lease.access, preventCommits: true },
    }, input.onEvent);
    if (reply.usage) send({ t: "execution_usage_record", rootExecutionId: executionStore.findNode(input.lease.executionId)?.rootExecutionId || input.task.id, sessionId: input.sessionId, agent: input.task.agent, usage: { ...reply.usage, costKind: reply.usage.costKind || "unavailable", source: reply.usage.source || "adapter não declarou a origem do uso" } });
    return reply;
  },
  onEvent: (event) => send({ t: "execution_event", sessionId: event.rootExecutionId, event }),
  onChildUsage: (input) => send({ t: "execution_usage_record", rootExecutionId: input.rootExecutionId, sessionId: input.sessionId, agent: input.agent, usage: input.usage }),
});

type ExecutionDelegateCommand = Extract<HubToRunner, { t: "execution_delegate" }>;
type ExecutionDelegateResult = Extract<RunnerToHub, { t: "execution_delegate_result" }>;
const DELEGATE_RESULTS_FILE = join(JDIR, "execution-delegate-results.json");
const delegateResults = (() => {
  try {
    const rows = JSON.parse(readFileSync(DELEGATE_RESULTS_FILE, "utf8"));
    return new Map<string, ExecutionDelegateResult>((Array.isArray(rows) ? rows : []).filter((row: any) => row?.t === "execution_delegate_result" && typeof row.requestId === "string" && typeof row.ok === "boolean").slice(-500).map((row: ExecutionDelegateResult) => [row.requestId, row]));
  } catch { return new Map<string, ExecutionDelegateResult>(); }
})();
function rememberDelegateResult(result: ExecutionDelegateResult): void {
  delegateResults.set(result.requestId, result); while (delegateResults.size > 500) { const oldest = delegateResults.keys().next().value; if (oldest) delegateResults.delete(oldest); else break; }
  try { writeJsonAtomic(DELEGATE_RESULTS_FILE, [...delegateResults.values()]); } catch { /* outbox still preserves the live reply */ }
  send(result);
}
function handleExecutionDelegate(command: ExecutionDelegateCommand): void {
  const cached = delegateResults.get(command.requestId); if (cached) { send(cached); return; }
  const plan: ManagedExecutionPlan = { ...command.plan, tasks: command.plan.tasks.map((task) => ({ ...task, write: task.write === undefined ? EXECUTION_DEFAULT_WRITE : task.write })) };
  const policy: ManagedExecutionPolicyInput = { ...command.policy,
    maxConcurrency: Math.min(EXECUTION_MAX_CONCURRENCY, command.policy?.maxConcurrency ?? EXECUTION_MAX_CONCURRENCY),
    maxDepth: Math.min(EXECUTION_MAX_DEPTH, command.policy?.maxDepth ?? EXECUTION_MAX_DEPTH) };
  let accepted = false; const ctrl = new AbortController();
  managedRuns.add(plan.rootExecutionId); executionAborts.set(plan.rootExecutionId, ctrl); pushRuns();
  void runnerManagedExecution.run(plan, { title: command.title, policy, signal: ctrl.signal,
    onAccepted: (rootExecutionId) => { accepted = true; rememberDelegateResult({ t: "execution_delegate_result", requestId: command.requestId, ok: true, rootExecutionId }); },
  }).catch((error) => {
    const message = String((error as Error)?.message || error);
    if (!accepted) rememberDelegateResult({ t: "execution_delegate_result", requestId: command.requestId, ok: false, error: message });
    console.error(`[runner] workflow gerenciado ${plan.rootExecutionId} falhou: ${message}`);
  }).finally(() => {
    managedRuns.delete(plan.rootExecutionId); if (executionAborts.get(plan.rootExecutionId) === ctrl) executionAborts.delete(plan.rootExecutionId); pushRuns();
  });
}

type ExecutionControlCommand = Extract<HubToRunner, { t: "execution_control" }>;
type ExecutionControlResult = Extract<RunnerToHub, { t: "execution_control_result" }>;
const CONTROL_RESULTS_FILE = join(JDIR, "execution-control-results.json");
const CONTROL_RESULT_LIMIT = 500;

function loadExecutionControlResults(): Map<string, ExecutionControlResult> {
  try {
    const parsed = JSON.parse(readFileSync(CONTROL_RESULTS_FILE, "utf8"));
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.flatMap((row: unknown) => {
      const value = row as Partial<ExecutionControlResult>;
      return value?.t === "execution_control_result" && typeof value.requestId === "string"
        && typeof value.executionId === "string" && typeof value.ok === "boolean"
        && Array.isArray(value.affectedIds) && Array.isArray(value.unsupportedIds)
        ? [[value.requestId, value as ExecutionControlResult] as const] : [];
    }).slice(-CONTROL_RESULT_LIMIT));
  } catch { return new Map(); }
}

const executionControlResults = loadExecutionControlResults();

function rememberExecutionControl(result: ExecutionControlResult): void {
  executionControlResults.set(result.requestId, result);
  while (executionControlResults.size > CONTROL_RESULT_LIMIT) {
    const oldest = executionControlResults.keys().next().value;
    if (oldest) executionControlResults.delete(oldest); else break;
  }
  try { writeJsonAtomic(CONTROL_RESULTS_FILE, [...executionControlResults.values()]); }
  catch (error) { console.warn("[runner] não foi possível persistir resultado de controle:", String(error)); }
  send(result);
}

function handleExecutionControl(command: ExecutionControlCommand): void {
  const cached = executionControlResults.get(command.requestId);
  if (cached) { send(cached); return; }
  const found = executionStore.findNode(command.executionId);
  let result: ExecutionControlResult;
  if (!found) {
    result = { t: "execution_control_result", requestId: command.requestId, executionId: command.executionId,
      ok: false, affectedIds: [], unsupportedIds: [command.executionId], error: "execução não encontrada neste Runner" };
  } else if (command.action !== "cancel" && command.action !== "cancel_subtree") {
    result = { t: "execution_control_result", requestId: command.requestId, executionId: command.executionId,
      ok: false, affectedIds: [], unsupportedIds: [command.executionId],
      error: `controle ${command.action} não é suportado por este Runner` };
  } else if (found.node.executionId !== found.node.rootExecutionId) {
    result = { t: "execution_control_result", requestId: command.requestId, executionId: command.executionId,
      ok: false, affectedIds: [], unsupportedIds: [command.executionId],
      error: "cancelamento por nó não é suportado; cancele a execução raiz" };
  } else {
    const ctrl = executionAborts.get(found.rootExecutionId);
    if (!ctrl || ctrl.signal.aborted) {
      result = { t: "execution_control_result", requestId: command.requestId, executionId: command.executionId,
        ok: false, affectedIds: [], unsupportedIds: [], error: "a execução raiz não está ativa" };
    } else {
      ctrl.abort();
      result = { t: "execution_control_result", requestId: command.requestId, executionId: command.executionId,
        ok: true, affectedIds: [command.executionId], unsupportedIds: [] };
    }
  }
  rememberExecutionControl(result);
}

async function executeRunnerAgentTurn(sessionId: string, selected: AgentAdapter, agentInput: string, cwd: string, opts: SendOpts, ctrl: AbortController): Promise<Awaited<ReturnType<AgentAdapter["send"]>> & { activity: AgentEvent[] }> {
  const turnId = opts.turnId || randomUUID();
  const sequencer = createEventSequencer(turnId);
  const bridge = createAgentEventBridge(turnId, sequencer);
  const activity: AgentEvent[] = [];
  const profile = EXECUTION_ADAPTER_PROFILES[selected.name as keyof typeof EXECUTION_ADAPTER_PROFILES];
  const rootExecutionId = executionRootId(RUNNER_ID, sessionId, turnId);
  const tracker = new ExecutionTracker(executionStore, {
    runnerId: RUNNER_ID, sessionId, turnId, agent: selected.name, cwd,
    model: opts.model, effort: opts.effort, profile,
  }, EXECUTIONS_ENABLED ? (event) => send({ t: "execution_event", sessionId, event }) : undefined,
  (usage) => send({ t: "execution_usage_record", rootExecutionId, sessionId, agent: selected.name, usage }));
  executionAborts.set(tracker.rootExecutionId, ctrl);
  const emit = (event: AgentEvent, project = true): void => {
    if (activity.length < 600) activity.push(event);
    if (project) {
      try { tracker?.handleAgentEvent(event); }
      catch (error) { console.warn(`[runner] falha ao projetar execução ${tracker?.rootExecutionId || turnId}:`, String(error)); }
    }
    send({ t: "agent_event", sessionId, agent: selected.name, event });
  };
  try {
    emit(bridge.accepted()); emit(bridge.started());
    const prior = store.history(sessionId).slice(0, -1).filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
    const reply = await selected.send(sessionId, agentInput, cwd, { ...opts, turnId, history: prior, signal: ctrl.signal }, (ev) => {
      if (isProviderExecutionEvent(ev)) {
        let projected: ReturnType<ExecutionTracker["handleProviderEvent"]> | undefined;
        let projectionFailed = false;
        try { projected = tracker?.handleProviderEvent(ev); }
        catch (error) { projectionFailed = true; console.warn(`[runner] falha ao projetar subprocesso em ${tracker?.rootExecutionId || turnId}:`, String(error)); }
        if (ev.kind === "execution_activity") {
          const childActivity = projected?.activity || (!tracker || projectionFailed ? redactProviderExecutionActivity(ev.event, cwd) : undefined);
          if (childActivity) {
            const event = bridge.provider({ ...childActivity, parentId: ev.providerId });
            event.executionId = projected?.executionId;
            emit(event, false);
          }
        }
      } else emit(bridge.provider(ev));
    });
    if (reply.usage || opts.model || opts.effort) reply.usage = { costKind: "unavailable", source: "Jarvis turn selection", ...reply.usage, model: reply.usage?.model || opts.model, effort: reply.usage?.effort || opts.effort };
    if (reply.usage) emit(bridge.usage(reply.usage));
    emit(bridge.completed(reply.text));
    return { ...reply, activity };
  } catch (e: any) {
    if (ctrl.signal.aborted || String(e?.message) === ABORTED) { if (!sequencer.terminal) emit(bridge.cancelled("Cancelada por solicitação do usuário.")); }
    else if (!sequencer.terminal) emit(bridge.failed(String(e?.message ?? e), "PROVIDER_ERROR"));
    throw e;
  } finally {
    if (executionAborts.get(tracker.rootExecutionId) === ctrl) executionAborts.delete(tracker.rootExecutionId);
  }
}

function reconcileFromNative(s: ReturnType<typeof store.ensure>): void {
  if (activeRuns.has(s.id)) return;
  const last = store.history(s.id).at(-1);
  if (!last || last.role !== "user") return;
  const nid = agents.get(s.agent).nativeSessionId?.(s.id);
  if (!nid) return;
  const nativeKey = nativeIdForAgent(s.agent, nid); if (!nativeKey) return;
  const h = nativeHistory(nativeKey);
  if (!h) return;
  const nativeReply = [...h.messages].reverse().find((m) => m.role === "assistant" && m.ts > last.ts);
  if (nativeReply?.text) store.add(s.id, { role: "assistant", text: nativeReply.text, ts: nativeReply.ts, agent: s.agent, activity: nativeReply.activity });
}

async function doSend(
  sessionId: string,
  text: string,
  agentName?: string,
  cwd?: string,
  opts?: SendOpts,
  attachments: Array<{ name: string; content: string; image?: boolean }> = [],
  turnId?: string,
  speaker?: string,
  actor?: ContextActor,
): Promise<void> {
  if (store.isHidden(sessionId)) { send({ t: "error", message: "sessão interna não aceita envio pelo chat" }); return; }
  if (turnId && !seenTurns.add(turnId)) { console.log(`[runner] turno duplicado ignorado (turnId=${turnId})`); return; }
  // One turn per session (authoritative): a second send while one runs = two agents on one repo.
  if (activeRuns.has(sessionId)) { send({ t: "busy", message: "Já há um processamento nesta sessão — aguarde terminar ou toque em Parar." }); return; }
  const ctrl = new AbortController();
  const effectiveTurnId = turnId || randomUUID();
  runAborts.set(sessionId, ctrl);
  activeRuns.add(sessionId); pushRuns();
  // pause the native tail so our own turn isn't double-broadcast (already streamed below)
  const tail = isNativeId(sessionId) ? tails.get(sessionId) : undefined;
  if (tail) tail.paused = true;
  let streamAgent: string | undefined;
  try {
    let agent: AgentAdapter, useCwd: string;
    if (isNativeId(sessionId)) {
      const info = nativeInfo(sessionId);
      if (!info) throw new Error("sessão nativa não encontrada");
      agent = agents.get(info.agent); streamAgent = agent.name; useCwd = info.cwd || CWD;
      const built = buildTurnAttachments(attachments, text, {
        saveImage: (name, bytes) => {
          const dir = join(JDIR, "pasted"); mkdirSync(dir, { recursive: true });
          const p = join(dir, `${Date.now()}-${String(name || "img").replace(/[^\w.-]/g, "_")}`);
          writeFileSync(p, bytes); return p;
        },
        previewImage: (name, bytes) => imageDataUrl(name, bytes),
      });
      const bang = await expandBang(built.agentText, useCwd);
      const cmdExp = bang ? null : expandCommand(built.agentText, useCwd, cmdAgentOf(agent.name));
      const agentInput = bang ? bang.expanded : (cmdExp ? cmdExp.expanded : built.agentText);
      const prior = (nativeHistory(sessionId)?.messages || []).filter((message) => message.role === "user" || message.role === "assistant");
      const manifest = buildContextManifest({
        turnId: effectiveTurnId, sessionId, runnerId: RUNNER_ID, agent: agent.name, cwd: useCwd, actor,
        continuity: agent.sessionContinuity?.() || "none",
        nativeSessionId: sessionId.includes(":") ? sessionId.slice(sessionId.indexOf(":") + 1) : undefined,
        history: prior, showText: built.showText, agentText: agentInput, images: built.images, files: built.files,
      });
      try { contextManifests.append(manifest); } catch (error) { console.warn("[runner] manifesto de contexto não persistido:", String(error)); }
      send({ t: "context_manifest", sessionId, manifest });
      send({ t: "message", sessionId, message: { role: "user", text: built.showText, ts: Date.now(), agent: agent.name, images: built.images, files: built.files, contextManifest: manifest } });
      await executeRunnerAgentTurn(sessionId, agent, agentInput, useCwd, { ...opts, turnId: effectiveTurnId }, ctrl);
    } else {
      const existing = store.get(sessionId);
      // The Hub may resolve an automatic IA immediately before the first turn. Rebind only while
      // the session is still empty; Store enforces that a started conversation never changes IA.
      if (existing && agentName && existing.agent !== agentName) store.reconfigure(sessionId, { agent: agentName });
      const s = store.ensure(sessionId, agentName ? { agent: agentName, cwd: cwd || CWD } : undefined);
      agent = agents.get(s.agent); streamAgent = agent.name; useCwd = s.cwd || CWD;
      const built = buildTurnAttachments(attachments, text, {
        saveImage: (name, bytes) => {
          const dir = join(JDIR, "pasted"); mkdirSync(dir, { recursive: true });
          const p = join(dir, `${Date.now()}-${String(name || "img").replace(/[^\w.-]/g, "_")}`);
          writeFileSync(p, bytes); return p;
        },
        previewImage: (name, bytes) => imageDataUrl(name, bytes),
      });
      const bang = await expandBang(built.agentText, useCwd);
      const cmdExp = bang ? null : expandCommand(built.agentText, useCwd, cmdAgentOf(agent.name));
      const agentInput = bang ? bang.expanded : (cmdExp ? cmdExp.expanded : built.agentText);
      const ctx: TurnCtx = {
        ensure: (sid) => store.ensure(sid),
        resolveAgentName: (name) => agents.get(name).name,
        add: (sid, msg) => store.add(sid, msg),
        broadcast: (sid, message) => send({ t: "message", sessionId: sid, message: (message as any).message }),
        pushSessions,
        now: () => Date.now(),
        speak: async () => {},
        buildContextManifest: ({ turnId: manifestTurnId, sid, agentName: manifestAgent, cwd: manifestCwd, showText, agentText, actor: manifestActor, images, files }) => {
          const selected = agents.get(manifestAgent);
          return buildContextManifest({
            turnId: manifestTurnId, sessionId: sid, runnerId: RUNNER_ID, agent: selected.name, cwd: manifestCwd,
            actor: manifestActor, continuity: selected.sessionContinuity?.() || "none", nativeSessionId: selected.nativeSessionId?.(sid),
            history: store.history(sid), showText, agentText, images, files,
          });
        },
        recordContextManifest: (manifest) => {
          try { contextManifests.append(manifest); } catch (error) { console.warn("[runner] manifesto de contexto não persistido:", String(error)); }
          send({ t: "context_manifest", sessionId: manifest.sessionId, manifest });
        },
        runAgentTurn: async (sid, name, agentText, turnCwd, turnOpts) => {
          const selected = agents.get(name);
          return executeRunnerAgentTurn(sid, selected, agentText, turnCwd, turnOpts, ctrl);
        },
        afterStored: (sid, storedTurnId) => send({ t: "activity_committed", sessionId: sid, turnId: storedTurnId }),
      };
      await runManagedTurn(ctx, sessionId, {
        showText: built.showText, agentText: agentInput, model: opts?.model, effort: opts?.effort, turnId: effectiveTurnId,
        actor, speaker, images: built.images, files: built.files,
        onError: (message) => {
          if (!(ctrl.signal.aborted || message === ABORTED)) send({ t: "error", message });
        },
      });
    }
  } catch (e: any) {
    // User-initiated cancel: not an error — tell the UI it stopped and stay quiet otherwise.
    if (!(ctrl.signal.aborted || String(e?.message) === ABORTED)) {
      send({ t: "error", message: String(e?.message ?? e) });
    }
  } finally {
    const managed = !isNativeId(sessionId) ? store.get(sessionId) : undefined;
    if (managed) {
      const nativeId = agents.get(managed.agent).nativeSessionId?.(sessionId);
      if (nativeId) send({ t: "session", sessionId, nativeId });
    }
    if (runAborts.get(sessionId) === ctrl) runAborts.delete(sessionId);
    activeRuns.delete(sessionId); pushRuns();
    if (tail) { try { tail.offset = statSync(tail.path).size; tail.buf = ""; } catch { /* ignore */ } tail.paused = false; }
  }
}

let reconnectDelay = 1000;
function connect(): void {
  const sock = new WebSocket(HUB_URL);
  ws = sock;
  // Inverse heartbeat / half-open detection. The Hub pings every 20s; ANY inbound frame refreshes
  // this clock. A dead TCP half-open (Hub crashed, NAT dropped the mapping) never fires 'close', so
  // the socket would sit "OPEN" for minutes while every turn event is written into the void (send()
  // only buffers to the outbox when readyState !== OPEN). If three ping cycles pass with no traffic,
  // terminate the socket ourselves — that fires 'close', which reconnects and re-arms the outbox.
  let lastInbound = Date.now();
  const hb = setInterval(() => {
    if (sock.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastInbound > 60000) { console.warn("[runner] Hub sem ping há 60s — encerrando socket meio-aberto"); try { sock.terminate(); } catch { /* ignore */ } }
  }, 20000);
  hb.unref?.();
  sock.on("open", async () => {
    reconnectDelay = 1000;
    const available = await availableAgents();
    // Publish the full catalog (including not_installed/unauthenticated reasons). `agents` remains
    // the executable allow-list; descriptors let the UI explain why another adapter is unavailable.
    const descriptors = await agents.describe();
    const agentUsage: Record<string, unknown | null> = {};
    for (const name of agents.names()) { const a = agents.get(name); try { agentUsage[name] = a.usage ? await a.usage() : null; } catch { agentUsage[name] = null; } }
    const info: RunnerInfo = {
      runnerId: RUNNER_ID, host: hostname(), os: platform(), agents: available,
      agentDescriptors: descriptors, agentUsage, protocolVersion: RUNNER_PROTOCOL_VERSION,
      version: VERSION, commit: await repoCommit(RUNNER_ROOT), updateReceipt: updateReceipt(), updateResult: readUpdateResult(), label: process.env.JARVIS_LABEL || undefined,
    };
    send({ t: "register", token: TOKEN, info });
  });
  sock.on("message", async (data) => {
    lastInbound = Date.now();
    let m: any; try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m !== "object" || typeof m.t !== "string") return; // drop junk / non-object frames
    try {
      if (m.t === "welcome") {
        console.log(`[runner] registered as ${RUNNER_ID} (${hostname()})`);
        clearUpdateResult();
        flushOutbox();
        pushExecutionManifest(`welcome:${RUNNER_ID}`);
        pushSessions(); pushRuns(); send({ t: "caps", agent: DEFAULT_AGENT, caps: await agents.describe() });
        return;
      }
      if (m.t === "reject") {
        console.error(`[runner] rejected by hub: ${m.reason}`);
        void maybeSelfUpdate(`rejeitado pelo Hub: ${String(m.reason || "").slice(0, 120)}`, true);
        sock.close();
        return;
      }
      if (m.t === "ping") { send({ t: "pong" }); return; }
      if (updateInProgress && ["send", "execution_delegate", "new", "configure"].includes(m.t)) {
        send({ t: "error", reqId: m.reqId, message: "máquina drenando para atualização — tente novamente após ela reconectar" }); return;
      }
      if (m.t === "execution_manifest_request" && typeof m.reqId === "string") {
        pushExecutionManifest(m.reqId); return;
      }
      if (m.t === "execution_read" && typeof m.reqId === "string" && typeof m.rootExecutionId === "string") {
        const afterSeq = Number.isSafeInteger(m.afterSeq) && m.afterSeq >= 0 ? m.afterSeq : 0;
        const limit = Number.isSafeInteger(m.limit) && m.limit > 0 ? Math.min(m.limit, 1000) : undefined;
        pushExecutionEvents(m.reqId, m.rootExecutionId, afterSeq, limit); return;
      }
      if (m.t === "execution_control" && typeof m.requestId === "string" && typeof m.executionId === "string"
        && ["cancel", "cancel_subtree", "steer", "retry"].includes(m.action)) {
        handleExecutionControl(m as ExecutionControlCommand); return;
      }
      if (m.t === "execution_delegate" && typeof m.requestId === "string" && m.plan && typeof m.plan === "object") {
        if (!EXECUTIONS_ENABLED) { rememberDelegateResult({ t: "execution_delegate_result", requestId: m.requestId, ok: false, error: "acompanhamento de trabalhos está desabilitado neste Runner" }); return; }
        handleExecutionDelegate(m as ExecutionDelegateCommand); return;
      }
      if (m.t === "list") { pushSessions(); return; }
      if (m.t === "new") {
        const id = randomUUID();
        const agentName = agents.names().includes(m.agent) ? m.agent : agents.default;
        const cwd = (typeof m.cwd === "string" && m.cwd && existsSync(m.cwd)) ? m.cwd : CWD;
        const s = store.ensure(id, { agent: agentName, cwd });
        send({ t: "history", reqId: m.reqId, sessionId: id, title: s.title, agent: s.agent, cwd: s.cwd, writable: true, total: 0, messages: [] });
        pushSessions();
        return;
      }
      if (m.t === "readfile" && typeof m.path === "string") { send({ t: "filecontent", reqId: m.reqId, ...readProjectFile(m.path, m.cwd) }); return; }
      if (m.t === "readdiff" && typeof m.path === "string" && typeof m.sessionId === "string") {
        if (store.isHidden(m.sessionId)) { send({ t: "error", reqId: m.reqId, message: "sessão interna não expõe diff pelo chat" }); return; }
        const diffId = isNativeId(m.sessionId) ? m.sessionId : (() => { const s = store.get(m.sessionId); const nid = s && agents.get(s.agent).nativeSessionId?.(s.id); return s && nid ? (nativeIdForAgent(s.agent, nid) || "") : ""; })();
        const managed = !diffId ? store.history(m.sessionId) : [];
        send({ t: "filediff", reqId: m.reqId, ...(diffId ? sessionFileDiff(diffId, m.path) : fileDiffFromMessages(managed, m.path)) });
        return;
      }
      if (m.t === "delete" && (typeof m.sessionId === "string" || Array.isArray(m.sessionIds))) {
        const ids: string[] = Array.isArray(m.sessionIds) ? m.sessionIds.filter((x: any) => typeof x === "string") : [m.sessionId];
        const deletedIds: string[] = [];
        for (const sid of ids) {
          if (activeRuns.has(sid)) continue;
          if (isNativeId(sid)) { stopTail(sid); if (deleteNative(sid)) { executionStore.deleteSession(sid); deletedIds.push(sid); } }
          else {
            if (store.isHidden(sid)) continue;
            const s = store.get(sid);
            if (s) {
              const ag = agents.get(s.agent);
              if (m.alsoNative && ag.nativeSessionId) { const nid = ag.nativeSessionId(sid); const key = nid && nativeIdForAgent(s.agent, nid); if (key) deleteNative(key); }
              ag.forgetSession?.(sid);
            }
            if (store.delete(sid)) { executionStore.deleteSession(sid); deletedIds.push(sid); }
          }
        }
        send({ t: "deleted", reqId: m.reqId, sessionId: m.sessionId, ids: deletedIds, ok: deletedIds.length === ids.length, okCount: deletedIds.length });
        pushSessions();
        return;
      }
      if (m.t === "open" && typeof m.sessionId === "string") { await doHistory(m.reqId, m.sessionId); return; }
      if (m.t === "listdir") {
        const base = (typeof m.path === "string" && m.path) ? m.path : homedir();
        try {
          const entries = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort((a, b) => a.localeCompare(b));
          send({ t: "dirs", reqId: m.reqId, path: base, parent: dirname(base), entries });
        } catch (e: any) { send({ t: "error", reqId: m.reqId, message: "listdir: " + String(e?.message ?? e) }); }
        return;
      }
      if (m.t === "configure" && typeof m.sessionId === "string") {
        if (store.isHidden(m.sessionId)) { send({ t: "error", reqId: m.reqId, message: "sessão interna não pode ser configurada pelo chat" }); return; }
        const s = store.get(m.sessionId);
        if (!s) { send({ t: "error", reqId: m.reqId, message: "sessão não encontrada" }); return; }
        const agentName = agents.names().includes(m.agent) ? m.agent : undefined;
        const cwd = (typeof m.cwd === "string" && m.cwd && existsSync(m.cwd)) ? m.cwd : undefined;
        if (!store.reconfigure(s.id, { agent: agentName, cwd })) { send({ t: "error", reqId: m.reqId, message: "sessão já iniciada — agente e pasta travados" }); return; }
        const ns = store.get(s.id)!;
        const all = store.history(ns.id);
        send({ t: "history", reqId: m.reqId, sessionId: ns.id, title: ns.title, agent: ns.agent, cwd: ns.cwd, writable: true, total: all.length, messages: all.map((x: any) => ({ role: x.role, text: x.text, ts: x.ts })) });
        pushSessions();
        return;
      }
      if (m.t === "send" && typeof m.sessionId === "string") {
        await doSend(
          m.sessionId, String(m.text ?? ""), m.agent, m.cwd,
          { model: m.model ?? m.opts?.model, effort: m.effort ?? m.opts?.effort },
          Array.isArray(m.attachments) ? m.attachments : [],
          typeof m.turnId === "string" ? m.turnId : undefined,
          typeof m.speaker === "string" ? m.speaker : undefined,
          m.actor,
        );
        return;
      }
      if (m.t === "caps") { send({ t: "caps", agent: m.agent || DEFAULT_AGENT, caps: await agents.describe() }); return; }
      if (m.t === "usage" && typeof m.reqId === "string") {
        const name = typeof m.agent === "string" && agents.names().includes(m.agent) ? m.agent : DEFAULT_AGENT;
        const adapter = agents.get(name);
        if (!adapter.usage) { send({ t: "usage_info", reqId: m.reqId, agent: name, plan: null, planStatus: "unsupported" }); return; }
        try {
          const plan = await adapter.usage();
          send({ t: "usage_info", reqId: m.reqId, agent: name, plan, planStatus: plan ? "available" : "not_reported" });
        } catch {
          send({ t: "usage_info", reqId: m.reqId, agent: name, plan: null, planStatus: "error" });
        }
        return;
      }
      if (m.t === "commands") { const cwd = sessCwd(m.sessionId); send({ t: "command_list", reqId: m.reqId, cwd, commands: listCommandsPublic(cwd) }); return; }
      if (m.t === "mention") { if (typeof m.sessionId === "string" && store.isHidden(m.sessionId)) { send({ t: "error", reqId: m.reqId, message: "sessão interna não expõe arquivos pelo chat" }); return; } send({ t: "mention_list", reqId: m.reqId, files: listMentionFiles(sessCwd(m.sessionId), typeof m.q === "string" ? m.q : "") }); return; }
      if (m.t === "memory_preview" && typeof m.text === "string") {
        if (typeof m.sessionId === "string" && store.isHidden(m.sessionId)) { send({ t: "error", reqId: m.reqId, message: "sessão interna não aceita memória pelo chat" }); return; }
        try {
          cleanExpiredMemoryPreviews();
          const cwd = sessCwd(m.sessionId), agent = cmdAgentOf(sessAgent(m.sessionId));
          const preview = previewMemoryAppend(m.text, cwd, agent);
          const token = randomUUID(), expiresAt = Date.now() + MEMORY_PREVIEW_TTL_MS;
          pendingMemoryPreviews.set(token, { preview, sessionId: m.sessionId, actor: m.actor, agent: agent || undefined, cwd, expiresAt });
          send({ t: "memory_preview", reqId: m.reqId, sessionId: m.sessionId, token, target: preview.file, note: preview.note, appendText: preview.appendText, beforeHash: preview.beforeHash, exists: preview.exists, expiresAt });
        } catch (e: any) { send({ t: "error", reqId: m.reqId, message: "memória: " + String(e?.message ?? e) }); }
        return;
      }
      if (m.t === "memory_apply" && typeof m.token === "string") {
        cleanExpiredMemoryPreviews();
        const pending = pendingMemoryPreviews.get(m.token);
        pendingMemoryPreviews.delete(m.token);
        if (!pending) { send({ t: "memory_applied", reqId: m.reqId, token: m.token, ok: false, error: "prévia inexistente, expirada ou já aplicada" }); return; }
        try {
          const result = applyMemoryAppend(pending.preview);
          memoryProvenance.append({
            at: Date.now(), sessionId: pending.sessionId, runnerId: RUNNER_ID,
            userId: pending.actor?.userId, deviceId: pending.actor?.deviceId, agent: pending.agent, cwd: pending.cwd,
            target: result.file, beforeHash: result.beforeHash, afterHash: result.afterHash,
            noteHash: createHash("sha256").update(result.note).digest("hex"),
          });
          send({ t: "memory_applied", reqId: m.reqId, token: m.token, sessionId: pending.sessionId, ok: true, target: result.file, beforeHash: result.beforeHash, afterHash: result.afterHash });
          if (pending.sessionId) send({ t: "message", sessionId: pending.sessionId, message: { role: "assistant", text: "Anotado em " + result.file, ts: Date.now() } });
        } catch (e: any) { send({ t: "memory_applied", reqId: m.reqId, token: m.token, sessionId: pending.sessionId, ok: false, error: "memória: " + String(e?.message ?? e) }); }
        return;
      }
      if (m.t === "memory_cancel" && typeof m.token === "string") {
        pendingMemoryPreviews.delete(m.token);
        return;
      }
      if (m.t === "memory_append") {
        send({ t: "error", message: "escrita de memória exige prévia e confirmação pelo fluxo preview/apply" });
        return;
      }
      if (m.t === "dropLast" && typeof m.sessionId === "string") {
        if (store.isHidden(m.sessionId)) { send({ t: "error", message: "sessão interna não pode ser alterada pelo chat" }); return; }
        if (!isNativeId(m.sessionId)) {
          store.dropLastUser(m.sessionId);
          pushSessions();
        }
        return;
      }
      if (m.t === "update") {
        if (updateInProgress) { send({ t: "update_done", requestId: m.requestId, ok: false, log: "outra atualização já está em andamento" }); return; }
        updateInProgress = true;
        console.log("[runner] update solicitado pelo Hub...", m.force ? "(forçado)" : "");
        const drainStarted = Date.now();
        while ((activeRuns.size || managedRuns.size) && Date.now() - drainStarted < 120_000) await new Promise((resolve) => setTimeout(resolve, 1000));
        if (activeRuns.size || managedRuns.size) {
          const log = `não foi possível drenar ${activeRuns.size + managedRuns.size} trabalho(s) em 120s; nenhum arquivo foi alterado`;
          send({ t: "update_done", requestId: m.requestId, ok: false, log }); updateInProgress = false; return;
        }
        if (await handoffWindowsRunnerUpdate(m)) return;
        let r: UpdateResult;
        try { r = await updateApply(RUNNER_ROOT, { force: !!m.force, targetCommit: typeof m.targetCommit === "string" ? m.targetCommit : undefined }); }
        catch (error: any) { const log = "falha inesperada ao preparar atualização: " + String(error?.message ?? error); send({ t: "update_done", requestId: m.requestId, ok: false, log }); updateInProgress = false; return; }
        console.log("[runner] update:", r.ok ? "ok" : "falhou", "-", r.log.replace(/\n/g, " ").slice(0, 160));
        if (r.ok && typeof m.requestId === "string") {
          try { writeJsonAtomic(UPDATE_RECEIPT_FILE, { requestId: m.requestId, targetCommit: String(m.targetCommit || r.current || ""), current: String(r.current || await repoCommit(RUNNER_ROOT)).replace("+dirty", ""), preparedAt: Date.now() }, { pretty: true }); }
          catch (error) { r = { ok: false, log: r.log + "\nERRO ao persistir comprovante da atualização: " + String((error as any)?.message ?? error), behind: r.behind }; }
        }
        // Report back: this used to land only in THIS machine's console, so the Hub said
        // "atualizando N máquinas" and an abort here was invisible — you'd find out days later.
        send({ t: "update_done", requestId: m.requestId, ok: r.ok, dirty: !!r.dirty, behind: r.behind ?? 0, log: r.log.slice(0, 600), current: r.current, restartRequired: r.restartRequired, rolledBack: r.rolledBack, retryable: r.retryable });
        if (r.ok && r.restartRequired !== false) void drainAndExit();
        else updateInProgress = false;
        return;
      }
      if ((m.t === "cancel" || m.t === "stop") && typeof m.sessionId === "string") { runAborts.get(m.sessionId)?.abort(); return; }
    } catch (e: any) { send({ t: "error", reqId: m?.reqId, message: String(e?.message ?? e) }); }
  });
  sock.on("close", () => {
    clearInterval(hb); ws = null;
    void maybeSelfUpdate("desconectado");
    setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    console.log(`[runner] disconnected; retrying in ${reconnectDelay / 1000}s`);
  });
  sock.on("error", (e: any) => { console.error("[runner] ws error:", e?.message ?? e); });
}

/** Wait for in-flight turns to finish (up to a deadline), then restart via the service manager. A
 *  restart mid-turn kills the agent's process tree — draining lets the running turn land its reply
 *  first; the deadline stops a stuck turn from blocking the update forever. */
async function drainAndExit(deadlineMs = 120000): Promise<void> {
  const start = Date.now();
  while (activeRuns.size && Date.now() - start < deadlineMs) await new Promise((r) => setTimeout(r, 1000));
  if (activeRuns.size) console.warn(`[runner] reiniciando com ${activeRuns.size} turno(s) ainda ativo(s) — deadline atingido`);
  await new Promise((r) => setTimeout(r, 250)); // let update_done leave the WebSocket; reconnect verification remains authoritative
  try { restartService("runner"); } catch { /* ignore */ }
  process.exit(0);
}
// Graceful shutdown: a service stop / SIGTERM otherwise leaves the spawned agent CLIs (running with
// bypassPermissions) orphaned — still working, still spending tokens, with nothing to collect the
// result. Abort every live turn (killTree fires via the AbortSignal) before exiting.
let shuttingDown = false;
function shutdown(sig: string): void {
  if (shuttingDown) return; shuttingDown = true;
  if (runAborts.size) console.log(`[runner] ${sig} — abortando ${runAborts.size} turno(s) em andamento`);
  for (const [, ctrl] of runAborts) { try { ctrl.abort(); } catch { /* ignore */ } }
  setTimeout(() => process.exit(0), 300); // brief grace so killTree's taskkill can spawn
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(`[runner] id=${RUNNER_ID} host=${hostname()} os=${platform()} -> ${HUB_URL}`);
// Surface the #1 misconfig at boot instead of as a silent reject 20s later: an empty token means the
// Hub drops the register unless it runs with JARVIS_AUTH=off. Warn (not exit) so the auth-off case
// still works. Louder still when pointing at a REMOTE hub, where a missing token is almost never intended.
if (!TOKEN) {
  const remote = !/^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(HUB);
  console.warn(`[runner] ⚠ JARVIS_TOKEN vazio — com auth ligada (padrão) o Hub vai rejeitar o registro.`);
  if (remote) console.warn(`[runner] ⚠ Hub remoto (${HUB}) sem token: gere um com \`jarvis machine "<label>"\` no Hub e grave JARVIS_TOKEN=... em ~/.jarvis/runner.env.`);
}
try { const purged = purgeProbeJunk(); if (purged) console.log(`[runner] limpei ${purged} sessão(ões) de sondagem "ok"`); } catch { /* ignore */ }
try { const s = purgeScratch(); if (s) console.log(`[runner] limpei ${s} transcript(s) descartável(is) de one-shot`); } catch { /* ignore */ }
try {
  let n = 0;
  for (const meta of store.list()) {
    const s = store.ensure(meta.id);
    const before = s.messages.length;
    reconcileFromNative(s);
    if (s.messages.length > before) n++;
  }
  if (n) console.log(`[runner] reconciliei ${n} sessão(ões) com resposta nativa que tinha ficado invisível`);
} catch { /* ignore */ }
connect();
// keep native/managed session list fresh (native sessions can change out-of-band)
setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) pushSessions(); }, 6000);
if (RUNNER_SELF_UPDATE_MS > 0) {
  setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) void maybeSelfUpdate("checagem periódica desconectada");
  }, RUNNER_SELF_UPDATE_MS).unref?.();
}
