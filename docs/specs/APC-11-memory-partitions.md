# APC-11 — Partições de memória para projetos grandes

## Objetivo

Evitar que a memória semântica vire um bloco único em projetos grandes ou monorepos, mantendo visibilidade e filtros por subárvore.

## Escopo

- Adicionar estatísticas de memória por escopo, tópico e `projectKey`.
- Permitir busca por prefixo de projeto/subárvore (`projectPrefix`).
- Expor `memory_stats` no Hub.
- Retornar estatísticas junto de buscas e reindexação.
- Mostrar um resumo simples das maiores partições no modal de busca semântica.

## Fora de escopo

- Migração para banco vetorial externo.
- UI completa de administração da memória.
- Exclusão granular de partições.

## Aceite

- Busca por prefixo isola uma subárvore de monorepo.
- Estatísticas listam total, escopos, tópicos e projetos.
- Reindexação retorna estatísticas atualizadas.
- Teste unitário cobre partições de monorepo.
