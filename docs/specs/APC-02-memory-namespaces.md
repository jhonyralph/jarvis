---
feature_id: APC-02-memory-namespaces
tldr: "Memória semântica passa a carregar namespaces e classificação local para não misturar projeto, assuntos pessoais e subescopos."
title: "Namespaces inteligentes para memória"
owner: "Jonathan / Codex"
status: approved
risk_level: medium
stack: node
services_affected: [core, hub, docs]
dependencies: [APC-01-adaptive-policy-scopes]
schema_required: false
schema_dependencies: []
approval_evidence: "Usuário aprovou APC-01..APC-14 e reforçou que memória deve ser segmentada por assunto, projeto e monorepo, evitando um único arquivo/espaço global confuso."
---

# Executable spec

## Objective

Adicionar uma camada determinística de classificação e namespaces na memória
semântica local. O Jarvis deve conseguir indexar e buscar memórias por escopos
como `project`, `personal` e `general`, com tópicos como `recipe`, `sports` e
`project`, sem depender de LLM para uma decisão básica.

## Non-goals

- Não escrever memória no repo.
- Não criar UI completa de gestão de memória.
- Não apagar nem migrar destrutivamente o `memory.json` existente.
- Não substituir embeddings locais.

## Data contract

`MemoryEntry` ganha campos opcionais e retrocompatíveis:

- `namespaces: string[]`
- `scope: "project" | "personal" | "general"`
- `topic: string`
- `projectKey?: string`

Entradas antigas são normalizadas em memória quando carregadas.

## Rules

1. Receitas e esportes não entram em namespace de projeto só porque a sessão tem `cwd`.
2. Memória de projeto recebe `project:<cwd-normalizado>` apenas quando o texto tem sinal de trabalho técnico/projeto.
3. Busca semântica tenta primeiro os namespaces inferidos da consulta.
4. Se o namespace não retorna hits, a busca cai para o comportamento amplo anterior.
5. Monorepos preservam subpath no `projectKey`.

## Acceptance

- Classificador separa receita, esporte e projeto.
- Store filtra por `namespaces`, `scope`, `topic` e `projectKey`.
- Reindex semântico grava classificação junto da entrada.
- Busca semântica retorna metadados de classificação para o cliente.
- Testes existentes de memória continuam passando.

## Validation

- `node --import tsx --test packages/core/src/memory.test.ts`
- `npm run typecheck`
- `npm test`
