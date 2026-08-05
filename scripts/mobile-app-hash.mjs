// Decide whether a mobile (APK/IPA) build is actually needed.
//
// The mobile app is a WEBVIEW shell: its bytes are fully determined by (a) the web payload that
// sync-web.mjs stages into www (apps/hub/web/**), (b) the mobile shell itself (launcher, capacitor
// config, native transforms/plugins, deps), and (c) the build scripts. If NONE of those changed since
// the last published APK, rebuilding produces the same app — so CI can skip it.
//
// This computes a stable content FINGERPRINT over exactly that set. The workflow compares it against
// the fingerprint saved beside the previous release; equal → skip the build.
//
// Usage:
//   node scripts/mobile-app-hash.mjs                 # print the current fingerprint
//   node scripts/mobile-app-hash.mjs --against <hex> # also decide `needed` vs a baseline
// When $GITHUB_OUTPUT is set it also writes `hash=`, and (with --against) `needed=` / `reason=`.
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const NUL = String.fromCharCode(0); // git ls-files -z record separator

/** Does this repo path end up affecting the built mobile app? (Path is repo-relative, any separator.) */
export function isAppRelevant(p) {
  const path = String(p).replace(/\\/g, "/");
  // The whole web client is bundled into the WebView (offline fallback + the live UI is this code OTA).
  if (path.startsWith("apps/hub/web/")) return true;
  // The one build script living outside mobile/.
  if (path === "scripts/build-mobile.mjs") return true;
  if (path.startsWith("mobile/")) {
    // Generated dirs are never part of the SOURCE fingerprint (git wouldn't list them anyway; belt+braces).
    if (/^mobile\/(www|android|ios|node_modules)\//.test(path)) return false;
    // Docs, tests and ignore files don't change a single byte of the APK.
    if (path.endsWith(".md")) return false;
    if (path.endsWith(".test.mjs")) return false;
    if (path.endsWith("/.gitignore")) return false;
    return true;
  }
  return false;
}

/** Combine per-file {path, sha} entries into ONE order-independent fingerprint. Pure + deterministic. */
export function fingerprint(entries) {
  const lines = entries
    .map((e) => `${String(e.path).replace(/\\/g, "/")} ${e.sha}`)
    .sort(); // order-independent: sorting makes the result stable regardless of enumeration order
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** Enumerate tracked, app-relevant files via git (so untracked/generated noise can never leak in). */
export function appFiles(cwd = process.cwd()) {
  const res = spawnSync("git", ["ls-files", "-z", "apps/hub/web", "mobile", "scripts/build-mobile.mjs"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr || res.status}`);
  return res.stdout.split(NUL).filter(Boolean).filter(isAppRelevant).sort();
}

/** Compute the fingerprint of the working tree at `cwd`. */
export function computeAppFingerprint(cwd = process.cwd()) {
  const entries = appFiles(cwd).map((path) => ({ path, sha: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  return { hash: fingerprint(entries), count: entries.length };
}

function emit(key, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (out && existsSync(out)) appendFileSync(out, `${key}=${value}\n`);
}

function main(argv) {
  const against = (() => { const i = argv.indexOf("--against"); return i >= 0 ? (argv[i + 1] || "").trim() : null; })();
  const { hash, count } = computeAppFingerprint();
  console.log(`[mobile-app-hash] ${hash} (${count} files)`);
  emit("hash", hash);
  if (against !== null) {
    // No baseline (first ever run / no previous release asset) → build, to be safe (never wrongly skip).
    const needed = against === "" ? true : against !== hash;
    const reason = against === "" ? "no baseline (first build)" : needed ? "app inputs changed" : "app inputs unchanged since last release";
    console.log(`[mobile-app-hash] baseline=${against || "(none)"} needed=${needed} — ${reason}`);
    emit("needed", String(needed));
    emit("reason", reason);
  }
}

// Run as CLI only when invoked directly (kept importable for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(`[mobile-app-hash] ${e.message || e}`); process.exit(1); }
}
