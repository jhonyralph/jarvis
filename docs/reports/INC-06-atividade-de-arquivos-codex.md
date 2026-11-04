# INC-06 — Arquivos do Codex ausentes na atividade do Jarvis

Data: 2026-11-04. Base: `534f9d9`. Formato observado: Codex CLI `0.154.0`.

## Diagnóstico

A imagem enviada corresponde a uma sessão de subagente do Claude: suas chamadas
`Read`, `Edit` e `Write` já fornecem caminho e conteúdo diretamente. No Codex, os
registros reais contêm `event_msg.item_completed` com itens `CommandExecution` e
`FileChange`. Os leitores do Jarvis ignoravam esses itens e esperavam o envelope
antigo `patch_apply_end`. A perda ocorria na transmissão, histórico, subagentes e
lista de arquivos; não era uma ausência de informação no provedor.

Outro problema era interpretar toda chamada externa `exec` como shell. No modo
que agrupa ferramentas em código JavaScript, ela apenas coordena chamadas; os
comandos e alterações reais aparecem nos itens internos gravados depois.

## Comparação com sessões reais

Auditoria em 04/11 às 14:59:18 (America/Sao_Paulo). Foram percorridas todas as
linhas disponíveis naquele momento em quatro arquivos selecionados, aproximadamente
47 MB. O leitor de `534f9d9` e o corrigido receberam exatamente cada mesma linha;
os registros originais não foram alterados. Os totais contam eventos, não arquivos
distintos. Sessões em execução continuam crescendo depois desse recorte.

| Sessão | Read antes → depois | Edit antes → depois | Write antes → depois |
| --- | ---: | ---: | ---: |
| Codex principal | 0 → 80 | 0 → 20 | 0 → 6 |
| Codex paralela | 0 → 127 | 0 → 46 | 0 → 26 |
| Claude da imagem | 1 → 1 | 13 → 13 | 11 → 11 |
| Claude principal | 38 → 38 | 129 → 129 | 23 → 23 |

O novo leitor também recuperou pesquisas web, comandos e leitura de imagem.
Tentativas malsucedidas ficam identificadas como falhas, fora da lista de arquivos
alterados com sucesso. A auditoria não representa todas as sessões da máquina nem
certifica outras versões de CLI. O JSON com os demais contadores e o script de
comparação ficam somente na pasta local de evidências, sem conteúdos privados no Git.

## Alteração

- `packages/core/src/codex-activity.ts`: tradução compartilhada de itens atuais e
  envelopes antigos. Preserva caminhos, identidade, estado, contagens e linhas de
  diff; distingue o agrupamento JavaScript de comandos shell. Usa `parsed_cmd`
  quando disponível e reconhece leituras literais conservadoramente. Não executa
  comandos nem avalia variáveis para descobrir caminhos.
- `packages/core/src/agents.ts`: stdout e polling usam essa tradução. A mesma
  identidade de ferramenta deduplica cópias entre os dois canais. Permanecem a
  leitura assíncrona incremental, teto de 8 MB por leitura, parsing em lotes e
  espera pelo polling antes do flush final introduzidos no INC-05.
- `packages/core/src/native.ts`: histórico, acompanhamento nativo e painel de
  arquivos recebem os mesmos dados. Unifica separadores Windows na lista e permite
  abrir o diff completo de arquivos criados quando excede o limite inline.
- `packages/core/src/codex-executions.ts`: subagentes passam a projetar os itens
  atuais; repetição do mesmo item não soma a edição novamente. Respostas a chamadas
  antigas preservam caminho e detalhe da chamada inicial.
- `packages/core/src/codex-activity.test.ts` e `codex-rollout-io.test.ts`: regressões
  baseadas em formas reais, com conteúdo e caminhos anonimizados, e CLI simulado
  para testar stdout, polling, flush e ausência de emissão depois do término.

As alternativas eram apenas renomear chamadas genéricas (continuaria perdendo
diffs), adaptar os registros disponíveis (implementado) ou trocar o protocolo de
integração com o CLI (mudança maior, desnecessária para esta falha). A tradução foi
extraída para impedir que os quatro leitores voltem a divergir.

## Validação

Os três primeiros testes reproduziram a falha antes da implementação. Os testes
adversariais cobrem múltiplos arquivos, caminhos com espaços, texto que apenas cita
`Get-Content`, variáveis, mudança de diretório, chamadas antigas, falhas, exit code
negativo, repetição, separadores Windows, arquivo vazio, diff grande, caracteres
que se parecem com cabeçalhos de diff, JSON incompleto e itens desconhecidos.

- `npm run typecheck`: aprovado.
- Primeira suíte completa: 1.711 testes, 1.701 aprovados, dez pulados, zero falhas.
- `npm test` final após revisão: 1.712 testes, 1.702 aprovados, dez pulados,
  zero falhas (95,2 segundos). Inclui os dez novos testes de atividade e o teste
  ampliado de stdout/polling.
- Reprodução dos quatro registros reais: comparação acima; Claude preservado.
- `nativeHistoryAsync` e `sessionFiles` nos dois rollouts Codex reais: histórico
  reconstruído e 52/87 arquivos reconhecidos. O coletor do subagente real recuperou
  199 atividades de arquivos e o estado `succeeded`. Essa leitura posterior já
  inclui novos eventos gerados depois da tabela.
- `git diff --check`: aprovado.

## Estado e limites

Commit desta alteração autorizado pelo usuário após a validação e apresentação
do diff. O commit de estabilidade anterior é `534f9d9`. A ativação das duas correções continua
pendente do reinício controlado: o usuário escolheu aguardar os trabalhos ativos.
Nenhum serviço foi reiniciado nesta etapa.

Os cartões existentes da interface são reutilizados. Não houve reformulação da
UI, mudança de modelo/permissões, atualização de CLI, migração de histórico ou
alteração no leitor Claude. Não foi executado um novo turno pago com o provedor
nem validada visualmente a UI de produção após deploy. A validação usa registros
reais e um processo CLI simulado; o teste visual no Hub atualizado permanece
pendente da ativação.

Leituras feitas dentro de scripts complexos continuam como comandos quando não
há um caminho inequívoco. Eventos disponíveis somente como `item_completed`
aparecem após a conclusão da operação. Registros anteriores de sessões gerenciadas
que já foram salvos sem atividade não são reescritos; o leitor de histórico nativo
consegue recuperar os itens existentes no transcript. Mantêm-se os tetos de
histórico existentes e não se promete recuperar partes fora dessas janelas.

Evidências locais: `C:\Users\Jonathan\.jarvis\evidence\2026-11-04-stability`,
arquivos `audit-codex-claude.mjs`, `codex-claude-session-audit.json`,
`codex-activity-targeted.log`, `codex-activity-full-suite.log` e
`codex-activity-final-suite.log`.
