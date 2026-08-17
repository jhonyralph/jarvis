/**
 * Foco por sessão no store de acompanhamentos (multi-tarefa, F3). Arquivo separado do teste
 * principal do run de propósito: workflow-run.test.ts está em edição por outra frente.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowRunStore } from "./workflow-run-store.js";
import { createRun } from "./workflow-run.js";
import type { WorkflowDefinition } from "./workflow.js";

const def: WorkflowDefinition = {
  schemaVersion: 1, id: "fluxo", name: "Fluxo", source: { kind: "manual" },
  steps: [
    { id: "a", title: "A", order: 0, kind: "step" },
    { id: "b", title: "B", order: 1, kind: "step" },
  ],
};

const mk = (store: WorkflowRunStore, runId: string, key: string, sessionId: string, now: number) =>
  store.put(createRun(def, { tracker: "jira", key }, { runId, now, sessionId }));

test("uma sessão gerencia N tarefas: lista completa, foco explícito e fallback seguro", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-wfr-focus-"));
  try {
    const store = new WorkflowRunStore({ dir });
    mk(store, "r1", "ABC-1", "sess", 1000);
    mk(store, "r2", "ABC-2", "sess", 2000);
    assert.equal(store.activeForSession("sess").length, 2);

    // Sem foco declarado: cai no comportamento antigo (o mais recente da sessão).
    assert.equal(store.focusedFor("sess")!.runId, "r2");

    store.setFocus("sess", "r1");
    assert.equal(store.focusedFor("sess")!.runId, "r1", "o foco vence a ordem por recência");
    assert.equal(new WorkflowRunStore({ dir }).focusedFor("sess")!.runId, "r1", "o foco sobrevive a restart");

    // Foco apontando para run encerrado nunca devolve run inválido.
    const r1 = store.get("r1")!;
    store.put({ ...r1, status: "done", updatedAt: 3000 });
    assert.equal(store.focusedFor("sess")!.runId, "r2");

    store.setFocus("sess", "inexistente");
    assert.equal(store.focusedFor("sess")!.runId, "r2", "runId desconhecido é ignorado");

    store.clearFocusOfRun("r1");
    const reread = new WorkflowRunStore({ dir });
    assert.equal(reread.focusedFor("sess")!.runId, "r2");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a compactação preserva o foco de runs mantidos e descarta o de runs removidos", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-wfr-focus-c-"));
  try {
    let clock = 1000;
    const store = new WorkflowRunStore({ dir, now: () => clock, retainClosedMs: 10 });
    mk(store, "vivo", "ABC-1", "sa", clock);
    mk(store, "morto", "ABC-2", "sb", clock);
    store.setFocus("sa", "vivo");
    store.setFocus("sb", "morto");
    const dead = store.get("morto")!;
    store.put({ ...dead, status: "abandoned", updatedAt: clock });
    clock += 1_000_000;                      // o encerrado sai por idade na compactação
    store.compact();

    const reread = new WorkflowRunStore({ dir });
    assert.equal(reread.focusedFor("sa")!.runId, "vivo", "foco de run mantido sobrevive à compactação");
    assert.equal(reread.get("morto"), undefined);
    assert.equal(reread.focusedFor("sb"), undefined, "foco órfão não renasce do journal compactado");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
