/**
 * Runner <-> Hub protocol (the real, as-built contract).
 *
 * A Runner is a machine (the host itself, or a remote Ubuntu/macOS/Windows box)
 * that executes agents locally and streams results back to the Hub. Runners dial
 * the Hub over an outbound WebSocket and authenticate with an app token; the Hub
 * is the router and the single UI. Transport (Tailscale / VPN / tunnel / LAN) is
 * an external operator choice — this protocol assumes only a WebSocket.
 *
 * Correlation: request-scoped Hub->Runner messages carry a `reqId`; the Runner
 * echoes it on the matching reply so the Hub can route back to the right client.
 */
import type { AgentEvent, PermissionMode } from "./agent.js";
import type { ContextActor, ContextManifest } from "./context.js";
import type { ExecutionHubToRunner, ExecutionRunnerToHub, ExecutionState, ManagedExecutionPlanWire, ManagedExecutionPolicyWire } from "./execution.js";

export type RunnerOS = "linux" | "darwin" | "win32" | string;

/** Increment when a protocol change affects observable turn/history semantics.
 *  v7: framework_publish / framework_published (Framework Jarvis distribution to machines).
 *  v8: preview_query / preview_list (Design Mode preview-URL discovery for a session's cwd).
 *      Tolerant: the Hub only sends preview_query to runners advertising protocolVersion >= 8.
 *  v18: browser_* (BRW-IDE-00 F1 — browser remoto) + frames binários na conexão do runner;
 *       writefile/searchfiles (BRW-IDE-00 F3 — editor leve).
 *  v19: BRW-IDE-00 F2 — a IA vê e dirige o browser da máquina (ponte MCP `jarvisbrowser`, três
 *       níveis, `browser_agent_*`) + seleção de pontos do dono (`browser_grab`).;
 *       ide_* (BRW-IDE-00 F4 — VS Code/code-server por máquina) + túnel binário `kind 0x54` entraram
 *       aqui e foram REMOVIDOS em 2026-10-26 (a edição ficou no editor leve, F3). A versão segue 19;
 *       Hub e runner descartam `ide_*` e `0x54` de quem ainda não atualizou. */
export const RUNNER_PROTOCOL_VERSION = 19;

/**
 * Em qual versão cada CAPACIDADE entrou. Comparar com número solto espalha a regra pelo código, e
 * "um a menos que o atual" deixa de significar "antes da capacidade" no primeiro bump seguinte — foi
 * exatamente assim que o e2e da configuração de MCP quebrou quando o protocolo foi para 14.
 */
export const RUNNER_CAPABILITY_SINCE = {
  /** listar tarefas locais da própria máquina */ localTaskList: 10,
  /** listar tarefas pelo servidor MCP da máquina */ mcpTaskList: 11,
  /** ponte de tarefas (a IA daquela máquina) */ taskBridge: 12,
  /** configurar o task-mcp.json pela tela */ taskMcpConfig: 13,
  /** criar tarefa na fonte da própria máquina */ taskSourceWrite: 14,
  /** o CORPO do updater vem do Hub, conferido por hash (UPD-02) */ updaterFromHub: 15,
  /** abrir subsessoes na MAQUINA da sessao, e nao so no Hub */ fanoutOnRunner: 16,
  /** Espaco de Solucoes (Benchmark/Revisao/Auditoria) na MAQUINA da sessao */ tournamentOnRunner: 17,
  /** Debate iterativo na MAQUINA da sessao, com recado ao vivo */ debateOnRunner: 17,
  /** BRW-IDE-00 F3 — editor leve: `writefile` → `filesaved` (escrita com detecção de conflito) */ fileWrite: 18,
  /** BRW-IDE-00 F3 — busca de conteúdo no projeto: `searchfiles` → `searchresults` */ fileSearch: 18,
  /** BRW-IDE-00 F1 — browser remoto da máquina (perfil do dono), frames binários */ remoteBrowser: 18,
  /** BRW-IDE-00 F2 — ferramentas de browser para a IA desta máquina (ver/dirigir; níveis no runner) */ browserAgentTools: 19,
  /** BRW-IDE-00 F2 — "selecionar pontos": elemento sob o ponto + recorte, para o dono mandar à IA */ browserGrab: 19,
} as const;

/** Sent by the Runner at `register` time and kept in the Hub registry. */
export interface RunnerInfo {
  runnerId: string;
  host: string; // os.hostname()
  os: RunnerOS;
  agents: string[]; // available adapter names, e.g. ["claude-code","codex","mock"]
  /** Canonical adapter descriptors. `agents` remains for backward compatibility with v1 Hubs. */
  agentDescriptors?: unknown[];
  /** Account-plan snapshots by adapter; null means the CLI exposes no usable limit data. */
  agentUsage?: Record<string, unknown | null>;
  protocolVersion?: number;
  version?: string;
  /** Human-readable build id from `git describe` (tag + commits-ahead + sha), e.g. "v0.5.1-27-g862e9d3".
   *  Optional/additive: an old runner that doesn't send it just falls back to `commit` in the UI, so no
   *  protocol bump is needed. Shown per machine so its version and distance-from-tag are legible. */
  build?: string;
  /** short git HEAD sha of the runner's checkout ("+dirty" suffix if uncommitted) — lets the Hub
   *  spot a runner drifting behind (or ahead of) the Hub's own build. */
  commit?: string;
  /** F: NOMES dos servidores MCP de tarefa na allowlist desta máquina (nunca comando/segredo) — é o
   *  que a tela de Configurações mostra para você saber o que está ligado em cada máquina sem abrir
   *  sessão nela. Aditivo: runner antigo simplesmente não manda, e a tela diz "—". */
  taskMcpServers?: string[];
  /** TSK-11 — esta máquina aceita servir a ponte de tarefas (a IA daqui mexendo em tarefas). */
  taskBridge?: boolean;
  /** TSK-12 — o caminho REAL da allowlist NESTA máquina. A tela mostrava o caminho do Hub como se
   *  fosse o da máquina remota: numa Luby Linux, aparecia um caminho C:\Users de Windows. */
  taskMcpConfigFile?: string;
  /** TSK-12 — esta máquina aceita ser configurada pela tela (`JARVIS_TASK_MCP_REMOTE_EDIT`). */
  taskMcpRemoteEdit?: boolean;
  /** TSK-13 — usos declarados por servidor: `{ "<nome>": { list, create } }`. Listar e criar são
   *  capacidades diferentes, e a tela não pode oferecer o que a máquina não declarou. */
  taskMcpUses?: Record<string, { list: boolean; create: boolean }>;
  /** Durable proof that dependencies/validation completed for a correlated update before restart. */
  updateReceipt?: { requestId: string; targetCommit: string; current: string; preparedAt: number };
  /** Durable failure/success log produced by an external updater before the runner restarted. */
  updateResult?: { requestId: string; ok: boolean; log?: string; current?: string; targetCommit?: string; restartRequired?: boolean; rolledBack?: boolean; retryable?: boolean; dirty?: boolean; behind?: number; preparedAt?: number };
  /** friendly name set at install (JARVIS_LABEL); the Hub uses it as the initial label */
  label?: string;
  /** true for the Hub's own embedded runner ("machine 0") */
  local?: boolean;
  /** BRW-IDE-00 F1 — esta máquina tem Chrome/Edge/Chromium e o browser remoto não foi desligado
   *  (`JARVIS_BROWSER=0`). O Hub só oferece o browser quando isto é true E o protocolo é ≥
   *  `RUNNER_CAPABILITY_SINCE.remoteBrowser`. O Chrome só sobe na primeira abertura. */
  browser?: boolean;
  /** BRW-IDE-00 F2 — esta máquina serve as ferramentas de browser às IAs dela (`JARVIS_BROWSER_AGENT=0`
   *  desliga). Só vale junto com `browser:true` e protocolo ≥ `RUNNER_CAPABILITY_SINCE.browserAgentTools`. */
  browserAgent?: boolean;
}

/** One session as listed by a Runner (managed by Jarvis, or a native CLI session). */
export interface RunnerSession {
  id: string;
  title: string;
  agent: string;
  cwd: string;
  updatedAt: number;
  source: "managed" | "native";
  /** native sessions may be read-only depending on the agent */
  writable?: boolean;
  /** Whether at least one message already exists; agent/cwd are locked once true. */
  started?: boolean;
}

export interface RunnerMsg {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ts?: number;
  /** role:"tool" — the tool name + (file tools) the real path, +/- line counts and diff rows */
  name?: string;
  /** role:"tool" — the FULL command/args behind the row (shown when expanded) */
  detail?: string;
  path?: string;
  adds?: number;
  dels?: number;
  rows?: DiffRowMeta[];
  /** role:"assistant" — the turn's grouped tool/sub-agent activity, so native history renders the
   *  same nested flow shown live (see @jarvis/core HistEvent). Opaque to the protocol layer. */
  activity?: unknown[];
  agent?: string;
  speaker?: string;
  images?: string[];
  files?: Array<{ name: string; content?: string }>;
  contextManifest?: ContextManifest;
  usage?: {
    costUsd?: number;
    costKind?: "billed" | "estimated_api_equivalent" | "subscription_included" | "tokens_only" | "unavailable";
    source?: string;
    model?: string;
    effort?: string;
    fastMode?: boolean;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    contextTokens?: number;
    contextWindowTokens?: number;
  };
}

/** Live activity while an agent works, mirrored to the streaming UI. */
export interface RunnerStreamEvent {
  kind: "start" | "text" | "tool" | "thinking" | "done" | "error" | "cancelled";
  text?: string; // text / thinking chunk, or final text on "done"
  name?: string; // tool name (Bash, Edit, Read…)
  summary?: string; // tool one-liner ("Editando foo.ts")
  detail?: string; // tool FULL command/args (untruncated), shown when the row is expanded
  usage?: RunnerMsg["usage"];
  /** tool_use id — lets sub-agent (Task) activity be correlated to a parent block */
  toolId?: string;
  /** parent_tool_use_id — set when this event happens INSIDE a spawned sub-agent (Task) */
  parentId?: string;
  /** for file tools: the real (usually absolute) file path, so the UI can open it */
  path?: string;
  /** for edits: line counts of this change */
  adds?: number;
  dels?: number;
  /** for edits: the diff rows of THIS specific change (for the inline expand) */
  rows?: DiffRowMeta[];
}

/** A file touched by tools in a session (real path + action + +/- line counts). */
export interface TouchedFileMeta { path: string; action: "read" | "edit" | "write" | string; adds: number; dels: number; }
/** One row of a rendered diff: ' ' context, '+' add, '-' del, '@' section marker. */
export interface DiffRowMeta { t: " " | "+" | "-" | "@" | string; s: string; }

/** A candidate dev-server preview URL discovered on the machine that owns a session (Design Mode, v8).
 *  Found by attributing a listening port to a process whose cwd is under the session's cwd, or by
 *  reading the URL a dev-server prints. The URL host is loopback for the local runner; a remote runner
 *  fills its own reachable (tailnet) host. */
export interface PreviewCandidate {
  url: string;
  port: number;
  source: "pty-advertised" | "port-scan";
  detectedAt: number;
}

/** Provider-neutral browser observation emitted by any future Browser Runtime/MCP/Runner adapter.
 *  Payloads are deliberately small and reference blobs/artifacts by id when needed. */
export type BrowserSessionEvent =
  | { kind: "opened"; pageId: string; url: string; title?: string; at: number }
  | { kind: "navigated"; pageId: string; url: string; title?: string; at: number }
  | { kind: "selection"; pageId: string; url: string; selector?: string; sourceRef?: { file: string; line?: number; column?: number; framework?: string }; screenshotName?: string; at: number }
  | { kind: "screenshot"; pageId: string; url: string; screenshotName?: string; at: number }
  | { kind: "console"; pageId: string; level: "log" | "info" | "warn" | "error"; text: string; at: number }
  | { kind: "network"; pageId: string; method?: string; url: string; status?: number; at: number }
  | { kind: "coverage"; pageId: string; url: string; jsFiles?: number; cssRules?: number; usedCssRules?: number; at: number }
  | { kind: "closed"; pageId: string; at: number };

/** v18 (F3) — versão no disco quando `writefile` encontra conflito. */
export interface FileSaveConflict { mtimeMs?: number; size?: number; missing?: boolean; exists?: boolean }
/** v18 (F3) — um acerto da busca no projeto. `hl` = [início, fim) do trecho casado DENTRO de `preview`. */
export interface FileSearchHitWire { path: string; rel: string; line: number; col: number; preview: string; hl: [number, number] }

/** Interactive terminal session hosted by one Runner/Hub machine. */
export interface TerminalInfo {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  createdAt: number;
  updatedAt: number;
}

// --- Browser remoto (BRW-IDE-00 F1) ---------------------------------------------------------------
// Um Chromium headless por PERFIL na máquina (F1 expõe só "owner"; "agent" é da F2), dirigido por CDP
// só em 127.0.0.1. Pela rede passam só metadados (URL, título, abas), input e frames — cookies e
// storage nunca saem da máquina (lei §3.1 da spec).
//
// Frames NÃO são JSON: vão como mensagem BINÁRIA do WebSocket (runner → Hub → cliente), com um
// cabeçalho fixo e o JPEG cru logo depois (o CDP entrega base64; cru economiza ~25% do fio):
//
//   off len  campo
//   0   1    kind = 0x42 ('B')      — os outros valores ficam livres; 0x54 foi do túnel da IDE (F4, removida)
//   1   1    versão do cabeçalho = 1
//   2   1    L = tamanho do pageId (1..64, ASCII)
//   3   1    qualidade JPEG usada (informativo)
//   4   4    seq (u32 BE, por página)
//   8   8    t0 (f64 BE, ms epoch em que o produtor recebeu o frame do Chrome)
//   16  2    largura do viewport em px CSS (u16 BE) — base da conversão de coordenadas do input
//   18  2    altura do viewport em px CSS (u16 BE)
//   20  L    pageId
//   20+L …   JPEG
//
// O Hub só lê o pageId (para rotear) e repassa o Buffer intacto. Codec em @jarvis/core (browser.ts).

export type BrowserProfileName = "owner" | "agent";

export interface BrowserPageInfo {
  /** targetId do CDP — único por Chrome; é o endereço de toda operação de página */
  pageId: string;
  url: string;
  title: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** aba aberta por outra (window.open/target=_blank) — o cliente pode segui-la */
  openerId?: string;
  /** diálogo JS aberto (alert/confirm/prompt/beforeunload): a página fica PARADA até alguém responder */
  dialog?: { type: string; message: string; defaultPrompt?: string };
  /** viewport sobrescrito (ex.: "ajustar à tela do celular"); ausente = janela padrão do Chrome */
  viewport?: { width: number; height: number; mobile: boolean };
  /** há espectador (screencast ligado) nesta aba agora */
  viewing?: boolean;
}

export interface BrowserStateInfo {
  profile: BrowserProfileName;
  /** o Chrome deste perfil está de pé */
  running: boolean;
  pages: BrowserPageInfo[];
  /** última aba ativada (por qualquer dispositivo do dono) — o cliente só adota ao abrir o painel */
  activePageId?: string;
  /** motivo da última parada ("idle", "shutdown", "exited", erro de launch…) */
  reason?: string;
}

/** Input do espectador. Coordenadas em px CSS do viewport (o cabeçalho do frame traz a base).
 *  `modifiers` segue o CDP: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export type BrowserInput =
  | { kind: "mouse"; type: "move" | "down" | "up"; x: number; y: number; button?: "left" | "middle" | "right" | "none"; buttons?: number; clickCount?: number; modifiers?: number }
  | { kind: "wheel"; x: number; y: number; dx: number; dy: number; modifiers?: number }
  | { kind: "key"; type: "down" | "up"; key: string; code?: string; modifiers?: number }
  /** texto pronto (teclado virtual do celular, IME, colar) — vira Input.insertText */
  | { kind: "text"; text: string };

// --- BRW-IDE-00 F2: a IA no browser (três níveis, spec §3.1) -----------------------------------------
// Ver (padrão): ferramentas só-leitura no perfil do DONO. Dirigir no perfil do agente: tudo no perfil
// `agent` (separado, sem logins do dono). Dirigir no perfil do dono: só com liberação EXPLÍCITA do dono
// para AQUELA sessão — expira no fim do turno, no "Assumir", na queda do link com o Hub ou em 30 min.
// Quem decide é a máquina dona do browser (um único lugar); o Hub só repassa a vontade do dono.

/** Uma liberação do nível 3 (IA dirigindo o perfil do dono) numa sessão desta máquina. */
export interface BrowserAgentGrantInfo {
  sessionId: string;
  /** sempre "owner" hoje — o perfil do agente não precisa de liberação */
  profile: BrowserProfileName;
  since: number;
  /** teto absoluto; antes disso a liberação cai no fim do turno da sessão */
  expiresAt: number;
  /** a sessão tem turno rodando agora (a IA pode estar agindo) */
  turnActive: boolean;
}

/** Uma ação da IA no browser — vai para o audit.log do Hub (NUNCA conteúdo de página nem texto digitado). */
export interface BrowserAgentActionInfo {
  sessionId: string;
  tool: string;
  profile: BrowserProfileName;
  pageId?: string;
  ok: boolean;
  /** resumo seguro: URL navegada, ref clicado, tecla, "N caracteres" — nunca o texto digitado */
  detail?: string;
  at: number;
}

/** Elemento sob o ponto que o dono marcou (seleção de pontos → IA). Texto já redigido de segredos. */
export interface BrowserGrabInfo {
  url: string;
  title?: string;
  tag: string;
  selector: string;
  role?: string;
  name?: string;
  text?: string;
  attributes?: Record<string, string>;
  htmlSnippet?: string;
  /** caixa do elemento em px CSS do viewport */
  rect: { x: number; y: number; width: number; height: number };
  viewport?: { width: number; height: number };
  /** quantos trechos parecidos com segredo foram trocados por [redacted] */
  redactions?: number;
  /** recorte do elemento (data URL JPEG), quando deu para capturar */
  image?: string;
}

// --- Runner -> Hub ---
export type RunnerToHub =
  | { t: "register"; token: string; info: RunnerInfo }
  /** Resultado do update NESTA máquina. Sem isso o Hub só sabia que enviou o pedido, e um
   *  update abortado (repo sujo) ficava invisível — o dono achava que tinha atualizado. */
  | { t: "update_done"; requestId?: string; ok: boolean; dirty?: boolean; behind?: number; log?: string; current?: string; restartRequired?: boolean; rolledBack?: boolean; retryable?: boolean }
  | { t: "busy"; message: string } // recusa de turno concorrente na mesma sessão
  | { t: "sessions"; sessions: RunnerSession[]; recentDirs?: string[] }
  | { t: "task_local_list"; reqId: string; sessionId: string; dir: string; files: Array<{ key: string; title: string; description?: string }>; cached: boolean; scannedAt: number; error?: string }
  /** v11: resposta da fonte MCP desta máquina. `dir` traz o rótulo do servidor (o que o painel
   *  mostra); nenhum segredo/comando volta — só as tarefas. */
  | { t: "task_mcp_list"; reqId: string; sessionId: string; server: string; files: Array<{ key: string; title: string; description?: string }>; scannedAt: number; error?: string }
  | { t: "caps"; agent: string; caps: unknown; agents?: string[]; agentUsage?: Record<string, unknown | null> }
  | {
      t: "history";
      reqId: string;
      sessionId: string;
      title: string;
      agent: string;
      cwd: string;
      writable: boolean;
      messages: RunnerMsg[];
      total: number;
      /** underlying native session id (e.g. the real claude session, for `claude --resume`) */
      nativeId?: string;
      inputTokens?: number;
      contextWindowTokens?: number;
      model?: string;
      effort?: string;
      permissionMode?: PermissionMode;
      /** files touched by tools in this session (real paths, for the viewer/diff panel) */
      files?: TouchedFileMeta[];
      /** Durable replay for the latest user turn that does not yet have a stored assistant reply. */
      liveActivity?: AgentEvent[];
      liveState?: ExecutionState;
      liveTurnId?: string;
      liveUpdatedAt?: number;
      liveTruncated?: boolean;
    }
  | { t: "filediff"; reqId: string; path: string; name: string; rows?: DiffRowMeta[]; adds?: number; dels?: number; error?: string }
  /** Canonical AgentEvent lifecycle. New Hubs/Runners must use this; `stream` remains read-only migration input. */
  | { t: "agent_event"; sessionId: string; agent?: string; event: AgentEvent }
  /** Live metadata update for a managed session, e.g. native CLI id discovered during first turn. */
  | { t: "session"; sessionId: string; nativeId?: string }
  /** The assistant reply is now durably present in sessions.json; live replay may be cleared. */
  | { t: "activity_committed"; sessionId: string; turnId: string }
  | { t: "context_manifest"; sessionId: string; manifest: ContextManifest }
  /** @deprecated v1 compatibility during rolling upgrades. */
  | { t: "stream"; sessionId: string; agent?: string; ev: RunnerStreamEvent }
  | { t: "message"; sessionId: string; message: RunnerMsg }
  | { t: "debate_started"; sessionId: string; debateId: string; debaters: string[]; maxRounds: number }
  | { t: "debate_progress"; sessionId: string; debateId: string; round: number; maxRounds: number; phase: string; rootExecutionId?: string; debaters: Array<{ label: string; state: string }>; interjected: number; canSay: boolean }
  | { t: "debate_said"; reqId: string; ok: boolean; sessionId: string; debateId?: string; pending?: number; msgId?: string; message: string }
  | { t: "activity"; sessionId: string; name?: string; summary?: string; detail?: string; path?: string; adds?: number; dels?: number; rows?: DiffRowMeta[]; background?: boolean }
  /** `readOnlyReason` (v18, aditivo): por que o editor não pode editar este arquivo sem perda. */
  | { t: "filecontent"; reqId: string; path: string; name: string; content?: string; size?: number; mtimeMs?: number; truncated?: boolean; error?: string; image?: boolean; mime?: string; readOnlyReason?: string }
  /** v18 (F3) — resultado de `writefile`. `conflict` = o disco não é mais a versão lida (a IA editou?):
   *  NADA foi gravado e vem a versão atual (`missing` = o arquivo sumiu; `exists` = criar por cima). */
  | { t: "filesaved"; reqId: string; path: string; name?: string; ok: boolean; mtimeMs?: number; size?: number; created?: boolean; conflict?: FileSaveConflict; error?: string }
  /** v18 (F3) — resultado de `searchfiles`. `truncated` = algum teto (resultados/tempo/bytes) cortou. */
  | { t: "searchresults"; reqId: string; cwd: string; query: string; results: FileSearchHitWire[]; truncated: boolean; engine?: "rg" | "node"; error?: string }
  /** directory listing for the folder browser (reply to Hub->Runner "listdir").
   *  `files` is present only when the request set `files:true` (the file-tree panel); the legacy
   *  folder-picker omits it and keeps seeing directories only. `path` is the NORMALIZED path that was
   *  listed (quotes stripped, `~` expanded); `requested` echoes the raw request so the client can match
   *  the reply to what it asked for. `drives` (Windows, at a drive root) and `error` (shown inside the
   *  picker, `entries` empty) are optional — an older runner omits them. */
  | { t: "dirs"; reqId: string; path: string; parent: string; entries: string[]; files?: string[]; drives?: string[]; error?: string; requested?: string }
  /** Correlated result of a remote delete. `ids` contains only sessions actually removed. */
  | { t: "deleted"; reqId: string; sessionId?: string; ids: string[]; ok: boolean; okCount: number }
  | { t: "runs"; active: string[] }
  /** Acknowledges Hub->Runner cancel; active=false lets the Hub clear stale busy state. */
  | { t: "cancel_result"; sessionId: string; active: boolean }
  /** available slash-commands / skills on this machine (reply to Hub->Runner "commands") */
  | { t: "command_list"; reqId?: string; commands: unknown[]; cwd?: string }
  /** "@" file-mention matches under a session's cwd (reply to Hub->Runner "mention") */
  | { t: "mention_list"; reqId?: string; files: string[] }
  /** Live account-plan snapshot for one adapter (reply to Hub->Runner "usage"). */
  | { t: "usage_info"; reqId: string; agent: string; plan: unknown | null; planStatus: "available" | "not_reported" | "unsupported" | "error"; /** Causa da falha (planStatus "error"). */ planError?: string }
  | { t: "memory_preview"; reqId: string; sessionId?: string; token: string; target: string; note: string; appendText: string; beforeHash: string; exists: boolean; expiresAt: number }
  | { t: "memory_applied"; reqId: string; token: string; sessionId?: string; ok: boolean; target?: string; beforeHash?: string; afterHash?: string; error?: string }
  /** Result of materializing a published Framework Jarvis on this machine (reply to framework_publish). */
  | { t: "framework_published"; requestId: string; ok: boolean; version?: number; hash?: string; written?: number; removed?: number; skipped?: boolean; error?: string }
  /** Preview URL candidates for a session's cwd (reply to Hub->Runner "preview_query"). */
  | { t: "preview_list"; reqId: string; sessionId: string; candidates: PreviewCandidate[] }
  /** Provider-neutral browser/runtime observation for a session. */
  | { t: "browser_event"; sessionId: string; event: BrowserSessionEvent }
  /** Interactive terminal lifecycle/output (reply to terminal_* Hub commands). */
  | { t: "terminal_opened"; reqId?: string; terminal: TerminalInfo }
  | { t: "terminal_output"; terminalId: string; data: string }
  | { t: "terminal_closed"; terminalId: string; exitCode?: number; signal?: number }
  | { t: "terminal_list"; reqId?: string; terminals: TerminalInfo[] }
  | { t: "terminal_error"; reqId?: string; terminalId?: string; message: string }
  /** v18 — estado do browser da máquina (abas, URL, título, rodando). Vai a cada mudança (com debounce)
   *  e como resposta a `browser_open` (com `reqId`). Frames vão à parte, em mensagem binária. */
  | { t: "browser_state"; reqId?: string; state: BrowserStateInfo }
  | { t: "browser_error"; reqId?: string; pageId?: string; message: string }
  /** v19 (F2) — liberações do nível 3 nesta máquina (a cada mudança e depois do `register`). */
  | { t: "browser_agent_state"; grants: BrowserAgentGrantInfo[] }
  /** v19 (F2) — a IA usou uma ferramenta de browser: o Hub audita e mostra no painel. */
  | { t: "browser_agent_action"; action: BrowserAgentActionInfo }
  /** v19 (F2) — resposta de `browser_grab`. */
  | { t: "browser_grab_result"; reqId: string; ok: boolean; error?: string; grab?: BrowserGrabInfo }
  /** Manual permission mode: a tool on THIS machine is blocked waiting for the user. The Hub owns the
   *  UI, so the runner relays the request and waits for the matching `permission_decision`. `id` is
   *  minted by the runner and is only meaningful for this runner's pending table. */
  | { t: "permission_request"; sessionId: string; id: string; tool: string; input: unknown; cwd?: string }
  /** TSK-11 — a IA desta máquina quer mexer nas tarefas do projeto dela. Quem tem a credencial é o
   *  Hub, então o runner NÃO decide nada: encaminha a intenção e espera `task_bridge_result`. O Hub
   *  resolve a conexão pelo vínculo do projeto DESTA máquina — é isso que impede uma máquina de
   *  alcançar a conta de um projeto que não está nela. */
  | { t: "task_bridge"; reqId: string; sessionId: string; op: "search" | "get" | "create"; args: Record<string, unknown> }
  /** Resposta ao pedido de remote do Hub: o `git remote` do projeto vive no disco DESTA máquina, e
   *  computá-lo no Hub devolvia o remote de outro repositório (ou nenhum). */
  | { t: "git_remote"; reqId: string; cwd: string; url?: string }
  /** TSK-12 — respostas da configuração de MCP. `servers` vem REDIGIDO: nomes de env, nunca valores. */
  | { t: "task_mcp_config"; reqId: string; configFile: string; schemaVersion: number; servers: Array<Record<string, unknown>>; error?: string }
  | { t: "task_mcp_config_set"; reqId: string; ok: boolean; error?: string }
  | { t: "task_mcp_test"; reqId: string; ok: boolean; count?: number; sample?: string[]; error?: string }
  | { t: "task_local_write"; reqId: string; ok: boolean; key?: string; error?: string }
  | { t: "task_mcp_create"; reqId: string; ok: boolean; key?: string; url?: string; error?: string }
  | { t: "error"; reqId?: string; message: string }
  | { t: "pong" }
  | ExecutionRunnerToHub;

// --- Hub -> Runner ---
export type HubToRunner =
  | { t: "welcome"; runnerId: string }
  | { t: "reject"; reason: string }
  | { t: "open"; reqId: string; sessionId: string }
  | {
      t: "send";
      sessionId: string;
      text: string;
      /** Bounded, short-lived Hub context prepended only to the agent input. The Runner must not
       * persist this field in chat history or context manifests. */
      contextPrefix?: string;
      agent?: string;
      cwd?: string;
      opts?: { model?: string; effort?: string; fastMode?: boolean; permissionMode?: PermissionMode };
      /** idempotency key — the Runner executes a given turnId at most once (dedupes re-delivery:
       *  client resend on reconnect, queue re-flush, WS redelivery). See @jarvis/core createSeenSet. */
      turnId?: string;
      /** attachments carried by a queue flush (top-level model/effort accompany them) */
      attachments?: Array<{ name: string; content: string; image?: boolean; binary?: boolean; mime?: string; size?: number }>;
      speaker?: string;
      model?: string;
      effort?: string;
      fastMode?: boolean;
      actor?: ContextActor;
      /** v19 (F2) — turno do DONO numa máquina que serve as ferramentas: o runner entrega a ponte MCP
       *  `jarvisbrowser` à IA deste turno (token por turno). Ausente/false = sem browser para a IA. */
      browser?: boolean;
    }
  | { t: "list" }
  /** Tarefas locais (`docs/features/*.md`) do projeto DESTA máquina. v10: antes o Hub varria o
   *  próprio disco e, para uma sessão remota, devolvia as features do projeto errado. */
  | { t: "task_local_list"; reqId: string; sessionId: string; featuresDir?: string; refresh?: boolean }
  /** v11: lista tarefas pelo servidor MCP configurado NESTA máquina. O Hub manda só o NOME do
   *  servidor (`server`) — a receita (comando, env, segredo) vive na allowlist do disco de lá. */
  | { t: "task_mcp_list"; reqId: string; sessionId: string; server?: string; refresh?: boolean }
  /** create a fresh managed session on the runner (reply: history with the new id) */
  /** `title`, `parentSessionId` e `seed` existem para o fan-out: a subsessao nasce ja com nome, com
   *  a mae registrada e com a mensagem que explica de que tarefa ela veio. Sem eles, o Hub teria de
   *  criar a sessao no PROPRIO disco — e a conversa nasceria numa maquina que nao e a do projeto. */
  | { t: "new"; reqId: string; agent?: string; cwd?: string; permissionMode?: PermissionMode; title?: string; parentSessionId?: string; seed?: string }
  /** Anexa uma mensagem a uma sessao que JA existe naquela maquina (o recado da mae do fan-out).
   *  Nao e um turno: nada e enviado para a IA, so entra no historico. */
  | { t: "session_note"; sessionId: string; text: string }
  /** folder browser for the "new conversation" dialog (reply: dirs) */
  | { t: "listdir"; reqId: string; path?: string; files?: boolean }
  /** change agent/cwd of a not-yet-started session (reply: history) */
  | { t: "configure"; reqId: string; sessionId: string; agent?: string; cwd?: string }
  | { t: "delete"; reqId: string; sessionId?: string; sessionIds?: string[]; alsoNative?: boolean }
  | { t: "readfile"; reqId: string; path: string; cwd?: string }
  /** v18 (F3) — gravar um arquivo do projeto. Só o DONO chega aqui (o Hub barra membro e audita).
   *  Sem `expectedMtimeMs` só cria (`create:true`); com ele, conflito em vez de sobrescrever.
   *  `force` = "sobrescrever mesmo assim" depois que o usuário viu o conflito. */
  | { t: "writefile"; reqId: string; path: string; cwd?: string; content: string; expectedMtimeMs?: number; expectedSize?: number; force?: boolean; create?: boolean }
  /** v18 (F3) — buscar conteúdo sob `cwd` (ripgrep se houver; senão varredura numa worker thread). */
  | { t: "searchfiles"; reqId: string; cwd: string; query: string; regex?: boolean; caseSensitive?: boolean; max?: number }
  | { t: "readdiff"; reqId: string; sessionId: string; path: string }
  | { t: "caps"; agent?: string }
  /** Query this machine's live account-plan usage for an adapter. */
  | { t: "usage"; reqId: string; agent?: string }
  /** Start a Jarvis Conselho workflow and persist the final synthesis into this managed session. */
  | { t: "council_start"; requestId: string; sessionId: string; requestText: string; mode: "quick" | "technical" | "critical" | "deep"; finalTaskId: string; title?: string; plan: ManagedExecutionPlanWire; policy?: ManagedExecutionPolicyWire }
  // Espaco de Solucoes na maquina da sessao. Mesmo formato do council: o Hub monta o plano (e e
  // dono da posse da execucao), a maquina executa e publica a mensagem final no store DELA.
  | { t: "tournament_start"; requestId: string; sessionId: string; requestText: string; mode: "benchmark" | "review" | "audit"; judgeTaskId: string; candidateTaskIds: string[]; title?: string; plan: ManagedExecutionPlanWire; policy?: ManagedExecutionPolicyWire }
  // Debate na maquina da sessao. Diferente do council/tournament, o Hub NAO monta plano: quem
  // escolhe os debatentes e o juiz e a maquina, porque disponibilidade de CLI e fato local dela.
  // O Hub manda o tema ja contextualizado (historico remoto) e o debateId, de que ele e dono.
  | { t: "debate_start"; requestId: string; sessionId: string; debateId: string; requestText: string; topic: string; agents?: string[]; effortLevel: string; maxRounds: number; policy?: ManagedExecutionPolicyWire }
  // Recado do usuario para o debate em andamento naquela maquina.
  | { t: "debate_interject"; reqId: string; sessionId: string; text: string; msgId?: string }
  /** Publish a Framework Jarvis snapshot to this machine; the Runner materializes it and replies
   *  framework_published. Content-addressed by `hash` — a machine already on that hash is a no-op. */
  | { t: "framework_publish"; requestId: string; version: number; hash: string; files: Array<{ path: string; content: string }> }
  /** enumerate this machine's slash-commands / skills (reply: command_list) */
  | { t: "commands"; reqId: string; sessionId?: string }
  /** "@" file-mention search under a session's cwd (reply: mention_list) */
  | { t: "mention"; reqId: string; q?: string; sessionId?: string }
  /** Preview a provider-instruction write without modifying the runner filesystem. */
  | { t: "memory_preview"; reqId: string; text: string; sessionId?: string; actor?: ContextActor }
  /** Apply a previously previewed, one-time write. */
  | { t: "memory_apply"; reqId: string; token: string }
  /** Invalidate a preview without writing; idempotent cleanup for multi-device HITL. */
  | { t: "memory_cancel"; token: string }
  /** @deprecated v4 compatibility. New Hubs must use preview/apply. */
  | { t: "memory_append"; text: string; sessionId?: string }
  /** Drop the trailing user message from a managed session after a cancelled turn. */
  | { t: "dropLast"; sessionId: string }
  | { t: "stop"; sessionId: string }
  | { t: "cancel"; sessionId: string } // abort a live turn (user hit "parar")
  /** `requestId` correlates a durable Hub deployment; old runners may ignore the extra fields.
   *  force discards local changes on disposable child machines and may be persisted by the Hub
   *  for offline fleet updates. The Hub's own checkout remains conservative unless forced there. */
  /** UPD-02 — `script` é o CORPO do updater (a lógica), gerado pelo HUB e conferido por
   *  `scriptSha256` antes de rodar. Ausente, ou hash divergente, a máquina usa o próprio — que é
   *  o comportamento de sempre e também a rota de rollback. */
  | { t: "update"; requestId?: string; targetCommit?: string; force?: boolean; script?: string; scriptSha256?: string }
  /** Ask this machine for dev-server preview URLs under a session's cwd (Design Mode). */
  | { t: "preview_query"; reqId: string; sessionId: string }
  /** Interactive terminal control. Only Hubs should send these; authz is enforced at the Hub. */
  | { t: "terminal_open"; reqId: string; cwd?: string; shell?: string; title?: string; cols?: number; rows?: number }
  | { t: "terminal_input"; terminalId: string; data: string }
  | { t: "terminal_resize"; terminalId: string; cols: number; rows: number }
  | { t: "terminal_close"; terminalId: string }
  | { t: "terminal_list"; reqId?: string }
  /** v18 — browser remoto. Authz (só o DONO) é do Hub; o runner só executa. Operações de página são
   *  endereçadas pelo `pageId`; perfil só aparece onde há escolha (abrir/encerrar). */
  | { t: "browser_open"; reqId: string; profile: BrowserProfileName }
  | { t: "browser_tab"; reqId?: string; op: "new" | "close" | "activate"; pageId?: string; url?: string; profile?: BrowserProfileName }
  | { t: "browser_nav"; pageId: string; url?: string; action?: "back" | "forward" | "reload" | "stop" }
  | { t: "browser_input"; pageId: string; input: BrowserInput }
  /** Liga/desliga o screencast da aba. O HUB conta os espectadores e só manda `on:false` quando o
   *  último sai; `maxWidth/maxHeight` = a MAIOR tela entre os espectadores (px de dispositivo). */
  | { t: "browser_view"; pageId: string; on: boolean; maxWidth?: number; maxHeight?: number }
  /** Retorno do relay (≈1/s por aba assistida): frames entregues e descartados por crédito esgotado.
   *  Alimenta a qualidade adaptativa no produtor. */
  | { t: "browser_feedback"; pageId: string; delivered: number; dropped: number }
  /** Sobrescreve o viewport da aba ("ajustar à tela"); sem `width` volta ao padrão. */
  | { t: "browser_viewport"; pageId: string; width?: number; height?: number; mobile?: boolean; scale?: number }
  /** Responde o diálogo JS aberto na aba (alert/confirm/prompt/beforeunload). */
  | { t: "browser_dialog"; pageId: string; accept: boolean; promptText?: string }
  /** Encerra o Chrome do perfil (o perfil continua no disco). */
  | { t: "browser_shutdown"; profile: BrowserProfileName }
  /** v19 (F2) — o dono liga/desliga o nível 3 (IA dirigindo o perfil DELE) para uma sessão; `all` +
   *  `on:false` = "Assumir" (revoga tudo nesta máquina na hora). Resposta: `browser_agent_state`. */
  | { t: "browser_agent_grant"; sessionId?: string; on: boolean; all?: boolean }
  /** v19 (F2) — seleção de pontos: o elemento sob (x,y) em px CSS da aba + recorte. Resposta: `browser_grab_result`. */
  | { t: "browser_grab"; reqId: string; pageId: string; x: number; y: number }
  /** The user answered a `permission_request` this runner relayed. Unknown/expired ids are ignored
   *  (already settled or timed out → the runner already failed it closed). */
  | { t: "permission_decision"; sessionId: string; id: string; behavior: "allow" | "deny"; updatedInput?: unknown; message?: string }
  /** TSK-11 — resultado do pedido da ponte. Nunca carrega credencial: só o rótulo da conexão. */
  | { t: "task_bridge_result"; reqId: string; ok: boolean; code?: string; error?: string; connection?: string;
      results?: Array<{ tracker: string; key: string; title: string; state?: string; url?: string }>;
      task?: { tracker: string; key: string; title: string; description?: string; url?: string };
      key?: string; url?: string }
  /** Pergunta o `git remote` de uma pasta DESTA máquina (guarda-corpo de conta errada na escrita). */
  | { t: "git_remote"; reqId: string; cwd: string }
  /** TSK-12 — ler, gravar e testar a allowlist de MCP DESTA máquina. Quem valida e grava é ela: o Hub
   *  encaminha a intenção, como na ponte de tarefas. Nenhum valor de env viaja de volta. */
  | { t: "task_mcp_config"; reqId: string }
  | { t: "task_mcp_config_set"; reqId: string; name: string; server?: Record<string, unknown>; remove?: boolean }
  | { t: "task_mcp_test"; reqId: string; name: string }
  /** TSK-13 — criar um arquivo de feature na pasta declarada do projeto, NESTA máquina. O caminho é
   *  contido pela mesma função da leitura, e arquivo existente NÃO é sobrescrito: criar não é editar. */
  | { t: "task_local_write"; reqId: string; sessionId: string; featuresDir?: string; title: string; description?: string }
  /** TSK-13 — chamar a ferramenta de CRIAÇÃO declarada em `uses.tasks[<servidor>].create`. */
  | { t: "task_mcp_create"; reqId: string; server?: string; title: string; description?: string }
  | { t: "ping" }
  | ExecutionHubToRunner;

export type RunnerProtocol = RunnerToHub | HubToRunner;
