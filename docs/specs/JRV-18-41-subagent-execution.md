---
feature_id: JRV-18-41-subagent-execution
tldr: "Toda IA terá subprocessos observáveis por um grafo nativo ou gerenciado pelo Jarvis."
title: "Grafo agnóstico de subagentes e trabalhos em segundo plano"
owner: "Jonathan / Codex"
status: implemented
risk_level: high
stack: node
services_affected: [core, protocol, hub, runner, web, mcp, scripts, docs]
dependencies: [JRV-01-17-agent-parity]
schema_required: false
schema_dependencies: []
links:
  roadmap: "../agent-parity-matrix.md#63-conteúdo-do-stream"
  design: "Referências visuais fornecidas pelo usuário em 2026-07-20"
  adr: "N/A"
approval_evidence: "Usuário em 2026-07-20 aprovou a arquitetura híbrida, o escopo, o anti-escopo, o breakdown completo EXEC-01..12 / ADP-01..12 e esta especificação executável."
implementation_evidence: "Contrato/journal/tracker, protocolo Runner v6, replay durável do chat, painel Trabalhos, fallback gerenciado local/remoto, settings, retenção, perfis e entradas de mapper dos 12 adapters e MCP jarvis_delegate implementados no working tree em 2026-07-21; corpus versionado completo, gate final e canaries externos continuam separados."
---

# Executable spec

## 0) Meta (TL;DR)

Antes desta iniciativa, o Jarvis agrupava ferramentas de um subagente Claude por `toolId/parentId`,
mas não possuía uma entidade durável para o filho, seu estado, transcript, métricas ou descendentes.
A implementação introduz um grafo canônico de execuções que recebe eventos nativos quando o
fornecedor os publica e usa orquestração Jarvis como fallback seguro. O mesmo contrato alimenta
atividade inline, painel global, transcript, controles, histórico, Hub local e Runner remoto sem
inventar progresso.

### 0.1 Implementation status

- `packages/protocol/src/execution.ts` é o contrato canônico; Hub e Runner negociam protocolo v6.
- `ExecutionStore` mantém journal fsynced, snapshot/replay, manifesto, idempotência, compactação de
  raízes terminais e remoção por sessão. O Hub espelha journals remotos sem fabricar terminal.
- O painel global **Trabalhos** lista a árvore autorizada, transcript, arquivos/diffs, `+/-`, métricas,
  conexão, truncamento, deep-link e somente os controles declarados pela capability.
- O fallback Jarvis-managed executa DAGs em máquina fixa, usa sessões internas ocultas e falha antes
  do spawn se não houver read-only real ou worktree + prevenção de commit para um escritor.
- O MCP `jarvis_delegate` valida uma DAG explícita. `mode:"wait"` (default) devolve à IA chamadora o
  estado terminal e o resumo sanitizado de cada tarefa; `mode:"background"` devolve aceite/root ID
  imediatamente e mantém o workflow assíncrono em Trabalhos. Em `wait`, o snapshot filtrado pela raiz
  é lido em páginas correlacionadas de 500 nós, com deduplicação e limite defensivo de 100 páginas;
  timeout de espera nunca cancela o job.
- Os 12 adapters possuem perfil e entrada de fixture-mapper. Há casos sintéticos representativos para
  os mappers implementados, mas ainda não um corpus versionado completo para os 12; somente capacidades
  verificadas localmente sobem de certificação. CLIs ausentes permanecem `fixture_only`, `unverified`
  ou `unavailable`.
- Testes automatizados cobrem o workflow gerenciado mock local e remoto. Um canary Chrome temporário
  passou em desktop e 390×844 (inline, árvore, transcript, arquivos, métricas e deep-link).
  Browser/a11y automatizado, reconnect/restart no meio de uma ferramenta, dois clientes e canaries
  autenticados continuam no gate residual; `implemented` aqui não significa `reviewed` ou
  `gate-approved`.

## 1) Context and objective

### 1.1 Problem

No baseline anterior, subagentes eram representados como uma ferramenta especial dentro do turno. A correlação simples
não distingue fila, execução, espera por aprovação, conclusão, falha ou processo órfão; não contabiliza
uso por filho; não preserva um transcript individual; não representa workflows/DAGs; e depende do
formato Claude. Vários fornecedores já possuem árvores próprias, mas expõem IDs, estados, sessões e
controles incompatíveis. Adapters final-only não têm uma superfície nativa observável.

### 1.2 Objective (Definition of Value)

O usuário consegue acompanhar todo trabalho delegado em um único lugar, abrir qualquer filho,
entender o que ele publicou, ver ferramentas/arquivos/uso, identificar bloqueios e controlar somente
o que a capability real permite. Uma IA sem subagentes nativos continua capaz de participar por
filhos gerenciados pelo Jarvis. Refresh, restart, Runner remoto e outro dispositivo preservam a mesma
visão ou declaram honestamente que a execução ficou órfã/indeterminada.

### 1.3 Out of scope

- Escolher ou trocar automaticamente a máquina da sessão.
- Inventar texto, thinking, tool calls, estados, custo ou relações que o fornecedor não publicou.
- Expor chain-of-thought privado; somente mensagens, resumos e thinking explicitamente publicados.
- Prometer steering, cancelamento, resume ou retry nativo sem capability verificada.
- Marcar como certificado um CLI/modelo/effort não testado na máquina.
- Instalar ou autenticar CLIs externos como parte desta feature.
- Fazer commit, push ou merge automático de alterações produzidas em worktrees.
- Substituir o armazenamento local por banco SQL.
- Remover o lifecycle `AgentEvent`/atividade inline existente durante a migração.

## 2) Dual-source planning

### 2.1 Roadmap (compass)

- `docs/agent-parity-matrix.md`, requisitos A-EVT-06, A-SES-03..07, M-09 e matriz de validação.
- Breakdown aprovado: EXEC-01..12 (capacidades comuns) e ADP-01..12 (certificação individual).

### 2.2 Detailed references (map)

- `packages/protocol/src/agent.ts` — lifecycle canônico `AgentEvent` v1.
- `packages/protocol/src/runner.ts` — transporte Hub/Runner e histórico rico.
- `packages/protocol/src/execution.ts` — grafo, eventos, frames browser/Runner e wire da delegação.
- `packages/core/src/agents.ts` — `StreamEvent`, bridge e adapters.
- `packages/core/src/execution-store.ts` / `execution-tracker.ts` — journal, reducer, replay e bridge
  do lifecycle do turno.
- `packages/core/src/execution-adapters.ts` — perfis E0–E5 e entradas de mapper dos 12 adapters;
  `execution-adapters.test.ts` contém amostras sintéticas, não um corpus certificado por versão.
- `packages/core/src/execution-policy.ts`, `execution-orchestrator.ts`, `execution-worktree.ts`,
  `execution-redact.ts` e `managed-execution.ts` — fallback fail-closed compartilhado por Hub/Runner.
- `packages/core/src/native.ts` — sidechains Claude e transcripts Claude/Codex.
- `packages/core/src/store.ts` — histórico gerenciado e activity persistida.
- `packages/core/src/usage-ledger.ts` — custo/usage tipado.
- `apps/hub/src/index.ts` — runs, replay, fila, cancelamento e relay remoto.
- `apps/runner/src/index.ts` — execução e persistência na máquina remota.
- `apps/hub/web/app.js` / `index.html` — atividade inline/subagente e shell responsivo.
- `apps/mcp/src/delegate.ts` / `index.ts` — validação e ferramenta `jarvis_delegate`.
- Documentação oficial de subagentes: Codex, Gemini, Cursor, Copilot, OpenCode, Cline, Qwen, Kiro e Antigravity, registrada no discovery de 2026-07-20.

### 2.3 Gap scan na aprovação

- Na aprovação, o working tree continha a implementação ainda não commitada de roteamento Automático. Esta feature
  deve ser desenvolvida de modo aditivo e não pode apagar ou reformatar mudanças sobrepostas.
- `AgentEvent` não carrega uma identidade de execução aplicável a texto/thinking/usage; `parentId`
  existe somente em ferramentas.
- `activityBuf` tem limite de 600 eventos e não informa truncamento ao usuário.
- O replay remoto atual depende de outbox em memória e a queda do Runner converte atividade pendente
  em `cancelled`; para background jobs, desconexão é conectividade desconhecida, não terminal.
- Eventos nativos de Claude são parcialmente reconstruídos; Codex não mapeia threads-filhas;
  structured adapters mapeiam ferramentas, mas não um lifecycle de filhos.
- Continue e Aider não têm superfície pública de subagente comprovada; usam fallback Jarvis.
- Kiro exige sair do adapter final-only para uma interface estruturada (preferencialmente ACP).
- Antigravity permanece não executável no adapter atual até existir probe headless verificável.
- Sem DDL/migration: `schema_required=false`; a persistência continua em arquivos sob `~/.jarvis`.

### 2.4 Delta

Além do `parentId`, introduzir identidade, estado, transcript, métricas, capabilities, dependências e
origem de cada execução. Criar uma visão global e uma visão detalhada. Fornecer orquestração Jarvis
somente quando a superfície nativa for inexistente/insuficiente, sem substituir árvores nativas.

## 3) Rules and invariants (SYSTEM LAWS)

1. **Verdade do fornecedor:** um collector só emite valores observados; ausência vira capability
   ausente, estado `unknown` ou certificação `partial`, nunca um evento sintético com aparência nativa.
2. **Uma identidade canônica:** IDs do fornecedor são opacos e mapeados de forma estável para um
   `executionId` namespaced por máquina/sessão/turno; cada raiz possui um `journalId` e nenhum ID bruto
   é assumido globalmente único.
3. **Raiz fixa:** todos os nós pertencem a um único `rootTurnId`, sessão e máquina. Nenhum filho muda
   de máquina automaticamente.
4. **Ordem/idempotência:** eventos possuem `eventId` e `seq` global por raiz; o owner persiste antes
   de transmitir, duplicados não alteram contadores e gaps bloqueiam aplicação até replay.
5. **Terminal único:** `succeeded`, `failed` e `cancelled` são terminais. Retry cria outro nó com
   `retryOf`; não reabre nem reescreve um terminal.
6. **Transições fechadas:** `queued→running|failed|cancelled|orphaned`; `running↔waiting_input` e
   `running→succeeded|failed|cancelled|orphaned|unknown`; `waiting_input→running|failed|cancelled|orphaned|unknown`;
   `unknown→queued|running|waiting_input|succeeded|failed|cancelled|orphaned`; e
   `orphaned→running|succeeded|failed|cancelled` somente por reconciliação explícita. Transição para
   `unknown` exige diagnóstico explícito de perda da observação; desconexão de
   transporte nunca é traduzida diretamente para um estado terminal.
7. **Uso sem duplicidade:** usage de filho é atribuído ao filho; agregados somam folhas/usage
   explicitamente scoped e nunca contabilizam novamente um total já inclusivo do pai.
8. **Thinking seguro:** armazenar/exibir somente conteúdo que o fornecedor classificar como
   publicável. Evento de reasoning sem texto pode renderizar apenas “Pensando…”.
9. **Capacidade honesta:** botões de cancelar, steer, retry, resume, aprovação e transcript dependem
   de capability por adapter/versão/modelo/effort/máquina e mostram o motivo quando desabilitados.
10. **Cancelamento em árvore:** cancelar a raiz solicita cancelamento dos descendentes; falha de um
    filho não é escondida. Cancelamento parcial reporta quais nós não puderam ser interrompidos.
11. **Permissões herdadas:** filho nativo respeita a política do fornecedor; filho Jarvis herda o
    limite mais restritivo entre pai, configuração e perfil. Ele nunca amplia permissões sozinho.
12. **Isolamento de escrita:** fallback Jarvis somente leitura pode compartilhar cwd; filho com
    escrita usa worktree isolado por padrão. Mesmo cwd concorrente exige opt-in explícito e aviso.
13. **Segredos:** prompts, argumentos, stdout e tool results passam pelo redator existente/novo antes
    de broadcast/persistência. Tokens, chaves e credenciais não entram em logs de diagnóstico.
14. **Compatibilidade:** `AgentEvent` v1 e a UI inline continuam funcionando. O grafo é aditivo e um
    cliente antigo ignora frames novos sem perder a resposta principal.
15. **Paridade de transporte:** Hub local e Runner usam o mesmo reducer/store; Runner muda apenas o
    transporte e a propriedade da execução.
16. **Limites visíveis:** atingir cap de eventos/transcript produz `truncated=true` e um marcador na
    UI; não descarta silenciosamente o meio de uma execução.
17. **Retenção:** o resumo e os agregados permanecem com a sessão; eventos detalhados obedecem uma
    retenção configurável (default 30 dias) e são removidos ao excluir a sessão.
18. **Observabilidade:** cada erro/latência inclui `runnerId`, `sessionId`, `rootTurnId`,
    `executionId`, `agent`, `model`, `origin`, `providerVersion` e `state`, quando conhecidos.
19. **Entrega pelo menos uma vez, projeção uma vez:** transporte pode redeliver; journal e reducer
    persistem/aplicam cada `eventId` uma única vez. Um gap nunca é ocultado por um snapshot mais novo.
20. **Comandos idempotentes:** control/input possui `requestId` persistido com resultado; retry de
    rede retorna o mesmo resultado e nunca dispara cancelamento, aprovação ou steer duas vezes.
21. **Métricas com escopo:** UI e API distinguem métricas próprias (`self`) das inclusivas da
    subárvore (`subtree`); valor indisponível aparece como indisponível, não como zero observado.
22. **Nó é trabalho, não qualquer tool:** comando shell síncrono normal do turno continua como
    atividade; só vira `process` separado quando possui lifecycle assíncrono/identidade própria.

## 4) Contracts (APIs / events / tools)

### 4.1 Tipos canônicos

Novo `packages/protocol/src/execution.ts`:

```ts
export const EXECUTION_SCHEMA_VERSION = 1 as const;

export type ExecutionKind = "turn" | "workflow" | "phase" | "agent" | "process";
export type ExecutionState =
  | "queued" | "running" | "waiting_input"
  | "succeeded" | "failed" | "cancelled" | "orphaned" | "unknown";
export type ExecutionOrigin = "native" | "jarvis_managed";
export type ExecutionCertification =
  "verified" | "partial" | "fixture_only" | "stale" | "unverified" | "unavailable";
export type TranscriptLevel = "none" | "summary_only" | "published_only" | "full";

export interface ExecutionCapabilities {
  source: "native_stream" | "native_hook" | "native_transcript" | "native_sdk" |
    "native_api" | "jarvis_managed" | "none";
  observe: "live" | "snapshot" | "terminal_only";
  transcript: TranscriptLevel;
  tools: boolean;
  cancel: "none" | "node" | "subtree" | "root";
  steer: "none" | "queued" | "running";
  retry: boolean;
  resume: boolean;
  input: "none" | "approval" | "question" | "both";
  files: "none" | "metadata" | "full";
  usage: "none" | "self" | "subtree";
  asynchronous: boolean;
  dependencies: boolean;
  maxDepth?: number;
  isolatedWorkspace: "native_worktree" | "jarvis_worktree" | "shared_cwd" |
    "read_only" | "unknown";
  reason?: string;
}

export interface ExecutionMetricSet {
  toolCalls?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  costKind?: CostKind;
}

export interface ExecutionMetrics {
  self: ExecutionMetricSet;
  subtree?: ExecutionMetricSet;
}

export interface ExecutionArtifact {
  artifactId: string;
  executionId: string;
  kind: "file" | "diff" | "log" | "report";
  name: string;
  relativePath?: string;
  mime?: string;
  size?: number;
  sha256?: string;
  redacted?: boolean;
}

export interface ExecutionNode {
  schemaVersion: typeof EXECUTION_SCHEMA_VERSION;
  journalId: string;
  executionId: string;
  rootExecutionId: string;
  rootTurnId: string;
  sessionId: string;
  runnerId: string;
  parentExecutionId?: string;
  providerExecutionId?: string;
  retryOf?: string;
  dependsOn: string[];
  depth: number;
  kind: ExecutionKind;
  origin: ExecutionOrigin;
  certification: ExecutionCertification;
  state: ExecutionState;
  title: string;
  role?: string;
  prompt?: string;
  summary?: string;
  currentStep?: string;
  agent?: string;
  model?: string;
  effort?: string;
  acquisitionSurface?: string;
  adapterVersion?: string;
  providerVersion?: string;
  cwd?: string;
  worktree?: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  archivedAt?: number;
  capabilities: ExecutionCapabilities;
  metrics: ExecutionMetrics;
  truncated?: boolean;
}
```

`ExecutionEvent` é uma união discriminada fechada. Campos comuns: `schemaVersion`, `journalId`,
`eventId` (`journalId:seq`), `executionId`, `rootExecutionId`, `rootTurnId`, `seq` global por raiz,
`at` e `providerAt?`. Payloads permitidos:

- `node_created { node }`
- `state_changed { from, to, reason? }`
- `message { role: "assistant"|"system"; text; published: true }`
- `thinking { text?; published: true }`
- `agent_event { event: AgentEvent }`
- `usage { usage: UsageRecord; measure: "delta"|"cumulative"; scope: "self"|"subtree" }`
- `input_requested { inputId; inputKind: "approval"|"question"; summary; choices?; expiresAt? }`
- `input_resolved { inputId; state: "answered"|"approved"|"rejected"|"expired"; answer? }`
- `artifact { artifact: ExecutionArtifact }`
- `archived { archived: boolean }`
- `dependency { dependsOn }`
- `summary { text }`
- `truncated { dropped; reason }`
- `diagnostic { level; code; message }`

Novos tipos não usam `any`; payloads desconhecidos não entram no grafo público. Os mappers atuais os
ignoram defensivamente; telemetria estruturada de drift por provider/versão e rebaixamento automático
de certificação continuam pendentes.

### 4.2 Boundary adapter → lifecycle

`OnEvent` passa a aceitar `ProviderProgressEvent = StreamEvent | ProviderExecutionEvent`.

```ts
export type ProviderExecutionEvent =
  | { kind: "execution_spawn"; providerId: string; parentProviderId?: string; node: ProviderExecutionNode }
  | { kind: "execution_state"; providerId: string; state: ExecutionState; summary?: string; at?: number }
  | { kind: "execution_activity"; providerId: string; event: StreamEvent }
  | { kind: "execution_usage"; providerId: string; usage: UsageRecord;
      measure?: "delta" | "cumulative"; scope?: "self" | "subtree" };
```

Hub e Runner interceptam eventos `execution_*` antes do `AgentEventBridge` e os persistem no journal
do nó. Um `node_created` da sessão atualmente aberta cria um card inline ao vivo ligado pelo mesmo
`executionId`; estados seguintes atualizam esse card e o botão abre **Trabalhos**. O chat histórico,
porém, só recompõe `StoredMessage.activity`: um evento nativo que não teve `AgentEvent` equivalente
permanece durável no journal/painel, não é sintetizado dentro do bubble após reload.

### 4.3 WebSocket browser ↔ Hub

Cliente → Hub:

- `{ t:"executions_list", requestId?, scope:"all"|"session", sessionId?, rootExecutionId?, runnerId?, states?, cursor?, limit? }`
- `{ t:"execution_open", executionId, cursor?, limit? }`
- `{ t:"execution_control", requestId, executionId, action:"cancel"|"cancel_subtree"|"steer"|"retry", message? }`
- `{ t:"execution_input", requestId, executionId, inputId, decision:"approve"|"reject"|"answer", answer? }`
- `{ t:"execution_archive", requestId, executionId, archived: boolean }`
- `{ t:"execution_delegate", requestId, title?, plan:{rootExecutionId,runnerId,tasks}, policy? }`

Hub → cliente:

- `{ t:"executions_snapshot", scope, nodes, nextCursor?, generatedAt }`
- `{ t:"execution_delta", event }`
- `{ t:"execution_transcript", executionId, node, events, nextCursor?, truncated }`
- `{ t:"execution_control_result", requestId, executionId, ok, affectedIds, unsupportedIds, error? }`
- `{ t:"execution_input_result"|"execution_archive_result", requestId, executionId, ok, error? }`
- `{ t:"execution_delegate_result", requestId, ok, rootExecutionId?, error? }`
- `{ t:"execution_error", code, message, executionId? }`

Erros fechados: `NOT_FOUND`, `FORBIDDEN`, `UNSUPPORTED`, `INVALID_STATE`, `CONFLICT`,
`RUNNER_OFFLINE`, `PROVIDER_ERROR`, `LIMIT_REACHED`, `MALFORMED_REQUEST`.

### 4.4 Hub ↔ Runner

O Runner emite os mesmos `ExecutionEvent` em `{ t:"execution_event", sessionId, event }`, mantém o
journal autoritativo e responde manifest/replay paginado por `reqId`. O Hub produz o snapshot para o
browser a partir do mirror reconciliado. Controles do Hub carregam
`requestId` idempotente. `RUNNER_PROTOCOL_VERSION` é 6 e manifest/replay estão implementados nos dois
lados. Um Runner com versão incompatível é recusado no handshake e deve ser atualizado; o Hub não
permite uma conexão parcialmente compatível com semântica ambígua.
Delegação remota usa `execution_delegate`/`execution_delegate_result`; usage do filho volta em
`execution_usage_record`. Resultado de aceite é persistido/deduplicado por `requestId` no owner.
O Runner persiste o resultado dos controles. Em queda de link, o Hub marca conectividade offline e
mantém o último estado de execução até manifest/replay na reconexão. Se o processo owner reinicia sem
binding verificável, ele marca o nó ativo como `orphaned`; desconexão nunca vira `cancelled` por
inferência.

### 4.5 Persistência

- O owner local usa `~/.jarvis/executions/<hash-do-root>.jsonl`; Runner remoto mantém o journal na
  máquina dona e o Hub mantém mirror em `~/.jarvis/hub/executions/<runnerId>/`.
- Snapshots são projeções reconstruíveis; JSONL é a fonte de verdade.
- Store aplica reducer puro, valida sequência, deduplica `eventId` e gera snapshot atômico a cada
  200 eventos. Uma linha incompleta após crash interrompe o replay no último evento válido; alerta
  operacional explícito para esse tail ainda é gap conhecido.
- Owner faz append + flush/fsync antes de broadcast. Conteúdo publicável passa por limites e redação;
  arquivos/diffs entram como metadata/artifacts quando o adapter fornece evidência.
- Na reconexão, Hub pede manifest `{rootExecutionId,journalId,lastSeq}` e pagina os gaps. Troca de
  `journalId` tenta replay desde `seq=1` e preserva a visão anterior como `.stale-*`. Quando o cursor
  precede a janela do reducer, a API relê o JSONL autoritativo; gap ou journal divergente nunca é
  ocultado por um snapshot mais novo.
- Defaults: janela em memória de 5.000 eventos por raiz, 30 dias de detalhe, concorrência 6 e
  profundidade 3. O JSONL continua append-only e serve como fallback do replay paginado quando um
  cursor ficou fora da janela em memória. O cenário de overflow real da outbox seguido desse replay
  durável ainda precisa do canary de estresse listado no gate residual.
- Resultados idempotentes de controles/delegações ficam no estado operacional persistido do owner; o
  snapshot do grafo inclui o último `seq` aplicado. Divergência de `journalId` preserva o journal
  anterior como `.stale-*` antes de substituir o mirror.
- A retenção roda no boot e compacta somente raízes terminais antigas: preserva nós, estados, resumo e
  métricas, remove prompt/current step/worktree/artifacts/detalhes e acrescenta marcador `truncated`.
  Excluir a sessão remove seus journals. Leases de worktree são liberados separadamente após terminal,
  sempre por caminho validado dentro da raiz configurada.

### 4.6 Orquestração Jarvis fallback

- Ferramenta provider-neutral `jarvis_delegate` quando o adapter permite MCP/tools. A entrada atual é
  uma DAG JSON explícita; ainda não há decomposição implícita de texto livre pelo Jarvis.
- `rootExecutionId` opcional é uma semente estável; idempotência de reentrega continua no `requestId`.
  O MCP deriva o ID canônico de
  `machine + seed`, e correlaciona aceite, terminal e snapshot pelo mesmo par, evitando colisão entre
  Runners que recebem a mesma semente humana.
- Cada filho recebe prompt delimitado, sessão oculta própria, agente/modelo/effort válidos e política.
- Read-only é default. Escrita exige `write:true` e worktree criado/validado.
- Limites de concorrência/profundidade/orçamento são verificados antes do spawn.
- O aceite contém o root ID. Em `wait`, o mesmo tool call permanece correlacionado até o terminal,
  pagina `executions_list` filtrado pela raiz em blocos de 500 (até 100 páginas), deduplica nós e
  devolve resumos sanitizados e limitados dos filhos; em `background`, resultado/transcript
  permanecem no journal/painel e a resposta retorna imediatamente. Falha ao ler o snapshot não muda
  o terminal já observado: o retorno aponta para a execução durável. Timeout preserva o workflow.

### 4.7 Workflows/DAG

- `dependsOn` referencia somente nós da mesma raiz.
- O reducer rejeita ciclo, self-dependency e dependência ausente sem placeholder explícito.
- Um nó só sai de `queued` quando todas as dependências terminarem em `succeeded`, salvo política de
  continuação declarada.
- Loops nativos são registrados como novas tentativas/nós; um terminal nunca é reaberto.

## 5) Data models

### 5.1 Entrada

- IDs de entrada: 1–200 caracteres, sem controle/NUL. IDs canônicos são gerados pelo Jarvis; em
  delegação gerenciada a raiz é namespaced por máquina a partir da semente opcional do chamador.
- Títulos/resumos: 1–200 caracteres; prompts/mensagens limitados pelo cap configurado.
- `depth` de tarefa gerenciada: inteiro `1..32` e também limitado por `maxDepth`; a raiz canônica usa
  profundidade 0.
- `limit` de listagem/transcript: inteiro `1..500`; defaults atuais 100/200, respectivamente.
- `message` de steer: 1..8.000 caracteres, somente quando capability e estado permitem.
- `requestId`: UUID/id seguro já deduplicado pelo Hub/Runner.
- `dependsOn`: únicos, mesma raiz, sem ciclo.

### 5.2 Saída

- Toda resposta identifica versão, raiz, nó e sequência.
- Datas são epoch milliseconds, durações derivadas e nunca negativas.
- Métricas ausentes são `0`/campo ausente com origem; custo indisponível não vira `$0 cobrado`.
- `prompt`/detalhes podem vir redigidos com marcador explícito.
- Capability desabilitada inclui `reason` legível.
- `relativePath` de artifact é validado contra cwd/worktree e nunca permite navegação fora da raiz;
  conteúdo só é servido pelo endpoint autenticado existente, não dentro do frame WebSocket.

## 6) Flow

### 6.1 Happy path nativo

1. Hub inicia o turno raiz e cria `turn/root`.
2. Adapter observa spawn nativo e emite `execution_spawn` com ID opaco.
3. Store resolve/mapeia ID, persiste `node_created` e transmite `execution_delta`.
4. Activity do filho chega com provider ID e vira evento durável do nó; `AgentEvent.executionId`
   continua sendo usado quando a mesma activity veio pelo stream canônico do turno.
5. UI atualiza card inline ao vivo, painel global e detalhe aberto pelo mesmo delta. O painel/journal
   é a reconstrução durável universal; o bubble histórico só recompõe eventos também persistidos em
   `StoredMessage.activity`.
6. Usage do filho é persistido com escopo e agregado sem duplicar usage inclusivo do pai.
7. Estado terminal fecha duração; resultado resumido retorna ao pai.
8. Refresh pede snapshot/transcript e recompõe a mesma árvore.

### 6.2 Happy path fallback Jarvis

1. Usuário solicita delegação ou provider chama `jarvis_delegate`.
2. Policy valida máquina, IA disponível, profundidade, concorrência, orçamento e permissão.
3. Jarvis cria nós `queued`; filhos read-only compartilham cwd, escritores recebem worktree.
4. Scheduler executa independentes em paralelo e respeita `dependsOn`.
5. Cada adapter usa o lifecycle normal; seus eventos são atribuídos ao filho.
6. Em `wait`, o chamador recebe estado terminal e resumos dos filhos no retorno da própria ferramenta;
   em `background`, recebe aceite/root ID e acompanha resultado/transcript no painel.

### 6.3 Edge cases

1. Spawn chega antes do pai: criar placeholder interno por tempo limitado; resolver ou marcar drift.
2. Evento duplicado/reentregue: deduplicar por `eventId` sem incrementar ferramentas/usage.
3. Evento fora de ordem: buffer limitado; timeout produz `unknown/truncated`, nunca estado falso.
4. Evento após terminal: armazenar em drift e ignorar no reducer público.
5. Runner cai com filhos ativos: marcar `orphaned`; reconciliar após reconexão por IDs nativos.
6. Hub reinicia enquanto processo local segue vivo: reconciliar se houver binding; senão `orphaned`.
7. Pai termina antes do filho assíncrono: filho permanece ativo e vinculado à raiz.
8. Cancelamento parcial: retornar `affectedIds` e `unsupportedIds`; não declarar sucesso total.
9. Aprovação em filho não interativo: falhar rápido com motivo, sem aguardar indefinidamente.
10. Usage pai inclusivo + usage dos filhos: exibir composição, mas somar somente uma vez.
11. Cap de eventos: preservar começo, eventos terminais e tail; emitir `truncated` com quantidade.
12. Worktree não pode ser criada/limpa: não executar filho escritor no cwd compartilhado.
13. Sessão excluída durante execução: bloquear exclusão ou cancelar/confirmar conforme fluxo existente.
14. Adapter/versão muda formato: evento desconhecido aumenta parse-health e rebaixa certificação.
15. Provider sem nativo e fallback desabilitado: capability `unavailable` com motivo, sem botão falso.

## 7) Acceptance criteria (Gherkin)

```gherkin
Scenario: acompanhar dois subagentes nativos em paralelo
  GIVEN um adapter certificado publica dois filhos de um turno
  WHEN os filhos executam ferramentas simultaneamente
  THEN o painel mostra dois nós ativos com transcripts e estados independentes
  AND o chat mantém uma representação inline sem misturar os eventos

Scenario: reabrir durante execução remota
  GIVEN um filho está rodando em um Runner remoto
  WHEN o navegador recarrega e abre a sessão
  THEN snapshot e deltas recompõem o progresso sem duplicação
  AND o cronômetro mantém o startedAt original

Scenario: queda do transporte não fabrica cancelamento
  GIVEN um filho segue ativo no Runner e o link com o Hub cai
  WHEN o Hub perde contato antes de receber um terminal
  THEN a interface mostra Runner offline e preserva o último estado observado
  AND após timeout de reconciliação o nó pode virar órfão, mas nunca cancelado por inferência

Scenario: cancelar somente uma subárvore
  GIVEN dois ramos independentes estão em execução
  WHEN o usuário cancela um ramo
  THEN somente os nós canceláveis daquele ramo recebem cancelamento
  AND o outro ramo continua executando

Scenario: provider sem subagentes nativos
  GIVEN uma sessão Continue ou Aider com fallback Jarvis habilitado
  WHEN o usuário solicita pesquisa paralela
  THEN o Jarvis cria filhos gerenciados observáveis
  AND a origem aparece como Jarvis-managed, não nativa

Scenario: filho escritor isolado
  GIVEN um filho Jarvis-managed recebe permissão de escrita
  WHEN ele modifica arquivos
  THEN trabalha em worktree própria
  AND o painel atribui diff e arquivos ao filho sem alterar automaticamente a branch principal

Scenario: uso inclusivo não é cobrado duas vezes
  GIVEN o pai publica total inclusivo e os filhos publicam usage individual
  WHEN o painel calcula o agregado
  THEN mostra o detalhamento dos filhos
  AND o total financeiro usa uma única base de contabilização

Scenario: restart sem superfície de retomada
  GIVEN o Hub reinicia e não consegue reencontrar um processo ativo
  WHEN o store é reconstruído
  THEN o nó aparece como órfão com motivo
  AND nunca aparece como concluído

Scenario: evento futuro desconhecido
  GIVEN uma nova versão do CLI publica um tipo desconhecido
  WHEN o collector o recebe
  THEN o turno principal continua funcionando
  AND parse-health registra drift sanitizado e rebaixa a certificação quando necessário
```

### 7.1 Executable verification

| Criterion | Command/check | Expected result |
|---|---|---|
| Contratos compilam sem `any` novo | `npm run typecheck` | exit 0 |
| Reducer/idempotência/estados | `node --import tsx --test packages/core/src/execution*.test.ts` | todos passam |
| Perfis/mappers de execução | `node --import tsx --test packages/core/src/execution-adapters.test.ts packages/core/src/agents.test.ts` | perfis/entradas dos 12 consistentes; casos sintéticos passam sem promover CLIs ausentes |
| Hub↔Runner + workflows gerenciados | `npm run test:e2e` | chat remoto e DAG mock local/remota preservam aceite, terminal, ocultação e idempotência |
| Suíte inteira | `npm test` | zero falhas |
| Cliente válido | `node --check apps/hub/web/app.js` | exit 0 |
| Diff limpo | `git diff --check` | exit 0 |
| Relatório de capabilities | `npm run agents:report` | tier/origem por adapter e versão |
| UI desktop/mobile | teste DOM + inspeção em viewport desktop/mobile | happy path + erro + vazio |

## 8) Test plan

### 8.1 Unit

- Reducer: todas as transições válidas/inválidas, terminal único, retry, DAG/ciclos.
- Store: append, replay, snapshot, TTL, cap/truncamento, arquivo corrompido e recovery.
- ID mapping: colisões entre máquinas/sessões/providers.
- Usage: inclusive/exclusivo, cumulative/delta, ausência/custo tipado.
- Policy: profundidade, concorrência, orçamento, read-only/write/worktree.
- Redação: secrets em prompt, command e tool result.
- Mapper de cada adapter: spawn, nested, activity, usage, terminal, falha e unknown.

### 8.2 Integration

- `AgentAdapter → ProviderProgressEvent → ExecutionStore → WS snapshot/delta`.
- Hub local e Runner aplicam o mesmo reducer.
- Cancelamento node/subtree e resposta parcial.
- Fallback Jarvis com dois filhos read-only; `wait` devolve relatório terminal e `background` devolve aceite/root ID com resultado no journal/painel.
- Filho escritor em worktree; diff permanece isolado.
- Reconnect e restart com processo retomável e não retomável.

### 8.3 UI / E2E

- Indicador inline abre o filho correto.
- Acesso rápido `Trabalhos` mostra badge azul para ativos e âmbar para intervenção pendente.
- Painel: filtros Precisa de você/Em execução/Na fila/Concluídos/Todos, máquina, sessão e provider.
- Detalhe: breadcrumb, transcript, arquivos, métricas e capability controls.
- Estados loading, empty, error, offline, truncated, orphaned e approval.
- Deep-link `#session=<id>&work=<executionId>` abre o nó e sobrevive a refresh/back/forward.
- Mobile full-screen, foco restaurado, teclado, `aria-live` agregado e contraste WCAG 2.2 AA.
- Autoscroll só permanece ativo quando o usuário já está no fim; caso contrário surge “N novos”.
- Arquivar remove concluídos da visão padrão sem apagar journal/transcript; excluir continua separado.
- Dois browsers observam os mesmos deltas sem duplicação.

### 8.4 AI/provider regression

Corpus versionado obrigatório por adapter para certificação (ainda não completo):

1. session/init;
2. spawn e identidade do pai;
3. filho e neto;
4. texto parcial/final publicável;
5. tool start/completed/failed;
6. arquivo/diff;
7. usage individual/inclusivo;
8. aprovação/input;
9. terminal success/failure/cancel;
10. evento desconhecido;
11. transcript truncado/malformado;
12. reconciliação/restart.

Probe real é opt-in e persiste certificação por
`adapter + CLI version + model + effort + machine`. Fixture/documentação sem binário permanece
`fixture_only` ou `unverified`, conforme a existência de fixture executável; nunca promove suporte
automaticamente.

## 9) UX information architecture

```text
Chat
├── indicador inline do workflow/subagente
└── Trabalhos
    ├── Precisa de você
    ├── Em execução
    ├── Na fila
    ├── Concluídos
    └── Todos
        └── Workflow / fase / agente / processo
            ├── Atividade
            ├── Transcript
            ├── Arquivos
            └── Detalhes, uso e controles
```

- Entrada rápida `Trabalhos` fica junto aos atalhos do chat. Badge âmbar tem precedência sobre o azul;
  a ordenação padrão é intervenção, running, queued, falha recente e concluídos recentes.
- Desktop: drawer lateral reutiliza o shell do painel de arquivos (420–780 px); maximizado usa split
  tree/detalhe sem substituir o chat. Mobile: lista e detalhe são rotas/telas completas com back.
- Linha resumida: título, IA/modelo, estado textual, duração, tokens, tools e custo quando disponível.
- Fases usam árvore/DAG progressiva; não renderizar dezenas de pontos sem legenda/estado acessível.
- Transcript separa prompt delegado, mensagens publicadas, tools/results e resultado retornado.
- “Thinking” não equivale a transcript privado e nunca promete raciocínio integral.
- Files atribui arquivos/diffs a cada nó e sinaliza conflito quando dois filhos escrevem o mesmo alvo.
- Estado parcial/offline/truncado exibe o que está faltando e quando ocorreu a última atualização.
- “Arquivar” e “Excluir” são ações distintas; arquivar nunca remove transcript ou artefato.
- Árvores usam `role=tree/treeitem`, setas/Home/End; botões têm alvo mínimo 44 px, nome acessível,
  foco visível, restauração de foco e respeitam `prefers-reduced-motion`.
- Atualizações frequentes são agrupadas no `aria-live`; tools individuais não interrompem o leitor.

Critérios de usabilidade para o primeiro gate visual:

- 100% das execuções ativas alcançáveis em até dois acionamentos.
- Intervenção pendente reconhecível em até 10 segundos em teste moderado.
- Usuário identifica estado e origem sem depender de cor.
- Cancelamento exige confirmação com quantidade de descendentes afetados.
- Uma falha sempre oferece motivo e, se suportado, retry; nenhuma tela termina vazia.
- Fluxos críticos operáveis por teclado e leitor de tela.
- Gate de usabilidade: 90% de conclusão das tarefas críticas com 5–8 participantes e SUS ≥ 80.

## 10) Adapter acquisition and certification

Suporte é um vetor de capabilities, não um booleano. O tier resume o nível mínimo comum sem esconder
as capabilities individuais:

- **E0 — unavailable:** adapter não executa ou não possui fallback seguro nessa máquina.
- **E1 — boundary:** spawn Jarvis/native e terminal observáveis, sem lifecycle rico.
- **E2 — lifecycle:** IDs/parentesco/estado/concurrency verificáveis.
- **E3 — observable:** transcript publicável, tools, files, duração e usage conforme capability.
- **E4 — controllable:** ao menos um controle verificado de cancel/input/retry/steer.
- **E5 — recoverable:** reconcilia refresh, reconnect e restart sem fabricar terminal.

Ordem permitida de aquisição: SDK/API pública estruturada → stdout/event stream estruturado → hooks
documentados → transcript/store nativo estável → heartbeat de processo. PTY/scraping visual não
certifica lifecycle. Mais de uma fonte exige deduplicação por ID/seq e precedência documentada.

| Adapter | Fonte preferencial | Fallback | Tier máximo antes de probe |
|---|---|---|---|
| Claude Code | stream-json + sidechains/transcript | Jarvis-managed | E5 alvo; manter tier atual até fixture/canary |
| Codex | exec JSON + collaboration/child rollouts | Jarvis-managed | E5 alvo; E2 parcial até probe headless multi-agent |
| Gemini CLI | subagents nomeados como tools/eventos | Jarvis-managed | E3 alvo inicial, depth 1; E4 só com controle público |
| Cursor Agent | CLI local estruturado; SDK/store/hooks depois | Jarvis-managed | superfícies local/cloud certificadas separadamente |
| Copilot CLI | SDK lifecycle; CLI JSON como superfície separada | Jarvis-managed | unverified até fixture por superfície |
| OpenCode | server/SDK SSE: children/messages/diffs/permissions/abort | Jarvis-managed | E5 alvo |
| Cline | SDK subscriptions; diferenciar `use_subagents` de Agent Teams | Jarvis-managed | E5 alvo via SDK; read-only não promete escrita |
| Qwen Code | stream-json + hooks + OTel + transcript | Jarvis-managed | E5 alvo com dedupe entre fontes |
| Kiro | ACP JSON-RPC/event stream; `/spawn` não implica delegated agent | Jarvis-managed | E5 alvo após substituir final-only |
| Antigravity | API/headless estruturado somente após probe | nenhuma execução branded enquanto inexequível | E0 atual |
| Continue | nenhuma superfície nativa comprovada | Jarvis-managed | E1–E5 conforme executor fallback |
| Aider | nenhuma superfície nativa comprovada | Jarvis-managed + worktree + `--no-auto-commits` | E1–E3 fallback |

Collectors ficam isolados por provider e ignoram payloads desconhecidos sem quebrar o turno; a futura
telemetria de drift só poderá preservá-los de forma sanitizada. `agents:report` mostra o descriptor
atual, versão detectável do CLI, origem, tier E0–E5,
certification, capabilities e motivo sem gastar um turno. Persistência de último canary, tupla
certificada e hash no relatório continua pendente.

### 10.1 Regras de degradação

- Nó nativo só nasce após ID estável; antes disso a atividade permanece no pai com diagnóstico.
- O mesmo trabalho nunca aparece simultaneamente como nativo e Jarvis-managed.
- Transcript apenas resumido é rotulado `summary_only`; não é promovido para `published_only/full`.
- Processo que desaparece sem terminal vira `orphaned`; reconciliação é append-only.
- Controles sem capability ficam desabilitados com motivo e também são rejeitados no servidor.
- Usage declara `self` ou `subtree`; ausência não é inferida de duração, texto ou custo do pai.
- Se o adapter não consegue executar (Antigravity atual), o Jarvis não anuncia fallback com aquela
  marca. O fallback pode usar outra IA executável somente após escolha/política explícita.

### 10.2 Fixture, probe e validade da certificação

- Fixtures certificáveis removem segredos e preservam IDs, ordem, nesting, estados, tools, approvals,
  usage, malformed/unknown e reconciliação. Hoje todos os adapters possuem entrada de mapper, mas os
  testes são amostras sintéticas de profundidade desigual; não há ainda a mesma suíte versionada
  completa para cada provider. Continue, Antigravity e Aider retornam zero evento nativo por desenho.
- Probe real é opt-in, com repositório descartável, prompt fixo, timeout, limites de fan-out/depth e
  orçamento máximo; nunca grava credencial na fixture.
- A implementação-alvo deve registrar `adapter`, superfície, versão CLI/SDK/API, SO, modelo, effort,
  data, fixture hash, capabilities e resultado; um hash de certificação acompanha o relatório.
- A função de comparação da tupla já consegue rebaixar um perfil fornecido para `stale`, mas o store
  de canary ainda não existe. Quando conectado, mudança em qualquer elemento rebaixa a certificação
  até novo canary; docs ou fixture sem binário local resultam em `fixture_only`, nunca `verified`.
- O produto não bloqueia providers ausentes: implementa collector/fallback e deixa a validação real
  explicitamente pendente, conforme decisão do usuário.

## 11) Observability

- Métricas: execuções por estado/origem/provider; duração p50/p95; profundidade/fan-out; erro;
  cancelamento; órfãos; truncamentos; drift; tokens/custo; tempo aguardando aprovação.
- Logs estruturados e sanitizados; nunca logar prompt/tool output completo no log operacional.
- Parse-health segmentado por provider e versão.
- O painel “Uso & custo” recebe breakdown de subagentes e identifica totals inclusivos.
- Alertas locais: crescimento de órfãos/drift/truncamento e Runner incompatível.

## 12) Risk, rollback, feature flag

### Riscos

- Formatos privados mudarem silenciosamente.
- Usage inclusivo ser interpretado como delta e duplicar custo.
- Eventos assíncronos chegarem depois do terminal do pai.
- Escritores concorrentes causarem conflito ou efeito fora do worktree.
- Transcripts crescerem e degradarem abertura/replay.
- Cancelar o pai não cancelar um processo nativo desacoplado.
- Provider publicar conteúdo sensível em argumentos/output.

### Mitigação/rollback

- Feature flag `JARVIS_EXECUTIONS=0` desativa tracking/listagem do grafo e fallback, deixa Trabalhos
  sem dados e mantém o lifecycle inline do chat.
- Store novo é aditivo; rollback não altera `sessions.json` nem transcripts nativos.
- Collector pode ser desativado individualmente e rebaixado para fallback/tier parcial.
- Worktrees nunca são limpas por alvo não validado e nunca fazem merge/push automático.
- UI ignora frames novos quando flag/versão não suportada.

### 12.1 Environment and bootstrap

- **Affected stack:** Node/TypeScript + JavaScript web sem bundler.
- **Canonical test_command:** `npm run check`.
- **Package manager:** npm (`package-lock.json`).
- **DDL/migration:** N/A.
- **Novas dependências:** nenhuma planejada; usar Node fs/process/git existente.
- **Configurações:** `JARVIS_EXECUTIONS`, `JARVIS_EXECUTION_RETENTION_DAYS`,
  `JARVIS_EXECUTION_MAX_EVENTS`, `JARVIS_EXECUTION_MAX_CONCURRENCY`,
  `JARVIS_EXECUTION_MAX_DEPTH`, `JARVIS_EXECUTION_DEFAULT_WRITE` e
  `JARVIS_EXECUTION_WORKTREE_ROOT`. No Hub elas são defaults sobrepostos pelo arquivo salvo em
  Configurações; concurrency/depth/default-write aplicam a novas delegações imediatamente e os demais
  campos pedem restart. Cada Runner lê apenas seu próprio ambiente e precisa de restart.
- **CI:** GitHub Actions existente; gate local obrigatório, CI remoto após commit/PR quando aplicável.

## 13) Implementation plan (baseline aprovado)

Cada passo altera no máximo dois arquivos principais; testes vêm antes/ao lado do comportamento.

Estado pós-implementação: os passos 1–18 e 25 possuem infraestrutura funcional; 19–24 entregaram
perfis/entradas de mapper e alguns casos sintéticos honestos, não collectors completos, corpus
versionado nem certificação real dos CLIs ausentes. O passo 26 permanece aberto para gate
browser/canaries externos. A lista abaixo é preservada como rastreabilidade do plano aprovado, não
como alegação de conclusão individual.

1. Criar testes de reducer/contrato e `packages/protocol/src/execution.ts`.
2. Criar `packages/core/src/execution-store.test.ts` e `execution-store.ts`.
3. Adicionar `ProviderProgressEvent`/`executionId` em `packages/core/src/agents.ts` e testes de bridge.
4. Integrar store/deltas locais em `apps/hub/src/index.ts` com testes dedicados do reducer/handler.
5. Estender `packages/protocol/src/runner.ts` e integrar `apps/runner/src/index.ts`.
6. Adicionar E2E snapshot/delta/reconnect em `apps/hub/src/parity.e2e.test.ts`.
7. Criar shell acessível do painel em `apps/hub/web/index.html`.
8. Implementar lista/filtros/deltas em `apps/hub/web/app.js` e teste DOM novo.
9. Implementar detalhe/transcript/arquivos/métricas em `app.js` + teste DOM.
10. Migrar Claude collector/native parser em `agents.ts`/`native.ts` e fixtures.
11. Implementar Codex collector em arquivo provider isolado + fixtures de rollout/exec.
12. Implementar controle node/subtree/approval no Hub e protocolo.
13. Implementar usage scoped/aggregate no ledger e painel Uso & custo.
14. Implementar recovery/orphan/reconcile no store/Hub.
15. Criar `apps/hub/src/execution-orchestrator.test.ts` e orquestrador read-only.
16. Integrar ferramenta `jarvis_delegate` no MCP/Hub sem poluir sessões públicas.
17. Criar worktree manager/testes e ligar somente a filhos `write:true`.
18. Adicionar Settings/policy/limits e validação server-side.
19. Certificar Gemini e Qwen com collectors/fixtures separados.
20. Certificar Copilot e OpenCode com collectors/fixtures separados.
21. Certificar Cursor e Cline com collectors/fixtures separados.
22. Migrar Kiro para ACP/eventos; manter fallback explícito se a superfície não for suficiente.
23. Implementar Antigravity collector somente com contrato verificável; caso contrário, fallback/tier.
24. Certificar Continue e Aider pelo fallback Jarvis/worktree.
25. Atualizar `agents:report`, matriz, README e setup/configurações.
26. Rodar revisão adversarial, teste browser desktop/mobile, `npm run check` e gate final.

## 14) DoR / DoD

### DoR

- Contratos e enums fechados.
- Invariantes, fluxo e 15 edge cases definidos.
- Oito cenários Gherkin e tabela executável.
- Persistência sem DDL decidida.
- Fallback, segurança, worktree, retention e rollback definidos.
- Matriz completa dos 12 adapters.
- Plano por arquivos e dependências aprovado pelo usuário.

### DoD

Esta é a saída exigida para `reviewed`/`gate-approved`, não uma alegação de que o status atual
`implemented` já satisfaz todos os itens:

- `npm run check`, `npm run test:e2e`, `node --check` e `git diff --check` verdes.
- Testes de contrato/store/policy/usage/recovery e DOM/E2E presentes.
- Claude/Codex sem regressão no fluxo atual.
- Todos os adapters têm collector ou fallback explícito e tier honesto.
- Runner local/remoto e dois clientes preservam o mesmo grafo.
- UI cobre estados loading/empty/error/offline/truncated/orphaned/approval.
- Security triage e redaction aprovados; zero critical/important na review.
- Docs, matriz, settings e evidence trail atualizados.
- Providers ausentes permanecem `fixture_only`, `unverified` ou `unavailable` até canary real.

### 14.1 Evidence trail e gaps antes do gate

| Área | Evidência no repositório | Estado honesto |
|---|---|---|
| Contrato e persistência | `packages/protocol/src/execution.ts`, `packages/core/src/execution-store.ts` e testes | implementado |
| Policy/DAG/worktree/redaction | `execution-policy`, `execution-orchestrator`, `execution-worktree`, `execution-redact` e testes | implementado; segurança real depende da combinação certificada abaixo |
| Lifecycle local/remoto | tracker no Hub/Runner, protocolo v6, manifest/replay e E2E mock local/remoto | implementado; E2E dedicado reinicia o Hub durante tool e recupera atividade do journal do Runner |
| UX Trabalhos | `apps/hub/web/index.html` e `app.js` | árvore/detalhe e card inline vivo implementados; o chat recompõe turno pendente e agrupa chunks `Read` por arquivo; browser/a11y automatizado ainda pendentes |
| MCP/fallback | `apps/mcp/src/delegate.ts`, `delegateTool.ts`, `delegateReport.ts`, `jarvis_delegate`, `ManagedExecutionService` e testes | `wait`/`background`, corrida aceite/terminal, timeout e snapshot paginado/sanitizado implementados; E2E por cliente MCP real ainda pendente |
| Retenção/settings | compactação de raízes terminais + Configurações/env | implementado; Runner remoto usa env próprio |
| Claude | E3 `partial`; RO/writer conectados por controles do provider | canary de subagente/cancel/reconnect pendente |
| Codex | E3 `partial`; somente RO conectado | writer e canary multi-agent headless pendentes |
| Aider | E1 `unverified`; somente writer com worktree/`--no-auto-commits` | CLI ausente; RO recusado |
| Gemini/Cursor/Copilot/OpenCode/Cline/Qwen/Kiro | perfis/mappers e amostras sintéticas `fixture_only` | corpus versionado completo, sandbox e canary real ausentes; fallback gerenciado recusado |
| Continue | E1 `unverified` | executor sandboxado/canary ausentes; fallback recusado |
| Antigravity | E0 `unavailable` | nenhum contrato headless verificável; execução recusada |

A matriz fail-closed conectada no Hub e no Runner permite Claude read-only/writer, Codex somente
read-only, Aider somente writer e Mock somente read-only em teste com `JARVIS_ENABLE_MOCK=1`.
Qualquer outra combinação falha no preflight: nenhuma delas degrada para instrução de prompt, cwd
compartilhado com escrita ou botão que aparenta suporte.

Também permanecem fora do gate: store persistente de canary/certificação, telemetria de drift de
eventos de execução desconhecidos e rebaixamento automático por versão/modelo/effort.
