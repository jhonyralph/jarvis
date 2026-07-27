// Design Mode — preview-URL discovery. Runs on the machine that OWNS the session (the Runner, LEI 6),
// never guessed by the client. It finds dev servers whose owning process cwd is under the session's
// cwd by scanning listening TCP ports (ss/lsof/netstat), and can also read the URL a dev-server prints.
//
// Pure parsers + an injectable `exec` so the logic is unit-tested without spawning real processes.

import type { PreviewCandidate } from "@jarvis/protocol";

export type PreviewPlatform = "linux" | "darwin" | "win32" | (string & {});

/** Ports commonly used by dev servers; ranked first among discovered candidates. */
export const KNOWN_DEV_PORTS = new Set<number>([
  3000, 3001, 4173, 4200, 5000, 5173, 5174, 8000, 8080, 8081, 8787, 8888, 9000,
]);

export interface ListeningEntry {
  port: number;
  pid: number | null;
}

function uniqByPort(entries: ListeningEntry[]): ListeningEntry[] {
  const seen = new Map<number, ListeningEntry>();
  for (const e of entries) {
    const existing = seen.get(e.port);
    // Prefer an entry that carries a pid over one that doesn't.
    if (!existing || (existing.pid == null && e.pid != null)) seen.set(e.port, e);
  }
  return [...seen.values()];
}

const portOf = (addr: string): number => {
  const port = Number(addr.slice(addr.lastIndexOf(":") + 1));
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 0;
};

/** Parse Linux `ss -ltnpH`:  `LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=1234,fd=20))` */
export function parseSs(output: string): ListeningEntry[] {
  const out: ListeningEntry[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^LISTEN/i.test(line)) continue; // also drops the header row
    const cols = line.split(/\s+/);
    const port = portOf(cols[3] ?? "");
    if (!port) continue;
    const pidM = line.match(/pid=(\d+)/);
    out.push({ port, pid: pidM ? Number(pidM[1]) : null });
  }
  return uniqByPort(out);
}

/** Parse `lsof -nP -iTCP -sTCP:LISTEN`:  `node 1234 user 20u IPv4 ... TCP 127.0.0.1:5173 (LISTEN)` */
export function parseLsof(output: string): ListeningEntry[] {
  const out: ListeningEntry[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("COMMAND")) continue;
    const m = line.match(/:(\d+)\s+\(LISTEN\)/);
    if (!m) continue;
    const cols = line.split(/\s+/);
    const pid = Number(cols[1]);
    out.push({ port: Number(m[1]), pid: Number.isInteger(pid) ? pid : null });
  }
  return uniqByPort(out);
}

/** Parse Windows `netstat -ano -p tcp`:  `  TCP  127.0.0.1:5173  0.0.0.0:0  LISTENING  1234` */
export function parseNetstat(output: string): ListeningEntry[] {
  const out: ListeningEntry[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^TCP/i.test(line) || !/LISTENING/i.test(line)) continue;
    const cols = line.split(/\s+/);
    const port = portOf(cols[1] ?? "");
    if (!port) continue;
    const pid = Number(cols[cols.length - 1]);
    out.push({ port, pid: Number.isInteger(pid) ? pid : null });
  }
  return uniqByPort(out);
}

/** Extract localhost dev-server URLs a process printed (e.g. Vite's "Local: http://localhost:5173/"). */
export function parseAdvertisedUrls(text: string): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>]*)?/gi;
  for (const m of text.matchAll(re)) urls.add(m[0].replace(/\/+$/, ""));
  return [...urls];
}

/** Known dev ports first, then ascending. */
export function rankEntries(entries: ListeningEntry[]): ListeningEntry[] {
  return [...entries].sort((a, b) => {
    const ka = KNOWN_DEV_PORTS.has(a.port) ? 0 : 1;
    const kb = KNOWN_DEV_PORTS.has(b.port) ? 0 : 1;
    return ka - kb || a.port - b.port;
  });
}

/** True if `child` is `parent` or nested under it (path-separator agnostic). */
export function isPathUnder(child: string, parent: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const c = norm(child);
  const p = norm(parent);
  return !!p && (c === p || c.startsWith(p + "/"));
}

export function toCandidate(
  port: number,
  host: string,
  source: PreviewCandidate["source"],
  detectedAt: number,
): PreviewCandidate {
  return { url: `http://${host}:${port}`, port, source, detectedAt };
}

export interface DetectDeps {
  platform: PreviewPlatform;
  /** Run a command and return stdout ("" on failure). Injected so discovery is testable. */
  exec: (cmd: string, args: string[]) => Promise<string>;
  now: () => number;
  /** Host embedded in the candidate URL (loopback for the local runner; a remote runner fills its own). */
  host?: string;
}

async function pidCwd(pid: number, deps: DetectDeps): Promise<string | null> {
  if (deps.platform === "linux") {
    const out = (await deps.exec("readlink", [`/proc/${pid}/cwd`]).catch(() => "")).trim();
    return out || null;
  }
  if (deps.platform === "darwin") {
    const out = await deps.exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).catch(() => "");
    const m = out.match(/^n(.+)$/m);
    return m ? m[1].trim() : null;
  }
  return null; // win32: a process's cwd is not readily obtainable
}

/**
 * Discover preview candidates under `cwd`. Entries owned by a process whose cwd is under `cwd` are
 * kept; entries with an unknown owner are kept only if they use a known dev port; entries owned by an
 * unrelated process are dropped.
 */
export async function detectPreviewCandidates(cwd: string, deps: DetectDeps): Promise<PreviewCandidate[]> {
  const host = deps.host ?? "127.0.0.1";
  const at = deps.now();
  let entries: ListeningEntry[] = [];
  try {
    if (deps.platform === "win32") {
      entries = parseNetstat(await deps.exec("netstat", ["-ano", "-p", "tcp"]));
    } else {
      const ss = await deps.exec("ss", ["-ltnpH"]).catch(() => "");
      entries = ss.trim() ? parseSs(ss) : parseLsof(await deps.exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]).catch(() => ""));
    }
  } catch {
    entries = [];
  }

  const candidates: PreviewCandidate[] = [];
  for (const e of rankEntries(entries)) {
    let underCwd: boolean | null = null;
    if (e.pid != null) {
      const procCwd = await pidCwd(e.pid, deps);
      underCwd = procCwd ? isPathUnder(procCwd, cwd) : null;
    }
    if (underCwd === false) continue; // owned by an unrelated process
    if (underCwd === null && !KNOWN_DEV_PORTS.has(e.port)) continue; // unknown owner + non-dev port
    candidates.push(toCandidate(e.port, host, "port-scan", at));
  }
  return candidates;
}
