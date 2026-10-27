---
feature_id: VOZ-01-voz-em-qualquer-lugar
tldr: "Chamar o Jarvis de qualquer lugar (botão no app, Hey Jarvis em várias máquinas e no celular), acompanhar cada sessão por voz do jeito que o dono pedir, e uma fila única de fala para nada se sobrepor."
title: "Voz em qualquer lugar: chamar, acompanhar e ouvir sem bagunça"
owner: "Jonathan / Claude"
status: draft
risk_level: high
stack: node + python + android
services_affected: [hub, web, mobile, voice-services, runner]
dependencies: [VOZ-00-voz-efetiva, voice-progressive-disclosure]
schema_required: false
schema_dependencies: []
links:
  roadmap: "Continuação da VOZ-00 (UC-16 em diante; regras L em diante — a K da VOZ-00 é Observabilidade)"
  design: "Conversa de 2026-10-27: decisões do dono sobre destino, acompanhamento, fila de fala e vários aparelhos ouvindo"
  adr: "N/A — decisões na seção 6"
approval_evidence: "Decisões DEC-09..13 respondidas pelo dono em 2026-10-27 (conversa); interpretações I-1..I-3 a confirmar; nada implementado"
---

# Executable spec

## 0) Meta (TL;DR)

Hoje só dá para falar com o Jarvis **dentro de uma sessão aberta** ou pelo "Hey Jarvis" **de uma
máquina só** (a do Hub). Este épico define:

1. **Chamar o Jarvis de qualquer lugar** — botão no app e "Hey Jarvis" em qualquer aparelho que o
   dono habilitar (3 máquinas + celular), sempre caindo na sessão **voice**, que pode tratar de um
   tópico ou falar **sobre** qualquer outra sessão.
2. **Acompanhar cada sessão do jeito pedido, por voz** — "me avise quando terminar", "me avise a cada
   tanto tempo", "me fale quando houver algo importante" — isolado por sessão, com verbosidade
   configurável (padrão `essencial`).
3. **Uma fila única de fala, organizada por sessão** — nada fala por cima de nada em nenhum aparelho;
   as falas de uma sessão tocam juntas, a resposta dada logo depois vai para essa sessão, e só então
   a fila passa para a próxima.
4. **Vários aparelhos ouvindo sem bagunça** — o dono escolhe quem "manda" agora; quando mais de um
   ouve o mesmo "Hey Jarvis", só um responde (pelo líder, por rede e localização).
5. **"Hey Jarvis" no celular só com o app aberto** e a opção ligada.

## 1) Contexto e objetivo

### 1.1 Origem (palavras do dono, 2026-10-27)

- "Chamar o jarvis pelo app mesmo sem ser só pelo comando de acordar … posso querer acionar o jarvis
  sem ser por uma sessão específica. Assim como o comando hey jarvis faz."
- No celular, "pode ser ativada somente se o app estiver aberto com a configuração de hey jarvis".
- Destino: "Sempre a sessão voice, mas ela pode estar relacionada a um tópico específico."
- "Vale dar feedback de tempo em tempo … o usuário deve poder mexer nessa configuração para dizer que
  quer mais verboso, mesmo, ou até mesmo me avise quando terminar."
- "O usuário pode pedir também via voz sobre uma sessão específica … me avise quando terminar a
  demanda e passar para próxima … me avise de tanto em tanto tempo como está … me informando quando
  tiver algo significante. Isso vale para cada sessão de forma isolada."
- "Todo o sistema de voz deve entrar em uma fila. Pois se duas ações acontecer no mesmo momento as
  duas começam a reproduzir e vira uma zona."
- "Eu tenho 3 máquinas aqui e o telefone. Então o hey jarvis deve ter uma ação de escolher quem é que
  manda no momento. Claro que cada máquina irá configurar se quer usar o hey jarvis ou não … verificar
  se está na mesma rede ou não e até mesmo localização se aplicável … se tiver habilitado o hey jarvis
  em mais de uma máquina, poder as duas ficar de ouvinte."
- Sobre "a próxima" (respostas às decisões): várias sessões com voz; a resposta dada enquanto a sessão
  ainda escuta vai para ela, não para a voice; a próxima fala da fila só depois desse tempo; falas da
  mesma sessão na fila tocam agrupadas; "Hey Jarvis" no meio assume e pausa a voz; fala que chega
  durante a fala atual toca logo em seguida, "empilhada" no que já está falando.

### 1.2 Objetivo

Falar com o Jarvis deixa de depender de **onde** a pessoa está (qual tela, qual máquina) e passa a
depender só de **o que** ela quer — e o Jarvis devolve informação no ritmo que ela escolheu, uma fala
de cada vez.

## 2) Estado atual (auditado em 2026-10-27)

| Peça | Hoje | Lacuna |
|---|---|---|
| "Hey Jarvis" do PC | `services/voice/wake_listener.py` injeta em uma sessão fixa `voice` (`JARVIS_WAKE_SESSION`, Hub `WAKE_SESSION`) | Só a máquina do Hub: o listener se autentica com um segredo por boot gravado em `~/.jarvis/wake-token` (prova de "mesma máquina"); outra máquina não tem como se autenticar como listener |
| Fala no app | `audioMgr` em `apps/hub/web/app.js` já serializa as falas **dentro de um aparelho** (TTS, clipes, prévias) | Cada aba/aparelho tem a sua fila, e o listener do PC toca por conta própria (`_play_q` no Python): duas fontes falam ao mesmo tempo |
| Janela de resposta | Depois de uma fala no app, o microfone reabre sozinho (hands-free) por `continueSec` (mínimo 6 s) na sessão aberta (`playTTS` → `startRec(true)` em `app.js`) | Só no aparelho e na sessão que estão na tela; outra sessão que fala no meio disputa o mesmo microfone |
| Notificações | Push global por evento (`done`/`error`), "cada uma" ou "agrupado a cada N min" | Nada por sessão, nada por voz, nada de "progresso a cada N min" nem "algo importante" |
| Troca de assunto | G21: `looksLikeTopicShift` abre sessão nova com a fala no compositor | Não há "falar SOBRE outra sessão" a partir da voice |
| Celular | `JarvisWakePlugin` + `JarvisWakeService.kt` (Android): **serviço em segundo plano** sempre ouvindo (openWakeWord), avisa o app por broadcast | O oposto do pedido: ouve com o app fechado (bateria/privacidade) |
| Agente prometendo aviso | Regra do repo: o agente NÃO deve prometer "te aviso quando terminar" — ele não tem como | Com acompanhamento no Hub, o aviso passa a ser real |

## 3) Casos de uso

### UC-16 — Chamar o Jarvis de qualquer tela
- **Gatilho:** botão "Falar com o Jarvis" visível em qualquer tela do app (sem sessão aberta, ou com
  outra sessão aberta).
- **Fluxo:** grava → vai para a sessão **voice** → resposta falada na fila (RN-N).
- **Regras:** RN-L1, RN-L2.

### UC-17 — A voice trata de um tópico
- **Gatilho:** a fala começa um assunto novo ("vamos planejar a viagem").
- **Fluxo:** a voice mantém um **tópico corrente** (nome curto); falas seguintes continuam nele até a
  troca de assunto (G21 já detecta).
- **Regras:** RN-L3.

### UC-18 — Falar SOBRE outra sessão
- **Gatilho:** "como está a demanda do login?", "manda para a sessão do relatório: …".
- **Fluxo:** a voice identifica a sessão alvo pelo nome/tópico; consulta o estado dela ou envia a
  mensagem para ela; responde falando. Ambiguidade = pergunta curta ("a do app ou a do Hub?").
- **Regras:** RN-L4, RN-L5.

### UC-19 — Acompanhar uma sessão do jeito pedido
- **Gatilho (por voz, por sessão):**
  - "me avise quando terminar" → aviso no fim do turno/trabalho;
  - "me avise a cada 10 minutos" → resumo periódico (sem número, vale o padrão: 15 min);
  - "me fale quando houver algo importante" → só eventos significativos (RN-M3);
  - "passe para a próxima" → encerra a janela de resposta da sessão que falou e libera o próximo
    item da fila de fala (RN-O3, DEC-09).
- **Fluxo:** o Hub registra o **acompanhamento** daquela sessão; ele sobrevive a reinício do Hub e se
  cancela por voz ("pode parar de me avisar sobre o relatório").
- **Regras:** RN-M1…RN-M6.

### UC-20 — Escolher o quanto o Jarvis fala
- **Gatilho:** Ajustes de voz, ou por voz ("seja mais breve", "me conte mais").
- **Fluxo:** nível global com padrão do dono + ajuste por sessão.
- **Regras:** RN-N1, RN-N2.

### UC-21 — Nada fala por cima de nada, e cada resposta volta para a sessão certa
- **Cenário do dono:** 3 a 5 sessões, cada uma de um projeto, todas com voz.
- **Gatilho:** falas de sessões diferentes ficam prontas perto uma da outra (resposta + aviso de
  outra sessão, dois aparelhos, listener do PC + app).
- **Fluxo:**
  1. A fila toca **uma sessão por vez**. Na vez da sessão 1, tudo o que está pendente da sessão 1 toca
     junto (fila 1 → 2 → 1 vira: 1+1, depois 2).
  2. Depois de falar, a sessão 1 fica com a **janela de resposta** aberta. O que o dono disser nela vai
     para a **sessão 1**, não para a voice.
  3. Chegou fala nova da sessão 1 enquanto ela fala → toca logo em seguida, não vai para o fim da fila.
  4. Só quando a janela fecha sem fala (ou o dono diz "próxima") a fila passa para a sessão 2.
  5. "Hey Jarvis" no meio de qualquer fala → pausa a voz e assume; o que for dito vai para a sessão
     que estava falando (ou em janela de resposta); fora disso, para a voice.
- **Regras:** RN-O1…RN-O9.

### UC-22 — Escolher quem manda agora
- **Gatilho:** "Hey Jarvis" habilitado em mais de um aparelho (3 máquinas + celular).
- **Fluxo:** cada aparelho opta por ouvir ou não; o dono escolhe qual aparelho **responde** agora
  (por tela ou por voz: "Jarvis, agora é o celular").
- **Regras:** RN-P1…RN-P4.

### UC-23 — Vários ouvindo, um responde (automático)
- **Gatilho:** dois aparelhos ouvem o mesmo "Hey Jarvis".
- **Fluxo:** o Hub junta as detecções da mesma janela curta e escolhe um, pelo critério da RN-P5
  (líder escolhido > proximidade por rede e localização > confiança/volume da detecção). Os outros
  descartam. Entra já na primeira entrega de vários aparelhos (DEC-12).
- **Regras:** RN-P5, RN-P6.

### UC-24 — "Hey Jarvis" no celular só com o app aberto
- **Gatilho:** opção "Hey Jarvis neste aparelho" ligada **e** app em primeiro plano.
- **Fluxo:** ouve enquanto o app está aberto; para ao sair dele.
- **Regras:** RN-Q1, RN-Q2.

## 4) Regras de negócio

### L. Destino e roteamento por voz
- **RN-L1 — Chamada sem sessão vai para a voice.** Botão global e "Hey Jarvis" de qualquer aparelho
  caem na mesma sessão `voice` (DEC do dono, 27/10).
- **RN-L2 — A resposta volta pelo aparelho que vai falar (RN-P3)**, não necessariamente o que ouviu.
- **RN-L3 — A voice tem um tópico corrente**, nomeado e visível; troca de assunto (G21) muda o tópico
  em vez de misturar contexto — e segue a RN-C4 da VOZ-00: a troca é sugerida, nunca decidida em
  silêncio.
- **RN-L4 — "Sobre a sessão X" é um pedido explícito**, nunca adivinhação: sem alvo claro, pergunta.
- **RN-L5 — Mandar texto para outra sessão usa o caminho que já existe** (`jarvis_read_session` /
  `jarvis_send_to_session` em `apps/mcp/src/index.ts`, G22), com confirmação falada curta do que foi enviado.

### M. Acompanhamento por sessão
- **RN-M1 — Isolado por sessão:** cada sessão tem o seu acompanhamento; um não altera o outro.
- **RN-M2 — Tipos:** `ao_terminar`, `periodico(N min)`, `importante`. Combináveis ("a cada 15 min e
  quando terminar"). O intervalo padrão do periódico é **15 min**, configurável nos Ajustes de voz e
  por pedido ("a cada 5 minutos") (DEC-11).
- **RN-M3 — "Importante" é por evento, sem LLM por padrão:** terminou, falhou, está esperando decisão
  sua (pergunta/permissão), trabalho de fundo concluído. Classificar "relevância" com LLM só se o
  dono ligar (custo).
- **RN-M4 — Periódico resume o que mudou desde o último aviso** (passos/ferramentas/arquivos do
  registro de atividade); sem novidade, avisa "segue no mesmo ponto" no máximo 1 vez e depois se cala
  até mudar algo.
- **RN-M5 — Persistente:** sobrevive a reinício do Hub; some quando a sessão é arquivada ou o dono
  cancela.
- **RN-M6 — Visível:** cada sessão acompanhada mostra o ícone e o tipo de acompanhamento.

### N. Verbosidade
- **RN-N1 — Níveis:** `silencioso` (só o que foi pedido explicitamente) · `essencial` (padrão: fim,
  erro, pergunta) · `detalhado` (inclui progresso). Global + por sessão. Padrão confirmado pelo dono:
  `essencial` (DEC-10).
- **RN-N2 — Comando de voz muda o nível na hora** e confirma em uma frase.

### O. Fila única de fala
- **RN-O1 — Uma fala por vez, no conjunto inteiro de aparelhos que falam para o dono**, não só dentro
  de um aparelho. O Hub é o dono da fila; aparelhos tocam o que o Hub manda e avisam quando acabou.
- **RN-O2 — A fila é por sessão e agrupa.** Cada fala pertence a uma sessão. Na vez de uma sessão,
  todas as falas pendentes dela tocam juntas, na ordem em que chegaram (fila 1 → 2 → 1 toca 1+1,
  depois 2).
- **RN-O3 — Janela de resposta.** Depois de uma sessão falar, o microfone fica aberto pelo tempo de
  continuação que já existe (`continueSec`, mínimo 6 s); o que o dono disser vai para **essa** sessão.
  A fila só passa para a próxima sessão quando a janela fecha sem fala, ou quando o dono diz
  "próxima" / "passe para a próxima" (DEC-09).
- **RN-O4 — Empilha na sessão que está falando.** Fala nova da sessão que está tocando (ou em janela
  de resposta) entra logo depois da fala atual, não no fim da fila.
- **RN-O5 — Entre sessões, prioridade:** pergunta que bloqueia trabalho > aviso de término > alerta
  "importante" > progresso periódico; empate pela ordem de chegada.
- **RN-O6 — Expira:** progresso que ficou velho na fila (nova versão chegou, ou passou do prazo) é
  descartado; nunca se ouve um "está em 40%" depois do "terminou".
- **RN-O7 — "Hey Jarvis" assume na hora:** durante qualquer fala, pausa a voz (barge-in da VOZ-00) e
  ouve. O destino é a sessão que estava falando ou em janela de resposta; fora disso, a voice
  (RN-L1). Depois da resposta, a fila retoma.
- **RN-O8 — A sessão que está falando é visível** em todos os aparelhos (nome + tópico), para o dono
  saber a quem está respondendo.
- **RN-O9 — O listener do PC deixa de ter fila própria:** toca pela fila do Hub como qualquer
  aparelho (hoje é a principal fonte de sobreposição).

### P. Vários aparelhos
- **RN-P1 — Cada aparelho opta:** "Hey Jarvis neste aparelho" é configuração local de cada máquina e
  do celular; desligado não abre o microfone.
- **RN-P2 — Autenticação de listener remoto:** fora da máquina do Hub, o listener se autentica pelo
  pareamento do próprio aparelho/runner (não pelo `wake-token`, que só prova "mesma máquina").
- **RN-P3 — Existe um "líder" que responde**, escolhido pelo dono (tela ou voz). Sem escolha, responde
  quem ouviu.
- **RN-P4 — Trocar o líder por voz** vale até o dono trocar de novo (persistente).
- **RN-P5 — Arbitragem quando mais de um ouve** (janela de ~1,5 s), já na primeira entrega: líder >
  aparelho mais perto do dono (RN-P6) > maior confiança/volume da detecção. Os demais descartam a
  captura.
- **RN-P6 — Proximidade usa rede e localização (DEC-13):** se todos os aparelhos que ouviram têm os
  dois sinais, considera os dois; se algum não tem localização (desligada, negada, máquina sem GPS),
  a comparação usa só a rede (mesma LAN/Tailscale). A localização é opt-in por aparelho.

### Q. Celular
- **RN-Q1 — Só com o app em primeiro plano:** o serviço do Android passa a seguir o ciclo de vida do
  app (liga ao voltar para a tela, desliga ao sair) quando a opção estiver ligada.
- **RN-Q2 — iOS:** o sistema não permite ouvir com o app fechado; o mesmo comportamento (app aberto)
  é o teto lá também.

## 5) Riscos
- **Custo:** resumos periódicos e roteamento "sobre a sessão X" chamam LLM; precisam de modelo barato
  e teto por hora.
- **Privacidade:** vários microfones abertos; localização. Tudo opt-in e visível.
- **Falso positivo multiplicado:** com 4 aparelhos ouvindo, os falsos positivos de 19/10 aparecem 4×
  mais; a comparação de detectores (pendente desde o INC-01) vira pré-requisito da fase de vários
  aparelhos.
- **Antivírus:** cada aparelho novo vai pedir permissão de microfone (Kaspersky, 27/10).
- **Teste:** voz não se valida sem aparelho real (restrição registrada na VOZ-00).

## 6) Decisões do dono (2026-10-27)
- **DEC-09 — "A próxima" é o próximo item da fila de fala.** Primeiro identificar de qual sessão se
  trata; a resposta dada na janela de resposta vai para a sessão que falou; a fila só avança quando a
  janela passa (RN-O2…RN-O4, RN-O7).
- **DEC-10 — Nível padrão de fala:** `essencial`.
- **DEC-11 — Periódico:** 15 min por padrão, configurável.
- **DEC-12 — Arbitragem automática na primeira entrega** de vários aparelhos.
- **DEC-13 — Rede e localização:** as duas quando todos têm as duas; só rede quando falta uma.

### 6.1) Interpretações a confirmar com o dono antes da F1
- **I-1 — Empilhar vale para a mesma sessão.** "Chegou voz durante a fala → toca logo depois" foi lido
  como fala **da sessão que está falando** (coerente com o agrupamento). Fala de outra sessão segue a
  fila e espera a janela de resposta.
- **I-2 — A janela de resposta é o tempo de continuação que já existe** (`continueSec`, Ajustes de
  voz), não um prazo novo.
- **I-3 — Fala interrompida pelo "Hey Jarvis"** não volta a tocar do início; o texto segue na sessão.

## 7) Plano em fases
| Fase | Entrega | Por que nessa ordem |
|---|---|---|
| **F1** | Fila única de fala no Hub com agrupamento por sessão, janela de resposta e empilhamento (RN-O1…RN-O9), listener do PC tocando pela fila | É a dor que já existe hoje e a base de tudo o que vai falar mais |
| **F2** | Botão "Falar com o Jarvis" global + voice com tópico (UC-16, UC-17) | Barato, usa o caminho da voice que já existe |
| **F3** | Acompanhamento por sessão + verbosidade (UC-19, UC-20), comandos de voz | Precisa da F1 para não virar barulho |
| **F4** | Falar SOBRE outra sessão (UC-18) | Depende do roteamento por nome/tópico |
| **F5** | Celular só com app aberto (UC-24) | Muda o serviço Android que já existe; teste em aparelho |
| **F6** | Vários aparelhos: opt-in, autenticação remota, líder manual e arbitragem automática por rede + localização (UC-22, UC-23) | Exige pareamento de listener remoto e a comparação de detectores |

## 8) Validação
- F1 tem teste automático (fila 1 → 2 → 1 tocando 1+1 e depois 2; fala da sessão 1 chegando durante
  a fala dela entra logo depois; a fila não avança com a janela de resposta aberta; "próxima" avança;
  prioridades; expiração) e e2e com dois clientes falsos; o resto exige o dono com aparelhos reais.
- Cada fase registra no log o que decidiu (quem falou, o que foi descartado e por quê).

## 9) Fora de escopo
- Ouvir com o app do celular fechado.
- Voz em navegadores de terceiros (só o app/PWA do Jarvis).
