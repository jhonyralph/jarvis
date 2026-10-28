import test from "node:test";
import assert from "node:assert/strict";

// O módulo define o teto na CARGA: o valor que importa é o do ambiente antes do import.
delete process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS;
delete process.env.JARVIS_CLAUDE_BG_WAIT_MIN;
const { claudeBackgroundWaitMs, CLAUDE_BG_WAIT_DEFAULT_MIN } = await import("./agents.js");

test("o Claude iniciado pelo Jarvis espera os agentes em segundo plano por 3 h, não 10 min", () => {
  assert.equal(CLAUDE_BG_WAIT_DEFAULT_MIN, 180);
  assert.equal(process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, String(180 * 60_000), "herdado por todo `claude` que o Jarvis inicia");
});

test("o teto é configurável em minutos e valor inválido volta ao padrão", () => {
  assert.equal(claudeBackgroundWaitMs({ JARVIS_CLAUDE_BG_WAIT_MIN: "45" }), 45 * 60_000);
  assert.equal(claudeBackgroundWaitMs({ JARVIS_CLAUDE_BG_WAIT_MIN: "0" }), 180 * 60_000);
  assert.equal(claudeBackgroundWaitMs({ JARVIS_CLAUDE_BG_WAIT_MIN: "abc" }), 180 * 60_000);
  assert.equal(claudeBackgroundWaitMs({}), 180 * 60_000);
});
