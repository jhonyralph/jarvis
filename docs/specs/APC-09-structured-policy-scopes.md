# APC-09 — Gestão estruturada de políticas por escopo

## Objetivo

Permitir que o power-user configure comportamento por projeto, subescopo ou sessão sem depender apenas de editar JSON avançado.

## Escopo

- Adicionar helpers no core para `upsert` e remoção de políticas por escopo.
- Validar campos mínimos por escopo: projeto/subescopo exigem pasta, sessão exige `sessionId`, tarefa exige `taskId`.
- Expor mensagens owner-only no Hub para criar/remover overrides.
- Adicionar atalhos na UI para salvar os controles visíveis na pasta atual ou sessão atual.

## Fora de escopo

- Editor visual completo de todos os overrides.
- Reordenação manual de políticas.
- Propagação automática para runners remotos offline.

## Aceite

- Um override de projeto com a mesma pasta substitui o anterior em vez de duplicar.
- Um override de sessão pode ser removido e deixa de afetar a resolução.
- A UI consegue criar overrides estruturados sem alterar a política global.
- O payload retornado continua trazendo a explicação efetiva da política.
