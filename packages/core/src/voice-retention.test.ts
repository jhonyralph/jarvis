import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAudioRetention, planAudioCleanup, DEFAULT_AUDIO_RETENTION, STALE_PENDING_MS, type StoredAudioInfo } from "./voice-retention.js";

const DAY = 24 * 60 * 60_000;
const MB = 1024 * 1024;
const now = 100 * DAY;
const item = (id: string, status: StoredAudioInfo["status"], ageMs: number, bytes = MB): StoredAudioInfo => ({ id, status, at: now - ageMs, bytes });

test("padrão: só até dar certo, 7 dias, 200 MB no Hub, 50 MB no aparelho, 32 kbit/s", () => {
  assert.deepEqual(normalizeAudioRetention(undefined), DEFAULT_AUDIO_RETENTION);
  assert.deepEqual(DEFAULT_AUDIO_RETENTION, { mode: "until_done", days: 7, maxMb: 200, deviceMb: 50, bitrate: 32_000 });
});

test("valores fora da faixa são presos aos limites; lixo cai no padrão", () => {
  const r = normalizeAudioRetention({ mode: "forever", days: 0, maxMb: 1e9, deviceMb: "x", bitrate: 1 });
  assert.equal(r.mode, "until_done");
  assert.equal(r.days, 1);
  assert.equal(r.maxMb, 10_000);
  assert.equal(r.deviceMb, 50);
  assert.equal(r.bitrate, 16_000);
});

test("só até dar certo: o transcrito sai na hora; falha fica até o prazo", () => {
  const policy = normalizeAudioRetention({});
  const ids = planAudioCleanup([item("ok", "done", 1_000), item("falhou-ontem", "failed", DAY), item("falhou-velho", "failed", 8 * DAY), item("agora", "pending", 1_000)], policy, now);
  assert.deepEqual(ids, ["ok", "falhou-velho"]);
});

test("guardar por N dias: o transcrito também fica até o prazo", () => {
  const policy = normalizeAudioRetention({ mode: "days", days: 3 });
  assert.deepEqual(planAudioCleanup([item("ok", "done", DAY), item("ok-velho", "done", 4 * DAY)], policy, now), ["ok-velho"]);
});

test("não guardar: apaga o que sobrou de antes", () => {
  assert.deepEqual(planAudioCleanup([item("a", "pending", 1), item("b", "failed", 1)], normalizeAudioRetention({ mode: "off" }), now), ["a", "b"]);
});

test("teto de espaço: apaga o que deu certo primeiro, depois o mais velho; pendente recente fica", () => {
  const policy = normalizeAudioRetention({ mode: "days", days: 30, maxMb: 10 });
  const items = [
    item("falha-velha", "failed", 5 * DAY, 4 * MB),
    item("ok-novo", "done", 1 * DAY, 4 * MB),
    item("falha-nova", "failed", 2 * DAY, 4 * MB),
    item("em-andamento", "pending", 1_000, 4 * MB),
  ];
  assert.deepEqual(planAudioCleanup(items, policy, now), ["falha-velha", "ok-novo"]);
});

test("pendente esquecido (processo caiu no meio) passa a poder ser apagado pelo teto", () => {
  const policy = normalizeAudioRetention({ mode: "days", days: 30, maxMb: 10 });
  const items = [item("esquecido", "pending", STALE_PENDING_MS + 1, 8 * MB), item("recente", "pending", 1_000, 8 * MB)];
  assert.deepEqual(planAudioCleanup(items, policy, now), ["esquecido"]);
});

test("teto do aparelho usa o mesmo plano com outro limite", () => {
  const policy = normalizeAudioRetention({ mode: "days", days: 30, maxMb: 500, deviceMb: 5 });
  const items = [item("a", "failed", 3 * DAY, 3 * MB), item("b", "failed", 1 * DAY, 3 * MB)];
  assert.deepEqual(planAudioCleanup(items, policy, now, policy.deviceMb), ["a"]);
  assert.deepEqual(planAudioCleanup(items, policy, now), []);
});
