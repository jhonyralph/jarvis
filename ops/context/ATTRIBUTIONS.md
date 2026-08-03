# Licencas e atribuicoes do Context Engine

Revisado em 2026-08-01. Este inventario nao substitui os textos das licencas nem os termos da
fonte de dados escolhida pelo operador.

| Componente/dado | Versao desta operacao | Licenca/obrigacao principal | Referencia |
|---|---:|---|---|
| Nominatim | 5.3.2 | Python GPL-3.0-or-later; configuracao Lua Apache-2.0; demais arquivos GPL-2.0 | [Nominatim](https://github.com/osm-search/Nominatim) |
| Nominatim Docker | imagem 5.3.2 | Wrapper Docker CC0-1.0; componentes internos preservam suas licencas | [mediagis/nominatim-docker](https://github.com/mediagis/nominatim-docker) |
| Valhalla scripted | 3.8.3 | MIT | [Valhalla](https://github.com/valhalla/valhalla) |
| go-pmtiles | v1.31.2 | BSD-3-Clause; especificacao PMTiles em dominio publico/CC0 quando aplicavel | [PMTiles](https://github.com/protomaps/PMTiles) |
| OpenStreetMap | conforme o extrato | ODbL 1.0; mostrar `OpenStreetMap contributors` e ligar para a pagina de copyright | [OSM copyright](https://www.openstreetmap.org/copyright) |
| Protomaps basemap | conforme o build escolhido | Tiles ODbL; codigo BSD-3-Clause; design CC0. Preserve os avisos do build | [Protomaps basemaps](https://github.com/protomaps/basemaps) |
| Geofabrik | conforme o extrato | OSM/ODbL; respeitar os termos de download e atribuicao do provedor | [Geofabrik](https://download.geofabrik.de/) |

O estilo em `map/style.json` mantem a atribuicao OSM visivel via metadata da fonte. Ao exportar uma
imagem, gerar PDF ou usar outro renderer, a aplicacao exportadora tambem precisa preservar a
atribuicao em local legivel. Nao remova a origem dos candidatos retornados pelo Context Engine.

As fontes opcionais Open-Meteo, Open Charge Map, Mapas Culturais, feeds ICS/RSS/JSON-LD, CalDAV,
MCP e Home Assistant nao sao redistribuidas por este Compose. Quem as configurar deve revisar os
termos da instancia e do conjunto de dados usado, registrar a atribuicao na configuracao da fonte e
nao assumir que software aberto implica dados sem restricoes.
