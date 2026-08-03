/**
 * GitHub source for Framework Jarvis imports. Parses a repo spec (shorthand or URL), downloads the
 * repo tarball with a hard byte cap, and extracts the in-scope framework files. Public repos only for
 * now (no stored credentials); an optional token is threaded through for callers that already hold one.
 * Network lives here so framework-import.ts stays pure and unit-testable.
 */
import { untargz, extractFrameworkFiles, type ExtractResult } from "./framework-archive.js";

export interface GithubSpec { owner: string; repo: string; ref?: string; subdir?: string }
export interface GithubFetch extends ExtractResult { spec: GithubSpec; ref: string; commit?: string }

/** cap the tarball download so a hostile/huge repo can't exhaust memory before we even extract. */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Accepts: `owner/repo`, `owner/repo@ref`, `owner/repo/sub/dir`, `owner/repo/sub/dir@ref`,
 * and `https://github.com/owner/repo[/tree/ref[/sub/dir]]`. Throws on anything unrecognizable.
 */
export function parseGithubSpec(input: string): GithubSpec {
  let s = String(input || "").trim();
  if (!s) throw new Error("origem GitHub vazia");
  const urlMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/i.exec(s);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], ref: urlMatch[3] || undefined, subdir: (urlMatch[4] || "").replace(/\/+$/, "") || undefined };
  }
  if (/^https?:\/\//i.test(s)) throw new Error("URL de GitHub não reconhecida");
  let ref: string | undefined;
  const at = s.lastIndexOf("@");
  if (at > 0) { ref = s.slice(at + 1) || undefined; s = s.slice(0, at); }
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("use owner/repo[/subpasta][@ref]");
  const [owner, repo, ...rest] = parts;
  return { owner, repo, ref, subdir: rest.length ? rest.join("/") : undefined };
}

async function download(url: string, token?: string): Promise<Buffer> {
  // Global fetch follows GitHub's 302 to codeload automatically. Read with a hard byte cap so a
  // server that omits/lies about content-length can't stream us to death.
  const res = await fetch(url, {
    headers: {
      "user-agent": "jarvis-framework",
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error("download excede o limite permitido");
  const reader = res.body?.getReader();
  if (!reader) return Buffer.from(await res.arrayBuffer());
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > MAX_DOWNLOAD_BYTES) { await reader.cancel(); throw new Error("download excede o limite permitido"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Fetch + extract the framework files from a GitHub repo. `commit` is derived from the tarball's
 *  top-level `repo-<sha>/` directory, so update checks can compare against the exact commit. */
export async function fetchGithubFramework(spec: GithubSpec, opts: { token?: string } = {}): Promise<GithubFetch> {
  const refPath = spec.ref ? `/${encodeURIComponent(spec.ref)}` : "";
  const url = `https://api.github.com/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}/tarball${refPath}`;
  const buf = await download(url, opts.token);
  const entries = untargz(buf);
  const top = entries[0]?.path.split("/")[0] || "";
  const dash = top.lastIndexOf("-");
  const commit = dash > 0 ? top.slice(dash + 1) : undefined;
  const extracted = extractFrameworkFiles(entries, { subdir: spec.subdir });
  return { ...extracted, spec, ref: spec.ref || "(default)", commit };
}
