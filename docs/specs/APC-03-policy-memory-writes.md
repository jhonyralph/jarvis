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
3. `repo_allowed` cai para Jarvis quando escrita no repo estiver bloqueada.
4. `repo_required` recusa quando o repo não estiver disponível ou escrita estiver bloqueada.
5. Escrita interativa no repo usa sempre `memory_preview` + `memory_apply`, com hash da versão lida e token curto de uso único; `memory_cancel` invalida a prévia sem escrever.

## Acceptance

- A decisão fica no core e é testável sem Hub.
- Hub local e Runner remoto usam a mesma decisão e o fluxo preview/apply.
- Memória Jarvis-only recebe classificação e embedding quando disponível.
- A prévia não escreve; alteração concorrente no arquivo falha fechada.
- Aplicar ou cancelar em um dispositivo consome a operação para todos os dispositivos e para o Runner remoto.
- Proveniência registra máquina, sessão, usuário/dispositivo e hashes, sem copiar o texto da nota.

## Validation

- `node --import tsx --test packages/core/src/adaptive-policy.test.ts`
- `npm run typecheck`
- `npm test`
