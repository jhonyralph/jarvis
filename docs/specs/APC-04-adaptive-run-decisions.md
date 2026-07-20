---
feature_id: APC-04-adaptive-run-decisions
tldr: "Política adaptativa ganha decisão pura allow/ask/reject para risco, custo, tokens, autoplay e background."
title: "Decisões adaptativas de execução"
owner: "Jonathan / Codex"
status: approved
risk_level: medium
stack: node
services_affected: [core, docs]
dependencies: [APC-01-adaptive-policy-scopes]
schema_required: false
schema_dependencies: []
approval_evidence: "Usuário definiu aprovação por risco/custo e pediu suporte agnóstico entre cockpit e autopilot conforme o momento."
---

# Executable spec

## Objective

Criar uma decisão pura e testável que transforme a política efetiva em uma
resposta operacional: permitir, pedir aprovação ou recusar uma execução.

## Rules

1. Autoplay de fila é recusado quando a política não permitir.
2. Turno em background é recusado quando a política não permitir.
3. Orçamento de custo/tokens excedido recusa.
4. Estimativa desconhecida segue `unknownEstimate`: `allow`, `ask` ou `reject`.
5. Risco acima do threshold configurado pede aprovação.

## Non-goals

- Não criar UI de aprovação ainda.
- Não substituir o budget guard existente.
- Não plugar todos os runners remotos.

## Acceptance

- Core exporta `decideAdaptiveRun`.
- Testes cobrem risco, custo, tokens, estimativa desconhecida, autoplay e background.
- A função não tem side effects e pode ser usada por Hub, Runner e MCP.

## Validation

- `node --import tsx --test packages/core/src/adaptive-policy.test.ts`
- `npm run typecheck`
- `npm test`
