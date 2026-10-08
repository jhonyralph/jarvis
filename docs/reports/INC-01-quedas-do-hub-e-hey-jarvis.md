# INC-01 — Quedas do Hub sem recuperação e "Hey Jarvis" mudo (16/09 – 07/10/2026)

Investigação feita em 2026-10-07, passos 1–2 do plano aprovado no debate ("corrigir a recuperação
e localizar as falhas de áudio antes de trocar o serviço Python ou o detector").
Evidências preservadas em `~/.jarvis/evidence/2026-10-07/`: `hub.log`, `wake.log`, `audit.log`, `logs/`,
`voice-cfg.json`, `hub.env`, eventos do Windows exportados em `system-events.csv` e `app-events.csv`.

## Cobertura das evidências

| Fonte | Cobre | Lacuna |
|---|---|---|
| `logs/jarvis-*.jsonl` | 23/09 → 07/10 | **16/09–22/09 apagado** (retenção era de 14 dias) |
| `hub.log` | 15/07 → hoje | sem timestamps nas linhas do node; UTF-16 e UTF-8 misturados; linhas do supervisor se perdem enquanto o node segura o arquivo |
| `wake.log` | 28/07 → 30/09 13:44 | o listener não roda desde 30/09 |
| Event Log do Windows | 16/09 → 07/10 | o evento 7036 (mudança de estado de serviço) não é gravado neste Windows 11 |

## Como o Hub está implantado nesta máquina

- Serviço do Windows `JarvisHub` (Automatic, conta `.\Jonathan`), host `~/.jarvis/bin/JarvisService.exe`, que executa `scripts/start-hub.ps1 -Once`. A recuperação: reinicia após 5, 10 e 30 s, e depois a cada 30 s.
- A tarefa agendada `JarvisHub` está desativada desde a migração para serviço.
- A tarefa agendada `JarvisWake` só tem gatilho de logon. Ela roda `powershell -WindowStyle Hidden`, mas o Windows Terminal hospeda o console numa janela visível.

## Causas confirmadas

1. **Exaustão de memória da máquina (commit).** O evento 2004 (Resource-Exhaustion-Detector) disparou 21 vezes em 3 semanas. Em todas, o culpado foi `node.exe` com 20 a 102 GB de commit, vindo de dev servers Vite de outros projetos. Os horários coincidem com os incidentes:
   - **25/09** — exaustão de 18:01 a 19:03, com o node chegando a 102 GB. O Hub saiu às 18:43 e a máquina foi reiniciada às 19:04.
   - **30/09** — exaustão de 13:36 a 13:45. O **Áudio do Windows caiu às 13:37**, o Hub saiu às 13:42 e foi parado às 13:44. O listener de wake morreu às 13:44.
   - **07/10** — commit em 110 de 115 GB. O processo era o Vite do `dnautto/owner-web-app` (porta 5312), com 41 GB. O Áudio do Windows caiu às 21:21:57 e não voltou. Os testes do Node passaram a morrer com `0xC0000409`.
2. **Boot do Hub de 85 a 190 s, com a porta fechada durante todo esse tempo.** Antes do `listen`, o Hub lia de forma síncrona todo o histórico: `ExecutionStore` com 10.002 arquivos e 353 MB, o `Store` de sessões com 229 MB e a listagem e os transcripts nativos. Num boot isolado com os mesmos dados, o perfil de CPU mostrou 91 s em `readFileUtf8` e 13 s em `open`. Durante o boot o Hub parece morto. Em 30/09 ele foi parado 2 min 17 s depois de iniciado, sem ter terminado de subir. Além disso, `restart-hub.ps1` declarava `FALHOU` depois de 120 s.
3. **Laço de falhas no SCM com o Hub órfão.** Hoje às 20:30 o host do serviço morreu sem registro de crash, mas o Hub filho continuou vivo. A cada religada do SCM, o launcher via o mutex ou a porta ocupados e saía. O host convertia essa saída em falha, e o ciclo se repetiu **86 vezes ou mais** em 23 minutos. Enquanto isso, o Hub em pé ficou sem supervisor.
4. **Saídas sem motivo registrado.** O reinício pela bandeja (`/admin/restart`) ou por update terminava com `process.exit(0)` sem nenhuma linha. As saídas de 25/09 e 30/09 só foram explicadas pela correlação com outras fontes.
5. **"Hey Jarvis" do PC desarmado por qualquer cliente.** O `postAuth` de todo cliente dono enviava `{t:'wake', enabled: cfg.wake}` (default `false`). O Hub aplicava o valor globalmente e o retransmitia, sem persistir. No `wake.log` há cerca de 40 mil `armed=False`, contra 1 a 3 `armed=True` por conexão. Houve **duas detecções na história toda**, ambas em 28/07 e ambas falsas.
6. **Listener sem supervisão efetiva.**
   - De 25/09 a 28/09, cerca de 918 crashes em `PortAudioError MME error 11` (o microfone não abre), cada um relançado pelo launcher a cada 3 s.
   - Em 30/09, `forrtl: error (200) ... window-CLOSE event`: o console da tarefa foi fechado e o supervisor morreu junto.
   - O gatilho é só de logon; o `RestartCount` da tarefa cobre apenas falha ao iniciar.

## Achados de código corrigidos de quebra

- `server.listen` sem tratador: um `EADDRINUSE` virava só "wss error" e o processo seguia vivo **sem escutar**, um zumbi que nenhum supervisor recicla.
- `restartService("hub")` matava **qualquer** dono da porta 4577 depois de 3 s, o que derrubaria um Hub novo que subisse rápido. Também tentava religar a tarefa agendada desativada.
- O `restart-hub.ps1 -Wait` saía assim que o Hub **antigo** ainda escutava e imprimia um status velho.
- A bandeja tirava o Hub do menu quando ele caía por completo: não avisava da queda e não oferecia como subir de novo.

## Hipóteses não confirmadas

- **O que matou `JarvisService.exe` às 20:30:15 de 07/10.** Não houve evento de crash do .NET nem do WER. Candidatos: terminação externa (antivírus Kaspersky sobre um exe compilado localmente e sem assinatura), kill manual, ou falha de alocação sob exaustão de commit.
- **O que travou o boot em produção.** No sandbox, o boot frio levou 112 s e o morno, 28 s. A divisão real em produção só será conhecida no próximo boot, pelas fases agora registradas em `hub_boot.phases`.
- **Microfone.** O MME error 11 de 25 a 28/09 e o travamento ao abrir o G933 em 07/10 coincidem com o serviço de áudio caído ou instável. Falta repetir o teste com o Áudio do Windows saudável e sem pressão de memória.

## Backlog derivado

| # | Item | Evidência | Estado |
|---|---|---|---|
| 1 | Eliminar a exaustão de commit (dev servers Vite órfãos/vazando) | evento 2004 ×21 | **decisão do dono**: encerrar o Vite atual, adotar um teto de memória para dev servers |
| 2 | Abrir a porta antes da reconciliação nativa e registrar as fases do boot | perfil de CPU | feito (`index.ts`) |
| 3 | Reduzir o que o boot lê (executions: 10 mil arquivos; sessões: 229 MB) | perfil de CPU | aberto: arquivar journals antigos e carregar sob demanda |
| 4 | Launcher adota o órfão / espera o mutex em vez de sair; watchdog de `/health` | laço no SCM | feito (`start-hub.ps1`) |
| 5 | Registrar o motivo de saída e o `EADDRINUSE` como fatal | saídas silenciosas | feito |
| 6 | Estado de wake do PC persistido e só alterado por toque explícito | ~40 mil `armed=False` | feito (Hub + web) |
| 7 | Listener: microfone com nova tentativa, status na UI, erro por ciclo não derruba o processo | ~918 crashes | feito (`wake_listener.py`) |
| 8 | Tarefa `JarvisWake` sem janela e com religamento | `window-CLOSE` | feito (`install-wake.ps1`), falta instalar |
| 9 | Fluxo nativo do Android (passo 6 do plano) | código (debate) | aberto, depende de testes no aparelho |
| 10 | Comparação de detectores (passo 7) | — | aberto, depende de gravações reais |
| 11 | `hub.log` com UTF-8 único e rotação | log misto, sem rotação | aberto |
| 12 | Catálogo de env defasado (cerca de 30 variáveis sem entrada) bloqueia `environment-catalog.mjs --write` | `--check` | aberto (dívida anterior) |
