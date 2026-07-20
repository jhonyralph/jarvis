# APC-10 — Presets de autonomia

## Objetivo

Transformar o modo de autonomia em uma escolha operacional clara, com controles consistentes para o momento do usuário.

## Presets

- `manual`: sem play automático de fila, sem background e aprovação acima de risco baixo.
- `assisted`: sem automação em background por padrão e aprovação acima de risco médio.
- `controlled_autonomy`: permite fila/background e só exige aprovação acima de risco alto.

## Escopo

- Publicar presets no core para uso por Hub/UI e testes.
- Permitir aplicar um preset a uma política.
- Atualizar a UI para ajustar fila, background e risco ao trocar o modo.

## Fora de escopo

- Alterar permissões de escrita no repo automaticamente.
- Alterar orçamento automaticamente.
- Autonomia irrestrita sem aprovação humana.

## Aceite

- Cada modo possui mapeamento testado.
- A troca de modo na UI atualiza controles dependentes de autonomia.
- O salvamento continua passando pelo mesmo documento de política.
