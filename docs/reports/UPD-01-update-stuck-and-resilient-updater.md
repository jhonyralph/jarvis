# UPD-01 — "Atualizar todos" começou e não concluiu: causa, telemetria de falha e updater resiliente

> Report para trabalhar em outra máquina/sessão. Autocontido, com `arquivo:linha` verificados no
> código (não de memória). Contexto: o usuário mandou **atualizar todos os dispositivos** pela UI; a
> atualização **iniciou e não concluiu**, e a máquina **sumiu da visão** ("não vejo ela").

## 1. Como o update funciona hoje (fluxo real)

O update é **auto-aplicado pelo próprio processo que está sendo trocado**:

1. Hub enfileira um `PendingRunnerUpdate` por máquina — estados `queued | sent | awaiting_restart | blocked` (`apps/hub/src/index.ts:828`), persistido em `~/.jarvis/hub/…`/`runner-updates.json`.
2. Hub entrega `{t:"update"}` ao runner (`deliverPendingRunnerUpdate`, `apps/hub/src/index.ts:1310`) → estado `sent`.
3. **Runner (Windows)**: `handoffWindowsRunnerUpdate` (`apps/runner/src/index.ts:376`) grava um **lock** (`runner-update.lock`, `:383`) + um **script PowerShell destacado** (`:386`) e o dispara via `cmd /c start /b` (`:391`) — porque `spawn detached` de PS puro **morria em silêncio** no Windows (comentário `:387-390`, foi a causa do incidente anterior de ~30 min offline). O runner então responde `update_done` (`:212` / `:1281`) e agenda o próprio restart (`:1321-1322`).
4. **Script destacado** (`detachedWindowsRunnerUpdateScript`): para o runner (`:326`), `fetch` + `ff-merge`/`reset --hard` (force) (`:331-345`), `Verify-Or-Repair` (`npm ci` se deps mudaram) (`:346`), grava **receipt** (`:349`), grava **`update-result.json`** (`UPDATE_RESULT_FILE`, `apps/runner/src/index.ts:50`). Em erro → **rollback** ao commit anterior (`:351-364`). `finally` → **remove o lock** (`:369`) e **Start-Runner** (`Start-ScheduledTask`, fallback `npm start`, `:304-310`).
5. **Restart**: `restartService("runner")` (`packages/core/src/update.ts:259`) — no Windows é um PS destacado `Start-Sleep; Start-ScheduledTask` (`update.ts:272`), **single-shot, sem supervisão nem verificação**. `Start-ScheduledTask` com `IgnoreNew` é **no-op se a task já está "rodando"** (mesmo travada).
6. **Hub** recebe `update_done ok` → estado `awaiting_restart` (`apps/hub/src/index.ts:1331`). A recuperação depende da **reconexão** do runner no commit novo: `verifyOrDeliverRunnerUpdate` (`:1339`) apaga o pending se reconectou no alvo, senão **re-entrega**.

## 2. Causa raiz (estrutural)

**O processo que aplica o update é o mesmo que está sendo derrubado/reiniciado.** Quando o restart/handoff falha ou trava, a máquina sai do ar e cai em **dois buracos**:

- **Sem watchdog (era):** a recuperação depende de o runner **reconectar**. Se ele nunca volta, `verifyOrDeliverRunnerUpdate` nunca dispara, e o loop de auto-cura **pulava `awaiting_restart` e `blocked` de propósito** — o registro ficava preso **para sempre, sem sinal**. → você "não vê a máquina". **✅ Corrigido na Fase 1 (abaixo).**
- **Sem telemetria de falha:** `update_done` só chega se o runner estiver **vivo**. Se ele morre no meio (script destacado morto, lock órfão, `npm ci` pela metade), **nada é reportado** ao Hub. → silêncio total.

## 3. Modos de falha catalogados (com evidência)

| # | Modo | Evidência | Sintoma |
|---|---|---|---|
| 1 | Script destacado (.ps1) morre **antes da 1ª linha** (antes de auto-registrar o `$PID` real) | `apps/runner/src/index.ts:387-390` (comentário do incidente ~30 min) | Lock com pid provisório; launcher confuso; máquina offline |
| 2 | **Lock órfão** (`runner-update.lock` nunca removido) — script morre antes do `finally` | `:369` (remove só no finally), `:383`/`:321` (grava lock) | Launcher espera no lock; runner não sobe |
| 3 | **`Start-Runner` no-op/falha** — `Start-ScheduledTask` com IgnoreNew é no-op se a task está "rodando" (hung); fallback `npm start` | `packages/core/src/update.ts:272`; `apps/runner/src/index.ts:304-310` | Código novo nunca carrega; processo velho/hung permanece |
| 4 | **`npm ci` interrompido** → `node_modules` meio-instalado | `Verify-Or-Repair` `:346` | Processo reiniciado entra em **crash loop** |
| 5 | **`update_done` enviado ANTES do restart** → Hub marca `awaiting_restart`; se o restart falha, Hub não recebe mais nada | `:212`/`:1281` + restart `:1321-1322`; skip antigo em `index.ts` auto-cura | **Preso para sempre** (o buraco que a Fase 1 fecha) |
| 6 | **Rollback também falha** (git/npm no rollback) | `:351-364` | Máquina num meio-estado quebrado |
| 7 | **Repo sujo / commits locais** → `throw` → `blocked` | `:340`, `:343` | Precisa de ação do dono (force/limpar) |

## 4. As duas melhorias pedidas, mapeadas nos buracos

- **A — Report automático de falha para o servidor (§2, buraco 2):** um **phone-home fora-de-banda** do updater — o script destacado faz um `POST` ao Hub (ou grava um breadcrumb que o launcher envia) **em cada fase e no erro**, independente do WebSocket do runner (que já pode ter morrido). Assim, mesmo o modo 1/2/6 (runner morto) reporta "travei na fase X".
- **B — Serviço de update à parte, resiliente (§2 + buracos 1/2/3/4):** promover o handoff do Windows a um **`jarvis-updater` como unidade de SO própria** (scheduled task/serviço separado do runner), com **timeout por fase**, **heartbeat**, **rollback-para-o-último-bom** e **retry** — nunca deixa a máquina em crash loop nem dependente de um `.ps1` de uma vez só sem supervisão.

## 5. Plano faseado

### Fase 1 — Watchdog no Hub ✅ FEITO (commit `9850349`, `fix(hub): watchdog de atualização travada`)
- `apps/hub/src/update-watchdog.ts` (puro, testado): `updateStalled()` = `awaiting_restart` + **offline** + além da janela + ainda não sinalizado. Máquina **online** (mesmo em commit antigo) **não** é travada (auto-cura por re-entrega).
- Hub: carimba `awaitingSince` na transição; o loop de auto-cura marca `stalled` e **alerta o dono UMA vez** (push `notifyEvent` + `update_machine` + log estruturado `update_stalled`). Janela: `JARVIS_UPDATE_STALL_SEC` (default 300 s, piso 120 s). Flags persistem no `runner-updates.json` (sobrevivem a restart do Hub). **Ativa no próximo restart do Hub.**
- **Escopo:** só **detecção + alerta** (visibilidade). NÃO faz auto-retry cego numa máquina hung — isso é a Fase 3.

### Fase 2 — Phone-home do updater (melhoria A)
- No `detachedWindowsRunnerUpdateScript` (`apps/runner/src/index.ts`), a cada `Add-Progress`/fase e no `catch`, `POST` ao Hub (`/health` já é um endpoint; criar `/update-report` sem auth aceitando `{runnerId, requestId, phase, ok, log}`). Fecha o silêncio dos modos 1/2/6.
- Hub: endpoint recebe, atualiza o pending (`stalled`/`lastError`), alerta o dono com o **motivo real**, não só "não voltou".

### Fase 3 — `jarvis-updater` supervisionado (melhoria B)
- Unidade de SO própria (scheduled task/serviço), separada do runner. Fases com **timeout** e **heartbeat** no lock; **retry** com backoff; **rollback-para-o-último-bom-conhecido** garantido; só declara sucesso após o runner **reconectar** no alvo. Substitui o `restartService` single-shot (modo 3) e o `.ps1` sem supervisão (modos 1/2).

## 6. Coleta de evidências na máquina travada (para cravar o modo exato)

Rode **na máquina que travou** o script versionado `scripts/collect-update-evidence.ps1` e cole a saída aqui:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\collect-update-evidence.ps1
```

Ele junta, num único arquivo (`~/.jarvis/update-evidence.txt`) + stdout: `runner-update.log`, `update-result.json`, `update-receipt.json`, `runner-update.lock` (+ qualquer coisa em `~/.jarvis/updates/`), estado das scheduled tasks `JarvisRunner`/`JarvisHub`, processos node/tsx vivos, `git HEAD`/`status` no checkout do runner, e o rabo do `runner.log`. Com isso eu aponto **qual dos 7 modos** derrubou aquela máquina e o **conserto imediato** (destravar o lock, forçar o start, ou limpar o `node_modules`).

---

## 7. CAUSA-RAIZ ENCONTRADA (2026-08-18) — `$Args` como nome de parâmetro no updater destacado

O updater destacado do Windows **nunca executou um único comando git corretamente**. Não era rede,
não era tag, não era credencial, não era o `.git` ausente: era o **nome de um parâmetro**.

`Run-Step`, `Invoke-Git`, `Npm` e `Git-Out` (no script gerado por `apps/runner/src/index.ts`)
declaravam `[string[]]$Args`. **`$args` é variável AUTOMÁTICA do PowerShell** (os argumentos não
ligados a parâmetros): declarar um parâmetro com esse nome é sintaticamente válido, passa em qualquer
checagem de parse — e **o valor passado é descartado em silêncio**. Dentro da função, `$Args` chega
VAZIO. Portanto `& $Exe @Args` virava um **`git` pelado**, que imprime o uso e sai com **código 1**.

Reproduzido nas duas edições (não é peculiaridade do PS 5.1):

```
function Run-Step([string]$Exe, [string[]]$Args) { "ArgsCount=$($Args.Count)" }
function Invoke-Git([string[]]$Args) { Run-Step "git" $Args }
Invoke-Git @("fetch","--quiet","--tags","origin","main")
→ powershell.exe (5.1): ArgsCount=0
→ pwsh (7):             ArgsCount=0
```

Rodando o prelúdio ANTIGO com um `git fetch` real, a mensagem produzida é, byte a byte, a que o Hub
registrou ~50 vezes desde 2026-08-05: **`git saiu com código 1`**.

### Cadeia de evidência (como fechou)

1. `~/.jarvis/logs/jarvis-*.jsonl`, `ev:"update_report"`: em TODAS as tentativas desde
   2026-08-05T01:05Z, a sequência é `applying` → `error: "git saiu com código 1"` → `restarting`.
   Nunca `prepared`, nunca `rolled_back`.
2. Sem `rolled_back` ⇒ `$previous` estava vazio ⇒ a falha foi **antes** de `$previous = Git-Out
   rev-parse HEAD`, isto é, no **primeiro comando git do script**.
3. A mensagem **não tem os argumentos** — `Run-Step` fazia `throw ($Exe + " saiu com código " ...)`,
   sem `$cmd`; `Git-Out` incluía os args, e com args vazios produz `"git  saiu com código 1"`, que o
   Hub normaliza (`\s+`→` `) para exatamente a linha observada. Os dois caminhos apontam para args
   vazios.
4. Assimetria decisiva: o `git fetch` **in-process** (`updateCheck`, Node/`execFile`) FUNCIONAVA — é
   pré-requisito para o auto-update autônomo sequer disparar o handoff. Só o caminho PowerShell
   falhava ⇒ o problema estava no PowerShell, não no git/rede/repo.
5. `git` sem argumentos → `exit 1` (confirmado: `git version 2.55.0.windows.4`). Bate com o código e
   com a rapidez (~1s, sem I/O de rede).

**Efeito operacional observado (máquina `Luby`, id `29e046ba-…`, a mesma da "Notebook" dos incidentes
1/2):** ~30 min a ~90 min de intervalo, o runner perdia o Hub, disparava auto-update, **matava o
runner**, o updater morria no 1º git, o launcher ressuscitava no código velho, e o ciclo repetia —
**393 `runner online` / 344 `runner offline`** no `hub.log`. Do lado do dono: "é só atualizar para a
máquina ficar offline". Como o caminho in-process é recusado de propósito no Windows (protege o
`node_modules`), **não havia nenhuma via de atualização funcional nessa plataforma**.

### O que mudou

- `apps/runner/src/windows-updater-script.ts` (**novo módulo, extraído de index.ts para poder ter
  teste**): parâmetros renomeados para `$CmdArgs`; **guarda** que lança se a lista de argumentos vier
  vazia (um executável pelado nunca mais passa como "código 1"); erro passa a carregar **o comando e
  as últimas linhas da saída** (`Detail-Of`).
- `apps/runner/src/windows-updater-script.test.ts` (**novo**): proíbe nome de variável automática em
  parâmetro do script gerado, exige o splat, e — no Windows — **executa o prelúdio real no
  powershell.exe** e prova que os argumentos chegam. Parse-check não pegaria: a sintaxe era válida.
- `updatePreflight` + `resolveCommit` + `gitErrorDetail` (`packages/core/src/update.ts`) e o handoff
  em `apps/runner/src/index.ts`: o que pode ser verificado com o runner **VIVO** é verificado antes;
  recusa não custa mais indisponibilidade. `updateCheck` reporta o **stderr** do git (antes: "fetch
  falhou (rede?)" com 120 chars, que escondia justamente o motivo).
- `autonomousUpdateAttempt` + `~/.jarvis/update-attempts.json`: disjuntor do auto-update autônomo
  (2 tentativas por alvo). Update pedido pelo Hub/dono não passa pelo disjuntor.
- `apps/hub/src/index.ts` (`recordRunnerUpdateReport`): passa a **persistir o `logTail`**
  (`lastLogTail`) e a logá-lo. Antes, `error` eclipsava o rastro e o único registro que sobrava era
  a linha inútil — foi o que impediu o diagnóstico por semanas apesar da telemetria da Fase 2 existir.

### Ainda aberto

- **Fase 3** (updater como unidade de SO supervisionada) segue não feita. Com o preflight, a janela
  de risco diminuiu, mas a aplicação em si continua sendo um `.ps1` de uma vez só.
- **Bootstrap manual em máquinas que ficaram atrás:** o script é gerado pelo runner a partir do
  PRÓPRIO checkout, então uma máquina em código velho continua gerando o script quebrado — ela não
  consegue se auto-curar. É preciso UMA atualização manual (git fetch/reset + `npm ci` + reiniciar a
  task) por máquina; depois disso o caminho automático funciona.
