---
feature_id: TSK-02-local-task-scan-cache
tldr: "Varredura de tarefas locais passa a servir de cache, invalidado por mtime, com refresh explícito."
title: "Cache da varredura de tarefas locais"
owner: "Jonathan / Claude"
status: ready_for_review
risk_level: low
stack: node
services_affected: [core, hub, web]
dependencies: []
schema_required: false
schema_dependencies: []
links:
  roadmap: "N/A — épico 'fontes de tarefa e fluxo', discovery nesta sessão"
  design: "Discovery aprovado em 2026-08-18 (fatias A–I); esta é a fatia B"
  adr: "N/A"
approval_evidence: "Usuário em 2026-08-18: 'O sistema deve ser capaz de varrer e ter isso em cache… tem que ter opção de atualizar tudo e o cache tem que ter validade… não pode ser LLM essa parte para não consumir crédito'; validade decidida como 'Invalidação por mtime'."
---

# Executable spec

## 0) Meta (TL;DR)

`task_local_list` deixa de ler e parsear todos os `.md` a cada pedido. Passa a
comparar uma assinatura barata da pasta (nomes + mtime + tamanho) com a do último
resultado: se nada mudou, devolve o cache sem abrir arquivo nenhum. Existe
refresh explícito. Nenhum agente/LLM participa deste caminho.

## 1) Context and objective

### 1.1 Problem

`apps/hub/src/index.ts:6561` faz, a cada pedido: `readdirSync` → filtra `.md` →
`slice(0,100)` → `readFileSync` + `parseFeatureTask` de cada arquivo. A faixa do
fluxo e o seletor pedem essa lista com frequência; o custo é linear no número de
features e cai no event loop do Hub — o mesmo event loop que já foi diagnosticado
como gargalo quando bloqueado por I/O síncrono.

### 1.2 Objective (Definition of Value)

A lista aparece instantânea nas aberturas seguintes, reflete alterações em disco
sem intervenção, e o usuário pode forçar releitura quando quiser.

## 2) Dual-source planning

- **2.1 Roadmap** — fatia B do épico (~1d, sem dependências).
- **2.2 Referências** — handler `task_local_list` (`index.ts:6559–6577`); `parseFeatureTask` (`packages/core/src/task-link.ts:83`); binding de projeto com `featuresDir` (`task-link.ts:117,169`).
- **2.3 Gap scan** — a fonte remota (projeto em outra máquina) está ERRADA hoje: `store.get(sessionId)?.cwd || CWD` cai no `cwd` do Hub para sessão de runner. Isso é a fatia C (TSK-03); esta fatia **não** conserta nem esconde: a resposta continua trazendo `dir`, e a chave do cache inclui o runner para não misturar máquinas. Sem schema.
- **2.4 Delta** — módulo de cache próprio em `packages/core`, testável sem Hub, com `fs` injetável.

## 3) Rules and invariants (SYSTEM LAWS)

- **Zero LLM.** Nenhuma chamada a agente/adapter neste caminho. Teste garante 0 leituras de arquivo em cache quente, e o módulo não importa nada de agente.
- **Nunca servir dado de outro projeto/máquina.** Chave do cache = `runnerId` + caminho absoluto resolvido da pasta. Sessão remota nunca lê cache de sessão local.
- **Cache não pode mentir.** Se a assinatura não puder ser calculada (pasta some, erro de permissão), a entrada é descartada e o erro sobe — nunca devolve resultado velho como se fosse atual.
- **Contenção de caminho.** A checagem existente (`root` dentro do projeto) continua ANTES de qualquer leitura ou consulta ao cache.
- **Teto de memória.** No máximo 20 pastas em cache (LRU), além dos 100 arquivos já limitados por pasta.
- **Observabilidade.** A resposta declara `cached` e `scannedAt`; sem log por pedido (ruído).

## 4) Contracts (APIs / events / DB / tools)

- **4.1 WS**
  - Pedido: `{ t: "task_local_list", sessionId: string, refresh?: boolean }` (campo `refresh` novo, opcional, default `false`).
  - Resposta: `{ t: "task_local_list", sessionId, dir, files: Array<{key,title,description?}>, cached: boolean, scannedAt: number }` (`cached` e `scannedAt` novos).
  - Erros (mensagens exatas preservadas): `"pasta de features fora do projeto"`; demais viram `"Tarefas locais: <motivo>"`.
  - Autorização inalterada: `requireOwner(ws)`.
- **4.4 Módulo** — `packages/core/src/task-local-cache.ts`
  - `signatureOf(root, fsLike): string` — `readdir` + `stat` por arquivo (nome, `mtimeMs`, `size`), sem abrir conteúdo.
  - `LocalTaskCache.list(key, root, parse, fsLike, opts?): { files, cached, scannedAt }`.

## 5) Data models

```ts
interface LocalTaskCacheEntry {
  key: string;        // `${runnerId}` + separador + caminho absoluto da pasta
  signature: string;  // nomes + mtimeMs + size dos .md, ordenado
  files: LocalTaskFile[];
  scannedAt: number;
}
```

Cache em memória do processo do Hub (não persiste em disco): reiniciar o Hub
esvazia, e a primeira listagem paga o preço uma vez.

## 6) Flow (semi-executable pseudo-code)

```
list(sessionId, refresh):
  root = resolveDentroDoProjeto(cwd, featuresDir)     # inalterado, ANTES do cache
  sig  = signatureOf(root)                            # readdir + stat, sem ler conteúdo
  hit  = cache.get(key)
  if (!refresh && hit && hit.signature === sig): return { files: hit.files, cached: true, scannedAt: hit.scannedAt }
  files = readdir(root).filter(.md).sort().slice(0,100).map(read + parseFeatureTask)
  cache.set(key, { signature: sig, files, scannedAt: now })
  return { files, cached: false, scannedAt: now }
```

Casos de borda:

1. Pasta não existe → `files: []`, `cached: false`; não guarda entrada.
2. Arquivo editado sem mudar de tamanho → `mtimeMs` muda → invalida (por isso mtime entra na assinatura, não só nome+tamanho).
3. Arquivo renomeado mantendo mtime e size → o conjunto de nomes muda → invalida.
4. mtime de granularidade grosseira (FAT, drive de rede): dois writes no mesmo tick podem colidir → `refresh: true` é a saída documentada.
5. Arquivo ilegível → aquele arquivo é pulado (comportamento atual) e a assinatura continua válida.
6. 101+ arquivos → a assinatura considera os mesmos 100 do resultado, para não invalidar por arquivo que nunca entra na lista.
7. Duas sessões, mesma pasta, mesmo runner → compartilham a entrada (a chave é a pasta, não a sessão).

## 7) Acceptance criteria (Gherkin)

```gherkin
Cenário: segunda listagem não toca em disco
  Dado uma pasta de features já listada uma vez
  Quando eu peço a lista de novo sem alterar nada
  Então nenhum arquivo é aberto
  E a resposta vem com cached=true

Cenário: alteração em arquivo invalida
  Dado uma pasta já listada
  Quando eu altero o conteúdo de um arquivo
  Então a próxima listagem lê os arquivos de novo
  E a resposta reflete o novo título

Cenário: refresh explícito ignora o cache
  Dado uma pasta já listada e inalterada
  Quando eu peço a lista com refresh=true
  Então os arquivos são lidos de novo
  E a resposta vem com cached=false

Cenário: máquinas diferentes não compartilham cache
  Dado a mesma pasta listada para um runner A
  Quando eu peço a lista para um runner B
  Então o resultado de A não é reaproveitado

Cenário: pasta fora do projeto continua recusada
  Quando a pasta configurada aponta para fora do projeto
  Então o erro "pasta de features fora do projeto" é devolvido
  E nada é lido nem guardado
```

### 7.1 Executable verification

`node --import tsx --test packages/core/src/task-local-cache.test.ts` e a suíte
completa `npm run check`.

## 8) Test plan

- Unit (`task-local-cache.test.ts`) com `fs` injetado que **conta** chamadas: cache quente = 0 `readFile`; alteração de mtime = N `readFile`; `refresh` = N `readFile`; LRU descarta a 21ª pasta; assinatura estável entre chamadas sem mudança.
- Unit: chave por runner não colide.
- Integração leve: o handler devolve `cached`/`scannedAt` e mantém as mensagens de erro atuais.
- Regressão: `npm run check` verde.

## 9) Observability

`cached` e `scannedAt` na resposta (a UI pode mostrar "atualizado há X"). Sem log
por pedido; erro segue pelo caminho de erro atual.

## 10) Risk, rollback, feature flag

- Risco: mtime não confiável em drive de rede → mitigado por `refresh` explícito e por a assinatura combinar nome + mtime + size.
- Risco: o cache mascarar o bug da fatia C → mitigado pela chave com runner e por `dir` continuar na resposta.
- Rollback: remover a consulta ao cache (uma linha) volta ao comportamento atual.
- Sem feature flag.

### 10.1 Environment and bootstrap

Nada novo. Cache em memória, morre com o processo.

## 11) Implementation plan (BEFORE CODING)

1. `packages/core/src/task-local-cache.test.ts` — testes RED com `fs` contador.
2. `packages/core/src/task-local-cache.ts` — assinatura + LRU.
3. Exportar no índice do core.
4. `index.ts` — handler usa o cache, aceita `refresh`, responde `cached`/`scannedAt`.
5. `app.js` — botão de atualizar na lista local (manda `refresh: true`).
6. `npm run check`.

## 12) DoR / DoD

**DoR** — contratos exatos, sem dependências, sem schema, modelo definido, invariantes específicos, fluxo + 7 bordas, 5 cenários Gherkin, verificação executável, plano em passos. **Aguardando aprovação humana.**

**DoD** — CI verde, testes do plano cobertos, `cached`/`scannedAt` observáveis, evidência (comando + saída), sem regressão nos 1031 testes.
