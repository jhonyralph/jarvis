# Review — DSK-01-12 Cliente desktop (Electron) + Design Mode

Auto-review da implementação (Fases 0+1). Gate: [`../gates/DSK-01-12-desktop-design-mode-gate.md`](../gates/DSK-01-12-desktop-design-mode-gate.md).

## Arquivos alterados

**Fora do workspace (isolado, LEI 3):**
- `desktop/` — `package.json`, `.gitignore`, `README.md`, `electron-builder.yml`, `main.js`,
  `preload.js`, `src/shared/bridge-types.d.ts`, `src/browser/{grab-guest-script,screenshot,register-browser-ipc}.js`.

**Workspace:**
- `packages/protocol/src/runner.ts` — `PreviewCandidate`, `preview_query`/`preview_list`, versão v8.
- `packages/core/src/preview.ts` + `preview.test.ts` — descoberta de preview (parsers + orquestrador).
- `packages/core/src/index.ts` — export de `preview`.
- `apps/runner/src/index.ts` — `previewExec` + handler `preview_query`.
- `apps/hub/src/index.ts` — relay cliente↔runner de `getWorktreePreview`/`preview_list`.
- `apps/hub/web/{index.html,app.js}` — painel Design Mode + bridge `window.jarvis` + envio de feedback.
- `docs/ARCHITECTURE.md` — terceira casca (cliente Electron).

## Conformidade com as LEIS do spec

- **LEI 1/2 (UI única, no-op fora do Electron):** ✅ o painel e o botão ficam ocultos sem
  `window.jarvis.capabilities.designMode`; a IIFE do bridge dá early-return num browser puro.
- **LEI 3 (fora do workspace):** ✅ `desktop/` não entra no `npm install`/CI; typecheck/test do
  workspace inalterados.
- **LEI 5 (sem nuvem):** ✅ nenhum endpoint externo; o cliente só fala com o Hub.
- **LEI 6 (preview descoberto no dono):** ✅ `detectPreviewCandidates` roda no Runner (`sessCwd`).
- **LEI 7 (redação/orçamento):** ✅ o extractor injetado redige segredos e limita HTML a 4KB antes
  de o payload sair da página.
- **LEI 8 (guest sem bridge):** ✅ `will-attach-webview` remove preload/Node do guest.
- **LEI 9 (screenshot no main):** ✅ `capturePage` recorta no processo main.
- **LEI 11 (bridge versionado):** ✅ `bridgeVersion` + `capabilities`; UI degrada sem o bridge.

## Desvio consciente do contrato

O spec §4.2 esboçava `openPreview(worktreeId) → pageId`. Na prática o **renderer** (UI servida pelo
Hub) é dono do `<webview>` e passa o `webContentsId`; o main não pode criar um elemento DOM do
renderer. O bridge opera por `webContentsId` (`setGrabMode/awaitGrabSelection/captureSelectionScreenshot/cancelGrab`).
Documentado em `desktop/src/shared/bridge-types.d.ts`.

## Pontos abertos / seguir

- **Evidência visual** pendente de build local (ver gate) — é o principal gate não fechado.
- **Runner remoto:** host do preview via URL manual até anunciar endereço de tailnet.
- **Fase 2 (fan-out compara-e-promove):** fora deste spec, próximo.
- **Teste do injetável do grab:** o `grab-guest-script.js` roda no page-world; hoje sem teste
  automatizado (validação é o build local). Candidato a um teste de parsing/redação futuro.
