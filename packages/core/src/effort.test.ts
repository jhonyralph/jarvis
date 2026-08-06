/** Mapeamento do nível simplificado (médio/alto/máximo) para a escala real de cada IA. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEffortLevel, normalizeEffortLevel } from "./effort.js";

test("normalizeEffortLevel aceita pt/en e cai em medium", () => {
  assert.equal(normalizeEffortLevel("alto"), "high");
  assert.equal(normalizeEffortLevel("high"), "high");
  assert.equal(normalizeEffortLevel("máximo"), "max");
  assert.equal(normalizeEffortLevel("maximo"), "max");
  assert.equal(normalizeEffortLevel("max"), "max");
  assert.equal(normalizeEffortLevel("médio"), "medium");
  assert.equal(normalizeEffortLevel(undefined), "medium");
  assert.equal(normalizeEffortLevel("qualquer"), "medium");
});

test("resolveEffortLevel mapeia por nome quando a escala é conhecida", () => {
  const scale = ["low", "medium", "high"];
  assert.equal(resolveEffortLevel("medium", scale), "medium");
  assert.equal(resolveEffortLevel("high", scale), "high");
  assert.equal(resolveEffortLevel("max", scale), "high", "máximo = maior disponível quando não há 'max'");

  const full = ["minimal", "low", "medium", "high", "xhigh", "max"];
  assert.equal(resolveEffortLevel("max", full), "max");
  assert.equal(resolveEffortLevel("high", full), "high");
  assert.equal(resolveEffortLevel("medium", full), "medium");
});

test("resolveEffortLevel: sem escala cai no default; escala desconhecida usa posição", () => {
  assert.equal(resolveEffortLevel("high", [], "padrao-x"), "padrao-x");
  assert.equal(resolveEffortLevel("high", undefined), undefined);
  // vocabulário desconhecido, assumido ordenado do menor p/ o maior:
  const weird = ["calmo", "focado", "intenso", "extremo"];
  assert.equal(resolveEffortLevel("max", weird), "extremo");
  assert.equal(resolveEffortLevel("medium", weird), weird[Math.round(3 * 0.4)]);
});
