import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  DEFAULT_REPO_ROOT,
  DOCKER_ENV_CATALOG,
  HUB_CONTEXT_ENV_CATALOG,
  OPS_CONTEXT_ENV_CATALOG,
  detectComposeEnvNames,
  detectExampleEnvNames,
  detectHubContextEnvNames,
  parseDoctorArgs,
  parseEnvText,
  runContextDoctor,
  validateMapStyleFile,
  validatePmtilesFile,
} from "./context-doctor.mjs";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-context-doctor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writePmtiles(path, version = 3) {
  const bytes = Buffer.alloc(127);
  bytes.write("PMTiles", 0, "ascii");
  bytes[7] = version;
  await writeFile(path, bytes);
}

function check(report, id) {
  const value = report.checks.find((item) => item.id === id);
  assert.ok(value, `missing check ${id}`);
  return value;
}

test("env parser accepts common syntax without expanding or exposing values", () => {
  const parsed = parseEnvText("A=one\nexport B=\"two words\"\nC='literal value'\nD=value # comment\nBROKEN\n");
  assert.deepEqual(parsed.values, { A: "one", B: "two words", C: "literal value", D: "value" });
  assert.deepEqual(parsed.errors, ["line 5: expected NAME=value"]);
});

test("doctor CLI parser is cross-platform and rejects unknown options", () => {
  const parsed = parseDoctorArgs(["--json", "--offline", "--strict", "--timeout-ms", "800", "--profiles", "nominatim,valhalla", "--env-file", "context.env"], "C:\\work");
  assert.equal(parsed.json, true);
  assert.equal(parsed.timeoutMs, 800);
  assert.equal(parsed.profiles, "nominatim,valhalla");
  assert.throws(() => parseDoctorArgs(["--download"]), /unknown option/);
  assert.throws(() => parseDoctorArgs(["--timeout-ms", "0"]), /between 100 and 60000/);
});

test("catalogs match direct code, Compose, and env.example references", async () => {
  const contextDir = join(DEFAULT_REPO_ROOT, "ops", "context");
  const hub = await detectHubContextEnvNames(DEFAULT_REPO_ROOT);
  const compose = await detectComposeEnvNames(join(contextDir, "compose.yaml"));
  const example = await detectExampleEnvNames(join(contextDir, "env.example"));
  const ordered = (values) => [...values].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(hub, ordered(HUB_CONTEXT_ENV_CATALOG.map((entry) => entry.name)));
  assert.deepEqual(compose, ordered(OPS_CONTEXT_ENV_CATALOG));
  for (const name of [...hub, ...compose, ...DOCKER_ENV_CATALOG]) assert.ok(example.includes(name), `${name} missing from env.example`);
  const docs = await readFile(join(DEFAULT_REPO_ROOT, "docs", "personal-assistant", "environment.md"), "utf8");
  for (const name of [...hub, ...compose, ...DOCKER_ENV_CATALOG]) assert.match(docs, new RegExp(`\\b${name}\\b`), `${name} missing from environment.md`);
});

test("Compose is opt-in, pinned, local-only, and has three healthchecks", async () => {
  const compose = await readFile(join(DEFAULT_REPO_ROOT, "ops", "context", "compose.yaml"), "utf8");
  assert.doesNotMatch(compose, /:latest\b/);
  assert.doesNotMatch(compose, /\b(?:PBF_URL|tile_urls)\s*:/);
  assert.match(compose, /internal:\s*true/);
  assert.match(compose, /CONTEXT_BIND_HOST:-127\.0\.0\.1/g);
  assert.equal((compose.match(/healthcheck:/g) || []).length, 3);
  assert.equal((compose.match(/profiles:\s*\[/g) || []).length, 3);
  assert.match(compose, /UPDATE_MODE:\s*none/);
  assert.match(compose, /use_default_speeds_config:\s*"False"/);
});

test("tracked personal-assistant documentation has no broken local links", async () => {
  const files = [
    join(DEFAULT_REPO_ROOT, "ops", "context", "README.md"),
    join(DEFAULT_REPO_ROOT, "ops", "context", "ATTRIBUTIONS.md"),
    ...["README.md", "installation.md", "environment.md", "integrations.md", "privacy.md", "mobile.md", "troubleshooting.md"]
      .map((name) => join(DEFAULT_REPO_ROOT, "docs", "personal-assistant", name)),
  ];
  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split("#", 1)[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = resolve(join(file, ".."), decodeURIComponent(target));
      assert.equal((await stat(resolved)).isFile(), true, `broken link ${target} in ${file}`);
    }
  }
});

test("PMTiles and MapLibre validators reject malformed artifacts", async (t) => {
  const directory = await temporaryDirectory(t);
  const pmtiles = join(directory, "region.pmtiles");
  const style = join(directory, "style.json");
  await writePmtiles(pmtiles);
  await writeFile(style, JSON.stringify({ version: 8, sources: {}, layers: [{ id: "background", type: "background" }] }));
  assert.equal((await validatePmtilesFile(pmtiles)).ok, true);
  assert.equal((await validateMapStyleFile(style)).ok, true);
  await writePmtiles(pmtiles, 4);
  await writeFile(style, "{broken");
  assert.match((await validatePmtilesFile(pmtiles)).reason, /unsupported/);
  assert.match((await validateMapStyleFile(style)).reason, /valid JSON/);
});

test("offline doctor validates configured local files and reports public fallbacks as degraded", async (t) => {
  const directory = await temporaryDirectory(t);
  const pmtiles = join(directory, "region.pmtiles");
  const style = join(directory, "style.json");
  const envFile = join(directory, "context.env");
  await writePmtiles(pmtiles);
  await writeFile(style, JSON.stringify({ version: 8, sources: {}, layers: [{ id: "background", type: "background" }] }));
  await writeFile(envFile, `JARVIS_PMTILES_FILE=${pmtiles.replaceAll("\\", "/")}\nJARVIS_MAP_STYLE_FILE=${style.replaceAll("\\", "/")}\nJARVIS_CONTEXT_TIMEZONE=America/Sao_Paulo\n`);
  const report = await runContextDoctor({ repoRoot: DEFAULT_REPO_ROOT, envFile, processEnv: {}, offline: true });
  assert.equal(report.exitCode, 0);
  assert.equal(report.mode, "self-hosted-degraded");
  assert.equal(check(report, "artifact.pmtiles-hub").status, "ok");
  assert.equal(check(report, "artifact.map-style").status, "ok");
  assert.equal(check(report, "fallback.nominatim").status, "warning");
});

test("configured profiles make missing artifacts and secrets hard failures", async (t) => {
  const directory = await temporaryDirectory(t);
  const envFile = join(directory, "context.env");
  await writeFile(envFile, "COMPOSE_PROFILES=nominatim,valhalla,pmtiles\nCONTEXT_PBF_FILE=missing.osm.pbf\nCONTEXT_VALHALLA_DIR=missing-valhalla\nCONTEXT_PMTILES_DIR=missing-pmtiles\nCONTEXT_PMTILES_ARCHIVE=missing.pmtiles\n");
  const report = await runContextDoctor({ repoRoot: DEFAULT_REPO_ROOT, envFile, processEnv: {}, offline: true, commandRunner: async () => ({ ok: true, code: 0 }) });
  assert.equal(report.exitCode, 1);
  assert.equal(check(report, "artifact.pbf").status, "error");
  assert.equal(check(report, "secret.nominatim").status, "error");
  assert.equal(check(report, "directory.valhalla").status, "error");
  assert.equal(check(report, "artifact.pmtiles-sidecar").status, "error");
});

test("doctor validates proactive scheduler controls", async (t) => {
  const directory = await temporaryDirectory(t);
  const envFile = join(directory, "context.env");
  await writeFile(envFile, "JARVIS_PERSONAL_PROACTIVE=yes\nJARVIS_PERSONAL_PROACTIVE_INTERVAL_MIN=0\n");
  const report = await runContextDoctor({ repoRoot: DEFAULT_REPO_ROOT, envFile, processEnv: {}, offline: true });
  assert.equal(check(report, "value.personal-proactive").status, "error");
  assert.equal(check(report, "value.personal-proactive-interval").status, "error");
  assert.equal(report.exitCode, 1);
});

test("doctor rejects unsafe effective Compose overrides", async (t) => {
  const directory = await temporaryDirectory(t);
  const envFile = join(directory, "context.env");
  await writeFile(envFile, [
    "CONTEXT_NOMINATIM_IMAGE=mediagis/nominatim:latest",
    "CONTEXT_BIND_HOST=0.0.0.0",
    "CONTEXT_NOMINATIM_PORT=70000",
    "CONTEXT_PMTILES_ARCHIVE=../outside.pmtiles",
    "CONTEXT_PMTILES_CORS=https://example.com/path",
  ].join("\n"));
  const report = await runContextDoctor({ repoRoot: DEFAULT_REPO_ROOT, envFile, processEnv: {}, offline: true });
  assert.equal(check(report, "value.images").status, "error");
  assert.equal(check(report, "value.bind-host").status, "warning");
  assert.equal(check(report, "value.ports").status, "error");
  assert.equal(check(report, "value.pmtiles-archive").status, "error");
  assert.equal(check(report, "url.context_pmtiles_cors").status, "error");
  assert.equal(report.exitCode, 1);
});

test("network probes check local health paths and never serialize secrets", async (t) => {
  const directory = await temporaryDirectory(t);
  const pbf = join(directory, "region.osm.pbf");
  const valhalla = join(directory, "valhalla");
  const envFile = join(directory, "context.env");
  await writeFile(pbf, Buffer.from("local-pbf-fixture"));
  await mkdir(valhalla);
  const server = createServer((request, response) => {
    if (["/nominatim/status", "/valhalla/status"].includes(request.url)) response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    else response.writeHead(404).end();
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const root = `http://127.0.0.1:${address.port}`;
  const password = "DO-NOT-PRINT-THIS-PASSWORD";
  await writeFile(envFile, [
    "COMPOSE_PROFILES=nominatim,valhalla",
    `CONTEXT_PBF_FILE=${pbf.replaceAll("\\", "/")}`,
    `CONTEXT_VALHALLA_DIR=${valhalla.replaceAll("\\", "/")}`,
    `CONTEXT_NOMINATIM_PASSWORD=${password}`,
    `JARVIS_NOMINATIM_URL=${root}/nominatim/`,
    `JARVIS_VALHALLA_URL=${root}/valhalla/`,
  ].join("\n"));
  const report = await runContextDoctor({ repoRoot: DEFAULT_REPO_ROOT, envFile, processEnv: {}, timeoutMs: 1_000, commandRunner: async () => ({ ok: true, code: 0 }) });
  assert.equal(check(report, "network.nominatim").status, "ok");
  assert.equal(check(report, "network.valhalla").status, "ok");
  assert.equal(JSON.stringify(report).includes(password), false);
});

test("strict mode fails on warnings while default mode allows degraded operation", async (t) => {
  const directory = await temporaryDirectory(t);
  const envFile = join(directory, "context.env");
  await writeFile(envFile, "JARVIS_CONTEXT_TIMEZONE=UTC\n");
  const normal = await runContextDoctor({ repoRoot: DEFAULT_REPO_ROOT, envFile, processEnv: {}, offline: true });
  const strict = await runContextDoctor({ repoRoot: DEFAULT_REPO_ROOT, envFile, processEnv: {}, offline: true, strict: true });
  assert.equal(normal.exitCode, 0);
  assert.equal(strict.exitCode, 1);
  assert.ok(strict.summary.warning > 0);
});

test("Compose rendering remains checkable when optional Docker daemon is stopped", async (t) => {
  const directory = await temporaryDirectory(t);
  const envFile = join(directory, "context.env");
  await writeFile(envFile, "JARVIS_CONTEXT_TIMEZONE=UTC\n");
  let calls = 0;
  const commandRunner = async (_command, args) => {
    calls += 1;
    if (args[0] === "version" && args[1] === "--format") return { ok: false, code: 1 };
    return { ok: true, code: 0 };
  };
  const report = await runContextDoctor({ repoRoot: DEFAULT_REPO_ROOT, envFile, processEnv: {}, offline: true, compose: true, commandRunner });
  assert.equal(check(report, "docker.daemon").status, "warning");
  assert.equal(check(report, "docker.compose-config").status, "ok");
  assert.equal(report.exitCode, 0);
  assert.equal(calls, 3);
});
