# Fontes de tarefa (de onde vêm as tarefas de um projeto)

Cada projeto (pasta) declara **uma** fonte de tarefas. Uma só, sempre — nunca duas na mesma lista,
e nunca um padrão implícito: sem declaração, o Jarvis pede que você escolha em vez de adivinhar.

O vínculo é lembrado **por pasta** e resolvido **na máquina onde a sessão roda** (projeto na Luby usa
o vínculo da Luby, não o do Desktop).

| Fonte | O que lista | Onde executa |
|---|---|---|
| `local` | arquivos `.md` de uma pasta de features (padrão `docs/features`) | máquina do projeto |
| `mcp` | um servidor MCP configurado naquela máquina | máquina do projeto |
| `github` / `jira` / `linear` / … | o provedor, pela conexão vinculada no cofre | Hub (o cofre é central) |
| *(nenhuma)* | nada — o painel pede para você declarar | — |

Troque a fonte no chip 🧭 (que abre a **faixa do fluxo**) → **🎯 Tarefa** → **Fonte do projeto**. A
lista muda na hora; o que estava na tela era da fonte antiga e é descartado. Na mesma gaveta ficam a
**pasta** (fonte `local`), o **servidor** (fonte `mcp`) e a **conexão** (provedores) — escolher de
onde vêm as tarefas não exige mais sair do fluxo.

## Trocar pelo chat

Uma frase na conversa do projeto também resolve, sem abrir gaveta nenhuma:

```
a fonte de tarefas deste projeto é a pasta docs/roadmap
troca a fonte de tarefas deste projeto para jira da conta trabalho
fonte de tarefas: mcp linear-local
fonte de tarefas deste projeto: nenhuma
```

O Jarvis responde com o **caminho resolvido** e a fonte que passou a valer (`docs/./roadmap` volta
como `docs/roadmap`) — nunca um "ok", porque "ok" não deixa você conferir se ficou valendo o que você
quis. Pasta que escapa do projeto (`..`, caminho absoluto de outro lugar) é **recusada com o motivo**
e nada é gravado. Fonte que ainda não pode servir é gravada e a resposta já diz o que falta (vincular
a conta, por exemplo). O que a frase muda aparece na hora em **Configurações → 🎯 Tarefas**: é a
mesma memória por pasta, difundida para todas as telas abertas.

O reconhecimento é **determinístico, sem nenhuma IA no caminho** (declarar fonte não gasta crédito), e
por isso é exigente: a frase precisa começar nomeando a configuração e o alvo precisa ser reconhecido
por inteiro. Falar de tarefas, pasta ou Jira no meio de uma conversa — inclusive perguntando *"a fonte
de tarefas deste projeto é o jira?"* — não muda nada: na dúvida o turno segue normal para a IA.

Para ver **tudo que está ligado** de uma vez — sem abrir uma sessão em cada pasta — use
**Configurações → 🎯 Tarefas**: as conexões do cofre com o estado de verificação (quem é a conta,
quando foi verificada, se o segredo existe no ambiente), a fonte declarada por cada projeto (com
**Desvincular**) e os servidores MCP de cada máquina. A tela é do dono, e qualquer mudança feita ali
— ou em outro aparelho — aparece nas demais telas abertas sem recarregar. Máquina em código antigo
aparece como "—" em vez de "nenhum servidor": não saber é diferente de não ter.

Quando uma fonte não pode servir, o painel diz **o motivo e o que fazer** (declarar a fonte, vincular
a conta, configurar o servidor) — nunca uma lista vazia, que é indistinguível de "não há tarefas".

## Fonte `local`

Cada `.md` da pasta vira uma tarefa: título vem do frontmatter (`title:`/`name:`), do primeiro `# h1`
ou do nome do arquivo; a descrição, de `description:` ou do primeiro parágrafo. A pasta é relativa ao
projeto e não pode escapar dele. A pasta se troca em **🎯 Tarefa → pasta:** (ou em Configurações →
🎯 Tarefas, para projetos que não estão abertos). A varredura é cacheada por assinatura da pasta —
**Atualizar lista** relê ignorando o cache.

## Fonte `mcp` — servidor na máquina do projeto

O servidor MCP roda **na máquina do projeto**, porque é lá que existem o binário, a credencial e a
rede dele. O Hub guarda apenas o **nome** do servidor; a receita (comando, ambiente, segredo) vive no
disco daquela máquina, em:

```
~/.jarvis/task-mcp.json
```

```json
{
  "servers": {
    "linear-local": {
      "label": "Linear do trabalho",
      "transport": {
        "command": "npx",
        "args": ["-y", "@linear/mcp-server"],
        "secretEnv": { "LINEAR_API_KEY": "JARVIS_SECRET_LINEAR" }
      },
      "listTool": "list_issues",
      "listArguments": { "limit": 50 }
    },
    "board-http": {
      "transport": { "kind": "streamable-http", "endpoint": "http://127.0.0.1:9000/mcp" },
      "listTool": "tasks",
      "fields": { "key": "ticket", "title": "headline", "description": "detalhe" }
    }
  }
}
```

- **`listTool`** é a ÚNICA ferramenta que o Jarvis chama nesse servidor, sempre como leitura, com os
  `listArguments` declarados aqui. O que o servidor anuncia não amplia nada: ferramenta não declarada
  é inalcançável.
- **`secretEnv`** mapeia a variável que o servidor espera → o **NOME** da variável de ambiente desta
  máquina. O valor nunca sai daqui: não vai para o Hub, não vai para o navegador. Se faltar, o erro
  diz qual variável está ausente.
- **`fields`** só é necessário quando o servidor usa outros nomes de campo. Por padrão o Jarvis
  reconhece `key`/`id`/`identifier`/`number`/`slug` e `title`/`name`/`summary`/`subject`.
- **`transport.kind: "streamable-http"`** aceita endpoint HTTP; sem `endpointPolicy` explícita, só
  loopback e LAN são permitidos.
- Escolha do servidor: o projeto pode nomear um (botão **servidor:** no painel). Sem nome, a máquina
  usa o único configurado — com dois ou mais, ela recusa e pede que você diga qual. Adivinhar aqui
  seria escolher a fonte por você.

**Nada de LLM neste caminho.** O resultado precisa ser dado: `structuredContent`, ou conteúdo de
texto que seja JSON. Um servidor que responde em prosa é recusado com motivo — interpretar isso
exigiria um modelo, e a varredura de tarefas não gasta crédito.

O resultado é cacheado por 60s por servidor (subir um processo a cada abertura do painel seria caro);
**Atualizar lista** ignora o cache.

Requisitos de máquina: o runner precisa estar **online** e no protocolo atual — uma máquina
desatualizada recusa com esse motivo em vez de deixar o Hub responder pelo disco errado.

## Várias tarefas de uma vez → várias subsessões

Na lista do painel cada item tem uma **marca** (☐). Marcadas 1..N tarefas, o botão **▶ Abrir N
subsessões** abre uma conversa por tarefa, **ligada à conversa de onde você marcou** — o vínculo é
gravado na sessão (sobrevive a recarregar a página e a reiniciar o Hub), a filha nasce com a tarefa
já armada, e a mãe fica com um recado dizendo o que foi aberto.

Duas fontes, nunca as duas juntas:

| Situação | O que decide |
|---|---|
| Pelo menos um item marcado | **A sua seleção.** Nenhum modelo é consultado — o que estiver escrito no campo de texto é ignorado. |
| Nenhum item marcado | **Interpretação:** o Jarvis lê a frase do campo e diz quantas tarefas viu. O resultado aparece marcado como interpretação, na confirmação e na primeira mensagem de cada filha. |

- **Você confirma o número antes de qualquer sessão existir.** O pedido tem dois passos: o Hub só
  *decide* a lista e devolve o plano; abrir acontece depois, com o plano confirmado. Um plano
  confirmado abre **uma vez** (clicar duas vezes não vira o dobro de conversas).
- **Sem certeza, o Jarvis pergunta.** Frase vaga, resposta em prosa ou lista vazia viram pergunta com
  motivo — nunca um número chutado de sessões.
- **Teto de 8 por vez.** Acima disso o pedido é recusado com motivo, e não truncado: cortar em
  silêncio jogaria fora tarefa que você marcou.
- Hoje só funciona em sessão **desta máquina** (o Hub). Numa sessão de máquina remota o pedido é
  recusado com esse motivo, em vez de criar a subsessão na máquina errada.

## Fontes de provedor (GitHub, Jira, Linear, …)

Executam a partir do Hub, usando a **conexão** vinculada ao projeto no cofre (⚙ no painel). Valem as
regras do cofre: sem conexão vinculada, nada de escrita e nada de "conta padrão"; a busca aparece
apenas com a conta vinculada, e o segredo fica no cofre (o cliente recebe só o rótulo e a identidade
verificada).
