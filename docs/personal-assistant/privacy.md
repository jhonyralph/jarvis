# Privacidade, retenção e segurança

## Fronteiras de dados

O Context Engine é local-first, mas não necessariamente offline. A fronteira muda conforme a fonte:

| Fluxo | Sai do dispositivo/Hub | Persistência esperada |
|---|---|---|
| localização foreground nativa | vai ao Hub somente após consentimento e consulta | posição exata temporária; histórico reduz precisão |
| calendário nativo | somente intervalos busy/free vão ao Hub | intervalos exatos em memória; resumo de contagem/janela persistido |
| scope nativo | `principalId`, `deviceId` e `generation` ficam entre UI e plugin; não são enviados a provedores | epoch no cliente e no store nativo; nenhum token ou coordenada faz parte do scope |
| transição de geofence | ID da geofence, enter/exit e timestamps vão ao Hub após consentimento | fila nativa até ACK; Hub guarda favorito/transição/aparelho minimizados conforme retenção |
| Nominatim/Overpass/Open-Meteo público | texto, coordenadas e janela necessários vão ao provedor | cache limitado no Hub; provedor possui seus próprios logs/termos |
| sidecars locais | consulta fica na máquina, mas pode aparecer em access logs locais | banco/grafo/archive e logs Docker locais |
| CalDAV/MCP/Home Assistant | payload minimizado vai ao endpoint configurado | cache privado limitado; segredo não entra no store |
| ação externa | payload aprovado vai ao executor | estado, preview, resultado redigido e trilha de ação |

O caminho padrão do estado pessoal é `<JARVIS_HOME>/.jarvis/personal/<hash-do-principal>/`; sem
`JARVIS_HOME`, a base é o home do usuário. O diretório usa snapshots atômicos e journal JSONL. Faça
backup como dado pessoal, não como simples configuração de aplicação.

## Consentimento e minimização

- Consentimento é associado a `principalId`, `deviceId`, `sourceId` e propósitos permitidos.
- Configurar uma fonte não concede consentimento para consultá-la.
- Revogação impede novas leituras e deve invalidar dados/cache derivados aplicáveis.
- O Hub substitui identidades de dispositivo recebidas pelo actor autenticado; o cliente não escolhe
  outro principal/dispositivo no payload.
- A bridge nativa vincula geofences, fila e callbacks a `{ principalId, deviceId, generation }`.
  Esse scope separa epochs locais, mas não autentica frames no Hub e nunca deve derivar de token.
- `generation` avança após `eraseAll` antes de um grant posterior. O contador interno
  `configurationGeneration`, usado para rejeitar callback/rearm antigo, é distinto.
- Localização exata tem TTL e não é anexada ao chat comum. Observação persistida usa precisão reduzida
  salvo opt-in explícito de retenção bruta.
- Agenda nativa cruza a bridge apenas como intervalos ocupados; título, notas, participantes, URL e
  local não atravessam.
- `secretRef` armazena somente o nome de uma variável; o valor permanece no ambiente do Hub.

CalDAV com `config.access=details` é uma ampliação relevante da coleta. Trate-a como decisão separada,
revise a necessidade e prefira `busy_free`.

## Transições nativas e redelivery

`leaseTransitions` não remove eventos. O lease, suas tentativas e o evento sem coordenadas ficam no
armazenamento nativo até `ackTransitions` confirmar apenas os IDs aceitos de forma durável pelo Hub.
ACK parcial e retry são idempotentes. Se o Hub aceitar o evento e a resposta/ACK se perder, a
expiração do lease libera redelivery com o mesmo ID e `deliveryAttempt` maior; o store do Hub faz
upsert pelo principal/aparelho autenticado e ID estável, sem criar uma segunda observação.

Um evento sem consentimento vigente não é enviado nem ACKed. Ele permanece pendente até o grant
voltar a autorizá-lo ou até revoke/`eraseAll` eliminar a fila. `drainTransitions` é apenas alias de
migração, também não destrutivo; código novo deve usar lease + ACK. Restart do app preserva fila,
lease e ledger de ACK. Consulte [mobile.md](mobile.md#lease-ack-exclusão-e-restart) para o contrato de
plataforma.

## Logs e diagnósticos

O doctor não imprime os valores dos segredos conhecidos (`CONTEXT_NOMINATIM_PASSWORD`,
`JARVIS_OCM_API_KEY` ou `secretRef`) e não envia a chave OCM em probe. Entretanto, JSON de
diagnóstico contém caminhos locais, profiles e host/path de endpoints. Revise-o antes de enviar ao
time.

Sidecars têm logs próprios. Uma busca de endereço pode aparecer no access log do Nominatim local;
coordenadas podem aparecer em logs de proxy. Restrinja acesso aos logs, defina retenção e não os
publique em tickets sem redação.

## Rede

- Portas dos sidecars ligam em `127.0.0.1` por padrão.
- A rede Compose é `internal: true`; containers não baixam dados nem fazem replicação.
- Não altere `CONTEXT_BIND_HOST` para `0.0.0.0` sem firewall, autenticação/proxy e avaliação de risco.
- Hub remoto deve usar TLS/Tailscale. O endpoint admin do Jarvis não deve ser publicado.
- HTTP de integrações privadas só é apropriado em loopback/LAN/Tailscale controlado; internet remota
  exige HTTPS e autorização explícita.

## Retenção, exportação e exclusão

As configurações do assistente definem retenção de observações, decisões e inferências. O usuário
pode exportar o estado pessoal, podar itens expirados, apagar uma categoria ou executar exclusão
completa confirmada.

Apagar uma categoria reescreve snapshot e journal em um checkpoint compacto, removendo também os
derivados definidos pelo contrato: por exemplo, favorito remove sua evidência de geofence;
consentimentos removem observações; fonte remove status/cache registrado e inferências derivadas.
“Apagar tudo” no cliente nativo chama `eraseAll` com o scope vigente antes da exclusão no Hub.
`eraseAll` independe da permissão de localização e elimina geofences, transições, leases, replay
markers e ACKs locais antes de pedir limpeza ao SO. Scope diferente falha fechado para que revoke
atrasado de um login antigo não apague o login novo.

Dois marcadores mínimos permanecem deliberadamente fora do conteúdo exportável:

- o Hub grava primeiro `.erased-<hash-do-principal>.json`, com versão e `erasedAt`, e só então remove
  o diretório pessoal; o tombstone impede backup, snapshot ou journal antigo de ressuscitar no
  restart e é removido apenas por reativação explícita;
- o cliente mantém o scope `{ principalId, deviceId, generation }` com a geração avançada. Ele não
  contém contexto, segredo ou coordenada e impede callback/lease antigo de entrar no grant seguinte.

Portanto exclusão significa remover dados pessoais canônicos e derivados controlados pelo Jarvis,
não prometer ausência byte a byte de metadados anti-replay. A limpeza nativa vale para o aparelho
que executou o fluxo. Outro aparelho offline pode conservar estado local; reabrir o app não prova a
limpeza. Esse aparelho precisa executar sua própria exclusão ou ser desinstalado, enquanto o Hub
bloqueia novos envios por estar desativado/sem consentimento.

A exclusão no Hub também não apaga automaticamente:

- backups do operador;
- logs de containers/proxy;
- dados mantidos por provedores externos;
- PBF, grafos Valhalla ou PMTiles, que são dados geográficos compartilhados;
- calendários, entidades e recursos na fonte original.

Se `eraseAll` nativo não conseguir confirmar a exclusão do filesystem, o cliente reporta falha e
não apresenta sucesso completo. No iOS, `platformCleanup: "requested"` é honesto: o store já foi
apagado, mas CoreLocation remove regiões de forma assíncrona. No Android, workers de transição/rearm
são cancelados e Play Services é reconciliado; ainda assim somente teste físico verifica o
comportamento do aparelho e do fabricante.

## Recuperação após restart

- O journal JSONL é fsyncado e tolera cauda incompleta. Um checkpoint de compactação vence snapshot
  antigo que tenha sobrevivido a uma queda.
- O tombstone de exclusão é autoritativo no boot e remove diretório pessoal restaurado por engano.
- Escritas proativas em andamento carregam uma geração e são rejeitadas depois da exclusão. Ações
  externas `running` sem processo recuperável viram `uncertain`; nunca são repetidas como sucesso.
- Handoff de navegação recupera o prazo de ACK e, se ele vencer, vira `uncertain`. CalDAV retoma cache
  incremental por principal/fonte sem persistir detalhes quando o grant é busy/free.
- A fila nativa reentrega o mesmo ID depois de restart/lease expirado e só o remove após ACK.

Para apagar o banco local Nominatim, pare o Compose e remova o volume somente após backup/decisão
explícita. `docker compose down -v` é destrutivo e não aparece em scripts automáticos.

## Licenças e dados abertos

Dados abertos ainda possuem obrigações. Mapas e exports baseados em OSM devem exibir atribuição
legível e referência à ODbL. Consulte [ATTRIBUTIONS.md](../../ops/context/ATTRIBUTIONS.md) e os termos
da instância específica de eventos, clima, recarga ou cultura.

## Limites de certificação

Testes Node, Playwright, Kotlin/Swift e inspeção de manifests comprovam contratos automatizáveis;
não comprovam permissões, entrega em background, energia, limpeza assíncrona do SO ou comportamento
de backup em aparelho real. Este checkout não contém relatório físico nem aprovação de loja. Privacy
manifest, usage descriptions e build assinado são pré-requisitos, não aprovação da App Store ou da
Play Store. Veja a [matriz e os gates pendentes](traceability.md#gates-físicos-e-de-distribuição).

Este documento descreve controles técnicos; não substitui análise jurídica, RIPD/LGPD, App Privacy,
Data safety ou políticas de publicação vigentes das lojas móveis.
