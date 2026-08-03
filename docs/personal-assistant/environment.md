# Catálogo de variáveis

Este catálogo foi derivado de busca direta nas árvores `apps/hub/src` e `packages/core/src`, além de
`ops/context/compose.yaml`, em 2026-08-01. O doctor repete essa busca: uma variável contextual nova no
código ou removida do Compose gera `contract.*` em erro até catálogo, exemplo e documentação serem
atualizados.

## Variáveis consumidas pelo Hub/Core

Todas são opcionais. Variável ausente e variável vazia não são sempre equivalentes: para endpoints
com fallback, não exporte `NAME=`; remova a variável para usar o default.

| Variável | Uso/default efetivo | Sensível | Referência direta |
|---|---|---:|---|
| `JARVIS_CONTEXT_TIMEZONE` | timezone de Mapas Culturais/feeds; defaults variam por adapter | não | `personalSources.ts` |
| `JARVIS_EVENTS_ATTRIBUTION` | texto de atribuição do feed global | não | `personalSources.ts` |
| `JARVIS_EVENTS_FEED_FORMAT` | `ics`, `rss` ou `jsonld`; outro valor cai em JSON-LD | não | `personalSources.ts` |
| `JARVIS_EVENTS_FEED_URL` | ativa um feed global de eventos | não | `personalSources.ts` |
| `JARVIS_HOME` | base do estado; personal fica em `<JARVIS_HOME>/.jarvis/personal` | caminho | `personal-store.ts` |
| `JARVIS_MAPAS_CULTURAIS_URL` | ativa o adapter global Mapas Culturais | não | `personalSources.ts` |
| `JARVIS_MAP_STYLE_FILE` | arquivo JSON MapLibre servido pelo Hub | caminho | `index.ts` |
| `JARVIS_NOMINATIM_EMAIL` | identificação adicional para uso do endpoint público | dado de contato | `personalSources.ts` |
| `JARVIS_NOMINATIM_URL` | endpoint Nominatim autohospedado; ausente desabilita geocodificação integrada | não | `personalSources.ts` |
| `JARVIS_OCM_API_KEY` | ativa a fonte global Open Charge Map | sim | `personalSources.ts` |
| `JARVIS_OCM_URL` | endpoint OCM; com chave e ausente usa o endpoint oficial | não | `personalSources.ts` |
| `JARVIS_OPEN_METEO_URL` | endpoint de forecast; ausente usa Open-Meteo público | não | `personalSources.ts` |
| `JARVIS_OVERPASS_URL` | endpoint Overpass; ausente usa a instância pública configurada no core | não | `personalSources.ts` |
| `JARVIS_PMTILES_FILE` | arquivo PMTiles v3 servido em `/context/maps/region.pmtiles` | caminho | `index.ts` |
| `JARVIS_PERSONAL_PROACTIVE` | `0` desliga globalmente o scheduler proativo; ausente mantém o scheduler disponível para aparelhos com opt-in | não | `index.ts` |
| `JARVIS_PERSONAL_PROACTIVE_INTERVAL_MIN` | intervalo do scheduler em minutos; default `5`, mínimo efetivo `1` | não | `index.ts` |
| `JARVIS_VALHALLA_URL` | ativa rotas Valhalla no Hub | não | `personalSources.ts` |

`JARVIS_OCM_API_KEY` não é requisito do produto. Sem ela, a fonte dedicada OCM fica desativada; POIs
OSM autorizados ainda podem encontrar estações mapeadas pelo Overpass.

## Variáveis do Compose opcional

Estas são consumidas por `ops/context/compose.yaml`, não pelo código TypeScript.

| Variável | Default | Função |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `jarvis-context` | namespace dos recursos Docker |
| `COMPOSE_PROFILES` | vazio | profiles ativos: `nominatim`, `valhalla`, `pmtiles` ou `all` |
| `CONTEXT_BIND_HOST` | `127.0.0.1` | endereço onde as portas são publicadas |
| `CONTEXT_NOMINATIM_IMAGE` | `mediagis/nominatim:5.3.2` | imagem fixada do geocoder |
| `CONTEXT_NOMINATIM_IMPORT_STYLE` | `full` | estilo de importação Nominatim |
| `CONTEXT_NOMINATIM_PASSWORD` | sem default seguro | senha interna gerada pelo setup |
| `CONTEXT_NOMINATIM_PORT` | `8080` | porta local do Nominatim |
| `CONTEXT_NOMINATIM_SHM_SIZE` | `1gb` | shared memory do container |
| `CONTEXT_NOMINATIM_THREADS` | `4` | threads de importação |
| `CONTEXT_NOMINATIM_WORKERS` | `2` | workers HTTP |
| `CONTEXT_PBF_FILE` | `./runtime/imports/region.osm.pbf` | PBF local montado read-only |
| `CONTEXT_PMTILES_ARCHIVE` | `region.pmtiles` | nome do arquivo dentro do diretório PMTiles |
| `CONTEXT_PMTILES_CORS` | `http://127.0.0.1:4577` | origins do sidecar ZXY, não da rota do Hub |
| `CONTEXT_PMTILES_DIR` | `./runtime/pmtiles` | diretório local de archives |
| `CONTEXT_PMTILES_IMAGE` | `protomaps/go-pmtiles:v1.31.2` | imagem fixada do sidecar |
| `CONTEXT_PMTILES_PORT` | `8081` | porta local do sidecar ZXY |
| `CONTEXT_PMTILES_PUBLIC_URL` | `http://127.0.0.1:8081` | URL anunciada no TileJSON |
| `CONTEXT_VALHALLA_DIR` | `./runtime/valhalla` | grafos e configuração persistentes |
| `CONTEXT_VALHALLA_IMAGE` | `ghcr.io/valhalla/valhalla-scripted:3.8.3` | imagem fixada de routing |
| `CONTEXT_VALHALLA_PORT` | `8002` | porta local do Valhalla |
| `CONTEXT_VALHALLA_THREADS` | `2` | threads de build/serviço |

Os caminhos relativos do Compose são relativos a `ops/context`. O setup grava caminhos absolutos
com separador compatível com Docker Desktop.

## Segredos dinâmicos (`secretRef`)

CalDAV, MCP e Home Assistant não leem nomes fixos de segredo. O owner escolhe na configuração da
fonte um `secretRef` que deve corresponder a `^[A-Z][A-Z0-9_]{1,100}$`; o Hub resolve
`process.env[secretRef]` no momento do uso. Exemplos de nomes, não requisitos:

```dotenv
JARVIS_CALDAV_SECRET={"username":"<redacted>","password":"<redacted>"}
JARVIS_MCP_AUTH_TOKEN=<redacted>
JARVIS_HOME_ASSISTANT_TOKEN=<redacted>
```

Não coloque valores reais em `ops/context/env.example`, documentação, source connection ou output de
diagnóstico. Reinicie o Hub depois de alterar seu ambiente. A UI retorna apenas `hasSecret`, nunca o
nome resolvido nem o valor.

## Precedência e verificação

1. O processo do Hub lê seu ambiente; os scripts de start também carregam `~/.jarvis/hub.env`.
2. Docker Compose recebe `--env-file ops/context/.env`; variáveis já exportadas no shell têm
   precedência do Compose.
3. `ops/context/.env` não é injetado automaticamente no Hub.
4. `node scripts/context-doctor.mjs --json` informa presença e validade, mas redige segredos.
