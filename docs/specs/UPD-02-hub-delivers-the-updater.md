---
feature_id: UPD-02-hub-delivers-the-updater
tldr: "O Hub entrega o script de atualização — para que um defeito no updater deixe de ser incorrigível na máquina que o tem."
title: "O Hub entrega o updater (fim da armadilha do auto-conserto)"
owner: "Jonathan / Claude"
status: approved
risk_level: high
stack: node
services_affected: [hub, runner, protocol]
dependencies: []
schema_required: false
schema_dependencies: []
links:
  roadmap: "Diagnóstico do update travado da Luby, 2026-08-19"
  design: "Chat em 2026-08-19"
  adr: "N/A — mas §3 mexe no modelo de confiança e merece registro"
approval_evidence: "Usuário em 2026-08-19: 'os dois' (visibilidade + armadilha) e depois 'Aprovar e implementar'. Desvio implementado e justificado: o Hub entrega o CORPO do script, não o script inteiro — ele não conhece root/pid/token daquela máquina, e o cabeçalho segue local."
---

# Executable spec

## 0) Meta (TL;DR)

O script que atualiza uma máquina Windows é gerado **pela própria máquina**, a partir do código que
ela está rodando. Um defeito no updater é, por construção, incorrigível: o conserto viaja dentro do
update que aquela máquina não consegue executar. Esta fatia move a geração do script para o Hub.

## 1) Context and objective

### 1.1 Problem

Evidência do caso real (relatório em `~/.jarvis/hub/pending-runner-updates.json`, 19/08 22:43):

```
fromCommit  7bf2394   (v0.23.1, de 12/08)
lastPhase   restarting
lastError   git saiu com código 1
lastLogTail "'git help -a' … ERRO na preparação: git saiu com código 1"
```

O rastro é o texto de USO do git — o que ele imprime quando é chamado sem argumento nenhum. A causa
foi corrigida em `04dc655` (18/08): `& git @Args` com `$Args` automático do PowerShell resolvia para
vazio. Mas `git merge-base --is-ancestor 04dc655 7bf2394` responde **não**: a máquina está antes do
conserto, e o updater dela é o quebrado.

O ciclo observado pelo dono ("terminal abrindo e fechando várias vezes"): o script destacado sobe,
morre no primeiro `git`, sai; o supervisor ressuscita o runner em ~3s (por design); o Hub reenvia o
update; repete. Quatro tentativas registradas antes do diagnóstico.

**A propriedade que importa não é este bug — é a classe dele.** Qualquer defeito futuro no updater
tem a mesma forma: quem precisa do conserto é justamente quem não consegue recebê-lo.

### 1.2 Objective (Definition of Value)

Um defeito no updater passa a ser corrigível **remotamente**, sem alguém sentar na máquina.

## 2) Dual-source planning

- **2.1 Roadmap** — aberta pelo diagnóstico de 19/08; a visibilidade do relatório no painel foi junto,
  em commit próprio.
- **2.2 Referências** — `apps/runner/src/windows-updater-script.ts` (o gerador de hoje);
  `handoffWindowsRunnerUpdate` (`apps/runner/src/index.ts:400-440`); `/runner-update-report`
  (`apps/hub/src/index.ts:1017`); `deliverPendingRunnerUpdate` e o frame `update`.
- **2.3 Gap scan** — `RUNNER_PROTOCOL_VERSION` sobe 14 → 15. Máquina em 14 ignora o script recebido e
  usa o próprio (comportamento de hoje) — a fatia não conserta quem já está quebrado; conserta a
  classe daqui para frente.
- **2.4 Delta** — o gerador sai do runner e vira conteúdo entregue com o pedido de update.

## 3) O que muda no modelo de confiança (leia antes de aprovar)

Hoje, a máquina executa o script que ela mesma escreveu, a partir de código que veio do git. Depois
desta fatia, ela executa um script **enviado pelo Hub**.

O argumento a favor: **o Hub já manda a máquina rodar código arbitrário**. O frame `update` carrega um
`targetCommit`, e a máquina faz `git reset --hard <commit>` e executa o que estiver ali. Quem controla
o Hub já escolhe o código que roda em cada máquina; um script no lugar de um ponteiro para commit é a
mesma fronteira, com carga menor e mais auditável.

O argumento contra, honesto: hoje o que a máquina executa está **versionado e é o mesmo para todos**
(um commit no repositório, revisável depois). Um script pela rede é conteúdo efêmero — se o Hub for
comprometido, o payload não fica em lugar nenhum para ser auditado.

Mitigações desta fatia:

- **Script gravado antes de rodar**, com hash, em `~/.jarvis/updates/<requestId>.ps1`, e o hash vai no
  relatório. O que rodou fica auditável NA máquina.
- **O Hub também registra** o hash do que enviou. Divergência entre os dois é sinal, não detalhe.
- **A máquina recusa script vazio ou maior que o teto** e cai no gerador local (comportamento de hoje).
- **Nada de `Invoke-Expression`**: o conteúdo é gravado em arquivo e executado como arquivo, para o
  rastro existir mesmo se o processo morrer no meio.

## 4) Contracts

### 4.1 Protocolo do runner (14 → 15)

O frame `update` ganha campos opcionais:

```ts
| { t: "update"; requestId: string; targetCommit: string; force?: boolean;
    script?: string;        // conteúdo do updater, gerado pelo HUB
    scriptSha256?: string } // conferido pela máquina antes de gravar
```

O relatório (`/runner-update-report`) ganha `scriptSha256` — o hash do que a máquina de fato executou.

### 4.2 Onde o gerador passa a viver

`apps/runner/src/windows-updater-script.ts` move para `packages/core/src/windows-updater-script.ts`.
O Hub importa e gera; o runner mantém o import como **fallback** (máquina sem `script` no frame, ou
com hash divergente, usa o local — que é o comportamento de hoje).

## 5) Data models

Nenhum estado novo. `pendingRunnerUpdates[runnerId]` ganha `scriptSha256` (o que o Hub enviou).

## 6) Flow

```
# Hub, ao entregar um update para uma máquina Windows em protocolo >= 15
script = windowsUpdaterScript({ requestId, targetCommit, root: <root daquela máquina>, ... })
sha    = sha256(script)
grava sha no pending; envia { t:"update", requestId, targetCommit, script, scriptSha256: sha }

# Máquina
se protocolo < 15 ou script ausente        -> gera local (hoje)
se sha256(script) != scriptSha256          -> recusa, reporta "hash divergente", gera local
senão                                      -> grava ~/.jarvis/updates/<requestId>.ps1 e executa
reporta scriptSha256 em cada fase
```

Casos de borda:

1. Máquina em protocolo 14 → usa o gerador local; nada quebra, nada melhora.
2. Script chega truncado (WS fragmentado) → hash diverge → fallback local + relatório.
3. Máquina não-Windows → o campo é ignorado (o caminho de update dela é outro).
4. `root` da máquina difere do esperado → o script recebe o root como parâmetro, não o adivinha.
5. Hub antigo + máquina nova → sem `script` no frame, fallback local. Compatível nos dois sentidos.
6. Disco cheio ao gravar o `.ps1` → reporta e cai no gerador local.

## 7) Acceptance criteria (Gherkin)

```gherkin
Cenário: o Hub entrega o script e a máquina executa o que recebeu
  Dado uma máquina Windows em protocolo 15
  Quando o Hub pede a atualização
  Então o frame de update carrega script e hash
  E a máquina grava o arquivo e reporta o mesmo hash

Cenário: hash divergente não roda
  Dado um script cujo conteúdo não bate com o hash anunciado
  Quando a máquina recebe o pedido
  Então ela NÃO executa o recebido
  E reporta a divergência, caindo no gerador local

Cenário: máquina antiga segue como hoje
  Dado uma máquina em protocolo 14
  Quando o Hub pede a atualização
  Então ela usa o próprio gerador, sem erro

Cenário: o que rodou fica auditável na máquina
  Dado um update entregue pelo Hub
  Quando a máquina executa
  Então o arquivo do script fica em ~/.jarvis/updates/<requestId>.ps1
```

### 7.1 Executable verification

```
node --import tsx --test packages/core/src/windows-updater-script.test.ts
node --import tsx --test apps/hub/src/update-handshake.e2e.test.ts
npm run check
```

## 8) Test plan

- **Core**: o gerador continua produzindo script válido (os testes de hoje mudam de pasta); hash estável.
- **Hub**: o frame de update leva `script` + `scriptSha256` só para protocolo ≥ 15.
- **Máquina** (unidade): hash divergente → fallback + relatório; ausência de script → fallback.
- **E2E**: reusar `update-handshake.e2e.test.ts`, que já exercita o handshake de update.
- **Manual**: a Luby, depois de recuperada, recebendo um update entregue pelo Hub.

## 9) Observability

`scriptSha256` no relatório e no `pendingRunnerUpdates`; log do Hub registra o hash enviado. Uma
divergência vira alerta, não linha de log.

## 10) Risk, rollback, feature flag

- **Risco principal**: o modelo de confiança do §3. Mitigado por hash, arquivo auditável e fallback.
- **Rollback**: reverter o commit; máquinas voltam a gerar o script local (o caminho nunca deixa de
  existir, justamente para o rollback ser trivial).
- **Feature flag**: `JARVIS_UPDATER_FROM_HUB=0` no `runner.env` de uma máquina a faz ignorar o script
  recebido e usar o próprio.

### 10.1 Environment and bootstrap

Runner em 15 e Hub reiniciado. **Esta fatia não recupera a Luby**: ela está em 7bf2394, e nenhuma
mudança nossa alcança uma máquina que não consegue atualizar. A recuperação daquela máquina é manual,
uma vez (`git fetch && git reset --hard origin/main && npm ci` + reiniciar o runner).

## 11) Implementation plan (BEFORE CODING)

1. Mover o gerador para `packages/core`; testes acompanham (RED se algum import ficar para trás).
2. Protocolo: campos novos no frame `update`, `RUNNER_PROTOCOL_VERSION = 15`, `RUNNER_CAPABILITY_SINCE.updaterFromHub = 15`.
3. Hub: gerar + hash + enviar; guardar o hash no pending.
4. Runner: conferir hash, gravar em `~/.jarvis/updates/<requestId>.ps1`, executar; fallback nos casos do §6.
5. Relatório: incluir `scriptSha256` em cada fase.
6. Testes do §8; `npm run check`.
7. `docs/` — nota sobre o modelo de confiança (§3), que é a parte que alguém vai querer reler daqui a um ano.

## 12) DoR / DoD

**DoR** — contratos definidos, sem schema, sem dependência pendente, modelo de confiança explicitado,
fluxo com 6 bordas, 4 cenários Gherkin, plano em 7 passos. **Aguardando aprovação humana.**

**DoD** — suíte verde, cenários cobertos, evidência no commit, protocolo documentado, nota de confiança
escrita. **F11 (security) obrigatório**: esta fatia entrega código executável por rede, e é o tipo de
mudança que merece uma segunda leitura adversarial mesmo com o argumento do §3 de pé.
