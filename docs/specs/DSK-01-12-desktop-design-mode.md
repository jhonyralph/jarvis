---
feature_id: DSK-01-12-desktop-design-mode
tldr: "Um cliente desktop Electron (casca rica, não reescrita) que carrega a UI viva do Hub e adiciona o Design Mode — clicar num elemento do preview e mandar HTML+CSS+screenshot pro agente — sem nuvem e sem tocar o install do Hub/Runner."
title: "Cliente desktop (Electron) + Design Mode"
owner: "Jonathan / Claude"
status: approved
risk_level: medium
stack: node
services_affected: [desktop, core, protocol, hub-web, docs]
dependencies: []
schema_required: false
schema_dependencies: []
links:
  roadmap: "../ARCHITECTURE.md"
  design: "../../../orca (referência de código: stablyai/orca, MIT — clonado localmente)"
  adr: "N/A"
approval_evidence: "Usuário em 2026-07-27: 'Pode fazer tudo'."
---

# Executable spec

## 0) Meta (TL;DR)

O Jarvis hoje tem duas cascas sobre um único núcleo web (`apps/hub/web`): a **PWA**
(browser) e o **app Capacitor** (mobile, carregando a UI viva do Hub via `server.url`).
Esta feature adiciona a **terceira casca — Electron no desktop** — como **cliente rico**,
não como reescrita: o Hub/Runner headless (JSON atômico, autostart, Tailscale) ficam
intactos e continuam donos de sessões/PTY/worktrees. O shell aponta pra URL viva do Hub
("reload é o deploy" também no desktop) e só ele empacota poderes nativos via um **bridge
`window.jarvis` feature-detected** (no-op no browser, subset no Capacitor, rico no Electron).

O primeiro poder rico é o **Design Mode**: um browser embutido por worktree onde clicar
num elemento captura HTML sanitizado + CSS computado + seletor + screenshot recortado e
injeta isso como contexto no próximo turno do agente. A URL de preview é **descoberta
automaticamente no Runner** (port-scan por `cwd` do processo + leitura da saída do PTY),
nunca adivinhada pelo cliente.

**Não-competição / privacidade:** nenhum relay na nuvem. Diferente do Orca (que cai em
`relay.onorca.dev` fora da LAN), o cliente desktop alcança Hub/Runner **só pela rede privada
do operador** (Tailscale/loopback) — a Tailscale já é o "caminho direto" que dispensa relay.

## 1) Context and objective

### 1.1 Problem

O único cliente hoje é a UI web servida pelo Hub. Ela é ótima como PWA/Capacitor, mas não
alcança poderes nativos de desktop (janela própria, auto-update, browser embutido
injetável, `capturePage`). Sem isso não há Design Mode — a ponte visual "aponto num
elemento renderizado → o agente recebe o HTML/CSS/screenshot e o arquivo-fonte". Além
disso, o Jarvis não tem forma de descobrir a URL de preview de um dev-server que um agente
subiu num worktree.

### 1.2 Objective (Definition of Value)

O operador abre um app desktop nativo que mostra exatamente a mesma UI do Hub, com
auto-update, e — quando um worktree tem um dev-server rodando — abre esse preview embutido,
clica num elemento, escreve um comentário e o agente recebe um bloco "Design Feedback"
estruturado + a imagem recortada, apontando (quando o framework do app previsto expõe)
para `arquivo:linha:coluna`. Tudo sobre a rede privada; nada novo sai da máquina.

### 1.3 Out of scope

- **Fan-out compare-and-promote** (1 prompt → N agentes → comparar → promover vencedor):
  próximo spec, reusa worktree writers + DAG `jarvis_delegate`.
- Terminal/editor nativos no Electron (a UI web já roda; PTY continua no Runner).
- **Design Mode no mobile** (Capacitor) — o bridge é o mesmo, mas o webview e a captura
  de tela mobile são um spec separado.
- Substituir a PWA ou o app Capacitor. As três cascas coexistem.
- Qualquer relay/serviço de nuvem próprio. Explicitamente proibido (LEI 5).
- Empacotar Hub/Runner dentro do binário (modelo "app standalone" do Orca) — rejeitado
  na análise por abrir mão da separação que dá estabilidade.

## 2) Dual-source planning

### 2.1 Roadmap

`docs/ARCHITECTURE.md` (topologia Hub + Runners + Clients; princípio "multi-client,
multi-desktop") e a decisão registrada na memória do operador
(`jarvis-electron-designmode-direction`): Electron como cliente rico, Design Mode primeiro,
mobile continua Capacitor.

### 2.2 Detailed references

- `mobile/` — precedente exato de "casca fora do workspace, própria toolchain, carrega a
  URL viva do Hub". `mobile/capacitor.config.ts` (`server.url` OTA), `mobile/README.md`
  (bridge feature-detected, no-op no browser), `mobile/.gitignore`, `mobile/sync-web.mjs`.
- `apps/hub/web/index.html` + `apps/hub/web/app.js` — o núcleo web único (fonte da verdade).
- `packages/protocol/src/runner.ts` — contrato Hub↔Runner real (onde entra `worktree.preview`).
- `packages/core/src/*` — onde entra a descoberta de preview (port-scan + PTY watcher).
- Referência de código externa (só leitura, MIT): `C:\Users\jonat\orca`
  - Transporte/relay: `src/main/runtime/relay/*`, `src/main/orca-profiles/profile-cloud-auth-config.ts`
    (`relay.onorca.dev` — o que **evitamos**).
  - Design Mode ("Browser Context Grab"): `src/main/browser/grab-guest-script.ts`,
    `browser-grab-screenshot.ts`, `src/shared/browser-grab-types.ts`,
    `src/renderer/src/components/browser-pane/{useGrabMode,browser-annotation-output}.ts`.
  - Descoberta de URL: `src/main/ports/{local-workspace-port-scanner,advertised-url-watcher}.ts`.

### 2.3 Gap scan

- Sem DDL/migration: `schema_required=false`.
- `desktop/` não existe; será criado fora do workspace (LEI 3).
- `worktree.preview` não existe no protocolo; exige bump de versão tolerante a clientes antigos.
- O núcleo web hoje não faz feature-detect de `window.jarvis`; a mudança é aditiva (no-op
  quando ausente), então PWA/Capacitor não regridem.
- Electron é dep nativa pesada; **não** entra no `npm install` do Hub/Runner.

### 2.4 Delta

Além de "abrir uma janela", a entrega cria: (a) o contrato de bridge `window.jarvis`
versionado e feature-detected como superfície durável para TODA capacidade nativa futura;
(b) a descoberta de preview no Runner, útil por si só (até no mobile); (c) o Design Mode.

### 2.5 Directive challenge (anti-viés)

- *"Estou super-construindo?"* — A Fase 0 (shell) é ~5 arquivos, zero build, fora do
  workspace; risco baixo. O peso real (webview + grab) fica na Fase 1, atrás de flag e
  isolado no `desktop/`. Fatiável e reversível (LEI/rollback §10).
- *"Isto compete com o Orca?"* — Não. Reusamos o mecanismo (MIT) mas o eixo do Jarvis
  (voz + self-host + Tailscale) é mantido; explicitamente sem relay de nuvem.
- *"Isto ameaça a estabilidade que o operador pediu?"* — O maior risco seria Electron
  contaminar o install do Hub/Runner. LEI 3 elimina isso (espelha `mobile/`).
- *"A UI vira dois códigos?"* — Não. LEI 1: a UI servida pelo Hub continua única; o desktop
  só adiciona bridge. Sem fork de UI.

## 3) Rules and invariants (SYSTEM LAWS)

1. A UI servida pelo Hub (`apps/hub/web`) é a **fonte única**. A casca desktop adiciona
   capacidades por bridge; **nunca** forka a UI.
2. Capacidade nativa ausente é **no-op detectável**. A UI faz feature-detect de
   `window.jarvis?.browser`; nunca assume presença. PWA e Capacitor não regridem.
3. O app Electron vive **fora do workspace npm** e **nunca** afeta `npm install`/CI do
   Hub/Runner (espelha `mobile/`).
4. Hub/Runner permanecem **autoritativos** sobre sessões, PTY e worktrees. O cliente
   desktop **não** possui estado de sessão.
5. **Sem relay de nuvem.** O cliente alcança Hub/Runner só pela rede privada do operador
   (Tailscale/loopback). Nenhum endpoint externo novo. (Contraste explícito com o Orca.)
6. URLs de preview são **descobertas na máquina dona do worktree** (o Runner), nunca
   adivinhadas pelo cliente.
7. Payloads do grab são **redigidos de segredos e limitados em tamanho** antes de sair da
   página previsualizada; conteúdo bruto sensível nunca entra em logs/telemetria.
8. O guest previsualizado **não** acessa o bridge de preload (preload removido do guest),
   então uma página hostil não alcança APIs nativas.
9. Screenshots são capturados no **processo main** do Electron (o guest não se auto-captura),
   recortados no retângulo do elemento.
10. Auth/pareamento do cliente desktop **reusa** o modelo de device-pairing/passphrase
    existente; nenhum caminho de auth novo.
11. O bridge `window.jarvis` é **versionado**; a UI degrada com elegância quando o shell é
    mais antigo/novo que o esperado.
12. Nada de Design Mode sem evidência visual: a entrega da Fase 1 exige screenshot do
    overlay + do "Design Feedback" chegando ao turno (gate de correspondência visual).

## 4) Contracts (APIs / events / tools)

### 4.1 Bridge `window.jarvis` (feature-detected)

```ts
interface JarvisBridge {
  shell: "electron" | "capacitor" | "browser"; // "browser" quando ausente é implícito
  shellVersion: string;                          // versão da casca (semver do desktop/)
  bridgeVersion: 1;                              // versão do contrato do bridge
  capabilities: {                                // o que ESTA casca implementa
    designMode: boolean;
    autoUpdate: boolean;
  };
  browser?: BrowserBridge; // presente só quando capabilities.designMode
}
```

Regras de detecção na UI: `const b = globalThis.jarvis; if (b?.capabilities?.designMode)
mostrarEntradaDesignMode();`. Sem `window.jarvis` → shell "browser" implícito, tudo no-op.

### 4.2 BrowserBridge (Design Mode)

```ts
interface BrowserBridge {
  openPreview(input: { worktreeId: string; url?: string }): Promise<{ pageId: string; url: string }>;
  setGrabMode(pageId: string, on: boolean): Promise<void>;
  awaitGrabSelection(pageId: string): Promise<GrabSelection>; // resolve no clique; rejeita se cancelado
  captureSelectionScreenshot(pageId: string, rect: Rect): Promise<{ pngDataUrl: string } | { unavailable: true }>;
  cancelGrab(pageId: string): Promise<void>;
  closePreview(pageId: string): Promise<void>;
}
```

### 4.3 Descoberta de preview (protocolo Runner↔Hub↔cliente)

- Runner anuncia (novo evento de protocolo): `worktree.preview` com
  `{ worktreeId, candidates: PreviewCandidate[] }`.
- Cliente consulta via RPC existente do Hub: `getWorktreePreview(worktreeId) ->
  { candidates: PreviewCandidate[] }`.
- Bump de versão do protocolo **tolerante**: cliente/Hub antigos ignoram `worktree.preview`
  sem erro (feature negociada por capability, não obrigatória).

```ts
interface PreviewCandidate {
  url: string;                 // ex.: http://100.x.y.z:5173 (endereço do Runner na tailnet)
  port: number;
  source: "pty-advertised" | "port-scan";
  detectedAt: number;
}
```

### 4.4 GrabSelection (payload do clique)

```ts
interface GrabSelection {
  url: string;
  viewport: { w: number; h: number; dpr: number };
  rect: Rect;                       // bounding box em px de layout
  htmlSnippet: string;              // outerHTML sanitizado (script-stripped), orçado (≤4KB)
  computedStyles: Record<string, string>; // subset relevante (layout/box/typography/color)
  selector: string;                 // seletor CSS único
  domPath: string;                  // caminho legível html>body>...>el
  sourceRef?: { file: string; line: number; column: number; framework: string }; // best-effort
  components?: string[];            // cadeia de componentes quando disponível (React/Vue/etc.)
  a11y?: { role?: string; name?: string; ariaAttributes?: Record<string, string> };
  nearbyText?: string;              // texto próximo, orçado
  redactions: number;              // quantos campos foram redigidos por padrão de segredo
}
type Rect = { x: number; y: number; width: number; height: number };
```

### 4.5 Formatter de contexto (UI → turno)

`formatDesignFeedbackMarkdown(selection, userComment) -> string` emite um bloco
`## Design Feedback` (URL, viewport, seletor, arquivo-fonte quando houver, componentes,
bounds, classes, texto próximo, estilos computados, snippet HTML em fence, e o comentário
do usuário). O bloco entra como **anexo/contexto** do próximo turno na sessão-alvo,
reusando o caminho de anexos existente; o screenshot vai como **imagem** anexa.

### 4.6 Errors (closed codes)

`NO_PREVIEW` (nenhum candidato), `PREVIEW_UNREACHABLE` (URL do Runner fora do ar/tailnet),
`GRAB_CANCELLED`, `SCREENSHOT_UNAVAILABLE`, `BRIDGE_UNSUPPORTED` (capacidade não presente
nesta casca), `HUB_UNREACHABLE`.

## 5) Data models

### 5.1 Input

- Shell: `JARVIS_APP_HUB_URL` (mesma semântica do `mobile/`), fallback `http://127.0.0.1:4577`.
- `openPreview`: `worktreeId` conhecido; `url` opcional só quando o operador digita manual.

### 5.2 Output

- `GrabSelection` (§4.4) sempre sanitizado/orçado antes de cruzar o bridge.
- `DesignFeedback` = markdown (§4.5) + imagem PNG, ambos anexos de turno normais.

## 6) Flow

### 6.1 Happy path

1. Operador abre o app desktop; main carrega `JARVIS_APP_HUB_URL` (UI viva do Hub) sobre Tailscale.
2. UI faz feature-detect: `window.jarvis.capabilities.designMode === true` → mostra a entrada Design Mode.
3. Operador escolhe um worktree; UI chama `getWorktreePreview(worktreeId)`; Runner responde candidatos.
4. UI chama `bridge.openPreview({ worktreeId, url })`; abre o `<webview>` no preview.
5. Operador ativa o grab (`setGrabMode`); o main injeta o picker no guest; hover destaca; clique resolve `awaitGrabSelection`.
6. UI pede `captureSelectionScreenshot(pageId, rect)`; main recorta via `capturePage`.
7. Operador escreve um comentário; UI monta o "Design Feedback" (§4.5) e injeta no próximo turno da sessão-alvo.
8. Agente recebe markdown + imagem e age; o resto do fluxo é o turno normal do Jarvis.

### 6.2 Edge cases

1. Nenhum dev-server → `NO_PREVIEW`; UI oferece entrada manual de URL.
2. Worktree num Runner remoto → URL é o endereço do Runner na tailnet; se fora do ar → `PREVIEW_UNREACHABLE` com dica de `tailscale status`.
3. Vários dev-servers no worktree → listar candidatos; operador escolhe.
4. Guest navega/cross-origin → re-injeta o picker no `did-navigate`; captura escopada à origem atual.
5. Elemento dentro de iframe → best-effort; payload marca a limitação.
6. Casca sem bridge (browser/Capacitor) → entrada Design Mode oculta (LEI 2).
7. Segredo no DOM (token em `value`) → redigido antes de montar o payload; `redactions` incrementa.
8. `capturePage` falha → `SCREENSHOT_UNAVAILABLE`; envia payload sem imagem (não bloqueia).
9. Shell mais antigo que a UI (bridgeVersion desconhecida) → UI degrada pra sem-Design-Mode (LEI 11).
10. Hub cai enquanto o app está aberto → `HUB_UNREACHABLE`; main tenta reconectar; o shell nunca fabrica estado.

## 7) Acceptance criteria (Gherkin)

```gherkin
Scenario: shell carrega a UI viva sem forkar
  GIVEN o app desktop com JARVIS_APP_HUB_URL apontando pro Hub
  WHEN a janela abre
  THEN ela mostra a mesma UI do browser e um reload reflete um deploy web do Hub

Scenario: paridade no-op fora do Electron
  GIVEN o mesmo apps/hub/web aberto num browser comum
  WHEN a UI checa window.jarvis
  THEN a entrada Design Mode não aparece e nada quebra

Scenario: preview é descoberto, não adivinhado
  GIVEN um agente subiu um dev-server em :5173 num worktree do Runner
  WHEN a UI pede o preview desse worktree
  THEN o Runner devolve a URL correta com source pty-advertised ou port-scan

Scenario: grab vira contexto do agente
  GIVEN o preview aberto no webview e o grab ativo
  WHEN o operador clica num elemento e comenta
  THEN o próximo turno recebe um bloco "Design Feedback" com seletor+HTML+estilos e a imagem recortada

Scenario: segredos não vazam
  GIVEN um input com um token no DOM previsualizado
  WHEN o grab captura o elemento
  THEN o valor sensível é redigido e redactions > 0

Scenario: sem nuvem
  GIVEN o cliente desktop em qualquer lugar
  WHEN ele conecta ao Hub e abre um preview remoto
  THEN todo tráfego passa só pela tailnet/loopback e nenhum endpoint externo é contatado
```

### 7.1 Executable verification

| Criterion | Command/check | Expected result |
|---|---|---|
| Workspace intacto (types) | `npm run typecheck` | exit 0 |
| Workspace intacto (tests) | `npm test` | exit 0 |
| Web syntax | `node --check apps/hub/web/app.js` | exit 0 |
| Diff hygiene | `git diff --check` | exit 0 |
| Preview discovery | `npm test` (novo `preview.test.ts`) | port-scan/pty parsers passam |
| Protocol tolerante | teste de handshake em `runner.ts` | cliente antigo ignora `worktree.preview` |
| Grab redaction | teste unit do extractor | segredos redigidos, orçamento respeitado |
| Shell (manual) | `cd desktop && npm start` | janela abre na UI do Hub |
| Sem nuvem (manual) | inspeção de rede do app | zero requests fora da tailnet/loopback |

## 8) Test plan

- **Unit:** parser de porta→worktree por `cwd`; parser de URL anunciada no PTY; extractor do
  grab (sanitização, orçamento, redação de segredos); formatter do "Design Feedback";
  feature-detect do bridge (browser vs electron).
- **Integração:** `worktree.preview` ponta a ponta (Runner→Hub→cliente) com handshake
  tolerante; anexos do Design Feedback reabrindo no histórico.
- **Manual/E2E (Fase 1, gate visual):** grab real num app de exemplo, screenshot do overlay
  e do bloco chegando ao turno; preview remoto sobre Tailscale.
- **Regressão:** abrir `apps/hub/web` num browser puro confirma no-op (nenhuma entrada nova,
  nenhum erro de console).

## 9) Observability

Tags mínimas (sem conteúdo de DOM/segredos): `worktreeId`, `pageId`, `previewSource`,
`grabResult` (ok/cancelled/unavailable), `payloadBytes`, `screenshotBytes`, `redactions`,
`shell`, `shellVersion`, `bridgeVersion`. Métricas: tempo até primeiro preview, taxa de
`NO_PREVIEW`/`PREVIEW_UNREACHABLE`, falhas de screenshot. HTML/CSS capturado nunca entra em
métricas ou logs.

## 10) Risk, rollback, feature flag

- **Riscos:** Electron contaminar o install do Hub/Runner (mitigado por LEI 3 — fora do
  workspace); página de preview hostil (LEI 8 — guest sem preload); vazamento de segredo no
  payload (LEI 7 — redação+orçamento); custo de manutenção do bundler do grab (isolado no
  `desktop/`).
- **Rollback:** o shell é aditivo; remover `desktop/` não afeta Hub/Runner/PWA/Capacitor. A
  UI degrada sozinha sem o bridge. `worktree.preview` é negociado por capability, então
  reverter o Runner não quebra clientes.
- **Flags:** `JARVIS_DESKTOP` (build/scripts do shell); capacidade `designMode` só ligada
  quando o `desktop/` implementa o BrowserBridge; entrada Design Mode gated por
  `window.jarvis.capabilities.designMode`.

### 10.1 Environment and bootstrap

- `desktop/` tem toolchain própria (electron, electron-builder), **fora** do workspace
  (LEI 3). Fase 0 do shell roda **sem build** (Electron executa `main.js`/`preload.js`
  direto). O bundler só chega na Fase 1 (ferramentas do grab), isolado no `desktop/`.
- Node 22. Nenhuma env secreta com default no código. Novas envs (`JARVIS_APP_HUB_URL`)
  entram em `desktop/README.md` e no doctor.
- Artefatos de build (`node_modules`, `dist`, `out`) são gitignored, como em `mobile/`.

## 11) Implementation plan

**Fase 0 — Shell (cliente), fatia segura e fundacional:**

1. Scaffold `desktop/` fora do workspace: `package.json` (electron + electron-builder,
   `main: "main.js"`), `.gitignore`, `README.md` (build/run/OTA espelhando `mobile/`).
2. `desktop/main.js` — uma `BrowserWindow` com `contextIsolation`, carrega
   `JARVIS_APP_HUB_URL` (fallback `http://127.0.0.1:4577`), reconexão e abertura de links
   externos no navegador padrão.
3. `desktop/preload.js` — `contextBridge.exposeInMainWorld("jarvis", …)` expondo só
   identidade da casca + `capabilities` (Fase 0: `designMode:false`).
4. `desktop/electron-builder.yml` — targets por SO + auto-update (electron-updater); doc
   de assinatura/notarização como passo do operador.
5. Docs/FDD: seção no `docs/ARCHITECTURE.md` (terceira casca), entrada no doctor, e o
   contrato do bridge (§4.1) documentado. **Nenhuma mudança em source do workspace.**

**Fase 1 — Design Mode (atrás de flag, isolado no `desktop/`):**

6. `packages/core/src/preview.ts` — port-scanner (atribui porta→worktree por `cwd`) +
   watcher da URL anunciada no PTY; `preview.test.ts`.
7. `packages/protocol/src/runner.ts` — `worktree.preview` (anúncio) + `getWorktreePreview`
   (consulta) + bump de versão tolerante; relay no Hub; testes de handshake.
8. `desktop/src/browser/webview.js` — guest `<webview>` (`webviewTag`), carrega a URL de
   preview, remove preload herdado do guest (LEI 8).
9. `desktop/src/browser/grab-guest-script.js` — picker injetado (overlay em shadow-root,
   `elementFromPoint`) + extractor (HTML sanitizado, estilos, seletor, a11y, bounds,
   redação de segredos); `desktop/src/browser/screenshot.js` — `capturePage` + recorte no main.
10. Bridge do grab: `desktop/preload.js` ganha `jarvis.browser.*` (§4.2) + handlers IPC no
    main; tipos compartilhados em `desktop/src/shared/grab-types.js`.
11. Integração na UI (gated): `apps/hub/web/app.js` mostra a entrada Design Mode quando
    `window.jarvis?.capabilities?.designMode`; roda o grab; `formatDesignFeedbackMarkdown()`
    injeta como anexo/contexto do turno-alvo; UI de confirmação. **Gate visual: evidência.**
12. Testes + docs de gate/review: unit do extractor/redação e da descoberta de preview;
    `docs/gates/DSK-01-12-desktop-design-mode-gate.md` +
    `docs/reviews/DSK-01-12-desktop-design-mode-review.md`.

Cada passo em 1–2 arquivos (um teste e seu módulo contam como par natural), como no padrão
JRV. Fase 0 e Fase 1 são fatias independentes: a Fase 0 já entrega valor (app desktop +
auto-update) sem nada da Fase 1.

## 11.1) Implementation status (2026-07-27)

Fases 0 e 1 **implementadas**. Gate/review em `docs/gates/DSK-01-12-…-gate.md` e
`docs/reviews/DSK-01-12-…-review.md`. Gates verdes (typecheck, web syntax, `preview.test.ts` 9/9,
suíte 348/350 com 1 flaky verde em isolamento). **Evidência visual pendente** de build local do
Electron (declarado no gate). Desvio consciente: o bridge do Design Mode opera por `webContentsId`
(o renderer é dono do `<webview>`), não `openPreview`/`pageId` como esboçado em §4.2. Limitação
conhecida: host do preview é `127.0.0.1` (runner local); runner remoto usa URL manual até anunciar
endereço de tailnet. **Fase 2 (fan-out) segue fora de escopo** (próximo spec).

## 12) DoR / DoD

**DoR:** direção aprovada (memória `jarvis-electron-designmode-direction`); análise do Orca
por código real concluída (memória `orca-reference-clone`); contratos, invariantes, edge
cases, Gherkin, verificação, ambiente e plano preenchidos; aprovação humana registrada no
frontmatter ("Pode fazer tudo").

**DoD (por fase):**
- **Fase 0:** `desktop/` builda e abre na UI do Hub; PWA/Capacitor/typecheck/test do
  workspace inalterados (LEI 3 comprovada — `npm install` do Hub intocado); ARCHITECTURE +
  doctor + README atualizados; evidência = screenshot da janela na UI do Hub.
- **Fase 1:** `worktree.preview` verde ponta a ponta com handshake tolerante; extractor
  redige segredos e respeita orçamento; grab real chega ao turno como markdown+imagem
  (evidência visual anexada ao gate); zero request fora da tailnet/loopback; gate/review
  registrados; typecheck/test verdes.
