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
- Clicking a file opens it in the file panel; the tree stays open.

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

## Not in the web client (by design)

- **Design Mode** (grab a live web-page element, screenshot + HTML/CSS → agent) needs Electron
  `<webview>` privileges a plain browser can't grant safely; it lives in the desktop shell
  (`desktop/`, spec `docs/specs/DSK-01-12-*`). The web annotation flow above is the browser-native
  counterpart for reviewing files/diffs.
