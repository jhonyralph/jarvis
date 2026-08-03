#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, open, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
export const DEFAULT_REPO_ROOT = resolve(dirname(SCRIPT_FILE), "..");

export const HUB_CONTEXT_ENV_CATALOG = Object.freeze([
  { name: "JARVIS_CONTEXT_TIMEZONE", kind: "timezone", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_EVENTS_ATTRIBUTION", kind: "text", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_EVENTS_FEED_FORMAT", kind: "enum", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_EVENTS_FEED_URL", kind: "url", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_HOME", kind: "directory", optional: true, source: "packages/core/src/personal-store.ts" },
  { name: "JARVIS_MAPAS_CULTURAIS_URL", kind: "url", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_MAP_STYLE_FILE", kind: "json-file", optional: true, source: "apps/hub/src/index.ts" },
  { name: "JARVIS_NOMINATIM_EMAIL", kind: "text", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_NOMINATIM_URL", kind: "url", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_OCM_API_KEY", kind: "secret", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_OCM_URL", kind: "url", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_OPEN_METEO_URL", kind: "url", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_OVERPASS_URL", kind: "url", optional: true, source: "apps/hub/src/personalSources.ts" },
  { name: "JARVIS_PMTILES_FILE", kind: "pmtiles-file", optional: true, source: "apps/hub/src/index.ts" },
  { name: "JARVIS_PERSONAL_PROACTIVE", kind: "boolean-flag", optional: true, source: "apps/hub/src/index.ts" },
  { name: "JARVIS_PERSONAL_PROACTIVE_INTERVAL_MIN", kind: "positive-number", optional: true, source: "apps/hub/src/index.ts" },
  { name: "JARVIS_VALHALLA_URL", kind: "url", optional: true, source: "apps/hub/src/personalSources.ts" },
]);

export const OPS_CONTEXT_ENV_CATALOG = Object.freeze([
  "COMPOSE_PROJECT_NAME",
  "CONTEXT_BIND_HOST",
  "CONTEXT_NOMINATIM_IMAGE",
  "CONTEXT_NOMINATIM_IMPORT_STYLE",
  "CONTEXT_NOMINATIM_PASSWORD",
  "CONTEXT_NOMINATIM_PORT",
  "CONTEXT_NOMINATIM_SHM_SIZE",
  "CONTEXT_NOMINATIM_THREADS",
  "CONTEXT_NOMINATIM_WORKERS",
  "CONTEXT_PBF_FILE",
  "CONTEXT_PMTILES_ARCHIVE",
  "CONTEXT_PMTILES_CORS",
  "CONTEXT_PMTILES_DIR",
  "CONTEXT_PMTILES_IMAGE",
  "CONTEXT_PMTILES_PORT",
  "CONTEXT_PMTILES_PUBLIC_URL",
  "CONTEXT_VALHALLA_DIR",
  "CONTEXT_VALHALLA_IMAGE",
  "CONTEXT_VALHALLA_PORT",
  "CONTEXT_VALHALLA_THREADS",
]);

export const DOCKER_ENV_CATALOG = Object.freeze(["COMPOSE_PROFILES"]);

const CONTEXT_CODE_FILES = Object.freeze([
  "apps/hub/src/personalSources.ts",
  "apps/hub/src/index.ts",
  "packages/core/src/personal-store.ts",
]);
const CONTEXT_CODE_ROOTS = Object.freeze(["apps/hub/src", "packages/core/src"]);
const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const CONTEXT_NAME = /^JARVIS_(?:CONTEXT|EVENTS|MAPAS_CULTURAIS|MAP_STYLE|NOMINATIM|OCM|OPEN_METEO|OVERPASS|PERSONAL_PROACTIVE|PMTILES|VALHALLA)(?:_|$)/;
const PROFILE_NAMES = new Set(["nominatim", "valhalla", "pmtiles", "all"]);

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function visiblePath(path, root) {
  const rel = relative(root, path);
  return rel && !rel.startsWith(`..${sep}`) && rel !== ".." ? rel.replaceAll("\\", "/") : path;
}

function resolveConfiguredPath(value, root) {
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function parseInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return undefined;
  return parsed;
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try { return JSON.parse(trimmed); }
    catch { throw new Error("invalid double-quoted value"); }
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) throw new Error("invalid single-quoted value");
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

export function parseEnvText(text) {
  const output = {};
  const errors = [];
  String(text).split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) { errors.push(`line ${index + 1}: expected NAME=value`); return; }
    try { output[match[1]] = unquoteEnvValue(match[2]); }
    catch (error) { errors.push(`line ${index + 1}: ${error instanceof Error ? error.message : "invalid value"}`); }
  });
  return { values: output, errors };
}

export function parseDoctorArgs(argv, cwd = process.cwd()) {
  const options = { json: false, offline: false, strict: false, compose: false, timeoutMs: 4_000, profiles: undefined, envFile: undefined, repoRoot: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--offline") options.offline = true;
    else if (argument === "--strict") options.strict = true;
    else if (argument === "--compose") options.compose = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (["--env-file", "--profiles", "--timeout-ms", "--root"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--env-file") options.envFile = resolve(cwd, value);
      else if (argument === "--profiles") options.profiles = value;
      else if (argument === "--root") options.repoRoot = resolve(cwd, value);
      else {
        const timeoutMs = parseInteger(value, undefined, 100, 60_000);
        if (timeoutMs === undefined) throw new Error("--timeout-ms must be an integer between 100 and 60000");
        options.timeoutMs = timeoutMs;
      }
    } else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function normalizeProfiles(value) {
  if (!value) return [];
  const profiles = sortedUnique(String(value).split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean));
  const invalid = profiles.filter((item) => !PROFILE_NAMES.has(item));
  if (invalid.length) throw new Error(`unknown context profile(s): ${invalid.join(", ")}`);
  return profiles;
}

async function listSourceFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSourceFiles(path));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

export async function detectHubContextEnvNames(repoRoot = DEFAULT_REPO_ROOT) {
  const names = [];
  const files = [];
  for (const root of CONTEXT_CODE_ROOTS) files.push(...await listSourceFiles(join(repoRoot, root)));
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const pattern of [/\b(?:process\.)?env\.([A-Z][A-Z0-9_]*)/g, /\b(?:process\.)?env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g]) {
      for (const match of text.matchAll(pattern)) {
        if (match[1] === "JARVIS_HOME" || CONTEXT_NAME.test(match[1])) names.push(match[1]);
      }
    }
  }
  return sortedUnique(names);
}

export async function detectComposeEnvNames(composeFile) {
  const text = await readFile(composeFile, "utf8");
  return sortedUnique([...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
}

export async function detectExampleEnvNames(exampleFile) {
  const text = await readFile(exampleFile, "utf8");
  return sortedUnique([...text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((match) => match[1]));
}

async function fileInfo(path) {
  try {
    const info = await stat(path);
    return { exists: true, info };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return { exists: false };
    throw error;
  }
}

export async function validatePmtilesFile(path) {
  const present = await fileInfo(path);
  if (!present.exists) return { ok: false, reason: "file does not exist" };
  if (!present.info.isFile()) return { ok: false, reason: "path is not a file" };
  if (present.info.size < 127) return { ok: false, reason: "file is smaller than a PMTiles v3 header" };
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(8);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length || bytes.subarray(0, 7).toString("ascii") !== "PMTiles") return { ok: false, reason: "PMTiles magic header is invalid" };
    if (bytes[7] !== 3) return { ok: false, reason: `unsupported PMTiles specification version ${bytes[7]}` };
    return { ok: true, size: present.info.size, specVersion: bytes[7] };
  } finally { await handle.close(); }
}

export async function validateMapStyleFile(path) {
  const present = await fileInfo(path);
  if (!present.exists) return { ok: false, reason: "file does not exist" };
  if (!present.info.isFile()) return { ok: false, reason: "path is not a file" };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "style root must be an object" };
    if (parsed.version !== 8) return { ok: false, reason: "MapLibre style version must be 8" };
    if (!parsed.sources || typeof parsed.sources !== "object" || Array.isArray(parsed.sources)) return { ok: false, reason: "MapLibre style must define sources" };
    if (!Array.isArray(parsed.layers) || parsed.layers.length === 0) return { ok: false, reason: "MapLibre style must define at least one layer" };
    return { ok: true, sources: Object.keys(parsed.sources).length, layers: parsed.layers.length };
  } catch { return { ok: false, reason: "file is not valid JSON" }; }
}

function safeUrlLabel(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch { return "configured endpoint"; }
}

function validateHttpUrl(value, allowQuery = false) {
  let url;
  try { url = new URL(value); }
  catch { return { ok: false, reason: "must be an absolute URL" }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: "protocol must be HTTP or HTTPS" };
  if (url.username || url.password) return { ok: false, reason: "credentials must not be embedded in URLs" };
  if (url.hash) return { ok: false, reason: "fragments are not allowed" };
  if (!allowQuery && url.search) return { ok: false, reason: "query parameters are not allowed for this endpoint" };
  return { ok: true, url };
}

function isPinnedImageReference(value) {
  const text = String(value || "").trim();
  if (!text || /\s/.test(text)) return false;
  if (/^[^@]+@sha256:[a-f0-9]{64}$/i.test(text)) return true;
  const slash = text.lastIndexOf("/");
  const colon = text.lastIndexOf(":");
  if (colon <= slash) return false;
  const tag = text.slice(colon + 1);
  return tag.toLowerCase() !== "latest" && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag);
}

function validateCorsOrigins(value) {
  const origins = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!origins.length) return false;
  return origins.every((origin) => {
    const validation = validateHttpUrl(origin);
    return validation.ok && validation.url.pathname === "/";
  });
}

function childUrl(value, child) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return new URL(child, url);
}

async function probeHttp(url, timeoutMs, fetcher, accepted = (status) => status >= 200 && status < 400) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetcher(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "user-agent": "Jarvis-Context-Doctor/1" } });
    void response.body?.cancel();
    return { ok: accepted(response.status), status: response.status, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return { ok: false, reason: timedOut ? "timed out" : "connection failed", latencyMs: Date.now() - startedAt };
  } finally { clearTimeout(timer); }
}

function commandResult(command, args, options = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const maxOutputBytes = 64 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveResult(result);
    };
    child.stdout.on("data", (chunk) => {
      const remaining = maxOutputBytes - stdoutBytes;
      if (remaining <= 0) return;
      const next = chunk.subarray(0, remaining);
      stdout.push(next);
      stdoutBytes += next.length;
    });
    child.stderr.on("data", (chunk) => {
      const remaining = maxOutputBytes - stderrBytes;
      if (remaining <= 0) return;
      const next = chunk.subarray(0, remaining);
      stderr.push(next);
      stderrBytes += next.length;
    });
    child.on("error", (error) => finish({ ok: false, code: null, error: error.code || error.message }));
    child.on("close", (code) => finish({ ok: code === 0, code, stdout: Buffer.concat(stdout).toString("utf8").trim(), stderr: Buffer.concat(stderr).toString("utf8").trim() }));
    timer = setTimeout(() => { child.kill(); finish({ ok: false, code: null, error: "timeout" }); }, options.timeoutMs ?? 10_000);
  });
}

function humanHelp() {
  return `Usage: node scripts/context-doctor.mjs [options]\n\nOptions:\n  --env-file PATH   Read Context Engine configuration (default: ops/context/.env)\n  --profiles LIST   Override COMPOSE_PROFILES for validation\n  --offline         Skip all HTTP probes\n  --compose         Validate Docker even when no profile is selected\n  --strict          Treat warnings as a failing exit code\n  --timeout-ms N    Per-request/process timeout (100..60000)\n  --json             Emit one machine-readable JSON object\n  --root PATH        Override repository root (mainly for diagnostics/tests)\n  -h, --help         Show this help`;
}

function summarize(checks, strict) {
  const counts = { ok: 0, warning: 0, error: 0, skipped: 0 };
  for (const check of checks) counts[check.status] += 1;
  return { ...counts, passed: counts.error === 0 && (!strict || counts.warning === 0) };
}

export async function runContextDoctor(options = {}) {
  const repoRoot = resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const contextDir = join(repoRoot, "ops", "context");
  const composeFile = join(contextDir, "compose.yaml");
  const exampleFile = join(contextDir, "env.example");
  const versionsFile = join(contextDir, "versions.json");
  const envFile = resolve(options.envFile || join(contextDir, ".env"));
  const timeoutMs = parseInteger(options.timeoutMs, 4_000, 100, 60_000);
  if (timeoutMs === undefined) throw new Error("timeoutMs must be an integer between 100 and 60000");
  const checks = [];
  const add = (id, status, message, details) => checks.push({ id, status, message, ...(details === undefined ? {} : { details }) });
  const fetcher = options.fetch || fetch;
  const processEnv = options.processEnv || process.env;

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("runtime.node", nodeMajor >= 22 ? "ok" : "error", nodeMajor >= 22 ? `Node ${process.versions.node}` : `Node ${process.versions.node}; version 22 or newer is required`);

  const requiredFiles = [composeFile, exampleFile, versionsFile, ...CONTEXT_CODE_FILES.map((file) => join(repoRoot, file))];
  const missingFiles = [];
  for (const file of requiredFiles) if (!(await fileInfo(file)).exists) missingFiles.push(visiblePath(file, repoRoot));
  add("repository.layout", missingFiles.length ? "error" : "ok", missingFiles.length ? `Missing required files: ${missingFiles.join(", ")}` : "Context Engine operation and code files are present");

  let fileEnv = {};
  const envPresent = await fileInfo(envFile);
  if (!envPresent.exists) add("environment.file", "warning", `${visiblePath(envFile, repoRoot)} does not exist; run context-setup or use --env-file`);
  else if (!envPresent.info.isFile()) add("environment.file", "error", `${visiblePath(envFile, repoRoot)} is not a file`);
  else {
    const parsed = parseEnvText(await readFile(envFile, "utf8"));
    fileEnv = parsed.values;
    add("environment.file", parsed.errors.length ? "error" : "ok", parsed.errors.length ? `Invalid env file: ${parsed.errors.join("; ")}` : `Loaded ${Object.keys(fileEnv).length} names from ${visiblePath(envFile, repoRoot)}`);
  }
  const env = { ...fileEnv, ...processEnv };

  if (missingFiles.length === 0) {
    const detectedHub = await detectHubContextEnvNames(repoRoot);
    const catalogHub = sortedUnique(HUB_CONTEXT_ENV_CATALOG.map((entry) => entry.name));
    add("contract.hub-env", arraysEqual(detectedHub, catalogHub) ? "ok" : "error", arraysEqual(detectedHub, catalogHub)
      ? `Catalog matches ${detectedHub.length} direct Context Engine env references`
      : `Hub env catalog drift; code-only: ${detectedHub.filter((name) => !catalogHub.includes(name)).join(", ") || "none"}; catalog-only: ${catalogHub.filter((name) => !detectedHub.includes(name)).join(", ") || "none"}`);
    const detectedCompose = await detectComposeEnvNames(composeFile);
    const catalogCompose = sortedUnique(OPS_CONTEXT_ENV_CATALOG);
    add("contract.compose-env", arraysEqual(detectedCompose, catalogCompose) ? "ok" : "error", arraysEqual(detectedCompose, catalogCompose)
      ? `Catalog matches ${detectedCompose.length} Compose variables`
      : `Compose env catalog drift; compose-only: ${detectedCompose.filter((name) => !catalogCompose.includes(name)).join(", ") || "none"}; catalog-only: ${catalogCompose.filter((name) => !detectedCompose.includes(name)).join(", ") || "none"}`);
    const exampleNames = await detectExampleEnvNames(exampleFile);
    const expectedExamples = sortedUnique([...catalogHub, ...catalogCompose, ...DOCKER_ENV_CATALOG]);
    const absentExamples = expectedExamples.filter((name) => !exampleNames.includes(name));
    add("contract.env-example", absentExamples.length ? "error" : "ok", absentExamples.length ? `env.example is missing: ${absentExamples.join(", ")}` : "env.example covers every direct and operational variable");
    const composeText = await readFile(composeFile, "utf8");
    const versions = JSON.parse(await readFile(versionsFile, "utf8"));
    const versionKeys = ["nominatim", "valhalla", "pmtiles"];
    const invalidVersionKeys = versionKeys.filter((name) => typeof versions.images?.[name]?.image !== "string" || typeof versions.images?.[name]?.tag !== "string");
    add("contract.versions", versions.schemaVersion === 1 && !invalidVersionKeys.length ? "ok" : "error", versions.schemaVersion !== 1
      ? "versions.json must use schemaVersion 1"
      : invalidVersionKeys.length ? `versions.json is missing valid image/tag entries: ${invalidVersionKeys.join(", ")}` : "versions.json defines all three sidecars");
    const expectedImages = Object.fromEntries(versionKeys.map((name) => {
      const entry = versions.images?.[name];
      return [name, entry && typeof entry.image === "string" && typeof entry.tag === "string" ? `${entry.image}:${entry.tag}` : undefined];
    }));
    const imageRefs = Object.values(expectedImages);
    const absentImages = imageRefs.filter((image) => image && !composeText.includes(image));
    const floating = /(?:image|tag)[^\n]*:latest\b/i.test(composeText) || imageRefs.some((image) => image?.endsWith(":latest"));
    add("contract.images", invalidVersionKeys.length || absentImages.length || floating ? "error" : "ok", invalidVersionKeys.length
      ? "Compose image references cannot be checked until versions.json is complete"
      : absentImages.length ? `Compose is missing version catalog image(s): ${absentImages.join(", ")}` : floating ? "Floating latest image tag is not allowed" : `${imageRefs.length} image references use exact release tags`);
    add("contract.network", /internal:\s*true/.test(composeText) && /CONTEXT_BIND_HOST:-127\.0\.0\.1/.test(composeText) ? "ok" : "error", "Compose defaults to an internal network and loopback-only published ports");

    const imageVariables = [
      ["CONTEXT_NOMINATIM_IMAGE", expectedImages.nominatim],
      ["CONTEXT_VALHALLA_IMAGE", expectedImages.valhalla],
      ["CONTEXT_PMTILES_IMAGE", expectedImages.pmtiles],
    ];
    const effectiveImages = imageVariables.map(([name, expected]) => [name, env[name] || expected, expected]);
    const unpinnedImages = effectiveImages.filter(([, value]) => !isPinnedImageReference(value)).map(([name]) => name);
    const overriddenImages = effectiveImages.filter(([, value, expected]) => value !== expected).map(([name]) => name);
    add("value.images", unpinnedImages.length ? "error" : overriddenImages.length ? "warning" : "ok", unpinnedImages.length
      ? `Image references must use an exact tag or sha256 digest: ${unpinnedImages.join(", ")}`
      : overriddenImages.length ? `Pinned operator image override(s) differ from versions.json: ${overriddenImages.join(", ")}` : "Effective sidecar images match versions.json");
  }

  const bindHost = String(env.CONTEXT_BIND_HOST || "127.0.0.1").trim().toLowerCase();
  const loopbackBind = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(bindHost);
  add("value.bind-host", loopbackBind ? "ok" : "warning", loopbackBind ? `Sidecars bind only to loopback (${bindHost})` : `CONTEXT_BIND_HOST=${bindHost || "<empty>"} can expose sidecars beyond this host; require firewall and an authenticated proxy`);

  const portSpecs = [["CONTEXT_NOMINATIM_PORT", 8080], ["CONTEXT_VALHALLA_PORT", 8002], ["CONTEXT_PMTILES_PORT", 8081]];
  const ports = portSpecs.map(([name, fallback]) => [name, parseInteger(env[name] || undefined, fallback, 1, 65_535)]);
  const invalidPorts = ports.filter(([, value]) => value === undefined).map(([name]) => name);
  const duplicatePorts = sortedUnique(ports.filter(([, value]) => value !== undefined && ports.filter(([, other]) => other === value).length > 1).map(([, value]) => value));
  add("value.ports", invalidPorts.length ? "error" : duplicatePorts.length ? "warning" : "ok", invalidPorts.length
    ? `Ports must be integers from 1 to 65535: ${invalidPorts.join(", ")}`
    : duplicatePorts.length ? `Sidecar host ports collide if their profiles run together: ${duplicatePorts.join(", ")}` : "Sidecar host ports are valid and distinct");

  const resourceSpecs = [["CONTEXT_NOMINATIM_THREADS", 4], ["CONTEXT_NOMINATIM_WORKERS", 2], ["CONTEXT_VALHALLA_THREADS", 2]];
  const invalidResources = resourceSpecs.filter(([name, fallback]) => parseInteger(env[name] || undefined, fallback, 1, 256) === undefined).map(([name]) => name);
  add("value.resources", invalidResources.length ? "error" : "ok", invalidResources.length ? `Worker/thread values must be integers from 1 to 256: ${invalidResources.join(", ")}` : "Worker/thread values are valid");

  const importStyle = env.CONTEXT_NOMINATIM_IMPORT_STYLE || "full";
  const validImportStyle = ["admin", "street", "address", "full", "extratags"].includes(importStyle);
  add("value.nominatim-import-style", validImportStyle ? "ok" : "error", validImportStyle ? `Nominatim import style is ${importStyle}` : "CONTEXT_NOMINATIM_IMPORT_STYLE must be admin, street, address, full, or extratags");

  const pmtilesArchive = env.CONTEXT_PMTILES_ARCHIVE || "region.pmtiles";
  const validArchiveName = basename(pmtilesArchive) === pmtilesArchive && /\.pmtiles$/i.test(pmtilesArchive);
  add("value.pmtiles-archive", validArchiveName ? "ok" : "error", validArchiveName ? `PMTiles archive name is valid (${pmtilesArchive})` : "CONTEXT_PMTILES_ARCHIVE must be a basename ending in .pmtiles");

  const publicUrl = env.CONTEXT_PMTILES_PUBLIC_URL || "http://127.0.0.1:8081";
  const publicUrlValidation = validateHttpUrl(publicUrl);
  add("url.context_pmtiles_public_url", publicUrlValidation.ok ? "ok" : "error", publicUrlValidation.ok ? `CONTEXT_PMTILES_PUBLIC_URL is a credential-free HTTP(S) URL (${safeUrlLabel(publicUrl)})` : `CONTEXT_PMTILES_PUBLIC_URL ${publicUrlValidation.reason}`);
  const cors = env.CONTEXT_PMTILES_CORS || "http://127.0.0.1:4577";
  const validCors = validateCorsOrigins(cors);
  add("url.context_pmtiles_cors", validCors ? "ok" : "error", validCors ? "CONTEXT_PMTILES_CORS contains valid HTTP(S) origins" : "CONTEXT_PMTILES_CORS must be a comma-separated list of credential-free HTTP(S) origins");

  let profiles = [];
  try { profiles = normalizeProfiles(options.profiles ?? env.COMPOSE_PROFILES); add("profiles", "ok", profiles.length ? `Selected profiles: ${profiles.join(", ")}` : "No sidecar profile selected; Hub remains operational with explicitly configured public sources and no built-in geocoder"); }
  catch (error) { add("profiles", "error", error.message); }
  const expandedProfiles = new Set(profiles.includes("all") ? ["nominatim", "valhalla", "pmtiles"] : profiles);

  const pbfValue = env.CONTEXT_PBF_FILE || "./runtime/imports/region.osm.pbf";
  if (expandedProfiles.has("nominatim") || expandedProfiles.has("valhalla")) {
    const path = resolveConfiguredPath(pbfValue, contextDir);
    const present = await fileInfo(path);
    const valid = present.exists && present.info.isFile() && present.info.size > 0 && /\.osm\.pbf$/i.test(path);
    add("artifact.pbf", valid ? "ok" : "error", valid ? `Local PBF is present (${visiblePath(path, repoRoot)})` : `Local PBF is missing, empty, not a file, or has the wrong extension (${visiblePath(path, repoRoot)})`);
  } else add("artifact.pbf", "skipped", "PBF is not needed without nominatim/valhalla profiles");

  if (expandedProfiles.has("nominatim")) add("secret.nominatim", env.CONTEXT_NOMINATIM_PASSWORD ? "ok" : "error", env.CONTEXT_NOMINATIM_PASSWORD ? "Nominatim database password is configured (value redacted)" : "CONTEXT_NOMINATIM_PASSWORD is required when the nominatim profile is selected");
  else add("secret.nominatim", "skipped", "Nominatim profile is not selected");

  if (expandedProfiles.has("valhalla")) {
    const path = resolveConfiguredPath(env.CONTEXT_VALHALLA_DIR || "./runtime/valhalla", contextDir);
    const present = await fileInfo(path);
    add("directory.valhalla", present.exists && present.info.isDirectory() ? "ok" : "error", present.exists && present.info.isDirectory() ? `Valhalla data directory exists (${visiblePath(path, repoRoot)})` : `Valhalla data directory is missing (${visiblePath(path, repoRoot)})`);
  } else add("directory.valhalla", "skipped", "Valhalla profile is not selected");

  if (expandedProfiles.has("pmtiles")) {
    const directory = resolveConfiguredPath(env.CONTEXT_PMTILES_DIR || "./runtime/pmtiles", contextDir);
    const archive = env.CONTEXT_PMTILES_ARCHIVE || "region.pmtiles";
    const validation = await validatePmtilesFile(join(directory, archive));
    add("artifact.pmtiles-sidecar", validation.ok ? "ok" : "error", validation.ok ? `PMTiles v${validation.specVersion} archive is valid (${visiblePath(join(directory, archive), repoRoot)})` : `PMTiles sidecar archive is invalid: ${validation.reason}`);
  } else add("artifact.pmtiles-sidecar", "skipped", "PMTiles sidecar profile is not selected");

  if (env.JARVIS_PMTILES_FILE) {
    const path = resolveConfiguredPath(env.JARVIS_PMTILES_FILE, repoRoot);
    const validation = await validatePmtilesFile(path);
    add("artifact.pmtiles-hub", validation.ok ? "ok" : "error", validation.ok ? `Hub PMTiles v${validation.specVersion} archive is valid (${visiblePath(path, repoRoot)})` : `JARVIS_PMTILES_FILE is invalid: ${validation.reason}`);
  } else add("artifact.pmtiles-hub", "skipped", "JARVIS_PMTILES_FILE is not set; list results remain available without a basemap");

  if (env.JARVIS_MAP_STYLE_FILE) {
    const path = resolveConfiguredPath(env.JARVIS_MAP_STYLE_FILE, repoRoot);
    const validation = await validateMapStyleFile(path);
    add("artifact.map-style", validation.ok ? "ok" : "error", validation.ok ? `MapLibre style is valid (${validation.sources} source(s), ${validation.layers} layer(s))` : `JARVIS_MAP_STYLE_FILE is invalid: ${validation.reason}`);
  } else add("artifact.map-style", "skipped", "JARVIS_MAP_STYLE_FILE is not set; Hub uses its network-free background style");

  if (env.JARVIS_HOME) {
    const path = resolveConfiguredPath(env.JARVIS_HOME, repoRoot);
    const present = await fileInfo(path);
    if (!present.exists) add("storage.jarvis-home", "warning", `JARVIS_HOME does not exist yet (${visiblePath(path, repoRoot)}); Hub may create it at startup`);
    else if (!present.info.isDirectory()) add("storage.jarvis-home", "error", "JARVIS_HOME must point to a directory");
    else {
      try { await access(path, fsConstants.R_OK | fsConstants.W_OK); add("storage.jarvis-home", "ok", `JARVIS_HOME is readable and writable (${visiblePath(path, repoRoot)})`); }
      catch { add("storage.jarvis-home", "error", "JARVIS_HOME is not readable and writable by this process"); }
    }
  } else add("storage.jarvis-home", "skipped", "JARVIS_HOME is not set; the normal user home is used");

  if (env.JARVIS_CONTEXT_TIMEZONE) {
    try { new Intl.DateTimeFormat("en", { timeZone: env.JARVIS_CONTEXT_TIMEZONE }).format(); add("value.timezone", "ok", `Time zone is valid (${env.JARVIS_CONTEXT_TIMEZONE})`); }
    catch { add("value.timezone", "error", "JARVIS_CONTEXT_TIMEZONE is not a valid IANA time zone"); }
  } else add("value.timezone", "skipped", "JARVIS_CONTEXT_TIMEZONE is not set; individual adapters use their documented defaults");
  if (env.JARVIS_EVENTS_FEED_FORMAT && !["ics", "rss", "jsonld"].includes(env.JARVIS_EVENTS_FEED_FORMAT)) add("value.events-format", "warning", "JARVIS_EVENTS_FEED_FORMAT should be ics, rss, or jsonld; other values fall back to JSON-LD");
  else add("value.events-format", "ok", env.JARVIS_EVENTS_FEED_FORMAT ? `Event feed format is ${env.JARVIS_EVENTS_FEED_FORMAT}` : "Event feed format is inferred/defaulted when a feed is configured");
  if (env.JARVIS_OCM_URL && !env.JARVIS_OCM_API_KEY) add("value.ocm", "warning", "JARVIS_OCM_URL is set without JARVIS_OCM_API_KEY; the optional Open Charge Map source stays disabled");
  else add("value.ocm", "ok", env.JARVIS_OCM_API_KEY ? "Optional Open Charge Map key is configured (value redacted)" : "Optional Open Charge Map source is disabled");
  if (env.JARVIS_PERSONAL_PROACTIVE !== undefined && !["0", "1"].includes(env.JARVIS_PERSONAL_PROACTIVE)) add("value.personal-proactive", "error", "JARVIS_PERSONAL_PROACTIVE must be 0 or 1 when set");
  else add("value.personal-proactive", "ok", env.JARVIS_PERSONAL_PROACTIVE === "0" ? "Personal proactive scheduler is globally disabled" : "Personal proactive scheduler is available only to opted-in devices");
  const proactiveInterval = env.JARVIS_PERSONAL_PROACTIVE_INTERVAL_MIN === undefined ? 5 : Number(env.JARVIS_PERSONAL_PROACTIVE_INTERVAL_MIN);
  if (!Number.isFinite(proactiveInterval) || proactiveInterval < 1 || proactiveInterval > 10_080) add("value.personal-proactive-interval", "error", "JARVIS_PERSONAL_PROACTIVE_INTERVAL_MIN must be between 1 and 10080 minutes");
  else add("value.personal-proactive-interval", "ok", `Personal proactive interval is ${proactiveInterval} minute(s)`);

  const urlSpecs = [
    ["JARVIS_NOMINATIM_URL", false], ["JARVIS_VALHALLA_URL", false], ["JARVIS_OVERPASS_URL", false],
    ["JARVIS_OPEN_METEO_URL", false], ["JARVIS_OCM_URL", true], ["JARVIS_MAPAS_CULTURAIS_URL", true], ["JARVIS_EVENTS_FEED_URL", true],
  ];
  const validUrls = new Map();
  for (const [name, allowQuery] of urlSpecs) {
    if (!env[name]) continue;
    const validation = validateHttpUrl(env[name], allowQuery);
    add(`url.${name.toLowerCase()}`, validation.ok ? "ok" : "error", validation.ok ? `${name} is a credential-free HTTP(S) URL (${safeUrlLabel(env[name])})` : `${name} ${validation.reason}`);
    if (validation.ok) validUrls.set(name, validation.url);
  }
  if (!env.JARVIS_NOMINATIM_URL) add("fallback.nominatim", "warning", "Nominatim is disabled; configure and consent an explicit endpoint to enable integrated geocoding");
  if (!env.JARVIS_OVERPASS_URL) add("fallback.overpass", "warning", "Nearby search uses the public Overpass endpoint unless another URL is configured and consented");
  if (!env.JARVIS_OPEN_METEO_URL) add("fallback.open-meteo", "warning", "Weather uses the public Open-Meteo endpoint unless another URL is configured and consented");
  if (validUrls.get("JARVIS_NOMINATIM_URL")?.hostname === "nominatim.openstreetmap.org" && !env.JARVIS_NOMINATIM_EMAIL) add("policy.nominatim-public", "warning", "Public Nominatim is configured without JARVIS_NOMINATIM_EMAIL; identify low-volume requests and follow the OSMF usage policy");

  const probes = [];
  if (validUrls.has("JARVIS_NOMINATIM_URL")) probes.push({ name: "nominatim", url: childUrl(env.JARVIS_NOMINATIM_URL, "status"), required: expandedProfiles.has("nominatim"), accepted: (status) => status >= 200 && status < 300 });
  if (validUrls.has("JARVIS_VALHALLA_URL")) probes.push({ name: "valhalla", url: childUrl(env.JARVIS_VALHALLA_URL, "status"), required: expandedProfiles.has("valhalla"), accepted: (status) => status >= 200 && status < 300 });
  if (validUrls.has("JARVIS_OVERPASS_URL")) probes.push({ name: "overpass", url: validUrls.get("JARVIS_OVERPASS_URL"), required: false, accepted: (status) => status >= 200 && status < 500 });
  if (validUrls.has("JARVIS_OPEN_METEO_URL")) {
    const url = new URL(validUrls.get("JARVIS_OPEN_METEO_URL"));
    url.search = new URLSearchParams({ latitude: "0", longitude: "0", current: "temperature_2m", forecast_days: "1" }).toString();
    probes.push({ name: "open-meteo", url, required: false, accepted: (status) => status >= 200 && status < 300 });
  }
  if (validUrls.has("JARVIS_MAPAS_CULTURAIS_URL")) probes.push({ name: "mapas-culturais", url: validUrls.get("JARVIS_MAPAS_CULTURAIS_URL"), required: false, accepted: (status) => status >= 200 && status < 500 });
  if (validUrls.has("JARVIS_EVENTS_FEED_URL")) probes.push({ name: "events-feed", url: validUrls.get("JARVIS_EVENTS_FEED_URL"), required: false, accepted: (status) => status >= 200 && status < 400 });
  for (const probe of probes) {
    if (options.offline) { add(`network.${probe.name}`, "skipped", "HTTP probe disabled by --offline"); continue; }
    const result = await probeHttp(probe.url, timeoutMs, fetcher, probe.accepted);
    add(`network.${probe.name}`, result.ok ? "ok" : probe.required ? "error" : "warning", result.ok ? `${probe.name} responded with HTTP ${result.status} in ${result.latencyMs} ms` : `${probe.name} is unavailable (${result.status ? `HTTP ${result.status}` : result.reason}); unrelated sources remain usable`);
  }
  if (env.JARVIS_OCM_URL && env.JARVIS_OCM_API_KEY) add("network.open-charge-map", "skipped", "Open Charge Map is not probed by doctor to avoid placing its secret in a diagnostic request");

  if (profiles.length || options.compose) {
    const commandRunner = options.commandRunner || commandResult;
    const commandEnv = { ...fileEnv, ...processEnv };
    const docker = await commandRunner("docker", ["version", "--format", "{{.Server.Version}}"], { cwd: repoRoot, env: commandEnv, timeoutMs });
    add("docker.daemon", docker.ok ? "ok" : profiles.length ? "error" : "warning", docker.ok ? "Docker daemon is reachable" : `Docker daemon is unavailable (${docker.error || `exit ${docker.code}`}); this is optional while no sidecar profile is active`);
    const compose = await commandRunner("docker", ["compose", "version", "--short"], { cwd: repoRoot, env: commandEnv, timeoutMs });
    add("docker.compose", compose.ok ? "ok" : "error", compose.ok ? "Docker Compose plugin is available" : `Docker Compose plugin is unavailable (${compose.error || `exit ${compose.code}`})`);
    if (compose.ok) {
      const args = ["compose"];
      if (envPresent.exists && envPresent.info.isFile()) args.push("--env-file", envFile);
      for (const profile of profiles) args.push("--profile", profile);
      args.push("-f", composeFile, "config", "--quiet");
      const configured = await commandRunner("docker", args, { cwd: repoRoot, env: commandEnv, timeoutMs });
      add("docker.compose-config", configured.ok ? "ok" : "error", configured.ok ? "Compose configuration renders successfully" : "Compose configuration is invalid; run docker compose config for details");
    } else add("docker.compose-config", "skipped", "Compose render skipped because the Compose plugin is unavailable");
  } else {
    add("docker.daemon", "skipped", "Docker checks are optional until a sidecar profile is selected; use --compose to force them");
    add("docker.compose", "skipped", "No sidecar profile selected");
    add("docker.compose-config", "skipped", "No sidecar profile selected");
  }

  const summary = summarize(checks, Boolean(options.strict));
  const configuredLocal = [env.JARVIS_NOMINATIM_URL, env.JARVIS_VALHALLA_URL, env.JARVIS_PMTILES_FILE].filter(Boolean).length;
  const mode = summary.error ? "invalid" : configuredLocal ? (summary.warning ? "self-hosted-degraded" : "self-hosted-ready") : "degraded-public-fallback";
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repoRoot,
    envFile,
    offline: Boolean(options.offline),
    strict: Boolean(options.strict),
    profiles,
    mode,
    checks,
    summary,
    exitCode: summary.passed ? 0 : 1,
  };
}

export function formatDoctorReport(report) {
  const marker = { ok: "OK", warning: "WARN", error: "FAIL", skipped: "SKIP" };
  const lines = ["Jarvis Context Engine doctor", `mode: ${report.mode} | profiles: ${report.profiles.join(",") || "none"}`];
  for (const check of report.checks) lines.push(`[${marker[check.status]}] ${check.id}: ${check.message}`);
  lines.push(`summary: ${report.summary.ok} ok, ${report.summary.warning} warning, ${report.summary.error} error, ${report.summary.skipped} skipped`);
  return lines.join("\n");
}

async function main() {
  let args;
  try { args = parseDoctorArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n\n${humanHelp()}\n`); process.exitCode = 2; return; }
  if (args.help) { process.stdout.write(`${humanHelp()}\n`); return; }
  try {
    const report = await runContextDoctor(args);
    process.stdout.write(args.json ? `${JSON.stringify(report)}\n` : `${formatDoctorReport(report)}\n`);
    process.exitCode = report.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, fatal: true, error: message })}\n`);
    else process.stderr.write(`Context doctor failed: ${message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
