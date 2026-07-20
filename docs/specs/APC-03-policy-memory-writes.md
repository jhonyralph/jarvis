---
feature_id: APC-03-policy-memory-writes
tldr: "O atalho # passa a respeitar a política adaptativa antes de gravar memória no Jarvis ou no repo."
title: "Writes de memória controlados por política"
owner: "Jonathan / Codex"
status: approved
risk_level: medium
stack: node
services_affected: [core, hub, docs]
dependencies: [APC-01-adaptive-policy-scopes, APC-02-memory-namespaces]
schema_required: false
schema_dependencies: []
approval_evidence: "Usuário aprovou a direção APC e pediu memória configurável por global/projeto, com cautela para não misturar contextos nem escrever em repo sem política adequada."
---

# Executable spec

## Objective

O fluxo `#` de memória não pode mais assumir que toda nota deve ir para um
arquivo do projeto. Ele deve consultar a política efetiva da sessão e decidir
entre recusar, gravar na memória local do Jarvis ou gravar no repo.

## Rules

1. `memory.writeTarget=disabled` recusa a operação.
2. `jarvis_only` grava no store semântico local com namespace APC-02.
3. `repo_allowed` cai para Jarvis quando escrita no repo estiver bloqueada ou exigir preview ainda indisponível.
4. `repo_required` recusa quando o repo não estiver disponível, escrita estiver bloqueada ou preview for obrigatório.
5. Escrita no repo só acontece quando `write.allowRepoWrites=true` e `write.requireDiffPreview=false`.

## Acceptance

- A decisão fica no core e é testável sem Hub.
- Hub local usa a decisão para `memory_append`.
- Memória Jarvis-only recebe classificação e embedding quando disponível.
- Remote runner mantém o comportamento legado até receber política em fase posterior.

## Validation

- `node --import tsx --test packages/core/src/adaptive-policy.test.ts`
- `npm run typecheck`
- `npm test`
