import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuiltInPersonalSources, createPersonalSourceFactory, normalizeMcpCandidates } from "./personalSources.js";
import type { PersonalSourceConnection } from "@jarvis/protocol";

const connection = (patch: Partial<PersonalSourceConnection>): PersonalSourceConnection => ({ id: "source-1", principalId: "alice", type: "open_meteo", label: "Weather", enabled: true, config: {}, allowedResources: [], allowedActions: [], createdAt: 1, updatedAt: 1, ...patch });

test("built-in personal sources require no paid service and keep optional adapters opt-in", () => {
  const sources = createBuiltInPersonalSources({});
  assert.deepEqual(sources.map((source) => source.descriptor.id).sort(), ["open-meteo", "overpass-osm"]);
  assert.ok(sources.every((source) => ["free", "local"].includes(source.descriptor.costClass)));
  assert.ok(createBuiltInPersonalSources({ JARVIS_NOMINATIM_URL: "http://127.0.0.1:8080/" }).some((source) => source.descriptor.id === "nominatim"));
});

test("connection factory builds free HTTP and CalDAV adapters without returning secrets", () => {
  const factory = createPersonalSourceFactory({ JARVIS_HOME: mkdtempSync(join(tmpdir(), "jarvis-caldav-factory-")), CALDAV_SECRET: JSON.stringify({ username: "u", password: "private" }) });
  const weather = factory(connection({ endpoint: "https://api.open-meteo.com/v1/forecast" }));
  assert.ok(weather && !("source" in weather) && weather.descriptor.purposes.includes("weather"));
  const alerts = factory(connection({ type: "weather_alerts", label: "Official alerts", endpoint: "https://alerts.example.gov/cap.xml", config: { certification: "audited", attribution: "Weather authority" } }));
  assert.ok(alerts && !("source" in alerts) && alerts.descriptor.purposes.includes("weather"));
  assert.equal(alerts && !("source" in alerts) ? alerts.descriptor.certification : undefined, "audited");
  assert.throws(() => factory(connection({ type: "weather_alerts", endpoint: "https://alerts.example.gov/cap.xml" })), /first-party or audited/);
  const caldav = factory(connection({ type: "caldav", label: "Calendar", endpoint: "https://calendar.example/dav/", secretRef: "CALDAV_SECRET", config: { allowRemoteHttps: true }, allowedResources: [] }));
  assert.ok(caldav && "source" in caldav && caldav.source.descriptor.purposes.includes("calendar"));
  assert.equal(typeof (caldav && "source" in caldav ? caldav.dispose : undefined), "function");
  assert.equal(JSON.stringify(caldav).includes("private"), false);
  if (caldav && "source" in caldav) void caldav.dispose?.();
});

test("CalDAV discovery is explicit, restricted, bounded, and metadata-only", async () => {
  const password = "private-calendar-password";
  let requests = 0;
  let authorization: string | undefined;
  const calendars = Array.from({ length: 101 }, (_, index) => (
    `<D:response><D:href>/calendar-${index}/</D:href><D:propstat><D:prop>`
    + `<D:displayname>${index === 0 ? password : `Calendar ${index}`}</D:displayname>`
    + `<D:resourcetype><C:calendar/></D:resourcetype><D:sync-token>private-token-${index}</D:sync-token>`
    + `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
  )).join("");
  const server = createServer((request, response) => {
    requests++;
    authorization = request.headers.authorization;
    response.writeHead(207, { "content-type": "application/xml" });
    response.end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${calendars}</D:multistatus>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}/root/`;
  const allowedHref = `http://127.0.0.1:${address.port}/calendar-0/`;
  try {
    const factory = createPersonalSourceFactory({
      JARVIS_HOME: mkdtempSync(join(tmpdir(), "jarvis-caldav-discovery-")),
      CALDAV_SECRET: JSON.stringify({ username: "owner", password }),
    });
    const created = factory(connection({
      type: "caldav",
      endpoint,
      secretRef: "CALDAV_SECRET",
      allowedResources: [allowedHref],
    }));
    assert.ok(created && "source" in created && created.discover);
    assert.equal(requests, 0, "factory construction must not access CalDAV");
    if (!created || !("source" in created) || !created.discover) return;

    const discovery = await created.discover(new AbortController().signal);
    assert.equal(requests, 1);
    assert.match(authorization || "", /^Basic /);
    assert.equal(discovery.sourceId, "source-1");
    assert.equal(discovery.state, "ready");
    assert.equal(discovery.health, "healthy");
    assert.equal(discovery.calendars.length, 100);
    assert.equal(discovery.truncated.calendars, true);
    assert.equal(discovery.calendars.find((calendar) => calendar.href === allowedHref)?.allowed, true);
    const serialized = JSON.stringify(discovery);
    assert.doesNotMatch(serialized, new RegExp(password));
    assert.doesNotMatch(serialized, /sync-token|private-token|etag|authorization/i);
    assert.equal(discovery.calendars.every((calendar) => Object.keys(calendar).every((key) => ["id", "name", "href", "allowed"].includes(key))), true);
    await created.dispose?.();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("CalDAV write grants register only the explicitly classified per-source executors", () => {
  const factory = createPersonalSourceFactory({ CALDAV_SECRET: JSON.stringify({ username: "u", password: "private" }) });
  const created = factory(connection({
    id: "work", type: "caldav", label: "Work", endpoint: "https://calendar.example/dav/", secretRef: "CALDAV_SECRET",
    config: { allowRemoteHttps: true },
    allowedResources: ["https://calendar.example/calendars/u/work/"],
    allowedActions: ["external_reversible:calendar.create", "consequential:calendar.delete"],
  }));
  assert.ok(created && "source" in created);
  if (!created || !("source" in created)) return;
  assert.deepEqual(created.actions?.map((action) => [action.kind, action.risk]), [
    ["calendar.caldav:work:create", "external_reversible"],
    ["calendar.caldav:work:delete", "consequential"],
  ]);
  const preview = created.actions?.[0].preview({ calendarHref: "https://calendar.example/calendars/u/work/", uid: "u1", title: "Meeting", startAt: Date.UTC(2026, 7, 2, 12), endAt: Date.UTC(2026, 7, 2, 13), timeZone: "UTC", remindersMinutes: [10] });
  assert.equal(preview?.title, "Meeting");
  assert.equal(JSON.stringify(created).includes("private"), false);
  assert.throws(() => factory(connection({ type: "caldav", endpoint: "https://calendar.example/dav/", secretRef: "CALDAV_SECRET", config: { allowRemoteHttps: true }, allowedResources: ["https://calendar.example/cal/"], allowedActions: ["read:calendar.create"] })), /invalid CalDAV action grant/);
});

test("uncertified HTTP MCP is never read automatically and exposes read tools only as confirmed actions", async () => {
  const factory = createPersonalSourceFactory({ TOKEN: "secret" });
  const outputSchema = JSON.stringify({ type: "object", additionalProperties: false, properties: { items: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, title: { type: "string" }, observedAt: { type: "number" }, freshness: { type: "string" } }, required: ["id", "title", "observedAt", "freshness"] } } }, required: ["items"] });
  const created = factory(connection({ type: "mcp_http", endpoint: "https://mcp.example/api", secretRef: "TOKEN", config: { allowRemoteHttps: true, outputSchema }, allowedResources: ["context://me"], allowedActions: ["read:list_events"] }));
  assert.ok(created && "source" in created);
  if (!created || !("source" in created)) return;
  assert.equal(created.source.descriptor.certification, "uncertified");
  assert.deepEqual(created.actions?.map((action) => [action.kind, action.risk]), [["mcp:source-1:explicit:list_events", "external_reversible"]]);
  const rows = await created.source.query({ principalId: "alice", purpose: "events" }, { fetch, now: Date.now, signal: new AbortController().signal });
  assert.deepEqual(rows, []);
  await created.dispose?.();

  assert.throws(() => factory(connection({ type: "home_assistant", endpoint: "http://192.168.1.2:8123", secretRef: "TOKEN", allowedResources: [], allowedActions: [] })), /allowlist/);
});

test("stdio MCP exposes a consequential shell start plan and queries cannot start it implicitly", async () => {
  const secret = "resolved-secret-that-must-not-leak";
  const environmentValue = "configured-value-that-must-not-leak";
  const factory = createPersonalSourceFactory({ SOURCE_SECRET_REFERENCE: secret });
  const outputSchema = JSON.stringify({
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            observedAt: { type: "number" },
            freshness: { type: "string" },
          },
          required: ["id", "title", "observedAt", "freshness"],
        },
      },
    },
    required: ["items"],
  });
  const created = factory(connection({
    type: "mcp_stdio",
    label: "Local context",
    endpoint: "definitely-not-an-implicit-process",
    secretRef: "SOURCE_SECRET_REFERENCE",
    config: {
      args: ["--stdio"],
      cwd: "C:\\work\\local-context",
      "env.REGION": environmentValue,
      outputSchema,
    },
    allowedActions: ["read:list_events", "consequential:create_event"],
  }));
  assert.ok(created && "source" in created);
  if (!created || !("source" in created)) return;

  assert.deepEqual(created.actions?.map((action) => [action.kind, action.risk]), [
    ["mcp:source-1:stdio.start", "consequential"],
    ["mcp:source-1:create_event", "consequential"],
  ]);
  const start = created.actions?.[0];
  assert.ok(start);
  const preview = start.preview({});
  assert.deepEqual(preview, {
    type: "shell",
    operation: "mcp_stdio_start",
    command: "definitely-not-an-implicit-process",
    cwd: "C:\\work\\local-context",
    configuredEnvNames: ["JARVIS_MCP_SECRET", "REGION"],
    impact: "Start local MCP process for Local context",
    state: "awaiting_start",
  });
  const serialized = JSON.stringify(preview);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(environmentValue));
  assert.doesNotMatch(serialized, /SOURCE_SECRET_REFERENCE/);

  const discovery = await created.discover?.(new AbortController().signal);
  assert.equal(discovery?.state, "awaiting_start");
  assert.deepEqual(discovery?.tools.map((tool) => [tool.name, tool.allowed, tool.advertised]), [
    ["create_event", true, false],
    ["list_events", true, false],
  ]);

  await assert.rejects(
    () => created.source.query(
      { principalId: "alice", purpose: "events" },
      { fetch, now: Date.now, signal: new AbortController().signal },
    ),
    /awaiting an approved start action/,
  );
  await created.dispose?.();
});

test("MCP automated context requires closed output schemas and server provenance", () => {
  const descriptor = { id: "mcp", label: "MCP", purposes: ["events" as const], costClass: "free" as const, transport: "http" as const, certification: "audited" as const };
  const candidates = normalizeMcpCandidates({ structuredContent: { items: [{ id: "one", kind: "event", title: "Event", observedAt: 10, freshness: "unknown" }] } }, descriptor);
  assert.equal(candidates[0]?.sources[0]?.observedAt, 10);
  assert.equal(candidates[0]?.sources[0]?.freshness, "unknown");
  assert.throws(() => normalizeMcpCandidates({ items: [{ id: "one", title: "Event" }] }, descriptor), /provenance/);
  assert.throws(() => normalizeMcpCandidates({ items: [{ id: "one", title: "Event", observedAt: 10, freshness: "fresh", sourceId: "other" }] }, descriptor), /sourceId/);

  const factory = createPersonalSourceFactory({ TOKEN: "secret" });
  const base = connection({ type: "mcp_http", endpoint: "https://mcp.example/api", secretRef: "TOKEN", config: { certification: "audited", allowRemoteHttps: true }, allowedActions: ["read:list_events"] });
  assert.throws(() => factory(base), /output schema/);
  const outputSchema = JSON.stringify({ type: "object", additionalProperties: false, properties: { items: { type: "array", maxItems: 50, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, title: { type: "string" }, observedAt: { type: "number" }, freshness: { type: "string", enum: ["live", "fresh", "stale", "unknown"] } }, required: ["id", "title", "observedAt", "freshness"] } } }, required: ["items"] });
  const configured = factory({ ...base, config: { ...base.config, outputSchema } });
  assert.ok(configured && "source" in configured);
});
