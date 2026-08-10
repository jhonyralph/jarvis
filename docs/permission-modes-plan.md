# Plano — Modos de permissão por IA + configuração e herança por sessão/projeto

> Status: **plano aprovado, decisões travadas** (aguardando início da Fase 1).
> Origem: tela nativa de modos do Claude Code (Manual / Aceitar edições / Planejar / Automático / Ignorar permissões) que queremos oferecer no Jarvis para todos os providers.

## Decisões travadas

1. **Enum canônico de permissões** com mapeamento específico por provider. ✅
2. **Modo não suportado por um provider → desabilitar no picker** (cinza, não clicável), igual ao comportamento nativo do Claude Code. ✅
3. **Config durável** → **novo arquivo `~/.jarvis/session-defaults.json`** (não contamina o `policies.json` de autonomia de ações pessoais). ✅
4. **Modo "Manual" real (ponte de aprovação) entra no escopo agora** (Fase 3), não fica para depois. ✅
5. **Herança da última sessão do projeto** inclui **IA + modelo + esforço + modo de permissão**. ✅

## 1. Diagnóstico do estado atual (código real)

- **Permissão hoje:** enum binário `PermissionMode = "provider_default" | "full_access"` em `packages/protocol/src/agent.ts:15`, resolvido de um env global em `packages/core/src/agents.ts:40-44` (`agentPermissionMode()` / `fullAccess()`). Quando `full_access`, cada adapter injeta seu flag de "bypass total"; quando `provider_default`, nenhum flag → default do CLI. Sem UI, sem por-sessão, sem por-projeto.
- **Pontos de injeção de flag por provider (`agents.ts`):**
  - Claude: `--permission-mode bypassPermissions` (`:752` send, `:857` oneShot)
  - Codex: `--dangerously-bypass-approvals-and-sandbox` (`:1165`, `:1293`)
  - Gemini: `--yolo` (`buildGeminiArgs :1607`)
  - Cursor: `--force` (`:1608`) · Copilot: `--yolo` + sempre `--no-ask-user` (`:1609`)
  - OpenCode: `--auto` (`:1610`) · Cline: `--auto-approve true|false` (`:1611`)
  - Qwen: `--approval-mode yolo|default` (`:1612`) · Continue: `--auto` (`:1613`)
  - Kiro: `--trust-all-tools` (`:1614`) · Aider: `--yes-always` (`:300`, `:1760`)
  - Antigravity: `send()` lança (sem modo headless)
- **Sandbox de subagentes gerenciados (fail-closed, independente do modo):** `managedAdapterSecurityArgs()` `agents.ts:165-186` — só Claude (`--safe-mode --permission-mode dontAsk --tools <allowlist>`), Codex (`--sandbox read-only`) e Aider (`--no-auto-commits`); os demais lançam. **NÃO pode ser enfraquecido pelos novos modos.**
- **Sessão (`SessionData`, `store.ts:49-62`):** guarda `agent` + `cwd` (travados na criação). NÃO guarda model/effort/permissão. Model/effort são por-turno (`SendOpts`, resolvidos no cliente `app.js:1995-2016`) e ficam só no `usage` de cada mensagem (`store.ts:21-31`).
- **Projeto:** derivado do `cwd` no cliente (`projectLabelOf`, `app.js:1803`); não é entidade persistida.
- **Config atual:** só `cfg` no localStorage do browser (`app.js:145`) — preso ao navegador. Padrão de escopo server-side (global→projeto→sessão) já existe em `adaptive-policy.ts` (`~/.jarvis/policies.json`), mas para autonomia de ações pessoais.
- **"Última sessão do projeto":** `store.list()` já ordena por `updatedAt` desc (`store.ts:267-282`); filtrar por `cwd` resolve.

## 2. Enum canônico + mapeamento por provider

Enum canônico (retrocompat: `full_access`→`bypass`, `provider_default`→`manual`):

`manual` · `accept_edits` · `plan` · `auto` · `bypass`

| Canônico (UI) | Claude Code | Codex | Gemini | Demais (Cursor/Copilot/OpenCode/Cline/Qwen/Continue/Kiro/Aider) |
|---|---|---|---|---|
| **Manual** (sempre perguntar) | `--permission-mode manual` + ponte de aprovação | `-a on-request --sandbox workspace-write` + ponte (viabilidade headless a confirmar) | ❌ desabilitado | ❌ desabilitado (maioria) |
| **Aceitar edições** | `--permission-mode acceptEdits` | `--sandbox workspace-write` | ❌ | parcial |
| **Planejar** | `--permission-mode plan` | `--sandbox read-only` | ❌ | ❌ |
| **Automático** (IA gerencia) | `--permission-mode auto` ✅ existe | `-a on-request` (modelo decide) | ❌ | ❌ |
| **Ignorar permissões** | `--permission-mode bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` | `--yolo` | `--force`/`--yolo`/`--auto`/`--trust-all-tools`/`--yes-always` |

> **Verificado no CLI instalado:** Claude `--permission-mode` aceita `manual`, `acceptEdits`, `plan`, `auto`, `bypassPermissions` (+`dontAsk`, usado no sandbox gerenciado) → suporta os 5 modos canônicos 1:1. Codex `-a/--ask-for-approval` = `untrusted|on-failure|on-request|never` e `-s/--sandbox` = `read-only|workspace-write|danger-full-access`. Gemini só tem `--yolo` (bypass) — os intermediários ficam desabilitados.

- Cada adapter declara `supportedPermissionModes: PermissionMode[]` em `AgentCapabilities`.
- Resolver central `resolvePermissionArgs(agent, mode)` substitui `fullAccess()` nos pontos de injeção.
- Modo não suportado → **desabilitado no picker** (decisão travada).

## 3. Verificações — resultados

- [x] **Modo "Automático" do Claude** existe como `--permission-mode auto`. Lista completa: `manual|acceptEdits|plan|auto|bypassPermissions|dontAsk`.
- [x] **Vocabulário do Codex:** `-a/--ask-for-approval` = `untrusted|on-failure|on-request|never`; `-s/--sandbox` = `read-only|workspace-write|danger-full-access`; `--dangerously-bypass-approvals-and-sandbox` para bypass total.
- [x] **Gemini:** só `--yolo` (bypass). Sem modos intermediários → desabilitados.
- [ ] **`--permission-prompt-tool` NÃO aparece no `--help` desta versão do Claude** (pode existir oculto, mas não vou depender de contrato não documentado). Canal de aprovação headless documentado = protocolo bidirecional `--input-format stream-json --output-format stream-json`. Ver §4.
- [ ] **Codex on-request em `codex exec` (headless):** viabilidade de round-trip a confirmar quando iniciar a Fase 3 (exec pode auto-negar/falhar em vez de pausar).

## 4. Ponte de aprovação (modo Manual real) — Fase 3, no escopo

O Jarvis roda os CLIs em modo não-interativo, então "sempre perguntar antes de alterar" exige round-trip:
CLI pausa pedindo permissão → Hub captura → UI do Jarvis mostra o pedido → usuário aprova/nega → decisão volta ao CLI.

**Realidade do código hoje:** o adapter do Claude usa `-p --output-format stream-json --verbose` com o prompt via STDIN e fluxo **uni-direcional** (`runStream`, `agents.ts:785`).

**VERIFICADO empiricamente (probe 2026-08-10, Claude Code 2.1.202):** com `-p --input-format stream-json --output-format stream-json --permission-mode manual`, ao precisar de permissão o CLI **NÃO** abre round-trip interativo — ele **auto-nega** a ferramenta (emite `{"type":"user",...,"tool_result":{is_error:true,"...you haven't granted it yet"}}`), o modelo desiste e o turno termina com `"permission_denials":[...]` no `result`. Ou seja, stream-json bidirecional sozinho NÃO é o canal de aprovação. Detalhe: `--permission-mode manual` é reportado no `init` como `permissionMode:"default"` (manual == o "ask" padrão).

**Mecanismo correto da Fase 3 — `--permission-prompt-tool` (ponte MCP):** o Jarvis expõe um servidor MCP com uma tool de permissão e passa `--permission-prompt-tool mcp__<server>__<tool>`. Quando o CLI precisa de permissão, ele CHAMA essa tool com `{tool_name, input}`; a implementação bloqueia, emite um evento `permission_request` para a UI, espera a decisão do usuário e retorna `{behavior:"allow", updatedInput}` ou `{behavior:"deny", message}`. Esse é o contrato do SDK (o flag não aparece no `--help`, mas o canal stream-json puro comprovadamente auto-nega, então a ponte MCP é o caminho).

**Escopo real da Fase 3 (subsistema, não um patch):**
- Servidor MCP de permissão (stdio ou via `--mcp-config`) reaproveitando a infra de MCP do core (`mcp.ts`).
- Registro de aprovações pendentes por turno no Hub + evento `permission_request`/resposta no protocolo.
- UI: card de aprovação (aceitar / negar / **sempre permitir X**), com default seguro em timeout (negar).
- Persistência opcional de "sempre permitir" (candidato a reaproveitar o padrão de escopo do `adaptive-policy`/`session-defaults`).
- **Não** pode enfraquecer o sandbox gerenciado de subagentes (`managedAdapterSecurityArgs`).
- Codex: verificar o análogo (`codex exec` com `-a on-request` provavelmente também exige um canal; a confirmar).

## 5. Config durável + herança (Fase 2)

- **Arquivo novo `~/.jarvis/session-defaults.json`**, estrutura `{ global, projects[] }`, cada entrada `{ agent, model, effort, permissionMode }`, resolvido pelo mesmo padrão de escopo do `adaptive-policy.ts` (global→projeto por `cwd`).
- **Precedência ao criar sessão** (no handler `new`, `apps/hub/src/index.ts:5164`):
  1. Escolha explícita do usuário na criação.
  2. **Projeto existente** → herda da última sessão do mesmo `cwd`: `agent` (campo) + `model`/`effort` (do `usage` da última mensagem) + `permissionMode` (campo novo).
  3. **Projeto novo** → default por-projeto do config, senão global.
  4. Fallback do adapter/sistema.
- Servidor computa o "seed" e devolve na criação; cliente alimenta `jarvis_session_prefs` (`app.js:1979`).

## 6. Mudanças de dados

- `packages/protocol/src/agent.ts:15` — expandir `PermissionMode` (com aliases de retrocompat).
- `AgentCapabilities` — `supportedPermissionModes: PermissionMode[]`.
- `SendOpts` (`agents.ts:137-156`) — `permissionMode` por-turno (como model/effort).
- `SessionData`/`SessionMeta` (`store.ts:35-62`) — `permissionMode` mutável (não travado) + gravar no `usage` por-mensagem.
- Resolver central substituindo `fullAccess()` nos pontos de injeção.
- Preservar `managedAdapterSecurityArgs` intacto.

## 7. UI

Picker de modo ao lado de IA/modelo/esforço em `apps/hub/web`; modos não suportados pela IA atual **desabilitados**; per-sessão (grava em `jarvis_session_prefs`), refletindo o seed herdado. Settings ganha defaults global/por-projeto.

## 8. Fases

1. **Fundação:** enum canônico + `supportedPermissionModes` + resolver central + `permissionMode` em SendOpts/SessionData; expõe Planejar/Aceitar edições/Ignorar/provider_default; retrocompat do env global.
2. **Config + herança:** `session-defaults.json` + precedência no handler `new` (IA/model/effort/permissão); picker na UI.
3. **Ponte de aprovação:** protocolo de round-trip para Manual/"perguntar" (dep. §3).

## 9. Escopo negativo

- Não mexer no `adaptive-policy` de autonomia de ações pessoais.
- Não enfraquecer o sandbox gerenciado de subagentes.
- Não commitar sem autorização explícita.
