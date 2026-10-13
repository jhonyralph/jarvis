// Auto-update driven by the WEB UI (the Hub-served client), not only by a silent background check.
//
// Why: the shell is a thin client whose UI lives in apps/hub/web. Putting "check for updates" and
// "restart and install" in that UI keeps ONE place for the user to see everything, instead of a
// native dialog the web layer knows nothing about. The main process still owns the privileged part
// (electron-updater); the page only gets an audited request/notify surface through preload.
//
// Contract (mirrors src/browser/register-browser-ipc.js):
//   invoke "jarvis:updater:check"    -> { state, version?, notes?, error? }
//   invoke "jarvis:updater:install"  -> { ok } and quits to install (no-op if nothing downloaded)
//   event  "jarvis:updater:event"    -> { state, version?, percent?, error? } pushed to the page
//
// States: idle | checking | available | downloading | downloaded | none | error | unsupported

const UNSUPPORTED = { state: "unsupported" };

/**
 * Traduz os erros do electron-updater que têm uma AÇÃO do lado do usuário. O resto segue como
 * mensagem crua (fatiada), que é melhor que nada para um erro de rede.
 *
 * O caso que motivou isto: no macOS o updater escolhe o asset por arquitetura antes de baixar,
 * filtrando os arquivos do canal pela substring "arm64" no nome (MacUpdater.filterFilesForArch).
 * Num Mac Intel ele DESCARTA os arm64; enquanto a release saía arm64-only isso deixava a lista
 * VAZIA, e o que chegava à UI era "No files provided" — depois de a mesma UI ter anunciado
 * "atualização disponível". Ninguém deduz "esta release não tem build para o meu processador" a
 * partir disso.
 *
 * Os dois códigos existem e vêm de lugares diferentes; verificados no electron-updater 6.8.9:
 *   • lista VAZIA  -> Provider.findFile joga ERR_UPDATER_NO_FILES_PROVIDED ("No files provided").
 *                     É este o caso da arquitetura sem build.
 *   • lista sem zip -> MacUpdater joga ERR_UPDATER_ZIP_FILE_NOT_FOUND, com os arquivos no texto
 *                     (uma release só com .dmg, por exemplo).
 *
 * A assimetria importa e não é intuitiva: no sentido inverso NÃO há erro. Um Mac ARM sem arquivo
 * arm64 cai no mesmo filtro e FICA com o x64, instalando-o sob Rosetta de propósito
 * (electron-builder PR 5524) — sem avisar ninguém.
 *
 * @param {any} e
 * @returns {string}
 */
function describeUpdaterError(e) {
  const code = String(e?.code || "");
  const raw = String(e?.message || e);
  const semArquivos = code === "ERR_UPDATER_NO_FILES_PROVIDED" || /No files provided/i.test(raw);
  const semZip = code === "ERR_UPDATER_ZIP_FILE_NOT_FOUND" || /ZIP file not provided/i.test(raw);
  if (semArquivos || semZip) {
    // Só no macOS o updater filtra por arquitetura; dizer isso no Windows mandaria o usuário
    // procurar um DMG que não existe para ele.
    if (process.platform === "darwin") {
      return `esta versão não traz instalador para a arquitetura deste Mac (${process.arch}). Baixe o pacote certo na página de releases — a atualização automática volta a funcionar na próxima versão que publicar as duas.`;
    }
    return "esta versão não traz um instalador aplicável a esta máquina. Baixe o pacote na página de releases.";
  }
  // Sem assinatura de código, o Squirrel.Mac recusa aplicar o pacote já baixado. É esperado
  // enquanto o projeto não tiver Developer ID (ver desktop/README.md), e dizer isso evita que o
  // dono procure um bug que não existe.
  if (/code signature|not signed|Could not get code signature/i.test(raw)) {
    return "a atualização baixada não pôde ser aplicada porque o app não é assinado — no macOS a atualização é MANUAL: baixe o novo DMG na página de releases.";
  }
  return raw.slice(0, 300);
}

function registerUpdaterIpc({ ipcMain, isPackaged, getWindow, loadUpdater }) {
  let updater = null;
  let downloaded = false;
  let wired = false;

  const emit = (payload) => {
    const win = getWindow && getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("jarvis:updater:event", payload);
  };

  /** Lazily resolve electron-updater. Absent (dev run / not installed) => unsupported, never throws. */
  function get() {
    if (updater) return updater;
    if (!isPackaged()) return null;
    try {
      updater = (loadUpdater ? loadUpdater() : require("electron-updater")).autoUpdater;
    } catch {
      return null; // optionalDependency missing — stays a detectable no-op
    }
    // The page decides WHEN to install (a restart mid-conversation would be rude), so we download
    // automatically but never quit on our own.
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    if (!wired) {
      wired = true;
      updater.on("checking-for-update", () => emit({ state: "checking" }));
      updater.on("update-available", (i) => emit({ state: "available", version: i?.version, notes: typeof i?.releaseNotes === "string" ? i.releaseNotes : undefined }));
      updater.on("update-not-available", () => emit({ state: "none" }));
      updater.on("download-progress", (p) => emit({ state: "downloading", percent: Math.round(p?.percent || 0) }));
      updater.on("update-downloaded", (i) => { downloaded = true; emit({ state: "downloaded", version: i?.version }); });
      updater.on("error", (e) => emit({ state: "error", error: describeUpdaterError(e) }));
    }
    return updater;
  }

  ipcMain.handle("jarvis:updater:check", async () => {
    const u = get();
    if (!u) return UNSUPPORTED;
    try {
      const r = await u.checkForUpdates();
      const version = r?.updateInfo?.version;
      // checkForUpdates resolves as soon as the manifest is read; the real outcome arrives through
      // the events above, so the caller gets a best-effort snapshot plus the live stream.
      return { state: version && version !== u.currentVersion ? "available" : "none", version };
    } catch (e) {
      return { state: "error", error: describeUpdaterError(e) };
    }
  });

  ipcMain.handle("jarvis:updater:install", () => {
    const u = get();
    if (!u) return UNSUPPORTED;
    if (!downloaded) return { ok: false, error: "nenhuma atualização baixada ainda" };
    setImmediate(() => u.quitAndInstall()); // let the IPC reply flush before the app dies
    return { ok: true };
  });

  return {
    /** Silent check at boot: the page shows the banner if an update turns up. */
    checkOnBoot() { const u = get(); if (u) u.checkForUpdates().catch(() => {}); },
  };
}

module.exports = { registerUpdaterIpc, describeUpdaterError };
