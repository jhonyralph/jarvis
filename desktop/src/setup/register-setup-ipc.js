// Ponte da tela de configuração do Hub (setup.html).
//
// Fica no main de propósito: o teste de conexão precisa ser um GET real, sem CORS e sem origem —
// coisa que o renderer não consegue fazer contra um Hub arbitrário. O renderer só pede.
//
// A decisão de PRECEDÊNCIA não mora aqui: mora em src/shared/hub-config.js, que é puro e testado.
// Este arquivo é a metade com efeito colateral (disco, rede, recarregar a janela).

const http = require("node:http");
const https = require("node:https");
const { readSavedHubUrl, writeSavedHubUrl } = require("../shared/hub-config.js");
const { normalizeHubUrl } = require("../shared/hub-url.js");

/** GET <url>/health com timeout curto. Nunca rejeita: devolve {ok:false,error} para a tela mostrar. */
function probe(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL("/health", url.endsWith("/") ? url : url + "/"); }
    catch (e) { return resolve({ ok: false, url, error: "endereço inválido" }); }
    const lib = target.protocol === "https:" ? https : http;
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let req;
    try {
      req = lib.get(target, { timeout: timeoutMs }, (res) => {
        res.resume();
        const status = res.statusCode || 0;
        // Qualquer resposta HTTP prova que ALGUÉM atendeu naquele endereço; 401/403 continua sendo
        // um Hub vivo (só não autenticado ainda), e é exatamente o que o usuário precisa saber aqui.
        finish(status > 0 ? { ok: status < 500, url, status } : { ok: false, url, error: "sem resposta" });
      });
    } catch (e) {
      return finish({ ok: false, url, error: String((e && e.message) || e) });
    }
    req.on("timeout", () => { req.destroy(); finish({ ok: false, url, error: `sem resposta em ${timeoutMs} ms` }); });
    req.on("error", (e) => finish({ ok: false, url, error: friendly(e) }));
  });
}

/** Mensagens de rede do Node são siglas; a tela precisa de português. */
function friendly(e) {
  const code = e && e.code;
  if (code === "ECONNREFUSED") return "conexão recusada (nada escutando nessa porta)";
  if (code === "ENOTFOUND") return "nome não resolvido (o Tailscale desta máquina está conectado?)";
  if (code === "ETIMEDOUT" || code === "ECONNRESET") return "sem resposta (host inalcançável)";
  if (code === "CERT_HAS_EXPIRED" || code === "ERR_TLS_CERT_ALTNAME_INVALID") return "certificado inválido";
  return String((e && e.message) || e);
}

/**
 * @param {object} deps
 * @param {import("electron").IpcMain} deps.ipcMain
 * @param {string} deps.userDataDir  onde o hub-config.json é gravado
 * @param {() => object} deps.hubState  estado resolvido atual (url/source/sourceLabel/candidates)
 * @param {() => string|undefined} deps.lastError  último erro de carga, para a tela explicar
 * @param {() => void} deps.rereadAndReload  re-resolve a precedência e recarrega a janela
 */
function registerSetupIpc({ ipcMain, userDataDir, hubState, lastError, rereadAndReload }) {
  const state = () => ({ ...hubState(), saved: readSavedHubUrl(userDataDir) || "", lastError: lastError() });

  ipcMain.handle("jarvis:hub:get", () => state());

  ipcMain.handle("jarvis:hub:test", async (_e, value) => {
    const r = normalizeHubUrl(String(value || ""));
    if (r.warning) return { ok: false, url: String(value || ""), error: r.warning };
    return probe(r.url);
  });

  ipcMain.handle("jarvis:hub:set", async (_e, value) => {
    const r = normalizeHubUrl(String(value || ""));
    if (r.usedFallback) return { ok: false, error: r.warning || "endereço vazio" };
    // Guarda a URL já normalizada: o que a tela mostra depois é exatamente o que o app vai carregar.
    if (!writeSavedHubUrl(userDataDir, r.url)) return { ok: false, error: "não consegui gravar a configuração" };
    rereadAndReload();
    return { ok: true, url: r.url, state: state() };
  });

  ipcMain.handle("jarvis:hub:clear", () => {
    if (!writeSavedHubUrl(userDataDir, "")) return { ok: false, error: "não consegui gravar a configuração" };
    rereadAndReload();
    return { ok: true, state: state() };
  });

  ipcMain.handle("jarvis:hub:retry", () => { rereadAndReload(); return { ok: true }; });
}

module.exports = { registerSetupIpc, probe, friendly };
