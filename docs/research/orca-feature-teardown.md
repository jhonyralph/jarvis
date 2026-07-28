# Orca — teardown de funcionalidades (para validação do Jarvis)

**O que é:** Orca (stablyai, MIT) é uma **ADE** — IDE Electron pra desenvolvimento agêntico em
paralelo: roda qualquer CLI agent em git worktrees isolados e expõe um binário `orca` pros
próprios agentes dirigirem a IDE.

**Método deste doc:** cruzamento do site (onorca.dev) + **código real clonado** em
`C:\Users\jonat\orca` (v1.4.160-rc.0) + 5 agentes de exploração lendo o código. Cada feature tem:
_o que é_ · _como é construído (arquivos)_ · _pro Jarvis_.

**Fora de escopo por decisão do operador:** **git / PR / Linear** — o Jarvis não constrói esse
cluster (ver memória `jarvis-excludes-git-pr-linear`). Catalogado aqui só o que é reutilizável.

Organizado pelas 5 tabs do site (menos "Git integration").

---

## A) Run a fleet of agents — worktrees, orquestração, máquinas, SSH

### Parallel Worktrees
Cada workspace é um `git worktree add` real em diretório próprio, com branch nova off da base
(`--no-track -b`), **sem stash e sem trocar branch no checkout principal**. Remoção é defensiva:
recusa worktree sujo/locked e, ao apagar a branch, usa `-d` preservando commits não mergeados
(retorna `preservedBranch`). Cache de scan com _generation counters_ colapsa `git worktree list`
duplicados (caro no Windows); timeout de 180s pra falhar rápido em stall de OneDrive.
- `src/main/git/worktree.ts`, `src/main/ipc/worktree-logic.ts`, `src/shared/worktree-id.ts`.
- **Pro Jarvis:** dar a cada nó do DAG `jarvis_delegate` um sandbox worktree "no-stash" com teardown
  que preserva trabalho não mergeado. Você já tem worktree writers isolados; falta o padrão de
  teardown-que-preserva + cache de scan.

### Orquestração (DAG coordinator/worker)
O "fan across N + merge winner" **não é uma feature única** — é montado de: (a) N worktrees, (b) um
**coordinator/worker DAG** com barramento de mensagens SQLite, (c) merge por source-control normal.
Coordinator faz poll, despacha tasks `ready` até `maxConcurrent` (default 4), cada worker no seu
worktree/terminal. Mensagens tipadas: `worker_done`, `merge_ready`, `heartbeat`, `escalation`,
`decision_gate`. **Broadcast por grupo** (`@all`/`@idle`/`@claude`/`@worktree:<id>`) insere 1 linha
por destinatário com `thread_id` compartilhado. Decomposição **ainda não é IA-dirigida** (exige
tasks pré-criadas); circuit-breaker após escalations repetidas; guarda de base-stale (recusa se >20
commits atrás); **decision-gates nunca auto-resolvem** — humano aprova.
- `src/main/runtime/orchestration/{coordinator,groups,db,preamble}.ts`,
  `src/main/runtime/rpc/methods/orchestration.ts`.
- **Pro Jarvis:** mapeia **quase 1:1** no `jarvis_delegate`. Borrar: mailbox entre agentes +
  `decision-gate`/`ask` (human-in-the-loop) + keepalive no long-poll. **A parte "compara e promove o
  vencedor automático" é o que VOCÊ adiciona** (scoring + merge) — o Orca deixa pro humano+git.

### Ciclo de vida do agente — por HOOK, não por título
Orca **não** supervisiona o CLI como subprocesso; ele é dono do **PTY** e o agente roda dentro. O
status **nunca** é inferido do título do terminal — vem de **hooks nativos** que o agente faz POST
(`working|blocked|waiting|done` + tool + input + model + subagents). PTYs sobrevivem a desconexão via
grace timer; status por-pane é re-tocado no reconnect.
- `src/relay/pty-handler.ts`, `src/shared/agent-status-types.ts`, `src/main/agent-hooks/server.ts`.
- **Pro Jarvis:** status por hook (não raspar título) é **ideal pra resumo por voz** e pra rotear
  "qual máquina precisa de mim". Encaixa no seu contrato de eventos canônicos.

### Múltiplas máquinas / hosts
Todo repo/worktree carrega um `ExecutionHostId` de 3 tipos: `local`, `ssh:<id>`, `runtime:<id>`
(VM efêmera). `buildExecutionHostRegistry` funde máquina local + alvos SSH + ambientes runtime numa
lista única com `health` por host (`available|connecting|blocked|disconnected|error`), plataforma,
capabilities, versões. Labels amigáveis ("MacBook Pro") com override do usuário.
- `src/shared/execution-host.ts`, `src/shared/execution-host-registry.ts`.
- **Pro Jarvis:** mapeia limpo na sua topologia Hub+Runner sobre Tailscale — uma lista de hosts com
  health/label/versão é exatamente o seletor de máquina que você já tem, formalizado.

### SSH Worktrees — o relay de execução (reconnect-survival)
Um daemon Node leve, SCP'd pro host remoto e iniciado por canal SSH, fala JSON-RPC em frames por
stdio. Registra toolset completo remoto: **PTY, filesystem, git, preflight, port-scan, agent-exec**.
Assinatura do design: **sobrevive a queda do SSH** — no disconnect entra em graça, mantém PTYs vivos
num **Unix domain socket**, ignora `SIGHUP`, e um `relay.js --connect` posterior faz a **ponte do
novo canal SSH ao mesmo daemon** que já é dono dos PTYs vivos. Auto-reconnect com backoff
escalonado; **cache de passphrase/senha em memória**; port-forwarding com 2 providers.
- `src/relay/{relay,relay-handshake,pty-handler,git-handler,port-scan-handler}.ts`,
  `src/main/ssh/ssh-connection.ts`.
- **Pro Jarvis (maior "roubar"):** sobre Tailscale você **descarta** SCP-deploy e version-handshake,
  mas fica com o ouro: _"o Runner é dono do PTY longevo; o Hub reata por session-id e replica o
  último status"_. É a robustez que um control-plane voice-first precisa quando o celular/rede pisca.

---

## B) Automate everything — CLI, automations, snapshots, skills, computer use

### Orca CLI (os agentes dirigem a IDE)
Cliente fino e auto-descritivo de um **daemon runtime** longevo. Specs declarativas fazem parsing +
help; handler-groups são lazy-`import()` (cold-start rápido); `--json` em tudo (caminho preferido de
agente). Comandos reais: `worktree create|list|rm|ps`, `terminal create|read|send|wait|split`,
`browser snapshot|click|fill|type|goto`, `orchestration …`, `computer …`, `automations …`, `linear
…`, `emulator …`. `worktree create --agent codex --prompt … --json` cria checkout + spawna agente no
1º terminal.
- `package.json` (bin `orca`), `src/cli/{index,dispatch,args}.ts`, `src/cli/specs/*`, `handlers/*`.
- **Pro Jarvis:** análogo ao `jarvis_delegate`, mas voltado a **dirigir a IDE/superfícies**. O padrão
  "specs declarativas = parsing + help" e `--json` é bom pra uma futura CLI que agentes usem.

### Automations (cron/RRULE agendado)
`automations create --trigger <hourly|daily|cron|RRULE> --prompt --provider codex [--precheck
"<cmd>"]`. Serviço com tick de 60s calcula ocorrência via RRULE e despacha — pra janela ou pra um
**dispatcher headless** (`orca serve`, sem UI). **Grace de missed-run** (marca `skipped_missed` se
Orca ficou fora demais); **precheck** gateia cada run (ex.: só roda revisor se `gh pr list` retorna
algo).
- `src/main/automations/service.ts`, `src/cli/handlers/automations.ts`.
- **Pro Jarvis:** template limpo pra **rotinas de voz agendadas** ("todo dia 9h, resumo dos
  runners"), com precheck evitando runs vazias. Encaixa nas suas rotinas/cron.

### Snapshots (snapshot → agir por ref)
Dois tipos: (a) **AX do browser** — anda na árvore de acessibilidade via CDP, dá `[ref]` estável a
cada nó acionável; agente age por ref (`click --element <ref>`), sem caçar pixel. (b) **app-state de
desktop** — snapshot AX de janela de app, dá `element-index` pro `computer click`; **PNG é retirado
antes de cachear** pra não inchar o sidecar.
- `src/main/browser/snapshot-engine.ts`, `src/main/computer/desktop-script-snapshot-*.ts`.
- **Pro Jarvis:** substrato barato e confiável pra **comando de voz** ("clica em enviar"): resolve
  intenção → ref → ação. Muito mais robusto e barato que coordenada de pixel.

### Skills (guias embutidos no binário, versão casada)
"Skill" = guia markdown de uma capacidade. Os `SKILL.md` são **stubs finos** (só frontmatter com
frases-gatilho + instrução de buscar o guia); o conteúdo real é **compilado dentro do binário** e
servido local por `orca skills get <topic> --full` — **nunca desincroniza** da superfície de comandos
porque envia no mesmo binário que executa. Aliases são um ledger permanente (renomeia adiciona, nunca
remove).
- `skills/*/SKILL.md`, `skill-guides/*.md`, `src/cli/bundled-skill-guides.ts`.
- **Pro Jarvis:** stubs com **frases-gatilho** casam com **matching de intenção por voz**; o guia
  gordo servido sob demanda pelo mesmo build elimina drift prompt↔ferramenta nos sub-agentes.

### Computer Use (dirigir apps de desktop por AX)
Agentes operam apps arbitrários por **árvore de acessibilidade**, não pixel: `computer list-apps`,
`get-app-state` (snapshot), depois `click`/`type`/`hotkey`/`scroll` por `--element-index` ou `--x
--y`. Provider por plataforma: Swift nativo (macOS 14+ assinado) ou sidecar Node → `python3`/
`powershell.exe`. Muita validação de segurança de teclado/paste (ações batem na máquina real).
- `src/main/computer/*`, `native/computer-use-{macos,linux,windows}/`.
- **Pro Jarvis:** provavelmente **overkill** pro seu escopo agora, mas o padrão "AX + índice + ação"
  é o mesmo do snapshot; guardar como referência se um dia quiser controle de app por voz.

---

## C) Review AI output — Design Mode + previews (a parte que você mais curtiu)

### Design Mode ("Browser Context Grab") — **é a Fase 1 do nosso spec DSK-01-12**
`<webview>` Electron (`webviewTag`), guest sem preload. O main injeta um **picker autocontido** via
`executeJavaScript()` — overlay em closed shadow-root, crosshair, `elementFromPoint`. No clique
extrai: outerHTML sanitizado (script-stripped, ~4KB), subset de computed styles, seletor CSS + DOM
path, **`arquivo:linha:coluna` via React fiber `_debugSource`**, a11y, texto vizinho, bounds — com
**redação de segredos**. Screenshot recortado no **main** (`capturePage`). Vira bloco markdown
`## Design Feedback` + imagem, anexado ao turno. **URL de preview é descoberta sozinha:** port-scan
atribuindo porta→worktree por `cwd` do processo + leitura da URL anunciada no PTY. **Zero config.**
- `src/main/browser/{grab-guest-script,browser-grab-screenshot}.ts`,
  `src/main/ports/{local-workspace-port-scanner,advertised-url-watcher}.ts`,
  `src/renderer/src/components/browser-pane/{useGrabMode,browser-annotation-output}.ts`.
- **Pro Jarvis:** já especificado. Split: **Runner descobre a URL** (port-scan + PTY), **cliente
  Electron** renderiza no `<webview>`, injeta picker, captura e injeta no turno. É o "clicar em cada
  elemento pra corrigir comportamento" que você amou.

### Rich Repo Previews
Markdown via `react-markdown` + pipeline remark/rehype com **`rehype-sanitize`** (conteúdo do repo é
não-confiável), Mermaid, KaTeX, find embutido. PDF com `pdfjs-dist` (viewer real + find). Imagens com
zoom/pan próprio. Previews são só outro `contentType` de aba → moram em split panes como tudo.
- `src/renderer/src/components/editor/{MarkdownPreview,PdfViewer,ImageViewer}.tsx`.
- **Pro Jarvis:** **sanitize-by-default** pra markdown do repo é a lição de segurança; reusar
  pdf.js/react-markdown em vez de renderer caseiro.

> Nota: "Annotate AI Diffs" (comentar linha a linha no diff → lote → mandar pro agente) é o outro
> loop de revisão do Orca. Opera sobre **as mudanças propostas pelo agente** (o Jarvis já renderiza
> diffs inline), então **não** é integração git/PR. Fica registrado como opção de revisão — decisão
> do operador se entra, dado o corte de git/PR/Linear.

---

## D) Workspace — terminal, panes, busca, UI

### Terminal Splits (xterm + WebGL + PTY com backpressure)
PTY vive no **main** (node-pty), empurra bytes por **um** canal roteado por id (evita leak de N
listeners). **Protocolo de flow-control**: main conta `sentChars` vs `ackedChars` por PTY, segura
envios até o renderer dar handshake (bytes de boot não caem em página sem listener), e no desync
emite `pty:modelRestoreNeeded` → renderer **repinta de um snapshot do buffer que o main é dono**.
WebGL é opt-out-on-failure (cai pra DOM e recupera). Scrollback sobrevive restart (snapshots
`@xterm/addon-serialize` keyed por `sha256(tabId\0leafId)`); busca via `@xterm/addon-search`.
- `src/main/ipc/pty.ts` (~5000 linhas, um boundary auditado), `src/renderer/.../terminal-pane/*`.
- **Pro Jarvis (forte):** o **ack-gated backpressure + restore-de-snapshot-no-desync** é o padrão que
  deixa reconnect/reload robustos **sem framework** — encaixa direto no seu Hub→cliente por socket.

### Split Anything (dois sistemas de split aninhados)
Nível-workspace: `TabGroupSplitLayout` (React + dnd-kit) arranja **abas** de qualquer tipo (terminal/
editor/diff/browser/simulator) em panes redimensionáveis. Dentro de uma aba de terminal:
`pane-manager` **imperativo/DOM-first** (não-React) pra splits infinitos de xterm. Ambos são árvores
binárias recursivas. Persistência: sessão inteira serializada e revalidada na leitura por **Zod
tolerante** ("rejeita e cai pro default, lixo nunca chega no React"). Identidade estável = `leafId`
UUID desacoplado do `paneId` numérico vivo.
- `src/renderer/.../tab-group/*`, `src/renderer/.../lib/pane-manager/*`,
  `src/shared/workspace-session-schema.ts`.
- **Pro Jarvis:** **persistir layout como árvore validada e rejeitar-pra-default na leitura ruim** —
  um guard Zod pequeno no boundary evita que um layout salvo corrompido brique a UI single-file.

### Native Search
Duas paletas sobre `cmdk`: `QuickOpen` (fuzzy de arquivo, rg-first) e `cmd-j WorktreeJumpPalette`
(busca ampla: worktrees, agentes, páginas de browser, portas, comandos). Busca de texto no main:
ripgrep quando existe, **`git grep` como fallback garantido** (rg pode faltar no PATH), com timeout +
cap de resultados. Lógica de parsing/ranking extraída pra módulos testados.
- `src/renderer/.../QuickOpen.tsx`, `src/main/ipc/filesystem-search-git.ts`, `src/shared/text-search.ts`.
- **Pro Jarvis:** rg-com-fallback pra busca nunca falhar hard; uma paleta única (cmdk-like) reusada
  em todas as superfícies de busca.

### Design system / interface (o que você elogiou)
**shadcn/ui + Radix + Tailwind v4 + CVA**, tema 100% por **CSS custom properties** (`:root`/`.dark`,
`@theme inline`). Componentes canônicos shadcn (`cva()`, `data-slot`, `asChild`, `cn()`). Fontes
self-hosted (Geist/Nerd Font); ícones `lucide-react`; toasts `sonner`; drag `@dnd-kit`; temas de
terminal separados (importa temas do Warp). Guard `theme-transition-disabled` evita fade multi-speed;
controles hover-reveal atrás de variante `can-hover` (touch ainda vê ações).
- `components.json`, `src/renderer/src/components/ui/*`, `src/renderer/src/assets/main.css`.
- **Pro Jarvis:** você **não precisa** de shadcn, mas a **disciplina de tokens** (variáveis semânticas
  em `:root`/`.dark`, referenciadas em tudo) dá pra portar pro seu `index.html` **sem build** — Hub/
  voz trocam tema virando uma classe.

---

## E) Every CLI Agent — integrações, seleção, contas

### Registro declarativo de agentes (1 tabela)
`TUI_AGENT_CONFIG: Record<TuiAgent, TuiAgentConfig>` — cada agente é **metadado declarativo** (sem
classe por agente): `detectCmd`, `launchCmd`, `expectedProcess`, e `promptInjectionMode`
(`argv|flag-prompt|stdin-after-start|hermes-query|…`). Comentários guardam quirks (Kiro=`kiro-cli`,
Continue=`cn`, Copilot usa `-i`, Grok precisa de `--`). **Adicionar um agente = 3-4 edições de tabela
tipadas** que `satisfies Record<TuiAgent,…>` **obriga** em compile-time. Detecção, picker, launch e
telemetria derivam das tabelas.
- `src/shared/tui-agent-config.ts`, `src/renderer/.../agent-catalog.tsx`, `src/shared/agent-kind.ts`.
- **Pro Jarvis:** contrato "drops right in" mais limpo que switch paralelos; `promptInjectionMode` +
  `preflightTrust` são bom vocabulário pros seus quirks de launch.

### Seleção — **o ponto "só mostrar o que estiver linkado"**
O picker do Orca (`QuickLaunchButton.tsx`) mostra só agentes **detectados no PATH + não-desabilitados**
— **NÃO** filtra por autenticado/linkado. Disponibilidade = **instalado**, não logado; o login fica
pro CLI no 1º uso. Auth só é checada pra CLIs de VCS e pros account-managers Claude/Codex/Grok —
**nunca** como filtro do picker.
- **Pro Jarvis:** **seu instinto é MAIS rigoroso que o Orca**, e você **já está mais perto** do que
  quer (níveis `complete/limited/unverified/unauthenticated/not_installed`, só `complete` selecionável
  por padrão). "Só mostrar linkado" é um **refinamento seu do seletor** (filtrar por `complete`/
  autenticado), não uma cópia do Orca.

### Account switcher / usage (hot-swap sem re-login)
Cada conta Codex tem `CODEX_HOME` isolado com `auth.json` próprio. Troca **sem `codex login`** — só
re-aponta qual credencial o runtime usa. **Read-back reconciliation:** antes de sobrescrever, lê o
`auth.json` de volta, casa com a conta dona e persiste o token refreshado — trocar A→B→A nunca perde
o token de A. Usage: scanners de `~/.claude/projects` etc. (dedupe cross-file), janelas de reset,
cache de uso de conta inativa pro switcher mostrar quota sem ativar.
- `src/main/codex-accounts/*`, `src/main/claude-accounts/*`, `src/main/rate-limits/service.ts`.
- **Pro Jarvis:** ouro **se** um dia fizer multi-conta. Padrão de home isolado + read-back é a peça
  central; casa com seu ledger de usage/custo tipado.

### Model selection
Catálogos estruturados só pra `claude/codex/gemini/cursor`: cada modelo tem `options` (effort,
fastMode) e `apply` define args de launch + comandos mid-session (`/model`, `/effort`, `/fast`).
`mergeCatalogModels()` sobrepõe modelos descobertos ao vivo sobre um seed curto.
- `src/shared/agent-session-option-catalog*.ts`.
- **Pro Jarvis:** o padrão **seed + merge de modelos live** deixa modelos novos aparecerem sem mudar
  código, mantendo as opções curadas — bom pro seu descriptor de modelos.

---

## F) Work on-the-go — mobile

App **React Native / Expo nativo** (não webview-wrapper). Usa `react-native-webview` só pras
superfícies web-por-natureza (terminal xterm, browser pane, preview HTML, editor markdown).
Compartilha só o **core TS** (`src/transport`, `src/session`) com o desktop; UI é nativa por
plataforma. **Dois transportes:** direto (LAN/**Tailscale** — reconhece CGNAT 100.64/10) e **relay na
nuvem** (`relay.onorca.dev` + `login.onorca.dev`, director+cell, E2EE zero-knowledge). Já tem: push,
status ao vivo, ditado por voz, anotação de diff → "Send to AI", troca de conta. Distribui via App
Store + TestFlight + APK.
- `mobile/` (expo-router, RN 0.83), `src/main/runtime/relay/*`, `mobile/src/transport/*`.
- **Pro Jarvis:** você cobre com **PWA + Capacitor (APK + iOS)** carregando a UI viva do Hub —
  caminho **mais leve** que um RN nativo inteiro. E o ponto-chave: **não copie o relay de nuvem** — a
  **Tailscale já é o caminho direto**, então você fica com a ergonomia do "direto" **sem** nuvem/relay
  (privacidade). É o seu moat.

---

## Prioridade pro Jarvis — top-5 (esforço × impacto), sem git/PR/Linear

> **STATUS (2026-07-27):** ver detalhe na memória `orca-features-batch`.

1. **Design Mode** (Fase 1 do `DSK-01-12`) — ✅ **implementado no cliente Electron** (`desktop/`,
   commit 36c6f75). No navegador puro não roda (precisa de privilégios de `<webview>`); o
   contraponto web é a **anotação de arquivos/diffs** (ver `docs/file-explorer-and-review.md`).
2. **Reconnect-survival + status por hook** — ✅ **já existia** no Jarvis (Outbox/turn-resume +
   `activeRuns`/`waiting_input`/`pendingAsk`, do milestone de hardening); a premissa do teardown
   estava desatualizada. Nada novo a construir.
3. **Orquestração → fan-out "compara e promove"** — ✅ **implementado** (`packages/core/src/tournament.ts`
   + wiring no Hub `startLocalTournament` + botão "Torneio"). Remoto (runner-side) fica de follow-up.
4. **PTY ack-gated backpressure + restore-de-snapshot** — ⏳ não portado (Jarvis usa adapters, não é
   dono de PTY; o reconnect já é coberto pelo Outbox). Fica como referência.
5. **Seletor auth-aware** — ✅ **implementado** (picker esconde não-instaladas/sem-login por padrão).

**Também feito (extras):** file-tree explorer, viewer line-numbered redimensionável + tela cheia,
highlighter reescrito (regex/template-aware), toggle Markdown Formatado/Bruto, **anotação de linha/
trecho → lote → enviar p/ IA escolhida** (Annotate, Opção A), Configurações com nav+busca, CI de
release do desktop (3 SOs). Ver `docs/file-explorer-and-review.md`.

**Extras ainda abertos:** persistência de layout com guard Zod; skills como stubs-gatilho + guia
servido; snapshot-then-act-by-ref pra comando de voz; modos empilhado/abas do viewer.

## Não portar (de propósito)

- **git / PR / Linear** — fora de escopo por decisão do operador.
- **Relay de nuvem** (`relay.onorca.dev`) — quebra a privacidade; Tailscale substitui.
- **App RN nativo inteiro** — pesado demais pra solo; Capacitor-webview cobre.
- **Electron dono do runtime (modelo standalone)** — abre mão da separação Hub/Runner que dá
  estabilidade.
- **Computer Use** — overkill pro escopo atual.
