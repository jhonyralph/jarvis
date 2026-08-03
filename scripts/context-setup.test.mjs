import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_REPO_ROOT, parseEnvText } from "./context-doctor.mjs";
import { parseSetupArgs, runContextSetup, validateRegion } from "./context-setup.mjs";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-context-setup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("setup CLI parser has no download or start switch", () => {
  const parsed = parseSetupArgs(["--region", "monaco", "--profiles", "nominatim,pmtiles", "--dry-run", "--json"]);
  assert.equal(parsed.region, "monaco");
  assert.equal(parsed.profiles, "nominatim,pmtiles");
  assert.equal(parsed.dryRun, true);
  assert.throws(() => parseSetupArgs(["--download"]), /unknown option/);
  assert.throws(() => parseSetupArgs(["--start"]), /unknown option/);
});

test("every tracked region passes semantic validation", async () => {
  const directory = join(DEFAULT_REPO_ROOT, "ops", "context", "regions");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  assert.deepEqual(files.sort(), ["belo-horizonte.json", "monaco.json"]);
  for (const file of files) {
    const region = JSON.parse(await readFile(join(directory, file), "utf8"));
    assert.equal(validateRegion(region), region);
  }
});

test("setup creates only local directories and a new private env plan", async (t) => {
  const directory = await temporaryDirectory(t);
  const envFile = join(directory, "context.env");
  const dataDir = join(directory, "runtime");
  const report = await runContextSetup({ repoRoot: DEFAULT_REPO_ROOT, region: "monaco", profiles: "nominatim,valhalla,pmtiles", envFile, dataDir });
  assert.equal(report.envCreated, true);
  assert.equal(report.automaticDownloads, false);
  assert.equal(report.containersStarted, false);
  assert.deepEqual(report.blockers.sort(), ["local-pbf-missing", "local-pmtiles-missing-or-invalid"]);
  const parsed = parseEnvText(await readFile(envFile, "utf8"));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.values.COMPOSE_PROFILES, "nominatim,pmtiles,valhalla");
  assert.match(parsed.values.CONTEXT_NOMINATIM_PASSWORD, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(parsed.values.JARVIS_NOMINATIM_URL, "http://127.0.0.1:8080/");
  assert.equal(parsed.values.JARVIS_VALHALLA_URL, "http://127.0.0.1:8002/");
  assert.ok(parsed.values.JARVIS_PMTILES_FILE.endsWith("monaco.pmtiles"));
  for (const path of [join(dataDir, "imports"), join(dataDir, "valhalla"), join(dataDir, "pmtiles")]) assert.equal((await stat(path)).isDirectory(), true);
});

test("setup never overwrites an existing env file", async (t) => {
  const directory = await temporaryDirectory(t);
  const envFile = join(directory, "context.env");
  const original = "EXISTING_SECRET=preserve-me\n";
  await writeFile(envFile, original);
  const first = await runContextSetup({ repoRoot: DEFAULT_REPO_ROOT, region: "monaco", profiles: "nominatim", envFile, dataDir: join(directory, "first") });
  const second = await runContextSetup({ repoRoot: DEFAULT_REPO_ROOT, region: "belo-horizonte", profiles: "all", envFile, dataDir: join(directory, "second") });
  assert.equal(first.envPreserved, true);
  assert.equal(second.envPreserved, true);
  assert.equal(await readFile(envFile, "utf8"), original);
});

test("dry-run performs no filesystem writes", async (t) => {
  const directory = await temporaryDirectory(t);
  const envFile = join(directory, "context.env");
  const dataDir = join(directory, "runtime");
  const report = await runContextSetup({ repoRoot: DEFAULT_REPO_ROOT, region: "monaco", profiles: "", envFile, dataDir, dryRun: true });
  assert.equal(report.dryRun, true);
  assert.equal(report.envCreated, false);
  assert.ok(report.actions.some((item) => item.action === "would-preserve-directory" && item.path === directory));
  assert.ok(report.actions.some((item) => item.action === "would-create-directory"));
  await assert.rejects(stat(envFile), /ENOENT/);
  await assert.rejects(stat(dataDir), /ENOENT/);
});

test("setup rejects unknown regions and unsafe artifact extensions", async (t) => {
  const directory = await temporaryDirectory(t);
  await assert.rejects(runContextSetup({ repoRoot: DEFAULT_REPO_ROOT, region: "not-a-region", envFile: join(directory, "x.env") }), /unknown region/);
  await assert.rejects(runContextSetup({ repoRoot: DEFAULT_REPO_ROOT, region: "monaco", pbfFile: join(directory, "map.zip"), envFile: join(directory, "x.env") }), /must end with .osm.pbf/);
  await assert.rejects(runContextSetup({ repoRoot: DEFAULT_REPO_ROOT, region: "monaco", pmtilesFile: join(directory, "map.mbtiles"), envFile: join(directory, "x.env") }), /must end with .pmtiles/);
});

test("setup source contains no network client, process spawn, or destructive removal", async () => {
  const source = await readFile(join(DEFAULT_REPO_ROOT, "scripts", "context-setup.mjs"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /from\s+["']node:(?:http|https|child_process)["']/);
  assert.doesNotMatch(source, /rm\([^\n]*recursive\s*:\s*true/);
});
