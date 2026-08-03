import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = join(here, "android");
const localProperties = join(androidDir, "local.properties");

function sdkCandidates() {
  const env = process.env;
  const home = env.HOME || env.USERPROFILE || "";
  const local = env.LOCALAPPDATA || (home ? join(home, "AppData", "Local") : "");
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    env.ANDROID_SDK,
    local && join(local, "Android", "Sdk"),
    home && join(home, "Library", "Android", "sdk"),
    home && join(home, "Android", "Sdk"),
    "/opt/android-sdk",
    "/usr/local/share/android-sdk",
    "/usr/lib/android-sdk",
    "C:\\Android\\Sdk",
  ];
  return candidates.filter(Boolean).map((p) => resolve(String(p)));
}

function looksLikeAndroidSdk(path) {
  if (!path || !existsSync(path)) return false;
  return ["platform-tools", "platforms", "cmdline-tools", "build-tools"].some((name) => existsSync(join(path, name)));
}

function localPropertiesValue(path) {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function upsertSdkDir(path) {
  mkdirSync(androidDir, { recursive: true });
  const sdkDir = `sdk.dir=${localPropertiesValue(path)}`;
  const current = existsSync(localProperties) ? readFileSync(localProperties, "utf8") : "";
  const lines = current.split(/\r?\n/).filter((line) => line.trim() !== "");
  const idx = lines.findIndex((line) => /^\s*sdk\.dir\s*=/.test(line));
  if (idx >= 0) lines[idx] = sdkDir;
  else lines.unshift(sdkDir);
  const next = `${lines.join("\n")}\n`;
  if (next !== current) writeFileSync(localProperties, next);
  return localProperties;
}

export function findAndroidSdk() {
  return sdkCandidates().find(looksLikeAndroidSdk) || "";
}

export function ensureAndroidSdkLocalProperties() {
  const sdk = findAndroidSdk();
  if (!sdk) {
    const tried = sdkCandidates().map((p) => `  - ${p}`).join("\n");
    throw new Error(
      "Android SDK not found. Install Android Studio/SDK or set ANDROID_HOME/ANDROID_SDK_ROOT.\n" +
        "Checked:\n" +
        tried
    );
  }
  const file = upsertSdkDir(sdk);
  return { sdk, file };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { sdk, file } = ensureAndroidSdkLocalProperties();
    console.log(`[android-sdk] sdk.dir=${localPropertiesValue(sdk)}`);
    console.log(`[android-sdk] wrote ${file}`);
  } catch (error) {
    console.error(`[android-sdk] ${error.message || error}`);
    process.exit(1);
  }
}
