# INC-04 — Hub fora do ar porque a conta do serviço ficou travada (19/10 e 22/10/2026)

Investigação feita em 2026-10-22, disparada por "fiz uma nova atualização do Jarvis e parece que
quebrou bastante". A atualização para a v0.42.0 **não** quebrou nada: ela só provocou o reinício que
expôs um lockout da conta local que já estava lá.

Evidências: `~/.jarvis/hub.log`, `~/.jarvis/logs/jarvis-20261022.jsonl`, `net accounts`, leitura ADSI
da conta e o log do Sistema (origem `Service Control Manager`).

## Cobertura das evidências

| Fonte | Cobre | Lacuna |
|---|---|---|
| `logs/jarvis-*.jsonl` | 01/10 → 22/10 | — |
| `hub.log` | 15/07 → hoje | UTF-16 com linhas do launcher em UTF-8 no meio; as linhas do node não têm timestamp |
| Log do Sistema (SCM) | 19/10 → 22/10 nas linhas do Jarvis | o evento 7036 não é gravado neste Windows 11 |
| Log **Security** | — | **não lido**: exige elevação. É o que falta para nomear a origem do lockout |
| `hub-watchdog.log` | até 19/10 10:11 | o watchdog vive dentro do Hub, então não registra nada enquanto o serviço não sobe |

## Como o Hub está implantado nesta máquina

- Serviço `JarvisHub`, `Automatic`, conta **`.\Jonathan`** com a senha gravada no SCM
  (`scripts/install-service.ps1`: `sc.exe create ... obj= .\Jonathan password= $plain`). A conta de
  usuário é obrigatória: como LocalSystem o Hub perderia `~/.claude`, as credenciais do git, o PATH
  e o perfil todo.
- Recuperação do SCM: `reset= 86400 actions= restart/5000/restart/10000/restart/30000`, com
  `failureflag 1`.
- O SID do usuário tem `RP`/`WP` (START/STOP) no ACL do serviço, então ligar e desligar não pede
  elevação.
- Política de bloqueio da máquina (`net accounts`): **limite 10 tentativas, janela 10 min,
  duração 10 min**.

## Causas confirmadas

1. **A conta local `Jonathan` estava travada antes do reinício.** No momento do diagnóstico:
   `BadPasswordAttempts = 10` (exatamente o limite) e `UserFlags = 66097`
   = `0x10000` + `0x200` + `0x20` + **`0x10` (UF_LOCKOUT)** + `0x1`. `Win32_UserAccount.Lockout = True`.

2. **O reinício da atualização encontrou a conta já travada, e o Hub não voltou.** Linha do tempo:

   | Hora (local) | O que aconteceu |
   |---|---|
   | 22:32:53 | `hub_restart reason=admin activeRuns=0` |
   | 22:32:53 | `hub_exit code=0 reason=restart_admin uptimeS=303826` (3,5 dias no ar) |
   | 22:32:54 | launcher: `hub encerrou (codigo 0) devolvendo ao SCM`; SCM agenda religar em 5000 ms |
   | 22:32:58 / 22:32:59 / 22:34:09 / 22:34:59 | quatro pares **1069 + 1909** — `ERROR_ACCOUNT_LOCKED_OUT` |
   | 22:34:59 → 22:42:22 | serviço `Stopped`, nada escutando a 4577 |
   | 22:42:22 | `Start-Service JarvisHub` na mão → subiu |
   | 22:45:10 | `hub_boot version 0.42.0 bootMs 166573` |

   O detalhe que fecha a causa: os erros do SCM são **1909 (já travada)**, não 1326 (senha errada).
   As 10 tentativas ruins, portanto, aconteceram **antes** das 22:32, com o Hub rodando normalmente.
   Qualquer reinício naquele momento teria falhado igual.

3. **O SCM não se cura deste caso.** As ações de falha só disparam quando um serviço que *estava
   rodando* termina — um start que falha por logon não re-arma a cadeia. Na prática as tentativas se
   esgotaram em ~2 min, **todas dentro da janela de 10 min do lockout**, e aí o serviço ficou
   `Stopped` para sempre. O watchdog interno não cobre isto: ele vive dentro da árvore do Hub, então
   quando o serviço não sobe não existe watchdog nenhum.

4. **Não é a primeira vez.** O mesmo par 1069 + 1909 aparece em **19/10 09:31:02**, e o
   `LastLogin` da conta é 19/10 10:09:07 — ou seja, naquele dia também ficou ~40 min fora e só voltou
   quando alguém subiu na mão.

5. **O start limpou o lockout sozinho.** Depois do `Start-Service`: `BadPasswordAttempts` 10 → **0**
   e `UserFlags` 66097 → **66081** (o bit `UF_LOCKOUT` caiu). A duração de 10 min já havia expirado;
   o flag só é reavaliado na tentativa de logon seguinte. Os 2 runners reconectaram sozinhos.

## Descartado como origem do lockout (sem elevação, em 22/10)

| Vetor | Resultado |
|---|---|
| Credenciais salvas (`cmdkey /list`) | nenhuma para esta máquina — só git/gh/conta Microsoft, que não validam contra o SAM local |
| Drives mapeados (`net use`) | nenhum |
| Serviços usando a conta | **só o `JarvisHub`** — é o único consumidor de senha gravada na máquina |
| Tarefas agendadas `JarvisHub` / `JarvisWake` | `LogonType = Interactive`, que **não guarda senha** e por isso não gera logon falho; a `JarvisHub` legada está `Disabled` |
| RDP | desabilitado (`fDenyTSConnections = 1`) |
| Shares SMB | só os administrativos (`ADMIN$`, `C$`, `IPC$`); nenhuma sessão aberta |
| Firewall de entrada | nenhuma regra ativa para 445 / 3389 / 5985 |

## Hipóteses não confirmadas

- **Quem gerou as 10 tentativas de senha erradas.** Com todos os vetores acima descartados, o
  suspeito que sobra é o próprio serviço durante um ciclo de reinícios (o "laço do SCM" do INC-01) —
  mas isso conflita com o logon bem-sucedido de 19/10 10:09, que prova que a senha gravada está
  certa. **Não dá para decidir sem o log Security**: o evento 4740 nomeia a máquina que causou o
  lockout e o 4625 dá o tipo de logon e o processo. Para isso existe
  `scripts/diagnose-lockout.ps1`, que precisa de uma execução elevada.

## O que foi corrigido

- **`scripts/hub-retrier.ps1`** — religa o `JarvisHub` quando o SCM já desistiu. Só age se o serviço
  estiver `Stopped` **e** com `StartMode = Auto`; nunca sonda a porta 4577 (o boot leva até ~190 s
  com a porta fechada, e sondar porta daria falso positivo durante um boot normal). Tem teto de
  tentativas por hora, para não mascarar um Hub em laço de crash, e um marcador
  `~/.jarvis/hub-retrier-off` para manutenção. Registra tudo em `~/.jarvis/hub-retrier.log`.
- **`scripts/install-hub-retrier.ps1`** — registra o worker como tarefa de
  **`NT AUTHORITY\SYSTEM`** (`LogonType ServiceAccount`: sem senha gravada, logo **imune ao
  lockout**), com gatilho de boot mais repetição a cada 3 min. Três minutos fica abaixo da duração
  de 10 min do lockout (garante que uma tentativa caia depois da expiração) e acima de um reinício
  normal, que termina em segundos — assim o retrier nunca disputa com a bandeja nem com o update.
  Tem `-Uninstall`.
- **`scripts/diagnose-lockout.ps1`** — somente leitura, elevado: estado da conta, política, eventos
  4740 / 4625 / 4776 agrupados por tipo de logon, processo e origem, mais as linhas do SCM. Lê os
  campos pelo XML do evento, não pela `Message`, que é traduzida. Guarda cópia em
  `~/.jarvis/evidence/<data>/lockout-diagnostico.txt`.

## Observação lateral: o boot de 166 s

O `hub_boot` desta subida mostra onde vai o tempo:

```
imports 728ms -> store 45.933ms -> executions 160.087ms -> maintenance 166.497ms -> listen 166.573ms
```

**160 dos 166 segundos são a fase `executions`.** Não é regressão da v0.42.0 — é o INC-03 (um único
event loop fazendo servidor e leitura síncrona de GBs). Mas é o que faz cada reinício custar quase
3 min de indisponibilidade, e é o que torna a sondagem de porta inviável como sinal de saúde.

## Backlog derivado

1. Rodar `scripts/diagnose-lockout.ps1` elevado e fechar a origem das tentativas ruins (o único
   item que ainda deixa o incidente poder repetir).
2. Instalar o retrier (`scripts/install-hub-retrier.ps1`, elevado, uma vez) e nas outras máquinas
   que rodam o Hub como serviço.
3. Considerar baixar a exposição: se a origem for rede, avaliar `net accounts /lockoutthreshold`
   mais alto ou janela menor — decisão de segurança, não de código.
4. A ação de "subir o Hub" do app desktop (`desktop/src/control/actions.js`) falha com mensagem
   genérica quando a conta está travada; poderia reconhecer 1069/1909 e dizer o motivo real.
5. INC-03 segue aberto: enquanto `executions` dominar o boot, toda recuperação custa ~3 min.
