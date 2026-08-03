# Context Engine autohospedado

Esta pasta oferece sidecars opcionais para geocodificacao (Nominatim), rotas (Valhalla) e servico
ZXY de arquivos PMTiles. Todos os servicos usam tags exatas, profiles do Compose, rede sem saida e
portas em loopback. Nenhum profile fica ativo por padrao e nenhum dado geografico e baixado pelo
setup.

Comece por [instalação autohospedada](../../docs/personal-assistant/installation.md) e execute:

```sh
node scripts/context-setup.mjs --region belo-horizonte --profiles nominatim,valhalla,pmtiles
node scripts/context-doctor.mjs --offline
```

Depois de colocar os artefatos locais indicados pelo setup, rode o doctor com rede e inicie apenas
os profiles desejados. O Hub funciona sem estes sidecars em modo degradado; nenhuma API paga e
obrigatoria.
