// Normalização/validação do endereço do Hub (JARVIS_APP_HUB_URL).
//
// Por que existe: o shell é um cliente fino cujo ÚNICO parâmetro é para onde apontar. Um valor em
// formato errado não falha alto — o app entra no loop de reconexão com backoff e fica eternamente
// numa tela vazia, sem dizer o motivo. Os erros reais que isso cobre:
//   "jarvis.ts.net"            -> sem esquema; loadURL trata como caminho relativo e nunca conecta
//   "ws://jarvis.ts.net"       -> é o formato do RUNNER (WebSocket); a janela precisa de http(s)
//   "https://jarvis.ts.net/"   -> barra final: inofensiva, mas normalizamos para comparar origin
//   "file:///c:/..." etc.      -> esquema perigoso/sem sentido aqui
//
// Devolve sempre { url, warning } — nunca lança: o app precisa subir e EXPLICAR o problema, não
// morrer no boot.

const DEFAULT_HUB_URL = "http://127.0.0.1:4577";

/**
 * @param {string | undefined} raw valor cru da env
 * @param {string} [fallback] usado quando `raw` é vazio ou inválido
 * @returns {{ url: string, warning?: string, usedFallback: boolean }}
 */
function normalizeHubUrl(raw, fallback = DEFAULT_HUB_URL) {
  const value = String(raw ?? "").trim();
  if (!value) return { url: fallback, usedFallback: true };

  // Sem esquema é o erro mais comum ("jarvis.ts.net", "192.168.0.10:4577"): assumimos http, que é o
  // que um Hub em rede privada serve, em vez de recusar e deixar o usuário sem app.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { url: fallback, usedFallback: true, warning: `JARVIS_APP_HUB_URL inválida (${value}); usando ${fallback}` };
  }

  // ws:// é o endereço que o RUNNER usa; a janela carrega uma página, então converte para http(s)
  // em vez de falhar — o host/porta que o usuário quis dizer é o mesmo.
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  else if (parsed.protocol === "wss:") parsed.protocol = "https:";

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { url: fallback, usedFallback: true, warning: `JARVIS_APP_HUB_URL precisa ser http(s) (recebi ${parsed.protocol}//); usando ${fallback}` };
  }
  if (!parsed.hostname) {
    return { url: fallback, usedFallback: true, warning: `JARVIS_APP_HUB_URL sem host (${value}); usando ${fallback}` };
  }

  // Normaliza para a origem: o app sempre carrega a raiz da UI, e origin é o que comparamos em
  // will-navigate. Guardar path/query aqui só criaria divergência entre "o que carreguei" e "o que
  // considero interno".
  return { url: parsed.origin, usedFallback: false };
}

module.exports = { normalizeHubUrl, DEFAULT_HUB_URL };

// CLI para os scripts de instalação (.ps1/.sh) validarem o valor SEM reimplementar a regra — três
// cópias da mesma validação divergiriam na primeira mudança.
//   node desktop/src/shared/hub-url.js "https://jarvis.ts.net/"
// Sai 0 imprimindo a URL normalizada, ou 1 imprimindo o motivo. Tudo em STDOUT de propósito: com
// $ErrorActionPreference='Stop', o PowerShell transforma stderr de comando nativo num
// NativeCommandError que ele renderiza por cima da mensagem amigável do instalador.
if (require.main === module) {
  const result = normalizeHubUrl(process.argv[2]);
  process.stdout.write(result.warning || result.url);
  process.exit(result.warning ? 1 : 0);
}
