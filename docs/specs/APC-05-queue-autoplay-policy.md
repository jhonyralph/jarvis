---
feature_id: APC-05-queue-autoplay-policy
tldr: "A fila só roda automaticamente quando a política permitir; o play manual continua disponível."
title: "Política para autoplay da fila"
owner: "Jonathan / Codex"
status: approved
risk_level: medium
stack: node
services_affected: [hub, docs]
dependencies: [APC-01-adaptive-policy-scopes, APC-04-adaptive-run-decisions]
schema_required: false
schema_dependencies: []
approval_evidence: "Usuário pediu suporte para dar play na fila quando ela existir e a sessão estiver parada, e aprovou controle por risco/custo/autonomia."
---

# Executable spec

## Objective

Separar execução manual da fila e autoplay. O botão `rodar fila` deve continuar
acionando a fila explicitamente; flush automático ao terminar um turno deve
respeitar `autonomy.allowQueueAutoplay`.

## Rules

1. Fim de turno local consulta `decideAdaptiveRun(..., { queueAutoplay: true })`.
2. Fim de turno remoto consulta a mesma política.
3. Se a política recusar autoplay, os itens permanecem na fila.
4. Clique manual em `flushqueue` ignora o bloqueio de autoplay, pois é ação explícita do usuário.

## Acceptance

- Não altera o contrato da fila.
- Não remove o botão manual.
- Usa a política efetiva por sessão.

## Validation

- `npm run typecheck`
- `npm test`
