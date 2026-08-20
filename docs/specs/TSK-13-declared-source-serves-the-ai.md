---
feature_id: TSK-13-declared-source-serves-the-ai
tldr: "A fonte declarada do projeto vale para a IA também — pasta, MCP ou provedor — e o arquivo passa a declarar o servidor uma vez, com os usos à parte."
title: "A fonte declarada serve a IA (e o registro único de MCP)"
owner: "Jonathan / Claude"
status: approved
risk_level: medium
stack: node
services_affected: [hub, runner, protocol, core, web]
dependencies: [TSK-11-task-bridge-on-runner, TSK-12-task-mcp-config-from-ui]
schema_required: false
schema_dependencies: []
links:
  roadmap: "Épico 'fontes de tarefa'; fatia 4b, remodelada por um defeito encontrado ao desenhá-la"
  design: "Chat em 2026-08-19"
  adr: "N/A"
approval_evidence: "Usuário em 2026-08-19 escolheu 'Atacar o 4b'. A forma da fatia mudou depois da verificação descrita em §1.1 — a forma nova foi aprovada em 2026-08-19. Desvio implementado e justificado: `uses.tasks` é MAPEADO por nome de servidor (o §4.2 previa um `server` único), senão máquina com dois servidores perderia o uso de cada um."
---

# Executable spec

## 0) Meta (TL;DR)

A ponte de tarefas (TSK-11) só sabe servir fonte de **provedor**. Num projeto cuja fonte declarada é
uma **pasta** ou um **servidor MCP**, a IA recebe "escolha a conta" — instrução impossível de seguir,
porque essas fontes não têm conta por definição. Esta fatia faz a fonte declarada valer para a IA nos
três casos, e é o segundo consumidor que finalmente justifica separar, no arquivo da máquina, **como
subir o servidor** de **para que usá-lo**.

## 1) Context and objective

### 1.1 Problem

`serveTaskBridge` resolve tudo por `resolveSessionTaskConnection` → `resolveTaskConnection`, que só
conhece o cofre (`packages/core/src/task-connections.ts:180-182`): sem `connectionId`, recusa
`NO_CONNECTION` com *"o projeto tem fonte definida mas nenhuma CONEXÃO vinculada — escolha a conta"*.

Mas `resolveTaskSource` (`task-link.ts:265-275`) devolve `local` e `mcp` como **`ready: true` sem
conexão nenhuma** — de propósito, porque a conta não existe nesse caminho. Resultado, no mesmo
projeto e ao mesmo tempo:

| Quem pergunta | Projeto com fonte `local` ou `mcp` |
|---|---|
| O painel (`task_local_list`) | lista as tarefas normalmente |
| A IA (`jarvis_task_search`) | recusa mandando escolher uma conta que não existe |

É a mesma família que a fatia C matou: resposta plausível e falsa. E ficou visível agora porque a
TSK-11 abriu esse caminho para todas as máquinas.

O segundo problema é de forma. Hoje o arquivo mistura numa entrada só:

```json
"linear-trabalho": { "transport": {...},            // COMO subir o servidor
                     "listTool": "list_issues",     // PARA QUE usá-lo
                     "fields": { "key": "identifier" } }
```

Enquanto "para que" era só listar, misturar não custava. Com **criar** entrando (§4.3), o mesmo
servidor passa a ter dois usos — e declarar o servidor duas vezes para isso seria subir dois
processos para o mesmo binário.

### 1.2 Objective (Definition of Value)

Numa sessão de qualquer máquina, a IA busca, lê e cria tarefas **na fonte que o projeto declarou** —
pasta, MCP ou provedor — sem que nenhuma dessas respostas dependa de uma conta que aquela fonte não
tem.

## 2) Dual-source planning

- **2.1 Roadmap** — 4b da ordem acordada, remodelada: a parte que dói (a IA recusando em fonte sem
  conta) entra antes do formato, e o formato só muda onde o segundo uso o exige.
- **2.2 Referências** — `serveTaskBridge` e `resolveSessionTaskConnection` (`apps/hub/src/index.ts`);
  `resolveTaskSource` (`packages/core/src/task-link.ts:250-300`); listagem por máquina já roteada
  (`task_local_list`, `task_mcp_list`); `resolveFeaturesRoot` (contenção de caminho, já testada);
  `validateTaskMcpServerInput` e `writeTaskMcpConfig` (TSK-12).
- **2.3 Gap scan** — `RUNNER_PROTOCOL_VERSION` sobe 13 → 14 (um frame novo: escrever arquivo de
  feature). Máquina em 13 continua servindo busca e leitura; só `create` em fonte local recusa com
  motivo. Sem schema de banco. Sem segredo novo.
- **2.4 Delta** — além de servir as três fontes, esta fatia carimba `schemaVersion: 2` e migra o
  arquivo na primeira gravação.

## 3) Rules and invariants (SYSTEM LAWS)

- **A fonte declarada manda, para todo mundo.** Painel e IA respondem pela MESMA fonte. Duas
  respostas diferentes para a mesma pergunta no mesmo projeto é o defeito, não a feature.
- **Conta só é exigida onde conta existe.** `local` e `mcp` nunca recusam por falta de conexão.
- **Uso não declarado é inalcançável.** Como já vale para `listTool`: sem `createTool` declarado, criar
  por MCP é recusado com motivo — o que o servidor anuncia não amplia nada.
- **Criar continua sendo escrita.** Mesmo portão de hoje: preview nominal e aprovação do dono, salvo
  `autoApprove` do projeto. Vale também para arquivo de feature: criar arquivo no repositório de
  alguém é escrita, não leitura.
- **Contenção de caminho.** Escrever arquivo de feature passa por `resolveFeaturesRoot` — o mesmo
  guarda que impede `..` e caminho absoluto na leitura.
- **Zero LLM neste caminho** (anti-escopo do épico). Interpretar resultado é determinístico; servidor
  que responde em prosa é erro com motivo.
- **Migração não perde nada.** Arquivo v1 é lido como sempre; a forma v2 só é escrita quando alguém
  salva. Nenhuma máquina precisa ser tocada para continuar funcionando.

## 4) Contracts (APIs / events / DB / tools)

### 4.1 Protocolo do runner (13 → 14)

```ts
// Hub → máquina: criar um arquivo de feature na pasta declarada do projeto.
| { t: "task_local_write"; reqId: string; sessionId: string; key: string; title: string; description?: string }
// máquina → Hub
| { t: "task_local_write"; reqId: string; ok: boolean; key?: string; error?: string }
```

Busca e leitura NÃO ganham frame novo: `task_local_list` e `task_mcp_list` já existem e já são
roteados por máquina. A ponte passa a usá-los em vez de exigir cofre.

### 4.2 Arquivo da máquina — `schemaVersion: 2`

```json
{
  "schemaVersion": 2,
  "servers": { "linear-trabalho": { "label": "Linear do trabalho", "transport": { "kind": "stdio", "command": "npx", "args": ["-y", "linear-mcp"] } } },
  "uses": {
    "tasks": {
      "server": "linear-trabalho",
      "list": { "tool": "list_issues", "arguments": { "limit": 50 }, "fields": { "key": "identifier" } },
      "create": { "tool": "create_issue", "arguments": { "teamId": "PRI" } }
    }
  }
}
```

Migração v1 → v2 na leitura (em memória) e na primeira gravação (em disco): cada servidor vira uma
entrada em `servers` e o `listTool`/`listArguments`/`fields` dele vira `uses.tasks.list`. Um arquivo v1
com dois servidores migra com `uses.tasks` apontando para o primeiro, e o restante fica em `servers`
disponível para uso — sem escolher fonte por conta própria (a regra do `pickTaskMcpServer` continua
valendo quando o vínculo não nomeia servidor).

### 4.3 Comportamento da ponte por fonte

| Fonte | `search` / `get` | `create` |
|---|---|---|
| `provider` | cofre do Hub (como hoje) | como hoje |
| `local` | lista de arquivos da máquina, filtrada pelo termo | `task_local_write` na pasta declarada |
| `mcp` | `uses.tasks.list` na máquina | `uses.tasks.create` se declarado; senão recusa com motivo |

### 4.4 Superfície de teste

O e2e da TSK-11 ganha um cenário com fonte `local` numa máquina remota; o da TSK-12 cobre a migração
v1 → v2 na gravação.

## 5) Data models

Só o arquivo da máquina (§4.2). Nada persistido novo no Hub.

## 6) Flow (semi-executable pseudo-code)

```
# no Hub, em serveTaskBridge
{cwd, binding, source} = sessionTaskSource(runnerId, sessionId)
se source.kind == "provider" -> caminho de hoje (cofre + aprovação)
se source.kind == "local":
   search/get -> pede task_local_list à máquina; filtra por termo/chave
   create     -> preview + aprovação; depois task_local_write (a máquina valida o caminho)
se source.kind == "mcp":
   search/get -> pede task_mcp_list à máquina
   create     -> se uses.tasks.create ausente -> recusa "este servidor não declara ferramenta de criar"
                 senão preview + aprovação; depois task_mcp_call
se source.kind == "none" -> recusa "declare a fonte deste projeto" (motivo que já existe)
```

Casos de borda:

1. Máquina em protocolo 13 → busca e leitura funcionam; `create` em fonte local recusa pedindo update.
2. Arquivo de feature com o mesmo nome já existe → recusa; sobrescrever tarefa alheia não é criar.
3. `key` com `..`, caminho absoluto ou barra invertida → recusado por `resolveFeaturesRoot`.
4. Fonte `mcp` cujo servidor sumiu do arquivo → recusa nomeando o servidor (motivo que já existe).
5. Arquivo v1 com dois servidores → migra sem escolher fonte sozinho (§4.2).
6. Migração falha (arquivo torto) → mantém v1 em disco e responde com o motivo; não reescreve por cima.
7. `search` em fonte local com muitos arquivos → mesmo teto da listagem de hoje, e o teto é dito.

## 7) Acceptance criteria (Gherkin)

```gherkin
Cenário: a IA busca tarefas num projeto cuja fonte é uma pasta
  Dado um projeto numa máquina remota com fonte local declarada e arquivos de feature
  Quando a IA chama jarvis_task_search
  Então a resposta traz as tarefas da pasta DAQUELA máquina
  E em nenhum momento é pedida uma conta

Cenário: a IA busca num projeto cuja fonte é um servidor MCP
  Dado um projeto com fonte mcp e servidor declarado na máquina
  Quando a IA chama jarvis_task_search
  Então a listagem vem do servidor daquela máquina

Cenário: criar tarefa em fonte local pede aprovação e vira arquivo
  Dado um projeto com fonte local
  Quando a IA pede para criar uma tarefa e eu aprovo
  Então um arquivo de feature aparece na pasta declarada, na máquina do projeto

Cenário: criar por MCP sem ferramenta declarada recusa com motivo
  Dado um projeto com fonte mcp cujo uso não declara create
  Quando a IA pede para criar uma tarefa
  Então a recusa diz que o servidor não declara ferramenta de criar
  E nada é chamado no servidor

Cenário: arquivo v1 continua funcionando e migra ao salvar
  Dado uma máquina com task-mcp.json na forma antiga
  Quando eu salvo qualquer servidor pela tela
  Então o arquivo passa a ter schemaVersion 2 com servers e uses
  E a listagem continua respondendo igual, antes e depois
```

### 7.1 Executable verification

```
node --import tsx --test packages/core/src/task-mcp.test.ts
node --import tsx --test apps/hub/src/taskBridge.e2e.test.ts
npm run check
```

## 8) Test plan

- **Core**: migração v1 → v2 (um servidor, dois servidores, arquivo torto), leitura de `uses`,
  `create` ausente, contenção de caminho no `key` do arquivo de feature.
- **E2E**: máquina remota com fonte `local` respondendo `search` pela ponte; recusa de `create` por
  MCP sem `createTool`.
- **Hub**: a ponte não chama o cofre quando a fonte é `local`/`mcp` (o teste falha se `NO_CONNECTION`
  voltar a aparecer nesse caminho).
- **Regressão**: `npm test` inteiro.
- **Manual**: numa sessão da Luby, com projeto de fonte local, pedir para a IA listar e criar tarefa.

## 9) Observability

`log.info("task_bridge", { runnerId, sessionId, op, source: "local"|"mcp"|"provider", ok })` — a fonte
entra no log porque "por que essa resposta veio assim" começa por ela. Auditoria de escrita
(`task_write`) passa a valer também para arquivo de feature, com o caminho relativo.

## 10) Risk, rollback, feature flag

- **Risco 1**: escrita de arquivo no repositório do projeto. Mitigações: mesma aprovação da escrita em
  provedor, contenção por `resolveFeaturesRoot`, recusa quando o arquivo já existe.
- **Risco 2**: migração de formato. Mitigação: v1 continua sendo lido; v2 só é escrito quando alguém
  salva; arquivo torto não é reescrito por cima.
- **Rollback**: reverter o commit. Um arquivo já migrado para v2 volta a ser lido por... **não**: a
  versão anterior não conhece `uses`. Por isso a migração acontece só na gravação, e o rollback exige
  reverter o arquivo daquela máquina — está dito aqui porque é a única parte não trivialmente
  reversível desta fatia.
- **Feature flag**: nenhuma nova; `JARVIS_TASK_BRIDGE=0` já desliga o caminho inteiro por máquina.

### 10.1 Environment and bootstrap

Runner em 14 e Hub reiniciado. Nenhuma ação manual em arquivo.

## 11) Implementation plan (BEFORE CODING)

1. `packages/core/src/task-mcp.ts`: leitura tolerante a v1 e v2 (`readTaskMcpUses`), migração e
   gravação em v2. Testes RED primeiro.
2. `apps/hub/src/index.ts`: `serveTaskBridge` passa a decidir por `source.kind`; `local` e `mcp`
   deixam de tocar o cofre. (RED: teste do `NO_CONNECTION` que hoje aparece.)
3. `packages/protocol/src/runner.ts` + `apps/runner/src/index.ts`: `task_local_write` com contenção de
   caminho e recusa se o arquivo existir; `RUNNER_PROTOCOL_VERSION = 14`.
4. Ponte: `create` em `local` e `mcp`, com o mesmo preview e a mesma aprovação da escrita em provedor.
5. `apps/hub/web/app.js`: a seção de MCP passa a mostrar os usos declarados (listar / criar).
6. Testes do §8; `npm run check`.
7. `docs/task-sources.md`: a tabela de fontes ganha a coluna "o que a IA pode fazer".

## 12) DoR / DoD

**DoR** — contratos definidos, dependências satisfeitas (TSK-11 e TSK-12 commitadas), invariantes
explícitos, fluxo com 7 bordas, 5 cenários Gherkin, verificação executável, plano em 7 passos.
**Aguardando aprovação humana.**

**DoD** — suíte verde, cenários cobertos, evidência no commit, protocolo documentado,
`docs/task-sources.md` atualizado, sem TODO pendente. Triagem: F11 completo, como nas duas fatias
anteriores — esta escreve arquivo no repositório do usuário.
