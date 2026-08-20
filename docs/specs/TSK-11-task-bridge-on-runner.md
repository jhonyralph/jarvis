---
feature_id: TSK-11-task-bridge-on-runner
tldr: "A IA de uma sessão remota passa a buscar, ler e criar tarefas — pela conta do projeto daquela máquina."
title: "Ponte de tarefas no runner"
owner: "Jonathan / Claude"
status: approved
risk_level: medium
stack: node
services_affected: [hub, runner, protocol, core]
dependencies: []
schema_required: false
schema_dependencies: []
links:
  roadmap: "Épico 'fontes de tarefa'; fatia nova, aberta pela pergunta do dono em 2026-08-18"
  design: "Desenho aprovado no chat em 2026-08-18 (ordem: ponte → 4a → 4b)"
  adr: "N/A"
approval_evidence: "Usuário em 2026-08-18: 'Sim' para a IA remota mexer em tarefas, 'Ponte primeiro' na ordem; e em 2026-08-19 aprovou a spec, confirmou a borda 4 (sem git → sem auto-aprovação), a flag nascendo LIGADA e o aviso da ponte aparecendo NA SESSÃO."
---

# Executable spec

## 0) Meta (TL;DR)

A ponte MCP `jarvistask` só existe hoje em sessões da máquina do Hub. Numa sessão remota, a IA
simplesmente não tem ferramenta de tarefa. Esta fatia leva a ponte ao runner, no mesmo molde da ponte
de permissão, e conserta três defeitos de "qual máquina responde" que hoje estão latentes porque
ninguém os alcança.

## 1) Context and objective

### 1.1 Problem

`packages/core/src/agents.ts:866` monta o servidor MCP `jarvistask` apenas quando `JARVIS_TASK_URL` +
`JARVIS_TASK_TOKEN` existem no ambiente. Essas variáveis são definidas só no processo do Hub
(`apps/hub/src/index.ts:71-72`); `grep JARVIS_TASK apps/runner/src/` não devolve nada. Consequência:
numa sessão da Luby você configura a fonte pela tela e a busca funciona pelo painel, mas pedir "cria
uma issue disso" para a IA não faz nada — a ferramenta não existe naquela sessão.

Três defeitos latentes da mesma família ("o Hub responde pelo disco dele"):

- **A.** `task_create` (`apps/hub/src/index.ts:7021`) chama `resolveSessionTaskConnection(sessionId, true)`
  sem `runnerId` → default `LOCAL_ID` → `sessionProjectDir(LOCAL_ID, sid)` = `store.get(sid)?.cwd || CWD`.
  Em sessão remota isso cai no **CWD do Hub**: o vínculo resolvido é o de outro projeto. Hoje nenhum
  chamador envia esse frame (o cliente só recebe `task_create_result`), então é superfície esperando o
  primeiro uso.
- **B.** A ponte local (`732`/`748`) usa o mesmo default. Correto **por acidente**: ela só existe em
  sessão da máquina do Hub. Vira bug no minuto em que esta fatia existir.
- **C.** `gitRemoteUrl` (`448`) roda `git -C <cwd>` no disco do **Hub**. Com `cwd` de outra máquina, o
  aviso "o remote deste projeto não bate com a conexão" some em silêncio — um guarda-corpo que
  desaparece justamente no caso remoto. E é ele que impede auto-aprovar criação com a conta errada
  (`if (binding?.autoApprove?.includes("create") && !warning)`).

Ainda no caminho da ponte: o sucesso é anunciado com `broadcastOn(LOCAL_ID, sessionId, …)` e auditado
com `runnerId: LOCAL_ID` fixos — em sessão remota, o aviso iria para o canal da máquina errada e a
auditoria registraria a máquina errada.

### 1.2 Objective (Definition of Value)

Numa sessão de qualquer máquina pareada, a IA pode `search`/`get`/`create` tarefas do provedor
declarado pelo projeto **daquela** máquina, com o segredo permanecendo no Hub e a aprovação
acontecendo na tela do dono.

## 2) Dual-source planning

- **2.1 Roadmap** — épico de fontes de tarefa; ordem acordada: esta fatia → 4a (editar o
  `task-mcp.json` pela tela) → 4b (registro único de MCP).
- **2.2 Referências** — ponte de permissão no runner (`apps/runner/src/index.ts:203-262`) e seu par no
  Hub (`apps/hub/src/index.ts:2352-2366`); ponte de tarefas local (`apps/hub/src/index.ts:719-785`);
  `resolveSessionTaskConnection` (`491`), `sessionProjectDir` (`464`); harness e2e com Hub e runner
  reais (`apps/hub/src/taskFanout.e2e.test.ts`).
- **2.3 Gap scan** — nenhum schema; nenhum segredo novo; `RUNNER_PROTOCOL_VERSION` sobe 11 → 12. Runner
  em 11 continua funcionando: ele não monta a ponte, e a IA lá segue sem ferramenta de tarefa — que é
  exatamente o estado de hoje, não uma regressão.
- **2.4 Delta** — além da ponte, esta fatia corrige A, B e C, e troca os `LOCAL_ID` fixos do aviso e da
  auditoria pelo runner real da sessão.

## 3) Rules and invariants (SYSTEM LAWS)

- **Segredo não sai do Hub.** O runner encaminha intenção e recebe resultado; nunca recebe token,
  `config` de conexão ou `secretRef`. Igual à ponte de permissão, que também não decide nada.
- **Contenção por máquina.** O Hub resolve a conexão pelo projeto **da máquina que pediu** (`rc.id`).
  Uma máquina só alcança as conexões dos projetos que estão nela. É o conserto de A virando garantia,
  e é o invariante mais importante desta fatia.
- **Escrita mantém as travas.** Identidade verificada, preview nominal, aprovação adaptativa salvo
  `autoApprove` do projeto. Divergência remote×conexão continua NUNCA auto-aprovável.
- **Falha fechada.** Hub desconectado, sessão sem pasta conhecida, projeto sem fonte declarada,
  conexão não verificada, timeout → recusa **com motivo**. Nunca lista vazia, nunca sucesso silencioso.
- **Aprovação é do dono, na tela dele.** Nada de aprovar na máquina remota.
- **A ponte se anuncia.** Máquina com a ponte ativa avisa na sessão, uma vez por sessão — uma porta
  nova para o cofre não pode ser invisível para quem é dono dele.
- **Observabilidade** — `auth.audit("task_write", …)` com o runner REAL; `notice` na sessão certa.

## 4) Contracts (APIs / events / DB / tools)

### 4.1 Protocolo do runner (11 → 12)

Runner → Hub:

```ts
| { t: "task_bridge"; reqId: string; sessionId: string; op: "search" | "get" | "create"; args: Record<string, unknown> }
| { t: "git_remote"; reqId: string; cwd: string; url?: string }   // resposta ao pedido do Hub
```

Hub → Runner:

```ts
| { t: "task_bridge_result"; reqId: string; ok: boolean; code?: string; error?: string; connection?: string;
    results?: Array<{ tracker: string; key: string; title: string; state?: string; url?: string }>;
    task?: { tracker: string; key: string; title: string; description?: string; url?: string };
    key?: string; url?: string }
| { t: "git_remote"; reqId: string; cwd: string }                  // pedido
```

`reqId` correlaciona; ids desconhecidos ou expirados são ignorados dos dois lados — mesma regra do
`permission_decision`.

### 4.2 HTTP local do runner

`POST /internal/task` em `127.0.0.1:<porta efêmera>`, com token próprio por processo — cópia do
`permServer`. Exporta `JARVIS_TASK_URL` e `JARVIS_TASK_TOKEN` no ambiente do runner; `agents.ts` monta
a ponte sem nenhuma mudança.

### 4.3 Sem mudança de contrato com o cliente

`task_create_pending` / `task_create_result`, aprovações adaptativas e `notice` continuam iguais — o
que muda é o canal para o qual são emitidos (a sessão da máquina certa).

### 4.4 Superfície de teste

O harness e2e ganha um cenário com runner remoto e um provedor **falso** (servidor HTTP local que
responde como GitHub), para exercitar `search` e `create` sem rede.

## 5) Data models

Nada persistido de novo. Em memória, no Hub:
`pendingTaskBridge: Map<reqId, { runnerId, sessionId, timer, settle }>`, espelhando
`pendingPermissions`. No runner: `pendingTaskCalls: Map<reqId, { timer, settle }>`.

## 6) Flow (semi-executable pseudo-code)

```
# no runner (cópia do permServer)
POST /internal/task {op, sessionId, args} + token
  se hub desconectado -> 200 {ok:false, error:"Hub desconectado — recusado por segurança"}
  reqId = uuid; timer(TASK_TIMEOUT_MS) -> {ok:false, error:"tempo esgotado"}
  send({t:"task_bridge", reqId, sessionId, op, args})

# no Hub, ao receber task_bridge de rc
runnerId = rc.id                                   # <- a correção de A/B
{cwd, binding, resolved} = resolveSessionTaskConnection(sessionId, op=="create", runnerId)
se refusal -> task_bridge_result{ok:false, code, error}
se op in (search,get) -> chama o provedor com o segredo do cofre do HUB -> resultado
se op == create:
  target = binding.target, ou recusa NO_TARGET
  remote = await gitRemoteOf(runnerId, cwd)        # <- a correção de C
  warning = remoteMismatchWarning(remote, conexão)
  se binding.autoApprove.create e !warning -> executa
  senão -> aprovação adaptativa; executa só se aprovado
  ao executar: audit(runnerId REAL) + notice na sessão daquela máquina
```

Casos de borda:

1. Runner em protocolo 11 → não monta a ponte; a IA fica sem ferramenta de tarefa, como hoje. Sem erro.
2. Hub cai no meio do pedido → o runner responde recusa por timeout; o Hub, ao voltar, não executa
   nada (o pedido morreu com o `reqId`).
3. Sessão cuja pasta a máquina ainda não reportou → recusa com o motivo já existente.
4. `git` ausente na máquina do projeto → `remote` indefinido → `warning` indefinido; criação **não**
   pode ser auto-aprovada nesse caso (ausência de prova não é prova de ausência).
5. Dois pedidos com o mesmo `reqId` (entrega duplicada) → o primeiro é dono da resposta.
6. Aprovação expira (30 min) → recusa com motivo, e o `reqId` é encerrado.
7. Máquina desconecta com aprovação pendente → executar seria escrever em nome de uma sessão que já
   não existe: recusa e registra.
8. Projeto remoto vinculado à mesma conexão de um projeto do Hub → permitido (a conexão é do cofre, o
   vínculo é por pasta). O que a contenção impede é alcançar o vínculo de OUTRA máquina.

## 7) Acceptance criteria (Gherkin)

```gherkin
Cenário: a IA de uma sessão remota busca tarefas pela conta do projeto daquela máquina
  Dado um runner remoto pareado e um projeto lá vinculado a um provedor com conexão verificada
  Quando a IA daquela sessão chama jarvis_task_search
  Então o Hub resolve a conexão pelo vínculo da pasta DAQUELA máquina
  E o resultado volta para a IA sem que o segredo saia do Hub

Cenário: a máquina remota não alcança o vínculo de um projeto do Hub
  Dado um projeto no Hub vinculado a um provedor e um projeto remoto sem fonte declarada
  Quando a IA da sessão remota pede uma tarefa
  Então a resposta é recusa com o motivo do projeto REMOTO
  E nenhuma conexão do projeto do Hub é usada

Cenário: criar tarefa a partir de sessão remota pede aprovação na tela do dono
  Dado uma sessão remota com conexão verificada e destino definido
  Quando a IA pede para criar uma tarefa
  Então uma aprovação aparece para o dono com o preview nominal
  E nada é criado antes da aprovação

Cenário: Hub desconectado recusa por segurança
  Dado o runner sem conexão com o Hub
  Quando a IA daquela máquina chama a ferramenta de tarefa
  Então a resposta é recusa com motivo, e não uma lista vazia

Cenário: o aviso de remote divergente volta a existir em projeto remoto
  Dado um projeto remoto cujo git remote não bate com a conexão vinculada
  Quando a IA pede para criar uma tarefa com autoApprove ligado
  Então a criação NÃO é auto-aprovada
  E o preview mostra o aviso de divergência

Cenário: runner desatualizado degrada sem mentir
  Dado um runner em protocolo 11
  Quando uma sessão dele roda um turno
  Então a IA não recebe ferramenta de tarefa
  E nenhum erro é apresentado ao usuário
```

### 7.1 Executable verification

```
node --import tsx --test apps/hub/src/taskBridge.e2e.test.ts
node --import tsx --test apps/hub/src/webClient.test.ts
npm run check
```

## 8) Test plan

- **E2E (novo `taskBridge.e2e.test.ts`)**, no molde do `taskFanout.e2e.test.ts`: Hub e runner reais,
  mais um provedor falso. Cobre os cenários 1, 2, 3 e 4 do §7.
- **Unidade (Hub)**: roteamento por `rc.id`, `reqId` duplicado, timeout, expiração de aprovação.
- **Unidade (core)**: nenhuma regra nova de domínio — `remoteMismatchWarning` já tem testes.
- **Regressão**: suíte inteira (`npm test`), incluindo os 1189 atuais.
- **Manual**: uma sessão na Luby criando uma issue de verdade, com a aprovação aparecendo no Desktop.

## 9) Observability

- `auth.audit("task_write", { runnerId: <real>, detail: "create(ia) <conexão> → <chave>" })`.
- `notice` na sessão de origem, na máquina de origem.
- `log.info("task_bridge", { runnerId, sessionId, op, ok })` — sem args, sem título, sem segredo.
- `notice` uma vez por sessão em máquina com a ponte ativa: "Esta máquina permite que a IA busque e
  crie tarefas pela conta do projeto. Para desligar: `JARVIS_TASK_BRIDGE=0` no `runner.env` dela."

## 10) Risk, rollback, feature flag

- **Risco 1**: uma máquina comprometida ganha uma porta para o cofre. Mitigação: contenção por projeto
  (§3), escrita com aprovação, auditoria com a máquina real, e o segredo nunca no runner.
- **Risco 2**: `create` disparado por prompt injection dentro da IA. Mitigação: a aprovação adaptativa
  é o mesmo portão de hoje; `autoApprove` continua sendo escolha explícita por projeto.
- **Rollback**: reverter o commit. Runner e Hub voltam a 11 e local-only, sem migração — nada
  persistido muda.
- **Feature flag**: `JARVIS_TASK_BRIDGE` nasce LIGADA (ausente = ponte ativa); `=0` no `runner.env`
  desliga naquela máquina. Decisão do dono em 2026-08-19, junto com o aviso na sessão.

### 10.1 Environment and bootstrap

Nenhuma variável obrigatória nova. O runner precisa ser atualizado (protocolo 12) e o Hub reiniciado.
Nenhum passo manual no `task-mcp.json` — esta fatia não o toca.

## 11) Implementation plan (BEFORE CODING)

1. `packages/protocol/src/runner.ts`: frames `task_bridge`, `task_bridge_result`, `git_remote`;
   `RUNNER_PROTOCOL_VERSION = 12`.
2. `apps/hub/src/index.ts`: extrair o corpo da ponte local (719-785) para uma função que recebe
   `{ runnerId, sessionId, op, args, reply }`; o caminho HTTP local passa a chamá-la com `LOCAL_ID`.
   (RED antes: o e2e do cenário 2 falha com o default atual.)
3. `apps/hub/src/index.ts`: handler de `task_bridge` vindo de `rc`, com `pendingTaskBridge`, timeout e
   respostas; trocar o `LOCAL_ID` fixo de `broadcastOn` e `audit` pelo runner real.
4. `apps/hub/src/index.ts`: `gitRemoteOf(runnerId, cwd)` — local usa `gitRemoteUrl`, remoto pede à
   máquina (`git_remote`); ausência de resposta bloqueia auto-aprovação (§6, borda 4).
5. `apps/hub/src/index.ts:7021`: `task_create` passa `activeRunner(ws)` (defeito A).
6. `apps/runner/src/index.ts`: `taskServer` no molde do `permServer`, `JARVIS_TASK_URL/TOKEN`, handlers
   de `task_bridge_result` e `git_remote`; respeitar `JARVIS_TASK_BRIDGE=0`.
7. Testes do §8; `npm run check`.
8. `docs/task-sources.md`: seção "a IA e as tarefas", com o que vale em sessão remota.

## 12) DoR / DoD

**DoR** — contratos definidos (§4), sem schema, sem dependência pendente, invariantes explícitos,
fluxo com 8 bordas, 6 cenários Gherkin, verificação executável, plano em 8 passos. **Aguardando
aprovação humana.**

**DoD** — suíte verde (incluindo o e2e novo), cenários cobertos, evidência (comando e saída) no
commit, protocolo documentado, `docs/task-sources.md` atualizado, sem TODO pendente. A triagem do F9
decide se esta fatia exige F11 completo — a recomendação da spec é que **sim**, por tocar caminho de
escrita com credencial de terceiro.
