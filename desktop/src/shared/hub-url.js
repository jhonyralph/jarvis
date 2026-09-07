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

/**
 * Endereço do Hub que o RUNNER desta máquina já usa (`~/.jarvis/runner.env`, chave `JARVIS_HUB`).
 *
 * Por que existe: numa máquina que só roda runner NÃO existe Hub em `127.0.0.1:4577`, então o
 * fallback padrão garante uma janela que nunca carrega. E o endereço certo já está no disco — é
 * como o runner se conecta. Sem isto, toda máquina de runner nova nasce com o app quebrado até
 * alguém lembrar de rodar o instalador com `-HubUrl`.
 *
 * O valor é `ws(s)://…`, que `normalizeHubUrl` já converte para `http(s)`.
 *
 * Nunca lança: arquivo ausente/ilegível/vazio devolve undefined e o chamador segue para o padrão.
 * `readFile`/`home` são injetáveis para teste.
 */
function readRunnerHubUrl({ readFile, home, join } = {}) {
  try {
    const nodeFs = readFile ? null : require("node:fs");
    const nodeOs = home ? null : require("node:os");
    const nodePath = join ? null : require("node:path");
    const base = home || nodeOs.homedir();
    const file = (join || nodePath.join)(base, ".jarvis", "runner.env");
    const text = readFile ? readFile(file) : nodeFs.readFileSync(file, "utf8");
    // install-runner.ps1 grava com `Set-Content -Encoding UTF8`, que no PowerShell 5 significa
    // UTF-8 COM BOM — o BOM cola na primeira chave e quebraria um `^JARVIS_HUB=` ingênuo.
    const clean = String(text || "").replace(/^﻿/, "");
    const line = /^[ \t]*JARVIS_HUB[ \t]*=[ \t]*(.+)$/m.exec(clean);
    if (!line) return undefined;
    const value = line[1].trim().replace(/^["']|["']$/g, "").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

module.exports = { normalizeHubUrl, DEFAULT_HUB_URL, readRunnerHubUrl };

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
