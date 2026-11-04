# Implementação da experiência de conversa

Escopo aprovado: P0, P1 e P2 de `hey-jarvis-dot-market-review-2026-11-04.md`.

## Sequência e aceite

- [x] P0: recebimento durável, reenvio idempotente, falhas explícitas e recuperação após queda.
- [x] P0: reprodução iniciada/concluída/fracassada, medição no aparelho e fila liberada em erro.
- [x] P0: prazos nas dependências, recuperação de transcrição e retenção de temporários.
- [x] P0: diagnóstico de microfone/saída/serviço acessível e escolha de dispositivo.
- [x] P1: conversa e ditado distintos; assunto e tarefa visíveis.
- [x] P1: execução independente, status/correções durante trabalho, respostas curtas.
- [x] P1: parar áudio, cancelar tarefa e encerrar conversa distintos; continuidade entre aparelhos.
- [x] P1: preferências básicas e avançadas separadas.
- [x] P2: tarefas/resultados recuperáveis com origem, estado, atualização e decisões.
- [x] P2: decisões/responsabilidades com fonte e correção usando contexto existente.
- [x] P2: resumo ao voltar, notificações deduplicadas e controle de interrupções.
- [x] P2: jornadas de fontes/automação verificadas e condicionadas às permissões existentes.
- [x] Validação automatizada: falhas, reinício isolado, verificações do projeto e nova interface.
- [ ] Ativação no Hub e no listener reais, depois do encerramento dos trabalhos ativos.
- [ ] Aceite acústico: 100 tentativas das cinco jornadas, em dispositivos/ruído distintos.

Os itens de implementação marcados não certificam o aceite acústico ou a ativação do serviço.

## Limites da implementação

Reutilizar execução, histórico, consentimentos e contexto pessoal existentes. Não contratar um
provedor, reescrever os adapters, ampliar o catálogo de personalidades ou executar trabalho do
DNAutto. Não reiniciar o serviço enquanto houver trabalhos ativos. Alterações de código não
demonstram latência acústica: registrar os testes automatizados e os testes com hardware separadamente.

## Alterações e motivo

| Área | Arquivos principais | Comportamento entregue |
|---|---|---|
| Conversa e execução | `apps/hub/src/conversation.ts`, `conversationLedger.ts`, `conversationHandoff.ts`, `index.ts` | Recibo antes do ACK; consulta de estado sem aguardar o executor; execução independente; contexto de origem explícito; correções enfileiradas para o próximo turno. |
| Recuperação e memória | `conversationLedger.ts`, `conversationMemory.ts`, `index.ts` | Pedidos incertos aparecem interrompidos; reenvio não repete ações; decisões/responsabilidades corrigíveis com fonte no contexto pessoal existente. |
| Interface | `apps/hub/web/conversation.js`, `app.js`, `index.html`, `sw.js` | Conversa, ditado e voz de sessão distintos; tarefas/resultados; comandos separados; diagnóstico e dispositivos antes dos controles avançados. |
| Entrega no PC | `services/voice/delivery.py`, `wake_listener.py` | Journal local de áudio conforme a retenção; reenvio com identidade estável; confirmação durável; nova tentativa explícita após falha; erros de dispositivo visíveis. |
| Áudio e limites | `apps/hub/src/speechBridge.ts`, `stt.ts`, `tts.ts`, `speaker.ts`, `voiceDeadline.ts`, `voiceTemps.ts`, `packages/core/src/voice-turn.ts` | Reprodução confirmada pelo aparelho; falha libera a fila; destino autorizado; prazos finitos; limpeza de temporários; envio sem confirmação não é contado como fala concluída. |
| Análise curta | `packages/core/src/agents.ts` | Consulta com cancelamento e limites de ferramentas; Codex/Claude respeitam o perfil de análise, sem iniciar outro executor irrestrito. |
| Evidências | testes adjacentes, `apps/hub/src/conversation.e2e.test.ts`, `tests/personal-assistant/conversation.*`, fixture e testes web existentes | Reinício isolado, corrupção, concorrência de tarefas, memória corrigida, recuperação, autorização, interface desktop/mobile e falha de áudio. |

P2 reutiliza as jornadas existentes de fontes, consentimentos e automações. Não acrescenta um
conector arbitrário: a expansão de fontes continua condicionada a uma jornada útil e permissão
específica. A memória guarda anotações explicitamente fornecidas pelo usuário; não inventa decisões.

## Registro de validação — 04/11/2026

| Comando / verificação | Resultado |
|---|---|
| `npm run check` | 1.742 testes: **1.732 aprovados, zero falhas, 10 pulados** pelas condições da suíte. Typecheck aprovado. |
| `npm run typecheck` e `node --check` nos dois scripts web, após a revisão final | Aprovados. |
| Suíte dirigida às conversas, ledger, handoff, memória, reinício, deadlines, temporários, ponte de fala, cliente web, telemetria e adaptadores | **152 aprovados, zero falhas e zero pulados**, incluindo os ajustes posteriores à suíte ampla. |
| `python -m unittest discover -s services/voice -p 'test_*.py' -q` | **18 aprovados**, nenhum pulado. |
| `npx playwright test --config tests/personal-assistant/conversation.config.ts` | **8 aprovados**, nos tamanhos desktop e mobile. Microfone sintético do Chromium; nenhum áudio ambiente capturado. |
| `npm run test:ui:personal` | **17 aprovados e uma divergência de screenshot CalDAV**. A mesma diferença de 21.045 pixels foi reproduzida com `app.js` e `index.html` de `HEAD`, anteriores às alterações. As asserções funcionais desse cenário passaram. Baseline não alterado. |
| `git diff --check` | Sem erros de whitespace. Git avisa sobre normalização LF/CRLF neste checkout Windows. |

A suíte ampla foi executada antes dos últimos ajustes locais. Depois deles, foram repetidos
typecheck, sintaxe web e os testes diretamente afetados, incluindo reinício e interface.

O teste de reinício usa outro `JARVIS_HOME`, portas livres, agente simulado e processos próprios.
Ele comprova: duas execuções distintas para pedido/correção; status durante o trabalho; resultado
e foco recuperados; decisão corrigida persistente com fonte; pedido aceito antes da queda visível
como interrompido; ACK repetido sem nova execução; reenvio para outra máquina rejeitado; áudio
alheio preservado diante de recuperação forjada; registro corrompido bloqueia replay e continua
visível sem ocultar os demais resultados. Os processos de teste são encerrados ao terminar.

Outros cenários incluem falha de disco, ACK perdido em conexão saudável, falha de reprodução,
destino sem acesso, janela de resposta de outro usuário, cancelamento da análise e exceção no
cancelamento de uma dependência. Excluir histórico remove o conteúdo dos recibos e conserva
somente a identidade necessária para impedir a repetição de uma ação já aceita.

## Pendências de ativação e aceite

- O Hub em execução não foi reiniciado. Esta própria execução do Codex é descendente do Hub;
  reiniciá-lo agora interromperia trabalho ativo, contrariando a decisão de aguardar. O listener
  também precisa ser recarregado na janela de ativação. O código novo ainda não está certificado
  no processo real em uso.
- Não houve ensaio acústico humano, teste de ruído/eco ou medição de p50/p95 no hardware. Os
  limites de espera e a instrumentação implementados **não demonstram** as metas de 1,5/3 segundos.
- O modo permanece por turnos, com ativação/continuação explícitas. Conversa simultânea com o
  executor não significa áudio full-duplex ou cancelamento de eco validado.
- Texto ainda sem ACK é conservado apenas na janela aberta; áudio segue a política escolhida.
  Com retenção desligada, não há promessa de recuperar áudio após fechar o aparelho.
- Notificações são discretas e deduplicadas; a caixa de resultados e o resumo de itens não vistos
  permanecem a referência recuperável mesmo se um aviso transitório não for observado.
- A divergência visual preexistente de CalDAV continua registrada; não foi corrigida como parte
  da experiência de voz. Nenhuma baseline foi atualizada para esconder o resultado.
- Esta validação foi registrada antes da criação do commit, autorizado pelo usuário em 04/11/2026.
  O checkout iniciou em `main`, um commit atrás de `origin/main`. Push e ativação não fazem parte
  dessa autorização de commit.

Próxima verificação operacional: após os trabalhos ativos encerrarem, carregar Hub e listener,
validar uma interação real e executar as 100 tentativas previstas no relatório de avaliação,
registrando falhas e tempos por dispositivo. A aprovação de produto depende dessa evidência.
