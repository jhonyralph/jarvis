// Stage the existing Jarvis web client (apps/hub/web) into ./www so Capacitor bundles it as the
// offline/first-launch fallback. Run before `cap sync`. Idempotent (wipes ./www first).
// The live UI still comes from the Hub over-the-air when server.url is set (see capacitor.config.ts).
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "apps", "hub", "web");
const dst = join(here, "www");

if (!existsSync(src)) {
  console.error(`[sync-web] source not found: ${src} — run from the repo's mobile/ dir.`);
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`[sync-web] copied ${src} -> ${dst}`);
