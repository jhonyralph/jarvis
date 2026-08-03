// Mobile build dispatcher used by scripts/run.mjs.
// Android can build on Windows/macOS/Linux. iOS/Apple builds require macOS + Xcode.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMergedAndroidManifest } from "../mobile/apply-context-native.mjs";

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
  build-ios / build-apple            iOS sync/open on macOS; --archive creates an Xcode archive

Examples:
  npm run build:android
  npm run build:aab
  npm run build:apple -- --archive
  npm run build:apple -- --spm
  npm run build:apple -- --cocoapods
  npm run build:apple -- --ios-background-mode
`);
}

function android(task) {
  run(node, ["build-android.mjs", task]);
  verifyBuiltAndroidManifest(task);
  const outputs = {
    assembleSideloadDebug: [join(MOBILE, "android", "app", "build", "outputs", "apk", "sideload", "debug", "app-sideload-debug.apk")],
    assembleSideloadRelease: [
      join(MOBILE, "android", "app", "build", "outputs", "apk", "sideload", "release", "app-sideload-release.apk"),
      join(MOBILE, "android", "app", "build", "outputs", "apk", "sideload", "release", "app-sideload-release-unsigned.apk"),
    ],
    bundleStoreRelease: [join(MOBILE, "android", "app", "build", "outputs", "bundle", "storeRelease", "app-store-release.aab")],
  };
  const output = outputs[task]?.find((candidate) => existsSync(candidate));
  if (outputs[task] && !output) throw new Error(`Gradle completed but the ${task} artifact was not found`);
  if (output) console.log(`[mobile-build] output: ${output}`);
}

function verifyBuiltAndroidManifest(task) {
  const variants = {
    assembleSideloadDebug: ["sideloadDebug", "SideloadDebug", "sideload"],
    assembleSideloadRelease: ["sideloadRelease", "SideloadRelease", "sideload"],
    bundleStoreRelease: ["storeRelease", "StoreRelease", "store"],
  };
  const variant = variants[task];
  if (!variant) return;
  const [directory, taskName, policy] = variant;
  const candidates = [
    join(MOBILE, "android", "app", "build", "intermediates", "merged_manifests", directory, `process${taskName}Manifest`, "AndroidManifest.xml"),
    join(MOBILE, "android", "app", "build", "intermediates", "packaged_manifests", directory, `process${taskName}ManifestForPackage`, "AndroidManifest.xml"),
  ];
  const manifest = candidates.find((candidate) => existsSync(candidate));
  if (!manifest) throw new Error(`Could not locate the final ${directory} AndroidManifest.xml`);
  verifyMergedAndroidManifest(readFileSync(manifest, "utf8"), policy, manifest);
  console.log(`[mobile-build] verified ${policy} manifest policy: ${manifest}`);
}

function requestedIosPackageManager() {
  const spm = extra.includes("--spm");
  const pods = extra.includes("--cocoapods");
  if (spm && pods) throw new Error("Use only one of --spm or --cocoapods");
  return spm ? "SPM" : pods ? "CocoaPods" : "";
}

function detectIosPackageManager() {
  const app = join(MOBILE, "ios", "App");
  const hasSpm = existsSync(join(app, "CapApp-SPM", "Package.swift"));
  const hasPods = existsSync(join(app, "Podfile"));
  if (hasSpm && hasPods) {
    throw new Error(`Ambiguous iOS project contains both SPM and CocoaPods entrypoints: ${app}`);
  }
  if (hasSpm) return "SPM";
  if (hasPods) return "CocoaPods";
  return "";
}

function ensureIosProject() {
  const iosDir = join(MOBILE, "ios");
  const requested = requestedIosPackageManager();
  if (!existsSync(iosDir)) {
    run(npx, ["cap", "add", "ios", "--packagemanager", requested || "CocoaPods"]);
    const created = detectIosPackageManager();
    if (!created) throw new Error("cap add ios completed without a detectable SPM or CocoaPods project");
    return created;
  }
  const actual = detectIosPackageManager();
  if (requested && actual && actual !== requested) {
    throw new Error(`Existing iOS project uses ${actual}; regenerate it to switch to ${requested}`);
  }
  if (!actual) throw new Error("Could not detect the generated iOS package manager (SPM or CocoaPods)");
  return actual;
}

function iosArchiveEntrypoint() {
  const app = join(MOBILE, "ios", "App");
  const spm = join(app, "CapApp-SPM", "Package.swift");
  const pods = join(app, "Podfile");
  const workspace = join(app, "App.xcworkspace");
  if (existsSync(spm) && existsSync(pods)) {
    throw new Error(`Ambiguous iOS project contains both SPM and CocoaPods entrypoints: ${app}`);
  }
  if (existsSync(spm)) return ["-project", "ios/App/App.xcodeproj"];
  if (existsSync(pods) && existsSync(workspace)) return ["-workspace", "ios/App/App.xcworkspace"];
  if (existsSync(pods)) {
    throw new Error("CocoaPods project has no App.xcworkspace after cap sync ios; run pod install and retry");
  }
  throw new Error("Could not detect the generated iOS package manager (SPM or CocoaPods)");
}

function filesNamed(root, name) {
  if (!existsSync(root)) return [];
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) matches.push(...filesNamed(path, name));
    else if (entry.isFile() && entry.name === name) matches.push(path);
  }
  return matches;
}

function verifyArchivedPrivacyManifest(archivePath) {
  const manifests = filesNamed(archivePath, "PrivacyInfo.xcprivacy").filter((path) =>
    /jarviscontext/i.test(path) &&
    /NSPrivacyAccessedAPICategoryUserDefaults[\s\S]*CA92\.1/.test(readFileSync(path, "utf8")));
  if (manifests.length === 0) {
    throw new Error("JarvisContext PrivacyInfo.xcprivacy was not found in the Xcode archive");
  }
  console.log(`[mobile-build] verified JarvisContext privacy manifest: ${manifests[0]}`);
}

function ios() {
  if (process.platform !== "darwin") {
    console.error("iOS/Apple builds require macOS with Xcode. Run this command on a Mac or macOS CI runner.");
    process.exit(1);
  }
  const allowed = new Set(["--archive", "--spm", "--cocoapods", "--ios-background-mode"]);
  const unknown = extra.filter((argument) => !allowed.has(argument));
  if (unknown.length) throw new Error(`Unknown Apple build option: ${unknown.join(", ")}`);
  requestedIosPackageManager();
  const privacyManifest = join(MOBILE, "plugins", "jarvis-context", "ios", "Sources", "JarvisContext", "PrivacyInfo.xcprivacy");
  run("plutil", ["-lint", privacyManifest], ROOT);
  run(node, ["sync-web.mjs"]);
  const packageManager = ensureIosProject();
  run(npx, ["cap", "sync", "ios"]);
  const transformArgs = ["apply-context-native.mjs", "ios"];
  if (extra.includes("--ios-background-mode")) transformArgs.push("--ios-background-mode");
  run(node, transformArgs);
  if (packageManager === "CocoaPods") run("pod", ["install"], join(MOBILE, "ios", "App"));
  if (extra.includes("--archive")) {
    const archivePath = join(MOBILE, "build", "Jarvis.xcarchive");
    run("xcodebuild", [
      "archive",
      ...iosArchiveEntrypoint(),
      "-scheme",
      "App",
      "-destination",
      "generic/platform=iOS",
      "-archivePath",
      archivePath,
    ]);
    verifyArchivedPrivacyManifest(archivePath);
    console.log(`[mobile-build] archive: ${archivePath}`);
  } else {
    run(npx, ["cap", "open", "ios"]);
  }
}

try {
  if (mode === "android" || mode === "apk") android("assembleSideloadDebug");
  else if (mode === "android-release") android("assembleSideloadRelease");
  else if (mode === "aab" || mode === "android-bundle") android("bundleStoreRelease");
  else if (mode === "ios" || mode === "apple") ios();
  else { help(); process.exit(mode === "help" || mode === "--help" ? 0 : 1); }
} catch (error) {
  console.error(`[mobile-build] ${error.message || error}`);
  process.exit(1);
}
