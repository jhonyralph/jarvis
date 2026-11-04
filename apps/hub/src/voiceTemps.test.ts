import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanVoiceTemps } from "./voiceTemps.js";
test("cleanup removes only old owned processing clips", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-temp-test-"));
  try {
    for (const name of ["jarvis_stt_123_1.webm", "jarvis_stt_123_2.webm", "family.wav", "jarvis_other.wav"]) writeFileSync(join(dir, name), "audio");
    utimesSync(join(dir, "jarvis_stt_123_1.webm"), 1, 1);
    assert.equal(cleanVoiceTemps(dir), 1);
    assert.ok(existsSync(join(dir, "jarvis_stt_123_2.webm")));
    assert.ok(existsSync(join(dir, "family.wav")));
    assert.equal(cleanVoiceTemps(dir), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
