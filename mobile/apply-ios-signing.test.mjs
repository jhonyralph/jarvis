import assert from "node:assert/strict";
import test from "node:test";
import { applyIosSigning, exportOptionsPlist } from "./apply-ios-signing.mjs";

const options = {
  bundleId: "chat.jarvis.app",
  teamId: "ABCDE12345",
  profileName: "Jarvis App Store (2026)",
  version: "0.56.0",
  build: "2611211530",
};

// Same shape Capacitor generates: a project-level block, then the App target's Debug/Release blocks.
const PBXPROJ = `/* Begin XCBuildConfiguration section */
\t\t504EC3141FED79650016851F /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tCODE_SIGN_IDENTITY = "iPhone Developer";
\t\t\t\tSDKROOT = iphoneos;
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\t504EC3171FED79650016851F /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (
\t\t\t\t\t"$(inherited)",
\t\t\t\t\t"@executable_path/Frameworks",
\t\t\t\t);
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = chat.jarvis.app;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\t504EC3181FED79650016851F /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = chat.jarvis.app;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t};
\t\t\tname = Release;
\t\t};
/* End XCBuildConfiguration section */
`;

test("patches only the App target blocks and leaves the rest alone", () => {
  const out = applyIosSigning(PBXPROJ, options);
  assert.equal(out.split("CODE_SIGN_STYLE = Manual;").length - 1, 2, "Debug and Release of the App target");
  assert.equal(out.split("CODE_SIGN_STYLE = Automatic;").length - 1, 0);
  assert.equal(out.split("DEVELOPMENT_TEAM = ABCDE12345;").length - 1, 2);
  assert.equal(out.split('PROVISIONING_PROFILE_SPECIFIER = "Jarvis App Store (2026)";').length - 1, 2);
  assert.equal(out.split("MARKETING_VERSION = 0.56.0;").length - 1, 2);
  assert.equal(out.split("CURRENT_PROJECT_VERSION = 2611211530;").length - 1, 2);
  // The project-level block (no bundle id) keeps its own identity and gets no profile.
  assert.match(out, /CODE_SIGN_IDENTITY = "iPhone Developer";/);
  assert.equal(out.split("CODE_SIGN_IDENTITY = ").length - 1, 3, "project block + 2 App blocks");
  // Multi-line values survive untouched.
  assert.match(out, /LD_RUNPATH_SEARCH_PATHS = \(\n\t\t\t\t\t"\$\(inherited\)",/);
});

test("is idempotent", () => {
  const once = applyIosSigning(PBXPROJ, options);
  assert.equal(applyIosSigning(once, options), once);
});

test("fails loudly when the project has no block for the bundle id", () => {
  assert.throws(() => applyIosSigning(PBXPROJ, { ...options, bundleId: "other.app" }), /changed shape/);
});

test("rejects values that could break out of the pbxproj or plist", () => {
  for (const profileName of ['a"b', "a\\b", "a\nb", "a<b", "a&b", " "]) {
    assert.throws(() => applyIosSigning(PBXPROJ, { ...options, profileName }), /unsupported characters/);
    assert.throws(() => exportOptionsPlist({ ...options, profileName }), /unsupported characters/);
  }
});

test("export options map the bundle id to the profile for an App Store ipa", () => {
  const plist = exportOptionsPlist(options);
  assert.match(plist, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(plist, /<key>teamID<\/key>\s*<string>ABCDE12345<\/string>/);
  assert.match(plist, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
  assert.match(plist, /<key>chat\.jarvis\.app<\/key>\s*<string>Jarvis App Store \(2026\)<\/string>/);
});
