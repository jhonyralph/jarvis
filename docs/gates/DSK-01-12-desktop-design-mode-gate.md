# Gate — DSK-01-12 Cliente desktop (Electron) + Design Mode

Spec: [`../specs/DSK-01-12-desktop-design-mode.md`](../specs/DSK-01-12-desktop-design-mode.md) ·
Review: [`../reviews/DSK-01-12-desktop-design-mode-review.md`](../reviews/DSK-01-12-desktop-design-mode-review.md)

## Escopo entregue

- **Fase 0 — shell Electron** (cliente rico, fora do workspace): `desktop/` carrega a UI viva do Hub,
  bridge `window.jarvis` feature-detected, auto-update, sem relay de nuvem (LEI 5).
- **Fase 1 — Design Mode**: descoberta de preview no Runner (`packages/core/src/preview.ts`),
  protocolo `preview_query`/`preview_list` (v8, tolerante), `<webview>` embutido + element grab
  (`desktop/src/browser/*`) e o painel Design Mode na UI web (`apps/hub/web`) que injeta o bloco
  "Design Feedback" + screenshot como anexos do turno.

## Quality gates

| Gate | Comando | Resultado |
|---|---|---|
| Types | `npm run typecheck` | **passed** (exit 0) |
| Web syntax | `node --check apps/hub/web/app.js` | **passed** |
| Preview module | `node --import tsx --test packages/core/src/preview.test.ts` | **passed** (9/9) |
| Suíte completa | `npm test` | **348/350 passed**; 1 falha **flaky** (`parity.e2e` #27 "remote Runner preserves…"), **verde em isolamento** (`npm run test:e2e` 2/2) — contenção de timing na suíte paralela, não regressão desta entrega; 1 cancelado em cascata |
| Diff hygiene | `git diff --check` | **pending** (rodar no commit) |

## Correspondência visual (o gate)

**Declarado: bloqueado por ambiente — evidência pendente de build local do operador.**

Design Mode adiciona telas novas (painel `#designPanel`, overlay de grab no guest, compose de
feedback). A evidência visual **não pôde ser capturada nesta sessão** porque Design Mode só roda
dentro do app Electron construído (`cd desktop && npm install && npm start`), e o Electron é dep
nativa pesada mantida **fora do workspace** (espelha `mobile/`), não instalada no ambiente do agente.
Num browser puro o painel fica oculto por design (LEI 2), então não há tela a capturar fora do Electron.

**Ação de desbloqueio (operador):** rodar o shell local e capturar (a) a janela na UI do Hub, (b) o
overlay de seleção sobre um preview, (c) o bloco "Design Feedback" + screenshot chegando no turno.
Anexar aqui. Até lá, a entrega é **código verificado por tipos/testes**, sem prova visual.

## Risco residual

- **Host do preview:** candidatos usam `127.0.0.1` — funciona pro runner local; runner **remoto**
  precisa da URL manual (host da tailnet) até o Runner anunciar o próprio endereço. Documentado.
- **Versões `electron`/`electron-builder`** em `desktop/package.json` são estimativas — validar no
  primeiro `npm install`.
- **CSP `<webview>`:** assume-se que o `<webview>` do Electron é isento de `default-src 'self'`; a
  confirmar no primeiro build (se bloquear, relaxar CSP para o webview).
- **Grab em página cross-origin/iframe:** best-effort; `sourceRef` só em builds dev com React fiber.
