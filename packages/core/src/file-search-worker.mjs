// Busca de conteúdo no projeto — caminho SEM ripgrep (BRW-IDE-00 F3).
//
// Roda numa worker thread de propósito: no Hub esta busca acontece DENTRO do processo do Hub, cujo
// event loop travado já derrubou o serviço (INC-01..03). Aqui nem uma regex catastrófica (`(a+)+$`)
// nem uma árvore enorme seguram o loop principal — quem chamou só troca mensagens e, no teto de
// tempo, `terminate()` mata esta thread no meio do que estiver fazendo.
//
// JavaScript puro (sem TypeScript) para não depender do loader do tsx dentro da worker.
import { parentPort, workerData } from "node:worker_threads";
import { opendir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const {
  root, query, regex, caseSensitive, max, maxFileSize, maxBytes, maxFiles, ignoreDirs, binaryExt,
} = workerData;

const IGNORE = new Set(ignoreDirs);
const BINARY_EXT = new Set(binaryExt);
const PREVIEW = 240;
const MAX_LINE_SCAN = 20000;

let matcher = null, badRegex = "";
try {
  if (regex) {
    const rx = new RegExp(query, caseSensitive ? "g" : "gi");
    matcher = (line) => { rx.lastIndex = 0; const m = rx.exec(line); return m ? [m.index, m.index + Math.max(1, m[0].length)] : null; };
  } else {
    const needle = caseSensitive ? query : query.toLowerCase();
    matcher = (line) => { const hay = caseSensitive ? line : line.toLowerCase(); const i = hay.indexOf(needle); return i < 0 ? null : [i, i + needle.length]; };
  }
} catch (e) {
  badRegex = "expressão regular inválida: " + String(e && e.message || e).slice(0, 160);
}

let found = 0, bytesRead = 0, filesSeen = 0, truncated = false;

function preview(line, s, e) {
  if (line.length <= PREVIEW) return { preview: line, hl: [s, e] };
  const start = Math.max(0, Math.min(s - 80, line.length - PREVIEW));
  const cut = line.slice(start, start + PREVIEW);
  const pre = start > 0 ? "…" : "";
  const post = start + PREVIEW < line.length ? "…" : "";
  return { preview: pre + cut + post, hl: [s - start + pre.length, Math.min(e - start, PREVIEW) + pre.length] };
}

function scanFile(abs, text) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const m = matcher(line.length > MAX_LINE_SCAN ? line.slice(0, MAX_LINE_SCAN) : line);
    if (!m) continue;
    const p = preview(line, m[0], m[1]);
    hits.push({ path: abs, rel: relative(root, abs).split(sep).join("/"), line: i + 1, col: m[0] + 1, preview: p.preview, hl: p.hl });
    if (found + hits.length >= max) break;
  }
  return hits;
}

async function visitFile(abs, name) {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase())) return;
  let st;
  try { st = await stat(abs); } catch { return; }
  if (!st.isFile() || st.size > maxFileSize) return;
  if (bytesRead + st.size > maxBytes) { truncated = true; return; }
  let buf;
  try { buf = await readFile(abs); } catch { return; }
  bytesRead += buf.length;
  // Binário: byte nulo no começo (mesma heurística do ripgrep).
  if (buf.subarray(0, 8192).includes(0)) return;
  const hits = scanFile(abs, buf.toString("utf8"));
  if (hits.length) {
    found += hits.length;
    parentPort.postMessage({ type: "hits", hits });
    if (found >= max) truncated = true;
  }
}

async function walk() {
  const stack = [root];
  while (stack.length) {
    if (truncated) return;
    const dir = stack.pop();
    let handle;
    try { handle = await opendir(dir); } catch { continue; }
    const subdirs = [];
    try {
      for await (const ent of handle) {
        if (truncated) break;
        // Link simbólico NÃO é seguido: evita laço e sair do projeto.
        if (ent.isSymbolicLink()) continue;
        const abs = join(dir, ent.name);
        if (ent.isDirectory()) { if (!IGNORE.has(ent.name)) subdirs.push(abs); continue; }
        if (!ent.isFile()) continue;
        if (++filesSeen > maxFiles) { truncated = true; break; }
        await visitFile(abs, ent.name);
      }
    } catch { /* pasta sumiu no meio — segue */ }
    // Ordem estável e previsível (alfabética) — o empilhamento inverte, então empilha ao contrário.
    subdirs.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    stack.push(...subdirs);
  }
}

if (badRegex) parentPort.postMessage({ type: "done", error: badRegex });
else walk().then(
  () => parentPort.postMessage({ type: "done", truncated, filesSeen, bytesRead }),
  (e) => parentPort.postMessage({ type: "done", truncated, error: String(e && e.message || e).slice(0, 200) }),
);
