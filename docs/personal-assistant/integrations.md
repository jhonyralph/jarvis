# Contratos de integrações

Fontes privadas são configuradas pelo owner e armazenadas por `principalId`. O Hub devolve para a
UI apenas a visão sem `secretRef`, acrescida de `hasSecret`. Consentimento por fonte e propósito é
independente da existência da conexão: configurar não autoriza consultar.

## Contrato comum

Uma conexão possui:

| Campo | Regra |
|---|---|
| `id` | identificador estável, até 200 caracteres no protocolo |
| `type` | adapter listado abaixo |
| `label` | nome visível, até 100 caracteres |
| `enabled` | desativa o adapter sem apagar sua configuração |
| `endpoint` | URL absoluta ou comando stdio, conforme o tipo |
| `secretRef` | nome de env do Hub; nunca o segredo em si |
| `config` | no máximo 50 chaves simples/arrays de strings |
| `allowedResources` | allowlist explícita, deduplicada, no máximo 100 itens |
| `allowedActions` | grants explícitos, deduplicados, no máximo 100 itens |

Endpoints HTTP não aceitam credenciais embutidas. Loopback, LAN e endereços Tailscale podem ser
autorizados; HTTPS remoto exige `config.allowRemoteHttps=true`. Redirects e respostas continuam
limitados pelo adapter. HTTP remoto inseguro não é um caminho suportado.

## Fontes geográficas, clima e eventos

| `type` | Endpoint/configuração | Propósito |
|---|---|---|
| `nominatim` | raiz HTTP(S); `config.email` opcional | nearby/mobility |
| `valhalla` | raiz do serviço; Hub chama `/route` | mobility |
| `osm` | endpoint Overpass `/api/interpreter` | nearby |
| `open_charge_map` | endpoint POI; `secretRef` para chave quando exigida | nearby/mobility |
| `open_meteo` | endpoint `/v1/forecast` | weather |
| `mapas_culturais` | endpoint de eventos; `attribution` e `timeZone` | events |
| `open_events` | feed HTTP(S); `format=ics`, `rss` ou `jsonld` | events |

`config.purposes` restringe ainda mais os propósitos do descriptor. Cada resultado carrega
`sourceId`, `recordId`, horário observado, freshness e atribuição; a UI não deve remover essa
proveniência.

## CalDAV somente leitura

Use `type=caldav` com:

- `endpoint`: raiz DAV HTTPS ou HTTP apenas em loopback;
- `secretRef`: credencial no ambiente do Hub;
- `allowedResources`: hrefs de calendários permitidos; vazio habilita discovery same-origin;
- `config.access`: `busy_free` (default) ou `details`;
- `config.timeZone`: timezone IANA de fallback.

Formatos de segredo aceitos:

```dotenv
CALDAV_WORK={"username":"<redacted>","password":"<redacted>"}
CALDAV_TOKEN={"token":"<redacted>"}
```

Também existem os formatos compactos `usuario:senha` e bearer bruto, mas JSON evita ambiguidade.
Não coloque usuário/senha na URL.

O adapter envia apenas `PROPFIND` e `REPORT`, usa `sync-token`/ETag quando disponíveis, não segue
calendários cross-origin e limita tamanho, janela e número de ocorrências. Em `busy_free`, solicita e
mantém somente UID/tempo/recorrência/status/transparência necessários para intervalos ocupados; título,
descrição, local, participantes e URL não entram no candidato. `details` deve ser habilitado somente
quando o caso de uso e o consentimento justificarem a exposição.

Falha de um calendário selecionado pode produzir resultado parcial; falha de todos derruba apenas
essa fonte. Revogar consentimento ou remover a fonte deve limpar o uso do cache associado.

## MCP

### Streamable HTTP

Use `type=mcp_http`:

- `endpoint`: endpoint Streamable HTTP;
- `config.certification`: `first_party`, `audited` ou `uncertified` (default);
- `config.allowRemoteHttps=true`: necessário para host remoto fora de LAN/Tailscale;
- `secretRef`: bearer opcional no ambiente do Hub;
- `allowedResources`: URIs MCP exatas;
- `allowedActions`: somente grants `read:<tool>`.

Somente profiles `first_party` e `audited` participam de consultas automáticas. Em um servidor
`uncertified`, resources não são lidos automaticamente e cada grant `read:<tool>` aparece como uma
ação explícita `external_reversible`, com preview e confirmação. A certificação é uma decisão do
owner; annotations declaradas pelo próprio servidor não promovem confiança.

O perfil HTTP é deliberadamente read-only. Um grant de ação
`external_reversible:<tool>` ou `consequential:<tool>` é rejeitado na compilação, mesmo que a UI o
envie. Isso evita transformar um servidor HTTP remoto em executor genérico.

### Stdio local

Use `type=mcp_stdio`:

- `endpoint`: executável/comando local;
- `config.args`: array de argumentos;
- `config.cwd`: diretório de trabalho opcional;
- `secretRef`: se presente, é entregue ao processo filho como `JARVIS_MCP_SECRET`;
- `allowedResources`: URIs exatas;
- `allowedActions`: `<risco>:<nome-da-tool>`.

Riscos aceitos: `read`, `local_reversible`, `external_reversible` e `consequential`. Tools de leitura
podem participar da consulta; demais viram executores com preview/confirmação conforme o risco.

O cliente MCP aplica schema fechado aos argumentos padrão (`query`, `purpose`, `startAt`, `endAt`),
limites de bytes/páginas/itens, allowlist de tool/resource, timeout, redirecionamento restrito e
redação de chaves sensíveis. Resultado genérico é limitado e mapeado para candidatos; não trate MCP
não auditado como fronteira de segurança.

## Home Assistant REST

Use `type=home_assistant`:

- `endpoint`: raiz da instância, sem `/api` no final;
- `secretRef`: Long-Lived Access Token no ambiente do Hub;
- `allowedResources`: allowlist não vazia de `entity_id`;
- `config.attributes`: atributos liberados para todas as entidades da conexão;
- `config.serviceDataFields`: campos extras permitidos em chamadas de serviço;
- `allowedActions`: grants no formato abaixo.

```text
local_reversible:light.turn_on@light.sala|light.cozinha
external_reversible:climate.set_temperature@climate.quarto
consequential:lock.unlock@lock.porta_principal
```

Sem o sufixo `@...`, o grant usa as entidades de `allowedResources`. Domínio, serviço, entidades e
campos de dados são validados antes do request. Domínios como `alarm_control_panel`, `automation`,
`cover`, `lock` e `script` são promovidos a consequential mesmo se configurados com risco menor.

Leituras usam `/api/states/<entity_id>` e retornam somente estado, timestamps e atributos
allowlisted. Ações usam `/api/services/<domain>/<service>`, depois tentam verificar novamente as
entidades permitidas. Sucesso HTTP sem verificação completa não é apresentado como verificação
garantida.

## Ações e confirmação

- `read`: pode executar automaticamente dentro do consentimento.
- `local_reversible`: preview e política local; ainda precisa de idempotência.
- `external_reversible`: preview e confirmação vinculada ao hash/challenge.
- `consequential`: sempre exige confirmação válida e não reutilizável.

O payload bruto fica no plano interno; a visão enviada ao cliente contém resumo/impacto e estado. O
botão Parar/cancelar não reverte um efeito externo já confirmado; executores devem ser idempotentes e
relatar verificação parcial de forma explícita.

Handoffs executados pelo dispositivo, como abrir navegação ou outro aplicativo, usam confirmação em
duas fases. O Hub marca o plano como aguardando o cliente e persiste `clientAckExpiresAt`; somente um
ACK válido conclui a ação. Se o app fechar, reiniciar ou não confirmar antes do prazo, a reconciliação
move o plano para `uncertain`. Um ACK atrasado não converte esse estado em sucesso.

Consultas que registram ações ou uso de preferências devolvem a revisão atual do estado pessoal. A UI
deve usar essa revisão na mutação seguinte, em vez da revisão anterior à consulta. `lastUsedAt` é
metadado exclusivo do Hub: o cliente pode ver a recência, mas não pode defini-la em
`personal_preference_put`.
