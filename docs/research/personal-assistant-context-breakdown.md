---
initiative_id: PAC
title: "Assistente Pessoal Contextual"
status: approved
owner: "Jonathan / Codex"
date: 2026-08-01
stack: "Node.js 22, TypeScript, Hub + PWA/Capacitor/Electron"
approach_approval: "Jonathan aprovou em 2026-08-01 o Context Engine local-first, sem dependencia obrigatoria de APIs pagas, com leitura, memoria e acoes. Tambem aprovou politica por risco, localizacao progressiva e suporte a lojas + sideload."
breakdown_approval: "Jonathan aprovou PAC-01 a PAC-25 em 2026-08-01 e autorizou a implementacao completa com multiagentes e validacao pesada."
---

# Assistente Pessoal Contextual - discovery e breakdown

## 1. Resultado da discovery

O Jarvis recebera um **Context Engine no Hub**, agnostico de agente e modelo. Ele sera a autoridade
para consentimento, coleta, memoria, consulta de fontes, ranking, explicacao, aprovacao e auditoria.
Agentes de IA poderao interpretar pedidos e redigir explicacoes, mas nao serao a fonte de verdade
para disponibilidade, distancia, agenda, permissao ou execucao de acoes.

O baseline nao dependera de Google Maps, TomTom, HERE, Tesla Fleet ou outra API paga. Fontes
gratuitas externas poderao acelerar a instalacao pessoal, mas cada capacidade essencial tera um
caminho aberto ou autohospedavel e um modo degradado explicito.

### Decisoes aprovadas

- Assistente pessoal desligado por padrao e habilitado voluntariamente.
- Leitura de contexto, memoria pessoal e execucao de acoes.
- Acoes classificadas por risco; efeitos externos sensiveis sempre exigem confirmacao.
- Localizacao somente durante o uso inicialmente; background/geofencing e avancado e opt-in.
- Arquitetura compativel com Play Store, App Store e sideload.
- Primeira entrega para um usuario por instalacao, com isolamento por principal desde o contrato.
- Nenhuma dependencia obrigatoria de API paga; inferencia usa o modelo configurado pelo usuario.

### Escopo

- Localizacao do dispositivo, lugares favoritos, rotas, estabelecimentos, carregadores, clima,
  eventos, agenda, preferencias, feedback e contexto temporal.
- Consultas reativas por texto e voz.
- Sugestoes proativas com horario silencioso, limite de interrupcao e explicacao.
- Acoes de navegacao, agenda e automacao local com preview, politica e auditoria.
- Fontes nativas, adapters tipados e MCPs locais/autohospedados.
- Interface e ajuda em portugues, ingles e espanhol.

### Anti-escopo

- APIs pagas obrigatorias ou conectores pagos incluidos no baseline.
- Garantia inventada de disponibilidade em tempo real de carregadores.
- Compra, pagamento, reserva, envio de mensagem, controle de veiculo ou seguranca sem confirmacao.
- Rastreamento bruto e continuo de GPS por padrao.
- Dados de saude, financeiros ou localizacao de terceiros nesta iniciativa.
- Publicidade, venda de dados, treinamento de modelos com dados pessoais ou relay de nuvem Jarvis.
- Scraping que viole termos, robots.txt, autenticacao ou restricoes de uma fonte.
- Reescrita do frontend, migracao para SQLite ou introducao de dependencia nativa no Hub.
- UX completa de familia/equipe na primeira entrega.

## 2. Contexto real do repositorio

- O Hub e a autoridade de estado e usa snapshots JSON atomicos em `~/.jarvis`.
- Journals JSONL fsyncados ja sustentam recuperacao de execucoes e auditoria.
- `MemoryStore` e um indice vetorial de sessoes; nao deve virar o banco de preferencias pessoais.
- `AdaptivePolicy` ja possui autonomia, risco, aprovacao e `allowPersonalContext=false` por padrao.
- Rotinas, push, filas e execucao em background ja existem e devem ser reutilizados.
- A localizacao atual e guardada apenas no `localStorage` e injetada como coordenada crua no prompt.
- O header do Hub bloqueia `geolocation`, e o mobile ainda nao possui plugin oficial de localizacao.
- Jarvis e um servidor MCP, mas ainda nao possui um cliente MCP central e controlado pelo Hub.
- O protocolo cliente-Hub principal continua parcialmente inline em `apps/hub/src/index.ts`.

### Correcao sobre persistencia

A recomendacao preliminar de SQLite foi descartada por conflitar com a arquitetura do projeto.
O contexto pessoal usara:

- Snapshot atomico por principal para consentimentos, perfil, favoritos, preferencias e configuracao.
- Journal JSONL fsyncado para observacoes, decisoes, feedback e acoes.
- Compactacao, retencao e backup seguindo os padroes de `ExecutionStore` e `writeJsonAtomic`.
- Indice semantico derivado e reconstruivel, separado do dado pessoal canonico.
- Credenciais representadas por `secretRef`; nunca em frames WebSocket, prompts ou `localStorage`.

O modelo de ameaca permanece o atual: processos executados como o usuario do Hub sao confiaveis.
Criptografia com chave armazenada no mesmo diretorio nao sera anunciada como protecao real. Uma
integracao futura com cofres do sistema operacional exige uma discovery propria.

## 3. Arquitetura de referencia

```text
Dispositivo / agenda / fontes abertas / Home Assistant
                         |
                         v
              Consentimento por principal
                         |
                         v
  ContextSource adapters -> ContextSnapshot minimizado
                         |
                         v
        filtros objetivos -> score deterministico
                         |
                         v
     IA opcional sobre top-K -> Suggestion explicavel
                         |
                         v
        ActionPlan -> politica -> preview/confirmacao
                         |
                         v
            executor idempotente + auditoria
```

### Contratos de dominio que as primeiras specs devem fechar

```ts
type ContextPurpose = "nearby" | "mobility" | "calendar" | "events" | "weather" | "automation";
type Freshness = "live" | "fresh" | "stale" | "unknown";
type ActionRisk = "read" | "local_reversible" | "external_reversible" | "consequential";

interface SourceRef {
  sourceId: string;
  recordId?: string;
  observedAt: number;
  freshness: Freshness;
  attribution?: string;
}

interface ContextSnapshot {
  principalId: string;
  purpose: ContextPurpose;
  generatedAt: number;
  expiresAt: number;
  fields: Record<string, unknown>;
  sources: SourceRef[];
}

interface Suggestion<T = unknown> {
  id: string;
  kind: string;
  candidate: T;
  score: number;
  reasons: string[];
  caveats: string[];
  sources: SourceRef[];
  actions: ActionPlan[];
}

interface ActionPlan {
  idempotencyKey: string;
  kind: string;
  risk: ActionRisk;
  preview: Record<string, unknown>;
  expiresAt: number;
}
```

Invariantes:

1. O servidor e a autoridade de consentimento e politica; o cliente apenas solicita.
2. Nenhuma fonte recebe campos fora da finalidade aprovada.
3. Coordenadas cruas nao sao prefixadas livremente no prompt do agente.
4. Filtros duros executam antes de qualquer ranking por IA.
5. A IA nunca altera `freshness`, disponibilidade, horario, distancia ou identificador da fonte.
6. Todo resultado externo preserva fonte, observacao, atribuicao e caveats.
7. Toda acao externa possui preview, expiracao e chave de idempotencia.
8. Revogar uma fonte impede novas leituras imediatamente e agenda a eliminacao do cache relacionado.
9. Dados de um principal nunca aparecem em consultas de outro principal.
10. Falha de uma fonte produz resultado parcial ou erro da fonte, nunca informacao fabricada.
11. `readOnlyHint` e outras annotations de MCP sao metadados nao confiaveis; apenas profiles
    first-party/auditados podem ser chamados automaticamente como leitura.

## 4. Baseline gratuito e autohospedado

| Capacidade | Baseline | Operacao robusta |
|---|---|---|
| Mapa | MapLibre GL JS + PMTiles | Extrato regional servido pelo Hub, com atribuicao OSM |
| Geocodificacao | Nominatim | Sidecar autohospedado; endpoint publico apenas para desenvolvimento de baixo volume |
| Rotas | Valhalla | Sidecar regional com rota, matriz e isocronas |
| POIs | OpenStreetMap | Extrato local consultavel, sem depender do Overpass publico em producao |
| Recarga EV | Open Charge Map + OSM | Somente registros abertos; estado desconhecido quando nao houver observacao recente |
| Clima | Open-Meteo | Endpoint gratuito com cache; autohospedagem opcional para independencia completa |
| Eventos | Mapas Culturais/PBH/SALIC, RSS, ICS e JSON-LD | Adapters por fonte, ETag, deduplicacao e fixtures versionadas |
| Agenda | API nativa do dispositivo e CalDAV | Busy/free por padrao; detalhes somente com consentimento adicional |
| Automacao | Jarvis + Home Assistant | MCP oficial/local ou adapter REST local com allowlist |

Nao existe equivalencia gratuita universal para status ao vivo de todos os carregadores. PAC-09
deve mostrar `unknown` ou `stale`, ultima observacao e alternativas. A ausencia de uma fonte paga
reduz cobertura/frescor, mas nao pode reduzir a honestidade da resposta.

### Jornadas primarias

**Recarga e refeicao:** pedido por voz/texto -> localizacao permitida -> perfil EV -> carregadores
compativeis -> rota/desvio -> restaurantes alinhados as preferencias -> tres opcoes com frescor ->
preview -> abrir navegacao.

**Evento em BH:** interesse/data/regiao -> fontes culturais em paralelo -> deduplicacao -> agenda e
clima opcionais -> lista/mapa com proveniencia -> abrir fonte ou criar compromisso confirmado.

**Sugestao proativa:** rotina/agenda/contexto permitido -> score minimo -> quiet hours e cooldown ->
push curto -> deep link para justificativa -> aceitar, dispensar ou desativar a categoria.

**Privacidade:** Settings -> ver dados/fontes/inferencias -> corrigir ou revogar -> exportar/apagar ->
journal registra a operacao sem conservar o dado removido.

## 5. Bootstrap tecnico

Bootstrap nao e tratado como feature horizontal entregue sozinha; cada item entra junto da primeira
fatia vertical que o utiliza.

| ID | Item | Primeira feature consumidora |
|---|---|---|
| BOOT-01 | Contratos `ContextSource`, `ContextSnapshot`, `Suggestion` e `ActionPlan` no core/protocol | PAC-01/PAC-04 |
| BOOT-02 | Store por principal com snapshot atomico, journal, migracao, compactacao e redacao | PAC-01/PAC-03 |
| BOOT-03 | Plugin `@capacitor/geolocation`, permissoes nativas e bridge feature-detected | PAC-02 |
| BOOT-04 | Perfil autohospedado Nominatim + Valhalla + PMTiles, extrato regional e doctor | PAC-05/PAC-06 |
| BOOT-05 | Harness de adapters, timeout, cache, ETag, circuit breaker, fixtures e proveniencia | PAC-04 |
| BOOT-06 | `secretRef` inicialmente referenciando secrets em `~/.jarvis/hub.env`; UI mostra presenca, nunca valor | PAC-11/PAC-20 |
| BOOT-07 | Ledger de licencas/atribuicoes de OSM, OCM, Open-Meteo e fontes culturais | PAC-05/PAC-09/PAC-12/PAC-13/PAC-14 |
| BOOT-08 | Router de intents pessoais e slots estruturados, sem consumir falsos positivos do chat de codigo | PAC-08/PAC-10/PAC-12 |

Pre-requisitos de ambiente a validar nas specs:

- Node.js 22 e os comandos existentes `npm run typecheck`, `npm test` e `npm run check`.
- Docker/WSL2 ou host Linux para o perfil geoespacial autohospedado; o Hub continua sem dependencia
  nativa e funciona sem esse perfil em modo degradado.
- Android Studio para validar o plugin mobile e macOS/Xcode para a validacao iOS.
- Nenhuma nova variavel obrigatoria para ativar o Hub. URLs locais e regioes serao configuradas pelo
  setup; chaves gratuitas opcionais devem aparecer no doctor e na documentacao de configuracao.
- Toda nova env deve entrar no catalogo central de configuracao, setup, doctor e documentacao na
  mesma feature; nao sera aceita uma chave descoberta apenas por mensagem de erro.

## 6. Epic breakdown

| Ordem | ID | Valor entregue | Dependencias | Risco |
|---:|---|---|---|---|
| 1 | PAC-01 | Habilitar, pausar e limitar o assistente pessoal por finalidade | nenhuma | alto |
| 2 | PAC-02 | Usar a localizacao atual em pedidos feitos com o app aberto | PAC-01 | alto |
| 3 | PAC-03 | Inspecionar, exportar e apagar os dados pessoais do Jarvis | PAC-01 | alto |
| 4 | PAC-04 | Ver, testar e controlar fontes de contexto e sua proveniencia | PAC-01 | medio |
| 5 | PAC-05 | Buscar um endereco/POI e inspeciona-lo em mapa local | PAC-02, PAC-04 | medio |
| 6 | PAC-06 | Calcular rota, desvio e tempo de deslocamento sem API paga | PAC-05 | medio |
| 7 | PAC-07 | Salvar casa, trabalho e favoritos com aliases privados | PAC-05 | alto |
| 8 | PAC-08 | Receber opcoes de lugares proximos, filtradas e explicadas | PAC-06, PAC-07 | medio |
| 9 | PAC-09 | Encontrar carregadores compativeis com fonte e frescor visiveis | PAC-08 | alto |
| 10 | PAC-10 | Cruzar disponibilidade da agenda do dispositivo sem expor detalhes | PAC-01, PAC-04 | alto |
| 11 | PAC-11 | Conectar uma agenda CalDAV somente leitura para uso em background | PAC-01, PAC-04 | alto |
| 12 | PAC-12 | Descobrir eventos do Mapa Cultural BH por fonte oficial | PAC-04, PAC-05 | medio |
| 13 | PAC-13 | Federar PBH, RSS, ICS e JSON-LD com deduplicacao | PAC-04, PAC-12 | medio |
| 14 | PAC-14 | Considerar clima em deslocamentos, eventos e sugestoes | PAC-04, PAC-05 | baixo |
| 15 | PAC-15 | Lembrar preferencias explicitas e feedback corrigivel | PAC-01 | alto |
| 16 | PAC-16 | Inferir habitos com evidencia, confianca e decaimento | PAC-07, PAC-15 | alto |
| 17 | PAC-17 | Combinar fontes em uma recomendacao contextual unica | PAC-08, PAC-15 | alto |
| 18 | PAC-18 | Pre-visualizar, autorizar e executar navegacao/handoffs | PAC-06, PAC-17 | alto |
| 19 | PAC-19 | Criar ou atualizar compromisso com confirmacao e idempotencia | PAC-10, PAC-18 | alto |
| 20 | PAC-20 | Conectar MCP HTTP somente leitura com allowlist e minimizacao | PAC-04 | alto |
| 21 | PAC-21 | Habilitar MCP local/stdio e tools de acao sob politica | PAC-18, PAC-20 | alto |
| 22 | PAC-22 | Ler contexto e executar acoes permitidas no Home Assistant | PAC-21 | alto |
| 23 | PAC-23 | Receber sugestoes proativas uteis sem excesso de notificacoes | PAC-17, PAC-18 | alto |
| 24 | PAC-24 | Usar geofences/background opt-in no Android | PAC-02, PAC-23 | alto |
| 25 | PAC-25 | Usar mudancas significativas/geofences opt-in no iOS | PAC-02, PAC-23 | alto |

## 7. Fatias e criterios de aceite

### PAC-01 - Opt-in, finalidades e pausa

**Valor:** o usuario decide se o assistente existe e o que ele pode observar.

- Desligado e sem consentimentos na primeira execucao e para novos principals.
- Ativacao explicita por finalidade e fonte; consentimento registra versao, data e dispositivo.
- `Pausar assistente` interrompe coleta, injecao, sincronizacao e proatividade imediatamente.
- Politica efetiva e aplicada no servidor e respeita `allowPersonalContext` e o principal autenticado.
- Configuracao, estados vazio/erro e ajuda modular funcionam em pt/en/es e mobile/desktop.

### PAC-02 - Localizacao atual em primeiro plano

**Valor:** pedidos como "o que existe perto de mim?" usam a posicao do dispositivo solicitante.

- Permissao e solicitada somente depois do opt-in e mostra precisa/aproximada/negada/indisponivel.
- PWA e Capacitor usam o mesmo contrato; a implementacao nativa usa o plugin oficial de foreground.
- A posicao possui expiracao e precisao; dado vencido nao e usado silenciosamente.
- O Hub recebe um envelope tipado e minimizado, nao uma linha de coordenadas concatenada ao prompt.
- Revogar permissao no sistema ou no Jarvis remove o valor ativo e produz orientacao acionavel.

### PAC-03 - Ciclo de vida dos dados pessoais

**Valor:** o usuario consegue ver e controlar tudo que o Jarvis guardou sobre ele.

- Painel lista categorias, volume, fonte, retencao e ultima atualizacao sem expor outro principal.
- Exportacao produz pacote JSON legivel com schema e proveniencia; segredos nunca sao exportados.
- Apagar categoria e `Apagar tudo` removem snapshot, journal derivado, indices e caches relacionados.
- Retencao compacta observacoes expiradas e mantem apenas agregados aprovados.
- Reinicio ou falha durante exclusao nao recria dados apagados a partir de cache/journal antigo.

### PAC-04 - Centro de fontes e proveniencia

**Valor:** o usuario sabe de onde os dados vieram e se uma fonte esta saudavel.

- Settings mostra fonte, capacidade, custo (`local`/`gratuita`), estado, latencia e ultima sincronizacao.
- Cada fonte pode ser testada, habilitada, pausada e revogada pelo owner.
- Timeouts, limite de concorrencia, cache, ETag e circuit breaker isolam falhas por fonte.
- Todo resultado conserva `SourceRef`; nenhum adapter retorna dados sem identificacao/frescor.
- O baseline funciona com todas as fontes pagas ausentes/desabilitadas.

### PAC-05 - Mapa local, geocodificacao e POIs

**Valor:** o usuario pesquisa endereco ou lugar e o visualiza sem chave de mapa paga.

- MapLibre renderiza mapa real com atribuicao e suporta PWA, Capacitor e Electron.
- Nominatim local faz busca e reverse geocoding; autocomplete nao usa o endpoint publico do OSM.
- Resultados mostram nome, categoria, coordenada, fonte e confianca do match.
- Falha do sidecar mostra estado degradado e nao impede uso das demais funcoes do Jarvis.
- Desktop e 390x844 sao validados sem mapa vazio, sobreposicao ou controles inacessiveis.

### PAC-06 - Rotas e tempo de deslocamento

**Valor:** o usuario compara distancia, tempo e desvio entre opcoes.

- Valhalla local calcula rota e matriz para carro, caminhada e bicicleta quando suportados.
- Resposta diferencia distancia em linha reta de distancia/tempo roteado.
- Rota obsoleta ou servico offline e sinalizado; o ranking nao usa tempo ficticio.
- Mapa exibe origem, destino e trajeto com enquadramento responsivo.
- Requests repetidos usam cache por origem aproximada/destino/modo e respeitam expiracao.

### PAC-07 - Lugares favoritos

**Valor:** casa, trabalho e locais frequentes podem ser usados sem rastrear cada deslocamento.

- Usuario cria favorito pelo mapa/endereco, define alias e escolhe quais finalidades podem usa-lo.
- Valores sao isolados por principal, editaveis e apagaveis.
- Endereco exibivel e identificador da fonte sao armazenados; coordenada mantem precisao necessaria.
- Alias ambiguo pede escolha e nunca e resolvido para outro principal.
- Casa/trabalho nao sao incluidos em prompt ou log sem necessidade da finalidade ativa.

### PAC-08 - Lugares proximos

**Valor:** pedidos por restaurante, servico ou local devolvem opcoes utilizaveis e comparaveis.

- Parser reconhece categoria, raio/tempo, horario, restricoes e ponto de referencia em texto e voz.
- Candidatos de OSM passam por filtros de distancia, rota, horario conhecido e restricoes explicitas.
- Resultado estruturado mostra score, motivos, caveats, fonte e acoes; sem dado significa desconhecido.
- Uma fonte lenta nao bloqueia resultados validos das demais.
- Query sem localizacao oferece escolher favorito ou informar regiao, sem presumir a posicao.

### PAC-09 - Recarga de veiculo eletrico

**Valor:** o usuario encontra recarga compativel e entende a confiabilidade da disponibilidade.

- Perfil guarda conector, potencia aceita, autonomia/range opcional e preferencias de recarga.
- Open Charge Map usa apenas registros licenciados como abertos e preserva atribuicao do provedor.
- Filtros eliminam conectores incompativeis antes do ranking e cruzam rota/desvio.
- Status distingue `live`, `fresh`, `stale` e `unknown`, sempre com horario da observacao.
- Perfil manual funciona sem Tesla Fleet; Home Assistant podera fornecer range local apos PAC-22.

### PAC-10 - Agenda do dispositivo somente leitura

**Valor:** o Jarvis considera compromissos do telefone sem ler mais do que precisa.

- Plugin nativo solicita a menor permissao possivel e sincroniza apenas busy/free por padrao.
- Detalhes de titulo, participantes e local exigem consentimento separado.
- Timezone, recorrencia, all-day e calendarios sobrepostos possuem fixtures e comportamento definido.
- Snapshot no Hub tem TTL e mostra quando o app precisa sincronizar novamente.
- Usuario pode perguntar por disponibilidade e receber resposta mesmo sem modelo de IA.

### PAC-11 - Agenda CalDAV somente leitura

**Valor:** rotinas e sugestoes em background consultam agenda sem depender do telefone aberto.

- Cadastro usa endpoint e `secretRef`, descobre calendarios e permite selecionar quais participam.
- Sync incremental usa ETag/sync token quando suportado e nao baixa indefinidamente o historico.
- Busy/free continua sendo o default; detalhes exigem consentimento adicional por finalidade.
- Revogacao invalida credenciais, interrompe sync e elimina cache relacionado.
- Falha de uma conta nao bloqueia agenda nativa nem outras fontes de contexto.

### PAC-12 - Eventos do Mapa Cultural BH

**Valor:** o usuario encontra eventos atuais da fonte cultural oficial da cidade.

- Adapter consulta a API do Mapas Culturais e filtra data, linguagem/categoria e regiao.
- Cada resultado preserva identificador, horario, local, link e atribuicao da fonte.
- Evento expirado ou cancelado deixa de ser sugerido conforme o estado publicado.
- Lista e mapa exibem atualizado/confirmado/incerto e estados vazio/erro coerentes.
- Parser opera sobre fixtures versionadas para detectar mudanca de contrato.

### PAC-13 - Federacao de eventos abertos

**Valor:** a cobertura cresce para PBH e outras agendas sem perder rastreabilidade.

- Adapters cobrem PBH e fontes aprovadas em RSS, ICS e JSON-LD; HTML e isolado e possui fixture.
- Deduplicacao considera titulo, horario, local e fonte sem fundir eventos realmente diferentes.
- Conflitos preservam os dois valores e indicam qual fonte/observacao e mais recente.
- Cada card abre a fonte original e mostra atualizado/confirmado/incerto.
- Falha de parser aparece na saude da fonte sem remover resultados validos de outros adapters.

### PAC-14 - Clima contextual

**Valor:** o Jarvis evita sugerir um programa externo inadequado ao clima previsto.

- Open-Meteo e consultado por coordenada aproximada e janela temporal, com atribuicao e cache.
- Chuva, temperatura e alertas sao fatos de fonte; a IA apenas explica o impacto.
- Falha do clima nao bloqueia evento/rota e aparece como contexto indisponivel.
- Preferencia por local coberto/aberto pode ser aplicada sem gravar historico de localizacao.

### PAC-15 - Preferencias explicitas e feedback

**Valor:** o usuario ensina gostos e restricoes de maneira visivel e reversivel.

- `Lembrar`, `Nao sugerir`, `Gostei`, `Nao gostei` e `Esquecer` produzem registros estruturados.
- Cada memoria mostra fonte, evidencia, escopo, confianca, validade e ultima utilizacao.
- Restricoes explicitas vencem inferencias e nunca sao rebaixadas silenciosamente pela IA.
- Memorias podem ser editadas/apagadas e deixam de afetar ranking imediatamente.
- O indice vetorial e derivado; apagar a memoria canonica remove/reconstroi sua entrada.

### PAC-16 - Preferencias inferidas

**Valor:** o assistente aprende padroes sem transformar toda observacao em verdade permanente.

- Inferencia usa escolhas, recusas e visitas resumidas autorizadas; GPS bruto nao e requisito.
- Nova inferencia inclui evidencia, confianca, data de expiracao e explicacao legivel.
- Baixa confianca nao altera filtros duros; pode apenas influenciar score de modo limitado.
- Usuario confirma, corrige ou rejeita uma inferencia, e essa decisao e persistida.
- Decaimento remove influencia de habitos antigos sem apagar evidencias antes da retencao configurada.

### PAC-17 - Recomendacao multicontexto

**Valor:** uma pergunta recebe uma recomendacao que cruza local, tempo, preferencias e fontes disponiveis.

- Pipeline normaliza candidatos, aplica filtros duros e calcula score deterministico explicavel.
- IA opcional recebe apenas top-K e `ContextSnapshot` minimizado para ordenar empates/redigir resumo.
- Resposta mostra porque sugeriu, porque descartou quando solicitado e quais dados faltaram.
- Resultado parcial continua valido quando agenda, eventos, clima ou outra fonte estiver indisponivel.
- Um modelo local/configurado pode substituir qualquer modelo cloud; nenhum provedor e fixado no contrato.

### PAC-18 - Preview, navegacao e handoff

**Valor:** o usuario transforma uma sugestao em navegacao ou abertura da fonte sem perder controle.

- Cards produzem `ActionPlan` expiravel com preview, risco, executor e chave de idempotencia.
- Abrir rota/link pode ser autorizado como baixo risco; efeitos externos seguem politica efetiva.
- O servidor revalida permissao, principal e dados no momento da execucao.
- Duplo clique/retry nao executa a mesma acao duas vezes.
- Resultado e auditado como concluido, falhou, cancelado ou expirado, sem marcar tentativa como sucesso.

### PAC-19 - Acoes de agenda

**Valor:** uma sugestao vira compromisso correto sem criacao duplicada.

- Preview mostra calendario, titulo, horario, timezone, local e lembretes antes da escrita.
- Criar/atualizar pede confirmacao e usa idempotencia e deteccao de possivel duplicata.
- Alteracao concorrente invalida preview antigo e exige revisao.
- Quando suportado, a resposta oferece desfazer; exclusao sempre exige confirmacao.
- Permissao somente leitura continua funcionando quando escrita e negada.

### PAC-20 - MCP HTTP somente leitura

**Valor:** o owner conecta uma fonte MCP autohospedada sem depender do agente escolhido.

- Hub suporta Streamable HTTP com uma versao estavel do SDK oficial pinada na spec.
- Cadastro e owner-only e exibe endpoint, tools, saude, latencia e permissoes concedidas.
- Somente tools de profiles first-party/auditados entram em leitura automatica; um servidor
  desconhecido permanece `uncertified` e exige acionamento/confirmacao explicita.
- Egress policy remove campos nao autorizados; schemas e outputs possuem limites de tamanho/tempo.
- Annotations do MCP nao sao fronteira de seguranca; servidor comprometido nao recebe secrets
  arbitrarios nem acesso ao host, mas ainda pode produzir efeitos no proprio endpoint remoto.

### PAC-21 - MCP local e tools de acao

**Valor:** o owner conecta MCP stdio/local e usa acoes apenas depois da politica do Jarvis.

- Comando, executavel, cwd e ambiente sao configurados pelo owner; iniciar stdio e tratado como shell.
- Tools de acao recebem classificacao de risco local; annotations do servidor nao sao fronteira de seguranca.
- Argumentos exatos viram preview e a chamada so ocorre depois da aprovacao exigida.
- Processo possui timeout, limite de output, cancelamento e encerramento no revoke/restart.
- Um MCP arbitrario nunca recebe permissao implicita para chamar outra tool, acessar secrets ou evitar auditoria.

### PAC-22 - Home Assistant

**Valor:** o assistente usa presenca/sensores locais e executa automacoes permitidas.

- Integracao usa MCP oficial/local ou adapter local, nunca Home Assistant Cloud como requisito.
- Entidades de leitura e servicos de escrita sao allowlists separadas.
- Cena/servico mostra entidade, parametros e impacto antes da confirmacao exigida pela politica.
- Locks, alarmes, portoes e equivalentes sao `consequential` e nunca rodam sem confirmacao explicita.
- Falha ou timeout nao e convertido em sucesso; estado posterior e relido quando possivel.

### PAC-23 - Sugestoes proativas

**Valor:** o Jarvis avisa sobre oportunidades relevantes sem exigir uma pergunta naquele momento.

- Reutiliza scheduler, politicas adaptativas, push e sessoes de rotina existentes.
- Triggers iniciais usam horario, agenda, clima, eventos e rotinas; background GPS nao e dependencia.
- Quiet hours, limite por dia, cooldown, deduplicacao e score minimo sao configuraveis por dispositivo.
- Notificacao curta inclui motivo, validade e deep link para detalhes/acao.
- Ignorar, dispensar e desativar categoria alimentam feedback e reduzem repeticao.

### PAC-24 - Background e geofences no Android

**Valor:** o usuario opt-in recebe contexto de chegada/saida com o Android bloqueado.

- Recurso e separado de foreground e exige consentimento e permissoes especificas do sistema.
- Plugin open source escolhido e auditado, ou implementacao propria, usa foreground service e notificacao persistente quando exigido.
- Geofences guardam entrada/saida, nao uma trilha crua continua por padrao.
- Bateria, reboot, force-stop, app encerrado e permissao revogada sao testados em aparelho real.
- Build de loja pode desabilitar a capacidade sem quebrar o baseline; sideload pode habilita-la.

### PAC-25 - Background e geofences no iOS

**Valor:** o usuario opt-in recebe contexto permitido pelo iOS com o aparelho bloqueado.

- Plugin nativo usa mudancas significativas, visitas/geofences e `Always` apenas quando necessario.
- O fluxo explica a diferenca entre permissao durante o uso e sempre, sem dark pattern.
- Geofences guardam entrada/saida, nao uma trilha crua continua por padrao.
- Background, encerramento pelo sistema, reboot, bateria e permissao revogada sao testados em device.
- Suporte so e declarado depois de teste em iPhone e revisao das exigencias da App Store.

## 8. Grafo de dependencias

```text
PAC-01
  |-- PAC-02 -- PAC-05 -- PAC-06 -- PAC-07 -- PAC-08 -- PAC-09
  |                |                              |
  |                +-- PAC-12 -- PAC-13           +-- PAC-17 -- PAC-18 -- PAC-19
  |                +-- PAC-14                            |          |
  |-- PAC-03                                             |          +-- PAC-23 --+-- PAC-24
  |-- PAC-04 -- PAC-10 ----------------------------------+                       +-- PAC-25
  |       |---- PAC-11
  |       +---- PAC-20 -- PAC-21 -- PAC-22
  +-- PAC-15 -- PAC-16
          +--------- PAC-17
```

PAC-17 aceita fontes opcionais: nao precisa esperar PAC-10/PAC-11/PAC-12/PAC-13/PAC-14 para existir,
mas fica mais rica a cada adapter. PAC-23 nasce sem background GPS e usa apenas contexto permitido
ja disponivel.

## 9. Leis transversais de UX, seguranca e operacao

### UX e i18n

- A primeira tela continua sendo a experiencia real; nao sera criada landing page.
- O assistente pessoal entra em Configuracoes como modulo, com ajuda em modal; tooltips ficam apenas
  em controles cuja duvida e local e curta.
- Sugestoes usam lista/mapa e comparacao escaneavel, sem cards aninhados ou excesso de informacao.
- Todo estado possui loading, vazio, parcial, stale, offline, negado, expirado e erro recuperavel.
- Textos, aria-labels, notificacoes e permissoes devem existir em pt-BR, en e es na mesma feature.
- Mobile preserva composer/footer, safe areas e alvos de toque; mapas nao cobrem controles.

### Seguranca e privacidade

- Consentimento, source grants, action grants e dados pessoais sao isolados por `principalId`.
- Somente owner configura fontes executaveis/MCP; membros controlam apenas seus consentimentos.
- Context manifests registram campos/fontes/expiracao, nao valores pessoais crus.
- Logs, notificacoes e erros passam por redacao; endereco residencial nao aparece em audit generico.
- Acoes de alto impacto podem exigir passphrase/biometria mesmo com sessao autenticada.
- Prompts nao sao usados como fronteira de seguranca; adapters e executores validam contratos.

### Confiabilidade

- Toda chamada externa possui timeout, cancelamento, retry limitado e circuit breaker.
- Escritas possuem idempotencia; leituras possuem cache com TTL por tipo de dado.
- Estado stale nunca e promovido para live por inferencia.
- Sidecars sao opcionais para o boot do Hub e possuem health/doctor/update independentes.
- Falha de parse preserva fixture/raw hash suficiente para diagnostico sem guardar PII desnecessaria.
- Reinicio no meio de sync/acao recupera estado a partir do journal sem repetir efeito externo.

### Licencas e atribuicao

- OSM/PMTiles/Valhalla preservam atribuicao e termos do dado de origem.
- Open Charge Map e filtrado para dados abertos e conserva atribuicao por registro/provedor.
- Open-Meteo e fontes culturais exibem atribuicao exigida e origem clicavel.
- Cada adapter declara licenca, politica de cache, retencao permitida e data da ultima revisao.

## 10. Gates de validacao

Cada spec deve definir checks focados e, antes do merge da iniciativa, o conjunto precisa passar:

1. `npm run typecheck`.
2. `npm test`.
3. `node --check apps/hub/web/app.js`.
4. `git diff --check`.
5. Testes de contrato com fixtures offline para todos os adapters.
6. Teste adversarial de isolamento entre dois principals.
7. Restart durante sync, compactacao e acao pendente.
8. Fontes pagas ausentes e internet indisponivel, com modos degradados coerentes.
9. Playwright desktop e mobile para Settings, cards, mapa e acoes, incluindo verificacao de pixels.
10. Android real: permissoes de foreground, app em background, bloqueio e reinicio.
11. iOS real antes de declarar PAC-25 suportado.
12. Revisao de ameacas e RIPD antes de liberar background location em distribuicao publica.

## 11. Metricas de produto

- Taxa de sugestoes abertas, aceitas, rejeitadas e marcadas como irrelevantes.
- Cobertura por fonte e proporcao de resultados fresh/stale/unknown.
- Tempo ate primeira opcao valida e tempo ate resultado completo.
- Numero de notificacoes por dispositivo/dia e taxa de silenciamento da categoria.
- Correcoes de preferencias inferidas e idade media das inferencias utilizadas.
- Acoes duplicadas evitadas, previews expirados e falhas por executor.
- Zero leitura quando desativado, zero vazamento entre principals e zero API paga obrigatoria.

As metricas ficam locais e agregadas. Nao existe telemetria externa nesta iniciativa.

## 12. Ordem de especificacao sugerida

Depois da aprovacao deste breakdown, cada feature entra separadamente em `/flow:spec`. A primeira
sequencia recomendada e PAC-01 -> PAC-02 -> PAC-03 -> PAC-04 -> PAC-05. Ela entrega controle,
localizacao reativa, ciclo de vida dos dados e a primeira fonte geografica completa antes de iniciar
memoria inferida, acoes ou proatividade.

Nenhuma feature posterior deve antecipar sua dependencia dentro de uma spec maior. Alterar o escopo
ou anti-escopo desta iniciativa exige nova aprovacao humana.

## 13. Referencias da pesquisa

### Contexto, recomendacao e confianca

- [Context-aware recommender systems: systematic review (2024)](https://link.springer.com/article/10.1007/s10462-024-10939-4)
- [Microsoft Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)
- [Google PAIR - Explainability and Trust](https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/)

### Mobile e privacidade

- [Android location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions)
- [Android background location](https://developer.android.com/develop/sensors-and-location/location/background)
- [Android geofencing](https://developer.android.com/develop/sensors-and-location/location/geofencing)
- [Google Play background-location policy](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en)
- [Apple Core Location](https://developer.apple.com/documentation/CoreLocation)
- [ANPD - direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares)
- [ANPD - orientacao sobre RIPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd)

### Geodados, recarga e clima

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Valhalla routing engine](https://github.com/valhalla/valhalla)
- [Open Charge Map API](https://www.openchargemap.org/develop/api)
- [Open-Meteo source and self-hosting](https://github.com/open-meteo/open-meteo)

### Eventos, agenda e automacao

- [Mapa Cultural BH](https://www.mapaculturalbh.pbh.gov.br/)
- [Mapas Culturais API](https://docs.mapasculturais.org/mc_config_api/)
- [Calendario oficial de eventos de Belo Horizonte](https://portalbelohorizonte.com.br/trade/calendario-anual-de-eventos)
- [Radicale CalDAV/CardDAV](https://radicale.org/)
- [Home Assistant MCP server](https://www.home-assistant.io/integrations/mcp_server/)

### MCP

- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
