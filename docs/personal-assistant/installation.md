# Instalação autohospedada

## Pré-requisitos

- Node.js 22 ou mais novo.
- Docker Engine/Desktop com o plugin Docker Compose, apenas se algum sidecar for usado.
- Um PBF regional para Nominatim/Valhalla e um PMTiles regional para mapa, conforme os profiles.
- Espaço em disco e memória dimensionados para a região. Importações variam muito; consulte a
  documentação upstream antes de escolher um extrato grande.

O Hub continua utilizável sem Docker. O Compose é opcional, não expõe banco PostgreSQL e publica
somente em `127.0.0.1` por padrão.

## 1. Gerar a configuração

Para Belo Horizonte:

```sh
node scripts/context-setup.mjs --region belo-horizonte --profiles nominatim,valhalla,pmtiles
```

Para um smoke test com uma região pequena:

```sh
node scripts/context-setup.mjs --region monaco --profiles nominatim,valhalla
```

O setup:

1. valida `regions/<id>.json` e `versions.json`;
2. cria apenas diretórios locais e, se ausente, `ops/context/.env`;
3. gera uma senha aleatória para o banco interno do Nominatim;
4. nunca sobrescreve um `.env` existente;
5. não baixa PBF/PMTiles, não puxa imagens e não inicia containers.

Use `--dry-run --json` para integrar o plano a outra automação sem escrever no disco. Se o `.env`
já existir, o setup o preserva integralmente; altere-o conscientemente ou use outro `--env-file`.

## 2. Preparar os dados

Os destinos exatos aparecem na saída do setup e em `ops/context/.env`.

### PBF

Para `monaco`, a configuração regional contém um link direto pequeno da Geofabrik. Para Belo
Horizonte, o catálogo oficial indicado oferece um extrato do Brasil, não um recorte canônico da
cidade. Baixar esse arquivo sem revisar tamanho e recursos não é uma boa operação padrão.

O fluxo recomendado é:

1. escolher uma fonte OSM confiável e registrar data/checksum;
2. obter ou produzir um `.osm.pbf` recortado pelo bbox de `regions/belo-horizonte.json`;
3. gravá-lo exatamente no caminho `CONTEXT_PBF_FILE`;
4. preservar a atribuição OSM/ODbL.

Ferramentas como `osmium extract` podem criar o recorte a partir de um PBF maior. A aquisição do
arquivo maior é uma decisão explícita do operador e não faz parte do setup.

### PMTiles

Escolha um build datado no [catálogo Protomaps](https://maps.protomaps.com/builds/) e extraia apenas
o bbox regional. Exemplo intencionalmente parametrizado:

```sh
docker run --rm -v <diretorio-pmtiles>:/data protomaps/go-pmtiles:v1.31.2 \
  extract https://build.protomaps.com/<AAAAMMDD>.pmtiles /data/belo-horizonte.pmtiles \
  --bbox=-44.0639,-20.059,-43.856,-19.7763
```

Substitua a data e o diretório, revise o volume estimado e mantenha a origem do build. O comando é
manual: nenhum script Jarvis o executa.

## 3. Validar antes de iniciar

Primeiro valide contratos e arquivos sem rede:

```sh
node scripts/context-doctor.mjs --env-file ops/context/.env --offline
```

Depois valide Docker e endpoints configurados:

```sh
node scripts/context-doctor.mjs --env-file ops/context/.env
```

`--strict` faz warnings falharem, adequado para CI. `--json` produz um objeto sem valores de
segredo; ele ainda contém caminhos e nomes de endpoints, portanto revise antes de compartilhar.

## 4. Iniciar os profiles escolhidos

`COMPOSE_PROFILES` foi gravado no `.env` pelo setup:

```sh
docker compose --env-file ops/context/.env -f ops/context/compose.yaml up -d
docker compose --env-file ops/context/.env -f ops/context/compose.yaml ps
```

Também é possível iniciar um serviço isolado:

```sh
docker compose --env-file ops/context/.env -f ops/context/compose.yaml up -d valhalla
```

O primeiro import pode demorar. Nominatim e Valhalla têm `start_period` longo para não serem
marcados como unhealthy durante uma construção legítima. Acompanhe sem expor logs publicamente:

```sh
docker compose --env-file ops/context/.env -f ops/context/compose.yaml logs -f nominatim
```

O Compose regional não ativa `flatnode`: o próprio Nominatim recomenda esse armazenamento para
extratos grandes, e montá-lo muda o modo de importação automaticamente. Quem ampliar a operação para
regiões muito maiores deve dimensionar disco e revisar essa opção diretamente na documentação da
mesma versão antes de alterar o Compose.

## 5. Configurar o processo do Hub

O Hub não lê `ops/context/.env` automaticamente. Copie somente as linhas `JARVIS_*` aplicáveis para
o ambiente do processo ou para:

- Windows: `%USERPROFILE%\.jarvis\hub.env`
- macOS/Linux: `~/.jarvis/hub.env`

Exemplo local completo:

```dotenv
JARVIS_NOMINATIM_URL=http://127.0.0.1:8080/
JARVIS_VALHALLA_URL=http://127.0.0.1:8002/
JARVIS_CONTEXT_TIMEZONE=America/Sao_Paulo
JARVIS_PMTILES_FILE=C:/caminho/jarvis/ops/context/runtime/pmtiles/belo-horizonte.pmtiles
JARVIS_MAP_STYLE_FILE=C:/caminho/jarvis/ops/context/map/style.json
```

Use caminhos absolutos para os arquivos. Reinicie o Hub e rode o doctor novamente. Se o Hub estiver
em outro container, `127.0.0.1` aponta para aquele container; configure uma rede/hostname explícito
sem publicar os sidecars na internet.

## Parar, atualizar e remover

Parar preserva volumes e arquivos:

```sh
docker compose --env-file ops/context/.env -f ops/context/compose.yaml down
```

O Compose usa rede interna, `UPDATE_MODE=none` e nenhum URL de download. Atualizar dados exige uma
operação deliberada: backup, substituição do artefato, reconstrução do grafo Valhalla e reimportação
compatível do Nominatim. Leia as notas da versão antes de trocar uma imagem.

Não use `down -v` como rotina: ele exclui o volume do banco Nominatim. O doctor é somente leitura e
nunca executa essa remoção.
