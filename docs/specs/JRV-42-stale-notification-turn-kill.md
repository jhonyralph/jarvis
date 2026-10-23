---
feature_id: JRV-42-stale-notification-turn-kill
tldr: "Um `result` do claude deixa de ser o fim do turno quando a CLI começa outro turno no mesmo processo — o aviso velho do --resume não mata mais o trabalho real em 60 s; e o custo/contexto do turno param de ser o acumulado da sessão."
title: "Turno do Claude derrubado pelo mini-turno do aviso velho (e a telemetria que somava a sessão inteira)"
owner: "Jonathan / Claude"
status: approved
risk_level: medium
stack: node
services_affected: [core]
dependencies: []
schema_required: false
schema_dependencies: []
links:
  roadmap: "Incidente recorrente 'a sessão inicia e trava' — 4 ocorrências em 13–14/10 (sessão fd1ed2da) e de novo em 19/10 (sessão 9ecf7b75)"
  design: "Chat em 2026-10-19; diagnóstico anterior registrado na memória 'claude-background-agents-die' (2026-10-14)"
  adr: "N/A"
approval_evidence: "usuário em 2026-10-19: 'verifique porque toda vez está travando e coloque na pipeline para corrigir isso'"
implementation_evidence: "Implementado no worktree jarvis-wt/fix-turn-stall em 2026-10-19, sem commit. Medições do CLI e validação no §8.1."
---

# Executable spec

## 0) Meta (TL;DR)

O adaptador do Claude tomava o PRIMEIRO `result` do stream como fim do turno e armava o prazo de 60 s
(`FINISHED_EXIT_GRACE_MS`, de 9c4222e) para a CLI sair. Mas um processo `claude -p` pode ter vários
turnos da CLI: no `--resume`, quando o turno anterior deixou shell/Monitor em segundo plano, a CLI
primeiro processa o aviso velho ("didn't finish before the previous session ended") como um
**mini-turno sem API**, emite um `result` vazio em ~40 ms, e só então roda o pedido do usuário. O
Jarvis derrubava esse pedido 60 s depois. Esta fatia:

1. faz o `result` só valer como fim enquanto a CLI não abre outro turno (o prazo é desarmado pela
   linha de turno novo e re-armado pelo `result` seguinte), preservando a proteção de 9c4222e;
2. corrige a telemetria: o custo do turno era o `total_cost_usd` **acumulado da sessão nativa** e o
   contexto podia cair na **soma do turno** (1.967.066 tokens);
3. fecha o nó de subagente em segundo plano com o terminal que o stream-json realmente publica;
4. atualiza a instrução ao modelo com o comportamento MEDIDO de cada tipo de tarefa em segundo plano.

## 1) Context and objective

### 1.1 Problem — evidência

**Hub log** `~/.jarvis/logs/jarvis-20261019.jsonl`, sessão Jarvis `9ecf7b75-c08f-4c83-8217-809123819968`
(nativa `6b84d10e-99b2-49a8-a655-b5c9555cd081`):

| Turno (fim) | ms | workMs | outputTokens | contextTokens | costUsd | replyChars |
|---|---|---|---|---|---|---|
| 14:25:01 | 233.483 | 232.547 | 18.090 | 98.786 | 1,47 | 7.837 |
| 14:52:12 | 1.328.294 | 1.327.386 | 64.992 | 200.808 | 4,99 | 5.645 |
| 15:17:36 | 1.292.450 | 1.291.315 | 20.776 | **1.967.066** | 15,67 | 1.058 |
| 15:57:43 | 2.224.000 | 2.222.928 | 16.471 | 308.279 | 36,97 | 7.189 |
| **17:32:04** | **60.939** | **35** | **0** | — | **36,97** | 299 |

**Transcript** da nativa, turno das 17:31 (linhas 875–892):

- 17:31:04.431 — `user` `<task-notification>` de 3 shells (`bko6jw51a`, `bngxoz2kh`, `btr8cug2t`) que
  "didn't finish before the previous session ended" (o turno das 15:57 terminou com eles registrados);
- 17:31:04.453 — a mensagem real do usuário ("…você pode seguir para as próximas fases…");
- 17:32:02.541 — texto real do modelo, **299 caracteres** ("Vou seguir para a F2…") + 1 `Bash`;
- 17:32:04.208 — `tool_result` do Bash; **nada depois**: processo morto em 17:32:04.7, exatamente
  ~60 s após o `result` do mini-turno (dispatch 17:31:03.709 + spawn 585 ms + work 35 ms);
- nenhum `cost-state` foi gravado para esse processo (a CLI só grava ao sair sozinha) — assinatura
  de processo derrubado;
- no `--resume` seguinte (17:40:36) a CLI injetou `"No response requested."` (`model: "<synthetic>"`)
  no lugar da resposta que nunca veio.

`replyChars: 299` é o texto do pedido real: o Jarvis entregou meio turno como `ok: true`.

**Sessão fd1ed2da (nativa a4fec5f4, 13–14/10)** — mesmas 4 ocorrências já diagnosticadas em 14/10;
reexaminadas agora com a marca `cost-state`: **todo** aviso "Background agent … didn't finish" é
precedido por um processo que terminou SEM `cost-state` (derrubado), nunca por uma saída normal.

### 1.2 Reprodução controlada (Claude Code 2.1.288, haiku, cwd temporário)

Harness que lança `claude -p --output-format stream-json --verbose --permission-mode bypassPermissions
--model haiku` com o prompt pelo stdin (igual ao Jarvis) e grava cada linha com o tempo relativo.

| # | Experimento | Resultado medido |
|---|---|---|
| 1a | Turno lança `Bash run_in_background: sleep 200` e termina | `result` em 7.210 ms; **5 s depois** `system/task_updated {status: killed}` + `system/task_notification {status: stopped}`; exit 0 em 12.443 ms |
| 1b | `--resume` da mesma sessão com "rode echo hi e responda PONG" | `system/task_notification` (aviso velho) → `system/init` → **`result` vazio** (`num_turns: 0`, `duration_ms: 45`, `usage` zerado, `origin.kind: "task-notification"`, `total_cost_usd: 0,0315` = acumulado anterior) → **segundo `system/init`** → turno real → `result` "PONG" (`total_cost_usd: 0,0419`, `result_index: 1`) |
| 2 | Turno lança `Agent run_in_background: true` (subagente roda `sleep 25`) e responde LAUNCHED | texto LAUNCHED em 7 s, mas **nenhum `result`** até o subagente terminar (14,5 s); `system/init` de um 2º turno para o aviso; os **dois** `result` saem juntos aos 17,1 s. O subagente NÃO morreu; o shell em segundo plano que ELE abriu foi morto 5 s após o fim |
| 3 | `--resume` da sessão do exp. 1 depois de outra sessão rodar no mesmo cwd | `total_cost_usd` 0,0419 → 0,0462: o custo é restaurado **por sessão** (do último `cost-state` do transcript) |
| A1 | `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, pedindo Bash e Agent com `run_in_background` | o parâmetro **some dos schemas** de Bash e Agent (o modelo recusou: "não têm `run_in_background`"); a lista de ferramentas não muda — **`Monitor` continua disponível** |
| A2 | mesma env, Agent comum | subagente **síncrono** (`task_started.is_backgrounded: false`, `tool_result` com o relatório) |

Custo total das medições: US$ 0,22 (estimativa da própria CLI: 0,0315 + 0,0104 + 0,0648 + 0,0043 +
0,0577 + 0,0532). Transcripts do cwd temporário apagados ao fim.

### 1.3 Causas-raiz

- **B (a do incidente)** — `ClaudeCodeAdapter.send` devolvia `true` no primeiro `result`; `runStream`
  armava 60 s; o mini-turno do aviso velho é um `result` legítimo que NÃO é o fim. Confirmado byte a
  byte (§1.1) e reproduzido (exp. 1b).
- **A (revisada)** — o diagnóstico de 14/10 dizia "agentes em segundo plano morrem no fim do turno do
  `-p`". Medido: **falso para saída normal** — a CLI espera subagentes (exp. 2). O que morre na saída
  normal são **shells em segundo plano e vigias do Monitor** (exp. 1a, e o 17:31 eram 3 shells). Os
  subagentes do 13–14/10 morreram porque o PROCESSO foi derrubado (pela própria causa B — o prazo de
  60 s armado pelo mini-turno pegava também os agentes lançados no turno real —, por quedas do Hub
  do INC-02, ou cancelamento). Ou seja: B é também a principal assassina de subagentes.
- **T1 — custo** — `total_cost_usd` é acumulado da sessão nativa; o adaptador gravava-o como custo do
  turno, e o ledger SOMA turnos: a sessão de US$ 36,97 aparecia como US$ 96,07 (2,6×).
- **T2 — contexto** — com mensagem sintética no fim (limite de sessão, `usage` zerado) o adaptador
  caía em `result.usage`, que é a SOMA das chamadas do turno → 1.967.066 tokens, ~10× a janela.
- **R — rastreamento** — o terminal de subagente em segundo plano chega como
  `system/task_notification` com `tool_use_id`; o adaptador só lia `<task-notification>` dentro de
  linhas `user` (que não apareceram em nenhum stream medido). O nó ficava "rodando" e virava `unknown`
  no fim do turno.

### 1.4 Objective (Definition of Value)

Um pedido enviado a uma sessão Claude que retoma depois de tarefas em segundo plano é executado até
o fim — e o custo/contexto mostrados para aquele turno são os daquele turno.

## 2) Dual-source planning

- **2.1 Roadmap** — correção de defeito recorrente (sintoma "Parou?", "trava", "não está rastreando").
- **2.2 Referências** — `runStream`/`FINISHED_EXIT_GRACE_MS`/`settleOnExit` (`packages/core/src/agents.ts`,
  de 9c4222e); `ClaudeCodeAdapter.send`; `UsageLedger` e a migração Codex já existente
  (`packages/core/src/usage-ledger.ts`); `BACKGROUND_JOB_STEERING` (`packages/core/src/background-jobs.ts`);
  memórias `claude-background-agents-die` e `codex-hung-turn-and-cancel-data-loss`.
- **2.3 Gap scan** — sem protocolo novo (o uso já trafega tipado runner→Hub), sem schema, sem
  dependência nova. Hub e runner herdam a correção do `core`; nenhuma mudança neles.
- **2.4 Delta** — contrato explícito de `runStream` (`StreamLineSignal`); contabilidade pura por processo
  (`ClaudeTurnAccount`); leitura assíncrona do `cost-state`; migração em memória do ledger.

## 3) Rules and invariants (SYSTEM LAWS)

- **Antes do anúncio de fim, nenhum relógio do Jarvis opina** (inalterado de 9c4222e).
- **Anúncio de fim é revogável**: uma linha de turno NOVO (`system/init`, `assistant`, `user`,
  `stream_event`) depois de um `result` desarma o prazo. O teardown pós-`result` medido
  (`system` `task_updated`/`task_notification`/`background_tasks_changed`) NÃO revoga.
- **O último anúncio manda**: depois do `result` final, CLI pendurada (neto no pipe, MCP que não
  fecha) continua derrubada em `FINISHED_EXIT_GRACE_MS` e a resposta já recebida é entregue.
- **Custo do turno nunca é o acumulado**: sem base conhecida, o custo do turno é *indisponível*
  (`costKind: "unavailable"`), nunca o total da sessão.
- **Contexto é UMA chamada de API** (a última real do thread principal), nunca a soma do turno.
- **Leitura de transcript é assíncrona e com teto** (INC-02/03: leitura síncrona grande derruba o Hub).
- **Migração de histórico não perde nada e é idempotente** (a `source` muda ao migrar).

## 4) Contracts

### 4.1 `runStream` (core, interno, agora exportado)

```ts
export type StreamLineSignal = boolean | "resumed" | void;
//  true      → o agente anunciou fim: arma FINISHED_EXIT_GRACE_MS
//  "resumed" → depois de um anúncio, começou outro turno: desarma o prazo
export function runStream(cmd, args, cwd, stdin, onLine: (line) => StreamLineSignal,
                          signal?, finishedGraceMs = FINISHED_EXIT_GRACE_MS): Promise<string>;
```

Saída não-zero só é tratada como sucesso se o ÚLTIMO estado for "anunciou fim" (`announcedEnd`), não
mais "existe um timer". Codex e adaptadores genéricos continuam devolvendo `true`/nada — sem mudança.

### 4.2 Contabilidade do Claude

```ts
export class ClaudeTurnAccount {      // pura; uma por processo
  line(o): StreamLineSignal;          // true no result; "resumed" na 1ª linha de turno novo depois dele
  text: string;                       // texto do thread principal; um parágrafo por turno da CLI
  contextTokens?: number;             // última chamada real; fallback result.usage.iterations[-1]
  outputTokens?: number;              // soma dos result.usage.output_tokens do processo
  restoredCost?: number;              // total do mini-turno sem API (num_turns 0) no início
  turnCost(restoredFromTranscript?): number | undefined;
}
export function claudeTurnCost(total, restored): number | undefined;   // total<restaurado → total
export function claudeRestoredCost(cwd, nativeId, projectsDir?): Promise<number | undefined>;
export function claudeRestoredCostFromFile(file, nativeId?, capBytes = 32 MiB, chunkBytes = 1 MiB);
export function parseClaudeSystemTaskNotification(o): { providerId; state; summary? } | undefined;
```

Base do custo, em ordem: (1) `restoredCost` do mini-turno (número da própria CLI); (2) último
`cost-state` do transcript, lido ANTES do spawn; (3) sessão nova → 0; (4) senão, desconhecido.

### 4.3 `usage` do turno Claude (o que o Hub recebe)

`costUsd` = custo do turno; `source` = `"Claude Code result.total_cost_usd − custo restaurado da
sessão (por turno)"` (ou a variante "indisponível"); one-shot = `"… (one-shot: sessão nova, o total é
o turno)"`. A `source` antiga `"Claude Code result.total_cost_usd"` deixa de ser gravada — é ela que
identifica, no ledger, os registros acumulados a migrar.

### 4.4 Instrução ao modelo (`BACKGROUND_JOB_STEERING`)

Passa a dizer o comportamento medido: shell em segundo plano e Monitor morrem no fim do turno (não
encerre com eles pendentes — espere ou `TaskStop`); subagentes não morrem (o turno espera); aviso
"didn't finish before the previous session ended" é resto do turno anterior; tarefa longa →
` ```jarvis-run `.

## 5) Data models

`~/.jarvis/session-cost.json` (ledger): sem campo novo. Migração em memória, persistida no próximo
registro (como a do Codex): registros `agent: "claude-code"` com a `source` antiga, em sessão de
conversa (id uuid ou `claude:<uuid>`), viram diferenças sucessivas por (runner, sessão); total que cai
= sessão nativa nova (fica o próprio total). Pseudo-sessões (`__summary__`, `voice`, `__debate__:…`)
ficam como estão — são one-shots independentes.

## 6) Flow

```
send(sessionId, text):
  prev = sessão nativa ligada
  restored = prev ? await claudeRestoredCost(cwd, prev) : 0        # assíncrono, antes do spawn
  account = new ClaudeTurnAccount()
  runStream(claude -p --resume prev …, onLine = l => {
      s = account.line(l)                       # true | "resumed" | nada
      eventos de atividade/subagente como antes
      system/task_started(is_backgrounded) → marca subagente assíncrono
      system/task_notification(tool_use_id deste processo) → estado terminal do subagente
      return s })
  usage = { costUsd: account.turnCost(restored), contextTokens: account.contextTokens, … }
  return { text: account.text, usage }
```

Casos de borda:

1. Vários avisos velhos → vários mini-turnos (`true`, `resumed`, `true`, `resumed`, …): o primeiro dá a base.
2. Só o mini-turno e a CLI sai → resolve pelo `exit`, sem prazo; texto vazio, custo 0.
3. `result` real e CLI pendurada / neto no pipe → derrubada em 60 s, resposta entregue (9c4222e).
4. Subagente em segundo plano: a CLI segura os `result` e solta todos no fim — o parágrafo fecha no `init`.
5. Mensagem sintética de limite de sessão no fim → contexto da última chamada real; aviso continua no texto.
6. `cost-state` muito para trás (processos derrubados não gravam) → varredura reversa até 32 MiB; além → custo indisponível.
7. cwd grafado diferente do diretório que a CLI criou → procura `<id>.jsonl` por projeto (assíncrono).
8. Erro num mini-turno e sucesso no turno real → vale o último `result`.
9. Aviso velho de processo anterior com `tool_use_id` desconhecido → ignorado pelo rastreamento.

## 7) Acceptance criteria (Gherkin)

```gherkin
Cenário: aviso velho no --resume não derruba o pedido real
  Dado uma sessão Claude cujo turno anterior terminou com shell em segundo plano
  Quando eu envio uma mensagem que leva mais de 60 s
  Então o turno roda até o fim
  E a resposta entregue é a do meu pedido
  E o uso do turno é o do pedido real, não o do mini-turno

Cenário: CLI pendurada depois do fim real continua sendo derrubada
  Dado um turno Claude que já emitiu o result final
  E um processo neto segurando o pipe
  Quando passam FINISHED_EXIT_GRACE_MS
  Então a árvore é derrubada e a resposta já recebida é entregue

Cenário: só o mini-turno e a CLI sai
  Dado um --resume em que a CLI processa só o aviso velho e sai
  Então o turno termina na hora, sem esperar prazo nenhum

Cenário: custo do turno é do turno
  Dado uma sessão nativa com custo acumulado de US$ 36,97
  Quando um turno custa US$ 0,25
  Então o turno registra US$ 0,25
  E o total da sessão no ledger é US$ 37,22, não a soma dos acumulados

Cenário: contexto não vira a soma do turno
  Dado um turno que termina com a mensagem sintética de limite de sessão
  Então o contexto registrado é o da última chamada real do modelo

Cenário: subagente em segundo plano que terminou não vira "desconhecido"
  Dado um turno que lança um subagente em segundo plano
  Quando o stream publica system/task_notification com status completed
  Então o nó do subagente fica "concluído"
```

### 7.1 Executable verification

```
node --import tsx --test packages/core/src/agents.test.ts packages/core/src/usage-ledger.test.ts packages/core/src/background-jobs.test.ts
npm run test:agents
npx tsc -p tsconfig.json
npm test
```

## 8) Test plan

- **Contabilidade (fixtures na forma exata dos streams medidos)**: (a) turno normal + teardown;
  (b) mini-turno + turno real; (c) só o mini-turno; (e) vários avisos; vários turnos com subagente;
  mensagem sintética de limite; "No response requested."; erro de turno anterior.
- **Processo real** (`runStream` com `node -e`, prazo de 300 ms): (b) turno real de 900 ms depois do
  mini-turno NÃO é derrubado; (c) só o mini-turno resolve pelo `exit`; (d) `result` real + CLI
  pendurada + neto herdando o stdout → derrubada no prazo, resposta entregue.
- **Custo**: `claudeTurnCost`; `claudeRestoredCostFromFile` com bloco de 64 B (costura entre blocos,
  último `cost-state`, sessão alheia ignorada, arquivo sem `cost-state` = 0, teto = indisponível,
  arquivo ausente); `claudeRestoredCost` pelo nome do diretório e pelo fallback.
- **Ledger**: os 5 turnos reais da sessão 9ecf7b75 migrados para US$ 36,97; total que cai; pseudo-sessão
  intocada; registro novo intocado; idempotência ao recarregar.
- **Rastreamento**: `parseClaudeSystemTaskNotification`.
- **Regressão**: `npm test` inteiro e `npm run test:agents`.

### 8.1 Validation evidence (2026-10-19)

- RED/GREEN do prazo com processo real: mesma sequência mini-turno → turno real de 900 ms, prazo de
  300 ms — com o sinal `"resumed"` suprimido (comportamento antigo) o processo morre em 611 ms e o
  `result` real não chega; com a correção termina em 966 ms com o `result` real.
- Replay dos streams REAIS gravados nas medições pela contabilidade nova: exp. 1a só `result=>true`
  (teardown não revoga); exp. 1b `result=>true, init=>resumed, result=>true`, texto "PONG", contexto
  32.326 (= última chamada 8+1.002+31.316), base 0,0315 → custo do turno 0,0104; exp. 2 texto dos dois
  turnos, saída 575+153.
- `claudeRestoredCost` na sessão real do incidente devolve 36,9696274 — exatamente o total do mini-turno
  que a CLI restaurou às 17:31.
- Suíte: ver relatório da entrega (tsc, `npm test`, `npm run test:agents`).

## 9) Observability

- A linha `[claude-cli] spawn->1a-linha … spawn->result … result->fechou …` passa a medir o ÚLTIMO
  `result`; `workMs` do `turn` idem.
- O `turn` do hub log passa a trazer o custo do TURNO; `source` do ledger distingue registros novos,
  migrados e indisponíveis.
- Sinal para detectar regressão: `turn` com `workMs` < 200 ms e `ms` ≈ 60.000 — era a assinatura exata
  do defeito (`grep '"workMs":3[0-9],'` no hub log).

## 10) Risk, rollback, feature flag

- **Risco 1 — prazo desarmado indevidamente**: uma linha `assistant`/`user` depois do `result` final
  seguida de CLI pendurada sem novo `result` voltaria a pendurar o turno. Mitigação: o teardown medido
  é só `system` (não revoga); qualquer `result` posterior re-arma. Aceito: é o mesmo estado de um turno
  em andamento antes de 9c4222e, e não foi observado em nenhum stream medido.
- **Risco 2 — custo indisponível** quando o `cost-state` está além de 32 MiB do fim (muitos processos
  derrubados seguidos) — o turno sai com tokens e sem custo, em vez de custo errado.
- **Risco 3 — migração heurística do ledger**: sessão nativa trocada sob o mesmo id do Jarvis em que o
  primeiro turno da nova custou MAIS que o acumulado da antiga seria sub-contada. Raro; erro limitado e
  muito menor que a inflação de 2,6× atual. O histórico de mensagens (`msg.usage`) dos turnos antigos
  NÃO é reescrito: `effectiveSessionUsage` usa o maior entre ledger e histórico, então sessões antigas
  podem continuar exibindo o valor inflado até saírem da janela de 30 dias.
- **Risco 4 — texto final**: turnos múltiplos da CLI agora viram parágrafos separados por linha em
  branco (antes eram colados sem separador).
- **Rollback**: reverter o commit. Entradas do ledger já migradas ficam como diferenças (corretas) —
  não há o que desfazer.
- **Feature flag**: nenhuma nova. Quem preferir eliminar tarefas em segundo plano pode exportar
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` no ambiente do Hub/runner — o CLI herda (ver §11.1).

### 10.1 Environment and bootstrap

Só vale depois de reiniciar o Hub e os runners (o adaptador roda dentro deles). Nenhuma ação manual.

## 11) Implementation plan

1. `runStream`: `StreamLineSignal`, `announcedEnd`, `finishedGraceMs` (teste). ✔
2. `ClaudeTurnAccount`, `claudeTurnCost`, `claudeRestoredCost*`, `parseClaudeSystemTaskNotification`. ✔
3. `ClaudeCodeAdapter.send` (stream e json) usando a contabilidade; one-shot com `source` própria. ✔
4. `UsageLedger`: migração dos acumulados antigos do Claude. ✔
5. `BACKGROUND_JOB_STEERING` com o comportamento medido. ✔
6. Testes do §8. ✔

### 11.1 Decisão sobre `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` (A)

| Alternativa | Consequência medida | Decisão |
|---|---|---|
| Ligar a env em todo turno do Jarvis | Some o `run_in_background` de Bash **e** Agent; subagente vira síncrono; **Monitor continua** (o vigia órfão continua possível). Perde o padrão "lança subagentes e segue trabalhando no mesmo turno" — que a CLI já suporta sem perda (exp. 2) | **Não** por padrão |
| Só instrução ao modelo + correção de B | Atinge a causa de morte real dos subagentes (B) e ensina o que de fato morre (shell/Monitor) e o que ignorar (aviso velho) | **Adotada** |
| Opt-in pelo ambiente | A env já é herdada pelo processo do CLI (o spawn não sobrescreve `env`) | Documentada, sem código |

### 11.2 Rastreamento — o que o Jarvis vê e o que não vê (diagnóstico)

| Sinal no stream-json | Subagente em 1º plano | Em 2º plano | Jarvis antes | Jarvis agora |
|---|---|---|---|---|
| `assistant`/`user` com `parent_tool_use_id` (ferramentas e texto do filho) | sim | sim | atividade do nó filho | igual |
| `system/task_started` (`is_backgrounded`, `tool_use_id`) | sim | sim | ignorado | marca assíncrono |
| `system/task_progress` (descrição, última ferramenta, tokens, duração) | sim | sim | ignorado | ignorado (ver follow-up) |
| `system/task_notification` (status terminal) | sim | sim | ignorado → nó `unknown` | fecha o nó |
| Nada durante uma ferramenta longa e silenciosa (Bash de minutos, espera de Monitor) | — | — | sem sinal | sem sinal |

O "não está rastreando" de 19/10 era a própria causa B: o Jarvis encerrou o turno às 17:32 com a CLI
morta. **Follow-up (não implementado aqui, mexe no Hub/UI onde outras frentes estão trabalhando)**:
mostrar `task_progress` como "aguardando subagente: <descrição> (N ferramentas, T s)" e um batimento
"ferramenta rodando há N min" para chamadas longas sem saída.

## 12) DoR / DoD

**DoR** — evidência byte a byte, reprodução controlada, causas separadas (B, A revisada, T1, T2, R),
contratos explícitos, 9 bordas, 6 cenários, verificação executável. Aprovado pelo usuário (frontmatter).

**DoD** — testes do §8 verdes; `tsc` limpo; `npm test` e `npm run test:agents` verdes; sem byte NUL
nos arquivos tocados; nenhum processo deixado para trás; efeito real só após o usuário reiniciar Hub e
runners (não feito por esta entrega); sem commit (aguarda autorização).
