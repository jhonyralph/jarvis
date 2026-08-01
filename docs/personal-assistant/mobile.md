# Android, iOS, Web e Electron

O suporte de contexto é capability-based. A UI deve consultar `JarvisContext.isSupported()` e
`checkPermissions()`; não deve inferir capacidades apenas pelo user-agent.

## Matriz

| Capacidade | Android nativo | iOS nativo | Web/PWA | Electron |
|---|---|---|---|---|
| localização foreground | sim, app visível | sim, When In Use | Geolocation API em origem segura | Geolocation API/permissão do shell |
| precisão aproximada | sim | estado limited/precise conforme sistema | conforme browser/SO | conforme shell/SO |
| busy/free do calendário local | sim, `READ_CALENDAR` | sim, permissão de calendário | não | não; use CalDAV |
| geofence | implementado no sideload; homologação física pendente | implementado; homologação em iPhone pendente | não | não |
| lease/ACK de transições sem coordenadas | implementado; homologação física pendente | implementado; homologação física pendente | não | não |
| localização contínua arbitrária | não | não | não | não |

## Invariantes da bridge

- `getCurrentLocation` é one-shot, exige app em foreground e não persiste posição no plugin.
- Resposta tem `observedAt`, `expiresAt`, precisão e origem Android/iOS.
- `getBusyIntervals` retorna intervalos mesclados, timezone, range e flag `truncated`; nenhum detalhe
  de evento cruza a bridge.
- O estado persistido de geofences é substituído atomicamente e o Jarvis limita a lista a 20. No
  iOS, CoreLocation não oferece transação: o plugin confirma cada região e faz rollback, mas pode
  existir uma pequena janela sem monitoramento durante a troca.
- A fila durável guarda ID da geofence, transição, timestamps e metadados de entrega. Coordenadas
  permanecem na configuração local da geofence, não no envelope enviado em background.
- `transitionAvailable` é apenas um sinal para tentar entrega; não é confirmação de persistência no
  Hub e não autoriza remover um evento.

## Escopo de autorização nativo

Toda configuração nova e toda entrega durável usam um `JarvisContextScope`:

```ts
{
  principalId: string;
  deviceId: string;
  generation: number;
}
```

- `principalId` é o usuário autenticado no Hub; `deviceId` é o aparelho autenticado/enrolado. O
  cliente não pode usar esse objeto para escolher a identidade aceita pelo Hub: frames continuam
  vinculados ao actor da conexão autenticada.
- `generation` é um epoch inteiro, monotônico e controlado pelo cliente para aquela combinação de
  principal/aparelho. Ele permanece estável durante um grant e avança depois de `eraseAll`, antes de
  um grant futuro. Não é segredo, token, revisão do store nem contador de eventos.
- Estado nativo scoped não pode ser lido, alterado, drenado ou apagado por outro principal,
  aparelho ou geração. A bridge falha com `CONTEXT_SCOPE_MISMATCH`.
- `configureGeofences`, `removeGeofences` e `listGeofences` ainda aceitam omissão de scope somente
  para migrar estado legado ainda não scoped. Ao adotar o primeiro scope, o plugin descarta
  transições, leases e ACKs legados ambíguos em vez de atribuí-los ao usuário atual.

`configurationGeneration` é outro valor: um epoch interno do plugin que muda a cada configuração
de geofences. Ele impede callback atrasado ou worker de reboot de rearmar uma configuração antiga;
não substitui `scope.generation`.

## Lease, ACK, exclusão e restart

`leaseTransitions` faz uma leitura não destrutiva e exige `scope` e `requestId`. Repetir o mesmo
`requestId` durante a validade devolve o mesmo lease. Depois da expiração, o evento volta a ficar
disponível com o mesmo ID `ctx-...` e `deliveryAttempt` incrementado.

O cliente chama `ackTransitions` somente para IDs que o Hub aceitou de forma durável. ACK parcial é
permitido e retry do mesmo ACK é idempotente; ID desconhecido ou já entregue por outro lease é
rejeitado sem apagar a fila. O Hub deduplica o envelope pelo principal/aparelho autenticado e pelo
ID estável da transição, então perda do ACK causa redelivery, não um segundo fato pessoal. O alias
legado `drainTransitions` também deixou de apagar dados: ele não conclui entrega sem ACK scoped e
não deve ser usado por código novo.

Geofences, transições, leases, tentativas e o ledger de ACK ficam em armazenamento nativo durável.
Um restart do processo preserva o lease; o mesmo request ainda ativo retorna o mesmo lote e um
lease expirado permite redelivery. A fila só perde um evento por ACK confirmado, adoção deliberada
de um novo scope, `eraseAll` ou corrupção/falha de armazenamento reportada ao caller.

`eraseAll({ scope })` é idempotente e não depende da permissão de localização atual. Primeiro apaga
geofences, fila, leases, replay markers e ACKs locais; depois cancela workers e solicita remoção ao
SO. O retorno diferencia `platformCleanup: "confirmed"`, `"requested"` e `"unavailable"`: no iOS a
remoção de regiões é assíncrona, portanto apagar o store não prova que CoreLocation já confirmou a
limpeza. Um revoke atrasado não apaga estado legível de um scope mais novo; estado corrompido ainda
é apagável. Se o filesystem não confirmar a exclusão, a chamada falha em vez de declarar sucesso.

No cliente atual, revogar `device-location` e apagar observações, favoritos, consentimentos,
perfis de aparelho ou todos os dados chama `eraseAll`; a geração local avança antes de uma futura
reconfiguração. Em “Apagar tudo”, a limpeza nativa ocorre antes da exclusão do estado no Hub.

## Android

O build principal pede localização coarse/fine e leitura de calendário. Localização foreground
falha se a Activity não estiver visível, se a permissão for revogada, se Google Play Services não
oferecer localização ou se a observação disponível estiver stale.

Existem dois flavors de distribuição:

- `store`: remove `ACCESS_BACKGROUND_LOCATION`, rearm no boot e geofences de background;
- `sideload`: inclui background location e `RECEIVE_BOOT_COMPLETED`, com pedido explícito e separado.

Essa separação evita declarar uma permissão sensível no artefato de loja sem justificativa/política.
No sideload, conceder foreground não concede background. Em versões recentes do Android o usuário
pode precisar concluir o fluxo nas Configurações. Economia de bateria, Play Services e política do
fabricante ainda podem atrasar transições; teste em aparelho real bloqueado e após reboot.

O plugin não transforma geofence em rastreamento contínuo. O SO decide quando entregar enter/exit e
pode não produzir evento se localização estiver desligada.

O estado Android usa arquivo atômico em `noBackupFilesDir`. Overflow de callback é reentregue por
WorkManager sem colocar `principalId` ou `deviceId` crus no job; a fila não descarta evento sem ACK.
Reboot/package replacement, `GEOFENCE_NOT_AVAILABLE`, configuração, revoke e rearm passam pelo
mesmo coordenador serializado e pelo `configurationGeneration` persistido.

## iOS

O plugin requer iOS 15+. Solicita When In Use antes de um upgrade explícito para Always. O sistema
pode devolver `limited`/`denied`, e o app não deve insistir em loop. iOS limita regiões monitoradas;
o Jarvis aplica o teto de 20 e pode usar significant-location changes apenas quando configurado.

Descrições de uso são aplicadas ao projeto gerado. `UIBackgroundModes=location` só entra com o opt-in
explícito `--ios-background-mode`; não é ativado pelo build padrão. Nenhuma dessas configurações
garante aprovação da App Store nem entrega instantânea. Always/background precisa de justificativa
de produto, teste físico, revisão de energia e política de privacidade. Um `.ipa` só pode ser gerado
e assinado em macOS/Xcode.

O estado iOS fica em Application Support com proteção de arquivo e exclusão de backup. Cada callback
aceito do CoreLocation é persistido; não existe limite local que descarte silenciosamente uma
transição ainda sem ACK. Reiniciar o app não equivale a reiniciar o monitoramento: relaunch pelo SO,
entrega de regiões e significant-change continuam sujeitos às regras e atrasos do iOS.

## Web/PWA e Electron

Web usa `navigator.geolocation` somente com gesto/consentimento e origem segura (HTTPS ou localhost).
Fechar a PWA encerra esse caminho; não existe bridge de calendário/geofence. Para agenda, configure
CalDAV. Electron também não ganha o plugin Capacitor automaticamente: usa as permissões do shell e
CalDAV para calendário.

## Sequência de permissão recomendada

1. Explicar o benefício no fluxo que precisa do dado.
2. Pedir apenas foreground location ou calendar, nunca o pacote inteiro.
3. Salvar consentimento do Context Engine depois da permissão da plataforma.
4. Pedir background apenas quando o usuário criar uma automação/geofence que realmente o exige.
5. Mostrar estado denied/limited/unavailable e um caminho para Configurações, sem prompt repetitivo.
6. Ao revogar no Jarvis, executar `eraseAll` com o scope vigente, avançar a geração e parar novas
   coletas/entregas antes de permitir outro grant.

Wake word, push notification e Context Engine são subsistemas diferentes. Uma notificação ou
listener ativo não prova que geofence, calendário ou localização possuem permissão válida.

## Estado de homologação

Os contratos, state machines, transforms, testes unitários e builds automatizados podem ser
verificados neste checkout. Eles não certificam permissão, calendário, entrega de callback, consumo
de energia ou comportamento em background em hardware real. Não há relatório físico ou aprovação
de loja versionado no repositório; o estado atual é “implementado; homologação física pendente”.

Antes de declarar suporte, execute a matriz Android com tela bloqueada, app em background/encerrado,
reboot/package replace, force-stop, economia de bateria, localização desligada e permissão revogada.
No iPhone, cubra When In Use/Always, precisão reduzida, suspensão/encerramento pelo sistema, reboot,
bateria, revogação, relaunch e redelivery após expiração de lease. Registre aparelho, SO, artifact,
flavor, permissões e timestamps. iOS exige macOS/Xcode; App Store e Play Store exigem revisão vigente
e aprovação efetiva, que nenhum teste local pode prometer. Veja os
[gates de rastreabilidade](traceability.md#gates-físicos-e-de-distribuição).
