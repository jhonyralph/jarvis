// Log em ARQUIVO do shell desktop.
//
// Por que existe: até aqui o app só tinha `console.log`. Num duplo clique no Finder (ou no atalho do
// Windows) não existe stdout para onde esse texto ir — ele simplesmente desaparece. O custo apareceu
// em 2026-10-13, investigando um "do nada fechou" num Mac Intel: o único vestígio era um crash
// report do macOS (`Jarvis Helper (Renderer)` / SIGSEGV) com símbolos chutados, sem UMA linha do app
// dizendo em que Hub ele estava, o que o updater tinha feito ou por que o renderer morreu. A
// investigação virou arqueologia de `.ips` quando devia ter sido um `tail`.
//
// Formato: JSONL igual ao do Hub (apps/hub/src/logger.ts) — `{t, lvl, ev, ...campos}`, um objeto por
// linha. Mesma forma de propósito: quem já sabe greppar o log do Hub sabe greppar este, e os dois
// podem ser lidos pelo mesmo visualizador depois.
//
// Diferenças deliberadas em relação ao logger do Hub:
//  - SEM configuração por env. O Hub loga por turno e precisa de nível ajustável; este shell escreve
//    algumas dezenas de linhas por sessão, e variável nova aqui custaria entrada no
//    environment-catalog.mjs + docs regeradas para resolver um problema que não existe.
//  - Nome de arquivo com prefixo `jarvis-desktop-`: numa máquina que hospeda o Hub os dois logs
//    podem acabar lado a lado, e `jarvis-20261013.jsonl` do Hub ao lado do do app seria uma
//    armadilha de leitura.
//
// Nada aqui requer `electron`: o diretório e o acesso a disco entram por parâmetro (mesmo idioma do
// hub-config.js vizinho), então rotação, retenção e redação são testáveis em node puro.

const ORDER = { error: 0, warn: 1, info: 2, debug: 3 };

/** 5 MB por arquivo. O Hub usa 50, porque lá cabe um turno por linha; aqui 5 MB já é um exagero
 *  confortável — uma sessão normal não passa de alguns KB. */
const MAX_BYTES = 5 * 1024 * 1024;
/** 30 dias, igual ao Hub: a investigação que motivou este arquivo olhou uma janela de 3 semanas. */
const RETENTION_DAYS = 30;

const FILE_RE = /^jarvis-desktop-\d{8}(\.1)?\.jsonl$/;

/**
 * Mascara segredo antes de ir para o disco.
 *
 * Não é precaução teórica: o alvo do app é resolvido a partir do `~/.jarvis/runner.env`, o arquivo
 * que guarda o `JARVIS_TOKEN`. Qualquer erro que cite esse arquivo, ou uma URL com token em query,
 * passaria o segredo para um log que o usuário vai colar num chat de suporte. Mascarar aqui — e não
 * em cada chamador — é o que torna isso verdade para TODAS as linhas.
 */
function redact(value) {
  return String(value)
    // KEY=valor para chaves sensíveis (JARVIS_TOKEN=..., SECRET=..., password=...).
    .replace(/\b([A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|APIKEY|API_KEY)[A-Za-z_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi, "$1=<oculto>")
    // token/access_token/key em query string.
    .replace(/([?&](?:token|access_token|key|apikey)=)[^&\s]+/gi, "$1<oculto>")
    // Authorization: Bearer ...
    .replace(/\b(Bearer)\s+[\w\-._~+/]+=*/gi, "$1 <oculto>");
}

/**
 * Nome de campo que, por si só, condena o valor. Precisa existir SEPARADO do `redact` de texto: ali
 * o segredo é reconhecido pela forma `CHAVE=valor` dentro da string, e um campo
 * `{ secret: "s3nh4" }` não tem essa forma — a chave está no JSON, não no texto. Sem este teste de
 * chave, `log.error("x", { token })` escreveria o token limpinho no disco.
 */
const SENSITIVE_KEY = /(^|_)(token|secret|password|senha|apikey|api_key|auth|authorization|credential)s?($|_)/i;

/** Redação aplicada recursivamente aos campos, porque eles vão para o JSON como vieram. */
function redactFields(fields) {
  if (fields == null) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(k)) out[k] = "<oculto>";
    else if (typeof v === "string") out[k] = redact(v);
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redactFields(v);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? redact(x) : x));
    else out[k] = v;
  }
  return out;
}

function ymd(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function defaultIo() {
  const fs = require("node:fs");
  return {
    mkdir: (d) => fs.mkdirSync(d, { recursive: true }),
    append: (f, s) => fs.appendFileSync(f, s),
    size: (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0),
    rename: (a, b) => fs.renameSync(a, b),
    remove: (f) => fs.rmSync(f, { force: true }),
    readdir: (d) => fs.readdirSync(d),
    mtimeMs: (f) => fs.statSync(f).mtimeMs,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.dir               diretório do log (no app: `app.getPath("logs")`)
 * @param {object} [opts.io]              acesso a disco injetável (testes)
 * @param {() => Date} [opts.now]
 * @param {number} [opts.maxBytes]
 * @param {number} [opts.retentionDays]
 * @param {boolean} [opts.mirror]         também imprime no console (padrão: sim)
 * @param {object} [opts.console]
 * @param {"error"|"warn"|"info"|"debug"} [opts.level]
 */
function createLogger({ dir, io, now, maxBytes, retentionDays, mirror = true, console: con, level = "info" } = {}) {
  const disk = io || defaultIo();
  const clock = now || (() => new Date());
  const cap = maxBytes == null ? MAX_BYTES : maxBytes;
  const keepDays = retentionDays == null ? RETENTION_DAYS : retentionDays;
  const out = con || console;
  const threshold = ORDER[level] == null ? ORDER.info : ORDER[level];

  const dayFile = (date) => `${dir}/jarvis-desktop-${ymd(date)}.jsonl`;

  function rotateIfBig(file) {
    try {
      if (cap > 0 && disk.size(file) >= cap) {
        const prev = file.replace(/\.jsonl$/, ".1.jsonl");
        try { disk.remove(prev); } catch { /* pode não existir */ }
        disk.rename(file, prev);
      }
    } catch { /* rotação é best-effort: nunca impede a linha de ser escrita */ }
  }

  /**
   * Apaga arquivos diários mais velhos que a retenção. Chamado no boot — um app desktop pode passar
   * semanas aberto, mas também é reaberto o tempo todo, então o boot é o gancho honesto.
   */
  function purgeOld(nowMs) {
    if (!keepDays) return 0;
    const cutoff = (nowMs == null ? clock().getTime() : nowMs) - keepDays * 86400000;
    let removed = 0;
    try {
      for (const name of disk.readdir(dir)) {
        if (!FILE_RE.test(name)) continue;
        const p = `${dir}/${name}`;
        try { if (disk.mtimeMs(p) < cutoff) { disk.remove(p); removed++; } } catch { /* ignora um arquivo */ }
      }
    } catch { /* diretório ainda não existe */ }
    return removed;
  }

  function emit(lvl, ev, fields) {
    if (ORDER[lvl] > threshold) return;
    const date = clock();
    const line = { t: date.toISOString(), lvl, ev, ...(redactFields(fields) || {}) };
    if (mirror) {
      // Texto legível no console, para quem roda `npm start` continuar vendo o que via antes. O
      // `[jarvis]` é o prefixo que o main.js já usava.
      const extra = Object.entries(line).filter(([k]) => !["t", "lvl", "ev"].includes(k));
      const tail = extra.length ? " " + extra.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : "";
      const sink = lvl === "error" ? out.error : lvl === "warn" ? out.warn : out.log;
      try { sink.call(out, `[jarvis] ${ev}${tail}`); } catch { /* console pode não existir sob pythonw/serviço */ }
    }
    try {
      disk.mkdir(dir);
      const file = dayFile(date);
      rotateIfBig(file);
      disk.append(file, JSON.stringify(line) + "\n");
    } catch { /* NUNCA derruba o app por causa de log */ }
  }

  return {
    dir,
    file: () => dayFile(clock()),
    error: (ev, fields) => emit("error", ev, fields),
    warn: (ev, fields) => emit("warn", ev, fields),
    info: (ev, fields) => emit("info", ev, fields),
    debug: (ev, fields) => emit("debug", ev, fields),
    purgeOld,
  };
}

/** Logger que não escreve nada — default para módulos que recebem `log` por injeção. */
const noopLogger = {
  dir: "",
  file: () => "",
  error() {}, warn() {}, info() {}, debug() {},
  purgeOld: () => 0,
};

module.exports = { createLogger, noopLogger, redact, SENSITIVE_KEY, FILE_RE, MAX_BYTES, RETENTION_DAYS };
