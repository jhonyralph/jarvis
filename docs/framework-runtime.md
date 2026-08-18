# Como o framework age num turno

`docs/framework-pack.md` descreve **o que** é um pacote. Este documento descreve **o que acontece
depois** — como cada parte chega (ou não) até a IA quando você conversa no chat.

A dúvida que motivou este texto foi: *"importei o framework e não vi nada acontecer em lugar nenhum"*.
A resposta curta é que **o framework não é injetado sozinho — na maior parte, ele é oferecido no
menu `/`**. Publicar não muda o comportamento da IA; muda o que está disponível.

---

## Onde o framework vive

Publicar materializa a árvore em `~/.jarvis/framework/` **em cada máquina**. É só isso que a
publicação faz.

**As pastas nativas das IAs não são tocadas.** Nada é copiado para `~/.claude/skills/`, e nenhum
`CLAUDE.md`/`AGENTS.md` seu é sobrescrito. O Jarvis não altera configuração que é sua.

---

## As cinco partes, uma a uma

| parte | como age | automático? |
|---|---|---|
| `commands/` | corpo inlinado ao digitar `/nome` | não — você invoca |
| `skills/` | corpo inlinado ao digitar `/nome` | não — você invoca |
| `flows/` | instrução do fluxo em todo turno | sim, **depois** de iniciar o acompanhamento |
| `reference/` | nada | não, por desenho |
| `instructions.md` | prefixo em todo turno, descontando o nativo | sim |

### `commands/` — menu `/`, em todas as IAs

Você digita `/ia:review`. Antes de enviar, o Hub **substitui o `/comando` pelo corpo do arquivo**,
trocando `$ARGUMENTS` pelo que você escreveu depois. A IA recebe texto puro — é por isso que o mesmo
comando funciona no Claude, no Codex e no Cursor sem nenhum deles ter suporte a "comandos do Jarvis".

### `skills/` — também no menu `/`

Uma skill do framework **não é escolhida sozinha pela IA**. Ela aparece no `/` e, quando invocada, o
corpo do `SKILL.md` vai **inline** no prompt, prefixado com *"Use a competência «nome» do Framework
Jarvis"*.

Isso é deliberado: a IA do outro lado pode não ter sistema de skills nenhum. Inlining é o que faz
valer em qualquer uma. A contrapartida é que **auto-seleção só existe nas skills nativas** — as que
estão em `~/.claude/skills/` e o próprio provedor descobre.

> O formato `skills/<nome>/SKILL.md` continua obrigatório, mas quem exige é o **scanner do Jarvis**,
> que segue a mesma convenção dos provedores. Um `.md` solto não vira skill em nenhum dos dois mundos.

### `flows/` — nada acontece só por importar

Um fluxo é uma **definição**. Ficar ativo é outra coisa: um *acompanhamento* amarra três coisas — o
fluxo, a **tarefa** e a **sessão**.

Duas formas de começar:

1. **À mão** — o chip `🧭 Fluxo` do composer abre a **faixa** logo acima do campo de digitação. Sem
   fluxo ativo ela vem no modo início: o fluxo **padrão** com `[Iniciar]`, a lista dos outros fluxos
   (com entrada direta num passo) e a gaveta `🎯 Tarefa`, onde se escolhe a fonte, a pasta de features
   e a tarefa. Com fluxo ativo, o mesmo chip abre/fecha a faixa do acompanhamento.
2. **Sozinho** — se o fluxo tem `"autoStart": true`, ele começa a acompanhar na primeira mensagem de
   cada sessão nova. Só entra em sessão que **nunca** teve fluxo; abandonar não faz voltar. O estado
   aparece na própria faixa (`padrão · ▶ inicia sozinho em sessão nova`, com o botão `auto: ON/off`)
   e em *Configurações → Framework* — as duas telas mexem na mesma chave.

A partir daí, **todo turno** recebe na frente do seu texto:

```
Fluxo de trabalho ativo: "Pipeline de engenharia (F1–F14)" — tarefa linear: PRI-824.
Passo atual: F5 — Testes (RED).
1. [x] F1 — Discovery
2. [x] F2 — Arquitetura / Spec
3. [ ] F5 — Testes (RED)
...
7. [ ] F10 — QA Gate (gate: só conferência)
Ao concluir um passo, emita: `jarvis-step: done <número>`
```

A IA responde com `jarvis-step: done 3` numa linha própria, e o Hub marca o passo. Se ela não declarar
nada mas o turno tiver link de PR, hash de commit ou testes verdes, o Jarvis **sugere** marcar —
nunca marca sozinho.

### `reference/` — nada automático, de propósito

Não é lido por IA nenhuma por conta própria. Serve para o que as skills referenciam e para
documentação que você quer publicada junto. É o destino certo do material de apoio que **não** é
skill acionável.

### `instructions.md` — o prefixo universal

Entra como prefixo em todo turno, **descontando o que aquela IA já carrega sozinha**.

Esse desconto não é detalhe: o arquivo normalmente nasce da concatenação dos seus próprios
`CLAUDE.md`/`AGENTS.md` (é assim que "importar desta máquina" o semeia), e o Claude Code já lê o
`~/.claude/CLAUDE.md` em todo turno. Injetar o conjunto mandaria **o mesmo texto duas vezes no mesmo
prompt** — custo dobrado para dizer a mesma coisa. Então o Jarvis remove os blocos que a IA já vê e
injeta só o resto; se não sobrar nada, não injeta nada.

Na prática: no Claude desta máquina costuma sobrar pouco ou nada. Em outra IA, ou em outra máquina
sem aqueles arquivos, vai o conteúdo inteiro — que é exatamente o ponto de ter instruções universais.

**Orçamento: ~2000 tokens.** Acima disso a atenção do modelo degrada e o inventário avisa. Processo
detalhado é **skill** (carrega sob demanda), não instrução.

Desligável em *Configurações → Framework*.

---

## Duas armadilhas comuns

**"Importei o fluxo e ele não ficou ativo."** Correto: importar traz a receita, não põe a panela no
fogo. Veja `flows/` acima.

**"O `instructions.md` tem 20 KB."** Provavelmente ele é a concatenação bruta dos seus arquivos
nativos, com cabeçalhos `# Claude (CLAUDE.md)` e `# AGENTS.md`. Isso é um **ponto de partida**, não o
resultado esperado: a ideia é você editá-lo até virar um texto universal único e curto. Enquanto for
uma cópia do nativo, o desconto acima faz ele não custar nada no Claude local — mas ele viaja inteiro
para as outras máquinas.

---

## Ver também

- `docs/framework-pack.md` — o padrão do pacote (topos, formas, `map`, promoção, `autoStart`).
- `packages/core/src/framework-instructions.ts` — o desconto do nativo, com testes.
- `packages/core/src/workflow-run.ts` — a instrução de fluxo injetada no turno.
