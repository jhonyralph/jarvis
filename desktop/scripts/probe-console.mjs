// Diagnóstico descartável: abre a UI do Hub num BrowserWindow oculto e imprime TUDO que o renderer
// registra (console, exceções, falhas de carregamento). Some depois do diagnóstico.
import { app, BrowserWindow } from "electron";

const URL_ = process.env.JARVIS_APP_HUB_URL || "http://127.0.0.1:4577";
const LEVELS = ["debug", "info", "warn", "error"];

app.whenReady().then(() => {
  const w = new BrowserWindow({ show: false, width: 1280, height: 860, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  w.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[${LEVELS[level] || level}] ${message}   (${sourceId}:${line})`);
  });
  w.webContents.on("did-fail-load", (_e, code, desc, url) => console.log(`[did-fail-load] ${code} ${desc} ${url}`));
  w.webContents.on("render-process-gone", (_e, d) => console.log(`[render-gone] ${JSON.stringify(d)}`));
  w.webContents.on("did-finish-load", () => {
    console.log("[did-finish-load]");
    // Espera o handshake (auth -> authed -> estado inicial) antes de fotografar o estado.
    setTimeout(async () => {
      const probe = await w.webContents.executeJavaScript(`(()=>{
        const d=document.getElementById('dot');
        const gate=document.querySelector('.gate,#gate');
        return JSON.stringify({
          dot: d?d.className:'AUSENTE',
          gateVisivel: !!(gate && gate.offsetParent!==null),
          papel: (typeof authUser!=='undefined'&&authUser)?authUser.role:'sem authUser',
          entrou: typeof enteredConn!=='undefined'?enteredConn:'?',
          sessoesNaLista: document.querySelectorAll('#recents .item').length,
          chipAgente: (document.getElementById('agentName')||{}).textContent,
          navItems: [...document.querySelectorAll('#settings .snav:not(.hidden)')].map(b=>b.dataset.goto),
          secSettingsOculto: (document.getElementById('secSettings')||{}).className,
          secHintOculto: (document.getElementById('secOwnerHint')||{}).className,
        });
      })()`).catch((e) => `EXECUTE_FALHOU: ${e.message}`);
      console.log("[probe]", probe);
      // Abre as configurações e navega pelos 3 painéis novos, como o usuário faria.
      const nav = await w.webContents.executeJavaScript(`(()=>{
        try{
          document.getElementById('settingsBtn').click();
          const r=[];
          for(const p of ['uso','celular','dispositivos']){
            document.querySelector('#settings .snav[data-goto="'+p+'"]').click();
            const el=document.querySelector('#settings .spanel[data-panel="'+p+'"]');
            r.push(p+'='+(el.classList.contains('hidden')?'OCULTO':'visivel'));
          }
          document.getElementById('setClose').click();
          r.push('salvarLabel='+document.getElementById('setClose').textContent);
          r.push('settingsAindaAberto='+!document.getElementById('settings').classList.contains('hidden'));
          document.getElementById('setX').click();
          r.push('depoisDoX_fechado='+document.getElementById('settings').classList.contains('hidden'));
          return r.join(' | ');
        }catch(e){ return 'ERRO: '+e.message+' @ '+e.stack.split('\\n')[1]; }
      })()`).catch((e) => `EXECUTE_FALHOU: ${e.message}`);
      console.log("[navegacao]", nav);
      setTimeout(() => { console.log("[fim]"); app.exit(0); }, 1500);
    }, 3500);
  });
  w.loadURL(URL_);
  setTimeout(() => { console.log("[timeout global]"); app.exit(1); }, 30000);
});
