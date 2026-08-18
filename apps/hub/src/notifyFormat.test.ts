import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_LIMITS,
  cleanNotifyText,
  formatGroupedPushPayload,
  formatPushPayload,
  payloadBytes,
} from "./notifyFormat.js";

test("cleanNotifyText strips markdown, control chars, and collapses whitespace", () => {
  assert.equal(cleanNotifyText("## **Feito**  `ok`\n\nlinha _dois_\u0007"), "Feito ok linha dois");
  assert.equal(cleanNotifyText("[arquivo](https://example.test/a)"), "arquivo");
  assert.equal(cleanNotifyText(undefined as any), "");
});

test("done notification body is an objective summary (first sentence), never the session id nor the full reply", () => {
  const longReply = "Resumo detalhado com muitas linhas. ".repeat(40) + "TOKEN-CARO-QUE-NAO-DEVE-APARECER";
  const p = formatPushPayload("done", "claude · sessão concluída", longReply, "claude:1c0fac7e-f9dd-4f2c-81e1-6e348bc05e17");

  assert.equal(p.title, "Jarvis · concluído");
  assert.equal(p.sid, "claude:1c0fac7e-f9dd-4f2c-81e1-6e348bc05e17"); // sid stays in the payload for deep-link, not in the text
  assert.match(p.body, /^Resumo detalhado com muitas linhas\./); // objective: what was worked on
  assert.doesNotMatch(p.body, /resultado pronto|Toque para abrir/i); // no generic filler
  assert.doesNotMatch(p.body, /1c0fac7e|claude:/); // no session id in the visible text
  assert.doesNotMatch(p.body, /TOKEN-CARO/); // still never the full reply
  assert.ok(payloadBytes(p) <= NOTIFICATION_LIMITS.jarvisSoftPayloadBytes);
});

test("error notifications keep the useful context but stay compact", () => {
  const p = formatPushPayload("error", "Rotina longa · falhou", "Erro ".repeat(80), "abc");

  assert.equal(p.title, "Jarvis · falhou");
  assert.match(p.body, /^Rotina longa: /);
  assert.ok([...p.body].length <= NOTIFICATION_LIMITS.bodyChars);
  assert.ok(payloadBytes(p) <= NOTIFICATION_LIMITS.jarvisSoftPayloadBytes);
});

test("grouped notifications summarize the latest events within the soft payload budget", () => {
  const p = formatGroupedPushPayload([
    { kind: "done", title: "A", body: "" },
    { kind: "error", title: "B", body: "erro" },
    { kind: "machine", title: "C", body: "offline" },
    { kind: "done", title: "D", body: "" },
    { kind: "error", title: "E", body: "falha" },
  ]);

  assert.equal(p.title, "Jarvis · 5 eventos");
  assert.match(p.body, /Falha: B/);
  assert.match(p.body, /Falha: E/);
  assert.doesNotMatch(p.body, /^Ok: A/);
  assert.ok(payloadBytes(p) <= NOTIFICATION_LIMITS.jarvisSoftPayloadBytes);
});

// TSK-10: o texto tem que dizer que o trabalho PAROU esperando decisão. "Concluído" é a mensagem
// errada — foi exatamente o que confundiu o usuário: sessão travada anunciada como pronta.
test("payload de ask fala em decisão esperando, não em conclusão", () => {
  const payload = formatPushPayload("ask", "Refatorar o cofre", "2 decisões esperando você", "s-1");
  assert.match(payload.title, /decis/i, "o título precisa dizer do que se trata");
  assert.doesNotMatch(payload.title, /conclu/i, "não pode se passar por aviso de conclusão");
  assert.match(payload.body, /Refatorar o cofre/, "diz QUAL sessão está esperando");
});
