# File explorer, viewer & AI annotations (web UI)

The web client (`apps/hub/web/`) has a file-review surface inspired by Orca's explorer + "Annotate
AI Diffs" (see `docs/research/orca-feature-teardown.md`), implemented natively in the browser/PWA —
no Electron required.

## File-tree explorer

- Opened by the **🗂 icon in the chat header** (next to *Resumir*); click again to close.
- A narrow right-docked "explorer" strip that **stays open** while you read files and chat — it only
  closes on the icon. Open/closed state is **persisted** (`cfg.treeOpen`) and restored per session.
- Lazy per folder: expanding a folder sends `{t:"listdir", files:true}`; the runner/hub answer a
  `dirs` message that now includes a `files` array **only when the flag is set** (the legacy
  folder-picker omits it and keeps seeing folders only — no regression).
- The reply echoes the raw request as `requested` (the `path` comes back normalized), and the tree
  matches its pending folder by it. A read error comes back **inside** `dirs` as `error` (shown on
  the folder row), not as a chat-level `error` frame.
- The folder-picker shares the same contract: its path is an editable field (type/paste + Enter or
  "Ir"); the listing machine strips quotes, expands `~`, turns `C:` into `C:\` and rejects relative
  paths (`packages/core/src/dir-listing.ts`). At a Windows drive root the reply also carries
  `drives`, so the picker can switch disks.
- Clicking a file opens it in the file panel (as a tab); the tree stays open.
- The **Buscar no projeto…** box at the top searches file contents (see *Lightweight editor* below).

## File / diff viewer

- Right-docked panel; **resizable** (drag the left edge, width persisted in `cfg.fileW`) and a
  **full-screen** toggle (⤢).
- Rendered **line by line** with a numbered gutter (both files and diffs).
- **Syntax highlighting** uses a small char-by-char tokenizer (`hlJs`) that understands line/block
  comments, strings, template literals and **regex literals** — fixing the classic single-regex bug
  where a quote inside a regex (e.g. `str.replace(/'/g, "x")`) started a "string" and mis-coloured
  the rest of the line.
- **Formatado / Bruto** toggle: for `.md` it renders Markdown (headings, bold/italic, code, lists,
  quotes, links, hr — HTML-escaped first, since repo content is untrusted); for code it turns colours
  on/off (a clean fallback). The choice is persisted (`cfg.fileFmt`).

## AI annotations ("Annotate", Orca Option A)

- Click a line number to select a line; click another to extend to a **start→end range**.
- **💬 Comentar** anchors a note to that line/range. Notes accumulate and render inline under the
  anchor (`NOTA · LINHA n`).
- The header shows a **✈️ N** button. Sending opens a small picker of the available AIs; the chosen
  agent receives one message with every comment — each carrying its **code snippet** as context, so
  the AI has the exact target even though a diff has no absolute line numbers.
- Notes are **persisted per file** in `localStorage` (`jarvis_anno:<path>`) and cleared after they're
  sent. Works on file view (real line numbers) and diff view (row-anchored + snippet).

## Lightweight editor (BRW-IDE-00 F3)

Spec: `docs/specs/BRW-IDE-00-remote-browser-and-ide.md` (§4.2 has the wire contract).

- **Tabs.** Every file opened in the viewer becomes a tab (strip under the header, shown when there
  are 2+ tabs or one is being edited; max 12 — the oldest clean, non-editing tab is dropped). A tab
  remembers the **machine it came from**: re-reads and saves go there even if you switch machines.
  Closing a tab with unsaved changes asks first.
- **Editar** (✏️ in the header) turns the active tab into a CodeMirror 6 editor. The bundle
  (`/vendor/codemirror/codemirror.js`, ~614 KB, ~214 KB gzip) is loaded **only on the first click** —
  the app boot does not grow — and the service worker keeps it after that first use. Languages:
  JS/TS/JSX/TSX, JSON, CSS, HTML, Markdown, Python, YAML (others open as plain text). Line numbers,
  folding, bracket matching/closing, history, multi-cursor, search/replace (Ctrl/Cmd+F inside the
  editor opens CodeMirror's own panel, in Portuguese).
- **Editing takes the main area.** While any tab is in edit mode the file moves out of the side
  panel into the main area — the *Abas* (▭) layout, where a `💬 Chat | 📄 Arquivo` bar switches
  between the two — and when the last edit closes the reading layout comes back. This is **not**
  saved: reading side by side (reviewing what the AI changed with the chat next to it) stays the
  preference. Picking ⬌/⬍/▭ in the layout switch while editing is an explicit choice and also decides
  where editing goes from then on (`cfg.editMain`). Phones are unchanged (the file panel is already
  full screen). The full VS Code (F4) still opens in a **new tab**.
- **`</> Editor` in the chat header is the way in** (owner only). With a file open it edits that
  file; with none it opens the file tree and the file you pick **opens already in edit mode**. While
  any edit is open, a *new* file picked in the tree also opens editing (IDE-like). This auto-edit
  fires once, on the tab's first load — the 2.5 s re-read and a tab you put back on **Ver** are never
  pushed into editing again. From the 💬 Chat tab, the same button brings the editor back.
- **VS Code is secondary**: `</> VS Code ↗` lives in the file panel header (not the chat header) and
  still opens a new tab. Hidden on phones — there the lightweight editor is the IDE. The ✏️ button now
  always shows its **Editar** label (it used to vanish whenever the side panel was narrow).
- The button is **disabled with the reason** (tooltip + toast on tap) for images, binary, files
  over 512 KB (the viewer only read the beginning), non-UTF-8 or NUL-containing files (editing would
  corrupt bytes), read-only files, members (not the owner) and machines on runner protocol < 18.
  The reason comes from the read itself (`filecontent.readOnlyReason`).
- **Save**: 💾 or Ctrl/Cmd+S. Dirty state shows as ● in the tab and title and a green Salvar. Line
  endings (CRLF/LF) and a UTF-8 BOM are preserved; a file with **mixed** endings is saved with the
  dominant one (shown in the meta line). Leaving the page with unsaved edits triggers the browser's
  "leave site?" prompt, and the app's auto-reload on a new version waits until nothing is dirty.
- **Conflict (the AI edited the file).** Save sends the `mtimeMs`/`size` of the version you opened. If
  the disk changed, the machine writes **nothing** and the app shows a dialog — your buffer stays in
  the editor:
  - **Ver diferenças** — line diff of the disk version (−) against yours (+), with context;
  - **Recarregar do disco** — replaces the buffer as ONE undoable step (Ctrl+Z brings yours back);
  - **Sobrescrever mesmo assim** — saves with `force`;
  - **Continuar editando** — closes the dialog; a yellow banner stays with a "Resolver…" button.
  While you edit, the viewer's 2.5 s poll keeps checking the disk: with **no** local changes the
  editor follows the disk silently (toast); with local changes the banner appears before you save.
  A file deleted meanwhile offers "Recriar com a minha versão".
- **Search in project** — box at the top of the file tree (owner + protocol ≥ 18 only), `Aa` = case
  sensitive, `.*` = regex. Results are grouped by file (line number + preview with the match
  highlighted); clicking opens the file at that line (or jumps inside the editor if that file is being
  edited). Up to 200 results; "cortado" means a limit was hit.
  - The machine uses **ripgrep** when it is on PATH (or `JARVIS_RG=<path to rg>`), otherwise a
    **worker thread** walk. Both skip `.git`, `node_modules`, build/cache dirs, binary extensions and
    files over 1 MB; the walk does not follow symlinks and does not read `.gitignore` (rg does). Hard
    limits: 10 s wall time, 64 MB read, 50 000 files, 2 searches at a time per machine. The Hub's event
    loop never runs the search itself (worker or child process) — see INC-01..03.
- **Writes on disk** (`packages/core/src/files.ts` → `writeProjectFile`): same path resolution as the
  read; atomic (temp file in the same folder + rename, retried on Windows `EPERM/EBUSY`); symlinks are
  written through (the link stays a link); POSIX mode bits preserved. Refuses anything under `.git`,
  relative paths without a session folder, images, content over 512 KB, and — unless `force` — a disk
  file that is no longer an editable text. Creating a new file needs `create:true` and never
  overwrites. Hard links are not preserved (rename replaces the inode).
- **Security**: editing and searching are **owner-only** on every machine (the Hub refuses members even
  with a grant on that runner, and audits the refusal). Every successful write is audited
  (`file_write`: path + bytes + `[sobrescrito]`/`[criado]`, never the content), and so is every search
  (`file_search`: folder + first 80 chars of the query).

Not in scope (F4 / never): LSP/IntelliSense, git integration, formatting, a file manager
(create/rename/delete from the tree), access for members.

## Not in the web client (by design)

- **Design Mode** (grab a live web-page element, screenshot + HTML/CSS → agent) needs Electron
  `<webview>` privileges a plain browser can't grant safely; it lives in the desktop shell
  (`desktop/`, spec `docs/specs/DSK-01-12-*`). The web annotation flow above is the browser-native
  counterpart for reviewing files/diffs.
