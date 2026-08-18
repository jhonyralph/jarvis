---
feature_id: TSK-01-flow-bar-expand
tldr: "Clicar no chip 🧭 com fluxo ativo expande a faixa, em vez de abrir o seletor."
title: "Faixa do fluxo abre no clique"
owner: "Jonathan / Claude"
status: ready_for_review
risk_level: low
stack: node
services_affected: [web]
dependencies: []
schema_required: false
schema_dependencies: []
links:
  roadmap: "N/A — épico 'fontes de tarefa e fluxo', discovery nesta sessão"
  design: "Discovery aprovado em 2026-08-18 (fatias A–I); esta é a fatia A"
  adr: "N/A"
approval_evidence: "Usuário em 2026-08-18: 'O que deve acontecer ao clicar no fluxo? → Expandir a faixa'; e 'Não precisa abrir a listagem do fluxo. É só deixar habilitado e já abrir a barra do fluxo.'"
---

# Executable spec

## 0) Meta (TL;DR)

Com um fluxo ativo, o chip 🧭 do composer passa a abrir/fechar a faixa do fluxo.
Hoje ele abre um popup — uma camada a mais entre o usuário e a resposta "onde eu
estou". Sem fluxo ativo nada muda: o chip continua sendo a porta de entrada para
escolher um fluxo, porque desde `4d467ff` ele é a ÚNICA porta.

## 1) Context and objective

### 1.1 Problem

`E.wfStepBtn.onclick = () => togglePop(E.wfStepBtn, buildWfStepPop)`
(`apps/hub/web/app.js:5489`) sempre abre o seletor. Com fluxo ativo, o que o
usuário quer ver na maior parte das vezes — passos, trilha, tarefa, evidência —
já está na faixa (`renderWfRun`), atrás do botão "passos" (`.wf-tog`, linha
5152). São dois cliques em lugares diferentes para uma informação só.

### 1.2 Objective (Definition of Value)

Um clique no chip mostra o estado do fluxo. Nenhuma capacidade existente some.

## 2) Dual-source planning

- **2.1 Roadmap** — épico aprovado em 2026-08-18, fatia A ("Faixa do fluxo expande ao clicar", ~0,5d, sem dependências).
- **2.2 Referências** — `apps/hub/web/app.js` `renderWfRun` (5113+), `renderWfStep` (5205+), handler de cliques da faixa (5515–5517); teste de UI em `apps/hub/src/webClient.test.ts`.
- **2.3 Gap scan** — o seletor (`buildWfStepPop`) hospeda hoje a **gaveta de Tarefa** (`wfTaskOpen`) e o cofre de conexões (`wfConnManage`). Se o chip deixar de abri-lo com run ativo, essa gaveta fica inalcançável — regressão. Sem dependência pendente; sem schema (`schema_required: false`).
- **2.4 Delta** — além da troca de comportamento do chip, esta fatia cria na faixa uma porta para a gaveta de Tarefa, para não perder função.

## 3) Rules and invariants (SYSTEM LAWS)

- **Não criar run.** O clique nunca inicia acompanhamento. Iniciar continua exigindo escolha explícita de fluxo no seletor.
- **Porta de entrada preservada.** Sem run ativo, o clique abre o seletor. Nenhum estado pode deixar o usuário sem caminho para iniciar um fluxo.
- **Nenhuma função perdida.** Toda ação hoje alcançável pelo seletor com run ativo (trocar passo, armar tarefa, abrir cofre) continua alcançável em ≤2 cliques.
- **Sem tráfego novo.** Mudança 100% cliente; nenhuma mensagem WS nova, nenhum pedido ao Hub no clique.
- **Observabilidade** — não se aplica (sem backend nesta fatia).

## 4) Contracts (APIs / events / DB / tools)

- **4.1 API / WS** — nenhuma alteração de contrato.
- **4.2/4.3/4.4** — não se aplica.
- **4.5 Superfície de teste** — `webClient.test.ts` ganha `wfSetRun(run)` no harness (espelhando `wfSetDefs`) para simular run ativo sem WebSocket.

## 5) Data models

Estado só em memória do cliente, já existente:

- `wfRun: Run|null` — run em foco na sessão.
- `wfOpen: boolean` — faixa expandida.
- `wfHideSuggest: boolean` — faixa encolhida em alça.

Nenhum campo persistido. Recarregar a página volta ao padrão (`wfOpen=false`).

## 6) Flow (semi-executable pseudo-code)

```
onClickChip():
  if (!wfRun):            togglePop(seletor)            # inalterado
  else:
    if (wfHideSuggest):   wfHideSuggest = false; wfOpen = true
    else:                 wfOpen = !wfOpen
    renderWfRun()
```

Casos de borda:
1. Sem `wfDefs` → chip está escondido (`renderWfStep`), clique não existe.
2. Run ativo + faixa em alça (`wfHideSuggest`) → restaura E expande, num clique.
3. Run ativo + faixa já expandida → recolhe (o chip é alternância, não porta de mão única).
4. Run concluído no mesmo turno (`wfRun` vira null entre render e clique) → cai no ramo do seletor, sem erro.
5. Popup aberto por outro botão quando o chip é clicado → fecha o popup e aplica a alternância.
6. Sessão trocada com faixa expandida → `openSession` já zera `wfRun`; a faixa some sem estado órfão.

## 7) Acceptance criteria (Gherkin)

```gherkin
Cenário: clique com fluxo ativo expande a faixa
  Dado uma sessão com fluxo ativo e a faixa recolhida
  Quando eu clico no chip 🧭
  Então a faixa fica expandida
  E nenhum popup é aberto

Cenário: clique de novo recolhe
  Dado a faixa expandida por clique no chip
  Quando eu clico no chip 🧭
  Então a faixa volta a ficar recolhida

Cenário: sem fluxo ativo o chip continua sendo a porta de entrada
  Dado uma sessão sem fluxo ativo e com fluxos declarados
  Quando eu clico no chip 🧭
  Então o seletor de fluxos abre
  E nenhum run é criado

Cenário: faixa encolhida em alça volta inteira
  Dado um fluxo ativo com a faixa encolhida em alça
  Quando eu clico no chip 🧭
  Então a faixa aparece expandida num único clique

Cenário: a gaveta de Tarefa continua alcançável
  Dado uma sessão com fluxo ativo
  Quando eu abro a faixa e aciono a tarefa
  Então a gaveta de Tarefa abre com o mesmo conteúdo de antes
```

### 7.1 Executable verification

`node --import tsx --test apps/hub/src/webClient.test.ts` — verde, com os cenários acima cobertos.

## 8) Test plan

- Unit/UI (`webClient.test.ts`): clique com run → `wfRunActive()` true, faixa com classe `open`, `popOpen()` false; segundo clique → sem `open`; clique sem run → popup aberto e `wfRunActive()` continua false; alça → expande em um clique.
- Regressão: os 25 testes existentes seguem verdes.
- Manual: celular (largura estreita) — a faixa expandida não pode cobrir o composer.

## 9) Observability

Não aplicável (sem backend). Nenhum log novo.

## 10) Risk, rollback, feature flag

- Risco: perder a gaveta de Tarefa (mitigado pelo item 2.4 e por cenário de aceite próprio).
- Rollback: reverter o commit; a mudança é isolada em `app.js`/`webClient.test.ts`.
- Sem feature flag: comportamento de UI, reversível em um clique pelo próprio usuário.

### 10.1 Environment and bootstrap

Nenhuma variável nova, nenhum passo de bootstrap. Recarregar a página basta.

## 11) Implementation plan (BEFORE CODING)

1. `webClient.test.ts`: expor `wfSetRun` e escrever os 5 cenários (RED).
2. `app.js`: trocar o handler do chip pela alternância descrita em §6.
3. `app.js`: porta para a gaveta de Tarefa dentro da faixa (linha 🎯 quando há tarefa; botão "vincular tarefa" quando não há).
4. Rodar suíte de UI + typecheck.

## 12) DoR / DoD

**DoR** — contratos (não há mudança de contrato), sem dependências, sem schema, modelos definidos, invariantes específicos, fluxo + 6 bordas, 5 cenários Gherkin, verificação executável, plano em passos. **Aguardando aprovação humana.**

**DoD** — suíte verde, cenários cobertos, evidência (comando + saída) no PR/commit, sem TODO pendente.
