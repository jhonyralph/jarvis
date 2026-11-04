# INC-05 — Quedas recorrentes: bloqueio do Hub, logon do Chromium e recuperação ausente

Data: 2026-11-04. Horários locais: America/Sao_Paulo. Base inspecionada: `5023065` (0.53.1).

## Estado da intervenção

Correções implementadas e validadas no checkout. A tarefa externa `JarvisHubRetrier` já está instalada e executando como SYSTEM, com resultado 0. O Hub de produção ainda precisa de um reinício controlado para carregar as alterações TypeScript. Há outros agentes ativos na árvore desse Hub; reiniciá-lo interrompe esses trabalhos, inclusive a sessão desta investigação.

Decisão do usuário em 04/11: commit das correções autorizado; reinício adiado para aguardar os trabalhos ativos. A aplicação em produção permanece pendente. Não houve push, troca de conta do serviço, alteração de senha/política de bloqueio, encerramento de aplicativos pessoais ou remoção de históricos.

## Evidências e limites da conclusão

### 1. O Chrome pode bloquear a conta que inicia o serviço

O diagnóstico do log Security encontrou 183 eventos 4625 atribuídos ao `chrome.exe` e 13 bloqueios da conta desde 28/10, incluindo um em 04/11 às 10:43. A falha registrada é senha incorreta (`0xc000006a`, logon interativo), não uma solicitação de senha respondida pelo usuário.

A reprodução aconteceu durante a própria investigação: a primeira execução de `npm test`, antes da correção do navegador, produziu seis novos eventos 4625 entre 13:07:27 e 13:07:45. O contador de tentativas inválidas chegou a seis. Esses testes criam perfis temporários de Chrome sem interação humana. O Chrome instalado era 155.0.8059.86.

O código do Chromium explica o mecanismo: ao inicializar um perfil sem o cache de estado da senha, `CheckBlankPasswordWithPrefs` chama `LogonUser` com senha vazia. Cada falha pode contar para o bloqueio da conta Windows. O serviço JarvisHub depende do logon de Jonathan; se precisar iniciar durante um bloqueio, o SCM pode esgotar suas tentativas e deixá-lo parado, como documentado no INC-04. Os eventos antigos do SCM confirmam a falha de logon do serviço, mas não há log Security suficiente para atribuir todos aqueles episódios antigos ao Chrome.

Correção em `browser-profile.ts` / `browser.ts`: antes de abrir um perfil pertencente ao Jarvis, depois do recolhimento da instância anterior, preparar atomicamente os dois campos do cache em `Local State`. `os_password_blank=false` mantém a exigência de autenticação; `os_password_last_changed` usa o formato int64 serializado como string do Chromium e o horário atual com margem de um minuto. Não se usa um prazo permanente no futuro. As demais preferências e chaves são preservadas; arquivo corrompido impede a abertura e permanece intacto.

Fontes primárias:

- [Código do Chromium: password_manager_util_win.cc](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/password_manager/password_manager_util_win.cc).
- [Chromium issue 541310282](https://issues.chromium.org/issues/541310282).
- [Reprodução e requisito de serialização do int64 no agent-browser](https://github.com/vercel-labs/agent-browser/issues/2232).

### 2. Ainda havia I/O síncrono de rollouts no processo que atende o Hub

O watchdog registrou travamentos em 02/11 às 12:56, 13:32 e 15:07, seguidos de encerramento da árvore e recuperação do serviço. Não há stack capturada para atribuir individualmente esses três episódios a uma função.

As capturas posteriores em `stall-traces.jsonl` mostram `codexRolloutAppend` / `codexPatchEventsFromLines` em 03/11 e `codexPlanTelemetry` / `codexTelemetryFromLines` / `readTailLines` no refresh de agentes em 04/11. A ordenação do catálogo também fazia `statSync` dentro do comparador. As proteções anteriores limitavam o volume de alguns arquivos, mas ainda executavam leitura e parsing no caminho do event loop.

Correção em `agents.ts`: catálogo e leitura de arquivos assíncronos, um `stat` capturado por arquivo para ordenar, caudas limitadas, descarte de linhas irrelevantes antes do JSON.parse, parsing em lotes que cedem ao event loop e uma consulta compartilhada para pedidos simultâneos de uso. A finalização do turno aguarda o polling em andamento antes do último flush, evitando leitores concorrentes no mesmo offset e atividade posterior à resposta final. Históricos e vínculos de sessões permanecem preservados.

### 3. O retrier externo não estava instalado e seu instalador falhava

O serviço estava automático e a tarefa antiga JarvisHub desabilitada, mas não havia tarefa JarvisHubRetrier. Ao executar o instalador existente, o Agendador rejeitou a duração de repetição gerada por `TimeSpan.MaxValue`. A criação do objeto de trigger aceitava o valor; a falha ocorria depois, no registro, fora do antigo catch.

Correção em `install-hub-retrier.ps1`: omitir Duration para repetir indefinidamente, validar o intervalo e atualizar a tarefa com `-Force`, sem removê-la antes de validar a nova definição. A tarefa foi instalada e executou repetidamente com resultado 0. O worker existente só tenta iniciar um serviço automático parado; ele não reinicia um Hub que está rodando e mantém seu limite de tentativas.

Fonte: [Microsoft — RepetitionPattern.Duration: ausência de duração significa repetição indefinida](https://learn.microsoft.com/en-us/windows/win32/taskschd/repetitionpattern-duration).

### 4. Há também exaustão de memória da máquina

O Windows registrou Resource-Exhaustion-Detector 2004 em 03/11 às 20:44 e 04/11 às 12:24 e 12:27. A telemetria histórica chegou a aproximadamente 3 MB de RAM disponível e praticamente todo o limite de memória comprometida consumido. Em nova leitura durante esta investigação, mesmo depois dos testes, havia aproximadamente 285 MiB de RAM disponível e 74,2 GiB comprometidos de 79,8 GiB. Esse risco continua presente e não pode ser declarado resolvido pelas alterações de I/O.

O comando padrão `npm test` agora limita a concorrência entre arquivos a dois processos, reduzindo a pressão adicional provocada pela suíte na máquina que também hospeda o serviço. Isso não limita agentes de produção, não corrige consumo de outros aplicativos e não prova ausência de vazamento após vários dias de uso.

### 5. Nem todo reinício registrado é espontâneo

Em 04/11 às 11:24:17 houve pedido administrativo de reinício com três turnos ativos. O código existente aguardou seu teto de dois minutos e reiniciou ainda com trabalho ativo às 11:26:18. Esse episódio deve ser separado dos travamentos e dos bloqueios de conta. A política de reinício administrativo não foi modificada nesta intervenção.

## Alternativas consideradas

1. Aumentar os prazos do watchdog: reduziria alguns reinícios, mas prolongaria a indisponibilidade causada por bloqueio do event loop e não resolveria falha de logon.
2. Mudar a conta do serviço ou desativar o bloqueio de conta: alteraria acesso a credenciais, perfis e controles do Windows; não é necessário para corrigir a abertura dos navegadores do Jarvis.
3. Corrigir os caminhos de I/O e a inicialização dos perfis, com recuperação externa funcional: opção implementada porque trata os mecanismos comprovados sem migrar históricos ou credenciais.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Passou. |
| Testes de adapters, execuções Codex e regressões de I/O | Passaram após corrigir uma perda de campos entre lotes detectada pelo novo teste. |
| `codex-rollout-io.test.ts` | Seis testes: HTTP responde durante catálogo frio; preservação de telemetria entre lotes; cauda grande com event loop livre; limites/expiração; arquivo desaparecido/UTF-8; flush final único e nenhuma emissão tardia com CLI simulado. |
| `browser-profile.test.ts` | Quatro testes: perfil novo, preservação/repetição, estado corrompido e outros sistemas operacionais. |
| Teste isolado com Chrome real após a correção | Passou; zero novos eventos 4625. |
| Primeira suíte completa | 1.687 passaram, um timeout no E2E de paridade, dez pulados; seis novos logons inválidos antes da correção do Chrome. |
| `node --env-file=scripts/test.env --import tsx --test apps/hub/src/parity.e2e.test.ts` | Ambos os testes passaram na repetição isolada; nenhuma mudança nesse teste. |
| `npm test` final, 13:15:13–13:17:01 | 1.702 testes: 1.692 passaram, zero falhas, dez pulados; **zero novos eventos 4625 durante toda a suíte**. |
| `node --check apps/hub/web/app.js` | Passou. |
| `node mobile/sync-web.mjs` | Passou. |
| `python -m compileall -q services/voice` | Passou; somente sintaxe, sem iniciar modelos. |
| Parser PowerShell do instalador | Sem erros. |
| Registro real e execuções do JarvisHubRetrier | Resultado 0, repetição de três minutos, conta SYSTEM. |
| `git diff --check` | Passou. |

Não foi induzido bloqueio da conta, esgotamento de memória ou crash no serviço de produção. Não foram executados testes Linux/macOS, a suíte visual Playwright nem o spike descartável de screencast. A preparação do perfil cobre BrowserManager, usado pelo Hub, Runner e integrações padrão; lançadores independentes de Chromium (inclusive ferramentas externas e experimentos) continuam sujeitos ao problema upstream.

## Evidências preservadas e acompanhamento

Arquivos locais em `C:\Users\Jonathan\.jarvis\evidence\2026-11-04-stability`: logs do watchdog, stacks de stalls, logs JSONL, estado anterior do serviço/tarefas, `npm-test.log`, `parity-rerun.log`, `npm-test-after.log` e `test-after-summary.json`. O diagnóstico de bloqueio está em `C:\Users\Jonathan\.jarvis\evidence\2026-11-04\lockout-diagnostico.txt`. Esses arquivos não são adicionados ao repositório porque podem conter dados locais de sessões.

Depois de carregar o código em produção, confirmar novo PID/uptime e health, e acompanhar watchdog, stalls, eventos 4625/4740 e memória durante uso normal. Uma suíte verde prova os cenários exercitados; estabilidade prolongada ainda depende dessa observação e da pressão de memória da máquina.
