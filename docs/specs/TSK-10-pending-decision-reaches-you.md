---
feature_id: TSK-10-pending-decision-reaches-you
tldr: "Pergunta pendente encontra o usuário fora da sessão: entrega, marcador, notificação e persistência."
title: "A decisão pendente te encontra"
owner: "Jonathan / Claude"
status: ready_for_review
risk_level: medium
stack: node
services_affected: [hub, web, mobile]
dependencies: []
schema_required: false
schema_dependencies: []
links:
  roadmap: "N/A — épico 'fontes de tarefa e fluxo'; fatia nova, priorizada antes de TSK-03"
  design: "Diagnóstico nesta sessão (2026-08-18): o frame de ask não sai do servidor para quem não está na sessão"
  adr: "N/A"
approval_evidence: "Usuário em 2026-08-18: 'Quando estou trabalhando em uma sessão x, e eu vou para outra… E ela termina de rodar e normalmente teriam action points para responder e decidir. Se não estiver na sessão as perguntas simplesmente não aparecem.' Prioridade decidida: antes da fatia C."
---

# Executable spec

## 0) Meta (TL;DR)

Quando um turno termina pedindo decisão, hoje a pergunta só existe para quem está
com aquela sessão aberta. Esta fatia faz a pergunta chegar: entrega para todos os
aparelhos autorizados, marcador próprio na lista, uma notificação que diz
"preciso de você" em vez de "concluída", e a pergunta sobrevive a restart do Hub.

## 1) Context and objective

### 1.1 Problem

Quatro falhas somadas, todas verificadas no código:

1. **Entrega.** `runAsking` publica com `broadcastOn` (`index.ts:4710`), que filtra
   por `subs.get(c) === sessionId` (`index.ts:910`). Quem está em outra sessão não
   recebe nada. O ramo do cliente que marcaria a conversa como não-lida
   (`app.js:4719`) é inalcançável na prática — receber o frame exige justamente
   estar na sessão.
2. **Notificação.** `runAsking` não chama `notifyEvent`. Pior: o turno terminou,
   então pode ter saído um push **"sessão concluída"** — o oposto de "estou parado
   esperando você".
3. **Sinalização.** Mesmo que chegasse, viraria o `unread` genérico, igual a
   qualquer resposta. Existe precedente de marcador dedicado (`⌖` das sugestões
   pessoais, `app.js:1881`) e de toast clicável (`app.js:3191`).
4. **Durabilidade.** `pendingAsk` é `Map` em memória (`index.ts:926`) — é ele que
   devolve o cartão ao reabrir a sessão (`index.ts:935`). Restart do Hub apaga a
   pergunta para sempre. E `saveAsk` grava em `localStorage`, então o cartão é por
   aparelho, não por pessoa.

### 1.2 Objective (Definition of Value)

Trabalho não fica parado sem o dono saber. De qualquer aparelho, com a sessão
aberta ou não, dá para perceber que existe decisão esperando e chegar nela em um
toque.

## 2) Dual-source planning

- **2.1 Roadmap** — fatia nova do épico, priorizada **antes de TSK-03** por decisão do dono (o estrago é trabalho parado sem aviso).
- **2.2 Referências** — `runAsking` (`index.ts:4701`), `broadcastOn` (`910`), `pendingAsk` (`926`, replay em `935`), `notifyEvent` (`index.ts:552`), `PushCenter.notifyEvent` + `normalizePrefs` (`push.ts:64,186`), cliente `m.t==='ask'` (`app.js:4719`), `saveAsk/getAsk` (`app.js:4999`), precedente de marcador (`app.js:1881`) e de toast (`app.js:3191`).
- **2.3 Gap scan** — `normalizePrefs` **filtra** a lista de tipos salvos (`["done","error","machine","personal"]`): um tipo novo nasce DESLIGADO em toda assinatura existente, e a feature entraria muda. Precisa de migração explícita. Sem schema de banco.
- **2.4 Delta** — frame novo e enxuto (`ask_pending`), tipo de push novo com migração, marcador/toast no cliente, e persistência do `pendingAsk`.

## 3) Rules and invariants (SYSTEM LAWS)

- **Nunca vazar o conteúdo.** O frame amplo carrega apenas `sessionId`, `runnerId`, contagem e horário — nunca o texto das perguntas. O conteúdo continua saindo só para quem abre a sessão, sob `canAccessSession`. O frame amplo também é filtrado por `canAccessSession`.
- **Uma notificação por turno.** O usuário recebe "concluída" OU "precisa de você", nunca as duas para o mesmo turno.
- **Responder em um aparelho apaga em todos.** `ask_cleared` passa a ter o mesmo alcance do `ask_pending`; marcador órfão é mentira visual.
- **A pergunta é da pessoa, não do aparelho.** Persistência no Hub, chaveada por identidade (`auth.identityOf`) — o cartão pendente no celular é o mesmo do desktop.
- **Sem LLM novo.** `detectDecisions` já roda hoje; esta fatia não acrescenta nenhuma chamada de modelo.
- **Observabilidade** — o estado pendente é consultável (frame de replay ao abrir a sessão) e sobrevive a restart.

## 4) Contracts (APIs / events / DB / tools)

- **4.1 WS**
  - Novo, Hub→cliente, para TODOS os clientes autorizados do runner:
    `{ t: "ask_pending", runnerId, sessionId, count: number, at: number }`.
  - `{ t: "ask", runnerId, sessionId, questions }` — inalterado, continua indo a quem tem a sessão inscrita (e no replay ao abrir).
  - `{ t: "ask_cleared", runnerId, sessionId }` — passa a ir para todos os clientes autorizados do runner (hoje é `broadcastOn`).
- **4.2 Notificação** — novo `NotifyKind: "ask"`.
  - Título: nome da sessão; corpo: "N decisão(ões) esperando você".
  - **Uma só por turno**: o push de conclusão espera o `asking` resolver, com teto de **20 s**; resolvido com perguntas → `ask`; sem perguntas ou estourou o teto → `done` como hoje.
  - **Migração**: assinatura existente que já aceita `done` passa a aceitar `ask` até o usuário mudar explicitamente. "Terminou e precisa de você" é um subconjunto de "terminou", então herdar o consentimento é fiel à escolha original.
- **4.3 Persistência** — `~/.jarvis/hub/pending-asks.json` (mesmo padrão de `queues.json`/`pending-inbound-turns.json`): `{ version: 1, asks: [{ runnerId, sessionId, principalId, questions, at }] }`. Escrita atômica; carregado no boot.
- **4.4 UI** — marcador próprio na linha da conversa (classe dedicada, não `unread`) e toast clicável que abre a sessão, espelhando `handlePersonalTurnSuggestions`.

## 5) Data models

```ts
interface PendingAsk {
  runnerId: string;
  sessionId: string;
  principalId: string;  // identidade (auth.identityOf), não login de aparelho
  questions: unknown[];
  at: number;
}
```

Cliente: `pendingAsks: Map<sessionKey, { count, at }>` em memória, alimentado por
`ask_pending` e pelo estado inicial da conexão. `saveAsk` no `localStorage` deixa
de ser a fonte de verdade e vira só cache de conveniência.

## 6) Flow (semi-executable pseudo-code)

```
fim do turno:
  asking = true; broadcast(asking)
  questions = detectDecisions(reply)            # já existe hoje
  if (questions.length):
     pendingAsks.upsert({runner, sid, principal, questions})   # persiste
     broadcastOn(sid, {t:"ask", questions})                    # quem está na sessão
     broadcastToRunner({t:"ask_pending", sid, count})          # todos os autorizados
     notifyOnce(kind="ask", título=sessão, corpo="N decisões esperando")
  else:
     notifyOnce(kind="done", ...)

ao responder (qualquer aparelho):
  pendingAsks.remove(runner, sid) → broadcastToRunner({t:"ask_cleared", sid})
```

Casos de borda:

1. Respondi no celular enquanto o desktop mostrava o marcador → `ask_cleared` amplo apaga nos dois.
2. Hub reinicia com pergunta pendente → recarrega do disco; o cartão volta ao abrir a sessão e o marcador reaparece na lista.
3. Sessão apagada com pergunta pendente → a entrada é removida junto (mesma invalidação que já limpa vínculo e memória).
4. Novo turno na mesma sessão antes de responder → a pergunta antiga é substituída (o `generation` de `runAsking` já invalida a anterior); o marcador reflete a atual.
5. `detectDecisions` demora mais que 20 s → sai `done`; se depois vierem perguntas, sai `ask` como segunda notificação (é o único caso de duas, e é o preço de não segurar o aviso indefinidamente).
6. Runner offline quando a resposta chega → o pendente continua no disco do Hub; nada se perde.
7. Aparelho de um `member` sem acesso à sessão → não recebe `ask_pending` nem notificação (filtrado por `canAccessSession`).
8. Conexão nova (reload/celular acordando) → recebe os pendentes visíveis no estado inicial, sem precisar de novo turno.

## 7) Acceptance criteria (Gherkin)

```gherkin
Cenário: a pergunta aparece estando eu em outra sessão
  Dado que estou com a sessão B aberta
  Quando a sessão A termina um turno com decisões pendentes
  Então a sessão A ganha marcador de "decisão esperando" na lista
  E recebo um toast que abre a sessão A em um toque

Cenário: a notificação diz que preciso decidir, não que terminou
  Dado que a tela está apagada
  Quando um turno termina com decisões pendentes
  Então chego a receber uma notificação do tipo "precisa de você"
  E não recebo também a notificação de "sessão concluída" pelo mesmo turno

Cenário: responder em um aparelho limpa o outro
  Dado o marcador visível no desktop e no celular
  Quando eu respondo a decisão no celular
  Então o marcador some do desktop sem eu tocar nele

Cenário: a pergunta sobrevive ao restart do Hub
  Dado um turno que terminou com decisões pendentes
  Quando o Hub é reiniciado
  E eu abro a sessão
  Então o cartão de decisão continua lá

Cenário: quem não pode ver a sessão não é avisado
  Dado um membro sem acesso à sessão A
  Quando a sessão A termina com decisões pendentes
  Então esse membro não recebe marcador nem notificação
```

### 7.1 Executable verification

`node --import tsx --test apps/hub/src/webClient.test.ts apps/hub/src/push.test.ts` e `npm run check`.

## 8) Test plan

- Hub (unit): `ask_pending` vai para cliente NÃO inscrito na sessão; não vai para quem falha `canAccessSession`; não carrega o texto das perguntas.
- Hub (unit): persistência — grava, recarrega no boot, remove ao responder e ao apagar a sessão.
- Push (unit): assinatura antiga com `done` herda `ask`; uma notificação por turno; teto de 20 s cai em `done`.
- Cliente (`webClient.test.ts`): `ask_pending` fora da sessão pinta o marcador dedicado (não o `unread` genérico) e dispara toast; `ask_cleared` apaga.
- Regressão: `npm run check` verde.

## 9) Observability

Sem log por evento. O estado pendente é inspecionável em `pending-asks.json` e
volta pelo replay ao abrir a sessão.

## 10) Risk, rollback, feature flag

- Risco: **notificação dupla** se `detectDecisions` estourar o teto — limitado ao caso lento e explicitado no critério.
- Risco: segurar o push de conclusão por até 20 s atrasa o aviso de quem não tinha pergunta nenhuma; mitigado pelo teto curto e por só segurar quando `asking` está de fato em andamento.
- Risco: migração de prefs herdar `ask` para quem só queria `done` — reversível pelo próprio usuário nas configurações, e o texto do item deixa claro o que é.
- Rollback: remover o fanout e o novo tipo de push; a persistência é aditiva e inofensiva.

### 10.1 Environment and bootstrap

Arquivo novo em `~/.jarvis/hub/`. Nenhuma variável de ambiente.

## 11) Implementation plan (BEFORE CODING)

1. Testes RED: fanout do `ask_pending`, persistência, herança de prefs, marcador/toast no cliente.
2. Hub: store persistido de pendências + fanout amplo de `ask_pending`/`ask_cleared`.
3. Hub: `notifyOnce` com espera limitada e o novo tipo `ask`.
4. Push: `normalizePrefs` com o tipo novo + migração de herança.
5. Cliente: marcador dedicado, toast clicável, consumo do estado inicial.
6. `npm run check` + validação manual no celular com a tela apagada.

## 12) DoR / DoD

**DoR** — contratos definidos, sem dependência bloqueante, sem schema, modelo definido, invariantes específicos, fluxo + 8 bordas, 5 cenários Gherkin, verificação executável, plano em passos. **Aguardando aprovação humana.**

**DoD** — CI verde, cenários cobertos, evidência de que a notificação chega com a tela apagada (teste manual em aparelho real), sem regressão.
