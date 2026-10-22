---
feature_id: VOZ-00-voz-efetiva
tldr: "Épico de voz: casos de uso, regras de negócio, orçamento de latência e decisões para a conversa por voz do Jarvis ser rápida, precisa, interrompível e à prova de perda."
title: "Voz efetiva no Jarvis"
owner: "Jonathan / Claude"
status: draft
risk_level: high
stack: node + python
services_affected: [hub, web, mobile, desktop, voice-services]
dependencies: [voice-progressive-disclosure]
schema_required: false
schema_dependencies: []
links:
  roadmap: "Épico novo de voz; consolida o backlog de gaps de voz aberto em 2026-07-24"
  design: "Diagnóstico desta spec (2026-10-22): telemetria de voz, auditoria do código e backlog de gaps"
  adr: "N/A — as decisões ficam na seção 6, como nas demais specs do repo"
approval_evidence: "Usuário em 2026-10-22: 'A gente precisa conseguir fazer o jarvis ser extremamente efetivo relacionado a voz.' Decidido reimplementar ideias do zero, com cada requisito derivado dos próprios requisitos do Jarvis."
---

# Executable spec

## 0) Meta (TL;DR)

A voz do Jarvis funciona, mas é lenta e frágil no caminho que importa: **entre o usuário parar de
falar e o agente começar a trabalhar, a mediana registrada é de 25 segundos** (45 turnos entre
18/07 e 04/08; mínimo 11,5 s, máximo 2,5 min), quase tudo em transcrição e numa chamada de LLM de correção/relevância que roda em série antes do despacho. Do
lado da saída, a fala só começa depois que a resposta inteira existe — e, se for longa, depois de
mais uma chamada de LLM para resumir. Nada disso é medido de ponta a ponta.

Este épico define **o que "efetivo" significa em números**, os casos de uso que a voz precisa
atender, as regras de negócio de cada etapa e uma ordem de entrega em fases. A primeira fase é
medir: sem telemetria por etapa, nenhuma melhoria seguinte é verificável.

## 1) Contexto e objetivo

### 1.1 Problema

Verificado no código e nos dados desta instalação em 2026-10-22:

1. **A entrada é sequencial e cara.** O caminho de um turno de voz hoje é: silêncio de 1,8 s →
   envio do áudio inteiro → transcrição do arquivo inteiro → identificação de falante →
   **correção + portão de relevância por LLM** → despacho. Registros de
   `~/.jarvis/voice-timing.log` (gravados em `apps/hub/src/index.ts:8995`):

   | Etapa (45 turnos, 18/07 a 04/08) | Mínimo | Mediana | Máximo |
   |---|---|---|---|
   | Transcrição | 4,7 s | 20,2 s | 89,2 s |
   | Identificação de falante | 0,10 s | ~0,10 s | 0,16 s |
   | Correção + portão | 1,4 s | 4,6 s | 98,8 s |
   | **Soma até o despacho** | **11,5 s** | **25,0 s** | **154,5 s** |

   O portão cumpre um papel real: 3 falas de 18/07 foram barradas (`relevante=false`) e, pelo
   conteúdo, eram conversa ambiente, não pedidos. O problema é o custo, não a função.

   A correção + portão (`buildVoicePreflightPrompt`, `index.ts:4100`) roda **sempre** que
   `voiceCfg.relevance` está ligado — e o padrão é ligado (`index.ts:820-822`). Ela está no
   caminho crítico de todo turno de voz fora da sessão de wake (`index.ts:8991`).

   Ressalva: esses números são de julho e agosto. Desde então a transcrição foi configurada para
   `JARVIS_STT_MODEL=small` em CUDA com `int8`. Não há medição de um turno real depois disso —
   o único registro posterior (2026-09-26, 310 ms) é de uma fala vazia. **A latência atual da
   transcrição é desconhecida.**

2. **O idioma é adivinhado, e erra.** A transcrição usa `idioma do pedido > JARVIS_STT_LANG >
   autodetecção` (`services/voice/whisper_service.py:169`). O cliente manda `lang: null`
   (`apps/hub/src/stt.ts:129`) e `JARVIS_STT_LANG` não está definido, então tudo cai em
   autodetecção. Resultado registrado em 2026-08-04: uma fala em português transcrita como
   *"Voila, judea pentru ziunului, vamo testa comunicas"* (romeno). A autodetecção é deliberada —
   `stt.ts:6` documenta que ela existe para aceitar fala em inglês —, então corrigir isso é uma
   troca, não um ajuste (ver DEC-04).

3. **A saída só começa no fim.** A síntese recebe o texto completo da resposta. Se a versão falada
   passar de 600 caracteres, `speechForReply` (`index.ts:3728`) faz **mais uma chamada de LLM**
   para resumir antes de sintetizar. Não há fala por frase.

4. **O fim da fala é decidido por um limiar.** O cliente encerra a gravação após `silenceSec`
   segundos de silêncio (padrão 1,8 s, `apps/hub/web/app.js:154`). O usuário relatou que pausas de
   raciocínio continuam cortando o turno mesmo após o ajuste de julho.

5. **Áudio pode se perder.** Não existe armazenamento do áudio bruto antes da transcrição; se
   ela falha ou estoura o tempo, o conteúdo some (relato do usuário, 2026-07-24).

6. **Não há telemetria de ponta a ponta.** Os logs estruturados de 17–20/10 só têm `wake_detect`,
   `wake_status`, `stt_cold_start` e `tts_cold_start`. Nenhum evento mede um turno de voz completo,
   e o lado da saída (do fim do agente até o primeiro som) nunca foi medido.

### 1.2 Objetivo

A voz do Jarvis deve parecer uma conversa, não um formulário. Concretamente:

- **Responder rápido**: o usuário percebe que foi ouvido em instantes e ouve a resposta começar
  sem esperar o texto inteiro.
- **Entender certo**: português do Brasil com termos técnicos em inglês, sem trocar de idioma.
- **Não interromper o usuário** no meio de um raciocínio, e **deixar o usuário interromper** o Jarvis.
- **Nunca perder o que foi dito.**
- **Ser mensurável**: cada etapa tem tempo registrado, e as metas da seção 5 são verificáveis.

### 1.3 Origem dos requisitos

Cada caso de uso e regra desta spec aponta, no campo **Origem**, para uma fonte interna: o backlog
de gaps de voz aberto em 2026-07-24 (gaps numerados G1–G22), a telemetria em
`~/.jarvis/voice-timing.log`, o incidente INC-01 (`docs/reports/INC-01-quedas-do-hub-e-hey-jarvis.md`),
o código auditado em 2026-10-22 ou um relato direto do usuário. As técnicas gerais mencionadas —
segmentar texto em frases, detectar atividade de voz, transcrever de forma incremental — são de
domínio público e já estavam registradas no backlog de julho (G1, G12).

## 2) Estado atual (auditado em 2026-10-22)

| Área | Existe hoje | Onde | Origem |
|---|---|---|---|
| Serviço de síntese persistente | Sim — Piper com modelo quente | `services/voice/piper_service.py`, `apps/hub/src/tts.ts` | G1 |
| Vozes na nuvem com instruções de estilo | Sim — 8 perfis `openai:*-br` | `apps/hub/src/tts.ts` | G6, G9 |
| Endpoint de síntese configurável | **Não** — URL fixa | `apps/hub/src/tts.ts:529` | DEC-06 |
| Fala por frase | **Não** | — | G1 |
| Resumo falado de resposta longa | Sim, por LLM, antes de falar | `index.ts:3728` | G16 |
| Transcrição persistente | Sim — modelo quente, uma requisição por vez | `services/voice/whisper_service.py` | G1, G19 |
| Timeout que reinicia a transcrição travada | Sim | `apps/hub/src/stt.ts` | G19 |
| Transcrição incremental / parciais | **Não** — arquivo inteiro | `whisper_service.py` | G12 |
| Glossário de termos técnicos | Sim | `~/.jarvis/stt-hotwords.txt`, `stt.ts:8` | — |
| Idioma fixo | **Não** — autodetecção | `whisper_service.py:169` | transcrição de 2026-08-04 |
| Fim de fala | Limiar de silêncio configurável | `app.js:154` (`silenceSec`) | G2 |
| Detector de atividade de voz por modelo | **Não** | — | G12 |
| Fila central de áudio (sem sobreposição, parar funciona) | Sim | `app.js:1686` (`audioMgr`) | G3, G7 |
| Confirmar por voz | Sim | `index.ts:3917` (`CONFIRM_RX`) | G14 |
| Abortar por voz | Sim | `index.ts:3924` (`ABORT_RX`) | G13, G14 |
| Encerrar a conversa por voz | Sim | `index.ts:3929` (`CLOSING_RX`) | G17 |
| Ack → processa → entrega | Sim | `packages/core/src/progressive-reply.ts:34` | G18 |
| Áudio bruto guardado antes da transcrição | **Não** | — | G11 |
| Telemetria de turno de voz | Parcial — arquivo à parte, só entrada | `index.ts:8995` | — |
| Identificação de falante | Sim | `services/voice/speaker_id.py` | — |
| Comandos de voz (confirmar/abortar/encerrar) em outro idioma | **Não** — só português | `index.ts:3917-3929` | UC-15 |
| Taxa de gravação definida para fala | **Não** — padrão do navegador | `app.js:5860` (`new MediaRecorder(st)`) | RN-G5 |
| Wake word com estado persistido e reabertura do microfone | Sim | INC-01 | — |

## 3) Casos de uso

Formato: **ator**, **gatilho**, **fluxo principal**, **fluxos alternativos**, **regras**, **origem**.
O ator é sempre o dono do Jarvis falando com ele, salvo indicação.

### UC-01 — Conversa mãos-livres

- **Gatilho:** "Hey Jarvis" ou botão de microfone.
- **Fluxo:** o Jarvis sinaliza que está ouvindo → o usuário fala → o Jarvis detecta o fim da fala →
  transcreve → responde falando → se a conversa continua, volta a ouvir.
- **Alternativos:** sem fala depois do gatilho (UC-10); fala que não é comando (RN-C2); usuário
  encerra (UC-05).
- **Regras:** RN-A1..A4, RN-B1, RN-C1..C3, RN-D1..D3, RN-F1.
- **Origem:** G1, G2, G5.

### UC-02 — Ditar um pedido longo, com pausas de raciocínio

- **Gatilho:** o usuário fala por vários segundos e para para pensar no meio.
- **Fluxo:** a pausa de raciocínio **não** encerra o turno; o fim só vem quando o usuário de fato
  terminou.
- **Alternativos:** o usuário encerra explicitamente ("é isso", botão).
- **Regras:** RN-A1, RN-A2, RN-A3.
- **Origem:** G2 e o relato de 2026-07-24 de que os cortes continuaram após o ajuste de julho.

### UC-03 — Interromper o Jarvis para acrescentar contexto

- **Gatilho:** o usuário fala enquanto o Jarvis está falando ou processando.
- **Fluxo:** o Jarvis para de falar, ouve e incorpora o que foi dito ao pedido em andamento.
- **Regras:** RN-E1, RN-E2.
- **Origem:** G13 (intenção "adicionar contexto").

### UC-04 — Abortar

- **Gatilho:** "para", "cancela", "esquece", "deixa pra lá", "não era isso".
- **Fluxo:** o Jarvis para de falar e de ouvir, descarta o pedido em andamento e confirma em uma
  palavra.
- **Regras:** RN-E3.
- **Origem:** G13 (intenção "abortar"), G14. Já existe (`ABORT_RX`).

### UC-05 — Encerrar a conversa

- **Gatilho:** "obrigado", "valeu", "tchau", sem pedir nada novo.
- **Fluxo:** resposta curta de encerramento; o microfone **não** é reaberto.
- **Regras:** RN-E4.
- **Origem:** G17. Já existe (`CLOSING_RX`).

### UC-06 — Pedido demorado

- **Gatilho:** o pedido exige trabalho real de vários segundos.
- **Fluxo:** confirmação curta e específica imediatamente → trabalho → resultado.
- **Regras:** RN-D4.
- **Origem:** G18. Já existe (`docs/voice-progressive-disclosure.md`).

### UC-07 — Resposta longa falada

- **Gatilho:** a resposta do agente é longa ou tem código, listas, tabelas.
- **Fluxo:** o Jarvis fala o essencial — começando sem esperar o texto inteiro — e o detalhe fica
  no chat. Nunca anuncia "o restante está no chat".
- **Regras:** RN-D1, RN-D2, RN-D3.
- **Origem:** G1, G16.

### UC-08 — Termos técnicos em português

- **Gatilho:** a fala mistura português com nomes de ferramentas, comandos, siglas e bibliotecas.
- **Fluxo:** a transcrição preserva os termos; a síntese os pronuncia de forma inteligível.
- **Regras:** RN-B1, RN-B2, RN-H1, RN-H2.
- **Origem:** G4 e a transcrição em romeno de 2026-08-04.

### UC-09 — Nada do que foi dito se perde

- **Gatilho:** rede cai, transcrição falha ou estoura o tempo.
- **Fluxo:** o áudio continua guardado; o Jarvis avisa e reprocessa sem o usuário repetir.
- **Regras:** RN-G1..G3.
- **Origem:** G11, G19.

### UC-10 — Saber o que o Jarvis está fazendo

- **Gatilho:** qualquer momento de um turno de voz.
- **Fluxo:** estado sempre visível e, quando útil, audível: ouvindo · transcrevendo · pensando ·
  falando · parou por silêncio · erro.
- **Regras:** RN-F1, RN-F2.
- **Origem:** G5.

### UC-11 — Escolher e ouvir vozes

- **Gatilho:** Ajustes de voz.
- **Fluxo:** catálogo com prévia; a escolha persiste por dono.
- **Regras:** RN-I1, RN-I2.
- **Origem:** G6, G9. Já existe o catálogo; falta naturalidade da voz local (G9).

### UC-12 — Voz a partir de qualquer aparelho, sobre qualquer máquina

- **Gatilho:** o usuário fala pelo celular ou desktop sobre uma sessão que roda em outra máquina.
- **Fluxo:** o pedido chega à sessão certa e a resposta volta falada para o aparelho de origem.
- **Regras:** RN-J2.
- **Origem:** G22.

### UC-13 — Troca de assunto no meio da conversa

- **Gatilho:** pergunta sem relação com a sessão ativa.
- **Fluxo:** o Jarvis percebe e pergunta se deve abrir uma sessão separada, em vez de misturar.
- **Regras:** RN-C4.
- **Origem:** G21.

### UC-14 — Fala de outra pessoa ou ruído

- **Gatilho:** voz de terceiro ou ruído ambiente durante a escuta.
- **Fluxo:** não vira comando.
- **Regras:** RN-J1.
- **Origem:** identificação de falante existente (`speaker_id.py`).

### UC-15 — Praticar um idioma

- **Gatilho:** "Jarvis, vamos praticar inglês" ou escolha nos Ajustes.
- **Fluxo:** a conversa por voz passa a escutar e responder no idioma escolhido, com uma voz que
  fala esse idioma. Depois de cada resposta, se a correção estiver ligada, o Jarvis aponta em uma
  frase curta o que poderia ser dito melhor. "Volta pro português" encerra o modo.
- **Alternativos:** o usuário trava e fala em português no meio → o Jarvis entende e ajuda no
  idioma praticado; abortar e encerrar em português funcionam sempre.
- **Regras:** RN-H3..H7.
- **Origem:** decisão do dono em 2026-10-22 ("é uma meta começar a treinar línguas").

## 4) Regras de negócio

Cada regra: **enunciado**, **porquê**, **como verificar**. Números marcados como *proposta* são
alvos iniciais para validar com uso real, não requisitos já confirmados.

### A. Captura e fim de fala

- **RN-A1 — Pausa de raciocínio não encerra o turno.** O fim da fala precisa distinguir "terminei"
  de "estou pensando". *Porquê:* G2 persiste com 1,8 s. *Verificar:* roteiro de dispositivo com
  pausas de 2–4 s no meio de uma frase; zero cortes.
- **RN-A2 — O fim da fala usa sinal de voz, não só amplitude.** Ruído ambiente não pode manter o
  turno aberto, e fala baixa não pode ser lida como silêncio. *Porquê:* G12 (o "VAD" atual é
  limiar de amplitude). *Verificar:* gravações de referência com ruído e fala baixa.
- **RN-A3 — Silêncio mínimo e máximo assimétricos.** Encerrar exige silêncio sustentado após fala;
  desistir sem fala nenhuma tem prazo próprio. *Porquê:* G12. *Verificar:* testes unitários da
  função de decisão com sequências sintéticas de quadros.
- **RN-A4 — Encerramento explícito sempre vence.** Botão, "é isso" ou "pode mandar" encerram na
  hora. *Origem:* `CONFIRM_RX`.

### B. Transcrição

- **RN-B1 — Termos técnicos são preservados.** O glossário (`stt-hotwords.txt`) é aplicado em toda
  transcrição. *Verificar:* conjunto de frases de teste com termos do glossário.
- **RN-B2 — Idioma não troca no meio de uma conversa em português.** Ver DEC-04. *Verificar:* a
  frase de 2026-08-04 e variantes nunca saem em outro idioma.
- **RN-B3 — Transcrição não bloqueia o despacho mais do que o necessário.** Quando houver
  transcrição incremental, o texto já transcrito avança enquanto o usuário fala. *Origem:* G12.
- **RN-B4 — Falha de transcrição não perde o áudio.** Ver RN-G1.

### C. Pré-processamento (correção e relevância)

- **RN-C1 — O portão de relevância não pode custar mais que o turno que ele protege.** Hoje ele
  soma de 1,4 s a 98,8 s (mediana 4,6 s) antes de qualquer trabalho. Ver DEC-03. *Verificar:*
  telemetria da etapa (RN-K1).
- **RN-C2 — Fala que não é comando não vira turno.** Mantém a função atual do portão.
- **RN-C3 — Correção da transcrição é opcional por confiança.** Corrigir texto que já saiu certo é
  desperdício. Ver DEC-03.
- **RN-C4 — Troca de assunto é sugerida, nunca decidida em silêncio.** *Origem:* G21.
- **RN-C5 — O dono escolhe entre velocidade e rigor.** Três níveis, por dono:

  | Nível | Antes de despachar | Efeito |
  |---|---|---|
  | **Rápido** | só regras baratas | nenhuma chamada de IA; fala ambígua vira pedido |
  | **Equilibrado** (padrão) | regras; IA só na fala ambígua; correção só com confiança baixa | custo de IA só onde há dúvida |
  | **Rigoroso** | IA sempre (comportamento de hoje) | menos falsos pedidos, mais espera |

  *Migração:* quem hoje tem `relevance` desligado em `voice-cfg.json` entra em Rápido; os demais
  entram em Equilibrado. *Verificar:* a telemetria registra o nível, se a fala foi barrada e quanto
  a etapa custou — é com esses dados que se ajusta o que conta como "ambíguo".

### D. Síntese e fala

- **RN-D1 — A fala começa antes da resposta inteira existir.** Assim que houver uma primeira frase
  completa e falável, ela é sintetizada e tocada; as seguintes entram em fila. *Origem:* G1.
- **RN-D2 — Frases são cortadas em fronteira de sentido.** Abreviações, números, versões e nomes de
  arquivo não quebram frase. *Verificar:* testes unitários com textos técnicos em português.
- **RN-D3 — Resposta longa vira resumo falado útil, sem frase fixa de corte.** *Origem:* G16. Ver
  DEC-05 sobre como isso convive com RN-D1.
- **RN-D4 — Trabalho demorado recebe confirmação imediata e específica.** *Origem:* G18 (existente).
- **RN-D5 — Uma única fila de reprodução.** Nada toca por cima de nada; parar para tudo.
  *Origem:* G3, G7 (existente, `audioMgr`).

### E. Tomada de turno

- **RN-E1 — Falar por cima do Jarvis interrompe a fala dele.**
- **RN-E2 — Interromper para acrescentar contexto não descarta o pedido.** *Origem:* G13(a).
- **RN-E3 — Abortar descarta e não pergunta nada.** *Origem:* G13(b), G14 (existente).
- **RN-E4 — Encerramento não reabre o microfone.** *Origem:* G17 (existente).
- **RN-E5 — Texto e voz da mesma sessão não se misturam.** Um turno de cada vez por sessão.
  *Origem:* G20 (corrigido em julho; vira regra para não regredir).

### F. Estado e feedback

- **RN-F1 — Todo estado de voz é observável** (ouvindo, transcrevendo, pensando, falando, parou por
  silêncio, erro), no aparelho que iniciou o turno. *Origem:* G5.
- **RN-F2 — Erro diz o que aconteceu e o que foi preservado.** "Não consegui transcrever; seu áudio
  está guardado, vou tentar de novo" — nunca um erro mudo.

### G. Durabilidade

- **RN-G1 — O áudio bruto é guardado antes de qualquer processamento**, no aparelho (sobrevive a
  queda de conexão) e no Hub (permite reprocessar). *Origem:* G11.
- **RN-G2 — Guardar serve para uma coisa só: não perder fala.** Se a transcrição falha, estoura o
  tempo ou a conexão cai, o áudio ainda existe e é reprocessado. Não é arquivo nem histórico de
  áudio. *Origem:* G11, G19.
- **RN-G3 — Reprocessar não exige o usuário repetir.** *Origem:* G11, G19.
- **RN-G4 — A retenção é configurável em modo, prazo e espaço**, no Hub e no aparelho:

  | Opção | Valores | Padrão (*proposta*) |
  |---|---|---|
  | Modo | só até dar certo · guardar por N dias · não guardar | só até dar certo |
  | Prazo das falas que falharam | dias | 7 |
  | Teto de espaço no Hub | MB, apagando a mais antiga | 200 MB |
  | Teto de espaço no aparelho | MB, apagando a mais antiga | 50 MB |

  Em "só até dar certo", o áudio é apagado assim que a transcrição é entregue: no uso normal o
  espaço ocupado fica perto de zero e só as falhas permanecem. "Não guardar" mantém o
  comportamento de hoje, com o risco de perda.
- **RN-G5 — A taxa de gravação é definida para fala.** Hoje o gravador usa o padrão do navegador
  (`app.js:5860`). Fixar uma taxa adequada para voz reduz espaço e tempo de envio — a 32 kbit/s,
  um minuto de fala ocupa cerca de 0,24 MB. *Verificar:* a taxa escolhida não piora a
  transcrição no conjunto de frases de teste.

### H. Idioma

- **RN-H1 — Português do Brasil é o idioma padrão de fala e de escuta.** *Origem:* G4.
- **RN-H2 — Termos técnicos em inglês são pronunciados de forma inteligível** pela voz escolhida.
  *Verificar:* teste de escuta com o conjunto de frases de UC-08.
- **RN-H3 — O idioma de escuta é escolhido, não adivinhado entre todos.** Três modos:
  - **Fixo:** um idioma só. Padrão: português.
  - **Conjunto:** a detecção escolhe só entre os idiomas marcados (ex.: português e inglês).
  - **Prática:** o idioma praticado, com português permitido para o usuário pedir ajuda.

  Autodetecção livre entre todos os idiomas não é oferecida como padrão. *Porquê:* a transcrição
  em romeno de 2026-08-04; e quem pratica um idioma fala com sotaque, que é exatamente o caso em que
  a detecção livre mais erra. *Viabilidade verificada:* a biblioteca de transcrição instalada
  (faster-whisper 1.2.1) expõe `detect_language`, que devolve a probabilidade de cada idioma —
  basta escolher o mais provável dentro do conjunto e transcrever com ele fixado.
- **RN-H4 — O idioma é por dono e troca por voz ou nos Ajustes.** A troca por voz é confirmada em
  uma frase curta, já no novo idioma.
- **RN-H5 — Comandos de controle funcionam em qualquer modo.** Confirmar, abortar e encerrar valem
  sempre em português e também no idioma praticado. *Porquê:* hoje esses comandos só reconhecem
  português (`index.ts:3917-3929`) — no modo prática, "stop" não abortaria nada.
- **RN-H6 — Resposta e voz seguem o idioma da conversa.** O texto do agente sai no idioma
  praticado, a voz precisa falar esse idioma e os marcadores falados que hoje são fixos em
  português (ex.: "(tabela no chat)" em `speechify.ts`) também mudam. Voz sem suporte ao idioma →
  avisa e oferece outra (RN-I3).
- **RN-H7 — No modo prática, a correção é curta, opcional e vem depois.** Liga e desliga; nunca
  interrompe a fala do usuário.

### I. Vozes

- **RN-I1 — A voz é escolhida por dono e persiste.** *Origem:* G6 (existente).
- **RN-I2 — Toda voz oferecida tem prévia.** *Origem:* G6 (existente).
- **RN-I3 — Voz indisponível degrada para outra, nunca para silêncio.** Sem chave da nuvem, cai na
  local; sem a local, avisa no chat.

### J. Privacidade e segurança

- **RN-J1 — Fala de terceiro não vira comando** quando a verificação de falante estiver ligada.
- **RN-J2 — O áudio e a transcrição seguem os mesmos acessos da sessão.** Membro sem acesso à
  máquina não ouve nem lê o que foi dito ali.
- **RN-J3 — Áudio guardado é tratado como dado pessoal**: prazo e espaço (RN-G4), exclusão pelo dono.

### K. Observabilidade

- **RN-K1 — Todo turno de voz emite um evento com o tempo de cada etapa**, da entrada à saída, nos
  logs estruturados (não em arquivo à parte). Ver seção 5.
- **RN-K2 — As metas da seção 5 são verificadas pela telemetria**, não por impressão.

## 5) Orçamento de latência

Etapas do turno de voz, do fim da fala do usuário ao primeiro som da resposta. "Medido" vem de
`voice-timing.log`; "não medido" é lacuna que a fase F0 fecha.

| # | Etapa | Medido | Meta (*proposta*) |
|---|---|---|---|
| 1 | Fim da fala detectado | 1,8 s fixos de silêncio | a definir após F4 |
| 2 | Transcrição | mediana 20,2 s (4,7–89 s, jul–ago) · atual desconhecido | ≤ 1 s após o fim da fala |
| 3 | Identificação de falante | 0,1–0,16 s | manter |
| 4 | Correção + relevância | mediana 4,6 s (1,4–98,8 s) | fora do caminho crítico (DEC-03) |
| 5 | Confirmação "recebi" ao usuário | não medido | ≤ 1,5 s após o fim da fala |
| 6 | Trabalho do agente | não medido | — (depende do pedido) |
| 7 | Do fim do agente ao primeiro som | não medido | ≤ 1 s |
| 8 | Do primeiro trecho de texto ao primeiro som (com fala por frase) | não existe | ≤ 1 s |

## 6) Decisões a tomar

### DEC-01 — Onde e como decidir o fim da fala

- **A.** Manter limiar de amplitude no cliente, só ajustando números. Barato; não resolve G2.
- **B.** Detector de atividade de voz por modelo no cliente. Funciona em navegador e no app; exige
  escolher e empacotar o detector.
- **C.** Decisão no servidor, sobre áudio em fluxo. Mais preciso; depende de DEC-02.
- **D.** C + decisão semântica (a frase parece completa?). Melhor resultado; maior custo.
- **Recomendação:** B agora, D como evolução depois de DEC-02.

### DEC-02 — Transcrição de arquivo inteiro ou incremental

- **A.** Arquivo inteiro (hoje). Simples; latência cresce com o tamanho da fala.
- **B.** Incremental, com parciais enviadas ao cliente. Viabiliza RN-B3, DEC-01 D e confirmação
  antecipada; muda cliente, protocolo e serviço.
- **Recomendação:** B, mas só depois de F0 provar onde o tempo está hoje (com CUDA + `small` a
  transcrição pode já estar rápida o suficiente).

### DEC-03 — Correção e portão de relevância

- **A.** Manter em série (hoje).
- **B.** Rodar em paralelo com o início do turno; se a fala for irrelevante, cancelar.
- **C.** Portão por regras baratas primeiro (comprimento, palavras de comando, falante verificado)
  e LLM só no caso ambíguo.
- **D.** Correção só quando a confiança da transcrição for baixa.
- **Decidido (dono, 2026-10-22):** C + D, configurável em três níveis (RN-C5), com Equilibrado
  como padrão. O dono aceita que uma fala ambígua às vezes vire pedido por engano em troca de
  velocidade. B foi descartada: cancelar um turno já iniciado tem custo e pode deixar efeito
  colateral.

### DEC-04 — Idioma da transcrição

- **A.** Autodetecção (hoje). Aceita inglês; erra como em 2026-08-04.
- **B.** Fixar português e depender do glossário para termos em inglês. Acaba com o erro; frases
  inteiras em inglês ficam piores.
- **C.** Idioma por dono/aparelho, configurável, com português como padrão.
- **D.** Restringir a detecção a português e inglês. *Viabilidade técnica a verificar* na biblioteca
  de transcrição.
- **Decidido (dono, 2026-10-22):** C + D, na forma dos três modos de RN-H3, com Fixo em português
  como padrão. O dono não fala inglês com o Jarvis hoje, mas quer usá-lo para praticar idiomas
  (UC-15) — por isso a escolha não pode ser só "fixar português". D é viável (ver RN-H3).
- **Limite conhecido:** o modelo de transcrição em uso (`small`) é multilíngue, mas modelos
  menores perdem mais qualidade fora do inglês. Se a prática de algum idioma ficar ruim, a saída é
  um modelo maior só para o modo prática — medir antes de decidir.

### DEC-05 — Fala por frase e resumo falado

O resumo por LLM (RN-D3) precisa do texto inteiro; a fala por frase (RN-D1) quer começar antes.

- **A.** Fala por frase para respostas curtas; resumo para longas (decidido pelo tamanho final).
  Respostas longas continuam lentas para começar.
- **B.** Confirmação falada imediata + fala por frase de um resumo produzido em fluxo.
- **C.** O agente já produz, em paralelo, uma versão falada curta.
- **Recomendação:** A como primeira entrega (ganho imediato nas curtas, risco baixo); avaliar B
  com a telemetria de F0.

### DEC-06 — Motor de síntese

- **A.** Piper local (hoje, gratuito, menos natural — G9).
- **B.** Nuvem (hoje, `gpt-4o-mini-tts`, natural, custo por uso, depende de rede).
- **C.** Endpoint compatível com a API de fala da OpenAI, **configurável** — permite trocar o
  provedor (inclusive um servidor local) sem mudar o cliente. Exige tornar configurável a URL
  hoje fixa em `tts.ts:529`.
- **Comparação**, para responder "qual é melhor":

  | Critério | Nuvem (`gpt-4o-mini-tts`) | Local (Piper) |
  |---|---|---|
  | Naturalidade | alta; aceita instrução de estilo (os 8 perfis de hoje) | média; o modelo "medium" soa robótico (G9) |
  | Outros idiomas | a mesma voz fala vários idiomas | uma voz por idioma, baixada à parte |
  | Custo | por uso | zero |
  | Sem internet | não funciona | funciona |
  | Privacidade | o texto sai da máquina | fica na máquina |
  | Tempo até o primeiro som | depende da rede — **não medido** | modelo já carregado — **não medido** |

  Nenhum dos dois ganha em tudo: a nuvem é melhor em naturalidade e na prática de idiomas; a local
  em custo, privacidade e uso sem internet. A velocidade, que é o critério principal deste épico,
  ainda não foi medida em nenhum dos dois.
- **Decidido (dono, 2026-10-22):** os dois disponíveis e configuráveis, com troca automática para
  a local quando a nuvem falhar (RN-I3). Padrão proposto: nuvem, por naturalidade e idiomas. O
  padrão é revisto quando F0 medir o tempo até o primeiro som de cada um. C (endereço
  configurável) entra em F1 de qualquer forma.

### DEC-07 — Durabilidade do áudio

- **A.** Só no aparelho. **B.** Só no Hub. **C.** Nos dois.
- **Recomendação:** C (RN-G1).
- **Decidido (dono, 2026-10-22):** retenção configurável em modo, prazo e espaço (RN-G4), com
  "só até dar certo" como padrão — responde à preocupação com consumo de espaço.

### DEC-08 — Telemetria

- **Recomendação:** evento `voice_turn` nos logs estruturados com o tempo de cada etapa da seção 5,
  substituindo a escrita em `voice-timing.log`. Sem texto da fala no evento (só tamanhos e tempos).

## 7) Plano em fases

Cada fase entrega valor sozinha e é verificável pela telemetria de F0.

| Fase | Entrega | Regras | Risco | Precisa de restart do Hub |
|---|---|---|---|---|
| **F0** | Evento `voice_turn` com todas as etapas, inclusive saída | RN-K1, RN-K2 | Baixo | Sim |
| **F1** | Ganhos rápidos: modo de escuta Fixo em português, já com a configuração dos três modos (DEC-04); níveis Rápido/Equilibrado/Rigoroso (DEC-03); endereço de síntese configurável (DEC-06 C) | RN-B2, RN-C1, RN-C3, RN-C5, RN-H1, RN-H3, RN-H4 | Baixo | Sim |
| **F2** | Fala por frase nas respostas curtas (DEC-05 A) | RN-D1, RN-D2 | Médio | Sim |
| **F3** | Durabilidade do áudio no aparelho e no Hub, com política de retenção e taxa de gravação definida | RN-G1..G5, RN-J3 | Médio | Sim |
| **F4** | Detector de voz por modelo no cliente (DEC-01 B) | RN-A1..A3 | Médio | Não (cliente) |
| **F5** | Transcrição incremental e fim de turno semântico (DEC-02 B, DEC-01 D); troca de assunto; voz entre máquinas | RN-B3, RN-C4, UC-12, UC-13 | Alto | Sim |
| **F6** | Modo prática de idioma: modos Conjunto e Prática, comandos em outros idiomas, voz e marcadores por idioma, correção opcional. Depende de F1; fica melhor depois de F2 | UC-15, RN-H3, RN-H5..H7 | Médio | Sim |

**Critério de pronto de cada fase:** testes verdes, telemetria mostrando a etapa dentro da meta em
uso real por uma semana, e roteiro de dispositivo da seção 8 aprovado pelo usuário.

## 8) Validação

### Restrições duras

- **Voz não é testável sem dispositivo.** Toda fase termina com o usuário testando em aparelho real
  com microfone e alto-falante.
- **Nunca abrir captura de microfone a partir do shell do agente.** O agente roda na sessão 0, como
  filho do serviço do Hub; abrir o microfone ali já derrubou o serviço de Áudio do Windows duas
  vezes (INC-01). Teste de áudio local exige tarefa agendada interativa na sessão do usuário.
- **Mudanças no Hub só valem após restart**, conduzido pelo usuário.

### O que dá para testar automaticamente

- Decisão de fim de fala (RN-A3) como função pura sobre quadros sintéticos.
- Corte de frases (RN-D2) como função pura sobre textos técnicos em português.
- Portão por regras (DEC-03 C) como função pura.
- Agregação e formato do evento `voice_turn` (RN-K1).
- Escolha do idioma dentro do conjunto permitido, dadas as probabilidades (RN-H3).
- Comandos de controle em português e no idioma praticado (RN-H5).
- Política de retenção: o que apagar, dado modo, prazo, teto e lista de arquivos (RN-G4).

### Roteiro de dispositivo (por fase)

1. Frase curta → tempo até o primeiro som.
2. Frase longa com duas pausas de raciocínio → nenhum corte.
3. Frase com termos do glossário → termos corretos na transcrição.
4. Falar por cima do Jarvis → ele para e incorpora.
5. "Para" no meio → aborta sem perguntar.
6. "Obrigado" → encerra sem reabrir o microfone.
7. Derrubar a rede no meio de uma fala → áudio preservado e reprocessado (a partir de F3).
8. "Vamos praticar inglês" → escuta, resposta e voz em inglês; "stop" aborta; "volta pro
   português" encerra o modo (a partir de F6).

## 9) Fora de escopo

- Produção de áudio (narração longa, dublagem de vídeo, edição de áudio).
- Clonagem da voz de terceiros.
- Wake word com tela bloqueada no Android — depende de captura nativa (`app.js`, ajuda
  `hWakeLocked`); tratado no épico mobile.

## 10) Decisões do dono e perguntas abertas

### Respondidas em 2026-10-22

1. **Idioma (DEC-04):** não fala inglês com o Jarvis hoje, mas quer praticar idiomas com ele → três
   modos de escuta (RN-H3) e modo prática (UC-15, F6).
2. **Rigor do portão (DEC-03):** aceita falsos pedidos ocasionais em troca de velocidade, desde
   que configurável → três níveis (RN-C5), Equilibrado como padrão.
3. **Retenção do áudio (RN-G4):** perguntou para que serve e pediu controle de dias e espaço →
   finalidade única em RN-G2, retenção configurável, padrão "só até dar certo".
4. **Voz nuvem ou local (DEC-06):** quer a melhor, configurável se as duas forem aceitáveis → as
   duas, com troca automática; o padrão é revisto com as medições de F0.

### Ainda abertas

1. **UC-15:** quais idiomas praticar primeiro? Proposta: inglês e espanhol. O modelo de
   transcrição cobre os idiomas mais falados; o limite prático é a qualidade da voz e da
   transcrição em cada um.
2. **RN-H7:** a correção no modo prática começa ligada ou desligada?
3. **Seção 5:** as metas propostas batem com a sua percepção de "rápido"?
