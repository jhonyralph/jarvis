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

Troque a fonte no chip 🧭 → **🎯 Tarefa** → **Fonte do projeto**. A lista muda na hora; o que estava
na tela era da fonte antiga e é descartado.

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
projeto e não pode escapar dele. A varredura é cacheada por assinatura da pasta — **Atualizar lista**
relê ignorando o cache.

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

## Fontes de provedor (GitHub, Jira, Linear, …)

Executam a partir do Hub, usando a **conexão** vinculada ao projeto no cofre (⚙ no painel). Valem as
regras do cofre: sem conexão vinculada, nada de escrita e nada de "conta padrão"; a busca aparece
apenas com a conta vinculada, e o segredo fica no cofre (o cliente recebe só o rótulo e a identidade
verificada).
