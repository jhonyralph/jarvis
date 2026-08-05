// The Electron tray: renders the pure menu model (status.js) and wires clicks to the probed actions
// (register-control-ipc.js). Icon color + tooltip reflect live Hub/Runner status; a one-shot native
// notification fires when the Hub goes offline. Left-click opens the app; right-click shows the menu.

const { Tray, Menu, nativeImage, shell, Notification, app } = require("electron");
const { trayTemplate } = require("./status.js");
const { dataUrl } = require("./tray-icons.js");
const { startControl } = require("./register-control-ipc.js");

function createTray({ showWindow, quit }) {
  const iconFor = (level) => nativeImage.createFromDataURL(dataUrl(level)).resize({ width: 16, height: 16 });
  const notify = (title, body) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on("click", () => showWindow());
    n.show();
  };

  const tray = new Tray(iconFor("down"));
  tray.setToolTip("Jarvis");
  let control = null;

  const onClick = async (id) => {
    const a = control && control.actions;
    switch (id) {
      case "open": return showWindow();
      case "hub-restart": notify("Jarvis", "Reiniciando o Hub…"); return a && a.restartHub();
      case "update-runners": notify("Jarvis", "Enviando atualização às máquinas…"); return a && a.updateRunners();
      case "runner-start": return a && a.runnerControl("start");
      case "runner-stop": return a && a.runnerControl("stop");
      case "runner-update": notify("Jarvis", "Atualizando esta máquina (git pull + reiniciar)…"); return a && a.runnerSelfUpdate();
      case "logs-hub": return shell.openPath(a && a.logPath("hub"));
      case "logs-runner": return shell.openPath(a && a.logPath("runner"));
      case "login": {
        const cur = app.getLoginItemSettings().openAtLogin;
        app.setLoginItemSettings({ openAtLogin: !cur, args: ["--tray"] });
        if (a) rebuild(a.getState()); // reflect the new checkbox immediately
        return;
      }
      case "quit": return quit();
      default: return undefined;
    }
  };

  function rebuild(st) {
    if (!st) return;
    tray.setImage(iconFor(st.level));
    tray.setToolTip(st.tooltip);
    const template = trayTemplate(st, { openAtLogin: app.getLoginItemSettings().openAtLogin }).map((i) => {
      if (i.type === "separator") return { type: "separator" };
      const item = { label: i.label, enabled: i.enabled !== false, click: () => void onClick(i.id) };
      if (i.type === "checkbox") { item.type = "checkbox"; item.checked = !!i.checked; }
      return item;
    });
    tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  tray.on("click", () => showWindow());
  control = startControl({ onState: rebuild, notify });

  return { destroy: () => { if (control) control.stop(); tray.destroy(); } };
}

module.exports = { createTray };
