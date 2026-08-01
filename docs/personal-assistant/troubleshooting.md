# Troubleshooting

## Doctor

```sh
node scripts/context-doctor.mjs --offline
node scripts/context-doctor.mjs
node scripts/context-doctor.mjs --strict --json > context-doctor.json
```

Exit codes:

| Código | Significado |
|---:|---|
| 0 | nenhum erro; warnings são permitidos sem `--strict` |
| 1 | check em erro, ou warning com `--strict` |
| 2 | argumento inválido ou falha fatal do próprio doctor |

Modos comuns:

- `degraded-public-fallback`: sidecars locais não configurados; Overpass/Open-Meteo e feeds públicos autorizados podem funcionar, mas Nominatim não possui fallback público automático.
- `self-hosted-degraded`: pelo menos um recurso local existe, mas há warnings/recursos opcionais.
- `self-hosted-ready`: recursos configurados passaram sem warning.
- `invalid`: configuração explícita está inconsistente.

## Compose não inicia serviço algum

Todos os serviços têm profiles. Confira `COMPOSE_PROFILES` no `.env` ou selecione um alvo:

```sh
docker compose --env-file ops/context/.env -f ops/context/compose.yaml config --profiles
docker compose --env-file ops/context/.env -f ops/context/compose.yaml up -d nominatim
```

`COMPOSE_PROFILES=none` não significa vazio; remova o valor ou deixe `COMPOSE_PROFILES=`.

## PBF ausente ou virou diretório

Docker pode criar um diretório quando um bind source inexistente é usado em algumas combinações de
versão/plataforma. Pare o serviço, remova somente esse diretório vazio após conferir o caminho e
coloque um arquivo `.osm.pbf` real. O doctor exige arquivo não vazio e extensão correta antes do
start recomendado.

No Windows, use caminho absoluto com `/`, deixe o drive compartilhado no Docker Desktop e evite
diretório protegido por Controlled Folder Access.

## Nominatim fica `starting`

O primeiro import é CPU/disco intensivo. `start_period: 24h` impede falso unhealthy durante a
construção, mas não prova progresso. Verifique:

```sh
docker compose --env-file ops/context/.env -f ops/context/compose.yaml logs --tail 200 nominatim
docker compose --env-file ops/context/.env -f ops/context/compose.yaml ps
```

Confirme PBF, espaço em disco, memória compartilhada e permissões. Não apague o volume enquanto o
import estiver ativo. Se uma importação foi interrompida/corrompida, consulte o guia Nominatim da
mesma versão antes de decidir reimportar.

## Valhalla não responde em `/status`

Durante o primeiro build, a API pode não estar pronta. Confira logs e conteúdo de
`CONTEXT_VALHALLA_DIR`. O Compose desativa elevation, transit e default-speeds download; um PBF local
válido é obrigatório. Reduza `CONTEXT_VALHALLA_THREADS` se o processo for encerrado por memória.

Substituir PBF pode disparar rebuild pelo hash. Não misture grafo de uma região com PBF de outra no
mesmo diretório.

## PMTiles válido, mas mapa vazio

O doctor valida header v3 e JSON do style; ele não consegue provar que os `source-layer` do archive
combinam com `map/style.json`. Inspecione:

```sh
docker run --rm -v <diretorio>:/data protomaps/go-pmtiles:v1.31.2 show /data/<arquivo>.pmtiles --metadata
docker run --rm -v <diretorio>:/data protomaps/go-pmtiles:v1.31.2 verify /data/<arquivo>.pmtiles
```

O estilo fornecido espera camadas do basemap Protomaps (`earth`, `landuse`, `water`, `buildings`,
`roads`). Um archive criado com outro schema precisa de outro style. Reinicie o Hub depois de mudar
`JARVIS_PMTILES_FILE`/`JARVIS_MAP_STYLE_FILE`.

O sidecar `pmtiles serve` oferece ZXY/TileJSON, mas não serve o arquivo PMTiles bruto. A UI Jarvis usa
a rota range própria do Hub; são caminhos distintos.

## Endpoint local responde no browser, mas o Hub não usa

- Confirme que as linhas `JARVIS_*` foram colocadas no ambiente do processo do Hub, não apenas no
  `.env` do Compose.
- Reinicie o Hub: env é lida no boot.
- Preserve `/` final nas raízes Nominatim/Valhalla.
- Se o Hub estiver em container, `127.0.0.1` não aponta para o host.
- Rode doctor com o mesmo `--env-file` e usuário do serviço.

## Fonte pública intermitente/rate-limited

O Hub não usa Nominatim público automaticamente. Se o owner configurar explicitamente um endpoint
público, ele é apenas para busca direta de baixo volume, nunca autocomplete, e continua sujeito à
política do operador. Overpass público pode estar sobrecarregado. O registry usa limite de
concorrência, timeout, circuit breaker e stale limitado, então um resultado parcial é esperado.
Respeite atribuição e políticas, reduza frequência ou configure uma instância apropriada.

Sem DNS/internet, clima, eventos/feed, Overpass e OCM remotos falham independentemente dos sidecars
locais. Isso não deve marcar o Hub inteiro como failed.

## CalDAV

- `401/403`: confira `secretRef` no ambiente do Hub e reinicie o processo.
- discovery vazio: preencha hrefs same-origin em `allowedResources`.
- cross-origin/query rejeitado: use a raiz DAV canônica sem credenciais/query.
- resultado só busy/free: é o default de privacidade; `details` precisa ser explícito.
- uma agenda falha: resultado pode ser parcial; todas falham: a fonte fica indisponível.

## MCP

- HTTP sem `first_party`/`audited` é rejeitado.
- HTTP com tool de ação é rejeitado pelo perfil read-only.
- tool/resource fora da allowlist não é chamado.
- schema aberto, campo sensível ou resposta acima do limite falha fechado.
- stdio não inicia: confira comando, args, cwd e ambiente do usuário que executa o Hub.

## Home Assistant

- A allowlist de entidades deve ser não vazia e usar IDs válidos.
- Token deve ser Long-Lived Access Token no `secretRef`, sem `Bearer ` no valor.
- Endpoint é a raiz; o adapter acrescenta `/api/...`.
- Serviço/entidade/campo fora do grant falha antes do request.
- Locks, covers, scripts, alarms e automations são consequential mesmo com risco menor configurado.

## Mobile

Foreground location exige app visível. Android `store` não possui background geofence; use o flavor
sideload apenas quando apropriado. No iOS, conceder When In Use não equivale a Always. Teste aparelho
real, tela bloqueada, reboot, precisão aproximada e permissão revogada. Veja [mobile.md](mobile.md).

## Compartilhar diagnóstico

O JSON do doctor não inclui valores de token/senha/chave, mas pode revelar nome de usuário em caminho
local, host interno, ports e estrutura de diretórios. Revise e redija esses metadados antes de enviar
fora do time.
