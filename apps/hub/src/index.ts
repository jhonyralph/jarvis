/**
 * Jarvis Hub — local server: serves the chat PWA + a WebSocket that routes
 * messages to an AgentAdapter and (optionally) speaks the reply via local TTS.
 *
 * Runs NATIVELY (no WSL). Cross-platform (Windows/Linux/Mac).
 *
 * Env:
 *   JARVIS_PORT   (default 4577)
 *   JARVIS_CWD    working dir for the agent (default: process.cwd())
 *   JARVIS_VOICE  Piper voice (default en_GB-alan-medium)
 *   JARVIS_AGENT  default registered adapter id
 *   JARVIS_AGENT_PERMISSION_MODE  full-access | provider-default
 */
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdirSync, appendFileSync, rmSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, normalize, dirname, basename, relative, resolve, sep } from "node:path";
import QRCode from "qrcode";
import { PushCenter, type PushActor } from "./push.js";
import { RunnerListWaiters } from "./runnerListWaiters.js";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { AgentRegistry, MockAgentAdapter, ClaudeCodeAdapter, CodexAdapter, AiderAdapter, GeminiCliAdapter, CursorAgentAdapter, CopilotCliAdapter, OpenCodeAdapter, ClineCliAdapter, QwenCodeAdapter, ContinueCliAdapter, KiroCliAdapter, AntigravityCliAdapter, ABORTED, resolveClosestModel, createAgentEventBridge, createEventSequencer, ackThenWork, routePersonalIntent, loadSessionDefaults, saveSessionDefaults, resolveSessionDefaults, normalizePermissionMode, type AgentAdapter, type AgentReply, type SendOpts, type AgentEvent, type PermissionMode, type SessionDefaults, type SessionDefaultsDocument } from "@jarvis/core";
import { synthesize, listVoices, listVoiceCatalog, hasVoice, warmUp as warmUpTts } from "./tts.js";
import { transcribe, warmUp as warmUpStt } from "./stt.js";
import { warmUp as warmUpEmbed } from "./embed.js";
import { log, isLogLevel } from "./logger.js";
import { updateStalled } from "./update-watchdog.js";
import { retargetTarget } from "./update-retarget.js";
import { speechify, speechifyCapped } from "./speechify.js";
import { runSessionSearch, looksLikeCrossSessionQuery } from "./search.js";
import { identifySpeaker, enrollSpeaker, listSpeakers, deleteSpeaker } from "./speaker.js";
import { listNative, nativeHistory, isNativeId, nativeInfo, nativeFilePath, nativeIdForAgent, filterUnboundNativeSessions, parseNativeEvents, deleteNative, sessionFiles, sessionFileDiff, purgeProbeJunk, purgeScratch, searchNative, snippetAround, nativeParseHealth, lineDiff, type SessionHit } from "@jarvis/core";
import { parseVoiceIntent } from "./voiceIntent.js";
import { Store, updateCheck, updateApply, updateRollback, restartService, repoRemoteUrl, repoCommit, repoVersion, readProjectFile, writeJsonAtomic, readJson, cleanupOrphanBackups, RoutineStore, scheduleLabel, validateCron, createSeenSet, filterForDispatch, MemoryStore, classifyMemoryText, projectMemoryKey, StagingStore, buildRefinePrompt, parseRefine, Metrics, VERSION, AGENT_EVENT_SCHEMA_VERSION, buildRelevancePrompt, parseRelevanceVerdict, buildVoicePreflightPrompt, parseVoicePreflight, listCommandsPublic, expandCommand, cmdAgentOf, listNativeCatalog, collectNativeCatalogFiles, nativeSourceId, listMentionFiles, expandBang, previewMemoryAppend, applyMemoryAppend, MemoryProvenanceStore, ContextManifestStore, buildContextManifest, buildTurnAttachments, touchedFilesFromMessages, fileDiffFromMessages, UsageLedger, ExecutionStore, ExecutionTracker, ManagedWorktreeManager, isProviderExecutionEvent, redactProviderExecutionActivity, EXECUTION_ADAPTER_PROFILES, loadAdaptivePolicyDocument, saveAdaptivePolicyDocument, normalizeAdaptivePolicyDocument, resolveAdaptivePolicy, decideMemoryWrite, decideAdaptiveRun, mergeAdaptiveManagedPolicy, adaptiveApprovalVoiceCommand, createAdaptiveApprovalRequest, explainAdaptivePolicy, upsertAdaptivePolicyScope, removeAdaptivePolicyScope, pendingActivityReplay, buildCouncilPlan, COUNCIL_MODES, SOLUTION_WORKSPACE_MODES, formatCouncilFinalMessage, formatCouncilRequestMessage, managedChildExecutionId, managedPhaseExecutionId, buildTournamentPlan, parseJudgeScores, selectTournamentWinner, formatTournamentFinalMessage, parseWorkflowFromSkill, normalizeWorkflowDefinition, workflowToFile, workflowFromFile, dedupeWorkflowsById, WorkflowRunStore, ProjectTaskBindingStore, TaskMetaStore, parseTaskInput, parseFeatureTask, projectKeyFor, resolveTaskSource, resolveFeaturesRoot, listTasksFromMcp, loadTaskMcpConfig, taskMcpConfigFile, LocalTaskCache, formatParallelRunsLine, createTaskViaMcp, windowsUpdaterBody, featureFileContent, featureFileName, validateTaskMcpServerInput, writeTaskMcpConfig, describeTaskMcpServers, TASK_MCP_SCHEMA_VERSION, TaskConnectionStore, resolveTaskConnection, publicTaskConnections, remoteMismatchWarning, remoteCheckApplies, fetchProviderIdentity, searchProviderTasks, getProviderTask, createProviderTask, TASK_PROVIDERS, SecretVault, secretNameFor, createRun, markStep, advanceRun, jumpToStep, focusStep, attachEvidence, setRunTask, linkSession, summarizeRun, normalizeTaskRef, taskLabel, parseStepDirectives, applyStepDirectives, buildWorkflowSteering, type WorkflowRun, type RunStepState, type MarkedBy, clampDebateRounds, buildDebateOpeningPrompt, buildDebateRebuttalPrompt, buildDebateJudgePrompt, buildDebateSynthesisPrompt, parseDebateVerdict, formatDebateRoundMessage, formatDebateFinalMessage, DEBATE_INTERJECTION_MAX_CHARS, buildSessionBriefingBlock, pruneStoredBriefings, SESSION_BRIEFING_MAX_CHARS, SESSION_BRIEFING_MAX_PER_SESSION, SESSION_BRIEFING_TTL_MS, type StoredSessionBriefing, resolveEffortLevel, normalizeEffortLevel, type EffortLevel, type DebateDebater, type DebaterResponse, type DebateVerdict, TerminalManager, type TournamentCompetitor, type TournamentCandidateResult, type ManagedTaskState, readCanonicalFramework, materializeFramework, pruneFrameworkResidue, writeFrameworkFile, deleteFrameworkFile, deleteFrameworkFolder, importFrameworkFromNative, installFrameworkStarterPack, starterFrameworkFiles, collectNativeFrameworkFiles, frameworkRoot, normalizeFrameworkPreference, FrameworkProvenanceStore, type FrameworkPreference, type FrameworkManifest, type CouncilMode, type SolutionWorkspaceMode, type ExecutionAdapterId, type ManagedExecutionPlan, type ManagedExecutionPolicyInput, type Routine, type AdaptivePolicyDocument, type AdaptiveApprovalRequest, type PolicyScope, type MemoryAppendPreview, parseTaskSourceCommand, planTaskSourceCommand, formatTaskSourceConfirmation, resolveFanoutTasks, fanoutConfirmText, fanoutSeedMessage, fanoutParentMessage, type FanoutResolution } from "@jarvis/core";
import { QueueBlockRegistry, readPackDir, packDirLabel, pendingInstructions, buildInstructionsSteering, buildInventory, scanFramework, validateFramework, unzip, extractFrameworkFiles, buildImportPreview, applyFrameworkImport, parseGithubSpec, fetchGithubFramework, FrameworkSourceStore, githubSourceId, zipSourceId, hashFrameworkFiles, AgentAvailabilityStore, nextLocalMidnight, buildPackIndex, packTemplateFiles, zipStore, checkConformance, PACK_TEMPLATE_FILENAME, type FrameworkFile, type GithubSpec, type FrameworkSourceType, type PackManifest, type PackRef } from "@jarvis/core";
import { embed, embedOne } from "./embed.js";
import { RUNNER_PROTOCOL_VERSION, RUNNER_CAPABILITY_SINCE, isExecutionState, isPersonalClientMessage, type ContextActor, type ContextManifest, type RunnerInfo, type ExecutionEvent, type ExecutionNode, type ExecutionState, type ExecutionManifestEntry } from "@jarvis/protocol";
import * as auth from "./auth.js";
import * as guard from "./guard.js";
import { startAdminApi } from "./adminApi.js";
import { runManagedTurn, type ManagedTurnInput, type TurnCtx } from "./turn.js";
import { autoRouteFallback, buildAutoRoutePrompt, normalizeAutoRouteAgents, parseAutoRouteDecision, type AutoRouteDecision, type AutoRouteFlags } from "./autoRoute.js";
import { buildCouncilRoutePrompt, councilRouteFallback, parseCouncilRouteDecision, type CouncilRouteDecision } from "./councilRoute.js";
import { ManagedExecutionService, type ManagedExecutionSecurity } from "@jarvis/core";
import { BackgroundJobStore, planJobContinuation, parseBackgroundRunDirectives, canContinueOriginSession, DEFAULT_MAX_AUTO_CONTINUE_DEPTH, isTerminalJobStatus, type BackgroundJob, jobPaths, spawnDetachedJob, readJobPid, readJobCompletion, readJobLogTail } from "@jarvis/core";
import { PersonalAssistantService } from "./personalAssistant.js";
import { createBuiltInPersonalSources, createPersonalSourceFactory } from "./personalSources.js";
import { createPersonalProactiveScheduler } from "./personalProactiveIntegration.js";
import { preparePersonalTurnContext, type PreparedPersonalTurnContext } from "./personalTurnContext.js";
import { PersonalSessionBindings, type PersonalSessionGeneration } from "./personalSessionBindings.js";
import { PendingAskStore } from "./pendingAsks.js";
import { ExecutionOwnershipStore } from "./executionOwnership.js";
import { PendingRequestRegistry, SessionDispatchReservations, remoteErrorRoute, type PendingRequest, type SessionDispatchLease } from "./sessionIsolation.js";

const WEB = fileURLToPath(new URL("../web", import.meta.url));
const PORT = Number(process.env.JARVIS_PORT || 4577);
const CWD = process.env.JARVIS_CWD || process.cwd();
// Manual permission mode (Fase 3): mint a per-process secret and publish the internal approval
// endpoint via env, so the Claude adapter's stdio MCP bridge (spawned in THIS process) can call back
// to ask the user before each tool. Loopback + this token guard the route (see /internal/perm).
const PERM_TOKEN = randomBytes(24).toString("hex");
process.env.JARVIS_PERM_TOKEN = PERM_TOKEN;
process.env.JARVIS_PERM_URL = `http://127.0.0.1:${PORT}/internal/perm`;
// Ponte de TAREFAS (C3): mesmo desenho da de permissão — token por processo + endpoint interno em
// loopback. É por aqui que jarvis_task_search/get/create de QUALQUER IA chega ao cofre de conexões.
/**
 * A LISTA da fonte do projeto, sem cliente esperando na outra ponta. As duas listagens que já existem
 * (`task_local_list`, `task_mcp_list`) nasceram servindo a TELA: elas respondem para o socket que
 * perguntou. A ponte é a IA, não a tela — daí esta versão que devolve promessa.
 *
 * Quem varre continua sendo a máquina do projeto, sempre. É o mesmo invariante da fatia C.
 */
const pendingTaskListing = new Map<string, { timer: NodeJS.Timeout; settle: (r: TaskListingResult) => void }>();
type TaskListingResult = { files: Array<{ key: string; title: string; description?: string }>; dir: string } | { error: string };
const TASK_LISTING_TIMEOUT_MS = 25_000;
async function askProjectTasks(runnerId: string, sessionId: string, source: any): Promise<TaskListingResult> {
  const cwd = sessionProjectDir(runnerId, sessionId);
  if (runnerId === LOCAL_ID) {
    try {
      if (source.kind === "mcp") {
        const listing = await listTasksFromMcp({ wanted: source.mcpServer });
        return "error" in listing ? { error: listing.error } : { files: listing.files, dir: listing.label };
      }
      const { rel, root } = resolveFeaturesRoot(cwd, source.featuresDir);
      const listing = localTaskCache.list(`${LOCAL_ID}\u0000${root}`, root,
        (content, relPath) => { const parsed = parseFeatureTask(content, relPath); return { key: parsed.task.key, title: parsed.title, description: parsed.description }; },
        localTaskFs, { relPrefix: rel });
      return { files: listing.files, dir: rel };
    } catch (e: any) { return { error: String(e?.message ?? e).slice(0, 400) }; }
  }
  const rc = runners.get(runnerId);
  if (!rc?.ws) return { error: "a máquina do projeto está offline — a lista de tarefas vive nela" };
  if ((rc.info.protocolVersion || 1) < RUNNER_CAPABILITY_SINCE.mcpTaskList) return { error: "esta máquina está desatualizada e não sabe listar as tarefas dela — atualize-a" };
  const reqId = "tl-" + randomUUID();
  return new Promise<TaskListingResult>((done) => {
    const settle = (r: TaskListingResult): void => { const p = pendingTaskListing.get(reqId); if (!p) return; clearTimeout(p.timer); pendingTaskListing.delete(reqId); done(r); };
    const timer = setTimeout(() => settle({ error: "a máquina do projeto não respondeu a tempo" }), TASK_LISTING_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    pendingTaskListing.set(reqId, { timer, settle });
    const frame = source.kind === "mcp"
      ? { t: "task_mcp_list", reqId, sessionId, server: source.mcpServer }
      : { t: "task_local_list", reqId, sessionId, featuresDir: source.featuresDir };
    if (!sendToRunner(rc, frame)) settle({ error: "não consegui falar com a máquina do projeto" });
  });
}

/**
 * Criar tarefa NA FONTE da máquina do projeto (pasta ou MCP). Espelha `askProjectTasks`: quem escreve
 * é a máquina, e o Hub só manda a intenção — já aprovada pelo dono, porque este caminho passa pelo
 * mesmo portão da escrita em provedor.
 */
const pendingTaskWrite = new Map<string, { timer: NodeJS.Timeout; settle: (r: { ok: true; key: string; url?: string } | { ok: false; error: string }) => void }>();
const TASK_WRITE_TIMEOUT_MS = 30_000;
async function writeProjectTask(runnerId: string, sessionId: string, source: any, task: { title: string; description?: string }): Promise<{ ok: true; key: string; url?: string } | { ok: false; error: string }> {
  const cwd = sessionProjectDir(runnerId, sessionId);
  if (runnerId === LOCAL_ID) {
    try {
      if (source.kind === "mcp") {
        const criado = await createTaskViaMcp({ wanted: source.mcpServer, title: task.title, description: task.description });
        return "error" in criado ? { ok: false, error: criado.error } : { ok: true, key: criado.key, url: criado.url };
      }
      const { root } = resolveFeaturesRoot(cwd, source.featuresDir);
      const nome = featureFileName(task.title);
      const destino = join(root, nome);
      if (existsSync(destino)) return { ok: false, error: `já existe um arquivo ${nome} nessa pasta` };
      mkdirSync(root, { recursive: true });
      writeFileSync(destino, featureFileContent(task.title, task.description), "utf8");
      return { ok: true, key: relative(cwd, destino).split(sep).join("/") };
    } catch (e: any) { return { ok: false, error: String(e?.message ?? e).slice(0, 400) }; }
  }
  const rc = runners.get(runnerId);
  if (!rc?.ws) return { ok: false, error: "a máquina do projeto está offline — é nela que a tarefa é criada" };
  if ((rc.info.protocolVersion || 1) < RUNNER_CAPABILITY_SINCE.taskSourceWrite) return { ok: false, error: "esta máquina ainda não sabe criar tarefa na fonte dela — atualize-a" };
  const reqId = "tw-" + randomUUID();
  return new Promise((done) => {
    const settle = (r: { ok: true; key: string; url?: string } | { ok: false; error: string }): void => {
      const pending = pendingTaskWrite.get(reqId); if (!pending) return;
      clearTimeout(pending.timer); pendingTaskWrite.delete(reqId); done(r);
    };
    const timer = setTimeout(() => settle({ ok: false, error: "a máquina do projeto não respondeu a tempo" }), TASK_WRITE_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    pendingTaskWrite.set(reqId, { timer, settle });
    const frame = source.kind === "mcp"
      ? { t: "task_mcp_create", reqId, server: source.mcpServer, title: task.title, description: task.description }
      : { t: "task_local_write", reqId, sessionId, featuresDir: source.featuresDir, title: task.title, description: task.description };
    if (!sendToRunner(rc, frame)) settle({ ok: false, error: "não consegui falar com a máquina do projeto" });
  });
}

/**
 * A ponte de tarefas, servida para QUALQUER máquina. Nasceu dentro do handler HTTP local e por isso
 * resolvia tudo como se a sessão fosse do Hub (`LOCAL_ID` implícito) — correto por acidente enquanto
 * a ponte só existia aqui. Com a ponte no runner (TSK-11), a máquina é parâmetro: é ela que decide
 * QUAL projeto, e portanto qual conta. Uma máquina só alcança as conexões dos projetos que estão
 * nela; o segredo nunca sai daqui, só o resultado.
 */
async function serveTaskBridge(ctx: { runnerId: string; sessionId: string; op: string; args: Record<string, unknown>; reply: (payload: unknown) => void }): Promise<void> {
  const { runnerId, sessionId, op, args, reply } = ctx;
      // A FONTE DECLARADA manda, e ela decide quem responde. Antes tudo passava pelo cofre: num projeto
      // cuja fonte é pasta ou MCP — que não têm conta POR DEFINIÇÃO — a IA recebia "escolha a conta",
      // instrução impossível de seguir, enquanto o painel listava as tarefas normalmente no mesmo
      // projeto. Duas respostas para a mesma pergunta é o defeito.
      const fonte = sessionTaskSource(runnerId, sessionId).source as any;
      if (fonte.kind === "local" || fonte.kind === "mcp") {
        try {
          if (op === "search" || op === "get") {
            const listagem = await askProjectTasks(runnerId, sessionId, fonte);
            if ("error" in listagem) { reply({ ok: false, code: "SOURCE_UNAVAILABLE", error: listagem.error }); return; }
            const tracker = fonte.kind === "mcp" ? "mcp" : "local";
            if (op === "get") {
              const chave = String(args.key || "");
              const achado = listagem.files.find((f) => f.key === chave);
              reply(achado ? { ok: true, connection: listagem.dir, task: { tracker, key: achado.key, title: achado.title, description: achado.description || "" } }
                : { ok: false, error: `não achei "${chave}" na fonte deste projeto (${listagem.dir})` });
              return;
            }
            const termo = String(args.query || "").trim().toLowerCase();
            const achados = (termo ? listagem.files.filter((f) => `${f.title} ${f.key}`.toLowerCase().includes(termo)) : listagem.files).slice(0, 10);
            reply({ ok: true, connection: listagem.dir, results: achados.map((f) => ({ tracker, key: f.key, title: f.title })) });
            return;
          }
          // CRIAR na fonte da máquina. Escrever arquivo no repositório de alguém é escrita, não
          // leitura: passa pelo MESMO portão do provedor — preview nominal e aprovação do dono, salvo
          // `autoApprove` declarado no projeto.
          const titulo = String(args.title || "").trim().slice(0, 300);
          const descricao = typeof args.description === "string" ? args.description.slice(0, 4000) : undefined;
          if (!titulo) { reply({ ok: false, error: "a tarefa precisa de título" }); return; }
          const ondeCria = fonte.kind === "mcp" ? `servidor MCP ${fonte.mcpServer || "desta máquina"}` : `pasta ${fonte.featuresDir}`;
          const maquina = runnerId === LOCAL_ID ? "esta máquina" : (runners.get(runnerId)?.info.label || runnerId);
          const preview = `Criar "${titulo}" em ${ondeCria} (${maquina})`;
          const executar = async (): Promise<void> => {
            const escrita = await writeProjectTask(runnerId, sessionId, fonte, { title: titulo, description: descricao });
            if (!escrita.ok) { reply({ ok: false, error: escrita.error }); return; }
            auth.audit("task_write", { runnerId, detail: `create(ia) ${fonte.kind} → ${escrita.key}` });
            broadcastOn(runnerId, sessionId, { t: "notice", message: `Tarefa criada pela IA: ${escrita.key} (${ondeCria})` });
            reply({ ok: true, key: escrita.key, url: escrita.url, connection: ondeCria });
          };
          const cwdProjeto = sessionProjectDir(runnerId, sessionId);
          const vinculo = cwdProjeto ? projectTasks.get(cwdProjeto) : undefined;
          if (vinculo?.autoApprove?.includes("create")) { await executar(); return; }
          const politica = resolveAdaptivePolicy(adaptivePolicyDoc, { cwd: cwdProjeto, sessionId });
          const aprovacao = createAdaptiveApprovalRequest({
            id: `task:create:${Date.now()}:${randomUUID().slice(0, 8)}`, action: "task_write",
            title: `🧭 ${preview}`, reason: descricao ? descricao.slice(0, 200) : "pedida pela IA da sessão",
            policy: politica.policy, sessionId, ttlMs: 30 * 60 * 1000,
          });
          const expira = setTimeout(() => { if (pendingAdaptiveApprovals.delete(aprovacao.id)) { broadcastAdaptiveApprovals(); reply({ ok: false, error: "aprovação expirou sem resposta" }); } }, 30 * 60 * 1000);
          (expira as { unref?: () => void }).unref?.();
          pendingAdaptiveApprovals.set(aprovacao.id, { approval: aprovacao, resolve: (aprovado) => { clearTimeout(expira); if (aprovado) void executar(); else reply({ ok: false, error: "você recusou a criação" }); } });
          broadcastAdaptiveApprovals();
          notifyEvent("machine", "Tarefa aguardando aprovação", preview, sessionId);
          return;
        } catch (e: any) { reply({ ok: false, error: String(e?.message ?? e) }); return; }
      }
      try {
        if (op === "search" || op === "get") {
          const { resolved } = resolveSessionTaskConnection(sessionId, false, runnerId);
          if ("refusal" in resolved) { reply({ ok: false, code: resolved.refusal.code, error: resolved.refusal.message }); return; }
          const t = providerSignal();
          try {
            if (op === "search") {
              const results = await searchProviderTasks(resolved.connection.provider, String(args.query || ""), { config: resolved.connection.config, secret: resolved.secret, secret2: resolved.secret2, signal: t.signal });
              reply({ ok: true, connection: resolved.connection.label, results: results.slice(0, 10) });
            } else {
              const item = await getProviderTask(resolved.connection.provider, String(args.key || ""), { config: resolved.connection.config, secret: resolved.secret, secret2: resolved.secret2, signal: t.signal });
              if (item) taskMeta.merge(item.tracker, item.key, { title: item.title, description: item.description, url: item.url });
              reply(item ? { ok: true, connection: resolved.connection.label, task: item } : { ok: false, error: "tarefa não encontrada" });
            }
          } finally { t.finish(); }
          return;
        }
        if (op === "create") {
          const { cwd, binding, resolved } = resolveSessionTaskConnection(sessionId, true, runnerId);
          if ("refusal" in resolved) { reply({ ok: false, code: resolved.refusal.code, error: resolved.refusal.message }); return; }
          const target = String(binding?.target || "");
          const title = String(args.title || "").trim().slice(0, 300);
          const description = typeof args.description === "string" ? args.description.slice(0, 4000) : undefined;
          if (!target) { reply({ ok: false, code: "NO_TARGET", error: "o vínculo do projeto não define o destino da escrita (repo/projeto/time)" }); return; }
          if (!title) { reply({ ok: false, error: "a tarefa precisa de título" }); return; }
          const remote = await gitRemoteOf(runnerId, cwd);
          const warning = remoteMismatchWarning(remote, resolved.connection);
          // Borda 4 (TSK-11): quando a checagem SE APLICA e o remote não pôde ser lido — git ausente na
          // máquina do projeto, máquina offline, timeout —, não dá para afirmar que a conta é a certa.
          // Ausência de prova não é prova de ausência, e auto-aprovar aqui seria exatamente o acidente
          // da conta errada que o aviso existe para impedir.
          const remoteIncerto = remoteCheckApplies(resolved.connection) && !remote;
          const who = resolved.connection.identity?.login || resolved.connection.label;
          const preview = `Criar "${title}" em ${resolved.connection.label} · ${target} como ${who}${warning ? ` — ⚠ ${warning}` : remoteIncerto ? " — ⚠ não consegui ler o remote do projeto nesta máquina" : ""}`;
          const execute = async (): Promise<void> => {
            const pt = providerSignal(15_000);
            try {
              const created = await createProviderTask(resolved.connection.provider, target, { title, description }, { config: resolved.connection.config, secret: resolved.secret, secret2: resolved.secret2, signal: pt.signal });
              taskMeta.merge(resolved.connection.provider, created.key, { title, description, url: created.url });
              auth.audit("task_write", { runnerId, detail: `create(ia) ${resolved.connection.id} → ${created.key}` });
              broadcastOn(runnerId, sessionId, { t: "notice", message: `Tarefa criada pela IA: ${created.key}${created.url ? ` — ${created.url}` : ""} (${resolved.connection.label})` });
              reply({ ok: true, key: created.key, url: created.url, connection: resolved.connection.label });
            } catch (e: any) { reply({ ok: false, error: String(e?.message ?? e) }); }
            finally { pt.finish(); }
          };
          // Divergência remote×conexão NUNCA é auto-aprovável — é o acidente da conta errada.
          if (binding?.autoApprove?.includes("create") && !warning && !remoteIncerto) { await execute(); return; }
          const resolvedPolicy = resolveAdaptivePolicy(adaptivePolicyDoc, { cwd, sessionId });
          const approval = createAdaptiveApprovalRequest({
            id: `task:create:${Date.now()}:${randomUUID().slice(0, 8)}`, action: "task_write",
            title: `🧭 ${preview}`, reason: description ? description.slice(0, 200) : "pedida pela IA da sessão",
            policy: resolvedPolicy.policy, sessionId, ttlMs: 30 * 60 * 1000,
          });
          const expire = setTimeout(() => { if (pendingAdaptiveApprovals.delete(approval.id)) { broadcastAdaptiveApprovals(); reply({ ok: false, error: "aprovação expirou sem decisão" }); } }, 30 * 60 * 1000);
          (expire as { unref?: () => void }).unref?.();
          pendingAdaptiveApprovals.set(approval.id, { approval, resolve: (approved) => { clearTimeout(expire); if (approved) void execute(); else reply({ ok: false, error: "criação recusada pelo dono" }); } });
          broadcastAdaptiveApprovals();
          notifyEvent("machine", "Tarefa aguardando aprovação", preview, sessionId);
          return;
        }
        reply({ ok: false, error: `operação desconhecida: ${op}` });
      } catch (e: any) { reply({ ok: false, error: String(e?.message ?? e) }); }
}
const TASK_BRIDGE_TOKEN = randomBytes(24).toString("hex");
process.env.JARVIS_TASK_TOKEN = TASK_BRIDGE_TOKEN;
process.env.JARVIS_TASK_URL = `http://127.0.0.1:${PORT}/internal/task`;
// A user must answer within this window; past it the request fails closed (deny) so a turn can never
// hang forever waiting on an absent human.
const PERM_TIMEOUT_MS = 5 * 60 * 1000;
interface PermissionDecision { behavior: "allow" | "deny"; updatedInput?: unknown; message?: string }
// `runnerId` is the machine the blocked turn runs on: LOCAL_ID for an in-process turn (the bridge is
// waiting on our own held HTTP response), or a remote runner (the answer travels back over its WS).
// It is also what the access check must be scoped to — a session id only means something per machine.
interface PendingPermission { sessionId: string; runnerId: string; timer: ReturnType<typeof setTimeout>; settle: (d: PermissionDecision) => void; }
// In-flight approval requests keyed by a random id; each holds the HTTP response open until the user
// decides (permission_decision ws message) or the timeout fires.
const pendingPermissions = new Map<string, PendingPermission>();
/** A machine that went offline can no longer receive the answer (and its own bridge is already being
 *  failed closed there), so settle its in-flight approvals as denies instead of leaking them until
 *  the timeout. Cheap linear scan: this map holds one entry per BLOCKED tool call, never more. */
function denyPendingPermissionsFor(runnerId: string): void {
  for (const [, p] of [...pendingPermissions]) {
    if (p.runnerId === runnerId) p.settle({ behavior: "deny", message: "Máquina desconectada — negado por segurança" });
  }
}
const CONTEXT_PMTILES_FILE = process.env.JARVIS_PMTILES_FILE ? normalize(process.env.JARVIS_PMTILES_FILE) : "";
const CONTEXT_MAP_STYLE_FILE = process.env.JARVIS_MAP_STYLE_FILE ? normalize(process.env.JARVIS_MAP_STYLE_FILE) : "";
const LOCAL_ID = "local";
// Voz falada: mutável em runtime (trocável pela UI, persistida em voice-cfg.json). A resolução do
// default fica logo após o carregamento do voiceCfg (precisa dele) — ver resolveDefaultVoice().
let VOICE = process.env.JARVIS_VOICE || "en_GB-alan-medium";
// cap how many messages we send/render on open — long sessions were heavy on mobile
const HISTORY_CAP = Number(process.env.JARVIS_HISTORY_CAP || 120);

// Agnostic registry — every agent is registered; clients pick per message.
const DEFAULT_AGENT = process.env.JARVIS_AGENT || "claude-code";
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
const WAKE_SESSION = process.env.JARVIS_WAKE_SESSION || "voice";
const store = new Store({ agent: agents.default, cwd: CWD });
const routines = new RoutineStore();
const memory = new MemoryStore();
// Semantic-memory GATE (cost/perf). Auto-indexing pays a LOCAL embedding after EVERY turn — wasted
// work if nobody ever searches by meaning. We only auto-index once semantic memory is actually IN
// USE: it already holds entries (durable across restarts via memory.json) or the user has run a
// semantic search / reindex this session. Until then indexSession/indexRunnerSession no-op, so the
// warm embedding daemon (embed.ts) never even starts for users who don't touch the feature. History
// stays reachable via the "Reindexar" action, which flips this on and backfills.
let semanticMemoryActive = memory.size() > 0;
function markSemanticMemoryUsed(): void { semanticMemoryActive = true; }
// When semantic memory flips ON via a search (not from existing data), backfill EXISTING local
// sessions once so the feature isn't empty on first use. Remote sessions + a full rebuild stay the
// explicit "Reindexar" action. Best-effort and self-healing: results populate within a few seconds.
let semanticBackfilled = false;
function backfillLocalSemanticIndex(): void {
  if (semanticBackfilled) return;
  semanticBackfilled = true;
  for (const s of store.list()) void indexSession(s.id);
}
const staging = new StagingStore();
// Live turn telemetry (latency + error rate per machine) for the fleet dashboard. In-memory rolling
// window — resets on restart (it's a "how are turns doing now" signal, not an audit trail).
const metrics = new Metrics();
// Start time of a remote runner's in-flight turn, keyed "runnerId\0sessionId", so relayRunner can
// measure its duration when the terminal stream event arrives.
const remoteTurnStart = new Map<string, number>();
const remoteSpeak = new Set<string>();
/** Best-effort: embed a session's digest and upsert it into semantic memory (no-op if the local
 *  embedding model isn't installed). Called after each managed turn via turnCtx.afterTurn. */
async function indexSession(sid: string): Promise<void> {
  if (!semanticMemoryActive) return;
  try {
    const s = store.get(sid);
    if (!s || !s.messages.length) return;
    const ownerGeneration = captureSessionOwnerGeneration(LOCAL_ID, sid);
    if (ownerGeneration.conflicted) return;
    const updatedAt = s.updatedAt;
    const lastUser = [...s.messages].reverse().find((m) => m.role === "user")?.text || "";
    const lastAsst = [...s.messages].reverse().find((m) => m.role === "assistant")?.text || "";
    const text = `${s.title}\n${lastUser}\n${lastAsst}`.slice(0, 2000);
    const vec = await embedOne(text);
    const current = store.get(sid);
    if (!current || current.updatedAt !== updatedAt || !sessionOwnerGenerationCurrent(ownerGeneration)) return;
    if (vec.length) memory.upsert({ id: s.id, sessionId: s.id, runnerId: LOCAL_ID, ownerId: ownerGeneration.principalId, agent: s.agent, cwd: s.cwd, title: s.title, text: text.slice(0, 400), ts: updatedAt, vec });
  } catch { /* embedding unavailable — memory is opt-in */ }
}
async function indexRunnerSession(rc: RunnerConn, sid: string): Promise<void> {
  if (!semanticMemoryActive) return;
  try {
    const ownerGeneration = captureSessionOwnerGeneration(rc.id, sid);
    if (ownerGeneration.conflicted) return;
    const h = await runnerHistory(rc, sid, { principalId: ownerGeneration.principalId, generation: ownerGeneration });
    const messages = Array.isArray(h?.messages) ? h.messages : [];
    if (!h || !messages.length) return;
    const lastUser = [...messages].reverse().find((m: any) => m?.role === "user")?.text || "";
    const lastAsst = [...messages].reverse().find((m: any) => m?.role === "assistant")?.text || "";
    const label = runnerLabels[rc.id] || rc.info.host || rc.id;
    const title = `${label} · ${h.title || sid}`;
    const text = `${title}\n${lastUser}\n${lastAsst}`.slice(0, 2000);
    const vec = await embedOne(text);
    if (!sessionOwnerGenerationCurrent(ownerGeneration)) return;
    if (vec.length) memory.upsert({ id: `runner:${rc.id}:${sid}`, sessionId: sid, runnerId: rc.id, ownerId: ownerGeneration.principalId, agent: h.agent, cwd: h.cwd, title, text: text.slice(0, 400), ts: Date.now(), vec, ...classifyMemoryText({ text, cwd: h.cwd }) });
  } catch { /* embedding unavailable — memory is opt-in */ }
}
// dedicated, locked-agent/cwd session that the machine wake listener injects into
store.ensure(WAKE_SESSION, { agent: process.env.JARVIS_WAKE_AGENT || agents.default, cwd: process.env.JARVIS_WAKE_CWD || CWD, title: "Voz (Jarvis)" });

// ---- Web Push: notify when a turn finishes (works on a locked Android). VAPID keys
// + subscriptions live locally; the push protocol relays via the browser's FCM/APNs
// (payload is encrypted). ----
const JARVIS_DIR = join(process.env.JARVIS_HOME || homedir(), ".jarvis");
const personalSessionBindings = new PersonalSessionBindings(join(JARVIS_DIR, "hub", "personal-session-bindings.json"));
const ADAPTIVE_POLICY_FILE = join(JARVIS_DIR, "policies.json");
let adaptivePolicyDoc: AdaptivePolicyDocument = loadAdaptivePolicyDocument(ADAPTIVE_POLICY_FILE);
// Durable defaults for a NEW session (agent/model/effort/permission), scoped global + per project.
const SESSION_DEFAULTS_FILE = join(JARVIS_DIR, "session-defaults.json");
let sessionDefaultsDoc: SessionDefaultsDocument = loadSessionDefaults(SESSION_DEFAULTS_FILE);
// Per-session permission mode for turn dispatch: the Store for managed sessions (durable +
// inheritable), an in-memory map for native imported sessions (which have no Store record).
const nativeSessionPermissionModes = new Map<string, PermissionMode>();
// Permission mode chosen in the client picker for a REMOTE session, keyed "runnerId\0sessionId".
// The owning runner keeps the durable copy in its own store; this just carries the choice to the
// next forwarded turn (there is no remote setmode round-trip).
const remoteSessionModes = new Map<string, PermissionMode>();
function sessionPermissionMode(sid: string): PermissionMode | undefined {
  return store.get(sid)?.permissionMode ?? nativeSessionPermissionModes.get(sid);
}
function setSessionPermissionMode(sid: string, mode: PermissionMode): void {
  if (!store.setPermissionMode(sid, mode)) nativeSessionPermissionModes.set(sid, mode);
}
/** Bounded, validated shape for the durable session-defaults config coming from the Settings UI:
 *  known fields only, agent names checked against the registry, permission modes normalized, arrays
 *  capped. Anything unrecognized is dropped rather than trusted. */
function sanitizeSessionDefaults(input: unknown): SessionDefaultsDocument {
  const one = (v: unknown): SessionDefaults => {
    const o = (v ?? {}) as Record<string, unknown>;
    const out: SessionDefaults = {};
    if (typeof o.agent === "string" && agents.names().includes(o.agent)) out.agent = o.agent;
    if (typeof o.model === "string" && o.model.length <= 160) out.model = o.model;
    if (typeof o.effort === "string" && o.effort.length <= 40) out.effort = o.effort;
    const pm = normalizePermissionMode(typeof o.permissionMode === "string" ? o.permissionMode : undefined);
    if (pm) out.permissionMode = pm;
    return out;
  };
  const raw = (input ?? {}) as Record<string, unknown>;
  const projects = Array.isArray(raw.projects)
    ? raw.projects
        .filter((p): p is Record<string, unknown> => !!p && typeof (p as Record<string, unknown>).projectRoot === "string" && ((p as Record<string, unknown>).projectRoot as string).length > 0 && ((p as Record<string, unknown>).projectRoot as string).length <= 400)
        .slice(0, 200)
        .map((p) => ({ projectRoot: p.projectRoot as string, ...one(p) }))
    : [];
  return { global: one(raw.global), projects };
}
const personalAssistant = new PersonalAssistantService({
  root: join(JARVIS_DIR, "personal"),
  sourceFactory: createPersonalSourceFactory(),
  allowPersonalContext: () => {
    try { return resolveAdaptivePolicy(adaptivePolicyDoc, {}).policy.memory.allowPersonalContext === true; }
    catch { return false; }
  },
});
for (const source of createBuiltInPersonalSources()) personalAssistant.registerSource(source);
const contextManifests = new ContextManifestStore(JARVIS_DIR);
const remoteContextManifests = new ContextManifestStore(JARVIS_DIR, "remote-context-manifests.jsonl");
const memoryProvenance = new MemoryProvenanceStore(JARVIS_DIR);
const nativeBindingCollisions = agents.nativeBindingCollisions();
if (nativeBindingCollisions.length) console.error("[hub] colisões de sessão nativa detectadas; turnos afetados serão bloqueados:", JSON.stringify(nativeBindingCollisions));
void agents.describe().catch((e) => console.warn("[hub] catálogo de IAs não aqueceu em background:", String(e?.message ?? e)));
const LOCAL_EXECUTION_DIR = join(JARVIS_DIR, "executions");
const MIRROR_EXECUTION_DIR = join(JARVIS_DIR, "hub", "executions");
const EXECUTION_UI_FILE = join(JARVIS_DIR, "hub", "execution-ui.json");
const EXECUTION_CFG_FILE = join(JARVIS_DIR, "execution-config.json");
const executionOwnership = new ExecutionOwnershipStore(join(JARVIS_DIR, "hub", "execution-ownership.json"));
/** Rows written before ownership moved from the device login to the person (auth.identityOf) still
 *  name a single device. Left alone they would keep doing what this change removes — hiding the
 *  owner's own session from their other machine — and would answer "belongs to another user" the
 *  next time either device touched it. Runs once at boot; a second boot finds nothing to do. */
function normalizeOwnershipIdentities(): void {
  // With JARVIS_AUTH=off there is a single user and identityOf() answers "owner" for ANY id — rewriting
  // the store in that mode would flatten a member's rows written while auth was on, and turning auth
  // back on would not restore them. Comparisons still normalize on the fly, so skipping costs nothing.
  if (!auth.AUTH_ENABLED) return;
  const resolve = (principalId: string): string => auth.identityOf(principalId);
  try {
    const sessions = personalSessionBindings.normalizePrincipals(resolve);
    const executions = executionOwnership.normalizePrincipals(resolve);
    const memories = memory.normalizeOwners(resolve);
    if (sessions || executions || memories) console.log(`[auth] identidade unificada — sessões: ${sessions}, execuções: ${executions}, memórias: ${memories}`);
  } catch (error) {
    // Never fatal: every gate compares identities on the fly, so a failed rewrite costs a retry next
    // boot, not access. It is logged loudly because it means the store could not be written.
    console.warn("[auth] falha ao normalizar identidades (mantendo os registros antigos):", String((error as Error)?.message || error));
  }
}
normalizeOwnershipIdentities();
function saveAdaptivePolicy(): void { saveAdaptivePolicyDocument(ADAPTIVE_POLICY_FILE, adaptivePolicyDoc); }
interface AdaptiveDecisionLogEvent { ts: number; kind: string; action: string; reason: string; sessionId?: string; detail?: string; policyId?: string; }
const ADAPTIVE_DECISIONS_FILE = join(JARVIS_DIR, "adaptive-decisions.json");
let adaptiveDecisionLog: AdaptiveDecisionLogEvent[] = (() => {
  try { return JSON.parse(readFileSync(ADAPTIVE_DECISIONS_FILE, "utf8")).filter((e: any) => e && typeof e.ts === "number").slice(-500); } catch { return []; }
})();
function recordAdaptiveDecision(event: Omit<AdaptiveDecisionLogEvent, "ts">): void {
  adaptiveDecisionLog.push({ ts: Date.now(), ...event });
  if (adaptiveDecisionLog.length > 500) adaptiveDecisionLog = adaptiveDecisionLog.slice(-500);
  try { writeJsonAtomic(ADAPTIVE_DECISIONS_FILE, adaptiveDecisionLog, { pretty: true }); } catch { /* ignore */ }
}
function effectivePolicyFor(sessionId?: string): ReturnType<typeof resolveAdaptivePolicy> {
  const cwd = sessionId ? sessionCwd(sessionId) : undefined;
  return resolveAdaptivePolicy(adaptivePolicyDoc, { sessionId, cwd });
}
function adaptivePolicyPayload(sessionId?: string, saved = false): unknown {
  const effective = effectivePolicyFor(sessionId);
  return { t: "adaptive_policy", doc: adaptivePolicyDoc, effective: { ...effective, explanation: explainAdaptivePolicy(effective) }, sessionId, saved };
}
/** `routineId` roda uma rotina ao aprovar; `resolve` generaliza para qualquer operação que espera o
 *  dono (ex.: escrita em provedor de tarefas) — exatamente UM dos dois está presente. */
interface PendingAdaptiveApproval { approval: AdaptiveApprovalRequest; routineId?: string; resolve?: (approved: boolean) => void; }
const pendingAdaptiveApprovals = new Map<string, PendingAdaptiveApproval>();
function adaptiveApprovalList(): AdaptiveApprovalRequest[] {
  const now = Date.now();
  for (const [id, item] of pendingAdaptiveApprovals) {
    if (item.approval.expiresAt && item.approval.expiresAt <= now) pendingAdaptiveApprovals.delete(id);
  }
  return [...pendingAdaptiveApprovals.values()].map((item) => item.approval).sort((a, b) => a.createdAt - b.createdAt);
}
function broadcastAdaptiveApprovals(): void { broadcastAll({ t: "adaptive_approvals", approvals: adaptiveApprovalList() }); }
function queueRoutineApproval(r: Routine, reason: string): void {
  const sid = "routine-" + r.id;
  const existing = [...pendingAdaptiveApprovals.values()].find((item) => item.routineId === r.id);
  if (existing) { broadcastAdaptiveApprovals(); return; }
  const resolved = resolveAdaptivePolicy(adaptivePolicyDoc, { cwd: r.cwd || CWD, sessionId: sid });
  const approval = createAdaptiveApprovalRequest({
    id: `routine:${r.id}:${Date.now()}`,
    action: "routine_background",
    title: "⏰ " + r.name,
    reason,
    policy: resolved.policy,
    sessionId: sid,
    ttlMs: 12 * 60 * 60 * 1000,
  });
  pendingAdaptiveApprovals.set(approval.id, { approval, routineId: r.id });
  recordAdaptiveDecision({ kind: "routine", action: "ask", reason, sessionId: sid, detail: r.name, policyId: approval.policyId });
  notifyEvent("machine", "Rotina aguardando aprovação", `${r.name}: ${reason}`, sid);
  broadcastAdaptiveApprovals();
}
function completeAdaptiveApproval(id: string, action: "approve" | "reject", audit?: { userId?: string; deviceId?: string }): AdaptiveApprovalRequest | undefined {
  const pending = pendingAdaptiveApprovals.get(id);
  if (!pending) return undefined;
  pendingAdaptiveApprovals.delete(id);
  if (action === "approve") {
    if (pending.resolve) pending.resolve(true);
    else if (pending.routineId) { const routine = routines.get(pending.routineId); if (routine) void runRoutine(routine, true); }
    auth.audit("adaptive_approval", { ...audit, detail: `${pending.approval.id}: approved` });
  } else {
    pending.resolve?.(false);
    notifyEvent("machine", "Aprovação recusada", pending.approval.title, pending.approval.sessionId);
    auth.audit("adaptive_approval", { ...audit, detail: `${pending.approval.id}: rejected` });
  }
  recordAdaptiveDecision({ kind: "approval", action: action === "approve" ? "approved" : "rejected", reason: "owner_action", sessionId: pending.approval.sessionId, detail: pending.approval.title, policyId: pending.approval.policyId });
  broadcastAdaptiveApprovals();
  return pending.approval;
}
// (adaptiveApprovalVoiceCommand agora vive em @jarvis/core/adaptive-policy, com testes: a versão
// local aceitava a MESMA palavra como verbo e objeto, então qualquer texto citando "pendência" era
// consumido como comando e a mensagem do usuário sumia.)
interface ExecutionRuntimeConfig { enabled: boolean; retentionDays: number; maxEvents: number; maxConcurrency: number; maxDepth: number; defaultWrite: boolean; worktreeRoot: string; }
const executionCfg: ExecutionRuntimeConfig = (() => {
  const defaults: ExecutionRuntimeConfig = {
    enabled: process.env.JARVIS_EXECUTIONS !== "0",
    retentionDays: Math.max(1, Number(process.env.JARVIS_EXECUTION_RETENTION_DAYS || 30)),
    maxEvents: Math.max(100, Number(process.env.JARVIS_EXECUTION_MAX_EVENTS || 5_000)),
    maxConcurrency: Math.max(1, Number(process.env.JARVIS_EXECUTION_MAX_CONCURRENCY || 6)),
    maxDepth: Math.max(1, Number(process.env.JARVIS_EXECUTION_MAX_DEPTH || 3)),
    defaultWrite: process.env.JARVIS_EXECUTION_DEFAULT_WRITE === "1",
    worktreeRoot: process.env.JARVIS_EXECUTION_WORKTREE_ROOT || join(JARVIS_DIR, "worktrees"),
  };
  let raw: any = {}; try { raw = JSON.parse(readFileSync(EXECUTION_CFG_FILE, "utf8")); } catch { /* defaults */ }
  const value = { ...defaults, ...(raw && typeof raw === "object" ? raw : {}) };
  return { enabled: value.enabled !== false, retentionDays: Math.max(1, Math.min(3650, Number(value.retentionDays) || defaults.retentionDays)),
    maxEvents: Math.max(100, Math.min(100_000, Number(value.maxEvents) || defaults.maxEvents)),
    maxConcurrency: Math.max(1, Math.min(32, Number(value.maxConcurrency) || defaults.maxConcurrency)),
    maxDepth: Math.max(1, Math.min(10, Number(value.maxDepth) || defaults.maxDepth)), defaultWrite: value.defaultWrite === true,
    worktreeRoot: typeof value.worktreeRoot === "string" && value.worktreeRoot.trim() ? value.worktreeRoot : defaults.worktreeRoot };
})();
function saveExecutionCfg(): void { try { writeJsonAtomic(EXECUTION_CFG_FILE, executionCfg, { pretty: true }); } catch { /* ignore */ } }
const localExecutionStore = new ExecutionStore({ root: LOCAL_EXECUTION_DIR, maxEventsPerRoot: executionCfg.maxEvents });
// Durable store of Hub-owned background jobs (long tasks that outlive the one-shot agent turn and
// auto-continue the session when they finish). Same dir as sessions.json (~/.jarvis/hub).
const backgroundJobs = new BackgroundJobStore({ dir: join(JARVIS_DIR, "hub") });
// Acompanhamento de fluxos: o estado é do Hub para valer em qualquer máquina (decisão da descoberta).
const workflowRuns = new WorkflowRunStore({ dir: join(JARVIS_DIR, "hub") });
// Fluxo por tarefa (F1): memória POR PASTA de qual fonte de tarefas cada projeto usa e cache leve de
// título/descrição/link/resumo por tarefa — a UI mostra a tarefa sem depender de rede.
const projectTasks = new ProjectTaskBindingStore({ dir: join(JARVIS_DIR, "hub") });
// Varredura de features fica em cache, invalidada por assinatura de pasta (nome+mtime+tamanho).
// O adaptador existe para o teste do core poder injetar um fs que CONTA leituras.
const localTaskCache = new LocalTaskCache();
const localTaskFs = {
  existsSync,
  readdirSync: (dir: string) => readdirSync(dir),
  statSync: (path: string) => { const stat = statSync(path); return { mtimeMs: stat.mtimeMs, size: stat.size }; },
  readFileSync: (path: string) => readFileSync(path, "utf8"),
};
const taskMeta = new TaskMetaStore({ dir: join(JARVIS_DIR, "hub") });
// Cofre de conexões (C1): contas por provedor com identidade VERIFICADA; segredo só por secretRef.
const taskConnections = new TaskConnectionStore({ dir: join(JARVIS_DIR, "hub") });
// Cofre de SEGREDOS: cola o token na configuração e o Hub injeta no próprio env — sem caçar .env.
// Ambiente explícito vence o cofre; a carga acontece AGORA, antes de qualquer uso de conexão.
const secretVault = new SecretVault({ dir: join(JARVIS_DIR, "hub") });
/** Nomes cujo valor NO ENV veio do cofre — é o que separa "cofre" de "ambiente externo vence". */
const vaultEnvOwned = new Set<string>();
{
  const seeded = secretVault.loadIntoEnv(process.env);
  for (const name of seeded.loaded) vaultEnvOwned.add(name);
  if (seeded.loaded.length || seeded.skipped.length) console.log(`[hub] cofre de segredos: ${seeded.loaded.length} injetado(s) no ambiente${seeded.skipped.length ? `; ${seeded.skipped.length} definido(s) fora (ambiente vence)` : ""}`);
}
/** De onde o segredo desta env var vem HOJE: cofre, ambiente externo, ou de lugar nenhum. */
function secretSourceOf(name: string | undefined): "cofre" | "ambiente" | "ausente" {
  if (!name) return "ausente";
  if (process.env[name]) return vaultEnvOwned.has(name) ? "cofre" : "ambiente";
  return secretVault.has(name) ? "cofre" : "ausente";
}
/** Conexões para a UI: presença e ORIGEM do segredo (cofre/ambiente/ausente) — NUNCA o valor. */
/**
 * Tudo que está LIGADO em tarefas, num frame só (F): conexões com estado de verificação, o vínculo
 * de cada projeto e os servidores MCP por máquina.
 *
 * O recorte do que pode sair vive no core (`publicTaskConnections`): valor de segredo nunca sai, e
 * config que por acidente contenha um segredo é redigido — "config é não-sensível" é promessa de
 * quem preencheu o formulário, não garantia.
 */
function taskConnectionsFrame(): Record<string, unknown> {
  return {
    t: "task_connections",
    connections: publicTaskConnections(taskConnections.list(), process.env).map((c) => ({
      ...c,
      secretSource: secretSourceOf(c.secretRef),
      secretSource2: c.secretRef2 ? secretSourceOf(c.secretRef2) : undefined,
    })),
    providers: TASK_PROVIDERS,
    // Vínculos: qual projeto usa qual fonte. É a resposta para "o que está ligado onde" sem abrir
    // uma sessão em cada pasta.
    bindings: projectTasks.list(),
    // Servidores MCP por máquina — só nomes. A máquina local é este Hub; as demais reportam no
    // registro (runner antigo não manda, e a tela mostra "—" em vez de mentir "nenhum").
    mcpMachines: [
      (() => { const local = loadTaskMcpConfig(); return { runnerId: LOCAL_ID, label: runnerLabels[LOCAL_ID] || runners.get(LOCAL_ID)?.info.host || "Servidor", servers: Object.keys(local.servers), configFile: taskMcpConfigFile(), known: true, editable: true, online: true,
        uses: Object.fromEntries(Object.keys(local.servers).map((n) => [n, { list: true, create: !!local.creates[n] }])) }; })(),
      ...[...runners.values()].map((rc) => ({
        runnerId: rc.id,
        label: rc.info.label || rc.info.host || rc.id,
        servers: Array.isArray(rc.info.taskMcpServers) ? rc.info.taskMcpServers : [],
        // O caminho vem DA MÁQUINA. Enquanto vinha daqui, uma Luby Linux exibia o caminho do Windows
        // do Hub como se fosse o dela — mesma família de engano da fatia C.
        configFile: rc.info.taskMcpConfigFile || "",
        known: Array.isArray(rc.info.taskMcpServers),
        // Editável = protocolo novo E chave ligada lá. Formulário que não vai gravar é pior que
        // formulário nenhum: ele promete e falha depois de você digitar tudo.
        editable: (rc.info.protocolVersion || 1) >= RUNNER_CAPABILITY_SINCE.taskMcpConfig && rc.info.taskMcpRemoteEdit !== false,
        // Usos declarados por servidor (v2): "listar" e "criar" são capacidades diferentes, e um
        // servidor que só lista precisa dizer isso onde alguém vai pedir para criar.
        uses: rc.info.taskMcpUses || {},
        online: !!rc.ws,
      })),
    ],
  };
}
/** F: a mudança feita numa tela precisa aparecer nas outras (celular e desktop abertos ao mesmo
 *  tempo é o caso normal aqui) — sem reload, que é o critério da fatia. Só para o DONO: o frame
 *  lista contas, projetos e máquinas, que não são assunto de membro convidado. */
function broadcastTaskConnections(): void {
  const frame = taskConnectionsFrame();
  const payload = JSON.stringify(frame);
  for (const c of wss.clients) {
    const w = c as WebSocket;
    if (w.readyState === w.OPEN && !runnerSockets.has(w) && principalOf(w)?.role === "owner") w.send(payload);
  }
}
/** Remote do repositório do projeto (best-effort, 1.5s): alimenta o aviso remote×conexão. */
function gitRemoteUrl(cwd: string): Promise<string | undefined> {
  return new Promise((done) => {
    try { execFile("git", ["-C", cwd, "remote", "get-url", "origin"], { timeout: 1_500, windowsHide: true }, (err, stdout) => done(err ? undefined : String(stdout || "").trim() || undefined)); }
    catch { done(undefined); }
  });
}
/**
 * O `git remote` do projeto vive no disco da MÁQUINA dele. Calcular sempre aqui devolvia o remote de
 * outro repositório — ou nenhum — para sessão remota, e é justamente esse valor que impede criar
 * tarefa na conta errada (`remoteMismatchWarning`). Máquina que não responde devolve `undefined`, e
 * quem chama trata ausência como "não posso afirmar" — nunca como "está tudo certo".
 */
const pendingGitRemote = new Map<string, { timer: NodeJS.Timeout; settle: (url?: string) => void }>();
const GIT_REMOTE_TIMEOUT_MS = 4_000;
function gitRemoteOf(runnerId: string, cwd: string): Promise<string | undefined> {
  if (!cwd) return Promise.resolve(undefined);
  if (runnerId === LOCAL_ID) return gitRemoteUrl(cwd);
  const rc = runners.get(runnerId);
  if (!rc?.ws) return Promise.resolve(undefined);
  const reqId = "gr-" + randomUUID();
  return new Promise((done) => {
    const settle = (url?: string): void => { const p = pendingGitRemote.get(reqId); if (!p) return; clearTimeout(p.timer); pendingGitRemote.delete(reqId); done(url); };
    const timer = setTimeout(() => settle(undefined), GIT_REMOTE_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    pendingGitRemote.set(reqId, { timer, settle });
    if (!sendToRunner(rc, { t: "git_remote", reqId, cwd })) settle(undefined);
  });
}
/** Timeout duro para chamadas de provedor: uma API pendurada não pode prender um handler do Hub. */
function providerSignal(ms = 10_000): { signal: AbortSignal; finish: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  (timer as { unref?: () => void }).unref?.();
  return { signal: ctrl.signal, finish: () => clearTimeout(timer) };
}
/** A pasta do projeto de uma sessão NA MÁQUINA onde ela roda. "" quando ainda não se sabe — e "" NUNCA
 *  vira o cwd do Hub: um vínculo (ou uma lista) resolvido no projeto errado é resposta plausível e
 *  falsa, o mesmo engano que a fatia C tirou da listagem de tarefas locais. */
function sessionProjectDir(runnerId: string, sessionId: string): string {
  if (runnerId === LOCAL_ID) return store.get(sessionId)?.cwd || CWD;
  return sessionCwdOn(runnerId, sessionId);
}
/** Fonte ÚNICA declarada pelo projeto desta sessão (D): pasta local, provedor, ou nada declarado. */
function sessionTaskSource(runnerId: string, sessionId: string) {
  const cwd = sessionProjectDir(runnerId, sessionId);
  const binding = cwd ? projectTasks.get(cwd) : undefined;
  return { cwd, binding, source: resolveTaskSource({ projectDir: cwd, binding: binding || null, connections: taskConnections.list() }) };
}
/**
 * Planos de fan-out aguardando confirmação (fatia I). Vive em memória de propósito: um plano não
 * confirmado não é estado do produto, e sobreviver a um restart faria o Hub abrir sessões a partir de
 * uma lista que o usuário não tem mais na tela. Guardar o plano (em vez de reaproveitar a lista que o
 * cliente reenviaria) é o que impede trocar as tarefas entre confirmar e abrir.
 */
const FANOUT_PLAN_TTL_MS = 10 * 60_000;
const fanoutPlans = new Map<string, { sessionId: string; runnerId: string; res: FanoutResolution; at: number }>();
function pruneFanoutPlans(): void {
  const cutoff = Date.now() - FANOUT_PLAN_TTL_MS;
  for (const [id, plan] of fanoutPlans) if (plan.at < cutoff) fanoutPlans.delete(id);
  // Teto duro: um cliente em loop não pode transformar o cache de confirmação em vazamento.
  if (fanoutPlans.size > 200) for (const id of [...fanoutPlans.keys()].slice(0, fanoutPlans.size - 200)) fanoutPlans.delete(id);
}
/** Resolução da regra de ouro para UMA sessão: cwd → vínculo → conexão (nunca conta padrão).
 *  `runnerId` é a máquina onde a sessão roda: sem ele, uma sessão remota resolveria o vínculo pela
 *  pasta do HUB e poderia escrever no board de outro projeto. */
function resolveSessionTaskConnection(sessionId: string, requireVerified: boolean, runnerId: string = LOCAL_ID) {
  const cwd = sessionProjectDir(runnerId, sessionId);
  const binding = cwd ? projectTasks.get(cwd) : undefined;
  const resolved = resolveTaskConnection({ binding: binding || null, store: taskConnections, env: process.env, requireVerified });
  return { cwd, binding, resolved };
}
const compactedExecutions = localExecutionStore.compactBefore(Date.now() - executionCfg.retentionDays * 86_400_000);
if (compactedExecutions.roots) console.log(`[hub] retenção de trabalhos: ${compactedExecutions.roots} diário(s) compactado(s), ${compactedExecutions.droppedEvents} evento(s) detalhado(s) removido(s)`);
for (const snapshot of localExecutionStore.rootsForSession()) for (const node of snapshot.nodes) {
  if (node.state !== "queued" && node.state !== "running" && node.state !== "waiting_input") continue;
  try {
    localExecutionStore.append(node.rootExecutionId, node.executionId, { kind: "state_changed", from: node.state, to: "orphaned", reason: "Hub reiniciou sem binding verificável para este processo" });
    localExecutionStore.append(node.rootExecutionId, node.executionId, { kind: "diagnostic", level: "warning", code: "PROCESS_BINDING_LOST", message: "Estado preservado como órfão; nenhum terminal foi inferido" });
  } catch { /* a corrupt root remains visible through the last valid projection */ }
}
const executionMirrors = new Map<string, ExecutionStore>();
const executionUiState: { archives: Record<string, number>; commands: Record<string, any> } = (() => {
  try { const value = JSON.parse(readFileSync(EXECUTION_UI_FILE, "utf8")); return { archives: value?.archives || {}, commands: value?.commands || {} }; }
  catch { return { archives: {}, commands: {} }; }
})();
function saveExecutionUiState(): void {
  const keys = Object.keys(executionUiState.commands); if (keys.length > 2_000) for (const key of keys.slice(0, keys.length - 2_000)) delete executionUiState.commands[key];
  try { writeJsonAtomic(EXECUTION_UI_FILE, executionUiState, { pretty: true }); } catch { /* UI metadata is best-effort; journals remain authoritative */ }
}
function mirrorExecutionStore(runnerId: string): ExecutionStore {
  let value = executionMirrors.get(runnerId); if (value) return value;
  const key = createHash("sha256").update(runnerId).digest("hex");
  value = new ExecutionStore({ root: join(MIRROR_EXECUTION_DIR, key), maxEventsPerRoot: executionCfg.maxEvents }); executionMirrors.set(runnerId, value); return value;
}

// Summary/digest one-shot config — cheap by default (it's a light task), user-tunable in Settings.
const SUMMARY_FILE = join(JARVIS_DIR, "summary.json");
const summaryCfg: { agent: string; model: string; effort: string } = (() => {
  const d = { agent: process.env.JARVIS_SEARCH_AGENT || "claude-code", model: process.env.JARVIS_SUMMARY_MODEL || process.env.JARVIS_SEARCH_MODEL || "haiku", effort: "low" };
  try { mkdirSync(JARVIS_DIR, { recursive: true }); return { ...d, ...JSON.parse(readFileSync(SUMMARY_FILE, "utf8")) }; } catch { return d; }
})();
function saveSummaryCfg(): void { try { writeJsonAtomic(SUMMARY_FILE, summaryCfg, { pretty: true }); } catch { /* ignore */ } }
// Voz ambiente (staging): política de escalada de modelo + modelos rápido/upgrade. Persistido.
// escalate: "ask" (avisa e pede autorização por voz) | "auto" (sobe sozinho) | "<modelId>" (sobe pra esse).
const VOICE_CFG_FILE = join(JARVIS_DIR, "voice-cfg.json");
const voiceCfg: { agent: string; model?: string; effort?: string; escalate: string; fastModel: string; fastEffort: string; upgradeModel: string; upgradeEffort: string; relevance: string; gate?: boolean; threshold?: number; voice?: string } = (() => {
  // relevance: "on" (padrão — filtra falas que não são comando/relacionadas antes de despachar) | "off".
  const d = { agent: process.env.JARVIS_WAKE_AGENT || DEFAULT_AGENT, model: process.env.JARVIS_WAKE_MODEL || undefined, effort: process.env.JARVIS_WAKE_EFFORT || undefined, escalate: "ask", fastModel: process.env.JARVIS_VOICE_FAST_MODEL || "haiku", fastEffort: "low", upgradeModel: process.env.JARVIS_VOICE_UPGRADE_MODEL || "opus", upgradeEffort: "high", relevance: (process.env.JARVIS_VOICE_RELEVANCE || "on") };
  try { mkdirSync(JARVIS_DIR, { recursive: true }); return { ...d, ...JSON.parse(readFileSync(VOICE_CFG_FILE, "utf8")) }; } catch { return d; }
})();
function saveVoiceCfg(): void { try { writeJsonAtomic(VOICE_CFG_FILE, voiceCfg, { pretty: true }); } catch { /* ignore */ } }
// Resolve o timbre falado agora que o voiceCfg carregou. Preferência: escolha explícita salva (UI) >
// env JARVIS_VOICE > pt_BR (público padrão pt-BR — evita voz inglesa lendo português, Gap 4) >
// primeira voz pt > default/1ª disponível. Só ajusta se a resolução encontrar um modelo instalado.
(function resolveDefaultVoice() {
  if (voiceCfg.voice && hasVoice(voiceCfg.voice)) { VOICE = voiceCfg.voice; return; }
  if (process.env.JARVIS_VOICE && hasVoice(process.env.JARVIS_VOICE)) { VOICE = process.env.JARVIS_VOICE; return; }
  if (hasVoice("pt_BR-faber-medium")) { VOICE = "pt_BR-faber-medium"; return; }
  const all = listVoices();
  const pt = all.find((v) => v.toLowerCase().startsWith("pt"));
  if (pt) { VOICE = pt; return; }
  if (hasVoice(VOICE)) return;             // o default embutido existe → mantém
  if (all.length) VOICE = all[0];          // último recurso: qualquer voz instalada
})();
// Framework Jarvis — the canonical universal commands/skills/instructions live at frameworkRoot()
// (~/.jarvis/framework) on this Hub machine. `preference` decides how a native-vs-universal "/name"
// homonym resolves; `version` is the monotonic publish counter carried to every machine.
const FRAMEWORK_CFG_FILE = join(JARVIS_DIR, "framework-config.json");
const frameworkCfg: { preference: FrameworkPreference; version: number; autoStartFlows: boolean; applyInstructions: boolean } = (() => {
  // `autoStartFlows` é a chave de desligar do DONO da máquina: o fluxo declara `autoStart` no pacote,
  // mas quem sofre com um pacote de terceiro afobado é quem está na frente do chat. Liga por padrão —
  // um fluxo que se declarou padrão pediu para valer; quem não quiser, desliga em um clique.
  try { const raw = JSON.parse(readFileSync(FRAMEWORK_CFG_FILE, "utf8")); return { preference: normalizeFrameworkPreference(raw?.preference), version: Math.max(0, Number(raw?.version) || 0), autoStartFlows: raw?.autoStartFlows !== false, applyInstructions: raw?.applyInstructions !== false }; }
  catch { return { preference: "ask" as FrameworkPreference, version: 0, autoStartFlows: true, applyInstructions: true }; }
})();
function saveFrameworkCfg(): void { try { writeJsonAtomic(FRAMEWORK_CFG_FILE, frameworkCfg, { pretty: true }); } catch { /* ignore */ } }
const frameworkProvenance = new FrameworkProvenanceStore(JARVIS_DIR);
const frameworkSources = new FrameworkSourceStore(JARVIS_DIR);
// Credit/limit fallback — when the primary AI runs out of quota, retry the turn on a configured
// secondary AI and remember the primary is exhausted (until next local midnight, or a manual clear)
// so subsequent turns skip straight to the secondary instead of paying a failing round-trip each time.
const agentAvailability = new AgentAvailabilityStore(JARVIS_DIR);
const FALLBACK_CFG_FILE = join(JARVIS_DIR, "fallback-config.json");
const fallbackCfg: { enabled: boolean; agent: string; model: string; effort: string } = (() => {
  try { const raw = JSON.parse(readFileSync(FALLBACK_CFG_FILE, "utf8")); return { enabled: !!raw?.enabled, agent: String(raw?.agent || ""), model: String(raw?.model || ""), effort: String(raw?.effort || "") }; }
  catch { return { enabled: false, agent: "", model: "", effort: "" }; }
})();
function saveFallbackCfg(): void { try { writeJsonAtomic(FALLBACK_CFG_FILE, fallbackCfg, { pretty: true }); } catch { /* best effort */ } }
function fmtReset(ms: number): string { try { return new Date(ms).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }); } catch { return ""; } }
/** The configured secondary AI IF it is usable right now (enabled, registered, not the primary, not itself exhausted). */
function usableFallback(primary: string, now: number): { agent: string; model?: string; effort?: string } | null {
  if (!fallbackCfg.enabled || !fallbackCfg.agent || fallbackCfg.agent === primary) return null;
  if (!agents.has(fallbackCfg.agent) || agentAvailability.isBlocked(fallbackCfg.agent, now)) return null;
  return { agent: fallbackCfg.agent, model: fallbackCfg.model || undefined, effort: fallbackCfg.effort || undefined };
}
// Suppress the preemptive "using the secondary" notice after the first turn of a given block period
// (keyed by the reset deadline), so a blocked primary doesn't toast on every message.
const noticedBlock: Record<string, number> = {};
/** Preemptive pick for a turn: the primary unless it is known-exhausted and a usable secondary exists. */
function resolveTurnAgent(primary: string): { agent: string; model?: string; effort?: string; switched: boolean; note?: string } {
  const now = Date.now();
  agentAvailability.sweep(now);
  if (!agentAvailability.isBlocked(primary, now)) return { agent: primary, switched: false };
  const fb = usableFallback(primary, now);
  if (!fb) return { agent: primary, switched: false }; // no usable secondary — let it try and warn on failure
  const until = agentAvailability.blockedUntil(primary, now) || now;
  const firstThisBlock = noticedBlock[primary] !== until;
  noticedBlock[primary] = until;
  return { agent: fb.agent, model: fb.model, effort: fb.effort, switched: true, note: firstThisBlock ? `IA primária (${primary}) sem crédito até ${fmtReset(until)} — usando ${fb.agent}.` : undefined };
}
/** A limit error just hit `agent`: record exhaustion (retry after next local midnight) and return a usable secondary to retry with. */
function onLimitHit(agent: string, message: string): { agent: string; model?: string; effort?: string; note?: string } | null {
  const now = Date.now();
  const until = nextLocalMidnight(now);
  agentAvailability.markExhausted(agent, until, message, now);
  const fb = usableFallback(agent, now);
  return fb ? { agent: fb.agent, model: fb.model, effort: fb.effort, note: `IA ${agent} sem crédito (limite atingido) — refazendo com ${fb.agent}; a primária volta a ser tentada após ${fmtReset(until)}.` } : null;
}
function sendFallbackCfg(ws: WebSocket, saved = false): void {
  const now = Date.now(); agentAvailability.sweep(now);
  send(ws, { t: "fallback_cfg", saved, cfg: fallbackCfg, blocks: agentAvailability.list(now).map((b) => ({ agent: b.agent, blockedUntil: b.blockedUntil, reason: b.reason })) });
}
// Snapshot of the file set at the LAST publish, so the inventory can flag new/modified/removed files
// in the working tree since then. Content-addressed diffs live in framework-inventory.
const FRAMEWORK_PUBLISHED_FILE = join(JARVIS_DIR, "framework-published.json");
function readPublishedSnapshot(): FrameworkFile[] { return readJson<FrameworkFile[]>(FRAMEWORK_PUBLISHED_FILE, []); }
function savePublishedSnapshot(files: FrameworkFile[]): void { try { writeJsonAtomic(FRAMEWORK_PUBLISHED_FILE, files, { pretty: false }); } catch { /* best effort */ } }
// Server-held import previews: an import (zip/GitHub) is staged here after the security scan, and only
// written to disk when the owner confirms `framework_import_apply` with the matching token. This keeps
// the (possibly large, possibly hostile) payload off the client round-trip and gates apply on review.
interface PendingFrameworkImport { files: FrameworkFile[]; hash: string; scanBlocked: boolean; manifest?: PackManifest | null; source: { type: "zip" | "github" | "starter" | "native"; name?: string; spec?: GithubSpec; ref?: string; commit?: string; id?: string; nativeEntries?: Array<{ entryId: string; provider: string; kind: "skill" | "command"; name: string; hash: string; paths: string[] }> }; createdAt: number }
interface FrameworkUpdateAlert { id: string; type: FrameworkSourceType; label: string; provider?: string; scanBlocked: boolean; changed: number; at: number }
let frameworkUpdateAlerts: FrameworkUpdateAlert[] = [];
const pendingFrameworkImports = new Map<string, PendingFrameworkImport>();
const IMPORT_TTL_MS = 15 * 60 * 1000;
const MAX_IMPORT_B64 = 25 * 1024 * 1024; // ~18 MB decoded — a framework pack is far smaller
function sweepPendingImports(): void { const now = Date.now(); for (const [k, v] of pendingFrameworkImports) if (now - v.createdAt > IMPORT_TTL_MS) pendingFrameworkImports.delete(k); }
const push = new PushCenter(JARVIS_DIR);
function reconcilePushDevices(): void {
  if (!auth.AUTH_ENABLED) return;
  auth.pruneExpiredDevices();
  push.purgeUnknownDevices(auth.listDevices().map((device) => ({ principalId: device.userId, deviceId: device.id })), true);
}
reconcilePushDevices();
const sessionNotificationTargets = new Map<string, PushActor>();
function notificationKey(runnerId: string, sessionId: string): string { return `${runnerId}\u0000${sessionId}`; }
function rememberSessionNotificationTarget(runnerId: string, sessionId: string, actor?: ContextActor): void {
  const principalId = actor?.userId || "local";
  sessionNotificationTargets.set(notificationKey(runnerId, sessionId), { principalId });
}
function notificationTargetForSession(runnerId: string, sessionId: string): PushActor | undefined {
  const remembered = sessionNotificationTargets.get(notificationKey(runnerId, sessionId));
  if (remembered?.principalId) return remembered;
  // Bindings hold IDENTITIES; push subscriptions are per device login. The owner identity therefore
  // has no single push principal — falling through to `undefined` fans the notification out to every
  // owner device, which is what "my session finished" should do. A member maps back to their user.
  const binding = personalSessionBindings.get(runnerId, sessionId);
  if (!binding || auth.identityOf(binding.principalId) === auth.OWNER_IDENTITY) return undefined;
  return { principalId: binding.principalId.replace(/^u:/, "") };
}
// PushCenter rejects destination-less content. Operational alerts expand to each owner principal;
// session events pass the initiating principal explicitly at their call sites.
const notifyEvent = (...args: Parameters<PushCenter["notifyEvent"]>): void => {
  const [kind, title, body, tag, target] = args;
  const targets = target?.principalId
    ? [target]
    : !auth.AUTH_ENABLED
      ? [{ principalId: "local" }]
      : [...new Set(auth.listDevices().filter((device) => device.role === "owner").map((device) => device.userId))].map((principalId) => ({ principalId }));
  for (const destination of targets) push.notifyEvent(kind, title, body, tag, destination);
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

// Hardening headers on every response — clickjacking, sniffing, referrer leak,
// and a CSP that keeps the self-hosted single-origin app locked to itself. The
// HTML's single inline <script> runs under a per-response NONCE (no 'unsafe-inline'
// for scripts), so an injected inline script can't execute — real XSS mitigation,
// which matters because a device token lives in the page's localStorage.
function csp(nonce?: string): string {
  const script = nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'";
  return `default-src 'self'; ${script}; style-src 'self' 'unsafe-inline'; ` +
    "connect-src 'self' ws: wss:; img-src 'self' data:; media-src 'self' blob: data:; " +
    "font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
}
function secHeaders(nonce?: string): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "microphone=(self), camera=(), geolocation=(self)",
    "content-security-policy": csp(nonce),
  };
}
const PASTED_DIR = join(homedir(), ".jarvis", "pasted");
const server = createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  // Unauthenticated liveness/readiness probe for monitors, `tailscale serve` health, or a load
  // balancer. Deliberately leaks only coarse status (up + uptime + count of connected runners) —
  // no hostnames/ids — so it's safe to leave open on the private network.
  if (urlPath === "/health" || urlPath === "/healthz") {
    let online = 0; for (const r of runners.values()) if (r.ws) online++;
    res.writeHead(200, { ...secHeaders(), "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, version: VERSION, build: hubBuild || undefined, commit: hubCommit || undefined, uptime: Math.round(process.uptime()), runners: online }));
    return;
  }
  // Ponte de tarefas (C3) — jarvis_task_* de qualquer IA cai aqui: o Hub resolve sessão → projeto →
  // conexão do COFRE e executa com a conta certa. A IA nunca vê credencial nem escolhe conta.
  // `create` segura a resposta até a aprovação do dono (ou autoApprove do projeto, sem divergência).
  if (urlPath === "/internal/task" && req.method === "POST") {
    const ra = req.socket.remoteAddress || "";
    const isLocal = ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
    const bearerOk = String(req.headers["authorization"] || "") === "Bearer " + TASK_BRIDGE_TOKEN;
    let body = ""; let tooBig = false;
    req.on("data", (chunk) => { body += chunk; if (body.length > 128 * 1024) { tooBig = true; req.destroy(); } });
    req.on("error", () => { try { res.writeHead(400, secHeaders()).end(); } catch { /* ignore */ } });
    req.on("end", () => {
      void (async () => {
        if (tooBig) { try { res.writeHead(413, secHeaders()).end(); } catch { /* ignore */ } return; }
        let d: any; try { d = JSON.parse(body); } catch { res.writeHead(400, secHeaders()).end(); return; }
        if (!isLocal || !bearerOk) { res.writeHead(401, secHeaders()).end(); return; }
        const reply = (payload: unknown): void => {
          try { res.writeHead(200, { ...secHeaders(), "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(payload)); }
          catch { /* a ponte já se foi; nada a fazer */ }
        };
        const sessionId = typeof d?.sessionId === "string" ? d.sessionId : "";
        const op = String(d?.op || "");
        const args = (d?.args && typeof d.args === "object" ? d.args : {}) as Record<string, unknown>;
        await serveTaskBridge({ runnerId: LOCAL_ID, sessionId, op, args, reply });
      })();
    });
    return;
  }
  // Manual permission mode (Fase 3) — the Claude adapter's stdio MCP approval bridge calls here for
  // each tool. Guarded by loopback + the per-process token minted at boot. Holds the response open,
  // asks the user in the UI (permission_request), and answers when they decide or on timeout (deny).
  if (urlPath === "/internal/perm" && req.method === "POST") {
    const ra = req.socket.remoteAddress || "";
    const isLocal = ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
    const bearerOk = String(req.headers["authorization"] || "") === "Bearer " + PERM_TOKEN;
    let body = ""; let tooBig = false;
    req.on("data", (chunk) => { body += chunk; if (body.length > 256 * 1024) { tooBig = true; req.destroy(); } });
    req.on("error", () => { try { res.writeHead(400, secHeaders()).end(); } catch { /* ignore */ } });
    req.on("end", () => {
      if (tooBig) { try { res.writeHead(413, secHeaders()).end(); } catch { /* ignore */ } return; }
      let d: any; try { d = JSON.parse(body); } catch { res.writeHead(400, secHeaders()).end(); return; }
      const tokenOk = bearerOk || d?.token === PERM_TOKEN;
      if (!isLocal || !tokenOk) { res.writeHead(401, secHeaders()).end(); return; }
      const id = randomUUID();
      const sessionId = typeof d?.sessionId === "string" ? d.sessionId : "";
      const settle = (decision: PermissionDecision) => {
        const p = pendingPermissions.get(id); if (!p) return; // already answered/timed out
        clearTimeout(p.timer); pendingPermissions.delete(id);
        try {
          res.writeHead(200, { ...secHeaders(), "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify(decision));
        } catch { /* client (bridge) gone; nothing to do */ }
        broadcast(sessionId, { t: "permission_resolved", sessionId, id, behavior: decision.behavior });
      };
      const timer = setTimeout(() => settle({ behavior: "deny", message: "Tempo esgotado — negado por segurança" }), PERM_TIMEOUT_MS);
      pendingPermissions.set(id, { sessionId, runnerId: LOCAL_ID, timer, settle });
      // A dropped bridge connection must not leak a pending entry (it would deny a later, unrelated turn's
      // wait only via timeout, but also holds memory). If the request aborts, resolve it as a deny.
      req.on("aborted", () => settle({ behavior: "deny", message: "Conexão encerrada" }));
      broadcast(sessionId, { t: "permission_request", sessionId, id, tool: typeof d?.toolName === "string" ? d.toolName : "", input: d?.input ?? {}, cwd: sessionCwd(sessionId) });
    });
    return;
  }
  // UPD-01 Fase 2 — out-of-band updater failure report. A runner's detached updater POSTs here even
  // when the runner process is dead (crash-loop), so the owner learns why an update failed. Auth: a
  // valid runner token (when auth is on) + the requestId shared secret the Hub minted for this update.
  if (urlPath === "/runner-update-report" && req.method === "POST") {
    let body = ""; let tooBig = false;
    req.on("data", (chunk) => { body += chunk; if (body.length > 64 * 1024) { tooBig = true; req.destroy(); } });
    req.on("error", () => { try { res.writeHead(400, secHeaders()).end(); } catch { /* ignore */ } });
    req.on("end", () => {
      if (tooBig) { try { res.writeHead(413, secHeaders()).end(); } catch { /* ignore */ } return; }
      let d: any; try { d = JSON.parse(body); } catch { res.writeHead(400, { ...secHeaders(), "content-type": "application/json" }).end('{"ok":false}'); return; }
      const runnerId = typeof d?.runnerId === "string" ? d.runnerId : "";
      if (!runnerId || runnerId === LOCAL_ID) { res.writeHead(400, secHeaders()).end(); return; }
      if (auth.AUTH_ENABLED && !auth.authenticateRunner(typeof d?.token === "string" ? d.token : "")) { res.writeHead(401, secHeaders()).end(); return; }
      const pending = pendingRunnerUpdates[runnerId];
      if (pending && typeof d?.requestId === "string" && d.requestId !== pending.requestId) { res.writeHead(409, secHeaders()).end(); return; }
      try { recordRunnerUpdateReport(runnerId, d); } catch (e) { console.error("[hub] update-report:", String((e as any)?.message ?? e)); }
      res.writeHead(200, { ...secHeaders(), "content-type": "application/json", "cache-control": "no-store" }).end('{"ok":true}');
    });
    return;
  }
  // MapLibre starts with a private, network-free background style. Optional local files are fixed
  // by Hub environment variables; the request cannot select a path, so these routes never expose
  // arbitrary files from the host.
  if (urlPath === "/context/maps/style.json") {
    let style: unknown = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#10151d" } }] };
    if (CONTEXT_MAP_STYLE_FILE && existsSync(CONTEXT_MAP_STYLE_FILE) && statSync(CONTEXT_MAP_STYLE_FILE).isFile()) {
      try { style = JSON.parse(readFileSync(CONTEXT_MAP_STYLE_FILE, "utf8")); } catch { /* use the private fallback */ }
    }
    res.writeHead(200, { ...secHeaders(), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(style));
    return;
  }
  if (urlPath === "/context/maps/region.pmtiles") {
    if (!CONTEXT_PMTILES_FILE || !existsSync(CONTEXT_PMTILES_FILE) || !statSync(CONTEXT_PMTILES_FILE).isFile()) { res.writeHead(404, secHeaders()).end("local map is not configured"); return; }
    const size = statSync(CONTEXT_PMTILES_FILE).size;
    const match = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ""));
    let start = 0, end = size - 1;
    if (match) { start = Number(match[1]); end = match[2] ? Math.min(size - 1, Number(match[2])) : size - 1; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) { res.writeHead(416, { ...secHeaders(), "content-range": `bytes */${size}` }).end(); return; }
    const length = end - start + 1, body = Buffer.allocUnsafe(length), fd = openSync(CONTEXT_PMTILES_FILE, "r"); let offset = 0;
    try { while (offset < length) { const read = readSync(fd, body, offset, length - offset, start + offset); if (!read) break; offset += read; } }
    finally { closeSync(fd); }
    if (offset !== length) { res.writeHead(500, secHeaders()).end("local map read failed"); return; }
    res.writeHead(match ? 206 : 200, { ...secHeaders(), "content-type": "application/octet-stream", "accept-ranges": "bytes", "content-length": length, ...(match ? { "content-range": `bytes ${start}-${end}/${size}` } : {}), "cache-control": "private, max-age=86400" });
    res.end(body);
    return;
  }
  // pasted/attached images, served for the in-chat preview — basename only (no traversal)
  if (urlPath.startsWith("/pasted/")) {
    const name = basename(decodeURIComponent(urlPath.slice("/pasted/".length)));
    const pf = join(PASTED_DIR, name);
    if (name && pf.startsWith(PASTED_DIR) && existsSync(pf) && statSync(pf).isFile()) {
      const pext = pf.slice(pf.lastIndexOf(".")).toLowerCase();
      res.writeHead(200, { ...secHeaders(), "content-type": MIME[pext] || "application/octet-stream", "cache-control": "max-age=86400" });
      res.end(readFileSync(pf));
    } else res.writeHead(404, secHeaders()).end("not found");
    return;
  }
  const file = normalize(join(WEB, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, secHeaders()).end("not found");
    return;
  }
  const ext = file.slice(file.lastIndexOf("."));
  if (ext === ".html") {
    const nonce = randomBytes(16).toString("base64");
    const html = readFileSync(file, "utf8").replace(/<script(?![^>]*\bsrc=)/gi, `<script nonce="${nonce}"`);
    res.writeHead(200, { ...secHeaders(nonce), "content-type": MIME[ext], "cache-control": "no-cache, must-revalidate" });
    res.end(html);
    return;
  }
  // no-cache: clients (esp. mobile) must always get the latest UI, never a stale file
  res.writeHead(200, { ...secHeaders(), "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache, must-revalidate" });
  res.end(readFileSync(file));
});

// `ws` ships permessage-deflate off on the server (it warns about CPU/memory), but our traffic is
// JSON and our worst link is a relay: between this pair Tailscale never got a direct connection,
// so everything rides DERP at 28..621ms RTT — and a remote session crosses it TWICE (hub<->runner
// and hub<->browser). Measured on the largest real session: history 52.8KB -> 15.3KB (-71%) for
// 0.6ms of CPU per send. That trade is worth it here; on a phone it's worth it twice over.
// Browsers and the `ws` client both offer the extension, so enabling it here covers both hops.
const wss = new WebSocketServer({
  server,
  maxPayload: guard.MAX_PAYLOAD,
  perMessageDeflate: {
    threshold: 1024,       // below this the CPU costs more than the bytes saved
    concurrencyLimit: 10,  // cap parallel zlib jobs so a burst can't starve the loop
  },
});
wss.on("error", (e: any) => console.error("[hub] wss error:", e?.message ?? e));
// Last-resort safety net: a stray socket/parse error must not take the hub down
// (a crash is a denial-of-service). Log loudly and keep serving.
process.on("uncaughtException", (e: any) => console.error("[hub] uncaughtException (mantendo no ar):", e?.stack ?? e));
process.on("unhandledRejection", (e: any) => console.error("[hub] unhandledRejection:", e));

// Which session each client is currently viewing — for broadcast + listener mode.
const subs = new Map<WebSocket, string>();
// machine wake-word listener sockets + whether "Hey Jarvis" is armed.
const wakeClients = new Set<WebSocket>();
let wakeEnabled = process.env.JARVIS_WAKE !== "0";
// speaker-id: label voice messages with the enrolled speaker; optionally reject
// unknown voices (gate). Off by default so an un-enrolled user is never locked out.
// Persisted (voice-cfg.json) so the owner turning the gate ON survives a Hub restart — it used to
// live only in memory + env, so a restart silently reverted a security control to its default.
let voiceGate = typeof voiceCfg.gate === "boolean" ? voiceCfg.gate : process.env.JARVIS_VOICE_GATE === "1";
let voiceThreshold: number | undefined = typeof voiceCfg.threshold === "number" ? voiceCfg.threshold : (process.env.JARVIS_VOICE_THRESHOLD ? Number(process.env.JARVIS_VOICE_THRESHOLD) : undefined);
// proactive-voice session setup: which agent/model/effort/folder the wake session
// uses, and a task held while we ask the user "continuar ou nova sessão?".
const voiceConfig: { agent: string; model?: string; effort?: string; cwd: string } = {
  agent: voiceCfg.agent,
  model: voiceCfg.model,
  effort: voiceCfg.effort,
  cwd: process.env.JARVIS_WAKE_CWD || CWD,
};
let voicePending: { task: string } | null = null;
// Binding de voz: a sessão-ALVO da conversa de voz ("" = a sessão de voz). Garante que a voz aja na
// sessão certa e não misture contexto. Definido pela resolução do wake (sugestão via memória).
let voiceTarget = "";
let voiceResolve: { task: string; speak: boolean; speaker?: string; suggestId?: string } | null = null;
// cheap gate: only spend an LLM intent pass when the utterance plausibly carries a command
const VOICE_HINT = /\b(modelo|model|esfor[çc]o|effort|pasta|diret[óo]rio|folder|sess[ãa]o|nov[ao]|continu|seguir|trocar|usar?|use|come[çc]ar)\b/i;
const PT_EFFORT: Record<string, string> = { minimal: "mínimo", low: "baixo", medium: "médio", high: "alto", xhigh: "muito alto", max: "máximo", ultra: "ultra", ultracode: "ultracode" };

async function compatibleAgentOpts(agent: AgentAdapter, requestedModel?: string, requestedEffort?: string): Promise<SendOpts> {
  const caps = await agent.capabilities();
  const model = requestedModel && caps.models.some((m) => m.id === requestedModel) ? requestedModel : undefined;
  const selected = model ? caps.models.find((m) => m.id === model) : undefined;
  const effort = requestedEffort && selected?.efforts.includes(requestedEffort) ? requestedEffort : undefined;
  // Every caller of this helper is an internal analysis oneShot (routing, summary, decision-detection,
  // relevance, preflight, digest) — pure text-in/text-out that never calls MCP tools. Disable MCP so
  // we don't pay server startup/handshake latency + cost on each one. See SendOpts.noMcp.
  return { model, effort, noMcp: true };
}
const summaryAgent = (): AgentAdapter => agents.has(summaryCfg.agent) ? agents.get(summaryCfg.agent) : agents.searchAgent();

function voiceMentionsCatalog(text: string, desc: Awaited<ReturnType<AgentRegistry["describe"]>>): boolean {
  const lower = text.toLocaleLowerCase();
  return VOICE_HINT.test(text) || desc.some((a) => [a.name, a.label, ...a.models.flatMap((m) => [m.id, m.label])].some((v) => v && String(v).length > 2 && lower.includes(String(v).toLocaleLowerCase())));
}

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
/** To every client viewing a session on one exact machine (keeps desktop + phone in sync). */
function broadcastOn(runnerId: string, sessionId: string, obj: unknown): void {
  const frame = obj && typeof obj === "object" && !Array.isArray(obj) ? { ...(obj as Record<string, unknown>), runnerId } : obj;
  const s = JSON.stringify(frame);
  for (const c of clientsOn(runnerId)) if (c.readyState === c.OPEN && subs.get(c) === sessionId && canAccessSession(c, runnerId, sessionId)) c.send(s);
}
function broadcast(sessionId: string, obj: unknown): void { broadcastOn(LOCAL_ID, sessionId, obj); }
/** to every UI client (skips runner sockets) */
function broadcastAll(obj: unknown): void {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === c.OPEN && !runnerSockets.has(c as WebSocket)) c.send(s);
}

// sessions with an in-flight Jarvis-driven turn — powers the "rodando agora" panel.
const activeRuns = new Set<string>();
const routeAborts = new Map<string, AbortController>();
// Post-turn decision detection is Hub-owned HITL. It is machine/session scoped, replayed on open,
// and deliberately never blocks the composer or queue. A newer turn invalidates stale questions.
const decisionKey = (runnerId: string, sid: string): string => runnerId + "\0" + sid;
const asking = new Map<string, string>();
// A pergunta pendente é do Hub e da PESSOA: em memória ela morria no restart, e só existia para quem
// estava com a sessão aberta. Ver docs/specs/TSK-10-pending-decision-reaches-you.md.
const pendingAsks = new PendingAskStore(join(JARVIS_DIR, "hub", "pending-asks.json"));
/** Aviso ENXUTO (sem o texto das perguntas) para todo cliente que pode abrir a sessão — inclusive
 *  quem está olhando outra. Espalhar o conteúdo resolveria o aviso criando um vazamento. */
function broadcastAskState(runnerId: string, sid: string, count: number | null, at?: number): void {
  const frame = count === null
    ? { t: "ask_cleared", runnerId, sessionId: sid }
    : { t: "ask_pending", runnerId, sessionId: sid, count, at: at || Date.now() };
  const raw = JSON.stringify(frame);
  for (const c of clientsOn(runnerId)) if (c.readyState === c.OPEN && canAccessSession(c, runnerId, sid)) c.send(raw);
}
function clearPendingAsk(runnerId: string, sid: string): void {
  const key = decisionKey(runnerId, sid), wasAsking = asking.delete(key);
  let wasPending = false;
  try { wasPending = pendingAsks.remove(runnerId, sid); } catch { /* disco travado não pode travar o turno */ }
  if (wasAsking || wasPending) broadcastAskState(runnerId, sid, null);
}
/** Resend pending analysis/questions to a client that just (re)opened the exact machine/session. */
function sendPendingAsk(ws: WebSocket, runnerId: string, sid: string): void {
  const key = decisionKey(runnerId, sid);
  if (asking.has(key)) send(ws, { t: "asking", runnerId, sessionId: sid, on: true });
  const pa = pendingAsks.get(runnerId, sid); if (pa) send(ws, { t: "ask", runnerId, sessionId: sid, questions: pa.questions });
}
// runs/sessions are per-machine: only clients viewing the LOCAL machine get local ones.
function broadcastRuns(): void {
  for (const c of clientsOn(LOCAL_ID)) if (c.readyState === c.OPEN) {
    send(c, { t: "runs", runnerId: LOCAL_ID, active: [...activeRuns].filter((sid) => canAccessSession(c, LOCAL_ID, sid)) });
  }
}
// single-flight global para operações de voz (resumo/digest): só 1 por vez em toda a instância,
// independente de qual chat/cliente pediu. Guard no servidor complementa a trava de UI (multi-device).
let voiceOpBusy = false;

// --- auth: per-connection principal (device pairing; see auth.ts). JARVIS_AUTH=off bypasses. ---
type Conn = { userId: string; role: auth.Role; name: string; deviceId: string | null; verified: boolean };
const principals = new WeakMap<WebSocket, Conn>();
const unauthTimers = new WeakMap<WebSocket, ReturnType<typeof setTimeout>>();
function isAuthed(ws: WebSocket): boolean { return !auth.AUTH_ENABLED || principals.has(ws); }
function principalOf(ws: WebSocket): Conn | undefined { return principals.get(ws); }
function actorOf(ws: WebSocket, source: ContextActor["source"] = "user"): ContextActor {
  const principal = principalOf(ws);
  return { userId: principal?.userId || undefined, deviceId: principal?.deviceId || undefined, source };
}
/** WHOSE work this is — the person, not the device login (see auth.identityOf). Every gate that asks
 *  "may this connection touch this session/execution/memory?" goes through here, so the owner reaches
 *  their own work from the desktop and from the phone. Attribution (audit, push routing, personal
 *  data store) keeps using `principalOf(ws)?.userId`: that answers "which device", another question. */
function socketPrincipalId(ws: WebSocket): string { return auth.identityOf(principalOf(ws)?.userId); }
/** Same axis, for work that arrives with an actor instead of a socket (queue, routine, voice, wake). */
function actorPrincipalId(actor?: { userId?: string | null } | null): string { return auth.identityOf(actor?.userId); }
function localManagedSessionForNative(nativeSessionId: string): string | undefined {
  for (const session of store.list()) {
    try {
      const nativeId = agents.get(session.agent).nativeSessionId?.(session.id);
      if (nativeId && nativeIdForAgent(session.agent, nativeId) === nativeSessionId) return session.id;
    } catch { /* an unavailable adapter cannot establish an alias */ }
  }
  return undefined;
}
function sessionAliases(runnerId: string, sessionId: string): string[] {
  const aliases = new Set([sessionId]);
  if (runnerId === LOCAL_ID) {
    if (isNativeId(sessionId)) {
      const managed = localManagedSessionForNative(sessionId); if (managed) aliases.add(managed);
    } else {
      const session = store.get(sessionId);
      try {
        const nativeId = session && agents.get(session.agent).nativeSessionId?.(session.id);
        const nativeKey = session && nativeId ? nativeIdForAgent(session.agent, nativeId) : null;
        if (nativeKey) aliases.add(nativeKey);
      } catch { /* no established native alias */ }
    }
  } else if (isNativeId(sessionId)) {
    const managed = managedRunnerSessionForNative(runnerId, sessionId); if (managed) aliases.add(managed);
  } else {
    const state = runnerSessionState.get(runnerId)?.get(sessionId);
    const nativeKey = state?.nativeId && state?.agent ? nativeIdForAgent(String(state.agent), String(state.nativeId)) : null;
    if (nativeKey) aliases.add(nativeKey);
  }
  return [...aliases].sort();
}
interface SessionOwnerGeneration {
  runnerId: string;
  sessionId: string;
  aliases: string[];
  snapshots: PersonalSessionGeneration[];
  principalId?: string;
  conflicted: boolean;
}
function captureSessionOwnerGeneration(runnerId: string, sessionId: string): SessionOwnerGeneration {
  const aliases = sessionAliases(runnerId, sessionId);
  const snapshots = aliases.map((alias) => personalSessionBindings.capture(runnerId, alias));
  // Compared as IDENTITIES: two of the owner's devices are one person, so a managed session bound on
  // the phone and its native alias bound on the desktop is agreement, not a conflict.
  const owners = new Set(snapshots.map((snapshot) => snapshot.principalId).filter((value): value is string => !!value).map((value) => auth.identityOf(value)));
  return { runnerId, sessionId, aliases, snapshots, principalId: owners.size === 1 ? [...owners][0] : undefined, conflicted: owners.size > 1 };
}
function sessionOwnerGenerationCurrent(generation: SessionOwnerGeneration): boolean {
  const aliases = sessionAliases(generation.runnerId, generation.sessionId);
  return aliases.length === generation.aliases.length
    && aliases.every((alias, index) => alias === generation.aliases[index])
    && generation.snapshots.every((snapshot) => personalSessionBindings.matches(snapshot));
}
function synchronizePersonalSessionAliases(runnerId: string, sessionId: string): void {
  const generation = captureSessionOwnerGeneration(runnerId, sessionId);
  if (generation.conflicted) throw new Error("conflicting personal ownership across session aliases");
  if (generation.principalId) personalSessionBindings.claimMany(runnerId, generation.aliases, generation.principalId);
}
function preparePendingDeleteTargets(runnerId: string, sessionIds: string[], alsoNative: boolean): PendingDeleteTarget[] {
  return sessionIds.map((sessionId) => {
    synchronizePersonalSessionAliases(runnerId, sessionId);
    const aliases = alsoNative && !isNativeId(sessionId) ? sessionAliases(runnerId, sessionId) : [sessionId];
    return { sessionId, invalidations: aliases.map((alias) => personalSessionBindings.capture(runnerId, alias)) };
  });
}
function canAccessSession(ws: WebSocket, runnerId: string, sessionId: string): boolean {
  const generation = captureSessionOwnerGeneration(runnerId, sessionId);
  return !generation.conflicted && generation.snapshots.every((snapshot) => !snapshot.principalId || auth.sameIdentity(snapshot.principalId, socketPrincipalId(ws)));
}
function bindPersonalSession(runnerId: string, sessionId: string, actor: ContextActor): void {
  const principalId = actorPrincipalId(actor);
  const aliases = sessionAliases(runnerId, sessionId);
  const changed = aliases.some((alias) => !personalSessionBindings.get(runnerId, alias));
  personalSessionBindings.claimMany(runnerId, aliases, principalId);
  if (!changed) return;

  // Existing viewers and queued work from a different principal must not cross the point where
  // personal data starts entering the transcript.
  for (const client of clientsOn(runnerId)) {
    if (subs.get(client) !== sessionId || canAccessSession(client, runnerId, sessionId)) continue;
    subs.delete(client);
    send(client, { t: "session_access_revoked", runnerId, sessionId, message: "Esta sessão passou a conter contexto pessoal de outro usuário." });
  }
  const queue = queueOf(runnerId, sessionId), filtered = queue.filter((item) => auth.sameIdentity(item.actor?.userId, principalId));
  if (filtered.length !== queue.length) {
    queues.set(scopedSessionKey(runnerId, sessionId), filtered);
    saveQueues();
  }
  if (runnerId === LOCAL_ID) {
    let pendingChanged = false;
    for (const [id, item] of pendingInboundTurns) {
      if (item.sessionId !== sessionId || auth.sameIdentity(item.actor?.userId, principalId)) continue;
      pendingInboundTurns.delete(id); pendingChanged = true;
    }
    if (pendingChanged) savePendingInboundTurns();
  }
  syncTails();
}
/** Fully authed = token accepted AND (no owner passphrase OR this session verified it). */
function fullyAuthed(ws: WebSocket): boolean { if (!auth.AUTH_ENABLED) return true; const p = principals.get(ws); return !!p && (!auth.hasPassphrase() || p.verified); }
function clearUnauthTimer(ws: WebSocket): void { const t = unauthTimers.get(ws); if (t) { clearTimeout(t); unauthTimers.delete(ws); } }
function uaOf(req: any): string | undefined { const ua = req?.headers?.["user-agent"]; return typeof ua === "string" ? ua.slice(0, 200) : undefined; }
function clientMeta(req: any): { ip: string; ua?: string } { return { ip: guard.clientIp(req), ua: uaOf(req) }; }
function isLocalWakeMsg(ip: string, msg: any): boolean {
  if (!guard.isLoopback(ip)) return false;
  if (msg.t === "wake_hello" || msg.t === "wake_event") return true;
  return msg.t === "send" && msg.sessionId === WAKE_SESSION && msg.speak === true && typeof msg.text === "string";
}

async function personalContextForChat(runnerId: string, sid: string, text: string, actor: ContextActor, afterBinding?: () => boolean): Promise<PreparedPersonalTurnContext | undefined> {
  rememberSessionNotificationTarget(runnerId, sid, actor);
  const allowed = effectivePolicyFor(sid).policy.memory.allowPersonalContext === true;
  if (!allowed || !routePersonalIntent(text)) return undefined;
  bindPersonalSession(runnerId, sid, actor);
  if (afterBinding && !afterBinding()) throw new Error("a autorização da sessão mudou durante a vinculação pessoal");
  const key = scopedSessionKey(runnerId, sid), ctrl = new AbortController();
  routeAborts.set(key, ctrl);
  try {
    const work = preparePersonalTurnContext({
      assistant: personalAssistant,
      text,
      allowed,
      signal: ctrl.signal,
      actor: { principalId: actor.userId || "local", deviceId: actor.deviceId || "local", owner: false },
      onError: (error) => console.warn("[personal] contexto do turno indisponível:", String((error as Error)?.message || error)),
    });
    const aborted = new Promise<never>((_resolve, reject) => ctrl.signal.addEventListener("abort", () => reject(new Error(ABORTED)), { once: true }));
    const prepared = await Promise.race([work, aborted]);
    if (prepared) broadcastOn(runnerId, sid, { t: "personal_turn_suggestions", runnerId, sessionId: sid, intent: prepared.intent.intent, purpose: prepared.purpose, response: prepared.response });
    return prepared;
  } finally {
    if (routeAborts.get(key) === ctrl) routeAborts.delete(key);
  }
}
let warnedInsecure = false;
function maybeWarnInsecure(req: any): void {
  if (!warnedInsecure && auth.AUTH_ENABLED && guard.isInsecurePublic(req)) {
    warnedInsecure = true;
    console.warn(`[hub] AVISO: conexão não-loopback sem TLS (${guard.clientIp(req)}). Em servidor público use HTTPS/WSS via proxy — tokens não devem trafegar em texto puro.`);
  }
}
/** Owner-only gate for the security/admin messages. Returns the principal or null (and errors). */
function requireOwner(ws: WebSocket): Conn | null {
  if (!auth.AUTH_ENABLED) return { userId: "local", role: "owner", name: "Local", deviceId: null, verified: true };
  const p = principalOf(ws);
  if (!p || p.role !== "owner") { send(ws, { t: "error", message: "apenas o dono pode gerenciar dispositivos" }); return null; }
  return p;
}
/** Current devices + pending invites, marking THIS connection's device as "me". */
function secState(ws: WebSocket): void {
  const p = principalOf(ws);
  const onlineRunners = new Set([...runners.values()].filter((r) => !r.local && r.ws && r.ws.readyState === WebSocket.OPEN).map((r) => r.id));
  // Show the runner's REGISTERED/renamed label (runnerLabels), not the stale mint-time token
  // label — otherwise a machine that connected as "Notebook" still reads "nova máquina" here.
  const runnerTokens = auth.listRunnerTokens().map((rt) => ({ ...rt, label: runnerLabels[rt.runnerId] || rt.label, online: onlineRunners.has(rt.runnerId) }));
  // The main machine (the Hub itself, "machine 0") — always shown, never removable.
  const lr = runners.get(LOCAL_ID);
  const localMachine = { id: LOCAL_ID, label: runnerLabels[LOCAL_ID] || lr?.info.host || "Servidor (esta máquina)", host: lr?.info.host };
  send(ws, { t: "sec_state", devices: auth.listDevices(), invites: auth.listInvites(), me: p?.deviceId || null, role: p?.role || (auth.AUTH_ENABLED ? "member" : "owner"), hasPass: auth.hasPassphrase(), runnerTokens, localMachine, onlineRunners: [...onlineRunners], repoUrl });
}
/** Update the live role of any connected session for this device (so the owner UI
 *  appears/disappears without a reconnect). */
function refreshPrincipalRole(deviceId: string, role: auth.Role): void {
  for (const client of wss.clients) {
    const pr = principals.get(client as WebSocket);
    if (pr && pr.deviceId === deviceId) { pr.role = role; try { send(client as WebSocket, { t: "authed", user: { id: pr.userId, role, name: pr.name } }); } catch { /* ignore */ } }
  }
}
/** Boot any currently-connected device whose token was just revoked. */
function dropRevoked(): void {
  const valid = new Set(auth.listDevices().map((d) => d.id));
  for (const client of wss.clients) {
    const pr = principals.get(client as WebSocket);
    if (pr && pr.deviceId && !valid.has(pr.deviceId)) {
      try { send(client as WebSocket, { t: "unauth", reason: "revogado", claimed: true }); (client as WebSocket).close(); } catch { /* ignore */ }
    }
  }
}

// ---- runner registry: machine 0 (this host, in-process) + remote runners (dial /runner) ----
const RUNNERS_FILE = join(JARVIS_DIR, "runners.json");
const RUNNER_UPDATES_FILE = join(JARVIS_DIR, "hub", "pending-runner-updates.json");
const runnerLabels: Record<string, string> = (() => { try { return JSON.parse(readFileSync(RUNNERS_FILE, "utf8")); } catch { return {}; } })();
for (const runnerId of Object.keys(runnerLabels)) if (runnerId !== "local") mirrorExecutionStore(runnerId);
function saveRunnerLabels(): void { try { writeJsonAtomic(RUNNERS_FILE, runnerLabels, { pretty: true }); } catch { /* ignore */ } }
interface RunnerConn { id: string; ws: WebSocket | null; info: RunnerInfo; lastSeen: number; local: boolean; }
interface PendingRunnerUpdate { requestId: string; targetCommit: string; requestedAt: number; state: "queued" | "sent" | "awaiting_restart" | "blocked"; force?: boolean; fromCommit?: string; lastAttemptAt?: number; lastError?: string; awaitingSince?: number; stalled?: boolean; failures?: number; lastNote?: string; scriptSha256?: string; scriptRanSha256?: string; scriptFromHub?: boolean; stalledNotifiedAt?: number; /** Last out-of-band phase the runner's detached updater phoned home (Fase 2 UPD-01): even when the runner process dies mid-update and never sends update_done, this records WHERE it died. */ lastPhase?: string; lastReportAt?: number; /** Últimas linhas do log do updater na falha — o rastro que diz QUAL comando quebrou, não só que algo quebrou. */ lastLogTail?: string; }
const UPDATE_RETRY_MS = Math.max(30_000, Number(process.env.JARVIS_UPDATE_RETRY_SEC || 300) * 1000);
// A machine that applied an update and reported ok goes to "awaiting_restart" and should reconnect on
// the new commit within a normal restart window. Offline PAST this = the restart/updater hung (an
// incident that took a machine offline ~30 min before); the watchdog flags it stalled and alerts the
// owner — closing the "não vejo a máquina" blind spot the reconnect-driven recovery leaves.
const UPDATE_STALL_MS = Math.max(120_000, Number(process.env.JARVIS_UPDATE_STALL_SEC || 300) * 1000);
const pendingRunnerUpdates: Record<string, PendingRunnerUpdate> = (() => {
  try {
    const raw = JSON.parse(readFileSync(RUNNER_UPDATES_FILE, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, PendingRunnerUpdate> = {};
    for (const [id, candidate] of Object.entries(raw)) {
      const value: any = candidate;
      if (!id || !value || typeof value.requestId !== "string" || typeof value.targetCommit !== "string") continue;
      const state: PendingRunnerUpdate["state"] = ["queued", "sent", "awaiting_restart", "blocked"].includes(value.state) ? value.state : "queued";
      out[id] = { requestId: value.requestId, targetCommit: value.targetCommit, requestedAt: Number(value.requestedAt) || Date.now(), state, force: value.force === true,
        fromCommit: typeof value.fromCommit === "string" ? value.fromCommit : undefined, lastAttemptAt: Number.isFinite(value.lastAttemptAt) ? Number(value.lastAttemptAt) : undefined, lastError: typeof value.lastError === "string" ? value.lastError : undefined,
        awaitingSince: Number.isFinite(value.awaitingSince) ? Number(value.awaitingSince) : undefined, stalled: value.stalled === true, stalledNotifiedAt: Number.isFinite(value.stalledNotifiedAt) ? Number(value.stalledNotifiedAt) : undefined,
        lastPhase: typeof value.lastPhase === "string" ? value.lastPhase : undefined, lastReportAt: Number.isFinite(value.lastReportAt) ? Number(value.lastReportAt) : undefined,
        lastLogTail: typeof value.lastLogTail === "string" ? value.lastLogTail : undefined };
    }
    return out;
  } catch { return {}; }
})();
function savePendingRunnerUpdates(): void { try { writeJsonAtomic(RUNNER_UPDATES_FILE, pendingRunnerUpdates, { pretty: true }); } catch (e) { console.error("[hub] não consegui persistir fila de atualização:", String((e as any)?.message ?? e)); } }
const runners = new Map<string, RunnerConn>();
const runnerSockets = new Set<WebSocket>();
const personalProactiveIntervalMs = Math.max(60_000, Number(process.env.JARVIS_PERSONAL_PROACTIVE_INTERVAL_MIN || 5) * 60_000 || 300_000);
const personalProactiveScheduler = createPersonalProactiveScheduler({
  assistant: personalAssistant,
  push,
  listDevices: () => auth.listDevices(),
  includeLocalDevice: !auth.AUTH_ENABLED,
  listRoutines: (target) => routines.list().filter((routine) => {
    if (!routine.enabled) return false;
    const principalMatches = routine.principalId
      ? routine.principalId === target.principalId
      : !auth.AUTH_ENABLED && target.principalId === "local";
    return principalMatches && (!routine.deviceId || routine.deviceId === target.deviceId);
  }),
  intervalMs: personalProactiveIntervalMs,
  sendInApp: (notification, target) => {
    let delivered = false;
    for (const client of wss.clients) {
      const ws = client as WebSocket;
      if (ws.readyState !== ws.OPEN || runnerSockets.has(ws)) continue;
      const principal = principalOf(ws);
      const principalId = principal?.userId || "local", deviceId = principal?.deviceId || "local";
      if (principalId !== target.principalId || deviceId !== target.deviceId) continue;
      send(ws, { t: "personal_proactive_notification", notification });
      delivered = true;
    }
    return delivered;
  },
  onError: (error, context) => console.warn("[personal] proatividade:", context.phase || "run", String((error as Error)?.message || error)),
});
runners.set(LOCAL_ID, { id: LOCAL_ID, ws: null, local: true, lastSeen: Date.now(), info: { runnerId: LOCAL_ID, host: hostname(), os: process.platform, agents: [], protocolVersion: RUNNER_PROTOCOL_VERSION, local: true } });
// Labels are the durable machine inventory. Rebuild offline placeholders after every Hub restart so
// they remain selectable and, critically, can retain a pending update until they reconnect.
for (const [id, label] of Object.entries(runnerLabels)) if (id !== LOCAL_ID && !runners.has(id)) {
  runners.set(id, { id, ws: null, local: false, lastSeen: 0, info: { runnerId: id, host: label || id, os: "unknown", agents: [], protocolVersion: RUNNER_PROTOCOL_VERSION } });
}
const clientRunner = new WeakMap<WebSocket, string>();
const runnerActive = new Map<string, Set<string>>(); // runnerId -> session ids running there
const runnerActiveEpoch = new Map<string, number>();
function runnerRunKey(runnerId: string, sid: string): string { return scopedSessionKey(runnerId, sid); }
function bumpRunnerActiveEpoch(runnerId: string, sid: string): number {
  const key = runnerRunKey(runnerId, sid), next = (runnerActiveEpoch.get(key) || 0) + 1;
  runnerActiveEpoch.set(key, next);
  return next;
}
function broadcastRunnerRuns(runnerId: string): void {
  const active = [...(runnerActive.get(runnerId) || new Set<string>())];
  for (const c of clientsOn(runnerId)) send(c, { t: "runs", runnerId, active: active.filter((sid) => canAccessSession(c, runnerId, sid)) });
}
function markRunnerSessionActive(runnerId: string, sid: string): void {
  if (!runnerId || !sid) return;
  const set = runnerActive.get(runnerId) || new Set<string>();
  if (set.has(sid)) return;
  set.add(sid);
  runnerActive.set(runnerId, set);
  bumpRunnerActiveEpoch(runnerId, sid);
  broadcastRunnerRuns(runnerId);
}
function clearRunnerSessionActive(runnerId: string, sid: string): boolean {
  const set = runnerActive.get(runnerId);
  if (!set?.has(sid)) return false;
  set.delete(sid);
  runnerActive.set(runnerId, set);
  broadcastRunnerRuns(runnerId);
  return true;
}
function releaseRunnerSessionAfterTerminal(runnerId: string, sid: string): void {
  const epoch = runnerActiveEpoch.get(runnerRunKey(runnerId, sid)) || 0;
  setTimeout(() => {
    if ((runnerActiveEpoch.get(runnerRunKey(runnerId, sid)) || 0) !== epoch) return;
    if (clearRunnerSessionActive(runnerId, sid)) void maybeFlushQueue(runnerId, sid, false);
  }, 1500).unref?.();
}
// When each currently-offline runner dropped (cleared on reconnect), so the fleet view can show
// "offline há Xm" and a periodic sweep can alert once when a machine stays down past the threshold.
const offlineSince = new Map<string, number>();
const offlineAlerted = new Set<string>();
const OFFLINE_ALERT_MS = Math.max(0, Number(process.env.JARVIS_OFFLINE_ALERT_MIN || 10)) * 60000;
// Clients with the update panel open. A machine's result arrives asynchronously (it may be busy,
// or restarting), long after the request returned — this is who gets told.
const updateWatchers = new Set<WebSocket>();
interface PendingDeleteTarget {
  sessionId: string;
  invalidations: PersonalSessionGeneration[];
}
interface PendingRequestMetadata {
  deleteTargets?: PendingDeleteTarget[];
  rootExecutionId?: string;
}
const pendingReq = new PendingRequestRegistry<WebSocket, PendingRequestMetadata>();
const dispatchReservations = new SessionDispatchReservations();
const dispatchOwnerGenerations = new Map<string, SessionOwnerGeneration>();
const pendingDispatchFlush = new Set<string>();
function runnerRequestId(prefix = "r"): string { return `${prefix}-${randomUUID()}`; }
function registerPendingRequest(input: {
  requestId?: string;
  ws: WebSocket;
  runnerId: string;
  operation: string;
  sessionIds?: Iterable<string>;
  metadata?: PendingRequestMetadata;
}): string {
  const requestId = input.requestId || runnerRequestId();
  pendingReq.set(requestId, { socket: input.ws, runnerId: input.runnerId, principalId: socketPrincipalId(input.ws), operation: input.operation, sessionIds: input.sessionIds, metadata: input.metadata });
  return requestId;
}
function pendingRequestAuthorized(request: PendingRequest<WebSocket, PendingRequestMetadata>): boolean {
  return request.socket.readyState === request.socket.OPEN
    && isAuthed(request.socket)
    && socketPrincipalId(request.socket) === request.principalId
    && canUseRunner(request.socket, request.runnerId)
    && (!request.metadata?.rootExecutionId || executionOwnership.allows(request.runnerId, request.metadata.rootExecutionId, request.principalId))
    && request.sessionIds.every((sessionId) => canAccessSession(request.socket, request.runnerId, sessionId));
}
function takePendingRequest(rc: RunnerConn, requestId: unknown, operations: Iterable<string>, sessionId?: string): PendingRequest<WebSocket, PendingRequestMetadata> | undefined {
  if (typeof requestId !== "string") return undefined;
  return pendingReq.take(requestId, { runnerId: rc.id, operations: new Set(operations), sessionId, authorize: pendingRequestAuthorized });
}
interface PendingMemoryConfirmation {
  runnerId: string;
  sessionId?: string;
  actor: ContextActor;
  mode: "repo-local" | "repo-remote" | "jarvis";
  expiresAt: number;
  preview?: MemoryAppendPreview;
  text?: string;
  cwd?: string;
  agent?: string;
  ownerGeneration?: SessionOwnerGeneration;
}
const pendingMemoryConfirmations = new Map<string, PendingMemoryConfirmation>();
const pendingRemoteMemoryPreview = new Map<string, { ws: WebSocket; runnerId: string; sessionId?: string; actor: ContextActor }>();
const pendingRemoteMemoryApply = new Map<string, { ws: WebSocket; pending: PendingMemoryConfirmation; token: string }>();
const MEMORY_PREVIEW_TTL_MS = 5 * 60_000;
function cleanExpiredMemoryConfirmations(): void {
  const now = Date.now();
  for (const [token, pending] of pendingMemoryConfirmations) if (pending.expiresAt <= now) pendingMemoryConfirmations.delete(token);
}
function sendMemoryFrame(origin: WebSocket, pending: PendingMemoryConfirmation, frame: unknown): void {
  let sentOrigin = false;
  for (const client of clientsOn(pending.runnerId)) {
    if (pending.sessionId && subs.get(client) !== pending.sessionId) continue;
    if (pending.actor.userId && !auth.sameIdentity(principalOf(client)?.userId, pending.actor.userId)) continue;
    send(client, frame); if (client === origin) sentOrigin = true;
  }
  if (!sentOrigin) send(origin, frame);
}
// Durable Framework Jarvis publish queue, mirroring pendingRunnerUpdates: a machine that is offline or
// on an old protocol keeps its pending publish and receives it on reconnect. Keyed by runnerId.
const FRAMEWORK_QUEUE_FILE = join(JARVIS_DIR, "hub", "pending-framework-publish.json");
interface PendingFrameworkPublish { requestId: string; targetHash: string; targetVersion: number; requestedAt: number; lastAttemptAt?: number; }
const pendingFrameworkPublish: Record<string, PendingFrameworkPublish> = readJson<Record<string, PendingFrameworkPublish>>(FRAMEWORK_QUEUE_FILE, {});
function savePendingFrameworkPublish(): void { try { writeJsonAtomic(FRAMEWORK_QUEUE_FILE, pendingFrameworkPublish, { pretty: true }); } catch { /* best effort */ } }
// requestId -> the client awaiting per-machine publish status (best-effort; cleared on reply).
const frameworkPublishClients = new Map<string, { ws: WebSocket; runnerId: string }>();
const runnerSessionState = new Map<string, Map<string, any>>();
// which agents are actually usable on THIS (local) machine — probes availability, so the
// UI can disable agents that aren't installed/authenticated here.
let localAgents: string[] = [];
let localAgentsReady = false;
async function refreshLocalAgents(): Promise<void> {
  const out: string[] = [];
  for (const n of agents.names()) { try { if (await agents.get(n).available()) out.push(n); } catch { /* skip */ } }
  const next = out;
  const local = runners.get(LOCAL_ID);
  if (local) {
    local.info.agents = next;
    local.info.agentDescriptors = await agents.describe();
    const agentUsage: Record<string, unknown | null> = {};
    for (const name of agents.names()) { const a = agents.get(name); try { agentUsage[name] = a.usage ? await a.usage() : null; } catch { agentUsage[name] = null; } }
    local.info.agentUsage = agentUsage;
  }
  const changed = next.join() !== localAgents.join() || !localAgentsReady;
  localAgents = next;
  localAgentsReady = true;
  if (changed) broadcastMachines();
}

// --- self-update (git): "new version" = new commits on origin/<branch>. ---
const UPDATE_ROOT = fileURLToPath(new URL("../../../", import.meta.url)); // repo root from apps/hub/src
let repoUrl = "";
void repoRemoteUrl(UPDATE_ROOT).then((u) => { repoUrl = u; });
// The Hub's own build, so machineList can flag runners that drifted from it. Re-read after an
// update restart is automatic (the process restarts). Refresh periodically for a live commit.
let hubCommit = "";
let hubBuild = ""; // human-readable `git describe` (tag + distance), shown per machine in the UI
void repoCommit(UPDATE_ROOT).then((c) => { hubCommit = c; });
void repoVersion(UPDATE_ROOT).then((v) => { hubBuild = v; });
setInterval(() => { void repoCommit(UPDATE_ROOT).then((c) => {
  // When the Hub's own HEAD advances (it self-updated to a newer commit), re-aim every in-flight
  // runner update at it — so a fix that landed AFTER a stuck update actually reaches the runner,
  // instead of the Hub forever re-sending the target that isn't landing (UPD-01 Fase 2).
  const moved = !!c && c.replace("+dirty", "") !== (hubCommit || "").replace("+dirty", "");
  hubCommit = c;
  if (moved) sweepRetargetPendingUpdates();
}); void repoVersion(UPDATE_ROOT).then((v) => { if (v) hubBuild = v; }); }, 60_000).unref?.();
const sameBuild = (a: string, b: string) => !!a && !!b && a.replace("+dirty", "") === b.replace("+dirty", "");
const commitMatches = (actual: string, target: string) => { const a = (actual || "").replace("+dirty", ""), t = (target || "").replace("+dirty", ""); return !!a && !!t && (a === t || a.startsWith(t) || t.startsWith(a)); };
let updateStatus: any = { supported: true, behind: 0 };
async function refreshUpdate(doBroadcast = true): Promise<void> {
  try { updateStatus = await updateCheck(UPDATE_ROOT, true); } catch (e: any) { updateStatus = { supported: false, error: String(e?.message ?? e) }; }
  if (doBroadcast) broadcastAll({ t: "update_status", status: updateStatus });
}
/** Apply the Hub update and restart (via the service manager) so the new code takes effect. Drains
 *  in-flight LOCAL turns first (up to a deadline) so a restart doesn't kill an agent mid-edit. */
function scheduleRestart(): void {
  broadcastAll({ t: "update_progress", message: "Nova versão aplicada — reiniciando." });
  void (async () => {
    await new Promise((r) => setTimeout(r, 900)); // let the broadcast flush to clients
    const start = Date.now();
    while (activeRuns.size && Date.now() - start < 120000) await new Promise((r) => setTimeout(r, 1000));
    if (activeRuns.size) console.warn(`[hub] reiniciando com ${activeRuns.size} turno(s) local(is) ativo(s) — deadline atingido`);
    try { restartService("hub"); } catch { /* ignore */ }
    process.exit(0);
  })();
}
function activeRunner(ws: WebSocket): string { return clientRunner.get(ws) || LOCAL_ID; }
/** The cwd / agent of a LOCAL session (managed or native), for "@" file search, "!" and "#" memory. */
function sessionCwd(sid?: string): string { if (!sid) return CWD; if (isNativeId(sid)) return nativeInfo(sid)?.cwd || CWD; return store.get(sid)?.cwd || CWD; }
function sessionAgent(sid?: string): string | undefined { if (!sid) return undefined; if (isNativeId(sid)) return nativeInfo(sid)?.agent; return store.get(sid)?.agent; }
function sessionCwdOn(runnerId: string, sid?: string): string {
  if (runnerId === LOCAL_ID) return sessionCwd(sid);
  return String((sid && runnerSessionState.get(runnerId)?.get(sid)?.cwd) || "");
}
/** Attribute scoped usage without assigning origin-less legacy entries to a current machine. */
function usageAgent(sid: string, recorded?: string, runnerId?: string): string {
  if (recorded && recorded !== "unknown" && recorded !== "remote-unknown") return recorded;
  const scopedAgent = runnerId === LOCAL_ID
    ? sessionAgent(sid) || executionNodeBySession(sid)?.agent
    : runnerId ? runnerSessionState.get(runnerId)?.get(sid)?.agent : undefined;
  return scopedAgent || (sid.startsWith("claude:") ? "claude-code" : sid.startsWith("codex:") ? "codex" : "legacy-unattributed");
}
function scopedSessionKey(runnerId: string, sid: string): string { return runnerId + "\0" + sid; }
function splitScopedSessionKey(key: string): { runnerId: string; sessionId: string } {
  const separator = key.indexOf("\0");
  return separator < 0 ? { runnerId: LOCAL_ID, sessionId: key } : { runnerId: key.slice(0, separator), sessionId: key.slice(separator + 1) };
}
function sessionDispatchBusy(runnerId: string, sessionId: string): boolean {
  return dispatchReservations.isHeld(runnerId, sessionId)
    || routeAborts.has(scopedSessionKey(runnerId, sessionId))
    || (runnerId === LOCAL_ID ? activeRuns.has(sessionId) : runnerActive.get(runnerId)?.has(sessionId) === true);
}
function reserveSessionDispatch(runnerId: string, sessionId: string, principalId: string, operation: string): SessionDispatchLease | undefined {
  if (sessionDispatchBusy(runnerId, sessionId)) return undefined;
  const generation = captureSessionOwnerGeneration(runnerId, sessionId);
  if (generation.conflicted || (generation.principalId && !auth.sameIdentity(generation.principalId, principalId))) return undefined;
  const lease = dispatchReservations.tryAcquire(runnerId, sessionId, principalId, operation);
  if (lease) dispatchOwnerGenerations.set(lease.token, generation);
  return lease;
}
function refreshSessionDispatchAuthorization(lease: SessionDispatchLease): boolean {
  if (!dispatchReservations.isCurrent(lease)) return false;
  const generation = captureSessionOwnerGeneration(lease.runnerId, lease.sessionId);
  if (generation.conflicted || (generation.principalId && !auth.sameIdentity(generation.principalId, lease.principalId))) return false;
  dispatchOwnerGenerations.set(lease.token, generation);
  return true;
}
function sessionDispatchAuthorized(lease: SessionDispatchLease, ws?: WebSocket, rc?: RunnerConn): boolean {
  if (!dispatchReservations.isCurrent(lease)) return false;
  const reservedGeneration = dispatchOwnerGenerations.get(lease.token);
  if (!reservedGeneration || !sessionOwnerGenerationCurrent(reservedGeneration)) return false;
  if (ws && (socketPrincipalId(ws) !== lease.principalId || !canUseRunner(ws, lease.runnerId) || !canAccessSession(ws, lease.runnerId, lease.sessionId))) return false;
  if (!ws && auth.AUTH_ENABLED && !auth.canAccessRunner(lease.principalId, lease.runnerId)) return false;
  const generation = captureSessionOwnerGeneration(lease.runnerId, lease.sessionId);
  if (generation.conflicted || (generation.principalId && !auth.sameIdentity(generation.principalId, lease.principalId))) return false;
  if (rc && (runners.get(lease.runnerId) !== rc || !rc.ws || rc.ws.readyState !== WebSocket.OPEN)) return false;
  return true;
}
function releaseSessionDispatch(lease: SessionDispatchLease): void {
  dispatchOwnerGenerations.delete(lease.token);
  if (!dispatchReservations.release(lease)) return;
  const key = scopedSessionKey(lease.runnerId, lease.sessionId);
  if (!pendingDispatchFlush.delete(key)) return;
  queueMicrotask(() => { void maybeFlushQueue(lease.runnerId, lease.sessionId, false); });
}
function replayRoute(ws: WebSocket, runnerId: string, sid: string): void {
  if (routeAborts.has(scopedSessionKey(runnerId, sid))) send(ws, { t: "auto_route", sessionId: sid, state: "started" });
}
/** Per-runner authorization — the "access to the Hub == a shell on the machine" boundary. The owner
 *  reaches every machine; a member only the runners granted in their invite (auth.grants). Auth off =
 *  fully trusted. This is the DRIVE gate (select + act), enforced for BOTH the local machine and remote
 *  runners, so it also covers the default unselected case (activeRunner falls back to LOCAL_ID). */
function canUseRunner(ws: WebSocket, rid: string): boolean {
  if (!auth.AUTH_ENABLED) return true;
  const p = principalOf(ws);
  if (!p) return false;
  if (p.role === "owner") return true;
  return auth.canAccessRunner(p.userId, rid);
}
function allowedRunnerIds(ws: WebSocket): string[] {
  return [...new Set([LOCAL_ID, ...runners.keys(), ...Object.keys(runnerLabels)])].filter((runnerId) => canUseRunner(ws, runnerId));
}
function messageSessionScope(ws: WebSocket, msg: any): { runnerId: string; sessionIds: string[] } | undefined {
  const runnerId = msg.t === "sendTo" ? LOCAL_ID : activeRunner(ws);
  const sessionIds: string[] = Array.isArray(msg.sessionIds)
    ? msg.sessionIds.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
    : typeof msg.sessionId === "string" && msg.sessionId ? [msg.sessionId] : [];
  if (!sessionIds.length && ["send", "voice", "cancel"].includes(msg.t)) {
    const viewed = subs.get(ws); if (viewed) sessionIds.push(viewed);
  }
  return sessionIds.length ? { runnerId, sessionIds: [...new Set(sessionIds)] } : undefined;
}
// The session ops that act on a machine (local or the selected runner). A member without a grant for
// the target machine may not run any of these — mirrors the forwarded-op list below.
const RUNNER_OPS = new Set(["list", "open", "send", "new", "listdir", "configure", "readfile", "readdiff", "delete", "dropLast", "getWorktreePreview"]);
// Ops that ALWAYS read or execute the LOCAL (Hub) machine's own sessions, regardless of which runner
// is selected — they never take the remote-forward path. These were NOT in RUNNER_OPS, so a member
// without local access reached them: `sendTo` executes a turn ON THE HUB (normally full-access),
// and search/summary read every local session. Gate them on LOCAL_ID like any other machine op.
const LOCAL_OPS = new Set(["sendTo", "sendNew", "search"]);
// Ops that act on the CURRENTLY SELECTED machine (local by default, or a remote the member may see):
// the hub-owned queue flushes to it, cancel routes to it, summarize pulls its history. Gate on the
// active runner so a member may drive only a machine they were granted.
const ACTIVE_OPS = new Set(["enqueue", "dequeue", "clearqueue", "flushqueue", "cancel", "summarize", "voice", "council_start", "tournament_start", "debate_start", "debate_say", "memory_preview", "stage_voice", "stage_text", "stage_confirm", "stage_cancel", "stage_state", "stage_escalate_ok", "stage_escalate_no"]);
const UPDATE_BLOCKED_OPS = new Set(["send", "sendTo", "sendNew", "voice", "new", "configure", "enqueue", "flushqueue", "execution_delegate", "council_start", "tournament_start", "debate_start", "summarize", "digest", "routine_run", "terminal_open"]);
function holdForHubUpdate(ws: WebSocket, msg: any): boolean {
  if (!hubUpdateInProgress || !UPDATE_BLOCKED_OPS.has(msg.t)) return false;
  const runnerId = activeRunner(ws);
  const queueRunnerId = runnerId !== LOCAL_ID ? runnerId : undefined;
  const enqueue = (sid: string, text: string, atts: any[] = []): void => {
    if (typeof msg.msgId === "string" && !incomingTurns.add(msg.msgId)) return;
    enqueueChatTurn(runnerId, sid, {
      text,
      atts: Array.isArray(atts) ? atts : [],
      model: typeof msg.model === "string" ? msg.model : undefined,
      effort: typeof msg.effort === "string" ? msg.effort : undefined,
      auto: autoFlags(msg.auto),
      runnerId: queueRunnerId,
      msgId: typeof msg.msgId === "string" ? msg.msgId : undefined,
      actor: actorOf(ws, "queue"),
    });
    send(ws, { t: "queued", runnerId, sessionId: sid, text, update: true, message: "Atualização em andamento — mensagem ficou na fila e roda quando o Hub voltar." });
  };
  if (msg.t === "send" && typeof msg.text === "string") {
    enqueue((typeof msg.sessionId === "string" && msg.sessionId) || subs.get(ws) || "default", msg.text, msg.attachments);
    return true;
  }
  if (msg.t === "sendTo" && typeof msg.sessionId === "string" && typeof msg.text === "string") {
    enqueue(msg.sessionId, msg.text, msg.attachments);
    return true;
  }
  if (msg.t === "enqueue" && typeof msg.sessionId === "string") {
    enqueue(msg.sessionId, typeof msg.text === "string" ? msg.text : "(anexo)", msg.attachments);
    return true;
  }
  if (msg.t === "flushqueue" && typeof msg.sessionId === "string") {
    send(ws, { t: "queued", runnerId, sessionId: msg.sessionId, text: "", update: true, message: "Atualização em andamento — a fila roda automaticamente quando o Hub voltar." });
    return true;
  }
  send(ws, { t: "error", message: "Hub drenando para atualização — esta ação fica disponível após reconectar" });
  return true;
}
/** Client sockets (not runner sockets) currently viewing a given machine. */
function clientsOn(runnerId: string): WebSocket[] {
  const out: WebSocket[] = [];
  for (const c of wss.clients) { const w = c as WebSocket; if (!runnerSockets.has(w) && activeRunner(w) === runnerId) out.push(w); }
  return out;
}
/** The machines a connection may see. Filtered by per-runner access so a member's machine bar shows
 *  ONLY the runners granted in their invite — closes the residual name-visibility leak left by the
 *  drive-only authz gate. No ws (internal callers) → unfiltered. Owner / auth-off → everything. */
function machineList(ws?: WebSocket): any[] {
  return [...runners.values()].filter((r) => !ws || canUseRunner(ws, r.id)).map((r) => {
    const commit = r.local ? hubCommit : (r.info.commit || "");
    // Human-readable build (git describe). Falls back to the sha for a runner too old to report it.
    const build = r.local ? hubBuild : (r.info.build || "");
    // "stale" = an online remote runner whose build differs from the Hub's (drift you can act on).
    const online = r.local || (!!r.ws && r.ws.readyState === WebSocket.OPEN);
    const stale = !r.local && online && !!commit && !!hubCommit && !sameBuild(commit, hubCommit);
    const since = offlineSince.get(r.id);
    const offlineMs = online || !since ? 0 : Date.now() - since;
    return {
      id: r.id, label: runnerLabels[r.id] || r.info.host || r.id, host: r.info.host, os: r.info.os,
      agents: r.local ? (localAgentsReady ? localAgents : agents.names()) : (r.info.agents || []), agentDescriptors: r.info.agentDescriptors || [],
      protocolVersion: r.info.protocolVersion || 1, compatible: (r.info.protocolVersion || 1) === RUNNER_PROTOCOL_VERSION,
      // O NÚMERO do outro lado: "incompatível" sem dizer com o quê deixa o dono sem saber o tamanho
      // do atraso — nem se a máquina está andando entre uma tentativa e outra.
      hubProtocolVersion: RUNNER_PROTOCOL_VERSION,
      online, local: !!r.local, commit, hubCommit, build, hubBuild, stale, offlineMs, updatePending: pendingRunnerUpdates[r.id] || null,
    };
  });
}
// Prolonged-offline alert: the immediate drop already pushes once; this fires a SECOND alert when a
// machine is STILL down past the threshold (the one you actually want to act on — a brief blip is
// noise), exactly once per outage. Cheap 60s sweep; unref'd so it never holds the process open.
if (OFFLINE_ALERT_MS > 0) setInterval(() => {
  const now = Date.now();
  for (const [rid, since] of offlineSince) {
    if (offlineAlerted.has(rid) || now - since < OFFLINE_ALERT_MS) continue;
    offlineAlerted.add(rid);
    const rc = runners.get(rid); const label = runnerLabels[rid] || rc?.info.host || rid;
    notifyEvent("machine", `${label} segue offline há ${Math.round((now - since) / 60000)} min`, "A máquina não voltou — sessões nela seguem sem resposta.");
  }
}, 60000).unref?.();
function broadcastMachines(): void { for (const c of wss.clients) { const w = c as WebSocket; if (!runnerSockets.has(w)) send(w, { t: "machines", machines: machineList(w) }); } }
function sendToRunner(rc: RunnerConn, obj: unknown): boolean { if (rc.ws && rc.ws.readyState === WebSocket.OPEN) { rc.ws.send(JSON.stringify(obj)); return true; } return false; }
const terminalOwners = new Map<string, string>(); // terminalId -> runnerId
const terminalWatchers = new Map<string, Set<WebSocket>>(); // terminalId -> UI sockets that opened/listed it
function rememberTerminalWatcher(terminalId: unknown, ws?: WebSocket): void {
  if (!ws || typeof terminalId !== "string" || !terminalId) return;
  let set = terminalWatchers.get(terminalId);
  if (!set) { set = new Set(); terminalWatchers.set(terminalId, set); }
  set.add(ws);
}
function broadcastTerminal(runnerId: string, frame: Record<string, unknown>): void {
  const terminalId = typeof frame.terminalId === "string" ? frame.terminalId : (frame.terminal as any)?.id;
  const targets = new Set<WebSocket>(clientsOn(runnerId));
  if (typeof terminalId === "string") for (const ws of terminalWatchers.get(terminalId) || []) targets.add(ws);
  for (const c of targets) if (c.readyState === c.OPEN) send(c, { ...frame, runnerId });
  if (frame.t === "terminal_closed" && typeof terminalId === "string") terminalWatchers.delete(terminalId);
}
const localTerminals = new TerminalManager({
  defaultCwd: CWD,
  max: Math.max(1, Number(process.env.JARVIS_TERMINAL_MAX || 4)),
  onOutput: (terminal, data) => broadcastTerminal(LOCAL_ID, { t: "terminal_output", terminalId: terminal.id, data }),
  onExit: (terminal, exitCode, signal) => {
    terminalOwners.delete(terminal.id);
    broadcastTerminal(LOCAL_ID, { t: "terminal_closed", terminalId: terminal.id, exitCode, signal });
  },
});
function openLocalTerminal(ws: WebSocket, msg: any): void {
  try {
    const cwd = typeof msg.cwd === "string" && msg.cwd ? msg.cwd : sessionCwd(subs.get(ws));
    const terminal = localTerminals.open({ cwd, shell: msg.shell, title: msg.title, cols: msg.cols, rows: msg.rows });
    terminalOwners.set(terminal.id, LOCAL_ID);
    rememberTerminalWatcher(terminal.id, ws);
    auth.audit("terminal_open", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${terminal.id}: ${terminal.cwd}` });
    broadcastTerminal(LOCAL_ID, { t: "terminal_opened", reqId: msg.reqId, terminal });
  } catch (error: any) {
    send(ws, { t: "terminal_error", reqId: msg.reqId, runnerId: LOCAL_ID, message: String(error?.message ?? error) });
  }
}
function terminalRunner(msg: any, ws: WebSocket): string {
  return typeof msg.runnerId === "string" && msg.runnerId ? msg.runnerId
    : typeof msg.terminalId === "string" && terminalOwners.get(msg.terminalId) ? terminalOwners.get(msg.terminalId)!
    : activeRunner(ws);
}

function queueRunnerUpdate(runnerId: string, targetCommit: string, opts?: { force?: boolean }): PendingRunnerUpdate {
  const existing = pendingRunnerUpdates[runnerId];
  if (existing && commitMatches(existing.targetCommit, targetCommit) && existing.state !== "blocked") {
    if (opts?.force && !existing.force) { existing.force = true; savePendingRunnerUpdates(); }
    return existing;
  }
  const pending: PendingRunnerUpdate = { requestId: randomUUID(), targetCommit: targetCommit.replace("+dirty", ""), requestedAt: Date.now(), state: "queued", force: opts?.force === true };
  pendingRunnerUpdates[runnerId] = pending; savePendingRunnerUpdates(); return pending;
}
function updateMachineNotice(runnerId: string, payload: Record<string, unknown>): void {
  const rc = runners.get(runnerId), label = runnerLabels[runnerId] || rc?.info.host || runnerId;
  for (const c of updateWatchers) send(c, { t: "update_machine", runnerId, label, ...payload });
  broadcastMachines();
}
function normalizePendingRunnerUpdate(rc: RunnerConn): PendingRunnerUpdate | null {
  const pending = pendingRunnerUpdates[rc.id];
  if (!pending) return null;
  if (pending.state === "blocked") return pending;
  // Re-aim at the Hub's current commit when it moved past the pinned target (shared, unit-tested
  // policy — see update-retarget.ts). null → the pinned target is still the Hub's commit, keep it.
  const target = retargetTarget(pending, hubCommit);
  if (!target) return pending;
  const clean = !!rc.info.commit && !rc.info.commit.includes("+dirty");
  if (clean && commitMatches(rc.info.commit || "", target) && (rc.info.protocolVersion || 1) === RUNNER_PROTOCOL_VERSION) {
    delete pendingRunnerUpdates[rc.id]; savePendingRunnerUpdates();
    auth.audit("update_machine_verified", { runnerId: rc.id, detail: `${runnerLabels[rc.id] || rc.info.host || rc.id}: fila antiga ${pending.targetCommit} descartada; já está em ${rc.info.commit}` });
    updateMachineNotice(rc.id, { ok: true, verified: true, state: "verified", behind: 0, log: `fila antiga ${pending.targetCommit} descartada; máquina já está em ${rc.info.commit}` });
    return null;
  }
  const previousTarget = pending.targetCommit;
  pending.requestId = randomUUID();
  pending.targetCommit = target;
  pending.requestedAt = Date.now();
  pending.state = "queued";
  pending.fromCommit = undefined;
  pending.lastAttemptAt = undefined;
  // Reapontar NÃO é falhar. Enquanto isso morava em `lastError`, a tela lia o campo como defeito e
  // anunciava "falhou" para uma máquina que estava só seguindo um alvo novo. E a falha ANTERIOR se
  // referia a um alvo que não existe mais: mantê-la seria acusar um problema já sem sujeito.
  pending.lastNote = `alvo anterior ${previousTarget} substituído por ${target}`;
  pending.lastError = undefined; pending.lastLogTail = undefined; pending.lastPhase = undefined; pending.failures = 0;
  savePendingRunnerUpdates();
  updateMachineNotice(rc.id, { state: "queued", queued: true, ok: false, log: pending.lastNote });
  return pending;
}
function deliverPendingRunnerUpdate(rc: RunnerConn, opts?: { force?: boolean; allowBlocked?: boolean; retryNow?: boolean }): boolean {
  const pending = normalizePendingRunnerUpdate(rc);
  if (!pending || !rc.ws || rc.ws.readyState !== WebSocket.OPEN) return false;
  if (pending.state === "blocked" && !opts?.allowBlocked) return false;
  if (pending.lastAttemptAt && Date.now() - pending.lastAttemptAt < 30_000 && !opts?.retryNow) return false;
  if (opts?.force && !pending.force) { pending.force = true; savePendingRunnerUpdates(); }
  // UPD-02 — o CORPO do updater vai junto, gerado AQUI. Enquanto cada máquina gerava o próprio, um
  // defeito no updater era incorrigível justamente em quem precisava do conserto: o conserto viajava
  // dentro do update que aquela máquina não conseguia executar. O hash acompanha para a máquina
  // recusar o que chegou torto — e para o que rodou ficar auditável dos dois lados.
  const podeReceberScript = (rc.info.protocolVersion || 1) >= RUNNER_CAPABILITY_SINCE.updaterFromHub;
  const corpo = podeReceberScript ? windowsUpdaterBody() : undefined;
  const corpoSha = corpo ? createHash("sha256").update(corpo, "utf8").digest("hex") : undefined;
  if (corpoSha && pending.scriptSha256 !== corpoSha) { pending.scriptSha256 = corpoSha; savePendingRunnerUpdates(); }
  const sent = sendToRunner(rc, { t: "update", requestId: pending.requestId, targetCommit: pending.targetCommit, force: !!(opts?.force || pending.force), script: corpo, scriptSha256: corpoSha });
  if (sent) { if (!pending.fromCommit && rc.info.commit) pending.fromCommit = rc.info.commit; pending.state = "sent"; pending.lastAttemptAt = Date.now(); pending.lastError = undefined; pending.stalled = false; pending.stalledNotifiedAt = undefined; pending.awaitingSince = undefined; savePendingRunnerUpdates(); updateMachineNotice(rc.id, { state: "sent", queued: true, ok: false, log: "solicitação entregue; máquina drenando" }); }
  return sent;
}
function runnerUpdateDraining(runnerId: string): boolean {
  const pending = pendingRunnerUpdates[runnerId];
  return !!pending && pending.state !== "blocked";
}
function completePendingRunnerUpdate(rc: RunnerConn, m: any): void {
  const pending = pendingRunnerUpdates[rc.id];
  const label = runnerLabels[rc.id] || rc.info.host || rc.id;
  auth.audit("update_machine", { runnerId: rc.id, detail: `${label}: ${m.ok ? "preparada" : "falhou"}${m.dirty ? " (repo sujo)" : ""}` });
  console.log(`[hub] update ${label}: ${m.ok ? "preparada" : "falhou"} — ${String(m.log || "").split("\n")[0]}`);
  if (pending && (!m.requestId || m.requestId === pending.requestId)) {
    const blocked = !!m.dirty || m.retryable === false;
    if (m.ok) { pending.state = "awaiting_restart"; pending.lastError = undefined; pending.awaitingSince = Date.now(); pending.stalled = false; pending.stalledNotifiedAt = undefined; }
    else { pending.state = blocked ? "blocked" : "queued"; pending.lastError = String(m.log || "falha sem detalhe").slice(0, 3000); }
    savePendingRunnerUpdates();
    if (!m.ok && !blocked) setTimeout(() => { const current = pendingRunnerUpdates[rc.id]; if (current?.requestId === pending.requestId && current.state === "queued") deliverPendingRunnerUpdate(rc, { retryNow: true }); }, UPDATE_RETRY_MS).unref?.();
  }
  const state = m.ok ? "awaiting_restart" : ((m.dirty || m.retryable === false) ? "blocked" : "queued");
  updateMachineNotice(rc.id, { ok: !!m.ok, dirty: !!m.dirty, behind: m.behind ?? 0, state, queued: !m.ok, log: String(m.log || "").slice(0, 3000), rolledBack: !!m.rolledBack });
}
/** UPD-01 Fase 2 — out-of-band failure report from a runner's DETACHED updater (POST /runner-update-report).
 *  A runner can die mid-update (crash-loop, orphan lock, the ~30-min-offline incident) and never send
 *  update_done over its socket. This HTTP path survives that, so the owner learns WHERE and WHY it failed.
 *  Diagnostic only: it records the phase/lastError + alerts once per phase; it NEVER drives the update
 *  state machine (the WS `update_done`/reconnect path owns state — two writers would race). */
function recordRunnerUpdateReport(runnerId: string, r: { requestId?: string; phase?: string; ok?: boolean; error?: string; logTail?: string; targetCommit?: string; scriptSha256?: string; scriptFromHub?: boolean }): void {
  const label = runnerLabels[runnerId] || runners.get(runnerId)?.info.host || runnerId;
  const phase = String(r.phase || "?").slice(0, 40);
  const failed = r.ok === false || phase === "error";
  const detail = String(r.error || r.logTail || "").replace(/\s+/g, " ").trim().slice(0, 500);
  // O RASTRO do updater (últimas linhas do log) vai junto, e não só a mensagem: quando as duas
  // coisas existem, `error` eclipsava o `logTail` e o único registro que sobrava era uma linha do
  // tipo "git saiu com código 1" — que não diz nem qual comando falhou. Foi exatamente o que
  // manteve uma máquina sem atualizar por semanas sem ninguém conseguir apontar a causa.
  const tail = String(r.logTail || "").replace(/\s+/g, " ").trim().slice(0, 1500);
  log[failed ? "warn" : "info"]("update_report", { runnerId, label, phase, ok: r.ok !== false, targetCommit: r.targetCommit, error: failed ? detail : undefined, tail: failed && tail && tail !== detail ? tail : undefined });
  const pending = pendingRunnerUpdates[runnerId];
  const prevPhase = pending?.lastPhase;
  if (pending && (!r.requestId || r.requestId === pending.requestId)) {
    pending.lastPhase = phase; pending.lastReportAt = Date.now();
    if (failed && detail) pending.lastError = `[${phase}] ${detail}`.slice(0, 3000);
    if (failed && tail) pending.lastLogTail = tail;
    // Contar as falhas é o que transforma "falhou" em "está em LOOP". Uma máquina que tenta e falha
    // a cada reinício parece, num relatório só, igual a uma que falhou uma vez — e as duas pedem
    // ações diferentes: esperar contra intervir.
    if (failed) pending.failures = (pending.failures || 0) + 1;
    // Qual updater rodou de fato. Divergir do que o Hub enviou é sinal — e sem isso, depois da
    // UPD-02, "falhou" deixaria de dizer QUAL script falhou, que é a primeira pergunta.
    if (typeof r.scriptSha256 === "string" && r.scriptSha256) {
      if (pending.scriptSha256 && pending.scriptSha256 !== r.scriptSha256) {
        log.warn("update_script_divergente", { runnerId, enviado: pending.scriptSha256.slice(0, 12), executado: r.scriptSha256.slice(0, 12), fromHub: !!r.scriptFromHub });
      }
      pending.scriptRanSha256 = r.scriptSha256;
      pending.scriptFromHub = !!r.scriptFromHub;
    }
    savePendingRunnerUpdates();
  }
  updateMachineNotice(runnerId, { state: pending?.state, phase, ok: r.ok !== false, log: failed ? detail : `updater: ${phase}` });
  // Alert the owner only on a genuine failure, and only once per distinct phase, so a crash-loop
  // phoning home every few seconds can't spam notifications.
  if (failed && prevPhase !== phase) notifyEvent("machine", `${label}: falha na atualização (${phase})`, detail || "O updater reportou falha antes de concluir.");
}
function verifyOrDeliverRunnerUpdate(rc: RunnerConn): void {
  const pending = normalizePendingRunnerUpdate(rc); if (!pending) return;
  if (pending.state === "blocked") return;
  const receipt = rc.info.updateReceipt, clean = !!rc.info.commit && !rc.info.commit.includes("+dirty"), changedCommit = !!pending.fromCommit && !commitMatches(pending.fromCommit, pending.targetCommit);
  const receiptMatches = !!receipt && receipt.requestId === pending.requestId && commitMatches(receipt.targetCommit, pending.targetCommit) && commitMatches(receipt.current, pending.targetCommit);
  if (clean && commitMatches(rc.info.commit || "", pending.targetCommit) && (rc.info.protocolVersion || 1) === RUNNER_PROTOCOL_VERSION && (receiptMatches || changedCommit)) {
    delete pendingRunnerUpdates[rc.id]; savePendingRunnerUpdates();
    auth.audit("update_machine_verified", { runnerId: rc.id, detail: `${runnerLabels[rc.id] || rc.info.host || rc.id}: ${rc.info.commit || pending.targetCommit}` });
    updateMachineNotice(rc.id, { ok: true, verified: true, state: "verified", behind: 1, log: `reiniciou e reconectou em ${rc.info.commit || pending.targetCommit}` }); flushQueuesForRunner(rc.id); return;
  }
  deliverPendingRunnerUpdate(rc, { retryNow: true });
}
/** UPD-01 Fase 2 — the Hub advanced its own HEAD: re-aim every in-flight runner update at the new
 *  commit and re-deliver to the ones online; offline ones get their record re-aimed for the next
 *  reconnect. Reuses the existing verify/normalize path so retarget + delivery stay in one place. */
function sweepRetargetPendingUpdates(): void {
  for (const id of Object.keys(pendingRunnerUpdates)) {
    const rc = runners.get(id);
    if (!rc) continue;
    if (rc.ws && rc.ws.readyState === WebSocket.OPEN) verifyOrDeliverRunnerUpdate(rc);
    else normalizePendingRunnerUpdate(rc);
  }
}

function currentFrameworkManifest(): FrameworkManifest {
  return readCanonicalFramework(frameworkRoot(), frameworkCfg.version);
}
/** Trim an import preview for the wire: the client needs the scan/validation/inventory/conflicts to
 *  decide, but NOT the full file contents (those stay server-side in the pending-import map). */
function previewPayload(p: ReturnType<typeof buildImportPreview>) {
  return {
    files: p.files.map((f) => ({ path: f.path })),
    fileCount: p.files.length,
    skipped: p.skipped,
    scan: { counts: p.scan.counts, blocked: p.scan.blocked, findings: p.scan.findings },
    validation: { ok: p.validation.ok, errors: p.validation.errors, warnings: p.validation.warnings, issues: p.validation.issues },
    conformance: p.conformance,
    manifest: p.manifest,
    projection: p.projection,
    inventory: p.inventory,
    conflicts: p.conflicts,
    hash: p.hash,
    counts: p.counts,
    identical: p.identical,
  };
}
/** Deliver a queued Framework publish to a connected, protocol-compatible runner. Reads the CURRENT
 *  canonical tree so a machine that was offline gets the latest version, not a stale snapshot. */
function deliverPendingFrameworkPublish(rc: RunnerConn): boolean {
  const pending = pendingFrameworkPublish[rc.id];
  if (!pending || rc.local || !rc.ws || rc.ws.readyState !== WebSocket.OPEN) return false;
  if ((rc.info.protocolVersion || 1) < 7) return false; // old runner can't materialize; keep it queued
  const manifest = currentFrameworkManifest();
  const sent = sendToRunner(rc, { t: "framework_publish", requestId: pending.requestId, version: manifest.version, hash: manifest.hash, files: manifest.files });
  if (sent) { pending.lastAttemptAt = Date.now(); pending.targetHash = manifest.hash; pending.targetVersion = manifest.version; savePendingFrameworkPublish(); }
  return sent;
}
// Redeliver to machines that reconnected without an explicit register (or transiently failed).
setInterval(() => {
  for (const [id, pending] of Object.entries(pendingFrameworkPublish)) {
    if (pending.lastAttemptAt && Date.now() - pending.lastAttemptAt < 60_000) continue;
    const rc = runners.get(id); if (rc && rc.ws && rc.ws.readyState === WebSocket.OPEN) deliverPendingFrameworkPublish(rc);
  }
}, 60_000).unref?.();

let hubUpdateInProgress = false;
async function drainHubForUpdate(deadlineMs = 120_000): Promise<string | null> {
  const started = Date.now();
  while ((activeRuns.size || localManagedRuns.size || routeAborts.size || asking.size || voiceOpBusy) && Date.now() - started < deadlineMs) await new Promise((resolve) => setTimeout(resolve, 1000));
  const remaining = activeRuns.size + localManagedRuns.size + routeAborts.size + asking.size + (voiceOpBusy ? 1 : 0);
  return remaining ? `não foi possível drenar ${remaining} trabalho(s) local(is) em ${Math.round(deadlineMs / 1000)}s; nenhum arquivo foi alterado` : null;
}
function knownRemoteRunnerIds(): string[] { return [...new Set([...Object.keys(runnerLabels), ...runners.keys()])].filter((id) => id !== LOCAL_ID); }
async function applyHubUpdate(force: boolean, allMachines: boolean): Promise<any> {
  if (hubUpdateInProgress) return { ok: false, busy: true, log: "outra atualização do Hub já está em andamento" };
  const preflight = await updateCheck(UPDATE_ROOT, true);
  if (!preflight.supported || preflight.error) return { ok: false, log: preflight.error || "auto-update não suportado" };
  if (!preflight.clean && !force) return { ok: false, dirty: true, log: "há alterações locais não commitadas no Hub — nenhuma máquina foi alterada" };
  if ((preflight.ahead || 0) > 0 && !force) return { ok: false, dirty: true, log: `Hub possui ${preflight.ahead} commit(s) local(is) fora de origin/${preflight.branch} — nenhuma máquina foi alterada` };
  const target = (preflight.latest?.sha || preflight.current || hubCommit).replace("+dirty", "");
  const remoteIds = allMachines ? knownRemoteRunnerIds() : [];
  // Hub already healthy/current: runners can be repaired independently without bouncing the Hub.
  if (allMachines && preflight.behind === 0 && preflight.clean && (preflight.ahead || 0) === 0) {
    for (const id of remoteIds) { queueRunnerUpdate(id, target, { force: true }); const rc = runners.get(id); if (rc) deliverPendingRunnerUpdate(rc); }
    broadcastMachines();
    return { ok: true, behind: 0, restartRequired: false, log: remoteIds.length ? `Hub já está atualizado; ${remoteIds.length} máquina(s) enfileirada(s), inclusive as offline` : "Hub atualizado; nenhuma máquina remota cadastrada" };
  }
  hubUpdateInProgress = true;
  broadcastAll({ t: "update_progress", message: "Drenando trabalhos locais antes de atualizar…" });
  const drainError = await drainHubForUpdate();
  if (drainError) { hubUpdateInProgress = false; flushAllQueues(); return { ok: false, log: drainError }; }
  const created: Array<[string, string]> = [];
  if (allMachines) for (const id of remoteIds) { const before = pendingRunnerUpdates[id]?.requestId; const p = queueRunnerUpdate(id, target, { force: true }); if (p.requestId !== before) created.push([id, p.requestId]); }
  if (allMachines) { broadcastMachines(); broadcastAll({ t: "update_progress", message: `Hub drenado; ${remoteIds.length} máquina(s) ficaram na fila persistente. Preparando o Hub…`, queued: remoteIds.map((id) => runnerLabels[id] || id) }); }
  const result = await updateApply(UPDATE_ROOT, { force, targetCommit: target });
  if (!result.ok) {
    for (const [id, requestId] of created) if (pendingRunnerUpdates[id]?.requestId === requestId) delete pendingRunnerUpdates[id];
    if (created.length) savePendingRunnerUpdates();
    hubUpdateInProgress = false; broadcastMachines(); flushAllQueues(); return result;
  }
  if (result.restartRequired !== false) scheduleRestart(); else { hubUpdateInProgress = false; flushAllQueues(); }
  return result;
}
async function queueAllRemoteRunnerUpdates(): Promise<{ ok: boolean; queued: number; delivered: number; target?: string; error?: string }> {
  const status = await updateCheck(UPDATE_ROOT, true);
  if (!status.supported || status.error) return { ok: false, queued: 0, delivered: 0, error: status.error || "auto-update não suportado" };
  const target = (status.latest?.sha || status.current || hubCommit).replace("+dirty", "");
  let delivered = 0; const ids = knownRemoteRunnerIds();
  for (const id of ids) { queueRunnerUpdate(id, target, { force: true }); const rc = runners.get(id); if (rc && deliverPendingRunnerUpdate(rc)) delivered++; }
  broadcastMachines(); return { ok: true, queued: ids.length, delivered, target };
}
// Lost update_done and transient Git/network failures must self-heal even when the runner's WebSocket
// stays connected (there would otherwise be no reconnect event to re-deliver the durable request).
setInterval(() => {
  const now = Date.now();
  for (const [id, pending] of Object.entries(pendingRunnerUpdates)) {
    if (pending.state === "blocked") continue;
    if (pending.state === "awaiting_restart") {
      // Watchdog: it applied the update and should have restarted+reconnected fast. Offline past the
      // stall window means the restart/updater hung and it won't come back on its own — alert ONCE.
      const rc0 = runners.get(id), online = id === LOCAL_ID || !!rc0?.ws;
      if (updateStalled(pending, { online, now, stallMs: UPDATE_STALL_MS })) {
        pending.stalled = true; pending.stalledNotifiedAt = now; savePendingRunnerUpdates();
        const label = runnerLabels[id] || rc0?.info.host || id;
        const mins = Math.round((now - (pending.awaitingSince || pending.lastAttemptAt || pending.requestedAt || now)) / 60000);
        log.warn("update_stalled", { runnerId: id, label, offlineMin: mins, targetCommit: pending.targetCommit });
        notifyEvent("machine", `${label} travou na atualização`, "Aplicou a atualização mas o reinício não concluiu — a máquina não voltou. Verifique o updater/serviço dela.");
        updateMachineNotice(id, { ok: false, stalled: true, state: "stalled", log: `reinício não concluiu — offline há ${mins} min após aplicar a atualização` });
      }
      continue;
    }
    if (pending.lastAttemptAt && now - pending.lastAttemptAt < UPDATE_RETRY_MS) continue;
    const rc = runners.get(id); if (rc) deliverPendingRunnerUpdate(rc, { retryNow: true });
  }
}, Math.min(60_000, UPDATE_RETRY_MS)).unref?.();

// Waiters for a runner's next session list (visão unificada, busca cross-machine, purge "ok" do admin).
// Ver runnerListWaiters.ts: um slot único por runner fazia pedidos concorrentes se atropelarem, e a
// máquina sumia da visão unificada de forma intermitente.
const pendingRunnerList = new RunnerListWaiters();
// Voice features (resumir/digest) run ON THE HUB, so for a session that lives on another machine
// they need to pull it over the wire — the hub keeps no copy of a runner's sessions. Keyed by
// reqId, resolved by the runner's {t:history}/{t:sessions} reply, and always timed out so a
// silent runner degrades instead of hanging the single-flight voice lock.
interface RunnerHistoryScope {
  ws?: WebSocket;
  principalId?: string;
  generation?: SessionOwnerGeneration;
}
interface PendingRunnerHistory extends RunnerHistoryScope {
  runnerId: string;
  sessionId: string;
  generation: SessionOwnerGeneration;
  resolve: (history: any) => void;
}
const pendingRunnerHist = new Map<string, PendingRunnerHistory>();
const pendingRunnerUsage = new Map<string, (u: any) => void>();
interface ExecutionReplayRequest { runnerId: string; rootExecutionId: string; replace: boolean; events: ExecutionEvent[]; }
const executionReplayRequests = new Map<string, ExecutionReplayRequest>();
interface ExecutionPrincipalHint { principalId: string; expiresAt: number; }
const executionPrincipalHints = new Map<string, ExecutionPrincipalHint>();
function executionTurnKey(runnerId: string, turnId: string): string { return `${runnerId}\u0000${turnId}`; }
function rememberExecutionPrincipal(runnerId: string, turnId: string, principalId: string): void {
  executionPrincipalHints.set(executionTurnKey(runnerId, turnId), { principalId, expiresAt: Date.now() + 6 * 60 * 60_000 });
  if (executionPrincipalHints.size > 2_000) {
    const now = Date.now();
    for (const [key, hint] of executionPrincipalHints) if (hint.expiresAt <= now || executionPrincipalHints.size > 1_500) executionPrincipalHints.delete(key);
  }
}
/**
 * Uma porta nova para o cofre não pode ser invisível para quem é dono dele: máquina com a ponte de
 * tarefas ativa se anuncia na sessão, uma vez por sessão. Nasce no primeiro turno — antes disso a
 * ponte ainda não teve como ser usada, e um aviso na abertura da tela seria ruído por antecipação.
 */
const bridgeAnnounced = new Set<string>();
function announceTaskBridge(rc: RunnerConn, sessionId: string): void {
  const ponte = !!rc.info.taskBridge, edicao = rc.info.taskMcpRemoteEdit !== false && (rc.info.protocolVersion || 1) >= RUNNER_CAPABILITY_SINCE.taskMcpConfig;
  if ((!ponte && !edicao) || !sessionId) return;
  const key = `${rc.id}:${sessionId}`;
  if (bridgeAnnounced.has(key)) return;
  bridgeAnnounced.add(key);
  // UMA linha para as duas portas. Dois avisos por sessão sobre a mesma máquina viram o ruído que
  // ninguém lê — e aí o aviso que importa também deixa de ser lido.
  const partes = [
    ponte ? "a IA busque e crie tarefas pela conta do projeto (criar sempre pede sua aprovação) — desligue com JARVIS_TASK_BRIDGE=0" : "",
    edicao ? "os servidores MCP dela sejam configurados pela tela — desligue com JARVIS_TASK_MCP_REMOTE_EDIT=0" : "",
  ].filter(Boolean);
  broadcastOn(rc.id, sessionId, { t: "notice", message: `Esta máquina (${rc.info.label || rc.info.host || rc.id}) permite que ${partes.join("; e que ")}. As chaves ficam no runner.env dela.` });
}
function sendOwnedRunnerTurn(rc: RunnerConn, sessionId: string, turnId: string, principalId: string, frame: Record<string, unknown>): boolean {
  const key = executionTurnKey(rc.id, turnId);
  rememberExecutionPrincipal(rc.id, turnId, principalId);
  announceTaskBridge(rc, sessionId);
  if (sendToRunner(rc, { ...frame, sessionId, turnId })) return true;
  executionPrincipalHints.delete(key);
  return false;
}
function claimRemoteExecutionOwner(rc: RunnerConn, event: ExecutionEvent): void {
  if (executionOwnership.get(rc.id, event.rootExecutionId)) return;
  const hint = executionPrincipalHints.get(executionTurnKey(rc.id, event.rootTurnId));
  if (!hint || hint.expiresAt <= Date.now()) return;
  executionOwnership.claim(rc.id, event.rootExecutionId, hint.principalId);
}
function requestExecutionReplay(rc: RunnerConn, rootExecutionId: string, afterSeq: number, replace = false, prior: ExecutionEvent[] = []): void {
  const reqId = `exec-${randomUUID()}`;
  executionReplayRequests.set(reqId, { runnerId: rc.id, rootExecutionId, replace, events: prior });
  if (!sendToRunner(rc, { t: "execution_read", reqId, rootExecutionId, afterSeq, limit: 500 })) executionReplayRequests.delete(reqId);
  else setTimeout(() => { if (executionReplayRequests.delete(reqId)) { mirrorExecutionStore(rc.id).setConnection(rootExecutionId, "desynced"); broadcastExecutionConnection(rc.id, "desynced"); } }, 15_000).unref?.();
}
function reconcileExecutionManifest(rc: RunnerConn, entries: ExecutionManifestEntry[]): void {
  const mirror = mirrorExecutionStore(rc.id), local = new Map(mirror.manifest().map((entry) => [entry.rootExecutionId, entry]));
  let requested = false;
  for (const remote of entries) {
    const known = local.get(remote.rootExecutionId);
    if (!known || known.journalId !== remote.journalId || known.lastSeq > remote.lastSeq) {
      requested = true; mirror.setConnection(remote.rootExecutionId, "reconciling"); requestExecutionReplay(rc, remote.rootExecutionId, 0, true); continue;
    }
    if (known.lastSeq < remote.lastSeq) {
      requested = true; mirror.setConnection(remote.rootExecutionId, "reconciling"); requestExecutionReplay(rc, remote.rootExecutionId, known.lastSeq); continue;
    }
    mirror.setConnection(remote.rootExecutionId, "online");
  }
  broadcastExecutionConnection(rc.id, requested ? "reconciling" : "online");
}
function askRunner<T>(map: Map<string, (v: any) => void>, key: string, sendIt: () => boolean, empty: T, ms = 8000): Promise<T> {
  return new Promise<T>((resolve) => {
    map.set(key, resolve as (v: any) => void);
    if (!sendIt()) { map.delete(key); resolve(empty); return; }
    setTimeout(() => { if (map.delete(key)) resolve(empty); }, ms);
  });
}
/** History of a session that lives on `rc` (remote). null if the runner doesn't answer. */
function runnerHistory(rc: RunnerConn, sessionId: string, scope: RunnerHistoryScope = {}): Promise<any> {
  const reqId = runnerRequestId("hub-history");
  const generation = scope.generation || captureSessionOwnerGeneration(rc.id, sessionId);
  return new Promise((resolve) => {
    pendingRunnerHist.set(reqId, { ...scope, principalId: scope.ws ? socketPrincipalId(scope.ws) : scope.principalId, runnerId: rc.id, sessionId, generation, resolve });
    if (!sendToRunner(rc, { t: "open", reqId, sessionId })) { pendingRunnerHist.delete(reqId); resolve(null); return; }
    setTimeout(() => { if (pendingRunnerHist.delete(reqId)) resolve(null); }, 8_000).unref?.();
  });
}
function runnerHistoryWaiterAuthorized(waiter: PendingRunnerHistory, rc: RunnerConn, sessionId: unknown): boolean {
  if (waiter.runnerId !== rc.id || sessionId !== waiter.sessionId) return false;
  if (!waiter.generation.snapshots.every((snapshot) => personalSessionBindings.matches(snapshot))) return false;
  if (waiter.ws && (socketPrincipalId(waiter.ws) !== waiter.principalId || !canUseRunner(waiter.ws, rc.id) || !canAccessSession(waiter.ws, rc.id, waiter.sessionId))) return false;
  const current = captureSessionOwnerGeneration(rc.id, waiter.sessionId);
  return !current.conflicted && (!current.principalId || !waiter.principalId || auth.sameIdentity(current.principalId, waiter.principalId));
}
function rememberRunnerHistoryState(rc: RunnerConn, m: any): boolean {
  const states = runnerSessionState.get(rc.id) || new Map<string, any>();
  states.set(m.sessionId, { ...(states.get(m.sessionId) || {}), id: m.sessionId, title: m.title, agent: m.agent, cwd: m.cwd, nativeId: m.nativeId, model: m.model, effort: m.effort, started: Number(m.total) > 0, source: /^(claude:|codex:)/.test(m.sessionId || "") ? "native" : "managed" });
  runnerSessionState.set(rc.id, states);
  try { synchronizePersonalSessionAliases(rc.id, m.sessionId); return true; }
  catch (error) { console.error(`[hub] alias remoto de ${rc.id}/${m.sessionId} recusado:`, String((error as Error)?.message || error)); return false; }
}
/** Session list of a remote machine, plus whether the machine actually ANSWERED. A silent runner and a
 *  runner with genuinely zero sessions both yield `[]`; only `answered` tells them apart, and the
 *  unified view needs that difference to say "esta máquina não respondeu" instead of showing nothing. */
function runnerSessionsResult(rc: RunnerConn): Promise<{ answered: boolean; sessions: any[] }> {
  return new Promise((resolve) => {
    // cancel/timer are declared BEFORE finish() can reach them: the send-failure path below calls
    // finish synchronously, and a const captured later would be in its temporal dead zone.
    let settled = false, cancel = (): void => { /* replaced below */ }, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (answered: boolean, sessions: any[]): void => {
      if (settled) return;
      settled = true; cancel(); if (timer) clearTimeout(timer); resolve({ answered, sessions });
    };
    cancel = pendingRunnerList.add(rc.id, (sessions: any[]) => finish(true, sessions));
    timer = setTimeout(() => finish(false, []), 6000);
    if (!sendToRunner(rc, { t: "list" })) finish(false, []);
  });
}
/** Session list of a remote machine. [] if the runner doesn't answer. */
async function runnerSessions(rc: RunnerConn): Promise<any[]> {
  return (await runnerSessionsResult(rc)).sessions;
}
function runnerUsage(rc: RunnerConn, agent: string, fallback: any): Promise<any> {
  const reqId = "usage-" + randomUUID().slice(0, 8);
  return askRunner<any>(pendingRunnerUsage, reqId, () => sendToRunner(rc, { t: "usage", reqId, agent }), fallback, 6000);
}
function mergeRunnerSessionState(runnerId: string, sessions: any[]): Map<string, any> {
  const states = runnerSessionState.get(runnerId) || new Map<string, any>();
  for (const s of sessions) if (s?.id) states.set(s.id, { ...(states.get(s.id) || {}), ...s });
  runnerSessionState.set(runnerId, states);
  for (const s of sessions) if (s?.id) {
    try { synchronizePersonalSessionAliases(runnerId, String(s.id)); }
    catch (error) { console.error(`[hub] alias remoto de ${runnerId}/${s.id} recusado:`, String((error as Error)?.message || error)); }
  }
  return states;
}
function dedupeRunnerSessions(runnerId: string, sessions: any[]): any[] {
  const states = runnerSessionState.get(runnerId) || new Map<string, any>();
  const boundNative = new Set<string>();
  for (const s of states.values()) {
    const key = s?.nativeId && s?.agent ? nativeIdForAgent(String(s.agent), String(s.nativeId)) : null;
    if (key) boundNative.add(key);
  }
  return sessions.filter((s) => !boundNative.has(String(s?.id || "")));
}
function managedRunnerSessionForNative(runnerId: string, nativeSessionId: string): string | undefined {
  const states = runnerSessionState.get(runnerId) || new Map<string, any>();
  for (const [managedId, s] of states.entries()) {
    const key = s?.nativeId && s?.agent ? nativeIdForAgent(String(s.agent), String(s.nativeId)) : null;
    if (key === nativeSessionId) return managedId;
  }
  return undefined;
}

/** Relay a message from a remote runner to the clients currently viewing that machine. */
function relayRunner(rc: RunnerConn, m: any): void {
  if (m.t === "pong") return; // heartbeat ack — rc.lastSeen already refreshed by the caller
  if (m.t === "execution_manifest") { reconcileExecutionManifest(rc, Array.isArray(m.entries) ? m.entries : []); return; }
  if (m.t === "execution_event") {
    const event = m.event as ExecutionEvent;
    claimRemoteExecutionOwner(rc, event);
    const mirror = mirrorExecutionStore(rc.id), result = mirror.ingest(event);
    if (result.status === "applied") { mirror.setConnection(m.event.rootExecutionId, "online"); broadcastExecutionEvent(rc.id, result.event); }
    else if (result.status === "gap") { mirror.setConnection(m.event.rootExecutionId, "reconciling"); broadcastExecutionConnection(rc.id, "reconciling"); requestExecutionReplay(rc, m.event.rootExecutionId, result.expectedSeq - 1); }
    else if (result.status === "journal_mismatch") { mirror.setConnection(m.event.rootExecutionId, "reconciling"); broadcastExecutionConnection(rc.id, "reconciling"); requestExecutionReplay(rc, m.event.rootExecutionId, 0, true); }
    else if (result.status === "invalid") { mirror.setConnection(m.event.rootExecutionId, "desynced"); broadcastExecutionConnection(rc.id, "desynced"); console.error(`[hub] evento de execução inválido de ${rc.id}: ${result.reason}`); }
    return;
  }
  if (m.t === "execution_events") {
    const pending = executionReplayRequests.get(m.reqId); if (!pending || pending.runnerId !== rc.id || pending.rootExecutionId !== m.rootExecutionId) return;
    executionReplayRequests.delete(m.reqId);
    const batch = Array.isArray(m.events) ? m.events as ExecutionEvent[] : [], mirror = mirrorExecutionStore(rc.id);
    for (const event of batch) claimRemoteExecutionOwner(rc, event);
    if (pending.replace) pending.events.push(...batch);
    else for (const event of batch) {
      const result = mirror.ingest(event);
      if (result.status === "applied") broadcastExecutionEvent(rc.id, result.event);
      else if (result.status !== "duplicate") { requestExecutionReplay(rc, pending.rootExecutionId, 0, true); broadcastExecutionConnection(rc.id, "reconciling"); return; }
    }
    if (typeof m.nextSeq === "number") { requestExecutionReplay(rc, pending.rootExecutionId, m.nextSeq, pending.replace, pending.events); return; }
    if (pending.replace) {
      const result = mirror.replaceFromReplay(pending.events);
      if (result.status !== "applied") { mirror.setConnection(pending.rootExecutionId, "desynced"); broadcastExecutionConnection(rc.id, "desynced"); return; }
      for (const event of pending.events) broadcastExecutionEvent(rc.id, event);
    }
    mirror.setConnection(pending.rootExecutionId, "online"); broadcastExecutionConnection(rc.id, "online");
    return;
  }
  if (m.t === "execution_usage_record") { addUsage(String(m.sessionId || m.rootExecutionId), String(m.agent || "remote-unknown"), m.usage, rc.id); return; }
  if (m.t === "caps") {
    if (Array.isArray(m.caps)) rc.info.agentDescriptors = m.caps;
    if (Array.isArray(m.agents)) rc.info.agents = m.agents.filter((x: unknown) => typeof x === "string");
    if (m.agentUsage && typeof m.agentUsage === "object") rc.info.agentUsage = m.agentUsage;
    broadcastMachines();
    return;
  }
  if (m.t === "usage_info") {
    const cb = pendingRunnerUsage.get(m.reqId);
    if (cb) { pendingRunnerUsage.delete(m.reqId); cb(m); }
    if (typeof m.agent === "string") {
      rc.info.agentUsage = rc.info.agentUsage || {};
      rc.info.agentUsage[m.agent] = m.plan || null;
    }
    return;
  }
  if (m.t === "memory_preview") {
    const pending = pendingRemoteMemoryPreview.get(m.reqId);
    const request = takePendingRequest(rc, m.reqId, ["memory_preview"], pending?.sessionId);
    pendingRemoteMemoryPreview.delete(m.reqId); pendingReq.delete(m.reqId);
    if (!pending || !request || pending.runnerId !== rc.id || pending.ws !== request.socket || typeof m.token !== "string") return;
    const confirmation: PendingMemoryConfirmation = { runnerId: rc.id, sessionId: pending.sessionId, actor: pending.actor, mode: "repo-remote", expiresAt: Number(m.expiresAt) || Date.now() + MEMORY_PREVIEW_TTL_MS, ownerGeneration: pending.sessionId ? captureSessionOwnerGeneration(rc.id, pending.sessionId) : undefined };
    pendingMemoryConfirmations.set(m.token, confirmation);
    sendMemoryFrame(request.socket, confirmation, { t: "memory_preview", token: m.token, target: m.target, note: m.note, appendText: m.appendText, beforeHash: m.beforeHash, exists: !!m.exists, expiresAt: m.expiresAt, runnerId: rc.id, sessionId: pending.sessionId, mode: "repo" });
    return;
  }
  if (m.t === "memory_applied") {
    const memoryRequest = pendingRemoteMemoryApply.get(m.reqId);
    const request = takePendingRequest(rc, m.reqId, ["memory_apply"], memoryRequest?.pending.sessionId);
    pendingRemoteMemoryApply.delete(m.reqId); pendingReq.delete(m.reqId);
    if (memoryRequest && request && memoryRequest.ws === request.socket) sendMemoryFrame(request.socket, memoryRequest.pending, { ...m, runnerId: rc.id });
    return;
  }
  if (m.t === "framework_published") {
    const target = frameworkPublishClients.get(m.requestId);
    frameworkPublishClients.delete(m.requestId);
    const pending = pendingFrameworkPublish[rc.id];
    if (m.ok && pending && (!m.hash || m.hash === pending.targetHash)) { delete pendingFrameworkPublish[rc.id]; savePendingFrameworkPublish(); }
    try { frameworkProvenance.append({ at: Date.now(), runnerId: rc.id, version: Number(m.version) || 0, hash: String(m.hash || ""), written: Number(m.written) || 0, removed: Number(m.removed) || 0, skipped: !!m.skipped }); } catch { /* best effort */ }
    if (target?.ws) send(target.ws, { t: "framework_status", runnerId: rc.id, machine: runnerLabels[rc.id] || rc.info.host || rc.id, ok: !!m.ok, state: m.ok ? (m.skipped ? "current" : "materialized") : "error", version: m.version, error: m.error });
    return;
  }
  if (m.t === "execution_delegate_result") {
    const prior = executionUiState.commands[m.requestId];
    if (prior?.ok === false && /tempo esgotado/.test(String(prior.error || "")) && m.ok && m.rootExecutionId) {
      sendToRunner(rc, { t: "execution_control", requestId: `late-${randomUUID()}`, executionId: m.rootExecutionId, action: "cancel_subtree" });
      return;
    }
    const pending = typeof m.requestId === "string" ? pendingReq.get(m.requestId) : undefined;
    if (!m.ok && pending?.runnerId === rc.id && pending.operation === "execution_delegate" && pending.metadata?.rootExecutionId) executionOwnership.remove(rc.id, pending.metadata.rootExecutionId);
    executionUiState.commands[m.requestId] = m; saveExecutionUiState();
    const request = takePendingRequest(rc, m.requestId, ["execution_delegate"]); if (request) send(request.socket, m);
    return;
  }
  if (m.t === "execution_control_result") {
    executionUiState.commands[m.requestId] = m; saveExecutionUiState();
    const request = takePendingRequest(rc, m.requestId, ["execution_control"]); if (request) send(request.socket, m);
    return;
  }
  // E — a máquina do projeto respondeu pela fonte MCP dela. Chega ao cliente no MESMO formato da
  // lista local (o painel tem uma porta só); `kind` diz de qual fonte veio, e `dir` traz o rótulo
  // do servidor. Nenhum comando/segredo trafega: só as tarefas.
  if ((m.t === "task_local_write" || m.t === "task_mcp_create") && pendingTaskWrite.has(String(m.reqId))) {
    pendingTaskWrite.get(String(m.reqId))!.settle(m.ok === true
      ? { ok: true, key: String(m.key || ""), url: typeof m.url === "string" ? m.url : undefined }
      : { ok: false, error: String(m.error || "a máquina recusou sem dizer o motivo") });
    return;
  }
  if ((m.t === "task_mcp_list" || m.t === "task_local_list") && pendingTaskListing.has(String(m.reqId))) {
    // Pedido da PONTE (a IA), não da tela: quem espera é uma promessa, não um socket.
    pendingTaskListing.get(String(m.reqId))!.settle(m.error
      ? { error: String(m.error) }
      : { files: Array.isArray(m.files) ? m.files : [], dir: String(m.dir || m.server || "") });
    return;
  }
  if (m.t === "task_mcp_list") {
    const request = takePendingRequest(rc, m.reqId, ["task_mcp_list"], typeof m.sessionId === "string" ? m.sessionId : undefined);
    if (request) send(request.socket, { t: "task_local_list", kind: "mcp", runnerId: rc.id, sessionId: m.sessionId, dir: String(m.server || ""), files: Array.isArray(m.files) ? m.files : [], cached: false, scannedAt: Number(m.scannedAt) || Date.now(), ...(m.error ? { error: String(m.error) } : {}) });
    return;
  }
  if (m.t === "task_local_list") {
    const request = takePendingRequest(rc, m.reqId, ["task_local_list"], typeof m.sessionId === "string" ? m.sessionId : undefined);
    if (request) send(request.socket, { t: "task_local_list", runnerId: rc.id, sessionId: m.sessionId, dir: m.dir || "", files: Array.isArray(m.files) ? m.files : [], cached: m.cached === true, scannedAt: Number(m.scannedAt) || Date.now(), ...(m.error ? { error: String(m.error) } : {}) });
    return;
  }
  if (m.t === "sessions") {
    const raw = Array.isArray(m.sessions) ? m.sessions : [];
    mergeRunnerSessionState(rc.id, raw);
    const sessions = dedupeRunnerSessions(rc.id, raw);
    const recentDirs = Array.isArray(m.recentDirs) ? m.recentDirs.filter((d: unknown): d is string => typeof d === "string" && d.trim().length > 0) : [];
    pendingRunnerList.resolve(rc.id, sessions);
    for (const c of clientsOn(rc.id)) {
      const visible = visibleSessions(c, rc.id, sessions);
      send(c, { t: "sessions", sessions: visible, recentDirs: recentDirsList(10, visible), runnerId: rc.id });
    }
    return;
  }
  if (m.t === "deleted") {
    const request = takePendingRequest(rc, m.reqId, ["delete"]);
    if (!request) return;
    const responseIds = Array.isArray(m.ids) ? m.ids.filter((id: unknown): id is string => typeof id === "string") : [];
    const returned = [...new Set<string>(responseIds.filter((id: string) => request.sessionIds.includes(id)))];
    const accepted: string[] = [];
    for (const sessionId of returned) {
      const target = request.metadata?.deleteTargets?.find((candidate) => candidate.sessionId === sessionId);
      if (!target) continue;
      const invalidated = personalSessionBindings.invalidateManyIfCurrent(target.invalidations);
      if (!invalidated.some((snapshot) => snapshot.sessionId === sessionId)) continue;
      accepted.push(sessionId);
      const state = runnerSessionState.get(rc.id); state?.delete(sessionId);
      for (const snapshot of invalidated) removeSessionExecutionAndMemory(rc.id, snapshot.sessionId);
    }
    send(request.socket, { t: "deleted", sessionId: m.sessionId, ids: accepted, ok: accepted.length === request.sessionIds.length, okCount: accepted.length });
    return;
  }
  if (m.t === "history") {
    const hcb = pendingRunnerHist.get(m.reqId);
    if (hcb) {
      pendingRunnerHist.delete(m.reqId);
      if (!runnerHistoryWaiterAuthorized(hcb, rc, m.sessionId) || !rememberRunnerHistoryState(rc, m)) { hcb.resolve(null); return; }
      hcb.resolve(m); return;
    }
    const request = takePendingRequest(rc, m.reqId, ["open", "new", "configure"], m.sessionId);
    if (request) {
      if (!rememberRunnerHistoryState(rc, m) || !canAccessSession(request.socket, rc.id, m.sessionId)) return;
      const native = /^(claude:|codex:)/.test(m.sessionId || "");
    const messages = Array.isArray(m.messages) ? m.messages : [];
    const liveKey = scopedSessionKey(rc.id, m.sessionId);
    if (Array.isArray(m.liveActivity) && m.liveActivity.length) activityBuf.set(liveKey, m.liveActivity.slice(0, 1_200));
    else if ([...messages].reverse().some((message: any) => message?.role === "assistant")) activityBuf.delete(liveKey);
      const su = effectiveSessionUsage(m.sessionId, messages, rc.id);
      send(request.socket, {
        t: "history", runnerId: rc.id, sessionId: m.sessionId,
        session: {
          agent: m.agent, cwd: m.cwd, title: m.title, native, writable: m.writable, nativeId: m.nativeId,
          sessionCost: su.costUsd, sessionUsage: su,
          inputTokens: m.inputTokens || su.contextTokens, contextWindowTokens: m.contextWindowTokens || su.contextWindowTokens,
          model: m.model || su.model, effort: m.effort || su.effort, permissionMode: m.permissionMode,
        },
        total: m.total,
        messages: messages.map((x: any) => ({ sessionId: m.sessionId, role: x.role, text: x.text, ts: x.ts, agent: x.agent || m.agent, speaker: x.speaker, images: x.images, files: x.files, usage: x.usage, name: x.name, detail: x.detail, path: x.path, adds: x.adds, dels: x.dels, rows: x.rows, activity: x.activity, contextManifest: x.contextManifest })),
        files: m.files,
      });
      replayRoute(request.socket, rc.id, m.sessionId); replayActivity(request.socket, rc.id, m.sessionId);
      sendPendingAsk(request.socket, rc.id, m.sessionId);
      send(request.socket, { t: "queue", runnerId: rc.id, sessionId: m.sessionId, items: queueOf(rc.id, m.sessionId).map((q) => ({ text: q.text, atts: q.atts })) });
    }
    return;
  }
  if (m.t === "filediff") { const request = takePendingRequest(rc, m.reqId, ["filediff"]); if (request) send(request.socket, { t: "filediff", path: m.path, name: m.name, rows: m.rows, adds: m.adds, dels: m.dels, error: m.error }); return; }
  if (m.t === "agent_event") {
    const event = m.event as AgentEvent, sid = m.sessionId, mkey = rc.id + "\0" + sid;
    if (event.kind === "accepted") { activityBuf.set(mkey, []); remoteTurnStart.set(mkey, Date.now()); }
    const b = activityBuf.get(mkey); if (b && b.length < 600) b.push(event);
    if (event.kind === "usage" && event.usage) addUsage(sid, m.agent || "remote-unknown", event.usage, rc.id);
    if (event.kind === "completed" || event.kind === "cancelled" || event.kind === "failed") {
      const t0 = remoteTurnStart.get(mkey);
      if (t0 && event.kind !== "cancelled") metrics.record({ runnerId: rc.id, agent: m.agent, model: event.usage?.model, ms: Date.now() - t0, ok: event.kind === "completed", ts: Date.now() });
      remoteTurnStart.delete(mkey);
      if (event.kind !== "completed") remoteSpeak.delete(mkey);
      releaseRunnerSessionAfterTerminal(rc.id, sid);
    }
    for (const c of clientsOn(rc.id)) if (canAccessSession(c, rc.id, sid)) send(c, { t: "agent_event", runnerId: rc.id, sessionId: sid, event, sessionCost: costOf(sid, rc.id), sessionUsage: sessionUsage(sid, rc.id) });
    const label = runnerLabels[rc.id] || rc.info.host || rc.id;
    if (event.kind === "completed") {
      const replyText = event.text || "";
      if (remoteSpeak.delete(mkey) && replyText) void (async () => {
        try {
          const wav = await synthesize(replyText, VOICE);
          for (const c of clientsOn(rc.id)) if (subs.get(c) === sid && canAccessSession(c, rc.id, sid)) send(c, { t: "tts", runnerId: rc.id, sessionId: sid, audio: wav.toString("base64"), text: replyText });
        } catch { /* TTS is best-effort. */ }
      })();
      const askTarget = notificationTargetForSession(rc.id, sid);
      // Uma notificação por turno: quem decide entre "concluída" e "decisão esperando" é a runAsking.
      void runAsking(rc.id, sid, replyText, { title: `${label} · sessão`, target: askTarget, done: () => notifyEvent("done", `${label} · sessão concluída`, replyText, sid, askTarget) });
    }
    else if (event.kind === "failed") notifyEvent("error", `${label} · falhou`, event.text || "", sid, notificationTargetForSession(rc.id, sid));
    if (event.kind === "completed") void indexRunnerSession(rc, sid);
    return;
  }
  if (m.t === "activity_committed") {
    const key = scopedSessionKey(rc.id, m.sessionId), buffered = activityBuf.get(key);
    if (!buffered || buffered.some((event: any) => event?.turnId === m.turnId)) activityBuf.delete(key);
    return;
  }
  if (m.t === "session") {
    const states = runnerSessionState.get(rc.id) || new Map<string, any>();
    states.set(m.sessionId, { ...(states.get(m.sessionId) || {}), id: m.sessionId, nativeId: m.nativeId });
    runnerSessionState.set(rc.id, states);
    try { synchronizePersonalSessionAliases(rc.id, m.sessionId); }
    catch (error) { console.error(`[hub] alias remoto de ${rc.id}/${m.sessionId} recusado:`, String((error as Error)?.message || error)); return; }
    for (const c of clientsOn(rc.id)) if (canAccessSession(c, rc.id, m.sessionId)) send(c, { t: "session", runnerId: rc.id, sessionId: m.sessionId, nativeId: m.nativeId });
    return;
  }
  if (m.t === "context_manifest" && m.manifest) {
    const manifest: ContextManifest = { ...m.manifest, runnerId: rc.id, sessionId: m.sessionId };
    try { remoteContextManifests.append(manifest); } catch (error) { console.warn("[hub] manifesto remoto não persistido:", String(error)); }
    for (const c of clientsOn(rc.id)) if (subs.get(c) === m.sessionId && canAccessSession(c, rc.id, m.sessionId)) send(c, { t: "context_manifest", runnerId: rc.id, sessionId: m.sessionId, manifest });
    return;
  }
  if (m.t === "stream") {
    // Buffer a atividade viva do runner por sessão (igual ao local) pra um refresh no meio do
    // turno remoto reexibir "processando" + as ferramentas em vez de esperar em branco.
    { const sid = m.sessionId, ev = m.ev || {};
      const mkey = rc.id + "\0" + sid;
      if (ev.kind === "start") { activityBuf.set(mkey, []); remoteTurnStart.set(mkey, Date.now()); }
      else if (ev.kind === "tool" || ev.kind === "text" || ev.kind === "thinking") { const b = activityBuf.get(mkey); if (b && b.length < 600) b.push(ev); }
      else if (ev.kind === "done" || ev.kind === "cancelled" || ev.kind === "error") {
        if (ev.kind === "done") addUsage(sid, m.agent || "remote-unknown", ev.usage, rc.id); // typed remote usage, any agent
        const t0 = remoteTurnStart.get(mkey);
        if (t0 && ev.kind !== "cancelled") metrics.record({ runnerId: rc.id, agent: m.agent, model: ev.usage?.model, ms: Date.now() - t0, ok: ev.kind === "done", ts: Date.now() });
        remoteTurnStart.delete(mkey);
        releaseRunnerSessionAfterTerminal(rc.id, sid);
      } }
    for (const c of clientsOn(rc.id)) if (canAccessSession(c, rc.id, m.sessionId)) send(c, { t: "stream", runnerId: rc.id, sessionId: m.sessionId, ev: m.ev, usage: m.ev?.usage, sessionCost: costOf(m.sessionId, rc.id), sessionUsage: sessionUsage(m.sessionId, rc.id) });
    // Turnos de máquina remota terminavam em silêncio: só o cliente conectado ficava sabendo.
    const label = runnerLabels[rc.id] || rc.info.host || rc.id;
    if (m.ev?.kind === "done") notifyEvent("done", `${label} · sessão concluída`, m.ev.text || "", m.sessionId, notificationTargetForSession(rc.id, m.sessionId));
    else if (m.ev?.kind === "error") notifyEvent("error", `${label} · falhou`, m.ev.text || "", m.sessionId, notificationTargetForSession(rc.id, m.sessionId));
    return;
  }
  if (m.t === "busy") {
    if (typeof m.sessionId === "string") broadcastOn(rc.id, m.sessionId, { t: "busy", message: "A sessão já está processando outro turno." });
    else console.warn(`[hub] resposta busy sem escopo descartada de ${rc.id}`);
    return;
  }
  if (m.t === "message") { for (const c of clientsOn(rc.id)) if (canAccessSession(c, rc.id, m.sessionId)) send(c, { t: "message", runnerId: rc.id, message: { sessionId: m.sessionId, ...m.message } }); return; }
  if (m.t === "activity") { for (const c of clientsOn(rc.id)) if (canAccessSession(c, rc.id, m.sessionId)) send(c, { t: "activity", runnerId: rc.id, sessionId: m.sessionId, name: m.name, summary: m.summary, detail: m.detail, path: m.path, adds: m.adds, dels: m.dels, rows: m.rows, background: m.background }); return; }
  if (m.t === "runs") {
    const prev = runnerActive.get(rc.id) || new Set<string>();
    const now = new Set<string>(m.active || []);
    for (const sid of now) if (!prev.has(sid)) bumpRunnerActiveEpoch(rc.id, sid);
    runnerActive.set(rc.id, now);
    broadcastRunnerRuns(rc.id);
    for (const sid of prev) if (!now.has(sid)) void maybeFlushQueue(rc.id, sid, false); // turno do runner terminou → roda a fila DELE
    return;
  }
  if (m.t === "cancel_result" && typeof m.sessionId === "string") {
    if (!m.active && clearRunnerSessionActive(rc.id, m.sessionId)) void maybeFlushQueue(rc.id, m.sessionId, false);
    return;
  }
  // Update outcome of a machine. Goes to whoever asked (any owner watching the update panel),
  // not just clients on that machine — you fire the update from the Hub's own screen.
  if (m.t === "update_done") {
    completePendingRunnerUpdate(rc, m); return;
  }
  if (m.t === "command_list") { const request = takePendingRequest(rc, m.reqId, ["commands"]); if (request) send(request.socket, { t: "command_list", runnerId: rc.id, cwd: m.cwd, commands: m.commands || [] }); return; }
  if (m.t === "mention_list") { const request = takePendingRequest(rc, m.reqId, ["mention"]); if (request) send(request.socket, { t: "mention_list", files: m.files || [] }); return; }
  if (m.t === "preview_list") { const request = takePendingRequest(rc, m.reqId, ["preview"], m.sessionId); if (request) send(request.socket, { t: "worktree_preview", sessionId: m.sessionId, candidates: m.candidates || [] }); return; }
  if (m.t === "browser_event" && typeof m.sessionId === "string" && m.event) {
    for (const c of clientsOn(rc.id)) if (subs.get(c) === m.sessionId && canAccessSession(c, rc.id, m.sessionId)) send(c, { t: "browser_event", runnerId: rc.id, sessionId: m.sessionId, event: m.event });
    return;
  }
  // Manual permission mode (Fase 3), remote leg: a tool on THAT machine is blocked. The runner holds
  // its bridge's response open; we own the UI, so register a pending whose settle ships the answer
  // back over this runner's socket, then ask whoever is watching the session.
  // TSK-11 — a IA de uma sessão DESTA máquina quer mexer nas tarefas do projeto dela. `rc.id` é o
  // dado que faltava: é ele que amarra o pedido ao projeto daquela máquina, e portanto à conta certa.
  if (m.t === "task_bridge" && typeof m.reqId === "string" && typeof m.sessionId === "string") {
    const reqId = m.reqId, sessionId = m.sessionId, op = String(m.op || "");
    const args = (m.args && typeof m.args === "object" ? m.args : {}) as Record<string, unknown>;
    let answered = false;
    const reply = (payload: any): void => {
      if (answered) return;                       // entrega duplicada: o primeiro é dono da resposta
      answered = true;
      log.info("task_bridge", { runnerId: rc.id, sessionId, op, ok: !!payload?.ok });
      if (rc.ws) sendToRunner(rc, { t: "task_bridge_result", reqId, ...payload });
    };
    void serveTaskBridge({ runnerId: rc.id, sessionId, op, args, reply });
    return;
  }
  // TSK-12 — respostas da configuração de MCP daquela máquina, de volta para quem pediu.
  if ((m.t === "task_mcp_config" || m.t === "task_mcp_config_set" || m.t === "task_mcp_test") && typeof m.reqId === "string") {
    const req = takePendingRequest(rc, m.reqId, [m.t]);
    if (req) send(req.socket, { ...m, runnerId: rc.id });
    // A lista de servidores muda a tela de Configurações de todo mundo, não só de quem salvou.
    if (m.t === "task_mcp_config_set" && m.ok === true) sendToRunner(rc, { t: "task_mcp_config", reqId: `sync-${rc.id}` });
    if (m.t === "task_mcp_config" && Array.isArray(m.servers)) {
      rc.info.taskMcpServers = m.servers.map((x: any) => String(x?.name || "")).filter(Boolean);
      broadcastTaskConnections();
    }
    return;
  }
  if (m.t === "git_remote" && typeof m.reqId === "string") {
    pendingGitRemote.get(m.reqId)?.settle(typeof m.url === "string" && m.url ? m.url : undefined);
    return;
  }
  if (m.t === "permission_request" && typeof m.sessionId === "string" && typeof m.id === "string") {
    const sessionId = m.sessionId, id = m.id;
    if (pendingPermissions.has(id)) return; // duplicate delivery — the first one still owns the answer
    const settle = (decision: PermissionDecision) => {
      const p = pendingPermissions.get(id); if (!p) return;
      clearTimeout(p.timer); pendingPermissions.delete(id);
      if (rc.ws) send(rc.ws, { t: "permission_decision", sessionId, id, behavior: decision.behavior, updatedInput: decision.updatedInput, message: decision.message });
      for (const c of clientsOn(rc.id)) if (subs.get(c) === sessionId && canAccessSession(c, rc.id, sessionId)) send(c, { t: "permission_resolved", sessionId, id, behavior: decision.behavior });
    };
    // The runner runs its own (identical) window and fails closed on its side too; ours exists so a
    // dead runner can't leak a pending entry here forever.
    const timer = setTimeout(() => settle({ behavior: "deny", message: "Tempo esgotado — negado por segurança" }), PERM_TIMEOUT_MS);
    pendingPermissions.set(id, { sessionId, runnerId: rc.id, timer, settle });
    for (const c of clientsOn(rc.id)) if (subs.get(c) === sessionId && canAccessSession(c, rc.id, sessionId)) send(c, { t: "permission_request", sessionId, id, tool: String(m.tool || ""), input: m.input ?? {}, cwd: m.cwd });
    return;
  }
  if (m.t === "terminal_opened" && m.terminal?.id) {
    terminalOwners.set(String(m.terminal.id), rc.id);
    const request = takePendingRequest(rc, m.reqId, ["terminal_open"]);
    if (request) rememberTerminalWatcher(String(m.terminal.id), request.socket);
    broadcastTerminal(rc.id, { t: "terminal_opened", reqId: m.reqId, terminal: m.terminal });
    return;
  }
  if (m.t === "terminal_output" && typeof m.terminalId === "string") { terminalOwners.set(m.terminalId, rc.id); broadcastTerminal(rc.id, { t: "terminal_output", terminalId: m.terminalId, data: String(m.data || "") }); return; }
  if (m.t === "terminal_closed" && typeof m.terminalId === "string") { terminalOwners.delete(m.terminalId); broadcastTerminal(rc.id, { t: "terminal_closed", terminalId: m.terminalId, exitCode: m.exitCode, signal: m.signal }); return; }
  if (m.t === "terminal_list") {
    for (const terminal of m.terminals || []) if (terminal?.id) terminalOwners.set(String(terminal.id), rc.id);
    const request = takePendingRequest(rc, m.reqId, ["terminal_list"]);
    if (request) {
      for (const terminal of m.terminals || []) rememberTerminalWatcher(terminal?.id, request.socket);
    }
    broadcastTerminal(rc.id, { t: "terminal_list", reqId: m.reqId, terminals: Array.isArray(m.terminals) ? m.terminals : [] });
    return;
  }
  if (m.t === "terminal_error") {
    const route = remoteErrorRoute(m);
    let request: PendingRequest<WebSocket, PendingRequestMetadata> | undefined;
    if (route.scope === "request") {
      const pending = pendingReq.get(route.requestId);
      request = pending ? takePendingRequest(rc, route.requestId, [pending.operation]) : undefined;
    }
    if (request) send(request.socket, { t: "terminal_error", runnerId: rc.id, reqId: route.scope === "request" ? route.requestId : undefined, terminalId: m.terminalId, message: "erro no terminal remoto" });
    else {
      const routedSessionId = "sessionId" in route ? route.sessionId : undefined;
      if (routedSessionId) broadcastOn(rc.id, routedSessionId, { t: "terminal_error", terminalId: m.terminalId, message: "erro no terminal remoto" });
      else console.warn(`[hub] erro de terminal remoto sem escopo descartado de ${rc.id}`);
    }
    return;
  }
  if (m.t === "dirs") { const request = takePendingRequest(rc, m.reqId, ["listdir"]); if (request) send(request.socket, { t: "dirs", path: m.path, parent: m.parent, entries: m.entries, files: m.files }); return; }
  if (m.t === "filecontent") { const request = takePendingRequest(rc, m.reqId, ["readfile"]); if (request) send(request.socket, { t: "filecontent", path: m.path, name: m.name, content: m.content, size: m.size, mtimeMs: m.mtimeMs, truncated: m.truncated, error: m.error, image: m.image, mime: m.mime }); return; }
  if (m.t === "error") {
    const route = remoteErrorRoute(m);
    if (route.scope === "request") {
      const requestId = route.requestId;
      const replay = executionReplayRequests.get(requestId);
      if (replay?.runnerId === rc.id) {
        executionReplayRequests.delete(requestId);
        mirrorExecutionStore(rc.id).setConnection(replay.rootExecutionId, "desynced");
        broadcastExecutionConnection(rc.id, "desynced");
        console.error(`[hub] replay de execução falhou em ${rc.id}`);
        return;
      }
      const memoryApply = pendingRemoteMemoryApply.get(requestId);
      if (memoryApply?.pending.runnerId === rc.id) {
        const request = takePendingRequest(rc, requestId, ["memory_apply"], memoryApply.pending.sessionId);
        pendingRemoteMemoryApply.delete(requestId);
        if (request) sendMemoryFrame(request.socket, memoryApply.pending, { t: "memory_applied", token: memoryApply.token, ok: false, error: "a máquina não aplicou a memória", runnerId: rc.id, sessionId: memoryApply.pending.sessionId });
        return;
      }
      const history = pendingRunnerHist.get(requestId);
      if (history?.runnerId === rc.id) { pendingRunnerHist.delete(requestId); history.resolve(null); return; }
      const preview = pendingRemoteMemoryPreview.get(requestId);
      const pending = pendingReq.get(requestId);
      if (pending) {
        const request = takePendingRequest(rc, requestId, [pending.operation], preview?.sessionId);
        if (preview?.runnerId === rc.id) pendingRemoteMemoryPreview.delete(requestId);
        if (request) send(request.socket, { t: "error", message: `a operação remota ${request.operation} falhou` });
        return;
      }
      if (preview?.runnerId === rc.id) { pendingRemoteMemoryPreview.delete(requestId); return; }
    }
    const routedSessionId = "sessionId" in route ? route.sessionId : undefined;
    if (routedSessionId) broadcastOn(rc.id, routedSessionId, { t: "error", message: "operação remota falhou" });
    else console.warn(`[hub] erro remoto sem escopo descartado de ${rc.id}`);
    return;
  }
}

/** A transport drop is not a provider terminal. Preserve in-flight activity and mark the durable
 * execution roots offline; the Runner keeps working and reconciles its journal after reconnect. */
function noteRunnerOffline(rid: string): void {
  runnerActive.delete(rid);
  const mirror = mirrorExecutionStore(rid);
  for (const entry of mirror.manifest()) mirror.setConnection(entry.rootExecutionId, "offline");
  broadcastExecutionConnection(rid, "offline");
}
type ExecutionLocation = { runnerId: string; store: ExecutionStore; rootExecutionId: string; node: ExecutionNode };
function executionSources(): Array<{ runnerId: string; store: ExecutionStore }> {
  if (!executionCfg.enabled) return [];
  return [{ runnerId: LOCAL_ID, store: localExecutionStore }, ...[...executionMirrors].map(([runnerId, store]) => ({ runnerId, store }))];
}
function canAccessExecutionRoot(ws: WebSocket, runnerId: string, rootExecutionId: string): boolean {
  return canUseRunner(ws, runnerId) && executionOwnership.allows(runnerId, rootExecutionId, socketPrincipalId(ws));
}
function removeSessionExecutionAndMemory(runnerId: string, sessionId: string): void {
  const source = runnerId === LOCAL_ID ? localExecutionStore : mirrorExecutionStore(runnerId);
  const rootIds = source.rootsForSession(sessionId).map((snapshot) => snapshot.rootExecutionId);
  source.deleteSession(sessionId);
  for (const rootExecutionId of rootIds) {
    try { executionOwnership.remove(runnerId, rootExecutionId); }
    catch (error) { console.error(`[hub] ownership da execução ${rootExecutionId} não removido:`, String((error as Error)?.message || error)); }
  }
  memory.removeSession(sessionId, runnerId);
}
function executionNodeBySession(sessionId: string): ExecutionNode | undefined {
  for (const source of executionSources()) for (const entry of source.store.manifest()) {
    const node = source.store.snapshot(entry.rootExecutionId)?.nodes.find((candidate) => candidate.sessionId === sessionId);
    if (node) return node;
  }
  return undefined;
}
function executionLocation(executionId: string): ExecutionLocation | undefined {
  for (const source of executionSources()) { const found = source.store.findNode(executionId); if (found) return { ...source, ...found }; }
  return undefined;
}
/** Managed workflow sessions are deliberately absent from ordinary chat. Local sessions are
 * authoritative in Store; remote sessions are identified from the mirrored workflow graph so the
 * Hub can reject them before forwarding. The Runner repeats the check against its authoritative
 * Store because a mirror may be stale while reconnecting. */
function isInternalExecutionSession(runnerId: string, sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  if (runnerId === LOCAL_ID) return store.isHidden(sessionId);
  const source = mirrorExecutionStore(runnerId);
  for (const entry of source.manifest()) {
    const snapshot = source.snapshot(entry.rootExecutionId);
    const root = snapshot?.nodes.find((node) => node.executionId === entry.rootExecutionId);
    if (root?.kind === "workflow" && root.origin === "jarvis_managed" && snapshot?.nodes.some((node) => node.sessionId === sessionId)) return true;
  }
  return false;
}
function executionNodeForUi(node: ExecutionNode): ExecutionNode {
  return { ...node, capabilities: { ...node.capabilities }, metrics: { self: { ...node.metrics.self }, subtree: node.metrics.subtree ? { ...node.metrics.subtree } : undefined },
    archivedAt: executionUiState.archives[node.executionId] || node.archivedAt };
}
function executionEventsForNode(store: ExecutionStore, rootExecutionId: string, executionId: string): ExecutionEvent[] {
  const out: ExecutionEvent[] = []; let afterSeq = 0, pages = 0;
  do {
    const page = store.events(rootExecutionId, afterSeq, 1000);
    for (const event of page.events) if (event.executionId === executionId) out.push(event);
    if (page.nextSeq === undefined || page.nextSeq <= afterSeq) break;
    afterSeq = page.nextSeq;
  } while (++pages < 100);
  return out;
}
function broadcastExecutionEvent(runnerId: string, event: ExecutionEvent): void {
  for (const client of wss.clients) {
    const ws = client as WebSocket;
    if (!runnerSockets.has(ws) && canAccessExecutionRoot(ws, runnerId, event.rootExecutionId)) send(ws, { t: "execution_delta", runnerId, event });
  }
}
function canAccessCachedExecutionResult(ws: WebSocket, result: any): boolean {
  const executionId = typeof result?.executionId === "string" ? result.executionId : typeof result?.rootExecutionId === "string" ? result.rootExecutionId : undefined;
  const found = executionId ? executionLocation(executionId) : undefined;
  return !!found && canAccessExecutionRoot(ws, found.runnerId, found.rootExecutionId);
}
function broadcastExecutionConnection(runnerId: string, state: "online" | "offline" | "reconciling" | "desynced"): void {
  const at = Date.now();
  for (const client of wss.clients) { const ws = client as WebSocket; if (!runnerSockets.has(ws) && canUseRunner(ws, runnerId) && executionOwnership.hasOnRunner(runnerId, socketPrincipalId(ws))) send(ws, { t: "execution_connection", runnerId, state, at }); }
}

const managedWorktrees = new ManagedWorktreeManager(executionCfg.worktreeRoot);
const localManagedRuns = new Set<string>();
function managedSecurityFor(agent: string, write: boolean): ManagedExecutionSecurity | undefined {
  if (agent === "mock" && process.env.JARVIS_ENABLE_MOCK === "1" && !write) return { commitPrevention: "provider_config", readOnlyEnforcement: "provider_sandbox" };
  if (agent === "claude-code") return { commitPrevention: "provider_config", readOnlyEnforcement: write ? undefined : "provider_sandbox" };
  if (agent === "codex" && !write) return { commitPrevention: "provider_config", readOnlyEnforcement: "provider_sandbox" };
  if (agent === "aider" && write) return { commitPrevention: "provider_config" };
  return undefined;
}
const localManagedExecution = new ManagedExecutionService({
  runnerId: LOCAL_ID, store: localExecutionStore, agents, worktrees: managedWorktrees,
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
  securityFor: (task) => managedSecurityFor(task.agent, task.write === true),
  invoke: async (input) => {
    const reply = await input.adapter.send(input.sessionId, input.prompt, input.cwd, {
      model: input.task.model, effort: input.task.effort, signal: input.signal,
      managed: { workspaceAccess: input.lease.access, preventCommits: true },
    }, input.onEvent);
    addUsage(input.sessionId, input.task.agent, reply.usage); return reply;
  },
  onEvent: (event) => broadcastExecutionEvent(LOCAL_ID, event),
  onChildUsage: (input) => addUsage(input.sessionId, input.agent, input.usage),
});

function boundedManagedPolicy(value: ManagedExecutionPolicyInput | undefined): ManagedExecutionPolicyInput {
  return { ...value,
    maxConcurrency: Math.min(executionCfg.maxConcurrency, value?.maxConcurrency ?? executionCfg.maxConcurrency),
    maxDepth: Math.min(executionCfg.maxDepth, value?.maxDepth ?? executionCfg.maxDepth) };
}

function startLocalManagedExecution(input: { requestId: string; title?: string; plan: ManagedExecutionPlan; policy?: ManagedExecutionPolicyInput; principalId: string }, respond: (result: any) => void): void {
  let responded = false;
  const finish = (result: any): void => { if (responded) return; responded = true; executionUiState.commands[input.requestId] = result; saveExecutionUiState(); respond(result); };
  const ctrl = new AbortController();
  try { executionOwnership.claim(LOCAL_ID, input.plan.rootExecutionId, input.principalId); }
  catch (error) { finish({ t: "execution_delegate_result", requestId: input.requestId, ok: false, error: String((error as Error)?.message || error) }); return; }
  localManagedRuns.add(input.plan.rootExecutionId); localExecutionAborts.set(input.plan.rootExecutionId, ctrl);
  void localManagedExecution.run(input.plan, {
    title: input.title, policy: boundedManagedPolicy(input.policy), signal: ctrl.signal,
    onAccepted: (rootExecutionId) => finish({ t: "execution_delegate_result", requestId: input.requestId, ok: true, rootExecutionId }),
  }).catch((error) => {
    const message = String((error as Error)?.message || error);
    finish({ t: "execution_delegate_result", requestId: input.requestId, ok: false, error: message });
    console.error(`[hub] workflow gerenciado ${input.plan.rootExecutionId} falhou: ${message}`);
  }).finally(() => {
    localManagedRuns.delete(input.plan.rootExecutionId);
    if (localExecutionAborts.get(input.plan.rootExecutionId) === ctrl) localExecutionAborts.delete(input.plan.rootExecutionId);
  });
}

/** A remote runner connected on /runner: register (token) then relay its stream to clients. */
function handleRunnerConnection(ws: WebSocket, ip: string): void {
  runnerSockets.add(ws);
  let rid: string | null = null;
  let upgradeOnly: RunnerConn | null = null;
  // App-level heartbeat + half-open reaper. The runner answers every {t:"ping"} with {t:"pong"}, and
  // ANY inbound message refreshes rc.lastSeen. A dead TCP half-open never fires 'close', so if three
  // ping cycles pass with no traffic we terminate the socket ourselves — that triggers ws.on("close"),
  // which ends the runner's in-flight turns instead of leaving them hung.
  const ping = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) { clearInterval(ping); return; }
    if (rid) {
      const rc = upgradeOnly || runners.get(rid);
      if (rc && (upgradeOnly || rc.ws === ws) && Date.now() - rc.lastSeen > 60000) { console.warn(`[hub] runner ${rid} sem pong — encerrando socket meio-aberto`); try { ws.terminate(); } catch { /* ignore */ } return; }
    }
    send(ws, { t: "ping" });
  }, 20000);
  // drop runners that never register (token) within 20s
  const regTimer = setTimeout(() => { if (!rid) { try { ws.close(1008, "no register"); } catch { /* ignore */ } } }, 20000);
  ws.on("close", () => { clearInterval(ping); clearTimeout(regTimer); runnerSockets.delete(ws); if (rid) { const rc = runners.get(rid); if (rc && rc.ws === ws) { rc.ws = null; offlineSince.set(rid, Date.now()); denyPendingPermissionsFor(rid); console.log(`[hub] runner offline: ${rid}`); noteRunnerOffline(rid); broadcastMachines(); notifyEvent("machine", `${runnerLabels[rid] || rc.info.host || rid} ficou offline`, "A máquina saiu do ar — sessões nela não respondem até voltar."); } } });
  ws.on("error", () => { /* close handles cleanup */ });
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== "object" || typeof m.t !== "string") return; // drop junk / non-object frames
    if (m.t === "register") {
      if (guard.blockedFor(ip) > 0) { send(ws, { t: "reject", reason: "muitas tentativas" }); try { ws.close(); } catch { /* ignore */ } return; }
      if (auth.AUTH_ENABLED) { const rt = auth.authenticateRunner(m.token); if (!rt) { const r = guard.recordFail(ip); auth.audit(r.blocked ? "auth_blocked" : "runner_reject", { ip, detail: `runner token${r.blocked ? " — bloqueado" : ""}` }); send(ws, { t: "reject", reason: "token de runner inválido" }); try { ws.close(); } catch { /* ignore */ } return; } }
      clearTimeout(regTimer); guard.recordSuccess(ip);
      const info: RunnerInfo = m.info || {};
      const declaredId = info.runnerId || null;
      if (!declaredId) { send(ws, { t: "reject", reason: "sem runnerId" }); try { ws.close(); } catch { /* ignore */ } return; }
      // Machine 0 (this host) is always LOCAL_ID; a remote runner may not claim that reserved id and
      // overwrite the in-process entry.
      if (declaredId === LOCAL_ID) { send(ws, { t: "reject", reason: "runnerId reservado" }); try { ws.close(); } catch { /* ignore */ } return; }
      // TOFU: pin the token to this id and forbid claiming an id owned by another token. Done BEFORE
      // evicting any current holder, so a rejected impersonation attempt can't knock the real one off.
      if (auth.AUTH_ENABLED && !auth.claimRunnerId(m.token, declaredId, info.label || info.host || declaredId)) {
        auth.audit("runner_reject", { ip, runnerId: declaredId, detail: "id não confere com o token" });
        send(ws, { t: "reject", reason: "identidade de runner recusada" }); try { ws.close(); } catch { /* ignore */ } return;
      }
      rid = declaredId;
      const runnerProtocol = info.protocolVersion || 1;
      if (runnerProtocol > RUNNER_PROTOCOL_VERSION) {
        send(ws, { t: "reject", reason: `Runner usa protocolo ${runnerProtocol}, mas este Hub suporta ${RUNNER_PROTOCOL_VERSION}. Atualize o Hub primeiro; downgrade automático foi recusado.` });
        try { ws.close(); } catch { /* ignore */ }
        return;
      }
      if (runnerProtocol < RUNNER_PROTOCOL_VERSION) {
        // Authenticated but operationally incompatible: quarantine this socket instead of rejecting
        // the very machine that needs an update. It may only ping and complete an update; no session,
        // file or agent traffic is relayed until it restarts on the current protocol.
        const active = runners.get(rid);
        if (active?.ws && active.ws.readyState === WebSocket.OPEN) { send(ws, { t: "reject", reason: "já existe uma instância compatível desta máquina" }); try { ws.close(); } catch { /* ignore */ } return; }
        if (!runnerLabels[rid]) { runnerLabels[rid] = info.label || info.host || rid; saveRunnerLabels(); }
        const placeholder: RunnerConn = { id: rid, ws: null, local: false, lastSeen: Date.now(), info };
        runners.set(rid, placeholder); upgradeOnly = { ...placeholder, ws };
        console.warn(`[hub] runner ${rid} em quarentena de atualização (protocolo ${runnerProtocol} → ${RUNNER_PROTOCOL_VERSION})`);
        void (async () => {
          const target = (hubCommit || await repoCommit(UPDATE_ROOT)).replace("+dirty", "");
          if (!target || ws.readyState !== WebSocket.OPEN) return;
          queueRunnerUpdate(rid!, target);
          // A clean checkout already at the target may merely be running the old process. v2 restarts
          // on force even when behind=0; clean means this special force cannot discard user work.
          deliverPendingRunnerUpdate(upgradeOnly!, { force: !!info.commit && !info.commit.includes("+dirty") && commitMatches(info.commit, target) });
        })();
        broadcastMachines(); return;
      }
      offlineSince.delete(rid); offlineAlerted.delete(rid); // back online — reset the offline clock + alert latch
      // Same id registering again = a second instance on that machine (e.g. the service plus a
      // hand-started one). The map would just be overwritten and the old socket left live but
      // orphaned — a zombie that keeps tailing and probing. Evict it explicitly.
      const prevRc = runners.get(rid);
      if (prevRc?.ws && prevRc.ws !== ws) { console.warn(`[hub] runner ${rid} registrou de novo — encerrando instância anterior`); try { prevRc.ws.close(); } catch { /* ignore */ } }
      runners.set(rid, { id: rid, ws, local: false, lastSeen: Date.now(), info });
      if (!runnerLabels[rid]) { runnerLabels[rid] = info.label || info.host || rid; saveRunnerLabels(); }
      send(ws, { t: "welcome", runnerId: rid });
      send(ws, { t: "execution_manifest_request", reqId: `manifest-${randomUUID()}` });
      broadcastExecutionConnection(rid, "reconciling");
      auth.audit("runner_online", { runnerId: rid, detail: info.host });
      console.log(`[hub] runner online: ${rid} (${info.host})`);
      broadcastMachines();
      const registered = runners.get(rid)!;
      if (info.updateResult && typeof info.updateResult.requestId === "string") completePendingRunnerUpdate(registered, info.updateResult);
      verifyOrDeliverRunnerUpdate(registered);
      deliverPendingFrameworkPublish(registered); // a reconnecting machine picks up any queued Framework publish
      return;
    }
    if (!rid) return;
    if (upgradeOnly) {
      upgradeOnly.lastSeen = Date.now();
      if (m.t === "update_done") completePendingRunnerUpdate(upgradeOnly, m);
      // Quarantine is deliberately fail-closed: pong/update_done are the only accepted frames.
      return;
    }
    const rc = runners.get(rid); if (!rc) return; rc.lastSeen = Date.now();
    // A malformed frame from a runner must never take the hub down (unhandled throw → process crash).
    try { relayRunner(rc, m); } catch (e) { console.error("[hub] erro no relay do runner", rid, "-", String((e as any)?.message ?? e)); }
  });
}

// Live mirror of native CLI sessions: tail the jsonl and broadcast new turns as they're
// appended by an EXTERNAL Claude Code (or by us), so viewers update without refreshing.
interface Tail { path: string; claude: boolean; offset: number; buf: string; timer: ReturnType<typeof setInterval>; }
const nativeTails = new Map<string, Tail>();
/**
 * Sessões cujo turno está sendo conduzido POR NÓS — o tail tem de ficar calado, senão rebroadcasta a
 * nossa própria resposta (que o cliente já mostrou streamando) e ela aparece duplicada.
 *
 * A pausa vive AQUI, por sessionId, e não como campo do objeto Tail. O motivo é o bug que isto
 * corrige: `syncTails()` destrói e recria o tail quando a sessão sai de vista (trocar de sessão,
 * fechar a aba, reconexão de WebSocket). Quem pausava o objeto capturado no início do turno acabava
 * despausando um objeto já descartado, enquanto o tail NOVO — criado no meio do turno, sem saber de
 * pausa nenhuma — seguia emitindo. Chaveado por sessão, o silêncio sobrevive à recriação.
 */
const nativeTurnPaused = new Set<string>();
function pollTail(sid: string): void {
  const t = nativeTails.get(sid);
  if (!t || nativeTurnPaused.has(sid)) return;
  let size: number;
  try { size = statSync(t.path).size; } catch { return; }
  if (size <= t.offset) return;
  let chunk: Buffer;
  try {
    const fd = openSync(t.path, "r");
    chunk = Buffer.alloc(size - t.offset);
    readSync(fd, chunk, 0, chunk.length, t.offset);
    closeSync(fd);
  } catch { return; }
  t.offset = size;
  const parts = (t.buf + chunk.toString("utf8")).split("\n");
  t.buf = parts.pop() || ""; // keep the last (possibly partial) line
  for (const line of parts) {
    if (!line.trim()) continue;
    for (const e of parseNativeEvents(line, t.claude) as any[]) {
      if (e.kind === "message") broadcast(sid, { t: "message", message: { sessionId: sid, role: e.role, text: e.text, ts: e.ts, agent: t.claude ? "claude-code" : "codex" } });
      else broadcast(sid, { t: "activity", sessionId: sid, name: e.name, summary: e.summary, detail: e.detail, path: e.path, adds: e.adds, dels: e.dels, rows: e.rows, background: e.background });
    }
  }
}
function startTail(sid: string): void {
  if (nativeTails.has(sid)) return;
  const f = nativeFilePath(sid);
  if (!f) return;
  let size = 0;
  try { size = statSync(f.path).size; } catch { /* new file */ }
  nativeTails.set(sid, { path: f.path, claude: f.claude, offset: size, buf: "", timer: setInterval(() => pollTail(sid), 900) });
}
function stopTail(sid: string): void {
  const t = nativeTails.get(sid);
  if (t) { clearInterval(t.timer); nativeTails.delete(sid); }
}
/** Keep a tail running for every native session at least one client is currently viewing. */
function syncTails(): void {
  const viewed = new Set<string>();
  for (const s of subs.values()) if (isNativeId(s)) viewed.add(s);
  for (const sid of [...nativeTails.keys()]) if (!viewed.has(sid)) stopTail(sid);
  for (const sid of viewed) startTail(sid);
}
/** Jarvis's own sessions merged with imported native Claude/Codex sessions (agent-tagged, newest first). */
function nativeDisplayTitleForSession(s: any): string {
  try {
    const key = nativeSessionKeysForManaged(s)[0] || null;
    const h = key ? nativeHistory(key) : null;
    return h?.title || s.title;
  } catch {
    return s.title;
  }
}
function nativeSessionKeysForManaged(s: any): string[] {
  const keys: string[] = [];
  const names = [s.agent, ...agents.names().filter((name) => name !== s.agent)];
  for (const name of names) {
    try {
      const nid = agents.get(name).nativeSessionId?.(s.id);
      const key = nid ? nativeIdForAgent(name, nid) : null;
      if (key && !keys.includes(key)) keys.push(key);
    } catch { /* ignore unavailable adapter */ }
  }
  return keys;
}
function allSessions(): any[] {
  const own = store.list().map((s) => ({ ...s, title: nativeDisplayTitleForSession(s) }));
  // Uma sessão gerenciada pode criar um transcript NATIVO vinculado com outro id
  // (ex.: id Jarvis + `claude:<uuid>`). A sessão gerenciada é a linha canônica.
  const native = filterUnboundNativeSessions(listNative(), own, (s) => {
    return nativeSessionKeysForManaged(s);
  })
    .map((n) => ({ id: n.id, title: n.title, agent: n.agent, cwd: n.cwd, createdAt: n.updatedAt, updatedAt: n.updatedAt, lastMessage: "", count: n.count }));
  return [...own, ...native].sort((a, b) => b.updatedAt - a.updatedAt);
}
/** The N most-recently-used distinct working folders (across all sessions) — for the folder picker + voice. */
function recentDirsList(n = 10, sessions = allSessions()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sessions) {
    const d = (s.cwd || "").trim();
    if (d && !seen.has(d)) { seen.add(d); out.push(d); if (out.length >= n) break; }
  }
  return out;
}
function visibleSessions(ws: WebSocket, runnerId: string, sessions: any[]): any[] {
  return sessions.filter((session) => typeof session?.id !== "string" || canAccessSession(ws, runnerId, session.id));
}
function sessionsPayload(ws: WebSocket): unknown {
  const sessions = visibleSessions(ws, LOCAL_ID, allSessions());
  return { t: "sessions", sessions, recentDirs: recentDirsList(10, sessions), runnerId: LOCAL_ID };
}
function pushSessions(): void { for (const c of clientsOn(LOCAL_ID)) send(c, sessionsPayload(c)); }
/** Unified "all machines" view: local sessions + every ONLINE runner's sessions, each tagged with
 *  its runnerId + machine label so the UI can badge them and route an open to the owning machine.
 *  Remote lists are fetched concurrently with a per-runner timeout — a silent machine just yields
 *  nothing instead of hanging the whole view. */
async function aggregateAllSessions(ws?: WebSocket): Promise<{ sessions: any[]; machines: AggregateMachine[] }> {
  // Filter to the machines this connection may use so the "all machines" view never leaks sessions
  // from a runner a member wasn't granted. No ws (internal callers) => unfiltered.
  const canUse = (rid: string) => !ws || canUseRunner(ws, rid);
  const localLabel = runnerLabels[LOCAL_ID] || runners.get(LOCAL_ID)?.info.host || "Servidor";
  const localSessions = ws ? visibleSessions(ws, LOCAL_ID, allSessions()) : allSessions();
  const out: any[] = canUse(LOCAL_ID) ? localSessions.map((s) => ({ ...s, runnerId: LOCAL_ID, machine: localLabel })) : [];
  const machines: AggregateMachine[] = canUse(LOCAL_ID)
    ? [{ runnerId: LOCAL_ID, label: localLabel, online: true, contributed: true }]
    : [];
  // Every remote the connection may see — INCLUDING the offline ones. They used to be filtered out
  // silently, so a machine that dropped just vanished from the unified list with no explanation (e a
  // ordem parecia embaralhar sozinha quando ela voltava). Now it is reported as not contributing.
  const remotes = [...runners.values()].filter((r) => !r.local && canUse(r.id));
  const reachable = remotes.filter((r) => r.ws && r.ws.readyState === WebSocket.OPEN);
  const lists = await Promise.all(reachable.map((rc) => runnerSessionsResult(rc).then((r) => ({ rc, ...r })).catch(() => ({ rc, answered: false, sessions: [] as any[] }))));
  const answers = new Map(lists.map((l) => [l.rc.id, l]));
  for (const rc of remotes) {
    const label = runnerLabels[rc.id] || rc.info.host || rc.id;
    const online = !!rc.ws && rc.ws.readyState === WebSocket.OPEN;
    const answer = answers.get(rc.id);
    machines.push({ runnerId: rc.id, label, online, contributed: !!answer?.answered });
    for (const s of answer?.sessions || []) if (!ws || canAccessSession(ws, rc.id, s.id)) out.push({ ...s, runnerId: rc.id, machine: label });
  }
  return { sessions: out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), machines };
}
function sendSessions(ws: WebSocket): void { send(ws, sessionsPayload(ws)); }

/** Per-machine outcome of one unified-view aggregation. `contributed` is false when the machine is
 *  offline OR was online but never answered the list within the timeout — the UI needs both cases to
 *  say the view is partial instead of quietly showing fewer sessions. */
interface AggregateMachine { runnerId: string; label: string; online: boolean; contributed: boolean }

/** What to SPEAK for an agent reply: short answers are read verbatim (cleaned); long ones are
 *  condensed to a 1–3 sentence spoken summary (cheap model) so the audio doesn't drag on. */
async function speechForReply(replyText: string): Promise<string> {
  const spoken = speechify(replyText || "");
  if (spoken.length <= 600) return spoken; // already short when spoken → read as-is
  const prompt = `Resuma em 1 a 3 frases CURTAS e faladas (português do Brasil, sem markdown, sem listas, sem código) o texto abaixo — como quem conta o resultado em voz alta, direto ao ponto:\n\n${(replyText || "").slice(0, 4000)}`;
  try {
    const agent = summaryAgent();
    const opts = await compatibleAgentOpts(agent, summaryCfg.model, summaryCfg.effort);
    const reply = agent.oneShot ? await agent.oneShot(prompt, opts) : await agent.send("__speaksum__", prompt, process.cwd(), opts);
    addUsage("__spoken_summary__", agent.name, reply.usage);
    const s = speechify((reply.text || "").trim());
    return s || speechifyCapped(replyText);
  } catch { return speechifyCapped(replyText); }
}

// The ONE managed-turn context (see turn.ts): wires the shared lifecycle to the hub's real store,
// broadcast, agent runner and TTS. Every managed-session turn below routes through runManagedTurn(turnCtx,…).
// Idempotency for LOCAL managed turns (mirrors the runner's turnId dedup) — a re-delivered send
// runs at most once even on the embedded machine-0 path.
const localSeenTurns = createSeenSet();
// The automatic router runs before runManagedTurn/Runner dedupe. Guard the inbound frame as well,
// otherwise a reconnect could spend a second routing call even though the main turn is at-most-once.
const incomingTurns = createSeenSet(1000);
const executionPrincipalContext = new AsyncLocalStorage<string>();
const turnCtx: TurnCtx = {
  seen: (turnId) => localSeenTurns.add(turnId),
  afterStored: (sid) => { activityBuf.delete(scopedSessionKey(LOCAL_ID, sid)); },
  afterTurn: (sid) => { void indexSession(sid); },
  ensure: (sid) => store.ensure(sid),
  resolveAgentName: (n) => agents.get(n).name,
  add: (sid, msg) => {
    store.add(sid, msg);
    if (msg.role === "user") clearPendingInboundTurn(msg.contextManifest?.turnId);
  },
  broadcast: (sid, msg) => broadcast(sid, msg as any),
  pushSessions: () => pushSessions(),
  now: () => Date.now(),
  buildContextManifest: ({ turnId, sid, agentName, cwd, showText, agentText, actor, images, files }) => {
    const selected = agents.get(agentName);
    return buildContextManifest({
      turnId, sessionId: sid, runnerId: LOCAL_ID, agent: selected.name, cwd, actor,
      continuity: selected.sessionContinuity?.() || "none", nativeSessionId: selected.nativeSessionId?.(sid),
      history: store.history(sid), showText, agentText, images, files,
    });
  },
  recordContextManifest: (manifest) => {
    try { contextManifests.append(manifest); } catch (error) { console.warn("[hub] manifesto de contexto não persistido:", String(error)); }
    broadcast(manifest.sessionId, { t: "context_manifest", sessionId: manifest.sessionId, manifest });
  },
  runAgentTurn: (sid, agentName, agentText, cwd, opts) => agentTurn(sid, agents.get(agentName), agentText, cwd, opts),
  speak: async (sid, replyText, also) => {
    const spoken = await speechForReply(replyText);
    if (!spoken) return;
    const wav = await synthesize(spoken, VOICE); const b64 = wav.toString("base64");
    // Gap 17: se a fala do usuário que originou este turno foi um fechamento (CLOSING_RX), o client
    // não deve re-armar o mic depois de tocar esta resposta — a conversa terminou naturalmente.
    const closing = closingTurn.delete(sid) || undefined;
    broadcast(sid, { t: "tts", sessionId: sid, audio: b64, text: spoken, closing });
    for (const a of (also || [])) if (a && a !== sid) broadcast(a, { t: "tts", sessionId: a, audio: b64, text: spoken, closing }); // ex.: canal de voz (WAKE) quando vinculado a outra sessão
  },
  // Per-session spend cap (opt-in): JARVIS_SESSION_COST_CAP=<usd>. 0/unset = no cap (default, no
  // behavior change). Stops a runaway session from spending indefinitely without a human in the loop.
  checkBudget: (sid) => {
    const cap = Number(process.env.JARVIS_SESSION_COST_CAP) || 0;
    const spent = sessionUsage(sid).billableUsd;
    if (cap > 0 && spent >= cap) return { blocked: true, message: `Esta sessão já custou $${spent.toFixed(2)} (limite $${cap.toFixed(2)}). Ajuste JARVIS_SESSION_COST_CAP ou continue em outra sessão.` };
    return { blocked: false };
  },
  resolveAgent: (primary) => resolveTurnAgent(primary),
  onLimit: (agent, message) => onLimitHit(agent, message),
  notice: (sid, message) => broadcast(sid, { t: "notice", message }),
};
function runOwnedManagedTurn(sid: string, input: ManagedTurnInput): Promise<void> {
  const principalId = input.actor?.userId ? actorPrincipalId(input.actor) : captureSessionOwnerGeneration(LOCAL_ID, sid).principalId || auth.OWNER_IDENTITY;
  return executionPrincipalContext.run(principalId, () => runManagedTurn(turnCtx, sid, input));
}

/** One full turn against a session's agent: store+broadcast the user msg, get the reply, speak if asked. */
async function deliverTurn(sid: string, opts: { showText: string; agentText?: string; model?: string; effort?: string; speak?: boolean; speaker?: string; speakAlso?: string[]; actor?: ContextActor }): Promise<void> {
  const manifestAgentText = opts.agentText || opts.showText;
  const personal = opts.actor?.source === "user" ? await personalContextForChat(LOCAL_ID, sid, opts.showText, opts.actor) : undefined;
  await runOwnedManagedTurn(sid, {
    showText: opts.showText, agentText: personal ? `${personal.contextPrefix}\n\n${manifestAgentText}` : manifestAgentText, manifestAgentText, model: opts.model, effort: opts.effort,
    actor: opts.actor, speaker: opts.speaker, speak: opts.speak, speakAlso: opts.speakAlso,
    onError: (message, limit) => broadcast(sid, { t: "error", message, limit }),
  });
}

/** Run a scheduled routine in its own session, then push/speak the result. Goes through the shared
 *  turn lifecycle, so agentTurn's own "done" push notification fires — the user gets briefed even
 *  with the app closed. NOTE: the session's agent/cwd lock on first run; editing a routine's
 *  agent/folder later won't move an existing routine session (delete+recreate to change those). */
async function runRoutine(r: Routine, approved = false, actorOverride?: ContextActor): Promise<void> {
  if (auth.AUTH_ENABLED && !r.principalId) {
    console.warn(`[hub] rotina legada sem principal não executada: ${r.id}`);
    return;
  }
  const sid = "routine-" + r.id;
  const routineActor: ContextActor = actorOverride || { userId: r.principalId || "local", deviceId: r.deviceId || "local", source: "routine" };
  const routineTarget = { principalId: routineActor.userId || "local" };
  const flags = autoFlags(r.auto);
  if (!approved) {
    const resolved = resolveAdaptivePolicy(adaptivePolicyDoc, { cwd: r.cwd || CWD, sessionId: sid });
    const decision = decideAdaptiveRun(resolved.policy, { background: true, risk: "medium" });
    if (decision.action === "reject") {
      recordAdaptiveDecision({ kind: "routine", action: "reject", reason: decision.reason, sessionId: sid, detail: r.name, policyId: resolved.policy.id });
      notifyEvent("error", "⏰ " + r.name, "bloqueada pela política: " + decision.reason, sid, routineTarget);
      return;
    }
    if (decision.action === "ask") {
      queueRoutineApproval(r, decision.reason);
      return;
    }
    recordAdaptiveDecision({ kind: "routine", action: "allow", reason: decision.reason, sessionId: sid, detail: r.name, policyId: resolved.policy.id });
  }
  if (r.runnerId && r.runnerId !== LOCAL_ID) {
    const rc = runners.get(r.runnerId);
    if (!rc?.ws) { notifyEvent("error", "⏰ " + r.name, "máquina da rotina está offline", sid, routineTarget); return; }
    const state = runnerSessionState.get(rc.id)?.get(sid), hist = needsAuto(flags) ? await runnerHistory(rc, sid, { principalId: actorPrincipalId(routineActor) }) : null;
    const configuredAgent = r.agent && rc.info.agents.includes(r.agent) ? r.agent : undefined;
    const agentName = hist?.agent || state?.agent || (flags.agent ? configuredAgent || rc.info.agents[0] : r.agent || rc.info.agents[0]);
    if (!agentName || !rc.info.agents.includes(agentName)) { notifyEvent("error", "⏰ " + r.name, `agente '${agentName || "(nenhum)"}' indisponível nessa máquina`, sid, routineTarget); return; }
    const decision = await decideAutomaticRoute({ runnerId: r.runnerId, sid, text: r.prompt, started: Number(hist?.total) > 0 || state?.started === true, currentAgent: agentName, currentModel: r.model, currentEffort: r.effort, flags, descriptors: rc.info.agentDescriptors || [], available: rc.info.agents || [], recent: (hist?.messages || []).filter((m: any) => m?.role === "user" || m?.role === "assistant").slice(-6), contextTokens: hist?.inputTokens, contextWindowTokens: hist?.contextWindowTokens });
    const personal = await personalContextForChat(rc.id, sid, r.prompt, routineActor);
    const turnId = `routine:${r.id}:${r.lastRunAt || Date.now()}`;
    if (sendOwnedRunnerTurn(rc, sid, turnId, actorPrincipalId(routineActor), { t: "send", text: r.prompt, contextPrefix: personal?.contextPrefix, agent: decision.agent, cwd: r.cwd, opts: { model: decision.model, effort: decision.effort }, actor: routineActor })) markRunnerSessionActive(rc.id, sid);
    return;
  }
  const localAgent = flags.agent ? (r.agent && localAgents.includes(r.agent) ? r.agent : localAgents[0]) : (r.agent || agents.default);
  if (!localAgent || !localAgents.includes(localAgent)) { notifyEvent("error", "⏰ " + r.name, `agente '${localAgent || "(nenhum)"}' indisponível nessa máquina`, sid, routineTarget); return; }
  store.ensure(sid, { agent: localAgent, cwd: r.cwd || CWD, title: "⏰ " + r.name });
  const decision = await routeLocalTurn(sid, r.prompt, r.model, r.effort, flags);
  const personal = await personalContextForChat(LOCAL_ID, sid, r.prompt, routineActor);
  await runOwnedManagedTurn(sid, {
    showText: r.prompt, agentText: personal ? `${personal.contextPrefix}\n\n${r.prompt}` : r.prompt, manifestAgentText: r.prompt,
    model: decision.model, effort: decision.effort, speak: !!r.speak, actor: routineActor,
    onError: (message) => notifyEvent("error", "⏰ " + r.name, message, sid, routineTarget),
  });
}
/** Owner-only routine management (list / add / update / delete / run-now). */
function handleRoutineMsg(ws: WebSocket, msg: any): boolean {
  const manageable = (routine: Routine, principalId: string): boolean => routine.principalId ? auth.sameIdentity(routine.principalId, principalId) : !auth.AUTH_ENABLED && principalId === "local";
  const listMsg = (principalId: string) => ({ t: "routines" as const, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local do Hub", routines: routines.list().filter((routine) => manageable(routine, principalId)).map(({ principalId: _principalId, deviceId: _deviceId, ...r }) => ({ ...r, label: scheduleLabel(r) })) });
  if (msg.t === "routines") { const owner = requireOwner(ws); if (!owner) return true; send(ws, listMsg(owner.userId)); return true; }
  if (msg.t === "routine_validate") { if (!requireOwner(ws)) return true; const cron = String(msg.cron || ""); send(ws, { t: "cron_validation", cron, ...validateCron(cron) }); return true; }
  if (msg.t === "routine_add") { const owner = requireOwner(ws); if (!owner) return true; try { routines.add(msg.routine || {}, { principalId: owner.userId, deviceId: owner.deviceId || undefined }); send(ws, listMsg(owner.userId)); } catch (e: any) { send(ws, { t: "error", message: "Cron inválido: " + String(e?.message || e) }); } return true; }
  if (msg.t === "routine_update" && typeof msg.id === "string") { const owner = requireOwner(ws); if (!owner) return true; const current = routines.get(msg.id); if (!current || !manageable(current, owner.userId)) { send(ws, { t: "error", message: "rotina não encontrada" }); return true; } try { routines.update(msg.id, msg.patch || {}, { principalId: owner.userId, deviceId: owner.deviceId || undefined }); send(ws, listMsg(owner.userId)); } catch (e: any) { send(ws, { t: "error", message: "Cron inválido: " + String(e?.message || e) }); } return true; }
  if (msg.t === "routine_del" && typeof msg.id === "string") { const owner = requireOwner(ws); if (!owner) return true; const current = routines.get(msg.id); if (current && manageable(current, owner.userId)) routines.remove(msg.id); send(ws, listMsg(owner.userId)); return true; }
  if (msg.t === "routine_run" && typeof msg.id === "string") { const owner = requireOwner(ws); if (!owner) return true; const current = routines.get(msg.id); const binding = { principalId: owner.userId, deviceId: owner.deviceId || undefined }; const r = current && manageable(current, owner.userId) ? routines.update(msg.id, {}, binding) : undefined; if (r) void runRoutine(r, true, actorOf(ws, "routine")); send(ws, listMsg(owner.userId)); return true; }
  return false;
}
// Scheduler: every 30s, fire any routine whose local HH:MM matches now (markRun BEFORE running so a
// sub-minute re-tick can't double-fire; isDue also guards it). ~2 ticks/minute → never misses a minute.
setInterval(() => {
  if (hubUpdateInProgress) return;
  const now = new Date();
  for (const r of routines.due(now)) { routines.markRun(r.id, now.getTime()); void runRoutine(r); }
}, 30_000).unref?.();

// Voz (wake sem contexto): qual sessão EXISTENTE a fala mais combina, via memória semântica.
// null se nada forte o bastante. É a base da resolução "sugerir a sessão certa" (não perguntar cego).
async function suggestSession(utterance: string, scope: { runnerId: string; cwd: string; principalId?: string }): Promise<{ id: string; title: string; score: number } | null> {
  try {
    const vec = await embedOne(utterance);
    if (!vec.length) return null;
    const projectKey = projectMemoryKey(scope.cwd);
    if (!projectKey) return null;
    const [top] = memory.search(vec, { topK: 1, minScore: 0.35, runnerIds: [scope.runnerId], projectKey, principalId: scope.principalId });
    return top ? { id: top.sessionId, title: top.title || top.id, score: Math.round(top.score * 100) } : null;
  } catch { return null; }
}
// Gap 21: a sessão JÁ ATIVA tem um digest semântico próprio (indexado após cada turno pela memória
// — ver [[jarvis-hardening-milestone]], bloco "Semantic memory"). Comparamos a NOVA fala com o
// digest da MESMA sessão (`sessionId` filter): similaridade muito baixa é sinal de desvio de
// assunto. `memory.has(sid)` falso (sessão nova, ainda sem turno indexado) → nada a comparar, não
// dispara — evita falso-positivo logo na primeira mensagem de uma sessão.
async function looksLikeTopicShift(sid: string, text: string): Promise<boolean> {
  if (!memory.has(sid)) return false;
  const vec = await embedOne(text);
  if (!vec.length) return false;
  const [hit] = memory.search(vec, { topK: 1, minScore: 0, sessionId: sid });
  return !!hit && hit.score < 0.15;
}
// ---- voz ambiente: staging (refinar a fala por voz ANTES de comprometer no chat real) --------
const CONFIRM_RX = /\b(confirm(o|ar|ado)?|pode (mandar|enviar|ir)|manda(r)?|envia(r)?|isso mesmo|é isso|perfeito|fechou)\b/i;
// Gap 13(b)/14: intenção de ABORTAR (não "adicionar contexto") quando o usuário fala por cima do
// Jarvis ou durante um refino de staging já em andamento — "para, deixa pra lá" deve descartar o
// rascunho de vez, não ser tratado como mais uma rodada de refino. ANCORADO À UTTERANCE INTEIRA
// (igual ao CLOSING_RX do Gap 17) — "para" sozinho é comando de abortar, mas "isso é para o projeto
// X" (preposição, no meio de uma frase maior) NÃO pode disparar isso; checado ANTES do CONFIRM_RX
// (e antes de qualquer refino) em `stageHandle`.
const ABORT_RX = /^\s*(para(r)?|cancela(r)?(\s+isso)?|deixa\s+pra\s+l[áa]|deixa\s+isso(\s+pra\s+l[áa])?|esque[çc]e(\s+isso)?|n[ãa]o\s+(é|era)\s+isso|n[ãa]o\s+precisa(va)?|desist[oi]|n[ãa]o\s+importa)\s*[.,!]*\s*$/i;
// Gap 17: fechamento conversacional (agradecimento/despedida CURTO, sem pedido novo) — a UTTERANCE
// INTEIRA precisa bater (não só conter a palavra), senão "obrigado por isso, mas..." seria tratado
// como despedida. Quando bate, marcamos a sessão para o `speak()` sinalizar ao client (`closing`)
// que não deve re-armar o microfone depois de tocar a resposta.
const CLOSING_RX = /^\s*(muito\s+)?(obrigad[oa]s?|valeu|vlw|tchau|até\s+(mais|logo|depois|breve)|falou|é\s+isso(\s+mesmo)?|(só\s+)?isso\s+mesmo|beleza\s+obrigad[oa])[.! ]*$/i;
const closingTurn = new Set<string>();
interface StageScope { runnerId: string; sessionId: string; actor?: ContextActor }
const stageKey = (scope: StageScope): string => decisionKey(scope.runnerId, scope.sessionId);
const stageEscalatePending = new Map<string, string>();
async function stageContext(scope: StageScope): Promise<string> {
  let messages: any[];
  if (scope.runnerId === LOCAL_ID) messages = store.history(scope.sessionId);
  else {
    const rc = runners.get(scope.runnerId);
    messages = rc?.ws ? (await runnerHistory(rc, scope.sessionId, { principalId: actorPrincipalId(scope.actor) }))?.messages || [] : [];
  }
  return messages.slice(-6).map((m: any) => `${m.role === "user" ? "U" : "A"}: ${(m.text || "").slice(0, 200)}`).join("\n").slice(0, 1200);
}
async function stageSpeak(scope: StageScope, text: string): Promise<void> {
  if (!text) return;
  broadcastOn(scope.runnerId, scope.sessionId, { t: "stage_say", runnerId: scope.runnerId, sessionId: scope.sessionId, text });
  try { const wav = await synthesize(text, VOICE); broadcastOn(scope.runnerId, scope.sessionId, { t: "tts", sessionId: scope.sessionId, audio: wav.toString("base64"), text }); } catch { /* tts opcional */ }
}
async function stageRefinePass(scope: StageScope, utterance: string, model: string, effort: string): Promise<ReturnType<typeof parseRefine>> {
  const e = staging.get(stageKey(scope))!;
  const prompt = buildRefinePrompt({ context: await stageContext(scope), turns: e.turns, utterance });
  const agent = agents.searchAgent();
  const sendOpts = await compatibleAgentOpts(agent, model, effort);
  const reply = agent.oneShot ? await agent.oneShot(prompt, sendOpts) : await agent.send("__stage__", prompt, process.cwd(), sendOpts);
  addUsage(WAKE_SESSION, agent.name, reply.usage); // atribui usage/custo tipado à voz
  return parseRefine(reply.text);
}
/** Descarta o rascunho de staging em andamento (mesma lógica do botão "Cancelar" e do gatilho de
 *  voz ABORT_RX) — extraído para os dois caminhos não divergirem. */
function stageCancel(scope: StageScope): void {
  const key = stageKey(scope);
  staging.remove(key); stageEscalatePending.delete(key);
  broadcastOn(scope.runnerId, scope.sessionId, { t: "stage", runnerId: scope.runnerId, sessionId: scope.sessionId, done: true });
}
async function stageHandle(scope: StageScope, utterance: string): Promise<void> {
  utterance = (utterance || "").trim();
  if (!utterance) return;
  // Gap 13(b)/14: "para"/"cancela"/"deixa pra lá" — ABORTA de vez (não é mais uma rodada de refino).
  // Checado antes de sequer abrir/tocar o staging: cobre tanto abortar um rascunho já em andamento
  // quanto abortar logo na PRIMEIRA fala de um barge-in (draft ainda nem existe).
  if (ABORT_RX.test(utterance)) { stageCancel(scope); await stageSpeak(scope, "Ok, cancelei."); return; }
  const key = stageKey(scope);
  let e = staging.get(key) || staging.start(key, { model: voiceCfg.fastModel, effort: voiceCfg.fastEffort });
  if (CONFIRM_RX.test(utterance) && e.draft) { await stageConfirm(scope); return; }   // confirmação por voz
  let r = await stageRefinePass(scope, utterance, e.model || voiceCfg.fastModel, e.effort || voiceCfg.fastEffort);
  if (r.needsUpgrade && !e.escalated) {
    if (voiceCfg.escalate === "ask") {
      stageEscalatePending.set(key, utterance);
      broadcastOn(scope.runnerId, scope.sessionId, { t: "stage_escalate", runnerId: scope.runnerId, sessionId: scope.sessionId, reason: r.reason || "" });
      await stageSpeak(scope, `Isso pede um modelo mais forte pra ficar bom${r.reason ? " (" + r.reason + ")" : ""}. Posso usar por um momento?`);
      return;
    }
    const up = (voiceCfg.escalate !== "auto" ? voiceCfg.escalate : voiceCfg.upgradeModel) || voiceCfg.upgradeModel;
    r = await stageRefinePass(scope, utterance, up, voiceCfg.upgradeEffort);
    staging.push(key, { role: "user", text: utterance, ts: Date.now() }, r.draft, { escalated: true });
  } else {
    staging.push(key, { role: "user", text: utterance, ts: Date.now() }, r.draft);
  }
  if (r.say) staging.push(key, { role: "assistant", text: r.say, ts: Date.now() }, r.draft);
  broadcastOn(scope.runnerId, scope.sessionId, { t: "stage", runnerId: scope.runnerId, sessionId: scope.sessionId, draft: r.draft, say: r.say || "" });
  await stageSpeak(scope, r.say || "Anotei. Pode confirmar ou ajustar.");
}
async function stageEscalateApprove(scope: StageScope, ok: boolean): Promise<void> {
  const key = stageKey(scope), utterance = stageEscalatePending.get(key);
  stageEscalatePending.delete(key);
  if (!utterance || !staging.get(key)) return;
  const model = ok ? ((voiceCfg.escalate !== "auto" && voiceCfg.escalate !== "ask" ? voiceCfg.escalate : voiceCfg.upgradeModel) || voiceCfg.upgradeModel) : voiceCfg.fastModel;
  const effort = ok ? voiceCfg.upgradeEffort : voiceCfg.fastEffort;
  if (!ok) await stageSpeak(scope, "Ok, sigo com o modelo rápido.");
  const r = await stageRefinePass(scope, utterance, model, effort);
  staging.push(key, { role: "user", text: utterance, ts: Date.now() }, r.draft, { escalated: ok });
  if (r.say) staging.push(key, { role: "assistant", text: r.say, ts: Date.now() }, r.draft);
  broadcastOn(scope.runnerId, scope.sessionId, { t: "stage", runnerId: scope.runnerId, sessionId: scope.sessionId, draft: r.draft, say: r.say || "" });
  await stageSpeak(scope, r.say || "Pode confirmar.");
}
async function stageConfirm(scope: StageScope): Promise<void> {
  const key = stageKey(scope), e = staging.get(key);
  staging.remove(key); stageEscalatePending.delete(key);
  broadcastOn(scope.runnerId, scope.sessionId, { t: "stage", runnerId: scope.runnerId, sessionId: scope.sessionId, done: true });
  if (!e?.draft) return;
  clearPendingAsk(scope.runnerId, scope.sessionId);
  if (scope.runnerId === LOCAL_ID) {
    await deliverTurn(scope.sessionId, { showText: e.draft, speak: true, actor: scope.actor || { source: "user" } });
    return;
  }
  const rc = runners.get(scope.runnerId), state = runnerSessionState.get(scope.runnerId)?.get(scope.sessionId);
  if (!rc?.ws) throw new Error("máquina da sessão de voz está offline");
  if (runnerUpdateDraining(scope.runnerId) || runnerActive.get(scope.runnerId)?.has(scope.sessionId)) {
    enqueueChatTurn(scope.runnerId, scope.sessionId, { text: e.draft, atts: [], runnerId: scope.runnerId, msgId: randomUUID(), actor: { ...(scope.actor || {}), source: "queue" } });
    return;
  }
  const agent = state?.agent || rc.info.agents[0];
  if (!agent) throw new Error("nenhuma IA disponível na máquina da sessão de voz");
  remoteSpeak.add(scope.runnerId + "\0" + scope.sessionId);
  const actor = scope.actor || { source: "user" as const };
  const personal = await personalContextForChat(scope.runnerId, scope.sessionId, e.draft, actor);
  const turnId = randomUUID();
  if (!sendOwnedRunnerTurn(rc, scope.sessionId, turnId, actorPrincipalId(actor), { t: "send", text: e.draft, contextPrefix: personal?.contextPrefix, agent, actor })) {
    remoteSpeak.delete(scope.runnerId + "\0" + scope.sessionId);
    throw new Error("não foi possível enviar o refino de voz para a máquina");
  }
  markRunnerSessionActive(scope.runnerId, scope.sessionId);
}

/** Jarvis speaks a short control line into the voice session (not from the agent). */
async function voiceSay(text: string): Promise<void> {
  broadcast(WAKE_SESSION, { t: "message", message: { sessionId: WAKE_SESSION, role: "assistant", text, ts: Date.now(), agent: "jarvis" } });
  try { const wav = await synthesize(text, VOICE); broadcast(WAKE_SESSION, { t: "tts", sessionId: WAKE_SESSION, audio: wav.toString("base64"), text }); } catch { /* tts optional */ }
}
function resetVoiceSession(): void {
  const s = store.reset(WAKE_SESSION, { agent: voiceConfig.agent, cwd: voiceConfig.cwd, title: "Voz (Jarvis)" });
  broadcast(WAKE_SESSION, { t: "history", runnerId: LOCAL_ID, sessionId: s.id, session: { agent: s.agent, cwd: s.cwd, title: s.title }, messages: [] });
  pushSessions();
}
async function runVoiceTask(task: string, speak: boolean, speaker?: string): Promise<void> {
  const sid = voiceTarget || WAKE_SESSION; // binding: age na sessão-alvo (evita sessão errada)
  const s = store.ensure(sid);
  if (sid === WAKE_SESSION && s.messages.length === 0) store.reconfigure(WAKE_SESSION, { agent: voiceConfig.agent, cwd: voiceConfig.cwd });
  // sessão vinculada usa o modelo/esforço DELA (undefined → prefs/default); só a de voz usa voiceConfig.
  // e o ÁUDIO também vai pro canal de voz (WAKE) quando vinculado a outra sessão, senão o wake listener não ouve.
  await deliverTurn(sid, { showText: task, model: sid === WAKE_SESSION ? voiceConfig.model : undefined, effort: sid === WAKE_SESSION ? voiceConfig.effort : undefined, speak, speaker, speakAlso: sid !== WAKE_SESSION ? [WAKE_SESSION] : undefined, actor: { source: "user" } });
}
/** Wake sem contexto: sugere a sessão mais provável (memória semântica) e abre o overlay p/ decidir
 *  continuar nela ou criar nova. Sem sugestão forte → cai na sessão de voz (comportamento antigo). */
async function resolveVoice(task: string, speak: boolean, speaker?: string): Promise<void> {
  const sug = await suggestSession(task, { runnerId: LOCAL_ID, cwd: sessionCwd(voiceTarget || WAKE_SESSION) });
  if (sug && sug.id !== WAKE_SESSION && sug.id !== voiceTarget) {
    voiceResolve = { task, speak, speaker, suggestId: sug.id };
    broadcast(WAKE_SESSION, { t: "canvas", op: "show", kind: "resolve", title: "🎙 Onde continuar?", utterance: task, suggestion: sug, recents: store.list().slice(0, 20).map((s) => ({ id: s.id, title: s.title })) });
    await voiceSay(`Isso parece a sessão ${sug.title}. Continuo nela, ou começo uma nova?`);
    return;
  }
  await runVoiceTask(task, speak, speaker);
}

/** Proactive-voice router: pick agent/model/effort/folder from speech, and confirm
 *  new-vs-continue when a conversation is already in progress. */
/** Recent topic/context of a session (title + last few messages), for the relevance gate to judge
 *  whether a spoken follow-up is on-topic. Trimmed hard — this only needs the gist. */
function recentContextOf(sid: string): string {
  try {
    const s = store.get(sid);
    if (!s) return "";
    const msgs = (s.messages || []).slice(-3).map((m: any) => `${m.role === "user" ? "você" : "jarvis"}: ${String(m.text || "").slice(0, 200)}`);
    return [s.title ? `Sessão: ${s.title}` : "", ...msgs].filter(Boolean).join("\n").slice(0, 800);
  } catch { return ""; }
}
/** Fast-model relevance gate: true = dispatch to a session, false = ignore (noise / a conversation
 *  with someone else / off-topic). FAIL-OPEN — any error/unparseable verdict returns true, so a glitch
 *  never swallows a real command. Empty/garbage transcripts are dropped without even a model call. */
async function relevanceGate(text: string, context: string): Promise<boolean> {
  if (voiceCfg.relevance === "off") return true;
  if (!text || text.trim().length < 2) return false;
  try {
    const agent = summaryAgent();
    if (!agent?.oneShot) return true;
    const reply = await agent.oneShot(buildRelevancePrompt(text, context), await compatibleAgentOpts(agent, voiceCfg.fastModel, voiceCfg.fastEffort));
    addUsage(WAKE_SESSION, agent.name, reply.usage);
    const v = parseRelevanceVerdict(String(reply?.text ?? ""));
    if (!v.relevant) console.log(`[voz] descartado (irrelevante${v.reason ? ": " + v.reason : ""}): "${text.slice(0, 60)}"`);
    return v.relevant;
  } catch { return true; }
}
/** ONE fast-model call that corrects the transcript AND judges relevance (vs. two contending CLI
 *  spawns). Returns {text, relevant}. FAIL-OPEN. Empty/garbage → dropped without a model call. */
async function voicePreflight(rawText: string, context: string): Promise<{ text: string; relevant: boolean }> {
  if (!rawText || rawText.trim().length < 2) return { text: rawText, relevant: false };
  try {
    const agent = summaryAgent();
    if (!agent?.oneShot) return { text: rawText, relevant: true };
    const reply = await agent.oneShot(buildVoicePreflightPrompt(rawText, context), await compatibleAgentOpts(agent, voiceCfg.fastModel, voiceCfg.fastEffort));
    addUsage(WAKE_SESSION, agent.name, reply.usage);
    const r = parseVoicePreflight(String(reply?.text ?? ""), rawText);
    if (!r.relevant) console.log(`[voz] descartado (irrelevante): "${rawText.slice(0, 60)}"`);
    return r;
  } catch { return { text: rawText, relevant: true }; }
}
async function handleVoiceTurn(text: string, speak: boolean, speaker?: string): Promise<void> {
  // Relevance gate: unless we're waiting on a short control answer (continuar/nova/…), a captured
  // utterance must first pass a fast-model check that it's actually meant for Jarvis — not background
  // noise or you talking to someone else. If it fails, ignore it (no session dispatch).
  if (!voiceResolve && !voicePending) {
    if (!(await relevanceGate(text, voiceTarget ? recentContextOf(voiceTarget) : ""))) {
      broadcast(WAKE_SESSION, { t: "voice_ignored", text });
      return;
    }
  }
  const inProgress = store.ensure(WAKE_SESSION).messages.length > 0;
  // já vinculado a uma sessão? segue nela (contexto só dela), a menos que peça explicitamente nova/outra.
  if (voiceTarget && !/\b(nov[ao]|outra sess|do zero|come[çc]ar de novo)\b/i.test(text)) { await runVoiceTask(text, speak, speaker); return; }
  // resolvendo por VOZ o "continuar/nova" que o overlay perguntou
  if (voiceResolve) {
    const rp = voiceResolve;
    if (/\b(nov[ao]|do zero|outra|come[çc]ar)\b/i.test(text)) { voiceResolve = null; voiceTarget = ""; broadcast(WAKE_SESSION, { t: "canvas", op: "close" }); resetVoiceSession(); await runVoiceTask(rp.task, rp.speak, rp.speaker); return; }
    if (/\b(continu|sim|isso|nela|essa|pode|manter)\b/i.test(text) && rp.suggestId) { voiceResolve = null; voiceTarget = rp.suggestId; broadcast(WAKE_SESSION, { t: "canvas", op: "close" }); await runVoiceTask(rp.task, rp.speak, rp.speaker); return; }
    await voiceSay("Diga 'continuar' para seguir na sessão, ou 'nova' para começar do zero."); return;
  }
  // answering a pending "continuar ou nova?" (cheap, no LLM)
  if (voicePending) {
    const t = voicePending.task;
    if (/\bnov[ao]\b|come[çc]ar|do zero|outra/i.test(text)) { voicePending = null; resetVoiceSession(); await runVoiceTask(t, speak, speaker); return; }
    if (/\bcontinu|\bsegu|\bmesm[ao]\b|manter/i.test(text)) { voicePending = null; await runVoiceTask(t, speak, speaker); return; }
    voicePending = { task: text }; await voiceSay("Não entendi. Diga 'continuar' para seguir, ou 'nova' para começar do zero."); return;
  }
  const desc = await agents.describe();
  const hasControl = voiceMentionsCatalog(text, desc);
  // plain task, fresh session -> RESOLVE (sugere a sessão certa via memória; overlay decide)
  if (!inProgress && !hasControl) { await resolveVoice(text, speak, speaker); return; }
  // plain task, in progress -> ask new-vs-continue
  if (inProgress && !hasControl) { voicePending = { task: text }; await voiceSay("Já tenho uma conversa em andamento. Quer continuar ou começar uma nova?"); return; }
  // command-ish utterance -> one LLM intent pass
  const catalog = desc.map((a) => `${a.name} — modelos: ${a.models.map((m) => m.id).join(", ")} — esforços: ${[...new Set(a.models.flatMap((m) => m.efforts))].join(", ")}`).join("\n");
  const intent = await parseVoiceIntent({ text, catalog, recent: recentDirsList(20), inProgress, config: voiceConfig, agents });
  const empty = store.ensure(WAKE_SESSION).messages.length === 0;
  if (intent.agent && desc.some((a) => a.name === intent.agent) && empty) voiceConfig.agent = intent.agent;
  const acaps = desc.find((a) => a.name === voiceConfig.agent);
  if (intent.model && acaps?.models.some((m) => m.id === intent.model)) voiceConfig.model = intent.model;
  const efs = acaps?.models.find((m) => m.id === voiceConfig.model)?.efforts ?? acaps?.models.flatMap((m) => m.efforts) ?? [];
  if (intent.effort && efs.includes(intent.effort)) voiceConfig.effort = intent.effort;
  if (intent.folder && recentDirsList(20).includes(intent.folder) && empty) voiceConfig.cwd = intent.folder;
  const action = intent.sessionAction;
  const task = (intent.task || "").trim();
  if (!task) {
    if (action === "new") resetVoiceSession();
    const parts = [`Ok, ${voiceConfig.agent}`];
    if (voiceConfig.model) parts.push(`modelo ${voiceConfig.model}`);
    if (voiceConfig.effort) parts.push(`esforço ${PT_EFFORT[voiceConfig.effort] || voiceConfig.effort}`);
    if (voiceConfig.cwd) parts.push(`pasta ${voiceConfig.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}`);
    await voiceSay(parts.join(", ") + ". Pode falar.");
    return;
  }
  if (action === "new") { resetVoiceSession(); voiceTarget = ""; await runVoiceTask(task, speak, speaker); return; }
  if (inProgress && action !== "continue") { voicePending = { task }; await voiceSay("Já tenho uma conversa em andamento. Quer continuar ou começar uma nova?"); return; }
  // fresh command-ish sem alvo → resolve a sessão (sugere via memória) em vez de cair direto na voz
  if (!inProgress && !voiceTarget) { await resolveVoice(task, speak, speaker); return; }
  await runVoiceTask(task, speak, speaker);
}
/** One agent turn with LIVE streaming (tool activity + text) broadcast to session viewers.
 *  Returns the final reply. The stream 'done' event carries the final text + usage, so
 *  callers must NOT also broadcast a {t:message} assistant (they only persist it). */
// Live turns keyed by session, so a "parar" from any client can abort the actual agent process.
const localAborts = new Map<string, AbortController>();
// When the user hit "parar": ctrl.abort() is instant, but the CLI child process still has to notice
// the signal and actually exit before agentTurn's catch/finally unwinds — that gap is exactly the
// "parar demora" complaint. Stamped here, consumed (and cleared) in agentTurn's cancel branch.
const cancelRequestedAt = new Map<string, number>();
// Execution controls must address the exact root turn. A session can start another turn after the
// previous one finished; resolving cancellation through only the session id could otherwise let a
// stale UI command abort the newer turn.
const localExecutionAborts = new Map<string, AbortController>();
// Atividade viva bufferizada por sessão EM ANDAMENTO: um cliente que (re)abre no meio do turno
// replica o que perdeu e vê "processando" em vez de uma espera em branco. Limpo ao fim do turno
// (o texto final vai pro histórico, então replay só acontece enquanto o turno está ativo — sem
// duplicar o texto de um turno já concluído).
const activityBuf = new Map<string, any[]>();
// Fila POR MÁQUINA + SESSÃO, dona no HUB (não mais só no navegador): toda web vendo a sessão enxerga a MESMA
// fila, e o flush roda no servidor quando o turno termina — sobrevive mesmo que o dispositivo que
// enfileirou saia. Cada item guarda texto + anexos (+ model/effort do envio original).
type QueueItem = { text: string; atts: Array<{ name: string; content: string; image?: boolean; binary?: boolean; mime?: string; size?: number }>; model?: string; effort?: string; auto?: AutoRouteFlags; runnerId?: string; msgId?: string; actor?: ContextActor; queuedAt?: number };
const queues = new Map<string, QueueItem[]>();
// msgIds of queue items the user removed. A dequeue can land WHILE a flush is already mid-air: the
// flush captures the items and clears the queue, then spends SECONDS in async routing (a CLI spawn)
// before dispatching. During that window the item is no longer in the live queue, so index/msgId
// removal there is a no-op — the captured copy would still be sent. Recording the cancellation here
// lets the in-flight flush drop it right before dispatch. Bounded FIFO so it can't grow unbounded.
const cancelledFlushMsgIds = new Set<string>();
function markQueueItemCancelled(msgId?: string): void {
  if (!msgId) return;
  cancelledFlushMsgIds.add(msgId);
  while (cancelledFlushMsgIds.size > 1000) { const first = cancelledFlushMsgIds.values().next().value; if (first === undefined) break; cancelledFlushMsgIds.delete(first); }
}
type PendingInboundTurn = QueueItem & { sessionId: string; ts: number };
const PENDING_INBOUND_FILE = join(JARVIS_DIR, "pending-inbound-turns.json");
const PENDING_INBOUND_TTL_MS = 6 * 60 * 60 * 1000;
const pendingInboundTurns = new Map<string, PendingInboundTurn>();
function savePendingInboundTurns(): void {
  try { writeJsonAtomic(PENDING_INBOUND_FILE, Object.fromEntries(pendingInboundTurns)); } catch { /* best-effort recovery log */ }
}
function recordPendingInboundTurn(runnerId: string, sid: string, msg: any, text: string, actor: ContextActor): string | undefined {
  const id = typeof msg.msgId === "string" && msg.msgId ? msg.msgId : undefined;
  if (!id || isNativeId(sid) || runnerId !== LOCAL_ID) return undefined;
  pendingInboundTurns.set(id, {
    sessionId: sid, text, atts: Array.isArray(msg.attachments) ? msg.attachments : [],
    model: typeof msg.model === "string" ? msg.model : undefined,
    effort: typeof msg.effort === "string" ? msg.effort : undefined,
    auto: autoFlags(msg.auto), msgId: id, actor, ts: Date.now(),
  });
  savePendingInboundTurns();
  return id;
}
function clearPendingInboundTurn(id?: string): void {
  if (!id || !pendingInboundTurns.delete(id)) return;
  savePendingInboundTurns();
}
function loadPendingInboundTurns(): void {
  // allowStale:false — turnos pendentes de um snapshot VELHO seriam reentregues e rodariam de novo
  // (gasto de crédito + ação duplicada). Aqui é melhor começar vazio do que ressuscitar o passado.
  const raw = readJson<Record<string, PendingInboundTurn>>(PENDING_INBOUND_FILE, {}, { allowStale: false });
  const now = Date.now();
  for (const [id, item] of Object.entries(raw)) {
    if (!item || typeof item.sessionId !== "string" || typeof item.text !== "string" || now - Number(item.ts || 0) >= PENDING_INBOUND_TTL_MS) continue;
    if (isNativeId(item.sessionId)) continue;
    pendingInboundTurns.set(id, item);
  }
}
function recoverPendingInboundTurns(): void {
  for (const [id, item] of [...pendingInboundTurns]) {
    const q = queueOf(LOCAL_ID, item.sessionId);
    if (!q.some((queued) => queued.msgId === id)) pushQueueItem(LOCAL_ID, item.sessionId, { text: item.text, atts: item.atts || [], model: item.model, effort: item.effort, auto: item.auto, msgId: id, actor: { ...(item.actor || {}), source: "queue" } });
    pendingInboundTurns.delete(id);
    broadcastQueue(LOCAL_ID, item.sessionId);
  }
  saveQueues();
  savePendingInboundTurns();
}
function queueOf(runnerId: string, sid: string): QueueItem[] {
  const key = scopedSessionKey(runnerId, sid);
  let q = queues.get(key); if (!q) { q = []; queues.set(key, q); }
  return q;
}
/**
 * POR QUE a fila não saiu. `flushQueue`/`maybeFlushQueue` têm oito saídas antecipadas, e todas
 * retornavam em silêncio deixando a fila intacta — de fora, "o Hub tentou e desistiu" era
 * indistinguível de "ninguém tentou", e foi por isso que a fila encalhada sobreviveu a várias
 * investigações. Aqui cada saída passa a registrar o motivo, que viaja no frame `queue` e aparece na
 * barra da fila. Estado em memória de propósito: descreve o AGORA; se sumir num restart, a próxima
 * tentativa recalcula.
 */
const queueBlocks = new QueueBlockRegistry();
function noteQueueBlock(runnerId: string, sid: string, code: string, reason: string): void {
  if (!queueOf(runnerId, sid).length) { clearQueueBlock(runnerId, sid); return; }  // fila vazia não tem o que explicar
  const { changed } = queueBlocks.note(scopedSessionKey(runnerId, sid), code, reason, Date.now());
  if (changed) broadcastQueue(runnerId, sid);
  if (changed) log.warn("queue_blocked", { runnerId, sid, code, reason });
}
function clearQueueBlock(runnerId: string, sid: string): void {
  if (queueBlocks.clear(scopedSessionKey(runnerId, sid))) broadcastQueue(runnerId, sid);
}
function broadcastQueue(runnerId: string, sid: string): void {
  // msgId travels so the client can remove by STABLE id (index drifts if the queue changed).
  const block = queueBlocks.get(scopedSessionKey(runnerId, sid)) ?? null;
  broadcastOn(runnerId, sid, { t: "queue", runnerId, sessionId: sid, items: queueOf(runnerId, sid).map((q) => ({ text: q.text, atts: q.atts, msgId: q.msgId })), blocked: block });
}
/** Single choke point for every "push onto a queue" call site (there are several — direct busy-session
 *  enqueues as well as the enqueueChatTurn helper) so queue depth/wait-time are ALWAYS observable, not
 *  just for the paths someone remembered to instrument. Stamps queuedAt for queue_flush's waitMs. */
/** msgIds já ENTREGUES ao agente nesta execução do Hub. O caminho remoto já era idempotente (o runner
 *  ignora um turnId repetido); o local não tinha memória, então um item que voltasse à fila — por
 *  re-flush, reenvio do cliente ao reconectar ou restauração após falha — rodava DE NOVO, gerando um
 *  turno duplicado e cobrado duas vezes. */
const dispatchedTurns = createSeenSet(1000);

function pushQueueItem(runnerId: string, sid: string, item: QueueItem): number {
  item.queuedAt = item.queuedAt ?? Date.now();
  const q = queueOf(runnerId, sid);
  // Mesmo item chegando duas vezes (duplo submit, reenvio na reconexão) não entra duas vezes.
  if (item.msgId && (q.some((x) => x.msgId === item.msgId) || dispatchedTurns.has(item.msgId))) {
    log.debug("queue_enqueue_dup", { runnerId, sid, msgId: item.msgId });
    return q.length;
  }
  q.push(item);
  log.debug("queue_enqueue", { runnerId, sid, msgId: item.msgId, textLen: item.text.length, depth: q.length });
  return q.length;
}
function enqueueChatTurn(runnerId: string, sid: string, item: QueueItem): void {
  pushQueueItem(runnerId, sid, item);
  broadcastQueue(runnerId, sid);
  saveQueues();
}
function flushAllQueues(): void {
  for (const [key, items] of queues) if (items.length) { const scope = splitScopedSessionKey(key); void maybeFlushQueue(scope.runnerId, scope.sessionId, false); }
}

/** Inject a background job's result as an autonomous continuation turn on its ORIGIN session. Goes
 *  through the queue (not a raw runOwnedManagedTurn) so it inherits the concurrency lease, ownership
 *  resolution and native --resume for free, and works for both local and remote-runner sessions. The
 *  caller marks the job `continued` FIRST so a crash between mark and enqueue can't double-fire. */
/** A sessão de origem de um job ainda pode receber um turno nesta máquina? Sessão NATIVA vive no
 *  transcript do provider (nunca no store gerenciado) — tratar as duas do mesmo jeito era o bug que
 *  descartava a continuação de toda sessão nativa. */
function originSessionAlive(sid: string, runnerId: string = LOCAL_ID): boolean {
  const native = isNativeId(sid);
  return canContinueOriginSession({
    local: runnerId === LOCAL_ID,
    native,
    nativeTranscriptExists: native ? !!nativeInfo(sid) : false,
    managedSessionExists: !native ? !!store.get(sid) : false,
  });
}
function injectJobContinuation(job: BackgroundJob, text: string): { ok: true } | { ok: false; reason: string } {
  const runnerId = job.runnerId || LOCAL_ID;
  const sid = job.originSessionId;
  // A sessão de origem pode ser NATIVA (`claude:<uuid>`) — ela nunca esteve no store gerenciado, e a
  // checagem antiga (`!store.get(sid)`) derrubava a continuação de TODA sessão nativa em silêncio. O
  // caminho de flush já sabe entregar turno nativo (deliverNativeTurn), então o que importa aqui é só
  // se a sessão ainda EXISTE de alguma forma: transcript nativo legível, ou linha no store.
  if (!originSessionAlive(sid, runnerId)) return { ok: false, reason: "a sessão de origem não existe mais nesta máquina" };
  const owner = captureSessionOwnerGeneration(runnerId, sid);
  const actor: ContextActor = { userId: owner.principalId || "local", deviceId: "hub", source: "system" };
  enqueueChatTurn(runnerId, sid, { text, atts: [], actor, msgId: `job:${job.jobId}` });
  void maybeFlushQueue(runnerId, sid, false);
  return { ok: true };
}

/** Fire the auto-continuation for every terminal job that hasn't been continued yet. Called from the
 *  job-completion path (primary) and on a timer + at boot (safety net for jobs that finished while the
 *  Hub was down, or whose session was busy). Idempotent: `markContinued` is durable, so a job is only
 *  ever continued once even across restarts. */
function reconcileBackgroundJobs(): void {
  for (const job of backgroundJobs.pendingContinuation()) {
    const plan = planJobContinuation(job);
    // Close the job out (markContinued) so it stops being pending — retrying forever would be worse
    // than reporting. The rule that matters: NUNCA sair daqui em silêncio. Se a continuação não vai
    // acontecer, o usuário tem que ver na sessão, senão ele fica esperando um turno que nunca vem.
    backgroundJobs.markContinued(job.jobId);
    const target = job.runnerId || LOCAL_ID;
    let failure = plan.act ? "" : plan.reason;
    if (plan.act && plan.text) {
      const injected = injectJobContinuation(job, plan.text);
      if (!injected.ok) failure = injected.reason;
    }
    if (failure) {
      log.warn("job_continuation_skipped", { jobId: job.jobId, sessionId: job.originSessionId, runnerId: target, reason: failure });
      broadcastOn(target, job.originSessionId, { t: "notice", message: `A tarefa em segundo plano \`${job.command.slice(0, 60)}\` terminou (${job.status}), mas NÃO continuei a conversa: ${failure}. O resultado está no painel de tarefas.` });
    }
  }
  broadcastBackgroundJobs();
}
const HUB_JOB_DIR = join(JARVIS_DIR, "hub");
const JOB_CHAIN_WINDOW_MS = 15 * 60_000;
/** Start a Hub-owned detached background job for a LOCAL session and record it durably. The worker
 *  survives this turn (and the Hub); pollBackgroundJobs picks up its completion. Anti-loop: refuse if
 *  this session already spawned MAX jobs in the recent window (a runaway background→continue→background
 *  chain), so the depth carried into planJobContinuation stays bounded. */
function startLocalBackgroundJob(originSessionId: string, command: string, cwd: string): BackgroundJob | undefined {
  const now = Date.now();
  const depth = backgroundJobs.list().filter((j) => j.originSessionId === originSessionId && now - j.createdAt < JOB_CHAIN_WINDOW_MS).length;
  if (depth >= DEFAULT_MAX_AUTO_CONTINUE_DEPTH) {
    broadcastOn(LOCAL_ID, originSessionId, { t: "notice", message: `Limite de tarefas em segundo plano nesta sessão atingido (${DEFAULT_MAX_AUTO_CONTINUE_DEPTH}); rode manualmente.` });
    return undefined;
  }
  const job = backgroundJobs.create({ originSessionId, command, cwd, runnerId: LOCAL_ID, autoContinueDepth: depth });
  try {
    spawnDetachedJob(command, cwd, jobPaths(HUB_JOB_DIR, job.jobId));
    backgroundJobs.setStatus(job.jobId, "running");
    // Só prometer o que dá para cumprir: a continuação depende da sessão ainda existir no fim. Checar
    // AGORA não garante o futuro, mas transforma o caso estruturalmente impossível (sessão que já não
    // existe) num aviso honesto em vez da promessa cega que existia aqui antes.
    const canContinue = originSessionAlive(originSessionId);
    broadcastOn(LOCAL_ID, originSessionId, { t: "notice", message: canContinue
      ? `Tarefa em segundo plano iniciada: \`${command.slice(0, 80)}\`. Continuo a conversa sozinho quando terminar; acompanhe no painel de tarefas.`
      : `Tarefa em segundo plano iniciada: \`${command.slice(0, 80)}\`, mas esta sessão não pôde ser identificada — vou registrar o resultado no painel de tarefas SEM continuar a conversa.` });
    log.info("job_started", { jobId: job.jobId, sessionId: originSessionId, cwd, depth, canContinue, command: command.slice(0, 200) });
    broadcastBackgroundJobs();
  } catch (error) {
    backgroundJobs.setStatus(job.jobId, "failed", { exitCode: -1, resultSummary: `falha ao iniciar o job: ${String((error as Error)?.message || error)}` });
    reconcileBackgroundJobs();
  }
  return backgroundJobs.get(job.jobId);
}
/** Poll local running jobs: adopt the worker's real pid, and on completion record the terminal state
 *  (which reconcileBackgroundJobs then auto-continues). Runs on a short timer; crash-safe because the
 *  result file persists — a job that finishes while the Hub is down is caught on the next poll. */
function pollBackgroundJobs(): void {
  let anyTerminal = false, changed = false;
  for (const job of backgroundJobs.running()) {
    if ((job.runnerId || LOCAL_ID) !== LOCAL_ID) continue; // remote jobs are their runner's business (Phase 4)
    const paths = jobPaths(HUB_JOB_DIR, job.jobId);
    if (job.status === "queued") { const pid = readJobPid(paths); if (pid) { backgroundJobs.setPid(job.jobId, pid); changed = true; } continue; }
    if (job.pid === undefined) { const pid = readJobPid(paths); if (pid) { backgroundJobs.setPid(job.jobId, pid); changed = true; } }
    const completion = readJobCompletion(paths);
    if (completion) { backgroundJobs.setStatus(job.jobId, completion.exitCode === 0 ? "succeeded" : "failed", completion); anyTerminal = true; }
  }
  // Enquanto existe job vivo, re-transmite SEMPRE: é o que faz a cauda do log andar na tela em vez de
  // o usuário encarar uma linha parada sem saber se o processo travou.
  const anyLive = backgroundJobs.running().some((j) => (j.runnerId || LOCAL_ID) === LOCAL_ID);
  if (anyTerminal || changed || anyLive) broadcastBackgroundJobs();
  if (anyTerminal) reconcileBackgroundJobs();
}
/* ── Fluxos: acompanhamento (F2–F7) ───────────────────────────────────────────────────────────────
 * O run é do Hub (visível de qualquer máquina). Aqui ficam só os efeitos: ler a definição publicada,
 * transmitir o estado e aplicar o que a IA declarou no fim do turno. A lógica é pura, no core. */
function loadWorkflowDefinitions(): ReturnType<typeof workflowFromFile>[] {
  try {
    const defs = readCanonicalFramework(frameworkRoot()).files
      .filter((f) => f.path.startsWith("flows/"))
      .map((f) => workflowFromFile(f.content))
      .filter(Boolean);
    return dedupeWorkflowsById(defs as Array<NonNullable<ReturnType<typeof workflowFromFile>>>);
  } catch { return []; }
}
function workflowRunPayload(run: WorkflowRun): Record<string, unknown> {
  return { ...run, summary: summarizeRun(run), taskLabel: taskLabel(run.task) };
}
function broadcastWorkflowRuns(sessionId?: string): void {
  const payload = { t: "workflow_runs" as const, runs: workflowRuns.list().slice(0, 50).map(workflowRunPayload) };
  for (const c of wss.clients) { const w = c as WebSocket; if (w.readyState === WebSocket.OPEN && !runnerSockets.has(w) && isOwnerSocket(w)) { try { send(w, payload); } catch { /* skip */ } } }
  if (sessionId) { const run = workflowRuns.focusedFor(sessionId); if (run) broadcastOn(LOCAL_ID, sessionId, { t: "workflow_run", sessionId, run: workflowRunPayload(run) }); }
}
/** Aplica o que a IA declarou no texto do turno (F4) e os sinais locais (F7). Nunca quebra o turno. */
function applyWorkflowFromReply(sessionId: string, replyText: string): void {
  try {
    const run = workflowRuns.focusedFor(sessionId);   // multi-tarefa: a IA declara avanço na tarefa em foco
    if (!run) return;
    const directives = parseStepDirectives(replyText || "");
    if (!directives.length) { suggestWorkflowSignals(sessionId, run, replyText || ""); return; }
    const now = Date.now();
    const { run: next, applied } = applyStepDirectives(run, directives, now);
    if (!applied.length) return;
    workflowRuns.put(next);
    const s = summarizeRun(next);
    broadcastOn(LOCAL_ID, sessionId, { t: "notice", message: `Fluxo: ${applied.map((a) => `${a.action === "skip" ? "pulou" : a.action === "current" ? "foco em" : "concluiu"} “${a.title}”`).join("; ")} (${s.done}/${s.total})` });
    broadcastWorkflowRuns(sessionId);
  } catch { /* acompanhar nunca pode derrubar o turno */ }
}

/** F7 — sinais locais: o turno deixou pista de PR/commit/teste? Apenas SUGERE marcar o passo atual;
 *  nunca altera estado sozinho (a decisão continua sua). Silencioso quando não há sinal claro. */
function suggestWorkflowSignals(sessionId: string, run: WorkflowRun, replyText: string): void {
  const cur = run.steps.find((s) => s.id === run.currentStepId);
  if (!cur) return;
  const text = replyText.slice(0, 20_000);
  const signals: string[] = [];
  if (/https?:\/\/[^\s)]+\/(pull|merge_requests)\/\d+/i.test(text)) signals.push("PR aberto");
  if (/\b[0-9a-f]{7,40}\b(?=[^\n]*\bcommit\b)|\bcommit\s+[0-9a-f]{7,40}\b/i.test(text)) signals.push("commit");
  if (/\b(\d+)\s*(?:tests?|testes)\s*(?:pass|passaram|passing|ok)\b|\bpass\s+\d+\b|\ball tests? pass/i.test(text)) signals.push("testes verdes");
  if (!signals.length) return;
  broadcastOn(LOCAL_ID, sessionId, { t: "notice", message: `Fluxo: detectei ${signals.join(" e ")} neste turno. Marcar “${cur.title}” como feito?` });
}

/** Mata o worker detached de um job (e sua árvore) — best-effort, multiplataforma. */
function killJob(pid: number): void {
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }).unref?.();
    else { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* já saiu */ } } }
  } catch { /* best effort */ }
}
/** Jobs mostrados ao dono na UI: tudo ainda vivo + os terminais recentes (para ver "acabou/falhou" por
 *  um tempo). Comando truncado; nada além do próprio comando é exposto. */
function backgroundJobsForUi(): Array<Record<string, unknown>> {
  // Uma hora (era 10min): a queixa real era job terminal SUMINDO da tela antes de o usuário entender o
  // que houve — principalmente o que falhou. Enquanto vive, manda a cauda do log para dar progresso.
  const RECENT_MS = 60 * 60_000, now = Date.now();
  return backgroundJobs.list()
    .filter((j) => !j.dismissedAt)
    .filter((j) => !isTerminalJobStatus(j.status) || now - j.updatedAt < RECENT_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30)
    .map((j) => {
      const terminal = isTerminalJobStatus(j.status);
      // Job vivo: lê a cauda do log agora (só os poucos em execução tocam o disco). Terminal: já temos
      // o resumo persistido, não relê nada.
      const output = terminal ? (j.resultSummary || "") : (j.runnerId || LOCAL_ID) === LOCAL_ID ? readJobLogTail(jobPaths(HUB_JOB_DIR, j.jobId), 2000) : "";
      return {
        jobId: j.jobId, command: j.command.length > 200 ? j.command.slice(0, 200) + "…" : j.command,
        status: j.status, sessionId: j.originSessionId, runnerId: j.runnerId || LOCAL_ID,
        createdAt: j.createdAt, updatedAt: j.updatedAt, exitCode: j.exitCode,
        // `continued` distingue "terminou e devolveu o resultado na conversa" de "terminou e parou aqui" —
        // exatamente a dúvida que não dava para responder olhando a tela.
        continued: !!j.continued, output: output.length > 2000 ? output.slice(output.length - 2000) : output,
      };
    });
}
function broadcastBackgroundJobs(): void {
  const payload = { t: "background_jobs" as const, jobs: backgroundJobsForUi() };
  for (const c of wss.clients) { const w = c as WebSocket; if (w.readyState === WebSocket.OPEN && !runnerSockets.has(w) && isOwnerSocket(w)) { try { send(w, payload); } catch { /* skip */ } } }
}
/** Rede de segurança periódica: drena só fila ESQUECIDA — sessão ociosa, sem despacho em voo e com
 *  item parado há um tempo. O flush cego a cada 15s reencostava em despachos em andamento; a
 *  idempotência (dispatchedTurns) já impede repetir, mas não faz sentido insistir sem necessidade. */
const IDLE_QUEUE_MS = 20_000;
function flushIdleQueues(): void {
  const now = Date.now();
  for (const [key, items] of queues) {
    if (!items.length) continue;
    const scope = splitScopedSessionKey(key);
    // Estes três `continue` também eram mudos, e são justamente os que reavaliam a fila encalhada a
    // cada 15s — sem registrar o motivo, a rede de segurança rodava sem deixar rastro de por que
    // desistiu. É a informação mais útil quando a fila está parada há horas.
    if (scope.runnerId === LOCAL_ID && activeRuns.has(scope.sessionId)) { noteQueueBlock(scope.runnerId, scope.sessionId, "turn_running", "o turno anterior desta sessão ainda está rodando"); continue; }
    if (dispatchReservations.isHeld(scope.runnerId, scope.sessionId)) { noteQueueBlock(scope.runnerId, scope.sessionId, "dispatch_held", "outro despacho desta sessão está em voo"); continue; }
    const oldest = items.reduce((min, it) => (it.queuedAt != null && it.queuedAt < min ? it.queuedAt : min), Infinity);
    if (Number.isFinite(oldest) && now - oldest < IDLE_QUEUE_MS) continue;               // acabou de entrar
    void maybeFlushQueue(scope.runnerId, scope.sessionId, false);
  }
}
function flushQueuesForRunner(runnerId: string): void {
  for (const [key, items] of queues) {
    const scope = splitScopedSessionKey(key);
    if (items.length && scope.runnerId === runnerId) void maybeFlushQueue(runnerId, scope.sessionId, false);
  }
}
// A fila vive em memória; um restart do hub a perdia. Persistimos num cache com TTL para que, após
// reiniciar, o usuário VEJA a fila de volta e continue de onde estava (some sozinha após o TTL).
const QUEUES_FILE = join(JARVIS_DIR, "queues.json");
const QUEUE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
function saveQueues(): void {
  try {
    const now = Date.now();
    const obj: Record<string, { runnerId: string; sessionId: string; items: QueueItem[]; ts: number }> = {};
    for (const [key, items] of queues) if (items.length) {
      const scope = splitScopedSessionKey(key);
      obj[key] = { ...scope, items, ts: now };
    }
    // Sem `.bak`: loadQueues lê o primário direto (nunca o backup), então o .bak aqui só desperdiçava
    // I/O e deixava uma cópia velha do TEXTO das mensagens no disco.
    writeJsonAtomic(QUEUES_FILE, obj, { backup: false });
  } catch { /* ignore */ }
}
function loadQueues(): void {
  try {
    const obj = JSON.parse(readFileSync(QUEUES_FILE, "utf8"));
    const now = Date.now();
    for (const persistedKey of Object.keys(obj)) {
      const e = obj[persistedKey];
      if (!e || !Array.isArray(e.items) || !e.items.length) continue;
      // O TTL vale por ITEM, pela hora em que ele entrou na fila. Antes valia contra `e.ts`, que
      // `saveQueues` reescreve com `Date.now()` a CADA gravação — então o prazo se renovava sozinho e
      // nunca expirava: um item preso ressuscitava a cada restart, indefinidamente (havia um de 6 dias
      // em disco). `e.ts` só é usado como base para item antigo, sem `queuedAt`.
      const items = (e.items as QueueItem[]).filter((it) => now - (it?.queuedAt ?? e.ts ?? 0) < QUEUE_TTL_MS);
      if (!items.length) continue;
      const parsed = splitScopedSessionKey(persistedKey);
      const runnerId = typeof e.runnerId === "string" && e.runnerId ? e.runnerId : (items.find((item: QueueItem) => item?.runnerId)?.runnerId || parsed.runnerId);
      const sessionId = typeof e.sessionId === "string" && e.sessionId ? e.sessionId : parsed.sessionId;
      queues.set(scopedSessionKey(runnerId, sessionId), items);
    }
  } catch { /* ignore */ }
}
// Custo ACUMULADO por sessão (o que passou pelo Jarvis), persistido pra sobreviver a reload/restart.
const COST_FILE = join(JARVIS_DIR, "session-cost.json");
const usageLedger = new UsageLedger(COST_FILE);
function sessionUsage(sid: string, runnerId = LOCAL_ID): ReturnType<UsageLedger["session"]> { return usageLedger.session(sid, runnerId); }
function costOf(sid: string, runnerId = LOCAL_ID): number { return sessionUsage(sid, runnerId).costUsd; }
function addUsage(sid: string, agent: string, usage?: AgentReply["usage"], runnerId = LOCAL_ID): void { usageLedger.record(sid, agent, usage, runnerId); }
function usageFromMessages(messages: any[] = []): ReturnType<UsageLedger["session"]> {
  const out: ReturnType<UsageLedger["session"]> = { costUsd: 0, billableUsd: 0, estimatedUsd: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, byKind: {} };
  for (const msg of messages) {
    const u = msg?.usage; if (!u || typeof u !== "object") continue;
    out.inputTokens += Number(u.inputTokens) || 0; out.cachedInputTokens += Number(u.cachedInputTokens) || 0; out.outputTokens += Number(u.outputTokens) || 0;
    const cost = Number(u.costUsd) || 0, kind = String(u.costKind || "unavailable") as keyof typeof out.byKind;
    out.costUsd += cost; out.byKind[kind] = (out.byKind[kind] || 0) + cost;
    if (kind === "billed") out.billableUsd += cost;
    else if (kind === "estimated_api_equivalent") out.estimatedUsd += cost;
    if (Number(u.contextTokens) > 0) out.contextTokens = Number(u.contextTokens);
    if (Number(u.contextWindowTokens) > 0) out.contextWindowTokens = Number(u.contextWindowTokens);
    if (typeof u.model === "string" && u.model) out.model = u.model;
    if (typeof u.effort === "string" && u.effort) out.effort = u.effort;
  }
  return out;
}
function effectiveSessionUsage(sid: string, messages: any[] = [], runnerId = LOCAL_ID): ReturnType<UsageLedger["session"]> {
  const ledger = sessionUsage(sid, runnerId), hist = usageFromMessages(messages);
  const out = { ...ledger, byKind: { ...ledger.byKind } };
  if (hist.costUsd > out.costUsd) {
    out.costUsd = hist.costUsd; out.billableUsd = hist.billableUsd; out.estimatedUsd = hist.estimatedUsd; out.byKind = hist.byKind;
  }
  if (!out.inputTokens && hist.inputTokens) out.inputTokens = hist.inputTokens;
  if (!out.cachedInputTokens && hist.cachedInputTokens) out.cachedInputTokens = hist.cachedInputTokens;
  if (!out.outputTokens && hist.outputTokens) out.outputTokens = hist.outputTokens;
  out.contextTokens ||= hist.contextTokens;
  out.contextWindowTokens ||= hist.contextWindowTokens;
  out.model ||= hist.model;
  out.effort ||= hist.effort;
  return out;
}

function autoFlags(value: unknown): AutoRouteFlags {
  const v: any = value;
  return { agent: v?.agent === true, model: v?.model === true, effort: v?.effort === true };
}
function needsAuto(flags: AutoRouteFlags): boolean { return flags.agent || flags.model || flags.effort; }

async function decideAutomaticRoute(input: {
  runnerId: string;
  sid: string;
  text: string;
  started: boolean;
  currentAgent: string;
  currentModel?: string;
  currentEffort?: string;
  flags: AutoRouteFlags;
  descriptors: unknown;
  available: string[];
  recent?: Array<{ role: "user" | "assistant"; text: string }>;
  contextTokens?: number;
  contextWindowTokens?: number;
  notify?: (message: unknown) => void;
}): Promise<AutoRouteDecision> {
  const catalog = normalizeAutoRouteAgents(input.descriptors, input.available);
  const req = {
    message: input.text,
    started: input.started,
    currentAgent: input.currentAgent,
    currentModel: input.currentModel,
    currentEffort: input.currentEffort,
    flags: input.flags,
    agents: catalog,
    recent: input.recent,
    contextTokens: input.contextTokens,
    contextWindowTokens: input.contextWindowTokens,
  };
  if (!needsAuto(input.flags)) return { agent: input.currentAgent, model: input.currentModel, effort: input.currentEffort, reason: "seleção manual", fallback: false };
  input.notify?.({ t: "auto_route", runnerId: input.runnerId, sessionId: input.sid, state: "started" });
  let decision: AutoRouteDecision | null = null;
  const ctrl = new AbortController();
  const routeKey = scopedSessionKey(input.runnerId, input.sid);
  routeAborts.set(routeKey, ctrl);
  // The router is a CLI spawn that runs BEFORE the real turn (auto mode = 2 sequential spawns). It's
  // a latency optimization that must never BECOME the latency: bound it, and on timeout fall back to
  // the deterministic router (keeps the current agent) instead of making the whole turn wait. A
  // user-initiated cancel (routeAborts) is still honored — we distinguish it from a timeout abort.
  let timedOut = false;
  const routeTimeoutMs = Math.max(1000, Number(process.env.JARVIS_AUTOROUTE_TIMEOUT_MS) || 8000);
  const routeTimer = setTimeout(() => { timedOut = true; ctrl.abort(); }, routeTimeoutMs);
  const tRoute = Date.now();
  try {
    const router = summaryAgent();
    if (!router.oneShot) throw new Error("agente de roteamento sem suporte one-shot");
    const reply = await router.oneShot(buildAutoRoutePrompt(req), { ...(await compatibleAgentOpts(router, summaryCfg.model, summaryCfg.effort)), signal: ctrl.signal });
    // Routing is deliberately accounted outside the conversation: it must appear in total usage,
    // but never inflate the target session's context/cost as if the main coding agent spent it.
    addUsage("__auto_route__", router.name, reply.usage);
    decision = parseAutoRouteDecision(reply.text, req);
  } catch {
    // Only a genuine user cancel aborts the turn; a timeout (or any router error) is non-fatal and
    // falls through to the deterministic fallback below.
    if (ctrl.signal.aborted && !timedOut) { input.notify?.({ t: "auto_route", runnerId: input.runnerId, sessionId: input.sid, state: "cancelled" }); throw new Error(ABORTED); }
  } finally {
    clearTimeout(routeTimer);
    if (routeAborts.get(routeKey) === ctrl) routeAborts.delete(routeKey);
  }
  log.debug("autoroute", { sessionId: input.sid, runnerId: input.runnerId, ms: Date.now() - tRoute, outcome: timedOut ? "timeout_fallback" : decision ? "llm" : "error_fallback" });
  if (!decision) decision = autoRouteFallback(req);
  input.notify?.({ t: "auto_route", runnerId: input.runnerId, sessionId: input.sid, state: "completed", decision });
  return decision;
}

async function routeLocalTurn(sid: string, text: string, model: unknown, effort: unknown, flags: AutoRouteFlags): Promise<AutoRouteDecision> {
  const native = isNativeId(sid);
  const info = native ? nativeInfo(sid) : store.ensure(sid);
  if (!info) throw new Error("sessão não encontrada");
  const history = native ? (nativeHistory(sid)?.messages || []) : store.history(sid);
  const recent = history.filter((m: any) => m?.role === "user" || m?.role === "assistant").slice(-6).map((m: any) => ({ role: m.role as "user" | "assistant", text: String(m.text || "") }));
  const su = sessionUsage(sid);
  const decision = await decideAutomaticRoute({
    runnerId: LOCAL_ID, sid, text, started: native || history.length > 0, currentAgent: info.agent,
    currentModel: typeof model === "string" ? model : (flags.model ? su.model : undefined),
    currentEffort: typeof effort === "string" ? effort : undefined,
    flags, descriptors: await agents.describe(), available: localAgents,
    recent, contextTokens: su.contextTokens, contextWindowTokens: su.contextWindowTokens,
    notify: (frame) => broadcast(sid, frame),
  });
  if (!native && history.length === 0 && decision.agent !== info.agent) {
    if (!store.reconfigure(sid, { agent: decision.agent })) throw new Error("a IA da sessão foi bloqueada antes da decisão automática");
    pushSessions();
  }
  return decision;
}

function councilRecentLocal(sessionId: string): Array<{ role: "user" | "assistant"; text: string }> {
  return store.history(sessionId).filter((m: any) => m?.role === "user" || m?.role === "assistant")
    .slice(-6).map((m: any) => ({ role: m.role as "user" | "assistant", text: String(m.text || "") }));
}

function councilTopic(topic: string, recent: Array<{ role: "user" | "assistant"; text: string }>, includeContext: boolean): string {
  const base = topic.trim();
  if (!includeContext || !recent.length) return base;
  const context = recent.map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text.slice(0, 1200)}`).join("\n\n");
  return `${base}\n\nContexto recente da sessão:\n${context}`;
}

async function decideCouncilRoute(input: {
  topic: string;
  requestedMode: CouncilMode;
  recent: Array<{ role: "user" | "assistant"; text: string }>;
}): Promise<CouncilRouteDecision> {
  const req = { topic: input.topic, requestedMode: input.requestedMode, recent: input.recent };
  if (input.requestedMode !== "auto") return councilRouteFallback(req);
  let decision: CouncilRouteDecision | null = null;
  try {
    const router = summaryAgent();
    if (!router.oneShot) throw new Error("agente de roteamento sem suporte one-shot");
    const reply = await router.oneShot(buildCouncilRoutePrompt(req), await compatibleAgentOpts(router, summaryCfg.model, summaryCfg.effort));
    addUsage("__council_route__", router.name, reply.usage);
    decision = parseCouncilRouteDecision(reply.text, req);
  } catch {
    // deterministic fallback below
  }
  return decision || councilRouteFallback(req);
}

function councilFinalSummary(source: ExecutionStore, rootExecutionId: string, finalTaskId: string): string | undefined {
  const finalId = managedChildExecutionId(rootExecutionId, finalTaskId);
  const final = source.findNode(finalId)?.node;
  if (final?.summary?.trim()) return final.summary;
  return source.findNode(rootExecutionId)?.node.summary;
}

function filterSolutionAgents<T extends { name?: string }>(items: T[], selected?: string[]): T[] {
  const wanted = new Set((selected || []).filter(Boolean));
  return wanted.size ? items.filter((item) => item.name && wanted.has(item.name)) : items;
}

async function startLocalCouncil(ws: WebSocket, input: {
  sessionId: string;
  topic: string;
  mode: CouncilMode;
  includeContext: boolean;
  model?: string;
  effort?: string;
  agents?: string[];
}): Promise<void> {
  if (!executionCfg.enabled) { send(ws, { t: "error", message: "Conselho exige Trabalhos habilitado" }); return; }
  if (isNativeId(input.sessionId)) { send(ws, { t: "error", message: "Conselho ainda não grava resultado em sessão nativa" }); return; }
  if (store.isHidden(input.sessionId)) { send(ws, { t: "error", message: "sessão interna não aceita Conselho" }); return; }
  const s = store.get(input.sessionId);
  if (!s) { send(ws, { t: "error", message: "sessão não encontrada" }); return; }
  const recent = councilRecentLocal(input.sessionId);
  const route = await decideCouncilRoute({ topic: input.topic, requestedMode: input.mode, recent });
  const topic = councilTopic(input.topic, recent, input.includeContext);
  const built = buildCouncilPlan({
    runnerId: LOCAL_ID, sessionId: input.sessionId, topic, cwd: s.cwd || CWD, mode: route.mode,
    agents: filterSolutionAgents(await agents.describe() as any, input.agents), preferredAgent: s.agent, model: input.model, effort: input.effort,
  });
  const requestText = formatCouncilRequestMessage(input.topic, route.mode);
  const ts = Date.now();
  store.add(input.sessionId, { role: "user", text: requestText, ts, agent: "jarvis" });
  broadcast(input.sessionId, { t: "message", message: { sessionId: input.sessionId, role: "user", text: requestText, ts, agent: "jarvis" } });
  pushSessions();
  auth.audit("council_start", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${built.rootExecutionId}: ${route.mode}` });
  executionOwnership.claim(LOCAL_ID, built.rootExecutionId, socketPrincipalId(ws));

  const ctrl = new AbortController();
  localManagedRuns.add(built.rootExecutionId); localExecutionAborts.set(built.rootExecutionId, ctrl); broadcastRuns();
  void localManagedExecution.run(built.plan, {
    title: built.title, policy: boundedManagedPolicy(mergeAdaptiveManagedPolicy(built.policy, resolveAdaptivePolicy(adaptivePolicyDoc, { cwd: s.cwd || CWD }).policy)),
    signal: ctrl.signal,
    onAccepted: (rootExecutionId) => send(ws, { t: "council_started", runnerId: LOCAL_ID, sessionId: input.sessionId, rootExecutionId, mode: route.mode, reason: route.reason }),
  }).then((report) => {
    const summary = councilFinalSummary(localExecutionStore, built.rootExecutionId, built.finalTaskId);
    const text = formatCouncilFinalMessage({ mode: route.mode, rootExecutionId: built.rootExecutionId, summary, failed: report.state !== "succeeded" });
    const at = Date.now();
    store.add(input.sessionId, { role: "assistant", text, ts: at, agent: "jarvis" });
    broadcast(input.sessionId, { t: "message", message: { sessionId: input.sessionId, role: "assistant", text, ts: at, agent: "jarvis" } });
    pushSessions();
    // Mesmo buraco do Debate: o Conselho roda como execução gerenciada, fora da sessão da IA.
    addSessionBriefing(input.sessionId, `🧠 Conselho · ${input.topic.split(/\r?\n/)[0].slice(0, 120)}`, text);
  }).catch((error) => {
    const message = "Conselho: " + String((error as Error)?.message || error);
    send(ws, { t: "error", message });
  }).finally(() => {
    localManagedRuns.delete(built.rootExecutionId);
    if (localExecutionAborts.get(built.rootExecutionId) === ctrl) localExecutionAborts.delete(built.rootExecutionId);
    broadcastRuns();
  });
}

/** Lê estado/custo/tokens de cada candidato do execution store (mesmo caminho do councilFinalSummary),
 *  para alimentar a seleção determinística do vencedor. */
function tournamentCandidateResults(source: ExecutionStore, rootExecutionId: string, candidateTaskIds: string[], scores: Map<string, number>): TournamentCandidateResult[] {
  return candidateTaskIds.map((taskId) => {
    const node = source.findNode(managedChildExecutionId(rootExecutionId, taskId))?.node;
    const m = node?.metrics?.self;
    const tokens = (m?.inputTokens || 0) + (m?.outputTokens || 0);
    return { id: taskId, state: (node?.state as ManagedTaskState) ?? "queued", score: scores.get(taskId), costUsd: m?.costUsd, tokens: tokens || undefined };
  });
}
/** Solution Workspace local: fan-out da MESMA tarefa para N candidatos + consolidador/juiz.
 *  Espelha startLocalCouncil (mesma malha ManagedExecution/store/broadcast). */
async function startLocalTournament(ws: WebSocket, input: { sessionId: string; task: string; competitors: TournamentCompetitor[]; criteria?: string; write?: boolean; mode?: SolutionWorkspaceMode }): Promise<void> {
  const mode = input.mode || "benchmark";
  const flowLabel = mode === "benchmark" ? "Benchmark" : mode === "audit" ? "Auditoria" : "Revisão paralela";
  if (!executionCfg.enabled) { send(ws, { t: "error", message: `${flowLabel} exige Trabalhos habilitado` }); return; }
  if (isNativeId(input.sessionId)) { send(ws, { t: "error", message: `${flowLabel} ainda não grava resultado em sessão nativa` }); return; }
  if (store.isHidden(input.sessionId)) { send(ws, { t: "error", message: `sessão interna não aceita ${flowLabel}` }); return; }
  const s = store.get(input.sessionId);
  if (!s) { send(ws, { t: "error", message: "sessão não encontrada" }); return; }
  let built;
  try { built = buildTournamentPlan({ runnerId: LOCAL_ID, sessionId: input.sessionId, cwd: s.cwd || CWD, task: input.task, competitors: input.competitors, criteria: input.criteria, write: input.write, mode }); }
  catch (e: any) { send(ws, { t: "error", message: `${flowLabel}: ` + String(e?.message ?? e) }); return; }
  const requestText = `🧪 ${flowLabel} (${input.competitors.length} candidatos): ${input.task.split(/\r?\n/)[0].slice(0, 200)}`;
  const ts = Date.now();
  store.add(input.sessionId, { role: "user", text: requestText, ts, agent: "jarvis" });
  broadcast(input.sessionId, { t: "message", message: { sessionId: input.sessionId, role: "user", text: requestText, ts, agent: "jarvis" } });
  pushSessions();
  auth.audit("tournament_start", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${built.rootExecutionId}: ${mode} · ${input.competitors.length} cand.` });
  executionOwnership.claim(LOCAL_ID, built.rootExecutionId, socketPrincipalId(ws));

  const ctrl = new AbortController();
  localManagedRuns.add(built.rootExecutionId); localExecutionAborts.set(built.rootExecutionId, ctrl); broadcastRuns();
  void localManagedExecution.run(built.plan, {
    title: built.title, policy: boundedManagedPolicy(mergeAdaptiveManagedPolicy(built.policy, resolveAdaptivePolicy(adaptivePolicyDoc, { cwd: s.cwd || CWD }).policy)),
    signal: ctrl.signal,
    onAccepted: (rootExecutionId) => send(ws, { t: "tournament_started", runnerId: LOCAL_ID, sessionId: input.sessionId, rootExecutionId, mode }),
  }).then((report) => {
    const judgeSummary = councilFinalSummary(localExecutionStore, built.rootExecutionId, built.judgeTaskId);
    const verdict = parseJudgeScores(judgeSummary);
    const scores = new Map(verdict.scores.map((sc) => [sc.id, sc.score]));
    const results = tournamentCandidateResults(localExecutionStore, built.rootExecutionId, built.candidateTaskIds, scores);
    const outcome = selectTournamentWinner(results, { declaredWinnerId: verdict.declaredWinnerId });
    const text = formatTournamentFinalMessage({ rootExecutionId: built.rootExecutionId, outcome, summary: report.state === "succeeded" ? judgeSummary : undefined, mode });
    const at = Date.now();
    store.add(input.sessionId, { role: "assistant", text, ts: at, agent: "jarvis" });
    broadcast(input.sessionId, { t: "message", message: { sessionId: input.sessionId, role: "assistant", text, ts: at, agent: "jarvis" } });
    pushSessions();
    // Idem para Benchmark/Revisão/Auditoria: o veredito do juiz existe no chat e não na IA da sessão.
    addSessionBriefing(input.sessionId, `${flowLabel} · ${input.task.split(/\r?\n/)[0].slice(0, 120)}`, text);
  }).catch((error) => {
    send(ws, { t: "error", message: `${flowLabel}: ` + String((error as Error)?.message || error) });
  }).finally(() => {
    localManagedRuns.delete(built.rootExecutionId);
    if (localExecutionAborts.get(built.rootExecutionId) === ctrl) localExecutionAborts.delete(built.rootExecutionId);
    broadcastRuns();
  });
}

/**
 * Fila de resultados que o Jarvis publicou na conversa SEM passar pela IA da sessão (Debate, Conselho,
 * Torneio). Entregue uma vez, no próximo turno, como contexto — ver `session-briefing.ts`.
 *
 * DURÁVEL, e o protocolo é este: um debate que levou minutos e custou N chamadas não pode virar nada
 * porque o Hub reiniciou no intervalo entre o resultado e a sua próxima mensagem — que é justamente
 * quando um update roda. O que segura o arquivo é TETO, não sorte: corpo cortado no mesmo limite que a
 * renderização usa, 5 resultados por sessão e 50 sessões, as mais recentes. Um JSON sem teto já custou
 * caro neste projeto. O TTL descarta o briefing que ninguém foi buscar — contexto velho é ruído.
 */
const SESSION_BRIEFINGS_FILE = join(JARVIS_DIR, "session-briefings.json");
const sessionBriefings = new Map<string, StoredSessionBriefing[]>(
  Object.entries(pruneStoredBriefings(readJson<unknown>(SESSION_BRIEFINGS_FILE, {}), Date.now())),
);
function saveSessionBriefings(): void {
  // Persistir é melhoria do turno seguinte; nunca pode derrubar o debate que acabou de terminar.
  try { writeJsonAtomic(SESSION_BRIEFINGS_FILE, pruneStoredBriefings(Object.fromEntries(sessionBriefings), Date.now())); }
  catch (error) { log.warn("session_briefing_persist_failed", { error: String((error as Error)?.message || error) }); }
}
function addSessionBriefing(sessionId: string, kind: string, body: string): void {
  const texto = String(body || "").trim();
  if (!sessionId || !texto) return;
  const list = sessionBriefings.get(sessionId) || [];
  // Corta no mesmo teto da renderização: guardar mais do que a IA jamais vai ler só engorda o arquivo.
  list.push({ kind, body: texto.slice(0, SESSION_BRIEFING_MAX_CHARS), at: Date.now() });
  sessionBriefings.set(sessionId, list.slice(-SESSION_BRIEFING_MAX_PER_SESSION));
  saveSessionBriefings();
}
/** Retira os pendentes válidos. `restoreSessionBriefings` devolve quando o turno não chegou a acontecer. */
function takeSessionBriefings(sessionId: string): StoredSessionBriefing[] {
  const list = sessionBriefings.get(sessionId);
  if (!list?.length) return [];                 // caso comum (turno sem nada pendente): não toca o disco
  sessionBriefings.delete(sessionId);
  saveSessionBriefings();
  const now = Date.now();
  return list.filter((i) => now - i.at < SESSION_BRIEFING_TTL_MS);
}
function restoreSessionBriefings(sessionId: string, items: StoredSessionBriefing[]): void {
  if (!items.length) return;
  const list = sessionBriefings.get(sessionId) || [];
  sessionBriefings.set(sessionId, [...items, ...list].slice(-SESSION_BRIEFING_MAX_PER_SESSION));
  saveSessionBriefings();
}

/**
 * Debates VIVOS, por debateId — o registro que torna a INTERJEIÇÃO possível.
 *
 * Enquanto um debate roda, o chat daquela sessão fala com o DEBATE, não com a IA da sessão: antes, a
 * mensagem virava um turno paralelo que o debate ignorava (e a IA da sessão respondia sem nunca ter
 * visto o debate, porque as rodadas são one-shot fora do transcript nativo dela). O recado entra no
 * prompt de TODOS os participantes na rodada seguinte.
 *
 * `pending` é o que ainda não entrou numa rodada; `all` é tudo que o usuário disse no debate e vai
 * para a síntese — assim um recado que chegou depois da última rodada ainda é respondido no veredito,
 * em vez de sumir. `closed` marca o ponto em que não existe mais rodada para receber recado (síntese
 * em diante): dali em diante o chat volta a ser turno normal, sem ack mentiroso.
 */
interface LiveDebate {
  debateId: string;
  sessionId: string;
  pending: string[];
  all: string[];
  /** último frame `debate_progress` — hidrata um cliente que abriu a sessão no meio do debate. */
  lastProgress?: Record<string, unknown>;
  closed: boolean;
}
const liveDebates = new Map<string, LiveDebate>();
/** O debate vivo desta sessão (o mais recente, se por algum motivo houver mais de um). */
function liveDebateForSession(sessionId: string): LiveDebate | undefined {
  let found: LiveDebate | undefined;
  for (const d of liveDebates.values()) if (d.sessionId === sessionId) found = d;
  return found;
}
/** ...e que ainda aceita recado. Depois da síntese não há rodada para recebê-lo. */
function debateOpenForInterjection(sessionId: string): LiveDebate | undefined {
  const d = liveDebateForSession(sessionId);
  return d && !d.closed ? d : undefined;
}
/**
 * Recado do usuário para um debate em andamento: publica na conversa (o chat é o registro do debate),
 * enfileira para a próxima rodada e confirma para quem mandou. O ack NÃO promete rodada: se o juiz
 * fechar o debate antes, o recado ainda é respondido na síntese — e é isso que a frase diz.
 */
async function acceptDebateInterjection(live: LiveDebate, ws: WebSocket, text: string, speak: boolean, msgId?: string): Promise<void> {
  const recado = text.trim().slice(0, DEBATE_INTERJECTION_MAX_CHARS);
  live.pending.push(recado);
  live.all.push(recado);
  const ts = Date.now();
  const shown = `💬 Recado ao debate: ${recado}`;
  store.add(live.sessionId, { role: "user", text: shown, ts, agent: "jarvis" });
  broadcast(live.sessionId, { t: "message", message: { sessionId: live.sessionId, role: "user", text: shown, ts, agent: "jarvis" } });
  pushSessions();
  const aviso = "Recado anotado — entra na próxima etapa do debate (a rodada seguinte, ou o veredito final se o debate fechar antes).";
  // `msgId` volta para o cliente que mandou um `send` normal (não sabia do debate): é por ele que a
  // bolha otimista dele é removida, senão a mensagem apareceria duas vezes — a otimista crua e a que
  // o servidor publicou como "💬 Recado ao debate".
  send(ws, { t: "debate_said", ok: true, runnerId: LOCAL_ID, sessionId: live.sessionId, debateId: live.debateId, pending: live.pending.length, msgId, message: aviso });
  auth.audit("debate_say", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${live.debateId}: ${recado.slice(0, 80)}` });
  if (speak) {
    try { const wav = await synthesize(aviso, VOICE); send(ws, { t: "tts", sessionId: live.sessionId, audio: wav.toString("base64"), text: aviso }); }
    catch { /* o ack falado é acessório; o recado já está anotado */ }
  }
}

/** Debate iterativo local: rodadas de resposta + réplica cruzada entre 2+ IAs, com um JUIZ decidindo a
 *  convergência a cada rodada (para cedo no consenso) até o teto configurável. Read-only. Com Trabalhos
 *  habilitado, cada rodada roda os debatentes como execução gerenciada (subagentes visíveis no painel);
 *  sem Trabalhos, cai no one-shot. Cada rodada é transmitida à sessão. Cancelável como um run. */
async function startLocalDebate(ws: WebSocket, input: { sessionId: string; topic: string; agents?: string[]; effortLevel: EffortLevel; maxRounds?: number; includeContext: boolean }): Promise<void> {
  if (isNativeId(input.sessionId)) { send(ws, { t: "error", message: "Debate ainda não grava resultado em sessão nativa" }); return; }
  if (store.isHidden(input.sessionId)) { send(ws, { t: "error", message: "sessão interna não aceita Debate" }); return; }
  const s = store.get(input.sessionId);
  if (!s) { send(ws, { t: "error", message: "sessão não encontrada" }); return; }
  // Seleciona 2+ IAs distintas, disponíveis e com suporte a análise one-shot. Cada IA usa o SEU modelo
  // default e o esforço mapeado do nível escolhido para a escala dela (cada provedor nomeia diferente).
  const wanted = new Set((input.agents || []).filter(Boolean));
  const debaters: DebateDebater[] = [];
  let idx = 0;
  for (const name of agents.names()) {
    if (wanted.size && !wanted.has(name)) continue;
    const a = agents.get(name);
    if (!a.oneShot) continue;
    try { if (!(await a.available())) continue; } catch { continue; }
    let model: string | undefined, effort: string | undefined;
    try { const caps = await a.capabilities(); const m = caps.models.find((x) => x.id === (caps as any).defaultModel) || caps.models[0]; model = m?.id; effort = resolveEffortLevel(input.effortLevel, m?.efforts, (m as any)?.defaultEffort); } catch { /* agente decide */ }
    debaters.push({ id: `p${++idx}`, agent: name, model, effort, label: name });
  }
  if (debaters.length < 2) { send(ws, { t: "error", message: "Debate exige ao menos 2 IAs disponíveis (com suporte a análise one-shot)" }); return; }
  const maxRounds = clampDebateRounds(input.maxRounds);
  const recent = councilRecentLocal(input.sessionId);
  const topic = councilTopic(input.topic, recent, input.includeContext);
  const cwd = s.cwd || CWD;
  const usageKey = "__debate__:" + input.sessionId;

  const postAssistant = (text: string): void => {
    const at = Date.now();
    store.add(input.sessionId, { role: "assistant", text, ts: at, agent: "jarvis" });
    broadcast(input.sessionId, { t: "message", message: { sessionId: input.sessionId, role: "assistant", text, ts: at, agent: "jarvis" } });
    pushSessions();
  };
  const effortPt = input.effortLevel === "max" ? "máximo" : input.effortLevel === "high" ? "alto" : "médio";
  const reqText = `🗣️ Debate (${debaters.length} IAs, até ${maxRounds} rodadas, esforço ${effortPt}): ${input.topic.split(/\r?\n/)[0].slice(0, 200)}`;
  const ts = Date.now();
  store.add(input.sessionId, { role: "user", text: reqText, ts, agent: "jarvis" });
  broadcast(input.sessionId, { t: "message", message: { sessionId: input.sessionId, role: "user", text: reqText, ts, agent: "jarvis" } });
  pushSessions();
  auth.audit("debate_start", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${debaters.length} IAs · teto ${maxRounds}` });

  const debateId = "debate:" + randomUUID();
  const ctrl = new AbortController();
  localManagedRuns.add(debateId); localExecutionAborts.set(debateId, ctrl); broadcastRuns();
  // A partir daqui a sessão tem um debate vivo: o chat dela vira a porta de entrada de recados
  // (interjeição), até a síntese fechar a janela. Removido no `finally`, inclusive em erro/cancelamento.
  const live: LiveDebate = { debateId, sessionId: input.sessionId, pending: [], all: [], closed: false };
  liveDebates.set(debateId, live);
  send(ws, { t: "debate_started", runnerId: LOCAL_ID, sessionId: input.sessionId, debateId, debaters: debaters.map((d) => d.label), maxRounds });

  const oneShotBy = async (agentName: string, prompt: string, model?: string, effort?: string): Promise<{ text: string; usage?: any }> => {
    const a = agents.get(agentName);
    const opts = await compatibleAgentOpts(a, model, effort);
    return (a.oneShot ? await a.oneShot(prompt, opts) : await a.send("__debate__", prompt, cwd, opts)) as any;
  };
  const oneShotAdapter = async (a: AgentAdapter, prompt: string): Promise<{ text: string; usage?: any }> => {
    const opts = await compatibleAgentOpts(a, summaryCfg.model, summaryCfg.effort);
    return (a.oneShot ? await a.oneShot(prompt, opts) : await a.send("__debatejudge__", prompt, cwd, opts)) as any;
  };

  let responses: DebaterResponse[] = [];
  let converged = false, failed = false, roundsDone = 0;
  // Progresso ao vivo. Com Trabalhos habilitado, o DEBATE INTEIRO é um único trabalho principal (raiz
  // aberta antes da 1ª rodada) e cada rodada entra nele como uma FASE, com os debatentes pendurados
  // nela: quem gerencia é o trabalho, as rodadas e suas sessões são o subnível. Antes cada rodada
  // abria uma raiz própria e o painel mostrava N "trabalhos principais" soltos para um debate só —
  // e nenhum deles era cancelável, porque o abort estava registrado no id do debate, que não existia
  // como raiz. As ferramentas/subagentes seguem streamando e o texto integral volta em
  // report.tasks[].summary (= reply.text). Sem Trabalhos (ou se a raiz não abrir), cai no one-shot
  // anterior (progresso por IA no card). O juiz e a síntese seguem one-shot (são meta-chamadas de
  // resumo, não produzem subagentes) — o veredito de cada rodada é publicado no nó da fase.
  // `phase:'done'` no finally remove o card; `rootExecutionId` liga o botão "ver em Trabalhos".
  let useManaged = false;
  if (executionCfg.enabled) {
    try {
      executionOwnership.claim(LOCAL_ID, debateId, socketPrincipalId(ws));
      await localManagedExecution.openRoot({ rootExecutionId: debateId, runnerId: LOCAL_ID, cwd, title: `🗣️ Debate · ${input.topic.split(/\r?\n/)[0].slice(0, 120)}` });
      useManaged = true;
    } catch (error) {
      // Sem painel o debate ainda roda (todo debatente tem one-shot); perder o agrupamento não vale
      // matar a corrida — mas o motivo precisa ficar no log, não sumir.
      console.error(`[hub] debate ${debateId} sem trabalho gerenciado: ${String((error as Error)?.message || error)}`);
      try { executionOwnership.remove(LOCAL_ID, debateId); } catch { /* nada reivindicado */ }
    }
  }
  // `interjected` viaja no frame de progresso para o card do chat dizer "2 recados nesta rodada" —
  // confirmação de que o recado virou prompt, sem poluir a conversa com mais uma mensagem.
  let interjected = 0;
  const emitDebateProgress = (round: number, phase: string, states: Array<{ label: string; state: string }>, rootExecutionId?: string): void => {
    const frame = { t: "debate_progress", runnerId: LOCAL_ID, sessionId: input.sessionId, debateId, round, maxRounds, phase, rootExecutionId, debaters: states, interjected, canSay: !live.closed };
    live.lastProgress = frame;
    broadcast(input.sessionId, frame);
  };
  try {
    for (let round = 1; round <= maxRounds; round++) {
      if (ctrl.signal.aborted) { failed = true; break; }
      const prev = new Map(responses.map((r) => [r.id, r.text]));
      const prevResponses = responses;
      const roundState = debaters.map((d) => ({ label: d.label, state: "running" as string }));
      // Interjeição: o que o usuário mandou desde a rodada anterior entra AGORA, no prompt de todos os
      // participantes. Drenar aqui (e não durante a rodada) é o que garante que todo mundo debata o
      // MESMO material — injetar no meio deixaria uma IA com o recado e as outras sem.
      const recados = live.pending.splice(0);
      interjected = recados.length;
      const promptFor = (d: DebateDebater): string => round === 1
        ? buildDebateOpeningPrompt(topic, recados)
        : buildDebateRebuttalPrompt(topic, round, prev.get(d.id) || "", prevResponses.filter((r) => r.id !== d.id), recados);
      if (useManaged) {
        emitDebateProgress(round, "debating", roundState.map((p) => ({ ...p })), debateId);
        // Ids de tarefa carregam a rodada: a raiz é a mesma o debate inteiro, e ids repetidos seriam
        // recusados no preflight (mesmo executionId derivado).
        const plan: ManagedExecutionPlan = { rootExecutionId: debateId, runnerId: LOCAL_ID, tasks: debaters.map((d) => ({ id: `r${round}-${d.id}`, title: `${d.label} · rodada ${round}`, prompt: promptFor(d), agent: d.agent, cwd, depth: 1, write: false, model: d.model, effort: d.effort })) };
        const report = await localManagedExecution.run(plan, {
          continueRoot: true,
          phase: { id: `r${round}`, title: `Rodada ${round}/${maxRounds}` },
          policy: boundedManagedPolicy(mergeAdaptiveManagedPolicy({ maxConcurrency: debaters.length, maxDepth: 2, maxTasks: debaters.length }, resolveAdaptivePolicy(adaptivePolicyDoc, { cwd }).policy)),
          signal: ctrl.signal,
        });
        const byId = new Map(report.tasks.map((rec) => [rec.task.id, rec]));
        report.tasks.forEach((rec) => addUsage(usageKey, rec.task.agent, rec.usage));
        responses = debaters.map((d, i) => { const rec = byId.get(`r${round}-${d.id}`); const ok = rec?.state === "succeeded"; const text = (rec?.summary || "").trim(); if (!ok) failed = true; roundState[i].state = ok ? "done" : "failed"; return { id: d.id, label: d.label, text: ok && text ? text : `(falha: ${rec?.error || rec?.state || "sem resposta"})` }; });
        emitDebateProgress(round, "judging", roundState.map((p) => ({ ...p })), debateId);
      } else {
        emitDebateProgress(round, "debating", roundState.map((p) => ({ ...p })));
        responses = await Promise.all(debaters.map(async (d, i) => {
          const prompt = promptFor(d);
          try { const reply = await oneShotBy(d.agent, prompt, d.model, d.effort); addUsage(usageKey, d.agent, reply.usage); roundState[i].state = "done"; emitDebateProgress(round, "debating", roundState.map((p) => ({ ...p }))); return { id: d.id, label: d.label, text: (reply.text || "").trim() || "(sem resposta)" }; }
          catch (e: any) { failed = true; roundState[i].state = "failed"; emitDebateProgress(round, "debating", roundState.map((p) => ({ ...p }))); return { id: d.id, label: d.label, text: "(falha: " + String(e?.message ?? e) + ")" }; }
        }));
        emitDebateProgress(round, "judging", roundState.map((p) => ({ ...p })));
      }
      roundsDone = round;
      // Cancelou no meio da rodada: chamar o juiz aqui é uma chamada paga para avaliar respostas que
      // são "(falha: cancelado)" — e o parecer ainda acabaria publicado numa etapa já cancelada. O
      // laço só reavaliava o abort no topo, então isso acontecia toda vez. Registra o que a rodada
      // produziu (sem veredito, que `formatDebateRoundMessage` trata como opcional) e encerra.
      if (ctrl.signal.aborted) { failed = true; postAssistant(formatDebateRoundMessage(round, responses)); break; }
      let verdict: DebateVerdict = { converged: false, confidence: 0, reason: "" };
      try { const judge = summaryAgent(); const jr = await oneShotAdapter(judge, buildDebateJudgePrompt(topic, round, responses)); addUsage(usageKey, judge.name, jr.usage); verdict = parseDebateVerdict(jr.text); }
      catch { verdict = { converged: false, confidence: 0, reason: "juiz indisponível" }; }
      // O juiz é one-shot (não vira execução), então o parecer dele só existiria no chat. Publicado na
      // fase, cada rodada do painel diz por que o debate parou ali — ou por que continuou.
      if (useManaged) localManagedExecution.publishSummary(debateId, managedPhaseExecutionId(debateId, `r${round}`), `Juiz: ${verdict.converged ? "consenso" : "ainda diverge"} (confiança ${(verdict.confidence * 100).toFixed(0)}%) — ${verdict.reason}`);
      postAssistant(formatDebateRoundMessage(round, responses, verdict));
      if (verdict.converged) { converged = true; break; }
    }
    // Acabaram as rodadas: não há mais onde encaixar um recado novo, então a janela de interjeição
    // fecha AQUI e o chat volta a ser turno normal. Fechar antes de montar a síntese evita o ack
    // mentiroso ("entra na próxima etapa") para quem escrever enquanto o sintetizador já está rodando.
    live.closed = true;
    let summary: string | undefined;
    if (!ctrl.signal.aborted) {
      emitDebateProgress(roundsDone, "synthesizing", []);
      // A síntese recebe TODOS os recados (não só os da última rodada): é o único lugar onde um recado
      // que chegou tarde demais para virar rodada ainda é respondido.
      try { const synth = summaryAgent(); const sr = await oneShotAdapter(synth, buildDebateSynthesisPrompt(topic, responses, { converged, rounds: roundsDone, interjections: live.all })); addUsage(usageKey, synth.name, sr.usage); summary = sr.text; }
      catch { summary = undefined; }
    }
    const finalText = formatDebateFinalMessage({ rounds: roundsDone, maxRounds, converged, debaters: debaters.map((d) => d.label), summary, failed: failed || ctrl.signal.aborted });
    postAssistant(finalText);
    // A IA da sessão não viu NADA disto (as rodadas são one-shot fora do transcript nativo dela). Sem
    // esta linha, o debate acaba e a conversa seguinte começa do zero: "que debate?". Só quando houve
    // rodada — um debate que morreu antes de produzir posição não é contexto, é ruído.
    if (roundsDone > 0) addSessionBriefing(input.sessionId, `🗣️ Debate · tema: ${input.topic.split(/\r?\n/)[0].slice(0, 120)}`, finalText);
    // Cancelado com recado ainda na fila: ele não virou rodada e não houve síntese para respondê-lo.
    // Dizer isso é obrigação — sumir em silêncio é exatamente o bug que a interjeição veio corrigir.
    if (ctrl.signal.aborted && live.pending.length) postAssistant(`_Observação: ${live.pending.length} recado(s) enviado(s) durante o debate não foram usados — o debate foi cancelado antes da rodada seguinte._`);
  } catch (error: any) {
    failed = true;
    send(ws, { t: "error", message: "Debate: " + String(error?.message ?? error) });
  } finally {
    emitDebateProgress(roundsDone, "done", []);
    // O terminal da raiz é de quem a abriu: as ondas só encerram a própria fase.
    if (useManaged) {
      const state = ctrl.signal.aborted ? "cancelled" : failed ? "failed" : "succeeded";
      const outcome = converged ? `Consenso em ${roundsDone} rodada(s)` : `Sem consenso em ${roundsDone} rodada(s)`;
      try { localManagedExecution.closeRoot(debateId, state, `${outcome} · ${debaters.length} IAs`); }
      catch (error) { console.error(`[hub] debate ${debateId} não encerrou o trabalho: ${String((error as Error)?.message || error)}`); }
    }
    liveDebates.delete(debateId);
    localManagedRuns.delete(debateId);
    if (localExecutionAborts.get(debateId) === ctrl) localExecutionAborts.delete(debateId);
    broadcastRuns();
  }
}

async function startRemoteCouncil(ws: WebSocket, rc: RunnerConn, input: {
  sessionId: string;
  topic: string;
  mode: CouncilMode;
  includeContext: boolean;
  model?: string;
  effort?: string;
  agents?: string[];
}): Promise<void> {
  if (!executionCfg.enabled) { send(ws, { t: "error", message: "Conselho exige Trabalhos habilitado" }); return; }
  if (isNativeId(input.sessionId)) { send(ws, { t: "error", message: "Conselho ainda não grava resultado em sessão nativa" }); return; }
  if (isInternalExecutionSession(rc.id, input.sessionId)) { send(ws, { t: "error", message: "sessão interna não aceita Conselho" }); return; }
  if (!rc.ws || rc.ws.readyState !== WebSocket.OPEN) { send(ws, { t: "error", message: "máquina offline" }); return; }
  const hist = await runnerHistory(rc, input.sessionId, { ws });
  const state = runnerSessionState.get(rc.id)?.get(input.sessionId);
  const recent = Array.isArray(hist?.messages)
    ? hist.messages.filter((m: any) => m?.role === "user" || m?.role === "assistant").slice(-6).map((m: any) => ({ role: m.role as "user" | "assistant", text: String(m.text || "") }))
    : [];
  const cwd = String(hist?.cwd || state?.cwd || "");
  const preferredAgent = String(hist?.agent || state?.agent || rc.info.agents?.[0] || "");
  if (!cwd) { send(ws, { t: "error", message: "não foi possível identificar a pasta da sessão remota" }); return; }
  const route = await decideCouncilRoute({ topic: input.topic, requestedMode: input.mode, recent });
  const topic = councilTopic(input.topic, recent, input.includeContext);
  const remoteAgents = Array.isArray(rc.info.agentDescriptors) && rc.info.agentDescriptors.length
    ? rc.info.agentDescriptors
    : (rc.info.agents || []).map((name) => ({ name }));
  const built = buildCouncilPlan({
    runnerId: rc.id, sessionId: input.sessionId, topic, cwd, mode: route.mode,
    agents: filterSolutionAgents(remoteAgents as any, input.agents), preferredAgent, model: input.model, effort: input.effort,
  });
  const requestId = `council-${randomUUID()}`;
  const requestText = formatCouncilRequestMessage(input.topic, route.mode);
  const policy = boundedManagedPolicy(mergeAdaptiveManagedPolicy(built.policy, resolveAdaptivePolicy(adaptivePolicyDoc, { cwd }).policy));
  auth.audit("council_start", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: rc.id, detail: `${built.rootExecutionId}: ${route.mode}` });
  executionOwnership.claim(rc.id, built.rootExecutionId, socketPrincipalId(ws));
  if (!sendToRunner(rc, { t: "council_start", requestId, sessionId: input.sessionId, requestText, mode: route.mode, finalTaskId: built.finalTaskId, title: built.title, plan: built.plan, policy })) {
    executionOwnership.remove(rc.id, built.rootExecutionId);
    send(ws, { t: "error", message: "não foi possível iniciar Conselho na máquina" }); return;
  }
  send(ws, { t: "council_started", runnerId: rc.id, sessionId: input.sessionId, rootExecutionId: built.rootExecutionId, mode: route.mode, reason: route.reason });
}
/** Reconcile a hub session against its bound NATIVE transcript. If the hub was killed mid-turn
 *  (restart, crash), the provider CLI child can keep running as an orphan
 *  (Windows doesn't kill children when the parent is force-killed) and finish writing the reply
 *  straight into its native transcript — but the in-memory `await agent.send()` that would call store.add()
 *  never resumes (the whole Node process died), so the reply is invisible in Jarvis even though
 *  `claude --resume` has it. If the store's last message is a user turn with no reply, and the
 *  native transcript has a NEWER assistant reply, backfill it. Never touches a session that's
 *  currently running (a live turn's own store.add will land normally when it finishes). */
function reconcileFromNative(s: ReturnType<typeof store.ensure>): void {
  if (activeRuns.has(s.id)) return;
  const last = store.history(s.id).at(-1);
  if (!last || last.role !== "user") return; // already answered, or nothing sent yet — nothing to reconcile
  const nid = agents.get(s.agent).nativeSessionId?.(s.id);
  if (!nid) return;
  const nativeKey = nativeIdForAgent(s.agent, nid); if (!nativeKey) return;
  const h = nativeHistory(nativeKey);
  if (!h) return;
  const nativeReply = [...h.messages].reverse().find((m) => m.role === "assistant" && m.ts > last.ts);
  if (nativeReply?.text) store.add(s.id, { role: "assistant", text: nativeReply.text, ts: nativeReply.ts, agent: s.agent, activity: nativeReply.activity });
}

const LIVE_EXECUTION_STATES = new Set(["queued", "running", "waiting_input"]);
const NATIVE_EXECUTION_STALE_MS = 10 * 60_000;
function reconcileNativeExecutions(sid: string): number {
  if (!isNativeId(sid) || activeRuns.has(sid)) return 0;
  const h = nativeHistory(sid);
  if (!h) return 0;
  let changed = 0;
  const assistants = h.messages.filter((m) => m.role === "assistant" && m.text);
  for (const snapshot of localExecutionStore.rootsForSession(sid)) {
    const root = snapshot.nodes.find((node) => node.executionId === snapshot.rootExecutionId);
    if (!root || !LIVE_EXECUTION_STATES.has(root.state)) continue;
    const started = root.startedAt || root.queuedAt || 0;
    const reply = assistants.find((m) => m.ts >= started - 1000);
    if (reply) {
      localExecutionStore.append(root.rootExecutionId, root.executionId, { kind: "summary", text: reply.text.slice(0, 20_000) });
      localExecutionStore.append(root.rootExecutionId, root.executionId, { kind: "state_changed", from: root.state, to: "succeeded", reason: "Resposta nativa reconciliada pelo transcript." });
      changed++;
    } else if (started && Date.now() - started > NATIVE_EXECUTION_STALE_MS) {
      localExecutionStore.append(root.rootExecutionId, root.executionId, { kind: "state_changed", from: root.state, to: "orphaned", reason: "Terminal nativo não observado; nenhum processo ativo rastreável no Jarvis." });
      changed++;
    }
  }
  return changed;
}
/** Arquivos de instrução NATIVOS que a IA em questão já carrega sozinha nesta máquina. É o que
 *  permite não repetir: o Claude Code lê `~/.claude/CLAUDE.md` em todo turno por conta própria.
 *
 *  São TODOS os arquivos da máquina, não só o da IA da vez. O `instructions.md` costuma ser um
 *  snapshot desses mesmos arquivos ("importar desta máquina" o semeia assim), então aqui qualquer
 *  bloco identico a um deles ja e a linha de base local — reinjeta-lo so gasta contexto. Foi o que
 *  fazia o AGENTS.md do Codex (espelho declarado do CLAUDE.md) vazar para dentro do Claude. Em OUTRA
 *  maquina, que nao tem esses arquivos, nada casa e o conteudo vai inteiro — que e o ponto. */
function nativeInstructionContents(): string[] {
  const home = homedir();
  const out: string[] = [];
  for (const p of [join(home, ".claude", "CLAUDE.md"), join(home, ".codex", "AGENTS.md"), join(home, ".gemini", "GEMINI.md")]) {
    try { const c = readFileSync(p, "utf8").trim(); if (c) out.push(c); } catch { /* ausente */ }
  }
  return out;
}

/**
 * O trecho do `instructions.md` do framework que esta MÁQUINA ainda não declara — pronto para o turno.
 *
 * Fecha o buraco de o arquivo ser publicado para a frota e aplicado em lugar nenhum. Descontar o
 * nativo não é otimização: o arquivo nasce da concatenação dos próprios CLAUDE.md/AGENTS.md da
 * máquina, então injetá-lo inteiro mandaria o mesmo texto duas vezes no mesmo prompt.
 */
function frameworkInstructionsFor(): string {
  if (!frameworkCfg.applyInstructions) return "";
  let bruto = "";
  try { bruto = readFileSync(join(frameworkRoot(), "instructions.md"), "utf8"); } catch { return ""; }
  if (!bruto.trim()) return "";
  const pendente = pendingInstructions(bruto, nativeInstructionContents());
  return buildInstructionsSteering(pendente);
}

/** O fluxo que se declarou padrão (`autoStart` no `flows/<id>.json`). Se mais de um se declarar, vence
 *  o menor id — determinístico — e o restante é registrado: dois pacotes brigando pelo padrão é
 *  configuração a resolver, não sorteio a esconder. */
function defaultWorkflowDefinition(): ReturnType<typeof workflowFromFile> {
  const defs = readCanonicalFramework(frameworkRoot()).files
    .filter((f) => f.path.startsWith("flows/"))
    .map((f) => workflowFromFile(f.content))
    .filter((d): d is NonNullable<typeof d> => !!d && d.autoStart === true)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (defs.length > 1) log.warn("workflow_autostart_ambiguo", { escolhido: defs[0].id, outros: defs.slice(1).map((d) => d.id) });
  return defs[0] ?? null;
}

/**
 * Inicia sozinho o fluxo padrão na PRIMEIRA vez que uma sessão fala com a IA. Sem tarefa: o rastreador
 * é opcional no acompanhamento, e exigir um aqui transformaria "automático" em mais um formulário.
 *
 * Só dispara quando a sessão NUNCA teve acompanhamento — inclusive concluído ou abandonado. Sem isso,
 * abandonar um fluxo o faria renascer no turno seguinte, e não haveria como se livrar dele.
 */
function autoStartWorkflow(sid: string): WorkflowRun | undefined {
  if (!frameworkCfg.autoStartFlows) return undefined;
  if (workflowRuns.hasSession(sid)) return undefined;
  const def = defaultWorkflowDefinition();
  if (!def) return undefined;
  const run = workflowRuns.put(createRun(def, { tracker: "", key: "" }, { runId: "wfr-" + randomUUID(), now: Date.now(), sessionId: sid }));
  log.info("workflow_autostart", { sessionId: sid, workflowId: def.id, steps: def.steps.length });
  broadcastOn(LOCAL_ID, sid, { t: "notice", message: `Fluxo “${def.name}” iniciado automaticamente nesta sessão (declarado como padrão pelo pacote). Para desligar: Configurações → Framework.` });
  broadcastWorkflowRuns(sid);
  return run;
}

async function agentTurn(sid: string, agent: AgentAdapter, agentText: string, cwd: string, opts: SendOpts): Promise<AgentReply & { activity?: any[] }> {
  // F4 — a IA conduz: quando há fluxo ativo nesta sessão, o turno leva junto onde estamos e como
  // declarar avanço. Só custa tokens enquanto existe acompanhamento em andamento.
  // Multi-tarefa (F3): o steering COMPLETO é só da tarefa em FOCO. As demais entram como uma linha de
  // status — injetar N fluxos inteiros por turno poluiria a sessão principal exatamente com o que a
  // separação por tarefa existe para evitar.
  // Ponte de contexto: Debate/Conselho/Torneio rodaram FORA desta sessão e a IA nunca viu o resultado.
  // Entra primeiro no código para acabar por ÚLTIMO no prompt (colado no pedido): das três injeções,
  // é a única que responde "de que conversa estamos falando". Retirado da fila aqui e devolvido no
  // catch — um turno que nem chegou a rodar não pode consumir o briefing.
  let takenBriefings: StoredSessionBriefing[] = [];
  if (!opts.managed) {
    try {
      takenBriefings = takeSessionBriefings(sid);
      const bridge = buildSessionBriefingBlock(takenBriefings);
      if (bridge) agentText = `${bridge}\n\n---\n\n${agentText}`;
    } catch { /* contexto é acessório do turno; nunca pode derrubá-lo */ }
    try {
      const activeRun = workflowRuns.focusedFor(sid) ?? autoStartWorkflow(sid);
      if (activeRun) {
        const others = workflowRuns.activeForSession(sid).filter((r) => r.runId !== activeRun.runId);
        const parallel = formatParallelRunsLine(others);
        agentText = `${buildWorkflowSteering(activeRun)}${parallel ? `\n${parallel}` : ""}\n\n---\n\n${agentText}`;
      }
    } catch { /* nunca impedir o turno por causa do acompanhamento */ }
    // As instruções universais do framework. Vão DEPOIS do fluxo no código e ANTES dele no prompt:
    // regra geral primeiro, o passo do momento por último (mais perto do pedido, que é onde pesa).
    try {
      const universais = frameworkInstructionsFor();
      if (universais) agentText = `${universais}\n\n---\n\n${agentText}`;
    } catch { /* instrução é acessório do turno; nunca pode derrubá-lo */ }
  }
  const ctrl = new AbortController();
  localAborts.set(sid, ctrl);
  activeRuns.add(sid); broadcastRuns();
  // A new turn supersedes any pending post-turn decision without blocking this turn.
  clearPendingAsk(LOCAL_ID, sid);
  const activityKey = scopedSessionKey(LOCAL_ID, sid);
  const buf: any[] = []; activityBuf.set(activityKey, buf);
  const t0 = Date.now();
  const turnId = opts.turnId || randomUUID();
  const sequencer = createEventSequencer(turnId);
  const bridge = createAgentEventBridge(turnId, sequencer);
  const profile = (EXECUTION_ADAPTER_PROFILES as Partial<Record<string, (typeof EXECUTION_ADAPTER_PROFILES)[ExecutionAdapterId]>>)[agent.name];
  const tracker = new ExecutionTracker(localExecutionStore, { runnerId: LOCAL_ID, sessionId: sid, turnId, agent: agent.name, cwd, model: opts.model, effort: opts.effort, profile },
    executionCfg.enabled ? (event) => broadcastExecutionEvent(LOCAL_ID, event) : undefined, (usage) => addUsage(sid, agent.name, usage));
  executionOwnership.claim(LOCAL_ID, tracker.rootExecutionId, auth.identityOf(executionPrincipalContext.getStore() || captureSessionOwnerGeneration(LOCAL_ID, sid).principalId));
  localExecutionAborts.set(tracker.rootExecutionId, ctrl);
  const emit = (event: AgentEvent, project = true): void => {
    if (buf.length < 600) buf.push(event);
    if (project) tracker?.handleAgentEvent(event);
    broadcast(sid, { t: "agent_event", sessionId: sid, event, sessionCost: costOf(sid), sessionUsage: sessionUsage(sid) });
  };
  try {
    emit(bridge.accepted()); emit(bridge.started());
    const prior = store.history(sid).slice(0, -1).filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
    const reply = await agent.send(sid, agentText, cwd, { ...opts, permissionMode: opts.permissionMode ?? sessionPermissionMode(sid), turnId, history: prior, signal: ctrl.signal }, (ev) => {
      if (isProviderExecutionEvent(ev)) {
        let projected: ReturnType<ExecutionTracker["handleProviderEvent"]> | undefined;
        let projectionFailed = false;
        try { projected = tracker?.handleProviderEvent(ev); }
        catch (error) { projectionFailed = true; console.warn(`[hub] falha ao projetar subprocesso em ${tracker?.rootExecutionId || turnId}:`, String(error)); }
        if (ev.kind === "execution_activity") {
          // This is provider-published activity, not inferred progress. Feed it through the same
          // canonical chat/history lifecycle, but do not project it into the graph twice.
          const activity = projected?.activity || (!tracker || projectionFailed ? redactProviderExecutionActivity(ev.event, cwd) : undefined);
          if (activity) {
            const event = bridge.provider({ ...activity, parentId: ev.providerId });
            event.executionId = projected?.executionId;
            emit(event, false);
          }
        }
      }
      else emit(bridge.provider(ev));
    });
    if (reply.usage || opts.model || opts.effort) reply.usage = { costKind: "unavailable", source: "Jarvis turn selection", ...reply.usage, model: reply.usage?.model || opts.model, effort: reply.usage?.effort || opts.effort };
    addUsage(sid, agent.name, reply.usage);
    metrics.record({ runnerId: LOCAL_ID, agent: agent.name, model: reply.usage?.model || opts.model, ms: Date.now() - t0, ok: true, ts: Date.now() });
    // Structured observability: one line per turn — trace it by turnId, with duration/tokens/cost so a
    // slow or expensive turn is diagnosable and prompt/cost trends are analyzable. Metadata only (no text).
    log.info("turn", { traceId: turnId, sessionId: sid, agent: agent.name, model: reply.usage?.model || opts.model, effort: reply.usage?.effort || opts.effort, ms: Date.now() - t0, spawnMs: reply.usage?.spawnMs, workMs: reply.usage?.workMs, inputTokens: reply.usage?.inputTokens, outputTokens: reply.usage?.outputTokens, contextTokens: reply.usage?.contextTokens, costUsd: reply.usage?.costUsd, replyChars: (reply.text || "").length, ok: true });
    if (reply.usage) emit(bridge.usage(reply.usage));
    emit(bridge.completed(reply.text));
    // Surface the just-bound native session id (real claude/codex session) so the UI chip appears live.
    const nativeId = agent.nativeSessionId?.(sid);
    if (nativeId) {
      try { synchronizePersonalSessionAliases(LOCAL_ID, sid); }
      catch (error) { throw new Error(`native session alias ownership conflict: ${String((error as Error)?.message || error)}`); }
      broadcast(sid, { t: "session", sessionId: sid, nativeId });
    }
    {
      const askTitle = store.get(sid)?.title || (isNativeId(sid) ? "Sessão da máquina" : "Jarvis");
      const askTarget = notificationTargetForSession(LOCAL_ID, sid);
      void runAsking(LOCAL_ID, sid, reply.text, { title: askTitle, target: askTarget, done: () => notifyEvent("done", askTitle, reply.text, sid, askTarget) });
    }
    // A subagent's internal tool calls only exist while the turn is live (Claude Code writes no
    // recoverable trace of them to disk once done — verified: Task's toolUseResult.outputFile is
    // never populated). The buffered stream events ARE that trace; hand them back so the caller can
    // persist them onto the assistant message — otherwise they'd vanish the moment the turn ends.
    // In-band background jobs: the agent requests a durable long task via a ```jarvis-run fenced block.
    // The Hub owns this session/cwd, so it launches the job here; pollBackgroundJobs + reconcile then
    // auto-continue THIS session when it finishes. Skipped for managed/subagent turns (isolated). Best-
    // effort — a bad directive must never fail an otherwise-completed turn.
    if (!opts.managed) {
      try {
        const directives = parseBackgroundRunDirectives(reply.text || "");
        // Sem esta linha não havia como saber se um bloco ```jarvis-run foi visto e virou job: quando a
        // continuação nao chegava, o log nao dizia NADA sobre jobs. Registra tambem o caso "a resposta
        // tinha uma cerca jarvis-run mas o parser nao extraiu comando" — antes, indistinguivel.
        const looksLikeDirective = /```[ \t]*jarvis-run\b/i.test(reply.text || "");
        if (directives.length || looksLikeDirective) log.info("job_directives", { sessionId: sid, parsed: directives.length, fenced: looksLikeDirective });
        for (const command of directives) startLocalBackgroundJob(sid, command, cwd);
      } catch (e) { log.warn("job_directive_failed", { sessionId: sid, error: String((e as any)?.message ?? e) }); }
    }
    if (!opts.managed) applyWorkflowFromReply(sid, reply.text || "");   // F4: registra o que a IA declarou
    return { ...reply, activity: buf.slice() };
  } catch (e) {
    // O turno não entregou: o resultado que a IA precisava conhecer volta para a fila, senão um erro
    // de provedor apagaria o debate da memória da conversa para sempre.
    restoreSessionBriefings(sid, takenBriefings);
    // A user-initiated cancel is not a failure: tell the UI it stopped, and don't notify an error.
    if (ctrl.signal.aborted || String((e as any)?.message) === ABORTED) {
      const requestedAt = cancelRequestedAt.get(sid);
      if (requestedAt) cancelRequestedAt.delete(sid);
      log.info("turn_cancel", { traceId: turnId, sessionId: sid, agent: agent.name, teardownMs: requestedAt ? Date.now() - requestedAt : undefined, totalMs: Date.now() - t0 });
      if (!sequencer.terminal) emit(bridge.cancelled("Cancelada por solicitação do usuário."));
      throw e;
    }
    metrics.record({ runnerId: LOCAL_ID, agent: agent.name, model: opts.model, ms: Date.now() - t0, ok: false, ts: Date.now() });
    log.warn("turn", { traceId: turnId, sessionId: sid, agent: agent.name, model: opts.model, effort: opts.effort, ms: Date.now() - t0, ok: false, error: String((e as any)?.message ?? e).slice(0, 300) });
    if (!sequencer.terminal) emit(bridge.failed(String((e as any)?.message ?? e), "PROVIDER_ERROR"));
    notifyEvent("error", store.get(sid)?.title || "Sessão", String((e as any)?.message ?? e), sid, notificationTargetForSession(LOCAL_ID, sid));
    throw e;
  } finally {
    if (localExecutionAborts.get(tracker.rootExecutionId) === ctrl) localExecutionAborts.delete(tracker.rootExecutionId);
    if (localAborts.get(sid) === ctrl) localAborts.delete(sid);
    activeRuns.delete(sid); broadcastRuns();
    void maybeFlushQueue(LOCAL_ID, sid, false); // fim de turno → envia a fila DESTA sessão (se houver), no servidor
  }
}
async function maybeFlushQueue(runnerId: string, sid: string, autoplay: boolean): Promise<void> {
  if (hubUpdateInProgress) { noteQueueBlock(runnerId, sid, "hub_update", "atualização do Hub em andamento"); return; }
  if (dispatchReservations.isHeld(runnerId, sid)) { pendingDispatchFlush.add(scopedSessionKey(runnerId, sid)); noteQueueBlock(runnerId, sid, "dispatch_held", "outro despacho desta sessão está em voo"); return; }
  if (autoplay) {
    const resolved = effectivePolicyFor(sid);
    const decision = decideAdaptiveRun(resolved.policy, { queueAutoplay: true });
    recordAdaptiveDecision({ kind: "queue_autoplay", action: decision.action, reason: decision.reason, sessionId: sid, policyId: resolved.policy.id });
    if (decision.action !== "allow") { noteQueueBlock(runnerId, sid, "policy", `a política automática recusou: ${decision.reason || decision.action}`); return; }
  }
  await flushQueue(runnerId, sid);
}
/** Envia a fila acumulada de `sid` como UM novo turno, no servidor — assim ela dispara mesmo se o
 *  dispositivo que enfileirou já saiu, e nunca duplica (o guard activeRuns cobre corridas). Combina
 *  os itens (texto juntado, anexos concatenados) e roteia pelo mesmo caminho de um envio normal. */
async function flushQueue(runnerId: string, sid: string): Promise<void> {
  const key = scopedSessionKey(runnerId, sid), queue = queueOf(runnerId, sid);
  if (!queue.length) return;
  const rid = runnerId === LOCAL_ID ? undefined : runnerId;
  let rc: RunnerConn | undefined;
  if (rid) {
    if ((runnerActive.get(rid) || new Set()).has(sid)) { noteQueueBlock(runnerId, sid, "runner_busy", "a máquina ainda está ocupada com esta sessão"); return; }
    rc = runners.get(rid);
    if (!rc?.ws) { noteQueueBlock(runnerId, sid, "runner_offline", "a máquina está offline — a fila fica guardada até ela voltar"); return; } // OFFLINE → mantém a fila (não perde)
  } else if (activeRuns.has(sid)) { noteQueueBlock(runnerId, sid, "turn_running", "o turno anterior desta sessão ainda está rodando"); return; }
  const initialOwner = captureSessionOwnerGeneration(runnerId, sid);
  if (initialOwner.conflicted) { noteQueueBlock(runnerId, sid, "owner_conflict", "conflito de propriedade entre aliases da sessão"); broadcastOn(runnerId, sid, { t: "error", message: "conflito de propriedade entre aliases da sessão" }); return; }
  const principalId = initialOwner.principalId || actorPrincipalId(queue[0]?.actor);
  const lease = reserveSessionDispatch(runnerId, sid, principalId, "flush");
  if (!lease) { pendingDispatchFlush.add(key); noteQueueBlock(runnerId, sid, "no_lease", "não foi possível reservar o despacho desta sessão"); return; }

  let items: QueueItem[] = [];
  if (initialOwner.principalId) {
    items = queue.filter((item) => auth.sameIdentity(item.actor?.userId, principalId));
    queues.set(key, []); // entries from a different principal can never enter an owned transcript
  } else {
    let count = 0;
    while (count < queue.length && auth.sameIdentity(queue[count].actor?.userId, principalId)) count++;
    items = queue.splice(0, count);
  }
  broadcastQueue(runnerId, sid); saveQueues();
  // Idempotência do despacho LOCAL/remoto: um item já entregue ao agente não pode ser entregue de novo
  // (era isso que transformava um re-flush em turno duplicado, com custo real).
  {
    const filtered = filterForDispatch(items, (id) => dispatchedTurns.has(id));
    if (filtered.duplicates.length) log.info("queue_dispatch_dup", { runnerId, sid, dropped: filtered.duplicates.length, msgIds: filtered.duplicates.map((d) => d.msgId) });
    items = filtered.keep;
  }
  // Fila esvaziada aqui = itens de outro usuário, ou já entregues (idempotência). Não é "parada":
  // não sobrou nada para despachar, então nada a explicar.
  if (!items.length) { releaseSessionDispatch(lease); clearQueueBlock(runnerId, sid); return; }
  // How long the OLDEST item in this batch sat queued before this flush attempt — the number that
  // answers "did my message wait, or did the agent just take a while once it started?".
  const _oldestQueuedAt = items.reduce((min, it) => (it.queuedAt != null && it.queuedAt < min ? it.queuedAt : min), Infinity);
  const waitMs = Number.isFinite(_oldestQueuedAt) ? Date.now() - _oldestQueuedAt : undefined;

  const personalSeed = effectivePolicyFor(sid).policy.memory.allowPersonalContext === true
    ? items.find((item) => routePersonalIntent(item.text))
    : undefined;
  const restoreItems = (): void => { queues.set(key, [...items, ...queueOf(runnerId, sid)]); broadcastQueue(runnerId, sid); saveQueues(); };
  if (personalSeed) {
    try { bindPersonalSession(runnerId, sid, personalSeed.actor || { source: "queue" }); }
    catch (error) { restoreItems(); releaseSessionDispatch(lease); noteQueueBlock(runnerId, sid, "personal_context", `falha ao montar o contexto pessoal: ${String((error as Error)?.message || error)}`); broadcastOn(runnerId, sid, { t: "error", message: String((error as Error)?.message || error) }); return; }
    if (!refreshSessionDispatchAuthorization(lease)) { restoreItems(); releaseSessionDispatch(lease); noteQueueBlock(runnerId, sid, "unauthorized", "a autorização desta sessão mudou durante o preparo"); return; }
  }
  if (!sessionDispatchAuthorized(lease, undefined, rc)) { restoreItems(); releaseSessionDispatch(lease); noteQueueBlock(runnerId, sid, "unauthorized", "a autorização desta sessão mudou durante o preparo"); return; }
  const text = items.map((q) => q.text).join("\n\n");
  const atts = items.flatMap((q) => q.atts || []);
  // Queued messages are deliberately combined into one turn; the newest queued preference wins,
  // matching what the user last selected before that combined turn is dispatched.
  const policy = items.at(-1);
  const model = policy?.model;
  const effort = policy?.effort;
  const automatic = policy?.auto || { agent: false, model: false, effort: false };
  const actor = policy?.actor ? { ...policy.actor, source: "queue" as const } : { source: "queue" as const };
  clearPendingAsk(rid || LOCAL_ID, sid);
  let dispatched = false;
  // If a dequeue cancelled captured item(s) DURING the async preflight below (routing/personal context
  // take seconds), we must NOT send what the user removed: abort this dispatch and re-queue only the
  // survivors so they flush fresh (re-routed on the correct set). Cancelled items are simply dropped.
  const abortIfCancelled = (): boolean => {
    if (!items.some((it) => it.msgId && cancelledFlushMsgIds.has(it.msgId))) return false;
    const survivors = items.filter((it) => !it.msgId || !cancelledFlushMsgIds.has(it.msgId));
    if (survivors.length) { queues.set(key, [...survivors, ...queueOf(runnerId, sid)]); broadcastQueue(runnerId, sid); saveQueues(); pendingDispatchFlush.add(key); }
    return true;
  };
  try {
    if (rid) {
      if (rc?.ws) {
        const state = runnerSessionState.get(rid)?.get(sid), hist = needsAuto(automatic) ? await runnerHistory(rc, sid, { principalId: actorPrincipalId(actor) }) : null, su = sessionUsage(sid, rid);
        if (!sessionDispatchAuthorized(lease, undefined, rc)) throw new Error("a autorização da sessão mudou durante o envio");
        const currentAgent = hist?.agent || state?.agent || rc.info.agents[0];
        if (!currentAgent) throw new Error("nenhuma IA disponível nesta máquina");
        const decision = await decideAutomaticRoute({ runnerId, sid, text, started: /^(claude:|codex:)/.test(sid) || Number(hist?.total) > 0 || state?.started === true, currentAgent, currentModel: model || (automatic.model ? su.model : undefined), currentEffort: effort, flags: automatic, descriptors: rc.info.agentDescriptors || [], available: rc.info.agents || [], recent: (hist?.messages || []).filter((m: any) => m?.role === "user" || m?.role === "assistant").slice(-6), contextTokens: hist?.inputTokens || su.contextTokens, contextWindowTokens: hist?.contextWindowTokens || su.contextWindowTokens, notify: (frame) => { for (const c of clientsOn(rid)) if (subs.get(c) === sid && canAccessSession(c, rid, sid)) send(c, frame); } });
        if (!sessionDispatchAuthorized(lease, undefined, rc)) throw new Error("a autorização da sessão mudou durante o roteamento");
        const personal = await personalContextForChat(rid, sid, text, actor, () => refreshSessionDispatchAuthorization(lease));
        if (!sessionDispatchAuthorized(lease, undefined, rc)) throw new Error("a autorização da sessão mudou durante o contexto pessoal");
        if (abortIfCancelled()) return; // usuário removeu o item durante o preflight — não despacha
        const turnId = (items.find((q) => q.msgId)?.msgId) || randomUUID();
        const ok = sendOwnedRunnerTurn(rc, sid, turnId, actorPrincipalId(actor), { t: "send", text, contextPrefix: personal?.contextPrefix, agent: decision.agent, attachments: atts, model: decision.model, effort: decision.effort, opts: { permissionMode: remoteSessionModes.get(rc.id + " " + sid) }, actor });
        if (!ok) throw new Error("não foi possível enviar a fila para a máquina");
        dispatched = true;
        markRunnerSessionActive(rid, sid);
      }
      return;
    } // runner: relaya como envio normal (turnId = idempotência)
    // [timing] diagnóstico de latência pré-disparo: mede cada estágio até a mensagem SAIR para o CLI.
    const _t0 = Date.now();
    const decision = await routeLocalTurn(sid, text, model, effort, automatic);
    const _tRoute = Date.now();
    if (!sessionDispatchAuthorized(lease)) throw new Error("a autorização da sessão mudou durante o roteamento");
    const personal = await personalContextForChat(LOCAL_ID, sid, text, actor, () => refreshSessionDispatchAuthorization(lease));
    const _tPersonal = Date.now();
    if (!sessionDispatchAuthorized(lease)) throw new Error("a autorização da sessão mudou durante o contexto pessoal");
    if (abortIfCancelled()) return; // usuário removeu o item durante o preflight — não despacha
    if (isNativeId(sid)) {
      let _tDispatch = 0;
      await deliverNativeTurn(null, sid, text, { model: decision.model, effort: decision.effort, attachments: atts, actor, contextPrefix: personal?.contextPrefix, authorize: () => sessionDispatchAuthorized(lease), onDispatch: () => { dispatched = true; _tDispatch = Date.now(); } });
      log.debug("flush_timing", { sessionId: sid, native: true, auto: needsAuto(automatic), routeMs: _tRoute - _t0, personalMs: _tPersonal - _tRoute, toDispatchMs: (_tDispatch || Date.now()) - _tPersonal, totalMs: Date.now() - _t0 });
      return;
    }
    const { agentText, showText, images, files } = buildAttachments(atts, text);
    dispatched = true;
    await runOwnedManagedTurn(sid, { showText, agentText: personal ? `${personal.contextPrefix}\n\n${agentText}` : agentText, manifestAgentText: agentText, model: decision.model, effort: decision.effort, images, files, turnId: items.find((q) => q.msgId)?.msgId, actor, onError: (message, limit) => broadcast(sid, { t: "error", message, limit }) });
  } catch (e: any) {
    if (!dispatched) restoreItems();
    broadcastOn(runnerId, sid, { t: "error", message: String(e?.message ?? e) });
  } finally {
    // Só o que REALMENTE chegou ao agente vira "já despachado" — se a entrega falhou, os itens voltam
    // para a fila e precisam poder rodar; marcar antes da hora perderia a mensagem.
    if (dispatched) for (const it of items) if (it.msgId) dispatchedTurns.add(it.msgId);
    for (const it of items) if (it.msgId) cancelledFlushMsgIds.delete(it.msgId); // these ids did their job — keep the set bounded
    if (queueOf(runnerId, sid).length) pendingDispatchFlush.add(key);
    // Rede final: nenhuma saída daqui para baixo pode ficar muda. Despachou → o motivo antigo morre;
    // não despachou e ainda há fila → registra um motivo genérico se nenhum específico foi anotado.
    if (dispatched) clearQueueBlock(runnerId, sid);
    else if (queueOf(runnerId, sid).length && !queueBlocks.has(key)) noteQueueBlock(runnerId, sid, "dispatch_failed", "a entrega ao agente não se completou");
    log.debug("queue_flush", { runnerId, sid, items: items.length, waitMs, dispatched, remote: !!rid });
    releaseSessionDispatch(lease);
  }
}
/** Replay the buffered live activity of an IN-PROGRESS local turn to a client that just (re)opened
 *  the session — so a page refresh mid-turn shows "processando" + the tool/subagente activity it
 *  missed, instead of a blank wait until the reply lands. No-op once the turn is done (buffer gone),
 *  so a finished turn (whose text is already in history) is never re-streamed/duplicated. */
function replayActivity(ws: WebSocket, runnerId: string, sid: string): void {
  const key = scopedSessionKey(runnerId, sid);
  let buf = activityBuf.get(key);
  if (!buf && runnerId === LOCAL_ID && !isNativeId(sid)) {
    const replay = pendingActivityReplay(localExecutionStore, sid, store.history(sid), 240);
    if (replay?.events.length) { buf = replay.events; activityBuf.set(key, buf); }
  }
  if (!buf?.length) return;
  if (buf.some((ev: any) => ev?.schemaVersion === AGENT_EVENT_SCHEMA_VERSION)) {
    for (const event of buf) send(ws, { t: "agent_event", runnerId, sessionId: sid, event });
  } else {
    send(ws, { t: "stream", runnerId, sessionId: sid, ev: { kind: "start" } });
    for (const ev of buf) send(ws, { t: "stream", runnerId, sessionId: sid, ev });
  }
}
/** Abort a live turn. Local session → kill its agent process; remote → relay to the owning runner.
 *  Returns false only if nothing was running here to cancel. */
function cancelLocalExecutionsForSession(sid: string): number {
  let n = 0;
  for (const snapshot of localExecutionStore.rootsForSession(sid)) {
    const root = snapshot.nodes.find((node) => node.executionId === snapshot.rootExecutionId);
    if (!root || !["queued", "running", "waiting_input"].includes(root.state)) continue;
    const ctrl = localExecutionAborts.get(snapshot.rootExecutionId);
    if (ctrl && !ctrl.signal.aborted) { ctrl.abort(); n++; }
  }
  return n;
}
function cancelTurn(sid: string, ws: WebSocket): boolean {
  const rid = activeRunner(ws);
  const routing = routeAborts.get(scopedSessionKey(rid, sid));
  if (routing) { routing.abort(); return true; }
  if (rid !== LOCAL_ID) { const rc = runners.get(rid); if (rc?.ws) return sendToRunner(rc, { t: "cancel", sessionId: sid }); return false; }
  const ctrl = localAborts.get(sid);
  const executionCancels = cancelLocalExecutionsForSession(sid);
  if (ctrl) { cancelRequestedAt.set(sid, Date.now()); ctrl.abort(); return true; }
  if (activeRuns.has(sid)) { activeRuns.delete(sid); broadcastRuns(); void maybeFlushQueue(LOCAL_ID, sid, false); }
  return executionCancels > 0;
}
/** Turn attachments into (a) the text the AGENT sees — text files inlined, images decoded to
 *  ~/.jarvis/pasted and referenced by path for the Read tool — and (b) the text/images SHOWN in
 *  the chat (a 📎 chip for files, a served /pasted URL preview for images). Used by every turn. */
const ATTACH_PERSIST_MAX = 128 * 1024;
const ATTACH_INLINE_MAX = 48 * 1024;
function saveAttachmentFile(name: string, bytes: Buffer): string {
  const dir = join(JARVIS_DIR, "attachments"); mkdirSync(dir, { recursive: true });
  const p = join(dir, `${Date.now()}-${String(name || "file").replace(/[^\w.-]/g, "_")}`);
  writeFileSync(p, bytes);
  return p;
}
function buildAttachments(attachments: Array<{ name: string; content: string; image?: boolean; binary?: boolean; mime?: string; size?: number }>, text: string): { agentText: string; showText: string; images?: string[]; files?: Array<{ name: string; content?: string; path?: string; size?: number; binary?: boolean; mime?: string }> } {
  return buildTurnAttachments(attachments, text, {
    persistMax: ATTACH_PERSIST_MAX,
    inlineMax: ATTACH_INLINE_MAX,
    saveImage: (name, bytes) => {
      mkdirSync(PASTED_DIR, { recursive: true });
      const p = join(PASTED_DIR, `${Date.now()}-${String(name || "img").replace(/[^\w.-]/g, "_")}`);
      writeFileSync(p, bytes);
      return p;
    },
    saveFile: saveAttachmentFile,
    previewImage: (_name, _bytes, savedPath) => "/pasted/" + basename(savedPath),
  });
}

/** Continue a NATIVE CLI session (claude:<uuid>) by resuming the real claude session.
 *  Persists in the CLI's own jsonl (same file), so re-opening shows the new turns. */
/** Post-STT correction: a cheap model fixes recognition errors (esp. English tech terms spoken in
 *  pt/es) and returns ONLY the cleaned text — never an answer. Best-effort: any failure returns the
 *  raw transcript unchanged, so it can never block a voice turn. Disable with JARVIS_STT_CORRECT=0. */
async function correctTranscript(text: string): Promise<string> {
  if (process.env.JARVIS_STT_CORRECT === "0" || !text || text.trim().length < 3) return text;
  try {
    const agent = summaryAgent();
    if (!agent?.oneShot) return text;
    const prompt =
      "Você corrige transcrições de VOZ (pt/en/es) de um assistente de desenvolvimento. Conserte SOMENTE erros de reconhecimento — em especial termos técnicos em inglês ditos dentro do português (Docker, Kubernetes, git, commit, push, deploy, runner, hub, endpoint, API, Claude, Codex, PowerShell, etc.). NÃO responda, NÃO comente, NÃO traduza, NÃO adicione nada: devolva APENAS o texto corrigido, no mesmo idioma. Se já estiver correto, devolva idêntico.\n\nTranscrição:\n" +
      text;
    const reply = await agent.oneShot(prompt, await compatibleAgentOpts(agent, summaryCfg.model, summaryCfg.effort));
    addUsage(WAKE_SESSION, agent.name, reply.usage);
    const fixed = String(reply?.text ?? "").trim();
    return fixed || text;
  } catch {
    return text;
  }
}

/** Agnostic decision cards: a cheap LLM reads the agent's reply and, if it ASKS the user to decide,
 *  extracts structured questions (single- or multi-select). Works for ANY agent because it acts on
 *  the reply text, not the agent. The UI renders a stepper; the chosen answers come back as a normal
 *  next message. Best-effort; gated on a "?" so most replies skip the call. Disable: JARVIS_ASK=0. */
async function detectDecisions(replyText: string): Promise<Array<{ header: string; question: string; multi: boolean; options: Array<{ label: string; desc: string }> }>> {
  if (process.env.JARVIS_ASK === "0") return [];
  const t = (replyText || "").trim();
  if (t.length < 12 || !t.includes("?")) return [];
  try {
    const agent = summaryAgent();
    if (!agent?.oneShot) return [];
    const prompt =
      "Você analisa a RESPOSTA de um assistente de desenvolvimento e detecta se ela PEDE decisões ao usuário (escolher alternativas, priorizar itens, confirmar rumo, preencher lacunas).\n" +
      'Se SIM, devolva JSON estrito: {"questions":[{"header":"título curto","question":"a pergunta, clara e autoexplicativa","multi":false,"options":[{"label":"opção curta, com \\"(Recomendado)\\" no fim SE a resposta recomendar essa","desc":"detalhe"}]}]}\n' +
      "Regras:\n" +
      "- Extraia TODAS as decisões que a resposta pede — se ela pede 5, gere as 5 (não corte nem junte).\n" +
      "- CADA pergunta PRECISA de opções (2 a 6). Use as que a resposta oferece; se ela não listar, GERE opções plausíveis do contexto. Nunca devolva pergunta sem opções.\n" +
      "- header ~2-5 palavras; question 1-2 linhas — sempre curtos, entendíveis sem abrir o histórico.\n" +
      "- label: curto (uma linha). desc: aqui vale ser RICO quando a resposta original já explica o porquê — o que essa opção concretamente faz, o custo/trade-off, a consequência de escolher. NÃO invente justificativa que a resposta não deu; se a resposta só listou a opção sem explicar, deixe desc curto ou vazio. Não force tamanho artificial pra cima nem pra baixo — o tamanho certo é o que a resposta já sustenta.\n" +
      "- multi=true SOMENTE quando o usuário escolhe VÁRIOS itens de uma lista (ex.: quais tarefas fazer); multi=false quando é UMA alternativa entre outras.\n" +
      "- NÃO inclua 'Outros' (a UI adiciona).\n" +
      'Se a resposta NÃO pede decisão, devolva {"questions":[]}. Responda APENAS o JSON.\n\nRESPOSTA:\n' +
      t.slice(0, 4000);
    const reply = await agent.oneShot(prompt, await compatibleAgentOpts(agent, summaryCfg.model, summaryCfg.effort));
    addUsage("__decision_detection__", agent.name, reply.usage);
    const m = String(reply?.text ?? "").match(/\{[\s\S]*\}/);
    if (!m) return [];
    const qs = JSON.parse(m[0])?.questions;
    if (!Array.isArray(qs)) return [];
    return qs
      .filter((q: any) => q && q.question && Array.isArray(q.options) && q.options.length)
      .slice(0, 6)
      .map((q: any) => ({
        header: String(q.header || "").slice(0, 40),
        question: String(q.question).slice(0, 300),
        multi: !!q.multi,
        options: q.options.slice(0, 8).map((o: any) => ({ label: String(o?.label ?? o ?? "").slice(0, 100), desc: String(o?.desc ?? "").slice(0, 500) })).filter((o: any) => o.label),
      }))
      .filter((q: any) => q.options.length);
  } catch {
    return [];
  }
}
/** Post-turn decision flow: publish non-blocking analysis state, then keep any questions available
 *  for every device that opens this exact machine/session. A newer turn invalidates the generation. */
/** Uma notificação por turno: o "concluído" espera saber se sobrou decisão pendente. `ASK_NOTIFY_CAP_MS`
 *  existe para o aviso nunca ficar refém da detecção — estourou o teto, sai "concluído", e a decisão
 *  vira um segundo aviso (o único caso de dois, documentado no spec TSK-10). */
const ASK_NOTIFY_CAP_MS = 20_000;
interface AskNotify { done: () => void; title: string; target?: PushActor }
async function runAsking(runnerId: string, sid: string, replyText: string, notify?: AskNotify): Promise<void> {
  const key = decisionKey(runnerId, sid), generation = randomUUID();
  asking.set(key, generation);
  broadcastOn(runnerId, sid, { t: "asking", runnerId, sessionId: sid, on: true });
  let notified = false;
  const notifyOnce = (fn?: () => void): void => { if (notified || !fn) return; notified = true; fn(); };
  const cap = notify ? setTimeout(() => notifyOnce(notify.done), ASK_NOTIFY_CAP_MS) : undefined;
  try {
    const questions = await detectDecisions(replyText);
    if (asking.get(key) !== generation) return;
    if (questions.length) {
      const principalId = captureSessionOwnerGeneration(runnerId, sid).principalId || auth.OWNER_IDENTITY;
      try {
        const row = pendingAsks.set({ runnerId, sessionId: sid, principalId, questions });
        broadcastOn(runnerId, sid, { t: "ask", runnerId, sessionId: sid, questions });
        broadcastAskState(runnerId, sid, questions.length, row.at);
      } catch (error) { console.warn("[ask] não foi possível guardar a decisão pendente:", String((error as Error)?.message || error)); }
      if (notify) {
        const body = questions.length === 1 ? "1 decisão esperando você" : `${questions.length} decisões esperando você`;
        const sendAsk = (): void => notifyEvent("ask", notify.title, body, sid, notify.target);
        if (notified) sendAsk(); else notifyOnce(sendAsk);
      }
    } else notifyOnce(notify?.done);
  } catch { notifyOnce(notify?.done); }
  finally {
    if (cap) clearTimeout(cap);
    if (asking.get(key) === generation) {
      asking.delete(key);
      broadcastOn(runnerId, sid, { t: "asking", runnerId, sessionId: sid, on: false });
    }
  }
}
/** Voice wizard: map a spoken answer to a step action. Fast keyword nav first (voltar/avançar/
 *  repetir), then a cheap LLM maps the utterance to option indices or free "other" text. Robust:
 *  any failure falls back to treating the words as free "other" text. */
async function interpretAskVoice(transcript: string, question: string, options: Array<{ label: string }>, multi: boolean): Promise<any> {
  const t = (transcript || "").trim();
  if (!t) return { action: "repeat" };
  const low = t.toLowerCase();
  if (/\b(voltar|volta|anterior|volte)\b/.test(low)) return { action: "back" };
  if (/\b(avan[çc]ar|pr[óo]xim\w*|continuar|seguir|pronto|enviar|finalizar|confirmar)\b/.test(low)) return { action: "next" };
  if (/\b(repetir|repete|de novo|n[ãa]o entendi|repita)\b/.test(low)) return { action: "repeat" };
  try {
    const agent = summaryAgent();
    if (!agent?.oneShot) return { action: "other", other: t };
    const list = options.map((o, i) => `${i}: ${o.label}`).join("\n");
    const prompt =
      "O usuário respondeu POR VOZ a uma pergunta com opções. Mapeie a fala para as opções.\n" +
      `Pergunta: ${question}\nOpções:\n${list}\nMulti-seleção: ${multi ? "sim" : "não"}\nFala: "${t}"\n` +
      'Responda JSON: {"action":"choose"|"other","indices":[índices],"other":"texto livre"}. Se a fala casa com opção(ões), use "choose" e os índices (um só se não for multi). Se é instrução/algo fora das opções, use "other" com o texto. Só o JSON.';
    const r = await agent.oneShot(prompt, await compatibleAgentOpts(agent, summaryCfg.model, summaryCfg.effort));
    const m = String(r?.text ?? "").match(/\{[\s\S]*\}/);
    if (!m) return { action: "other", other: t };
    const o = JSON.parse(m[0]);
    if (o.action === "choose" && Array.isArray(o.indices)) {
      const idx = o.indices.filter((i: any) => Number.isInteger(i) && i >= 0 && i < options.length);
      if (idx.length) return { action: "choose", indices: multi ? idx : [idx[0]] };
    }
    return { action: "other", other: String(o.other || t) };
  } catch {
    return { action: "other", other: t };
  }
}

async function deliverNativeTurn(ws: WebSocket | null, sid: string, text: string, opts: { model?: string; effort?: string; speak?: boolean; speaker?: string; attachments?: Array<{ name: string; content: string; image?: boolean; binary?: boolean; mime?: string; size?: number }>; actor?: ContextActor; contextPrefix?: string; authorize?: () => boolean; onDispatch?: () => void }): Promise<void> {
  const info = nativeInfo(sid);
  if (!info) { if (ws) send(ws, { t: "error", message: "sessão nativa não encontrada" }); return; }
  if (info.agent !== "claude-code" && info.agent !== "codex") { if (ws) send(ws, { t: "error", message: "este adapter não oferece retomada nativa importada" }); return; }
  const agent = agents.get(info.agent);
  const now = Date.now();
  const { agentText, showText, images, files } = buildAttachments(Array.isArray(opts.attachments) ? opts.attachments : [], text);
  // Power-triggers for the AGENT (echoed user message stays raw): "!cmd" runs + injects output;
  // otherwise "/cmd" expands to its prompt (scoped to this session's agent).
  const bang = await expandBang(text, info.cwd || CWD);
  if (opts.authorize && !opts.authorize()) throw new Error("a autorização da sessão mudou durante a expansão do comando");
  const cmdExp = bang ? null : expandCommand(text, info.cwd || CWD, cmdAgentOf(info.agent), { preference: frameworkCfg.preference });
  const manifestAgentText = bang ? bang.expanded : (cmdExp ? cmdExp.expanded : agentText);
  const agentSend = opts.contextPrefix ? `${opts.contextPrefix}\n\n${manifestAgentText}` : manifestAgentText;
  const turnId = randomUUID();
  const manifest = buildContextManifest({
    turnId, sessionId: sid, runnerId: LOCAL_ID, agent: agent.name, cwd: info.cwd || CWD, actor: opts.actor,
    continuity: agent.sessionContinuity?.() || "none", nativeSessionId: sid.includes(":") ? sid.slice(sid.indexOf(":") + 1) : undefined,
    history: (nativeHistory(sid)?.messages || []).filter((message) => message.role === "user" || message.role === "assistant"),
    showText, agentText: manifestAgentText, images, files,
  });
  try { contextManifests.append(manifest); } catch (error) { console.warn("[hub] manifesto de contexto nativo não persistido:", String(error)); }
  opts.onDispatch?.();
  broadcast(sid, { t: "context_manifest", sessionId: sid, manifest });
  // NOTE: native sessions have no Jarvis-side store — `files` rides the live broadcast (viewable
  // now) but isn't persisted; a reload rebuilds from the claude transcript, which doesn't carry it.
  broadcast(sid, { t: "message", message: { sessionId: sid, role: "user", text: showText, ts: now, agent: info.agent, speaker: opts.speaker, images, files, contextManifest: manifest } });
  // Cala o tail para ele não rebroadcastar o nosso próprio turno (o cliente já mostra streamando).
  // Por SESSÃO, não pelo objeto: o tail pode ser destruído e recriado no meio do turno. Marcado
  // colado no try/finally — uma exceção entre marcar e o finally silenciaria o tail para sempre.
  nativeTurnPaused.add(sid);
  try {
    const principalId = opts.actor?.userId || captureSessionOwnerGeneration(LOCAL_ID, sid).principalId || "local";
    const reply = await executionPrincipalContext.run(principalId, () => agentTurn(sid, agent, agentSend, info.cwd || CWD, { model: opts.model, effort: opts.effort, turnId }));
    if (opts.speak) {
      const spoken = await speechForReply(reply.text);
      if (spoken) { const wav = await synthesize(spoken, VOICE); broadcast(sid, { t: "tts", sessionId: sid, audio: wav.toString("base64"), text: spoken }); }
    }
  } catch (e: any) {
    const message = String(e?.message ?? e);
    const err = { t: "error" as const, message, limit: /limit|rate|quota|exceeded|usage/i.test(message) };
    if (ws) send(ws, err); else broadcast(sid, err);
  } finally {
    // Relê o tail AGORA: o que existe no fim do turno pode não ser o mesmo objeto do começo, e era
    // justamente isso que fazia a retomada cair num objeto descartado enquanto o novo seguia solto.
    const tail = nativeTails.get(sid);
    if (tail) { try { tail.offset = statSync(tail.path).size; tail.buf = ""; } catch { /* ignore */ } }
    nativeTurnPaused.delete(sid);
  }
}
// Gap 18: "ack → processa → entrega" — busca cross-sessão e resumo/digest são operações genuinely
// lentas (chamada de LLM sobre várias sessões) que hoje deixam o usuário em silêncio até o fim. Uma
// confirmação curta e honesta ANTES do trabalho pesado (não um "filler" genérico) evita a sensação
// de travado. Mecanismo portável em packages/core/src/progressive-reply.ts — este `ackSpeak` é só o
// "como falar" específico do Jarvis (TTS via `synthesize`); a decisão de ONDE usar (aqui, e não em
// toda resposta) é o que não generaliza — ver o doc-comment do módulo.
async function ackSpeak(ws: WebSocket, text: string): Promise<void> {
  try { const wav = await synthesize(speechify(text) || text, VOICE); send(ws, { t: "ack_speak", text, audio: wav.toString("base64") }); }
  catch { /* o ack é best-effort — nunca deve travar ou falhar o trabalho real */ }
}
/** Cross-session search: reason over recent sessions, reply only to the asker (optionally spoken). */
async function runAndSendSearch(ws: WebSocket, query: string, speak: boolean): Promise<void> {
  const extra = listNative(24).filter((n) => canAccessSession(ws, LOCAL_ID, n.id)).map((n) => ({ id: n.id, agent: n.agent, cwd: n.cwd, title: n.title, updatedAt: n.updatedAt, lastUser: "", lastAssistant: "" }));
  const r = await ackThenWork(
    (t) => (speak ? ackSpeak(ws, t) : undefined),
    "Só um instante, deixa eu ver nas suas sessões.",
    async () => runSessionSearch({ query, store, agents, extra: [...extra, ...(await runnerSessionExtras(ws, 8))], includeSession: (entry) => canAccessSession(ws, entry.runnerId || LOCAL_ID, entry.id) }),
  );
  let audio: string | undefined;
  if (speak) {
    const spoken = await speechForReply(r.answer);
    if (spoken) audio = (await synthesize(spoken, VOICE)).toString("base64");
  }
  send(ws, { t: "searchResult", query, answer: r.answer, matches: r.matches, action: r.action, audio });
}
/** LITERAL full-text filter over title + full conversation of ALL sessions (managed + native),
 *  like grepping every session file. No LLM, no audio — just the sessions that contain the terms. */
// Literal (grep-like) search, split so results can be delivered in stages: managed sessions are
// in-memory (instant), native sessions read from disk (the slow part). Title matches rank first,
// then content, each newest-first.
function sortHits(hits: SessionHit[]): SessionHit[] {
  return hits.sort((a, b) => (a.where === b.where ? b.updatedAt - a.updatedAt : a.where === "title" ? -1 : 1));
}
/** Managed (Jarvis-owned) sessions whose title/conversation contains ALL query tokens — from memory. */
function searchManaged(query: string, ws?: WebSocket): SessionHit[] {
  const tokens = query.toLowerCase().split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) return [];
  const own: SessionHit[] = [];
  for (const meta of store.list()) {
    if (ws && !canAccessSession(ws, LOCAL_ID, meta.id)) continue;
    const msgs = store.history(meta.id);
    const hay = meta.title + "\n" + msgs.map((m) => m.text || "").join("\n");
    const hl = hay.toLowerCase();
    if (!tokens.every((t) => hl.includes(t))) continue;
    const titleL = meta.title.toLowerCase();
    const primary = tokens.find((t) => !titleL.includes(t)) || tokens[0];
    const idx = hl.indexOf(primary);
    const inContent = idx >= meta.title.length + 1;
    own.push({ id: meta.id, title: meta.title, agent: meta.agent, cwd: meta.cwd, updatedAt: meta.updatedAt, where: inContent ? "content" : "title", snippet: inContent ? snippetAround(hay, idx, primary.length) : meta.title });
  }
  return own;
}
type RoutedSessionHit = SessionHit & { runnerId?: string };
function searchHitFromMessages(query: string, meta: { id: string; title: string; agent: string; cwd: string; updatedAt: number; runnerId?: string }, messages: Array<{ text?: string }>): RoutedSessionHit | null {
  const tokens = query.toLowerCase().split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) return null;
  const hay = meta.title + "\n" + messages.map((m) => m.text || "").join("\n");
  const hl = hay.toLowerCase();
  if (!tokens.every((t) => hl.includes(t))) return null;
  const titleL = meta.title.toLowerCase();
  const primary = tokens.find((t) => !titleL.includes(t)) || tokens[0];
  const idx = hl.indexOf(primary);
  const inContent = idx >= meta.title.length + 1;
  return { id: meta.id, title: meta.title, agent: meta.agent, cwd: meta.cwd, updatedAt: meta.updatedAt, runnerId: meta.runnerId, where: inContent ? "content" : "title", snippet: inContent ? snippetAround(hay, idx, primary.length) : meta.title };
}
async function searchRunnerSessions(ws: WebSocket, query: string, perRunner = 20): Promise<RoutedSessionHit[]> {
  const out: RoutedSessionHit[] = [];
  const remotes = [...runners.values()].filter((r) => !r.local && r.ws && r.ws.readyState === WebSocket.OPEN && canUseRunner(ws, r.id));
  await Promise.all(remotes.map(async (r) => {
    const sessions = (await runnerSessions(r)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, perRunner);
    for (const s of sessions) {
      if (!canAccessSession(ws, r.id, s.id)) continue;
      const h = await runnerHistory(r, s.id, { ws });
      const messages = Array.isArray(h?.messages) ? h.messages : [];
      const hit = searchHitFromMessages(query, { id: s.id, title: s.title || h?.title || s.id, agent: s.agent || h?.agent || "", cwd: s.cwd || h?.cwd || "", updatedAt: Number(s.updatedAt) || Date.now(), runnerId: r.id }, messages);
      if (hit) out.push(hit);
    }
  }));
  return out;
}
async function runnerSessionExtras(ws: WebSocket, perRunner = 8): Promise<Array<{ id: string; agent: string; cwd: string; title: string; updatedAt: number; lastUser: string; lastAssistant: string; runnerId: string }>> {
  const out: Array<{ id: string; agent: string; cwd: string; title: string; updatedAt: number; lastUser: string; lastAssistant: string; runnerId: string }> = [];
  const remotes = [...runners.values()].filter((r) => !r.local && r.ws && r.ws.readyState === WebSocket.OPEN && canUseRunner(ws, r.id));
  await Promise.all(remotes.map(async (r) => {
    const label = runnerLabels[r.id] || r.info.host || r.id;
    const sessions = (await runnerSessions(r)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, perRunner);
    for (const s of sessions) {
      if (!canAccessSession(ws, r.id, s.id)) continue;
      const h = await runnerHistory(r, s.id, { ws });
      const messages = Array.isArray(h?.messages) ? h.messages : [];
      out.push({
        id: s.id, runnerId: r.id, agent: s.agent || h?.agent || "", cwd: s.cwd || h?.cwd || "",
        title: `${label} · ${s.title || h?.title || s.id}`, updatedAt: Number(s.updatedAt) || Date.now(),
        lastUser: [...messages].reverse().find((m: any) => m?.role === "user")?.text || "",
        lastAssistant: [...messages].reverse().find((m: any) => m?.role === "assistant")?.text || "",
      });
    }
  }));
  return out;
}
/** Native session ids that are already represented by a managed session (dedup, same as allSessions). */
function nativeExcludeIds(): Set<string> {
  const ex = new Set<string>();
  for (const s of store.list()) {
    ex.add(s.id);
    try { const nid = agents.get(s.agent)?.nativeSessionId?.(s.id), key = nid ? nativeIdForAgent(s.agent, nid) : null; if (key) ex.add(key); } catch { /* ignore */ }
  }
  return ex;
}
/** Summarize ONE session with the cheapest model + lowest effort, speak it, and reply
 *  only to the asker. NOT stored in history — it's a standalone "read it to me" action. */
async function summarizeAndSpeak(ws: WebSocket, sid: string, speak: boolean): Promise<void> {
  let msgs: Array<{ role: string; text: string }> = [];
  let title = "";
  // The session may live on another machine — looking it up locally would always come back empty
  // and report a perfectly full conversation as "Conversa vazia."
  const rid = activeRunner(ws);
  const rc = rid !== LOCAL_ID ? runners.get(rid) : undefined;
  if (rc?.ws) {
    const h = await runnerHistory(rc, sid, { ws });
    if (!h) { send(ws, { t: "error", message: `resumo: a máquina "${runnerLabels[rid] || rid}" não respondeu` }); return; }
    msgs = h.messages || []; title = h.title || "";
  } else if (isNativeId(sid)) { const h = nativeHistory(sid); if (h) { msgs = h.messages; title = h.title; } }
  else { const s = store.get(sid); if (s) { msgs = store.history(sid); title = s.title; } }
  if (!msgs.length) { send(ws, { t: "summary", sessionId: sid, text: "Conversa vazia." }); return; }
  // foca na ÚLTIMA resposta (referente ao último comando) — resumo curto, não a conversa toda
  const lastA = [...msgs].reverse().find((m) => m.role === "assistant")?.text || "";
  const lastU = [...msgs].reverse().find((m) => m.role === "user")?.text || "";
  const prompt =
    `Resuma em 1 a 3 frases CURTAS e faladas (português do Brasil, sem markdown, sem listas) a ÚLTIMA resposta desta conversa — ` +
    `referente ao último comando enviado. Vá direto ao ponto; NÃO resuma a conversa inteira.\n\n` +
    `Título: ${title}\n\nÚltimo comando: ${lastU.slice(0, 800)}\n\nÚltima resposta: ${lastA.slice(0, 2500)}`;
  const agent = summaryAgent();
    const sendOpts = await compatibleAgentOpts(agent, summaryCfg.model, summaryCfg.effort);
  let text = "";
  try {
    const reply = await ackThenWork(
      (t) => (speak ? ackSpeak(ws, t) : undefined),
      "Só um instante, já trago o resumo.",
      async () => (agent.oneShot ? agent.oneShot(prompt, sendOpts) : agent.send("__summary__", prompt, process.cwd(), sendOpts)),
    );
    addUsage("__summary__", agent.name, reply.usage);
    text = (reply.text || "").trim();
  } catch (e: any) {
    send(ws, { t: "error", message: "resumo: " + String(e?.message ?? e) });
    return;
  }
  let audio: string | undefined;
  if (speak && text) { const spoken = await speechForReply(text); if (spoken) audio = (await synthesize(spoken, VOICE)).toString("base64"); }
  send(ws, { t: "summary", sessionId: sid, text, audio });
}
/** Cross-agent digest ("what's happening across your sessions") — cheap, spoken, not stored. */
async function digestAndSpeak(ws: WebSocket, speak: boolean): Promise<void> {
  // Gap 18: junta sessões locais + de cada máquina remota (uma chamada de rede por máquina) ANTES
  // do resumo em si — genuinely lento o bastante pra merecer um ack imediato.
  if (speak) void ackSpeak(ws, "Só um instante, buscando o status de tudo.");
  // A member only hears the machines they were granted: the local (Hub) sessions require local access,
  // and remote machines are filtered below — otherwise the digest leaked titles/state of every machine.
  const canLocal = canUseRunner(ws, LOCAL_ID);
  const own = canLocal ? store.digest(Math.max(10, store.list().length), 200).filter((s) => canAccessSession(ws, LOCAL_ID, s.id)).slice(0, 10) : [];
  const nat = canLocal ? listNative(8).filter((n) => canAccessSession(ws, LOCAL_ID, n.id)).map((n) => ({ id: n.id, agent: n.agent, title: n.title, updatedAt: n.updatedAt, lastAssistant: "", lastUser: "" })) : [];
  const all = [...own, ...nat].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
  // "active now" = a Jarvis-driven turn in flight OR a native session whose jsonl was
  // just written (an EXTERNAL claude/codex working in a terminal shows up here too).
  const ACTIVE_MS = 120_000;
  const isActive = (s: any) => activeRuns.has(s.id) || (isNativeId(s.id) && Date.now() - (s.updatedAt || 0) < ACTIVE_MS);
  const activeCount = all.filter(isActive).length;
  const lines = all
    .map((s) => `- ${s.title}${isActive(s) ? " [ATIVA AGORA]" : ""} (${s.agent}): ${(s.lastAssistant || s.lastUser || "").slice(0, 160)}`)
    .join("\n") || "(nenhuma sessão)";
  // Remote machines: pull their real sessions. Sending only a running count left the model
  // describing an online machine with a dozen idle sessions as "inativa" — nothing in flight is
  // not the same as offline, and the machine's own sessions were invisible here entirely.
  const remotes = [...runners.values()].filter((r) => !r.local && r.ws && r.ws.readyState === WebSocket.OPEN && canUseRunner(ws, r.id));
  const remoteLines = (await Promise.all(remotes.map(async (r) => {
    const label = runnerLabels[r.id] || r.info.host || r.id;
    const running = runnerActive.get(r.id) || new Set<string>();
    const ss = (await runnerSessions(r)).filter((s) => canAccessSession(ws, r.id, s.id)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const top = ss.slice(0, 5).map((s) => `  - ${s.title}${running.has(s.id) ? " [ATIVA AGORA]" : ""}`).join("\n");
    return `- Máquina "${label}": ONLINE e conectada, ${running.size} em execução agora, ${ss.length} sessão(ões) no total.` + (top ? `\n${top}` : "");
  }))).join("\n");
  const prompt =
    `Você é o painel de status do Jarvis. Em português do Brasil, 2 a 4 frases FALADAS (sem markdown, sem listas), ` +
    `diga rapidamente o que está acontecendo. Há ${activeCount} sessão(ões) marcada(s) [ATIVA AGORA] (em execução/atividade neste momento) — ` +
    `destaque-as primeiro se houver; depois um resumo do resto. SEMPRE produza um status com base nos dados abaixo; NUNCA diga que faltam informações. Seja direto.\n\n` +
    `SESSÕES DESTA MÁQUINA (título · agente · [ATIVA AGORA] se em execução):\n${lines}` +
    (remoteLines
      ? `\n\nOUTRAS MÁQUINAS (todas as listadas abaixo estão ONLINE e conectadas neste momento; ` +
        `"0 em execução" significa apenas que nada está rodando agora — NUNCA diga que estão inativas, offline ou desconectadas):\n${remoteLines}`
      : "");
  const agent = summaryAgent();
    const sendOpts = await compatibleAgentOpts(agent, summaryCfg.model, summaryCfg.effort);
  let text = "";
  try {
    const reply = agent.oneShot ? await agent.oneShot(prompt, sendOpts) : await agent.send("__digest__", prompt, process.cwd(), sendOpts);
    addUsage("__digest__", agent.name, reply.usage);
    text = (reply.text || "").trim();
  } catch (e: any) {
    send(ws, { t: "error", message: "digest: " + String(e?.message ?? e) });
    return;
  }
  let audio: string | undefined;
  if (speak && text) { const spoken = await speechForReply(text); if (spoken) audio = (await synthesize(spoken, VOICE)).toString("base64"); }
  send(ws, { t: "summary", sessionId: "__digest__", text, audio });
}
/** Current speaker-id config + enrolled voiceprints (listing is cheap — no torch). */
async function sendVoiceState(ws: WebSocket): Promise<void> {
  send(ws, { t: "voice_state", gate: voiceGate, threshold: voiceThreshold ?? null, speakers: await listSpeakers() });
}
async function broadcastVoiceState(): Promise<void> {
  const speakers = await listSpeakers();
  broadcastAll({ t: "voice_state", gate: voiceGate, threshold: voiceThreshold ?? null, speakers });
}

// Client build version covers EVERY executable shell asset. Watching only index.html left tabs running
// stale app.js indefinitely when a UI-only fix shipped. The maximum mtime is stable, cheap and changes
// as soon as any critical asset is edited; connected clients then reload after their active turn.
function webVersion(): string {
  let latest = 0;
  for (const name of ["index.html", "app.js", "sw.js"]) try { latest = Math.max(latest, statSync(join(WEB, name)).mtimeMs); } catch { /* missing asset contributes nothing */ }
  return String(Math.floor(latest));
}
let lastWebVersion = webVersion();
let settlingWebVersion = lastWebVersion;
// Só anuncia quando a versão ESTABILIZA por um ciclo inteiro. index.html e app.js são salvos em
// momentos diferentes durante uma edição; anunciar no meio empurra um par INCONSISTENTE (HTML novo +
// JS velho) para todo cliente aberto. Um `getElementById` que virou null aborta o app.js no topo — o
// `connect()` do fim nunca roda, e a janela fica morta (sem WebSocket, portanto sem nem receber o
// próximo "version" para se recuperar). Custa até um ciclo extra de propagação; evita a tela morta.
setInterval(() => {
  const v = webVersion();
  if (v !== settlingWebVersion) { settlingWebVersion = v; return; }   // ainda mudando: espera assentar
  if (v !== lastWebVersion) { lastWebVersion = v; broadcastAll({ t: "version", v, contractVersion: AGENT_EVENT_SCHEMA_VERSION, runnerProtocolVersion: RUNNER_PROTOCOL_VERSION }); }
}, 15_000).unref?.();

/** Push the app's initial state to a (now authenticated) client. */
async function sendInitialState(ws: WebSocket): Promise<void> {
  send(ws, { t: "version", v: webVersion(), contractVersion: AGENT_EVENT_SCHEMA_VERSION, runnerProtocolVersion: RUNNER_PROTOCOL_VERSION });
  send(ws, { t: "hello", agents: agents.describeSnapshot(), default: agents.default });
  void agents.describe().then((catalog) => {
    if (ws.readyState === WebSocket.OPEN) send(ws, { t: "agent_catalog", agents: catalog, default: agents.default });
  }).catch(() => { /* hello already carried a minimal usable catalog */ });
  send(ws, { t: "machines", machines: machineList(ws) });
  send(ws, { t: "update_status", status: updateStatus });
  // The initial view is the local machine — only push its sessions/runs to a principal allowed to use
  // it, so a member granted only remote runners doesn't get the Hub's local session list unprompted
  // (mirrors the per-runner drive gate; the client then selects a machine it may access).
  if (canUseRunner(ws, LOCAL_ID)) { sendSessions(ws); send(ws, { t: "runs", runnerId: LOCAL_ID, active: [...activeRuns].filter((sid) => canAccessSession(ws, LOCAL_ID, sid)) }); }
  else send(ws, { t: "sessions", sessions: [], recentDirs: [] });
  // Decisões que já estavam esperando ANTES deste aparelho conectar: sem isto, o celular que acorda
  // só descobriria a pendência se o turno acontecesse com ele aberto — que é justamente o caso que
  // não acontece. Vai o resumo (sessão + contagem), nunca o conteúdo.
  for (const row of pendingAsks.list()) {
    if (!canUseRunner(ws, row.runnerId) || !canAccessSession(ws, row.runnerId, row.sessionId)) continue;
    send(ws, { t: "ask_pending", runnerId: row.runnerId, sessionId: row.sessionId, count: row.questions.length, at: row.at });
  }
  // Reidrata os runs ATIVOS dos runners REMOTOS no connect (o Hub já os rastreia em runnerActive).
  // Sem isto, um reload / abrir em outro computador vendo uma sessão remota perdia o selo "em execução"
  // na sidebar e o botão de parar — o stream do chat volta via turn-resume, mas o estado "ocupado" não.
  for (const [rid, set] of runnerActive) {
    if (rid !== LOCAL_ID && set.size && canUseRunner(ws, rid)) send(ws, { t: "runs", runnerId: rid, active: [...set].filter((sid) => canAccessSession(ws, rid, sid)) });
  }
  await sendVoiceState(ws);
}

/** Auth handshake — the ONLY messages a connection may send before it is authenticated.
 *  Device pairing: authinfo (claim state) / claim (owner bootstrap) / redeem (invite) / auth (token). */
async function handleAuth(ws: WebSocket, msg: any, req: any): Promise<void> {
  const { ip, ua } = clientMeta(req);
  if (msg.t === "authinfo") { send(ws, { t: "authinfo", claimed: auth.isClaimed() }); return; }
  const isAttempt = msg.t === "claim" || msg.t === "redeem" || msg.t === "auth";
  if (!isAttempt) { send(ws, { t: "unauth", claimed: auth.isClaimed() }); return; }
  // brute-force throttle (per IP) — the auth gate is the ONLY wall on a public server.
  const blk = guard.blockedFor(ip);
  if (blk > 0) { send(ws, { t: "unauth", reason: `muitas tentativas — aguarde ${Math.ceil(blk / 1000)}s`, claimed: auth.isClaimed() }); return; }
  const fail = (why: string) => {
    const r = guard.recordFail(ip);
    auth.audit(r.blocked ? "auth_blocked" : "auth_fail", { ip, detail: `${msg.t}: ${why}${r.blocked ? ` — bloqueado (${r.fails} tentativas)` : ""}` });
    send(ws, { t: "unauth", reason: r.blocked ? "muitas tentativas — tente mais tarde" : why, claimed: auth.isClaimed() });
  };
  // After a valid token, if an owner passphrase is set the session is authed but
  // NOT verified — hold back app state until the 2nd factor is entered.
  const enterAuthed = async (payload: any, conn: Conn) => {
    guard.recordSuccess(ip); clearUnauthTimer(ws);
    principals.set(ws, conn);
    if (auth.hasPassphrase() && !conn.verified) { send(ws, { t: "need_pass" }); armVerifyTimer(ws); }
    else { send(ws, payload); await sendInitialState(ws); }
  };
  try {
    if (msg.t === "claim" || msg.t === "redeem") {
      if (typeof msg.code !== "string" || !msg.code) return fail("sem código");
      const r = msg.t === "claim"
        ? auth.claim(msg.code, msg.label || "Dispositivo", { ip, ua })
        : auth.redeem(msg.code, msg.label || "Dispositivo", { ip, ua });
      reconcilePushDevices();
      // a device that just paired via a code is inherently 2FA (had the code) -> verified
      await enterAuthed({ t: "authed", token: r.token, user: r.user }, { userId: r.user.id, role: r.user.role, name: r.user.name, deviceId: r.deviceId, verified: true });
      return;
    }
    // msg.t === "auth"
    if (typeof msg.token !== "string" || !msg.token) return fail("sem token");
    const p = auth.authenticate(msg.token, { ip, ua });
    reconcilePushDevices();
    if (!p) return fail("token inválido");
    // Successful token auth was the one lifecycle event NOT audited (only failures/claim/redeem were),
    // leaving a blind spot on who actually connected. claim/redeem log their own events, so only the
    // returning-token path needs this.
    auth.audit("auth_ok", { userId: p.user.id, deviceId: p.device.id, ip, detail: p.user.role });
    await enterAuthed({ t: "authed", user: { id: p.user.id, role: p.user.role, name: p.user.name } }, { userId: p.user.id, role: p.user.role, name: p.user.name, deviceId: p.device.id, verified: false });
  } catch (e: any) {
    fail(String(e?.message ?? e));
  }
}
function armVerifyTimer(ws: WebSocket): void {
  clearUnauthTimer(ws);
  unauthTimers.set(ws, setTimeout(() => { if (!fullyAuthed(ws)) { try { send(ws, { t: "need_pass", error: "tempo esgotado" }); ws.close(); } catch { /* ignore */ } } }, 90000));
}
/** 2nd factor: verify the owner passphrase for a token-authed-but-unverified session. */
async function handleVerify(ws: WebSocket, msg: any, req: any): Promise<void> {
  const { ip } = clientMeta(req);
  const p = principalOf(ws);
  if (!p) return;
  if (guard.blockedFor(ip) > 0) { send(ws, { t: "need_pass", error: "muitas tentativas — aguarde" }); return; }
  if (typeof msg.pass !== "string" || !auth.verifyPassphrase(msg.pass)) {
    const r = guard.recordFail(ip);
    auth.audit(r.blocked ? "auth_blocked" : "pass_fail", { ip, deviceId: p.deviceId, detail: r.blocked ? "senha — bloqueado" : "senha incorreta" });
    send(ws, { t: "need_pass", error: r.blocked ? "muitas tentativas — tente mais tarde" : "senha incorreta" });
    return;
  }
  guard.recordSuccess(ip); clearUnauthTimer(ws);
  p.verified = true;
  send(ws, { t: "authed", user: { id: p.userId, role: p.role, name: p.name }, verified: true });
  await sendInitialState(ws);
}

/** Owner-only security/admin messages (devices, invites, roles, runner tokens, passphrase). Returns
 *  true if it handled `msg`. Extracted VERBATIM from the router to shrink the god-function; these
 *  handlers are self-contained and single-registered, so lifting them out changes no control flow. */
function handleSecurityMsg(ws: WebSocket, msg: any): boolean {
  if (msg.t === "sec_state") { if (!requireOwner(ws)) return true; secState(ws); return true; }
  if (msg.t === "sec_invite") {
    const p = requireOwner(ws); if (!p) return true;
    const role = msg.role === "owner" ? "owner" : "member";
    // ttlSec 0 = sem expiração (permanente); senão entre 1min e 1 ano
    const raw = Number(msg.ttlSec);
    const ttlSec = raw === 0 ? 0 : Math.min(Math.max(raw || 86400, 60), 365 * 86400);
    const runners = Array.isArray(msg.runners) ? msg.runners.filter((x: any) => typeof x === "string") : [];
    const { code, invite } = auth.mintInvite(p.userId, { role, runners, ttlSec });
    send(ws, { t: "sec_invite_created", code, invite });
    secState(ws);
    return true;
  }
  if (msg.t === "sec_revoke_device" && typeof msg.deviceId === "string") {
    if (!requireOwner(ws)) return true;
    const revoked = auth.listDevices().find((device) => device.id === msg.deviceId);
    if (auth.revokeDevice(msg.deviceId) && revoked) push.purgeTarget({ principalId: revoked.userId, deviceId: revoked.id });
    dropRevoked();
    secState(ws);
    return true;
  }
  if (msg.t === "sec_set_role" && typeof msg.deviceId === "string" && (msg.role === "owner" || msg.role === "member")) {
    if (!requireOwner(ws)) return true;
    if (auth.setDeviceRole(msg.deviceId, msg.role)) refreshPrincipalRole(msg.deviceId, msg.role);
    else send(ws, { t: "error", message: "não é possível (precisa de ao menos 1 dono)" });
    secState(ws);
    return true;
  }
  if (msg.t === "sec_revoke_all") {
    const p = requireOwner(ws); if (!p) return true;
    const revoked = p.deviceId ? auth.listDevices().filter((device) => device.id !== p.deviceId) : [];
    if (p.deviceId) auth.revokeAllExcept(p.deviceId);
    for (const device of revoked) push.purgeTarget({ principalId: device.userId, deviceId: device.id });
    dropRevoked();
    secState(ws);
    return true;
  }
  if (msg.t === "sec_revoke_invite" && typeof msg.inviteId === "string") {
    if (!requireOwner(ws)) return true;
    auth.revokeInvite(msg.inviteId);
    secState(ws);
    return true;
  }
  // --- machines (runners): mint a per-machine token / revoke one (owner) ---
  if (msg.t === "mint_runner") {
    const p = requireOwner(ws); if (!p) return true;
    const label = (typeof msg.label === "string" && msg.label.trim()) ? msg.label.trim().slice(0, 40) : "Nova máquina";
    const rid = "m-" + randomUUID().slice(0, 8);
    const token = auth.mintRunnerToken(rid, label);
    auth.audit("mint_runner", { userId: p.userId, detail: label });
    send(ws, { t: "runner_token", runnerId: rid, label, token });
    secState(ws);
    return true;
  }
  if (msg.t === "sec_revoke_runner" && typeof msg.runnerId === "string") {
    if (!requireOwner(ws)) return true;
    auth.revokeRunnerToken(msg.runnerId);
    const rc = runners.get(msg.runnerId); if (rc && rc.ws) { try { rc.ws.close(); } catch { /* ignore */ } }
    runners.delete(msg.runnerId); if (runnerLabels[msg.runnerId]) { delete runnerLabels[msg.runnerId]; saveRunnerLabels(); }
    broadcastMachines(); secState(ws);
    return true;
  }
  // owner passphrase (2nd factor): set/change/clear
  if (msg.t === "set_pass" && typeof msg.new === "string") {
    if (!requireOwner(ws)) return true;
    try { auth.setPassphrase(msg.new); } catch (e: any) { send(ws, { t: "error", message: String(e?.message ?? e) }); return true; }
    // don't kick sessions that are already in — only future/reconnecting ones need the passphrase
    for (const c of wss.clients) { const pr = principals.get(c as WebSocket); if (pr) pr.verified = true; }
    send(ws, { t: "pass_set", enabled: true });
    secState(ws);
    return true;
  }
  if (msg.t === "clear_pass") {
    if (!requireOwner(ws)) return true;
    auth.clearPassphrase();
    send(ws, { t: "pass_set", enabled: false });
    secState(ws);
    return true;
  }
  return false;
}

/** Voice-ambient (staging) + voice-config messages, lifted out of the god-router VERBATIM: spoken
 *  refinement before committing to the real chat, the resolution-overlay choice, and voice-cfg
 *  read/write. Returns true if it handled `msg`. Behavior-preserving — same relative order at the
 *  original call site (a single `if (await handleVoiceStageMsg(...)) return;`). */
async function handleVoiceStageMsg(ws: WebSocket, msg: any): Promise<boolean> {
  const scope = (sessionId?: string): StageScope => ({ runnerId: activeRunner(ws), sessionId: sessionId || subs.get(ws) || WAKE_SESSION, actor: actorOf(ws) });
  if (msg.t === "stage_voice" && typeof msg.audio === "string") {
    const current = scope((typeof msg.sessionId === "string" && msg.sessionId) ? msg.sessionId : undefined);
    let text = "";
    try { text = await transcribe(Buffer.from(msg.audio, "base64"), msg.lang, msg.ext); text = await correctTranscript(text); }
    catch (e: any) { send(ws, { t: "error", message: "STT: " + String(e?.message ?? e) }); return true; }
    broadcastOn(current.runnerId, current.sessionId, { t: "stage_heard", runnerId: current.runnerId, sessionId: current.sessionId, text });
    await stageHandle(current, text);
    return true;
  }
  if (msg.t === "stage_text" && typeof msg.text === "string") { await stageHandle(scope(typeof msg.sessionId === "string" ? msg.sessionId : undefined), msg.text); return true; }
  if (msg.t === "stage_confirm") { await stageConfirm(scope(typeof msg.sessionId === "string" ? msg.sessionId : undefined)); return true; }
  if (msg.t === "stage_cancel") { stageCancel(scope(typeof msg.sessionId === "string" ? msg.sessionId : undefined)); return true; }
  if (msg.t === "stage_state") { const current = scope(typeof msg.sessionId === "string" ? msg.sessionId : undefined), e = staging.get(stageKey(current)); if (e?.draft) send(ws, { t: "stage", runnerId: current.runnerId, sessionId: current.sessionId, draft: e.draft }); return true; }
  if (msg.t === "stage_escalate_ok") { await stageEscalateApprove(scope(typeof msg.sessionId === "string" ? msg.sessionId : undefined), true); return true; }
  if (msg.t === "stage_escalate_no") { await stageEscalateApprove(scope(typeof msg.sessionId === "string" ? msg.sessionId : undefined), false); return true; }
  if (msg.t === "voice_suggest" && typeof msg.utterance === "string") {
    const runnerId = activeRunner(ws), sid = subs.get(ws);
    send(ws, { t: "voice_suggest", utterance: msg.utterance, suggestion: await suggestSession(msg.utterance, { runnerId, cwd: sessionCwdOn(runnerId, sid), principalId: socketPrincipalId(ws) }) });
    return true;
  }
  if (msg.t === "canvas_choice") {
    broadcast(WAKE_SESSION, { t: "canvas", op: "close" });
    const rp = voiceResolve; voiceResolve = null;
    if (msg.choice === "cancel" || !rp) return true;
    if (msg.choice === "session" && typeof msg.sessionId === "string") voiceTarget = msg.sessionId;
    else if (msg.choice === "new") { const id = randomUUID(); store.ensure(id, { agent: voiceConfig.agent, cwd: voiceConfig.cwd, title: (rp.task || "Voz").slice(0, 40) }); voiceTarget = id; }
    else return true;
    await runVoiceTask(rp.task, rp.speak, rp.speaker);
    return true;
  }
  if (msg.t === "voice_cfg") { send(ws, { t: "voice_cfg", cfg: { ...voiceCfg } }); return true; }
  if (msg.t === "set_voice_cfg") { if (!requireOwner(ws)) return true;
    const nextAgent = typeof msg.agent === "string" && agents.names().includes(msg.agent) ? msg.agent : voiceCfg.agent;
    const caps = await agents.get(nextAgent).capabilities();
    const nextModel = typeof msg.model === "string" ? (msg.model || undefined) : voiceCfg.model;
    const modelInfo = nextModel ? caps.models.find((m) => m.id === nextModel) : undefined;
    if (nextModel && !modelInfo) { send(ws, { t: "error", message: `modelo de voz inválido para ${nextAgent}: ${nextModel}` }); return true; }
    const nextEffort = typeof msg.effort === "string" ? (msg.effort || undefined) : voiceCfg.effort;
    if (nextEffort && !modelInfo?.efforts.includes(nextEffort)) { send(ws, { t: "error", message: `esforço de voz inválido para ${nextModel || nextAgent}: ${nextEffort}` }); return true; }
    voiceCfg.agent = voiceConfig.agent = nextAgent; voiceCfg.model = voiceConfig.model = nextModel; voiceCfg.effort = voiceConfig.effort = nextEffort;
    if (typeof msg.escalate === "string") voiceCfg.escalate = msg.escalate; if (typeof msg.fastModel === "string") voiceCfg.fastModel = msg.fastModel; if (typeof msg.upgradeModel === "string") voiceCfg.upgradeModel = msg.upgradeModel; if (typeof msg.relevance === "string") voiceCfg.relevance = msg.relevance;
    saveVoiceCfg(); send(ws, { t: "voice_cfg", cfg: { ...voiceCfg } }); return true; }
  // --- catálogo de vozes / timbre falado (Gap 6): listar, trocar e ouvir prévia. Trocar é do dono
  //     (é a voz GLOBAL do Hub); listar e a prévia são inofensivos e ficam liberados. ---
  if (msg.t === "list_voices") { send(ws, { t: "voices", voices: listVoiceCatalog(), current: VOICE }); return true; }
  if (msg.t === "set_voice" && typeof msg.voice === "string") {
    if (!requireOwner(ws)) return true;
    if (!hasVoice(msg.voice)) { send(ws, { t: "error", message: `voz não encontrada: ${msg.voice}` }); return true; }
    VOICE = msg.voice; voiceCfg.voice = msg.voice; saveVoiceCfg();
    send(ws, { t: "voices", voices: listVoiceCatalog(), current: VOICE }); return true;
  }
  if (msg.t === "preview_voice" && typeof msg.voice === "string") {
    if (!hasVoice(msg.voice)) { send(ws, { t: "error", message: `voz não encontrada: ${msg.voice}` }); return true; }
    const voiceInfo = listVoiceCatalog().find((v) => v.id === msg.voice);
    const sample = (typeof msg.text === "string" && msg.text.trim()) ? msg.text.trim().slice(0, 200) : (voiceInfo?.previewText || "Bom dia, senhor. Todos os sistemas estão operacionais.");
    // fallback:false → a prévia de uma voz na nuvem NÃO cai na voz local por baixo; se a OpenAI falhar,
    // o usuário vê o motivo real em vez de ouvir a faber achando que é a voz escolhida.
    try { const wav = await synthesize(sample, msg.voice, { fallback: false }); send(ws, { t: "voice_preview", voice: msg.voice, audio: wav.toString("base64") }); }
    catch (e) { const raw = (e as Error).message || ""; const quota = /quota|insufficient_quota|HTTP 429/i.test(raw);
      send(ws, { t: "error", message: quota ? "Voz na nuvem indisponível: conta OpenAI sem crédito/quota. Adicione billing em platform.openai.com ou use uma voz local." : `falha ao gerar prévia da voz: ${raw}` }); }
    return true;
  }
  return false;
}

/** Wake-word control + speaker-identification / voice-gate messages, lifted from the router VERBATIM.
 *  Returns true if it handled `msg`. Behavior-preserving (same relative order at the call site). */
async function handleVoiceDeviceMsg(ws: WebSocket, msg: any): Promise<boolean> {
  if (msg.t === "wake_hello") { wakeClients.add(ws); send(ws, { t: "wake_state", enabled: wakeEnabled }); return true; }
  if (msg.t === "wake") { if (!requireOwner(ws)) return true; wakeEnabled = !!msg.enabled; for (const c of wakeClients) send(c, { t: "wake_state", enabled: wakeEnabled }); broadcastAll({ t: "wake_state", enabled: wakeEnabled }); return true; }
  if (msg.t === "wake_event") { broadcast(WAKE_SESSION, { t: "wake_event", phase: msg.phase }); return true; }
  if (msg.t === "speakers") { await sendVoiceState(ws); return true; }
  if (msg.t === "voicecfg") {
    // Owner-only: this is the biometric voice gate (an access control) + its threshold. A member could
    // otherwise disable it or lower the bar. Persisted so it survives a restart.
    if (!requireOwner(ws)) return true;
    if (typeof msg.gate === "boolean") voiceGate = msg.gate;
    if (typeof msg.threshold === "number") voiceThreshold = msg.threshold;
    voiceCfg.gate = voiceGate; voiceCfg.threshold = voiceThreshold; saveVoiceCfg();
    await broadcastVoiceState();
    return true;
  }
  if (msg.t === "enroll" && typeof msg.name === "string" && Array.isArray(msg.samples)) {
    // Owner-only: enrolling a voice grants it spoken access; a member could enroll their own.
    if (!requireOwner(ws)) return true;
    try {
      const bufs = msg.samples.filter((s: any) => typeof s === "string").map((s: string) => Buffer.from(s, "base64"));
      if (!bufs.length) { send(ws, { t: "error", message: "enroll: nenhum áudio recebido" }); return true; }
      const r = await enrollSpeaker(msg.name, bufs, typeof msg.ext === "string" ? msg.ext : "webm");
      send(ws, { t: "enrolled", name: r.name, samples: r.samples });
      await broadcastVoiceState();
    } catch (e: any) {
      send(ws, { t: "error", message: "enroll: " + String(e?.message ?? e) });
    }
    return true;
  }
  if (msg.t === "delspk" && typeof msg.name === "string") {
    if (!requireOwner(ws)) return true; // deleting a voiceprint (biometric data) is an owner action
    await deleteSpeaker(msg.name);
    await broadcastVoiceState();
    return true;
  }
  return false;
}

/** Notifications message group, lifted from the router VERBATIM: web-push (VAPID) subscribe/prefs/
 *  unsubscribe + the native-app (FCM) token register/unregister. Returns true if it handled `msg`. */
function handlePushMsg(ws: WebSocket, msg: any): boolean {
  const principal = principalOf(ws);
  return push.handleMsg(msg, (obj) => send(ws, obj), { principalId: principal?.userId || "local", deviceId: principal?.deviceId || "local" });
}

wss.on("connection", (ws: WebSocket, req: any) => {
  const ip = guard.clientIp(req);
  // connection cap (per IP + global) — blunts connection-flood DoS.
  if (!guard.connOpen(ip)) { try { ws.close(1013, "too many connections"); } catch { /* ignore */ } return; }
  ws.once("close", () => guard.connClose(ip));
  // Remote runners dial the "/runner" path; everything else is a UI client.
  if (String(req?.url || "").startsWith("/runner")) { handleRunnerConnection(ws, ip); return; }
  // Optional Origin allowlist (public deployments); no-op unless JARVIS_ALLOWED_ORIGINS set.
  if (!guard.originAllowed(req)) { try { ws.close(1008, "origin not allowed"); } catch { /* ignore */ } return; }
  // Fail-closed on plaintext when JARVIS_REQUIRE_TLS=on (public deployments).
  if (guard.tlsRequiredButMissing(req)) { try { send(ws, { t: "unauth", reason: "conexão exige HTTPS/WSS" }); ws.close(1008, "tls required"); } catch { /* ignore */ } return; }
  maybeWarnInsecure(req);
  // Drop connections that never authenticate (idle unauth hoarding). Cleared on auth.
  if (auth.AUTH_ENABLED) {
    unauthTimers.set(ws, setTimeout(() => {
      if (!fullyAuthed(ws)) { try { send(ws, { t: "unauth", reason: "tempo de autenticação esgotado", claimed: auth.isClaimed() }); ws.close(); } catch { /* ignore */ } }
    }, 20000));
  }
  const _wsConnectedAt = Date.now();
  log.debug("ws_connect", { ip });
  // Attach listeners SYNCHRONOUSLY (before any await) so a client message sent
  // right after connect is never dropped. The initial state below is async
  // (agent caps + speaker list, which spawns Python), so pushing it before the
  // message listener was attached created a window where "open" etc. were lost.
  // A per-connection socket error (e.g. oversized frame rejected by maxPayload) must
  // NEVER crash the hub — an unhandled 'error' event would take the whole process down.
  ws.on("error", () => { try { ws.close(); } catch { /* ignore */ } });
  ws.on("close", () => {
    log.debug("ws_disconnect", { ip, ms: Date.now() - _wsConnectedAt });
    subs.delete(ws);
    wakeClients.delete(ws);
    updateWatchers.delete(ws);
    for (const [terminalId, watchers] of terminalWatchers) {
      watchers.delete(ws);
      if (!watchers.size) terminalWatchers.delete(terminalId);
    }
    clearUnauthTimer(ws);
    syncTails();
  });

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Drop non-object frames / anything without a string `t` before dispatch — a JSON scalar (literal
    // `null`, `5`, `"x"`) would make `msg.t` throw deeper in, and there was no catch, so it surfaced as
    // an unhandledRejection. The whole dispatch is wrapped below so ANY handler error returns a clean
    // {t:"error"} instead of killing the turn silently (was the god-router's biggest reliability gap).
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
    try {

    // --- auth gate: until this connection is authenticated, ONLY the auth
    //     handshake is processed; every other message is dropped. ---
    const localWakeMsg = isLocalWakeMsg(ip, msg);
    if (auth.AUTH_ENABLED && !principals.has(ws) && !localWakeMsg) {
      await handleAuth(ws, msg, req);
      return;
    }
    // --- 2nd factor gate: token accepted but owner passphrase not yet verified. ---
    if (auth.AUTH_ENABLED && !fullyAuthed(ws) && !localWakeMsg) {
      if (msg.t === "verify") await handleVerify(ws, msg, req);
      else send(ws, { t: "need_pass" });
      return;
    }

    // Personal context is bound to the authenticated principal, never to identity fields supplied
    // by the client. It is independent from the selected code runner and therefore runs before the
    // per-runner authorization gates below.
    if (msg.t.startsWith("personal_")) {
      if (!isPersonalClientMessage(msg)) { send(ws, { t: "personal_context_result", requestId: typeof msg.requestId === "string" ? msg.requestId : "invalid", ok: false, error: "mensagem de contexto pessoal inválida" }); return; }
      const principal = principalOf(ws);
      const frame = await personalAssistant.handle(msg, {
        principalId: principal?.userId || "local",
        deviceId: principal?.deviceId || "local",
        owner: !auth.AUTH_ENABLED || principal?.role === "owner",
      });
      auth.audit(msg.t, { userId: principal?.userId, deviceId: principal?.deviceId, detail: msg.requestId });
      send(ws, frame);
      return;
    }

    // --- per-runner authorization (drive gate) -------------------------------
    // A member may only act on machines granted in their invite; the owner has all. Checked BEFORE
    // routing and for both local + remote, so the default (unselected → LOCAL_ID) case is covered too.
    if (RUNNER_OPS.has(msg.t) && !localWakeMsg && !canUseRunner(ws, activeRunner(ws))) { send(ws, { t: "error", message: "sem acesso a esta máquina" }); return; }
    // Local-only ops (execute/read the Hub's OWN store) → require access to the LOCAL machine. Active-
    // machine ops (queue/cancel/summarize) → require access to the selected runner. Owner passes both.
    if (LOCAL_OPS.has(msg.t) && !canUseRunner(ws, LOCAL_ID)) { send(ws, { t: "error", message: "sem acesso a esta máquina" }); return; }
    if (ACTIVE_OPS.has(msg.t) && !canUseRunner(ws, activeRunner(ws))) { send(ws, { t: "error", message: "sem acesso a esta máquina" }); return; }
    const personalScope = messageSessionScope(ws, msg);
    if (personalScope?.sessionIds.some((sessionId) => !canAccessSession(ws, personalScope.runnerId, sessionId))) {
      send(ws, { t: "error", message: "esta sessão contém contexto pessoal de outro usuário" });
      return;
    }
    if (holdForHubUpdate(ws, msg)) return;

    // --- durable execution graph (global across sessions and authorized machines) ---
    if (msg.t === "execution_delegate" && typeof msg.requestId === "string") {
      const cached = executionUiState.commands[msg.requestId];
      if (cached) {
        const cachedRoot = typeof cached.rootExecutionId === "string" ? executionLocation(cached.rootExecutionId) : undefined;
        if (cachedRoot && canAccessExecutionRoot(ws, cachedRoot.runnerId, cachedRoot.rootExecutionId)) send(ws, cached);
        else send(ws, { t: "execution_error", code: "NOT_FOUND", message: "trabalho não encontrado" });
        return;
      }
      const requestedRunner = typeof msg.plan?.runnerId === "string" ? msg.plan.runnerId : "";
      const reject = (error: string): void => { const result = { t: "execution_delegate_result", requestId: msg.requestId, ok: false, error }; executionUiState.commands[msg.requestId] = result; saveExecutionUiState(); send(ws, result); };
      if (!executionCfg.enabled) { reject("acompanhamento de trabalhos está desabilitado"); return; }
      if (!requestedRunner || !canUseRunner(ws, requestedRunner)) { reject("máquina fixa ausente ou sem acesso"); return; }
      if (!Array.isArray(msg.plan?.tasks)) { reject("plano de delegação inválido"); return; }
      const plan: ManagedExecutionPlan = { rootExecutionId: String(msg.plan.rootExecutionId || ""), runnerId: requestedRunner,
        tasks: msg.plan.tasks.map((task: any) => ({ ...task, write: task?.write === undefined ? executionCfg.defaultWrite : task.write === true })) };
      const delegateCwd = typeof plan.tasks[0]?.cwd === "string" ? plan.tasks[0].cwd : undefined;
      const adaptive = resolveAdaptivePolicy(adaptivePolicyDoc, { cwd: delegateCwd }).policy;
      const policy = boundedManagedPolicy(mergeAdaptiveManagedPolicy(msg.policy as ManagedExecutionPolicyInput | undefined, adaptive));
      auth.audit("execution_delegate", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: requestedRunner, detail: `${plan.rootExecutionId}: ${plan.tasks.length} tarefa(s)` });
      if (requestedRunner === LOCAL_ID) { startLocalManagedExecution({ requestId: msg.requestId, title: typeof msg.title === "string" ? msg.title : undefined, plan, policy, principalId: socketPrincipalId(ws) }, (result) => send(ws, result)); return; }
      const rc = runners.get(requestedRunner);
      try { executionOwnership.claim(requestedRunner, plan.rootExecutionId, socketPrincipalId(ws)); }
      catch (error) { reject(String((error as Error)?.message || error)); return; }
      if (!rc || !sendToRunner(rc, { t: "execution_delegate", requestId: msg.requestId, title: typeof msg.title === "string" ? msg.title : undefined, plan, policy })) { executionOwnership.remove(requestedRunner, plan.rootExecutionId); reject("máquina offline"); return; }
      registerPendingRequest({ requestId: msg.requestId, ws, runnerId: requestedRunner, operation: "execution_delegate", metadata: { rootExecutionId: plan.rootExecutionId } });
      setTimeout(() => {
        if (pendingReq.get(msg.requestId)?.socket !== ws) return;
        pendingReq.delete(msg.requestId); reject("tempo esgotado aguardando aceite da máquina");
      }, 30_000).unref?.();
      return;
    }
    if (msg.t === "executions_list") {
      const sessionId = msg.scope === "session" && typeof msg.sessionId === "string" ? msg.sessionId : undefined;
      const rootExecutionId = typeof msg.rootExecutionId === "string" ? msg.rootExecutionId : undefined;
      const requestedRunnerId = typeof msg.runnerId === "string" ? msg.runnerId : undefined;
      const states = Array.isArray(msg.states) ? new Set<ExecutionState>(msg.states.filter(isExecutionState)) : undefined;
      const allowedSources = executionSources().filter((source) => canUseRunner(ws, source.runnerId) && (!requestedRunnerId || source.runnerId === requestedRunnerId));
      const all = allowedSources
        .flatMap((source) => source.store.listNodes(sessionId).filter((node) => canAccessExecutionRoot(ws, source.runnerId, node.rootExecutionId)).map(executionNodeForUi))
        .filter((node) => !rootExecutionId || node.rootExecutionId === rootExecutionId)
        .filter((node) => !states?.size || states.has(node.state))
        .sort((a, b) => (b.startedAt || b.queuedAt) - (a.startedAt || a.queuedAt));
      const offset = Math.max(0, Number.parseInt(String(msg.cursor || "0"), 10) || 0), limit = Math.max(1, Math.min(500, Number(msg.limit) || 100));
      send(ws, { t: "executions_snapshot", requestId: typeof msg.requestId === "string" ? msg.requestId : undefined,
        scope: sessionId ? "session" : "all", nodes: all.slice(offset, offset + limit), nextCursor: offset + limit < all.length ? String(offset + limit) : undefined, generatedAt: Date.now() });
      for (const source of allowedSources) {
        if (!executionOwnership.hasOnRunner(source.runnerId, socketPrincipalId(ws))) continue;
        const rc = runners.get(source.runnerId), online = source.runnerId === LOCAL_ID || !!(rc?.ws && rc.ws.readyState === WebSocket.OPEN);
        send(ws, { t: "execution_connection", runnerId: source.runnerId, state: online ? "online" : "offline", at: Date.now() });
      }
      return;
    }
    if (msg.t === "execution_open" && typeof msg.executionId === "string") {
      const found = executionLocation(msg.executionId);
      if (!found || !canAccessExecutionRoot(ws, found.runnerId, found.rootExecutionId)) { send(ws, { t: "execution_error", code: "NOT_FOUND", message: "trabalho não encontrado", executionId: msg.executionId }); return; }
      const rootEvents = executionEventsForNode(found.store, found.rootExecutionId, msg.executionId);
      const offset = Math.max(0, Number.parseInt(String(msg.cursor || "0"), 10) || 0), limit = Math.max(1, Math.min(500, Number(msg.limit) || 200));
      send(ws, { t: "execution_transcript", executionId: msg.executionId, node: executionNodeForUi(found.node), events: rootEvents.slice(offset, offset + limit), nextCursor: offset + limit < rootEvents.length ? String(offset + limit) : undefined, truncated: found.store.snapshot(found.rootExecutionId)?.truncated || false });
      return;
    }
    if (msg.t === "execution_archive" && typeof msg.requestId === "string" && typeof msg.executionId === "string") {
      const cached = executionUiState.commands[msg.requestId]; if (cached) { if (canAccessCachedExecutionResult(ws, cached)) send(ws, cached); else send(ws, { t: "execution_error", code: "NOT_FOUND", message: "trabalho não encontrado" }); return; }
      const found = executionLocation(msg.executionId);
      const result = !found || !canAccessExecutionRoot(ws, found.runnerId, found.rootExecutionId)
        ? { t: "execution_archive_result", requestId: msg.requestId, executionId: msg.executionId, ok: false, error: "trabalho não encontrado ou sem acesso" }
        : (() => { if (msg.archived) executionUiState.archives[msg.executionId] = Date.now(); else delete executionUiState.archives[msg.executionId]; return { t: "execution_archive_result", requestId: msg.requestId, executionId: msg.executionId, ok: true }; })();
      executionUiState.commands[msg.requestId] = result; saveExecutionUiState(); send(ws, result); return;
    }
    if (msg.t === "execution_input" && typeof msg.requestId === "string" && typeof msg.executionId === "string") {
      const cached = executionUiState.commands[msg.requestId]; if (cached) { if (canAccessCachedExecutionResult(ws, cached)) send(ws, cached); else send(ws, { t: "execution_error", code: "NOT_FOUND", message: "trabalho não encontrado" }); return; }
      const found = executionLocation(msg.executionId), okAccess = !!found && canAccessExecutionRoot(ws, found.runnerId, found.rootExecutionId);
      const result = { t: "execution_input_result", requestId: msg.requestId, executionId: msg.executionId, ok: false,
        error: okAccess ? "este adaptador não publicou um canal de resposta verificável" : "trabalho não encontrado ou sem acesso" };
      executionUiState.commands[msg.requestId] = result; saveExecutionUiState(); send(ws, result); return;
    }
    if (msg.t === "execution_control" && typeof msg.requestId === "string" && typeof msg.executionId === "string") {
      const cached = executionUiState.commands[msg.requestId]; if (cached) { if (canAccessCachedExecutionResult(ws, cached)) send(ws, cached); else send(ws, { t: "execution_error", code: "NOT_FOUND", message: "trabalho não encontrado" }); return; }
      const found = executionLocation(msg.executionId);
      if (!found || !canAccessExecutionRoot(ws, found.runnerId, found.rootExecutionId)) {
        const result = { t: "execution_control_result", requestId: msg.requestId, executionId: msg.executionId, ok: false, affectedIds: [], unsupportedIds: [msg.executionId], error: "trabalho não encontrado ou sem acesso" };
        executionUiState.commands[msg.requestId] = result; saveExecutionUiState(); send(ws, result); return;
      }
      if (found.runnerId !== LOCAL_ID) {
        const rc = runners.get(found.runnerId);
        if (!rc || !sendToRunner(rc, { t: "execution_control", requestId: msg.requestId, executionId: msg.executionId, action: msg.action, message: msg.message })) {
          const result = { t: "execution_control_result", requestId: msg.requestId, executionId: msg.executionId, ok: false, affectedIds: [], unsupportedIds: [msg.executionId], error: "máquina offline" };
          executionUiState.commands[msg.requestId] = result; saveExecutionUiState(); send(ws, result);
        } else registerPendingRequest({ requestId: msg.requestId, ws, runnerId: found.runnerId, operation: "execution_control", metadata: { rootExecutionId: found.rootExecutionId } });
        return;
      }
      const rootCancelable = found.node.executionId === found.rootExecutionId && (msg.action === "cancel" || msg.action === "cancel_subtree");
      const ctrl = rootCancelable ? localExecutionAborts.get(found.rootExecutionId) : undefined;
      if (ctrl) ctrl.abort();
      const result = { t: "execution_control_result", requestId: msg.requestId, executionId: msg.executionId, ok: !!ctrl,
        affectedIds: ctrl ? [found.rootExecutionId] : [], unsupportedIds: ctrl ? [] : [msg.executionId],
        error: ctrl ? undefined : (rootCancelable ? "o turno não está mais em execução" : "controle não suportado por este adaptador") };
      executionUiState.commands[msg.requestId] = result; saveExecutionUiState(); send(ws, result); return;
    }

    // --- machine selection + routing to remote runners -----------------------
    if (msg.t === "machines") { send(ws, { t: "machines", machines: machineList(ws) }); return; }
    if (msg.t === "terminal_open" || msg.t === "terminal_input" || msg.t === "terminal_resize" || msg.t === "terminal_close" || msg.t === "terminal_list") {
      if (!requireOwner(ws)) return;
      const rid = terminalRunner(msg, ws);
      if (!canUseRunner(ws, rid)) { send(ws, { t: "terminal_error", runnerId: rid, reqId: msg.reqId, terminalId: msg.terminalId, message: "sem acesso a esta máquina" }); return; }
      if (rid === LOCAL_ID) {
        if (msg.t === "terminal_open") { openLocalTerminal(ws, { ...msg, reqId: typeof msg.reqId === "string" ? msg.reqId : "term-" + randomUUID() }); return; }
        if (msg.t === "terminal_list") { send(ws, { t: "terminal_list", runnerId: LOCAL_ID, reqId: msg.reqId, terminals: localTerminals.list() }); return; }
        if (msg.t === "terminal_input" && typeof msg.terminalId === "string" && typeof msg.data === "string") {
          if (!localTerminals.input(msg.terminalId, msg.data)) send(ws, { t: "terminal_error", runnerId: LOCAL_ID, terminalId: msg.terminalId, message: "terminal não encontrado" });
          return;
        }
        if (msg.t === "terminal_resize" && typeof msg.terminalId === "string") {
          if (!localTerminals.resize(msg.terminalId, msg.cols, msg.rows)) send(ws, { t: "terminal_error", runnerId: LOCAL_ID, terminalId: msg.terminalId, message: "terminal não encontrado" });
          return;
        }
        if (msg.t === "terminal_close" && typeof msg.terminalId === "string") {
          if (localTerminals.close(msg.terminalId)) terminalOwners.delete(msg.terminalId);
          else send(ws, { t: "terminal_error", runnerId: LOCAL_ID, terminalId: msg.terminalId, message: "terminal não encontrado" });
          return;
        }
      }
      const rc = runners.get(rid);
      if (!rc?.ws) { send(ws, { t: "terminal_error", runnerId: rid, reqId: msg.reqId, terminalId: msg.terminalId, message: "máquina offline" }); return; }
      if (msg.t === "terminal_open") {
        const reqId = typeof msg.reqId === "string" ? msg.reqId : "term-" + randomUUID();
        const cwd = typeof msg.cwd === "string" && msg.cwd ? msg.cwd : sessionCwdOn(rid, subs.get(ws));
        auth.audit("terminal_open", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: rid, detail: cwd || "(cwd padrão)" });
        registerPendingRequest({ requestId: reqId, ws, runnerId: rid, operation: "terminal_open" });
        if (!sendToRunner(rc, { t: "terminal_open", reqId, cwd, shell: msg.shell, title: msg.title, cols: msg.cols, rows: msg.rows })) {
          pendingReq.delete(reqId);
          send(ws, { t: "terminal_error", runnerId: rid, reqId, message: "não foi possível abrir terminal na máquina" });
        }
        return;
      }
      if (msg.t === "terminal_list") {
        const reqId = typeof msg.reqId === "string" ? msg.reqId : "term-" + randomUUID();
        registerPendingRequest({ requestId: reqId, ws, runnerId: rid, operation: "terminal_list" });
        if (!sendToRunner(rc, { t: "terminal_list", reqId })) {
          pendingReq.delete(reqId);
          send(ws, { t: "terminal_list", runnerId: rid, reqId, terminals: [] });
        }
        return;
      }
      if (msg.t === "terminal_input" && typeof msg.terminalId === "string" && typeof msg.data === "string") { sendToRunner(rc, { t: "terminal_input", terminalId: msg.terminalId, data: msg.data }); return; }
      if (msg.t === "terminal_resize" && typeof msg.terminalId === "string") { sendToRunner(rc, { t: "terminal_resize", terminalId: msg.terminalId, cols: Number(msg.cols) || 100, rows: Number(msg.rows) || 30 }); return; }
      if (msg.t === "terminal_close" && typeof msg.terminalId === "string") { sendToRunner(rc, { t: "terminal_close", terminalId: msg.terminalId }); return; }
      send(ws, { t: "terminal_error", runnerId: rid, message: "mensagem de terminal inválida" });
      return;
    }
    // Slash-command / skill list for the composer's "/" autocomplete, for the machine in view. Local
    // is read straight off disk; a remote machine's list is fetched from its runner (it owns the files).
    if (msg.t === "commands") {
      const ar = activeRunner(ws);
      const sid = typeof msg.sessionId === "string" ? msg.sessionId : subs.get(ws);
      if (ar === LOCAL_ID) { const cwd = sessionCwd(sid); send(ws, { t: "command_list", runnerId: LOCAL_ID, cwd, commands: listCommandsPublic(cwd) }); return; }
      if (!canUseRunner(ws, ar)) { send(ws, { t: "command_list", runnerId: ar, commands: [] }); return; }
      const rc = runners.get(ar);
      if (rc?.ws) { const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "commands", sessionIds: sid ? [sid] : [] }); sendToRunner(rc, { t: "commands", reqId, sessionId: sid }); }
      else send(ws, { t: "command_list", runnerId: ar, commands: [] });
      return;
    }
    // "@" file-mention search — files under the session's cwd (local off disk, remote from its runner).
    if (msg.t === "mention") {
      const ar = activeRunner(ws);
      const q = typeof msg.q === "string" ? msg.q : "";
      const sid = subs.get(ws);
      if (isInternalExecutionSession(ar, sid)) { send(ws, { t: "error", message: "sessão interna não expõe arquivos pelo chat" }); return; }
      if (ar === LOCAL_ID) { send(ws, { t: "mention_list", files: listMentionFiles(sessionCwd(subs.get(ws)), q) }); return; }
      if (!canUseRunner(ws, ar)) { send(ws, { t: "mention_list", files: [] }); return; }
      const rc = runners.get(ar);
      if (rc?.ws) { const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "mention", sessionIds: sid ? [sid] : [] }); sendToRunner(rc, { t: "mention", reqId, q, sessionId: sid }); }
      else send(ws, { t: "mention_list", files: [] });
      return;
    }
    // "#note" is a two-step HITL write: exact preview first, one-time apply second.
    if (msg.t === "memory_preview" && typeof msg.text === "string") {
      const runnerId = activeRunner(ws), sessionId = typeof msg.sessionId === "string" ? msg.sessionId : subs.get(ws);
      if (isInternalExecutionSession(runnerId, sessionId)) { send(ws, { t: "error", message: "sessão interna não aceita memória pelo chat" }); return; }
      cleanExpiredMemoryConfirmations();
      const actor = actorOf(ws), state = runnerId === LOCAL_ID ? undefined : (sessionId ? runnerSessionState.get(runnerId)?.get(sessionId) : undefined);
      const cwd = runnerId === LOCAL_ID ? sessionCwd(sessionId) : String(state?.cwd || "");
      const agent = runnerId === LOCAL_ID ? sessionAgent(sessionId) : String(state?.agent || "remote");
      const resolved = resolveAdaptivePolicy(adaptivePolicyDoc, { cwd, sessionId });
      const rc = runnerId === LOCAL_ID ? undefined : runners.get(runnerId);
      const decision = decideMemoryWrite(resolved.policy, { repoAvailable: runnerId === LOCAL_ID || !!rc?.ws });
      recordAdaptiveDecision({ kind: "memory_write", action: decision.action, reason: decision.reason, sessionId, policyId: resolved.policy.id });
      if (decision.action === "reject") { send(ws, { t: "error", message: "memória bloqueada pela política: " + decision.reason }); return; }
      if (decision.action === "repo" && runnerId !== LOCAL_ID) {
        if (!rc?.ws) { send(ws, { t: "error", message: "máquina offline" }); return; }
        const reqId = "memory-" + randomUUID();
        registerPendingRequest({ requestId: reqId, ws, runnerId, operation: "memory_preview", sessionIds: sessionId ? [sessionId] : [] }); pendingRemoteMemoryPreview.set(reqId, { ws, runnerId, sessionId, actor });
        if (!sendToRunner(rc, { t: "memory_preview", reqId, text: msg.text, sessionId, actor })) {
          pendingReq.delete(reqId); pendingRemoteMemoryPreview.delete(reqId); send(ws, { t: "error", message: "não foi possível solicitar a prévia na máquina" });
        }
        return;
      }
      try {
        const note = msg.text.replace(/^\s*#+\s*/, "").trim();
        if (!note) throw new Error("a nota de memória está vazia");
        if (note.length > 8000) throw new Error("a nota de memória excede 8000 caracteres");
        const token = randomUUID(), expiresAt = Date.now() + MEMORY_PREVIEW_TTL_MS;
        const pending: PendingMemoryConfirmation = { runnerId, sessionId, actor, mode: decision.action === "repo" ? "repo-local" : "jarvis", expiresAt, text: note, cwd, agent, ownerGeneration: sessionId ? captureSessionOwnerGeneration(runnerId, sessionId) : undefined };
        let target = "Memória privada do Jarvis", beforeHash = createHash("sha256").update("").digest("hex"), exists = true;
        if (pending.mode === "repo-local") {
          pending.preview = previewMemoryAppend(note, cwd, cmdAgentOf(agent));
          target = pending.preview.file; beforeHash = pending.preview.beforeHash; exists = pending.preview.exists;
        }
        pendingMemoryConfirmations.set(token, pending);
        sendMemoryFrame(ws, pending, { t: "memory_preview", token, target, note, appendText: pending.preview?.appendText || note, beforeHash, exists, expiresAt, runnerId, sessionId, mode: pending.mode === "jarvis" ? "jarvis" : "repo", reason: decision.reason });
      } catch (error: any) { send(ws, { t: "error", message: "memória: " + String(error?.message ?? error) }); }
      return;
    }
    if (msg.t === "memory_apply" && typeof msg.token === "string") {
      cleanExpiredMemoryConfirmations();
      const pending = pendingMemoryConfirmations.get(msg.token);
      if (!pending) { send(ws, { t: "memory_applied", token: msg.token, ok: false, error: "prévia inexistente, expirada ou já aplicada" }); return; }
      if (pending.actor.userId && !auth.sameIdentity(pending.actor.userId, principalOf(ws)?.userId)) { send(ws, { t: "memory_applied", token: msg.token, ok: false, error: "esta prévia pertence a outro usuário" }); return; }
      if (!canUseRunner(ws, pending.runnerId)) { send(ws, { t: "memory_applied", token: msg.token, ok: false, error: "sem acesso à máquina da prévia" }); return; }
      if (pending.ownerGeneration && (!sessionOwnerGenerationCurrent(pending.ownerGeneration) || !canAccessSession(ws, pending.runnerId, pending.ownerGeneration.sessionId))) { pendingMemoryConfirmations.delete(msg.token); send(ws, { t: "memory_applied", token: msg.token, ok: false, error: "a sessão mudou ou foi excluída desde a prévia" }); return; }
      pendingMemoryConfirmations.delete(msg.token);
      if (pending.mode === "repo-remote") {
        const rc = runners.get(pending.runnerId), reqId = "memory-apply-" + randomUUID();
        if (!rc?.ws) { sendMemoryFrame(ws, pending, { t: "memory_applied", token: msg.token, ok: false, error: "máquina offline" }); return; }
        registerPendingRequest({ requestId: reqId, ws, runnerId: pending.runnerId, operation: "memory_apply", sessionIds: pending.sessionId ? [pending.sessionId] : [] }); pendingRemoteMemoryApply.set(reqId, { ws, pending, token: msg.token });
        if (!sendToRunner(rc, { t: "memory_apply", reqId, token: msg.token })) {
          pendingReq.delete(reqId); pendingRemoteMemoryApply.delete(reqId); sendMemoryFrame(ws, pending, { t: "memory_applied", token: msg.token, ok: false, error: "não foi possível aplicar a memória na máquina" });
        }
        return;
      }
      try {
        const note = pending.text || pending.preview?.note || "", noteHash = createHash("sha256").update(note).digest("hex");
        let target = "jarvis://semantic", beforeHash = createHash("sha256").update("").digest("hex"), afterHash = noteHash;
        if (pending.mode === "repo-local" && pending.preview) {
          const result = applyMemoryAppend(pending.preview);
          target = result.file; beforeHash = result.beforeHash; afterHash = result.afterHash;
        } else {
          const cls = classifyMemoryText({ text: note, cwd: pending.cwd });
          let vec: number[] = []; try { vec = await embedOne(note); } catch { vec = []; }
          if (pending.ownerGeneration && !sessionOwnerGenerationCurrent(pending.ownerGeneration)) throw new Error("a sessão mudou ou foi excluída durante a indexação");
          memory.upsert({ id: `note:${pending.actor.userId || "local"}:${Date.now()}`, sessionId: pending.sessionId || "memory", runnerId: pending.runnerId, ownerId: actorPrincipalId(pending.actor), agent: pending.agent, cwd: pending.cwd, title: "Memória Jarvis", text: note.slice(0, 400), ts: Date.now(), vec, ...cls });
        }
        memoryProvenance.append({ at: Date.now(), sessionId: pending.sessionId, runnerId: pending.runnerId, userId: pending.actor.userId, deviceId: pending.actor.deviceId, agent: pending.agent, cwd: pending.cwd || "", target, beforeHash, afterHash, noteHash });
        auth.audit("memory_write", { userId: pending.actor.userId, deviceId: pending.actor.deviceId, runnerId: pending.runnerId, detail: `${pending.sessionId || "memory"}: ${target}` });
        sendMemoryFrame(ws, pending, { t: "memory_applied", token: msg.token, ok: true, target, beforeHash, afterHash, runnerId: pending.runnerId, sessionId: pending.sessionId });
        const confirmation = { t: "message", message: { sessionId: pending.sessionId || "", role: "assistant", text: pending.mode === "jarvis" ? "Anotado na memória privada do Jarvis" : "Anotado em " + target, ts: Date.now() } };
        sendMemoryFrame(ws, pending, confirmation);
      } catch (error: any) { sendMemoryFrame(ws, pending, { t: "memory_applied", token: msg.token, ok: false, error: "memória: " + String(error?.message ?? error) }); }
      return;
    }
    if (msg.t === "memory_cancel" && typeof msg.token === "string") {
      cleanExpiredMemoryConfirmations();
      const pending = pendingMemoryConfirmations.get(msg.token);
      if (!pending) { send(ws, { t: "memory_cancelled", token: msg.token, ok: false, error: "prévia inexistente, expirada ou já consumida" }); return; }
      if (pending.actor.userId && !auth.sameIdentity(pending.actor.userId, principalOf(ws)?.userId)) { send(ws, { t: "memory_cancelled", token: msg.token, ok: false, error: "esta prévia pertence a outro usuário" }); return; }
      if (!canUseRunner(ws, pending.runnerId)) { send(ws, { t: "memory_cancelled", token: msg.token, ok: false, error: "sem acesso à máquina da prévia" }); return; }
      pendingMemoryConfirmations.delete(msg.token);
      if (pending.mode === "repo-remote") {
        const rc = runners.get(pending.runnerId);
        if (rc?.ws) sendToRunner(rc, { t: "memory_cancel", token: msg.token });
      }
      sendMemoryFrame(ws, pending, { t: "memory_cancelled", token: msg.token, ok: true, runnerId: pending.runnerId, sessionId: pending.sessionId });
      return;
    }
    if (msg.t === "memory_append") { send(ws, { t: "error", message: "escrita de memória exige prévia e confirmação" }); return; }
    if (msg.t === "runner" && typeof msg.runnerId === "string") {
      const known = runners.has(msg.runnerId);
      const target = known ? msg.runnerId : LOCAL_ID;
      if (!canUseRunner(ws, target)) { send(ws, { t: "error", message: "sem acesso a esta máquina" }); return; }
      clientRunner.set(ws, target); subs.delete(ws);
      // Antes o fallback para LOCAL era SILENCIOSO: o cliente seguia acreditando que estava na outra
      // máquina enquanto o Hub roteava tudo para o Desktop — todo send/open caía na máquina errada sem
      // nenhum sinal. Um id desconhecido agora vira erro visível (a lista de máquinas vai junto, e o
      // cliente reconcilia o seletor com ela).
      if (!known) send(ws, { t: "error", message: `máquina desconhecida "${msg.runnerId}" — roteando para ${runnerLabels[LOCAL_ID] || "esta máquina"}` });
      send(ws, { t: "machines", machines: machineList(ws) });
      if (target === LOCAL_ID) sendSessions(ws);
      else { const rc = runners.get(target); if (!rc || !sendToRunner(rc, { t: "list" })) send(ws, { t: "sessions", sessions: [], recentDirs: [], runnerId: target }); }
      return;
    }
    if (msg.t === "rename_runner" && typeof msg.runnerId === "string" && typeof msg.label === "string") {
      if (!requireOwner(ws)) return;
      runnerLabels[msg.runnerId] = msg.label.slice(0, 40); saveRunnerLabels(); broadcastMachines(); secState(ws); return;
    }
    // unified "all machines" view: aggregate local + every online runner's sessions (tagged).
    if (msg.t === "listAll") {
      aggregateAllSessions(ws).then(({ sessions, machines }) => { if (ws.readyState === WebSocket.OPEN) send(ws, { t: "sessions", runnerId: "all", sessions, machines, recentDirs: recentDirsList(10, sessions) }); }).catch(() => { /* ignore */ });
      return;
    }
    // when viewing a REMOTE machine, session ops are forwarded to that runner
    {
      const explicitListRunner = msg.t === "listdir" && typeof msg.runnerId === "string" ? msg.runnerId : null;
      if (explicitListRunner && !canUseRunner(ws, explicitListRunner)) { send(ws, { t: "error", message: "sem acesso a esta máquina" }); return; }
      const ar = explicitListRunner || activeRunner(ws);
      if (ar !== LOCAL_ID && (msg.t === "list" || msg.t === "open" || msg.t === "send" || msg.t === "new" || msg.t === "listdir" || msg.t === "configure" || msg.t === "readfile" || msg.t === "readdiff" || msg.t === "delete" || msg.t === "dropLast" || msg.t === "archive" || msg.t === "getWorktreePreview")) {
        const targeted = Array.isArray(msg.sessionIds) ? msg.sessionIds.filter((id: unknown): id is string => typeof id === "string") : (typeof msg.sessionId === "string" ? [msg.sessionId] : []);
        if (targeted.some((sid: string) => isInternalExecutionSession(ar, sid))) { send(ws, { t: "error", message: "sessão interna só pode ser acessada pelo painel Trabalhos" }); return; }
        const rc = runners.get(ar);
        if (!rc || !rc.ws || rc.ws.readyState !== 1) { send(ws, { t: "error", message: "máquina offline" }); return; }
        if (msg.t === "list") { sendToRunner(rc, { t: "list" }); return; }
        if (msg.t === "dropLast" && typeof msg.sessionId === "string") { activityBuf.delete(scopedSessionKey(ar, msg.sessionId)); sendToRunner(rc, { t: "dropLast", sessionId: msg.sessionId }); return; }
        if (msg.t === "archive" && (typeof msg.sessionId === "string" || Array.isArray(msg.sessionIds))) { sendToRunner(rc, { t: "archive", sessionId: msg.sessionId, sessionIds: msg.sessionIds, archived: msg.archived !== false }); return; }
        if (msg.t === "delete" && (typeof msg.sessionId === "string" || Array.isArray(msg.sessionIds))) {
          const requestedIds = Array.isArray(msg.sessionIds)
            ? msg.sessionIds.filter((id: unknown): id is string => typeof id === "string")
            : typeof msg.sessionId === "string" ? [msg.sessionId] : [];
          const ids = [...new Set<string>(requestedIds)];
          if (ids.some((sid) => sessionDispatchBusy(ar, sid))) { send(ws, { t: "error", message: "pare o turno antes de excluir esta conversa" }); return; }
          const deleteTargets = preparePendingDeleteTargets(ar, ids, !!msg.alsoNative);
          const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "delete", sessionIds: ids, metadata: { deleteTargets } });
          if (!sendToRunner(rc, { t: "delete", reqId, sessionId: msg.sessionId, sessionIds: msg.sessionIds, alsoNative: !!msg.alsoNative })) { pendingReq.delete(reqId); send(ws, { t: "error", message: "não foi possível solicitar a exclusão na máquina" }); }
          return;
        }
        if (msg.t === "readdiff" && typeof msg.path === "string" && typeof msg.sessionId === "string") { const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "filediff", sessionIds: [msg.sessionId] }); if (!sendToRunner(rc, { t: "readdiff", reqId, sessionId: msg.sessionId, path: msg.path })) pendingReq.delete(reqId); return; }
        if (msg.t === "new") { const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "new" }); if (!sendToRunner(rc, { t: "new", reqId, agent: msg.agent, cwd: msg.cwd })) pendingReq.delete(reqId); return; }
        if (msg.t === "readfile" && typeof msg.path === "string") { const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "readfile" }); if (!sendToRunner(rc, { t: "readfile", reqId, path: msg.path, cwd: msg.cwd })) pendingReq.delete(reqId); return; }
        if (msg.t === "listdir") { const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "listdir" }); if (!sendToRunner(rc, { t: "listdir", reqId, path: msg.path, files: msg.files })) pendingReq.delete(reqId); return; }
        if (msg.t === "getWorktreePreview" && typeof msg.sessionId === "string") { const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "preview", sessionIds: [msg.sessionId] }); if (!sendToRunner(rc, { t: "preview_query", reqId, sessionId: msg.sessionId })) { pendingReq.delete(reqId); send(ws, { t: "worktree_preview", sessionId: msg.sessionId, candidates: [] }); } return; }
        if (msg.t === "configure" && typeof msg.sessionId === "string") { const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "configure", sessionIds: [msg.sessionId] }); if (!sendToRunner(rc, { t: "configure", reqId, sessionId: msg.sessionId, agent: msg.agent, cwd: msg.cwd })) pendingReq.delete(reqId); return; }
        if (msg.t === "open" && typeof msg.sessionId === "string") { const reqId = registerPendingRequest({ ws, runnerId: ar, operation: "open", sessionIds: [msg.sessionId] }); subs.set(ws, msg.sessionId); if (!sendToRunner(rc, { t: "open", reqId, sessionId: msg.sessionId })) pendingReq.delete(reqId); return; }
        if (msg.t === "send" && typeof msg.text === "string") {
          let sid = (typeof msg.sessionId === "string" && msg.sessionId) ? msg.sessionId : (subs.get(ws) || "default");
          const canonicalSid = isNativeId(sid) ? managedRunnerSessionForNative(rc.id, sid) : undefined;
          if (canonicalSid) sid = canonicalSid;
          if (typeof msg.msgId === "string" && !incomingTurns.add(msg.msgId)) return;
          clearPendingAsk(ar, sid);
          auth.audit("send", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: ar, detail: `${sid}: ${String(msg.text).slice(0, 80)}` });
          if (runnerUpdateDraining(ar)) {
            enqueueChatTurn(ar, sid, { text: msg.text, atts: Array.isArray(msg.attachments) ? msg.attachments : [], model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, auto: autoFlags(msg.auto), runnerId: ar, msgId: typeof msg.msgId === "string" ? msg.msgId : undefined, actor: actorOf(ws, "queue") });
            send(ws, { t: "queued", runnerId: ar, sessionId: sid, text: msg.text, update: true, message: "Máquina drenando para atualização — mensagem ficou na fila." }); return;
          }
          const turnActor = actorOf(ws);
          if (sessionDispatchBusy(ar, sid)) {
            pushQueueItem(ar, sid, { text: msg.text, atts: Array.isArray(msg.attachments) ? msg.attachments : [], model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, auto: autoFlags(msg.auto), runnerId: ar, msgId: typeof msg.msgId === "string" ? msg.msgId : undefined, actor: actorOf(ws, "queue") });
            broadcastQueue(ar, sid); saveQueues(); void maybeFlushQueue(ar, sid, false); send(ws, { t: "queued", runnerId: ar, sessionId: sid, text: msg.text }); return;
          }
          const lease = reserveSessionDispatch(ar, sid, actorPrincipalId(turnActor), "send");
          if (!lease) {
            enqueueChatTurn(ar, sid, { text: msg.text, atts: Array.isArray(msg.attachments) ? msg.attachments : [], model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, auto: autoFlags(msg.auto), runnerId: ar, msgId: typeof msg.msgId === "string" ? msg.msgId : undefined, actor: { ...turnActor, source: "queue" } });
            send(ws, { t: "queued", runnerId: ar, sessionId: sid, text: msg.text }); return;
          }
          try {
          if (!sessionDispatchAuthorized(lease, ws, rc)) throw new Error("a autorização da sessão mudou antes do envio");
          const flags = autoFlags(msg.auto);
          let state = runnerSessionState.get(rc.id)?.get(sid);
          let hist: any = null;
          if (needsAuto(flags)) {
            hist = await runnerHistory(rc, sid, { ws });
            if (!sessionDispatchAuthorized(lease, ws, rc)) throw new Error("a autorização da sessão mudou durante a leitura do histórico");
            if (hist) state = { ...(state || {}), agent: hist.agent, cwd: hist.cwd, started: Number(hist.total) > 0, source: /^(claude:|codex:)/.test(sid) ? "native" : "managed" };
          }
          const currentAgent = state?.agent || (typeof msg.agent === "string" ? msg.agent : undefined) || rc.info.agents[0];
          if (!currentAgent) { send(ws, { t: "error", message: "nenhuma IA disponível nesta máquina" }); return; }
          const su = sessionUsage(sid, ar);
          const decision = await decideAutomaticRoute({
            runnerId: ar, sid, text: msg.text, started: state?.source === "native" || state?.started === true,
            currentAgent, currentModel: typeof msg.model === "string" ? msg.model : (flags.model ? su.model : undefined),
            currentEffort: typeof msg.effort === "string" ? msg.effort : undefined,
            flags, descriptors: rc.info.agentDescriptors || [], available: rc.info.agents || [],
            recent: Array.isArray(hist?.messages) ? hist.messages.filter((m: any) => m?.role === "user" || m?.role === "assistant").slice(-6).map((m: any) => ({ role: m.role, text: String(m.text || "") })) : [],
            contextTokens: hist?.inputTokens || su.contextTokens, contextWindowTokens: hist?.contextWindowTokens || su.contextWindowTokens,
            notify: (frame) => { for (const c of clientsOn(rc.id)) if (subs.get(c) === sid && canAccessSession(c, rc.id, sid)) send(c, frame); },
          });
          if (!sessionDispatchAuthorized(lease, ws, rc)) throw new Error("a autorização da sessão mudou durante o roteamento");
          const states = runnerSessionState.get(rc.id) || new Map<string, any>(); states.set(sid, { ...(state || {}), id: sid, agent: decision.agent }); runnerSessionState.set(rc.id, states);
          if (msg.speak) remoteSpeak.add(ar + "\0" + sid);
          const personal = await personalContextForChat(ar, sid, msg.text, turnActor, () => refreshSessionDispatchAuthorization(lease));
          if (!sessionDispatchAuthorized(lease, ws, rc)) throw new Error("a autorização da sessão mudou durante o contexto pessoal");
          const turnId = (typeof msg.msgId === "string" && msg.msgId) ? msg.msgId : randomUUID();
          if (!sendOwnedRunnerTurn(rc, sid, turnId, actorPrincipalId(turnActor), { t: "send", text: msg.text, contextPrefix: personal?.contextPrefix, agent: decision.agent, opts: { model: decision.model, effort: decision.effort, permissionMode: remoteSessionModes.get(rc.id + " " + sid) }, attachments: Array.isArray(msg.attachments) ? msg.attachments : [], speaker: typeof msg.speaker === "string" ? msg.speaker : undefined, actor: turnActor })) {
            remoteSpeak.delete(ar + "\0" + sid);
            send(ws, { t: "error", message: "não foi possível enviar para a máquina" }); return;
          }
          markRunnerSessionActive(ar, sid);
          return;
          } finally { releaseSessionDispatch(lease); }
        }
      }
    }

    // --- session management (shared across every client) ---
    if (msg.t === "list") {
      sendSessions(ws);
      return;
    }
    // Delete one or MANY conversations on THIS (local) machine — and, if asked, the
    // underlying native claude/codex session each maps to. Irreversible.
    if (msg.t === "delete" && (typeof msg.sessionId === "string" || Array.isArray(msg.sessionIds))) {
      const ids: string[] = Array.isArray(msg.sessionIds) ? msg.sessionIds.filter((x: any) => typeof x === "string") : [msg.sessionId];
      if (ids.some((sid) => sessionDispatchBusy(LOCAL_ID, sid))) { send(ws, { t: "error", message: "pare o turno antes de excluir esta conversa" }); return; }
      const deleteOne = (sid: string): boolean => {
        if (isNativeId(sid)) { stopTail(sid); return deleteNative(sid); }
        if (store.isHidden(sid)) return false;
        const s = store.get(sid);
        if (s) {
          const ag = agents.get(s.agent);
          // Prefixo era fixo em "claude:" — sempre errado pra codex (procurava um arquivo claude com
          // um uuid de thread codex, então nunca achava nada e a exclusão nativa falhava em silêncio).
          if (msg.alsoNative && ag.nativeSessionId) { const nid = ag.nativeSessionId(sid); const key = nid && nativeIdForAgent(s.agent, nid); if (key) deleteNative(key); }
          ag.forgetSession?.(sid);
        }
        return store.delete(sid);
      };
      const deletedIds: string[] = [];
      for (const sid of ids) {
        synchronizePersonalSessionAliases(LOCAL_ID, sid);
        const invalidations = (msg.alsoNative && !isNativeId(sid) ? sessionAliases(LOCAL_ID, sid) : [sid]).map((alias) => personalSessionBindings.capture(LOCAL_ID, alias));
        if (deleteOne(sid)) {
          deletedIds.push(sid);
          for (const snapshot of personalSessionBindings.invalidateManyIfCurrent(invalidations)) removeSessionExecutionAndMemory(LOCAL_ID, snapshot.sessionId);
        }
        if (subs.get(ws) === sid && deletedIds.includes(sid)) subs.delete(ws);
      }
      const okCount = deletedIds.length;
      auth.audit("delete", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${okCount}/${ids.length} conversa(s)` });
      send(ws, { t: "deleted", sessionId: msg.sessionId, ids: deletedIds, ok: okCount === ids.length, okCount });
      pushSessions();
      return;
    }
    // Archive / unarchive local managed sessions (non-destructive; the session stays listed but drops out
    // of the default "Active" view). `archived:false` unarchives. Remote/native sessions are skipped.
    if (msg.t === "archive" && (typeof msg.sessionId === "string" || Array.isArray(msg.sessionIds))) {
      const ids: string[] = Array.isArray(msg.sessionIds) ? msg.sessionIds.filter((x: any) => typeof x === "string") : [msg.sessionId];
      const archived = msg.archived !== false;
      let okCount = 0;
      for (const sid of ids) { if (isNativeId(sid) || store.isHidden(sid)) continue; if (store.setArchived(sid, archived)) okCount++; }
      auth.audit(archived ? "archive" : "unarchive", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${okCount}/${ids.length} conversa(s)` });
      send(ws, { t: "archived", ids, archived, ok: okCount === ids.length, okCount });
      pushSessions();
      return;
    }
    // Set/switch a session's permission mode (the picker). Mutable at any time, unlike agent/cwd.
    // Persisted on the session (managed) or an in-memory map (native), so the next turn — and any
    // NEW session opened later for the same project — inherits it.
    if (msg.t === "setmode" && typeof msg.sessionId === "string") {
      const pm = normalizePermissionMode(typeof msg.mode === "string" ? msg.mode : undefined);
      if (!pm) { send(ws, { t: "error", message: "modo de permissão inválido" }); return; }
      setSessionPermissionMode(msg.sessionId, pm);
      send(ws, { t: "mode", runnerId: LOCAL_ID, sessionId: msg.sessionId, mode: pm });
      pushSessions();
      return;
    }
    // Manual permission mode (Fase 3): the user answered a pending tool approval. Resolve the held
    // HTTP response the Claude bridge is blocked on. Only someone who can access the session may
    // decide; unknown/expired ids are ignored (already answered or timed out → deny).
    if (msg.t === "permission_decision" && typeof msg.id === "string") {
      const pending = pendingPermissions.get(msg.id);
      if (pending) {
        if (!canAccessSession(ws, pending.runnerId, pending.sessionId)) { send(ws, { t: "error", message: "sem acesso a esta sessão" }); return; }
        const allow = msg.behavior === "allow";
        pending.settle(allow ? { behavior: "allow", updatedInput: msg.updatedInput } : { behavior: "deny", message: "Negado pelo usuário" });
      }
      return;
    }
    // Durable session-defaults config (agent/model/effort/permission), scoped global + per project.
    // A brand-new project seeds a new session from here (an existing one seeds from its last session).
    if (msg.t === "get_session_defaults") {
      send(ws, { t: "session_defaults", doc: sessionDefaultsDoc });
      return;
    }
    if (msg.t === "set_session_defaults") {
      if (!requireOwner(ws)) return;
      sessionDefaultsDoc = sanitizeSessionDefaults(msg.doc);
      try { saveSessionDefaults(sessionDefaultsDoc, SESSION_DEFAULTS_FILE); } catch { /* best-effort */ }
      send(ws, { t: "session_defaults", doc: sessionDefaultsDoc, saved: true });
      return;
    }
    // plan usage (5h / weekly windows) — account-level, from the local agent's usage endpoint
    if (msg.t === "get_usage") {
      const name = typeof msg.agent === "string" && agents.names().includes(msg.agent) ? msg.agent : agents.default;
      const requestedRunner = typeof msg.runnerId === "string" ? msg.runnerId : LOCAL_ID;
      let plan = null; const a = agents.get(name); let supportsUsage = !!a.usage;
      let planStatus: "available" | "not_reported" | "unsupported" | "error" = supportsUsage ? "not_reported" : "unsupported";
      if (requestedRunner !== LOCAL_ID) {
        const rc = runners.get(requestedRunner), snapHas = Object.prototype.hasOwnProperty.call(rc?.info.agentUsage || {}, name);
        const fallback: { agent: string; plan: any; planStatus: "available" | "not_reported" | "unsupported" | "error" } = { agent: name, plan: (rc?.info.agentUsage?.[name] as any) || null, planStatus: !snapHas ? "unsupported" : (rc?.info.agentUsage?.[name] ? "available" : "not_reported") };
        if (rc?.ws && rc.ws.readyState === WebSocket.OPEN) {
          const live = await runnerUsage(rc, name, fallback);
          plan = live?.plan || null; planStatus = live?.planStatus || fallback.planStatus;
        } else { plan = fallback.plan; planStatus = fallback.planStatus; }
        supportsUsage = planStatus !== "unsupported";
      }
      else try { plan = a.usage ? await a.usage() : null; planStatus = supportsUsage ? (plan ? "available" : "not_reported") : "unsupported"; } catch { plan = null; planStatus = "error"; }
      // total accumulated across all sessions, so the client can show THIS session as a share of it
      // (a raw $ on a plan has no baseline to compare against — a % does).
      const costTotal = usageLedger.total().costUsd;
      send(ws, { t: "usage_info", agent: name, runnerId: requestedRunner, plan, planStatus, total: costTotal });
      return;
    }
    // wake-word + speaker-id/voice-gate → handleVoiceDeviceMsg (extração verbatim, mesma ordem)
    if (await handleVoiceDeviceMsg(ws, msg)) return;
    // read a file to view it ("ver antes de executar") — local machine
    if (msg.t === "readfile" && typeof msg.path === "string") {
      send(ws, { t: "filecontent", ...readProjectFile(msg.path, typeof msg.cwd === "string" ? msg.cwd : undefined) });
      return;
    }
    // read the diff of an edited file, reconstructed from the session's claude jsonl — local machine
    if (msg.t === "readdiff" && typeof msg.path === "string" && typeof msg.sessionId === "string") {
      if (store.isHidden(msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não expõe diff pelo chat" }); return; }
      const diffId = isNativeId(msg.sessionId) ? msg.sessionId : (() => { const s = store.get(msg.sessionId); const nid = s && agents.get(s.agent).nativeSessionId?.(s.id); return s && nid ? (nativeIdForAgent(s.agent, nid) || "") : ""; })();
      const managed = !diffId ? store.history(msg.sessionId) : [];
      send(ws, { t: "filediff", ...(diffId ? sessionFileDiff(diffId, msg.path) : fileDiffFromMessages(managed, msg.path)) });
      return;
    }
    // folder browser for the "new conversation" dialog (Hub machine)
    if (msg.t === "listdir") {
      const base = typeof msg.path === "string" && msg.path ? msg.path : homedir();
      try {
        const all = readdirSync(base, { withFileTypes: true });
        const entries = all.filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => a.localeCompare(b));
        // `files` só é preenchido quando o cliente pede (msg.files) — o folder-picker legado não pede,
        // então segue vendo só pastas. O painel de árvore de arquivos (Orca #1) pede e recebe os dois.
        const files = msg.files ? all.filter((e) => e.isFile()).map((e) => e.name).sort((a, b) => a.localeCompare(b)) : undefined;
        send(ws, { t: "dirs", path: base, parent: dirname(base), entries, files });
      } catch (e: any) {
        send(ws, { t: "error", message: "listdir: " + String(e?.message ?? e) });
      }
      return;
    }
    if (msg.t === "open" && typeof msg.sessionId === "string" && isNativeId(msg.sessionId)) {
      subs.set(ws, msg.sessionId);
      syncTails();
      reconcileNativeExecutions(msg.sessionId);
      const h = nativeHistory(msg.sessionId);
      if (!h) { send(ws, { t: "error", message: "sessão nativa não encontrada" }); return; }
      send(ws, {
        t: "history", runnerId: LOCAL_ID,
        sessionId: msg.sessionId,
        session: { agent: h.agent, cwd: h.cwd, title: h.title, native: true, writable: h.agent === "claude-code" || h.agent === "codex", inputTokens: h.inputTokens, contextWindowTokens: h.contextWindowTokens, sessionCost: costOf(msg.sessionId), sessionUsage: sessionUsage(msg.sessionId), model: h.model, effort: h.effort, permissionMode: sessionPermissionMode(msg.sessionId) },
        total: h.messages.length,
        messages: h.messages.slice(-HISTORY_CAP).map((m) => ({ sessionId: msg.sessionId, role: m.role, text: m.text, ts: m.ts, agent: h.agent, name: m.name, detail: m.detail, path: m.path, adds: m.adds, dels: m.dels, rows: m.rows, activity: m.activity })),
        files: sessionFiles(msg.sessionId),
      });
      replayActivity(ws, LOCAL_ID, msg.sessionId);
      replayRoute(ws, LOCAL_ID, msg.sessionId);
      sendPendingAsk(ws, LOCAL_ID, msg.sessionId);
      send(ws, { t: "queue", runnerId: LOCAL_ID, sessionId: msg.sessionId, items: queueOf(LOCAL_ID, msg.sessionId).map((q) => ({ text: q.text, atts: q.atts, msgId: q.msgId })) });
      return;
    }
    if (msg.t === "open" && typeof msg.sessionId === "string") {
      if (store.isHidden(msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não pode ser aberta pelo chat" }); return; }
      subs.set(ws, msg.sessionId);
      syncTails();
      const s = store.ensure(msg.sessionId);
      try { synchronizePersonalSessionAliases(LOCAL_ID, s.id); }
      catch { send(ws, { t: "error", message: "conflito de propriedade entre a sessão e seu transcript nativo" }); return; }
      reconcileFromNative(s); // backfill a reply an orphaned turn (killed by a prior hub restart) already wrote natively
      const all = store.history(s.id);
      const nid = agents.get(s.agent).nativeSessionId?.(s.id);
      const su = sessionUsage(s.id), nativeKey = nid ? nativeIdForAgent(s.agent, nid) : null, nh = nativeKey ? nativeHistory(nativeKey) : null, lastUsage = [...all].reverse().find((m: any) => m.usage)?.usage;
      const nativeFiles = nativeKey ? sessionFiles(nativeKey) : [], derivedFiles = touchedFilesFromMessages(all), paths = new Set(nativeFiles.map((f) => f.path));
      const files = [...nativeFiles, ...derivedFiles.filter((f) => !paths.has(f.path))];
      send(ws, { t: "history", runnerId: LOCAL_ID, sessionId: s.id, session: { agent: s.agent, cwd: s.cwd, title: nh?.title || s.title, nativeId: nid, sessionCost: costOf(s.id), sessionUsage: su, inputTokens: nh?.inputTokens || su.contextTokens, contextWindowTokens: nh?.contextWindowTokens || su.contextWindowTokens, model: nh?.model || su.model || lastUsage?.model, effort: nh?.effort || su.effort || lastUsage?.effort, permissionMode: sessionPermissionMode(s.id) }, total: all.length, messages: all.slice(-HISTORY_CAP), files });
      replayActivity(ws, LOCAL_ID, s.id);
      replayRoute(ws, LOCAL_ID, s.id);
      sendPendingAsk(ws, LOCAL_ID, s.id);
      send(ws, { t: "queue", runnerId: LOCAL_ID, sessionId: s.id, items: queueOf(LOCAL_ID, s.id).map((q) => ({ text: q.text, atts: q.atts, msgId: q.msgId })) });
      // Debate em andamento nesta sessão: reenvia o último progresso para quem está ABRINDO agora. Sem
      // isso, um cliente que entrou no meio (outro aparelho, recarregou a página) ficaria cego até a
      // próxima troca de fase — que pode levar minutos — e sem saber que o chat fala com o debate.
      { const live = liveDebateForSession(s.id); if (live?.lastProgress) send(ws, live.lastProgress); }
      return;
    }
    if (msg.t === "new") {
      const _tNew = Date.now();
      const id = randomUUID();
      const cwd = typeof msg.cwd === "string" && existsSync(msg.cwd) ? msg.cwd : CWD;
      // Seed the new session: an EXISTING project inherits from its last started session; a brand-new
      // project falls back to the configured per-project/global defaults. Only fields the source
      // actually has are applied (an inherited-but-empty field falls through to the config, then to
      // the system default). An explicit agent picked in the dialog always wins.
      const seed: SessionDefaults = { ...resolveSessionDefaults(sessionDefaultsDoc, cwd) };
      const inherited = store.inheritForCwd(cwd);
      if (inherited) for (const k of ["agent", "model", "effort", "permissionMode"] as const) { const v = inherited[k]; if (v) (seed as Record<string, unknown>)[k] = v; }
      const explicitAgent = agents.names().includes(msg.agent) ? msg.agent : undefined;
      const agentName = explicitAgent || (seed.agent && agents.names().includes(seed.agent) ? seed.agent : agents.default);
      const permissionMode = normalizePermissionMode(typeof msg.permissionMode === "string" ? msg.permissionMode : undefined) ?? seed.permissionMode;
      const s = store.ensure(id, { agent: agentName, cwd, permissionMode });
      subs.set(ws, id);
      syncTails();
      log.debug("session_create", { sid: id, agent: agentName, ms: Date.now() - _tNew });
      send(ws, { t: "history", runnerId: LOCAL_ID, sessionId: id, session: { agent: s.agent, cwd: s.cwd, title: s.title, model: seed.model, effort: seed.effort, permissionMode: s.permissionMode }, messages: [] });
      pushSessions();
      return;
    }
    // Change agent/folder of a session that has not started yet (locked-session rule).
    if (msg.t === "configure" && typeof msg.sessionId === "string") {
      if (store.isHidden(msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não pode ser configurada pelo chat" }); return; }
      const s = store.get(msg.sessionId);
      if (!s) { send(ws, { t: "error", message: "sessão não encontrada" }); return; }
      const agent = agents.names().includes(msg.agent) ? msg.agent : undefined;
      const cwd = typeof msg.cwd === "string" && existsSync(msg.cwd) ? msg.cwd : undefined;
      if (!store.reconfigure(s.id, { agent, cwd })) {
        send(ws, { t: "error", message: "sessão já iniciada — agente e pasta estão travados" });
        return;
      }
      const ns = store.get(s.id)!;
      send(ws, { t: "history", runnerId: LOCAL_ID, sessionId: ns.id, session: { agent: ns.agent, cwd: ns.cwd, title: ns.title }, messages: store.history(ns.id) });
      pushSessions();
      return;
    }

    // cross-session search (explicit) + execute-in-a-specific-session
    if (msg.t === "search" && typeof msg.query === "string") {
      // Filtro LITERAL sobre título + conteúdo de todas as sessões (como grep). Sem LLM, sem áudio —
      // a busca semântica/falada continua no caminho de voz (looksLikeCrossSessionQuery).
      // Staged delivery so results appear FAST and grow: managed sessions (in-memory) render
      // instantly; then the most-recent native sessions; then the full native sweep. Each message
      // carries the full accumulated set + a `done` flag, so the client just replaces + shows
      // "buscando mais…" until done. setImmediate lets each batch paint before the next disk scan.
      {
        const q = msg.query;
        const managed = searchManaged(q, ws);
        const exclude = nativeExcludeIds();
        const NAT = Number(process.env.JARVIS_NATIVE_LIMIT) || 40;
        send(ws, { t: "searchResult", query: q, hits: sortHits([...managed]), done: false });
        const stage = async (limit: number, includeRemote: boolean, done: boolean): Promise<void> => {
          if (ws.readyState !== WebSocket.OPEN) return;
          try {
            const nat = searchNative(q, limit).filter((h) => !exclude.has(h.id) && canAccessSession(ws, LOCAL_ID, h.id));
            const remote = includeRemote ? await searchRunnerSessions(ws, q) : [];
            send(ws, { t: "searchResult", query: q, hits: sortHits([...managed, ...nat, ...remote]), done });
          } catch { send(ws, { t: "searchResult", query: q, hits: sortHits([...managed]), done }); }
        };
        // most-recent 10 native first (quick), then the full sweep — or straight to full if the cap is ≤10.
        setImmediate(() => { if (NAT > 10) { void stage(10, false, false); setImmediate(() => { void stage(NAT, true, true); }); } else void stage(NAT, true, true); });
      }
      return;
    }
    // per-session "resumir e falar" — cheap one-shot, spoken, not stored in history
    if (msg.t === "summarize" && typeof msg.sessionId === "string") {
      if (isInternalExecutionSession(activeRunner(ws), msg.sessionId)) { send(ws, { t: "error", message: "sessão interna só pode ser acompanhada pelo painel Trabalhos" }); return; }
      if (voiceOpBusy) { send(ws, { t: "busy", message: "Já estou gerando um áudio — aguarde terminar." }); return; }
      voiceOpBusy = true;
      try { await summarizeAndSpeak(ws, msg.sessionId, msg.speak !== false); } finally { voiceOpBusy = false; }
      return;
    }
    // cross-agent digest ("o que está rolando entre as sessões")
    if (msg.t === "digest") {
      if (voiceOpBusy) { send(ws, { t: "busy", message: "Já estou gerando um áudio — aguarde terminar." }); return; }
      voiceOpBusy = true;
      try { await digestAndSpeak(ws, msg.speak !== false); } finally { voiceOpBusy = false; }
      return;
    }
    if (msg.t === "council_start" && typeof msg.sessionId === "string" && typeof msg.topic === "string") {
      const mode = COUNCIL_MODES.includes(msg.mode) ? msg.mode as CouncilMode : "auto";
      const input = {
        sessionId: msg.sessionId,
        topic: msg.topic.slice(0, 20_000),
        mode,
        includeContext: msg.includeContext !== false,
        model: typeof msg.model === "string" ? msg.model : undefined,
        effort: typeof msg.effort === "string" ? msg.effort : undefined,
        agents: Array.isArray(msg.agents) ? msg.agents.filter((x: any) => typeof x === "string").slice(0, 12) : undefined,
      };
      const runnerId = activeRunner(ws);
      if (runnerId === LOCAL_ID) await startLocalCouncil(ws, input);
      else {
        const rc = runners.get(runnerId);
        if (!rc) { send(ws, { t: "error", message: "máquina desconhecida" }); return; }
        await startRemoteCouncil(ws, rc, input);
      }
      return;
    }
    // Debate iterativo (modo do Conselho): rodadas de réplica cruzada entre 2+ IAs até o juiz declarar
    // consenso ou atingir o teto. LOCAL-only por enquanto (mesma limitação do Torneio).
    if (msg.t === "debate_start" && typeof msg.sessionId === "string" && typeof msg.topic === "string") {
      if (activeRunner(ws) !== LOCAL_ID) { send(ws, { t: "error", message: "Debate por enquanto roda só na máquina servidora" }); return; }
      await startLocalDebate(ws, {
        sessionId: msg.sessionId,
        topic: msg.topic.slice(0, 20_000),
        includeContext: msg.includeContext !== false,
        effortLevel: normalizeEffortLevel(msg.effortLevel),
        agents: Array.isArray(msg.agents) ? msg.agents.filter((x: any) => typeof x === "string").slice(0, 12) : undefined,
        maxRounds: typeof msg.maxRounds === "number" ? msg.maxRounds : undefined,
      });
      return;
    }
    // Interjeição: recado do usuário para o debate em andamento (rota EXPLÍCITA do cliente, que já sabe
    // do debate pelos frames de progresso). O caminho implícito — um `send` normal enquanto o debate
    // roda — é interceptado mais abaixo, no bloco de conversa, e cobre cliente desatualizado e voz.
    // Falha devolve o texto: o cliente já limpou o composer, então engolir aqui perderia a mensagem.
    if (msg.t === "debate_say" && typeof msg.text === "string") {
      const sid = (typeof msg.sessionId === "string" && msg.sessionId) || subs.get(ws) || "";
      const recado = msg.text.trim();
      const live = sid && activeRunner(ws) === LOCAL_ID ? debateOpenForInterjection(sid) : undefined;
      if (!live || !recado) {
        send(ws, { t: "debate_said", ok: false, runnerId: LOCAL_ID, sessionId: sid, text: msg.text, message: "Nenhum debate aceitando recado nesta sessão." });
        return;
      }
      await acceptDebateInterjection(live, ws, recado, msg.speak === true);
      return;
    }
    // Espaço de Soluções: Benchmark/Revisão/Auditoria local com N candidatos + consolidador.
    // LOCAL-only por enquanto (o caminho remoto exigiria handler no runner, como o council).
    if (msg.t === "tournament_start" && typeof msg.sessionId === "string" && typeof msg.task === "string") {
      const mode = SOLUTION_WORKSPACE_MODES.includes(msg.mode) ? msg.mode as SolutionWorkspaceMode : "benchmark";
      const flowLabel = mode === "benchmark" ? "Benchmark" : mode === "audit" ? "Auditoria" : "Revisão paralela";
      if (activeRunner(ws) !== LOCAL_ID) { send(ws, { t: "error", message: `${flowLabel} só roda na máquina local por enquanto` }); return; }
      const task = msg.task.slice(0, 20_000).trim();
      if (!task) { send(ws, { t: "error", message: `${flowLabel}: tarefa vazia` }); return; }
      // competitors explícitos, ou N cópias do agente da sessão (default 3, clamp 2..6).
      const sAgent = store.get(msg.sessionId)?.agent || agents.default;
      let competitors: TournamentCompetitor[] = Array.isArray(msg.competitors)
        ? msg.competitors.filter((c: any) => c && typeof c.agent === "string").map((c: any) => ({ agent: c.agent, model: typeof c.model === "string" ? c.model : undefined, effort: typeof c.effort === "string" ? c.effort : undefined, label: typeof c.label === "string" ? c.label : undefined }))
        : [];
      if (competitors.length < 2) {
        const count = Math.min(6, Math.max(2, Number(msg.count) || 3));
        competitors = Array.from({ length: count }, (_v, i) => ({ agent: sAgent, model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, label: `${sAgent} #${i + 1}` }));
      }
      await startLocalTournament(ws, { sessionId: msg.sessionId, task, competitors, criteria: typeof msg.criteria === "string" ? msg.criteria : undefined, write: msg.write !== false, mode });
      return;
    }
    // summary/digest one-shot config (which agent/model/effort — cheap by default)
    if (msg.t === "summary_cfg") { send(ws, { t: "summary_cfg", cfg: summaryCfg, agents: await agents.describe() }); return; }
    if (msg.t === "set_summary_cfg") {
      const requestedAgent = typeof msg.agent === "string" && localAgents.includes(msg.agent) ? msg.agent : undefined;
      const agentName = requestedAgent
        || (localAgents.includes(summaryCfg.agent) ? summaryCfg.agent : undefined)
        || localAgents.find((name) => agents.has(name))
        || agents.searchAgent().name;
      const caps = await agents.get(agentName).capabilities();
      const requestedModel = typeof msg.model === "string" ? msg.model : "";
      const model = caps.models.find((m) => m.id === requestedModel) || caps.models.find((m) => m.id === caps.defaultModel) || caps.models[0];
      const requestedEffort = typeof msg.effort === "string" ? msg.effort : "";
      summaryCfg.agent = agentName;
      if (model) summaryCfg.model = model.id;
      if (model?.efforts.length) summaryCfg.effort = model.efforts.includes(requestedEffort) ? requestedEffort : (model.defaultEffort || model.efforts[0]);
      saveSummaryCfg();
      send(ws, { t: "summary_cfg", cfg: summaryCfg, agents: await agents.describe() });
      return;
    }
    // Sincronizar modelos: bust every adapter's ~1h capability cache, re-discover live (current agent
    // first), then repin every model-bearing setting whose id no longer exists onto the closest
    // surviving model "by family" (resolveClosestModel), keeping the same effort level. Auto-applied
    // and persisted; the reply carries a full change report so the user sees exactly what moved.
    if (msg.t === "sync_models") {
      if (!requireOwner(ws)) return;
      const preferred = typeof msg.agent === "string" && agents.has(msg.agent) ? msg.agent : undefined;
      const catalog = await agents.refresh(preferred);
      const capsOf = (name: string) => catalog.find((c) => c.name === name) || { models: [] };
      const changes: Array<{ scope: string; agent: string; from: string; to: string; reason?: string }> = [];
      const label = (m?: string, e?: string) => `${m || "auto"}${e ? " · " + e : ""}`;
      const remap = (scope: string, agentName: string, model: string | undefined, effort: string | undefined,
        apply: (model: string | undefined, effort: string | undefined) => void) => {
        const r = resolveClosestModel(model, effort, capsOf(agentName));
        if (!r.changed) return;
        apply(r.model, r.effort);
        changes.push({ scope, agent: agentName, from: label(model, effort), to: label(r.model, r.effort), reason: r.reason });
      };
      // resumos / auto-rota / status
      remap("Resumos e auto-rota", summaryCfg.agent, summaryCfg.model, summaryCfg.effort, (m, e) => { if (m) summaryCfg.model = m; if (e) summaryCfg.effort = e; });
      // voz: principal + modelo rápido + modelo de upgrade + escalada (quando nomeia um modelo)
      remap("Voz (principal)", voiceCfg.agent, voiceCfg.model, voiceCfg.effort, (m, e) => { voiceCfg.model = voiceConfig.model = m; voiceCfg.effort = voiceConfig.effort = e; });
      remap("Voz (rápido)", voiceCfg.agent, voiceCfg.fastModel, voiceCfg.fastEffort, (m, e) => { if (m) voiceCfg.fastModel = m; if (e) voiceCfg.fastEffort = e; });
      remap("Voz (upgrade)", voiceCfg.agent, voiceCfg.upgradeModel, voiceCfg.upgradeEffort, (m, e) => { if (m) voiceCfg.upgradeModel = m; if (e) voiceCfg.upgradeEffort = e; });
      if (voiceCfg.escalate && voiceCfg.escalate !== "ask" && voiceCfg.escalate !== "auto") {
        remap("Voz (escalada)", voiceCfg.agent, voiceCfg.escalate, undefined, (m) => { if (m) voiceCfg.escalate = m; });
      }
      saveSummaryCfg(); saveVoiceCfg();
      // rotinas: só o modelo FIXADO (não os campos marcados como automáticos), por rotina.
      for (const r of routines.list()) {
        if (!r.agent || !agents.has(r.agent)) continue;      // rotina em agente automático → nada fixado
        const model = r.auto?.model ? undefined : r.model;   // campo em automático → roteador decide, não mexe
        if (!model) continue;
        const effort = r.auto?.effort ? undefined : r.effort;
        const res = resolveClosestModel(model, effort, capsOf(r.agent));
        if (!res.changed) continue;
        routines.update(r.id, { model: res.model, effort: res.effort });
        changes.push({ scope: `Rotina "${r.name}"`, agent: r.agent, from: label(model, effort), to: label(res.model, res.effort), reason: res.reason });
      }
      // Empurra o catálogo fresco para todos via `machines` (agentDescriptors) — os pickers leem dali,
      // sem o `enter()` disruptivo de um `hello`. O solicitante recebe configs atualizadas + relatório.
      await refreshLocalAgents(); broadcastMachines();
      send(ws, { t: "voice_cfg", cfg: { ...voiceCfg } });
      send(ws, { t: "summary_cfg", cfg: summaryCfg, agents: await agents.describe() });
      send(ws, { t: "models_synced", changes, agents: catalog, default: agents.default });
      return;
    }
    if (msg.t === "execution_cfg") { if (!requireOwner(ws)) return; send(ws, { t: "execution_cfg", cfg: executionCfg, restartFields: ["enabled", "retentionDays", "maxEvents", "worktreeRoot"] }); return; }
    if (msg.t === "set_execution_cfg") {
      if (!requireOwner(ws)) return;
      const integer = (value: unknown, min: number, max: number, label: string): number => {
        const n = Number(value); if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label} deve ficar entre ${min} e ${max}`); return n;
      };
      if (typeof msg.worktreeRoot !== "string" || !msg.worktreeRoot.trim() || msg.worktreeRoot.length > 1_000) throw new Error("raiz de worktrees inválida");
      const next: ExecutionRuntimeConfig = { enabled: msg.enabled !== false,
        retentionDays: integer(msg.retentionDays, 1, 3650, "retenção"), maxEvents: integer(msg.maxEvents, 100, 100_000, "máximo de eventos"),
        maxConcurrency: integer(msg.maxConcurrency, 1, 32, "concorrência"), maxDepth: integer(msg.maxDepth, 1, 10, "profundidade"),
        defaultWrite: msg.defaultWrite === true, worktreeRoot: msg.worktreeRoot.trim() };
      const restartFields = (["enabled", "retentionDays", "maxEvents", "worktreeRoot"] as const).filter((key) => executionCfg[key] !== next[key]);
      Object.assign(executionCfg, next); saveExecutionCfg();
      send(ws, { t: "execution_cfg", cfg: executionCfg, saved: true, restartRequired: restartFields.length > 0, restartFields }); return;
    }
    // Framework Jarvis — canonical universal commands/skills/instructions, published to every machine.
    if (msg.t === "framework_cfg") {
      if (!requireOwner(ws)) return;
      const manifest = currentFrameworkManifest();
      send(ws, { t: "framework_cfg", preference: frameworkCfg.preference, version: frameworkCfg.version, autoStartFlows: frameworkCfg.autoStartFlows, applyInstructions: frameworkCfg.applyInstructions, root: frameworkRoot(),
        files: manifest.files.map((f) => ({ path: f.path })),
        machines: allowedRunnerIds(ws).map((id) => ({ runnerId: id, label: id === LOCAL_ID ? (runnerLabels[LOCAL_ID] || "esta máquina") : (runnerLabels[id] || runners.get(id)?.info.host || id),
          local: id === LOCAL_ID, online: id === LOCAL_ID || !!runners.get(id)?.ws, protocolVersion: runners.get(id)?.info.protocolVersion || (id === LOCAL_ID ? RUNNER_PROTOCOL_VERSION : 1), queued: !!pendingFrameworkPublish[id] })) });
      return;
    }
    if (msg.t === "set_framework_cfg") {
      if (!requireOwner(ws)) return;
      // Mesma regra do `autoStartFlows` logo abaixo, e pelo mesmo motivo: `normalizeFrameworkPreference`
      // devolve "ask" para qualquer coisa que não reconheça, então um payload que só quer mexer no
      // início automático rebaixava a preferência do dono em silêncio.
      if (typeof msg.preference === "string") frameworkCfg.preference = normalizeFrameworkPreference(msg.preference);
      // Só muda quando o cliente mandou o campo: um payload antigo (ou parcial) não pode religar
      // silenciosamente um início automático que o dono desligou de propósito.
      if (typeof msg.autoStartFlows === "boolean") frameworkCfg.autoStartFlows = msg.autoStartFlows;
      if (typeof msg.applyInstructions === "boolean") frameworkCfg.applyInstructions = msg.applyInstructions;
      saveFrameworkCfg();
      send(ws, { t: "framework_cfg", preference: frameworkCfg.preference, version: frameworkCfg.version, autoStartFlows: frameworkCfg.autoStartFlows, applyInstructions: frameworkCfg.applyInstructions, saved: true });
      return;
    }
    if (msg.t === "framework_read") {
      if (!requireOwner(ws)) return;
      const f = currentFrameworkManifest().files.find((x) => x.path === String(msg.path || ""));
      send(ws, { t: "framework_file", path: String(msg.path || ""), content: f ? f.content : "", exists: !!f });
      return;
    }
    if (msg.t === "framework_save") {
      if (!requireOwner(ws)) return;
      try { const path = writeFrameworkFile(String(msg.path || ""), String(msg.content ?? "")); send(ws, { t: "framework_saved", path, ok: true }); }
      catch (e: any) { send(ws, { t: "framework_saved", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    if (msg.t === "framework_delete") {
      if (!requireOwner(ws)) return;
      try { deleteFrameworkFile(String(msg.path || "")); send(ws, { t: "framework_saved", path: String(msg.path || ""), ok: true, deleted: true }); }
      catch (e: any) { send(ws, { t: "framework_saved", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Remove uma PASTA inteira do framework (uma skill com seus arquivos, um namespace de comandos).
    // Mesmo limite de segurança do arquivo; publique depois para propagar a remoção às máquinas.
    if (msg.t === "framework_delete_folder") {
      if (!requireOwner(ws)) return;
      const path = String(msg.path || "");
      try { const r = deleteFrameworkFolder(path); send(ws, { t: "framework_saved", path, ok: true, deleted: true, folder: true, removed: r.removed }); }
      catch (e: any) { send(ws, { t: "framework_saved", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    if (msg.t === "framework_import") {
      if (!requireOwner(ws)) return;
      try { const r = importFrameworkFromNative({}); send(ws, { t: "framework_imported", ok: true, imported: r.imported, skipped: r.skipped }); }
      catch (e: any) { send(ws, { t: "framework_imported", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // LIMPAR o framework inteiro. Existe porque a única forma de zerar era remover pasta por pasta, e
    // "limpo, reimporto o nativo, reimporto o framework" é um ciclo legítimo — quando o conteúdo veio
    // de fontes que mudaram de forma, mesclar por cima acumula lixo. Não publica: some desta máquina, e
    // as outras só perdem o conteúdo quando você publicar de propósito. As FONTES também são zeradas,
    // senão o registro apontaria para arquivos que não existem mais.
    if (msg.t === "framework_reset") {
      if (!requireOwner(ws)) return;
      try {
        const before = readCanonicalFramework(frameworkRoot()).files.length;
        const removed: string[] = [];
        for (const top of ["commands", "skills", "flows", "reference"]) {
          try { removed.push(...deleteFrameworkFolder(top).removed); } catch { /* pasta não existe: nada a remover */ }
        }
        try { rmSync(join(frameworkRoot(), "instructions.md"), { force: true }); removed.push("instructions.md"); } catch { /* idem */ }
        for (const s of frameworkSources.list()) frameworkSources.remove(s.id);
        frameworkUpdateAlerts = [];
        log.warn("framework_reset", { before, removed: removed.length });
        send(ws, { t: "framework_reset", ok: true, removed: removed.length, before });
      } catch (e: any) { send(ws, { t: "framework_reset", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Importar de uma PASTA da máquina. Mesmo caminho do zip a partir da extração (projeção, promoção,
    // limites, varredura, prévia) — a pasta só substitui a origem dos bytes. É o que permite reimportar
    // um framework que vive local, e importar UM perfil por vez de um repositório com vários pacotes.
    if (msg.t === "framework_import_dir" && typeof msg.path === "string") {
      if (!requireOwner(ws)) return;
      try {
        const dir = String(msg.path).trim();
        if (!dir) throw new Error("informe o caminho da pasta");
        const read = readPackDir(dir);
        const { files, skipped, outOfScope, outOfScopeSample, manifest, mapped, excluded } = extractFrameworkFiles(read.entries);
        const allSkipped = [...read.skipped, ...skipped];
        if (outOfScope) allSkipped.push(`${outOfScope} arquivo(s) fora do escopo do framework (esperado skills/, commands/, flows/, reference/ ou instructions.md): ${outOfScopeSample.join(", ")}${outOfScope > outOfScopeSample.length ? ", …" : ""}`);
        if (!files.length) throw new Error(`nenhum arquivo de framework encontrado em ${dir} (esperado commands/…, skills/… ou instructions.md, ou um jarvis.pack.json com projeção)`);
        const current = readCanonicalFramework(frameworkRoot()).files;
        const preview = buildImportPreview(files, allSkipped, current, manifest, { mapped, excluded });
        sweepPendingImports();
        const token = randomUUID();
        const label = manifest?.title || packDirLabel(dir);
        const id = manifest ? `pack:${manifest.name}` : `dir:${dir.replace(/\\/g, "/").toLowerCase()}`;
        const isUpdate = !!frameworkSources.get(id);
        pendingFrameworkImports.set(token, { files: preview.files, hash: preview.hash, scanBlocked: preview.scan.blocked, manifest, source: { type: "zip", name: label, id }, createdAt: Date.now() });
        send(ws, { t: "framework_import_preview", ok: true, token, isUpdate, source: { type: "dir", name: label, path: dir }, preview: previewPayload(preview) });
      } catch (e: any) { send(ws, { t: "framework_import_preview", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    if (msg.t === "framework_seed") {
      if (!requireOwner(ws)) return;
      try { const r = installFrameworkStarterPack(); send(ws, { t: "framework_seeded", ok: true, imported: r.imported, skipped: r.skipped }); }
      catch (e: any) { send(ws, { t: "framework_seeded", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Stage the bundled starter pack as a preview (scan + per-file diff) instead of writing it directly —
    // the owner inspects, can exclude items, and confirms via framework_import_apply.
    if (msg.t === "framework_seed_preview") {
      if (!requireOwner(ws)) return;
      try {
        const files = starterFrameworkFiles();
        const current = readCanonicalFramework(frameworkRoot()).files;
        const preview = buildImportPreview(files, [], current);
        sweepPendingImports();
        const token = randomUUID();
        pendingFrameworkImports.set(token, { files: preview.files, hash: preview.hash, scanBlocked: preview.scan.blocked, source: { type: "starter" }, createdAt: Date.now() });
        send(ws, { t: "framework_import_preview", ok: true, token, isUpdate: false, source: { type: "starter" }, preview: previewPayload(preview) });
      } catch (e: any) { send(ws, { t: "framework_import_preview", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Stage "import from this machine" (native CLAUDE.md/AGENTS.md/GEMINI.md → instructions.md) as a
    // preview so the owner sees exactly what would be written and can diff against the current file.
    if (msg.t === "framework_import_native_preview") {
      if (!requireOwner(ws)) return;
      try {
        const files = collectNativeFrameworkFiles({});
        if (!files.length) throw new Error("nenhuma instrução nativa encontrada nesta máquina (CLAUDE.md / AGENTS.md / GEMINI.md)");
        const current = readCanonicalFramework(frameworkRoot()).files;
        const preview = buildImportPreview(files, [], current);
        sweepPendingImports();
        const token = randomUUID();
        pendingFrameworkImports.set(token, { files: preview.files, hash: preview.hash, scanBlocked: preview.scan.blocked, source: { type: "native" }, createdAt: Date.now() });
        send(ws, { t: "framework_import_preview", ok: true, token, isUpdate: false, source: { type: "native" }, preview: previewPayload(preview) });
      } catch (e: any) { send(ws, { t: "framework_import_preview", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Catalog of this machine's INSTALLED native skills/commands across every AI provider, so the owner
    // can import them into the universal framework (then served under every AI's "/"). Metadata only.
    if (msg.t === "framework_native_catalog") {
      if (!requireOwner(ws)) return;
      try {
        const entries = listNativeCatalog();
        const tracked = new Set(frameworkSources.list().filter((s) => s.type === "native" && s.entryId).map((s) => s.entryId));
        send(ws, { t: "framework_native_catalog", ok: true, entries: entries.map((e) => ({ ...e, tracked: tracked.has(e.id) })) });
      } catch (e: any) { send(ws, { t: "framework_native_catalog", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Stage the chosen native skills/commands as a preview (scan + per-file diff). On apply each becomes
    // a tracked `native` source (autoUpdate) so the daily job can flag drift and re-sync (with confirm).
    if (msg.t === "framework_import_native_skill_preview") {
      if (!requireOwner(ws)) return;
      try {
        const ids = Array.isArray(msg.ids) ? (msg.ids as unknown[]).map((x) => String(x)).filter(Boolean) : [];
        if (!ids.length) throw new Error("nenhuma skill/comando selecionado");
        const { entries, missing } = collectNativeCatalogFiles(ids);
        if (!entries.length) throw new Error("as skills selecionadas não puderam ser lidas" + (missing.length ? ` (${missing.length} indisponível(is))` : ""));
        const files = entries.flatMap((e) => e.files);
        const current = readCanonicalFramework(frameworkRoot()).files;
        const preview = buildImportPreview(files, missing.map((m) => `${m} (indisponível)`), current);
        sweepPendingImports();
        const token = randomUUID();
        const nativeEntries = entries.map((e) => ({ entryId: e.id, provider: e.provider, kind: e.kind, name: e.name, hash: e.hash, paths: e.files.map((f) => f.path) }));
        pendingFrameworkImports.set(token, { files: preview.files, hash: preview.hash, scanBlocked: preview.scan.blocked, source: { type: "native", nativeEntries }, createdAt: Date.now() });
        // Reimportar algo já rastreado é ATUALIZAR: a prévia abre em "sobrescrever" (substituir a versão
        // antiga) e os arquivos que diferem aparecem como duplicados, com o botão de ver as diferenças —
        // a decisão continua sua, mas o padrão deixa de ser "mesclar e manter o antigo".
        const isUpdate = entries.some((e) => !!frameworkSources.get(nativeSourceId(e.id)));
        send(ws, { t: "framework_import_preview", ok: true, token, isUpdate, source: { type: "native", count: entries.length }, preview: previewPayload(preview) });
      } catch (e: any) { send(ws, { t: "framework_import_preview", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // ── Fluxos de trabalho (F1): propor a estrutura a partir de uma skill, revisar e salvar.
    // A definição vive em flows/<id>.json DENTRO do framework, então publica junto e o
    // acompanhamento fica igual em todas as máquinas.
    if (msg.t === "workflow_list") {
      if (!requireOwner(ws)) return;
      try {
        const files = readCanonicalFramework(frameworkRoot()).files;
        // Origem: por metadado. Um fluxo é atribuído ao pacote que trouxe o PRÓPRIO arquivo do fluxo;
        // se ele foi montado aqui a partir de uma skill importada, herda o pacote da skill de origem.
        // Sem nenhum dos dois é local — feito à mão nesta máquina.
        const packs = buildPackIndex(frameworkSources.list());
        // `via` diz COMO a origem foi estabelecida, e é o que separa os dois selos na interface:
        //   flow  → o arquivo do fluxo veio no pacote (declarado, autoritativo);
        //   skill → o fluxo foi montado aqui a partir de uma skill daquele pacote (derivado);
        //   null  → feito à mão nesta máquina.
        const packOf = (flowPath: string, skillPath?: string): { pack: PackRef | null; via: "flow" | "skill" | null } => {
          if (packs[flowPath]) return { pack: packs[flowPath], via: "flow" };
          if (skillPath && packs[skillPath]) return { pack: packs[skillPath], via: "skill" };
          return { pack: null, via: null };
        };
        const defs = dedupeWorkflowsById(files.filter((f) => f.path.startsWith("flows/"))
          .map((f) => { const def = workflowFromFile(f.content); return def ? { ...def, path: f.path, ...packOf(f.path, def.source.path) } : null; })
          .filter(Boolean) as Array<{ id: string } & Record<string, unknown>>);
        // Skills que ainda não viraram fluxo — candidatas a detectar.
        const have = new Set(defs.map((d) => d!.id));
        const candidates = files.filter((f) => f.path.startsWith("skills/") && f.path.endsWith("/SKILL.md"))
          .map((f) => ({ path: f.path, def: parseWorkflowFromSkill(f.content, { path: f.path }) }))
          .filter((c) => c.def.steps.length >= 2 && !have.has(c.def.id))
          .map((c) => ({ path: c.path, id: c.def.id, name: c.def.name, steps: c.def.steps.length, pack: packs[c.path] ?? null }));
        // Quem começa sozinho é decisão do Hub (o pacote declara `autoStart`; empate resolve pelo menor
        // id) somada à chave do dono. Vai no MESMO frame da lista porque a interface tem de mostrar
        // isso onde o fluxo é escolhido — um cliente que reimplementasse a regra marcaria "padrão" no
        // fluxo errado, e um auto-início invisível é um fluxo que entra em todo turno sem ninguém pedir.
        send(ws, { t: "workflow_list", ok: true, workflows: defs, candidates, autoStartFlows: frameworkCfg.autoStartFlows, autoStartId: defaultWorkflowDefinition()?.id ?? null });
      } catch (e: any) { send(ws, { t: "workflow_list", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // F2 — iniciar o acompanhamento de um fluxo numa TAREFA (referência agnóstica de rastreador).
    if (msg.t === "workflow_run_start" && typeof msg.workflowId === "string") {
      if (!requireOwner(ws)) return;
      try {
        const def = loadWorkflowDefinitions().find((d) => d!.id === msg.workflowId);
        if (!def) throw new Error("fluxo não encontrado (publique/salve o fluxo primeiro)");
        let task = normalizeTaskRef(msg.task);
        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
        // F1 — tarefa de verdade: aceita texto COLADO (chave "PRI-824", URL de Jira/GitHub/Linear) e
        // completa o rastreador pelo vínculo da pasta; título/descrição/link conhecidos entram no
        // cache — é o que alimenta a UI e o botão Resumir sem rede.
        // A pasta é a da MÁQUINA da sessão: com o cwd do Hub, uma chave nua colada numa sessão remota
        // herdaria o rastreador de OUTRO projeto — a mesma ambiguidade que a fonte declarada mata.
        const projectCwd = sessionProjectDir(activeRunner(ws), sessionId);
        if (!task.key && typeof msg.taskInput === "string") task = parseTaskInput(msg.taskInput, { defaultTracker: projectTasks.get(projectCwd)?.tracker }) || task;
        else if (task.key && !task.tracker) task = { ...task, tracker: projectTasks.get(projectCwd)?.tracker || "" };
        const pastedMeta = (msg.taskMeta && typeof msg.taskMeta === "object" ? msg.taskMeta : {}) as Record<string, unknown>;
        if (task.key) taskMeta.merge(task.tracker, task.key, { title: task.title || String(pastedMeta.title || ""), description: String(pastedMeta.description || ""), url: task.url || String(pastedMeta.url || "") });
        // Ponto de entrada opcional: o seletor do composer manda o passo escolhido ("quero TDD").
        const startAtStepId = typeof msg.stepId === "string" && msg.stepId ? msg.stepId : undefined;
        const existing = task.key ? workflowRuns.forTask(task.tracker, task.key) : undefined;
        if (existing) {                                   // mesma tarefa já acompanhada: apenas liga a sessão
          let linked = linkSession(existing, sessionId, Date.now());
          // Reusar o acompanhamento não pode ignorar o passo que a pessoa acabou de escolher.
          if (startAtStepId) linked = focusStep(linked, startAtStepId, { now: Date.now() });
          workflowRuns.put(linked);
          send(ws, { t: "workflow_run", sessionId, run: workflowRunPayload(linked), reused: true });
        } else {
          const run = createRun(def, task, { runId: "wfr-" + randomUUID(), now: Date.now(), sessionId, startAtStepId });
          workflowRuns.put(run);
          send(ws, { t: "workflow_run", sessionId, run: workflowRunPayload(run) });
        }
        // A tarefa recém-iniciada vira o FOCO da sessão (multi-tarefa): é dela que os turnos falam.
        const startedRun = task.key ? workflowRuns.forTask(task.tracker, task.key) : workflowRuns.forSession(sessionId);
        if (sessionId && startedRun) workflowRuns.setFocus(sessionId, startedRun.runId);
        broadcastWorkflowRuns(sessionId);
      } catch (e: any) { send(ws, { t: "error", message: "Fluxo: " + String(e?.message ?? e) }); }
      return;
    }
    // Estado atual: todos os runs (painel) e o da sessão aberta.
    if (msg.t === "workflow_runs") {
      if (!requireOwner(ws)) return;
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
      send(ws, { t: "workflow_runs", runs: workflowRuns.list().slice(0, 50).map(workflowRunPayload) });
      if (sessionId) { const run = workflowRuns.focusedFor(sessionId); send(ws, { t: "workflow_run", sessionId, run: run ? workflowRunPayload(run) : null }); }
      return;
    }
    // Multi-tarefa (F3): a sessão troca a tarefa em FOCO — o steering e o chip passam a falar dela.
    if (msg.t === "workflow_run_focus" && typeof msg.runId === "string" && typeof msg.sessionId === "string") {
      if (!requireOwner(ws)) return;
      const target = workflowRuns.get(msg.runId);
      if (!target || target.status !== "active") { send(ws, { t: "error", message: "Fluxo: acompanhamento não está ativo" }); return; }
      // Focar uma tarefa que ainda não passou por esta sessão também a VINCULA — focar é participar.
      if (!target.sessions.includes(msg.sessionId)) workflowRuns.put(linkSession(target, msg.sessionId, Date.now()));
      workflowRuns.setFocus(msg.sessionId, msg.runId);
      const run = workflowRuns.focusedFor(msg.sessionId);
      send(ws, { t: "workflow_run", sessionId: msg.sessionId, run: run ? workflowRunPayload(run) : null });
      broadcastWorkflowRuns(msg.sessionId);
      return;
    }
    // F3/F5 — marcar, avançar, pular (com o pulo REGISTRADO) e anexar evidência. Gates só sinalizam.
    if (msg.t === "workflow_run_update" && typeof msg.runId === "string") {
      if (!requireOwner(ws)) return;
      try {
        const run = workflowRuns.get(msg.runId);
        if (!run) throw new Error("acompanhamento não encontrado");
        const now = Date.now();
        const by: MarkedBy = msg.by === "ai" ? "ai" : msg.by === "signal" ? "signal" : "user";
        let next = run;
        const op = String(msg.op || "");
        if (op === "mark") next = markStep(run, String(msg.stepId || ""), (["pending", "done", "skipped"].includes(msg.state) ? msg.state : "done") as RunStepState, { by, now });
        else if (op === "advance") next = advanceRun(run, { by, now });
        else if (op === "jump") next = jumpToStep(run, String(msg.stepId || ""), { by, now });
        else if (op === "focus") next = focusStep(run, String(msg.stepId || ""), { now });
        else if (op === "evidence") next = attachEvidence(run, String(msg.stepId || ""), { kind: msg.kind === "link" ? "link" : "text", value: String(msg.value || "") }, { by, now });
        // Trocar a tarefa DO FLUXO EM ANDAMENTO. Aceita o mesmo texto colado do início ("PRI-824", URL)
        // e completa o rastreador pelo vínculo da PASTA DA SESSÃO — chave nua resolvida pelo cwd do Hub
        // herdaria o rastreador de outro projeto.
        else if (op === "task") {
          const sessionForTask = typeof msg.sessionId === "string" ? msg.sessionId : (run.sessions[0] || "");
          const projectCwd = sessionProjectDir(activeRunner(ws), sessionForTask);
          let task = normalizeTaskRef(msg.task);
          if (!task.key && typeof msg.taskInput === "string") task = parseTaskInput(msg.taskInput, { defaultTracker: projectTasks.get(projectCwd)?.tracker }) || task;
          else if (task.key && !task.tracker) task = { ...task, tracker: projectTasks.get(projectCwd)?.tracker || "" };
          if (!task.key && !task.title) throw new Error("não reconheci essa tarefa — cole a chave (PRI-824) ou a URL, ou escolha uma da lista");
          // Dois acompanhamentos do MESMO ticket é o que `forTask` impede no início; deixar a troca
          // fazer isso seria a porta dos fundos para o mesmo estado incoerente.
          const outro = task.key ? workflowRuns.forTask(task.tracker, task.key) : undefined;
          if (outro && outro.runId !== run.runId) throw new Error(`essa tarefa já é acompanhada por “${outro.workflowName}” — encerre aquele fluxo ou escolha outra tarefa`);
          const pastedMeta = (msg.taskMeta && typeof msg.taskMeta === "object" ? msg.taskMeta : {}) as Record<string, unknown>;
          if (task.key) taskMeta.merge(task.tracker, task.key, { title: task.title || String(pastedMeta.title || ""), description: String(pastedMeta.description || ""), url: task.url || String(pastedMeta.url || "") });
          next = setRunTask(run, task, { now });
        }
        else if (op === "finish") next = { ...run, status: "done", updatedAt: now };
        else if (op === "abandon") next = { ...run, status: "abandoned", updatedAt: now };
        else throw new Error("operação desconhecida");
        workflowRuns.put(next);
        // Encerrar/abandonar não pode deixar sessões olhando para um run morto (multi-tarefa).
        if (op === "finish" || op === "abandon") workflowRuns.clearFocusOfRun(next.runId);
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : (next.sessions[0] || "");
        send(ws, { t: "workflow_run", sessionId: sid, run: workflowRunPayload(next) });
        broadcastWorkflowRuns(sid);
      } catch (e: any) { send(ws, { t: "error", message: "Fluxo: " + String(e?.message ?? e) }); }
      return;
    }
    // Proposta a partir de uma skill: o Jarvis sugere os passos; NADA é salvo até você confirmar.
    if (msg.t === "workflow_detect" && typeof msg.path === "string") {
      if (!requireOwner(ws)) return;
      try {
        const path = String(msg.path);
        const file = readCanonicalFramework(frameworkRoot()).files.find((f) => f.path === path);
        if (!file) throw new Error("skill não encontrada no framework");
        const def = parseWorkflowFromSkill(file.content, { path });
        send(ws, { t: "workflow_detected", ok: true, path, definition: def, detected: def.steps.length });
      } catch (e: any) { send(ws, { t: "workflow_detected", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Salvar o fluxo confirmado/editado pelo humano.
    if (msg.t === "workflow_save") {
      if (!requireOwner(ws)) return;
      try {
        const def = normalizeWorkflowDefinition(msg.definition, "fluxo");
        if (!def.steps.length) throw new Error("um fluxo precisa de ao menos um passo");
        const file = workflowToFile(def);
        writeFrameworkFile(file.path, file.content);
        send(ws, { t: "workflow_saved", ok: true, id: def.id, path: file.path, steps: def.steps.length });
      } catch (e: any) { send(ws, { t: "workflow_saved", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // ── Fluxo por tarefa (F1/F2): vínculo por pasta, arquivos locais de feature e meta da tarefa ──
    // O vínculo diz de onde vêm as tarefas DESTE projeto (jira/github/linear/local/nada) e fica
    // lembrado por diretório — projetos diferentes usam fontes diferentes sem reconfigurar nada.
    if (msg.t === "task_binding_get" && typeof msg.sessionId === "string") {
      if (!requireOwner(ws)) return;
      const { cwd, binding, source } = sessionTaskSource(activeRunner(ws), msg.sessionId);
      send(ws, { t: "task_binding", sessionId: msg.sessionId, cwd, binding: binding || null, source });
      return;
    }
    // TSK-12 — configurar a allowlist de MCP de UMA máquina pela tela. O Hub não escreve o arquivo de
    // ninguém: ele encaminha a intenção para a máquina dona, que valida e grava. Guardas antes de
    // encaminhar, porque recusa clara vale mais do que silêncio de frame perdido.
    if ((msg.t === "task_mcp_config" || msg.t === "task_mcp_config_set" || msg.t === "task_mcp_test") && typeof msg.runnerId === "string") {
      if (!requireOwner(ws)) return;
      const alvo = msg.runnerId as string, op = msg.t as string;
      const recusa = (error: string): void => send(ws, { t: op, runnerId: alvo, ok: false, error, servers: [], configFile: "", schemaVersion: 0 });
      if (alvo === LOCAL_ID) {
        // A máquina do Hub responde em processo: mesmo código, sem passar pela rede.
        try {
          if (op === "task_mcp_config") { const cfg = loadTaskMcpConfig(); send(ws, { t: op, runnerId: alvo, configFile: taskMcpConfigFile(), schemaVersion: TASK_MCP_SCHEMA_VERSION, servers: describeTaskMcpServers(cfg), error: cfg.error }); return; }
          if (op === "task_mcp_config_set") {
            const nome = String(msg.name || "");
            const atual = loadTaskMcpConfig(); const servers = { ...atual.servers };
            if (msg.remove === true) { if (!servers[nome]) { recusa(`esta máquina não tem servidor chamado "${nome}"`); return; } delete servers[nome]; }
            else { const v = validateTaskMcpServerInput(nome, msg.server); if (!v.ok) { recusa(v.error); return; } servers[v.name] = v.server; }
            writeTaskMcpConfig(servers);
            auth.audit("task_mcp_config", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${msg.remove === true ? "remove" : "set"} ${nome}` });
            send(ws, { t: op, runnerId: alvo, ok: true }); broadcastTaskConnections(); return;
          }
          const listing = await listTasksFromMcp({ wanted: String(msg.name || ""), refresh: true });
          if ("error" in listing) { recusa(listing.error); return; }
          send(ws, { t: op, runnerId: alvo, ok: true, count: listing.files.length, sample: listing.files.slice(0, 3).map((f) => f.title) }); return;
        } catch (e: any) { recusa(String(e?.message ?? e)); return; }
      }
      const rc = runners.get(alvo);
      if (!rc) { recusa("não conheço essa máquina"); return; }
      // Protocolo ANTES de conexão, de propósito: máquina em quarentena de atualização fica com
      // `ws: null` aqui, e dizer "offline" para quem está conectado esperando update manda a pessoa
      // procurar o problema no lugar errado.
      if ((rc.info.protocolVersion || 1) < RUNNER_CAPABILITY_SINCE.taskMcpConfig) { recusa("esta máquina ainda não sabe ser configurada daqui — atualize-a"); return; }
      if (!rc.ws) { recusa("máquina offline — a configuração dela é gravada por ela mesma"); return; }
      if (op !== "task_mcp_config" && rc.info.taskMcpRemoteEdit === false) { recusa("edição remota desligada nesta máquina (JARVIS_TASK_MCP_REMOTE_EDIT=0)"); return; }
      if (op === "task_mcp_config_set") auth.audit("task_mcp_config", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: alvo, detail: `${msg.remove === true ? "remove" : "set"} ${String(msg.name || "")}` });
      const reqId = registerPendingRequest({ ws, runnerId: alvo, operation: op });
      if (!sendToRunner(rc, { t: op, reqId, name: String(msg.name || ""), server: msg.server, remove: msg.remove === true })) recusa("não consegui falar com essa máquina");
      return;
    }
    if (msg.t === "task_binding_set" && typeof msg.sessionId === "string" && typeof msg.tracker === "string") {
      if (!requireOwner(ws)) return;
      try {
        // O vínculo é DO PROJETO, e o projeto vive na máquina da sessão: gravar pela pasta do Hub
        // declararia a fonte de outro projeto (e escrita vai para board errado a partir daí).
        const taskRunnerId = activeRunner(ws);
        const cwd = sessionProjectDir(taskRunnerId, msg.sessionId);
        if (!cwd) { send(ws, { t: "error", message: "Vínculo de tarefas: ainda não sei em que pasta esta sessão está na máquina dela — abra a sessão nela primeiro" }); return; }
        const binding = projectTasks.set(cwd, {
          tracker: msg.tracker,
          featuresDir: typeof msg.featuresDir === "string" ? msg.featuresDir : undefined,
          mcpServer: typeof msg.mcpServer === "string" ? msg.mcpServer : undefined,
          connectionId: typeof msg.connectionId === "string" ? msg.connectionId : undefined,
          allowed: Array.isArray(msg.allowed) ? msg.allowed.map(String) : undefined,
          target: typeof msg.target === "string" ? msg.target : undefined,
          autoApprove: Array.isArray(msg.autoApprove) ? msg.autoApprove.map(String) : undefined,
        });
        auth.audit("task_binding", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: taskRunnerId, detail: `${cwd}: ${binding.tracker || "nenhuma"}${binding.connectionId ? ` · ${binding.connectionId}` : ""}` });
        // A decisão de fonte volta JUNTO: é ela que faz a lista mudar na hora, sem restart e sem o
        // cliente reimplementar a regra (uma fonte só, e o motivo quando ela não pode servir).
        send(ws, { t: "task_binding", sessionId: msg.sessionId, cwd, binding, source: resolveTaskSource({ projectDir: cwd, binding, connections: taskConnections.list() }) });
        // F: a tela de Configurações lista os vínculos — mudar a fonte aqui tem que aparecer lá.
        broadcastTaskConnections();
      } catch (e: any) { send(ws, { t: "error", message: "Vínculo de tarefas: " + String(e?.message ?? e) }); }
      return;
    }
    // Arquivos locais de feature (`docs/features/*.md` por padrão): a tarefa de quem não usa
    // gerenciador. Lista rasa e limitada; caminho preso dentro do projeto.
    if (msg.t === "task_local_list" && typeof msg.sessionId === "string") {
      if (!requireOwner(ws)) return;
      // A pasta de features vive no disco da MÁQUINA DO PROJETO. Varrer o disco do Hub para uma
      // sessão remota devolvia, em silêncio, as features de outro projeto — pior que erro: resposta
      // plausível e errada. Fora do local, ou a máquina responde, ou o pedido é recusado.
      const taskRunnerId = activeRunner(ws);
      const refuse = (error: string, code?: string): void => send(ws, { t: "task_local_list", runnerId: taskRunnerId, sessionId: msg.sessionId, dir: "", files: [], cached: false, scannedAt: Date.now(), error, ...(code ? { code } : {}) });
      // D — fonte ÚNICA declarada: arquivos de feature só respondem em projeto que DECLARA a pasta
      // como sua fonte. Sem isso, um projeto de Jira listava .md do disco junto: duas fontes na
      // mesma lista, e ninguém sabe de onde a tarefa veio. Sem fonte declarada também não há default
      // silencioso — a recusa diz o que fazer.
      const { cwd, source } = sessionTaskSource(taskRunnerId, msg.sessionId);
      if (source.kind === "mcp") {
        // Fonte MCP: quem executa é a máquina do projeto — o Hub só encaminha o NOME do servidor.
        // Para uma sessão local, a máquina do projeto é este Hub, então ele mesmo executa.
        if (taskRunnerId !== LOCAL_ID) {
          const rc = runners.get(taskRunnerId);
          if (!rc?.ws) { refuse("a máquina está offline — o servidor MCP de tarefas vive nela"); return; }
          if ((rc.info.protocolVersion || 1) < 11) { refuse("esta máquina está desatualizada e não sabe listar tarefas por MCP — atualize-a"); return; }
          const reqId = registerPendingRequest({ ws, runnerId: taskRunnerId, operation: "task_mcp_list", sessionIds: [msg.sessionId] });
          if (!sendToRunner(rc, { t: "task_mcp_list", reqId, sessionId: msg.sessionId, server: source.mcpServer, refresh: msg.refresh === true })) refuse("não foi possível falar com a máquina agora");
          return;
        }
        void (async () => {
          try {
            const listing = await listTasksFromMcp({ wanted: source.mcpServer, refresh: msg.refresh === true });
            if ("error" in listing) { refuse(listing.error); return; }
            send(ws, { t: "task_local_list", kind: "mcp", sessionId: msg.sessionId, dir: listing.label, files: listing.files, cached: listing.cached, scannedAt: listing.scannedAt });
          } catch (e: any) { refuse(String(e?.message ?? e).slice(0, 400)); }
        })();
        return;
      }
      if (source.kind !== "local" || !source.ready) { refuse(source.reason || "este projeto não usa arquivos de feature como fonte de tarefas", source.code); return; }
      if (taskRunnerId !== LOCAL_ID) {
        const rc = runners.get(taskRunnerId);
        if (!rc?.ws) { refuse("a máquina está offline — a lista de tarefas vive no disco dela"); return; }
        if ((rc.info.protocolVersion || 1) < 10) { refuse("esta máquina está desatualizada e não sabe listar as tarefas locais dela — atualize-a"); return; }
        const reqId = registerPendingRequest({ ws, runnerId: taskRunnerId, operation: "task_local_list", sessionIds: [msg.sessionId] });
        if (!sendToRunner(rc, { t: "task_local_list", reqId, sessionId: msg.sessionId, featuresDir: source.featuresDir, refresh: msg.refresh === true })) refuse("não foi possível falar com a máquina agora");
        return;
      }
      try {
        // Mesma função que o runner usa (`resolveFeaturesRoot`, no core): a contenção de caminho vem
        // ANTES de qualquer leitura, e existe UMA cópia dela — duas foi como o Hub ficou para trás.
        const { rel, root } = resolveFeaturesRoot(cwd, source.featuresDir);
        // Chave inclui a máquina: a mesma pasta relativa em outra máquina é OUTRO projeto. Aqui é o
        // caminho LOCAL (a máquina do projeto é este Hub); sessão remota já saiu pelo runner acima.
        const listing = localTaskCache.list(
          `${LOCAL_ID}\u0000${root}`,
          root,
          (content, relPath) => { const parsed = parseFeatureTask(content, relPath); return { key: parsed.task.key, title: parsed.title, description: parsed.description }; },
          localTaskFs,
          { refresh: msg.refresh === true, relPrefix: rel },
        );
        send(ws, { t: "task_local_list", sessionId: msg.sessionId, dir: rel, files: listing.files, cached: listing.cached, scannedAt: listing.scannedAt });
      } catch (e: any) { send(ws, { t: "error", message: "Tarefas locais: " + String(e?.message ?? e) }); }
      return;
    }
    // ── Fatia I: 1..N tarefas → 1..N subsessões ───────────────────────────────────────────────────
    // DOIS passos de propósito. Abrir N conversas é ação com efeito, e N pode vir de um palpite do
    // modelo: `task_fanout_plan` só DECIDE e devolve a lista (nada é criado), `task_fanout_open`
    // executa um plano que o Hub já emitiu. Num passo só, a confirmação do usuário seria decorativa.
    if (msg.t === "task_fanout_plan" && typeof msg.sessionId === "string") {
      if (!requireOwner(ws)) return;
      const refuse = (error: string): void => { send(ws, { t: "task_fanout_plan", sessionId: msg.sessionId, ok: false, tasks: [], error }); };
      // A recusa de máquina remota vem ANTES de decidir: interpretar primeiro e recusar na hora de
      // abrir cobraria uma chamada de modelo por um pedido que nunca poderia ser atendido.
      if (activeRunner(ws) !== LOCAL_ID) { refuse("abrir subsessões ainda só funciona em sessão desta máquina (o Hub)"); return; }
      // O modelo é chamado UMA vez, e só por dentro de resolveFanoutTasks: é a porta única que faz o
      // "zero chamadas com item marcado" ser uma propriedade do código, não uma promessa do comentário.
      const interpret = async (prompt: string): Promise<string> => {
        const a = summaryAgent();
        const opts = await compatibleAgentOpts(a, summaryCfg.model, summaryCfg.effort);
        const r = (a.oneShot ? await a.oneShot(prompt, opts) : await a.send("__taskfanout__", prompt, CWD, opts)) as { text?: string; usage?: any };
        addUsage(`__taskfanout__:${msg.sessionId}`, a.name, r.usage);
        return String(r?.text || "");
      };
      try {
        const res = await resolveFanoutTasks({ selected: msg.selected, phrase: typeof msg.phrase === "string" ? msg.phrase : undefined }, interpret);
        if (!res.ok) { send(ws, { t: "task_fanout_plan", sessionId: msg.sessionId, ok: false, tasks: [], question: res.question, error: res.reason, interpretedFrom: res.interpretedFrom }); return; }
        const planId = randomUUID();
        fanoutPlans.set(planId, { sessionId: msg.sessionId, runnerId: activeRunner(ws), res, at: Date.now() });
        pruneFanoutPlans();
        send(ws, { t: "task_fanout_plan", sessionId: msg.sessionId, ok: true, planId, origin: res.origin, tasks: res.tasks, interpretedFrom: res.interpretedFrom, confirm: fanoutConfirmText(res) });
      } catch (e: any) { refuse("Abrir subsessões: " + String(e?.message ?? e)); }
      return;
    }
    if (msg.t === "task_fanout_open" && typeof msg.planId === "string") {
      if (!requireOwner(ws)) return;
      const fail = (error: string): void => { send(ws, { t: "task_fanout_opened", ok: false, sessions: [], error }); };
      const plan = fanoutPlans.get(msg.planId);
      // Plano expirado NÃO é reinterpretado aqui: recriar a lista na hora de abrir devolveria uma
      // lista que ninguém confirmou. O usuário revê e confirma de novo.
      if (!plan || Date.now() - plan.at > FANOUT_PLAN_TTL_MS) { fanoutPlans.delete(msg.planId); fail("o plano expirou — confirme de novo quantas subsessões abrir"); return; }
      fanoutPlans.delete(msg.planId);   // um plano confirmado abre UMA vez (duplo clique não duplica sessão)
      const parent = store.get(plan.sessionId);
      // Só na máquina do Hub: a sessão de um runner remoto vive no disco DELE, e criar a filha aqui
      // colocaria a subsessão numa máquina que não é a do projeto — o engano que a fatia C tirou da
      // listagem. Recusa com motivo é melhor que abrir no lugar errado.
      if (plan.runnerId !== LOCAL_ID) { fail("abrir subsessões ainda só funciona em sessão desta máquina (o Hub)"); return; }
      if (!parent) { fail("a sessão de origem não existe mais"); return; }
      if (store.isHidden(plan.sessionId)) { fail("sessão interna não abre subsessões"); return; }
      const cwd = parent.cwd || CWD;
      const opened: Array<{ sessionId: string; title: string; tracker: string; key: string }> = [];
      for (const task of plan.res.tasks) {
        const id = randomUUID();
        // agent/cwd herdados da mãe: a subsessão é do MESMO projeto — deixar cair no default do Hub
        // abriria a conversa da tarefa noutra pasta, com outra IA, sem ninguém pedir.
        const child = store.ensure(id, { agent: parent.agent, cwd, title: task.title.slice(0, 60), parentSessionId: plan.sessionId });
        store.add(id, { role: "assistant", text: fanoutSeedMessage(task, plan.res.origin || "selection", parent.title), ts: Date.now(), agent: "jarvis" });
        opened.push({ sessionId: id, title: child.title, tracker: task.tracker, key: task.key });
      }
      // A mãe registra o que abriu. Sem isso, N conversas aparecem na lista e o histórico de quem as
      // pediu não tem nenhuma linha sobre elas. Vai por `broadcast` (e não só para quem pediu) porque
      // o recado é da CONVERSA: quem estiver com ela aberta noutro aparelho precisa ver na hora.
      if (opened.length) {
        const at = Date.now();
        const text = fanoutParentMessage(plan.res, opened);
        store.add(plan.sessionId, { role: "assistant", text, ts: at, agent: "jarvis" });
        broadcast(plan.sessionId, { t: "message", message: { sessionId: plan.sessionId, role: "assistant", text, ts: at, agent: "jarvis" } });
      }
      auth.audit("task_fanout", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${plan.sessionId}: ${opened.length} subsessão(ões) · ${plan.res.origin}` });
      pushSessions();
      send(ws, { t: "task_fanout_opened", ok: true, sessionId: plan.sessionId, runnerId: LOCAL_ID, origin: plan.res.origin, sessions: opened, interpretedFrom: plan.res.interpretedFrom });
      return;
    }
    if (msg.t === "task_meta_get" && typeof msg.tracker === "string" && typeof msg.key === "string") {
      if (!requireOwner(ws)) return;
      send(ws, { t: "task_meta", tracker: msg.tracker, key: msg.key, meta: taskMeta.get(msg.tracker, msg.key) || null });
      return;
    }
    // Resumir a tarefa para o dev (uma chamada ao agente de resumo; o resultado fica em cache).
    if (msg.t === "task_summarize" && typeof msg.tracker === "string" && typeof msg.key === "string") {
      if (!requireOwner(ws)) return;
      const known = taskMeta.get(msg.tracker, msg.key);
      const body = [known?.title, known?.description].filter(Boolean).join("\n\n");
      if (!body.trim()) { send(ws, { t: "error", message: "Resumir: a tarefa não tem descrição carregada" }); return; }
      try {
        const a = summaryAgent();
        const opts = await compatibleAgentOpts(a, summaryCfg.model, summaryCfg.effort);
        const prompt = `Resuma a tarefa a seguir para quem vai trabalhar nela agora: objetivo, critérios de aceite (explícitos ou implícitos) e riscos/armadilhas. No máximo 8 linhas, em português.\n\n${body.slice(0, 6000)}`;
        const r = (a.oneShot ? await a.oneShot(prompt, opts) : await a.send("__tasksum__", prompt, CWD, opts)) as { text?: string; usage?: any };
        addUsage(`__tasksum__:${msg.tracker}:${msg.key}`, a.name, r.usage);
        const summary = String(r?.text || "").trim();
        if (!summary) throw new Error("o agente de resumo não devolveu texto");
        const saved = taskMeta.merge(msg.tracker, msg.key, { summary });
        send(ws, { t: "task_meta", tracker: msg.tracker, key: msg.key, meta: saved || null });
      } catch (e: any) { send(ws, { t: "error", message: "Resumir: " + String(e?.message ?? e) }); }
      return;
    }
    // Cofre de SEGREDOS: grava o valor colado e injeta no env NA HORA (rotação sem restart). O valor
    // chega uma única vez neste frame e nunca volta em nenhum outro; em disco fica fora de git, com
    // chmod restrito. Se o mesmo nome existir no ambiente EXTERNO, o externo continua vencendo.
    if (msg.t === "secret_set" && typeof msg.name === "string" && typeof msg.value === "string") {
      if (!requireOwner(ws)) return;
      try {
        secretVault.set(msg.name, msg.value);
        // O env só é atualizado quando o valor atual NÃO veio de fora (ambiente externo sempre vence).
        const externallySet = process.env[msg.name] !== undefined && !vaultEnvOwned.has(msg.name);
        if (!externallySet) { process.env[msg.name] = msg.value; vaultEnvOwned.add(msg.name); }
        auth.audit("secret_set", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: msg.name });
        broadcastTaskConnections();
      } catch (e: any) { send(ws, { t: "error", message: "Segredo: " + String(e?.message ?? e) }); }
      return;
    }
    if (msg.t === "secret_delete" && typeof msg.name === "string") {
      if (!requireOwner(ws)) return;
      if (secretVault.remove(msg.name)) {
        if (vaultEnvOwned.delete(msg.name)) delete process.env[msg.name];   // nunca apaga env de fora
        auth.audit("secret_set", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `delete ${msg.name}` });
      }
      broadcastTaskConnections();
      return;
    }
    // F — gerenciar pela tela de Configurações, sem precisar abrir uma sessão naquela pasta. Só
    // mexe em projeto que JÁ TEM vínculo: a tela lista o que existe, não inventa caminho novo
    // (declarar fonte para uma pasta às cegas é como se cria vínculo para projeto que não existe).
    if (msg.t === "task_binding_project" && typeof msg.project === "string") {
      if (!requireOwner(ws)) return;
      const known = projectTasks.list().find((row) => row.project === projectKeyFor(msg.project, process.platform));
      if (!known) { send(ws, { t: "error", message: "Vínculo de tarefas: este projeto não está na lista" }); return; }
      try {
        if (msg.remove === true) {
          projectTasks.remove(known.project);
          auth.audit("task_binding", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${known.project}: removido` });
        } else if (typeof msg.tracker === "string") {
          const binding = projectTasks.set(known.project, {
            tracker: msg.tracker,
            featuresDir: typeof msg.featuresDir === "string" ? msg.featuresDir : known.binding.featuresDir,
            mcpServer: typeof msg.mcpServer === "string" ? msg.mcpServer : known.binding.mcpServer,
            connectionId: typeof msg.connectionId === "string" ? msg.connectionId : known.binding.connectionId,
            allowed: known.binding.allowed, target: known.binding.target, autoApprove: known.binding.autoApprove,
          });
          auth.audit("task_binding", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `${known.project}: ${binding.tracker || "nenhuma"}` });
        }
        broadcastTaskConnections();
      } catch (e: any) { send(ws, { t: "error", message: "Vínculo de tarefas: " + String(e?.message ?? e) }); }
      return;
    }
    // ── Cofre de conexões (C1) e operações de provedor (C4) ──────────────────────────────────────
    if (msg.t === "task_connections") {
      if (!requireOwner(ws)) return;
      send(ws, taskConnectionsFrame());
      return;
    }
    if (msg.t === "task_connection_save" && msg.connection && typeof msg.connection === "object") {
      if (!requireOwner(ws)) return;
      try {
        const c = msg.connection as Record<string, unknown>;
        const saved = taskConnections.save({
          id: typeof c.id === "string" ? c.id : undefined,
          provider: String(c.provider || ""), label: String(c.label || ""),
          config: (c.config && typeof c.config === "object" ? c.config : {}) as Record<string, string>,
          secretRef: String(c.secretRef || ""), secretRef2: typeof c.secretRef2 === "string" ? c.secretRef2 : undefined,
        });
        auth.audit("task_connection", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `save ${saved.id}` });
        broadcastTaskConnections();
      } catch (e: any) { send(ws, { t: "error", message: "Conexão: " + String(e?.message ?? e) }); }
      return;
    }
    if (msg.t === "task_connection_delete" && typeof msg.id === "string") {
      if (!requireOwner(ws)) return;
      if (taskConnections.remove(msg.id)) auth.audit("task_connection", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `delete ${msg.id}` });
      broadcastTaskConnections();
      return;
    }
    // Verificar = perguntar ao provedor QUEM é esta credencial e gravar a resposta (ou a falha).
    if (msg.t === "task_connection_verify" && typeof msg.id === "string") {
      if (!requireOwner(ws)) return;
      const conn = taskConnections.get(msg.id);
      if (!conn) { send(ws, { t: "error", message: "Conexão não encontrada" }); return; }
      const secret = process.env[conn.secretRef], secret2 = conn.secretRef2 ? process.env[conn.secretRef2] : undefined;
      if (!secret || (conn.secretRef2 && !secret2)) {
        taskConnections.recordVerification(conn.id, { error: `env var ${!secret ? conn.secretRef : conn.secretRef2} ausente no ambiente do Hub` });
        broadcastTaskConnections();
        return;
      }
      const t = providerSignal();
      try {
        const identity = await fetchProviderIdentity(conn.provider, { config: conn.config, secret, secret2, signal: t.signal });
        taskConnections.recordVerification(conn.id, { identity });
        auth.audit("task_connection", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `verify ${conn.id}: ${identity.login}` });
      } catch (e: any) {
        taskConnections.recordVerification(conn.id, { error: String(e?.message ?? e) });
      } finally { t.finish(); }
      broadcastTaskConnections();
      return;
    }
    // Busca no provedor do PROJETO (regra de ouro: sem vínculo → recusa acionável, nunca conta padrão).
    if (msg.t === "task_search" && typeof msg.sessionId === "string" && typeof msg.query === "string") {
      if (!requireOwner(ws)) return;
      const taskRunnerId = activeRunner(ws);
      // D — o outro lado do portão: projeto que declara pasta local não busca em provedor. Sem isto,
      // a mesma lista podia receber resultado de Jira num projeto cuja fonte é o disco.
      const { source } = sessionTaskSource(taskRunnerId, msg.sessionId);
      if (source.kind !== "provider" || !source.ready) {
        send(ws, { t: "task_search_results", sessionId: msg.sessionId, results: [], error: source.reason || "este projeto não usa provedor como fonte de tarefas", code: source.code });
        return;
      }
      const { resolved } = resolveSessionTaskConnection(msg.sessionId, false, taskRunnerId);
      if ("refusal" in resolved) { send(ws, { t: "task_search_results", sessionId: msg.sessionId, results: [], error: resolved.refusal.message, code: resolved.refusal.code }); return; }
      const t = providerSignal();
      try {
        const results = await searchProviderTasks(resolved.connection.provider, msg.query, { config: resolved.connection.config, secret: resolved.secret, secret2: resolved.secret2, signal: t.signal });
        send(ws, { t: "task_search_results", sessionId: msg.sessionId, results: results.slice(0, 10), connection: { id: resolved.connection.id, label: resolved.connection.label, identity: resolved.connection.identity || null } });
      } catch (e: any) { send(ws, { t: "task_search_results", sessionId: msg.sessionId, results: [], error: String(e?.message ?? e) }); }
      finally { t.finish(); }
      return;
    }
    // Carrega/atualiza UMA tarefa do provedor para o cache (alimenta a faixa e o Resumir).
    if (msg.t === "task_load" && typeof msg.sessionId === "string" && typeof msg.key === "string") {
      if (!requireOwner(ws)) return;
      const { resolved } = resolveSessionTaskConnection(msg.sessionId, false, activeRunner(ws));
      if ("refusal" in resolved) { send(ws, { t: "error", message: "Tarefa: " + resolved.refusal.message }); return; }
      const t = providerSignal();
      try {
        const item = await getProviderTask(resolved.connection.provider, msg.key, { config: resolved.connection.config, secret: resolved.secret, secret2: resolved.secret2, signal: t.signal });
        if (!item) { send(ws, { t: "error", message: `Tarefa ${msg.key} não encontrada em ${resolved.connection.label}` }); return; }
        const saved = taskMeta.merge(item.tracker, item.key, { title: item.title, description: item.description, url: item.url });
        send(ws, { t: "task_meta", tracker: item.tracker, key: item.key, meta: saved || null });
      } catch (e: any) { send(ws, { t: "error", message: "Tarefa: " + String(e?.message ?? e) }); }
      finally { t.finish(); }
      return;
    }
    // Escrita (C4): criar tarefa SEMPRE com identidade verificada + preview nominal. Aprovação pelo
    // painel adaptativo, a menos que o projeto tenha liberado a ação explicitamente (autoApprove).
    if (msg.t === "task_create" && typeof msg.sessionId === "string" && typeof msg.title === "string") {
      if (!requireOwner(ws)) return;
      const sessionId = msg.sessionId;
      // A máquina da sessão decide QUAL projeto — e portanto qual conta. Com `LOCAL_ID` implícito,
      // uma sessão remota caía no `cwd` do próprio Hub e escrevia no board de outro projeto.
      const { cwd, binding, resolved } = resolveSessionTaskConnection(sessionId, true, activeRunner(ws));
      if ("refusal" in resolved) { send(ws, { t: "task_create_result", sessionId, ok: false, error: resolved.refusal.message, code: resolved.refusal.code }); return; }
      const target = String(binding?.target || "");
      if (!target) { send(ws, { t: "task_create_result", sessionId, ok: false, error: "o vínculo do projeto não define o DESTINO da escrita (repo/projeto/time) — configure antes de criar", code: "NO_TARGET" }); return; }
      const title = String(msg.title).trim().slice(0, 300);
      const description = typeof msg.description === "string" ? msg.description.slice(0, 4000) : undefined;
      if (!title) { send(ws, { t: "task_create_result", sessionId, ok: false, error: "a tarefa precisa de título" }); return; }
      const remote = await gitRemoteOf(activeRunner(ws), cwd);
      const warning = remoteMismatchWarning(remote, resolved.connection);
      const remoteIncerto = remoteCheckApplies(resolved.connection) && !remote;   // borda 4 (TSK-11)
      const who = resolved.connection.identity?.login || resolved.connection.label;
      const preview = `Criar "${title}" em ${resolved.connection.label} · ${target} como ${who}${warning ? ` — ⚠ ${warning}` : remoteIncerto ? " — ⚠ não consegui ler o remote do projeto nesta máquina" : ""}`;
      const execute = async (): Promise<void> => {
        const t = providerSignal(15_000);
        try {
          const created = await createProviderTask(resolved.connection.provider, target, { title, description }, { config: resolved.connection.config, secret: resolved.secret, secret2: resolved.secret2, signal: t.signal });
          taskMeta.merge(resolved.connection.provider, created.key, { title, description, url: created.url });
          auth.audit("task_write", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: LOCAL_ID, detail: `create ${resolved.connection.id} → ${created.key}` });
          broadcastOn(LOCAL_ID, sessionId, { t: "notice", message: `Tarefa criada: ${created.key}${created.url ? ` — ${created.url}` : ""} (${resolved.connection.label})` });
          send(ws, { t: "task_create_result", sessionId, ok: true, key: created.key, url: created.url });
        } catch (e: any) {
          send(ws, { t: "task_create_result", sessionId, ok: false, error: String(e?.message ?? e) });
        } finally { t.finish(); }
      };
      // ⚠ de divergência remote×conexão NUNCA é auto-aprovável: é exatamente o acidente da conta errada.
      if (binding?.autoApprove?.includes("create") && !warning && !remoteIncerto) { await execute(); return; }
      const resolvedPolicy = resolveAdaptivePolicy(adaptivePolicyDoc, { cwd, sessionId });
      const approval = createAdaptiveApprovalRequest({
        id: `task:create:${Date.now()}`,
        action: "task_write",
        title: `🧭 ${preview}`,
        reason: description ? description.slice(0, 200) : "sem descrição",
        policy: resolvedPolicy.policy,
        sessionId,
        ttlMs: 30 * 60 * 1000,
      });
      pendingAdaptiveApprovals.set(approval.id, { approval, resolve: (approved) => { if (approved) void execute(); else send(ws, { t: "task_create_result", sessionId, ok: false, error: "criação recusada pelo dono" }); } });
      broadcastAdaptiveApprovals();
      send(ws, { t: "task_create_pending", sessionId, approvalId: approval.id, preview });
      return;
    }
    // The current "update available" alerts raised by the daily drift job (the client asks on panel open).
    if (msg.t === "framework_updates") {
      if (!requireOwner(ws)) return;
      send(ws, { t: "framework_updates", alerts: frameworkUpdateAlerts });
      return;
    }
    if (msg.t === "publish_framework") {
      if (!requireOwner(ws)) return;
      const base = readCanonicalFramework(frameworkRoot(), frameworkCfg.version);
      if (!base.files.length) { send(ws, { t: "framework_status", published: false, error: "o framework está vazio — adicione comandos, skills ou instruções antes de publicar" }); return; }
      frameworkCfg.version = base.version + 1; saveFrameworkCfg();
      savePublishedSnapshot(base.files); // baseline for the inventory diff ("alterações desde a última publicação")
      const manifest: FrameworkManifest = { version: frameworkCfg.version, hash: base.hash, files: base.files };
      const results: Array<Record<string, unknown>> = [];
      for (const rid of allowedRunnerIds(ws)) {
        const rc = runners.get(rid);
        const label = rid === LOCAL_ID ? (runnerLabels[LOCAL_ID] || "esta máquina") : (runnerLabels[rid] || rc?.info.host || rid);
        if (rid === LOCAL_ID) {
          // The canonical tree IS this machine's copy; materialize records a receipt so its version tracks.
          try { const r = materializeFramework(manifest, {}); frameworkProvenance.append({ at: Date.now(), runnerId: LOCAL_ID, version: r.version, hash: r.hash, written: r.written, removed: r.removed, skipped: r.skipped }); results.push({ runnerId: rid, label, local: true, state: "materialized" }); }
          catch (e: any) { results.push({ runnerId: rid, label, local: true, state: "error", error: String(e?.message ?? e) }); }
          continue;
        }
        const prior = pendingFrameworkPublish[rid];
        if (prior) frameworkPublishClients.delete(prior.requestId); // drop the superseded waiter so it can't leak
        const requestId = randomUUID();
        pendingFrameworkPublish[rid] = { requestId, targetHash: manifest.hash, targetVersion: manifest.version, requestedAt: Date.now() };
        if (rc && (rc.info.protocolVersion || 1) < 7) { results.push({ runnerId: rid, label, state: "needs_update" }); continue; }
        frameworkPublishClients.set(requestId, { ws, runnerId: rid });
        if (rc && rc.ws && rc.ws.readyState === WebSocket.OPEN && deliverPendingFrameworkPublish(rc)) results.push({ runnerId: rid, label, state: "sent" });
        else results.push({ runnerId: rid, label, state: "queued" });
      }
      savePendingFrameworkPublish();
      send(ws, { t: "framework_status", published: true, version: manifest.version, hash: manifest.hash, results });
      return;
    }
    // Inventory + health of the working tree: per-file kind/tokens/status vs. last publish, the token
    // budget, the security scan and the structural validation — the "ver o que tem e o que mudou" view.
    if (msg.t === "framework_inventory") {
      if (!requireOwner(ws)) return;
      const files = readCanonicalFramework(frameworkRoot(), frameworkCfg.version).files;
      const inventory = buildInventory(files, readPublishedSnapshot());
      const scan = scanFramework(files);
      const validation = validateFramework(files);
      send(ws, { t: "framework_inventory", version: frameworkCfg.version, inventory,
        scan: { counts: scan.counts, blocked: scan.blocked, findings: scan.findings },
        validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, issues: validation.issues },
        conformance: checkConformance(files),
        packs: buildPackIndex(frameworkSources.list()),
        sources: frameworkSources.list() });
      return;
    }
    // O pacote-modelo: um framework válido e comentado, para copiar em vez de ler a especificação.
    // Vai pela própria conexão (já autenticada) em base64 — o cliente monta o download no navegador.
    if (msg.t === "framework_pack_template") {
      if (!requireOwner(ws)) return;
      try {
        const zip = zipStore(packTemplateFiles());
        send(ws, { t: "framework_pack_template", ok: true, name: PACK_TEMPLATE_FILENAME, dataB64: zip.toString("base64") });
      } catch (e: any) { send(ws, { t: "framework_pack_template", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Stage a zip upload (base64) → extract → scan → preview. Nothing is written yet.
    if (msg.t === "framework_import_zip") {
      if (!requireOwner(ws)) return;
      try {
        const b64 = String(msg.dataB64 || "");
        if (!b64) throw new Error("arquivo vazio");
        if (b64.length > MAX_IMPORT_B64) throw new Error("arquivo excede o limite permitido");
        const buf = Buffer.from(b64, "base64");
        const { files, skipped, outOfScope, outOfScopeSample, manifest, mapped, excluded } = extractFrameworkFiles(unzip(buf));
        // Nada de sumiço mudo: o que está fora de skills/commands/flows/reference é reportado.
        if (outOfScope) skipped.push(`${outOfScope} arquivo(s) fora do escopo do framework (esperado skills/, commands/, flows/, reference/ ou instructions.md): ${outOfScopeSample.join(", ")}${outOfScope > outOfScopeSample.length ? ", …" : ""}`);
        if (!files.length) throw new Error("nenhum arquivo de framework encontrado (esperado commands/…, skills/… ou instructions.md)");
        const current = readCanonicalFramework(frameworkRoot()).files;
        const preview = buildImportPreview(files, skipped, current, manifest, { mapped, excluded });
        sweepPendingImports();
        const token = randomUUID();
        // O pacote que se identifica manda no id da fonte: reimportar o mesmo framework de um zip
        // renomeado passa a ATUALIZAR o registro em vez de criar uma origem duplicada.
        const name = String(msg.name || "pacote.zip");
        const sourceId = manifest ? `pack:${manifest.name}` : zipSourceId(name);
        const isUpdate = !!frameworkSources.get(sourceId);
        pendingFrameworkImports.set(token, { files: preview.files, hash: preview.hash, scanBlocked: preview.scan.blocked, manifest, source: { type: "zip", name, id: sourceId }, createdAt: Date.now() });
        send(ws, { t: "framework_import_preview", ok: true, token, isUpdate, source: { type: "zip", name }, preview: previewPayload(preview) });
      } catch (e: any) { send(ws, { t: "framework_import_preview", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Stage a GitHub import: fetch tarball (read-only) → extract → scan → preview. Public repos.
    if (msg.t === "framework_import_github") {
      if (!requireOwner(ws)) return;
      try {
        const spec = parseGithubSpec(String(msg.source || ""));
        const fetched = await fetchGithubFramework(spec);
        if (!fetched.files.length) throw new Error("nenhum arquivo de framework encontrado no repositório (esperado commands/…, skills/… ou instructions.md)");
        const current = readCanonicalFramework(frameworkRoot()).files;
        const ghSkipped = [...fetched.skipped];
        if (fetched.outOfScope) ghSkipped.push(`${fetched.outOfScope} arquivo(s) fora do escopo do framework (esperado skills/, commands/, flows/, reference/ ou instructions.md): ${fetched.outOfScopeSample.join(", ")}${fetched.outOfScope > fetched.outOfScopeSample.length ? ", …" : ""}`);
        const preview = buildImportPreview(fetched.files, ghSkipped, current, fetched.manifest, { mapped: fetched.mapped, excluded: fetched.excluded });
        sweepPendingImports();
        const token = randomUUID();
        const src = { type: "github" as const, spec, ref: fetched.ref, commit: fetched.commit, id: githubSourceId(spec.owner, spec.repo, spec.subdir) };
        const isUpdate = !!frameworkSources.get(src.id);
        pendingFrameworkImports.set(token, { files: preview.files, hash: preview.hash, scanBlocked: preview.scan.blocked, manifest: fetched.manifest, source: src, createdAt: Date.now() });
        send(ws, { t: "framework_import_preview", ok: true, token, isUpdate, source: { type: "github", repo: `${spec.owner}/${spec.repo}${spec.subdir ? "/" + spec.subdir : ""}`, ref: fetched.ref, commit: fetched.commit }, preview: previewPayload(preview) });
      } catch (e: any) { send(ws, { t: "framework_import_preview", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Re-fetch a previously imported source (GitHub or native provider skill) and preview the drift
    // ("buscar atualização"). Never applies — the owner confirms via framework_import_apply.
    if (msg.t === "framework_update_check") {
      if (!requireOwner(ws)) return;
      try {
        const rec = frameworkSources.get(String(msg.id || ""));
        if (!rec) throw new Error("fonte não encontrada");
        // Native provider skill/command: re-collect from disk and diff by content hash.
        if (rec.type === "native" && rec.entryId) {
          const { entries } = collectNativeCatalogFiles([rec.entryId]);
          const e = entries[0];
          if (!e) throw new Error("a skill nativa não está mais disponível nesta máquina");
          const current = readCanonicalFramework(frameworkRoot()).files;
          const preview = buildImportPreview(e.files, [], current);
          const hasUpdate = e.hash !== rec.hash;
          sweepPendingImports();
          const token = randomUUID();
          pendingFrameworkImports.set(token, { files: preview.files, hash: preview.hash, scanBlocked: preview.scan.blocked, source: { type: "native", nativeEntries: [{ entryId: e.id, provider: e.provider, kind: e.kind, name: e.name, hash: e.hash, paths: e.files.map((f) => f.path) }] }, createdAt: Date.now() });
          frameworkUpdateAlerts = frameworkUpdateAlerts.filter((a) => a.id !== rec.id || hasUpdate);
          send(ws, { t: "framework_update", ok: true, id: rec.id, hasUpdate, token, source: { type: "native", label: rec.label || e.name, provider: e.provider }, preview: previewPayload(preview) });
          return;
        }
        if (rec.type !== "github" || !rec.owner || !rec.repo) throw new Error("esta fonte não suporta verificação de atualização");
        const spec: GithubSpec = { owner: rec.owner, repo: rec.repo, ref: rec.ref, subdir: rec.subdir };
        const fetched = await fetchGithubFramework(spec);
        const current = readCanonicalFramework(frameworkRoot()).files;
        const preview = buildImportPreview(fetched.files, fetched.skipped, current);
        const hasUpdate = preview.hash !== rec.hash;
        sweepPendingImports();
        const token = randomUUID();
        pendingFrameworkImports.set(token, { files: preview.files, hash: preview.hash, scanBlocked: preview.scan.blocked, source: { type: "github", spec, ref: fetched.ref, commit: fetched.commit, id: rec.id }, createdAt: Date.now() });
        frameworkUpdateAlerts = frameworkUpdateAlerts.filter((a) => a.id !== rec.id || hasUpdate);
        send(ws, { t: "framework_update", ok: true, id: rec.id, hasUpdate, token, source: { type: "github", repo: `${rec.owner}/${rec.repo}${rec.subdir ? "/" + rec.subdir : ""}`, ref: fetched.ref, commit: fetched.commit, previousCommit: rec.commit }, preview: previewPayload(preview) });
      } catch (e: any) { send(ws, { t: "framework_update", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Line diff of one staged file against the current on-disk version (IDE-style, for "ver diferenças"
    // on a duplicate/modified file in the preview). Reuses core `lineDiff`; nothing is written.
    if (msg.t === "framework_import_diff") {
      if (!requireOwner(ws)) return;
      try {
        const pending = pendingFrameworkImports.get(String(msg.token || ""));
        if (!pending) throw new Error("prévia expirada — refaça a importação");
        const path = String(msg.path || "");
        const incoming = pending.files.find((f) => f.path === path);
        if (!incoming) throw new Error("arquivo não encontrado na prévia");
        const current = readCanonicalFramework(frameworkRoot()).files.find((f) => f.path === path);
        const rows = lineDiff(current?.content ?? "", incoming.content ?? "");
        send(ws, { t: "framework_import_diff", ok: true, path, rows, hasCurrent: !!current });
      } catch (e: any) { send(ws, { t: "framework_import_diff", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    // Apply a staged import. Refuses when the scan flagged HIGH unless `force` overrides. Additive
    // by default (`keep`); `overwrite` replaces conflicting files (used by updates).
    if (msg.t === "framework_import_apply") {
      if (!requireOwner(ws)) return;
      try {
        const pending = pendingFrameworkImports.get(String(msg.token || ""));
        if (!pending) throw new Error("prévia expirada — refaça a importação");
        const chosen = Array.isArray(msg.paths) && msg.paths.length ? pending.files.filter((f) => (msg.paths as string[]).includes(f.path)) : pending.files;
        if (!chosen.length) throw new Error("nenhum arquivo selecionado para aplicar");
        // Block is re-evaluated against the CHOSEN subset — deselecting the flagged file lifts the block.
        if (pending.scanBlocked && !msg.force && scanFramework(chosen).blocked) throw new Error("bloqueado por achados de segurança de severidade alta — revise e confirme o override para prosseguir");
        const mode = msg.mode === "overwrite" ? "overwrite" : "keep";
        const r = applyFrameworkImport(chosen, { mode });
        // A identidade declarada é gravada na fonte: é dela que sai a atribuição "de qual framework
        // veio" na interface. `files` guarda o que foi REALMENTE aplicado (não a prévia inteira),
        // senão um arquivo desmarcado continuaria sendo atribuído a este pacote.
        const pack = pending.manifest ? { name: pending.manifest.name, title: pending.manifest.title, version: pending.manifest.version } : undefined;
        const appliedPaths = chosen.map((f) => f.path);
        if (pending.source.type === "github" && pending.source.spec) {
          const s = pending.source.spec; const id = pending.source.id || githubSourceId(s.owner, s.repo, s.subdir);
          const prior = frameworkSources.get(id);
          frameworkSources.upsert({ id, type: "github", owner: s.owner, repo: s.repo, ref: s.ref, subdir: s.subdir, commit: pending.source.commit, label: pack?.title || `${s.owner}/${s.repo}`, pack, hash: pending.hash, files: appliedPaths, importedAt: prior?.importedAt || Date.now(), updatedAt: Date.now() });
        } else if (pending.source.type === "zip") {
          const name = pending.source.name || "pacote.zip";
          const id = pending.source.id || zipSourceId(name);
          const prior = frameworkSources.get(id);
          frameworkSources.upsert({ id, type: "zip", label: pack?.title || name, pack, hash: pending.hash, files: appliedPaths, importedAt: prior?.importedAt || Date.now(), updatedAt: Date.now() });
        } else if (pending.source.type === "native" && pending.source.nativeEntries) {
          const chosenPaths = new Set(chosen.map((f) => f.path));
          for (const ne of pending.source.nativeEntries) {
            const appliedPaths = ne.paths.filter((p) => chosenPaths.has(p));
            if (!appliedPaths.length) continue; // entry fully deselected in the preview → don't track it
            const id = nativeSourceId(ne.entryId);
            const prior = frameworkSources.get(id);
            // Track the FULL entry hash (over all of the skill's files) so a future drift check —
            // which re-collects the whole entry — compares like-for-like even on a partial import.
            frameworkSources.upsert({ id, type: "native", provider: ne.provider, kind: ne.kind, entryId: ne.entryId, label: ne.name, autoUpdate: prior?.autoUpdate ?? true, hash: ne.hash, files: appliedPaths, importedAt: prior?.importedAt || Date.now(), updatedAt: Date.now() });
          }
        }
        pendingFrameworkImports.delete(String(msg.token || ""));
        send(ws, { t: "framework_import_applied", ok: true, written: r.written, skippedExisting: r.skippedExisting, forced: !!msg.force && pending.scanBlocked });
      } catch (e: any) { send(ws, { t: "framework_import_applied", ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    if (msg.t === "framework_source_remove") {
      if (!requireOwner(ws)) return;
      const removed = frameworkSources.remove(String(msg.id || ""));
      send(ws, { t: "framework_source_removed", ok: removed, id: String(msg.id || "") });
      return;
    }
    // Credit/limit fallback config + current exhaustion state (owner-only).
    if (msg.t === "fallback_cfg") { if (!requireOwner(ws)) return; sendFallbackCfg(ws); return; }
    if (msg.t === "set_fallback_cfg") {
      if (!requireOwner(ws)) return;
      fallbackCfg.enabled = !!msg.enabled;
      fallbackCfg.agent = agents.has(String(msg.agent || "")) ? String(msg.agent) : "";
      fallbackCfg.model = String(msg.model || "");
      fallbackCfg.effort = String(msg.effort || "");
      saveFallbackCfg();
      sendFallbackCfg(ws, true);
      return;
    }
    if (msg.t === "fallback_clear") { // "tentar a primária agora" — lift a block manually
      if (!requireOwner(ws)) return;
      agentAvailability.clear(String(msg.agent || ""));
      sendFallbackCfg(ws);
      return;
    }
    // Observability log config (owner): enable/disable, level, retention.
    if (msg.t === "log_cfg") { if (!requireOwner(ws)) return; send(ws, { t: "log_cfg", cfg: log.getConfig() }); return; }
    if (msg.t === "set_log_cfg") {
      if (!requireOwner(ws)) return;
      const cfg = log.configure({ enabled: !!msg.enabled, level: isLogLevel(msg.level) ? msg.level : undefined, retentionDays: Number(msg.retentionDays), maxFileMb: Number(msg.maxFileMb) });
      send(ws, { t: "log_cfg", cfg, saved: true });
      return;
    }
    if (msg.t === "policy_state") {
      if (!requireOwner(ws)) return;
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : subs.get(ws);
      send(ws, adaptivePolicyPayload(sessionId));
      send(ws, { t: "adaptive_approvals", approvals: adaptiveApprovalList() });
      return;
    }
    if (msg.t === "adaptive_approvals") {
      if (!requireOwner(ws)) return;
      send(ws, { t: "adaptive_approvals", approvals: adaptiveApprovalList() });
      return;
    }
    if (msg.t === "adaptive_decisions") {
      if (!requireOwner(ws)) return;
      const limit = Number.isSafeInteger(msg.limit) && msg.limit > 0 ? Math.min(msg.limit, 200) : 50;
      send(ws, { t: "adaptive_decisions", decisions: adaptiveDecisionLog.slice(-limit).reverse() });
      return;
    }
    if (msg.t === "adaptive_approval" && typeof msg.id === "string") {
      if (!requireOwner(ws)) return;
      if (!completeAdaptiveApproval(msg.id, msg.action === "approve" ? "approve" : "reject", { userId: principalOf(ws)?.userId || undefined, deviceId: principalOf(ws)?.deviceId || undefined })) send(ws, { t: "adaptive_approvals", approvals: adaptiveApprovalList() });
      return;
    }
    if (msg.t === "set_adaptive_policy_scope") {
      if (!requireOwner(ws)) return;
      try {
        adaptivePolicyDoc = upsertAdaptivePolicyScope(adaptivePolicyDoc, msg.policy || {});
        saveAdaptivePolicy();
        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : subs.get(ws);
        auth.audit("set_adaptive_policy_scope", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, detail: String(msg.policy?.id || msg.policy?.scope || "") });
        send(ws, adaptivePolicyPayload(sessionId, true));
      } catch (e: any) {
        send(ws, { t: "error", message: "Política inválida: " + String(e?.message || e) });
      }
      return;
    }
    if (msg.t === "remove_adaptive_policy_scope" && typeof msg.scope === "string" && typeof msg.id === "string") {
      if (!requireOwner(ws)) return;
      adaptivePolicyDoc = removeAdaptivePolicyScope(adaptivePolicyDoc, msg.scope as PolicyScope, msg.id);
      saveAdaptivePolicy();
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : subs.get(ws);
      auth.audit("remove_adaptive_policy_scope", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, detail: `${msg.scope}:${msg.id}` });
      send(ws, adaptivePolicyPayload(sessionId, true));
      return;
    }
    if (msg.t === "set_adaptive_policy") {
      if (!requireOwner(ws)) return;
      adaptivePolicyDoc = normalizeAdaptivePolicyDocument(msg.doc);
      saveAdaptivePolicy();
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : subs.get(ws);
      send(ws, adaptivePolicyPayload(sessionId, true));
      return;
    }
    // --- self-update (git) ---
    if (msg.t === "update_check") { await refreshUpdate(false); send(ws, { t: "update_status", status: updateStatus }); return; }
    if (msg.t === "update_apply") {
      if (!requireOwner(ws)) return;
      const all = !!msg.allMachines;
      const force = !!msg.force;
      updateWatchers.add(ws);
      // Targeted retry (the per-machine "forçar" button). Forcing discards that machine's local
      // work, so it must hit exactly the machine the owner clicked — never fan out, never the Hub.
      if (typeof msg.runnerId === "string" && msg.runnerId) {
        const rc = runners.get(msg.runnerId);
        const label = rc ? (runnerLabels[rc.id] || rc.info.host || rc.id) : msg.runnerId;
        if (!rc || rc.local) { send(ws, { t: "update_machine", runnerId: msg.runnerId, label, ok: false, dirty: false, log: "máquina desconhecida" }); return; }
        if (force && (!rc.ws || rc.ws.readyState !== WebSocket.OPEN)) { send(ws, { t: "update_machine", runnerId: msg.runnerId, label, ok: false, dirty: false, log: "force não é guardado para execução futura: aguarde a máquina ficar online e confirme novamente" }); return; }
        auth.audit("update_apply", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: rc.id, detail: `${label}${force ? " (forçado — descarta local)" : ""}` });
        const latest = await updateCheck(UPDATE_ROOT, true), target = (latest.latest?.sha || latest.current || hubCommit).replace("+dirty", "");
        queueRunnerUpdate(rc.id, target, { force });
        if (deliverPendingRunnerUpdate(rc, { force, allowBlocked: force, retryNow: true })) send(ws, { t: "update_machine", runnerId: rc.id, label, ok: false, state: "sent", queued: true, log: "solicitação entregue; máquina drenando" });
        else { const online = !!rc.ws && rc.ws.readyState === WebSocket.OPEN, state = online ? (pendingRunnerUpdates[rc.id]?.state || "sent") : "queued"; send(ws, { t: "update_machine", runnerId: rc.id, label, ok: false, state, queued: true, log: online ? "atualização já está em andamento" : "máquina offline — atualização guardada para a próxima conexão" }); }
        return;
      }
      auth.audit("update_apply", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, detail: (all ? `hub + todas as máquinas conhecidas` : "hub") + (force ? " (forçado)" : "") });
      send(ws, { t: "update_progress", message: all ? "Preparando atualização do Hub; máquinas offline ficarão na fila…" : "Preparando atualização do Hub…", pending: all ? knownRemoteRunnerIds().length : 0, queued: [] });
      const r = await applyHubUpdate(force, all);
      send(ws, { t: "update_result", ok: r.ok, log: r.log });
      if (!r.ok || r.restartRequired === false) await refreshUpdate(true);
      return;
    }
    if (msg.t === "update_rollback") {
      if (!requireOwner(ws)) return;
      if (hubUpdateInProgress) { send(ws, { t: "update_result", ok: false, log: "outra atualização já está em andamento" }); return; }
      hubUpdateInProgress = true;
      const drainError = await drainHubForUpdate();
      const r = drainError ? { ok: false, log: drainError } : await updateRollback(UPDATE_ROOT);
      send(ws, { t: "update_result", ok: r.ok, log: r.log });
      if (r.ok) scheduleRestart();
      else hubUpdateInProgress = false;
      return;
    }
    // --- security admin (owner-only): devices, invites, roles, runner tokens, passphrase ---
    if (handleSecurityMsg(ws, msg)) return;
    // --- routines (owner-only): scheduled prompts ---
    if (handleRoutineMsg(ws, msg)) return;
    // --- fleet dashboard: a read-only snapshot of every machine + totals + plan + parse health ---
    if (msg.t === "fleet") {
      const machines = machineList(ws).map((m: any) => ({ ...m, active: m.local ? activeRuns.size + localManagedRuns.size : (runnerActive.get(m.id)?.size || 0) }));
      // Custo por IA e por sessão (não só o total): a cobrança acumula por sessão, e cada sessão tem
      // um agente — some por agente para o gráfico "por IA" e ranqueie as sessões mais caras.
      const overallUsage = usageLedger.total();
      const costTotal = overallUsage.costUsd;
      const byAgentUsage = usageLedger.byAgent(usageAgent);
      const byAgent: Record<string, number> = Object.fromEntries(Object.entries(byAgentUsage).map(([agent, usage]) => [agent, usage.costUsd]));
      const perSession: Array<{ id: string; runnerId: string; cost: number; agent: string; title: string }> = [];
      for (const entry of usageLedger.topSessions(50, usageAgent)) {
        const sid = entry.id, runnerId = entry.runnerId, cost = entry.usage.costUsd; if (!cost) continue;
        const agent = entry.agent;
        const internalTitle: Record<string, string> = { __auto_route__: "Roteamento automático", __summary__: "Resumos", __spoken_summary__: "Resumos falados", __decision_detection__: "Detecção de decisões" };
        const remoteState = runnerId === LOCAL_ID ? undefined : runnerSessionState.get(runnerId)?.get(sid);
        const remoteLabel = runnerLabels[runnerId] || runners.get(runnerId)?.info.host || runnerId;
        const title = sid === WAKE_SESSION && runnerId === LOCAL_ID ? "Voz (Jarvis)" : (internalTitle[sid] || (runnerId === LOCAL_ID ? store.get(sid)?.title || executionNodeBySession(sid)?.title : remoteState?.title || `${remoteLabel} · ${sid}`) || (isNativeId(sid) ? "Sessão da máquina" : sid));
        perSession.push({ id: sid, runnerId, cost, agent, title, usage: entry.usage } as any);
      }
      perSession.sort((a, b) => b.cost - a.cost);
      const topSessions = perSession.slice(0, 6);
      // custo atribuído à VOZ (a sessão de voz + o staging oculto usam o WAKE_SESSION) e sua fatia do total.
      const voiceCost = costOf(WAKE_SESSION);
      const voicePct = costTotal > 0 ? Math.round((voiceCost / costTotal) * 100) : 0;
      let remoteActive = 0; for (const s of runnerActive.values()) remoteActive += s.size;
      const plans: Record<string, any> = {};
      for (const machine of machines) for (const name of agents.names()) { const key = `${machine.id}:${name}`; const a = agents.get(name); if (machine.local) { if (!a.usage) plans[key] = { machine: machine.label, agent: name, status: "unsupported", plan: null }; else try { const plan = await a.usage(); plans[key] = { machine: machine.label, agent: name, status: plan ? "available" : "not_reported", plan }; } catch { plans[key] = { machine: machine.label, agent: name, status: "error", plan: null }; } } else { const has = Object.prototype.hasOwnProperty.call((runners.get(machine.id)?.info.agentUsage || {}), name), plan = (runners.get(machine.id)?.info.agentUsage?.[name] as any) || null; plans[key] = { machine: machine.label, agent: name, status: !has ? "unsupported" : plan ? "available" : "not_reported", plan }; } }
      const runnerMetrics = metrics.byRunner().filter((r) => canUseRunner(ws, r.runnerId)); // don't leak ids of machines they can't see
      send(ws, { t: "fleet", machines, totals: { sessions: store.list().length, active: activeRuns.size + localManagedRuns.size + remoteActive, costTotal, billableTotal: overallUsage.billableUsd, estimatedTotal: overallUsage.estimatedUsd, byKind: overallUsage.byKind, voiceCost, voicePct, byAgent, byAgentUsage, topSessions }, metrics: { overall: metrics.overall(), runners: runnerMetrics, agents: metrics.byAgent(), models: metrics.byModel() }, parseHealth: nativeParseHealth(), plans });
      return;
    }
    // --- semantic memory: search by MEANING (local embeddings) + owner reindex ---
    if (msg.t === "memory_search" && typeof msg.query === "string") {
      const q = msg.query;
      if (!semanticMemoryActive) { markSemanticMemoryUsed(); backfillLocalSemanticIndex(); }
      try {
        const vec = await embedOne(q);
        const runnerId = activeRunner(ws), sid = typeof msg.sessionId === "string" ? msg.sessionId : subs.get(ws), cwd = sessionCwdOn(runnerId, sid);
        const cls = classifyMemoryText({ text: q, cwd }), principalId = socketPrincipalId(ws), all = msg.scope === "all";
        const runnerIds = all ? allowedRunnerIds(ws) : [runnerId];
        const projectKey = all ? undefined : projectMemoryKey(cwd);
        const sessionId = !all && !projectKey ? sid : undefined;
        const hasBoundary = all || !!projectKey || !!sessionId;
        const scopedRunnerIds = hasBoundary ? runnerIds : [];
        const hits = vec.length && hasBoundary ? memory.search(vec, {
          topK: 10, minScore: 0.2, runnerIds: scopedRunnerIds, principalId,
          projectKey, sessionId,
        }) : [];
        send(ws, { t: "memory_result", query: q, searchScope: all ? "all" : "project", classification: cls, stats: memory.stats({ runnerIds: scopedRunnerIds, principalId, projectKey, sessionId }), hits: hits.map((h) => {
          const legacyRoute = /^runner:([^:]+):(.+)$/.exec(h.id);
          const hitRunner = h.runnerId || legacyRoute?.[1] || LOCAL_ID;
          return { id: h.sessionId, runnerId: hitRunner, title: h.title, agent: h.agent, cwd: h.cwd, snippet: h.text, score: Math.round(h.score * 100), namespaces: h.namespaces, scope: h.scope, topic: h.topic, projectKey: h.projectKey };
        }) });
      } catch { send(ws, { t: "memory_result", query: q, hits: [], error: "memória local indisponível — instale sentence-transformers na máquina do Hub (pip install sentence-transformers)" }); }
      return;
    }
    if (msg.t === "memory_stats") {
      send(ws, { t: "memory_stats", stats: memory.stats({ runnerIds: allowedRunnerIds(ws), principalId: socketPrincipalId(ws) }) });
      return;
    }
    if (msg.t === "memory_reindex") {
      const reindexOwner = requireOwner(ws); if (!reindexOwner) return;
      markSemanticMemoryUsed();
      void (async () => {
        try {
          type ReindexJob = {
            id: string;
            sessionId: string;
            runnerId: string;
            ownerGeneration: SessionOwnerGeneration;
            sourceUpdatedAt?: number;
            agent?: string;
            cwd?: string;
            title: string;
            updatedAt: number;
            text: string;
          };
          const stillAuthorized = (): boolean => ws.readyState === WebSocket.OPEN
            && socketPrincipalId(ws) === reindexOwner.userId
            && (!auth.AUTH_ENABLED || principalOf(ws)?.role === "owner");
          const jobs: ReindexJob[] = [];
          for (const summary of store.list()) {
            const full = store.get(summary.id);
            const ownerGeneration = captureSessionOwnerGeneration(LOCAL_ID, summary.id);
            if (!full || !full.messages.length || ownerGeneration.conflicted) continue;
            const lastUser = [...full.messages].reverse().find((message) => message.role === "user")?.text || "";
            const lastAssistant = [...full.messages].reverse().find((message) => message.role === "assistant")?.text || "";
            jobs.push({ id: summary.id, sessionId: summary.id, runnerId: LOCAL_ID, ownerGeneration, sourceUpdatedAt: full.updatedAt, agent: summary.agent, cwd: summary.cwd, title: summary.title, updatedAt: full.updatedAt, text: `${summary.title}\n${lastUser}\n${lastAssistant}`.slice(0, 2000) });
          }
          const remotes = [...runners.values()].filter((r) => !r.local && r.ws && r.ws.readyState === WebSocket.OPEN && canUseRunner(ws, r.id));
          for (const r of remotes) {
            const label = runnerLabels[r.id] || r.info.host || r.id;
            for (const s of await runnerSessions(r)) {
              if (!stillAuthorized() || !canUseRunner(ws, r.id)) throw new Error("a autorização mudou durante a reindexação");
              const requestedGeneration = captureSessionOwnerGeneration(r.id, s.id);
              if (requestedGeneration.conflicted) continue;
              const h = await runnerHistory(r, s.id, { ws, generation: requestedGeneration });
              if (!stillAuthorized() || !canUseRunner(ws, r.id)) throw new Error("a autorização mudou durante a reindexação");
              const messages = Array.isArray(h?.messages) ? h.messages : [];
              if (!messages.length) continue;
              const lu = [...messages].reverse().find((m: any) => m?.role === "user")?.text || "";
              const la = [...messages].reverse().find((m: any) => m?.role === "assistant")?.text || "";
              const title = `${label} · ${s.title || h?.title || s.id}`;
              const ownerGeneration = captureSessionOwnerGeneration(r.id, s.id);
              if (ownerGeneration.conflicted || !sessionOwnerGenerationCurrent(ownerGeneration)) continue;
              const sourceUpdatedAt = typeof s.updatedAt === "number" && Number.isFinite(s.updatedAt) ? s.updatedAt : undefined;
              jobs.push({ id: `runner:${r.id}:${s.id}`, sessionId: s.id, runnerId: r.id, ownerGeneration, sourceUpdatedAt, agent: s.agent || h?.agent, cwd: s.cwd || h?.cwd, title, updatedAt: sourceUpdatedAt || Date.now(), text: `${title}\n${lu}\n${la}`.slice(0, 2000) });
            }
          }
          const vecs = await embed(jobs.map((j) => j.text));
          if (!stillAuthorized()) throw new Error("a autorização mudou durante a reindexação");
          const entries = jobs.flatMap((job, index) => {
            const vec = vecs[index] || [];
            if (!vec.length || !sessionOwnerGenerationCurrent(job.ownerGeneration)) return [];
            if (job.runnerId === LOCAL_ID) {
              const current = store.get(job.sessionId);
              if (!current || current.updatedAt !== job.sourceUpdatedAt) return [];
            } else {
              const current = runnerSessionState.get(job.runnerId)?.get(job.sessionId);
              if (!current || (job.sourceUpdatedAt !== undefined && current.updatedAt !== job.sourceUpdatedAt)) return [];
            }
            return [{ id: job.id, sessionId: job.sessionId, runnerId: job.runnerId, ownerId: job.ownerGeneration.principalId, agent: job.agent, cwd: job.cwd, title: job.title, text: job.text.slice(0, 400), ts: job.updatedAt, vec, ...classifyMemoryText({ text: job.text, cwd: job.cwd }) }];
          });
          memory.upsertMany(entries);
          if (stillAuthorized()) send(ws, { t: "memory_reindexed", count: memory.size(), stats: memory.stats() });
        } catch (e: any) { send(ws, { t: "error", message: "reindex da memória falhou: " + String(e?.message ?? e) }); }
      })();
      return;
    }
    // --- voz ambiente (staging) + voz-config → handleVoiceStageMsg (extração verbatim, mesma ordem) ---
    if (await handleVoiceStageMsg(ws, msg)) return;
    // QR code of the URL to open on the phone
    if (msg.t === "qr" && typeof msg.url === "string") {
      try { send(ws, { t: "qr", url: msg.url, dataUri: await QRCode.toDataURL(msg.url, { width: 300, margin: 1 }) }); }
      catch (e: any) { send(ws, { t: "error", message: "qr: " + String(e?.message ?? e) }); }
      return;
    }
    // notifications (web-push + native FCM) → handlePushMsg (extração verbatim, mesma posição)
    if (handlePushMsg(ws, msg)) return;
    if (msg.t === "sendTo" && typeof msg.sessionId === "string" && typeof msg.text === "string") {
      if (store.isHidden(msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não aceita envio pelo chat" }); return; }
      const s = store.get(msg.sessionId);
      if (!s) { send(ws, { t: "error", message: "sessão não encontrada" }); return; }
      const turnActor = actorOf(ws);
      const queueTurn = (): void => {
        enqueueChatTurn(LOCAL_ID, s.id, { text: msg.text, atts: Array.isArray(msg.attachments) ? msg.attachments : [], model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, auto: autoFlags(msg.auto), msgId: typeof msg.msgId === "string" ? msg.msgId : undefined, actor: { ...turnActor, source: "queue" } });
        void maybeFlushQueue(LOCAL_ID, s.id, false);
        send(ws, { t: "queued", runnerId: LOCAL_ID, sessionId: s.id, text: msg.text });
      };
      if (sessionDispatchBusy(LOCAL_ID, s.id)) { queueTurn(); return; }
      const lease = reserveSessionDispatch(LOCAL_ID, s.id, actorPrincipalId(turnActor), "sendTo");
      if (!lease) { send(ws, { t: "error", message: "a autorização da sessão mudou antes do envio" }); return; }
      activeRuns.add(s.id); broadcastRuns();
      try {
        if (!sessionDispatchAuthorized(lease, ws) || !store.get(s.id)) throw new Error("a autorização da sessão mudou antes do envio");
        clearPendingAsk(LOCAL_ID, s.id);
        // routes through the shared lifecycle — which (unlike the old inline copy) also persists the
        // assistant's activity trace, so a reload of a session driven via sendTo keeps its tool blocks.
        const decision = await routeLocalTurn(s.id, msg.text, msg.model, msg.effort, autoFlags(msg.auto));
        if (!sessionDispatchAuthorized(lease, ws) || !store.get(s.id)) throw new Error("a autorização da sessão mudou durante o roteamento");
        const personal = await personalContextForChat(LOCAL_ID, s.id, msg.text, turnActor, () => refreshSessionDispatchAuthorization(lease));
        if (!sessionDispatchAuthorized(lease, ws) || !store.get(s.id)) throw new Error("a autorização da sessão mudou durante o contexto pessoal");
        await runOwnedManagedTurn(s.id, { showText: msg.text, agentText: personal ? `${personal.contextPrefix}\n\n${msg.text}` : msg.text, manifestAgentText: msg.text, model: decision.model, effort: decision.effort, actor: turnActor, onError: (message) => send(ws, { t: "error", message }) });
      } finally {
        activeRuns.delete(s.id); broadcastRuns();
        if (queueOf(LOCAL_ID, s.id).length) pendingDispatchFlush.add(scopedSessionKey(LOCAL_ID, s.id));
        releaseSessionDispatch(lease);
      }
      return;
    }

    // Suggestion card / cross-session "executar ação": run the action in a BRAND-NEW hub-managed
    // session (with the chat's chosen agent/model/effort) WITHOUT navigating the asker away. Creates
    // the session, replies with its id so the UI can offer a jump-link, then dispatches via the same
    // queue→flush lifecycle a normal send uses (so it shows as "rodando agora" and persists its trace).
    if (msg.t === "sendNew" && typeof msg.text === "string") {
      const text = msg.text.trim();
      if (!text) { send(ws, { t: "error", message: "ação vazia" }); return; }
      const turnActor = actorOf(ws);
      const agentName = agents.names().includes(msg.agent) ? msg.agent : agents.default;
      const cwd = typeof msg.cwd === "string" && existsSync(msg.cwd) ? msg.cwd : CWD;
      const title = (typeof msg.title === "string" && msg.title.trim() ? msg.title.trim() : text).slice(0, 60);
      const id = randomUUID();
      const s = store.ensure(id, { agent: agentName, cwd, title });
      pushSessions();
      const ref = msg.ref && typeof msg.ref.sessionId === "string"
        ? { sessionId: msg.ref.sessionId, runnerId: typeof msg.ref.runnerId === "string" ? msg.ref.runnerId : LOCAL_ID }
        : undefined;
      send(ws, { t: "sendNewResult", runnerId: LOCAL_ID, sessionId: id, agent: s.agent, title: s.title, ref });
      enqueueChatTurn(LOCAL_ID, id, {
        text,
        atts: Array.isArray(msg.attachments) ? msg.attachments : [],
        model: typeof msg.model === "string" ? msg.model : undefined,
        effort: typeof msg.effort === "string" ? msg.effort : undefined,
        auto: autoFlags(msg.auto),
        msgId: typeof msg.msgId === "string" ? msg.msgId : undefined,
        actor: { ...turnActor, source: "queue" },
      });
      void maybeFlushQueue(LOCAL_ID, id, false);
      return;
    }

    // Fila dona no hub: enfileirar / remover um / limpar / rodar agora. Sempre re-transmite a fila a todos que
    // veem a sessão (sincroniza entre dispositivos). O flush em si roda no fim do turno (flushQueue).
    if (msg.t === "enqueue" && typeof msg.sessionId === "string" && (typeof msg.text === "string" || Array.isArray(msg.attachments))) {
      const rid = activeRunner(ws);
      if (isInternalExecutionSession(rid, msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não aceita fila do chat" }); return; }
      pushQueueItem(rid, msg.sessionId, { text: typeof msg.text === "string" ? msg.text : "(anexo)", atts: Array.isArray(msg.attachments) ? msg.attachments : [], model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, auto: autoFlags(msg.auto), runnerId: rid !== LOCAL_ID ? rid : undefined, msgId: typeof msg.msgId === "string" ? msg.msgId : undefined, actor: actorOf(ws, "queue") });
      broadcastQueue(rid, msg.sessionId); saveQueues(); void maybeFlushQueue(rid, msg.sessionId, false); return;
    }
    if (msg.t === "dequeue" && typeof msg.sessionId === "string" && (typeof msg.msgId === "string" || typeof msg.index === "number")) {
      const rid = activeRunner(ws);
      if (isInternalExecutionSession(rid, msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não aceita fila do chat" }); return; }
      const q = queueOf(rid, msg.sessionId);
      let removedFromQueue = false, removedMsgId: string | undefined;
      // Prefer removal by STABLE msgId; index is a fallback (drifts if the queue changed since render).
      if (typeof msg.msgId === "string" && msg.msgId) {
        removedMsgId = msg.msgId;
        const i = q.findIndex((it) => it.msgId === msg.msgId);
        if (i >= 0) { q.splice(i, 1); removedFromQueue = true; }
        markQueueItemCancelled(msg.msgId); // even if not in the live queue — a flush may already hold it
      } else if (typeof msg.index === "number" && msg.index >= 0 && msg.index < q.length) {
        removedMsgId = q.splice(msg.index, 1)[0]?.msgId;
        removedFromQueue = true;
        markQueueItemCancelled(removedMsgId);
      }
      log.debug("queue_dequeue", { runnerId: rid, sid: msg.sessionId, msgId: removedMsgId, removedFromQueue, depth: q.length });
      broadcastQueue(rid, msg.sessionId); saveQueues(); return;
    }
    if (msg.t === "clearqueue" && typeof msg.sessionId === "string") { const rid = activeRunner(ws); if (isInternalExecutionSession(rid, msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não aceita fila do chat" }); return; } queues.set(scopedSessionKey(rid, msg.sessionId), []); queueBlocks.clear(scopedSessionKey(rid, msg.sessionId)); broadcastQueue(rid, msg.sessionId); saveQueues(); return; }
    // Monitor de jobs em background (comandos ```jarvis-run```): lista para o dono, e cancelar.
    if (msg.t === "background_jobs") { if (!requireOwner(ws)) return; send(ws, { t: "background_jobs", jobs: backgroundJobsForUi() }); return; }
    if (msg.t === "background_job_cancel" && typeof msg.jobId === "string") {
      if (!requireOwner(ws)) return;
      const job = backgroundJobs.get(msg.jobId);
      if (job && !isTerminalJobStatus(job.status)) {
        if (job.pid) killJob(job.pid);
        try { backgroundJobs.setStatus(job.jobId, "cancelled", { exitCode: -1, resultSummary: "cancelado pelo usuário" }); } catch { /* já terminal — corrida */ }
        backgroundJobs.markContinued(job.jobId); // cancel do usuário NÃO auto-continua a sessão
        broadcastOn(job.runnerId || LOCAL_ID, job.originSessionId, { t: "notice", message: `Tarefa em segundo plano cancelada: \`${job.command.slice(0, 80)}\`.` });
      }
      broadcastBackgroundJobs();
      return;
    }
    // Tirar do painel um job que já acabou. Só visual e só terminal — não cancela nem desfaz nada.
    // `jobId: "*"` dispensa todos os terminais de uma vez (o painel acumulava sem saída).
    if (msg.t === "background_job_dismiss" && typeof msg.jobId === "string") {
      if (!requireOwner(ws)) return;
      const alvos = msg.jobId === "*"
        ? backgroundJobs.list().filter((j) => isTerminalJobStatus(j.status) && !j.dismissedAt).map((j) => j.jobId)
        : [msg.jobId];
      for (const id of alvos) { try { backgroundJobs.dismiss(id); } catch (e: any) { send(ws, { t: "error", message: String(e?.message ?? e) }); } }
      broadcastBackgroundJobs();
      return;
    }
    if (msg.t === "flushqueue" && typeof msg.sessionId === "string") { const rid = activeRunner(ws); if (isInternalExecutionSession(rid, msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não aceita fila do chat" }); return; } void maybeFlushQueue(rid, msg.sessionId, false); return; }
    // "voltar" mensagem cancelada: tira a última mensagem do usuário do store (sessão do hub) pra
    // ela não reaparecer no reload. Nativa não dá (o transcript é do claude) — some só na tela.
    if (msg.t === "dropLast" && typeof msg.sessionId === "string") { if (store.isHidden(msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não pode ser alterada pelo chat" }); return; } if (!isNativeId(msg.sessionId)) { activityBuf.delete(scopedSessionKey(LOCAL_ID, msg.sessionId)); store.dropLastUser(msg.sessionId); pushSessions(); } return; }
    // The user answered/dismissed a decision card → forget the pending questions for that session.
    if (msg.t === "ask_clear" && typeof msg.sessionId === "string") {
      const runnerId = activeRunner(ws);
      if (isInternalExecutionSession(runnerId, msg.sessionId)) { send(ws, { t: "error", message: "sessão interna não pode ser alterada pelo chat" }); return; }
      clearPendingAsk(runnerId, msg.sessionId); return;
    }

    // Wizard de voz dos cards de decisão: falar um passo (say) e interpretar a resposta falada (ask_voice).
    if (msg.t === "say" && typeof msg.text === "string") {
      try { const wav = await synthesize(String(msg.text).slice(0, 900), VOICE); send(ws, { t: "tts", sessionId: msg.sessionId || "", audio: wav.toString("base64"), for: "ask" }); }
      catch (e: any) { send(ws, { t: "error", message: "TTS: " + String(e?.message ?? e) }); }
      return;
    }
    if (msg.t === "ask_voice" && typeof msg.audio === "string") {
      let transcript = "";
      try { transcript = await transcribe(Buffer.from(msg.audio, "base64"), undefined, msg.ext || "webm"); }
      catch (e: any) { send(ws, { t: "ask_choice", action: "repeat", error: String(e?.message ?? e) }); return; }
      const choice = await interpretAskVoice(transcript, String(msg.question || ""), Array.isArray(msg.options) ? msg.options : [], !!msg.multi);
      send(ws, { t: "ask_choice", ...choice, transcript });
      return;
    }

    // Stop a turn already running (user hit "parar"). Works for local and remote sessions.
    if (msg.t === "cancel") {
      const target = typeof msg.sessionId === "string" ? msg.sessionId : subs.get(ws);
      if (target) { const ok = cancelTurn(target, ws); if (!ok) send(ws, { t: "stream", sessionId: target, ev: { kind: "cancelled" } }); }
      return;
    }

    // --- conversation (text or voice) ---
    // O sessionId EXPLÍCITO manda (bate com o caminho de runner). Antes priorizávamos subs.get(ws)
    // — a sessão que o ws está VENDO — então um flush de fila da sessão A, disparado depois de você
    // trocar para B, ia parar em B (a fila de A é só de A). Agora roteia para A.
    const explicit = (typeof msg.sessionId === "string" && msg.sessionId) ? msg.sessionId : "";
    const viewing = subs.get(ws);
    const sid = explicit || viewing || "default";
    if (store.isHidden(sid)) { send(ws, { t: "error", message: "sessão interna não aceita envio pelo chat" }); return; }
    if (msg.t === "send" || msg.t === "voice") clearPendingAsk(activeRunner(ws), sid);
    // Só (re)inscreve o ws se o envio é para a sessão que ele já vê (ou se ainda não vê nada). Um
    // flush para uma sessão de FUNDO não pode trocar o que este ws está assistindo.
    if (!viewing || sid === viewing) subs.set(ws, sid);

    // Resolve the utterance first — routing (search / voice / native / normal) depends on it,
    // and native ids aren't in the store so we must NOT store.ensure() them here.
    let text: string | null = null;
    let speaker: string | undefined; // enrolled speaker for voice messages (or wake-injected)
    if (msg.t === "send" && typeof msg.text === "string") {
      text = msg.text;
      if (typeof msg.speaker === "string") speaker = msg.speaker; // wake listener already identified it
    } else if (msg.t === "voice" && typeof msg.audio === "string") {
      const audio = Buffer.from(msg.audio, "base64");
      const t0 = Date.now();
      let raw: string;
      try {
        raw = await transcribe(audio, msg.lang, msg.ext); // RAW — correction runs below, parallel to the gate
      } catch (e: any) {
        send(ws, { t: "error", message: "STT: " + String(e?.message ?? e) });
        return;
      }
      const sttMs = Date.now() - t0;
      // who spoke? label the message and, if the gate is on, reject unknown voices.
      const tSpk = Date.now();
      try {
        const id = await identifySpeaker(audio, msg.ext || "webm", voiceThreshold);
        if (id.known && id.name) speaker = id.name;
        if (voiceGate && !id.known) {
          send(ws, { t: "error", message: "voz não reconhecida", denied: true, score: id.score });
          if (msg.speak) {
            const wav = await synthesize("Desculpe, não reconheci a sua voz.", VOICE);
            send(ws, { t: "tts", sessionId: sid, audio: wav.toString("base64"), text: "Desculpe, não reconheci a sua voz." });
          }
          return;
        }
      } catch (e: any) {
        console.error("[speaker]", String(e?.message ?? e)); // speaker-id must never block the conversation
      }
      const spkMs = Date.now() - tSpk;
      // ONE fast-model call does correction + relevance together — two contending CLI spawns are slower
      // on a CPU-bound box (measured ~7.5s for the pair vs ~3.8s for one). Typed `send` never gets here;
      // the WAKE path only needs the correction (handleVoiceTurn runs its own gate with control skip).
      const tPre = Date.now();
      const needGate = voiceCfg.relevance !== "off" && sid !== WAKE_SESSION;
      const pre = await voicePreflight(raw, needGate ? recentContextOf(sid) : "");
      const preMs = Date.now() - tPre;
      // Timing to a file (hub.log doesn't capture stdout post-boot) so we can see WHERE the latency is.
      try { appendFileSync(join(JARVIS_DIR, "voice-timing.log"), `${new Date().toISOString()} stt=${sttMs}ms speaker=${spkMs}ms correção+gate=${preMs}ms relevante=${pre.relevant} "${String(raw).slice(0, 50)}"\n`); } catch { /* ignore */ }
      // Structured twin of the file line above, with the audio SIZE — so a slow STT can be told apart
      // from a big/long clip, and the whole voice pipeline is diagnosable from the one JSONL log.
      log.debug("voice_stt", { bytes: audio.length, sttMs, spkMs, preMs, relevant: pre.relevant });
      send(ws, { t: "voice_timing", stt: sttMs, speaker: spkMs, preflight: preMs });
      if (needGate && !pre.relevant) { send(ws, { t: "voice_ignored", sessionId: sid, text: pre.text }); return; }
      text = pre.text;
      if (CLOSING_RX.test(text)) closingTurn.add(sid); else closingTurn.delete(sid);
      // Gap 21: desvio de assunto NO MEIO de uma sessão já ativa. Diferente de `suggestSession`
      // (que resolve wake-word FRESCO, sem sessão), aqui comparamos a nova fala com o digest
      // semântico da PRÓPRIA sessão atual (indexado após cada turno) — se a similaridade for muito
      // baixa, é sinal de que isso não tem nada a ver com o que já estava rolando. NÃO bloqueia nem
      // decide sozinho: só SUGERE (o usuário decide se quer abrir uma sessão nova), e roda em
      // paralelo ao turno normal (não atrasa a resposta).
      void looksLikeTopicShift(sid, text).then((shift) => { if (shift) send(ws, { t: "topic_shift", sessionId: sid, text }); }).catch(() => { /* sugestão é best-effort */ });
    }
    if (!text) return;
    // Location is handled by PersonalAssistantService as a short-lived, purpose-bound envelope.
    // Legacy `geo` fields are intentionally ignored so raw coordinates never enter prompts,
    // pending-turn files, transcripts, semantic memory or the audit log.
    if (msg.t === "send" && typeof msg.msgId === "string" && !incomingTurns.add(msg.msgId)) return;
    // INTERJEIÇÃO — com um debate vivo nesta sessão, o chat fala com o DEBATE. A decisão é do SERVIDOR,
    // e não do cliente, de propósito: um celular que abriu a sessão no meio do debate, um cliente que
    // perdeu o frame de progresso ou uma fala pelo microfone acertam do mesmo jeito. Fica ANTES de
    // `recordPendingInboundTurn` porque um pendente é durável e seria repetido como TURNO depois de um
    // restart — só que o debate não sobrevive ao restart, e aí a mensagem viraria outra coisa.
    // `!comando` fica de fora: ele EXECUTA um shell (expandBang) e virar recado o engoliria em silêncio.
    // Vira o turno normal que sempre foi — o debate segue rodando em paralelo.
    if (activeRunner(ws) === LOCAL_ID && text.trim() && !text.trimStart().startsWith("!")) {
      const live = debateOpenForInterjection(sid);
      if (live) { await acceptDebateInterjection(live, ws, text, msg.speak === true, typeof msg.msgId === "string" ? msg.msgId : undefined); return; }
    }
    const inboundActor = actorOf(ws);
    const inboundKey = recordPendingInboundTurn(activeRunner(ws), sid, msg, text, inboundActor);
    { const _p = principalOf(ws); auth.audit("send", { userId: _p?.userId, deviceId: _p?.deviceId, detail: `${sid}: ${String(text).slice(0, 80)}` }); }
    // Remember the picker's permission mode for a remote session so the forwarded turn carries it
    // (local sessions persist it via the setmode handler + the Store instead).
    { const _rr = activeRunner(ws); if (_rr !== LOCAL_ID) { const _pm = normalizePermissionMode(typeof msg.permissionMode === "string" ? msg.permissionMode : undefined); if (_pm) remoteSessionModes.set(_rr + "" + sid, _pm); } }

    const approvalCommand = adaptiveApprovalVoiceCommand(text);
    if (approvalCommand) {
      clearPendingInboundTurn(inboundKey);
      const owner = requireOwner(ws); if (!owner) return;
      const approvals = adaptiveApprovalList();
      let reply = "";
      if (!approvals.length) reply = "Não há aprovações pendentes.";
      else if (approvalCommand === "list") reply = `${approvals.length} aprovação(ões) pendente(s): ${approvals.slice(0, 3).map((a) => a.title).join("; ")}.`;
      else {
        const done = completeAdaptiveApproval(approvals[0].id, approvalCommand, { userId: owner.userId || undefined, deviceId: owner.deviceId || undefined });
        reply = done ? `${approvalCommand === "approve" ? "Aprovado" : "Rejeitado"}: ${done.title}.` : "Essa aprovação não está mais pendente.";
      }
      send(ws, { t: "message", message: { sessionId: sid, role: "assistant", text: reply, ts: Date.now(), agent: "jarvis" } });
      if (msg.speak) {
        try { const wav = await synthesize(reply, VOICE); send(ws, { t: "tts", sessionId: sid, audio: wav.toString("base64"), text: reply }); } catch { /* ignore */ }
      }
      return;
    }

    // G — declarar a fonte/pasta de tarefas do projeto por uma frase, sem abrir a gaveta.
    //
    // Fica ANTES de qualquer despacho para a IA de propósito: mandar a frase para o agente custaria
    // crédito para, na melhor das hipóteses, ele responder que não sabe mexer no vínculo (o vínculo é
    // do Hub, não da sessão). O reconhecimento é determinístico e mora no core — `null` significa
    // "não é comigo" e o turno segue normal, que é o desfecho barato quando há dúvida.
    // Só o dono declara fonte — mas para quem NÃO é dono a frase nem chega a ser comando: sequestrar
    // o turno para responder "apenas o dono pode gerenciar dispositivos" (mensagem que nem fala de
    // tarefas) engoliria a mensagem de um convidado por causa da forma dela. Sem dono, segue normal.
    const sourceCommand = principalOf(ws)?.role === "owner" || !auth.AUTH_ENABLED ? parseTaskSourceCommand(text) : null;
    if (sourceCommand) {
      clearPendingInboundTurn(inboundKey);
      if (!requireOwner(ws)) return;
      // A pasta é a do projeto NA MÁQUINA da sessão. Resolver pelo cwd do Hub declararia a fonte de
      // outro projeto — o mesmo engano que a fatia C tirou da listagem.
      const taskRunnerId = activeRunner(ws);
      // Na conversa da varinha não existe "este projeto": ela cairia no cwd do próprio Hub e
      // declararia a fonte do repositório do Jarvis achando que era o do usuário.
      const cwd = sid === WAKE_SESSION ? "" : sessionProjectDir(taskRunnerId, sid);
      const planned = sid === WAKE_SESSION
        ? { ok: false as const, error: "aqui eu não sei de qual projeto você está falando — abra a sessão do projeto e repita a frase lá" }
        : planTaskSourceCommand({ command: sourceCommand, projectDir: cwd, current: (cwd ? projectTasks.get(cwd) : undefined) || null, connections: taskConnections.list() });
      let reply: string;
      if (!planned.ok) reply = `Fonte de tarefas: ${planned.error}.`;
      else {
        try {
          const removed = planned.plan.remove;
          // MESMA store (`projectTasks`) que alimenta `bindings` no frame de Configurações: é por ela
          // ser a mesma que a tela reflete o que a frase fez, sem código de tela nenhum nesta fatia.
          const binding = removed ? (projectTasks.remove(cwd), undefined) : projectTasks.set(cwd, planned.plan.binding!);
          const decision = resolveTaskSource({ projectDir: cwd, binding: binding || null, connections: taskConnections.list() });
          reply = formatTaskSourceConfirmation({ projectDir: cwd, decision, removed, connectionLabel: decision.connectionId ? taskConnections.get(decision.connectionId)?.label : undefined });
          auth.audit("task_binding", { userId: principalOf(ws)?.userId, deviceId: principalOf(ws)?.deviceId, runnerId: taskRunnerId, detail: `${cwd}: ${removed ? "removido" : binding?.tracker || "nenhuma"} (chat)` });
          // A gaveta desta sessão recebe o MESMO frame do botão da UI (a lista da fonte antiga é
          // descartada por ele) e as outras telas recebem a difusão — um caminho só de verdade.
          send(ws, { t: "task_binding", sessionId: sid, cwd, binding: binding || null, source: decision });
          broadcastTaskConnections();
        } catch (e: any) { reply = "Fonte de tarefas: " + String(e?.message ?? e); }
      }
      send(ws, { t: "message", message: { sessionId: sid, role: "assistant", text: reply, ts: Date.now(), agent: "jarvis" } });
      if (msg.speak) {
        try { const wav = await synthesize(reply, VOICE); send(ws, { t: "tts", sessionId: sid, audio: wav.toString("base64"), text: reply }); } catch { /* fala é best-effort; o texto já foi */ }
      }
      return;
    }

    // Meta-question about other sessions? -> cross-session search (typed or spoken).
    if (looksLikeCrossSessionQuery(text)) {
      clearPendingInboundTurn(inboundKey);
      await runAndSendSearch(ws, text, !!msg.speak);
      return;
    }

    // Proactive-voice router: the wake session lets the user pick the agent/model/effort/
    // folder by speech, and asks new-vs-continue when a conversation is already going.
    if (sid === WAKE_SESSION) {
      clearPendingInboundTurn(inboundKey);
      await handleVoiceTurn(text, !!msg.speak, speaker);
      return;
    }
    if (msg.t === "voice") {
      const ar = activeRunner(ws);
      if (ar !== LOCAL_ID) {
        if (!canUseRunner(ws, ar)) { send(ws, { t: "error", message: "sem acesso a esta máquina" }); return; }
        const rc = runners.get(ar);
        if (!rc || !rc.ws || rc.ws.readyState !== 1) { send(ws, { t: "error", message: "máquina offline" }); return; }
        let remoteSid = isNativeId(sid) ? (managedRunnerSessionForNative(rc.id, sid) || sid) : sid;
        if (runnerUpdateDraining(ar)) {
          enqueueChatTurn(ar, remoteSid, { text, atts: Array.isArray(msg.attachments) ? msg.attachments : [], model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, auto: autoFlags(msg.auto), runnerId: ar, msgId: typeof msg.msgId === "string" ? msg.msgId : undefined, actor: actorOf(ws, "queue") });
          send(ws, { t: "queued", runnerId: ar, sessionId: remoteSid, text, voice: true, update: true, message: "Máquina drenando para atualização — mensagem ficou na fila." });
          return;
        }
        const turnActor = actorOf(ws);
        if (sessionDispatchBusy(ar, remoteSid)) {
          pushQueueItem(ar, remoteSid, { text, atts: Array.isArray(msg.attachments) ? msg.attachments : [], model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, auto: autoFlags(msg.auto), runnerId: ar, msgId: typeof msg.msgId === "string" ? msg.msgId : undefined, actor: actorOf(ws, "queue") });
          broadcastQueue(ar, remoteSid); saveQueues(); void maybeFlushQueue(ar, remoteSid, false);
          send(ws, { t: "queued", runnerId: ar, sessionId: remoteSid, text, voice: true });
          return;
        }
        const lease = reserveSessionDispatch(ar, remoteSid, actorPrincipalId(turnActor), "voice");
        if (!lease) {
          enqueueChatTurn(ar, remoteSid, { text, atts: Array.isArray(msg.attachments) ? msg.attachments : [], model: typeof msg.model === "string" ? msg.model : undefined, effort: typeof msg.effort === "string" ? msg.effort : undefined, auto: autoFlags(msg.auto), runnerId: ar, msgId: typeof msg.msgId === "string" ? msg.msgId : undefined, actor: { ...turnActor, source: "queue" } });
          send(ws, { t: "queued", runnerId: ar, sessionId: remoteSid, text, voice: true }); return;
        }
        try {
        if (!sessionDispatchAuthorized(lease, ws, rc)) throw new Error("a autorização da sessão mudou antes do envio");
        const flags = autoFlags(msg.auto);
        let state = runnerSessionState.get(rc.id)?.get(remoteSid);
        let hist: any = null;
        if (needsAuto(flags)) {
          hist = await runnerHistory(rc, remoteSid, { ws });
          if (!sessionDispatchAuthorized(lease, ws, rc)) throw new Error("a autorização da sessão mudou durante a leitura do histórico");
          if (hist) state = { ...(state || {}), agent: hist.agent, cwd: hist.cwd, started: Number(hist.total) > 0, source: /^(claude:|codex:)/.test(remoteSid) ? "native" : "managed" };
        }
        const currentAgent = state?.agent || rc.info.agents[0];
        if (!currentAgent) { send(ws, { t: "error", message: "nenhuma IA disponível nesta máquina" }); return; }
        const su = sessionUsage(remoteSid, ar);
        const decision = await decideAutomaticRoute({
          runnerId: ar, sid: remoteSid, text, started: state?.source === "native" || state?.started === true,
          currentAgent, currentModel: typeof msg.model === "string" ? msg.model : (flags.model ? su.model : undefined),
          currentEffort: typeof msg.effort === "string" ? msg.effort : undefined,
          flags, descriptors: rc.info.agentDescriptors || [], available: rc.info.agents || [],
          recent: Array.isArray(hist?.messages) ? hist.messages.filter((m: any) => m?.role === "user" || m?.role === "assistant").slice(-6).map((m: any) => ({ role: m.role, text: String(m.text || "") })) : [],
          contextTokens: hist?.inputTokens || su.contextTokens, contextWindowTokens: hist?.contextWindowTokens || su.contextWindowTokens,
          notify: (frame) => { for (const c of clientsOn(rc.id)) if (subs.get(c) === remoteSid && canAccessSession(c, rc.id, remoteSid)) send(c, frame); },
        });
        if (!sessionDispatchAuthorized(lease, ws, rc)) throw new Error("a autorização da sessão mudou durante o roteamento");
        const states = runnerSessionState.get(rc.id) || new Map<string, any>(); states.set(remoteSid, { ...(state || {}), id: remoteSid, agent: decision.agent }); runnerSessionState.set(rc.id, states);
        if (msg.speak) remoteSpeak.add(ar + "\0" + remoteSid);
        const personal = await personalContextForChat(ar, remoteSid, text, turnActor, () => refreshSessionDispatchAuthorization(lease));
        if (!sessionDispatchAuthorized(lease, ws, rc)) throw new Error("a autorização da sessão mudou durante o contexto pessoal");
        const turnId = (typeof msg.msgId === "string" && msg.msgId) ? msg.msgId : randomUUID();
        if (!sendOwnedRunnerTurn(rc, remoteSid, turnId, actorPrincipalId(turnActor), { t: "send", text, contextPrefix: personal?.contextPrefix, agent: decision.agent, opts: { model: decision.model, effort: decision.effort, permissionMode: remoteSessionModes.get(rc.id + " " + remoteSid) }, attachments: Array.isArray(msg.attachments) ? msg.attachments : [], speaker, actor: turnActor })) {
          remoteSpeak.delete(ar + "\0" + remoteSid);
          send(ws, { t: "error", message: "não foi possível enviar para a máquina" });
          return;
        }
        markRunnerSessionActive(ar, remoteSid);
        return;
        } finally { releaseSessionDispatch(lease); }
      }
    }
    // One turn per session. A second send while one is still running would spawn a CONCURRENT agent
    // on the same session — two processes editing the same repo at once. Instead of DROPPING the
    // input, QUEUE it: it runs when the current turn finishes (flushQueue). This is critical for
    // VOICE — the utterance is transcribed here on the server, so the old "busy" reply threw away a
    // just-recorded audio (a long one is real work lost). A typed send only reaches here in a race
    // (the client sends {t:enqueue} once it knows the session is busy), so there's no double-queue.
    // Search and the wake router returned above, so this only covers real native/normal turns.
    const turnActor = actorOf(ws);
    const queueLocalTurn = (): void => {
      const rid = activeRunner(ws);
      enqueueChatTurn(LOCAL_ID, sid, {
        text,
        atts: Array.isArray(msg.attachments) ? msg.attachments : [],
        model: typeof msg.model === "string" ? msg.model : undefined,
        effort: typeof msg.effort === "string" ? msg.effort : undefined,
        auto: autoFlags(msg.auto),
        runnerId: rid !== LOCAL_ID ? rid : undefined,
        // Every queued item needs a stable id so it's removable by msgId + cancellable mid-flush.
        // Voice sends carry no client msgId, so mint one here.
        msgId: typeof msg.msgId === "string" && msg.msgId ? msg.msgId : randomUUID(),
        actor: { ...turnActor, source: "queue" },
      });
      void maybeFlushQueue(LOCAL_ID, sid, false);
      clearPendingInboundTurn(inboundKey);
      // ack so the client stops its "processando" spinner and confirms the utterance landed (the
      // queue list itself already updated via broadcastQueue above).
      send(ws, { t: "queued", runnerId: LOCAL_ID, sessionId: sid, text, voice: msg.t === "voice" });
    };
    if (sessionDispatchBusy(LOCAL_ID, sid)) {
      queueLocalTurn();
      return;
    }

    // Reserve the slot SYNCHRONOUSLY — no `await` between the guard check above and this line.
    // Without this, two messages for the same session (e.g. a text `send` and a `voice` whose STT
    // already ran) can both pass the check above before either registers, and both end up running
    // a turn concurrently on the same session (interleaved agent_event streams, garbled replies).
    // agentTurn()'s own activeRuns.add()/delete() become idempotent no-ops once this fires first;
    // the release in `finally` below covers paths (like isNativeId) that never reach agentTurn.
    const lease = reserveSessionDispatch(LOCAL_ID, sid, actorPrincipalId(turnActor), msg.t);
    if (!lease) { send(ws, { t: "error", message: "a autorização da sessão mudou antes do envio" }); return; }
    activeRuns.add(sid); broadcastRuns();
    try {
      if (!sessionDispatchAuthorized(lease, ws)) throw new Error("a autorização da sessão mudou antes do envio");
      // Continue an imported native CLI session (resumes the real claude session; persists in its jsonl).
      if (isNativeId(sid)) {
        const decision = await routeLocalTurn(sid, text, msg.model, msg.effort, autoFlags(msg.auto));
        if (!sessionDispatchAuthorized(lease, ws)) throw new Error("a autorização da sessão mudou durante o roteamento");
        const personal = await personalContextForChat(LOCAL_ID, sid, text, turnActor, () => refreshSessionDispatchAuthorization(lease));
        if (!sessionDispatchAuthorized(lease, ws)) throw new Error("a autorização da sessão mudou durante o contexto pessoal");
        await deliverNativeTurn(ws, sid, text, { model: decision.model, effort: decision.effort, speak: !!msg.speak, speaker, attachments: Array.isArray(msg.attachments) ? msg.attachments : [], actor: turnActor, contextPrefix: personal?.contextPrefix, authorize: () => sessionDispatchAuthorized(lease, ws) });
        clearPendingInboundTurn(inboundKey);
        return;
      }

      // --- normal Jarvis session (agent + cwd locked at creation) ---
      // Attachments: agent sees file contents / image paths; chat shows text + 📎 chip / image preview.
      // Per-seam timing: the turn event already covers the agent send; these three cover the gap
      // BEFORE it (route/expand/personal), which was an un-instrumented blind spot where voice latency
      // could hide. One debug line per turn correlates with the turn event by session.
      const _tRoute = Date.now();
      const decision = await routeLocalTurn(sid, text, msg.model, msg.effort, autoFlags(msg.auto));
      const _routeMs = Date.now() - _tRoute;
      if (!sessionDispatchAuthorized(lease, ws) || !store.get(sid)) throw new Error("a autorização da sessão mudou durante o roteamento");
      const { agentText, showText, images, files } = buildAttachments(Array.isArray(msg.attachments) ? msg.attachments : [], text);
      // Power-triggers, resolved for the AGENT only (chat keeps showing the raw text): "!cmd" runs and
      // injects its output; otherwise a "/cmd" expands to its prompt (scoped to this session's agent).
      const scwd = store.get(sid)?.cwd || CWD;
      const _tExpand = Date.now();
      const bang = await expandBang(text, scwd);
      if (!sessionDispatchAuthorized(lease, ws) || !store.get(sid)) throw new Error("a autorização da sessão mudou durante a expansão do comando");
      const cmdExp = bang ? null : expandCommand(text, scwd, cmdAgentOf(store.get(sid)?.agent), { preference: frameworkCfg.preference });
      const manifestAgentText = bang ? bang.expanded : (cmdExp ? cmdExp.expanded : agentText);
      const _expandMs = Date.now() - _tExpand;
      const _tPersonal = Date.now();
      const personal = await personalContextForChat(LOCAL_ID, sid, text, turnActor, () => refreshSessionDispatchAuthorization(lease));
      const _personalMs = Date.now() - _tPersonal;
      log.debug("local_dispatch", { sid, kind: msg.t, routeMs: _routeMs, expandMs: _expandMs, personalMs: _personalMs });
      if (!sessionDispatchAuthorized(lease, ws) || !store.get(sid)) throw new Error("a autorização da sessão mudou durante o contexto pessoal");
      await runOwnedManagedTurn(sid, {
        showText, agentText: personal ? `${personal.contextPrefix}\n\n${manifestAgentText}` : manifestAgentText, manifestAgentText,
        model: decision.model,
        effort: decision.effort,
        speaker, images, files, speak: !!msg.speak,
        turnId: typeof msg.msgId === "string" ? msg.msgId : undefined,
        actor: turnActor,
        onError: (message, limit) => send(ws, { t: "error", message, limit }),
      });
      clearPendingInboundTurn(inboundKey);
    } finally {
      activeRuns.delete(sid); broadcastRuns();
      if (queueOf(LOCAL_ID, sid).length) pendingDispatchFlush.add(scopedSessionKey(LOCAL_ID, sid));
      releaseSessionDispatch(lease);
    }
    } catch (e) {
      console.error("[hub] erro ao processar", msg.t, "-", String((e as any)?.message ?? e));
      if (String((e as any)?.message ?? e) !== ABORTED) try { send(ws, { t: "error", message: "erro interno ao processar a mensagem" }); } catch { /* ignore */ }
    }
  });

  // Initial state — pushed AFTER the message listener is attached. With auth ON,
  // it is deferred until the client completes the handshake (see handleAuth ->
  // sendInitialState); the client drives with authinfo/auth on connect. With auth
  // OFF (JARVIS_AUTH=off), push immediately as before.
  if (!auth.AUTH_ENABLED) void sendInitialState(ws);
});

// Loopback-only admin API (host recovery) — see adminApi.ts. Injected with the Hub state it needs.
startAdminApi({ updateRoot: UPDATE_ROOT, port: PORT, applyHubUpdate, rollbackHubUpdate: async () => {
  if (hubUpdateInProgress) return { ok: false, busy: true, log: "outra atualização já está em andamento" };
  hubUpdateInProgress = true; const drainError = await drainHubForUpdate(); const result = drainError ? { ok: false, log: drainError } : await updateRollback(UPDATE_ROOT);
  if (result.ok) scheduleRestart(); else hubUpdateInProgress = false; return result;
}, queueAllRunnerUpdates: queueAllRemoteRunnerUpdates, restartHub: scheduleRestart, dropRevoked, refreshPrincipalRole, runners, runnerLabels, runnerSessions, sendToRunner });

void refreshLocalAgents();
setInterval(() => void refreshLocalAgents(), 300_000); // every 5 min; probes are version/login-status checks, never inference turns
setTimeout(() => void refreshUpdate(true), 8_000); // first update check shortly after boot
setInterval(() => void refreshUpdate(true), 6 * 3600_000); // then every 6h
try { const purged = purgeProbeJunk(); if (purged) console.log(`[hub] limpei ${purged} sessão(ões) de sondagem "ok"`); } catch { /* ignore */ }
try { const s = purgeScratch(); if (s) console.log(`[hub] limpei ${s} transcript(s) descartável(is) de one-shot`); } catch { /* ignore */ }
try { loadQueues(); loadPendingInboundTurns(); recoverPendingInboundTurns(); const n = [...queues.values()].reduce((a, q) => a + q.length, 0); if (n) { console.log(`[hub] fila restaurada: ${n} mensagem(ns) (cache com TTL)`); setTimeout(flushAllQueues, 1500).unref?.(); } } catch { /* ignore */ }
// Resíduos de persistência: .bak/.tmp ÓRFÃOS (sem arquivo principal) e .tmp de escritas interrompidas.
// Nunca remove um .bak cujo primário existe — esse é a rede de segurança contra arquivo corrompido.
try {
  const swept = [...cleanupOrphanBackups(JARVIS_DIR), ...cleanupOrphanBackups(join(JARVIS_DIR, "hub"))];
  if (swept.length) console.log(`[hub] faxina de persistência: ${swept.length} arquivo(s) .bak/.tmp órfão(s) removido(s)`);
} catch { /* ignore */ }
// No framework, .bak/.tmp NÃO são rede de segurança: a escrita já é atômica e o conteúdo é
// republicável a partir do manifesto. Enquanto entravam no manifesto, cada publicação escrevia o
// backup do backup e o painel lia `flows/x.json.bak` como mais um fluxo com o mesmo nome.
try {
  const residue = pruneFrameworkResidue(frameworkRoot());
  if (residue) console.log(`[hub] framework: ${residue} arquivo(s) .bak/.tmp removido(s) do conteúdo canônico`);
} catch { /* ignore */ }
// Background-job auto-continuation: fire any continuation that a restart/busy-session left pending,
// then poll as a safety net (the primary trigger is the job-completion path, added with the spawner).
try { reconcileBackgroundJobs(); } catch { /* ignore */ }
setInterval(() => { try { pollBackgroundJobs(); } catch { /* ignore */ } }, 2_000).unref?.();
setInterval(() => { try { reconcileBackgroundJobs(); } catch { /* ignore */ } }, 30_000).unref?.();
// Safety-net: drena filas locais ociosas que encalharam. A continuação de um job enfileira o turno e
// chama maybeFlushQueue UMA vez; se esse flush bater num gate transitório (reserva de dispatch, timing
// de boot), nada mais re-dispara — o flush de fim-de-turno só roda quando um turno termina, e não há.
setInterval(() => { try { flushIdleQueues(); } catch { /* ignore */ } }, 15_000).unref?.();
// A hub restart can leave sessions with a "sent but no reply visible" turn (see reconcileFromNative)
// — fix them all proactively at boot, not just when the user happens to reopen one.
try { let n = 0; for (const meta of store.list()) { const s = store.ensure(meta.id); const before = s.messages.length; reconcileFromNative(s); if (s.messages.length > before) n++; } if (n) console.log(`[hub] reconciliei ${n} sessão(ões) com resposta nativa que tinha ficado invisível`); } catch { /* ignore */ }
try { let n = 0; for (const meta of listNative()) n += reconcileNativeExecutions(meta.id); if (n) console.log(`[hub] reconciliei ${n} execução(ões) nativas sem terminal observado`); } catch { /* ignore */ }
// Graceful shutdown: the Hub is also a runner (it spawns local agent CLIs under the configured permission mode).
// A service stop / SIGTERM would orphan them — abort every live local turn (killTree fires via the
// AbortSignal) before exiting, mirroring the runner.
// ── Framework auto-update: once a day (and shortly after boot) re-check every tracked source for drift
// and raise "update available" alerts. Policy is NOTIFY-ONLY — nothing is ever applied automatically;
// the owner reviews each drift (scan + diff) and confirms. Zip sources have no origin to re-fetch.
function isOwnerSocket(ws: WebSocket): boolean {
  if (!auth.AUTH_ENABLED) return true;
  return principalOf(ws)?.role === "owner";
}
function broadcastFrameworkUpdates(): void {
  const payload = { t: "framework_updates" as const, alerts: frameworkUpdateAlerts };
  for (const c of wss.clients) { const w = c as WebSocket; if (w.readyState === WebSocket.OPEN && !runnerSockets.has(w) && isOwnerSocket(w)) { try { send(w, payload); } catch { /* skip */ } } }
}
async function scanFrameworkSourceDrift(): Promise<void> {
  let current: FrameworkFile[];
  try { current = readCanonicalFramework(frameworkRoot()).files; } catch { return; }
  const alerts: FrameworkUpdateAlert[] = [];
  for (const s of frameworkSources.list()) {
    if (s.autoUpdate === false) continue;
    try {
      if (s.type === "github" && s.owner && s.repo) {
        const fetched = await fetchGithubFramework({ owner: s.owner, repo: s.repo, ref: s.ref, subdir: s.subdir });
        const preview = buildImportPreview(fetched.files, [], current);
        if (preview.hash !== s.hash) alerts.push({ id: s.id, type: "github", label: s.label || `${s.owner}/${s.repo}${s.subdir ? "/" + s.subdir : ""}`, scanBlocked: preview.scan.blocked, changed: preview.files.length, at: Date.now() });
      } else if (s.type === "native" && s.entryId) {
        const { entries } = collectNativeCatalogFiles([s.entryId]);
        const e = entries[0];
        if (e && e.hash !== s.hash) { const preview = buildImportPreview(e.files, [], current); alerts.push({ id: s.id, type: "native", label: s.label || e.name, provider: e.provider, scanBlocked: preview.scan.blocked, changed: preview.files.length, at: Date.now() }); }
      }
      // zip: no remote origin to re-fetch — cannot auto-check.
    } catch { /* transient (offline / rate-limit / source gone) — retry next cycle */ }
  }
  frameworkUpdateAlerts = alerts;
  broadcastFrameworkUpdates();
}

let hubShuttingDown = false;
async function hubShutdown(sig: string): Promise<void> {
  if (hubShuttingDown) return; hubShuttingDown = true;
  const forceExit = setTimeout(() => process.exit(0), 3_000);
  personalProactiveScheduler.stop();
  if (localAborts.size) console.log(`[hub] ${sig} — abortando ${localAborts.size} turno(s) local(is) em andamento`);
  for (const [, ctrl] of localAborts) { try { ctrl.abort(); } catch { /* ignore */ } }
  for (const [, ctrl] of routeAborts) { try { ctrl.abort(); } catch { /* ignore */ } }
  try { localTerminals.closeAll(); } catch { /* ignore */ }
  await Promise.race([personalAssistant.disposeAll(), new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
  clearTimeout(forceExit);
  setTimeout(() => process.exit(0), 300); // brief grace so killTree's taskkill can spawn
}
process.on("SIGTERM", () => { void hubShutdown("SIGTERM"); });
process.on("SIGINT", () => { void hubShutdown("SIGINT"); });

server.listen(PORT, () => {
  console.log(`[hub] http+ws  http://127.0.0.1:${PORT}`);
  console.log(`[hub] agents=[${agents.names().join(", ")}]  default=${agents.default}  cwd=${CWD}  voice=${VOICE}`);
  console.log(`[hub] guard: rate-limit + conn caps + ${Math.round(guard.MAX_PAYLOAD / 1024 / 1024)}MB payload cap active${/^(on|1|true)$/i.test(process.env.JARVIS_TRUST_PROXY || "") ? " (trust-proxy on)" : ""}`);
  if (process.env.JARVIS_PERSONAL_PROACTIVE !== "0") personalProactiveScheduler.start();
  if (process.env.JARVIS_FRAMEWORK_AUTOUPDATE !== "0") {
    setTimeout(() => { void scanFrameworkSourceDrift(); }, 30_000).unref?.();          // shortly after boot
    setInterval(() => { void scanFrameworkSourceDrift(); }, 24 * 60 * 60 * 1000).unref?.(); // daily
  }
  if (!auth.AUTH_ENABLED) {
    console.log(`[hub] AUTH DISABLED (JARVIS_AUTH=off) — every connection is trusted. Use ONLY on a private network (never a public server).`);
  } else if (!auth.isClaimed()) {
    const code = auth.ensureClaimCode();
    console.log(`[hub] UNCLAIMED. Claim ownership on your first device with this code:\n\n      ${code}\n\n      (also saved to ~/.jarvis/claim-code.txt)`);
  } else {
    console.log(`[hub] auth on — ${auth.listDevices().length} device(s) paired.`);
  }
  // Structured log: boot marker + retention housekeeping (purge old daily files now and once a day).
  log.info("hub_boot", { version: VERSION, port: PORT, agents: agents.names(), voice: VOICE });
  try { const purged = log.purgeOld(); if (purged) console.log(`[hub] logs: ${purged} arquivo(s) diário(s) removido(s) por retenção`); } catch { /* best effort */ }
  setInterval(() => { try { log.purgeOld(); } catch { /* best effort */ } }, 24 * 60 * 60 * 1000).unref?.();
  // Warm the voice daemons at boot instead of on the first live voice message: this product is
  // voice-first, and paying the cold-start (spawn + model load — the dominant cost, per stt.ts/
  // tts.ts's own comments) during a controlled boot is much better than silently eating it inside a
  // user-facing turn's latency budget. Fire-and-forget; a failure just means the old on-demand path
  // kicks in on first use (see warmUp()'s own .catch), so this can never make voice LESS available.
  if (process.env.JARVIS_VOICE_WARMUP !== "0") { warmUpStt(); warmUpTts(); }
  // Embedding stays opt-in (mirrors semanticMemoryActive's own gate) — only warm it when semantic
  // memory is already in use, so a user who never touches the feature never pays for it at all.
  if (semanticMemoryActive) warmUpEmbed();
});
