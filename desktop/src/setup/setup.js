// Renderer da tela de configuração do Hub. Só fala com o main pela ponte auditada (window.jarvis.hub);
// não tem Node, não tem rede própria — o `test` roda no main, onde não há CORS nem origem para
// atrapalhar. Se a ponte não existir (aberto fora do Electron), a tela se explica em vez de quebrar.
const $ = (id) => document.getElementById(id);
const bridge = window.jarvis && window.jarvis.hub;

function say(text, cls) {
  const el = $("msg");
  el.textContent = text || "";
  el.className = "msg" + (cls ? " " + cls : "");
}

function renderCandidates(state) {
  const box = $("cands");
  const list = (state && state.candidates) || [];
  if (!list.length) {
    box.textContent = "Nenhum endereço configurado ainda — sem isso o app usa http://127.0.0.1:4577, que só existe na máquina do Hub.";
    return;
  }
  box.innerHTML = "";
  for (const c of list) {
    const row = document.createElement("div");
    row.className = "cand";
    const src = document.createElement("span");
    src.className = "src";
    src.textContent = c.label;
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = c.invalid ? c.value + " (inválido)" : c.url;
    row.append(src, val);
    if (c.source === state.source) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "em uso";
      row.appendChild(b);
    } else if (c.invalid) {
      const b = document.createElement("span");
      b.className = "badge warn";
      b.textContent = "ignorado";
      row.appendChild(b);
    }
    box.appendChild(row);
  }
}

function applyState(state) {
  if (!state) return;
  $("url").value = state.saved || "";
  $("url").placeholder = state.url || "https://meu-hub.ts.net";
  renderCandidates(state);
  const err = $("err");
  if (state.lastError) {
    err.hidden = false;
    err.textContent = `Não consegui carregar ${state.url} (${state.sourceLabel}) — ${state.lastError}`;
  } else {
    err.hidden = true;
  }
}

async function refresh() {
  if (!bridge) {
    say("Esta tela precisa do app do Jarvis (a ponte window.jarvis.hub não está disponível aqui).", "bad");
    for (const id of ["save", "test", "clear", "retry"]) $(id).disabled = true;
    return;
  }
  applyState(await bridge.get());
}

async function withBusy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try { await fn(); } finally { button.disabled = false; button.textContent = original; }
}

$("test").onclick = () => withBusy($("test"), "Testando…", async () => {
  const value = $("url").value.trim();
  if (!value) return say("Digite um endereço para testar.", "bad");
  const r = await bridge.test(value);
  if (r.ok) say(`Respondeu: ${r.url} (HTTP ${r.status}).`, "ok");
  else say(`Não respondeu: ${r.url} — ${r.error}`, "bad");
});

$("save").onclick = () => withBusy($("save"), "Salvando…", async () => {
  const value = $("url").value.trim();
  if (!value) return say("Digite um endereço, ou use “Usar o padrão do sistema”.", "bad");
  const r = await bridge.set(value);
  if (!r.ok) return say(r.error || "Não consegui salvar.", "bad");
  say(`Salvo: ${r.url}. Conectando…`, "ok");
});

$("clear").onclick = () => withBusy($("clear"), "Limpando…", async () => {
  const r = await bridge.clear();
  if (!r.ok) return say(r.error || "Não consegui limpar.", "bad");
  applyState(r.state);
  say(`Escolha local removida. Agora vale: ${r.state.url} (${r.state.sourceLabel}).`, "ok");
});

$("retry").onclick = () => withBusy($("retry"), "Conectando…", async () => {
  say("Tentando conectar…", "mut");
  await bridge.retry();
});

$("url").addEventListener("keydown", (e) => { if (e.key === "Enter") $("save").click(); });

void refresh();
