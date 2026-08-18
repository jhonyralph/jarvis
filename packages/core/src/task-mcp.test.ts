/**
 * Fonte de tarefas por MCP (fatia E): allowlist da máquina, escolha do servidor, leitura
 * determinística do resultado e a listagem ponta a ponta com o cliente gerenciado real (SDK e
 * transporte injetados — nenhum processo sobe no CI).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Transport } from "@modelcontextprotocol/client";
import type { PersonalMcpSdkClient } from "./personal-mcp-client.js";
import { loadTaskMcpConfig, mapMcpTasks, pickTaskMcpServer, listMcpTasks, listTasksFromMcp, taskMcpConfigFile, type TaskMcpServer } from "./task-mcp.js";

const transport: Transport = { async start() {}, async close() {}, async send() {} };

class FakeSdk implements PersonalMcpSdkClient {
  calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  closed = 0;
  tools: Array<{ name: string; inputSchema: Record<string, unknown> }> = [{ name: "list_issues", inputSchema: { type: "object" } }];
  result: unknown = { structuredContent: { issues: [{ id: "PRI-1", title: "Uma tarefa", description: "detalhe" }] } };
  error?: Error;
  async connect(): Promise<void> {}
  async close(): Promise<void> { this.closed++; }
  async listTools(): Promise<any> { return { tools: this.tools }; }
  async listResources(): Promise<any> { return { resources: [] }; }
  async callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown> {
    this.calls.push(structuredClone(params));
    if (this.error) throw this.error;
    return structuredClone(this.result);
  }
  async readResource(): Promise<unknown> { return { contents: [] }; }
}

const stdioServer: TaskMcpServer = {
  label: "Linear local",
  transport: { kind: "stdio", command: "fake-mcp", secretEnv: { LINEAR_API_KEY: "JARVIS_SECRET_LINEAR" } },
  listTool: "list_issues",
  listArguments: { limit: 50 },
};

function withConfigFile(body: (file: string, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-task-mcp-"));
  try { mkdirSync(join(dir, ".jarvis"), { recursive: true }); body(join(dir, ".jarvis", "task-mcp.json"), dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Versão assíncrona: a síncrona apagaria a pasta com o teste ainda rodando (o `finally` corre antes
 *  do await) — e o arquivo "sumia" no meio da segunda chamada. */
async function withConfigFileAsync(body: (file: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-task-mcp-"));
  try { mkdirSync(join(dir, ".jarvis"), { recursive: true }); await body(join(dir, ".jarvis", "task-mcp.json")); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

/* ── allowlist da máquina ─────────────────────────────────────────────────────────────────────── */

test("MCP: arquivo ausente não é erro (a máquina só não tem fonte MCP)", () => {
  withConfigFile((file) => {
    const cfg = loadTaskMcpConfig(file);
    assert.deepEqual(cfg.servers, {});
    assert.equal(cfg.error, undefined);
  });
});

test("MCP: arquivo torto vira ERRO com o caminho — nunca 'nenhuma tarefa' em silêncio", () => {
  withConfigFile((file) => {
    writeFileSync(file, "{ isso não é json");
    const cfg = loadTaskMcpConfig(file);
    assert.match(cfg.error!, /não é um JSON válido/);
    assert.deepEqual(cfg.servers, {});

    writeFileSync(file, JSON.stringify({ outra: "coisa" }));
    assert.match(loadTaskMcpConfig(file).error!, /precisa de um objeto "servers"/);
  });
});

test("MCP: servidor sem comando/ferramenta é ignorado E denunciado", () => {
  withConfigFile((file) => {
    writeFileSync(file, JSON.stringify({ servers: {
      bom: { transport: { command: "fake" }, listTool: "list" },
      semTool: { transport: { command: "fake" } },
      semComando: { transport: {}, listTool: "list" },
    } }));
    const cfg = loadTaskMcpConfig(file);
    assert.deepEqual(Object.keys(cfg.servers), ["bom"]);
    assert.match(cfg.error!, /semTool/);
    assert.match(cfg.error!, /semComando/);
  });
});

test("MCP: transporte HTTP nasce restrito a loopback/LAN quando o arquivo não diz o contrário", () => {
  withConfigFile((file) => {
    writeFileSync(file, JSON.stringify({ servers: { api: { transport: { kind: "streamable-http", endpoint: "http://127.0.0.1:9000/mcp" }, listTool: "list" } } }));
    const t = loadTaskMcpConfig(file).servers.api.transport as any;
    assert.equal(t.kind, "streamable-http");
    assert.deepEqual(t.endpointPolicy, { allowLoopback: true, allowLan: true });
    assert.equal(t.profile, "read-only");
  });
});

test("MCP: escolha do servidor nunca adivinha entre vários", () => {
  const one = { servers: { linear: stdioServer } };
  assert.equal((pickTaskMcpServer(one) as any).name, "linear", "servidor único responde sem precisar de nome");
  assert.equal((pickTaskMcpServer(one, "linear") as any).name, "linear");

  const many = { servers: { linear: stdioServer, jira: stdioServer } };
  assert.match((pickTaskMcpServer(many) as any).error, /diga qual este projeto usa/);
  assert.match((pickTaskMcpServer(many, "outro") as any).error, /não tem servidor MCP de tarefas chamado "outro"/);
  assert.match((pickTaskMcpServer({ servers: {} }, "x") as any).error, /nenhum servidor MCP de tarefas configurado/);
  assert.match((pickTaskMcpServer({ servers: {} }) as any).error, new RegExp(taskMcpConfigFile().replace(/[\\/.]/g, ".")));
});

/* ── leitura do resultado (zero LLM) ──────────────────────────────────────────────────────────── */

test("MCP: structuredContent em array ou embrulhado vira lista de tarefas", () => {
  const direto = mapMcpTasks({ structuredContent: [{ id: "A-1", title: "Um" }] });
  assert.deepEqual(direto, [{ key: "A-1", title: "Um" }]);

  const embrulhado = mapMcpTasks({ structuredContent: { issues: [{ key: "B-2", name: "Dois", body: "corpo" }] } });
  assert.deepEqual(embrulhado, [{ key: "B-2", title: "Dois", description: "corpo" }]);
});

test("MCP: texto JSON também serve; texto livre é RECUSADO com motivo", () => {
  const json = mapMcpTasks({ content: [{ type: "text", text: JSON.stringify({ tasks: [{ id: 7, summary: "Sete" }] }) }] });
  assert.deepEqual(json, [{ key: "7", title: "Sete" }]);

  assert.throws(() => mapMcpTasks({ content: [{ type: "text", text: "Aqui estão suas tarefas: a primeira é..." }] }),
    /texto livre.*nenhum modelo interpreta isso aqui/s);
  assert.throws(() => mapMcpTasks({ content: [] }), /não devolveu dados de tarefa/);
  assert.throws(() => mapMcpTasks({ structuredContent: { total: 3 } }), /não encontrei a lista de tarefas/);
});

test("MCP: linhas sem identificação não viram tarefa fantasma, e duplicata não repete", () => {
  const out = mapMcpTasks({ structuredContent: [
    { id: "A-1", title: "Um" },
    { unrelated: true },
    { id: "A-1", title: "Um de novo" },
    { title: "Só título" },
  ] });
  assert.deepEqual(out.map((t) => t.key), ["A-1", "Só título"]);
  assert.throws(() => mapMcpTasks({ structuredContent: [{ unrelated: true }] }), /nenhuma linha tinha id\/título reconhecível/);
});

test("MCP: `fields` manda quando o servidor usa outros nomes", () => {
  const out = mapMcpTasks({ structuredContent: [{ ticket: "T-9", headline: "Nove", detalhe: "d" }] },
    { fields: { key: "ticket", title: "headline", description: "detalhe" } });
  assert.deepEqual(out, [{ key: "T-9", title: "Nove", description: "d" }]);
});

test("MCP: a lista tem teto (uma escolha, não um board paginado)", () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: `T-${i}`, title: `t${i}` }));
  assert.equal(mapMcpTasks({ structuredContent: rows }).length, 200);
  assert.equal(mapMcpTasks({ structuredContent: rows }, { max: 5 }).length, 5);
});

/* ── listagem ponta a ponta ───────────────────────────────────────────────────────────────────── */

test("MCP: listar por stdio passa pelo start autorizado, chama SÓ a ferramenta declarada e fecha", async () => {
  const sdk = new FakeSdk();
  const files = await listMcpTasks({ name: "linear", server: stdioServer, deps: {
    clientFactory: () => sdk, transportFactory: () => transport, resolveSecret: async () => "segredo-que-nao-sai-daqui",
  } });

  assert.deepEqual(files, [{ key: "PRI-1", title: "Uma tarefa", description: "detalhe" }]);
  assert.equal(sdk.calls.length, 1);
  assert.deepEqual(sdk.calls[0], { name: "list_issues", arguments: { limit: 50 } }, "só os argumentos declarados na máquina vão para o servidor");
  assert.equal(sdk.closed, 1, "o processo/conexão não fica pendurado depois da lista");
});

test("MCP: ferramenta fora da declarada é recusada pelo grant (o servidor não escolhe o que rodar)", async () => {
  const sdk = new FakeSdk();
  const server: TaskMcpServer = { ...stdioServer, listTool: "delete_everything" };
  sdk.tools = [{ name: "delete_everything", inputSchema: { type: "object" } }];
  // O grant é gerado a partir do que a MÁQUINA declarou; se o arquivo declara essa ferramenta, ela
  // roda — mas com risco "read" e argumentos mínimos. O que o servidor ANUNCIA nunca amplia nada:
  // uma ferramenta não declarada continua inalcançável.
  await assert.rejects(
    listMcpTasks({ name: "x", server: { ...server, listTool: "outra_qualquer" }, deps: { clientFactory: () => sdk, transportFactory: () => transport } }),
    /allowlisted MCP tool was not advertised|MCP tool is not allowlisted/,
  );
});

test("MCP: falha do servidor sobe com motivo e ainda assim fecha a conexão", async () => {
  const sdk = new FakeSdk();
  sdk.error = new Error("upstream 500");
  await assert.rejects(listMcpTasks({ name: "linear", server: stdioServer, deps: { clientFactory: () => sdk, transportFactory: () => transport } }), /upstream 500/);
  assert.equal(sdk.closed, 1);
});

test("MCP: resposta inútil do servidor vira erro acionável, não lista vazia", async () => {
  const sdk = new FakeSdk();
  sdk.result = { content: [{ type: "text", text: "não tenho nada para você hoje" }] };
  await assert.rejects(listMcpTasks({ name: "linear", server: stdioServer, deps: { clientFactory: () => sdk, transportFactory: () => transport } }), /texto livre/);
});

test("MCP: segredo sai do ambiente DESTA máquina e a falta dele diz qual variável falta", async () => {
  const sdk = new FakeSdk();
  const prior = process.env.JARVIS_TEST_MCP_SECRET;
  const server: TaskMcpServer = { ...stdioServer, transport: { kind: "stdio", command: "fake-mcp", secretEnv: { API_KEY: "JARVIS_TEST_MCP_SECRET" } } };
  // O transporte injetado recebe o MESMO resolvedor que o transporte real usaria: é por ele que o
  // valor do segredo entra no ambiente do processo do servidor, sem nunca sair desta máquina.
  let visto = "";
  const deps = { clientFactory: () => sdk, transportFactory: async (ctx: any) => { visto = await ctx.resolveSecret("JARVIS_TEST_MCP_SECRET"); return transport; } };
  try {
    delete process.env.JARVIS_TEST_MCP_SECRET;
    // Sem transporte injetado, a checagem prévia roda (e nada é spawnado: ela falha ANTES disso).
    // É essa mensagem que o dono lê — com o nome da variável, que a redação do cliente apagaria.
    await assert.rejects(listMcpTasks({ name: "x", server, deps: { clientFactory: () => sdk } }),
      /variável\(is\) de ambiente ausente\(s\).*JARVIS_TEST_MCP_SECRET/);

    process.env.JARVIS_TEST_MCP_SECRET = "valor-secreto";
    const files = await listMcpTasks({ name: "x", server, deps });
    assert.equal(files.length, 1, "com a variável presente, a listagem acontece");
    assert.equal(visto, "valor-secreto", "o segredo é resolvido no processo desta máquina");
  } finally {
    if (prior === undefined) delete process.env.JARVIS_TEST_MCP_SECRET; else process.env.JARVIS_TEST_MCP_SECRET = prior;
  }
});

test("MCP: TTL poupa subir o servidor de novo; refresh ignora o cache", async () => {
  await withConfigFileAsync(async (file) => {
    writeFileSync(file, JSON.stringify({ servers: { linear: { label: "Linear local", transport: { command: "fake-mcp" }, listTool: "list_issues", listArguments: { limit: 50 } } } }));
    const sdk = new FakeSdk();
    const deps = { clientFactory: () => sdk, transportFactory: () => transport };
    const cache = new Map<string, any>();
    let clock = 1_000;
    const call = (refresh?: boolean) => listTasksFromMcp({ file, deps, cache, refresh, now: () => clock }) as Promise<any>;

    const first = await call();
    assert.equal(first.label, "Linear local");
    assert.equal(first.cached, false);
    assert.equal(sdk.calls.length, 1);

    clock += 5_000;
    assert.equal((await call()).cached, true, "dentro do TTL a lista vem do cache");
    assert.equal(sdk.calls.length, 1, "não subiu o servidor de novo");

    assert.equal((await call(true)).cached, false);
    assert.equal(sdk.calls.length, 2, "refresh explícito sempre pergunta de novo");

    clock += 120_000;
    await call();
    assert.equal(sdk.calls.length, 3, "passado o TTL, a lista é buscada de novo");
  });
});

test("MCP: sem allowlist na máquina, a fonte devolve motivo com o caminho do arquivo", async () => {
  const out = await listTasksFromMcp({ file: taskMcpConfigFile("/maquina/sem/config"), wanted: "linear" });
  assert.ok("error" in out);
  assert.match((out as any).error, /não tem nenhum servidor MCP de tarefas configurado|não tem servidor MCP de tarefas chamado/);
});
