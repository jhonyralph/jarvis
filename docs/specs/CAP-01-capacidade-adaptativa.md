---
feature_id: CAP-01-capacidade-adaptativa
tldr: "O Jarvis mede a máquina, aprende o consumo normal dela e o custo real de cada turno, e só começa trabalho que cabe na folga; o resto espera numa fila visível em Trabalhos. Nada de limite fixo."
title: "Capacidade adaptativa: fila de agentes pelo que a máquina aguenta"
owner: "Jonathan / Claude"
status: draft
risk_level: high
stack: node (hub + runner) + web
services_affected: [hub, runner, web, core]
dependencies: [APC-06-managed-execution-adaptive-budget, JRV-42-stale-notification-turn-kill]
schema_required: false
links:
  design: "Conversa de 2026-10-28: SyNous com ~30 agentes, Hub 'offline', trabalho perdido"
  incidente: "memória hub-stalls-native-list-2026-10-28"
approval_evidence: "Rascunho. Decidido pelo dono em 2026-10-28: nada fixo (aprender do hardware e do consumo do dia a dia), D1, D2 e D3"
---

# Executable spec

## 0) Meta (TL;DR)

Hoje o Jarvis começa todo turno que pedem, na hora. Com vários turnos pesados juntos (um "ultracode"
abre dezenas de agentes), a máquina e o próprio Hub ficam sem fôlego. Esta spec define:

1. **Medir** a máquina continuamente (memória, memória comprometida, CPU, resposta do Hub).
2. **Aprender** o consumo normal dela sem o Jarvis e o custo real de cada tipo de turno.
3. **Admitir** só o turno que cabe na folga; o resto **espera numa fila visível** em Trabalhos.
4. **Orientar** o Claude sobre quantos agentes internos cabem agora (ele tem limites próprios).
5. Nunca matar trabalho para abrir espaço — na pressão, só parar de começar coisa nova.

## 1) Contexto

### 1.1 Decisão do dono (2026-10-28)
> "Eu gostaria que isso fosse feito de forma inteligente. Vamos supor que eu troque a placa de vídeo,
> aumente a memória e até troque de máquina. E aí. Vai ficar fixo? Isso é ruim. Além do mais a máquina
> tem um consumo médio no dia a dia, acredito que dê para saber com base nisso."

### 1.2 O que aconteceu em 28/10 (para não confundir causas)
- **"Hub offline":** NÃO foi falta de recurso. Foi a lista de sessões relendo transcripts no event
  loop (corrigido em 69715db). A máquina tinha 7,5 GB livres e CPU em 9% logo depois.
- **Trabalho do SyNous perdido:** o próprio Claude Code, no modo `-p`, encerra os agentes em segundo
  plano 10 min depois de o agente principal parar de falar (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`).
  13 dos 22 agentes foram cortados juntos. Corrigido à parte (teto de 3 h, JARVIS_CLAUDE_BG_WAIT_MIN).
- **O que sobra para esta spec:** a máquina hoje aguentou, mas nada impede dois ou três ultracodes
  juntos de esgotarem a memória comprometida — que é o que derrubou tudo em outubro
  (memórias machine-freeze-vite-orphans, INC-01).

### 1.3 Alavancas que existem (verificadas no binário do Claude Code instalado)
| Variável | O que faz |
|---|---|
| `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | teto de subagentes simultâneos ("Concurrent subagent limit reached… Do not retry") |
| `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` | teto de agentes simultâneos de um workflow (ultracode) |
| `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` | teto de subagentes por sessão |
| `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` | quanto o `-p` espera agentes em segundo plano (já ajustado) |

O Jarvis inicia cada `claude` e pode passar essas variáveis **por turno** — é como ele controla o
leque interno, que ele não enxerga para enfileirar um a um. Para o Codex e as demais IAs, só o
nível do turno/processo.

## 2) Estado atual
| Peça | Hoje | Lacuna |
|---|---|---|
| Fila por sessão | `enqueueChatTurn` / `maybeFlushQueue` — mensagem para sessão ocupada espera o turno dela | Nenhum limite ENTRE sessões: 5 sessões = 5 turnos ao mesmo tempo |
| Painel Trabalhos | mostra turnos rodando e subagentes (`broadcastRuns`) | Não mostra o que está esperando por capacidade, nem por quê |
| Medição | o Hub mede o próprio event loop (stall forensics, guarda) | Não mede memória/CPU da máquina nem o custo de cada turno |
| Variáveis do Claude | herdadas do processo do Hub | Nenhuma por turno |

## 3) Casos de uso
- **UC-1 — Trocar de máquina ou de memória:** no boot o Jarvis lê o hardware; a capacidade muda sem
  configurar nada.
- **UC-2 — Dia normal:** navegador, IDE e outros programas usam a memória de sempre; o Jarvis conta
  com isso e não toma a folga que você usa.
- **UC-3 — Vários pedidos pesados juntos:** o que não cabe espera na fila, com posição e motivo;
  começa sozinho quando liberar.
- **UC-4 — Um ultracode quando a máquina está apertada:** começa, mas com menos agentes simultâneos.
- **UC-5 — Pedido seu na hora (voz ou digitado):** passa na frente do trabalho em segundo plano.
- **UC-6 — Várias máquinas:** cada uma mede e enfileira o próprio trabalho; o Hub mostra todas.

## 4) Regras
- **R1 — Nada fixo.** Toda capacidade sai de medição; as variáveis de ambiente só ajustam margens.
- **R2 — Amostra contínua** (a cada ~5 s, fora do caminho de qualquer pedido): memória física livre,
  memória comprometida usada/limite, CPU, atraso do event loop do Hub. Leitura assíncrona — a medição
  não pode ser ela mesma uma causa de trava.
- **R3 — Consumo base aprendido:** o que a máquina usa SEM os processos do Jarvis, guardado por hora
  do dia (percentil 90 das últimas semanas, com decaimento). Sem histórico: usa o momento atual.
- **R4 — Custo aprendido por (IA, esforço):** memória e CPU da árvore de processos de cada turno,
  amostradas enquanto ele roda; guarda o percentil 75. Sem dados: estimativa conservadora (ex.: 1,5 GB
  por turno, 4 GB por ultracode) que é substituída pelos dados reais.
- **R5 — Folga** = o menor entre memória física e memória comprometida disponíveis, descontados o
  consumo base da hora e uma **reserva do dono** (padrão 20% do total).
- **R6 — Admissão:** um turno começa se o custo estimado cabe na folga E o Hub está respondendo bem
  (atraso do event loop abaixo de um limiar). Senão, entra na fila de capacidade.
- **R7 — Sempre cabe um:** com nada do Jarvis rodando, o primeiro turno sempre começa (mesmo que a
  folga pareça curta) — a fila nunca trava sozinha.
- **R8 — Prioridade:** pedido do dono na hora (voz, texto) > continuação de um turno (fila da própria
  sessão, notificações de trabalho de fundo) > rotinas e trabalho agendado. Dentro do nível, ordem de
  chegada. Sem fome: quem espera muito sobe.
- **R9 — Leque interno do Claude:** cada `claude` recebe `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`
  e `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` calculados pela folga no momento do início (piso 2).
- **R10 — Nunca matar para abrir espaço.** Sob pressão (folga negativa ou Hub lento), só suspende
  novas admissões; avisa no painel.
- **R11 — Visível:** cada item da fila de capacidade aparece em Trabalhos com posição, motivo
  ("aguardando memória: precisa ~3 GB, livres 1,2 GB") e ação de "começar mesmo assim".
- **R12 — Por máquina:** o runner mede e admite o próprio trabalho; o Hub agrega para o painel.
- **R13 — Registrado:** cada decisão (admitiu, enfileirou, liberou, leque calculado) vai para o log
  estruturado, para calibrar com dados.

## 5) Decisões
- **D1 — Reserva do dono:** 20% da memória (física e comprometida), proporcional ao hardware — fica
  sempre livre para o dono; não é um teto do Jarvis. *Decidido em 2026-10-28.*
- **D2 — "Começar mesmo assim":** só o dono, sem confirmação extra. *Decidido em 2026-10-28.*
- **D3 — Leque do ultracode:** automático pela folga **e** um teto manual nos ajustes; vale o menor
  dos dois. *Decidido em 2026-10-28.*

## 6) Plano em fases
| Fase | Entrega | Por quê nessa ordem |
|---|---|---|
| **F1** | Medição contínua (R2) + registro (R13), sem mudar comportamento | Ver os números reais antes de decidir |
| **F2** | Custo por (IA, esforço) e consumo base (R3, R4), ainda só observando | Precisa de dias de dados |
| **F3** | Admissão + fila de capacidade + prioridade (R5–R8, R10) | A parte que protege |
| **F4** | Painel Trabalhos com a fila e "começar mesmo assim" (R11) | Depende da F3 |
| **F5** | Leque do Claude por turno (R9) | Usa a folga da F3 |
| **F6** | Runner e várias máquinas (R12) | Mesma lógica na outra ponta |

## 7) Validação
- Unidades puras (folga, admissão, prioridade, aprendizado) com relógio e medições falsas.
- E2E com turnos falsos que "pesam" X GB: o terceiro espera; liberar um faz o terceiro começar.
- Em produção: relatório diário dos números (como o de voz) antes de ligar a F3.

## 8) Fora de escopo
- Enfileirar subagentes individualmente dentro do Claude (o Jarvis não os enxerga; usa R9).
- GPU (nenhuma IA usada hoje roda modelo local pesado no caminho do turno; entra se mudar).
