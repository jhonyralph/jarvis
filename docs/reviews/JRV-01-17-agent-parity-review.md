# Review — JRV-01…17 paridade de agentes

Data: 2026-07-20  
Escopo: core, protocol, Hub, Runner, web, MCP, scripts e documentação.  
Spec: [`../specs/JRV-01-17-agent-parity.md`](../specs/JRV-01-17-agent-parity.md)  
Fonte de verdade: [`../agent-parity-matrix.md`](../agent-parity-matrix.md)

## Resultado

**Aprovado para merge da infraestrutura comum, com certificação externa
pendente por adapter.** Nenhum adapter sem prova real é promovido a `complete`.
Claude Code é a referência completa nesta máquina; Codex permanece `limited`;
os CLIs ausentes ficam `not_installed`.

## Findings e resolução

| Severidade | Finding | Resolução |
|---|---|---|
| P0 | Runner persistia somente o texto final e divergia do lifecycle local | `runManagedTurn`, attachments, activity e usage compartilhados; E2E remoto reabre o mesmo histórico |
| P0 | Runner antigo/cliente antigo podiam misturar contratos | protocolo v2 + `contractVersion`; incompatibilidade é bloqueada |
| P0 | Mock podia aparecer como IA de produção | disponibilidade restrita a teste/env explícita; descriptor `limited` |
| P0 | Custo estimado, billed e assinatura eram semanticamente misturados | ledger append-only tipado e subtotais separados; cap considera somente billed |
| P0 | Antigravity era chamado pelo binário inexistente `antigravity` e poderia abrir TUI/hangar | binário oficial `agy`; adapter não executável até contrato headless público |
| P1 | UI remota mostrava modelos/esforços do Hub em vez do Runner | descriptors completos por máquina; `capsFor` e rotinas usam a máquina dona |
| P1 | Rotina podia oferecer agente/modelo indisponível na máquina escolhida | seletores filtrados pela allow-list executável do Runner |
| P1 | Default direto do Hub era `mock`, divergindo de README/scripts | default restaurado para `claude-code`; mock exige opt-in |
| P1 | Continue/OpenCode usavam flags desatualizadas | Continue `--allow "*"`; OpenCode `--auto`/`--variant`, conforme docs oficiais atuais |
| P1 | Kiro não aproveitava catálogo oficial | `chat --list-models --format json`, parser defensivo e fallback vazio |
| P1 | Dólar sem proveniência podia ficar classificado como `tokens_only` | passa a `estimated_api_equivalent`; somente fonte explicitamente billed usa `billed` |
| P1 | Validação de modelo não era chamada nos adapters estruturados/final-only | validação pré-spawn aplicada; catálogo vazio mantém apenas seleção automática do provedor |
| P1 | Arquitetura/README descreviam PWA, rede e listener inexistentes/incorretos | documentação alinhada ao código atual |
| P2 | Comentários ainda diziam que Codex era final-only e reconciliação era Claude-only | comentários e matriz corrigidos |
| P2 | Teardown E2E deixava filhos/locks no Windows | encerra árvore com `taskkill /T /F` e remove diretório com retry |

## Revisão adversarial

1. **Cross coverage:** busca global por nomes de fornecedores, defaults,
   permissões e prefixos nativos. Hardcodes restantes são fontes específicas
   legítimas (transcript Claude/Codex, uso de plano Claude, labels/ícones).
2. **Consistência:** Hub e Runner registram a mesma lista de adapters; report,
   doctor e installers usam os mesmos binários (`agy` para Antigravity).
3. **Cenário adversarial:** Runner remoto com catálogo diferente do Hub. A UI
   agora usa `agentDescriptors` do Runner e não oferece agentes indisponíveis em
   configurações/rotinas.
4. **Consequências das opções:** `full-access` permite execução arbitrária;
   `provider-default` pode bloquear/hangar um headless que peça aprovação e não é
   sandbox Jarvis. Ambos estão documentados.
5. **Ambiente:** Node 22/npm/PowerShell foram usados. Bash foi validado somente
   por sintaxe; CLIs externas ausentes não foram instaladas nem autenticadas.

## Riscos residuais aceitos

- O schema canônico existe e a versão é negociada, mas o web transport ainda
  carrega o shape compatível `stream`; migrar toda a UI para `AgentEvent` é uma
  evolução de protocolo, não requisito para a equivalência visual entregue.
- E2E prova processos Hub/Runner/WebSocket/store com fixture determinística; não
  prova DOM, reconnect/restart no meio de ferramenta ou dois browsers.
- Parsers de Gemini/Cursor/Copilot/OpenCode/Cline/Qwen são fixtures/documentação,
  não certificação de uma instalação real.
- Buffers vivos/outbox possuem limites sem indicador visual de truncamento.
- Catálogo Kiro é defensivo porque o schema JSON detalhado não foi publicado na
  página de referência; uma instalação real pode exigir ajuste antes de sair de
  `unverified`.

## Segurança

Nenhuma credencial foi lida ou exibida. Probes de catálogo/versão não enviam
prompt. O startup não executa warm-up de inferência. Conteúdo de ferramentas não
entra em métricas. O modo histórico continua `full-access`, portanto acesso a um
Runner equivale a acesso de shell; o operador deve usar VM/container para
contenção forte.
