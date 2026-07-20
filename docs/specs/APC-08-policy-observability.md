# APC-08 — Observabilidade da política adaptativa

## Objetivo

Dar ao power-user uma leitura rápida da política efetiva antes de delegar autonomia: o sistema deve explicar quais controles estão permitidos, exigem aprovação ou estão bloqueados.

## Escopo

- Gerar no core um relatório estruturado da política resolvida.
- Cobrir memória, escrita no repo, play automático da fila, turnos em background, ações de alto risco e orçamento desconhecido.
- Expor esse relatório no payload `adaptive_policy` do Hub.
- Mostrar o estado no painel de configurações sem exigir leitura do JSON avançado.

## Fora de escopo

- Editor visual completo de políticas por projeto/subescopo.
- Persistência de histórico de decisões.
- Mudança de semântica dos gates já implementados.

## Aceite

- Cada controle retorna `allow`, `ask` ou `reject` com motivo técnico.
- `policy_state` e `set_adaptive_policy` retornam a mesma explicação estruturada.
- A UI mostra a política efetiva, cadeia aplicada e chips de controle.
- Teste unitário cobre estados mistos na explicação.
