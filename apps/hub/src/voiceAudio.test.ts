import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeAudioRetention } from "@jarvis/core";
import { VoiceAudioStore } from "./voiceAudio.js";

function store() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-voice-audio-"));
  return { dir, s: new VoiceAudioStore(join(dir, "voice-audio")), done: () => rmSync(dir, { recursive: true, force: true }) };
}
const base = { ext: "webm", sessionId: "s1", runnerId: "local", principal: "owner", opts: { speak: true } };

test("guarda antes de processar e devolve o mesmo áudio para reprocessar", () => {
  const { s, done } = store();
  try {
    assert.equal(s.save({ ...base, id: "vt_abc123" }, Buffer.from("audio-bytes")), true);
    assert.equal(s.get("vt_abc123")?.status, "pending");
    assert.equal(s.audio("vt_abc123")?.toString(), "audio-bytes");
    s.mark("vt_abc123", "failed", "STT: tempo esgotado");
    assert.equal(s.get("vt_abc123")?.status, "failed");
    assert.equal(s.get("vt_abc123")?.error, "STT: tempo esgotado");
    assert.deepEqual(s.get("vt_abc123")?.opts, { speak: true });
  } finally { done(); }
});

test("id ou extensão maliciosos não escapam da pasta", () => {
  const { s, dir, done } = store();
  try {
    assert.equal(s.save({ ...base, id: "../../x" }, Buffer.from("a")), false);
    assert.equal(s.get("../../x"), undefined);
    assert.equal(s.save({ ...base, id: "vt_ok12345", ext: "../cmd" }, Buffer.from("a")), true);
    assert.equal(s.get("vt_ok12345")?.ext, "webm");
    assert.equal(existsSync(join(dir, "x.audio")), false);
  } finally { done(); }
});

test("varredura: no padrão, o transcrito some e a falha recente fica", () => {
  const { s, done } = store();
  try {
    s.save({ ...base, id: "vt_ok000001" }, Buffer.from("a")); s.mark("vt_ok000001", "done");
    s.save({ ...base, id: "vt_fail0001" }, Buffer.from("b")); s.mark("vt_fail0001", "failed");
    assert.equal(s.sweep(normalizeAudioRetention({})), 1);
    assert.deepEqual(s.list().map((i) => i.id), ["vt_fail0001"]);
  } finally { done(); }
});

test("áudio solto, sem metadado, entra na lista como falha e é limpo pela retenção", () => {
  const { s, dir, done } = store();
  try {
    s.save({ ...base, id: "vt_x000001" }, Buffer.from("a"));
    rmSync(join(dir, "voice-audio", "vt_x000001.json"));
    writeFileSync(join(dir, "voice-audio", "solto123.audio"), "zz");
    const ids = s.list().map((i) => i.id).sort();
    assert.deepEqual(ids, ["solto123", "vt_x000001"]);
    assert.equal(s.sweep(normalizeAudioRetention({ mode: "off" })), 2);
    assert.deepEqual(s.list(), []);
  } finally { done(); }
});

test("pasta inexistente: listar e varrer não quebram", () => {
  const s = new VoiceAudioStore(join(tmpdir(), "nao-existe-" + Date.now()));
  assert.deepEqual(s.list(), []);
  assert.equal(s.sweep(normalizeAudioRetention({})), 0);
});
