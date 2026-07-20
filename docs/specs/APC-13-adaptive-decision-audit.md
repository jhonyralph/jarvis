# APC-13 — Auditoria de decisões adaptativas

## Objetivo

Manter uma trilha curta e consultável de decisões da política adaptativa para explicar por que o Jarvis permitiu, pediu aprovação ou bloqueou uma ação.

## Escopo

- Persistir eventos em `~/.jarvis/adaptive-decisions.json`.
- Registrar decisões de rotina, autoplay de fila, escrita de memória e conclusão de aprovação.
- Limitar o log aos últimos 500 eventos.
- Expor consulta owner-only via `adaptive_decisions`.

## Fora de escopo

- Dashboard completo de auditoria.
- Exportação para serviços externos.
- Métricas agregadas de custo por decisão.

## Aceite

- Cada evento inclui tipo, ação, motivo, timestamp e policyId quando disponível.
- Decisões bloqueadas e permitidas ficam registradas.
- Aprovar/rejeitar uma pendência também gera evento.
- O Hub retorna os eventos mais recentes com limite configurável.
