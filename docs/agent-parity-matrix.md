# Jarvis — matriz de funcionalidades, agentes e modelos

> Fonte de verdade para implementação e validação da paridade entre agentes.
> Snapshot inicial: 2026-07-19. Implementação revisada: 2026-07-20. Este documento descreve o estado observado no
> código; capacidades externas precisam ser reconfirmadas quando a versão do CLI
> mudar.

## 0. Estado da implementação em 2026-07-20

Esta rodada implementou a infraestrutura comum e os adapters possíveis sem
falsear certificação. “Implementado” não é sinônimo de “completo”: uma CLI
ausente nesta máquina continua `not_installed`, e um parser baseado apenas em
documentação continua `unverified` até um probe autenticado daquela versão.

| Área | Estado após a rodada | Evidência/gap residual |
|---|---|---|
| contrato/descriptor/eventos | implementado no pacote de protocolo | `AgentEvent` versiona o turno e `ExecutionEvent` versiona Trabalhos; ambos são contratos compartilhados por Hub/Runner/browser, enquanto `stream` fica apenas para rolling upgrade |
| lifecycle local/remoto | implementado | serviço único, anexos/activity/usage/histórico compartilhados |
| handshake Runner | implementado | protocolo v6; versão incompatível é recusada |
| trabalhos/subprocessos | implementado | journal fsync local/remoto, manifesto/replay, árvore global e deep-link; o turno ainda sem resposta também é reconstruído no chat após reabertura/reinício |
| fallback gerenciado | implementado, fail-closed | DAG e máquina fixa; Claude RO/writer, Codex RO e Aider writer possuem políticas conectadas; demais aguardam sandbox real certificado |
| Claude Code | referência `complete` | esforços são CLI-wide e marcados não verificados por modelo |
| Codex | `limited` | stream/native/resume/files/diff/modelos, janela efetiva e limite de conta implementados; comandos observados são classificados como Read/Grep/Glob/Bash e `patch_apply_end` é acompanhado durante o turno; ainda falta certificar todos os event types por versão |
| Gemini/Cursor/Copilot/OpenCode/Cline/Qwen | `unverified` ou `not_installed` | adapters, perfis e mappers com casos sintéticos representativos; faltam corpus versionado completo, binário+auth e probes reais nesta máquina |
| Continue/Kiro/Antigravity/Aider | `limited` ou `not_installed` | saída final apenas ou sessão/usage sem prova suficiente |
| modelos | implementado sem invenção silenciosa | catálogo e controle são separados: `runtime`, `configured`, `provider_dynamic`, `none` × `per_turn`, `configuration_only`, `provider_default`, `none` |
| usage/custo | implementado | ledger separa billed/estimado/assinatura/tokens/indisponível e particiona IDs iguais por máquina |
| comandos/skills/MCP/memória | implementado best-effort | homônimos coexistem; fonte não documentada não promove certificação |
| voz/rotinas | registry-aware | modelo validado; rotina escolhe máquina/agente/modelo/pasta |
| permissões | explícitas | `full-access` ou `provider-default`; nenhum deles é sandbox Jarvis |
| doctor/relatório | implementado | `npm run agents:report` não envia prompt nem gasta turno |
| Hub/Runner/WebSocket/histórico | implementado e coberto | E2E local+remoto com mock determinístico, workflow gerenciado, dois clientes para HITL/memória/refino de voz, colisão local/remota do mesmo sessionId e restart do Hub durante tool; CLIs autenticadas seguem residuais |

## 1. Objetivo

O Jarvis não deve apresentar um agente como “suportado” apenas porque consegue
executar um prompt e devolver a resposta final. Suporte completo significa que a
experiência inteira é coerente com o fluxo de referência do Claude Code:

1. envio confirmado imediatamente;
2. ciclo de vida visível enquanto o turno executa;
3. texto, ferramentas e alterações exibidos em ordem;
4. erro e cancelamento terminais, sem spinner órfão;
5. progresso preservado durante reconnect/reload;
6. histórico reconstruído com a mesma semântica do fluxo ao vivo;
7. sessão nativa retomável quando o provedor oferecer essa capacidade;
8. modelo, esforço, contexto e uso representados sem inventar dados;
9. comportamento equivalente na máquina do Hub e em runners remotos;
10. comandos, skills, MCP, anexos, filas e automações respeitando o agente da
    sessão.

“Paridade” é semântica, não uma alegação de que todos os CLIs publicam os mesmos
dados. Se um fornecedor não expõe raciocínio, o Jarvis mostra o estado real
“trabalhando” e os eventos disponíveis, mas nunca fabrica pensamentos ou ações.

## 2. Escopo e vocabulário

- **Agente**: aplicativo/CLI agente que executa o loop de modelo e ferramentas,
  por exemplo Claude Code, Codex CLI ou Cursor Agent.
- **Modelo**: modelo selecionável dentro do agente. Gemini usado dentro de
  OpenCode não cria um “adapter Gemini”; continua sendo uma configuração do
  adapter OpenCode.
- **Sessão gerenciada**: conversa criada pelo Jarvis e persistida em
  `~/.jarvis/hub/sessions.json` na máquina que executa o agente.
- **Sessão nativa**: conversa criada pelo CLI fora do Jarvis e importada a partir
  do armazenamento do próprio agente.
- **Suporte completo**: adapter passou por todos os requisitos obrigatórios e por
  um probe real na versão instalada.
- **Suporte limitado**: é possível executar o agente, mas uma capacidade
  obrigatória não existe ou não pôde ser verificada.
- **Não verificado**: implementação baseada em documentação/fixtures, ainda sem
  prova contra um binário real autenticado.
- **Não instalado**: CLI ausente naquela máquina; não deve ser selecionável para
  novos turnos.

O universo não é “todos os produtos de IA do mercado”. A regra é mais forte e
mais sustentável: **todo adapter que o Jarvis registra ou apresenta deve cumprir
este contrato**. Um novo agente entra como uma feature vertical independente e
não pode contornar a certificação.

## 3. Fontes da auditoria

### Código local

- `packages/core/src/agents.ts`: contrato real e adapters atuais.
- `packages/core/src/native.ts`: descoberta, parsing, histórico, arquivos e diff
  de sessões nativas.
- `packages/core/src/commands.ts`: comandos, skills, built-ins e MCP.
- `packages/core/src/store.ts`: sessões gerenciadas e mensagens persistidas.
- `packages/core/src/triggers.ts`: `!` e `#`.
- `packages/protocol/src/runner.ts`: protocolo real Hub ↔ Runner.
- `packages/protocol/src/adapters.ts` e `messages.ts`: sketches legados mantidos
  apenas como referência e removidos do barrel público; não são contrato.
- `apps/hub/src/index.ts` e `turn.ts`: roteamento, lifecycle, filas, custo,
  histórico, voz, busca e automações.
- `apps/runner/src/index.ts`: execução remota, persistência e reconexão.
- `apps/hub/web/app.js`: renderização ao vivo, histórico e controles.
- scripts de instalação/doctor e documentação operacional.

### Documentação oficial dos fornecedores

- Claude Code: comportamento observado no CLI instalado e API de modelos usada
  pelo adapter atual.
- Codex CLI: `codex debug models`, `codex exec --json` e rollouts locais.
- Gemini CLI: <https://geminicli.com/docs/cli/headless/>
- Migração Gemini → Antigravity:
  <https://developers.googleblog.com/en/an-important-update-transitioning-gemini-cli-to-antigravity-cli/>
- Antigravity CLI: <https://antigravity.google/docs/cli-overview>
- Cursor Agent: <https://docs.cursor.com/en/cli/reference/output-format>
- GitHub Copilot CLI:
  <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference>
- OpenCode: <https://dev.opencode.ai/docs/cli/>
- Cline: <https://docs.cline.bot/usage/cli-overview>
- Qwen Code:
  <https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/>
- Continue CLI: <https://docs.continue.dev/cli/headless-mode>
- Kiro CLI: <https://kiro.dev/docs/cli/headless/> e
  <https://kiro.dev/docs/cli/reference/cli-commands/>

## 4. Arquitetura observada

### 4.1 Turno local gerenciado

```text
web send
  → Hub runManagedTurn
    → persiste/broadcast da mensagem do usuário
    → agentTurn
      → agent_event:accepted/started
      → AgentAdapter.send(onEvent)
      → agent_event:text/tool/thinking/plan/usage
      → agent_event:completed/failed/cancelled
    → persiste resposta + activity
```

O `activity` persistido na mensagem do assistente guarda o lifecycle `AgentEvent`
do turno; é a razão pela qual um reload consegue reconstruir ferramentas e
subagentes que também passaram por esse stream. Eventos `ProviderExecutionEvent`
nativos pertencem ao journal de execução: um `node_created` do chat aberto cria um
card inline ao vivo ligado por `executionId`, mas esse card não é hoje projetado de
volta para `StoredMessage.activity`. Portanto, após reload, **Trabalhos** é a fonte
durável universal para filhos nativos; adapters que também publicam `AgentEvent`
continuam reconstruindo a representação dentro do bubble.

### 4.2 Turno remoto

```text
web → Hub → Runner → AgentAdapter
                ↓
web ← Hub ← stream/message do Runner
```

Hub e Runner chamam o mesmo `runManagedTurn` do core. O Runner só adapta
persistência, broadcast e transporte; anexos, mensagem do usuário, `activity`,
usage e terminal seguem o mesmo serviço. O protocolo v6 rejeita Runner antigo e
o cliente verifica `contractVersion` antes de permitir envio. O E2E
`parity.e2e.test.ts` prova o caminho WebSocket remoto e a reabertura do histórico.

### 4.3 Sessão nativa

O Jarvis varre JSONL de Claude e Codex, cria IDs prefixados (`claude:` e
`codex:`), lê o histórico e acompanha arquivos abertos com tail periódico. O
parser é específico dos formatos privados de cada CLI; portanto precisa de
fixtures por versão, telemetria de parse e degradação explícita.

### 4.4 Trabalhos e subprocessos — arquitetura híbrida 3

Cada turno cria uma raiz canônica e durável no proprietário da execução. Eventos são
`fsync` antes do broadcast, recebem `journalId + seq`, toleram redelivery e são reconciliados
por manifesto/replay quando um Runner volta. O Hub mantém mirrors, mas nunca inventa terminal
durante uma queda: execuções ativas ficam `offline`, `reconciling`, `orphaned` ou `unknown`
conforme a evidência disponível.

Há duas fontes de filhos sob a mesma árvore:

1. **Nativa:** o adapter normaliza spawn/activity/state/usage que o provedor realmente publica.
2. **Jarvis-managed:** `jarvis_delegate` envia um DAG para uma máquina explicitamente escolhida;
   o scheduler valida dependências, profundidade, concorrência, modelo/effort e orçamento. Tarefas
   internas usam sessões ocultas determinísticas. Leitura exige sandbox real; escrita exige worktree
   destacada e bloqueio de commit. Ausência dessas garantias é erro, nunca downgrade silencioso.

Raízes gerenciadas são namespaced pela máquina: `rootExecutionId` fornecido ao MCP é uma semente
estável, e o ID canônico é derivado de `machine + seed`. A mesma semente em Runners diferentes não
colide; idempotência de reentrega continua pertencendo ao `requestId`, e snapshot/terminal são
correlacionados por máquina e raiz.

O painel global **Trabalhos** mostra raízes e filhos de todas as sessões/máquinas autorizadas,
transcript publicado, tools, arquivos/diffs, `+/-`, métricas próprias/subárvore, estado de conexão,
truncamento e controles somente quando a capability os autoriza. Retenção padrão de 30 dias compacta
eventos detalhados apenas de raízes terminais, mantendo árvore, resumo e agregados. Excluir a sessão
remove seus journals. Sessões nativas abertas fora do Jarvis só entram no grafo quando o formato do
fornecedor permite vínculo verificável; não são retroativamente fabricadas.

## 5. Inventário completo após a implementação

Legenda: **sim** = garantido pela infraestrutura comum; **dependente** = o Jarvis
preserva a capacidade quando o CLI a publica; **limitado** = restrição declarada,
sem simular paridade.

| Área | Funcionalidade | Estado | Regra/evidência atual |
|---|---|---:|---|
| Sessão | Criar/listar/configurar/excluir sessão gerenciada | sim | Mesmo store e lifecycle para qualquer adapter local/remoto |
| Sessão | Título automático, draft e cache por sessão | sim | Agnóstico de fornecedor |
| Sessão | Agente/cwd travados após primeiro turno | sim | Evita troca silenciosa de contexto |
| Sessão | Modelo/esforço por turno | dependente | Picker usa catálogo da máquina dona; catálogo conhecido é validado antes do spawn |
| Envio | Eco imediato do usuário + `start` | sim | Provado no E2E Hub↔Runner |
| Envio | Idempotência, exclusão mútua e fila por sessão | sim | Local e remoto usam `turnId` e `runManagedTurn` |
| Envio | Cancelamento da árvore e restauração do input | sim | Wrapper comum; Windows usa `taskkill /T` |
| Progresso | Cronômetro/estado inicial/terminal único | sim | Contrato canônico + transportes local/remoto |
| Progresso | Texto incremental ou em bloco | dependente | `stream` declara `delta`, `block` ou `final_only`; nunca inventa delta |
| Progresso | Ferramentas, thinking, planos e subagentes | dependente | Normalizados somente quando publicados pelo fornecedor; aliases explícitos (`read_file`, `readToolCall`, `read`, etc.) convergem para o mesmo vocabulário sem renomear ferramentas desconhecidas |
| Progresso | Card inline de filho nativo/gerenciado | limitado | `node_created` da sessão aberta cria card ao vivo e deep-link para Trabalhos; após reload a árvore durável permanece em Trabalhos, enquanto o bubble só recompõe `AgentEvent` persistido |
| Progresso | Replay/reconciliação de trabalhos | sim | Journal durável paginado; o buffer separado do chat continua limitado a 600 eventos e ainda não sinaliza seu próprio truncamento dentro do bubble |
| Progresso | Árvore global de subprocessos | dependente | Nativa quando o fornecedor publica IDs; fallback gerenciado quando há sandbox/worktree certificado |
| Histórico | Persistir texto, activity, anexos e usage | sim | Igual no Hub e Runner; reabertura remota coberta por E2E |
| Histórico | Reconciliar filho órfão após restart | limitado | O store marca perda de binding como órfã sem inventar terminal; backfill depende da superfície nativa e reconnect/restart durante tool ainda não tem E2E dedicado |
| Histórico | Limite de payload ao browser | sim | Últimas `JARVIS_HISTORY_CAP`, padrão 120 |
| Nativo | Descoberta/listagem/busca/tail | limitado | Implementado e rico para Claude/Codex; demais só quando houver formato verificável |
| Nativo | Resume de sessão importada | limitado | Claude/Codex; UI recusa explicitamente outros adapters |
| Nativo | Arquivos/diff/modelo/esforço | dependente | Claude/Codex normalizados a partir do transcript disponível |
| Arquivos | `@`, viewer texto/imagem e anexos | sim | Conteúdo é processado na máquina/cwd da sessão |
| Arquivos | Anexos e chips no Runner remoto | sim | Builder e `StoredMessage` compartilhados |
| Arquivos | Diff inline e menu persistente | dependente | Normalizador comum calcula caminho/linhas/+/- quando o evento fornece diff ou argumentos de edit/write; activity persistida recompõe o menu em qualquer adapter; CLI final-only não publica alterações para observar |
| Compositor | `/` commands/prompts/skills/MCP por agente | dependente | Homônimos coexistem; fontes são mapeadas sem alegar conexão MCP ativa |
| Compositor | `!cmd` + histórico | sim | Executa na máquina/cwd da sessão; histórico é local ao dispositivo |
| Compositor | `#nota` | sim | Claude→`CLAUDE.md`, Gemini→`GEMINI.md`, demais→`AGENTS.md` |
| Compositor | Hints/sugestões de `/`, `@`, `#`, `!` | sim | Lista respeita agente e máquina selecionados |
| Modelos | Catálogo, origem, visibilidade, contexto e efforts | dependente | Claude/Codex dinâmicos; OpenCode lista; ausência fica automática/vazia e não inventada |
| Modelos | Catálogo por Runner | sim | Cada máquina publica descriptors completos; UI não reutiliza o catálogo do Hub |
| Modelos | Modelo/effort inválido | sim quando catalogado | Rejeição pré-spawn; catálogo vazio mantém somente default do provedor |
| Modelos | Roteamento automático | sim | One-shot configurado em “Roteamento automático, resumos e status”; sessão nova pode escolher IA na máquina selecionada, sessão iniciada preserva IA; modelo/effort são reavaliados por turno e validados contra o catálogo vivo |
| Uso | Tokens/contexto por turno | dependente | Ledger aceita usage tipado de qualquer adapter |
| Uso | Uso de plano/conta | dependente | Claude usa endpoint OAuth; Codex usa `token_count.rate_limits` do rollout; demais mostram explicitamente não reportado/não suportado |
| Custo | Ledger por sessão/agente/modelo | sim | Classes billed/estimado/assinatura/tokens/indisponível separadas |
| Custo | Guard-rail | sim | Atua conforme política tipada; estimativa não vira cobrança real |
| Custo | Runner remoto e histórico | sim | `done` agrega usage e reabertura recebe rollup da sessão |
| Busca | Literal e semântica | sim | Nativas dependem dos formatos importados; embedding local é opt-in |
| Busca | Resumo/digest one-shot | sim | Agente/modelo configuráveis e validados; roda no Hub |
| Automação | Rotinas locais/remotas | sim | Seleciona Runner, agente, modelo e cwd; UI usa catálogo do Runner escolhido |
| Automação | MCP Jarvis | sim | `jarvis_run_task` cria chat; `jarvis_delegate` aceita DAG correlacionado: `wait` devolve terminal + resumos após snapshot paginado e `background` devolve aceite/root ID para Trabalhos |
| Voz | STT/TTS/wake/speaker gate | sim | Continua Hub-only por desenho |
| Voz | Agente/modelo/effort por fala | sim | Catálogo é gerado do registry, sem regex fixa de dois fornecedores |
| Voz | Refino/escalonamento | sim | Opções são compatibilizadas com o agente de resumo configurado; estado/histórico/envio permanecem no Runner dono da sessão |
| Runner | Descoberta e estado de todos os adapters | sim | Publica executáveis e descriptors com motivo de indisponibilidade |
| Runner | Reconnect/outbox/replay | sim | Outbox limitada a 3000 eventos; E2E cobre caminho conectado |
| Runner | Handshake de protocolo/build/contrato | sim | Runner v6 incompatível é recusado; cliente bloqueia contrato desconhecido |
| Runner | Manifesto/replay de trabalhos | sim | Journal autoritativo fica na máquina; outbox preserva deltas, uso e aceite durante desconexão |
| Segurança | Auth, grants e audit | sim | Agnóstico de adapter |
| Segurança | Política de ferramentas | explícita | `full-access` histórico ou `provider-default`; nenhum é sandbox Jarvis |
| Notificação | Web/mobile push em done/error/offline | sim | Terminal comum local/remoto |
| Diagnóstico | Latência/erro por Runner/agente/modelo | sim | Rolling metrics em memória |
| Diagnóstico | Doctor/relatório/instaladores | sim | Todos os adapters registrados; relatório não gasta inferência |
| Diagnóstico | Saúde de formato nativo por versão | limitado | Parser defensivo existe; certificação automática por versão ainda não |
| Atualização/PWA | update, rollback, offline e cliente mobile | sim | Handshake reduz cliente/servidor híbridos |

## 6. Contrato canônico obrigatório do adapter

O contrato atual (`AgentAdapter` + descriptors + `ExecutionAdapterProfile`) declara
capacidades, versões, formatos e o tier E0–E5. Todo adapter novo deve preencher e
provar os seguintes grupos; ausência de prova reduz o tier, não cria um valor otimista.

### 6.1 Identidade e disponibilidade

| ID | Requisito | Obrigatório |
|---|---|---:|
| A-ID-01 | ID estável, label e ícone independentes do modelo | sim |
| A-ID-02 | Comando/binário e versão detectados sem gastar um turno | sim |
| A-ID-03 | Estado: não instalado, não autenticado, limitado, não verificado ou completo | sim |
| A-ID-04 | Motivo e ação de correção legíveis | sim |
| A-ID-05 | Capability snapshot inclui versão do CLI e timestamp | sim |

### 6.2 Execução e lifecycle

| ID | Requisito | Obrigatório |
|---|---|---:|
| A-RUN-01 | `accepted`, `started`, `progress`, `completed`, `failed`, `cancelled` | sim |
| A-RUN-02 | IDs de turno/evento e sequência monotônica | sim |
| A-RUN-03 | Um único evento terminal por turno | sim |
| A-RUN-04 | Cancelamento mata todo o processo e filhos | sim |
| A-RUN-05 | Erro preserva código, mensagem segura e retryability | sim |
| A-RUN-06 | Eventos desconhecidos são preservados/telemetrados, não descartados silenciosamente | sim |
| A-RUN-07 | Heartbeat representa apenas processo vivo, nunca ação inventada | sim |

### 6.3 Conteúdo do stream

| ID | Requisito | Regra |
|---|---|---|
| A-EVT-01 | Texto incremental ou bloco concluído | Declarar granularidade |
| A-EVT-02 | Ferramenta: start/update/result | Correlacionar por `callId` |
| A-EVT-03 | Nome, resumo, argumentos seguros, status e duração | Sem vazar segredo por padrão |
| A-EVT-04 | Read/Write/Edit/Patch com caminho e diff quando fornecido | Nunca inferir conteúdo inexistente |
| A-EVT-05 | Thinking/reasoning | Exibir apenas quando o CLI publicar |
| A-EVT-06 | Plano/todos/subagentes | Representação estruturada e aninhável |
| A-EVT-07 | Usage parcial/final | Identificar escopo e unidade |

### 6.4 Sessão e histórico

| ID | Requisito | Obrigatório |
|---|---|---:|
| A-SES-01 | Binding Jarvis ID ↔ native ID persistente | sim se houver sessão nativa |
| A-SES-02 | Resume exato por ID | sim se o CLI suportar |
| A-SES-03 | Histórico normalizado com texto, ferramentas, erros e usage | sim |
| A-SES-04 | Reconstrução após restart/crash | sim |
| A-SES-05 | Reload no meio do turno preserva o progresso já emitido | sim |
| A-SES-06 | Deleção separa conversa Jarvis e conversa nativa | sim |
| A-SES-07 | Formato nativo versionado, com fixture e alerta de drift | sim |

### 6.5 Integrações auxiliares

| ID | Requisito | Obrigatório |
|---|---|---:|
| A-AUX-01 | Anexos texto/imagem com declaração de modalidades | sim |
| A-AUX-02 | One-shot sem poluir lista de sessões | sim |
| A-AUX-03 | Commands/prompts/skills/MCP por escopo e por agente | sim |
| A-AUX-04 | `#` grava no arquivo de instruções correto do agente | sim |
| A-AUX-05 | `!` e `@` executam na máquina e cwd corretos | sim |
| A-AUX-06 | Funciona local e remoto ou declara explicitamente a restrição | sim |

## 7. Gaps transversais: resolução e risco residual

### P0 encontrados na auditoria — resolvidos nesta rodada

1. Contratos canônicos `AgentEvent` e `ExecutionEvent` em `@jarvis/protocol`, reexportados pelo core; Hub, Runner e browser consomem os mesmos envelopes versionados.
2. Lifecycle gerenciado compartilhado entre Hub e Runner.
3. Status `complete/limited/unverified/unauthenticated/not_installed` impede
   adapter final-only de se passar por completo.
4. Handshake Runner v6 e `contractVersion` do browser.
5. Histórico remoto preserva `activity`, anexos e usage.
6. Builder de anexos é executado na máquina remota.
7. Codex ganhou stream, binding/resume, transcript rico, arquivos/diff e usage.
8. Prefixo nativo é resolvido por adapter.
9. Ledger separa classes de custo e origem.
10. Política `full-access`/`provider-default` é capability e configuração visível.

### P1 encontrados — resolvidos ou degradados honestamente

1. Efforts/contexto carregam flags de verificação por modelo.
2. Codex respeita `config.toml`; automático do fornecedor continua uma melhoria
   possível quando profiles/routing puderem ser representados sem ambiguidade.
3. Skills Codex incluem `~/.agents/skills` e `.agents/skills`.
4. Commands/skills/MCP são identificados por agente; homônimos coexistem.
5. Built-ins curados permanecem best-effort e não promovem certificação.
6. Cada Runner publica versão, status, motivo, capabilities e modelos; a UI usa o
   catálogo da máquina dona da sessão.
7. Histórico remoto usa o mesmo `StoredMessage` rico.
8. Métricas distinguem Runner, agente e modelo.
9. Busca, voz, doctor, install, README, manifest e MCP conhecem o registry inteiro.
10. Rotinas selecionam Runner/agente/modelo/cwd e validam disponibilidade.
11. Cursor Agent é adapter programático, não tratado como “apenas IDE”.

### Riscos residuais de release

1. **Certificação externa:** Gemini, Cursor, Copilot, OpenCode, Cline, Qwen,
   Continue, Kiro, Antigravity e Aider não estão instalados/autenticados nesta
   máquina. Seus estados permanecem `unverified`, `limited` ou `not_installed`.
2. **Conformance por versão/modelo:** ainda não há canary persistente para cada
   tupla CLI+versão+modelo+effort+Runner.
3. **Browser real:** o E2E cobre WebSocket/Hub/Runner/store, mas não DOM,
   reconnect durante ferramenta, restart no meio do turno ou dois browsers.
4. **Inline após reload:** filhos nativos recebem card inline ao vivo via
   `node_created`, mas o bubble histórico só recompõe `AgentEvent`; a árvore e o
   transcript provider-neutral duráveis ficam em **Trabalhos**.
5. **Buffers:** o histórico inline do chat continua limitado a 600 eventos; o
   journal de Trabalhos é durável e sinaliza truncamento. A outbox remota tem cap
   de 3.000 frames e o journal autoritativo permite manifest/replay, mas ainda
   falta um teste de estresse que force overflow e reconciliação do gap.
6. **Formatos privados:** saúde de parser nativo ainda não é segmentada por
   fornecedor/versão.
7. **Catálogo na UI:** origem/idade/verificação existem no descriptor, mas ainda
   não são mostradas em detalhe no picker de modelo.

## 8. Snapshot atual dos adapters

O estado exato por máquina deve ser obtido com `npm run agents:report`. O relatório
separa `support` do adapter de turno e o perfil de execução E0–E5; `complete` no
primeiro não promove automaticamente a árvore de subagentes para `verified`. Na
observação local de 2026-07-20, Claude Code foi `complete` no turno, Codex
`limited` e os demais CLIs externos estavam `not_installed`; os perfis de execução
de Claude e Codex continuam E3/`partial` até seus canaries específicos.

| Adapter | Implementação | Stream | Sessão/retomada | Usage/custo | Estado máximo sem probe real |
|---|---|---|---|---|---|
| Claude Code | nativa e verificada localmente | delta + tools/thinking/subagentes | binding, import, tail, resume, reconcile | tokens + equivalente informado pelo CLI + plano | `complete` |
| Codex | nativa, parser e catálogo reais | blocos + reasoning/commands/patch/tools | binding, import, tail, resume, reconcile | delta de tokens + janela efetiva + estimativa configurável + limite semanal | `limited` até certificar todos os eventos por versão |
| Gemini CLI | adapter `stream-json` + mapper sintético | delta/tools | session id/resume previsto | tokens quando publicados | `unverified` / execução `fixture_only` |
| Cursor Agent | adapter `stream-json` + mapper sintético | delta/tools, sem thinking | session id/resume previsto | indisponível no schema auditado | `unverified` / execução `fixture_only` |
| GitHub Copilot CLI | adapter JSONL defensivo | delta/tools quando publicados | resume previsto | tipado conforme evento | `unverified` |
| OpenCode | `run --format json`, catálogo `models` | eventos JSON | session id | tokens/equivalente, nunca “billed” sem prova | `unverified` |
| Cline CLI | parser JSONL `ask/say` | snapshot/delta/reasoning | continuidade pelo histórico isolado do Jarvis; nenhum resume por ID público foi encontrado | indisponível até probe | `unverified` |
| Qwen Code | `stream-json` + partials | delta/tools/reasoning/plan | session id/resume | tokens quando publicados | `unverified` |
| Continue CLI | final JSON | final-only | histórico isolado do Jarvis; `--resume` global/latest não é usado para evitar cruzar sessões | indisponível | `limited` |
| Kiro CLI | headless final | final-only | histórico isolado do Jarvis; catálogo é informativo e modelo é configurado no CLI | indisponível | `limited` |
| Antigravity CLI | TUI `agy` detectável | desativado no Jarvis | não certificada | indisponível | `unavailable` / E0, não executável |
| Aider | mensagem headless | final-only | histórico limitado injetado pelo Jarvis; não usa restore global por cwd | indisponível | `limited` |
| Mock | fixture determinística test-only | thinking/tool/text | gerenciada | `tokens_only` | nunca produção |

No Codex, `block` significa blocos progressivos publicados ao vivo pelo `exec
--json`; não significa que o Jarvis espera o processo inteiro para só então mostrar
o resultado. Isso é diferente de delta token a token e também de `final_only`.

### 8.1 Contrato de subprocessos por adapter

Tiers: E0 sem lifecycle; E1 raiz/terminal; E2 filhos por snapshot/API; E3 filhos e atividade;
E4 controles por nó; E5 recuperação/steer/retry/input completos. A coluna “certificação” descreve
a evidência atual, não a ambição do adapter.

| Adapter | Tier/perfil atual | Comportamento nativo exigido | Fallback gerenciado seguro hoje | Validação pendente |
|---|---|---|---|---|
| Claude Code | E3 · partial · `native_stream` | `Task/Agent` vira filho; texto/tools por `parent_tool_use_id`; terminal ausente vira `unknown` | RO e writer via `safe-mode` + allowlist sem Bash/Task; writer usa worktree | canary de cancel/reconnect e todos os tipos de subagente na versão instalada |
| Codex | E3 · partial · `native_transcript` | rollouts filhos ligados ao pai, activity incremental e usage próprio | somente RO via `--sandbox read-only`; writer é recusado sem bloqueio real de commit | certificar spawn multi-agent headless, terminal e cancelamento por versão |
| Gemini | E3 · fixture_only · `native_stream` | IDs de tool/subagent e lifecycle do `stream-json` | recusado até sandbox granular ser provado | instalar, autenticar e capturar fixture/canary real |
| Cursor | E2 · fixture_only · `native_stream` | lifecycle local/cloud separado; sem thinking fabricado | recusado até sandbox granular ser provado | binário+auth, local vs cloud, reconnect |
| Copilot | E2 · fixture_only · `native_stream` | JSONL correlacionado; não anunciar controles SDK no adapter CLI | recusado até sandbox granular ser provado | binário+auth e schema real por versão |
| OpenCode | E3 · fixture_only · `native_stream` | preferir API/ACP quando estável; CLI anuncia só raiz cancelável | recusado até sandbox/bloqueio de commit ser provado | binário+auth, API/ACP e reconciliação |
| Cline | E3 · fixture_only · `native_stream` | distinguir Agent Teams de `use_subagents`; asks não viram sucesso | recusado até sandbox granular ser provado | binário+auth e dois modos de subagente |
| Qwen | E3 · fixture_only · `native_stream` | deduplicar partials/transcript e preservar plano/usage | recusado até sandbox granular ser provado | binário+auth, resume e reconnect |
| Continue | E1 · unverified · `jarvis_managed` | final-only, sem filhos nativos alegados | recusado até executor sandboxado ser conectado | binário+auth e superfície estruturada/API |
| Kiro | E2 · fixture_only · `native_api` | ACP deve substituir o final-only; `/spawn` isolado não prova delegação | recusado até sandbox granular ser provado | binário+auth e ACP real |
| Antigravity | E0 · unavailable · `none` | não raspar TUI nem inventar protocolo | recusado | contrato headless público verificável |
| Aider | E1 · unverified · `jarvis_managed` | final-only, sem filho nativo alegado | writer via worktree + `--no-auto-commits`; RO recusado | instalar, autenticar, testar Windows/Linux e confirmar limites de arquivo |

Regras comuns: máquina nunca muda; `rootExecutionId` é globalmente namespaced e `requestId` torna a
reentrega idempotente; cancelamento atua apenas na raiz exata; sessões internas não aparecem em chat/busca/digest; conteúdo sensível é
redigido no journal secundário; o transcript canônico oculto permanece local; controles não
certificados aparecem como indisponíveis em vez de botões que falham depois.

## 9. Snapshot atual dos modelos

Snapshot produzido por `capabilities()` em 2026-07-19. É diagnóstico, não uma
lista eterna; a UI deve continuar consumindo catálogo runtime.

### 9.1 Claude Code

| ID | Contexto informado | Esforços anunciados pelo Jarvis | Observação |
|---|---:|---|---|
| opus | 1.000.000 | low…max + ultracode | alias de família |
| sonnet | 1.000.000 | low…max + ultracode | alias de família |
| haiku | 200.000 | low…max + ultracode | alias de família |
| fable | 1.000.000 | low…max + ultracode | alias de família |
| claude-sonnet-5 | 1.000.000 | low…max + ultracode | concreto |
| claude-fable-5 | 1.000.000 | low…max + ultracode | concreto |
| claude-opus-4-8 | 1.000.000 | low…max + ultracode | concreto |
| claude-opus-4-7 | 1.000.000 | low…max + ultracode | concreto |
| claude-sonnet-4-6 | 1.000.000 | low…max + ultracode | concreto |
| claude-opus-4-6 | 1.000.000 | low…max + ultracode | concreto |
| claude-opus-4-5-20251101 | 200.000 | low…max + ultracode | concreto |
| claude-haiku-4-5-20251001 | 200.000 | low…max + ultracode | concreto |
| claude-sonnet-4-5-20250929 | 1.000.000 | low…max + ultracode | concreto |
| claude-opus-4-1-20250805 | 200.000 | low…max + ultracode | concreto |

**Crítica:** contexto vem da API, mas a escada de esforço é aplicada por família
sem validação. `ultracode` é pseudo-modo do Jarvis traduzido para `xhigh`, não um
effort nativo independente. O catálogo precisa distinguir alias, modelo concreto,
effort nativo e preset Jarvis.

### 9.2 Codex

| ID | Contexto | Efforts | Default atual |
|---|---:|---|---|
| gpt-5.6-sol | 272.000 | low, medium, high, xhigh, max, ultra | low |
| gpt-5.6-terra | 272.000 | low, medium, high, xhigh, max, ultra | medium |
| gpt-5.6-luna | 272.000 | low, medium, high, xhigh, max | medium |
| gpt-5.5 | 272.000 | low, medium, high, xhigh | medium |
| gpt-5.3-codex-spark | 128.000 | low, medium, high, xhigh | high |

Esses cinco são os modelos `visibility=list` observados no catálogo local. O
adapter respeita um `model = "..."` top-level conhecido no `config.toml`; caso
contrário escolhe o primeiro modelo e sempre envia `-m`. O comportamento precisa
ser revisto para permitir “automático/do CLI” sem substituir profiles/routing.

### 9.3 Aider e demais agentes

Gemini, Cursor, Cline, Qwen e Continue têm catálogo dinâmico/configurado pelo
fornecedor e não recebem uma lista hardcoded. Copilot consulta a ajuda account-aware;
OpenCode consulta `opencode models`; Kiro consulta `--list-models`, mas marca cada
modelo `selectable=false` porque o headless público não documenta seleção por turno.
Aider expõe somente o modelo configurado, quando detectável. Antigravity não possui
controle headless público. A UI distingue ausência de catálogo, catálogo informativo
e seleção por turno; nunca transforma uma lista vazia em modelos inventados.

## 10. Contrato obrigatório por modelo

Cada entrada de modelo deve ter:

| ID | Campo/comportamento |
|---|---|
| M-01 | `id` passado ao CLI e label apresentado ao usuário |
| M-02 | origem: CLI, API, config, cache ou fallback |
| M-03 | versão do CLI e instante da descoberta |
| M-04 | visibilidade: público, preview, oculto, deprecated ou indisponível |
| M-05 | contexto total e definição exata de tokens contabilizados |
| M-06 | efforts/variants realmente aceitos por aquele modelo |
| M-07 | default do fornecedor separado do override do Jarvis/usuário |
| M-08 | modalidades: texto, imagem, áudio e arquivos |
| M-09 | suporte a tools, reasoning, plan e subagentes |
| M-10 | unidade de usage e semântica de custo |
| M-11 | autenticação/plano que tornam o modelo elegível |
| M-12 | probe de argv: modelo+effort inválido falha antes do turno |
| M-13 | canary de primeira utilização por combinação CLI/modelo/effort |
| M-14 | fallback seguro quando um modelo some durante uma sessão |

Não é aceitável marcar todos os modelos de um agente com as mesmas capacidades
por conveniência. O estado de certificação é da tupla:

```text
adapter + versão do CLI + modelo + variant/effort + máquina
```

Testar todo modelo com turnos reais em toda inicialização seria caro. A estratégia
é:

1. validação estrutural do catálogo sem inferência;
2. fixtures oficiais por tipo de evento;
3. smoke real opt-in por modelo;
4. canary leve na primeira execução de uma tupla ainda não observada;
5. persistência do resultado da certificação e invalidação ao mudar a versão.

## 11. Comportamento necessário por agente

### 11.1 Claude Code — referência a preservar

Deve manter texto/tool/thinking/subagentes, usage, native binding, histórico rico,
tail, diff e resume. Precisa ainda:

- probe de disponibilidade sem criar uma inferência real;
- catálogo de efforts comprovado por modelo;
- separar preset `ultracode` de effort nativo;
- declarar permissões/sandbox em vez de sempre usar bypass;
- tornar comandos built-in versionados/verificáveis;
- compartilhar exatamente o mesmo lifecycle com Runner;
- etiquetar custo e uso com sua origem real.

### 11.2 Codex — prioridade imediata

Deve mapear todos os eventos do `exec --json`, preservando start/completed/result,
status, saída e IDs de ferramentas. Precisa ainda:

- comportamento observado em canário real de 2026-07-20: `Get-Content` apareceu
  como Read aos 5,5 s e `patch_apply_end` como Edit com caminho e `+1/-1` aos
  10,0 s, antes do terminal aos 15,2 s; regressões desse fluxo devem falhar a
  certificação da versão;

- persistir activity em sessão local e remota;
- reconstruir reasoning, custom tools, commands, patches e usage do rollout;
- continuar uma sessão nativa importada;
- produzir arquivos/diffs equivalentes;
- reconciliar resposta após restart;
- respeitar config/profile/auto model sem forçar sempre o primeiro catálogo;
- mapear skills oficiais globais e de projeto;
- manter MCP homônimo ao de outro agente;
- classificar custo como estimativa API-equivalente ou assinatura, nunca cobrado;
- validar eventos de plano/subagentes quando o CLI os emitir.

### 11.3 Aider

O adapter atual foi escrito sem binário local e não é suporte completo. Para ser
certificado precisa:

- sessão isolada por conversa, não histórico compartilhado apenas por cwd;
- progresso verificável; se o CLI não tiver formato estruturado, permanecer
  limitado e oculto do seletor padrão;
- catálogo/model provider e autenticação detectáveis;
- usage/custo com origem;
- histórico, resume, arquivos, cancelamento e erros normalizados;
- fixtures e probe real em Windows/Linux;
- rever efeitos de commits automáticos e permissões.

### 11.4 Gemini CLI

O formato `stream-json` documenta init, mensagens, tool use/result, erros e
resultado com usage. O adapter deve usar esse formato, importar sessões e mapear
commands/skills/MCP/GEMINI.md. Como contas individuais migraram para
Antigravity em 2026-06-18, a disponibilidade precisa explicar se o usuário está
em licença enterprise/API compatível ou deve usar Antigravity.

### 11.5 Antigravity CLI

Não há, nas fontes auditadas, um stream headless estruturado suficiente para a
paridade. O adapter só poderá ser completo após probe de um protocolo público
(headless JSON/ACP/API). Status line/TUI não substitui histórico de mensagens e
ferramentas. O executável oficial é `agy`; até existir esse protocolo ele é
detectável como limitado, mas deliberadamente não entra na lista executável.

### 11.6 Cursor Agent

`--print --output-format stream-json` fornece init, deltas, tool start/completed
e result. Thinking é explicitamente suprimido nesse modo. O adapter deve:

- concatenar deltas sem duplicar o result;
- correlacionar tool calls por `call_id`;
- mostrar processo vivo sem inventar thinking;
- bind/resume pelo session ID;
- descobrir modelos pelo CLI instalado;
- mapear regras/commands/MCP do Cursor quando existirem;
- certificar Windows e runner remoto.

### 11.7 GitHub Copilot CLI

O CLI documenta JSONL, streaming, model selection, resume/session ID, plugins,
skills e MCP. Antes da certificação é necessário capturar fixtures reais do
schema de eventos. O adapter deve preservar sessão, ferramentas, reasoning quando
publicado, usage, plugins e políticas de permissão.

### 11.8 OpenCode

`opencode run --format json` publica eventos brutos; há `--continue`, `--session`,
stats, export/import, servidor HTTP e ACP NDJSON. Preferência de integração:

1. ACP/API quando garantir sessão e eventos estáveis;
2. `run --format json` como fallback.

Deve preservar provider/model/variant, custos reportados pelo próprio OpenCode,
agentes/plugins/MCP, sessões e arquivos.

### 11.9 Cline

`--json` emite uma mensagem por linha com `ask`/`say`, texto, reasoning opcional
e flag partial. A referência pública auditada não documenta um argumento de resume
por ID; por isso o adapter injeta histórico Jarvis limitado e isolado. O adapter normaliza asks como estado
de interação/erro quando não puder haver input programático, e mapear provider,
modelo, thinking e permissões.

### 11.10 Qwen Code

Possui `stream-json`, partials, continue/resume e sessões JSONL por projeto. O
adapter deve aproveitar esses contratos, usage, tools, modelos, system prompts,
skills/MCP e limites de turno/tempo/tools. Budgets do CLI não substituem o budget
do Jarvis; ambos precisam aparecer com escopo claro.

### 11.11 Continue CLI

O headless documenta JSON estruturado e resume, mas a auditoria não comprovou um
stream ao vivo de ferramentas. Deve permanecer limitado até um probe real ou uma
integração via API/ACP que cumpra o contrato.

### 11.12 Kiro CLI

Há headless, seleção de esforço, listagem de modelos e resume por ID, mas não foi
documentada seleção de modelo por turno nem stream estruturado de ferramentas. Deve permanecer limitado até
existir um protocolo verificável; stdout final não é paridade.

### 11.13 Mock

Somente testes/desenvolvimento. Nunca deve aparecer como IA de produção nem
participar de custo, model picker ou doctor de autenticação.

## 12. Política de uso e custo

Todo valor precisa carregar um `kind`:

- `billed`: valor realmente informado como cobrado pelo fornecedor;
- `estimated_api_equivalent`: tokens × tabela configurada;
- `subscription_included`: consumo de cota/plano, sem dólar por turno;
- `tokens_only`: há usage, mas nenhum preço confiável;
- `unavailable`: fornecedor não publicou usage.

O painel pode somar somente valores do mesmo tipo ou mostrar subtotais separados.
Uma estimativa jamais deve bloquear `JARVIS_SESSION_COST_CAP` como se fosse
cobrança real sem uma política explícita do usuário. O ledger deve registrar
agente, modelo, effort, máquina, turno, origem e versão da tabela.

## 13. Política de commands, skills, MCP e memória

1. Itens são identificados por `(agent, scope, kind, name)`, não apenas `name`.
2. Homônimos de agentes diferentes coexistem.
3. Project > user > builtin somente dentro do mesmo agente.
4. Cada adapter declara suas fontes globais e de projeto.
5. A UI consulta a máquina dona da sessão.
6. Expansion só pode usar item pertencente ao agente selecionado.
7. `#` usa o arquivo de instruções declarado pelo adapter; se não houver, a UI
   explica e não grava em CLAUDE.md por fallback silencioso.
8. MCP é apresentado com origem/transporte/status; listar configuração não prova
   que o servidor conectou.
9. Marketplace/plugins entram apenas quando o CLI fornece mapa confiável de itens
   habilitados.

## 14. Paridade local × runner remoto

Para cada adapter, os mesmos cenários devem passar nos dois caminhos:

- envio e eco de usuário;
- anexos texto/imagem;
- tools/text/thinking/plan;
- activity persistida;
- modelo/esforço;
- usage/custo;
- cancelamento;
- fila;
- reconnect durante ferramenta;
- reload durante turno;
- history e native resume;
- arquivos/diff;
- `/`, `@`, `#`, `!`;
- done/error e push.

O caminho remoto não deve ter um lifecycle próprio. Runner deve consumir o mesmo
serviço de turno e o mesmo normalizador usado pelo Hub, alterando apenas o
transporte.

## 15. Matriz obrigatória de validação

### 15.1 Fixtures por adapter

O contrato-alvo exige, para cada adapter, fixtures versionadas de:

1. init/session ID;
2. texto parcial e final;
3. tool started/completed com sucesso;
4. tool failed;
5. read/write/edit/patch;
6. reasoning/thinking quando existente;
7. plano/todos/subagente quando existente;
8. usage final;
9. erro fatal antes e depois do primeiro evento;
10. cancelamento;
11. evento desconhecido de versão futura;
12. transcript nativo completo e truncado/malformado.

A implementação atual registra os 12 perfis e os 12 pontos de entrada de mapper,
mas os testes usam objetos sintéticos inline e não cobrem todos os itens acima em
todos os providers. Continue, Antigravity e Aider deliberadamente retornam zero
evento nativo; isso prova a degradação fail-closed, não uma fixture de lifecycle.
Os casos específicos atuais cobrem Claude, Codex, Gemini, Cursor, Copilot,
OpenCode, Cline, Qwen e Kiro em profundidades diferentes. A suíte comum,
independente de provider, ainda precisa cobrir também:

1. perfil de execução E0–E5, origem e certificação para os 12 IDs;
2. delegação gerenciada permitida e recusada pela matriz de segurança;
3. DAG válido, dependência ausente e ciclo;
4. sessão interna oculta no chat, busca e digest;
5. redelivery do mesmo `requestId` sem execução duplicada;
6. retenção/compactação preservando árvore, resumo e métricas.

### 15.2 Cenários E2E obrigatórios

| Cenário | Prova esperada |
|---|---|
| Envio normal | user aparece antes do assistant; um terminal `completed` |
| Turno com shell | start/result correlacionados e persistidos |
| Turno com edit | caminho, +/- e diff quando fornecidos |
| Texto–tool–texto | ordem visual idêntica ao stream |
| Refresh no meio | atividade anterior reaparece e turno continua |
| Restart do Hub | resposta nativa é reconciliada sem duplicar |
| Queda do runner | spinner termina; reconnect não duplica turno |
| Cancelar | árvore morre, terminal cancelled, mensagem restaurável |
| Erro/quota | erro visível, categorizado, sem done falso |
| Anexo texto/imagem | agente recebe conteúdo e histórico reabre chips |
| Fila | itens persistem, combinam e executam uma vez |
| Sessão nativa | listar, abrir, acompanhar, retomar e apagar separadamente |
| Modelo removido | sessão pede nova escolha; não troca silenciosamente |
| Effort inválido | rejeição antes de gastar um turno |
| CLI atualizado | certificação invalidada; fixtures/probe executados novamente |
| Dois clientes | mesma fila, progresso e terminal em ambos |
| Local/remoto | payload normalizado equivalente |
| Delegação gerenciada local | aceite somente após raiz durável; DAG executa uma vez e sessão interna fica oculta |
| Delegação gerenciada remota | Hub fixa o Runner, relay preserva `requestId` e a raiz reaparece em Trabalhos |
| Reentrega de delegação | o mesmo `requestId` devolve o resultado persistido sem criar outra raiz |
| Sandbox indisponível | preflight falha antes do spawn; não há downgrade para prompt-only ou cwd compartilhado |
| Escritor gerenciado | somente perfil certificado recebe worktree; commit/merge/push não são automáticos |
| Cancelamento exato | uma requisição antiga não cancela uma nova raiz da mesma sessão |
| Retenção | somente raízes terminais antigas são compactadas; árvore/resumo/métricas permanecem e o painel indica truncamento |

### 15.3 Testes atuais e buracos

A suíte cobre stores, parsers/fixtures unitários, triggers, anexos, lifecycle
gerenciado, ledger tipado, persistência, auth, métricas, comandos, contrato,
policy/DAG, worktree, retenção, redaction e os 12 perfis de execução. O E2E sobe
processos Hub e Runner reais, conecta WebSocket, executa a fixture mock, confere
thinking/tool/text/terminal/usage e reabre o histórico rico. Também despacha um
workflow Jarvis-managed local e outro remoto, verifica aceite/terminal durável,
ocultação das sessões internas e redelivery idempotente do `requestId`. O número
exato vem do gate da revisão, não fica congelado aqui. Testes MCP separados cobrem
correlação, a corrida terminal-antes-do-aceite, timeout sem cancelamento, relatório
sanitizado e paginação/deduplicação do snapshot de `wait`. Ainda não cobre:

- o canário real de Read/Edit do Codex foi executado manualmente e passou, mas
  ainda não está automatizado na CI porque exige CLI autenticado e consome um
  turno;

- browser/DOM e acessibilidade automatizados (o canary manual desktop/mobile passou);
- reconnect/restart durante uma ferramenta e dois clientes simultâneos;
- overflow real da outbox seguido de manifest/replay;
- anexo remoto real no E2E (o builder tem cobertura unitária/integrada);
- processo/NDJSON autenticado de cada CLI externo;
- conformance por versão/modelo/effort;
- eventos futuros não presentes nas fixtures.

## 16. Definition of Done de um adapter

Um adapter só pode receber status **completo** quando:

- [ ] implementa o contrato canônico;
- [ ] possui fixtures versionadas de todos os eventos publicados;
- [ ] passa a suíte comum de conformidade;
- [ ] passa smoke real no CLI e versão declarados;
- [ ] possui catálogo/model validation sem valores inventados;
- [ ] passa local e runner remoto;
- [ ] persiste e reabre o mesmo fluxo visual;
- [ ] passa cancel/reconnect/restart;
- [ ] commands/skills/MCP/memória têm fontes corretas;
- [ ] usage/custo têm tipo e origem;
- [ ] permissões/sandbox são explícitos;
- [ ] doctor e UI explicam instalação/auth/correção;
- [ ] docs registram limitações reais;
- [ ] nenhum fallback transforma ausência em sucesso silencioso.

## 17. Breakdown de implementação

| Ordem | ID | Entrega vertical | Dependências | Risco |
|---:|---|---|---|---:|
| 1 | JRV-01 | Handshake de versão cliente/Hub/Runner e bloqueio de UI híbrida | — | baixo |
| 2 | JRV-02 | Contrato canônico + eventos persistíveis usando Claude como referência | JRV-01 | alto |
| 3 | JRV-03 | Conformance suite e status completo/limitado/não verificado | JRV-02 | médio |
| 4 | JRV-04 | Unificar lifecycle local/remoto, incluindo anexos e activity | JRV-02/03 | alto |
| 5 | JRV-05 | Corrigir Codex live/native/history/files/resume | JRV-04 | alto |
| 6 | JRV-06 | Modelo/capability registry por versão e máquina | JRV-03 | alto |
| 7 | JRV-07 | Ledger de usage/custo tipado e painel coerente | JRV-02/06 | alto |
| 8 | JRV-08 | Commands/skills/MCP/memória agnósticos | JRV-06 | alto |
| 9 | JRV-09 | Gemini CLI adapter | JRV-03/04/06 | médio |
| 10 | JRV-10 | Cursor Agent adapter | JRV-03/04/06 | médio |
| 11 | JRV-11 | GitHub Copilot CLI adapter | JRV-03/04/06 | médio/alto |
| 12 | JRV-12 | OpenCode adapter | JRV-03/04/06 | médio |
| 13 | JRV-13 | Cline adapter | JRV-03/04/06 | médio |
| 14 | JRV-14 | Qwen Code adapter | JRV-03/04/06 | médio |
| 15 | JRV-15 | Aider/Continue/Kiro/Antigravity: adapter verificável ou limitação explícita | JRV-03/04/06 | alto |
| 16 | JRV-16 | Doctor/install/docs/MCP/voz/rotinas para o registry completo | JRV-06/08 | médio |
| 17 | JRV-17 | E2E multiagente/multimodelo/local/remoto e gate de release | todas | alto |

Cada feature terá spec e critérios de aceitação próprios. Adapters de fornecedores
diferentes continuam independentes depois que JRV-01…08 estabelecerem a base.

## 18. Manutenção desta matriz

- Atualizar o snapshot ao mudar um adapter, protocolo ou versão de CLI.
- Toda nova capability deve receber ID, teste comum e coluna na matriz.
- Toda exceção por fornecedor deve trazer evidência e comportamento de fallback.
- A CI deve gerar um relatório de conformidade e comparar com esta matriz.
- O runtime deve mostrar a mesma situação: completo, limitado, não verificado,
  não autenticado ou não instalado.
- Se documentação e probe divergirem, o probe da versão instalada vence e a
  divergência deve ser registrada.
