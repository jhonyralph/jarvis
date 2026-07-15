#!/usr/bin/env sh
# jarvis.sh — host-side recovery/admin (macOS/Linux), mirrors jarvis.ps1. Talks to the
# Hub's loopback admin API (127.0.0.1, never exposed), so it works even with NO device
# logged in. Run it ON the Hub machine.
#
#   ./scripts/jarvis.sh owner              # gera convite de DONO (recuperar acesso)
#   ./scripts/jarvis.sh machine "Meu Mac"  # token p/ adicionar esta/outra máquina como runner
#   ./scripts/jarvis.sh status | claimcode | audit | passphrase-clear
#   ./scripts/jarvis.sh revoke <deviceId>
BASE="http://127.0.0.1:${JARVIS_ADMIN_PORT:-4578}"
post() { curl -fsS -X POST "$BASE$1" -H 'content-type: application/json' -d "$2" || echo "(hub rodando? $BASE)"; echo; }
get()  { curl -fsS "$BASE$1" || echo "(hub rodando? $BASE)"; echo; }
cmd="${1:-status}"
case "$cmd" in
  owner)            post /admin/invite '{"role":"owner","ttlSec":86400}';;
  invite)           post /admin/invite '{"role":"member","ttlSec":86400}';;
  machine)          post /admin/runner-token "{\"label\":\"${2:-runner}\"}";;
  status)           get  /admin/status;;
  claimcode)        get  /admin/claimcode;;
  audit)            get  "/admin/audit?n=${2:-100}";;
  update)           get  /admin/update;;
  update-apply)     echo "Atualizando o Hub (vai reiniciar)..."; post /admin/update '{}';;
  update-rollback)  echo "Revertendo (vai reiniciar)..."; post /admin/update/rollback '{}';;
  passphrase-clear) post /admin/passphrase '{"clear":true}';;
  revoke)           post /admin/revoke "{\"deviceId\":\"$2\"}";;
  *) echo "uso: jarvis.sh {owner|invite|machine|status|claimcode|audit|update|update-apply|update-rollback|passphrase-clear|revoke <id>}";;
esac
