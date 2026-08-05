// Browser+Node ESM normalizer for the mobile launcher's "Hub URL" field. Mirrors the desktop's
// desktop/src/shared/hub-url.js contract so both shells accept the same inputs. Kept as its own module
// so the launcher imports it (no inline duplication) and it can be unit-tested headless.
//
//   ""                       -> { error }         (nada informado)
//   "jarvis.ts.net"          -> https://jarvis.ts.net   (sem esquema → https, o erro mais comum)
//   "ws://host" / "wss://host" -> http/https://host      (aquilo é o RUNNER; a janela precisa de http)
//   "https://host/x?y=1"     -> https://host             (barra/rota/query são descartadas: só o origin)
//   "lixo :: inválido"       -> { error }

export function normalizeHubUrlWeb(raw) {
  let v = (raw || "").trim();
  if (!v) return { error: "Informe a URL do servidor." };
  if (/^wss:\/\//i.test(v)) v = v.replace(/^wss:\/\//i, "https://");
  else if (/^ws:\/\//i.test(v)) v = v.replace(/^ws:\/\//i, "http://");
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  let u;
  try { u = new URL(v); } catch { return { error: "Endereço inválido." }; }
  if (!u.hostname) return { error: "Falta o host no endereço." };
  return { url: u.origin };
}
