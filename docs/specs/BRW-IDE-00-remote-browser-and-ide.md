---
feature_id: BRW-IDE-00-remote-browser-and-ide
tldr: "Um browser por máquina, usável de qualquer dispositivo e que a IA consegue ver e dirigir; e o Jarvis como IDE (editor leve próprio + code-server por máquina)."
title: "Browser remoto (perfil = máquina) e IDE"
owner: "Jonathan / Claude"
status: F1-F2-F3-F4-implemented-awaiting-review
risk_level: high
stack: node
services_affected: [hub, runner, protocol, core, web, mcp, desktop]
dependencies: [DSK-01-12-desktop-design-mode]
schema_required: false
schema_dependencies: []
links:
  roadmap: "Pedido de 2026-10-19: 'essa aplicação se torne uma IDE e um browser'"
  design: "Chat em 2026-10-19 (plano + decisões)"
  adr: "N/A"
approval_evidence: "Usuário em 2026-10-19: um perfil por máquina; agente 'depende — no geral separado, mas a análise no mínimo no mesmo perfil'; F1 e F3 em agentes paralelos; browser só para o dono; 'Sim, pode começar' o F0."
---

# Executable spec

## 0) Meta (TL;DR)

Dois produtos sobre a mesma espinha (runner por máquina + Hub roteando + cliente único):

1. **Browser remoto** — cada máquina tem UM perfil de browser (Chromium dedicado) que o dono abre de
   qualquer dispositivo (PWA, celular, Electron). Só pixels e input atravessam a rede; cookies e
   senhas nunca saem da máquina. A IA consegue **ver** o que o dono vê (mesmo perfil) e **dirigir**
   um browser (perfil próprio por padrão; o do dono só com opt-in explícito).
2. **IDE** — nível 1: o visualizador de arquivos que já existe passa a editar (CodeMirror 6). Nível 2:
   VS Code de verdade via **code-server** (MIT) por máquina, aberto num painel do Jarvis.

Não construímos browser nem IDE do zero.

## 1) Context and objective

### 1.1 Problem

- Hoje o browser embutido (Design Mode, `desktop/src/browser/`) só existe no Electron e só enxerga a
  máquina local. Para usar o browser de outra máquina o dono precisa entrar nela.
- O Jarvis lê arquivos (`readfile`/`listdir`) mas não edita; não há IDE.
- O que JÁ existe e será reaproveitado: terminal remoto por máquina (`packages/core/src/terminal.ts`,
  `terminal_*` no protocolo — o padrão a copiar); árvore + viewer + diff + anotações para a IA;
  `BrowserSessionEvent` reservado no protocolo (`packages/protocol/src/runner.ts`) para "future
  Browser Runtime/MCP/Runner adapter"; `PreviewCandidate`; o picker de elementos do Design Mode
  (`desktop/src/browser/grab-guest-script.js`).

### 1.2 Objective (Definition of Value)

- O dono abre o browser da máquina X pelo celular, navega, digita, e o login feito ontem continua lá.
- O dono seleciona vários pontos de uma página (logada) e manda para a IA analisar/agir.
- Claude/Codex navegam sozinhos num browser e o dono assiste ao vivo.
- O dono edita um arquivo de qualquer máquina sem sair do Jarvis; quando precisa de IDE completa,
  abre o VS Code daquela máquina num painel.

## 2) Dual-source planning

| Necessidade | Fonte open source escolhida | Por quê | Descartado |
|---|---|---|---|
| Ver/controlar browser remoto | CDP do próprio Chrome (`Page.startScreencast` + `Input.dispatch*`), sem dependência nova | Funciona headless, em Windows/macOS/Linux, sem Docker | **neko** (só Linux/Docker); **Steel Browser** (serviço extra por máquina; fica como referência); WebRTC (complexidade, fase futura) |
| IA dirigindo o browser | **Ferramentas próprias** (`jarvisbrowser`, conjunto no estilo do Playwright MCP) sobre o `BrowserManager` da F1 — **decisão da F2, ver §16.1** | Os três níveis precisam de UM ponto de aplicação na máquina dona do browser; nenhuma dependência nova | **Playwright MCP** / **Chrome DevTools MCP**: exigem CDP cru (`--cdp-endpoint`), que é controle total do perfil (JS arbitrário, exportar cookies) — o nível não teria onde ser aplicado — e um npx/npm em cada máquina |
| IA vendo sem dirigir | As mesmas ferramentas, com só as de **leitura** valendo no perfil do dono (nível Ver) | Um servidor só, nível decidido por chamada | Dar controle total para analisar |
| Editor leve | **CodeMirror 6** (MIT) | Leve e bom no celular | Monaco (ruim no mobile) |
| IDE completa | **code-server** (Coder, MIT) | Ativo (v4.141.0, 2026-10-08) e publica `windows-amd64`, macOS, Linux; Open VSX tem `anthropic/claude-code` e `openai/chatgpt` | OpenVSCode Server (só Linux, última release 2026-02); `code serve-web` (licença não-OSS); Eclipse Theia (manter um produto-IDE) |

## 3) Rules and invariants (SYSTEM LAWS)

1. **Cookies, senhas e storage do perfil nunca saem da máquina.** Pela rede passam só frames, input e
   metadados (URL, título, abas). Nenhuma sincronização de perfil entre máquinas.
2. **CDP só em loopback.** Nenhuma porta de debug, nem do code-server, escuta fora de `127.0.0.1`. O
   acesso remoto passa SEMPRE pelo Hub (uma única fronteira de auth/grants/auditoria).
3. **Browser e IDE são owner-only.** Membros não veem o browser nem a IDE de nenhuma máquina, mesmo
   com grant no runner (decisão de 2026-10-19). Toda abertura/ação é auditada em `audit.log`.
4. **Um perfil do dono por máquina.** O perfil do agente é um perfil de SISTEMA separado (não aparece
   como perfil do dono) — ver §3.1.
5. **O Hub não interpreta frames.** Repasse binário opaco, só enquanto existe espectador, com
   backpressure (descarta frame quando o socket do cliente acumula); a guarda de lag do event loop já
   existente continua sendo o juiz (ver INC-03).
6. **Feature-detect, nunca forkar a UI** (lei do DSK-01-12): sem runner com a capacidade, o painel não
   aparece; PWA/Capacitor/Electron usam o mesmo cliente.

### 3.1 O agente e os perfis (a decisão "depende")

Três níveis, do mais seguro para o mais poderoso; o padrão é o recomendado:

| Nível | Perfil | O que a IA pode | Como é concedido |
|---|---|---|---|
| **Ver** (padrão no perfil do dono) | do dono | receber o que o dono seleciona (pontos/elementos, recorte de screenshot, URL, texto) e, sob pedido, `browser_tabs/snapshot/screenshot/wait` read-only no perfil do dono. A IA **não abre** o browser do dono (fechado = recusa) | o dono seleciona e envia (🎯) — é o fluxo "marco vários pontos e peço à IA"; a leitura vale em todo turno do dono |
| **Dirigir no perfil do agente** (padrão para autonomia) | `agent` (`~/.jarvis/browser/agent`), separado, sem logins do dono; sobe sob demanda, mesma proteção contra órfão da F1 | navegar, clicar, preencher, teclas, abas, diálogos — ferramentas `jarvisbrowser` | automático em todo turno do DONO numa máquina com browser (`JARVIS_BROWSER_AGENT=0` desliga); o dono assiste em 🌐 › 🤖 IA |
| **Dirigir no perfil do dono** | do dono | o mesmo, mas logado | opt-in explícito por SESSÃO (🤖 no painel + confirmação), com "IA no controle" visível (barra no painel + selo no 🌐), botão **Assumir** e expiração no fim do turno da sessão, na queda do link com o Hub ou em 30 min |

Regras transversais (F2): só turno do **dono** recebe a ponte (membro nunca, mesmo com grant na
máquina); nenhum nível tem avaliação de JS arbitrário nem acesso a cookies/storage; a IA só abre
http(s)/about:blank (nada de `chrome://`, `file:`); sessão em modo **planejamento** só lê; toda chamada
é auditada sem conteúdo de página nem texto digitado.

Racional: a análise precisa ver o que está logado (nível Ver cobre sem entregar o controle); páginas
podem conter prompt injection, então dirigir logado é exceção consciente, não padrão.

## 4) Contracts (APIs / events / DB / tools)

### 4.1 Protocolo do browser (runner 17 → 18) — contrato final da F1

Capacidade: `RUNNER_CAPABILITY_SINCE.remoteBrowser = 18` **e** `RunnerInfo.browser === true` (a máquina
achou um navegador e `JARVIS_BROWSER≠0`). Runner < 18 ou sem `browser` simplesmente não oferece o
painel. Para o cliente, `machines[].browser` só vem `true` para o **dono** (membro nem fica sabendo).
Tipos em `packages/protocol/src/runner.ts`; validação do lado do cliente em `apps/hub/src/browserRelay.ts`.

Hub → Runner (o Hub já checou owner-only; o runner só executa):

| Mensagem | Campos | Observação |
|---|---|---|
| `browser_open` | `reqId, profile: "owner"\|"agent"` | sobe o Chrome se preciso (lazy); responde `browser_state` com o `reqId`. F1 só libera `owner` |
| `browser_tab` | `reqId?, op: "new"\|"close"\|"activate", pageId?, url?` | o estado novo sai por `browser_state` |
| `browser_nav` | `pageId, url? \| action?: "back"\|"forward"\|"reload"\|"stop"` | URL normalizada NO runner (`normalizeNavUrl`: https padrão, http para rede local, busca para texto solto, `javascript:` recusado) |
| `browser_input` | `pageId, input: BrowserInput` | `mouse{type:move/down/up,x,y,button,buttons,clickCount,modifiers}`, `wheel{x,y,dx,dy}`, `key{type:down/up,key,code,modifiers}`, `text{text}`; coordenadas em px CSS |
| `browser_view` | `pageId, on, maxWidth?, maxHeight?` | liga/reajusta/desliga o screencast. O HUB conta os espectadores e manda `on:false` quando o último sai; `max*` = a MAIOR tela entre eles (px de dispositivo) |
| `browser_feedback` | `pageId, delivered, dropped` | ≈1/s por aba com tráfego: alimenta a qualidade adaptativa |
| `browser_viewport` | `pageId, width?, height?, mobile?, scale?` | "ajustar à tela" (Emulation.setDeviceMetricsOverride); sem `width` volta ao padrão |
| `browser_dialog` | `pageId, accept, promptText?` | responde alert/confirm/prompt/beforeunload (a página fica parada até isso) |
| `browser_shutdown` | `profile` | encerra o Chrome do perfil (o perfil continua no disco) |

Runner → Hub: `browser_state {reqId?, state: {profile, running, pages[], activePageId?, reason?}}`
(com debounce de 80 ms, a cada mudança de aba/URL/título/carregamento/diálogo), `browser_error {reqId?,
pageId?, message}` e os **frames binários**. `pages[]` = `{pageId, url, title, loading?, canGoBack?,
canGoForward?, openerId?, dialog?, viewport?, viewing?}`.

Cliente ↔ Hub: as mesmas operações com `runnerId` (`browser_open`, `browser_tab`, `browser_nav`,
`browser_input`, `browser_view`, `browser_viewport`, `browser_dialog`, `browser_shutdown`) mais
`browser_fack {runnerId, pageId}` (um por frame recebido, depois de desenhado ou descartado — é o
crédito; o Hub NÃO repassa ao runner) e `browser_detach {runnerId}` (fechou o painel). O Hub devolve
`browser_state {runnerId, …}` e `browser_error {runnerId, reqId?, pageId?, message}` só para os sockets
de dono com o painel daquela máquina aberto. `browser_event` (já existente) ficou para a F2.

Frame binário (mesmo Buffer do runner ao cliente; o Hub só lê o pageId):

```
off len campo
0   1   kind = 0x42 ('B')   — reserva espaço para outros binários na mesma conexão (ex.: túnel da IDE)
1   1   versão = 1
2   1   L = tamanho do pageId (1..64, ASCII)
3   1   qualidade JPEG usada
4   4   seq (u32 BE, por aba)
8   8   t0 (f64 BE, ms epoch em que o produtor recebeu o frame do Chrome)
16  2   largura do viewport em px CSS (u16 BE) — base para converter coordenadas do input
18  2   altura do viewport em px CSS (u16 BE)
20  L   pageId
20+L …  JPEG cru
```

Produtor ("o mais recente vence", §13.1): o frame do CDP é confirmado na hora; um timer no teto de
fps (`JARVIS_BROWSER_FPS`, padrão 15) despacha só o último, e só se o link escoou (`bufferedAmount <
2 MB` no runner). O frame do CDP não passa por `JSON.parse` (o base64 é fatiado do texto e só o
vencedor é decodificado). Relay: crédito de 2 frames sem `fack` por espectador, guardando só o mais
recente; quem chega numa aba já assistida recebe o último frame na hora; frame de aba sem espectador
não é repassado e o produtor recebe `browser_view{on:false}` (no máximo 1 lembrete a cada 2 s).

Code-server (contrato final no §17.2): `ide_open {reqId, cwd}` → runner sobe sob demanda em
`127.0.0.1:<porta livre>`; o Hub expõe `/ide/<runnerId>/…` com proxy HTTP+WS **autenticado** —
direto para a máquina do Hub, por **túnel multiplexado na conexão do runner** (frames binários
`kind 0x54`) para as outras. O proxy preserva o `Host`, passa a pasta como URI `/c:/…` e injeta
`Service-Worker-Allowed` (§13.2).

### 4.2 Arquivo (contrato final da F3 — protocolo 18)

Capacidades em `RUNNER_CAPABILITY_SINCE`: `fileWrite: 18`, `fileSearch: 18`. Cliente → Hub leva
`runnerId?` (ausente = a máquina para onde o cliente está roteado); Hub → runner leva o `reqId` **do
Hub** (o do cliente nunca vira chave de pendência) e a resposta volta ao cliente com o `reqId` dele +
`runnerId`.

```
writefile   {reqId, runnerId?, path, cwd?, content, expectedMtimeMs?, expectedSize?, force?, create?}
filesaved   {reqId, runnerId, path, name?, ok, mtimeMs?, size?, created?,
             conflict?: {mtimeMs?, size?, missing?, exists?}, error?}
searchfiles {reqId, runnerId?, cwd, query, regex?, caseSensitive?, max?}          // max ≤ 1000, padrão 200
searchresults {reqId, runnerId, cwd, query, truncated, engine?: "rg"|"node", error?,
               results: [{path, rel, line, col, preview, hl: [início, fim)}]}      // hl = trecho DENTRO de preview
filecontent (aditivo) … readOnlyReason?   // por que este arquivo não é editável sem perda
readfile    (aditivo) … runnerId?         // a aba relê da máquina de onde o arquivo veio
```

Semântica de `writefile`:
- Sem `force`, exige `expectedMtimeMs`; se `mtimeMs` (ou `size`, quando enviado) do disco diferir,
  devolve `conflict` com a versão atual e **não grava**. Arquivo sumido → `conflict.missing`.
- `force:true` = "sobrescrever mesmo assim" (o usuário viu o conflito); pula só o conflito, nunca as
  guardas de caminho/somente-leitura. Sobre arquivo sumido, recria.
- `create:true` sem `expectedMtimeMs` cria arquivo novo e **nunca** sobrescreve (`conflict.exists`).
- Recusas (`ok:false, error`): fora de dono (no Hub), protocolo < 18, máquina offline, caminho vazio
  ou relativo sem `cwd`, qualquer coisa dentro de `.git`, imagem, conteúdo > 512 KB, arquivo atual
  > 512 KB / com NUL / fora de UTF-8 (a leitura foi com perda), somente leitura, máquina drenando
  para atualização (runner).
- Grava atômico (temporário na mesma pasta + rename; retentativa em `EPERM/EACCES/EBUSY` no
  Windows), segue link simbólico, preserva modo POSIX, e grava os bytes exatamente como vieram (o
  cliente preserva CRLF/LF e BOM).

## 5) Data models

Perfis em `~/.jarvis/browser/owner/` e `~/.jarvis/browser/agent/` (user-data-dir do Chromium).
code-server em `~/.jarvis/ide/` (binário baixado + `user-data`/`extensions` próprios).

## 6) Flow

```
dono abre Browser ▸ máquina X
  hub(owner-only?) → runner X: browser_open{profile:owner}
  runner: chrome --headless=new --user-data-dir=~/.jarvis/browser/owner --remote-debugging-port=0
          (lê DevToolsActivePort; CDP só loopback)
  runner: Page.startScreencast → frames binários → hub → cliente (canvas)
  cliente: mouse/teclado → hub → runner → Input.dispatch*
  cliente fecha/minimiza → browser_view{on:false} → Page.stopScreencast (custo zero sem espectador)
```

## 7) Acceptance criteria (Gherkin)

- GIVEN o dono no celular WHEN abre o browser da máquina X e navega THEN vê a página e o login de
  ontem persiste; nenhum cookie trafega (inspecionar frames do Hub).
- GIVEN um membro com grant na máquina X WHEN tenta abrir o browser THEN é recusado e auditado.
- GIVEN nenhum espectador WHEN o browser está aberto THEN o Hub não recebe frames.
- GIVEN a IA no nível Ver WHEN o dono marca 3 pontos e envia THEN a IA recebe os 3 (seletor, texto,
  recorte) e NÃO tem ferramenta de clique no perfil do dono.
- GIVEN o arquivo alterado pela IA depois da abertura WHEN o dono salva THEN vê conflito, não perde
  nenhuma das versões.

## 8) Test plan

Unit: codec do frame binário, backpressure (descarte), owner-only gate, `writefile` com conflito.
Integração: runner + Chrome headless real (como o spike F0). Manual: celular via Tailscale.

## 9) Observability

Por sessão de browser: fps entregue, frames descartados, bytes/s, latência de input; lag do event loop
do Hub (guarda existente) correlacionado com espectadores ativos.

## 10) Risk, rollback, feature flag

- **Hub congestionado** (INC-01..03): mitigado pela regra 5 do §3. O F0 mediu o relay opaco com o lag
  do event loop igual ao ocioso, mesmo a 650 MB/10 s (§13.1). Processo de relay dedicado NÃO é
  necessário; fica como saída se a guarda de lag reclamar em produção.
- **Chrome órfão** (mesma classe que já travou a máquina): no F0, um Chrome sobreviveu alguns segundos
  ao runner morto à força. F1: pidfile por perfil + o runner, ao subir, recolhe qualquer Chrome com o
  `--user-data-dir` dele antes de abrir outro; o encerramento normal mata a árvore.
- **Banda no celular**: o pior caso a 15 fps dá 36 Mbps (§13.1). Resolução pelo tamanho da tela do
  espectador + qualidade adaptativa são obrigatórias na F1.
- **Login bloqueado em browser automatizado/headless** (ex.: Google): fallback de logar uma vez com
  janela visível na máquina.
- **Hub roda como serviço no Windows** (sessão 0): browser da máquina do Hub é headless.
- **code-server no Windows**: a doc oficial ainda diz que não publica Windows, mas o build 4.141.0
  funcionou no F0 (§13.2). Manter versão fixada e revalidar a cada atualização. Ele cria
  `~/.vscode-oss-shared` fora do `--user-data-dir`.
- Flag do browser (**mudou na F1**): ligado por padrão quando a máquina tem Chrome/Edge/Chromium, com
  `JARVIS_BROWSER=0` como kill switch (Hub e runner). Motivo: anunciar a capacidade não custa nada — o
  Chrome só sobe no primeiro `browser_open` e desliga sozinho sem espectador (`JARVIS_BROWSER_IDLE_MIN`,
  padrão 10) — e um opt-in por máquina obrigaria a editar o `runner.env` de cada uma para algo que só
  o dono enxerga. `JARVIS_BROWSER_PATH` força o executável.
- Flag da IDE (**mudou na F4**, mesmo raciocínio): capacidade ligada por padrão onde o code-server
  publica build, `JARVIS_IDE=0` como kill switch (Hub e runner). Anunciar não baixa nada: o download
  (~218 MB) só acontece quando o dono confirma na tela, e o code-server só sobe ao abrir e desliga
  sozinho sem aba aberta (`JARVIS_IDE_IDLE_MIN`, padrão 30). `JARVIS_IDE_CODE_SERVER` usa um
  code-server já instalado (sem a conferência de hash).

### 10.1 Environment and bootstrap

Chrome/Chromium instalado (Chrome, Edge ou o Chromium do Playwright); Node ≥ 22.

## 11) Implementation plan (BEFORE CODING)

| Fase | Entrega | Paralelismo |
|---|---|---|
| **F0** | Spike: screencast + relay + input medidos; code-server Windows atrás de proxy com prefixo. **Gate go/no-go.** | — |
| **F1** | Browser remoto v1: perfil do dono, abas, URL, input, celular, owner-only | agente A |
| **F2** | IA: nível Ver (ferramentas read-only + seleção de pontos portada do Design Mode), perfil `agent` + ferramentas `jarvisbrowser` (no lugar do Playwright MCP, §16.1), opt-in no perfil do dono | após F1 |
| **F3** | Editor leve: `writefile` + CodeMirror 6 + abas + busca | agente B (paralelo à F1) |
| **F4** | code-server por máquina via `/ide/<runner>/` | após F3 |

**Fora de escopo:** fork de VS Code/Theia; sincronizar perfis entre máquinas; WebRTC; extensões
Chrome; agente de uma máquina dirigindo o browser de outra; acesso de membros.

## 12) DoR / DoD

DoR F1/F3: resultados do F0 registrados em §13 e gate aprovado pelo dono.
DoD por fase: typecheck + `npm test` verdes, critérios do §7 da fase verificados, sem restart
autônomo de Hub/runner (o dono reinicia).

## 13) F0 — resultados (2026-10-19, máquina do Hub, Windows 11, Chrome do sistema, Node 22.14)

Scripts reproduzíveis e descartáveis: `scripts/spikes/browser-screencast.mjs` (runner + relay no papel
do Hub + espectadores sintéticos; modo `serve` para teste manual) e `scripts/spikes/code-server-proxy.mjs`
(code-server atrás de proxy com prefixo + prova com Chromium headless). **Tudo em loopback** — o teste
pela rede real (Tailscale/celular) ficou para o dono (§13.3).

### 13.1 Browser remoto

| Cenário (1280×800, JPEG) | fps entregue | Mbps/espectador | KB/frame | lag do relay p99 (ocioso: 24 ms) |
|---|---|---|---|---|
| Página animada, sem teto | 60 | 4,9 | 10 | 20–22 ms |
| Ruído em tela cheia (pior caso), sem teto | 58 | 180 | 380 | 21–22 ms (650 MB repassados em 10 s, 0,8 s de CPU) |
| Ruído, teto 15 fps, q50 | 14 | 36 | 325 | 31 ms |
| Página animada, teto 30 fps | 27 | 2,2 | 10 | 21 ms |
| Wikipedia real com cliques, teto 30 | 4 (só quando muda) | 3,6 | 107 | 18 ms |

- Chrome headless sobe e entrega o CDP em **185–320 ms**.
- **O relay no papel do Hub custa quase nada**: o lag do event loop fica igual ao ocioso (os 15,5 ms
  de p50 são a granularidade do timer do Windows) mesmo repassando 650 MB em 10 s para 3 espectadores.
  O repasse opaco (sem parse) é o motivo. O worker/processo separado de relay **não** se justifica.
- **Teto de fps segurando o ack do Chrome NÃO funciona**: medido 38 fps com teto 15, porque o Chrome
  não espera o ack frame a frame. O que funcionou foi **"o mais recente vence" no runner**: o Chrome é
  confirmado na hora, o runner despacha no ritmo do teto e substitui o frame pendente (nunca enfileira).
- **Fila por bytes no relay segura memória mas não atraso**: espectador lento acumulava ~690 ms. Com
  **crédito por espectador** (no máximo 2 frames sem confirmação `fack`, guardando só o mais recente),
  a mediana de atraso do espectador lento caiu para ~22 ms. O p95 de ~700 ms é a própria pausa simulada.
  A memória do relay ficou estável (~88 MB).
- Base64 → JPEG cru economiza 25% do fio (o CDP entrega base64).
- Input: ida-e-volta de clique p50 2–3 ms, p95 ≤ 19 ms em loopback; ~250 ms no pior caso (ruído +
  3 espectadores), causado pelo Chrome ocupado renderizando, não pelo relay.
- Latência medida da chegada do frame no runner até o espectador; não inclui o encode do Chrome.

**Decisões para a F1 que saem daqui:** "o mais recente vence" no runner + crédito `fack` por espectador
(§4.1). **Resolução e qualidade adaptativas são obrigatórias**: o pior caso a 15 fps ainda dá 36 Mbps.
O espectador informa o tamanho real da tela (`maxWidth`), e a qualidade cai quando o crédito esgota.
O screencast só liga com espectador.

### 13.2 IDE (code-server 4.141.0, build `windows-amd64`)

- O build Windows **funciona**: traz o próprio `node.exe` (Node 24), 218 MB baixados / 644 MB
  descompactados, sobe em **0,4–1,7 s**, workbench pronto em **1,6–2,2 s**.
- Atrás de proxy com prefixo `/ide/<máquina>/`, comprovado com Chromium headless:
  - o Explorer lista os arquivos (30 linhas);
  - o terminal integrado executa: o PowerShell escreveu o arquivo de prova com `42`;
  - a webview (preview de Markdown, mesmo mecanismo do painel da extensão do Claude Code) renderiza;
  - os 2 WebSockets passam pelo proxy.
- A extensão `anthropic.claude-code` v2.1.303 **instala do Open VSX em 16 s** (build `win32-x64`).
- Três pegadinhas que o proxy/runner do Jarvis precisa tratar:
  1. **Preservar o `Host` original.** O code-server recusa WebSocket cujo `Origin` não bate com o
     `Host` (anti-CSRF dele). Reescrever o `Host` derruba a conexão com 1006 ("workbench failed to
     connect").
  2. **Pasta em formato URI no Windows.** `?folder=/c:/Users/...`; com `C:/...` ou `C:\...` o
     Explorer abre a raiz **vazia**.
  3. **Bug do code-server no Windows.** Ele só envia `Service-Worker-Allowed` quando o caminho termina
     em `/serviceWorker.js`, e com `\` isso nunca acontece. O proxy injeta o header (validado). Sem
     ele as webviews **continuam funcionando** (têm Service Worker próprio); só o Service Worker raiz
     falha. É desejável, não bloqueante.
- 404 em `vsda.js`/`vsda_bg.wasm` é esperado: é um módulo proprietário da Microsoft, ausente no build
  open source. Inofensivo.
- **Efeito colateral:** o code-server cria `~/.vscode-oss-shared/sharedStorage` FORA do
  `--user-data-dir`. A F4 deve isolar com `HOME`/`USERPROFILE` próprios ou aceitar e documentar.
- **Não testado no F0:**
  - o túnel até um runner REMOTO. O runner disca o Hub, então o Hub não alcança o `127.0.0.1` dele;
    o proxy HTTP+WS precisa ir multiplexado sobre a conexão do runner ou num canal dedicado. Fica
    para a F4;
  - o painel da extensão do Claude Code logado;
  - macOS/Linux.

### 13.3 Gate — o que falta para o go

1. **Teste do dono pela rede real** (único item que o spike não cobre): numa máquina com o repo,
   `node scripts/spikes/browser-screencast.mjs serve --host <IP-tailscale-da-máquina> --port 47811`,
   abrir `http://<IP>:47811/` pelo celular, navegar (barra de endereço, cliques, roda, teclado) e dizer
   se a fluidez é aceitável. ⚠️ Esse modo **não tem autenticação**: use só o IP do Tailscale e
   encerre com Ctrl+C depois.
2. Aprovação do dono para F1 (browser) e F3 (editor leve) em agentes paralelos.

## 14) F1 — implementação (2026-10-19, não commitada; aguardando revisão)

### 14.1 Onde está

- `packages/core/src/browser.ts` — `BrowserManager` (um `ProfileBrowser` por perfil; F1 libera só
  `owner`) + funções puras: descoberta do executável, argumentos do Chrome, casamento de linha de
  comando (recolhimento de órfão), codec do frame, parse rápido do CDP, mapa de teclas/mouse,
  normalização de URL, `QualityController`. O host injeta a fábrica de WebSocket (o core não depende
  de `ws`).
- `apps/runner/src/index.ts` — hospeda o gerenciador, anuncia `browser`, frames binários sem deflate.
- `apps/hub/src/browserRelay.ts` — gate owner-only, contagem de espectadores, relay opaco com crédito,
  validação das mensagens do cliente. `apps/hub/src/index.ts` — browser LOCAL em processo (como o
  terminal), roteamento para runners, binário na conexão do runner, auditoria, log `browser_relay`
  (fps entregue/descartes/Mbps) a cada minuto com tráfego e `browser_view_session` ao fim de cada aba
  assistida.
- `apps/hub/web/app.js` + `index.html` — painel 🌐 (feature-detect; só dono), perfis = máquinas, abas,
  barra de endereço, voltar/avançar/recarregar, status (fps · qualidade · viewport), canvas via
  `createImageBitmap`, `fack` por frame, `maxWidth` = largura CSS × DPR (teto 1920), mouse/roda/teclado,
  colar (texto DESTE dispositivo), toque = clique, arrasto = rolagem, ⌨ abre o teclado do celular
  (campo oculto; IME por `compositionend`), diálogos JS, "ajustar à tela" (automático uma vez por aba
  em tela estreita), para o screencast quando a aba do cliente fica oculta. `sw.js` não mudou (nenhum
  arquivo novo a pré-cachear).

### 14.2 Desvios do esboço, com motivo

1. **Flag**: `JARVIS_BROWSER=0` desliga; padrão ligado quando há navegador (ver §10).
2. **Teclado**: imprimível vai como `Input.dispatchKeyEvent{keyDown, text}` (gera keydown/keypress/input
   reais — atalhos e autocomplete de site dependem disso); `Input.insertText` fica para o texto pronto
   (teclado do celular, IME, colar). Enter leva `"\r"` (é o que dispara o submit).
3. **`browser_fack` não vai ao runner**: o crédito é do relay (Hub). O runner recebe
   `browser_feedback` agregado ≈1/s para a qualidade adaptativa.
4. **Mensagens novas**: `browser_feedback`, `browser_viewport`, `browser_dialog`, `browser_shutdown`,
   `browser_detach` (cliente). Sem `browser_dialog` uma página com `confirm()` ficava parada sem nenhum
   sinal na UI; sem `browser_viewport` uma página de 1280 px no celular fica ilegível.
5. **`browser_grab`** ficou para a F2 (seleção de pontos para a IA).
6. **Recolhimento de órfão** além do pedido: varredura pela linha de comando depois de todo kill e
   recolhimento no **boot** do host (assíncrono, 5 s depois do boot; não mexe se o pidfile aponta outro
   host vivo). Motivo medido abaixo.
7. **User-Agent**: o headless se anuncia "HeadlessChrome"; o runner troca por "Chrome" por aba
   (`Emulation.setUserAgentOverride`) para reduzir bloqueio de login (§10). Popup aberto antes do
   attach pode fazer a primeira requisição com o UA headless.

### 14.3 Medido nesta implementação (Windows 11, Chrome do sistema, loopback)

- Primeiro frame no canvas ~1,4 s depois de abrir o painel num Hub frio (inclui subir o Chrome).
- O CDP do Chrome escuta só em `127.0.0.1` (conferido com `netstat` durante o teste).
- O viewport real do `--headless=new` com `--window-size=1280,800` é **1264×701** px CSS (o headless
  reserva a "moldura" da janela): o cabeçalho do frame leva o tamanho real e o cliente converte por ele.
- `Page.startScreencast` com o screencast já ligado é **recusado** pelo Chrome ("Screencast is already
  active"): trocar largura/qualidade é parar e ligar de novo.
- O Chrome **não** manda `targetInfoChanged` quando a página troca `document.title` por JS: o título é
  relido em carga/navegação e ~1/s na aba assistida.
- **Órfão**: matando o Hub em árvore (`taskkill /T /F`, como o watchdog faz), em 1 de 2 execuções um
  auxiliar do Chrome (utilitário "quarantine", criado durante o kill) escapou da árvore e ficou vivo.
  Mitigação: recolhimento no boot do host + varredura depois de todo kill; o teste de integração cobre
  o recolhimento de boot.
- **Chrome ≥ 136 + `USERPROFILE` trocado**: com o `USERPROFILE` do processo apontando para outra pasta,
  o Chrome recusa o CDP ("DevTools remote debugging requires a non-default data directory") mesmo com
  `--user-data-dir`. O launcher agora falha na hora com essa explicação em vez de um timeout de 20 s.
  **Risco para o Hub como serviço na sessão 0**: se a conta do serviço não for a do usuário, o browser
  LOCAL pode não abrir (os runners não são afetados). Não testado aqui.

### 14.4 Testes

Unit: `packages/core/src/browser.test.ts` (descoberta, argumentos, casamento de órfão, codec, parse
rápido, teclas/mouse, URL, qualidade) e `apps/hub/src/browserRelay.test.ts` (crédito, mais recente
vence, espectador lento não freia o rápido, contagem de espectadores, crédito preso, owner gate,
capacidade, validação). Integração com Chrome real: `apps/runner/src/browser.integration.test.ts`
(frames, clique, teclado, Enter/submit, histórico, abas, reinício de screencast, encerramento sem
processo, órfão recolhido no open e no boot; pulado sem navegador). E2E no Hub real com auth:
`apps/hub/src/browser.e2e.test.ts` (membro com grant recusado e auditado, capacidade só para o dono,
roteamento, frames binários byte a byte com crédito, sem espectador = sem repasse, socket caindo
desliga o screencast).

### 14.5 Não coberto pela F1

Runner remoto de verdade pela rede (Tailscale) e celular físico; Hub como serviço do Windows (sessão
0); macOS/Linux; login real em site que bloqueia headless; Electron/Capacitor (mesmo cliente, não
exercitado nos shells); áudio, downloads/uploads, clipboard da máquina → dispositivo, IA (F2).

## 15) F3 — editor leve (implementado em 2026-10-19, branch `brw-ide/f3-editor`, sem commit)

Entregue: `writeProjectFile` + `searchProjectFiles` no core; `writefile`/`searchfiles` no runner e no
Hub (só o dono, auditado); CodeMirror 6 vendorizado e carregado sob demanda; modo Editar, abas,
salvar com conflito, busca no projeto. Contrato no §4.2; uso em `docs/file-explorer-and-review.md`.

Arquivos: `packages/core/src/{files.ts,file-search.ts,file-search-worker.mjs}`,
`packages/protocol/src/runner.ts`, `apps/hub/src/fileEdit.ts` (regras) + fiação em `apps/hub/src/index.ts`,
`apps/runner/src/index.ts`, `apps/hub/web/{app.js,index.html,sw.js}`,
`apps/hub/web/vendor/codemirror/{codemirror.js,THIRD_PARTY_LICENSES.txt}`,
`scripts/build-codemirror.mjs` + `scripts/codemirror/{package.json,package-lock.json,entry.js}`.

Bundle: CodeMirror 6 (state 6.7.6, view 6.43.14, commands 6.11.1, language 6.13.1, search 6.7.2,
autocomplete 6.20.3, lang-javascript/json/css/html/markdown/python/yaml) num IIFE único de **614 KB**
(~214 KB gzip), `window.JarvisCM`. Build reprodutível: `node scripts/build-codemirror.mjs` instala por
`npm ci` (lock versionado) numa pasta temporária FORA do repo e copia só o resultado — rodado duas vezes
com SHA-256 idêntico.

### 15.1 Desvios e decisões (com motivo)

- **`expectedSize` além de `expectedMtimeMs`**: reforça a detecção em sistemas de arquivo de relógio
  grosso (FAT/exFAT/rede, 1–2 s). Não há hash de conteúdo: em NTFS/ext4/APFS o mtime tem resolução de
  ns e um conflito de mesmo mtime E mesmo tamanho é impraticável; nos de relógio grosso continua
  possível (risco aceito).
- **`readOnlyReason` no `filecontent`**: o botão Editar mostra o motivo ANTES do clique. Além das recusas
  pedidas (imagem/binário/truncado), recusa NUL (a leitura troca `\0` por `\\0`) e não-UTF-8 (a
  leitura troca bytes inválidos por U+FFFD) — editar qualquer um dos dois corromperia o arquivo.
- **`.git` e relativo-sem-pasta recusados na escrita**: a leitura não tinha restrição de escopo ("quem
  dirige um agente nesta máquina já lê os arquivos dela"); a escrita mantém esse escopo (o dono já tem
  terminal), e só fecha os dois casos que destroem coisa por engano.
- **Busca sem ripgrep roda numa worker thread**, não num walk assíncrono no loop principal: só a
  worker torna seguro aceitar regex (uma regex catastrófica em JS trava a thread — no Hub, o Hub
  inteiro). Teto de tempo = `worker.terminate()`. Teste prova o loop principal tiquetando durante `^(a+)+$`.
  O caminho com rg usa o rg do PATH ou `JARVIS_RG` (nesta máquina o rg não está no PATH, então o Hub
  usa a worker).
- **Service worker: cache no primeiro uso, não precache.** Pôr o bundle no `SHELL` faria TODO aparelho
  baixar ~600 KB na instalação do SW mesmo sem nunca editar — contra "o boot não cresce". Fica em
  stale-while-revalidate a partir do primeiro uso.
- **`reqId` do cliente não vira chave no Hub**: `PendingRequestRegistry.set` lança em id duplicado e o
  id é global; o Hub cunha o seu e devolve o do cliente (`fileEdit` na metadata da pendência).
- **`readfile` ganhou `runnerId` opcional** (aditivo): a aba lembra a máquina de origem, e salvar/reler
  vai para ela mesmo que o usuário troque de máquina no meio.
- **Busca auditada** (`file_search`, pasta + 80 caracteres da consulta), além da gravação — lei 3
  ("toda ação é auditada"); o precedente é o `send`, que já audita 80 caracteres da mensagem.
- **Finais de linha mistos** são salvos com o dominante (aviso na linha de metadados), em vez de manter
  cada linha como estava: o CodeMirror normaliza separadores internamente.
- **Membros**: o botão Editar aparece desabilitado com "só o dono pode editar" e a busca some (o Hub
  recusa e audita de qualquer forma).
- O `PROTOCOL 17 → 18` também é feito pela F1, em paralelo; a integração reconcilia o número e junta as
  chaves de capacidade.

### 15.2 Validação (2026-10-19, Windows 11, Node 22.14)

- `npx tsc -p tsconfig.json` limpo; `npm test`: 1448 testes, 1438 ok, 0 falha, 10 pulados (35 novos:
  escrita 18, busca 8 — um deles contra o rg real via `JARVIS_RG`, roteador do Hub 8, e2e 1).
- Smoke de UI sem Hub (Playwright + Chromium, servidor estático do `apps/hub/web` + Hub falso na
  página): 40/40 verificações — CodeMirror só carrega no clique, sujo/Ctrl+S com `expectedMtimeMs`,
  CRLF preservado, conflito com as 3 escolhas + aviso, Ctrl+Z após recarregar, abas, fechar aba suja,
  `beforeunload`, imagem/membro/protocolo 17 desabilitados, busca → abre na linha, viewport de celular.

### 15.3 Não validado

Runner remoto real (só runner falso no e2e), aparelho móvel real (só viewport do Chromium), o Hub
como serviço do Windows, ripgrep no PATH em produção, Safari/iOS (zoom de input e teclado virtual com
o CodeMirror), sistemas de arquivo de relógio grosso.

### 15.4 Editor na área principal (decisões do dono, 2026-10-22)

Três decisões tomadas em cartão: a IDE aparece na **área principal**; no celular basta o **editor
leve**; o que importa é **editar dentro do Jarvis**, não ter os recursos do VS Code. Leitura aplicada:
o editor leve (F3) passa a ocupar a área principal enquanto houver aba em edição, e o VS Code (F4)
continua em **aba nova** — o §17 decidiu isso pelos atalhos que brigariam num iframe, e nada nestas
decisões pede o VS Code embutido.

- Implementação: `syncEditMainArea()` em `apps/hub/web/app.js` reaproveita o layout "abas" que já
  existia (`💬 Chat | 📄 Arquivo`), em modo **transitório** (não grava `cfg.fileLayout`); ao sair da
  última edição, fechar o painel ou abrir o painel Trabalhos, o layout de leitura volta.
- Gatilho é "existe aba em edição", não "a aba ativa está em edição": alternar entre abas não faz a
  tela pular de lugar.
- O seletor ⬌/⬍/▭ usado durante a edição vira preferência de edição (`cfg.editMain`), para o editor
  não voltar à área principal contra uma escolha explícita.
- Celular (≤ 820 px) sem mudança: o painel já é tela cheia, que é o editor leve escolhido.
- Corrigido de quebra (821–1000 px): no modo abas o painel de arquivo continuava overlay `fixed` em
  `top:0` e cobria a barra `💬 Chat | 📄 Arquivo` — não havia como voltar ao chat. Agora volta ao fluxo
  e a árvore (overlay nessa faixa) sai da frente.
- Validação: Chromium via Playwright contra `apps/hub/web` com Hub falso, fluxo real (árvore → arquivo
  → Editar → Chat → Arquivo → Concluir → fechar no meio da edição → seletor) em 1400, 900 e 390 px.

## 16) F2 — implementação (2026-10-19, não commitada; aguardando revisão)

### 16.1 Decisão: ferramentas próprias em vez do Playwright MCP

O Playwright MCP (e o Chrome DevTools MCP) só se conecta a um Chromium por um endpoint CDP cru, e CDP
cru é controle TOTAL do perfil: JS arbitrário em qualquer página, `Network.getAllCookies`, storage. Com
ele os três níveis do §3.1 não teriam onde ser aplicados (nem "só leitura" no perfil do dono), e cada
máquina ganharia uma dependência npx/npm. A F2 implementa um conjunto pequeno no estilo do Playwright
MCP sobre o `BrowserManager` da F1, com o nível aplicado num lugar só (`BrowserAgentService.call`), na
máquina dona do browser. Não há ferramenta de avaliação de JS nem de cookies/storage em nível nenhum; o
JS que roda é só o NOSSO, fixo (seleção, posição, `readyState`), num mundo isolado da aba.

### 16.2 Contrato final (protocolo 18 → 19)

Capacidades: `RUNNER_CAPABILITY_SINCE.browserAgentTools = 19` (+ `RunnerInfo.browserAgent === true`) e
`browserGrab = 19`. Para o cliente, `machines[]` ganha `browserAgent`, `browserGrab` e `agentControl`
(nº de sessões com o nível 3 ligado) — só para o dono. Runner < 19 fica em quarentena de atualização
(regra existente do Hub), então nunca recebe nada disto.

Hub → Runner:

| Mensagem | Campos | Observação |
|---|---|---|
| `send` (aditivo) | `browser?: true` | só em turno do DONO (`browserToolsForTurn`), numa máquina com `browserAgent`; o runner cunha um token POR TURNO e pluga a ponte na IA |
| `browser_agent_grant` | `sessionId?, on, all?` | liga/desliga o nível 3 para a sessão; `all:true,on:false` = **Assumir** |
| `browser_grab` | `reqId` (do Hub), `pageId, x, y` | elemento sob o ponto (px CSS do viewport) |
| `browser_open` / `browser_tab` / `browser_shutdown` | `profile: "owner"\|"agent"` | o perfil "IA" só onde a máquina serve a IA |

Runner → Hub: `browser_agent_state {grants: [{sessionId, profile:"owner", since, expiresAt, turnActive}]}`
(a cada mudança e após o `welcome`), `browser_agent_action {action: {sessionId, tool, profile, pageId?,
ok, detail?, at}}` (o Hub grava em `audit.log` e mostra no painel) e `browser_grab_result {reqId, ok,
error?, grab?}`.

Cliente ↔ Hub: `browser_open/tab/shutdown` com `profile`; `browser_agent_grant {runnerId, sessionId,
on}`; `browser_agent_revoke {runnerId}` (Assumir); `browser_grab {runnerId, pageId, x, y, reqId}` →
`browser_grab_result {runnerId, reqId (o do cliente), ok, grab?, error?}`; o Hub manda
`browser_agent_state {runnerId, grants}` a TODO socket de dono (o selo no 🌐 aparece com o painel
fechado) e `browser_agent_action {runnerId, …}` a quem olha aquela máquina. Tudo `browser_*` passa pelo
portão owner-only da F1 (membro recusado e auditado).

`BrowserGrabInfo` = `{url, title?, tag, selector, role?, name?, text?, attributes?, htmlSnippet?, rect,
viewport?, redactions?, image? (data URL JPEG)}`.

Ferramentas MCP (servidor `jarvisbrowser`, todas com `profile?: "agent"(padrão)|"owner"`):

| Ferramenta | Args | Nível |
|---|---|---|
| `browser_tabs` | — | leitura |
| `browser_snapshot` | `pageId?, ref?, maxChars?` (30 000 padrão, teto 120 000) | leitura — árvore de acessibilidade com refs `eN` estáveis por documento; senha/valor com cara de segredo vira `oculto`; perfil do dono passa pela redação de segredos |
| `browser_screenshot` | `pageId?, ref?` | leitura — JPEG da área visível (ou do elemento), teto ~1,2 MB em base64 |
| `browser_wait` | `pageId?, ms? (≤30 s) \| text + timeoutMs?` | leitura |
| `browser_navigate` | `pageId?, url? \| action: back\|forward\|reload` | ação — só http(s)/about:blank; espera carregar até 15 s |
| `browser_click` | `pageId?, ref, button?, doubleClick?` | ação — rola até o elemento, clica no centro da maior caixa visível |
| `browser_type` | `pageId?, ref, text, submit?, append?` | ação — substitui o conteúdo por padrão |
| `browser_press` | `pageId?, key` (`Enter`, `Control+a`…) | ação |
| `browser_scroll` | `pageId?, ref? \| dx?, dy?` | ação |
| `browser_new_tab` / `browser_close_tab` | `url?` / `pageId` | ação |
| `browser_handle_dialog` | `pageId?, accept, promptText?` | ação |

Transporte: `~/.jarvis/browser-bridge.mjs` (escrito idempotente, como as pontes de tarefa/permissão)
lê `JARVIS_BROWSER_URL` + `JARVIS_BROWSER_TOKEN` e faz POST `{tool, args}` com `Authorization: Bearer`
para `/internal/browser` (Hub, sessões locais) ou para um servidor `127.0.0.1:<efêmera>` do runner.
Claude: entra no `--mcp-config` do turno e, fora do modo manual, `--allowedTools mcp__jarvisbrowser` (no
manual cada chamada passa pela ponte de aprovação do dono). Codex: `-c mcp_servers.jarvisbrowser.{command,
args,env.*,tool_timeout_sec=120,default_tools_approval_mode="approve"}`.

### 16.3 Desvios e decisões (com motivo)

1. **Playwright MCP → ferramentas próprias** (§16.1).
2. **Token por turno**, não por processo: a ponte de um turno velho não consegue mais nada, e o token é
   o que amarra cada chamada a uma sessão do dono.
3. **Liberação do nível 3 expira no fim do turno da sessão** — ligada com a sessão parada, vale para o
   PRÓXIMO turno e cai quando ele termina; ligada durante o turno, cai no fim dele. Somado: teto de 30
   min, Assumir, e queda do link runner↔Hub (sem Hub não há indicador nem Assumir). Fim de turno de
   OUTRA sessão não derruba.
4. **Sem Hub, nada**: o runner recusa toda chamada com o link caído (não haveria auditoria).
5. **A IA não abre o browser do dono** no nível Ver (fechado = recusa explicando); no nível 3 pode.
6. **Modo planejamento = só leitura** (ações recusadas em qualquer perfil).
7. **URL restrita a http(s)/about:blank** para a IA (a barra do dono continua aceitando o resto):
   `chrome://` no perfil do dono é a porta para senhas salvas.
8. **Snapshot por `Accessibility.getFullAXTree`** (sem JS na página) e refs como `backendNodeId`; ref de
   documento antigo é recusado com "tire outro snapshot" em vez de clicar no lugar errado (o documento é
   comparado pelo `loaderId`). Coordenadas medidas no spike: `DOM.getContentQuads` devolve px do
   viewport; o `clip` do `Page.captureScreenshot` é em coordenadas do DOCUMENTO (somar a rolagem);
   `DOM.getNodeForLocation` falhou ("No node found") — a seleção usa `elementFromPoint` num mundo isolado.
9. **Codex com `default_tools_approval_mode="approve"`** só no servidor `jarvisbrowser`: o `codex exec`
   não tem como perguntar, e a permissão destas ferramentas é o nível do Jarvis. O valor existe no enum
   do Codex 0.154 (`auto|prompt|writes|approve`, validado com `codex mcp get -c …`); que "approve"
   significa "aprovar sem perguntar" é **inferência** (não testado com um turno real do Codex).
10. **Abas por (máquina, perfil) no Hub** (`BrowserProfilePages`): sem isso o `browser_state` do perfil IA
    derrubaria quem assiste o perfil do dono.
11. **Seleção de pontos**: o cliente desenha as marcas sobre o canvas (nada é injetado na página); o
    recorte vem da máquina (resolução cheia, ≤1024 px de lado). Senha e `input[type=hidden]` nunca saem;
    texto/atributos/HTML passam pela redação no mundo isolado e de novo no host. Funciona nos dois perfis.
12. **Rotinas do dono** também recebem a ponte (o ator da rotina é o dono); o nível 3 continua exigindo a
    liberação explícita.
13. **Perfil "IA" no painel**: segue a aba que a IA ativar (assistir ao vivo); status mostra a última ação
    ("🤖 IA clicou · ref e12").
14. `browser_event`/`BrowserSessionEvent` (reservados no protocolo) **não** foram usados: a atividade da IA
    vai como `browser_agent_action` para o audit.log e o painel, não para o histórico da sessão.

### 16.4 Validação (2026-10-19, Windows 11, Node 22.14, Chrome do sistema)

- `npx tsc -p tsconfig.json` limpo.
- `npm test`: **1503 testes, 1493 ok, 0 falha, 10 pulados** (base 1480 + 23 novos). Em duas execuções
  anteriores do suite inteiro, `wake-auth.e2e` falhou por corrida de carga (recebeu um `machines` do
  aquecimento do catálogo de IAs antes do `wake_state`; passou 3/3 isolado e junto dos testes pesados de
  browser); numa execução sem os arquivos novos falharam os conhecidos `framework-import`/`framework-publish`
  e o teste de órfão no boot da F1 — o suite é sensível a carga.
- Unit (`packages/core/src/browser-agent.test.ts`, 12): matriz de nível (cada ferramenta × perfil ×
  liberação × planejamento); cada ferramenta × cada nível no host falso (recusa não encosta em nenhum
  comando que muda a página; auditoria nunca leva texto digitado); token por turno, Hub caído, aba de
  outro perfil, browser do dono fechado; nível 3 (liga por sessão, cai no fim do turno, Assumir, teto);
  snapshot/refs/redação/corte; teclas/URL; esquema MCP; seleção de pontos (clip em coordenadas do
  documento). **Ponte MCP de verdade**: processo stdio → `initialize`/`tools/list`/`tools/call` → HTTP
  loopback → serviço, incluindo recusa de nível e token morto.
- Registro na IA (`browser-agent-adapters.test.ts`, 2): `ClaudeCodeAdapter` real com CLI falsa — o
  `--mcp-config` do turno leva `jarvisbrowser` com URL+token e `--allowedTools` só fora do manual;
  `CodexAdapter` real com `codex.cmd` falso no PATH — os `-c mcp_servers.jarvisbrowser.*` atravessam o shim
  `.cmd` intactos; execução gerenciada não recebe a ponte. HOME temporária.
- Relay (`browserRelay.test.ts`, +4): capacidades, só turno do dono, mensagens novas, abas por perfil.
- Integração com Chrome real (`apps/runner/src/browser-agent.integration.test.ts`, 4, perfis temporários,
  rodado 3× seguidas): snapshot → clique por ref → navegação; ref velho recusado; digitar + Enter envia;
  JPEG; nível Ver lê o conteúdo logado do dono e recusa clique (a página não muda); perfil do agente NÃO
  vê o cookie do dono no mesmo site; nível 3 clica e cai no fim do turno; seleção de pontos acha
  `#go`, recorta JPEG e não vaza a senha. Sem Chrome órfão no fim (checado no próprio teste e por
  `Get-CimInstance Win32_Process`).
- E2E no Hub real com auth (`apps/hub/src/browserAgent.e2e.test.ts`, 1): turno do dono chega com
  `browser:true`, o de um membro com grant chega sem; capacidade só para o dono; máquina com
  `JARVIS_BROWSER_AGENT=0` sem perfil IA; liberação/Assumir chegam à máquina e o estado volta aos DOIS
  sockets de dono; membro recusado; ação auditada; seleção com reqId do Hub; resposta forjada ignorada.
- UI smoke (playwright-core, `apps/hub/web` estático + Hub falso, script fora do repo): 28/28 em 4 de 5
  execuções (uma abortou na preparação, saída não capturada) — perfil Você/IA, ação da IA ao vivo, ＋ no
  perfil IA, modo seleção (clique vira `browser_grab` em px CSS e não vai à página), marcas, lista com
  recorte, comentário, envio como UMA mensagem com 2 imagens, confirmação do nível 3, barra "IA no
  controle" + selo no 🌐, Assumir, máquina sem IA, toque no celular, sem erro de JS.

### 16.5 Não testado

Um turno REAL de Claude Code ou Codex usando as ferramentas (só o registro/config e a ponte stdio foram
exercitados); o significado exato de `default_tools_approval_mode="approve"` no Codex; Codex no modo
manual/planejamento com ferramenta MCP; runner remoto real pela rede; celular físico; Hub como serviço
do Windows (sessão 0) com o perfil do agente; macOS/Linux; iframes de outra origem (ficam fora do
snapshot); `<select>` nativo (o popup não renderiza em headless — teclado funciona); sites que bloqueiam
headless no perfil do agente.

### 16.6 Riscos

- **Prompt injection** (o motivo do §3.1): no perfil do agente a IA age sem logins do dono; no nível 3 a
  página pode tentar manipular a IA com o dono logado — é a exceção consciente, visível e curta.
- **Hub como máquina local**: `Accessibility.getFullAXTree` de página enorme é JSON de MB parseado no
  event loop do Hub (dezenas de ms). Aceitável hoje; se a guarda de lag reclamar, mover para o runner.
- Auditoria síncrona (`audit.log`) a cada chamada da IA — uma IA em laço gera muitas linhas.
- Chamada da IA já em curso termina mesmo se o turno acabar no meio (o token só barra as próximas).
- Liberação mapeada pelo id de sessão que o cliente conhece; no caminho de voz com alias nativo→gerenciado
  o indicador pode não casar com a sessão (a liberação continua só daquela sessão).
- O protocolo 19 também é usado pela F4 (paralela): a integração reconcilia o número e junta as chaves.

## 17) F4 — implementação (2026-10-19, não commitada; aguardando revisão)

VS Code de verdade (code-server 4.141.0, MIT) por máquina, aberto numa **aba nova** em
`/ide/<runnerId>/…` do Hub, inclusive para máquinas cujo runner é remoto.

### 17.1 Onde está

- `packages/core/src/ide.ts` — `IdeManager` + funções puras: build por SO/arquitetura com **SHA-256
  fixado no código**, download com hash no caminho, extração pelo `tar` do sistema, instalação atômica,
  ciclo de vida (porta livre em `127.0.0.1`, `--auth none --disable-telemetry --disable-update-check
  --disable-workspace-trust`, `user-data`/`extensions` próprios em `~/.jarvis/ide/`), ocioso, pidfile,
  recolhimento de órfão pela linha de comando + árvore de processos, morte por árvore.
- `packages/core/src/ide-tunnel.ts` — codec do frame, `TunnelMux`/`TunnelStream` (Duplex do Node com
  crédito por stream) e a ponta do runner (`bridgeTunnelStream`: HTTP refeito com o `Host` original;
  WebSocket como TCP cru).
- `apps/runner/src/ide.ts` — lado do runner: `ide_*` e a ponta do túnel (um mux por conexão com o Hub).
  Fiação mínima em `apps/runner/src/index.ts`.
- `apps/hub/src/ideGateway.ts` — superfície HTTP `/ide/<id>/…`, bilhete → cookie, owner-only, proxy
  LOCAL direto, túnel para as remotas, revogação, métricas. Fiação em `apps/hub/src/index.ts` (o
  `WebSocketServer` passou a `noServer` para os upgrades de `/ide/…` chegarem ao gateway).
- `apps/hub/src/auth.ts` — `deviceRole()` (consulta barata a cada requisição da IDE).
- `apps/hub/web/{app.js,index.html,sw.js}` — botão `</> VS Code` (só dono, feature-detect) + modal.
- `packages/protocol/src/runner.ts` — v19, `IdeStateInfo`, mensagens `ide_*`, `RunnerInfo.ide`.

### 17.2 Contrato

Capacidade: `RUNNER_CAPABILITY_SINCE.ideServer = 19`, `ideTunnel = 19` **e** `RunnerInfo.ide === true`
(há build para o SO/arquitetura e `JARVIS_IDE≠0`). `machines[].ide` só vem `true` para o dono.

Cliente ↔ Hub (o Hub cunha o próprio `reqId` para o runner e devolve o do cliente):

| Cliente → Hub | Resposta | Observação |
|---|---|---|
| `ide_status {reqId, runnerId}` | `ide_state {runnerId, reqId, state}` | |
| `ide_install {reqId, runnerId}` | `ide_state` (installing) + progresso por `ide_state` sem `reqId` | auditado `ide_install` |
| `ide_open {reqId, runnerId, cwd?}` | `ide_state` + `ide_ready {runnerId, reqId, url, expiresInMs}` | sobe se preciso; `url` = `/ide/<id>/__jarvis_auth?t=<bilhete>`; auditado `ide_open` |
| `ide_stop {reqId, runnerId}` | `ide_state` (stopped) | cancela download em andamento; auditado `ide_stop` |
| — | `ide_error {runnerId, reqId?, message}` | membro (`ide_denied`, auditado no máximo 1×/10 s por socket), máquina offline, sem capacidade, sem resposta em 150 s |

`IdeStateInfo = {status: unavailable|not_installed|installing|stopped|starting|running|error, version,
installed, sizeBytes?, progress?: {phase: download|verify|extract, received, total}, reason?,
startedAt?, external?}`. Hub → runner: `ide_status|ide_install|ide_open {reqId}`, `ide_stop {reqId?}`;
runner → Hub: `ide_state {reqId?, state}` (o Hub valida o formato antes de repassar).

HTTP/auth:

1. `ide_open` (WS autenticado, só dono) → o Hub sobe o code-server (LOCAL) ou pede ao runner, e cunha
   um **bilhete** de 256 bits, uso único, 60 s, preso à máquina, com a pasta já convertida
   (`/c:/…` no Windows, pelo SO do runner). Só o hash fica em memória.
2. A aba nova abre `GET /ide/<id>/__jarvis_auth?t=…` → `302` para `/ide/<id>/?folder=<uri>` com
   `Set-Cookie: jarvis_ide=<256 bits>; Path=/ide/<id>/; HttpOnly; SameSite=Strict; Max-Age=86400`
   (+ `Secure` com TLS ou `x-forwarded-proto: https`). Bilhete inválido/expirado/reusado → 401 +
   `guard.recordFail(ip)` + `ide_auth_fail` (1×/10 s por IP). Auditado `ide_session`.
3. Toda requisição e todo upgrade em `/ide/<id>/…` exigem o cookie válido **para aquela máquina** e
   que o dispositivo que o abriu ainda exista e seja dono (`auth.deviceRole`). Upgrade também exige
   `Origin` = este Hub (`ide_origin_reject`). Sem cookie: 401 (página "abra pelo Jarvis" para
   navegação). `/ide/<id>` sem barra → 301.
4. Proxy: tira o prefixo, preserva `Host` e a ordem/duplicatas dos cabeçalhos, tira o nosso cookie do
   `Cookie`, tira hop-by-hop no modo http, injeta `Service-Worker-Allowed: /ide/<id>/` em
   `…/serviceWorker.js`, prefixa `Location` absoluto-de-raiz. Corpo e bytes de WebSocket passam sem
   interpretação.
5. Revogar/rebaixar um aparelho (`dropRevoked`/`refreshPrincipalRole`) derruba as sessões dele e
   fecha as conexões abertas (HTTP em andamento e WebSockets).

Frame do túnel (mensagem binária na conexão do runner; o 1º byte separa do browser):

```
off len campo
0   1   kind = 0x54 ('T')        (0x42 = frame do browser, F1)
1   1   versão = 1
2   1   op: 1 OPEN · 2 DATA · 3 END · 4 RESET · 5 WINDOW · 6 RESPONSE
3   1   reservado
4   4   streamId (u32 BE; só o Hub cunha)
8   …   OPEN     JSON {mode: "http"|"upgrade", method, path, headers: [k,v,…], win}
        DATA     bytes crus (≤ 64 KiB)
        END      vazio — meia-volta
        RESET    motivo UTF-8
        WINDOW   u32 BE — crédito novo
        RESPONSE JSON {status, statusMessage?, headers: [k,v,…]} (runner → Hub, modo http)
```

Controle de fluxo por crédito (como HTTP/2): janela de 512 KiB por stream em cada sentido; o crédito
volta só depois que o destino aceitou os bytes (socket do navegador ou do code-server); passar da
janela = RESET. DATA também espera quando o link acumula (`bufferedAmount` > 4 MiB); controle sempre
passa. Teto de 128 streams por máquina (o Hub responde 503 acima; o runner recusa OPEN além do teto).
Timeouts: sem RESPONSE/primeiro byte em 60 s → 502; stream http sem tráfego em 5 min → fecha;
WebSocket não tem (o VS Code tem keepalive próprio). Conexão do runner caiu → todos os streams caem
nos dois lados; reconectou → túnel novo (o túnel é preso à identidade do socket). Deflate do `ws` só
para corpo de texto (js/css/json/html/svg) do runner para o Hub.

### 17.3 Desvios e decisões (com motivo)

1. **Túnel na conexão do runner, não canal dedicado.** Não abre porta nova nem segunda conexão a
   autenticar; reaproveita o canal binário da F1. O risco (um stream pesado atrapalhar turnos, terminal
   e browser) é tratado por crédito por stream + porteira de `bufferedAmount` + pedaços de 64 KiB.
2. **HTTP no túnel é "meio-cru".** A resposta HTTP volta como RESPONSE (JSON pequeno) + DATA, e não como
   bytes crus da resposta: com bytes crus o Hub teria de parsear HTTP de resposta ou sequestrar o
   socket keep-alive do Node. WebSocket, sim, é TCP cru ponta a ponta (inclusive o `101`).
3. **Aba nova, sem painel embutido.** Atalhos do VS Code (Ctrl+P, Ctrl+Shift+P, Ctrl+Crase, Ctrl+W)
   brigariam com os do Jarvis num iframe, e no celular o workbench precisa da tela inteira. A aba é
   aberta no clique (antes da resposta) para não cair no bloqueio de pop-up; no Electron vai para o
   navegador do sistema (o `setWindowOpenHandler` do shell); com pop-up bloqueado ou no Capacitor, o
   modal mostra um link (vale 1 min, uma vez).
4. **Bilhete + cookie em memória.** Reiniciar o Hub desloga todas as abas de IDE (o dono reabre pelo
   Jarvis); nada de segredo novo no disco.
5. **Extração pelo `tar` do sistema** (bsdtar do System32 no Windows — o `tar` do Git Bash entende
   `C:` como host remoto), num processo filho: o build tem ~6.000 arquivos, links e bits de execução;
   um leitor de tar próprio dentro do Hub disputaria o event loop.
6. **Versão 4.141.0 fixada** (a do F0 e a última publicada em 2026-10-19). Hashes do campo `digest` da
   API de releases do GitHub, um por build (`windows-amd64`, `macos-amd64/arm64`, `linux-amd64/arm64`).
   Windows ARM não tem build → capacidade indisponível com motivo.
7. **`HOME`/`USERPROFILE` NÃO são trocados** (o terminal integrado precisa do git/ssh do usuário). Efeito
   colateral aceito: `~/.vscode-oss-shared`. Do ambiente só saem `NODE_OPTIONS`, `VSCODE_*` e
   `ELECTRON_RUN_AS_NODE` (quebrariam o node embutido ou fariam o `code` do terminal falar com outro
   VS Code).
8. **Órfão pela árvore, não só pela linha de comando.** Medido: os filhos do code-server
   (`out/node/entry`, `bootstrap-fork --type=…`, servidores de linguagem) NÃO trazem `--user-data-dir`.
   Regra: principal = binário da instalação + NOSSA pasta de dados; mais os descendentes dele; mais
   processos do binário sem `--user-data-dir` cujo pai morreu. Processo com OUTRO `--user-data-dir`
   nunca entra. No Windows, o filho comum do Node morre junto com o pai (job object do libuv); o
   recolhimento cobre quem escapa.
9. **Recolhimento ao subir só se sobrou pidfile** (a consulta de processos custa 1–2 s no Windows); no
   boot do host sempre (assíncrono, 6 s depois). Recusa subir se o pidfile aponta outro processo
   Jarvis vivo usando a mesma pasta.
10. **`sw.js` do Jarvis ignora `/ide/`.** Sem isso, a navegação para a IDE (e a de cada webview, que
    também é `navigate`) caía no network-first do app: guardava o workbench no lugar do `/` do Jarvis
    e, em rede lenta, servia o Jarvis dentro da IDE. Validado no smoke de UI.
11. **`noServer` no `WebSocketServer` do Hub.** Com `{ server }` o `ws` responde 400 a todo upgrade
    que não é dele; agora o Hub roteia o upgrade (`/ide/…` → gateway; o resto → `ws`) e mantém um
    ouvinte de `error` permanente no servidor HTTP (antes ele vinha pelo `ws`).
12. **Integração com code-server real é opt-in** (`JARVIS_IDE_IT=1`): baixa 218 MB na primeira vez
    (cache em pasta temporária, `JARVIS_IDE_TEST_CACHE`); no `npm test` padrão ela é pulada.

### 17.4 Medido (Windows 11, Node 22.14, loopback)

- Download real pelo `downloadVerified` (GitHub → CDN, hash no caminho): **19,2 s** para 218 MB.
- Instalação a partir do cache (hash + extração + rename): **4,0–5,2 s** (extração 3,7 s). Instalado:
  **554 MB em 5.980 arquivos** (o F0 mediu 644 MB de espaço ocupado).
- `ide_open` → `ide_ready`: LOCAL **2,5–3,0 s** (inclui subir o code-server; na primeiríssima execução
  12,8 s, com o antivírus varrendo o binário recém-extraído); REMOTA (túnel) **0,55 s**. Workbench
  pronto: **2,4 s** LOCAL, **1,7 s** REMOTA.
- Integração real (Hub e runner reais, auth ligada, Chromium headless): nas duas rotas o Explorer
  lista, o terminal integrado escreve o arquivo de prova (`42`), a webview do preview de Markdown
  renderiza, 2 WebSockets por aba, nenhuma requisição falha além do `vsda` esperado; `ide_stop` não
  deixa processo do code-server (eram 8 `node.exe` por instância com workbench + terminal + preview).
- Túnel no papel do Hub (processo dedicado, `ws` real em loopback): **256 MB a ~100 MB/s**, upload de
  64 MB em 0,93 s e, ao mesmo tempo, 2.722 requisições pequenas (p50 0 ms, p95 8 ms). Lag do event loop
  durante a transferência: **p50 5 ms, p99 17 ms, máx 30 ms** (ocioso nesta máquina: p50 15,6 /
  p99 56 — granularidade do timer do Windows). RSS máx 162 MB (inclui o tsx).

### 17.5 Não testado

- Runner remoto de verdade pela rede (Tailscale/DERP): o túnel só rodou em loopback (runner real
  conectado ao Hub real na mesma máquina, e o runner falso do e2e).
- Celular/tablet físico e Safari/iOS (só viewport de celular do Chromium no smoke); Electron e
  Capacitor (caminhos de abertura escritos, não exercitados nos shells).
- macOS/Linux (hashes fixados e caminhos POSIX escritos e com teste de unidade; nenhum build rodado).
- Hub como serviço do Windows (sessão 0), HTTPS na frente (`tailscale serve`), extensões do Open VSX
  instaladas de dentro da IDE pelo túnel (o F0 instalou a do Claude Code direto), conta logada nela.

### 17.6 Riscos

- **Mesma origem do Jarvis.** JS do workbench (extensões web, webviews com `allow-same-origin`) lê o
  `localStorage` da UI do Jarvis — onde fica o token do dispositivo. Só o dono abre e instala
  extensões; a escalada é "uma máquina → token do dono no Hub". Saída estrutural (não feita): servir a
  IDE de uma origem própria (porta dedicada ou subdomínio), com o mesmo bilhete.
- **Antivírus que reescreve HTML.** Medido nesta máquina: o Kaspersky Web Anti-Virus injeta um
  `<script src="http://gc.kis.v2.scr.kaspersky-labs.com/…">` e acrescenta `child-src` à CSP das páginas
  servidas em HTTP quando o cliente é o Chrome "completo" (o chromium-headless-shell não sofreu
  injeção); o `child-src` injetado vira o fallback de `worker-src` e bloqueia o service worker das
  webviews (preview de Markdown e painéis de extensão em branco). O proxy não tem como evitar
  (acontece depois dele; `Cache-Control: no-transform` não adiantou). Contorno: excluir o endereço do
  Hub da varredura web do antivírus. Não verificado com HTTPS.
- **Sessões em memória**: reiniciar o Hub desloga as abas de IDE (o workbench fica "reconectando" até
  o dono reabrir pelo Jarvis).
- **Versão fixada envelhece**: atualizar o code-server = trocar versão + 5 hashes no código e revalidar
  as três pegadinhas do §13.2.
