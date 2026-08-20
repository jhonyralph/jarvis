---
feature_id: TSK-12-task-mcp-config-from-ui
tldr: "Configurar e testar o servidor MCP de tarefas de uma máquina pela tela — com a própria máquina validando e gravando."
title: "Editar o task-mcp.json pela tela"
owner: "Jonathan / Claude"
status: approved
risk_level: medium
stack: node
services_affected: [hub, runner, protocol, core, web]
dependencies: [TSK-11-task-bridge-on-runner]
schema_required: false
schema_dependencies: []
links:
  roadmap: "Épico 'fontes de tarefa'; fatia 4a da ordem acordada (ponte → 4a → 4b)"
  design: "Desenho descrito e decidido no chat em 2026-08-19"
  adr: "N/A"
approval_evidence: "Usuário em 2026-08-19: interruptor 'pode ser ligado, desde que esteja explícito quando entrar no chat ou novas sessões'; salvar sem exigir teste verde ('podemos seguir como não'); formato atual + schemaVersion 1; e 'Emendar 4a' na ordem de execução; spec aprovada em 2026-08-19, com a regra de env sensível reaproveitada do validador que já existe."
---

# Executable spec

## 0) Meta (TL;DR)

O `~/.jarvis/task-mcp.json` de cada máquina é editado à mão, com um editor de texto, naquela máquina.
A tela só relata os NOMES que ela reporta. Esta fatia deixa o dono criar, editar, testar e remover
esses servidores pela interface — com a **própria máquina** validando e gravando.

## 1) Context and objective

### 1.1 Problem

- Configurar uma fonte MCP exige acesso ao disco da máquina do projeto. Para a Luby, isso é abrir um
  terminal lá e escrever JSON à mão, sem validação nenhuma até a próxima listagem falhar.
- O erro só aparece depois: `loadTaskMcpConfig` recusa servidor incompleto e devolve o motivo na
  listagem — ou seja, você descobre que errou quando a lista de tarefas não vem.
- A tela informa `configFile` usando `taskMcpConfigFile()` do processo do **Hub**
  (`apps/hub/src/index.ts:430`). Para uma máquina Linux, ela exibe `C:\Users\...\.jarvis\task-mcp.json`
  "na própria máquina" — caminho de outro computador. Mesma família dos defeitos da TSK-11.

### 1.2 Objective (Definition of Value)

Adicionar um servidor MCP de tarefas a uma máquina, ver o erro **antes** de salvar, e provar que ele
responde — tudo pela tela, sem abrir terminal na máquina.

## 2) Dual-source planning

- **2.1 Roadmap** — 4a da ordem acordada; a 4b (registro único de MCP por máquina) vem depois, com
  dois consumidores reais na mesa.
- **2.2 Referências** — `packages/core/src/task-mcp.ts` (allowlist, `parseServer`, `listTasksFromMcp`);
  `packages/core/src/personal-mcp-client.ts:615-625` (validador de transporte stdio JÁ existente, com
  a regra de segredo em env); ponte de tarefas da TSK-11 (`task_bridge`) como molde de ida-e-volta
  com a máquina; `apps/hub/web/app.js` seção `tskMcp` de Configurações → 🎯 Tarefas.
- **2.3 Gap scan** — sem schema de banco; `RUNNER_PROTOCOL_VERSION` sobe 12 → 13. Máquina em 12
  continua funcionando: ela não anuncia a capacidade, e a tela mostra o caminho manual de hoje.
- **2.4 Delta** — além da edição, esta fatia corrige o `configFile` mentiroso e carimba
  `schemaVersion: 1` no arquivo, para a migração da 4b ser determinística em vez de adivinhação sobre
  arquivos escritos à mão.

## 3) Rules and invariants (SYSTEM LAWS)

- **Quem valida e grava é a máquina.** O Hub encaminha intenção; nunca escreve o arquivo de outra
  máquina. É a mesma postura da ponte de tarefas: a decisão fica onde está o disco.
- **Segredo continua sendo NOME.** Chave de env que pareça segredo (`token`, `secret`, `password`,
  `api_key`, `authorization`, `cookie`, `credential`) é **recusada** em `env` com a mensagem que manda
  usar `secretEnv` — a regra já existe em `personal-mcp-client.ts` e passa a valer também aqui. Env
  não-sensível (`NODE_ENV`, `HTTP_PROXY`) continua aceitando valor: proibir tudo quebraria
  configuração legítima por um perigo que a regra já endereça.
- **Nada vindo da rede vira comando sem dono ver.** Gravar um `command` exige confirmação explícita
  na tela, mostrando a linha de comando que aquela máquina passará a poder executar.
- **Só o dono, só máquina pareada.** `requireOwner` + allowlist de runners, como todo frame de tarefa.
- **Auditoria com a máquina real** (`auth.audit("task_mcp_config", …)`), no mesmo trilho do
  `task_binding` e do `task_write`.
- **A capacidade se anuncia.** Máquina que aceita edição remota diz isso na sessão — junto do aviso da
  ponte, numa linha só. Dois avisos por sessão sobre a mesma máquina viram ruído que ninguém lê.
- **Falha com motivo.** Arquivo inválido, servidor desconhecido, máquina offline, protocolo antigo →
  recusa explicando. Nunca "salvou" silencioso, nunca lista vazia.

## 4) Contracts (APIs / events / DB / tools)

### 4.1 Protocolo do runner (12 → 13)

Hub → máquina:

```ts
| { t: "task_mcp_config"; reqId: string }                                   // ler
| { t: "task_mcp_config_set"; reqId: string; name: string; server?: TaskMcpServerInput; remove?: boolean }
| { t: "task_mcp_test"; reqId: string; name: string }
```

Máquina → Hub:

```ts
| { t: "task_mcp_config"; reqId: string; configFile: string; schemaVersion: number;
    servers: Array<{ name: string; label?: string; transportKind: "stdio" | "streamable-http";
                     command?: string; args?: string[]; cwd?: string; envNames?: string[]; secretEnvNames?: string[];
                     endpoint?: string; listTool: string; listArguments?: Record<string, unknown>;
                     fields?: { key?: string; title?: string; description?: string }; testedAt?: number }>;
    error?: string }
| { t: "task_mcp_config_set"; reqId: string; ok: boolean; error?: string }
| { t: "task_mcp_test"; reqId: string; ok: boolean; count?: number; sample?: string[]; error?: string }
```

`envNames`/`secretEnvNames` são **nomes**. Valor de env não volta para a tela: quem já configurou não
precisa relê-lo aqui, e o que não trafega não vaza.

### 4.2 Registro da máquina

`RunnerInfo` ganha `taskMcpConfigFile: string` (o caminho REAL naquela máquina, consertando o que a
tela exibe hoje) e `taskMcpRemoteEdit: boolean` (a chave `JARVIS_TASK_MCP_REMOTE_EDIT`, que nasce
ligada).

### 4.3 Cliente ⇄ Hub

Frames espelhados (`task_mcp_config`, `task_mcp_config_set`, `task_mcp_test`) com `runnerId`, no molde
dos outros pedidos roteados por máquina. `task_connections` (que já alimenta a seção) passa a levar
`configFile` e `remoteEdit` por máquina.

### 4.4 Superfície de teste

`listTasksFromMcp` ganha injeção do cliente MCP nos testes (já existe em `task-mcp.test.ts`), então o
teste do `task_mcp_test` não sobe processo de verdade.

## 5) Data models

O arquivo mantém a forma de hoje e ganha um carimbo:

```json
{ "schemaVersion": 1, "servers": { "<nome>": { "label": "...", "transport": { ... }, "listTool": "...", "listArguments": { }, "fields": { } } } }
```

`schemaVersion` ausente é lido como 1 (todo arquivo escrito à mão até hoje). A gravação sempre carimba.
Nenhum estado novo no Hub; o `testedAt` fica no próprio arquivo, ao lado do servidor.

## 6) Flow (semi-executable pseudo-code)

```
# Hub, ao receber task_mcp_config_set do cliente
requireOwner; rc = runners.get(runnerId) ou recusa "máquina offline"
se rc.info.protocolVersion < 13 -> recusa "esta máquina ainda não sabe ser configurada daqui"
se !rc.info.taskMcpRemoteEdit   -> recusa "edição remota desligada nesta máquina (JARVIS_TASK_MCP_REMOTE_EDIT=0)"
encaminha; audita { runnerId, name, remove? }

# na máquina, ao receber task_mcp_config_set
se !TASK_MCP_REMOTE_EDIT -> { ok:false, error:"edição remota desligada nesta máquina" }
valida forma (parseServer) + transporte (validador stdio existente) + tetos
  env com chave sensível        -> { ok:false, error:"use secretEnv para <CHAVE>" }
  transporte/listTool ausente   -> { ok:false, error:<o que falta> }
lê arquivo atual, aplica {name: server} ou remove name
grava com writeJsonAtomic (schemaVersion: 1)
responde { ok:true } e republica taskMcpServers no registro
```

Casos de borda:

1. Máquina em protocolo 12 → a tela mostra o caminho manual (o de hoje) e não oferece formulário.
2. Máquina offline → recusa com motivo; nada fica "pendente" (diferente de publicação de framework,
   que tem fila — aqui um set enfileirado aplicaria configuração fora do contexto em que foi pensada).
3. Arquivo com JSON quebrado na máquina → a leitura devolve `error` e a tela mostra o motivo; salvar
   por cima é permitido, porque é justamente como se conserta um arquivo quebrado.
4. Remover o último servidor → arquivo fica `{schemaVersion:1, servers:{}}`; projeto que declarava
   `mcp` passa a recusar listagem com o motivo já existente.
5. Renomear = remover + adicionar. O vínculo do projeto guarda o NOME do servidor: renomear sem
   atualizar o vínculo quebra a fonte — a tela avisa quando o nome removido está em uso por algum
   projeto daquela máquina.
6. Dois clientes editando a mesma máquina → última escrita vence; a resposta sempre traz a lista
   relida do disco, então a tela do outro se corrige na hora.
7. `task_mcp_test` num servidor que não responde → `{ok:false, error}` com o motivo do servidor, e o
   servidor fica marcado "não testado" (salvar não exige teste verde — decisão do dono).

## 7) Acceptance criteria (Gherkin)

```gherkin
Cenário: adicionar um servidor MCP a uma máquina pela tela
  Dado uma máquina pareada no protocolo 13 com edição remota ligada
  Quando eu preencho o formulário e confirmo a linha de comando
  Então a máquina valida, grava o arquivo dela e responde ok
  E a lista de servidores daquela máquina passa a mostrar o novo nome

Cenário: segredo colado em env é recusado com o conserto no texto
  Dado o formulário com env GITHUB_TOKEN=ghp_xxx
  Quando eu salvo
  Então a máquina recusa dizendo para usar secretEnv
  E nada é gravado no arquivo

Cenário: testar prova que o servidor responde
  Dado um servidor configurado naquela máquina
  Quando eu aciono Testar
  Então a resposta diz quantas tarefas vieram, ou o motivo de não vir nenhuma

Cenário: salvar sem testar é permitido, e a tela não finge que testou
  Dado um servidor salvo sem teste verde
  Quando eu olho a lista
  Então ele aparece marcado como não testado

Cenário: máquina desatualizada não ganha formulário
  Dado uma máquina no protocolo 12
  Quando eu abro Configurações → Tarefas
  Então ela mostra o caminho do arquivo NA MÁQUINA DELA e o aviso de que não sabe ser configurada daqui

Cenário: edição remota desligada recusa com motivo
  Dado uma máquina com JARVIS_TASK_MCP_REMOTE_EDIT=0
  Quando eu tento salvar um servidor nela
  Então a recusa diz que a edição remota está desligada naquela máquina

Cenário: remover um servidor em uso avisa antes
  Dado um projeto daquela máquina cuja fonte é o servidor "linear-trabalho"
  Quando eu removo esse servidor
  Então a tela avisa que um projeto perde a fonte
```

### 7.1 Executable verification

```
node --import tsx --test packages/core/src/task-mcp.test.ts
node --import tsx --test apps/hub/src/webClient.test.ts
node --import tsx --test apps/hub/src/taskMcpConfig.e2e.test.ts
npm run check
```

## 8) Test plan

- **Core (`task-mcp.test.ts`)**: validador de entrada — env sensível recusado com o nome da chave,
  `listTool` ausente, transporte desconhecido, tetos de tamanho; gravação carimba `schemaVersion`;
  arquivo sem versão é lido como 1.
- **E2E (`taskMcpConfig.e2e.test.ts`)**, no molde do `taskBridge.e2e.test.ts` (Hub real + máquina
  falando o protocolo): salvar chega à máquina certa; máquina em protocolo 12 recusa com motivo;
  edição desligada recusa; a lista volta relida do disco.
- **Cliente (`webClient.test.ts`)**: formulário desenha os campos, marca "não testado", esconde o
  formulário para máquina antiga e mostra o caminho REAL dela.
- **Regressão**: `npm test` inteiro.
- **Manual**: configurar um servidor MCP na Luby pela tela do Desktop e listar tarefas dele.

## 9) Observability

- `auth.audit("task_mcp_config", { userId, deviceId, runnerId, detail: "set <nome>" | "remove <nome>" })`
  — sem valores de env, sem endpoint com credencial embutida.
- `log.info("task_mcp_config", { runnerId, name, ok })` na máquina e no Hub.

## 10) Risk, rollback, feature flag

- **Risco 1**: escrever comando remotamente é a mudança de postura. Mitigações: confirmação mostrando
  a linha de comando, só dono, só máquina pareada, auditoria, e o interruptor por máquina.
- **Risco 2**: segredo colado numa chave de env de nome inocente (`MY_THING=sk-...`) trafega até a
  máquina. A regra de nome sensível não pega esse caso — e nenhuma heurística pegaria. Mitigação
  honesta: a auditoria não registra valores, a tela avisa que valor de env vai para o disco da
  máquina, e `secretEnv` é oferecido como o caminho certo no próprio formulário.
- **Rollback**: reverter o commit; o arquivo continua válido (o `schemaVersion` extra é ignorado por
  quem não o conhece).
- **Feature flag**: `JARVIS_TASK_MCP_REMOTE_EDIT` nasce LIGADA; `=0` no `runner.env` desliga naquela
  máquina, e a tela passa a mostrar só o caminho manual.

### 10.1 Environment and bootstrap

Runner atualizado (protocolo 13) e Hub reiniciado. Nenhuma migração de arquivo: o carimbo entra na
primeira gravação.

## 11) Implementation plan (BEFORE CODING)

1. `packages/core/src/task-mcp.ts`: `validateTaskMcpServerInput` (forma + transporte + env sensível +
   tetos), `writeTaskMcpConfig` (atômico, carimba `schemaVersion: 1`), `describeTaskMcpServers`
   (versão redigida para a tela). Testes RED primeiro.
2. `packages/protocol/src/runner.ts`: frames do §4.1, `taskMcpConfigFile`/`taskMcpRemoteEdit` no
   registro, `RUNNER_PROTOCOL_VERSION = 13`.
3. `apps/runner/src/index.ts`: handlers de ler/gravar/testar, respeitando a flag; republicar
   `taskMcpServers` após gravar.
4. `apps/hub/src/index.ts`: roteamento por `runnerId` (owner, máquina online, protocolo ≥ 13),
   auditoria, e o `configFile` passando a vir da máquina; anúncio da capacidade junto do aviso da
   ponte, numa linha só.
5. `apps/hub/web/app.js` + `index.html`: formulário por máquina em Configurações → 🎯 Tarefas, com
   Testar, marca "não testado", confirmação da linha de comando e aviso de nome em uso.
6. E2E + testes de cliente; `npm run check`.
7. `docs/task-sources.md`: a seção `mcp` deixa de mandar editar à mão como único caminho.

## 12) DoR / DoD

**DoR** — contratos definidos (§4), sem schema de banco, dependência satisfeita (TSK-11 commitada em
`9b31528`), invariantes explícitos, fluxo com 7 bordas, 7 cenários Gherkin, verificação executável,
plano em 7 passos. **Aguardando aprovação humana.**

**DoD** — suíte verde (incluindo o e2e novo), cenários cobertos, evidência no commit, protocolo
documentado, `docs/task-sources.md` atualizado, sem TODO pendente. Triagem de segurança no F9: esta
fatia escreve configuração que vira processo na máquina — a recomendação é F11 completo, como na
TSK-11.
