import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyContextNative,
  ContextNativeTransformError,
  verifyMergedAndroidManifest,
} from "./apply-context-native.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, "plugins", "jarvis-context");

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "jarvis-context-native-"));
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function read(path) {
  return readFileSync(path, "utf8");
}

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

function createAndroidFixture(mobileDir) {
  write(join(mobileDir, "android", "settings.gradle"), `include ':app'
include ':capacitor-android'
apply from: 'capacitor.settings.gradle'
`);
  write(join(mobileDir, "android", "capacitor.settings.gradle"), `include ':jarvis-context'
project(':jarvis-context').projectDir = new File('../plugins/jarvis-context/android')
`);
  write(join(mobileDir, "android", "app", "build.gradle"), `apply plugin: 'com.android.application'

android {
    namespace = "chat.jarvis.fixture"
    buildFeatures {
        buildConfig true
    }
}

dependencies {
    implementation project(':capacitor-android')
}

apply from: 'capacitor.build.gradle'
`);
  write(join(mobileDir, "android", "app", "capacitor.build.gradle"), `dependencies {
    implementation project(':jarvis-context')
}
`);
  write(join(mobileDir, "android", "app", "src", "main", "AndroidManifest.xml"), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="Jarvis">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`);
  write(join(mobileDir, "android", "app", "src", "main", "java", "chat", "jarvis", "fixture", "MainActivity.java"), `package chat.jarvis.fixture;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ExistingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);
}

const packageSwiftFixture = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [.library(name: "CapApp-SPM", targets: ["CapApp-SPM"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ]
        )
    ]
)
`;

const infoPlistFixture = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Jarvis</string>
</dict>
</plist>
`;

const storyboardFixture = `<?xml version="1.0" encoding="UTF-8"?>
<document>
    <scenes>
        <scene>
            <objects>
                <viewController id="bridge" customClass="CAPBridgeViewController" customModule="Capacitor" sceneMemberID="viewController"/>
            </objects>
        </scene>
    </scenes>
</document>
`;

const pbxFixture = `// !$*UTF8*$!
{
    objects = {
        AAAAAAAAAAAAAAAAAAAAAAAA /* App */ = {
            isa = PBXNativeTarget;
            name = App;
        };
        BBBBBBBBBBBBBBBBBBBBBBBB /* Project object */ = {
            isa = PBXProject;
            attributes = {
                TargetAttributes = {
                    AAAAAAAAAAAAAAAAAAAAAAAA = {
                        ProvisioningStyle = Automatic;
                    };
                };
            };
        };
    };
}
`;

function createIosFixture(mobileDir, packageManager = "spm") {
  const app = join(mobileDir, "ios", "App");
  if (packageManager === "spm") {
    write(join(app, "CapApp-SPM", "Package.swift"), packageSwiftFixture);
  } else {
    write(join(app, "Podfile"), `platform :ios, '15.0'

def capacitor_pods
  pod 'Capacitor', :path => '../../node_modules/@capacitor/ios'
end

target 'App' do
  capacitor_pods
  # Add your Pods here
end
`);
  }
  write(join(app, "App", "Info.plist"), infoPlistFixture);
  write(join(app, "App", "capacitor.config.json"), JSON.stringify({
    packageClassList: ["JarvisContextPlugin"],
  }, null, 2));
  write(join(app, "App", "Base.lproj", "Main.storyboard"), storyboardFixture);
  write(join(app, "App.xcodeproj", "project.pbxproj"), pbxFixture);
}

test("Android transform links the plugin, isolates background permission, and is idempotent", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createAndroidFixture(mobileDir);
    const legacySettings = join(mobileDir, "android", "settings.gradle");
    write(legacySettings, `${read(legacySettings)}// jarvis-context:start
include ':jarvis-context'
project(':jarvis-context').projectDir = new File(rootProject.projectDir, '../plugins/jarvis-context/android')
// jarvis-context:end
`);
    const legacyGradle = join(mobileDir, "android", "app", "build.gradle");
    write(legacyGradle, read(legacyGradle).replace(
      "    implementation project(':capacitor-android')",
      "    implementation project(':capacitor-android')\n    // jarvis-context\n    implementation project(':jarvis-context')",
    ));
    write(join(mobileDir, "android", "app", "src", "store", "AndroidManifest.xml"), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-feature android:name="fixture.store.preserved" />
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <application>
        <receiver android:name="chat.jarvis.context.JarvisContextBootReceiver" android:exported="true">
            <intent-filter><action android:name="fixture.old.action" /></intent-filter>
        </receiver>
        <receiver android:name=".PreservedReceiver" />
    </application>
</manifest>
`);
    write(join(mobileDir, "android", "app", "src", "sideload", "AndroidManifest.xml"), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-feature android:name="fixture.sideload.preserved" />
    <application>
        <receiver android:name="chat.jarvis.context.JarvisContextBootReceiver" android:exported="false" />
    </application>
</manifest>
`);
    const pluginBefore = read(join(pluginDir, "android", "src", "main", "AndroidManifest.xml"));
    const first = applyContextNative({ mobileDir, pluginDir, platform: "android" });
    assert.ok(first.changedFiles.length >= 6);

    const settings = read(join(mobileDir, "android", "settings.gradle"));
    const capacitorSettings = read(join(mobileDir, "android", "capacitor.settings.gradle"));
    const gradle = read(join(mobileDir, "android", "app", "build.gradle"));
    const capacitorGradle = read(join(mobileDir, "android", "app", "capacitor.build.gradle"));
    const manifest = read(join(mobileDir, "android", "app", "src", "main", "AndroidManifest.xml"));
    const activity = read(join(mobileDir, "android", "app", "src", "main", "java", "chat", "jarvis", "fixture", "MainActivity.java"));
    const store = read(join(mobileDir, "android", "app", "src", "store", "AndroidManifest.xml"));
    const sideload = read(join(mobileDir, "android", "app", "src", "sideload", "AndroidManifest.xml"));
    const fullBackup = read(join(
      mobileDir,
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "jarvis_context_backup_rules.xml",
    ));
    const dataExtraction = read(join(
      mobileDir,
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "jarvis_context_data_extraction_rules.xml",
    ));

    assert.equal(occurrences(settings, "project(':jarvis-context')"), 0);
    assert.equal(occurrences(capacitorSettings, "project(':jarvis-context')"), 1);
    assert.equal(occurrences(gradle, "jarvis-context:flavors:start"), 1);
    assert.equal(occurrences(gradle, "implementation project(':jarvis-context')"), 0);
    assert.equal(occurrences(capacitorGradle, "implementation project(':jarvis-context')"), 1);
    assert.match(gradle, /\bstore\s*\{/);
    assert.match(gradle, /\bsideload\s*\{/);
    assert.match(manifest, /android\.permission\.READ_CALENDAR/);
    assert.match(manifest, /android\.permission\.ACCESS_COARSE_LOCATION/);
    assert.match(manifest, /android\.permission\.ACCESS_FINE_LOCATION/);
    assert.doesNotMatch(manifest, /WRITE_CALENDAR|ACCESS_BACKGROUND_LOCATION/);
    assert.ok(manifest.lastIndexOf("<uses-permission") < manifest.indexOf("<application"));
    assert.match(manifest, /android:fullBackupContent="@xml\/jarvis_context_backup_rules"/);
    assert.match(manifest, /android:dataExtractionRules="@xml\/jarvis_context_data_extraction_rules"/);
    assert.match(activity, /registerPlugin\(ExistingPlugin\.class\)/);
    assert.doesNotMatch(activity, /JarvisContextPlugin/);
    assert.match(store, /ACCESS_BACKGROUND_LOCATION[\s\S]*tools:node="remove"/);
    assert.match(store, /RECEIVE_BOOT_COMPLETED[\s\S]*tools:node="remove"/);
    assert.ok(store.lastIndexOf("<uses-permission") < store.indexOf("<application"));
    assert.match(store, /fixture\.store\.preserved/);
    assert.match(store, /\.PreservedReceiver/);
    assert.equal(occurrences(store, "JarvisContextBootReceiver"), 1);
    assert.match(sideload, /ACCESS_BACKGROUND_LOCATION/);
    assert.match(sideload, /android\.intent\.action\.BOOT_COMPLETED/);
    assert.match(sideload, /android\.intent\.action\.MY_PACKAGE_REPLACED/);
    assert.ok(sideload.lastIndexOf("<uses-permission") < sideload.indexOf("<application"));
    assert.match(sideload, /fixture\.sideload\.preserved/);
    assert.match(sideload, /android:exported="true"/);
    assert.doesNotMatch(sideload, /tools:node=["']remove["']/);
    assert.equal(occurrences(sideload, "JarvisContextBootReceiver"), 1);
    assert.match(fullBackup, /domain="sharedpref" path="jarvis_context\.xml"/);
    assert.match(dataExtraction, /<cloud-backup>[\s\S]*jarvis_context\.xml[\s\S]*<device-transfer>/);
    assert.match(dataExtraction, /<cloud-backup>\r?\n\s+<exclude/);
    assert.match(dataExtraction, /<device-transfer>\r?\n\s+<exclude/);
    assert.equal(read(join(pluginDir, "android", "src", "main", "AndroidManifest.xml")), pluginBefore);

    const snapshots = [settings, gradle, manifest, activity, store, sideload, fullBackup, dataExtraction];
    const second = applyContextNative({ mobileDir, pluginDir, platform: "android" });
    assert.deepEqual(second.changedFiles, []);
    assert.deepEqual([
      read(join(mobileDir, "android", "settings.gradle")),
      read(join(mobileDir, "android", "app", "build.gradle")),
      read(join(mobileDir, "android", "app", "src", "main", "AndroidManifest.xml")),
      read(join(mobileDir, "android", "app", "src", "main", "java", "chat", "jarvis", "fixture", "MainActivity.java")),
      read(join(mobileDir, "android", "app", "src", "store", "AndroidManifest.xml")),
      read(join(mobileDir, "android", "app", "src", "sideload", "AndroidManifest.xml")),
      read(join(mobileDir, "android", "app", "src", "main", "res", "xml", "jarvis_context_backup_rules.xml")),
      read(join(mobileDir, "android", "app", "src", "main", "res", "xml", "jarvis_context_data_extraction_rules.xml")),
    ], snapshots);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Android transform removes legacy manual registration from Kotlin MainActivity", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createAndroidFixture(mobileDir);
    const javaActivity = join(
      mobileDir,
      "android",
      "app",
      "src",
      "main",
      "java",
      "chat",
      "jarvis",
      "fixture",
      "MainActivity.java",
    );
    rmSync(javaActivity);
    const kotlinActivity = javaActivity.replace(/\.java$/, ".kt");
    write(kotlinActivity, `package chat.jarvis.fixture

import android.os.Bundle
import chat.jarvis.context.JarvisContextPlugin
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(
            JarvisContextPlugin::class.java
        )
        super.onCreate(savedInstanceState)
    }
}
`);

    applyContextNative({ mobileDir, pluginDir, platform: "android" });
    const transformed = read(kotlinActivity);
    assert.match(transformed, /import android\.os\.Bundle/);
    assert.doesNotMatch(transformed, /import chat\.jarvis\.context\.JarvisContextPlugin/);
    assert.match(transformed, /class MainActivity : BridgeActivity\(\) \{/);
    assert.doesNotMatch(transformed, /registerPlugin\s*\([\s\S]*?JarvisContextPlugin/);
    assert.deepEqual(
      applyContextNative({ mobileDir, pluginDir, platform: "android" }).changedFiles,
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Android manifest transform handles single quotes, paired tags, and conflicting tools:node", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createAndroidFixture(mobileDir);
    write(join(mobileDir, "android", "app", "src", "main", "AndroidManifest.xml"), `<?xml version='1.0'?>
<manifest xmlns:android='http://schemas.android.com/apk/res/android' xmlns:tools='http://schemas.android.com/tools'>
  <uses-permission android:name='android.permission.ACCESS_BACKGROUND_LOCATION'></uses-permission>
  <uses-permission android:name='android.permission.ACCESS_FINE_LOCATION' tools:node='remove'></uses-permission>
  <application android:label='Jarvis'/>
</manifest>
`);
    write(join(mobileDir, "android", "app", "src", "store", "AndroidManifest.xml"), `<?xml version='1.0'?>
<manifest xmlns:android='http://schemas.android.com/apk/res/android' xmlns:tools='http://schemas.android.com/tools'>
  <uses-permission android:name='android.permission.ACCESS_BACKGROUND_LOCATION' tools:node='merge'></uses-permission>
  <uses-permission android:name='android.permission.RECEIVE_BOOT_COMPLETED'></uses-permission>
  <application><receiver android:name='chat.jarvis.context.JarvisContextBootReceiver' tools:node='merge'></receiver></application>
</manifest>
`);
    write(join(mobileDir, "android", "app", "src", "sideload", "AndroidManifest.xml"), `<?xml version='1.0'?>
<manifest xmlns:android='http://schemas.android.com/apk/res/android' xmlns:tools='http://schemas.android.com/tools'>
  <uses-permission android:name='android.permission.ACCESS_BACKGROUND_LOCATION' tools:node='remove'></uses-permission>
  <application><receiver android:name='chat.jarvis.context.JarvisContextBootReceiver' tools:node='remove'></receiver></application>
</manifest>
`);

    applyContextNative({ mobileDir, pluginDir, platform: "android" });
    const main = read(join(mobileDir, "android", "app", "src", "main", "AndroidManifest.xml"));
    const store = read(join(mobileDir, "android", "app", "src", "store", "AndroidManifest.xml"));
    const sideload = read(join(mobileDir, "android", "app", "src", "sideload", "AndroidManifest.xml"));

    assert.doesNotMatch(main, /ACCESS_BACKGROUND_LOCATION/);
    assert.match(main, /ACCESS_FINE_LOCATION/);
    assert.doesNotMatch(main, /ACCESS_FINE_LOCATION[^>]*tools:node=["']remove["']/);
    assert.equal(occurrences(main, "<application"), 1);
    assert.equal(occurrences(store, "xmlns:tools"), 1);
    assert.match(store, /ACCESS_BACKGROUND_LOCATION[^>]*tools:node="remove"/);
    assert.match(store, /RECEIVE_BOOT_COMPLETED[^>]*tools:node="remove"/);
    assert.match(store, /JarvisContextBootReceiver[\s\S]*tools:node="remove"/);
    assert.doesNotMatch(sideload, /tools:node=["']remove["']/);
    assert.equal(occurrences(sideload, "JarvisContextBootReceiver"), 1);
    assert.deepEqual(applyContextNative({ mobileDir, pluginDir, platform: "android" }).changedFiles, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Android manifest transform ignores fake permissions and receivers inside XML comments", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createAndroidFixture(mobileDir);
    write(join(mobileDir, "android", "app", "src", "main", "AndroidManifest.xml"), `<?xml version="1.0"?>
<!DOCTYPE manifest [<!ENTITY harmless "value > still declaration">]>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <!-- <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" /> -->
  <application android:label="Jarvis" />
</manifest>
`);
    for (const flavor of ["store", "sideload"]) {
      write(join(mobileDir, "android", "app", "src", flavor, "AndroidManifest.xml"), `<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <!-- <receiver android:name="chat.jarvis.context.JarvisContextBootReceiver" tools:node="remove" /> -->
  <application />
</manifest>
`);
    }

    applyContextNative({ mobileDir, pluginDir, platform: "android" });
    const main = read(join(mobileDir, "android", "app", "src", "main", "AndroidManifest.xml"));
    const store = read(join(mobileDir, "android", "app", "src", "store", "AndroidManifest.xml"));
    const sideload = read(join(mobileDir, "android", "app", "src", "sideload", "AndroidManifest.xml"));

    assert.equal(occurrences(main, "android.permission.ACCESS_FINE_LOCATION"), 2);
    assert.equal(occurrences(store, "JarvisContextBootReceiver"), 2);
    assert.match(store, /JarvisContextBootReceiver"\s+tools:node="remove"/);
    assert.equal(occurrences(sideload, "JarvisContextBootReceiver"), 2);
    assert.match(sideload, /JarvisContextBootReceiver"[\s\S]*android:exported="true"/);
    assert.deepEqual(applyContextNative({ mobileDir, pluginDir, platform: "android" }).changedFiles, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Android transform extends existing backup resources without dropping host rules", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createAndroidFixture(mobileDir);
    const manifestPath = join(mobileDir, "android", "app", "src", "main", "AndroidManifest.xml");
    write(manifestPath, read(manifestPath).replace(
      '<application android:label="Jarvis">',
      '<application android:label="Jarvis" android:fullBackupContent="@xml/host_backup" android:dataExtractionRules="@xml/host_extraction">',
    ));
    write(join(mobileDir, "android", "app", "src", "main", "res", "xml", "host_backup.xml"), `<?xml version="1.0"?>
<full-backup-content><include domain="file" path="documents" /></full-backup-content>
`);
    write(join(mobileDir, "android", "app", "src", "main", "res", "xml", "host_extraction.xml"), `<?xml version="1.0"?>
<data-extraction-rules>
  <cloud-backup><include domain="file" path="documents" /></cloud-backup>
  <device-transfer><include domain="file" path="documents" /></device-transfer>
</data-extraction-rules>
`);

    applyContextNative({ mobileDir, pluginDir, platform: "android" });
    const backup = read(join(mobileDir, "android", "app", "src", "main", "res", "xml", "host_backup.xml"));
    const extraction = read(join(mobileDir, "android", "app", "src", "main", "res", "xml", "host_extraction.xml"));
    assert.match(backup, /include domain="file" path="documents"/);
    assert.match(backup, /exclude domain="sharedpref" path="jarvis_context\.xml"/);
    assert.equal(occurrences(extraction, 'include domain="file" path="documents"'), 2);
    assert.equal(occurrences(extraction, 'exclude domain="sharedpref" path="jarvis_context.xml"'), 2);
    assert.doesNotMatch(read(manifestPath), /jarvis_context_(?:backup|data_extraction)_rules/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Android transform preserves explicitly disabled backup without creating insecure fallbacks", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createAndroidFixture(mobileDir);
    const manifestPath = join(mobileDir, "android", "app", "src", "main", "AndroidManifest.xml");
    write(manifestPath, read(manifestPath).replace(
      '<application android:label="Jarvis">',
      '<application android:label="Jarvis" android:allowBackup="false" android:fullBackupContent="false" android:dataExtractionRules="false">',
    ));

    applyContextNative({ mobileDir, pluginDir, platform: "android" });
    const transformed = read(manifestPath);
    assert.match(transformed, /android:allowBackup="false"/);
    assert.match(transformed, /android:fullBackupContent="false"/);
    assert.match(transformed, /android:dataExtractionRules="false"/);
    assert.equal(existsSync(join(
      mobileDir,
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "jarvis_context_backup_rules.xml",
    )), false);
    assert.deepEqual(applyContextNative({ mobileDir, pluginDir, platform: "android" }).changedFiles, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("merged Android manifest verifier enforces store and sideload isolation", () => {
  const store = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:fullBackupContent="@xml/backup_rules" android:dataExtractionRules="@xml/extraction_rules" />
  </manifest>`;
  const sideload = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <application android:fullBackupContent="@xml/backup_rules" android:dataExtractionRules="@xml/extraction_rules">
      <receiver android:name="chat.jarvis.context.JarvisContextBootReceiver" android:enabled="true" android:exported="true">
        <intent-filter>
          <action android:name="android.intent.action.BOOT_COMPLETED" />
          <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
        </intent-filter>
      </receiver>
    </application>
  </manifest>`;
  assert.equal(verifyMergedAndroidManifest(store, "store"), true);
  assert.equal(verifyMergedAndroidManifest(sideload, "sideload"), true);
  assert.throws(() => verifyMergedAndroidManifest(sideload, "store"), /store manifest contains/);
  assert.throws(() => verifyMergedAndroidManifest(store, "sideload"), /sideload manifest is missing/);
  assert.throws(
    () => verifyMergedAndroidManifest(
      sideload.replace('<action android:name="android.intent.action.MY_PACKAGE_REPLACED" />', ""),
      "sideload",
    ),
    /boot receiver is not operational/,
  );
  assert.throws(
    () => verifyMergedAndroidManifest(sideload.replace('android:exported="true"', 'android:exported="false"'), "sideload"),
    /boot receiver is not operational/,
  );
  assert.throws(
    () => verifyMergedAndroidManifest(store.replace(" android:dataExtractionRules=\"@xml/extraction_rules\"", ""), "store"),
    /defensive backup configuration/,
  );
});

test("iOS SPM transform uses Capacitor discovery without implicit background mode", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createIosFixture(mobileDir, "spm");
    const first = applyContextNative({ mobileDir, pluginDir, platform: "ios" });
    assert.equal(first.changedFiles.length, 2);

    const packageSwift = read(join(mobileDir, "ios", "App", "CapApp-SPM", "Package.swift"));
    const plist = read(join(mobileDir, "ios", "App", "App", "Info.plist"));
    const storyboard = read(join(mobileDir, "ios", "App", "App", "Base.lproj", "Main.storyboard"));
    const pbx = read(join(mobileDir, "ios", "App", "App.xcodeproj", "project.pbxproj"));

    assert.equal(occurrences(packageSwift, '.package(name: "JarvisContext"'), 1);
    assert.equal(occurrences(packageSwift, '.product(name: "JarvisContext"'), 1);
    assert.match(plist, /NSLocationWhenInUseUsageDescription/);
    assert.match(plist, /NSLocationAlwaysAndWhenInUseUsageDescription/);
    assert.match(plist, /NSCalendarsFullAccessUsageDescription/);
    assert.match(plist, /NSCalendarsUsageDescription/);
    assert.doesNotMatch(plist, /UIBackgroundModes|<string>location<\/string>/);
    assert.match(storyboard, /customClass="CAPBridgeViewController" customModule="Capacitor"/);
    assert.doesNotMatch(storyboard, /JarvisContextBridgeViewController/);
    assert.doesNotMatch(pbx, /com\.apple\.BackgroundModes/);

    const snapshots = [packageSwift, plist, storyboard, pbx];
    const second = applyContextNative({ mobileDir, pluginDir, platform: "ios" });
    assert.deepEqual(second.changedFiles, []);
    assert.deepEqual([
      read(join(mobileDir, "ios", "App", "CapApp-SPM", "Package.swift")),
      read(join(mobileDir, "ios", "App", "App", "Info.plist")),
      read(join(mobileDir, "ios", "App", "App", "Base.lproj", "Main.storyboard")),
      read(join(mobileDir, "ios", "App", "App.xcodeproj", "project.pbxproj")),
    ], snapshots);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("iOS transform removes the legacy bridge subclass and normalizes Windows SPM paths", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createIosFixture(mobileDir, "spm");
    applyContextNative({ mobileDir, pluginDir, platform: "ios" });
    const packagePath = join(mobileDir, "ios", "App", "CapApp-SPM", "Package.swift");
    const storyboardPath = join(mobileDir, "ios", "App", "App", "Base.lproj", "Main.storyboard");
    write(packagePath, read(packagePath).replace(
      /\.package\(name: "JarvisContext", path: "[^"]+"\)/,
      '.package(name: "JarvisContext", path: "..\\..\\..\\plugins\\jarvis-context")',
    ));
    write(storyboardPath, read(storyboardPath).replace(
      'customClass="CAPBridgeViewController" customModule="Capacitor"',
      'customClass="JarvisContextBridgeViewController" customModule="JarvisContext"',
    ));

    applyContextNative({ mobileDir, pluginDir, platform: "ios" });
    const transformedPackage = read(packagePath);
    const transformedStoryboard = read(storyboardPath);
    assert.match(transformedPackage, /\.package\(name: "JarvisContext", path: "[^"]+\/plugins\/jarvis-context"\)/);
    assert.doesNotMatch(transformedPackage, /plugins\\jarvis-context/);
    assert.match(transformedStoryboard, /customClass="CAPBridgeViewController" customModule="Capacitor"/);
    assert.doesNotMatch(transformedStoryboard, /JarvisContextBridgeViewController/);
    assert.deepEqual(applyContextNative({ mobileDir, pluginDir, platform: "ios" }).changedFiles, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("iOS explicit background-mode opt-in preserves existing capabilities", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createIosFixture(mobileDir, "spm");
    const project = join(mobileDir, "ios", "App", "App.xcodeproj", "project.pbxproj");
    write(project, pbxFixture.replace(
      "ProvisioningStyle = Automatic;",
      `ProvisioningStyle = Automatic;
                        SystemCapabilities = {
                            com.apple.BackgroundModes = {
                                enabled = 0;
                            };
                            com.apple.Push = {
                                enabled = 1;
                            };
                        };`,
    ));

    applyContextNative({ mobileDir, pluginDir, platform: "ios", iosBackgroundMode: true });
    const transformed = read(project);
    const plist = read(join(mobileDir, "ios", "App", "App", "Info.plist"));
    assert.equal(occurrences(transformed, "com.apple.BackgroundModes"), 1);
    assert.match(transformed, /com\.apple\.BackgroundModes\s*=\s*\{\s*enabled = 1;/);
    assert.match(transformed, /com\.apple\.Push\s*=\s*\{\s*enabled = 1;/);
    assert.match(plist, /UIBackgroundModes[\s\S]*<string>location<\/string>/);
    assert.deepEqual(
      applyContextNative({ mobileDir, pluginDir, platform: "ios", iosBackgroundMode: true }).changedFiles,
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("iOS default transform disables a stale unconditional location background capability", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createIosFixture(mobileDir, "spm");
    const plist = join(mobileDir, "ios", "App", "App", "Info.plist");
    const project = join(mobileDir, "ios", "App", "App.xcodeproj", "project.pbxproj");
    write(plist, infoPlistFixture.replace(
      "</dict>",
      "\t<key>UIBackgroundModes</key>\n\t<array><string>location</string></array>\n</dict>",
    ));
    write(project, pbxFixture.replace(
      "ProvisioningStyle = Automatic;",
      `ProvisioningStyle = Automatic;
                        SystemCapabilities = {
                            com.apple.BackgroundModes = {
                                enabled = 1;
                            };
                        };`,
    ));

    applyContextNative({ mobileDir, pluginDir, platform: "ios" });
    assert.doesNotMatch(read(plist), /UIBackgroundModes|<string>location<\/string>/);
    assert.match(read(project), /com\.apple\.BackgroundModes\s*=\s*\{\s*enabled = 0;/);
    assert.deepEqual(applyContextNative({ mobileDir, pluginDir, platform: "ios" }).changedFiles, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("iOS CocoaPods transform adds the local pod without requiring Xcode or CocoaPods", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createIosFixture(mobileDir, "pods");
    applyContextNative({ mobileDir, pluginDir, platform: "ios" });
    const podfile = read(join(mobileDir, "ios", "App", "Podfile"));
    assert.equal(occurrences(podfile, "pod 'JarvisContext'"), 1);
    assert.match(podfile, /target 'App' do[\s\S]*pod 'JarvisContext'[\s\S]*capacitor_pods/);
    assert.deepEqual(
      applyContextNative({ mobileDir, pluginDir, platform: "ios" }).changedFiles,
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("iOS transform rejects an ambiguous tree with both SPM and CocoaPods entrypoints", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createIosFixture(mobileDir, "spm");
    const plist = join(mobileDir, "ios", "App", "App", "Info.plist");
    const before = read(plist);
    write(join(mobileDir, "ios", "App", "Podfile"), "target 'App' do\nend\n");

    assert.throws(
      () => applyContextNative({ mobileDir, pluginDir, platform: "ios" }),
      /ambiguous generated iOS tree contains both SwiftPM and CocoaPods/,
    );
    assert.equal(read(plist), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated mode transforms every present platform without requiring the absent one", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createAndroidFixture(mobileDir);
    const result = applyContextNative({ mobileDir, pluginDir, platform: "generated" });
    assert.equal(result.platform, "generated");
    assert.match(read(join(mobileDir, "android", "app", "build.gradle")), /jarvis-context:flavors:start/);
    assert.deepEqual(
      applyContextNative({ mobileDir, pluginDir, platform: "generated" }).changedFiles,
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("all-platform preflight reports a missing generated tree before modifying the present tree", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createAndroidFixture(mobileDir);
    const settingsPath = join(mobileDir, "android", "settings.gradle");
    const before = read(settingsPath);
    assert.throws(
      () => applyContextNative({ mobileDir, pluginDir, platform: "all" }),
      (error) => error instanceof ContextNativeTransformError && /generated iOS tree/.test(error.message),
    );
    assert.equal(read(settingsPath), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("all-platform transform stages changes until every insertion anchor is valid", () => {
  const root = fixtureRoot();
  const mobileDir = join(root, "mobile");
  try {
    createAndroidFixture(mobileDir);
    createIosFixture(mobileDir, "spm");
    const settingsPath = join(mobileDir, "android", "settings.gradle");
    const storyboardPath = join(mobileDir, "ios", "App", "App", "Base.lproj", "Main.storyboard");
    const before = read(settingsPath);
    write(storyboardPath, storyboardFixture.replace("CAPBridgeViewController", "ExistingBridgeViewController"));

    assert.throws(
      () => applyContextNative({ mobileDir, pluginDir, platform: "all" }),
      (error) => error instanceof ContextNativeTransformError && /custom bridge controller/.test(error.message),
    );
    assert.equal(read(settingsPath), before);
    assert.equal(
      existsSync(join(mobileDir, "android", "app", "src", "store", "AndroidManifest.xml")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("platform-specific invocation fails with a diagnostic when generated files are absent", () => {
  const root = fixtureRoot();
  try {
    const mobileDir = join(root, "mobile");
    mkdirSync(mobileDir, { recursive: true });
    assert.throws(
      () => applyContextNative({ mobileDir, pluginDir, platform: "android" }),
      (error) => error instanceof ContextNativeTransformError &&
        error.message.startsWith("[context-native]") &&
        /npx cap add android/.test(error.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("native source privacy boundaries exclude write access, calendar details, and queued coordinates", () => {
  const definitions = read(join(pluginDir, "definitions.ts"));
  const androidManifest = read(join(pluginDir, "android", "src", "main", "AndroidManifest.xml"));
  const androidPlugin = read(join(
    pluginDir,
    "android",
    "src",
    "main",
    "java",
    "chat",
    "jarvis",
    "context",
    "JarvisContextPlugin.kt",
  ));
  const uploader = read(join(
    pluginDir,
    "android",
    "src",
    "main",
    "java",
    "chat",
    "jarvis",
    "context",
    "JarvisContextTransitionUploader.kt",
  ));
  const coordinator = read(join(
    pluginDir,
    "android",
    "src",
    "main",
    "java",
    "chat",
    "jarvis",
    "context",
    "JarvisContextGeofenceCoordinator.kt",
  ));
  const geofenceReceiver = read(join(
    pluginDir,
    "android",
    "src",
    "main",
    "java",
    "chat",
    "jarvis",
    "context",
    "JarvisContextGeofenceReceiver.kt",
  ));
  const iosPlugin = read(join(pluginDir, "ios", "Sources", "JarvisContext", "JarvisContextPlugin.swift"));
  const iosModels = read(join(pluginDir, "ios", "Sources", "JarvisContext", "JarvisContextModels.swift"));
  const androidStore = read(join(
    pluginDir,
    "android",
    "src",
    "main",
    "java",
    "chat",
    "jarvis",
    "context",
    "JarvisContextStore.kt",
  ));
  const iosStore = read(join(pluginDir, "ios", "Sources", "JarvisContext", "JarvisContextStore.swift"));
  const privacyManifest = read(join(
    pluginDir,
    "ios",
    "Sources",
    "JarvisContext",
    "PrivacyInfo.xcprivacy",
  ));
  const swiftPackage = read(join(pluginDir, "Package.swift"));
  const podspec = read(join(pluginDir, "JarvisContext.podspec"));

  assert.match(androidManifest, /android\.permission\.READ_CALENDAR/);
  assert.doesNotMatch(androidManifest, /WRITE_CALENDAR|ACCESS_BACKGROUND_LOCATION/);
  assert.doesNotMatch(androidPlugin, /Instances\.(?:TITLE|DESCRIPTION|EVENT_LOCATION|ORGANIZER)/);
  assert.doesNotMatch(iosPlugin, /event\.(?:title|attendees|location|notes|url)\b/);
  assert.doesNotMatch(uploader, /put(?:Double|Float)|["'](?:lat|lng|latitude|longitude)["']/i);
  assert.doesNotMatch(uploader, /triggeringLocation/);
  assert.doesNotMatch(uploader, /KEY_(?:PRINCIPAL_ID|DEVICE_ID)|scope\.principalId|scope\.deviceId/);
  assert.match(uploader, /!enqueue\.inserted && enqueue\.pending == 0[\s\S]*Result\.success\(\)/);
  assert.match(uploader, /configurationGeneration[\s\S]*expectedGeneration = input\.configurationGeneration/);
  assert.match(uploader, /KEY_SCOPE_IDENTITY[\s\S]*jarvisContextScopeIdentity/);
  assert.match(uploader, /cancelAllWorkByTag\(TRANSITION_WORK_TAG\)/);
  assert.match(androidStore, /noBackupFilesDir/);
  assert.doesNotMatch(androidStore, /fun\s+drainTransitions\s*\(/);
  assert.doesNotMatch(androidStore, /drop\(count\)|transitions\.removeFirst/);
  assert.match(androidStore, /fun leaseTransitions[\s\S]*leaseTransitionBatch/);
  assert.match(androidStore, /fun acknowledgeTransitions[\s\S]*acknowledgeTransitionBatch/);
  assert.match(androidStore, /scopeChanged[\s\S]*transitions = if \(scopeChanged\) emptyList\(\)/);
  assert.match(androidStore, /fun eraseAll[\s\S]*atomicFile\.delete\(\)/);
  assert.match(androidStore, /writeState\(State\(scope = expectedScope\)\)/);
  assert.match(androidStore, /migrationError = runCatching \{ migrateLegacyState\(\) \}\.exceptionOrNull\(\)/);
  assert.match(androidStore, /canonicalizeTransitions/);
  assert.match(androidStore, /deleteSharedPreferences\(LEGACY_PREFERENCES\)/);
  assert.match(coordinator, /newSingleThreadExecutor/);
  assert.match(coordinator, /eraseAllBlocking[\s\S]*JarvisContextStore\(context, migrateLegacy = false\)[\s\S]*store\.eraseAll\(scope\)[\s\S]*cancelAllBlocking/);
  const androidErase = /private fun eraseAllBlocking[\s\S]*?(?=\n    private fun reconcileSerialized)/.exec(coordinator)?.[0] ?? "";
  assert.doesNotMatch(androidErase, /finePermissionGranted|backgroundPermissionGranted|requireRegistrationAvailable/);
  assert.match(coordinator, /configured\.isEmpty\(\)[\s\S]*commitGeofenceReplacement/);
  assert.match(coordinator, /snapshot\(\)\.generation == desired\.generation/);
  assert.match(geofenceReceiver, /GEOFENCE_NOT_AVAILABLE[\s\S]*enqueue\(context, replace = true\)/);
  assert.match(iosStore, /applicationSupportDirectory/);
  assert.match(iosStore, /completeFileProtectionUntilFirstUserAuthentication/);
  assert.match(iosStore, /isExcludedFromBackup = true/);
  assert.match(iosStore, /replaceItemAt/);
  assert.match(iosStore, /canonicalizeTransitions/);
  assert.doesNotMatch(iosStore, /func\s+drainTransitions\s*\(|next\.transitions\.removeFirst/);
  assert.match(iosStore, /func leaseTransitions[\s\S]*leaseTransitionBatch/);
  assert.match(iosStore, /func acknowledgeTransitions[\s\S]*acknowledgeTransitionBatch/);
  assert.match(iosStore, /if scopeChanged \{[\s\S]*next\.transitions = \[\][\s\S]*next\.acknowledgements = \[\]/);
  assert.match(iosStore, /func eraseAll[\s\S]*removeItem\(at: directoryURL\)/);
  assert.match(iosStore, /tombstone\.scope = expectedScope[\s\S]*persist\(tombstone\)/);
  assert.match(iosStore, /return \(state\.transitions\.count, false, false\)/);
  assert.doesNotMatch(iosStore, /state\.transitions\.count\s*>=\s*jarvisContextMaximumTransitions/);
  assert.doesNotMatch(iosModels, /UUID\(\)/);
  assert.match(iosPlugin, /monitorSignificantChanges"\) \?\? false/);
  assert.match(iosPlugin, /didStartMonitoringFor[\s\S]*completeRegionPhase/);
  assert.match(iosPlugin, /beginRegionRollback[\s\S]*phase: \.rollingBack/);
  assert.match(iosPlugin, /contextStore\.eraseAll\(expectedScope: scope\)[\s\S]*stopManagedRegions\(\)/);
  const iosErase = /@objc func eraseAll[\s\S]*?(?=\n    \/\*\* Non-destructive)/.exec(iosPlugin)?.[0] ?? "";
  assert.doesNotMatch(iosErase, /authorizationStatus|authorizedAlways/);
  assert.match(iosPlugin, /CAPPluginMethod\(name: "leaseTransitions"[\s\S]*CAPPluginMethod\(name: "ackTransitions"[\s\S]*CAPPluginMethod\(name: "eraseAll"/);
  assert.match(definitions, /interface JarvisContextScope[\s\S]*principalId[\s\S]*deviceId[\s\S]*generation/);
  assert.match(androidPlugin, /data\.opt\("principalId"\) as\? String[\s\S]*data\.opt\("generation"\) as\? Number/);
  assert.match(definitions, /leaseTransitions[\s\S]*ackTransitions[\s\S]*eraseAll/);
  assert.match(privacyManifest, /NSPrivacyAccessedAPICategoryUserDefaults[\s\S]*CA92\.1/);
  assert.match(swiftPackage, /\.process\("PrivacyInfo\.xcprivacy"\)/);
  assert.match(podspec, /JarvisContextPrivacy[\s\S]*PrivacyInfo\.xcprivacy/);

  const iosTransition = /struct JarvisTransitionEnvelope[\s\S]*?\n}/.exec(iosModels)?.[0] ?? "";
  assert.match(iosTransition, /geofenceId/);
  assert.doesNotMatch(iosTransition, /\b(?:point|lat|lng|latitude|longitude)\b/i);
});

test("mobile package and dispatcher keep Capacitor iOS, CocoaPods, SPM, and privacy archive checks coherent", () => {
  const mobilePackage = JSON.parse(read(join(here, "package.json")));
  const dependencies = mobilePackage.dependencies;
  for (const dependency of ["@capacitor/core", "@capacitor/cli", "@capacitor/android", "@capacitor/ios"]) {
    assert.match(dependencies[dependency], /^\^8\./, `${dependency} must use the compatible Capacitor 8 range`);
  }
  assert.match(mobilePackage.scripts.sync, /apply-context-native\.mjs generated --install-pods-if-needed/);
  assert.match(mobilePackage.scripts["sync:ios"], /apply-context-native\.mjs ios --install-pods-if-needed/);

  const dispatcher = read(join(here, "..", "scripts", "build-mobile.mjs"));
  assert.match(dispatcher, /CapApp-SPM[\s\S]*-project/);
  assert.match(dispatcher, /App\.xcworkspace[\s\S]*-workspace/);
  assert.match(dispatcher, /Ambiguous iOS project contains both SPM and CocoaPods entrypoints/);
  assert.match(dispatcher, /packageManager === "CocoaPods"[\s\S]*"pod", \["install"\]/);
  assert.match(dispatcher, /PrivacyInfo\.xcprivacy/);
  assert.match(dispatcher, /run\("plutil", \["-lint", privacyManifest\]/);
  assert.match(dispatcher, /verifyArchivedPrivacyManifest\(archivePath\)/);
});
