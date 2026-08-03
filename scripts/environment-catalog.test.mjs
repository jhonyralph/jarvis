import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  CATALOG_BY_NAME,
  DEFAULT_REPO_ROOT,
  ENVIRONMENT_CATALOG,
  auditRepository,
  renderDocumentation,
  renderEnvExample,
  scanRepository,
} from "./environment-catalog.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "jarvis-environment-catalog-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

test("catalog metadata is unique, complete and explicit about do-not-set entries", () => {
  assert.equal(new Set(ENVIRONMENT_CATALOG.map((entry) => entry.name)).size, ENVIRONMENT_CATALOG.length);
  assert.ok(ENVIRONMENT_CATALOG.length > 150);
  for (const entry of ENVIRONMENT_CATALOG) {
    for (const field of ["name", "group", "requirement", "classification", "scope", "defaultValue", "format", "secret", "provider", "cost", "configure", "description"]) {
      assert.equal(typeof entry[field], "string", entry.name + " missing " + field);
      assert.ok(entry[field].length > 0, entry.name + " has empty " + field);
    }
    if (["internal", "legacy", "os", "ci"].includes(entry.classification)) {
      assert.equal(entry.userSettable, false, entry.name + " must be marked do-not-set");
    }
    if (entry.userSettable) assert.ok(Object.hasOwn(entry, "example"), entry.name + " needs an example");
  }
  assert.equal(CATALOG_BY_NAME.get("JARVIS_OPENAI_API_KEY").classification, "legacy");
  assert.match(CATALOG_BY_NAME.get("JARVIS_WAKE_MODEL").description, /Overloaded/);
  assert.equal(CATALOG_BY_NAME.get("PATH").classification, "os");
  assert.equal(CATALOG_BY_NAME.get("PBF_PATH").classification, "internal");
});

test("scanner recognizes static APIs and ignores dynamically constructed names", async (t) => {
  const root = await fixture({
    "src/app.ts": [
      "const inherited = process.env;",
      "const merged = { ...inherited };",
      "void process.env.STATIC_NODE;",
      "void process.env['STATIC_BRACKET'];",
      "void process['env'].STATIC_PROCESS_BRACKET;",
      "const { STATIC_DESTRUCTURED, STATIC_RENAMED: renamed, [dynamicKey]: ignoredComputed, ...rest } = process.env;",
      "void process.env[prefix + suffix];",
      "function read(env = process.env) {",
      "  void env.STATIC_ALIAS;",
      "  void env[secretRef];",
      "}",
      "spawn('x', [], { env: { ...process.env, CHILD_SET: '1' } });",
      "const transport = { secretEnv: enabled ? { FIXED_SECRET: 'ref' } : undefined };",
      "const ordinary = { NOT_AN_ENV: true }; void ordinary.NOT_AN_ENV;",
      "// process.env.COMMENT_ONLY",
      "",
    ].join("\n"),
    "services/service.py": [
      "import os",
      "value = os.environ.get('STATIC_PYTHON')",
      "other = os.environ[dynamic_name]",
      "",
    ].join("\n"),
    "scripts/start.ps1": [
      "$value = $env:STATIC_POWERSHELL",
      "[Environment]::SetEnvironmentVariable('STATIC_PS_SET', '1', 'Process')",
      "[Environment]::SetEnvironmentVariable($dynamicName, '1', 'Process')",
      "",
    ].join("\n"),
    "scripts/start.sh": [
      "#!/usr/bin/env sh",
      "LOCAL_VALUE=inside",
      "echo \"$LOCAL_VALUE\"",
      "echo \"$" + "{STATIC_SHELL:-fallback}\"",
      "echo \"$HOME\"",
      "",
    ].join("\n"),
    "compose.yaml": [
      "services:",
      "  app:",
      "    image: $" + "{STATIC_COMPOSE:-example.invalid/app:1}",
      "    environment:",
      "      STATIC_CONTAINER: value",
      "      lower_container: value",
      "",
    ].join("\n"),
    ".github/workflows/release.yml": [
      "jobs:",
      "  release:",
      "    steps:",
      "      - run: echo ok >> \"$GITHUB_OUTPUT\"",
      "        env:",
      "          STATIC_WORKFLOW: value",
      "",
    ].join("\n"),
    "plugin/build.gradle": [
      "def version = System.getenv('STATIC_GRADLE')",
      "def dynamic = System.getenv(name)",
      "",
    ].join("\n"),
    "Dockerfile.fixture": [
      "FROM scratch",
      "ENV STATIC_DOCKER=value",
      "",
    ].join("\n"),
    ".env.runner.example": [
      "STATIC_DOTENV=value",
      "# COMMENTED_DOTENV=value",
      "",
    ].join("\n"),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const uses = await scanRepository(root);
  const expected = [
    "CHILD_SET",
    "FIXED_SECRET",
    "GITHUB_OUTPUT",
    "HOME",
    "STATIC_ALIAS",
    "STATIC_BRACKET",
    "STATIC_COMPOSE",
    "STATIC_CONTAINER",
    "STATIC_DESTRUCTURED",
    "STATIC_DOCKER",
    "STATIC_DOTENV",
    "STATIC_GRADLE",
    "STATIC_NODE",
    "STATIC_POWERSHELL",
    "STATIC_PROCESS_BRACKET",
    "STATIC_PS_SET",
    "STATIC_PYTHON",
    "STATIC_RENAMED",
    "STATIC_SHELL",
    "STATIC_WORKFLOW",
    "lower_container",
  ];
  assert.deepEqual([...uses.keys()], [...expected].sort((left, right) => left.localeCompare(right)));
  for (const ignored of ["COMMENTED_DOTENV", "COMMENT_ONLY", "LOCAL_VALUE", "NOT_AN_ENV", "dynamicKey", "dynamic_name", "ignoredComputed", "prefix", "rest", "secretRef"]) {
    assert.equal(uses.has(ignored), false, ignored + " is dynamic/local and must be ignored");
  }
});

test("a new static environment use is reported as uncatalogued", async (t) => {
  const root = await fixture({
    "src/new-env.mjs": "export const value = process.env.JARVIS_FUTURE_UNCATALOGUED;\n",
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const uses = await scanRepository(root);
  const missing = [...uses.keys()].filter((name) => !CATALOG_BY_NAME.has(name));
  assert.deepEqual(missing, ["JARVIS_FUTURE_UNCATALOGUED"]);
});

test("real repository has no catalog drift and generated artifacts are exact", async () => {
  const audit = await auditRepository(DEFAULT_REPO_ROOT);
  assert.deepEqual(audit.catalogProblems, []);
  assert.deepEqual(audit.missingCatalog, []);
  assert.deepEqual(audit.staleCatalog, []);
  assert.equal(audit.docsCurrent, true);
  assert.equal(audit.exampleCurrent, true);
  assert.equal(await readFile(join(DEFAULT_REPO_ROOT, "docs/environment.md"), "utf8"), renderDocumentation(audit.uses));
  assert.equal(await readFile(join(DEFAULT_REPO_ROOT, ".env.example"), "utf8"), renderEnvExample());
});

test("env example contains every user-settable name and no active assignment", () => {
  const example = renderEnvExample();
  const names = [...example.matchAll(/^# ([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((match) => match[1]);
  const expected = ENVIRONMENT_CATALOG.filter((entry) => entry.userSettable).map((entry) => entry.name);
  assert.deepEqual([...names].sort(), [...expected].sort());
  assert.equal(/^[A-Za-z_][A-Za-z0-9_]*=/m.test(example), false);
  for (const entry of ENVIRONMENT_CATALOG.filter((item) => !item.userSettable)) {
    assert.equal(names.includes(entry.name), false, entry.name + " must not be suggested in .env.example");
  }
});
