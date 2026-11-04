# INC-07 — Histórico de trabalho interrompido após reinício

Data: 2026-11-04. Base: `eee7bf5`. Escopo: recuperação no Jarvis, em Hub e Runner,
para Codex e Claude. Nenhum trabalho dos repositórios DNAutto foi executado aqui.

## Evidência e causa

A sessão Codex indicada pelo usuário corresponde ao plano backend DNAutto P0/P1/P2.
O rollout nativo tinha 121.936.034 bytes e 17.952 linhas no recorte investigado.
Seu último turno terminou com `turn_aborted` às 18:27:33 UTC (15:27:33 em São Paulo),
sem resposta final. A última atualização textual era das 15:25:55 locais.

Havia três falhas na projeção do histórico:

- A reconciliação antiga só procurava uma resposta quando a última mensagem era
  do usuário. Enviar outra pergunta podia esconder permanentemente o trabalho anterior.
- O leitor limitado aos últimos 32 MB cortava o próprio turno longo, perdendo sua
  pergunta e o começo da atividade. O boot anterior já havia persistido essa cauda
  como se fosse a resposta inteira, sem marcá-la como interrompida ou recuperada.
- O replay do journal não era promovido a mensagem durável antes da próxima
  pergunta. A execução nativa também podia ser considerada bem-sucedida apenas
  por existir texto intermediário, sem evento de conclusão do provedor.

## Correção

`packages/core/src/history-recovery.ts` reúne a recuperação usada por Hub e Runner
no boot, na abertura e antes de enviar uma nova pergunta. A pergunta é associada
por texto e horário; a próxima pergunta limita a resposta. Pedidos curtos repetidos
e o prefixo de instruções do Framework são tratados explicitamente. O journal só
é usado com o identificador exato do turno e execução terminal.

`native.ts` ganhou leitura completa em fluxo para recuperação, com pausas entre
lotes, reaproveitamento do cache e limite por registro. Não há uma string com o
arquivo inteiro. Conclusão, interrupção e horários dos trechos vêm do provedor.
No Claude, mensagens internas/compactação não viram perguntas humanas e respostas
de subagentes não encerram o turno principal. Eventos inválidos ou registros acima
do limite ficam sinalizados como leitura truncada; não se promete recuperar dados
ausentes ou registros que não possam ser interpretados.

`store.ts` grava a recuperação atomicamente com backup antes de atualizar sua visão
em memória. Repetições não duplicam mensagens, e mudanças concorrentes impedem a
substituição. Só projeções nativas reconhecíveis são enriquecidas; respostas normais
já persistidas são preservadas. `history-gaps.ts` respeita a próxima pergunta mesmo
quando ela é apenas “Continue” e recupera também trabalho composto só por ferramentas.

As alternativas eram reparar apenas os JSONL desta máquina (não preveniria a
recorrência), aumentar o teto da leitura síncrona (manteria o risco de bloquear o
Hub) ou recuperar pela fonte nativa/journal com leitura em fluxo. A terceira foi
implementada, compartilhando a lógica entre os dois processos.

## Validação

A reprodução usa cópias isoladas dos históricos reais. Os originais e os resultados
estão em `~/.jarvis/evidence/2026-11-04-history`; conteúdo privado não entra no Git.

| Sessão/turno | Antes | Cópia recuperada |
| --- | --- | --- |
| Codex DNAutto, penúltimo turno | 497 eventos | 874 eventos, 8.163 caracteres |
| Codex DNAutto, último turno | 1.793 eventos, 16.795 caracteres | 2.212 eventos, 20.921 caracteres |
| Claude, resposta ausente no meio | nenhuma resposta naquele intervalo | 20 eventos, 596 caracteres |

Os três trechos ficam marcados como recuperados e interrompidos. Uma segunda
execução modifica zero mensagens. O caso Claude tinha um aviso interno já gravado
como usuário pelo código anterior; seu limite é respeitado para não duplicar a
resposta posterior. Essa mensagem antiga não foi apagada.

- `npm run typecheck`: aprovado.
- `npm test`: 1.722 testes; 1.712 aprovados, 10 ignorados, zero falhas.
- Dois testes E2E sobem Hub/Runner reais em diretórios isolados, recuperam ambos
  os provedores, enviam nova pergunta, reiniciam os processos e verificam persistência,
  ausência de duplicação e inclusão do trecho recuperado no contexto da nova pergunta.
- Regressões: turno maior que o limite, mensagens de sistema, prompts repetidos,
  Claude compactado, atividade sem texto, concorrência, falha de gravação, journal
  órfão e enriquecimento de projeção antiga.

## Estado operacional

As correções anteriores estão nos commits locais `534f9d9` (estabilidade) e
`eee7bf5` (atividade Codex). O usuário autorizou explicitamente o commit desta
correção de histórico após a apresentação do diff e das validações. A ativação
no processo de produção continua pendente. Não foi feito push.

Na verificação desta etapa, o Hub de produção era o PID 47520, iniciado às 15:27:45
locais, antes desta correção. Sua árvore inclui o próprio agente desta investigação
e outro Claude ativo. O usuário escolheu aguardar os trabalhos; nenhum reinício foi
disparado e os históricos de produção não foram reescritos por um processo externo.
A recuperação será aplicada pelo Store proprietário quando o Hub corrigido iniciar
ou abrir a sessão. Confirmar a ativação exige observar o novo processo e o histórico
servido depois desse reinício; o hash retornado pelo healthcheck, sozinho, não prova
qual versão de código está carregada.

O texto recuperado está disponível no arquivo local `DNAutto-P0-P1-P2-recuperado.md`.
Ele registra progresso parcial, não comprova a conclusão das etapas P0/P1/P2.
