---
feature_id: JRV-01-17-agent-parity
tldr: "Todos os agentes exibidos pelo Jarvis terão o mesmo contrato verificável de conversa."
title: "Paridade de agentes, modelos e runners"
owner: "Jonathan / Codex"
status: approved
risk_level: high
stack: node
services_affected: [core, protocol, hub, runner, web, mcp, scripts, docs]
dependencies: []
schema_required: false
schema_dependencies: []
links:
  roadmap: "../agent-parity-matrix.md#17-breakdown-de-implementação"
  design: "../agent-parity-matrix.md"
  adr: "N/A"
approval_evidence: "Usuário em 2026-07-20: 'Aprovo tudo e pode fazer tudo'."
---

# Executable spec

## 0) Meta (TL;DR)

O Jarvis hoje permite que adapters entreguem apenas texto final e ainda pareçam
suportados. Esta feature cria um contrato único para execução, stream, histórico,
modelos e integrações; faz Hub e Runner usarem o mesmo lifecycle; corrige Claude e
Codex; e adiciona adapters documentados para os principais CLIs. Um agente só
fica selecionável como completo depois de passar a conformidade na máquina.

## 1) Context and objective

### 1.1 Problem

O fluxo visto pelo usuário muda conforme o agente e a máquina. Atividade ao vivo,
anexos, histórico, sessão nativa, usage, commands e modelos têm implementações
específicas ou ausentes. A UI não diferencia suporte completo de um adapter que
apenas devolve a resposta final, e não existe certificação por versão/modelo.

### 1.2 Objective (Definition of Value)

Toda IA selecionável oferece o mesmo ciclo observável: envio, início, progresso,
ferramentas, terminal, persistência, reload, cancelamento e retomada. Diferenças
do fornecedor são declaradas sem inventar dados. A mesma suíte prova o fluxo no
Hub e no Runner.

### 1.3 Out of scope

- Integrar APIs de modelo sem um agente CLI correspondente.
- Inventar reasoning, tool calls, preços ou capabilities.
- Instalar/autenticar CLIs globais sem autorização operacional específica.
- Redesenhar toda a interface fora dos estados/capabilities necessários.
- Mudar armazenamento para banco SQL.

## 2) Dual-source planning

### 2.1 Roadmap

`docs/agent-parity-matrix.md`, especialmente seções 5–17 e itens JRV-01…17.

### 2.2 Detailed references

- `packages/core/src/agents.ts` — contrato e adapters atuais.
- `apps/hub/src/turn.ts` — lifecycle local gerenciado.
- `packages/protocol/src/runner.ts` — contrato Hub/Runner real.
- `packages/core/src/native.ts` — sessões nativas.
- `packages/core/src/commands.ts` — extensions por agente.
- Fontes oficiais listadas em `agent-parity-matrix.md#3-fontes-da-auditoria`.

### 2.3 Gap scan

- Sem DDL/migration: `schema_required=false`.
- Working tree contém apenas a matriz e link arquitetural aprovados.
- Claude/Codex estão implementados; demais CLIs não estão instalados nesta máquina.
- Adapters sem probe real permanecem `unverified` ou `limited`.
- O formato cliente/Hub é inline e precisa migrar sem quebrar clientes atuais.

### 2.4 Delta

Além de corrigir o stream do Codex, a entrega cria certificação, versão, custo
tipado, persistência remota, extensions por adapter e onboarding de fornecedores.

## 3) Rules and invariants (SYSTEM LAWS)

1. Um turno tem exatamente um `turnId`, sequência monotônica e um terminal.
2. Eventos repetidos são idempotentes; eventos fora de ordem não duplicam texto.
3. `complete` só é anunciado quando requirements obrigatórios estão verificados.
4. Ausência de reasoning é ausência — nunca texto sintético.
5. Reload/reconnect não apaga atividade já confirmada.
6. Hub e Runner persistem o mesmo `StoredMessage` normalizado.
7. Anexos chegam ao agente na máquina dona da sessão e reabrem no histórico.
8. Modelo/effort inválido falha antes de spawn/inferência.
9. Custo sempre informa `kind` e `source`; tipos incompatíveis não são somados.
10. Segredos e conteúdo bruto sensível de tools não entram em logs/telemetria.
11. O adapter declara a política de permissão/sandbox; bypass não é implícito.
12. Um CLI/versão não provado não é apresentado como completo.
13. Homônimos de commands/skills/MCP coexistem por adapter e escopo.
14. Operações remotas respeitam os grants já existentes.
15. Mock nunca aparece como agente de produção.

## 4) Contracts (APIs / events / tools)

### 4.1 Canonical agent contract

```ts
type SupportLevel =
  | "complete"
  | "limited"
  | "unverified"
  | "unauthenticated"
  | "not_installed";

type AgentEventKind =
  | "accepted"
  | "started"
  | "text_delta"
  | "text_block"
  | "thinking"
  | "tool_started"
  | "tool_completed"
  | "tool_failed"
  | "plan"
  | "usage"
  | "completed"
  | "failed"
  | "cancelled";

interface AgentEvent {
  schemaVersion: 1;
  turnId: string;
  eventId: string;
  seq: number;
  at: number;
  kind: AgentEventKind;
  text?: string;
  tool?: ToolEvent;
  plan?: PlanEvent;
  usage?: UsageRecord;
  providerEvent?: string;
}

interface AgentDescriptor {
  id: string;
  label: string;
  support: SupportLevel;
  reason?: string;
  cli?: { command: string; version?: string };
  capabilities: AgentCapabilities;
  models: ModelDescriptor[];
  discoveredAt: number;
}
```

### 4.2 Capability contract

Capabilities são booleans/enums fechados para: streaming granularity, tools,
thinking, plans, subagents, native sessions, native resume, files/diff, usage,
cost kind, attachments/modalities, commands, skills, MCP, one-shot e remote.

### 4.3 Model contract

Cada modelo carrega ID, label, source, visibility, context, efforts/variants,
default provenance, modalities, deprecation e certification key. A chave é
`agentId + cliVersion + modelId + effort + runnerId`.

### 4.4 Usage contract

```ts
type CostKind =
  | "billed"
  | "estimated_api_equivalent"
  | "subscription_included"
  | "tokens_only"
  | "unavailable";

interface UsageRecord {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  contextTokens?: number;
  costUsd?: number;
  costKind: CostKind;
  source: string;
  model?: string;
}
```

### 4.5 Hub/Runner protocol

- Runner registration includes descriptor snapshots and build version.
- `send` carries `turnId`, attachments, model, effort and permission policy.
- `event` carries canonical `AgentEvent`.
- `history` carries full normalized messages, activity, attachments, usage and
  session cost breakdown.
- Legacy `stream` is accepted during migration and converted at the boundary.
- Hub/client version incompatibility emits `version_mismatch`; envio fica
  bloqueado até reload/restart coerente.

### 4.6 Errors

Closed codes: `NOT_INSTALLED`, `UNAUTHENTICATED`, `UNVERIFIED`, `UNSUPPORTED`,
`INVALID_MODEL`, `INVALID_EFFORT`, `BUSY`, `CANCELLED`, `TIMEOUT`, `QUOTA`,
`PERMISSION`, `PROVIDER_ERROR`, `PROTOCOL_DRIFT`, `RUNNER_OFFLINE`.

## 5) Data models

### 5.1 Input

`SendRequest`: non-empty `turnId/sessionId/text` (attachment-only uses explicit
placeholder), known agent/model/effort, bounded attachments, declared permission
policy. No unvalidated model string reaches argv.

### 5.2 Output

`NormalizedTurn`: ordered events, final text, usage records, native session ID,
CLI/model metadata and one terminal status. Persisted messages use typed activity,
not `unknown[]`.

## 6) Flow

### 6.1 Happy path

1. UI obtains descriptors for the selected machine.
2. Only `complete` agents are selectable by default; limited is explicitly marked.
3. Hub validates session/model/effort and records `accepted`.
4. Shared turn service persists user+attachments and emits `started`.
5. Adapter normalizes provider events into ordered canonical events.
6. Shared service persists activity checkpoints and broadcasts local/remotely.
7. Terminal `completed` persists final text/usage/native binding.
8. Reload reconstructs the same ordered flow from store/native transcript.

### 6.2 Edge cases

1. CLI missing/auth expired between discovery and send → typed error, no turn spent.
2. Model removed after session creation → request new selection, no silent fallback.
3. Duplicate/out-of-order provider event → dedupe/reorder by ID/seq.
4. Runner disconnect mid-tool → keep confirmed checkpoint; terminal interrupted;
   reconcile on reconnect.
5. Hub restarts while child continues → native/store reconciliation without duplicate.
6. Attachment too large/binary unsupported → error before storing/spawn.
7. Unknown event after CLI upgrade → preserve provider type, mark protocol drift.
8. Usage without price → `tokens_only`, never zero-dollar billed.
9. Limited adapter selected by legacy session → allow explicit continuation with
   warning; do not promote support status.
10. Two clients send same `turnId` → execute once.

## 7) Acceptance criteria (Gherkin)

```gherkin
Scenario: same live flow on Hub and Runner
  GIVEN a certified agent and a tool-using prompt
  WHEN it runs locally and remotely
  THEN both histories contain equivalent ordered lifecycle, tool and terminal events

Scenario: reload during work
  GIVEN a turn has emitted text and a tool event
  WHEN the browser reloads before completion
  THEN the confirmed progress is restored and the final event arrives once

Scenario: unsupported agent is honest
  GIVEN an adapter cannot expose structured progress
  WHEN descriptors are loaded
  THEN it is limited and is not offered as fully supported

Scenario: model capability is exact
  GIVEN a model does not support a requested effort
  WHEN the user sends a turn
  THEN Jarvis rejects it before spawning the CLI

Scenario: remote attachments survive
  GIVEN a text file and image are sent to a remote runner
  WHEN the turn completes and history is reopened
  THEN the agent received both and both attachment chips remain available

Scenario: costs are not conflated
  GIVEN one billed usage and one API-equivalent estimate
  WHEN Usage & cost is opened
  THEN separate subtotals and labels are shown and only configured kinds affect caps
```

### 7.1 Executable verification

| Criterion | Command/check | Expected result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Unit/integration | `npm test` | exit 0 |
| Web syntax | `node --check apps/hub/web/app.js` | exit 0 |
| Diff hygiene | `git diff --check` | exit 0 |
| Conformance | `npm run test:agents` (to add) | all certified fixtures pass |
| E2E | `npm run test:e2e` (to add) | local/remote scenarios pass |
| Registry | doctor + descriptor endpoint | statuses/reasons match installed CLIs |

## 8) Test plan

- Unit: event normalizers, model validation, usage kinds, descriptor registry.
- Integration: shared turn service with Hub/Runner transports and stores.
- UI/E2E: send, tool, reload, cancel, reconnect, attachments, errors and models.
- AI regression: golden NDJSON fixtures for each provider; trap fixtures for
  duplicated final text, secrets in args and unknown events.
- Real probes: optional for uninstalled CLIs; certification cannot become complete
  until a real probe succeeds.

## 9) Observability

Minimum tags: `turnId`, `sessionId`, `runnerId`, `agentId`, `cliVersion`, `model`,
`effort`, `eventKind`, `supportLevel`, `costKind`. Metrics: turn latency/error,
time-to-first-event, reconnects, protocol drift, history reconciliation and event
truncation. Conteúdo de prompt/tool não entra em métricas.

## 10) Risk, rollback, feature flag

- Riscos: quebra do protocolo, duplicação de texto, formato upstream instável,
  custo incorreto e permissões excessivas.
- Rollback: manter conversor do stream legado durante uma versão; stores recebem
  schema version e leitores toleram mensagens antigas.
- Flags: `JARVIS_AGENT_CONTRACT_V2`, por adapter; limited agents ficam off por
  padrão. Remover flags após gate completo.
- Sem novas migrations/DDL.

### 10.1 Environment and bootstrap

- Stack: Node 22 + TypeScript, npm workspaces, web JS sem framework.
- Canonical test: `npm test`; types: `npm run typecheck`.
- Novos CLIs não serão instalados automaticamente.
- Novas env vars precisam entrar em README/setup/doctor; nenhuma secreta terá
  default no código.

## 11) Implementation plan

1. Tipos/testes do contrato em `packages/core/src/agent-contract.test.ts` e
   `packages/core/src/agent-contract.ts`.
2. Export/compatibilidade em `packages/core/src/index.ts` e
   `packages/protocol/src/adapters.ts`.
3. Handshake/version tests em `packages/protocol/src/runner.ts` e Hub.
4. Descriptor registry em `packages/core/src/agents.ts` + testes.
5. Shared remote/local turn payload em `apps/hub/src/turn.ts` + testes.
6. Runner adota mensagens/activity/anexos comuns em `apps/runner/src/index.ts`.
7. Relay/histórico do Hub em `apps/hub/src/index.ts`.
8. UI de status/capability/version em `apps/hub/web/app.js` + HTML se necessário.
9. Normalizador/histórico Codex em `agents.ts`, `native.ts` + fixtures/testes.
10. Usage ledger tipado em módulo core + integração Hub/web.
11. Extension registry por adapter em `commands.ts` + testes.
12. Adapter Gemini + fixtures/testes.
13. Adapter Cursor + fixtures/testes.
14. Adapter Copilot + fixtures/testes.
15. Adapter OpenCode + fixtures/testes.
16. Adapter Cline + fixtures/testes.
17. Adapter Qwen + fixtures/testes.
18. Descriptors limitados Aider/Continue/Kiro/Antigravity.
19. Doctor/install/docs/MCP/voz/rotinas atualizados por registry.
20. Harness E2E local/remote e scripts npm.
21. Review report, security triage e gate evidence em `docs/reviews/`.

Cada passo de implementação será mantido em 1–2 arquivos, salvo quando um teste
e seu módulo contam como o par natural do mesmo passo.

## 12) DoR / DoD

**DoR:** roadmap e matriz aprovados; contratos, modelos, invariantes, edge cases,
Gherkin, verificação, ambiente e plano preenchidos. A aprovação humana está
registrada no frontmatter.

**DoD:** types/testes/web syntax verdes; adapters certificados passam fixtures e
probe real; local/remoto equivalentes; docs/doctor atualizados; zero gap crítico
ou importante no review; security triage concluído; gate evidence registrado.

