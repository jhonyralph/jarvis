// Mobile build dispatcher used by scripts/run.mjs.
// Android can build on Windows/macOS/Linux. iOS/Apple builds require macOS + Xcode.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS, "..");
const MOBILE = join(ROOT, "mobile");
const node = process.execPath;
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const mode = (process.argv[2] || "help").toLowerCase();
const extra = process.argv.slice(3);

function run(cmd, args, cwd = MOBILE) {
  const shell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(cmd);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function help() {
  console.log(`
Mobile builds:
  build-android                      Android debug APK
  build-android-release              Android release APK (requires signing config for a real release)
  build-aab                          Android release bundle (Play Store)
  build-ios / build-apple            iOS sync/open on macOS; --archive tries an Xcode archive

Examples:
  npm run build:android
  npm run build:aab
  npm run build:apple -- --archive
`);
}

function android(task) {
  run(node, ["build-android.mjs", task]);
  const outputs = {
    assembleDebug: join(MOBILE, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
    assembleRelease: join(MOBILE, "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
    bundleRelease: join(MOBILE, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab"),
  };
  if (outputs[task]) console.log(`[mobile-build] output: ${outputs[task]}`);
}

function ensureIosProject() {
  if (!existsSync(join(MOBILE, "ios"))) run(npx, ["cap", "add", "ios"]);
}

function ios() {
  if (process.platform !== "darwin") {
    console.error("iOS/Apple builds require macOS with Xcode. Run this command on a Mac or macOS CI runner.");
    process.exit(1);
  }
  run(node, ["sync-web.mjs"]);
  ensureIosProject();
  run(npx, ["cap", "sync", "ios"]);
  if (extra.includes("--archive")) {
    const archivePath = join(MOBILE, "build", "Jarvis.xcarchive");
    run("xcodebuild", ["archive", "-workspace", "ios/App/App.xcworkspace", "-scheme", "App", "-archivePath", archivePath]);
    console.log(`[mobile-build] archive: ${archivePath}`);
  } else {
    run(npx, ["cap", "open", "ios"]);
  }
}

try {
  if (mode === "android" || mode === "apk") android("assembleDebug");
  else if (mode === "android-release") android("assembleRelease");
  else if (mode === "aab" || mode === "android-bundle") android("bundleRelease");
  else if (mode === "ios" || mode === "apple") ios();
  else { help(); process.exit(mode === "help" || mode === "--help" ? 0 : 1); }
} catch (error) {
  console.error(`[mobile-build] ${error.message || error}`);
  process.exit(1);
}
