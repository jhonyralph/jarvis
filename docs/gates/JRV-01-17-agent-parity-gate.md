# Gate — JRV-01…17 paridade de agentes

Data: 2026-07-20  
Decisão: **PASS condicional por adapter**

## Critérios de merge

| Gate | Resultado |
|---|---|
| Spec aprovada | PASS — aprovação registrada no frontmatter |
| Matriz funcional/minuciosa | PASS — inventário, contrato, comportamento por IA/modelo e gaps residuais |
| TypeScript | PASS — `npm run typecheck` exit 0 |
| Web JS | PASS — `node --check apps/hub/web/app.js` exit 0 |
| Testes | PASS — `npm test`: 151/151 |
| E2E Hub↔Runner | PASS — envio, start, thinking, tool, text, done, usage e reabertura rica |
| Report de adapters | PASS — sem inferência; Claude complete, Codex limited, demais externos ausentes |
| Diff hygiene | PASS — `git diff --check` sem erro (apenas aviso LF→CRLF do Git) |
| Bash/PowerShell syntax | PASS — `bash -n` em 5 scripts; parser PowerShell em 6 scripts |
| Security triage | PASS — permissões explícitas; sem alegação de sandbox |

## Certificação por adapter nesta máquina

| Adapter | Gate |
|---|---|
| Claude Code 2.1.202 | `complete` no descriptor; regressão unitária/integrada verde |
| Codex CLI 0.144.5 | `limited`; catálogo/stream real parcialmente provados, todos os event types ainda não |
| Gemini/Cursor/Copilot/OpenCode/Cline/Qwen | `not_installed`; código fica `unverified` até probe autenticado |
| Continue/Kiro/Antigravity/Aider | `not_installed`; mesmo instalados não passam de `limited` no contrato atual |
| Mock | fixture `limited`, habilitada somente no E2E/teste |

## Bloqueios para promover outro adapter a complete

1. Instalar e autenticar o CLI na máquina-alvo.
2. Rodar fixture/probe real sem alterar o status manualmente.
3. Capturar versão, modelos, efforts, evento de texto, ferramenta, erro,
   cancelamento, usage e resume.
4. Repetir local e Runner remoto e reabrir histórico.
5. Atualizar a matriz e o descriptor somente após as provas.

## Evidência executada

- `npm run typecheck` — exit 0.
- `npm run test:agents` — 40/40.
- `npm run test:e2e` — 1/1, processos reais Hub/Runner e WebSocket.
- `npm test` — 151/151.
- `node --check apps/hub/web/app.js` — exit 0.
- `npm run agents:report` — exit 0, sem prompt/inferência.
- `bash -n scripts/install-hub.sh scripts/install-runner.sh scripts/jarvis-doctor.sh scripts/jarvis-setup.sh scripts/start-hub.sh` — exit 0.
- parser PowerShell — 6/6 scripts sem erro.
- `git diff --check` — exit 0; somente aviso de normalização LF→CRLF.
