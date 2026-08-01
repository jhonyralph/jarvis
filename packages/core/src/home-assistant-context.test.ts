import test from "node:test";
import assert from "node:assert/strict";
import { PersonalActionOutcomeUncertainError, actionRequiresConfirmation } from "./personal-actions.js";
import {
  HomeAssistantRestAdapter,
  createHomeAssistantRestIntegration,
  type HomeAssistantRestConfig,
} from "./home-assistant-context.js";

const token = "home-assistant-secret-token";
const endpointPolicy = { allowLoopback: true, allowInsecureHttp: true } as const;

function baseConfig(overrides: Partial<HomeAssistantRestConfig> = {}): HomeAssistantRestConfig {
  return {
    endpoint: "http://127.0.0.1:8123",
    endpointPolicy,
    tokenSecretRef: "HOME_ASSISTANT_TOKEN",
    allowedEntities: ["sensor.temperature", "light.kitchen"],
    allowedAttributes: {
      "sensor.temperature": ["friendly_name", "unit_of_measurement"],
      "light.kitchen": ["friendly_name", "brightness"],
    },
    services: [{
      domain: "light",
      service: "turn_on",
      risk: "local_reversible",
      entityIds: ["light.kitchen"],
      allowedDataFields: ["brightness"],
      dataSchema: {
        type: "object",
        properties: { brightness: { type: "integer", minimum: 1, maximum: 255 } },
        additionalProperties: false,
      },
      impact: "Acende a luz da cozinha com o brilho escolhido.",
    }],
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input);
}

test("Home Assistant source descriptor declares license, retention, and review metadata", () => {
  const source = new HomeAssistantRestAdapter(baseConfig(), { resolveSecret: () => token }).createContextSource();
  assert.ok(source.descriptor.license);
  assert.ok(source.descriptor.retentionPolicy);
  assert.equal(source.descriptor.lastReviewedAt, "2026-08-01");
});

test("Home Assistant context reads only allowlisted entities and minimizes attributes", async () => {
  const calls: Array<{ url: URL; authorization: string | null }> = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get("authorization") });
    return jsonResponse({
      entity_id: "sensor.temperature",
      state: "23.5",
      attributes: {
        friendly_name: "Cozinha",
        unit_of_measurement: "C",
        latitude: -19.9,
        access_token: token,
      },
      last_changed: "2026-08-01T12:00:00.000Z",
      last_updated: "2026-08-01T12:00:01.000Z",
    });
  }) as typeof fetch;
  const adapter = new HomeAssistantRestAdapter(baseConfig(), {
    resolveSecret: () => token,
    fetch: fakeFetch,
    now: () => Date.parse("2026-08-01T12:00:02.000Z"),
  });
  const source = adapter.createContextSource();
  const controller = new AbortController();
  const result = await source.query(
    { principalId: "owner", purpose: "automation", filters: { entityIds: ["sensor.temperature"] } },
    { fetch: fakeFetch, now: Date.now, signal: controller.signal },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/states/sensor.temperature");
  assert.equal(calls[0].authorization, `Bearer ${token}`);
  assert.equal(result[0].title, "Cozinha");
  assert.deepEqual(result[0].data.attributes, { friendly_name: "Cozinha", unit_of_measurement: "C" });
  assert.equal(result[0].sources[0].freshness, "live");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token));

  await assert.rejects(
    () => source.query(
      { principalId: "owner", purpose: "automation", filters: { entityIds: ["lock.front_door"] } },
      { fetch: fakeFetch, now: Date.now, signal: controller.signal },
    ),
    /not allowlisted/,
  );
  assert.equal(calls.length, 1);
});

test("Home Assistant redacts the resolved token from adapter errors", async () => {
  const fakeFetch = (async () => { throw new Error(`socket failed with Bearer ${token}; raw=${token}`); }) as typeof fetch;
  const source = new HomeAssistantRestAdapter(baseConfig(), {
    resolveSecret: () => token,
    fetch: fakeFetch,
  }).createContextSource();
  const controller = new AbortController();
  await assert.rejects(
    () => source.query(
      { principalId: "owner", purpose: "automation", filters: { entityIds: ["sensor.temperature"] } },
      { fetch: fakeFetch, now: Date.now, signal: controller.signal },
    ),
    (error: Error) => error.message.includes("REDACTED") && !error.message.includes(token),
  );
});

test("Home Assistant endpoints are denied unless local network and HTTP policies are explicit", () => {
  const dependencies = { resolveSecret: () => token };
  assert.throws(
    () => new HomeAssistantRestAdapter(baseConfig({ endpointPolicy: {} }), dependencies),
    /loopback endpoint is not allowed/,
  );
  assert.throws(
    () => new HomeAssistantRestAdapter(baseConfig({ endpointPolicy: { allowLoopback: true } }), dependencies),
    /insecure.*not allowed/,
  );
  assert.throws(
    () => new HomeAssistantRestAdapter(baseConfig({ endpoint: "https://home-assistant.example", endpointPolicy: {} }), dependencies),
    /remote endpoint is not allowed/,
  );
  assert.throws(
    () => new HomeAssistantRestAdapter(baseConfig({
      endpoint: "http://169.254.169.254",
      endpointPolicy: { allowLan: true, allowInsecureHttp: true },
    }), dependencies),
    /link-local/,
  );
});

test("Home Assistant service executor previews exact arguments, executes allowlisted action, and rereads state", async () => {
  const calls: Array<{ url: URL; method: string; body?: unknown; authorization: string | null }> = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ url, method, body, authorization: headers.get("authorization") });
    if (method === "POST") return jsonResponse([]);
    return jsonResponse({
      entity_id: "light.kitchen",
      state: "on",
      attributes: { friendly_name: "Luz da cozinha", brightness: 180, hidden: token },
      last_updated: "2026-08-01T12:00:01.000Z",
    });
  }) as typeof fetch;
  const integration = createHomeAssistantRestIntegration(baseConfig(), {
    resolveSecret: () => token,
    fetch: fakeFetch,
  });
  const executor = integration.executors[0];
  const payload = { entityIds: ["light.kitchen"], data: { brightness: 180 } };
  const preview = executor.preview(payload);

  assert.equal(executor.risk, "local_reversible");
  assert.deepEqual(preview, {
    service: "light.turn_on",
    entityIds: ["light.kitchen"],
    parameters: { brightness: 180 },
    impact: "Acende a luz da cozinha com o brilho escolhido.",
  });
  assert.doesNotMatch(JSON.stringify(preview), new RegExp(token));
  assert.throws(() => executor.preview({ ...payload, token }), /non-allowlisted fields/);
  assert.throws(() => executor.preview({ entityIds: ["light.bedroom"], data: {} }), /entity is not allowlisted/);
  assert.throws(() => executor.preview({ entityIds: ["light.kitchen"], data: { brightness: 999 } }), /failed schema/);

  const result = await executor.execute(payload, { principalId: "owner", signal: new AbortController().signal });
  assert.deepEqual(calls.map((call) => [call.method, call.url.pathname]), [
    ["POST", "/api/services/light/turn_on"],
    ["GET", "/api/states/light.kitchen"],
  ]);
  assert.deepEqual(calls[0].body, { entity_id: "light.kitchen", brightness: 180 });
  assert.ok(calls.every((call) => call.authorization === `Bearer ${token}`));
  assert.equal(result.verification, "state_matched");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
  await integration.dispose();
});

test("Home Assistant derives freshness from entity timestamps instead of claiming every value is live", async () => {
  let missingTimestamp = false;
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  const fakeFetch = (async () => jsonResponse({
    entity_id: "sensor.temperature",
    state: "23",
    attributes: {},
    ...(missingTimestamp ? {} : { last_updated: "2026-08-01T10:00:00.000Z" }),
  })) as typeof fetch;
  const adapter = new HomeAssistantRestAdapter(baseConfig(), { resolveSecret: () => token, fetch: fakeFetch, now: () => now });
  const source = adapter.createContextSource();
  const runtime = { fetch: fakeFetch, now: () => now, signal: new AbortController().signal };
  assert.equal((await source.query({ principalId: "owner", purpose: "automation", filters: { entityIds: ["sensor.temperature"] } }, runtime))[0].sources[0].freshness, "stale");
  missingTimestamp = true;
  assert.equal((await source.query({ principalId: "owner", purpose: "automation", filters: { entityIds: ["sensor.temperature"] } }, runtime))[0].sources[0].freshness, "unknown");
  await adapter.dispose();
});

test("Home Assistant reports an uncertain outcome when a sent action cannot be verified", async () => {
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if ((init?.method || "GET") === "POST") return jsonResponse([]);
    return jsonResponse({ entity_id: "light.kitchen", state: "off", attributes: {}, last_updated: "2026-08-01T12:00:00.000Z" });
  }) as typeof fetch;
  const integration = createHomeAssistantRestIntegration(baseConfig(), { resolveSecret: () => token, fetch: fakeFetch });
  await assert.rejects(
    () => integration.executors[0].execute({ entityIds: ["light.kitchen"], data: { brightness: 100 } }, { principalId: "owner", signal: new AbortController().signal }),
    (error: Error) => error instanceof PersonalActionOutcomeUncertainError && /expected state on was not observed/.test(error.message),
  );
  await integration.dispose();
});

test("locks are consequential regardless of a lower configured risk and service failures reject", async () => {
  const lockGrant = {
    domain: "lock",
    service: "unlock",
    risk: "local_reversible" as const,
    entityIds: ["lock.front_door"],
    allowedDataFields: [],
    impact: "Destranca a porta principal.",
  };
  let mutationCalls = 0;
  const failingFetch = (async () => {
    mutationCalls++;
    return jsonResponse({ message: "failed" }, 500);
  }) as typeof fetch;
  const adapter = new HomeAssistantRestAdapter(baseConfig({ services: [lockGrant] }), {
    resolveSecret: () => token,
    fetch: failingFetch,
  });
  const executor = adapter.createActionExecutor("lock", "unlock");
  assert.equal(executor.risk, "consequential");
  assert.equal(actionRequiresConfirmation(executor.risk), true);
  const preview = executor.preview({ entityIds: ["lock.front_door"], data: {} });
  assert.equal(preview.impact, "Destranca a porta principal.");
  await assert.rejects(
    () => executor.execute(
      { entityIds: ["lock.front_door"], data: {} },
      { principalId: "owner", signal: new AbortController().signal },
    ),
    /HTTP 500/,
  );
  assert.equal(mutationCalls, 1, "mutation failures must not be retried");
});

test("Home Assistant rejects nested secret fields and open nested service schemas", () => {
  const nestedGrant = {
    domain: "input_select",
    service: "set_options",
    risk: "local_reversible" as const,
    entityIds: ["input_select.mode"],
    allowedDataFields: ["options"],
    dataSchema: {
      type: "object",
      properties: {
        options: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" } },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    impact: "Atualiza as opcoes de modo.",
  };
  const adapter = new HomeAssistantRestAdapter(baseConfig({ services: [nestedGrant] }), { resolveSecret: () => token });
  const executor = adapter.createActionExecutor("input_select", "set_options");
  assert.throws(
    () => executor.preview({
      entityIds: ["input_select.mode"],
      data: { options: [{ label: "Casa", access_token: token }] },
    }),
    /forbidden secret field/,
  );

  assert.throws(
    () => new HomeAssistantRestAdapter(baseConfig({
      services: [{
        ...nestedGrant,
        dataSchema: {
          type: "object",
          properties: { options: { type: "object", properties: { label: { type: "string" } } } },
          additionalProperties: false,
        },
      }],
    }), { resolveSecret: () => token }),
    /must reject additional properties/,
  );
});
