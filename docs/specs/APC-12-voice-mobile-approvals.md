# APC-12 — Aprovações por voz e mobile

## Objetivo

Permitir que aprovações adaptativas sejam acompanhadas e resolvidas sem depender do desktop.

## Escopo

- Centralizar a conclusão de uma aprovação adaptativa.
- Aceitar comandos falados/digitados para listar, aprovar ou rejeitar a primeira pendência.
- Responder por texto e TTS quando o comando veio de voz.
- Solicitar aprovações pendentes ao reconectar como owner, cobrindo mobile/PWA.

## Fora de escopo

- Seleção por número de uma aprovação específica via voz.
- Push notification nativa dedicada para cada aprovação.
- Aprovação por usuários sem papel owner.

## Aceite

- “listar aprovações” informa pendências.
- “aprovar pendência” aprova a primeira pendência e dispara a rotina.
- “rejeitar pendência” rejeita a primeira pendência.
- Mobile reconectado como owner recebe a lista atual de aprovações.
