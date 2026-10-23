// Entrada do bundle do CodeMirror 6 do Jarvis (BRW-IDE-00 F3 — editor leve).
//
// Vira UM arquivo IIFE em apps/hub/web/vendor/codemirror/codemirror.js (ver
// scripts/build-codemirror.mjs) que expõe `window.JarvisCM`. O app.js só o carrega quando o usuário
// entra no modo "Editar" — o boot do app não cresce.
//
// O que fica AQUI (e não no app.js): o que depende da API do CodeMirror. Finais de linha, BOM,
// conflito e salvar são do app.js, que conhece o protocolo.
import { EditorState, EditorSelection, Compartment } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, highlightSpecialChars, rectangularSelection, crosshairCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from "@codemirror/language";
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";

// Mesmas cores do realce do visualizador (classes .hl-* do index.html, paleta One Dark).
const jarvisHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#7c8797", fontStyle: "italic" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue], color: "#98c379" },
  { tag: [t.escape], color: "#56b6c2" },
  { tag: [t.number, t.integer, t.float], color: "#d19a66" },
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self], color: "#c678dd" },
  { tag: [t.bool, t.null, t.atom], color: "#56b6c2" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: "#e5c07b" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "#61afef" },
  { tag: [t.tagName], color: "#e06c75" },
  { tag: [t.attributeName], color: "#e5c07b" },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "#e6e9ec" },
  { tag: [t.labelName], color: "#e06c75" },
  { tag: t.heading, color: "#e06c75", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "#61afef", textDecoration: "underline" },
  { tag: [t.quote], color: "#8b98a5", fontStyle: "italic" },
  { tag: [t.monospace], color: "#98c379" },
  { tag: [t.meta, t.processingInstruction], color: "#7c8797" },
  { tag: t.invalid, color: "#f85149" },
]);

// Tema escuro amarrado às variáveis CSS do app (o app só tem tema escuro hoje).
const jarvisTheme = EditorView.theme({
  "&": { color: "var(--text, #e6e9ec)", backgroundColor: "var(--code, #0d1117)", height: "100%", fontSize: "12.5px" },
  ".cm-scroller": { fontFamily: "ui-monospace, Menlo, Consolas, monospace", lineHeight: "1.5" },
  ".cm-content": { caretColor: "#e6e9ec", padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#e6e9ec" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#2563eb55" },
  ".cm-gutters": { backgroundColor: "var(--code, #0d1117)", color: "#5c6673", border: "none", borderRight: "1px solid var(--line, #ffffff14)" },
  ".cm-activeLine": { backgroundColor: "#ffffff08" },
  ".cm-activeLineGutter": { backgroundColor: "#ffffff0d", color: "#93c5fd" },
  ".cm-selectionMatch": { backgroundColor: "#ffffff14" },
  ".cm-searchMatch": { backgroundColor: "#e5c07b33", outline: "1px solid #e5c07b66" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#2563eb66" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "#3fb95033", outline: "1px solid #3fb95088" },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "#f8514933" },
  ".cm-foldPlaceholder": { backgroundColor: "#ffffff14", border: "none", color: "#8b98a5" },
  ".cm-panels": { backgroundColor: "var(--panel, #161b21)", color: "var(--text, #e6e9ec)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line, #ffffff14)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line, #ffffff14)" },
  ".cm-panel.cm-search": { padding: "6px 8px", fontSize: "12.5px" },
  ".cm-panel.cm-search label": { fontSize: "12px", color: "var(--mut, #8b98a5)" },
  ".cm-textfield": { backgroundColor: "#0f141b", color: "var(--text, #e6e9ec)", border: "1px solid #ffffff1f", borderRadius: "6px", padding: "3px 6px" },
  ".cm-button": { backgroundImage: "none", backgroundColor: "var(--panel, #161b21)", color: "var(--text, #e6e9ec)", border: "1px solid #ffffff1f", borderRadius: "6px", padding: "3px 8px" },
  ".cm-button:active": { backgroundImage: "none", backgroundColor: "#2563eb" },
  ".cm-tooltip": { backgroundColor: "var(--panel, #161b21)", border: "1px solid var(--line, #ffffff14)", color: "var(--text, #e6e9ec)" },
  ".cm-specialChar": { color: "#f85149" },
}, { dark: true });

// Painel de busca/substituição e "ir para a linha" em português.
const ptBR = EditorState.phrases.of({
  "Find": "Buscar", "Replace": "Substituir", "next": "próximo", "previous": "anterior", "all": "todos",
  "match case": "maiúsc./minúsc.", "regexp": "regex", "by word": "palavra inteira", "replace": "substituir",
  "replace all": "substituir todos", "close": "fechar", "Go to line": "Ir para a linha", "go": "ir",
  "current match": "ocorrência atual", "on line": "na linha", "replaced match on line $": "substituída a ocorrência da linha $",
  "replaced $ matches": "$ ocorrências substituídas", "Selection deleted": "Seleção apagada", "folded code": "código recolhido",
  "unfold": "expandir", "Control character": "Caractere de controle",
});

/** Linguagem pelo nome do arquivo. Devolve [extensão do CodeMirror, rótulo] ou null (texto puro). */
function languageFor(filename) {
  const name = String(filename || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : name;
  switch (ext) {
    case "js": case "mjs": case "cjs": return [javascript(), "JavaScript"];
    case "jsx": return [javascript({ jsx: true }), "JSX"];
    case "ts": case "mts": case "cts": return [javascript({ typescript: true }), "TypeScript"];
    case "tsx": return [javascript({ jsx: true, typescript: true }), "TSX"];
    case "json": case "jsonc": case "json5": case "webmanifest": return [json(), "JSON"];
    case "css": case "scss": case "less": return [css(), "CSS"];
    case "html": case "htm": case "xhtml": return [html(), "HTML"];
    case "md": case "markdown": case "mdx": return [markdown(), "Markdown"];
    case "py": case "pyw": case "pyi": return [python(), "Python"];
    case "yml": case "yaml": return [yaml(), "YAML"];
    default: return null;
  }
}

/**
 * Cria um editor em `parent`.
 * opts: { text, filename, onChange(handle), onSave(handle), readOnly }
 * Devolve um handle; o app.js nunca toca em EditorView diretamente.
 */
function create(parent, opts = {}) {
  const lang = languageFor(opts.filename);
  const readOnly = new Compartment();
  const saveKey = { key: "Mod-s", preventDefault: true, run: () => { if (opts.onSave) opts.onSave(handle); return true; } };
  const state = EditorState.create({
    doc: String(opts.text ?? ""),
    extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(),
      drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true), indentOnInput(),
      syntaxHighlighting(jarvisHighlight), bracketMatching(), closeBrackets(), rectangularSelection(),
      crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(), search({ top: true }),
      keymap.of([saveKey, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      jarvisTheme, ptBR, EditorView.lineWrapping,
      readOnly.of(EditorState.readOnly.of(!!opts.readOnly)),
      EditorView.updateListener.of((u) => { if (u.docChanged && opts.onChange) opts.onChange(handle); }),
      ...(lang ? [lang[0]] : []),
    ],
  });
  const view = new EditorView({ state, parent });
  const handle = {
    view,
    language: lang ? lang[1] : "Texto",
    /** Snapshot imutável do documento (Text) — guardar para saber depois se ficou "sujo". */
    doc: () => view.state.doc,
    /** Texto com as linhas unidas por `eol` (o CodeMirror sempre separa internamente). */
    text: (eol = "\n", doc = view.state.doc) => doc.toJSON().join(eol),
    /** true se o documento atual é igual ao snapshot dado. */
    same: (doc) => view.state.doc.eq(doc),
    /** Troca todo o conteúdo como UMA transação desfazível (Ctrl+Z traz a versão anterior de volta). */
    replaceAll: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text ?? "") }, userEvent: "input.replace.all" }),
    gotoLine: (n) => {
      const ln = Math.max(1, Math.min(view.state.doc.lines, Math.floor(Number(n) || 1)));
      const line = view.state.doc.line(ln);
      view.dispatch({ selection: EditorSelection.cursor(line.from), effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    },
    setReadOnly: (on) => view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(!!on)) }),
    openSearch: () => openSearchPanel(view),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
  return handle;
}

window.JarvisCM = { create, languageFor: (f) => { const l = languageFor(f); return l ? l[1] : null; }, build: "__BUILD__" };
