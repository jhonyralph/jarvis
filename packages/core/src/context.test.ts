import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextManifest, ContextManifestStore, discoverInstructionFiles } from "./context.js";

test("context manifest exposes candidates and counts without persisting prompt text", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-context-"));
  try {
    const cwd = join(root, "apps", "hub"); mkdirSync(cwd, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "root instructions");
    writeFileSync(join(cwd, "AGENTS.md"), "cwd instructions");
    const candidates = discoverInstructionFiles(cwd, "mock");
    assert.deepEqual(candidates.map((entry) => entry.scope), ["cwd", "ancestor"]);
    assert.ok(candidates.every((entry) => entry.providerLoad === "candidate" && entry.sha256.length === 64));

    const manifest = buildContextManifest({
      turnId: "turn-1", sessionId: "session-1", runnerId: "local", agent: "mock", cwd,
      continuity: "jarvis_history", history: [{ text: "old" }], showText: "user secret", agentText: "expanded secret",
      files: [{ name: "a.txt", content: "abc" }], actor: { userId: "u1", source: "user" },
    });
    assert.equal(manifest.semanticMemory.injected, false);
    assert.equal(manifest.continuity.historyChars, 3);
    assert.equal(manifest.prompt.transformed, true);
    assert.equal(manifest.prompt.agentSha256.length, 64);
    assert.doesNotMatch(JSON.stringify(manifest), /user secret|expanded secret/);

    const audit = new ContextManifestStore(root);
    audit.append(manifest);
    assert.equal(existsSync(audit.path), true);
    assert.doesNotMatch(readFileSync(audit.path, "utf8"), /secret/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
