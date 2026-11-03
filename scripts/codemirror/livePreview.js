// Pré-visualização ao vivo do Markdown no editor (estilo Obsidian) — pedido do dono em 2026-11-03.
//
// O documento continua sendo o TEXTO exato do arquivo: nada aqui muda o conteúdo, só como ele aparece.
// Títulos, negrito, itálico, listas, citações, links e tabelas aparecem formatados; os símbolos de
// Markdown (#, **, -, [](...), |) somem — e voltam a aparecer na linha (ou na tabela) em que o cursor
// está, para editar. Salvar grava exatamente o que está no editor: nenhuma reformatação.
//
// Tudo vem da árvore de sintaxe do @lezer/markdown (GFM: tabelas, tarefas, riscado). As decorações
// moram num StateField porque a tabela desenhada substitui linhas inteiras (decoração de bloco).
import { StateField, RangeSet } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

const hide = Decoration.replace({});
const line = (cls) => Decoration.line({ class: cls });
const mark = (cls) => Decoration.mark({ class: cls });

/** Linhas tocadas pela seleção (onde os símbolos ficam visíveis para editar). */
function activeLines(state) {
  const set = new Set();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) set.add(n);
  }
  return set;
}
function touches(state, from, to) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement("span"); s.className = "cm-lp-bullet"; s.textContent = "•"; return s; }
}
class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement("span"); s.className = "cm-lp-hr"; return s; }
}
/** Caixa de tarefa: clicar troca o caractere entre os colchetes ([ ] <-> [x]) — uma edição de 1 letra. */
class TaskWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(o) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM(view) {
    const box = document.createElement("input");
    box.type = "checkbox"; box.className = "cm-lp-task"; box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" }, userEvent: "input" });
    });
    return box;
  }
  ignoreEvent() { return false; }
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Formatação mínima DENTRO das células (o texto já vem escapado). */
function inlineCell(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="cm-lp-link">$1</span>');
}
function splitRow(text) {
  let t = text.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  // "|" escapado (\|) não separa célula.
  const cells = []; let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i++; continue; }
    if (t[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}
/** Tabela desenhada. Clicar põe o cursor na tabela, que volta a mostrar o texto para editar. */
class TableWidget extends WidgetType {
  constructor(source) { super(); this.source = source; }
  eq(o) { return o.source === this.source; }
  toDOM(view) {
    const lines = this.source.split("\n").filter((l) => l.trim());
    const head = splitRow(lines[0] || ""), rows = lines.slice(2).map(splitRow);
    const align = splitRow(lines[1] || "").map((c) => /^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : "");
    const wrap = document.createElement("div"); wrap.className = "cm-lp-table";
    const cell = (tag, txt, i) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ""}>${inlineCell(txt)}</${tag}>`;
    wrap.innerHTML = `<table><thead><tr>${head.map((c, i) => cell("th", c, i)).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => cell("td", c, i)).join("")}</tr>`).join("")}</tbody></table>`;
    wrap.title = "Clique para editar a tabela";
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(wrap);
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() { return false; }
}

function build(state) {
  const out = [];
  const act = activeLines(state);
  const lineNo = (pos) => state.doc.lineAt(pos).number;
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter(node) {
      const name = node.name;
      // Títulos: tamanho por nível; "## " some fora da linha ativa.
      const h = /^ATXHeading(\d)$/.exec(name);
      if (h) {
        const ln = doc.lineAt(node.from);
        out.push(line("cm-lp-h cm-lp-h" + h[1]).range(ln.from));
        return;
      }
      if (name === "HeaderMark") {
        const parent = node.node.parent;
        if (parent && /^ATXHeading/.test(parent.name) && !act.has(lineNo(node.from))) {
          // marca de abertura + o espaço seguinte; a de fechamento ("## Título ##") também some.
          let to = node.to;
          if (doc.sliceString(to, to + 1) === " ") to++;
          if (node.from < to) out.push(hide.range(node.from, to));
        }
        return;
      }
      // Ênfase, negrito, riscado, código em linha: os símbolos somem fora da linha ativa.
      if (name === "EmphasisMark" || name === "StrikethroughMark") {
        if (!act.has(lineNo(node.from))) out.push(hide.range(node.from, node.to));
        return;
      }
      if (name === "InlineCode") {
        out.push(mark("cm-lp-code").range(node.from, node.to));
        return;
      }
      if (name === "CodeMark") {
        const parent = node.node.parent;
        if (parent && parent.name === "InlineCode" && !act.has(lineNo(node.from))) out.push(hide.range(node.from, node.to));
        return;
      }
      // Link [texto](url): mostra só o texto, como link, fora da linha ativa.
      if (name === "Link") {
        if (act.has(lineNo(node.from))) return;
        const marks = [];
        let urlFrom = -1, urlTo = -1;
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name === "LinkMark") marks.push(c);
          if (c.name === "URL" || c.name === "LinkTitle") { if (urlFrom < 0) urlFrom = c.from; urlTo = c.to; }
        }
        if (marks.length >= 2) {
          const textFrom = marks[0].to, textTo = marks[1].from;
          if (textFrom < textTo) out.push(mark("cm-lp-link").range(textFrom, textTo));
          out.push(hide.range(marks[0].from, marks[0].to));
          // "](url)" inteiro some
          if (marks[1].from < node.to) out.push(hide.range(marks[1].from, node.to));
        }
        return false;
      }
      // Listas: "-", "*", "+" viram "•"; tarefas viram caixas clicáveis.
      if (name === "ListMark") {
        const list = node.node.parent && node.node.parent.parent;
        const bullet = list && list.name === "BulletList";
        if (bullet && !act.has(lineNo(node.from))) {
          const next = node.node.nextSibling;
          if (next && next.name === "Task") return; // a caixa da tarefa já faz o papel do marcador
          out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
        }
        return;
      }
      if (name === "TaskMarker") {
        const txt = doc.sliceString(node.from, node.to);
        const checked = /x/i.test(txt);
        // "- [ ]": o "- " antes da caixa some junto (fora da linha ativa)
        const ln = doc.lineAt(node.from);
        const before = doc.sliceString(ln.from, node.from);
        const m = /^(\s*)([-*+]|\d+[.)])\s+$/.exec(before);
        if (!act.has(ln.number) && m) out.push(hide.range(ln.from + m[1].length, node.from));
        out.push(Decoration.replace({ widget: new TaskWidget(checked, node.from) }).range(node.from, node.to));
        if (checked) out.push(line("cm-lp-done").range(ln.from));
        return;
      }
      // Citação: barra lateral em todas as linhas; ">" some fora da linha ativa.
      if (name === "Blockquote") {
        for (let n = lineNo(node.from); n <= lineNo(node.to); n++) out.push(line("cm-lp-quote").range(doc.line(n).from));
        return;
      }
      if (name === "QuoteMark") {
        if (!act.has(lineNo(node.from))) {
          let to = node.to;
          if (doc.sliceString(to, to + 1) === " ") to++;
          out.push(hide.range(node.from, to));
        }
        return;
      }
      if (name === "HorizontalRule") {
        if (!act.has(lineNo(node.from))) out.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
        return false;
      }
      // Bloco de código: fonte de código e fundo próprio (os ``` ficam visíveis, esmaecidos).
      if (name === "FencedCode" || name === "CodeBlock") {
        for (let n = lineNo(node.from); n <= lineNo(node.to); n++) out.push(line("cm-lp-codeblock").range(doc.line(n).from));
        return false;
      }
      // Tabela: desenhada; com o cursor dentro, volta a ser o texto.
      if (name === "Table") {
        const first = doc.lineAt(node.from), last = doc.lineAt(node.to);
        if (!touches(state, first.from, last.to)) {
          out.push(Decoration.replace({ widget: new TableWidget(doc.sliceString(first.from, last.to)), block: true }).range(first.from, last.to));
        } else {
          for (let n = first.number; n <= last.number; n++) out.push(line("cm-lp-tablesrc").range(doc.line(n).from));
        }
        return false;
      }
    },
  });
  return Decoration.set(out, true);
}

const field = StateField.define({
  create: (state) => build(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return build(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.baseTheme({
  "&.cm-lp-on .cm-content": { fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", fontSize: "14.5px", lineHeight: "1.65", padding: "14px 0" },
  "&.cm-lp-on .cm-line": { padding: "0 18px" },
  "&.cm-lp-on .cm-gutters": { display: "none" },
  ".cm-lp-h": { fontWeight: "700", color: "#e6e9ec" },
  // o realce de código pinta títulos de vermelho; no modo visual o título é texto, na cor do texto
  "&.cm-lp-on .cm-lp-h span": { color: "inherit" },
  ".cm-lp-h1": { fontSize: "1.75em", lineHeight: "1.3", paddingTop: "10px !important" },
  ".cm-lp-h2": { fontSize: "1.45em", lineHeight: "1.3", paddingTop: "8px !important" },
  ".cm-lp-h3": { fontSize: "1.22em" },
  ".cm-lp-h4": { fontSize: "1.08em" },
  ".cm-lp-h5, .cm-lp-h6": { fontSize: "1em", color: "#cbd5e1" },
  ".cm-lp-code": { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "0.9em", backgroundColor: "#ffffff14", borderRadius: "4px", padding: "0 3px" },
  ".cm-lp-codeblock": { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "12.5px", lineHeight: "1.5", backgroundColor: "#ffffff0a" },
  ".cm-lp-link": { color: "#7cc0ff", textDecoration: "underline" },
  ".cm-lp-bullet": { color: "#93c5fd", fontWeight: "700", paddingRight: "2px" },
  ".cm-lp-task": { verticalAlign: "middle", margin: "0 6px 0 0", cursor: "pointer", accentColor: "#2563eb" },
  ".cm-lp-done": { color: "#8b98a5", textDecoration: "line-through" },
  ".cm-lp-quote": { borderLeft: "3px solid #ffffff2f", color: "#a9b4c0", marginLeft: "18px", paddingLeft: "12px !important" },
  ".cm-lp-hr": { display: "inline-block", width: "100%", height: "0", borderTop: "1px solid #ffffff2a", verticalAlign: "middle" },
  ".cm-lp-tablesrc": { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "12.5px", backgroundColor: "#ffffff06" },
  ".cm-lp-table": { padding: "4px 18px", overflowX: "auto", cursor: "text" },
  ".cm-lp-table table": { borderCollapse: "collapse", fontSize: "13.5px" },
  ".cm-lp-table th, .cm-lp-table td": { border: "1px solid #ffffff1f", padding: "5px 10px", textAlign: "left", verticalAlign: "top" },
  ".cm-lp-table th": { backgroundColor: "#ffffff0d" },
  ".cm-lp-table code": { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "0.9em", backgroundColor: "#ffffff14", borderRadius: "4px", padding: "0 3px" },
});

/** Extensão de pré-visualização ao vivo (para a linguagem Markdown com GFM). */
export function livePreview() {
  return [field, theme, EditorView.editorAttributes.of({ class: "cm-lp-on" })];
}
