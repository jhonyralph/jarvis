#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_REPO_ROOT } from "./context-doctor.mjs";

const ALLOWED_PROFILES = new Set(["nominatim", "valhalla", "pmtiles", "all"]);

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function portablePath(path) {
  return resolve(path).replaceAll("\\", "/");
}

function commandQuote(value) {
  const text = String(value);
  return process.platform === "win32"
    ? `'${text.replaceAll("'", "''")}'`
    : `'${text.replaceAll("'", `'\\''`)}'`;
}

function visiblePath(path, root) {
  const rel = relative(root, path);
  return rel && !rel.startsWith(`..${sep}`) && rel !== ".." ? rel.replaceAll("\\", "/") : path;
}

function envValue(value) {
  const text = String(value);
  if (!text || /[\r\n\0]/.test(text)) throw new Error("environment values must be non-empty single-line strings");
  if (/^[A-Za-z0-9_./:@,+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function normalizeProfiles(value) {
  if (!value) return [];
  const profiles = sortedUnique(String(value).split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean));
  const invalid = profiles.filter((profile) => !ALLOWED_PROFILES.has(profile));
  if (invalid.length) throw new Error(`unknown context profile(s): ${invalid.join(", ")}`);
  if (profiles.includes("all") && profiles.length > 1) return ["all"];
  return profiles;
}

function resolveFrom(value, base) {
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}

async function pathState(path) {
  try { return { exists: true, info: await stat(path) }; }
  catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return { exists: false };
    throw error;
  }
}

function validateArtifact(value, label, extension) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (typeof value.fileName !== "string" || !value.fileName.toLowerCase().endsWith(extension)) throw new Error(`${label}.fileName must end with ${extension}`);
  if (basename(value.fileName) !== value.fileName) throw new Error(`${label}.fileName must not contain a directory`);
  if (typeof value.catalogUrl !== "string") throw new Error(`${label}.catalogUrl is required`);
  try { new URL(value.catalogUrl); } catch { throw new Error(`${label}.catalogUrl must be an absolute URL`); }
  if (value.downloadUrl !== null) {
    if (typeof value.downloadUrl !== "string") throw new Error(`${label}.downloadUrl must be a URL or null`);
    try { new URL(value.downloadUrl); } catch { throw new Error(`${label}.downloadUrl must be an absolute URL`); }
  }
  if (!["small", "medium", "large", "unknown"].includes(value.sizeClass)) throw new Error(`${label}.sizeClass is invalid`);
  if (typeof value.note !== "string" || !value.note.trim()) throw new Error(`${label}.note is required`);
}

export function validateRegion(region) {
  if (!region || typeof region !== "object" || Array.isArray(region)) throw new Error("region root must be an object");
  if (region.schemaVersion !== 1) throw new Error("unsupported region schemaVersion");
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(region.id || "")) throw new Error("region id is invalid");
  if (typeof region.label !== "string" || !region.label.trim()) throw new Error("region label is required");
  try { new Intl.DateTimeFormat("en", { timeZone: region.timeZone }).format(); }
  catch { throw new Error("region timeZone is invalid"); }
  if (!Array.isArray(region.bbox) || region.bbox.length !== 4 || region.bbox.some((value) => !Number.isFinite(value))) throw new Error("region bbox must contain four finite numbers");
  const [west, south, east, north] = region.bbox;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) throw new Error("region bbox order/range is invalid");
  if (!Array.isArray(region.center) || region.center.length !== 2 || region.center.some((value) => !Number.isFinite(value))) throw new Error("region center must contain longitude and latitude");
  if (region.center[0] < west || region.center[0] > east || region.center[1] < south || region.center[1] > north) throw new Error("region center must be inside bbox");
  validateArtifact(region.pbf, "region.pbf", ".osm.pbf");
  validateArtifact(region.pmtiles, "region.pmtiles", ".pmtiles");
  if (typeof region.attribution !== "string" || !region.attribution.trim()) throw new Error("region attribution is required");
  return region;
}

export function parseSetupArgs(argv, cwd = process.cwd()) {
  const options = { region: "belo-horizonte", profiles: "", envFile: undefined, dataDir: undefined, pbfFile: undefined, pmtilesFile: undefined, repoRoot: undefined, json: false, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (["--region", "--profiles", "--env-file", "--data-dir", "--pbf-file", "--pmtiles-file", "--root"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--region") options.region = value;
      else if (argument === "--profiles") options.profiles = value;
      else if (argument === "--env-file") options.envFile = resolve(cwd, value);
      else if (argument === "--data-dir") options.dataDir = resolve(cwd, value);
      else if (argument === "--pbf-file") options.pbfFile = resolve(cwd, value);
      else if (argument === "--pmtiles-file") options.pmtilesFile = resolve(cwd, value);
      else options.repoRoot = resolve(cwd, value);
    } else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function renderSetupEnv(input) {
  const selected = new Set(input.profiles.includes("all") ? ["nominatim", "valhalla", "pmtiles"] : input.profiles);
  const lines = [
    "# Generated by scripts/context-setup.mjs. Local file: do not commit.",
    `# Region: ${input.region.label} (${input.region.id})`,
    "# No dataset was downloaded and no container was started.",
    `COMPOSE_PROJECT_NAME=${envValue("jarvis-context")}`,
    `COMPOSE_PROFILES=${input.profiles.join(",")}`,
    "",
    "CONTEXT_BIND_HOST=127.0.0.1",
    `CONTEXT_NOMINATIM_IMAGE=${envValue(input.versions.images.nominatim.image + ":" + input.versions.images.nominatim.tag)}`,
    `CONTEXT_VALHALLA_IMAGE=${envValue(input.versions.images.valhalla.image + ":" + input.versions.images.valhalla.tag)}`,
    `CONTEXT_PMTILES_IMAGE=${envValue(input.versions.images.pmtiles.image + ":" + input.versions.images.pmtiles.tag)}`,
    "CONTEXT_NOMINATIM_PORT=8080",
    "CONTEXT_VALHALLA_PORT=8002",
    "CONTEXT_PMTILES_PORT=8081",
    `CONTEXT_PBF_FILE=${envValue(portablePath(input.pbfFile))}`,
    `CONTEXT_VALHALLA_DIR=${envValue(portablePath(input.valhallaDir))}`,
    `CONTEXT_PMTILES_DIR=${envValue(portablePath(input.pmtilesDir))}`,
    `CONTEXT_PMTILES_ARCHIVE=${envValue(basename(input.pmtilesFile))}`,
    `CONTEXT_NOMINATIM_PASSWORD=${envValue(input.nominatimPassword)}`,
    "CONTEXT_NOMINATIM_SHM_SIZE=1gb",
    "CONTEXT_NOMINATIM_IMPORT_STYLE=full",
    "CONTEXT_NOMINATIM_THREADS=4",
    "CONTEXT_NOMINATIM_WORKERS=2",
    "CONTEXT_VALHALLA_THREADS=2",
    "CONTEXT_PMTILES_PUBLIC_URL=http://127.0.0.1:8081",
    "CONTEXT_PMTILES_CORS=http://127.0.0.1:4577",
    "",
    "# Copy the applicable JARVIS_* lines to the Hub process environment.",
    `JARVIS_CONTEXT_TIMEZONE=${envValue(input.region.timeZone)}`,
  ];
  if (selected.has("nominatim")) lines.push("JARVIS_NOMINATIM_URL=http://127.0.0.1:8080/");
  if (selected.has("valhalla")) lines.push("JARVIS_VALHALLA_URL=http://127.0.0.1:8002/");
  if (selected.has("pmtiles")) {
    lines.push(`JARVIS_PMTILES_FILE=${envValue(portablePath(input.pmtilesFile))}`);
    lines.push(`JARVIS_MAP_STYLE_FILE=${envValue(portablePath(input.mapStyleFile))}`);
  }
  lines.push("", "# Optional public/free adapters use code defaults when these names are absent.");
  lines.push("# Secrets for CalDAV, MCP, Home Assistant and Open Charge Map belong only in the Hub environment.", "");
  return lines.join("\n");
}

async function writeExclusive(path, content) {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { await copyFile(temporary, path, fsConstants.COPYFILE_EXCL); }
  finally { await rm(temporary, { force: true }); }
}

function setupHelp() {
  return `Usage: node scripts/context-setup.mjs [options]\n\nOptions:\n  --region ID          Region config (default: belo-horizonte)\n  --profiles LIST      nominatim,valhalla,pmtiles or all; none by default\n  --env-file PATH      Output env file (default: ops/context/.env)\n  --data-dir PATH      Runtime root (default: ops/context/runtime)\n  --pbf-file PATH      Existing/future local .osm.pbf path\n  --pmtiles-file PATH  Existing/future local .pmtiles path\n  --dry-run            Print the plan without creating directories/files\n  --json               Emit one machine-readable JSON object\n  --root PATH          Override repository root (mainly for diagnostics/tests)\n  -h, --help           Show this help\n\nThe setup never downloads geographic data, pulls images, starts Docker, or overwrites an existing env file.`;
}

export async function runContextSetup(options = {}) {
  const repoRoot = resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const contextDir = join(repoRoot, "ops", "context");
  const profiles = normalizeProfiles(options.profiles);
  const regionId = options.region || "belo-horizonte";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(regionId)) throw new Error("region id is invalid");
  const regionFile = join(contextDir, "regions", `${regionId}.json`);
  const versionsFile = join(contextDir, "versions.json");
  const regionState = await pathState(regionFile);
  if (!regionState.exists || !regionState.info.isFile()) throw new Error(`unknown region: ${regionId}`);
  const region = validateRegion(JSON.parse(await readFile(regionFile, "utf8")));
  const versions = JSON.parse(await readFile(versionsFile, "utf8"));
  if (versions.schemaVersion !== 1 || !versions.images?.nominatim || !versions.images?.valhalla || !versions.images?.pmtiles) throw new Error("versions.json is invalid");

  const dataDir = resolve(options.dataDir || join(contextDir, "runtime"));
  const importsDir = join(dataDir, "imports");
  const valhallaDir = join(dataDir, "valhalla");
  const pmtilesDir = join(dataDir, "pmtiles");
  const pbfFile = resolve(options.pbfFile || join(importsDir, region.pbf.fileName));
  const pmtilesFile = resolve(options.pmtilesFile || join(pmtilesDir, region.pmtiles.fileName));
  if (!pbfFile.toLowerCase().endsWith(".osm.pbf")) throw new Error("--pbf-file must end with .osm.pbf");
  if (!pmtilesFile.toLowerCase().endsWith(".pmtiles")) throw new Error("--pmtiles-file must end with .pmtiles");
  const envFile = resolve(options.envFile || join(contextDir, ".env"));
  const mapStyleFile = join(contextDir, "map", "style.json");
  const envState = await pathState(envFile);
  if (envState.exists && !envState.info.isFile()) throw new Error("env-file path exists and is not a file");
  const directories = sortedUnique([dirname(envFile), importsDir, valhallaDir, pmtilesDir]);
  const directoryStates = new Map();
  for (const path of directories) {
    const state = await pathState(path);
    if (state.exists && !state.info.isDirectory()) throw new Error(`required directory path is not a directory: ${path}`);
    directoryStates.set(path, state);
  }
  const input = { region, versions, profiles, pbfFile, pmtilesFile, valhallaDir, pmtilesDir, mapStyleFile, nominatimPassword: randomBytes(32).toString("base64url") };
  const envText = renderSetupEnv(input);
  const actions = [];

  if (options.dryRun) {
    directories.forEach((path) => actions.push({ action: directoryStates.get(path).exists ? "would-preserve-directory" : "would-create-directory", path }));
    actions.push({ action: envState.exists ? "would-preserve-env" : "would-create-env", path: envFile });
  } else {
    for (const path of directories) { await mkdir(path, { recursive: true }); actions.push({ action: "ensured-directory", path }); }
    if (envState.exists) actions.push({ action: "preserved-env", path: envFile });
    else { await writeExclusive(envFile, envText); actions.push({ action: "created-env", path: envFile }); }
  }

  const pbfState = await pathState(pbfFile);
  const pmtilesState = await pathState(pmtilesFile);
  const selected = new Set(profiles.includes("all") ? ["nominatim", "valhalla", "pmtiles"] : profiles);
  const blockers = [];
  if ((selected.has("nominatim") || selected.has("valhalla")) && (!pbfState.exists || !pbfState.info.isFile() || pbfState.info.size === 0)) blockers.push("local-pbf-missing");
  if (selected.has("pmtiles") && (!pmtilesState.exists || !pmtilesState.info.isFile() || pmtilesState.info.size < 127)) blockers.push("local-pmtiles-missing-or-invalid");
  if (!profiles.length) blockers.push("no-profile-selected");

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dryRun: Boolean(options.dryRun),
    nonDestructive: true,
    automaticDownloads: false,
    containersStarted: false,
    repoRoot,
    contextDir,
    envFile,
    envCreated: !options.dryRun && !envState.exists,
    envPreserved: envState.exists,
    region: { id: region.id, label: region.label, timeZone: region.timeZone, bbox: region.bbox },
    profiles,
    paths: { dataDir, pbfFile, valhallaDir, pmtilesFile, mapStyleFile },
    artifacts: {
      pbf: { present: pbfState.exists && pbfState.info.isFile() && pbfState.info.size > 0, target: pbfFile, catalogUrl: region.pbf.catalogUrl, downloadUrl: region.pbf.downloadUrl, sizeClass: region.pbf.sizeClass, note: region.pbf.note },
      pmtiles: { present: pmtilesState.exists && pmtilesState.info.isFile() && pmtilesState.info.size >= 127, target: pmtilesFile, catalogUrl: region.pmtiles.catalogUrl, downloadUrl: region.pmtiles.downloadUrl, sizeClass: region.pmtiles.sizeClass, note: region.pmtiles.note },
    },
    actions,
    blockers,
    readyForCompose: blockers.length === 0,
    nextCommands: [
      `node scripts/context-doctor.mjs --env-file ${commandQuote(envFile)} --offline`,
      `node scripts/context-doctor.mjs --env-file ${commandQuote(envFile)}`,
      `docker compose --env-file ${commandQuote(envFile)} -f ${commandQuote(join(contextDir, "compose.yaml"))} up -d`,
    ],
  };
}

export function formatSetupReport(report) {
  const lines = [
    "Jarvis Context Engine setup",
    `region: ${report.region.label} | profiles: ${report.profiles.join(",") || "none"}`,
    `env: ${report.envCreated ? "created" : report.envPreserved ? "preserved without changes" : "planned"} (${visiblePath(report.envFile, report.repoRoot)})`,
    "downloads: none | containers started: no",
    `PBF: ${report.artifacts.pbf.present ? "present" : "missing"} (${visiblePath(report.paths.pbfFile, report.repoRoot)})`,
    `PMTiles: ${report.artifacts.pmtiles.present ? "present" : "missing"} (${visiblePath(report.paths.pmtilesFile, report.repoRoot)})`,
  ];
  if (report.blockers.length) lines.push(`blockers: ${report.blockers.join(", ")}`);
  lines.push("Next:", ...report.nextCommands.map((command) => `  ${command}`));
  return lines.join("\n");
}

async function main() {
  let args;
  try { args = parseSetupArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n\n${setupHelp()}\n`); process.exitCode = 2; return; }
  if (args.help) { process.stdout.write(`${setupHelp()}\n`); return; }
  try {
    const report = await runContextSetup(args);
    process.stdout.write(args.json ? `${JSON.stringify(report)}\n` : `${formatSetupReport(report)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, fatal: true, error: message })}\n`);
    else process.stderr.write(`Context setup failed: ${message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
