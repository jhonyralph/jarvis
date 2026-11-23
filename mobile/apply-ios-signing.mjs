// CI-only iOS signing + versioning for the GENERATED Xcode project (mobile/ios is gitignored and
// recreated by `cap add ios`, so it has to be patched on every build).
//
// Why patch the project instead of passing build settings to xcodebuild: command-line settings apply
// to EVERY target of the workspace, including the CocoaPods targets, which reject a provisioning
// profile. Editing only the App target's own build settings keeps the Pods untouched.
//
// Pure functions + a small file wrapper so the transform is unit-tested without Xcode.
import { readFileSync, writeFileSync } from "node:fs";

// Values are written inside "..." in the pbxproj and inside <string> in a plist: refuse anything that
// could break out of either instead of trying to escape every case.
const SAFE_VALUE = /^[^"\\\r\n<>&]+$/;

function assertSafe(name, value) {
  if (typeof value !== "string" || !value.trim() || !SAFE_VALUE.test(value)) {
    throw new Error(`apply-ios-signing: ${name} is empty or has unsupported characters (" \\ < > & or a line break)`);
  }
}

/** Replace `KEY = ...;` inside one buildSettings body, or append it when absent. */
function setBuildSetting(body, key, value) {
  const line = `\t\t\t\t${key} = ${value};`;
  const existing = new RegExp(`^\\t\\t\\t\\t${key} = [^\\n]*;$`, "m");
  return existing.test(body) ? body.replace(existing, () => line) : `${body}\n${line}`;
}

/**
 * Switch the App target to manual signing with the given distribution profile and stamp the version.
 * Only buildSettings blocks that declare `PRODUCT_BUNDLE_IDENTIFIER = <bundleId>;` are touched.
 */
export function applyIosSigning(pbxproj, { bundleId, teamId, profileName, identity = "Apple Distribution", version, build }) {
  for (const [name, value] of Object.entries({ bundleId, teamId, profileName, identity, version, build })) assertSafe(name, value);
  let patched = 0;
  const out = pbxproj.replace(/(buildSettings = \{)([\s\S]*?)(\n\t\t\t\};)/g, (whole, open, body, close) => {
    if (!body.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${bundleId};`)) return whole;
    patched += 1;
    let next = body;
    next = setBuildSetting(next, "CODE_SIGN_STYLE", "Manual");
    next = setBuildSetting(next, "DEVELOPMENT_TEAM", teamId);
    next = setBuildSetting(next, "CODE_SIGN_IDENTITY", `"${identity}"`);
    next = setBuildSetting(next, "PROVISIONING_PROFILE_SPECIFIER", `"${profileName}"`);
    next = setBuildSetting(next, "MARKETING_VERSION", version);
    next = setBuildSetting(next, "CURRENT_PROJECT_VERSION", build);
    return `${open}${next}${close}`;
  });
  if (patched === 0) {
    throw new Error(`apply-ios-signing: no build settings declare PRODUCT_BUNDLE_IDENTIFIER = ${bundleId}; — the generated Xcode project changed shape`);
  }
  return out;
}

/** ExportOptions.plist for `xcodebuild -exportArchive` that produces an App Store Connect / TestFlight ipa. */
export function exportOptionsPlist({ bundleId, teamId, profileName, identity = "Apple Distribution" }) {
  for (const [name, value] of Object.entries({ bundleId, teamId, profileName, identity })) assertSafe(name, value);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>teamID</key>
	<string>${teamId}</string>
	<key>signingStyle</key>
	<string>manual</string>
	<key>signingCertificate</key>
	<string>${identity}</string>
	<key>provisioningProfiles</key>
	<dict>
		<key>${bundleId}</key>
		<string>${profileName}</string>
	</dict>
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
`;
}

/** File wrapper used by scripts/build-mobile.mjs. */
export function applyIosSigningToFile(path, options) {
  writeFileSync(path, applyIosSigning(readFileSync(path, "utf8"), options), "utf8");
}
