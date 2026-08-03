# Assistente pessoal e Context Engine

O Context Engine combina fontes explicitamente autorizadas para responder perguntas contextuais,
produzir sugestões com proveniência e preparar ações sujeitas a uma política de risco. A operação é
local-first: armazenamento, consentimentos, ranking e auditoria ficam no Hub. Nenhuma API paga é
obrigatória.

"Sem API paga" não significa "sempre offline". Sem sidecars, os adapters incorporados podem usar
Overpass e Open-Meteo quando a fonte e o propósito possuem consentimento. Nominatim não possui
fallback público automático: geocodificação integrada só é registrada com `JARVIS_NOMINATIM_URL`.
Consultas remotas deixam a máquina e seguem os termos de cada provedor. Os sidecars em `ops/context`
reduzem essa dependência para geocodificação, rotas e mapa.

## Componentes

| Componente | Responsabilidade | Obrigatório |
|---|---|---|
| Hub / `PersonalAssistantService` | autenticação, consentimento, isolamento por principal, consultas e ações | sim |
| `PersonalContextStore` | snapshots atômicos, journal JSONL, retenção, exportação e exclusão | sim |
| Registry de fontes | timeout, cache, stale-if-error e circuit breaker por fonte/principal | sim |
| Nominatim | geocodificação e busca por endereço | não |
| Valhalla | rota e duração estimada | não |
| PMTiles | mapa local no Hub ou endpoint ZXY separado | não |
| CalDAV/MCP/Home Assistant | agenda, fontes especializadas e automação privada | não |
| Plugin móvel `JarvisContext` | localização foreground, busy/free e geofences compatíveis com a plataforma | não |

## Modos operacionais

| Modo | Funciona | Limitação esperada |
|---|---|---|
| Hub sem sidecars | memória, consentimentos, lista, ações e fontes públicas autorizadas | geocodificação integrada desativada; depende da internet; mapa-base local ausente |
| Nominatim local | geocodificação local | POIs Overpass, clima e eventos ainda podem depender da internet |
| Nominatim + Valhalla | geocodificação e rotas locais | mapa-base e fontes temáticas continuam opcionais |
| PMTiles no Hub | mapa-base via range requests do próprio Hub | não adiciona geocodificação nem rotas |
| Todos os sidecars, sem internet | geocodificação, rotas e mapa da região carregada | clima, eventos, recarga dedicada e feeds remotos ficam indisponíveis |
| Fonte privada indisponível | demais fontes continuam consultáveis | resultado fica parcial/stale conforme o adapter |

O comando `node scripts/context-doctor.mjs` descreve o modo efetivo. Uma falha de sidecar não deve
impedir o boot do Hub.

## Documentação

- [Rastreabilidade PAC-01 a PAC-25 e gates de certificação](traceability.md)
- [Instalação autohospedada](installation.md)
- [Catálogo de variáveis](environment.md)
- [Contratos de integrações](integrations.md)
- [Privacidade e retenção](privacy.md)
- [Android, iOS, Web e Electron](mobile.md)
- [Troubleshooting](troubleshooting.md)
- [Licenças e atribuições](../../ops/context/ATTRIBUTIONS.md)

As versões de imagens ficam em `ops/context/versions.json`; a revisão atual é de 2026-08-01. Antes
de atualizar uma tag, confira migração, licença, arquitetura da imagem e reexecute o doctor e os
testes de operação.
