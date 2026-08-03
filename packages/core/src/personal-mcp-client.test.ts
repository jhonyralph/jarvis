import test from "node:test";
import assert from "node:assert/strict";
import type { Transport } from "@modelcontextprotocol/client";
import {
  ManagedPersonalMcpClient,
  assertAllowedPersonalEndpoint,
  createMcpStdioStartActionExecutor,
  createMcpToolContextSource,
  createRestrictedPersonalFetch,
  resolveAllowedPersonalEndpoint,
  type PersonalMcpClientConfig,
  type PersonalMcpSdkClient,
} from "./personal-mcp-client.js";
import { PersonalActionManager } from "./personal-actions.js";
import { emptyPersonalContextState } from "./personal-context.js";

const transport: Transport = {
  async start() {},
  async close() {},
  async send() {},
};

class FakeMcpClient implements PersonalMcpSdkClient {
  connectCalls = 0;
  closeCalls = 0;
  callParams: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
  }> = [];
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }> = [];
  toolResult: unknown = { content: [{ type: "text", text: "ok" }] };
  resourceResult?: unknown;
  toolError?: Error;

  async connect(): Promise<void> { this.connectCalls++; }
  async close(): Promise<void> { this.closeCalls++; }
  async listTools(): Promise<{ tools: FakeMcpClient["tools"] }> { return { tools: this.tools }; }
  async listResources(): Promise<{ resources: FakeMcpClient["resources"] }> { return { resources: this.resources }; }
  async callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown> {
    this.callParams.push(structuredClone(params));
    if (this.toolError) throw this.toolError;
    return structuredClone(this.toolResult);
  }
  async readResource(params: { uri: string }): Promise<unknown> {
    return this.resourceResult ?? { contents: [{ uri: params.uri, mimeType: "application/json", text: "{}" }] };
  }
}

const inputSchema = {
  type: "object",
  properties: { query: { type: "string", minLength: 1 } },
  required: ["query"],
  additionalProperties: false,
};

function config(overrides: Partial<PersonalMcpClientConfig> = {}): PersonalMcpClientConfig {
  return {
    id: "test",
    transport: { kind: "stdio", command: "fake-mcp" },
    tools: [{ name: "lookup", risk: "read", allowedArguments: ["query"], inputSchema }],
    resources: [],
    ...overrides,
  };
}

function managed(fake: FakeMcpClient, overrides: Partial<PersonalMcpClientConfig> = {}): ManagedPersonalMcpClient {
  return new ManagedPersonalMcpClient(config(overrides), {
    clientFactory: () => fake,
    transportFactory: () => transport,
  });
}

async function startStdio(client: ManagedPersonalMcpClient): Promise<void> {
  const executor = createMcpStdioStartActionExecutor({ client, kind: "mcp:test:stdio.start", impact: "Start test MCP" });
  await executor.execute({}, { principalId: "test", signal: new AbortController().signal });
}

test("managed MCP enforces Jarvis tool grants and ignores server annotations as authority", async () => {
  const fake = new FakeMcpClient();
  fake.tools = [
    { name: "lookup", inputSchema, annotations: { readOnlyHint: false } },
    { name: "delete_everything", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
  ];
  const client = managed(fake);
  await startStdio(client);

  await assert.rejects(() => client.callTool("delete_everything", { query: "x" }), /not allowlisted/);
  assert.equal(fake.callParams.length, 0);
  await client.callTool("lookup", { query: "cafe", ignored: "not sent" });
  assert.deepEqual(fake.callParams[0], { name: "lookup", arguments: { query: "cafe" } });
  await client.close();
  assert.equal(client.state, "awaiting_start");
  assert.equal(fake.connectCalls, 1);
  assert.equal(fake.closeCalls, 1);
});

test("MCP action grants require the Jarvis-configured risk even when annotations claim read-only", async () => {
  const fake = new FakeMcpClient();
  fake.tools = [{ name: "switch_on", inputSchema, annotations: { readOnlyHint: true } }];
  const client = managed(fake, {
    tools: [{ name: "switch_on", risk: "local_reversible", allowedArguments: ["query"], inputSchema }],
  });
  await startStdio(client);
  await assert.rejects(() => client.callTool("switch_on", { query: "kitchen" }), /risk approval/);
  await client.callTool("switch_on", { query: "kitchen" }, { approvedRisk: "local_reversible" });
  assert.equal(fake.callParams.length, 1);
  await client.close();
});

test("MCP rejects schema violations, oversized arguments, results, and advertised schemas", async () => {
  const fake = new FakeMcpClient();
  fake.tools = [{ name: "lookup", inputSchema }];
  fake.toolResult = { content: [{ type: "text", text: "x".repeat(500) }] };
  const client = managed(fake, {
    maxPayloadBytes: 160,
    tools: [{ name: "lookup", risk: "read", allowedArguments: ["query"], inputSchema, maxResultBytes: 120 }],
  });
  await startStdio(client);
  await assert.rejects(() => client.callTool("lookup", { query: 42 }), /failed policy schema/);
  await assert.rejects(() => client.callTool("lookup", { query: "x".repeat(500) }), /exceeds 160 bytes/);
  await assert.rejects(() => client.callTool("lookup", { query: "ok" }), /result.*exceeds 120 bytes/);
  await client.close();

  const oversized = new FakeMcpClient();
  oversized.tools = [{ name: "lookup", inputSchema: { ...inputSchema, description: "x".repeat(2_000) } }];
  const schemaClient = managed(oversized, { maxSchemaBytes: 512 });
  await assert.rejects(() => startStdio(schemaClient), /server schema.*exceeds 512 bytes/);
  assert.equal(schemaClient.state, "awaiting_start");
  assert.equal(oversized.closeCalls, 1);
});

test("resolved MCP secrets are absent from returned content and errors", async () => {
  const secret = "ultra-secret-value";
  const fake = new FakeMcpClient();
  fake.tools = [{ name: "lookup", inputSchema }];
  fake.toolResult = {
    content: [{ type: "text", text: `server echoed ${secret}` }],
    structuredContent: { authorization: secret, value: secret },
  };
  const client = new ManagedPersonalMcpClient(config({
    transport: { kind: "stdio", command: "fake-mcp", secretEnv: { HA_TOKEN: "ha-token" } },
  }), {
    resolveSecret: () => secret,
    clientFactory: () => fake,
    transportFactory: async ({ resolveSecret }) => { await resolveSecret("ha-token"); return transport; },
  });
  await startStdio(client);
  const result = await client.callTool("lookup", { query: "ok" });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.match(serialized, /REDACTED/);

  fake.toolError = new Error(`remote leaked ${secret}`);
  await assert.rejects(
    () => client.callTool("lookup", { query: "fail" }),
    (error: Error) => !error.message.includes(secret) && error.message.includes("REDACTED"),
  );
  await client.close();
});

test("MCP resources require an exact URI grant and enforce declared MIME types", async () => {
  const uri = "ha://states/temperature";
  const fake = new FakeMcpClient();
  fake.resources = [{ uri, mimeType: "application/json" }];
  const client = managed(fake, {
    tools: [],
    resources: [{ uri, mimeTypes: ["application/json"] }],
  });
  await startStdio(client);
  await assert.rejects(() => client.readResource("ha://states/door"), /not allowlisted/);
  assert.deepEqual(await client.readResource(uri), {
    contents: [{ uri, mimeType: "application/json", text: "{}" }],
  });
  fake.resourceResult = { contents: [{ uri, mimeType: "text/plain", text: "no" }] };
  await assert.rejects(() => client.readResource(uri), /forbidden MIME type/);
  await client.close();
});

test("MCP stdio lifecycle fails back to awaiting_start when client construction fails", async () => {
  const client = new ManagedPersonalMcpClient(config(), {
    clientFactory: () => { throw new Error("factory failed"); },
    transportFactory: () => transport,
  });
  await assert.rejects(() => startStdio(client), /factory failed/);
  assert.equal(client.state, "awaiting_start");
});

test("stdio queries cannot spawn and only a confirmed consequential shell ActionPlan starts MCP", async () => {
  const secret = "resolved-secret-value";
  const plainEnvironmentValue = "environment-value-that-must-not-leak";
  const fake = new FakeMcpClient();
  fake.tools = [{ name: "lookup", inputSchema }];
  let transportCreations = 0;
  let secretResolutions = 0;
  const client = new ManagedPersonalMcpClient(config({
    transport: {
      kind: "stdio",
      command: "local-mcp-server",
      args: ["--mode", "personal"],
      cwd: "C:\\work\\personal-mcp",
      env: { REGION: plainEnvironmentValue },
      secretEnv: { API_TOKEN: "MCP_SECRET_REF" },
    },
  }), {
    resolveSecret: (secretRef) => {
      secretResolutions++;
      assert.equal(secretRef, "MCP_SECRET_REF");
      return secret;
    },
    clientFactory: () => fake,
    transportFactory: async ({ resolveSecret }) => {
      transportCreations++;
      await resolveSecret("MCP_SECRET_REF");
      return transport;
    },
  });
  const source = createMcpToolContextSource({
    client,
    descriptor: {
      id: "local-mcp",
      label: "Local MCP",
      purposes: ["events"],
      costClass: "local",
      transport: "stdio",
      certification: "first_party",
    },
    toolName: "lookup",
    buildArguments: () => ({ query: "events" }),
    mapResult: () => [],
  });

  assert.equal(client.state, "awaiting_start");
  await assert.rejects(
    () => source.query(
      { principalId: "alice", purpose: "events" },
      { fetch, now: Date.now, signal: new AbortController().signal },
    ),
    /awaiting an approved start action/,
  );
  assert.equal(transportCreations, 0);
  assert.equal(secretResolutions, 0);
  assert.equal(fake.connectCalls, 0);

  const executor = createMcpStdioStartActionExecutor({
    client,
    kind: "mcp:local-mcp:stdio.start",
    impact: "Start local MCP process",
  });
  assert.equal(executor.risk, "consequential");
  assert.deepEqual(executor.preview({}), {
    type: "shell",
    operation: "mcp_stdio_start",
    command: "local-mcp-server",
    cwd: "C:\\work\\personal-mcp",
    configuredEnvNames: ["API_TOKEN", "REGION"],
    impact: "Start local MCP process",
    state: "awaiting_start",
  });
  const serializedPreview = JSON.stringify(executor.preview({}));
  assert.doesNotMatch(serializedPreview, new RegExp(secret));
  assert.doesNotMatch(serializedPreview, new RegExp(plainEnvironmentValue));
  assert.doesNotMatch(serializedPreview, /MCP_SECRET_REF/);
  assert.throws(() => executor.preview({ hidden: true }), /does not accept payload fields/);

  let state = emptyPersonalContextState("alice", 1_000);
  const manager = new PersonalActionManager({
    get(principalId) {
      assert.equal(principalId, "alice");
      return structuredClone(state);
    },
    putAction(principalId, action) {
      assert.equal(principalId, "alice");
      state = {
        ...state,
        revision: state.revision + 1,
        actions: [...state.actions.filter((row) => row.id !== action.id), structuredClone(action)],
      };
      return structuredClone(state);
    },
  }, { now: () => 1_000 });
  manager.register(executor);
  const plan = manager.preview("alice", executor.kind, {});
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.risk, "consequential");
  await assert.rejects(() => manager.execute("alice", plan.id), /confirmation required/);
  assert.equal(transportCreations, 0);
  assert.equal(secretResolutions, 0);
  assert.equal(fake.connectCalls, 0);

  const approved = manager.approve("alice", plan.id, plan.confirmationChallenge!);
  const completed = await manager.execute("alice", approved.id);
  assert.equal(completed.state, "succeeded");
  assert.deepEqual(completed.result, { transport: "stdio", state: "connected" });
  assert.equal(client.state, "connected");
  assert.equal(transportCreations, 1);
  assert.equal(secretResolutions, 1);
  assert.equal(fake.connectCalls, 1);
  assert.deepEqual(await source.query(
    { principalId: "alice", purpose: "events" },
    { fetch, now: Date.now, signal: new AbortController().signal },
  ), []);
  assert.equal(transportCreations, 1);
  assert.equal(fake.connectCalls, 1);
  await client.close();
  assert.equal(client.state, "awaiting_start");
  await assert.rejects(
    () => source.query(
      { principalId: "alice", purpose: "events" },
      { fetch, now: Date.now, signal: new AbortController().signal },
    ),
    /awaiting an approved start action/,
  );
  assert.equal(transportCreations, 1);
  assert.equal(fake.connectCalls, 1);
});

test("stdio discovery never spawns and returns only configured allowlists while awaiting start", async () => {
  const fake = new FakeMcpClient();
  let clientCreations = 0;
  let transportCreations = 0;
  let secretResolutions = 0;
  const client = new ManagedPersonalMcpClient(config({
    transport: {
      kind: "stdio",
      command: "must-not-spawn",
      env: { REGION: "private-environment-value" },
      secretEnv: { API_TOKEN: "SECRET_REFERENCE" },
    },
    resources: [{ uri: "context://allowed" }],
  }), {
    resolveSecret: () => { secretResolutions++; return "private-secret"; },
    clientFactory: () => { clientCreations++; return fake; },
    transportFactory: () => { transportCreations++; return transport; },
  });

  const discovery = await client.discover(new AbortController().signal);
  assert.equal(discovery.state, "awaiting_start");
  assert.equal(discovery.health, "unknown");
  assert.equal(discovery.latencyMs, undefined);
  assert.deepEqual(discovery.tools, [{ id: "lookup", name: "lookup", allowed: true, advertised: false }]);
  assert.deepEqual(discovery.resources, [{ id: "context://allowed", href: "context://allowed", allowed: true, advertised: false }]);
  assert.deepEqual({ clientCreations, transportCreations, secretResolutions, connectCalls: fake.connectCalls }, {
    clientCreations: 0,
    transportCreations: 0,
    secretResolutions: 0,
    connectCalls: 0,
  });
});

test("explicit HTTP discovery connects once and returns bounded redacted advertised and allowed metadata", async () => {
  const secret = "resolved-http-secret";
  const fake = new FakeMcpClient();
  fake.tools = [
    { name: "lookup", description: `Allowed ${secret} from HTTP_TOKEN`, inputSchema, annotations: { secret } },
    ...Array.from({ length: 101 }, (_, index) => ({
      name: `advertised-${String(index).padStart(3, "0")}`,
      description: "x".repeat(700),
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    })),
  ];
  fake.resources = [
    { uri: "context://allowed", name: `Allowed ${secret}`, description: `Bearer ${secret}`, mimeType: "application/json" },
    ...Array.from({ length: 101 }, (_, index) => ({ uri: `context://resource-${index}`, name: `Resource ${index}`, mimeType: "text/plain" })),
  ];
  let clientCreations = 0;
  let transportCreations = 0;
  let secretResolutions = 0;
  const client = new ManagedPersonalMcpClient(config({
    transport: {
      kind: "streamable-http",
      endpoint: "https://127.0.0.1:8123/mcp",
      profile: "read-only",
      certification: "audited",
      endpointPolicy: { allowLoopback: true },
      authorizationSecretRef: "HTTP_TOKEN",
    },
    resources: [{ uri: "context://allowed", mimeTypes: ["application/json"] }],
  }), {
    resolveSecret: (secretRef) => {
      secretResolutions++;
      assert.equal(secretRef, "HTTP_TOKEN");
      return secret;
    },
    clientFactory: () => { clientCreations++; return fake; },
    transportFactory: async ({ resolveSecret }) => {
      transportCreations++;
      await resolveSecret("HTTP_TOKEN");
      return transport;
    },
  });

  assert.deepEqual({ state: client.state, clientCreations, transportCreations, secretResolutions, connectCalls: fake.connectCalls }, {
    state: "disconnected",
    clientCreations: 0,
    transportCreations: 0,
    secretResolutions: 0,
    connectCalls: 0,
  });
  const discovery = await client.discover(new AbortController().signal);
  assert.equal(discovery.sourceId, "test");
  assert.equal(discovery.state, "connected");
  assert.equal(discovery.health, "healthy");
  assert.equal(typeof discovery.latencyMs, "number");
  assert.equal(discovery.tools.length, 100);
  assert.equal(discovery.resources.length, 100);
  assert.deepEqual(discovery.truncated, { calendars: false, tools: true, resources: true });
  assert.equal(discovery.tools[0]?.id, "lookup");
  assert.equal(discovery.tools[0]?.allowed, true);
  assert.equal(discovery.tools[0]?.advertised, true);
  assert.equal(discovery.tools[0]?.description, "Allowed [REDACTED] from [REDACTED]");
  assert.equal(discovery.resources[0]?.href, "context://allowed");
  assert.equal(discovery.resources[0]?.allowed, true);
  assert.equal(discovery.resources[0]?.advertised, true);
  assert.equal(discovery.resources[0]?.mime, "application/json");
  assert.equal(discovery.tools.every((tool) => !tool.description || tool.description.length <= 500), true);
  const serialized = JSON.stringify(discovery);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /HTTP_TOKEN/);
  assert.doesNotMatch(serialized, /inputSchema|outputSchema|annotations|properties/);
  assert.deepEqual({ clientCreations, transportCreations, secretResolutions, connectCalls: fake.connectCalls }, {
    clientCreations: 1,
    transportCreations: 1,
    secretResolutions: 1,
    connectCalls: 1,
  });
  await client.close();
});

test("streamable HTTP MCP keeps implicit connect behavior", async () => {
  const fake = new FakeMcpClient();
  fake.tools = [{ name: "lookup", inputSchema }];
  const client = new ManagedPersonalMcpClient(config({
    transport: {
      kind: "streamable-http",
      endpoint: "https://127.0.0.1:8123/mcp",
      profile: "read-only",
      certification: "audited",
      endpointPolicy: { allowLoopback: true },
    },
  }), {
    clientFactory: () => fake,
    transportFactory: () => transport,
  });
  assert.equal(client.state, "disconnected");
  await client.connect();
  assert.equal(client.state, "connected");
  assert.equal(fake.connectCalls, 1);
  await client.close();
  assert.equal(client.state, "disconnected");
});

test("personal endpoint policy blocks SSRF targets and requires explicit local-network grants", () => {
  assert.throws(() => assertAllowedPersonalEndpoint("http://127.0.0.1:8123"), /loopback endpoint is not allowed/);
  assert.throws(
    () => assertAllowedPersonalEndpoint("http://127.0.0.1:8123", { allowLoopback: true }),
    /insecure.*not allowed/,
  );
  assert.equal(
    assertAllowedPersonalEndpoint("http://127.0.0.1:8123", { allowLoopback: true, allowInsecureHttp: true }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    assertAllowedPersonalEndpoint("https://192.168.1.20:8123", { allowLan: true }).hostname,
    "192.168.1.20",
  );
  assert.equal(
    assertAllowedPersonalEndpoint("https://jarvis.example.ts.net", { allowTailscale: true }).hostname,
    "jarvis.example.ts.net",
  );
  assert.throws(
    () => assertAllowedPersonalEndpoint("http://169.254.169.254/latest/meta-data", { allowLan: true, allowInsecureHttp: true }),
    /link-local/,
  );
  assert.throws(() => assertAllowedPersonalEndpoint("https://example.com"), /remote endpoint is not allowed/);
  assert.throws(
    () => assertAllowedPersonalEndpoint("https://user:password@127.0.0.1", { allowLoopback: true }),
    /credentials in URL/,
  );
});

test("restricted fetch blocks redirects and cross-origin requests before credentials can escape", async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  }) as typeof fetch;
  const restricted = createRestrictedPersonalFetch({
    endpoint: "http://127.0.0.1:8123/mcp",
    policy: { allowLoopback: true, allowInsecureHttp: true },
    fetch: fakeFetch,
  });
  await assert.rejects(() => restricted("http://127.0.0.1:8123/mcp"), /redirects are forbidden/);
  await assert.rejects(() => restricted("https://example.com/mcp"), /remote endpoint is not allowed/);
  assert.equal(calls, 1);
  await restricted.close();
});

test("restricted fetch caps streamed responses without relying on Content-Length", async () => {
  const fakeFetch = (async () => new Response("x".repeat(200))) as typeof fetch;
  const restricted = createRestrictedPersonalFetch({
    endpoint: "https://127.0.0.1:8123/mcp",
    policy: { allowLoopback: true },
    fetch: fakeFetch,
    maxResponseBytes: 32,
  });
  const response = await restricted("https://127.0.0.1:8123/mcp");
  await assert.rejects(() => response.text(), /exceeds payload limit/);
  await restricted.close();
});

test("resolved endpoint policy rejects DNS rebinding to metadata or a different network", async () => {
  const policy = { allowRemoteHttps: true, allowedHosts: ["mcp.example"] } as const;
  await assert.rejects(
    () => resolveAllowedPersonalEndpoint("https://mcp.example/api", policy, async () => [
      { address: "169.254.169.254", family: 4 },
    ]),
    /forbidden address/,
  );
  await assert.rejects(
    () => resolveAllowedPersonalEndpoint("https://mcp.example/api", policy, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ]),
    /network changed from remote to lan/,
  );
  await assert.rejects(
    () => resolveAllowedPersonalEndpoint("https://mcp.example/api", policy, async () => [
      { address: "::ffff:a9fe:a9fe", family: 6 },
    ]),
    /forbidden address/,
  );
});

test("restricted fetch resolves once and supplies a pinned dispatcher to every request", async () => {
  let resolutions = 0;
  let calls = 0;
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.ok((init as RequestInit & { dispatcher?: unknown } | undefined)?.dispatcher);
    return new Response("ok");
  }) as typeof fetch;
  const restricted = createRestrictedPersonalFetch({
    endpoint: "https://mcp.example/api",
    policy: { allowRemoteHttps: true, allowedHosts: ["mcp.example"] },
    fetch: fakeFetch,
    resolveAddresses: async () => {
      resolutions++;
      return [{ address: "93.184.216.34", family: 4 }];
    },
  });
  assert.equal(await (await restricted("https://mcp.example/api")).text(), "ok");
  assert.equal(await (await restricted("https://mcp.example/next")).text(), "ok");
  assert.equal(calls, 2);
  assert.equal(resolutions, 1);
  await restricted.close();
});
