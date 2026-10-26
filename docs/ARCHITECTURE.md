# Architecture

The implementation and validation source of truth for cross-agent/model parity is
[`agent-parity-matrix.md`](agent-parity-matrix.md). An adapter is not considered
fully supported merely because it can return a final answer; it must satisfy the
streaming, persistence, history, model and local/remote conformance contract
defined there.

## Principles

1. **Security first.** Jarvis state is local (crash-safe JSON snapshots + files;
   see `packages/core/src/persist.ts`). Provider CLIs still call their own cloud
   services. Tailscale/private networking is recommended; TLS proxy exposure is
   supported only with the documented auth/proxy controls.
2. **Agnostic.** Never lock to one agent, one voice engine, or one transport.
   Everything external is behind a swappable **adapter**.
3. **Voice local.** STT + TTS run on the user's machine. The only external
   dependency is the selected agent CLI's own inference and configured integrations.
4. **Multi-client, multi-desktop.** One chat, reachable from the phone and any
   number of desktops. Any client may also be a passive **listener**.

## Topology: Hub + Runners + Clients

- **Hub** — one always-on machine. Owns the local store (sessions, messages,
  transcripts) as **atomic JSON snapshots** under `~/.jarvis` — every write is
  temp-file + fsync + rename with a `.bak`, so a crash can't corrupt or lose it.
  Serves the chat **PWA**. Hosts the local **voice**
  services (STT/TTS). Registers Runners and **routes** messages. Reached over
  Tailscale.
- **Runner** — one per desktop. Registers with the Hub and runs `AgentAdapter`s
  locally. Executes/streams supported agent sessions on that machine. Desktop A
  can run Claude while Desktop B runs Gemini or Cursor Agent — same lifecycle.
- **Client** — the Hub's single web UI (`apps/hub/web`), reachable three ways over one
  code core: the **PWA** (mobile + desktop browsers), the **Capacitor** shell (mobile app),
  and the **Electron** shell (rich desktop client). Thin: shows chat, sends text,
  push-to-talk audio, and can subscribe as a **listener** to play spoken (TTS) responses.
  Each native shell adds capabilities via a feature-detected `window.jarvis` bridge (no-op
  in a plain browser, so the UI is never forked). The Electron client additionally hosts
  **Design Mode** — see [`specs/DSK-01-12-desktop-design-mode.md`](specs/DSK-01-12-desktop-design-mode.md) —
  and a **system-tray control center** (`desktop/src/control/`) with live Hub/Runner status
  and actions (restart Hub, start/stop Runner, update machines, logs), auto-adapting to a
  hub / runner-only machine. See [`updates.md`](updates.md#from-the-tray-desktop-app).

## Adapters (the agnostic core) — `packages/core`

- `AgentAdapter` — `capabilities` · `available` · `send(onEvent)` · `oneShot`
  plus optional native binding/usage/descriptor. Implementations and support
  levels are enumerated in the parity matrix.
- `packages/core/src/turn.ts` — managed lifecycle shared by Hub and Runner.
- `packages/core/src/activity-replay.ts` — reconstructs only the latest unanswered
  turn from the fsynced execution journal. A stored assistant message closes the
  replay window, preventing duplicate completed responses.
- `packages/core/src/agent-contract.ts` — descriptors, models, usage and event
  schema; the current web transport still carries the compatible `stream` shape.
- `packages/core/src/council.ts` — multi-agent debate plan (Conselho).
- `packages/core/src/tournament.ts` — fan the same task out to N candidates in
  isolated worktrees, a judge scores them, and `selectTournamentWinner` promotes
  the winner deterministically (pure/testable; wired in the Hub via
  `startLocalTournament`, mirroring the council path).
- `packages/core/src/progressive-reply.ts` — portable "ack → process → deliver"
  helper for slow voice/agent replies (see `docs/voice-progressive-disclosure.md`).
- `packages/core/src/background-jobs.ts` + `background-runner.ts` — durable
  background jobs that outlive the one-shot turn: an fsynced job journal + pure
  continuation planner (`background-jobs.ts`) and a detached, reaper-safe process
  runner reporting back via files (`background-runner.ts`). The Hub parses a
  `` ```jarvis-run `` block from the reply, runs the job, and auto-continues the
  session on completion (see README "Durable background jobs & auto-continue").
- `packages/protocol/src/runner.ts` — actual Hub↔Runner WebSocket contract. The
  `listdir`/`dirs` messages carry an optional `files` array for the file-tree
  explorer (the legacy folder-picker omits the flag and still sees folders only).
  `dirs` may also carry `requested` (raw path echoed back), `error` (shown inside the
  picker) and `drives` (Windows, at a drive root); Hub and Runner build it with the
  same `listDirectory()` from `packages/core/src/dir-listing.ts`.
- `packages/core/src/browser.ts` — **remote browser** (BRW-IDE-00 F1): one headless
  Chromium per *profile* per machine (F1 exposes only the owner profile,
  `~/.jarvis/browser/owner`), driven over raw CDP on loopback only. Hosted by each
  Runner and, for the Hub's own machine, in-process by the Hub (like the terminal).
  Chrome is discovered (`JARVIS_BROWSER_PATH` → Chrome → Edge → Chromium/Playwright)
  and launched lazily on the first open; `JARVIS_BROWSER=0` removes the capability.
  Screencast runs only while someone watches a tab, with "latest wins" + an fps cap on
  the producer and adaptive JPEG quality. Orphan safety: pidfile per profile, reaping by
  `--user-data-dir` command line (on open, after every kill and at host boot), tree
  kill on shutdown, idle shutdown with no viewers.
- `apps/hub/src/browserRelay.ts` — the Hub side of the remote browser: **owner-only**
  gate (members are refused even with a runner grant, and the attempt is audited),
  viewer counting per (machine, tab), and an **opaque** relay of the binary frames
  (only the `pageId` in the header is read) with per-viewer credit (max 2 frames in
  flight without `browser_fack`, keeping only the newest). Frames travel as binary
  WebSocket messages on the existing runner connection and to the client, never as
  JSON/base64, and with per-message deflate disabled. Contract and binary layout:
  `packages/protocol/src/runner.ts` (protocol v18) and
  [`specs/BRW-IDE-00-remote-browser-and-ide.md`](specs/BRW-IDE-00-remote-browser-and-ide.md) §4.1.
  The client panel (🌐 in the chat header, `apps/hub/web/app.js`) is feature-detected:
  it only appears for the owner when some machine advertises `browser`.
- `packages/core/src/browser-agent.ts` — **the AI in the browser** (BRW-IDE-00 F2, protocol
  v19). A small Playwright-MCP-like toolset (`browser_tabs/snapshot/screenshot/navigate/click/
  type/press/scroll/new_tab/close_tab/wait/handle_dialog`; accessibility-tree snapshot with
  stable refs `e12`; **no** JS evaluation, **no** cookie/storage access) served by
  `BrowserAgentService` on top of the machine's `BrowserManager`. The three levels of the spec
  §3.1 are enforced in ONE place (`BrowserAgentService.call`) on the machine that owns the
  browser: *Ver* (read tools on the owner profile), *agent profile* (everything on the separate
  system profile `~/.jarvis/browser/agent`, launched lazily) and *owner drive* (actions on the
  owner profile only after the owner enables it for that session; expires at the end of the
  session's turn, on "Assumir", on Hub-link loss or after 30 min). Transport to the agent is the
  same as the task/permission bridges: a tiny stdio MCP server embedded as a string
  (`~/.jarvis/browser-bridge.mjs`, server `jarvisbrowser`) injected per turn — Claude via the
  turn's `--mcp-config`, Codex via `-c mcp_servers.jarvisbrowser.*` — that forwards each call to
  a loopback endpoint (`/internal/browser` on the Hub for local sessions, an ephemeral
  `127.0.0.1` server on each runner) with a **per-turn token**. The Hub only marks owner turns
  (`send.browser:true`); grants/actions/selection travel as `browser_agent_*`/`browser_grab*`
  and every agent action lands in `audit.log` without page content. The same module serves the
  owner's "select points → send to the AI" (`browser_grab`: element under the point + cropped
  JPEG, secrets redacted). Spec §16.
- **VS Code per machine** (BRW-IDE-00 F4) was **removed on 2026-10-26**: editing happens in the
  lightweight editor inside Jarvis (F3). Protocol v19 keeps its number; the Hub and the runner
  silently drop `ide_*` messages and binary `0x54` frames from peers that have not updated yet.
  History in the spec §15.4 and §17.

## Voice pipeline (local)

```
wake word (openWakeWord "Jarvis")
  → STT (faster-whisper, small)      -- audio → text
  → AgentAdapter + canonical event contract -- text → live events → response
  → TTS (Piper)                       -- response → audio
  → clients viewing the target session
```

An optional **orchestrator** — a headless agent session that interprets voice
intent ("open project X, run tests") and routes — is itself just a special
`AgentAdapter`, and is **not** shown in the chat UI.

## Audio delivery

TTS is generated on the Hub and broadcast to clients subscribed to the target
chat session. The wake/voice session can additionally receive the same audio
when it is controlling another conversation. There is no separate public
`listen` protocol today.

## Session list (Histórico)

The client sidebar organizes conversations instead of showing one flat feed. A
per-client toolbar (persisted in `localStorage['jarvis_recents_prefs']`) drives a
single **pure** function (`organizeSessions` in `app.js`, covered by
`apps/hub/src/webClient.test.ts`):

- **Group by** — Project (last path segment of the session `cwd`), Machine, Agent,
  Date bucket, or None. Each group header shows a count and, for Project/Machine
  groups, a **＋** that opens a new session already scoped to that folder/machine.
  Clicking a header **collapses/expands** that group (a chevron appears on hover;
  the collapsed set persists in `localStorage['jarvis_recents_collapsed']`).
- **Compact rows** — each session is a single line; its actions (summarize, archive,
  delete) live behind a per-row **⋯** menu instead of inline buttons, to save width.
- **Sort by** — Recency (default), Alphabetical, or Cost. Cost comes from a new
  `cost` field on the session metadata (`Store.list()` sums each message's
  `usage.costUsd`), so the sort is real, not cosmetic.
- **Show** — Active (default), Archived, or All. Archiving is non-destructive:
  `Store.setArchived(id, flag)` keeps the session listed (so it stays findable)
  but the "Active" view filters it out. The flag persists in `sessions.json` and
  is honored on both the Hub and remote Runners — the `archive` op forwards to the
  owning Runner exactly like `delete`/`dropLast`.

Grouping/sorting/filtering are view-only; the underlying `sessions` array (and its
Hub-authored order) is never mutated, so machine-routing invariants are unaffected.

## Data & security model

- **Storage:** crash-safe (atomic) JSON snapshots + local files on each machine
  that owns sessions; pending activity is an append-only fsynced execution
  journal and survives Hub/Runner restart. Provider-native transcripts remain
  in provider homes.
- **Network:** private Tailscale is recommended; reverse proxy/TLS is optional.
- **Encryption:** supplied by Tailscale or the operator's TLS proxy.
- **External calls:** the selected provider CLI's inference/integrations. Voice is
  fully offline.

## Current implementation milestones

1. Local voice, PWA, auth, push and managed sessions.
2. Hub + multi-machine Runner protocol v6, including durable execution journals,
   manifest/replay and provider-neutral subprocess trees.
3. Shared provider-neutral turn lifecycle and typed usage ledger.
4. Claude/Codex native integration plus registered adapters/status for the wider
   CLI matrix. External adapters remain unverified until their installed version
   passes the real probe gate.
