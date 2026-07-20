---
feature_id: APC-01-adaptive-policy-scopes
tldr: "Jarvis terá políticas globais, por projeto, subescopo, sessão e tarefa para memória, autonomia e aprovação."
title: "Políticas adaptativas para power-user"
owner: "Jonathan / Codex"
status: approved
risk_level: medium
stack: node
services_affected: [core, hub, web, docs]
dependencies: []
schema_required: false
schema_dependencies: []
links:
  roadmap: "../agent-parity-matrix.md"
  design: "Discovery aprovado em 2026-07-20: Adaptive Power-User Control Plane / APC-01..14"
  adr: "N/A"
approval_evidence: "Usuário em 2026-07-20 aprovou o breakdown APC-01..APC-14 e adicionou que memória deve ser segmentada, inclusive em monorepos/projetos grandes, para evitar um único ponto de memória confuso."
---

# Executable spec

## 0) Meta (TL;DR)

APC-01 cria a fundação de política do Jarvis: um perfil global com overrides por
projeto, subescopo de projeto, sessão e tarefa. A política decide onde a memória
pode viver, quanta autonomia o Jarvis tem, quando pedir aprovação por risco/custo
e se pode escrever no repositório. Esta feature não implementa a memória
inteligente em si; ela define os limites e a resolução de escopo que APC-02+
usarão.

## 1) Context and objective

### 1.1 Problem

O Jarvis já tem memória semântica local simples por sessão (`memory.json`) e o
atalho `#` para anexar notas em arquivos de instrução do projeto. Isso é útil,
mas perigoso se virar um despejo único: assuntos pessoais, esportes, receitas e
decisões de código não podem disputar o mesmo contexto. Em monorepos, um único
arquivo de memória para o repo inteiro também vira ruído: `apps/hub`,
`services/voice` e `mobile` podem ter regras, riscos e vocabulários diferentes.

### 1.2 Objective (Definition of Value)

O usuário consegue configurar como o Jarvis se comporta por escopo. Uma sessão
em um projeto grande herda defaults globais, reconhece o subescopo pelo `cwd` e
aplica uma política previsível para memória, escrita, autonomia e aprovação. A
UI mostra de onde a política veio e o servidor usa a mesma resolução antes de
executar ações.

### 1.3 Out of scope

- Capturar, classificar ou recuperar memórias semanticamente. Isso é APC-02/APC-04.
- Implementar workflow templates/autonomia avançada. Isso é APC-10/APC-11.
- Escrever memórias no repo automaticamente sem um diff/ação explícita.
- Substituir `MemoryStore` existente nesta feature.
- Criar colaboração multiusuário ou política por organização/time.
- Mudar armazenamento para SQL.

## 2) Dual-source planning

### 2.1 Roadmap

Breakdown aprovado APC-01..APC-14. APC-01 desbloqueia APC-02, APC-03, APC-05,
APC-08, APC-09 e APC-11.

### 2.2 Detailed references

- `packages/core/src/memory.ts` — store semântico local atual, ainda sem namespace.
- `apps/hub/src/index.ts` — configuração persistida, memória, `#`, filas e execução.
- `packages/core/src/execution-policy.ts` — política de execução gerenciada já existente.
- `apps/hub/web/app.js` / `index.html` — Configurações e controles atuais.
- `packages/core/src/store.ts` — sessões com `cwd`, `agent` e mensagens.

### 2.3 Gap scan

- Configurações existentes são separadas por domínio (`execution-config.json`,
  `voice-cfg.json`, `summary.json`), mas não há política unificada por projeto.
- `MemoryEntry` possui `cwd` e `agent`, mas não possui namespace, tipo de escopo,
  fonte, confiança, validade, domínio ou permissões.
- `#` escreve no arquivo de instrução do projeto conforme o agente, mas não
  consulta uma política.
- Monorepos não têm override por subpasta ou pacote.
- UI não mostra "esta ação vai seguir a política X".

### 2.4 Delta

Adicionar um modelo de política e um resolvedor determinístico. O resolvedor
deve receber `cwd`, `sessionId`, `agent`, `projectId?`, `taskId?` e devolver a
política efetiva mais específica, com a cadeia de herança visível.

## 3) Rules and invariants (SYSTEM LAWS)

1. Política efetiva é sempre resolvida em ordem: tarefa > sessão > subescopo >
   projeto > global > defaults seguros.
2. Um subescopo é uma raiz nomeada dentro de um projeto, por exemplo `apps/hub`
   ou `packages/core`; ele pode herdar ou sobrescrever a política do projeto.
3. Em caso de conflito, vence a política mais restritiva para escrita,
   aprovação, custo e autonomia.
4. Memória global/pessoal nunca é injetada em um projeto sem relevância e
   namespace explícitos.
5. Memória de projeto inteiro não pode ser usada para um subescopo se houver
   override que a bloqueie ou substitua.
6. Escrever no repo exige política permitindo `repo_write` e uma ação explícita
   com diff/preview.
7. Autonomia nunca implica escrita. Autonomia controla iniciar/continuar tarefas;
   escrita continua governada por workspace/política de execução.
8. Risco/custo desconhecido segue o modo configurado: `ask`, `allow` ou `reject`;
   default é `ask`.
9. A UI e o servidor devem resolver a mesma política. A UI pode prever, mas o
   servidor é autoridade.
10. Política corrompida ou inválida falha para defaults seguros, sem apagar o
    arquivo original.
11. Projetos grandes e monorepos devem poder ter múltiplas políticas no mesmo
    repositório, ligadas por `cwd`/globs.
12. Nenhuma política deve exigir inferência para ser resolvida; classificação
    semântica fica para features posteriores.

## 4) Contracts

### 4.1 Policy model

```ts
type PolicyScope = "global" | "project" | "subscope" | "session" | "task";
type MemoryWriteTarget = "jarvis_only" | "repo_allowed" | "repo_required" | "disabled";
type AutonomyMode = "manual" | "assisted" | "controlled_autonomy";
type UnknownEstimatePolicy = "ask" | "allow" | "reject";

interface AdaptivePolicy {
  schemaVersion: 1;
  id: string;
  scope: PolicyScope;
  label: string;
  projectRoot?: string;
  cwdPattern?: string;
  sessionId?: string;
  taskId?: string;
  memory: {
    writeTarget: MemoryWriteTarget;
    namespaces: string[];
    allowPersonalContext: boolean;
    allowProjectContext: boolean;
    repoFiles?: Array<"AGENTS.md" | "CLAUDE.md" | "GEMINI.md">;
  };
  autonomy: {
    mode: AutonomyMode;
    allowQueueAutoplay: boolean;
    allowBackgroundTurns: boolean;
    requireApprovalAboveRisk: "low" | "medium" | "high";
  };
  budget: {
    maxCostUsd?: number;
    maxTokens?: number;
    unknownEstimate: UnknownEstimatePolicy;
  };
  write: {
    allowRepoWrites: boolean;
    requireDiffPreview: boolean;
  };
  updatedAt: number;
}

interface ResolvedAdaptivePolicy {
  policy: AdaptivePolicy;
  chain: Array<{ id: string; scope: PolicyScope; label: string }>;
  warnings: string[];
}
```

### 4.2 Persistence

Policies live under `~/.jarvis/policies.json`:

```json
{
  "schemaVersion": 1,
  "global": { "...": "..." },
  "projects": [],
  "sessions": [],
  "tasks": []
}
```

Atomic JSON persistence uses the existing `writeJsonAtomic`/`readJson` pattern.
No repo file is written by APC-01.

### 4.3 Resolution input

```ts
interface ResolvePolicyInput {
  cwd?: string;
  sessionId?: string;
  taskId?: string;
  agent?: string;
}
```

The resolver must normalize paths cross-platform and rank project/subscope
matches by longest matching root/pattern.

## 5) Flow

### 5.1 Happy path

1. User opens Settings or a project/session policy panel.
2. UI requests current policies and effective policy for the active session.
3. Hub loads `policies.json`, validates it, resolves the effective policy.
4. UI displays inherited values and overrides.
5. User changes a setting and saves.
6. Hub validates, writes atomically and broadcasts updated policy state.
7. Subsequent memory/write/autonomy actions ask the resolver for the effective
   policy before acting.

### 5.2 Monorepo/subscope path

1. Project root is `C:\repo\jarvis`.
2. Subscopes exist for `apps/hub`, `packages/core` and `services/voice`.
3. A session with `cwd=C:\repo\jarvis\packages\core` resolves to the
   `packages/core` policy, not only the repo-wide policy.
4. If no subscope matches, it falls back to project policy.

### 5.3 Edge cases

1. `cwd` outside every project -> global policy only.
2. Two project roots match -> longest normalized path wins.
3. Two subscopes match -> longest normalized pattern wins; equal length is invalid.
4. Invalid policy file -> return safe defaults + warning, preserve file.
5. Session override removed -> next resolution falls back to subscope/project.
6. Unknown budget/cost estimate and policy `ask` -> action must request approval.
7. Policy allows repo memory but write preview unavailable -> reject write.
8. Windows path casing differs -> path match remains stable.

## 6) Acceptance criteria

```gherkin
Scenario: global policy resolves for unknown cwd
  GIVEN no project policy matches the session cwd
  WHEN the Hub resolves policy for that session
  THEN the effective policy is global defaults with an empty warning list

Scenario: monorepo subscope wins over project
  GIVEN a project policy for /repo and a subscope policy for /repo/packages/core
  WHEN a session cwd is /repo/packages/core/src
  THEN the effective policy chain ends with the packages/core subscope

Scenario: restrictive write policy wins
  GIVEN global allows repo writes and the subscope disables repo writes
  WHEN a memory write action resolves policy
  THEN repo writing is disabled

Scenario: unknown estimates ask by default
  GIVEN a background action has no cost estimate
  WHEN the policy unknownEstimate is ask
  THEN the action requires user approval before running

Scenario: corrupt policy is safe
  GIVEN policies.json is invalid
  WHEN the Hub starts
  THEN it uses safe defaults and does not delete the invalid file
```

## 7) Executable verification

| Criterion | Command/check | Expected result |
|---|---|---|
| Policy resolver tests | `node --import tsx --test packages/core/src/adaptive-policy.test.ts` | all pass |
| Hub integration tests | `node --import tsx --test apps/hub/src/adaptive-policy.test.ts` | all pass if added |
| Typecheck | `npm run typecheck` | exit 0 |
| Full suite | `npm test` | exit 0 |
| Web syntax | `node --check apps/hub/web/app.js` | exit 0 |
| Diff hygiene | `git diff --check` | exit 0 |

## 8) Test plan

- Unit: schema defaults, validation, path normalization, longest-match
  resolution, restrictive merge, corrupt-file fallback.
- Integration: Hub read/save/broadcast policy, session effective policy, owner
  gate for editing.
- UI smoke: settings section renders global/project/subscope/session policy
  without overlapping mobile/desktop layout.
- Regression: existing execution config, voice config, memory search and `#`
  memory append keep working until later features connect to policy.

## 9) UX

Initial UI can be modest and utilitarian:

- Settings -> "Políticas adaptativas".
- Rows for Global, current project, detected subscopes and current session.
- Each row shows memory target, autonomy mode, approval threshold and write
  permission.
- Editing a row uses compact controls: selects, toggles and numeric inputs.
- The active session header or settings panel shows "Política efetiva: X".

No marketing copy. No large hero. This is a control surface.

## 10) Risk, rollback, feature flag

### Risks

- Policy model becomes too broad and blocks iteration.
- UI exposes too many controls at once.
- Path matching gets wrong on Windows or symlinks.
- User thinks repo memory is active before APC-05 implements it.

### Mitigation

- Start with policy resolution and read-only display before wiring actions.
- Use safe defaults and owner-only editing.
- Store chain/warnings so decisions are explainable.
- Label unimplemented downstream actions as policy-only until connected.

### Rollback

Ignoring `policies.json` returns to current behavior. No session/history file is
modified by APC-01.

### Feature flag

Optional: `JARVIS_ADAPTIVE_POLICY=0` hides UI and makes resolver return defaults.

## 11) Implementation plan

1. Add `packages/core/src/adaptive-policy.test.ts` covering defaults,
   validation and resolution.
2. Add `packages/core/src/adaptive-policy.ts` with closed types, safe defaults,
   validation and resolver.
3. Export from `packages/core/src/index.ts`.
4. Add Hub policy store/loading in `apps/hub/src/index.ts` or a small
   `adaptivePolicy.ts` helper.
5. Add WebSocket frames: `policy_state`, `policy_save`, `policy_effective`.
6. Add Settings UI section for global/project/subscope/session policy.
7. Display effective policy for the active session.
8. Add docs to README/config section after implementation.

Each implementation step should stay small. Wiring `#`, memory search, queue
autoplay and workflow approvals to this resolver happens in APC-02/APC-05/APC-08
and APC-09, not here.

## 12) DoR / DoD

### DoR

- Discovery approved for Adaptive Power-User Control Plane.
- Breakdown APC-01..APC-14 approved.
- Monorepo/subscope concern recorded as a product law.
- Existing memory/configuration code inspected.

### DoD

- Policy resolver and persistence implemented with tests.
- Effective policy visible for active session.
- Global/project/subscope/session overrides can be saved by owner.
- Safe fallback on invalid policy file.
- `npm run typecheck`, `npm test`, `node --check apps/hub/web/app.js` and
  `git diff --check` pass.
