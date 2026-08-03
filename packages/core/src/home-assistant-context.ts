import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type {
  ContextCandidate,
  ContextSourceRef,
  PersonalActionRisk,
  PersonalContextQuery,
} from "@jarvis/protocol";
import type { ContextSource, ContextSourceRuntime } from "./context-sources.js";
import { PersonalActionOutcomeUncertainError, type PersonalActionExecutor } from "./personal-actions.js";
import {
  assertAllowedPersonalEndpoint,
  boundedJsonBytes,
  createRestrictedPersonalFetch,
  redactPersonalSecrets,
  redactedPersonalError,
  type PersonalEndpointPolicy,
  type PersonalDnsResolver,
  type PersonalSecretResolver,
  type RestrictedPersonalFetch,
} from "./personal-mcp-client.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_CACHE_TTL_MS = 15_000;
const DEFAULT_STALE_IF_ERROR_MS = 60_000;
const SOURCE_METADATA_LAST_REVIEWED_AT = "2026-08-01";
const MAX_ENTITIES = 128;
const SENSITIVE_FIELD = /(^|_)(authorization|cookie|credential|passwd|password|secret|token|api_?key|code)($|_)/i;
const NAME = /^[a-z0-9_]+$/;
const ALWAYS_CONSEQUENTIAL_DOMAINS = new Set(["alarm_control_panel", "automation", "cover", "lock", "script"]);

export interface HomeAssistantServiceGrant {
  domain: string;
  service: string;
  risk: Exclude<PersonalActionRisk, "read">;
  entityIds: readonly string[];
  allowedDataFields: readonly string[];
  dataSchema?: Record<string, unknown>;
  impact: string;
  kind?: string;
}

export interface HomeAssistantRestConfig {
  id?: string;
  endpoint: string;
  endpointPolicy: PersonalEndpointPolicy;
  tokenSecretRef: string;
  allowedEntities: readonly string[];
  allowedAttributes?: Readonly<Record<string, readonly string[]>>;
  services: readonly HomeAssistantServiceGrant[];
  timeoutMs?: number;
  maxPayloadBytes?: number;
  cacheTtlMs?: number;
  staleIfErrorMs?: number;
}

export interface HomeAssistantDependencies {
  resolveSecret: PersonalSecretResolver;
  fetch?: typeof fetch;
  resolveAddresses?: PersonalDnsResolver;
  now?: () => number;
}

export interface HomeAssistantStateData extends Record<string, unknown> {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
  lastChanged?: string;
  lastUpdated?: string;
}

export interface HomeAssistantActionPayload extends Record<string, unknown> {
  entityIds: string[];
  data?: Record<string, unknown>;
}

export interface HomeAssistantRestIntegration {
  source: ContextSource<HomeAssistantStateData>;
  executors: PersonalActionExecutor[];
  dispose(): Promise<void>;
}

interface HomeAssistantApiState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

interface CompiledServiceGrant {
  grant: HomeAssistantServiceGrant;
  kind: string;
  risk: Exclude<PersonalActionRisk, "read">;
  validateData?: ReturnType<AjvJsonSchemaValidator["getValidator"]>;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label} must be a positive integer`);
  return result;
}

function cloneJson<T>(value: T): T {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error();
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Home Assistant value is not valid JSON");
  }
}

function entityDomain(entityId: string): string {
  return entityId.split(".", 1)[0] ?? "";
}

function validEntityId(entityId: string): boolean {
  const parts = entityId.split(".");
  return parts.length === 2 && parts.every((part) => NAME.test(part));
}

function effectiveRisk(grant: HomeAssistantServiceGrant): Exclude<PersonalActionRisk, "read"> {
  if (ALWAYS_CONSEQUENTIAL_DOMAINS.has(grant.domain)) return "consequential";
  if (grant.entityIds.some((entityId) => ALWAYS_CONSEQUENTIAL_DOMAINS.has(entityDomain(entityId)))) return "consequential";
  if (/^(arm_|disarm|lock|open|open_|trigger|unlock)/.test(grant.service)) return "consequential";
  return grant.risk;
}

export function homeAssistantActionKind(domain: string, service: string): string {
  return `home_assistant.service.${domain}.${service}`;
}

async function readBoundedText(response: Response, maximum: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximum) {
    void response.body?.cancel();
    throw new Error("Home Assistant response exceeds payload limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new Error("Home Assistant response exceeds payload limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function parseState(value: unknown, expectedEntityId: string): HomeAssistantApiState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Home Assistant returned an invalid state");
  const state = value as Record<string, unknown>;
  if (state.entity_id !== expectedEntityId || typeof state.state !== "string") throw new Error("Home Assistant returned a mismatched state");
  if (!state.attributes || typeof state.attributes !== "object" || Array.isArray(state.attributes)) throw new Error("Home Assistant returned invalid state attributes");
  if (state.last_changed !== undefined && typeof state.last_changed !== "string") throw new Error("Home Assistant returned invalid last_changed");
  if (state.last_updated !== undefined && typeof state.last_updated !== "string") throw new Error("Home Assistant returned invalid last_updated");
  return {
    entity_id: expectedEntityId,
    state: state.state,
    attributes: state.attributes as Record<string, unknown>,
    last_changed: state.last_changed as string | undefined,
    last_updated: state.last_updated as string | undefined,
  };
}

function observedAt(state: HomeAssistantApiState, now: number): number | undefined {
  const parsed = Date.parse(state.last_updated ?? state.last_changed ?? "");
  return Number.isFinite(parsed) && parsed <= now + 60_000 ? Math.min(parsed, now) : undefined;
}

function expectedStateAfterService(domain: string, service: string): string | undefined {
  if (service === "turn_on") return "on";
  if (service === "turn_off") return "off";
  if (domain === "lock" && service === "lock") return "locked";
  if (domain === "lock" && service === "unlock") return "unlocked";
  if (domain === "cover" && service === "open_cover") return "open";
  if (domain === "cover" && service === "close_cover") return "closed";
  return undefined;
}

function assertClosedServiceSchema(schema: Record<string, unknown>, label: string): void {
  const inspect = (node: unknown, path: string, seen: Set<object>): void => {
    if (!node || typeof node !== "object" || seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      node.forEach((child, index) => inspect(child, `${path}[${index}]`, seen));
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.$ref === "string" && !record.$ref.startsWith("#/")) throw new Error(`${path} contains a remote schema reference`);
    if ((record.type === "object" || record.properties) && record.additionalProperties !== false) {
      throw new Error(`${path} must reject additional properties`);
    }
    for (const [key, child] of Object.entries(record)) inspect(child, `${path}.${key}`, seen);
  };
  inspect(schema, label, new Set());
}

function assertSafeServiceData(value: unknown, knownSecrets: ReadonlySet<string>, path = "data"): void {
  if (typeof value === "string") {
    for (const secret of knownSecrets) if (secret.length >= 4 && value.includes(secret)) throw new Error(`${path} contains a resolved secret`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafeServiceData(child, knownSecrets, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_FIELD.test(key)) throw new Error(`${path}.${key} is a forbidden secret field`);
    assertSafeServiceData(child, knownSecrets, `${path}.${key}`);
  }
}

export class HomeAssistantRestAdapter {
  private readonly endpoint: URL;
  private readonly sourceId: string;
  private readonly timeoutMs: number;
  private readonly maxPayloadBytes: number;
  private readonly cacheTtlMs: number;
  private readonly staleIfErrorMs: number;
  private readonly now: () => number;
  private readonly allowedEntities: Set<string>;
  private readonly allowedAttributes = new Map<string, Set<string>>();
  private readonly services = new Map<string, CompiledServiceGrant>();
  private readonly knownSecrets = new Set<string>();
  private readonly restrictedFetchers = new Map<typeof fetch, RestrictedPersonalFetch>();
  private readonly validator = new AjvJsonSchemaValidator();

  constructor(
    readonly config: HomeAssistantRestConfig,
    private readonly dependencies: HomeAssistantDependencies,
  ) {
    this.endpoint = assertAllowedPersonalEndpoint(config.endpoint, config.endpointPolicy);
    if (this.endpoint.search || this.endpoint.hash) throw new Error("Home Assistant endpoint cannot contain query or fragment");
    if (!config.tokenSecretRef) throw new Error("Home Assistant token secretRef is required");
    if (typeof dependencies.resolveSecret !== "function") throw new Error("Home Assistant secret resolver is required");
    this.sourceId = config.id || "home-assistant";
    if (!this.sourceId || this.sourceId.length > 100) throw new Error("Home Assistant source id is invalid");
    this.timeoutMs = positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, "Home Assistant timeout");
    this.maxPayloadBytes = positiveInteger(config.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, "Home Assistant payload limit");
    this.cacheTtlMs = positiveInteger(config.cacheTtlMs, DEFAULT_CACHE_TTL_MS, "Home Assistant cache TTL");
    this.staleIfErrorMs = positiveInteger(config.staleIfErrorMs, DEFAULT_STALE_IF_ERROR_MS, "Home Assistant stale window");
    this.now = dependencies.now ?? Date.now;
    if (!config.allowedEntities.length || config.allowedEntities.length > MAX_ENTITIES) throw new Error("Home Assistant entity allowlist must be non-empty and bounded");
    this.allowedEntities = new Set(config.allowedEntities);
    if (this.allowedEntities.size !== config.allowedEntities.length || [...this.allowedEntities].some((id) => !validEntityId(id))) {
      throw new Error("Home Assistant entity allowlist is invalid");
    }
    this.compileAttributes();
    this.compileServices();
  }

  createContextSource(): ContextSource<HomeAssistantStateData> {
    return {
      descriptor: {
        id: this.sourceId,
        label: "Home Assistant",
        purposes: ["automation"],
        costClass: "local",
        transport: "http",
        certification: "first_party",
        attribution: "Home Assistant",
        license: "User-owned Home Assistant data; no third-party data license",
        cachePolicy: `private; max-age=${Math.floor(this.cacheTtlMs / 1_000)}`,
        retentionPolicy: "Allowlisted minimized entity states only; raw responses are not persisted",
        lastReviewedAt: SOURCE_METADATA_LAST_REVIEWED_AT,
      },
      cacheTtlMs: this.cacheTtlMs,
      timeoutMs: this.timeoutMs,
      staleIfErrorMs: this.staleIfErrorMs,
      query: (request, runtime) => this.queryStates(request, runtime),
    };
  }

  createActionExecutors(): PersonalActionExecutor[] {
    return [...this.services.values()].map((compiled) => this.createExecutor(compiled));
  }

  createActionExecutor(domain: string, service: string): PersonalActionExecutor {
    const compiled = this.services.get(`${domain}.${service}`);
    if (!compiled) throw new Error(`Home Assistant service is not allowlisted: ${domain}.${service}`);
    return this.createExecutor(compiled);
  }

  async dispose(): Promise<void> {
    const fetchers = [...this.restrictedFetchers.values()];
    this.restrictedFetchers.clear();
    await Promise.allSettled(fetchers.map((fetcher) => fetcher.close()));
    this.knownSecrets.clear();
  }

  private compileAttributes(): void {
    for (const [entityId, attributes] of Object.entries(this.config.allowedAttributes ?? {})) {
      if (!this.allowedEntities.has(entityId)) throw new Error(`Home Assistant attributes configured for non-allowlisted entity: ${entityId}`);
      if (!Array.isArray(attributes)) throw new Error(`Home Assistant attribute allowlist is invalid: ${entityId}`);
      const names = new Set(attributes);
      if (names.size !== attributes.length || [...names].some((name) => !name || SENSITIVE_FIELD.test(name))) {
        throw new Error(`Home Assistant attribute allowlist is invalid: ${entityId}`);
      }
      this.allowedAttributes.set(entityId, names);
    }
  }

  private compileServices(): void {
    for (const rawGrant of this.config.services) {
      const grant = cloneJson(rawGrant);
      if (!NAME.test(grant.domain) || !NAME.test(grant.service)) throw new Error("Home Assistant service grant name is invalid");
      if (!grant.impact || grant.impact.length > 500) throw new Error(`Home Assistant service impact is invalid: ${grant.domain}.${grant.service}`);
      if (!grant.entityIds.length || grant.entityIds.length > MAX_ENTITIES) throw new Error(`Home Assistant service entity allowlist is invalid: ${grant.domain}.${grant.service}`);
      const entityIds = new Set(grant.entityIds);
      if (entityIds.size !== grant.entityIds.length || [...entityIds].some((id) => !validEntityId(id))) {
        throw new Error(`Home Assistant service entity allowlist is invalid: ${grant.domain}.${grant.service}`);
      }
      const dataFields = new Set(grant.allowedDataFields);
      if (dataFields.size !== grant.allowedDataFields.length || [...dataFields].some((field) => !NAME.test(field) || field === "entity_id" || SENSITIVE_FIELD.test(field))) {
        throw new Error(`Home Assistant service data allowlist is invalid: ${grant.domain}.${grant.service}`);
      }
      let validateData: CompiledServiceGrant["validateData"];
      if (grant.dataSchema) {
        boundedJsonBytes(grant.dataSchema, this.maxPayloadBytes, `Home Assistant schema for ${grant.domain}.${grant.service}`);
        if (grant.dataSchema.type !== "object" || grant.dataSchema.additionalProperties !== false) {
          throw new Error(`Home Assistant service schema must be a closed object: ${grant.domain}.${grant.service}`);
        }
        assertClosedServiceSchema(grant.dataSchema, `Home Assistant schema for ${grant.domain}.${grant.service}`);
        const properties = grant.dataSchema.properties;
        if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new Error("Home Assistant service schema must define properties");
        for (const property of Object.keys(properties)) if (!dataFields.has(property)) throw new Error("Home Assistant service schema exposes non-allowlisted data");
        try { validateData = this.validator.getValidator(grant.dataSchema); }
        catch (error) { throw new Error(`invalid Home Assistant service schema: ${redactedPersonalError(error)}`); }
      }
      const key = `${grant.domain}.${grant.service}`;
      const kind = grant.kind || homeAssistantActionKind(grant.domain, grant.service);
      if (this.services.has(key) || [...this.services.values()].some((item) => item.kind === kind)) throw new Error(`duplicate Home Assistant service grant: ${key}`);
      this.services.set(key, { grant, kind, risk: effectiveRisk(grant), validateData });
    }
  }

  private selectedEntities(request: PersonalContextQuery): string[] {
    const requested = request.filters?.entityIds;
    let selected: string[];
    if (requested === undefined) selected = [...this.allowedEntities];
    else {
      if (!Array.isArray(requested) || requested.some((id) => typeof id !== "string")) throw new Error("Home Assistant entity filter is invalid");
      selected = [...new Set(requested)];
      for (const entityId of selected) if (!this.allowedEntities.has(entityId)) throw new Error(`Home Assistant entity is not allowlisted: ${entityId}`);
    }
    if (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 0)) throw new Error("Home Assistant entity limit is invalid");
    const limit = request.limit === undefined ? selected.length : Math.min(request.limit, selected.length);
    return selected.slice(0, limit);
  }

  private async queryStates(request: PersonalContextQuery, runtime: ContextSourceRuntime): Promise<ContextCandidate<HomeAssistantStateData>[]> {
    if (request.purpose !== "automation") throw new Error("Home Assistant source only supports automation context");
    const entityIds = this.selectedEntities(request);
    if (!entityIds.length) return [];
    const token = await this.resolveToken(runtime.signal);
    const fetcher = this.restrictedFetch(runtime.fetch);
    try {
      const states = await Promise.all(entityIds.map((entityId) => this.getState(entityId, token, fetcher, runtime.signal)));
      return states.map((state) => this.toCandidate(state));
    } catch (error) {
      throw new Error(redactedPersonalError(error, this.knownSecrets));
    }
  }

  private createExecutor(compiled: CompiledServiceGrant): PersonalActionExecutor {
    return {
      kind: compiled.kind,
      risk: compiled.risk,
      preview: (payload) => {
        const normalized = this.normalizeActionPayload(compiled, payload);
        return redactPersonalSecrets({
          service: `${compiled.grant.domain}.${compiled.grant.service}`,
          entityIds: normalized.entityIds,
          parameters: normalized.data ?? {},
          impact: compiled.grant.impact,
        }, this.knownSecrets);
      },
      execute: async (payload, context) => this.executeService(compiled, payload, context.signal, context.markDispatched),
    };
  }

  private normalizeActionPayload(compiled: CompiledServiceGrant, payload: Record<string, unknown>): HomeAssistantActionPayload {
    boundedJsonBytes(payload, this.maxPayloadBytes, `Home Assistant action ${compiled.kind}`);
    const keys = Object.keys(payload);
    if (keys.some((key) => key !== "entityIds" && key !== "data")) throw new Error("Home Assistant action payload contains non-allowlisted fields");
    if (!Array.isArray(payload.entityIds) || !payload.entityIds.length || payload.entityIds.some((id) => typeof id !== "string")) {
      throw new Error("Home Assistant action entityIds are invalid");
    }
    const entityIds = [...new Set(payload.entityIds as string[])];
    if (entityIds.length !== payload.entityIds.length) throw new Error("Home Assistant action entityIds contain duplicates");
    for (const entityId of entityIds) if (!compiled.grant.entityIds.includes(entityId)) throw new Error(`Home Assistant action entity is not allowlisted: ${entityId}`);
    const rawData = payload.data ?? {};
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) throw new Error("Home Assistant action data is invalid");
    const data = rawData as Record<string, unknown>;
    assertSafeServiceData(data, this.knownSecrets);
    for (const key of Object.keys(data)) {
      if (!compiled.grant.allowedDataFields.includes(key)) throw new Error(`Home Assistant service data is not allowlisted: ${key}`);
      if (SENSITIVE_FIELD.test(key)) throw new Error(`Home Assistant service secret data is forbidden: ${key}`);
    }
    const normalizedData = cloneJson(data);
    if (compiled.validateData) {
      const validation = compiled.validateData(normalizedData);
      if (!validation.valid) throw new Error(`Home Assistant service data failed schema: ${validation.errorMessage}`);
    }
    const normalized = { entityIds, ...(Object.keys(normalizedData).length ? { data: normalizedData } : {}) };
    boundedJsonBytes(normalized, this.maxPayloadBytes, `Home Assistant minimized action ${compiled.kind}`);
    return normalized;
  }

  private async executeService(
    compiled: CompiledServiceGrant,
    payload: Record<string, unknown>,
    signal: AbortSignal,
    markDispatched?: () => void,
  ): Promise<Record<string, unknown>> {
    const normalized = this.normalizeActionPayload(compiled, payload);
    const token = await this.resolveToken(signal);
    const fetcher = this.restrictedFetch(this.dependencies.fetch ?? fetch);
    const body = {
      entity_id: normalized.entityIds.length === 1 ? normalized.entityIds[0] : normalized.entityIds,
      ...(normalized.data ?? {}),
    };
    try {
      markDispatched?.();
      await this.requestJson(
        this.apiUrl("services", compiled.grant.domain, compiled.grant.service),
        token,
        fetcher,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      if (signal.aborted) throw new Error("Home Assistant action aborted");
      const verifiable = normalized.entityIds.filter((entityId) => this.allowedEntities.has(entityId));
      const settled = await Promise.allSettled(verifiable.map((entityId) => this.getState(entityId, token, fetcher, signal)));
      if (signal.aborted) throw new Error("Home Assistant action aborted");
      const verifiedStates = settled
        .filter((result): result is PromiseFulfilledResult<HomeAssistantApiState> => result.status === "fulfilled")
        .map((result) => this.minimizedState(result.value));
      if (verifiable.length !== normalized.entityIds.length || verifiedStates.length !== normalized.entityIds.length) {
        throw new PersonalActionOutcomeUncertainError("Home Assistant action was sent but post-action state verification failed");
      }
      const expectedState = expectedStateAfterService(compiled.grant.domain, compiled.grant.service);
      if (expectedState && verifiedStates.some((state) => state.state !== expectedState)) {
        throw new PersonalActionOutcomeUncertainError(`Home Assistant action was sent but expected state ${expectedState} was not observed`);
      }
      return redactPersonalSecrets({
        service: `${compiled.grant.domain}.${compiled.grant.service}`,
        entityIds: normalized.entityIds,
        verification: expectedState ? "state_matched" : "observed_after_action",
        states: verifiedStates,
      }, this.knownSecrets);
    } catch (error) {
      if (error instanceof PersonalActionOutcomeUncertainError) {
        throw new PersonalActionOutcomeUncertainError(redactedPersonalError(error, this.knownSecrets));
      }
      throw new Error(redactedPersonalError(error, this.knownSecrets));
    }
  }

  private async getState(entityId: string, token: string, fetcher: typeof fetch, signal: AbortSignal): Promise<HomeAssistantApiState> {
    const result = await this.requestJson(this.apiUrl("states", entityId), token, fetcher, signal);
    return parseState(result, entityId);
  }

  private async requestJson(
    url: URL,
    token: string,
    fetcher: typeof fetch,
    parentSignal: AbortSignal,
    init: RequestInit = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (parentSignal.aborted) throw new Error("Home Assistant request aborted");
    parentSignal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("authorization", `Bearer ${token}`);
    try {
      const response = await fetcher(url, { ...init, headers, signal: controller.signal });
      if (!response.ok) {
        void response.body?.cancel();
        throw new Error(`Home Assistant request failed with HTTP ${response.status}`);
      }
      const text = await readBoundedText(response, this.maxPayloadBytes);
      if (!text) return undefined;
      try { return JSON.parse(text) as unknown; }
      catch { throw new Error("Home Assistant returned invalid JSON"); }
    } catch (error) {
      if (timedOut) throw new Error("Home Assistant request timed out");
      if (parentSignal.aborted) throw new Error("Home Assistant request aborted");
      throw new Error(redactedPersonalError(error, this.knownSecrets));
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onAbort);
    }
  }

  private async resolveToken(parentSignal: AbortSignal): Promise<string> {
    if (parentSignal.aborted) throw new Error("Home Assistant token resolution aborted");
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new Error("Home Assistant token resolution timed out")); }, this.timeoutMs);
    });
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error("Home Assistant token resolution aborted"));
      parentSignal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const token = await Promise.race([Promise.resolve(this.dependencies.resolveSecret(this.config.tokenSecretRef)), timeout, aborted]);
      if (typeof token !== "string" || !token || Buffer.byteLength(token) > this.maxPayloadBytes) throw new Error("Home Assistant secret resolver returned an invalid token");
      this.knownSecrets.add(token);
      return token;
    } catch (error) {
      if (timedOut) throw error;
      throw new Error(`Home Assistant token resolution failed: ${redactedPersonalError(error, this.knownSecrets)}`);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) parentSignal.removeEventListener("abort", onAbort);
    }
  }

  private restrictedFetch(fetcher: typeof fetch): RestrictedPersonalFetch {
    const existing = this.restrictedFetchers.get(fetcher);
    if (existing) return existing;
    const restricted = createRestrictedPersonalFetch({
      endpoint: this.endpoint,
      policy: this.config.endpointPolicy,
      fetch: fetcher,
      resolveAddresses: this.dependencies.resolveAddresses,
      maxRequestBytes: this.maxPayloadBytes,
      maxResponseBytes: this.maxPayloadBytes,
    });
    this.restrictedFetchers.set(fetcher, restricted);
    return restricted;
  }

  private apiUrl(...segments: string[]): URL {
    const url = new URL(this.endpoint);
    const prefix = url.pathname.replace(/\/+$/, "");
    url.pathname = `${prefix}/api/${segments.map(encodeURIComponent).join("/")}`;
    url.search = "";
    url.hash = "";
    return url;
  }

  private minimizedState(state: HomeAssistantApiState): HomeAssistantStateData {
    const allowed = this.allowedAttributes.get(state.entity_id) ?? new Set<string>();
    const attributes: Record<string, unknown> = {};
    for (const name of allowed) if (Object.hasOwn(state.attributes, name)) attributes[name] = state.attributes[name];
    return redactPersonalSecrets({
      entityId: state.entity_id,
      state: state.state,
      attributes,
      ...(state.last_changed ? { lastChanged: state.last_changed } : {}),
      ...(state.last_updated ? { lastUpdated: state.last_updated } : {}),
    }, this.knownSecrets);
  }

  private toCandidate(state: HomeAssistantApiState): ContextCandidate<HomeAssistantStateData> {
    const now = this.now();
    const stateObservedAt = observedAt(state, now);
    const age = stateObservedAt === undefined ? Number.POSITIVE_INFINITY : Math.max(0, now - stateObservedAt);
    const source: ContextSourceRef = {
      sourceId: this.sourceId,
      recordId: state.entity_id,
      observedAt: stateObservedAt ?? now,
      freshness: stateObservedAt === undefined ? "unknown" : age <= this.cacheTtlMs ? "live" : age <= this.staleIfErrorMs ? "fresh" : "stale",
      attribution: "Home Assistant",
    };
    const data = this.minimizedState(state);
    const friendlyName = typeof data.attributes.friendly_name === "string" ? data.attributes.friendly_name : state.entity_id;
    return {
      id: `${this.sourceId}:${state.entity_id}`,
      kind: "home_assistant_state",
      title: friendlyName,
      data,
      sources: [source],
    };
  }
}

export function createHomeAssistantRestIntegration(
  config: HomeAssistantRestConfig,
  dependencies: HomeAssistantDependencies,
): HomeAssistantRestIntegration {
  const adapter = new HomeAssistantRestAdapter(config, dependencies);
  return { source: adapter.createContextSource(), executors: adapter.createActionExecutors(), dispose: () => adapter.dispose() };
}

export function createHomeAssistantContextSource(
  config: HomeAssistantRestConfig,
  dependencies: HomeAssistantDependencies,
): ContextSource<HomeAssistantStateData> {
  return new HomeAssistantRestAdapter(config, dependencies).createContextSource();
}

export function createHomeAssistantServiceExecutors(
  config: HomeAssistantRestConfig,
  dependencies: HomeAssistantDependencies,
): PersonalActionExecutor[] {
  return new HomeAssistantRestAdapter(config, dependencies).createActionExecutors();
}
