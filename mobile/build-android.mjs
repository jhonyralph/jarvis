import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAndroidSdkLocalProperties } from "./android-sdk.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const androidDir = join(here, "android");
const node = process.execPath;
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const gradlew = join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const gradleArgs = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { normalizeHubUrl } = require("../desktop/src/shared/hub-url.js");

function run(cmd, args, opts = {}) {
  const shell = opts.shell ?? (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(cmd));
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd || here, shell });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function patchSendIntentSdk() {
  const gradleFile = join(here, "node_modules", "send-intent", "android", "build.gradle");
  if (!existsSync(gradleFile)) return;
  const before = readFileSync(gradleFile, "utf8");
  const after = before
    .replace(/compileSdkVersion\s+\d+/g, "compileSdkVersion rootProject.ext.compileSdkVersion")
    .replace(/targetSdkVersion\s+\d+/g, "targetSdkVersion rootProject.ext.targetSdkVersion");
  if (after !== before) {
    writeFileSync(gradleFile, after);
    console.log("[android-build] patched send-intent compile/target SDK to match android/variables.gradle");
  }
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1].startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function resolveHubUrl() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const jarvis = home ? join(home, ".jarvis") : "";
  const hubEnv = jarvis ? readEnvFile(join(jarvis, "hub.env")) : {};
  const runnerEnv = jarvis ? readEnvFile(join(jarvis, "runner.env")) : {};
  const raw =
    process.env.JARVIS_APP_HUB_URL ||
    process.env.JARVIS_PUBLIC_URL ||
    hubEnv.JARVIS_APP_HUB_URL ||
    hubEnv.JARVIS_PUBLIC_URL ||
    runnerEnv.JARVIS_APP_HUB_URL ||
    runnerEnv.JARVIS_PUBLIC_URL ||
    runnerEnv.JARVIS_HUB ||
    "";
  if (!raw) return "";
  const normalized = normalizeHubUrl(raw, "");
  if (normalized.warning || !normalized.url) {
    console.warn(`[android-build] Ignoring invalid Hub URL (${raw}): ${normalized.warning || "empty after normalization"}`);
    return "";
  }
  return normalized.url;
}

try {
  const { sdk, file } = ensureAndroidSdkLocalProperties();
  const hubUrl = resolveHubUrl();
  if (hubUrl) {
    process.env.JARVIS_APP_HUB_URL = hubUrl;
    console.log(`[android-build] Hub URL: ${hubUrl}`);
  } else {
    console.warn("[android-build] Hub URL not found; APK will use bundled UI only and cannot reach a Hub on the phone via localhost.");
  }
  console.log(`[android-build] SDK: ${sdk}`);
  console.log(`[android-build] local.properties: ${file}`);
  run(node, ["sync-web.mjs"]);
  run(node, ["generate-android-icons.mjs"]);
  run(npx, ["cap", "sync", "android"]);
  run(node, ["apply-android-native.mjs"]);
  run(node, ["apply-context-native.mjs", "android"]);
  patchSendIntentSdk();
  run(gradlew, gradleArgs.length ? gradleArgs : ["assembleSideloadDebug"], { cwd: androidDir });
} catch (error) {
  console.error(`[android-build] ${error.message || error}`);
  process.exit(1);
}
