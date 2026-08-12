# Pacote de framework Jarvis — o padrão

Um **pacote de framework** é um conjunto de comandos, skills, fluxos e instruções que o Jarvis
importa, versiona e publica para todas as suas máquinas e para todas as IAs.

Este documento é o contrato. Ele existe porque o formato antes só vivia implícito no código
(`assertSafeRelPath`, `toFrameworkPath`, `classifyFramework`): o importador aceitava o que
*parecesse* certo pelo nome da pasta, e quem montava um framework por fora não tinha nada a seguir.

> Não quer ler tudo? Clique em **Baixar modelo** no painel do framework. Você recebe um pacote
> pronto, válido e comentado — copiar e editar é mais rápido que ler spec.

---

## 1. A forma

Na **raiz** do pacote (uma pasta, um repositório ou um zip):

```
jarvis.pack.json          # identidade do pacote — opcional, recomendado
instructions.md           # instruções universais (sempre-ligadas)
commands/<nome>.md        # um comando "/" por arquivo
skills/<nome>/SKILL.md    # UMA pasta por skill, com o manifesto dentro
flows/<id>.json           # fluxos de trabalho declarados
reference/**              # material de apoio, estrutura livre
```

**Só estes cinco topos entram.** Qualquer outra coisa (`core/`, `profiles/`, `docs/`, `README.md`,
`.github/`) é ignorada na importação e reportada como *fora do escopo* — contada e amostrada na
prévia, nunca descartada em silêncio.

O pacote pode estar dentro de subpastas: a importação procura o primeiro segmento chamado
`commands`, `skills`, `flows` ou `reference` e ancora ali. Uma pasta-invólucro (o `repo-<sha>/` dos
tarballs do GitHub) é atravessada automaticamente. Pastas ocultas (começadas por `.`) nunca entram —
sem essa regra, `.github/workflows/ci.yml` viraria definição de fluxo só pelo nome da pasta.

---

## 2. A regra que mais pega quem migra

**Skill é pasta com `SKILL.md` dentro, um nível só.**

| | |
|---|---|
| ✅ | `skills/entrega-com-evidencia/SKILL.md` |
| ✅ | `skills/entrega-com-evidencia/referencia.md` — apoio ao lado do manifesto |
| ❌ | `skills/quality/clean-code.md` — arquivo solto: entra no framework, nunca é carregado |
| ❌ | `skills/process/writing-skills/SKILL.md` — fundo demais: a descoberta não enxerga |

A descoberta de skills é `skills/<nome>/SKILL.md`, um nível, nome exato (`commands.ts`). Um arquivo
sob `skills/` que não seja isso — nem apoio ao lado de um — é **peso morto**: viaja para todas as
máquinas, ocupa o inventário e nenhuma IA usa.

O **relatório de conformidade** da prévia acusa isso antes de você aplicar, agrupado por pasta.

Se o seu material é documentação de apoio e não skill acionável, o lugar dele é `reference/`.

---

## 3. Os arquivos

### `instructions.md` — o balde sempre-ligado

Uma vez exportado para o `CLAUDE.md`/`AGENTS.md` nativo, entra em **todo turno de toda IA**.
Orçamento: **~2000 tokens**; acima disso a atenção do modelo degrada e o inventário avisa.

Processo detalhado é **skill** (carrega sob demanda), não instrução.

### `commands/<nome>.md` — comandos `/`

Um arquivo `.md` por comando. O nome do arquivo é o nome do comando. `$ARGUMENTS` é substituído pelo
que você digitar depois do comando. Subpastas viram namespace (`commands/git/pr.md` → `/git:pr`).

Frontmatter opcional, mas `description` é recomendado — sem ele o comando aparece sem explicação:

```yaml
---
description: Revisa o diff atual em busca de regressões.
---
```

### `skills/<nome>/SKILL.md` — skills

Frontmatter **obrigatório**:

```yaml
---
name: minha-skill          # minúsculas, números e hífen; até 64 chars; igual ao nome da pasta
description: O que faz E quando usar.   # até 1024 chars
---
```

`description` é o que faz a skill ser **acionada** — descreva o gatilho, não só a função. Sem ele a
skill nunca é escolhida. `name` não pode conter `anthropic` nem `claude`, e não pode colidir com o
de outra skill do pacote.

Corpo acima de **500 linhas** gera aviso: quebre em arquivos de referência ao lado.

### `flows/<id>.json` — fluxos declarados

Fluxo de trabalho que o Jarvis acompanha passo a passo (progresso, gates, evidência):

```json
{
  "schemaVersion": 1,
  "id": "entrega-com-evidencia",
  "name": "Entrega com evidência",
  "source": { "kind": "skill", "path": "skills/entrega-com-evidencia/SKILL.md" },
  "steps": [
    { "id": "1-escopo", "title": "1 — Escopo", "order": 0, "kind": "step" },
    { "id": "2-evidencia", "title": "2 — Evidência", "order": 1, "kind": "step", "requiresEvidence": true },
    { "id": "gate-revisao", "title": "GATE — revisão", "order": 2, "kind": "gate" }
  ]
}
```

- `kind: "gate"` é **ponto de conferência: sinaliza, nunca bloqueia.**
- `requiresEvidence: true` faz o passo pedir anexo (link, print, log) para contar como completo.
- `"autoStart": true` (no nível do fluxo) marca este como o fluxo **padrão**: ele começa a acompanhar
  sozinho cada sessão nova, sem ninguém precisar iniciar à mão. Fica declarado aqui, e não numa
  configuração local, porque quem publica o pacote é quem sabe se aquele processo é *o jeito de
  trabalhar* — e a decisão viaja junto para todas as máquinas.

  Três limites deliberados: só entra em sessão que **nunca** teve fluxo (abandonar não faz voltar);
  se dois pacotes se declararem padrão, vence o menor `id` e o conflito é registrado no log; e o dono
  da máquina desliga tudo de uma vez em *Configurações → Framework*, porque quem sofre com um pacote
  de terceiro afobado é quem está na frente do chat.

Um fluxo pode ser **declarado** (este arquivo, versionado junto com o pacote — autoritativo) ou
**detectado** (o Jarvis lê os títulos numerados e os `GATE` da sua skill e *propõe* os passos, que
você revisa antes de salvar). Declare quando o processo importa; deixe detectar quando for rascunho.

A detecção reconhece três convenções: `### 0 — Título`, `## Phase 1 — Título` (e `Fase`/`Step`/
`Etapa`) e, na ausência de numeração, os checkboxes `- [ ]` de uma seção de checklist.

### `reference/**` — apoio

Estrutura livre. Não é carregado por IA nenhuma automaticamente; serve para o que as skills
referenciam e para documentação que você quer publicada junto.

---

## 4. `jarvis.pack.json` — identidade

```json
{
  "schemaVersion": 1,
  "name": "meu-framework",
  "title": "Meu framework",
  "version": "1.0.0",
  "description": "Processo de engenharia da equipe.",
  "homepage": "https://github.com/voce/meu-framework"
}
```

Só `name` é obrigatório (minúsculas, números e hífen). É ele que faz cada skill, comando e fluxo
mostrar **de qual framework veio** na interface.

**Sem manifesto o pacote importa normalmente** — só que a origem fica *inferida* da fonte (o nome do
zip, o repositório) em vez de declarada pelo pacote, e a prévia avisa. A atribuição é por metadado:
o disco continua plano, e quem sabe de onde cada caminho veio é o registro de fontes. Reimportar o
mesmo caminho de outro pacote transfere a origem para o mais recente, que é o que está no disco.

### `map` — projeção, para quem já tem uma estrutura própria

Um framework de verdade raramente nasce no formato desta página. Se o seu repositório já tem uma
organização — e principalmente se ela é consumida por outra ferramenta — **não reorganize nada**:
declare como ele entra no padrão.

```json
{
  "name": "meu-framework",
  "map": {
    "core/workflows": "commands",
    "core/skills": "reference/skills",
    "core/skills/process/writing-skills": "skills/writing-skills",
    "core/rules": "reference/rules",
    "profiles": null
  }
}
```

- **Chave** = prefixo no seu repositório. **Valor** = onde ele entra, dentro dos cinco topos.
- **`null`** (ou `""`) = **não entra**. É como se exclui uma árvore inteira de propósito — e a prévia
  conta isso separado de "ficou fora do escopo", que é acidente.
- O casamento respeita **fronteira de segmento**: `core/skills` não pega `core/skillsets`.
- A regra **mais específica vence**, independentemente da ordem em que você escreveu.
- Se a origem for um **arquivo**, o destino é usado tal e qual — é assim que se promove um `.md`
  solto a skill: `"core/skills/quality/clean-code.md": "skills/clean-code/SKILL.md"`.
- Caminho que não casa com regra nenhuma segue a ancoragem automática de sempre.

Um destino fora dos cinco topos (ou com `..`) é **recusado e mostrado na prévia** — regra ignorada em
silêncio faria você achar que projetou quando não projetou. A fronteira de segurança continua valendo:
projeção decide o destino, não dá permissão para escrever fora do escopo.

### Promover `.md` soltos a skills

Reposicionar resolve o caminho, mas não o formato: `reference/skills/clean-code.md` continua sem ser
uma skill. Quando a árvore que você está trazendo **é** um conjunto de skills escritas de outro jeito,
use o modo `skill`:

```json
"map": {
  "material/skills": { "to": "skills", "as": "skill" }
}
```

Cada `.md` daquela árvore vira `skills/<slug>/SKILL.md`, com frontmatter gerado:

- **`name`** — do nome do arquivo (ou da pasta, quando o arquivo já é `SKILL.md`), normalizado para
  minúsculas/números/hífen. Nomes repetidos em pastas diferentes ganham sufixo, nunca se sobrescrevem.
- **`description`** — a primeira linha útil da seção *"When to use"* / *"Quando usar"*, se houver;
  senão a primeira prosa do corpo, ignorando títulos, tabelas, citações e blocos de código.
- **O que você já declarou vence.** Se o arquivo tem `name`/`description` no frontmatter, eles são
  mantidos, e campos extras (`allowed-tools`, etc.) são preservados.

**O corpo original vai inteiro**, byte a byte, depois do frontmatter — promover nunca descarta
conteúdo. Arquivos que não são `.md` naquela árvore seguem apenas reposicionados.

O modo exige destino em `skills/`; qualquer outro é recusado como regra inválida.

> Por que não deixar simplesmente qualquer formato virar skill: a descoberta é
> `skills/<nome>/SKILL.md` com `name` e `description`, e quem define isso é o Claude/Codex/Cursor.
> O Jarvis não tem como afrouxar esse contrato — o que ele pode fazer é adaptar o seu material a ele
> na importação, que é exatamente o que este modo faz.

> Por que isto existe: um framework com `core/skills/<categoria>/<arquivo>.md` fazia o importador
> ancorar 103 arquivos em `skills/` — nenhum carregável — e renomear `core/skills/` quebraria o
> composer do próprio repositório. Com `map`, o repositório ganha **um arquivo** e nada se move.

---

## 5. Limites

| | |
|---|---|
| Tamanho por arquivo | 512 KB |
| Tamanho do pacote | 8 MB |
| Arquivos por pacote | 1000 |
| Binários | recusados (qualquer arquivo com byte NUL) |

Além disso, todo pacote passa por uma **varredura de segurança** antes de qualquer coisa ser
escrita: execução dinâmica em contexto, `allowed-tools` amplo demais, download-e-executa. Achados de
severidade alta bloqueiam a importação até você liberar explicitamente.

---

## 6. Como o Jarvis lê o seu pacote

1. **Extração** — ancora os caminhos, rejeita traversal e binário, lê `jarvis.pack.json`.
2. **Prévia** — nada tocou o disco ainda. Você vê:
   - o que entra, o que ficou **fora do escopo** e o que foi **pulado** com o motivo;
   - a **varredura de segurança**;
   - a **validação** (frontmatter, limites, referências quebradas);
   - a **conformidade** (o que entra mas não vai funcionar);
   - o **inventário** de tokens e o diff contra o que já existe.
3. **Aplicar** — só depois da sua confirmação. A fonte fica registrada com o hash do que entrou.
4. **Publicar** — o framework vira um manifesto com hash e é materializado nas outras máquinas,
   podando o que saiu da origem.

---

## Ver também

- `docs/ARCHITECTURE.md` — onde o framework entra no Hub/runner.
- `packages/core/src/framework-pack.ts` — o manifesto e o pacote-modelo, como dados.
- `packages/core/src/framework-conformance.ts` — as regras da seção 2, executáveis.
