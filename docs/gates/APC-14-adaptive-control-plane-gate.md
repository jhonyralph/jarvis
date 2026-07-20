# APC-14 — Gate do Adaptive Power-User Control Plane

## Escopo validado

APC-01..APC-13 implementam o plano aprovado para um control plane adaptativo de uso individual power-user:

- políticas globais, por projeto, subescopo, sessão e tarefa;
- memória semântica segmentada por escopo, tópico e partição de projeto;
- writes de memória governados por política;
- decisões de autonomia para fila, background, risco e orçamento;
- fila manual preservada quando autoplay é bloqueado;
- orçamento adaptativo aplicado em delegações gerenciadas;
- fila de aprovações para rotinas/background;
- explicação visual da política efetiva;
- operações estruturadas de política por pasta/sessão;
- presets de autonomia;
- estatísticas e filtros de memória para monorepo;
- aprovações por voz/mobile;
- auditoria curta de decisões adaptativas.

## Validação obrigatória

- `node --import tsx --test packages/core/src/adaptive-policy.test.ts`
- `node --import tsx --test packages/core/src/memory.test.ts`
- `node --check apps\hub\web\app.js`
- `npm run typecheck`
- `npm test`
- `git diff --check`

## Riscos restantes

- Aprovação por voz resolve a primeira pendência; seleção por número fica para uma próxima fatia.
- O log adaptativo é local e limitado a 500 eventos; não é analytics histórico.
- A UI de policies ainda mantém JSON avançado para casos complexos.
- Runners remotos ainda dependem de seus próprios ciclos de atualização para parity total de UI/estado.
