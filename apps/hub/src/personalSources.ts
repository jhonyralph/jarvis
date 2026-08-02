import { createHash } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PERSONAL_SOURCE_DISCOVERY_LIMITS } from "@jarvis/protocol";
import type { ContextCandidate, ContextPurpose, ContextSourceDescriptor, PersonalContextQuery, PersonalSourceConnection, PersonalSourceDiscovery } from "@jarvis/protocol";
import {
  ManagedPersonalMcpClient,
  createCalDavReadOnlySource,
  createCalDavActionExecutors,
  createCapWeatherAlertSource,
  createHomeAssistantRestIntegration,
  createIcsEventSource,
  createJsonLdEventSource,
  createMapasCulturaisSource,
  createMcpStdioStartActionExecutor,
  createMcpToolActionExecutor,
  createRestrictedPersonalFetch,
  createNominatimSource,
  createOpenChargeMapSource,
  createOpenMeteoSource,
  createOverpassNearbySource,
  createRssAtomEventSource,
  createValhallaSource,
  createValhallaMatrixSource,
  type ContextSource,
  type PersonalActionExecutor,
  type PersonalEndpointPolicy,
  type PersonalMcpToolGrant,
} from "@jarvis/core";
import type { PersonalSourceBundle } from "./personalAssistant.js";

type Env = NodeJS.ProcessEnv;

function safeDiscoveryText(value: unknown, maximum: number, redactions: readonly string[] = []): string | undefined {
  if (typeof value !== "string") return undefined;
  let sanitized = value;
  for (const secret of [...redactions].filter((item) => item.length >= 4).sort((left, right) => right.length - left.length)) {
    sanitized = sanitized.split(secret).join("[REDACTED]");
  }
  sanitized = sanitized.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return sanitized ? sanitized.slice(0, maximum) : undefined;
}

function stringConfig(connection: PersonalSourceConnection, key: string, fallback = ""): string {
  const value = connection.config[key]; return typeof value === "string" ? value.trim() : fallback;
}
function listConfig(connection: PersonalSourceConnection, key: string): string[] {
  const value = connection.config[key];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}
function boolConfig(connection: PersonalSourceConnection, key: string, fallback = false): boolean {
  const value = connection.config[key]; return typeof value === "boolean" ? value : fallback;
}
function stdioEnvironment(connection: PersonalSourceConnection): Record<string, string> | undefined {
  const output: Record<string, string> = {};
  const sensitive = /(^|_)(authorization|cookie|credential|passwd|password|secret|token|api_?key|private_?key)($|_)/i;
  for (const [key, value] of Object.entries(connection.config)) {
    const match = /^env\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(key);
    if (!match || typeof value !== "string") continue;
    if (sensitive.test(match[1])) throw new Error(`sensitive stdio environment must use secretRef: ${match[1]}`);
    output[match[1]] = value;
  }
  return Object.keys(output).length ? output : undefined;
}
function sourceEndpoint(connection: PersonalSourceConnection): string {
  const endpoint = String(connection.endpoint || "").trim(); if (!endpoint) throw new Error(`${connection.type} endpoint is required`); return endpoint;
}
function resolveSecret(env: Env, secretRef: string | undefined): string {
  if (!secretRef) throw new Error("source secretRef is required"); const value = env[secretRef];
  if (!value) throw new Error(`source secret environment variable is unavailable: ${secretRef}`); return value;
}
function purposes(connection: PersonalSourceConnection, fallback: ContextPurpose[]): ContextPurpose[] {
  const allowed = new Set<ContextPurpose>(["nearby", "mobility", "calendar", "events", "weather", "automation"]), configured = listConfig(connection, "purposes").filter((item): item is ContextPurpose => allowed.has(item as ContextPurpose));
  return configured.length ? configured : fallback;
}
function endpointPolicy(connection: PersonalSourceConnection): PersonalEndpointPolicy {
  const endpoint = new URL(sourceEndpoint(connection));
  return {
    allowLoopback: true,
    allowLan: true,
    allowTailscale: true,
    allowRemoteHttps: boolConfig(connection, "allowRemoteHttps"),
    allowInsecureHttp: endpoint.protocol === "http:",
    allowedHosts: [endpoint.hostname],
  };
}
function descriptor(connection: PersonalSourceConnection, fallbackPurposes: ContextPurpose[], transport: ContextSourceDescriptor["transport"] = "http"): ContextSourceDescriptor {
  const configuredCertification = stringConfig(connection, "certification");
  const certification = configuredCertification === "first_party" ? "first_party" : configuredCertification === "audited" ? "audited" : "uncertified";
  return { id: connection.id, label: connection.label, purposes: purposes(connection, fallbackPurposes), costClass: transport === "stdio" ? "local" : "free", transport, certification, attribution: stringConfig(connection, "attribution", connection.label) };
}
export function normalizeMcpCandidates(result: unknown, source: ContextSourceDescriptor): ContextCandidate[] {
  const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const unpack = (value: unknown): unknown[] => {
    const root = object(value);
    if (root?.structuredContent !== undefined) return unpack(root.structuredContent);
    if (Array.isArray(root?.contents)) return root.contents.flatMap((content) => {
      const row = object(content);
      if (typeof row?.text !== "string") throw new Error("MCP resource content must be bounded structured JSON");
      try { return unpack(JSON.parse(row.text)); } catch { throw new Error("MCP resource content must be valid structured JSON"); }
    });
    if (Array.isArray(value)) return value;
    if (Array.isArray(root?.items)) return root.items;
    return value === undefined || value === null ? [] : [value];
  };
  return unpack(result).slice(0, 50).map((value, index) => {
    const row = object(value); if (!row) throw new Error("MCP context item must be an object");
    const provenance = object(row.source), observedAt = Number(row.observedAt ?? provenance?.observedAt);
    const freshness = String((row.freshness ?? provenance?.freshness) || "");
    const declaredSourceId = row.sourceId ?? provenance?.sourceId;
    if (!Number.isSafeInteger(observedAt) || observedAt < 0 || !["live", "fresh", "stale", "unknown"].includes(freshness)) {
      throw new Error("MCP context item lacks valid observedAt/freshness provenance");
    }
    if (declaredSourceId !== undefined && declaredSourceId !== source.id) throw new Error("MCP context item sourceId does not match its grant");
    const lat = Number(row.lat ?? row.latitude), lng = Number(row.lng ?? row.lon ?? row.longitude), hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    const title = String(row.title ?? row.name ?? row.summary ?? "").trim().slice(0, 300);
    if (!title) throw new Error("MCP context item needs a bounded title");
    const data = object(row.data) || Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "kind", "title", "name", "summary", "lat", "latitude", "lng", "lon", "longitude", "source", "sourceId", "observedAt", "freshness", "attribution", "url"].includes(key)));
    return {
      id: String(row.id ?? `${source.id}:${index}`).slice(0, 200), kind: String(row.kind || "context_item").slice(0, 100), title,
      data, ...(hasPoint ? { point: { lat, lng } } : {}),
      sources: [{
        sourceId: source.id, recordId: String(row.id ?? index).slice(0, 200), observedAt,
        freshness: freshness as "live" | "fresh" | "stale" | "unknown",
        attribution: typeof row.attribution === "string" ? row.attribution.slice(0, 500) : source.attribution,
        ...(typeof row.url === "string" ? { url: row.url.slice(0, 2_000) } : {}),
      }],
    };
  });
}

function configuredMcpOutputSchema(connection: PersonalSourceConnection, toolName: string): Record<string, unknown> {
  const raw = stringConfig(connection, `outputSchema.${toolName}`) || stringConfig(connection, "outputSchema");
  if (!raw) throw new Error(`MCP tool grant requires a closed output schema in config: ${toolName}`);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch { throw new Error(`invalid MCP output schema JSON: ${toolName}`); }
}
function parseMcpAction(raw: string): { risk: PersonalMcpToolGrant["risk"]; name: string } {
  const match = /^(read|local_reversible|external_reversible|consequential):([A-Za-z0-9_.:/-]{1,150})$/.exec(raw);
  if (!match) throw new Error(`invalid MCP action grant: ${raw}`); return { risk: match[1] as PersonalMcpToolGrant["risk"], name: match[2] };
}
function mcpBundle(connection: PersonalSourceConnection, env: Env): PersonalSourceBundle {
  const http = connection.type === "mcp_http", sourceDescriptor = descriptor(connection, ["nearby", "mobility", "calendar", "events", "weather", "automation"], http ? "http" : "stdio");
  const trustedForAutomation = !http || sourceDescriptor.certification === "first_party" || sourceDescriptor.certification === "audited";
  const grants = connection.allowedActions.map(parseMcpAction), standardProperties = { query: { type: "string", maxLength: 500 }, purpose: { type: "string", enum: sourceDescriptor.purposes }, startAt: { type: "number" }, endAt: { type: "number" }, idempotencyKey: { type: "string", maxLength: 200 } };
  const tools: PersonalMcpToolGrant[] = grants.map((grant) => ({ name: grant.name, risk: grant.risk, allowedArguments: Object.keys(standardProperties), inputSchema: { type: "object", properties: standardProperties, additionalProperties: false }, outputSchema: configuredMcpOutputSchema(connection, grant.name), maxArgumentBytes: 32_768, maxResultBytes: 262_144 }));
  const transport = http ? {
    kind: "streamable-http" as const, endpoint: sourceEndpoint(connection), profile: "read-only" as const,
    certification: sourceDescriptor.certification as "first_party" | "audited" | "uncertified", endpointPolicy: endpointPolicy(connection), authorizationSecretRef: connection.secretRef,
  } : {
    kind: "stdio" as const, command: sourceEndpoint(connection), args: listConfig(connection, "args"), cwd: stringConfig(connection, "cwd") || undefined,
    env: stdioEnvironment(connection),
    secretEnv: connection.secretRef ? { JARVIS_MCP_SECRET: connection.secretRef } : undefined,
  };
  const client = new ManagedPersonalMcpClient({ id: connection.id, transport, tools, resources: connection.allowedResources.map((uri) => ({ uri, maxResultBytes: 262_144 })) }, { resolveSecret: (ref) => resolveSecret(env, ref) });
  const source: ContextSource = {
    descriptor: sourceDescriptor, cacheTtlMs: 60_000, timeoutMs: 15_000, staleIfErrorMs: 300_000,
    async query(request, runtime) {
      if (!trustedForAutomation) return [];
      await client.connect(runtime.signal); const candidates: ContextCandidate[] = [];
      for (const uri of client.allowedResourceUris().slice(0, 8)) candidates.push(...normalizeMcpCandidates(await client.readResource(uri, { signal: runtime.signal }), sourceDescriptor));
      for (const grant of grants.filter((row) => row.risk === "read").slice(0, 4)) candidates.push(...normalizeMcpCandidates(await client.callTool(grant.name, { query: request.text || "", purpose: request.purpose, ...(request.startAt === undefined ? {} : { startAt: request.startAt }), ...(request.endAt === undefined ? {} : { endAt: request.endAt }) }, { signal: runtime.signal }), sourceDescriptor));
      return candidates.slice(0, request.limit || 20);
    },
  };
  const actions: PersonalActionExecutor[] = http ? [] : [createMcpStdioStartActionExecutor({
    client,
    kind: `mcp:${connection.id}:stdio.start`,
    impact: `Start local MCP process for ${connection.label}`,
  })];
  actions.push(...grants.filter((grant) => grant.risk !== "read").map((grant) => createMcpToolActionExecutor({ client, kind: `mcp:${connection.id}:${grant.name}`, toolName: grant.name, impact: `Invoke ${grant.name} on ${connection.label}`, idempotencyArgument: "idempotencyKey" })));
  if (!trustedForAutomation) {
    for (const grant of grants.filter((row) => row.risk === "read")) {
      actions.push({
        kind: `mcp:${connection.id}:explicit:${grant.name}`,
        risk: "external_reversible",
        preview(payload) {
          return { tool: grant.name, arguments: client.prepareToolArguments(grant.name, payload, { requireExact: true }), impact: `Explicit read from uncertified MCP ${connection.label}` };
        },
        async execute(payload, context) {
          const withIdempotency = context.idempotencyKey ? { ...payload, idempotencyKey: context.idempotencyKey } : payload;
          const args = client.prepareToolArguments(grant.name, withIdempotency, { requireExact: true });
          await client.connect(context.signal);
          context.markDispatched?.();
          const result = await client.callTool(grant.name, args, { approvedRisk: "read", signal: context.signal, requireExactArguments: true });
          return { tool: grant.name, result };
        },
      });
    }
  }
  return { source, actions, discover: (signal) => client.discover(signal), dispose: () => client.close() };
}
function parseCalDavCredential(raw: string): { kind: "basic"; username: string; password: string } | { kind: "bearer"; token: string } {
  try { const parsed = JSON.parse(raw) as Record<string, unknown>; if (typeof parsed.token === "string") return { kind: "bearer", token: parsed.token }; if (typeof parsed.username === "string" && typeof parsed.password === "string") return { kind: "basic", username: parsed.username, password: parsed.password }; } catch { /* accept compact forms below */ }
  const split = raw.indexOf(":"); return split > 0 ? { kind: "basic", username: raw.slice(0, split), password: raw.slice(split + 1) } : { kind: "bearer", token: raw };
}
function calDavCacheFile(connection: PersonalSourceConnection, env: Env): string {
  const principal = createHash("sha256").update(connection.principalId).digest("hex");
  const source = createHash("sha256").update(connection.id).digest("hex");
  return join(env.JARVIS_HOME || homedir(), ".jarvis", "personal", principal, "source-cache", `caldav-${source}.json`);
}
function purgeLegacyCalDavCaches(env: Env): void {
  const directory = join(env.JARVIS_HOME || homedir(), ".jarvis", "personal", "source-cache");
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^caldav-[a-f0-9]{64}\.json(?:\.bak|\.tmp)?$/.test(entry.name)) continue;
      try { rmSync(join(directory, entry.name), { force: true }); } catch { /* best effort migration cleanup */ }
    }
  } catch { /* legacy directory is normally absent */ }
}
function calDavBundle(connection: PersonalSourceConnection, env: Env): PersonalSourceBundle {
  const secretRef = connection.secretRef || "";
  const discoveryRedactions = new WeakMap<AbortSignal, string[]>();
  const resolveCredential = async (ref: string, context: { signal: AbortSignal }) => {
    const raw = resolveSecret(env, ref);
    const credential = parseCalDavCredential(raw);
    const redactions = discoveryRedactions.get(context.signal);
    if (redactions) {
      redactions.push(raw);
      if (credential.kind === "basic") redactions.push(credential.username, credential.password);
      else redactions.push(credential.token);
    }
    return credential;
  };
  const restrictedFetch = createRestrictedPersonalFetch({ endpoint: sourceEndpoint(connection), policy: endpointPolicy(connection) });
  const source = createCalDavReadOnlySource({
    sourceId: connection.id, label: connection.label, endpoint: sourceEndpoint(connection), secretRef,
    resolveSecret: resolveCredential, calendarHrefs: connection.allowedResources,
    resolveAccess: () => stringConfig(connection, "access") === "details" ? "details" : "busy_free",
    defaultTimeZone: stringConfig(connection, "timeZone", "UTC"),
    cacheFile: calDavCacheFile(connection, env),
    fetch: restrictedFetch,
  });
  const allowedCalendars = new Set(connection.allowedResources.map((href) => new URL(href, sourceEndpoint(connection)).toString()));
  const discover = async (signal: AbortSignal): Promise<PersonalSourceDiscovery> => {
    const startedAt = Date.now();
    const redactions: string[] = [];
    if (secretRef) redactions.push(secretRef);
    discoveryRedactions.set(signal, redactions);
    try {
      const calendars = await source.discoverCalendars(connection.principalId, { fetch: restrictedFetch, now: Date.now, signal });
      const metadata = calendars.map((calendar) => {
        const href = safeDiscoveryText(calendar.href, 2_000, redactions) ?? "[invalid]";
        const name = safeDiscoveryText(calendar.displayName, 200, redactions);
        return {
          id: href,
          ...(name ? { name } : {}),
          href,
          allowed: allowedCalendars.has(calendar.href),
        };
      });
      return {
        sourceId: connection.id,
        state: "ready",
        health: "healthy",
        latencyMs: Math.max(0, Date.now() - startedAt),
        calendars: metadata.slice(0, PERSONAL_SOURCE_DISCOVERY_LIMITS.calendars),
        tools: [],
        resources: [],
        truncated: {
          calendars: metadata.length > PERSONAL_SOURCE_DISCOVERY_LIMITS.calendars,
          tools: false,
          resources: false,
        },
      };
    } finally {
      discoveryRedactions.delete(signal);
    }
  };
  if (!connection.allowedActions.length) return { source, discover, dispose: async () => { source.dispose(connection.principalId); await restrictedFetch.close(); } };
  if (!connection.allowedResources.length) throw new Error("CalDAV write actions require at least one explicitly allowed calendar");
  const grants: ReadonlyMap<string, "create" | "update" | "delete" | "undo"> = new Map([
    ["external_reversible:calendar.create", "create"],
    ["external_reversible:calendar.update", "update"],
    ["consequential:calendar.delete", "delete"],
    ["external_reversible:calendar.undo", "undo"],
  ] as const);
  const selected = connection.allowedActions.map((grant) => {
    const operation = grants.get(grant);
    if (!operation) throw new Error(`invalid CalDAV action grant: ${grant}`);
    return operation;
  });
  const namespace = connection.id;
  const actions = createCalDavActionExecutors({
    endpoint: sourceEndpoint(connection), calendars: connection.allowedResources, secretRef, sourceId: connection.id,
    resolveSecret: resolveCredential,
    fetch: restrictedFetch,
    actionKinds: {
      create: `calendar.caldav:${namespace}:create`, update: `calendar.caldav:${namespace}:update`,
      delete: `calendar.caldav:${namespace}:delete`, undo: `calendar.caldav:${namespace}:undo`,
    },
  });
  const byOperation = { create: actions.create, update: actions.update, delete: actions.delete, undo: actions.undo };
  return {
    source,
    actions: [...new Set(selected)].map((operation) => byOperation[operation]),
    discover,
    dispose: async () => { source.dispose(connection.principalId); actions.clearUndo(connection.principalId); await restrictedFetch.close(); },
  };
}
function homeAssistantBundle(connection: PersonalSourceConnection, env: Env): PersonalSourceBundle {
  const actions = connection.allowedActions.map((raw) => {
    const match = /^(local_reversible|external_reversible|consequential):([a-z0-9_]+)\.([a-z0-9_]+)(?:@(.+))?$/.exec(raw); if (!match) throw new Error(`invalid Home Assistant action grant: ${raw}`);
    return { risk: match[1] as "local_reversible" | "external_reversible" | "consequential", domain: match[2], service: match[3], entityIds: (match[4] ? match[4].split("|") : connection.allowedResources).filter(Boolean), allowedDataFields: listConfig(connection, "serviceDataFields"), impact: `${match[2]}.${match[3]} via ${connection.label}`, kind: `home-assistant:${connection.id}:${match[2]}.${match[3]}` };
  });
  const integration = createHomeAssistantRestIntegration({ id: connection.id, endpoint: sourceEndpoint(connection), endpointPolicy: endpointPolicy(connection), tokenSecretRef: connection.secretRef || "", allowedEntities: connection.allowedResources, allowedAttributes: Object.fromEntries(connection.allowedResources.map((entity) => [entity, listConfig(connection, "attributes")])), services: actions }, { resolveSecret: (ref) => resolveSecret(env, ref) });
  return { source: integration.source, actions: integration.executors, dispose: () => integration.dispose() };
}

export function createPersonalSourceFactory(env: Env = process.env): (connection: PersonalSourceConnection) => ContextSource<unknown> | PersonalSourceBundle | undefined {
  purgeLegacyCalDavCaches(env);
  return (connection) => {
    if (!connection.enabled) return undefined;
    switch (connection.type) {
      case "nominatim": return createNominatimSource({ endpoint: sourceEndpoint(connection), email: stringConfig(connection, "email") || undefined });
      case "valhalla": return boolConfig(connection, "matrix") ? createValhallaMatrixSource({ endpoint: sourceEndpoint(connection) }) : createValhallaSource({ endpoint: sourceEndpoint(connection) });
      case "osm": return createOverpassNearbySource({ endpoint: sourceEndpoint(connection) });
      case "open_charge_map": return createOpenChargeMapSource({ endpoint: sourceEndpoint(connection), apiKey: connection.secretRef ? resolveSecret(env, connection.secretRef) : undefined });
      case "open_meteo": return createOpenMeteoSource({ endpoint: sourceEndpoint(connection) });
      case "weather_alerts": {
        const certification = stringConfig(connection, "certification");
        if (certification !== "first_party" && certification !== "audited") throw new Error("CAP weather alerts require a first-party or audited source profile");
        const attribution = stringConfig(connection, "attribution", connection.label);
        return createCapWeatherAlertSource({ url: sourceEndpoint(connection), sourceId: connection.id, label: connection.label, attribution, authority: stringConfig(connection, "authority", attribution), certification });
      }
      case "mapas_culturais": return createMapasCulturaisSource({ endpoint: sourceEndpoint(connection), sourceId: connection.id, label: connection.label, attribution: stringConfig(connection, "attribution", connection.label), defaultTimeZone: stringConfig(connection, "timeZone", "America/Sao_Paulo") });
      case "open_events": { const endpoint = sourceEndpoint(connection), format = stringConfig(connection, "format") || (/\.ics(?:$|\?)/i.test(endpoint) ? "ics" : /rss|atom|xml/i.test(endpoint) ? "rss" : "jsonld"), common = { url: endpoint, sourceId: connection.id, label: connection.label, attribution: stringConfig(connection, "attribution", connection.label), defaultTimeZone: stringConfig(connection, "timeZone", "UTC") }; return format === "ics" ? createIcsEventSource(common) : format === "rss" ? createRssAtomEventSource(common) : createJsonLdEventSource(common); }
      case "caldav": return calDavBundle(connection, env);
      case "mcp_http": case "mcp_stdio": return mcpBundle(connection, env);
      case "home_assistant": return homeAssistantBundle(connection, env);
      case "device_location": case "device_calendar": return undefined;
    }
  };
}

/** Public, worldwide, zero-config endpoints for the global built-in sources. The env vars only
 *  OVERRIDE them (e.g. to point at a self-hosted stack). Nominatim/Valhalla default to localhost in
 *  the core (self-host, per their usage policy), so we pass explicit PUBLIC fallbacks here for the
 *  built-ins that make the assistant usable out of the box anywhere. Nominatim already sends a
 *  compliant User-Agent; personal (single-user) volume respects the public policy. */
const PUBLIC_NOMINATIM_URL = "https://nominatim.openstreetmap.org/";

export function createBuiltInPersonalSources(env: Env = process.env): ContextSource<unknown>[] {
  // Global, free, worldwide sources: ON by default with public endpoints — no setup, Brazil or abroad.
  // Nearby places (Overpass/OSM), geocoding (Nominatim), weather (Open-Meteo) and chargers (Open
  // Charge Map) all work with zero configuration; env vars only override the endpoints.
  const sources: ContextSource<unknown>[] = [
    createNominatimSource({ endpoint: env.JARVIS_NOMINATIM_URL || PUBLIC_NOMINATIM_URL, email: env.JARVIS_NOMINATIM_EMAIL || undefined }),
    createOverpassNearbySource({ endpoint: env.JARVIS_OVERPASS_URL }),
    createOpenMeteoSource({ endpoint: env.JARVIS_OPEN_METEO_URL }),
    createOpenChargeMapSource({ endpoint: env.JARVIS_OCM_URL, apiKey: env.JARVIS_OCM_API_KEY || undefined }),
  ];
  // Routing (Valhalla) has no free public instance — only self-hosted. Stays opt-in via env.
  if (env.JARVIS_VALHALLA_URL) sources.push(createValhallaSource({ endpoint: env.JARVIS_VALHALLA_URL }), createValhallaMatrixSource({ endpoint: env.JARVIS_VALHALLA_URL }));
  if (env.JARVIS_MAPAS_CULTURAIS_URL) sources.push(createMapasCulturaisSource({ endpoint: env.JARVIS_MAPAS_CULTURAIS_URL, sourceId: "mapas-culturais", label: "Mapas Culturais", attribution: "Mapas Culturais", defaultTimeZone: env.JARVIS_CONTEXT_TIMEZONE || "America/Sao_Paulo" }));
  if (env.JARVIS_EVENTS_FEED_URL) { const common = { url: env.JARVIS_EVENTS_FEED_URL, sourceId: "open-events", label: "Open events", attribution: env.JARVIS_EVENTS_ATTRIBUTION || "Configured open event feed", defaultTimeZone: env.JARVIS_CONTEXT_TIMEZONE || "UTC" }; sources.push(env.JARVIS_EVENTS_FEED_FORMAT === "ics" ? createIcsEventSource(common) : env.JARVIS_EVENTS_FEED_FORMAT === "rss" ? createRssAtomEventSource(common) : createJsonLdEventSource(common)); }
  return sources;
}
