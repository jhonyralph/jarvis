# GPT-6 Astra — análise e plano de incorporação no Jarvis

**O que é:** `gpt-6-astra` é o modelo de fronteira da OpenAI anunciado em **2026-09-03** (público
para pagantes em 2026-09-04). Não é um produto/IDE como o Orca — é um **modelo** que entra no Jarvis
pelo caminho que já existe: o **catálogo do Codex CLI**. Por isso este doc não é um teardown de
features; é *"o que muda no Jarvis quando um modelo com janela de 1.05M, preço 2.5x e um degrau de
preço no meio da janela aparecer no picker"*.

**Método:** doc de API da OpenAI (`developers.openai.com`, primária) + Artificial Analysis +
Wikipedia + Latent Space + guias de integração do Codex CLI (secundárias) — cruzados com **leitura do
código do Jarvis** e um **probe real do CLI nesta máquina** (`codex debug models`). Cada afirmação
sobre o Astra tem confiança marcada; cada afirmação sobre o Jarvis tem `arquivo:linha`.

> A página oficial `openai.com/index/gpt-6-astra/` respondeu **403** ao fetch — nada aqui foi lido
> do anúncio primário. Onde a fonte é jornalística/terceira, está marcado **[2ª]**.

---

## 0. Ficha técnica

| Item | Valor | Conf. |
|---|---|---|
| Model id | `gpt-6-astra` (snapshot único, sem alias datado) | alta |
| Janela | **1.050.000** tokens · input máx **922k** · output máx **128k** | alta |
| Knowledge cutoff | 2026-04-30 | alta |
| Preço /1M | in **$10** · cached in **$1** · cache write **$12,50** · out **$50** | alta |
| Degrau de contexto | acima de **272k tokens de input**: **2x** input e cache, **1.5x** output | alta |
| Fast mode | **2x** a tarifa aplicável | alta |
| Batch / Flex | **-50%** | alta |
| `reasoning.effort` | `low · medium · high · xhigh · max` — `max` só na Responses API; `none` é **rejeitado** | alta |
| Params proibidos | `temperature`, `top_p`, `logprobs` (erro ou descarte silencioso) | média **[2ª]** |
| Endpoints | Chat Completions, Responses, Batch. **Sem** Realtime, Assistants, fine-tune, embeddings, áudio, imagem | alta |
| Tools hospedadas | web search, code interpreter, **computer use**, MCP, **hosted shell**, **apply patch**, image gen, file search, tool search, **skills** | alta |
| Rate limit (tier 5) | 15.000 RPM · 40M TPM | alta |
| Arquitetura | "recurrent depth" / looped transformers — **reduz a legibilidade da cadeia de raciocínio** | média **[2ª]** |
| Acesso | Enterprise: **desabilitado por padrão** (admin precisa liberar no console). Plus/Pro: rollout normal. Cyber ofensivo: recusado fora do programa Daybreak | média **[2ª]** |
| Codex CLI | suporte de primeira classe a partir de **v0.153.0/0.153.1** (0.153.2 corrige o rótulo do tier Fast) | média **[2ª]** |

## 1. Benchmarks — a leitura honesta (não é troca, é complemento)

Números do Artificial Analysis:

| Índice | Astra | Comparação |
|---|---|---|
| Intelligence Index | **61** | **empatado** com o próprio GPT-5.6 Sol; Fable 5.1 (max c/ fallback) = 66 |
| Coding Agent Index | **67** | ≈ Fable 5, ≈ Claude Opus 5. **Fable 5.1 dentro do Claude Code = 70 e lidera** |
| Eficiência de token | **70% mais eficiente** que Sol em coding (~1/3 dos tokens) | — |
| Custo em coding | **menos da metade** do Fable 5 para performance equivalente | — |
| Alucinação (AA-Omniscience, max effort) | **92% → 51%** com +4 pts de acurácia | — |
| Longo horizonte (AA-Briefcase) | **~+80 pontos** — projetos de semanas, milhares de arquivos | — |
| Computer use (OSWorld 2.0) | **72,6%**, ~47% menos tempo por tarefa que Sol | **[2ª]** |

Latent Space relata queimar **>20B tokens** em threads únicas mantendo coerência, e um agente
orquestrando **20–50 subagentes em paralelo**.

**Conclusão para o Jarvis:** não existe caso para trocar o default. O agente de referência do Jarvis
é o Claude Code (`complete` na matriz de paridade; o Codex é `limited` —
`packages/core/src/agents.ts:1307`) e o Fable 5.1 no Claude Code **lidera** o índice de coding. O que
o Astra traz de exclusivo e que o Jarvis não consegue hoje com nenhum modelo do catálogo:

1. **Janela 3,9x maior** que o teto atual de 272k (todo modelo do catálogo local está exatamente em 272k — probe abaixo).
2. **Longo horizonte** (AA-Briefcase +80) — o modo de uso do `jarvis_delegate` / Torneio.
3. **Custo-benefício em coding** — metade do preço do Fable 5 no mesmo patamar.
4. **Computer use SOTA** — capacidade que o Jarvis tem contrato para receber e nenhum adapter para produzir.

## 2. Onde o Astra encaixa no que o Jarvis já tem

Probe real desta máquina (2026-09-05):

```
codex-cli 0.146.0
gpt-5.6-sol       | list | 272000 | low/medium/high/xhigh/max/ultra
gpt-5.6-terra     | list | 272000 | low/medium/high/xhigh/max/ultra
gpt-5.6-luna      | list | 272000 | low/medium/high/xhigh/max
gpt-5.5           | list | 272000 | low/medium/high/xhigh
gpt-5.4-mini      | list | 272000 | low/medium/high/xhigh | upgrade->gpt-5.6-luna
gpt-5.3-codex-spark | list | 128000 | low/medium/high/xhigh
```

Ou seja: **o CLI aqui está 7 minors abaixo do mínimo (0.153.0) e o Astra não existe no catálogo.**

O que já funciona sozinho quando o CLI subir:

- **Catálogo dinâmico.** `CodexAdapter.capabilities()` roda `codex debug models` e mapeia
  slug/display_name/`supported_reasoning_levels`/`default_reasoning_level`/`context_window`
  (`packages/core/src/agents.ts:1255-1287`). O Astra aparece no picker **sem uma linha de código**.
- **Escada de esforço.** `xhigh` e `max` já estão em `EFFORT_LADDER`
  (`packages/core/src/agents.ts:324`) e em `EFFORT_RANK` (`packages/core/src/effort.ts:11-18`).
- **Churn de catálogo.** `resolveClosestModel` + `modelMigrations` remapeiam pins mortos por família
  (`packages/core/src/agents.ts:365`), então settings fixados em `gpt-5.6-sol` não quebram.
- **Janela por modelo.** `contextWindowTokens` vem da telemetria do rollout
  (`packages/core/src/agents.ts:1051`) e o medidor é percentual (`apps/hub/web/app.js:3043`) — não há
  272k hardcoded em lugar nenhum.

## 3. O que **quebra** hoje se o Astra entrar (defeitos, não features)

### D1 — O custo do Astra sai errado por ~5–8x (e indistinguível do Sol)

`codexUsage` estima com três coeficientes **globais por agente**, não por modelo:
`JARVIS_CODEX_PRICE_IN` default **1,25**, `_CACHED` = in/10 = **0,125**, `_OUT` default **10**
(`packages/core/src/agents.ts:1045-1047`). O Astra é **10 / 1 / 50**.

- input subestimado **8x**, output **5x**, cached **8x**.
- pior: a tarifa é **uma só para o agente**. Uma sessão em Sol e outra em Astra na mesma máquina são
  precificadas idênticas — a coluna "custo", o ordenar-por-custo do Histórico e o rollup do
  `UsageLedger` (`packages/core/src/usage-ledger.ts`) passam a mentir de forma silenciosa.
- **não dá para resolver via env**: o env é global; não existe um `JARVIS_CODEX_PRICE_IN` por modelo.
- **e o CLI não ajuda**: verifiquei o JSON de `codex debug models` — **não há campo de preço**.

**Cenário adversarial concreto:** sessão de refactor de 400k input + 60k output em Astra.
Real: `(400k×20 + 60k×75)/1e6` = **$12,50**. Jarvis reporta `(400k×1,25 + 60k×10)/1e6` = **$1,10**.
Erro de **11x**, para baixo, sem nenhum aviso.

> **Ambiguidade a confirmar antes de implementar:** a doc diz *"Prompts with more than 272K input
> tokens are priced at 2x input and cache rates and 1.5x output"*. Leitura literal = **o prompt
> inteiro** vira 2x/1.5x (é o cálculo acima, $12,50). A leitura alternativa — só o excedente acima de
> 272k é sobretaxado — daria `(272k×10 + 128k×20 + 60k×50)/1e6` = **$8,28**. Diferença de 51% no
> mesmo turno. **Não invente:** medir contra uma fatura real da API antes de fechar a tabela do item A.

### D2 — O degrau de 272k não é representável

O estimador é **linear**. O Astra é **piecewise**: acima de 272k de input, 2x input/cache e 1.5x
output. Como todo modelo do catálogo hoje **termina** em 272k, essa faixa nunca existiu no Jarvis —
é território novo introduzido exatamente por este modelo.

### D3 — Fast mode custa 2x e o Jarvis não cobra nada por isso

`codexFastModeArgs` injeta `--enable fast_mode -c service_tier="priority"`
(`packages/core/src/agents.ts:266`) e `usageWithFast` só carimba um booleano
(`packages/core/src/agents.ts:271`). Nenhum multiplicador entra no `costUsd`. Em Astra isso soma ao
D1: fast + >272k = **4x input** contra uma estimativa que já erra 8x.

### D4 — `service_tiers` do catálogo é descartado

`mapCatalog` (`packages/core/src/agents.ts:1257-1268`) lê só id/label/efforts/defaultEffort/context.
O JSON traz `service_tiers` e `additional_speed_tiers` **por modelo**; o descriptor declara
`fastMode: true` para o agente inteiro (`packages/core/src/agents.ts:1313`). Resultado: o Jarvis
oferece Fast em modelo que pode não listar o tier, e não sabe qual multiplicador aplicar.

### D5 — O roteador automático não tem noção de preço

`buildAutoRoutePrompt` entrega ao modelo roteador `id/label/efforts/defaultEffort/contextWindow`
(`apps/hub/src/autoRoute.ts:128-135`) e a única regra econômica é *"prefira o menor modelo/esforço"*
(`apps/hub/src/autoRoute.ts:147`). Com um modelo de 1.05M e 2.5x de preço no cardápio, **"menor" deixa
de ser definido**: menor janela? menor preço? O roteador tende a escolher Astra por causa da janela em
tarefas triviais — e no fluxo por voz ninguém está olhando o picker.

### D6 — Reserva de orçamento passa a rejeitar (ou a subestimar) fan-out

`ManagedExecutionBudget` com `unknownEstimate: "reject"` exige `task.reservation.costUsd`
(`packages/core/src/execution-policy.ts:152-156`). Essa reserva sai da mesma tabela errada do D1: num
Torneio com candidatos Astra, ou o orçamento é estourado sem o guard perceber, ou o `maxCostUsd`
calibrado para Sol derruba o plano inteiro.

### D7 — Bump do CLI é uma mudança arriscada, não uma atualização de rotina

0.146.0 → 0.153.x atravessa 7 minors. O próprio descriptor do Codex admite que *"todos os tipos de
evento ainda precisam de certificação real por versão do CLI"* (`packages/core/src/agents.ts:1307`),
e `codexItemToEvents` (`packages/core/src/agents.ts:1177`) é um mapeamento por string de tipo. Um
rename de item type derruba a UI ao vivo (ferramentas, diffs, subagentes) sem derrubar o turno.

## 4. Propostas de incorporação (ranqueadas)

### A. Tabela de preço **por modelo**, piecewise, com Fast — ✅ **implementado (2026-09-07)**

Resolve D1+D2+D3. Entregue em `packages/core/src/codex-pricing.ts` (+ `codex-pricing.test.ts`), com
`codexUsage` (`packages/core/src/agents.ts`) passando a receber `opts` para saber modelo e fast tier.
Detalhes do que ficou diferente da proposta original estão em **§7**. Substituir os três coeficientes globais por uma tabela versionada
`{ modelId → { in, cachedIn, cacheWrite, out, tierThresholdTokens, tierInMult, tierOutMult, fastMult } }`,
com fallback para os defaults atuais quando o modelo é desconhecido, e `codexUsage` recebendo o
`model` (já disponível via `telemetry.model` / `opts.model`).

Alternativas consideradas:

1. **Env por modelo** (`JARVIS_CODEX_PRICE_IN__GPT_6_ASTRA`) — zero código novo, mas explode
   combinatoriamente e não expressa o degrau nem o Fast. **Rejeitada.**
2. **Ler preço do CLI** — impossível: verificado, `codex debug models` não expõe preço. **Rejeitada.**
3. **Tabela JSON versionada no repo + env de override** — mantém `JARVIS_CODEX_PRICING_VERSION`
   honesto no campo `source`, é greppável e testável puro (o teste de preço já existe em
   `packages/core/src/agents.test.ts:268`). **Recomendada.**

Consequência ruim da recomendada: vira uma tabela para manter à mão, que envelhece calada. Mitigação:
o `source` já carrega a versão da tabela — expor essa string na UI de proveniência e cair para
`costKind: "unavailable"` (em vez de estimar) quando o modelo não estiver na tabela **e** o usuário
não tiver definido override. Melhor não estimar do que estimar 8x errado.

### B. Guarda de contexto ciente do degrau

Hoje a barra fica amarela em 60% e vermelha em 85% da janela (`apps/hub/web/app.js:3052`). Em Astra,
o degrau de custo cai em 272k = **26% da janela** — verde. Propor um `costCliffTokens` por modelo,
com marca própria na barra e no digest por voz ("passou do degrau; daqui pra frente é 2x").
Barato (um campo + um marcador) e é o único ponto em que o usuário vê o custo *antes* de gastar.

### C. Economia no roteador automático

Anexar ao catálogo do prompt (`apps/hub/src/autoRoute.ts:128`) preço relativo e `costCliffTokens`, e
trocar a regra do `:147` por algo definido sobre o espaço misto: *"janela grande só quando a tarefa
exigir; nunca use um modelo acima do degrau de preço para pergunta curta"*. Alto retorno porque o
Jarvis é voice-first e o roteador decide sozinho. Risco: prompt maior em toda decisão de turno —
medir o custo do próprio roteador antes de fechar.

### D. Propagar `service_tiers` do catálogo

`mapCatalog` passa a carregar `service_tiers`/`additional_speed_tiers`; `codexFastModeArgs` recusa um
tier que o modelo não lista (hoje o valor vem de env com default `priority`, sem validação); o
multiplicador de Fast alimenta o estimador do item A.

### E. Longo horizonte / fan-out — o que o Astra realmente oferece

`maxDepth: 3` e `maxTasks: 100` (`packages/core/src/execution-policy.ts:11-12`) e um executor com
concorrência limitada pela prontidão do DAG (**não encontrei knob explícito de `maxConcurrent` —
não verificado**). O contrato do Torneio (`packages/core/src/tournament.ts`) já aceita
`model`/`effort` por competidor, então **um Torneio Astra-vs-Fable já é possível hoje** e é a forma
mais barata de validar as alegações de benchmark no *seu* código, em vez de acreditar no índice.
Pré-requisito: item A, senão o placar de custo do Torneio é ficção.

### F. Computer use — explorar, não planejar

`BrowserSessionEvent` já existe em `packages/protocol/src/runner.ts:171` descrito como *"any future
Browser Runtime/MCP/Runner adapter"*: é a zona de pouso pronta para os 72,6% de OSWorld. Mas: o
computer-use do Astra é **tool hospedada da API**, e não há evidência de que o `codex exec` a exponha
headless. Não existe browser runtime no Jarvis hoje. Manter como investigação, com um probe primeiro.

### G. Chores de documentação

Novos envs precisam entrar em `scripts/environment-catalog.mjs:87-90` (é ele que gera
`docs/environment.md:80-83`), e a matriz `docs/agent-parity-matrix.md` precisa registrar a versão de
CLI certificada. Sem isso o `npm run check` e a própria fonte de verdade divergem.

## 5. O que **não** fazer

- **Não** promover Astra a default de agente/modelo: Fable 5.1 no Claude Code lidera o índice de
  coding (70 vs 67) e o Claude Code é o adapter `complete`; o Codex é `limited`.
- **Não** tratar o raciocínio mais opaco como bug: "recurrent depth" reduz a cadeia visível, então
  eventos `reasoning`→`thinking` (`packages/core/src/agents.ts:1186`) tendem a rarear. É esperado.
- **Não** atualizar o `codex` em todos os runners de uma vez (D7): um runner primeiro,
  `npm run agents:report`, conferir `codexItemToEvents` contra um rollout real, depois espalhar.
- **Não** construir fluxo de segurança ofensiva em cima do Astra: recusado fora do Daybreak.
- **Não** escrever no `~/.codex/config.toml` do usuário para ajustar `auto_compact_token_limit`. O
  Jarvis hoje só **lê** esse arquivo (`packages/core/src/agents.ts:1214`) e essa fronteira é boa.
  O certo é o `doctor` **avisar** quando o default for Astra e o limite de compactação estiver
  implícito abaixo do degrau.

## 6. Ordem sugerida

1. ~~**A** (preço por modelo, piecewise, Fast)~~ — ✅ feito, ver §7.
2. **D** (service tiers do catálogo) — pequeno e fecha o buraco do multiplicador de A.
3. **G** (envs no catálogo + matriz de paridade).
4. **D7 como operação**: subir o CLI em um runner e recertificar os event types.
5. **B** (degrau na barra) e **C** (roteador ciente de preço).
6. **E**: um Torneio Astra × Fable numa tarefa real do repo, com custo já confiável.
7. **F**: só probe.

**Critério de pronto do item A:** um teste que, dado um turno de 400k input / 60k output em
`gpt-6-astra`, produza o valor da faixa sobretaxada (**$12,50** pela leitura literal — confirmar a
ambiguidade do D1 antes) e o mesmo turno em `gpt-5.6-sol` produza o valor da tabela do Sol —
provando que a tarifa deixou de ser global por agente.

## 7. Item A — o que de fato ficou no código (2026-09-07)

Ordem de resolução em `estimateCodexCost`:

1. `JARVIS_CODEX_PRICE_*` definido → tarifa **plana**, sem multiplicadores. É o comportamento
   pré-tabela, preservado bit a bit: o teste de env que já existia passa **sem alteração**.
2. modelo presente na tabela → tarifa do modelo + sobretaxa de contexto longo + multiplicador Fast.
3. modelo ausente/desconhecido → **sem custo**, `costKind: "tokens_only"`. Tokens e janela continuam
   sendo reportados; só o número inventado desaparece.

Decisões que valem registrar:

- **Não inventei preço.** Só duas linhas são `published`: `gpt-6-astra` (doc de API, lida) e
  `gpt-5.6-sol` ($4/$20, Artificial Analysis — o `cachedIn` dele **não** tem fonte e ficou no
  ratio in/10 que o Jarvis sempre assumiu). Todas as outras linhas são `ballpark` com os
  coeficientes legados, **de propósito**: assim a introdução da tabela não mudou calada o custo de
  nenhum modelo que já estava em uso. O campo `confidence` aparece na string de proveniência.
- **A ambiguidade do D1 virou um switch, não um chute:** `JARVIS_CODEX_LONG_CONTEXT_MODE`, default
  `whole` (leitura literal — a que **nunca subestima**). `excess` só depois de medir contra fatura.
- **O limiar é testado contra o prompt real, não contra o delta cobrado.** Numa thread retomada o
  delta pode ser 10k sobre um prompt de 400k; quem leva sobretaxa é o prompt. Usa
  `last_token_usage.input_tokens` da telemetria do rollout, com fallback para o delta.
- **Bug lateral corrigido:** em `oneShot` o custo era calculado **antes** de o modelo ser carimbado
  (`{ ...codexUsage(o.usage), model: opts?.model }`), ou seja, a rota one-shot nunca teria acesso ao
  preço certo nem com tabela. Agora `opts` entra na própria função.

Cobertura: 6 testes novos em `codex-pricing.test.ts` (override, tiers do Astra, os dois modos do
degrau, limiar por prompt, integridade de todas as linhas da tabela) e 5 em `agents.test.ts`
(tokens_only, composição long+fast, mesmo turno precificado diferente por modelo, limiar via
telemetria). Suíte completa: **1278 passando, 0 falhas**.

Pendências conhecidas deste item:

- `docs/environment.md` e `.env.example` são **gerados** por `scripts/environment-catalog.mjs`. O
  catálogo (fonte de verdade) já tem `JARVIS_CODEX_LONG_CONTEXT_MODE` e as descrições novas, mas
  `--write` **se recusa a rodar** por causa de entradas ausentes **pré-existentes** e alheias a esta
  mudança (`TAG`, `WINDIR`, `USERDOMAIN`, `CI`, `JARVIS_CODEX_FAST_SERVICE_TIER`, entre outras). Não
  editei as tabelas geradas à mão porque o próprio arquivo proíbe. Fica para o item G.
- O descriptor do Codex continua declarando `cost: "estimated_api_equivalent"`
  (`packages/core/src/agents.ts:1320`) — é a classe de melhor caso do adapter, enquanto o registro
  por turno é quem manda. Se isso incomodar, é mudança de contrato e mexe na matriz de paridade.
- As linhas `ballpark` (terra, luna, 5.5, mini, spark, reserve) seguem sem fonte publicada.

## 8. Fontes

- API: <https://developers.openai.com/api/docs/models/gpt-6-astra> (primária, lida)
- Benchmarks: <https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra>
- Uso agêntico: <https://www.latent.space/p/astra>
- Contexto/arquitetura/safety: <https://en.wikipedia.org/wiki/GPT-6_Astra>
- Integração Codex CLI: <https://codex.danielvaughan.com/2026/09/03/gpt-6-astra-codex-cli-configuration-context-notes-safety/> · <https://codex.danielvaughan.com/2026/09/04/gpt-6-astra-codex-cli-integration-guide-critical-cyber-threshold/>
- Anúncio oficial <https://openai.com/index/gpt-6-astra/> — **não lido (HTTP 403)**
