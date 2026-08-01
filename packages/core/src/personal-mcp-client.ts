import {
  Client,
  StreamableHTTPClientTransport,
  type Tool,
  type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { createHash } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { Agent as UndiciAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import type {
  ContextCandidate,
  ContextSourceDescriptor,
  PersonalActionRisk,
  PersonalContextQuery,
  PersonalSourceDiscovery,
  PersonalSourceDiscoveryResource,
  PersonalSourceDiscoveryTool,
} from "@jarvis/protocol";
import { PERSONAL_SOURCE_DISCOVERY_LIMITS } from "@jarvis/protocol";
import type { ContextSource, ContextSourceRuntime } from "./context-sources.js";
import type { PersonalActionExecutor } from "./personal-actions.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_SCHEMA_BYTES = 64 * 1024;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_MAX_LIST_ITEMS = 256;
const DEFAULT_MAX_LIST_PAGES = 8;
const MAX_SECRET_BYTES = 64 * 1024;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(^|_)(authorization|cookie|credential|passwd|password|secret|token|api_?key)($|_)/i;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export type PersonalSecretResolver = (secretRef: string) => string | Promise<string>;
export type PersonalEndpointNetwork = "loopback" | "lan" | "tailscale" | "remote";

export interface PersonalEndpointPolicy {
  allowLoopback?: boolean;
  allowLan?: boolean;
  allowTailscale?: boolean;
  allowRemoteHttps?: boolean;
  allowInsecureHttp?: boolean;
  allowedHosts?: readonly string[];
}

export interface PersonalMcpToolGrant {
  name: string;
  risk: PersonalActionRisk;
  allowedArguments: readonly string[];
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  maxArgumentBytes?: number;
  maxResultBytes?: number;
}

export interface PersonalMcpResourceGrant {
  uri: string;
  mimeTypes?: readonly string[];
  maxResultBytes?: number;
}

export interface StreamableHttpPersonalMcpTransport {
  kind: "streamable-http";
  endpoint: string;
  profile: "read-only";
  certification: "first_party" | "audited" | "uncertified";
  endpointPolicy: PersonalEndpointPolicy;
  authorizationSecretRef?: string;
}

export interface StdioPersonalMcpTransport {
  kind: "stdio";
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  secretEnv?: Readonly<Record<string, string>>;
}

export type PersonalMcpTransport = StreamableHttpPersonalMcpTransport | StdioPersonalMcpTransport;

export interface PersonalMcpClientConfig {
  id: string;
  transport: PersonalMcpTransport;
  tools: readonly PersonalMcpToolGrant[];
  resources: readonly PersonalMcpResourceGrant[];
  timeoutMs?: number;
  maxSchemaBytes?: number;
  maxPayloadBytes?: number;
  maxListItems?: number;
  maxListPages?: number;
}

interface McpRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxTotalTimeout?: number;
  cacheMode?: "use" | "refresh" | "bypass";
  toolDefinition?: Tool;
}

interface ListedMcpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

interface ListedMcpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface PersonalMcpSdkClient {
  connect(transport: Transport, options?: McpRequestOptions): Promise<void>;
  close(): Promise<void>;
  listTools(params?: undefined, options?: McpRequestOptions): Promise<{ tools: ListedMcpTool[] }>;
  listResources(params?: undefined, options?: McpRequestOptions): Promise<{ resources: ListedMcpResource[] }>;
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    options?: McpRequestOptions,
  ): Promise<unknown>;
  readResource(params: { uri: string }, options?: McpRequestOptions): Promise<unknown>;
}

export interface PersonalMcpTransportFactoryContext {
  config: PersonalMcpTransport;
  resolveSecret(secretRef: string): Promise<string>;
}

export interface PersonalMcpClientDependencies {
  resolveSecret?: PersonalSecretResolver;
  fetch?: typeof fetch;
  resolveAddresses?: PersonalDnsResolver;
  clientFactory?: () => PersonalMcpSdkClient;
  transportFactory?: (context: PersonalMcpTransportFactoryContext) => Transport | Promise<Transport>;
}

export type PersonalDnsResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

export type PersonalMcpClientState = "awaiting_start" | "disconnected" | "connecting" | "connected" | "closing";

const STDIO_START_AUTHORITY = Symbol("jarvis.mcp.stdio.start");

interface CompiledToolGrant {
  grant: PersonalMcpToolGrant;
  validateInput: ReturnType<AjvJsonSchemaValidator["getValidator"]>;
  validateOutput?: ReturnType<AjvJsonSchemaValidator["getValidator"]>;
}

export interface RestrictedFetchOptions {
  endpoint: string | URL;
  policy: PersonalEndpointPolicy;
  fetch?: typeof fetch;
  resolveAddresses?: PersonalDnsResolver;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

export type RestrictedPersonalFetch = typeof fetch & { close(): Promise<void> };

const LOOPBACK_ADDRESSES = new BlockList();
LOOPBACK_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK_ADDRESSES.addAddress("::1", "ipv6");
const BLOCKED_ADDRESSES = new BlockList();
BLOCKED_ADDRESSES.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED_ADDRESSES.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED_ADDRESSES.addSubnet("224.0.0.0", 4, "ipv4");
BLOCKED_ADDRESSES.addSubnet("240.0.0.0", 4, "ipv4");
BLOCKED_ADDRESSES.addAddress("::", "ipv6");
BLOCKED_ADDRESSES.addSubnet("fe80::", 10, "ipv6");
BLOCKED_ADDRESSES.addSubnet("ff00::", 8, "ipv6");
const LAN_ADDRESSES = new BlockList();
LAN_ADDRESSES.addSubnet("10.0.0.0", 8, "ipv4");
LAN_ADDRESSES.addSubnet("172.16.0.0", 12, "ipv4");
LAN_ADDRESSES.addSubnet("192.168.0.0", 16, "ipv4");
LAN_ADDRESSES.addSubnet("fc00::", 7, "ipv6");
const TAILSCALE_ADDRESSES = new BlockList();
TAILSCALE_ADDRESSES.addSubnet("100.64.0.0", 10, "ipv4");
TAILSCALE_ADDRESSES.addSubnet("fd7a:115c:a1e0::", 48, "ipv6");

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${label} must be a positive integer`);
  return resolved;
}

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function ipv4Number(hostname: string): number | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function mappedIpv4(hostname: string): string | undefined {
  const host = normalizedHostname(hostname);
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host)?.[1];
  if (dotted && ipv4Number(dotted) !== undefined) return dotted;
  const hexadecimal = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!hexadecimal) return undefined;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function classifyIpAddress(address: string): PersonalEndpointNetwork | "blocked" {
  const mapped = mappedIpv4(address);
  const candidate = mapped ?? normalizedHostname(address);
  const family = isIP(candidate);
  if (!family) return "blocked";
  const type = family === 4 ? "ipv4" : "ipv6";
  if (LOOPBACK_ADDRESSES.check(candidate, type)) return "loopback";
  if (BLOCKED_ADDRESSES.check(candidate, type)) return "blocked";
  if (TAILSCALE_ADDRESSES.check(candidate, type)) return "tailscale";
  if (LAN_ADDRESSES.check(candidate, type)) return "lan";
  return "remote";
}

function classifyEndpointHost(hostname: string): PersonalEndpointNetwork | "blocked" {
  const host = normalizedHostname(hostname);
  if (isIP(host)) return classifyIpAddress(host);
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (host.endsWith(".ts.net")) return "tailscale";
  if (host.endsWith(".local")) return "lan";
  return "remote";
}

function endpointNetworkAllowed(network: PersonalEndpointNetwork, policy: PersonalEndpointPolicy): boolean | undefined {
  if (network === "loopback") return policy.allowLoopback;
  if (network === "lan") return policy.allowLan;
  if (network === "tailscale") return policy.allowTailscale;
  return policy.allowRemoteHttps;
}

export function assertAllowedPersonalEndpoint(
  value: string | URL,
  policy: PersonalEndpointPolicy = {},
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid personal integration endpoint");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported personal integration endpoint protocol");
  if (url.username || url.password) throw new Error("endpoint credentials in URL are forbidden");
  const host = normalizedHostname(url.hostname);
  const allowlistedHosts = policy.allowedHosts?.map(normalizedHostname);
  if (allowlistedHosts?.length && !allowlistedHosts.includes(host)) throw new Error("personal integration endpoint host is not allowlisted");

  const network = classifyEndpointHost(host);
  if (network === "blocked") throw new Error("link-local and unspecified personal integration endpoints are forbidden");
  const networkAllowed = endpointNetworkAllowed(network, policy);
  if (!networkAllowed) throw new Error(`personal integration ${network} endpoint is not allowed`);
  if (url.protocol === "http:" && (!policy.allowInsecureHttp || network === "remote")) {
    throw new Error("insecure personal integration endpoint is not allowed");
  }
  return url;
}

async function defaultResolveAddresses(hostname: string): Promise<readonly LookupAddress[]> {
  const family = isIP(hostname);
  if (family) return [{ address: hostname, family }];
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export async function resolveAllowedPersonalEndpoint(
  value: string | URL,
  policy: PersonalEndpointPolicy,
  resolveAddresses: PersonalDnsResolver = defaultResolveAddresses,
): Promise<{ url: URL; addresses: readonly LookupAddress[] }> {
  const url = assertAllowedPersonalEndpoint(value, policy);
  const host = normalizedHostname(url.hostname);
  const expectedNetwork = classifyEndpointHost(host);
  let resolved: readonly LookupAddress[];
  try {
    resolved = await resolveAddresses(host);
  } catch {
    throw new Error("personal integration endpoint DNS resolution failed");
  }
  if (!resolved.length || resolved.length > 32) throw new Error("personal integration endpoint returned an invalid DNS result");
  const deduplicated = new Map<string, LookupAddress>();
  for (const row of resolved) {
    const address = normalizedHostname(row.address);
    const family = isIP(address);
    if ((family !== 4 && family !== 6) || family !== row.family) throw new Error("personal integration endpoint returned an invalid DNS address");
    const network = classifyIpAddress(address);
    if (network === "blocked") throw new Error("personal integration endpoint resolved to a forbidden address");
    if (network !== expectedNetwork) throw new Error(`personal integration endpoint DNS network changed from ${expectedNetwork} to ${network}`);
    if (!endpointNetworkAllowed(network, policy)) throw new Error(`personal integration ${network} address is not allowed`);
    deduplicated.set(`${family}:${address}`, { address, family });
  }
  if (!deduplicated.size) throw new Error("personal integration endpoint returned no usable DNS address");
  return { url, addresses: [...deduplicated.values()] };
}

function pinnedLookup(hostname: string, addresses: readonly LookupAddress[]): LookupFunction {
  const expectedHost = normalizedHostname(hostname);
  return (requestedHost, options, callback) => {
    if (normalizedHostname(requestedHost) !== expectedHost) {
      callback(Object.assign(new Error("personal integration DNS pin rejected a different hostname"), { code: "EACCES" }), "", 0);
      return;
    }
    const requestedFamily = options.family === 4 || options.family === 6 ? options.family : undefined;
    const eligible = requestedFamily ? addresses.filter((row) => row.family === requestedFamily) : addresses;
    if (!eligible.length) {
      callback(Object.assign(new Error("personal integration DNS pin has no address for the requested family"), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    if (options.all) callback(null, eligible.map((row) => ({ ...row })));
    else callback(null, eligible[0].address, eligible[0].family);
  };
}

function requestBodyBytes(body: BodyInit | null | undefined): number | undefined {
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
}

function responseWithByteLimit(response: Response, maximum: number): Response {
  if (!response.body) return response;
  let received = 0;
  const boundedBody = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maximum) {
        controller.error(new Error("personal integration response exceeds payload limit"));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  const bounded = new Response(boundedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.defineProperties(bounded, {
    redirected: { value: response.redirected },
    type: { value: response.type },
    url: { value: response.url },
  });
  return bounded;
}

export function createRestrictedPersonalFetch(options: RestrictedFetchOptions): RestrictedPersonalFetch {
  const endpoint = assertAllowedPersonalEndpoint(options.endpoint, options.policy);
  const fetcher = options.fetch ?? (undiciFetch as unknown as typeof fetch);
  const maxRequestBytes = positiveInteger(options.maxRequestBytes, DEFAULT_MAX_PAYLOAD_BYTES, "max request bytes");
  const maxResponseBytes = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_PAYLOAD_BYTES, "max response bytes");
  let dispatcherPromise: Promise<Dispatcher> | undefined;
  const dispatcher = (): Promise<Dispatcher> => {
    if (!dispatcherPromise) {
      dispatcherPromise = resolveAllowedPersonalEndpoint(endpoint, options.policy, options.resolveAddresses)
        .then(({ addresses }) => new UndiciAgent({ connect: { lookup: pinnedLookup(endpoint.hostname, addresses) } }));
    }
    return dispatcherPromise;
  };
  const restricted = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = assertAllowedPersonalEndpoint(input instanceof Request ? input.url : input, options.policy);
    if (requestUrl.origin !== endpoint.origin) throw new Error("cross-origin personal integration request is forbidden");
    const bodyBytes = requestBodyBytes(init?.body);
    if (bodyBytes !== undefined && bodyBytes > maxRequestBytes) throw new Error("personal integration request exceeds payload limit");
    if (input instanceof Request) {
      const declaredRequestBytes = Number(input.headers.get("content-length"));
      if (Number.isFinite(declaredRequestBytes) && declaredRequestBytes > maxRequestBytes) throw new Error("personal integration request exceeds payload limit");
    }
    const pinnedDispatcher = await dispatcher();
    const response = await fetcher(input, { ...init, redirect: "manual", dispatcher: pinnedDispatcher } as RequestInit);
    if (REDIRECT_STATUS.has(response.status)) throw new Error("personal integration redirects are forbidden");
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      void response.body?.cancel();
      throw new Error("personal integration response exceeds payload limit");
    }
    return responseWithByteLimit(response, maxResponseBytes);
  }) as RestrictedPersonalFetch;
  restricted.close = async () => {
    if (!dispatcherPromise) return;
    const active = await dispatcherPromise.catch(() => undefined);
    if (active) await active.close();
    dispatcherPromise = undefined;
  };
  return restricted;
}

function jsonText(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error("value is not JSON serializable");
    return result;
  } catch {
    throw new Error("value is not valid bounded JSON");
  }
}

export function boundedJsonBytes(value: unknown, maximum: number, label: string): number {
  const bytes = Buffer.byteLength(jsonText(value));
  if (bytes > maximum) throw new Error(`${label} exceeds ${maximum} bytes`);
  return bytes;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(jsonText(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function redactedString(value: string, secrets: readonly string[]): string {
  let result = value.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${REDACTED}`);
  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
    if (secret.length >= 4) result = result.split(secret).join(REDACTED);
  }
  return result;
}

export function redactPersonalSecrets<T>(value: T, secrets: Iterable<string> = []): T {
  const known = [...secrets].filter((secret) => secret.length > 0);
  const visit = (current: unknown, key?: string): unknown => {
    if (typeof current === "string") return key && SENSITIVE_KEY.test(key) ? REDACTED : redactedString(current, known);
    if (Array.isArray(current)) return current.map((item) => visit(item));
    if (current && typeof current === "object") {
      const output: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(current)) output[childKey] = visit(childValue, childKey);
      return output;
    }
    return current;
  };
  return visit(value) as T;
}

export function redactedPersonalError(error: unknown, secrets: Iterable<string> = []): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactedString(raw, [...secrets]).slice(0, 1_000);
}

function assertSafeArgumentTree(value: unknown, knownSecrets: ReadonlySet<string>, path = "arguments"): void {
  if (typeof value === "string") {
    for (const secret of knownSecrets) {
      if (secret.length >= 4 && value.includes(secret)) throw new Error(`${path} contains a resolved secret`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeArgumentTree(item, knownSecrets, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new Error(`${path}.${key} is a forbidden secret field`);
    assertSafeArgumentTree(child, knownSecrets, `${path}.${key}`);
  }
}

function assertClosedPolicySchema(schema: Record<string, unknown>, allowedArguments: readonly string[], label: string): void {
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    throw new Error(`${label} must be a closed object schema`);
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new Error(`${label} must define properties`);
  const propertyNames = new Set(Object.keys(properties));
  const allowed = new Set(allowedArguments);
  if (allowed.size !== allowedArguments.length) throw new Error(`${label} has duplicate allowed arguments`);
  for (const name of allowed) {
    if (!name || !propertyNames.has(name)) throw new Error(`${label} allowed argument is absent from schema: ${name}`);
    if (SENSITIVE_KEY.test(name) || ["__proto__", "prototype", "constructor"].includes(name)) {
      throw new Error(`${label} exposes a forbidden argument: ${name}`);
    }
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const name of required) if (typeof name !== "string" || !allowed.has(name)) throw new Error(`${label} requires a non-allowlisted argument`);

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

function makeSdkClient(id: string, maxListPages: number): PersonalMcpSdkClient {
  const client = new Client(
    { name: `jarvis-personal-${id}`, version: "0.5.0" },
    {
      capabilities: {},
      enforceStrictCapabilities: true,
      inputRequired: { autoFulfill: false },
      listMaxPages: maxListPages,
      defaultCacheTtlMs: 0,
    },
  );
  return {
    connect: (transport, options) => client.connect(transport, options),
    close: () => client.close(),
    listTools: (_params, options) => client.listTools(undefined, options),
    listResources: (_params, options) => client.listResources(undefined, options),
    callTool: (params, options) => client.callTool(params, options),
    readResource: (params, options) => client.readResource(params, options),
  };
}

export class ManagedPersonalMcpClient {
  readonly config: PersonalMcpClientConfig;
  private readonly timeoutMs: number;
  private readonly maxSchemaBytes: number;
  private readonly maxPayloadBytes: number;
  private readonly maxListItems: number;
  private readonly maxListPages: number;
  private readonly toolGrants = new Map<string, CompiledToolGrant>();
  private readonly resourceGrants = new Map<string, PersonalMcpResourceGrant>();
  private readonly knownSecrets = new Set<string>();
  private readonly protectedEnvironmentValues = new Set<string>();
  private readonly validator = new AjvJsonSchemaValidator();
  private sdkClient?: PersonalMcpSdkClient;
  private transport?: Transport;
  private restrictedFetch?: RestrictedPersonalFetch;
  private advertisedTools = new Map<string, ListedMcpTool>();
  private advertisedResources = new Map<string, ListedMcpResource>();
  private connectPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private lifecycleState: PersonalMcpClientState = "disconnected";

  constructor(
    config: PersonalMcpClientConfig,
    private readonly dependencies: PersonalMcpClientDependencies = {},
  ) {
    const normalized = jsonClone(config);
    if (normalized.transport.kind === "stdio" && normalized.transport.cwd === undefined) {
      normalized.transport = { ...normalized.transport, cwd: process.cwd() };
    }
    this.config = deepFreeze(normalized);
    if (this.config.transport.kind === "stdio") {
      for (const [key, value] of Object.entries(this.config.transport.env ?? {})) {
        if (key.length >= 4) this.protectedEnvironmentValues.add(key);
        if (value.length >= 4) this.protectedEnvironmentValues.add(value);
      }
      for (const [key, secretRef] of Object.entries(this.config.transport.secretEnv ?? {})) {
        if (key.length >= 4) this.protectedEnvironmentValues.add(key);
        if (secretRef.length >= 4) this.protectedEnvironmentValues.add(secretRef);
      }
    } else if (this.config.transport.authorizationSecretRef?.length && this.config.transport.authorizationSecretRef.length >= 4) {
      this.protectedEnvironmentValues.add(this.config.transport.authorizationSecretRef);
    }
    if (!this.config.id || this.config.id.length > 100) throw new Error("MCP client id is required and must be bounded");
    this.timeoutMs = positiveInteger(this.config.timeoutMs, DEFAULT_TIMEOUT_MS, "MCP timeout");
    this.maxSchemaBytes = positiveInteger(this.config.maxSchemaBytes, DEFAULT_MAX_SCHEMA_BYTES, "MCP schema limit");
    this.maxPayloadBytes = positiveInteger(this.config.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, "MCP payload limit");
    this.maxListItems = positiveInteger(this.config.maxListItems, DEFAULT_MAX_LIST_ITEMS, "MCP list item limit");
    this.maxListPages = positiveInteger(this.config.maxListPages, DEFAULT_MAX_LIST_PAGES, "MCP list page limit");
    this.validateTransport();
    this.compileGrants();
    if (this.config.transport.kind === "stdio") this.lifecycleState = "awaiting_start";
  }

  get state(): PersonalMcpClientState { return this.lifecycleState; }
  get transportKind(): PersonalMcpTransport["kind"] { return this.config.transport.kind; }

  toolRisk(name: string): PersonalActionRisk {
    const grant = this.toolGrants.get(name)?.grant;
    if (!grant) throw new Error(`MCP tool is not allowlisted: ${name}`);
    return grant.risk;
  }

  allowedToolNames(): string[] { return [...this.toolGrants.keys()]; }
  allowedResourceUris(): string[] { return [...this.resourceGrants.keys()]; }

  async discover(signal?: AbortSignal): Promise<PersonalSourceDiscovery> {
    if (this.config.transport.kind === "stdio" && this.lifecycleState !== "connected") {
      return this.discoverySnapshot(this.lifecycleState, "unknown");
    }
    const startedAt = Date.now();
    if (this.lifecycleState === "connected") {
      await this.loadAdvertisedCapabilities(this.connectedClient(), signal, true);
    } else {
      await this.connectAuthorized(signal, undefined, true);
    }
    return this.discoverySnapshot("connected", "healthy", Math.max(0, Date.now() - startedAt));
  }

  private validateTransport(): void {
    const transport = this.config.transport;
    if (transport.kind === "streamable-http") {
      assertAllowedPersonalEndpoint(transport.endpoint, transport.endpointPolicy);
      if (transport.profile !== "read-only") throw new Error("Streamable HTTP MCP must use the read-only profile");
      if (transport.authorizationSecretRef !== undefined && !transport.authorizationSecretRef) throw new Error("MCP authorization secretRef cannot be empty");
      return;
    }
    if (!transport.command || transport.command.includes("\0")) throw new Error("stdio MCP command is invalid");
    if (transport.args?.some((argument) => argument.includes("\0"))) throw new Error("stdio MCP argument is invalid");
    if (transport.cwd?.includes("\0")) throw new Error("stdio MCP cwd is invalid");
    for (const [key, value] of Object.entries(transport.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes("\0")) throw new Error("stdio MCP environment entry is invalid");
      if (SENSITIVE_KEY.test(key)) throw new Error(`stdio MCP secret environment must use secretEnv: ${key}`);
    }
    for (const [key, secretRef] of Object.entries(transport.secretEnv ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !secretRef) throw new Error("stdio MCP secret environment entry is invalid");
    }
  }

  private compileGrants(): void {
    for (const rawGrant of this.config.tools) {
      const grant = jsonClone(rawGrant);
      if (!grant.name || this.toolGrants.has(grant.name)) throw new Error(`duplicate or empty MCP tool grant: ${grant.name}`);
      if (this.config.transport.kind === "streamable-http" && grant.risk !== "read") {
        throw new Error(`Streamable HTTP read-only profile cannot grant action tool: ${grant.name}`);
      }
      boundedJsonBytes(grant.inputSchema, this.maxSchemaBytes, `MCP input schema for ${grant.name}`);
      assertClosedPolicySchema(grant.inputSchema, grant.allowedArguments, `MCP input schema for ${grant.name}`);
      let validateInput: CompiledToolGrant["validateInput"];
      let validateOutput: CompiledToolGrant["validateOutput"];
      try {
        validateInput = this.validator.getValidator(grant.inputSchema);
        if (grant.outputSchema) {
          boundedJsonBytes(grant.outputSchema, this.maxSchemaBytes, `MCP output schema for ${grant.name}`);
          validateOutput = this.validator.getValidator(grant.outputSchema);
        }
      } catch (error) {
        throw new Error(`invalid MCP policy schema for ${grant.name}: ${redactedPersonalError(error)}`);
      }
      if (grant.maxArgumentBytes !== undefined) positiveInteger(grant.maxArgumentBytes, this.maxPayloadBytes, "MCP tool argument limit");
      if (grant.maxResultBytes !== undefined) positiveInteger(grant.maxResultBytes, this.maxPayloadBytes, "MCP tool result limit");
      this.toolGrants.set(grant.name, { grant, validateInput, validateOutput });
    }
    for (const rawGrant of this.config.resources) {
      const grant = jsonClone(rawGrant);
      if (!grant.uri || this.resourceGrants.has(grant.uri)) throw new Error(`duplicate or empty MCP resource grant: ${grant.uri}`);
      try { new URL(grant.uri); } catch { throw new Error(`MCP resource grant must be an absolute URI: ${grant.uri}`); }
      if (grant.maxResultBytes !== undefined) positiveInteger(grant.maxResultBytes, this.maxPayloadBytes, "MCP resource result limit");
      this.resourceGrants.set(grant.uri, grant);
    }
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.lifecycleState === "connected") return;
    if (this.connectPromise) return this.connectPromise;
    if (this.config.transport.kind === "stdio") {
      throw new Error("MCP stdio process is awaiting an approved start action");
    }
    return this.connectAuthorized(signal);
  }

  async [STDIO_START_AUTHORITY](signal?: AbortSignal, markDispatched?: () => void): Promise<void> {
    if (this.config.transport.kind !== "stdio") throw new Error("MCP start action requires a stdio transport");
    return this.connectAuthorized(signal, markDispatched);
  }

  private async connectAuthorized(signal?: AbortSignal, markDispatched?: () => void, listAll = false): Promise<void> {
    if (this.lifecycleState === "connected") return;
    if (this.connectPromise) {
      await this.connectPromise;
      if (listAll) await this.loadAdvertisedCapabilities(this.connectedClient(), signal, true);
      return;
    }
    if (this.closePromise) await this.closePromise;
    this.lifecycleState = "connecting";
    const operation = this.connectOnce(signal, markDispatched, listAll).finally(() => { this.connectPromise = undefined; });
    this.connectPromise = operation;
    return operation;
  }

  private async connectOnce(signal?: AbortSignal, markDispatched?: () => void, listAll = false): Promise<void> {
    let client: PersonalMcpSdkClient | undefined;
    try {
      client = this.dependencies.clientFactory?.() ?? makeSdkClient(this.config.id, this.maxListPages);
      const activeClient = client;
      this.sdkClient = activeClient;
      this.transport = await this.createTransport();
      markDispatched?.();
      await this.withTimeout("MCP connect", signal, (requestSignal) => activeClient.connect(this.transport!, this.requestOptions(requestSignal)));
      await this.loadAdvertisedCapabilities(activeClient, signal, listAll);
      this.lifecycleState = "connected";
    } catch (error) {
      const redactedError = redactedPersonalError(error, this.redactionValues());
      if (client) await this.closeAfterFailure(client);
      else this.sdkClient = undefined;
      this.lifecycleState = this.idleState();
      throw new Error(redactedError);
    }
  }

  private async createTransport(): Promise<Transport> {
    const context: PersonalMcpTransportFactoryContext = {
      config: this.config.transport,
      resolveSecret: (secretRef) => this.resolveSecret(secretRef),
    };
    if (this.dependencies.transportFactory) return this.dependencies.transportFactory(context);
    const transport = this.config.transport;
    if (transport.kind === "streamable-http") {
      const restrictedFetch = createRestrictedPersonalFetch({
        endpoint: transport.endpoint,
        policy: transport.endpointPolicy,
        fetch: this.dependencies.fetch,
        resolveAddresses: this.dependencies.resolveAddresses,
        maxRequestBytes: this.maxPayloadBytes,
        maxResponseBytes: this.maxPayloadBytes,
      });
      this.restrictedFetch = restrictedFetch;
      const authProvider = transport.authorizationSecretRef
        ? { token: () => this.resolveSecret(transport.authorizationSecretRef!) }
        : undefined;
      return new StreamableHTTPClientTransport(new URL(transport.endpoint), {
        authProvider,
        fetch: restrictedFetch,
        onInsufficientScope: "throw",
        maxStepUpRetries: 0,
      });
    }
    let env: Record<string, string> | undefined;
    if (transport.env || transport.secretEnv) {
      env = { ...getDefaultEnvironment(), ...transport.env };
      for (const [key, secretRef] of Object.entries(transport.secretEnv ?? {})) env[key] = await this.resolveSecret(secretRef);
    }
    return new StdioClientTransport({
      command: transport.command,
      args: transport.args ? [...transport.args] : undefined,
      cwd: transport.cwd,
      env,
      stderr: "ignore",
      maxBufferSize: this.maxPayloadBytes,
    });
  }

  private async resolveSecret(secretRef: string): Promise<string> {
    const resolver = this.dependencies.resolveSecret;
    if (!resolver) throw new Error("MCP secret resolver is not configured");
    let value: string;
    try {
      value = await this.withTimeout("MCP secret resolution", undefined, async () => resolver(secretRef));
    } catch (error) {
      throw new Error(`MCP secret resolution failed: ${redactedPersonalError(error, this.redactionValues())}`);
    }
    if (typeof value !== "string" || !value || Buffer.byteLength(value) > MAX_SECRET_BYTES) throw new Error("MCP secret resolver returned an invalid value");
    this.knownSecrets.add(value);
    return value;
  }

  private async loadAdvertisedCapabilities(client: PersonalMcpSdkClient, signal?: AbortSignal, listAll = false): Promise<void> {
    const tools = listAll || this.toolGrants.size
      ? await this.withTimeout("MCP tools/list", signal, (requestSignal) => client.listTools(undefined, this.requestOptions(requestSignal)))
      : { tools: [] };
    boundedJsonBytes(tools, this.maxSchemaBytes * this.maxListItems, "MCP tools/list response");
    if (!Array.isArray(tools.tools) || tools.tools.length > this.maxListItems) throw new Error("MCP tools/list exceeds item limit");
    const advertisedTools = new Map<string, ListedMcpTool>();
    for (const tool of tools.tools) {
      if (!tool || typeof tool.name !== "string" || !tool.inputSchema || typeof tool.inputSchema !== "object") throw new Error("MCP server returned an invalid tool definition");
      boundedJsonBytes(tool.inputSchema, this.maxSchemaBytes, `MCP server schema for ${tool.name}`);
      if (tool.outputSchema) boundedJsonBytes(tool.outputSchema, this.maxSchemaBytes, `MCP server output schema for ${tool.name}`);
      if (advertisedTools.has(tool.name)) throw new Error(`MCP server advertised duplicate tool: ${tool.name}`);
      advertisedTools.set(tool.name, tool);
    }
    for (const name of this.toolGrants.keys()) if (!advertisedTools.has(name)) throw new Error(`allowlisted MCP tool was not advertised: ${name}`);

    const resources = listAll || this.resourceGrants.size
      ? await this.withTimeout("MCP resources/list", signal, (requestSignal) => client.listResources(undefined, this.requestOptions(requestSignal)))
      : { resources: [] };
    boundedJsonBytes(resources, this.maxSchemaBytes * this.maxListItems, "MCP resources/list response");
    if (!Array.isArray(resources.resources) || resources.resources.length > this.maxListItems) throw new Error("MCP resources/list exceeds item limit");
    const advertisedResources = new Map<string, ListedMcpResource>();
    for (const resource of resources.resources) {
      if (!resource || typeof resource.uri !== "string") throw new Error("MCP server returned an invalid resource definition");
      try { new URL(resource.uri); } catch { throw new Error("MCP server returned a resource with an invalid URI"); }
      if (advertisedResources.has(resource.uri)) throw new Error(`MCP server advertised duplicate resource: ${resource.uri}`);
      advertisedResources.set(resource.uri, resource);
    }
    for (const uri of this.resourceGrants.keys()) if (!advertisedResources.has(uri)) throw new Error(`allowlisted MCP resource was not advertised: ${uri}`);
    this.advertisedTools = advertisedTools;
    this.advertisedResources = advertisedResources;
  }

  prepareToolArguments(
    name: string,
    input: Record<string, unknown>,
    options: { requireExact?: boolean } = {},
  ): Record<string, unknown> {
    const compiled = this.toolGrants.get(name);
    if (!compiled) throw new Error(`MCP tool is not allowlisted: ${name}`);
    const maximum = Math.min(compiled.grant.maxArgumentBytes ?? this.maxPayloadBytes, this.maxPayloadBytes);
    boundedJsonBytes(input, maximum, `MCP arguments for ${name}`);
    const minimized: Record<string, unknown> = {};
    for (const key of compiled.grant.allowedArguments) if (Object.hasOwn(input, key)) minimized[key] = input[key];
    assertSafeArgumentTree(minimized, this.knownSecrets);
    const normalized = jsonClone(minimized);
    if (options.requireExact && !isDeepStrictEqual(normalized, input)) throw new Error(`MCP action arguments for ${name} are not minimized`);
    const validation = compiled.validateInput(normalized);
    if (!validation.valid) throw new Error(`MCP arguments failed policy schema for ${name}: ${validation.errorMessage}`);
    boundedJsonBytes(normalized, maximum, `MCP minimized arguments for ${name}`);
    return normalized;
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    options: { approvedRisk?: PersonalActionRisk; signal?: AbortSignal; requireExactArguments?: boolean } = {},
  ): Promise<unknown> {
    const compiled = this.toolGrants.get(name);
    if (!compiled) throw new Error(`MCP tool is not allowlisted: ${name}`);
    if (compiled.grant.risk !== "read" && options.approvedRisk !== compiled.grant.risk) {
      throw new Error(`MCP action tool requires Jarvis risk approval: ${name}`);
    }
    const args = this.prepareToolArguments(name, input, { requireExact: options.requireExactArguments });
    const client = this.connectedClient();
    const definition = this.advertisedTools.get(name);
    if (!definition) throw new Error(`allowlisted MCP tool is unavailable: ${name}`);
    const result = await this.withTimeout(`MCP tool ${name}`, options.signal, (requestSignal) => client.callTool(
      { name, arguments: args },
      { ...this.requestOptions(requestSignal), toolDefinition: definition as Tool },
    ));
    const maximum = Math.min(compiled.grant.maxResultBytes ?? this.maxPayloadBytes, this.maxPayloadBytes);
    boundedJsonBytes(result, maximum, `MCP result for ${name}`);
    if (result && typeof result === "object" && (result as { isError?: unknown }).isError === true) {
      throw new Error(`MCP tool reported failure: ${name}`);
    }
    const sanitized = redactPersonalSecrets(jsonClone(result), this.redactionValues());
    if (compiled.validateOutput) {
      const structured = sanitized && typeof sanitized === "object"
        ? (sanitized as { structuredContent?: unknown }).structuredContent
        : undefined;
      const validation = compiled.validateOutput(structured);
      if (!validation.valid) throw new Error(`MCP result failed policy schema for ${name}: ${validation.errorMessage}`);
    }
    return sanitized;
  }

  async readResource(uri: string, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    const grant = this.resourceGrants.get(uri);
    if (!grant) throw new Error(`MCP resource is not allowlisted: ${uri}`);
    if (!this.advertisedResources.has(uri)) throw new Error(`allowlisted MCP resource is unavailable: ${uri}`);
    const result = await this.withTimeout(`MCP resource ${uri}`, options.signal, (requestSignal) => this.connectedClient().readResource(
      { uri },
      { ...this.requestOptions(requestSignal), cacheMode: "bypass" },
    ));
    const maximum = Math.min(grant.maxResultBytes ?? this.maxPayloadBytes, this.maxPayloadBytes);
    boundedJsonBytes(result, maximum, `MCP resource result for ${uri}`);
    if (!result || typeof result !== "object") throw new Error(`MCP resource result is invalid: ${uri}`);
    const contents = (result as { contents?: unknown }).contents;
    if (!Array.isArray(contents)) throw new Error(`MCP resource result is invalid: ${uri}`);
    for (const content of contents) {
      if (!content || typeof content !== "object" || (content as { uri?: unknown }).uri !== uri) throw new Error(`MCP resource result escaped allowlist: ${uri}`);
      const mimeType = (content as { mimeType?: unknown }).mimeType;
      if (grant.mimeTypes?.length && (typeof mimeType !== "string" || !grant.mimeTypes.includes(mimeType))) {
        throw new Error(`MCP resource result has a forbidden MIME type: ${uri}`);
      }
    }
    return redactPersonalSecrets(jsonClone(result), this.redactionValues());
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const operation = this.closeOnce().finally(() => { this.closePromise = undefined; });
    this.closePromise = operation;
    return operation;
  }

  private async closeOnce(): Promise<void> {
    if (this.connectPromise) await this.connectPromise.catch(() => undefined);
    if (!this.sdkClient) {
      await this.closeRestrictedFetch();
      this.lifecycleState = this.idleState();
      return;
    }
    this.lifecycleState = "closing";
    const client = this.sdkClient;
    this.sdkClient = undefined;
    this.transport = undefined;
    this.advertisedTools.clear();
    this.advertisedResources.clear();
    try {
      await this.withTimeout("MCP close", undefined, () => client.close());
    } finally {
      await this.closeRestrictedFetch();
      this.lifecycleState = this.idleState();
      this.knownSecrets.clear();
    }
  }

  private async closeAfterFailure(client: PersonalMcpSdkClient): Promise<void> {
    try { await this.withTimeout("MCP failed connection close", undefined, () => client.close()); } catch { /* best effort */ }
    await this.closeRestrictedFetch();
    this.sdkClient = undefined;
    this.transport = undefined;
    this.advertisedTools.clear();
    this.advertisedResources.clear();
    this.knownSecrets.clear();
  }

  private async closeRestrictedFetch(): Promise<void> {
    const restricted = this.restrictedFetch;
    this.restrictedFetch = undefined;
    if (restricted) await restricted.close().catch(() => undefined);
  }

  private connectedClient(): PersonalMcpSdkClient {
    if (this.lifecycleState !== "connected" || !this.sdkClient) throw new Error("MCP client is not connected");
    return this.sdkClient;
  }

  private redactionValues(): string[] {
    return [...this.knownSecrets, ...this.protectedEnvironmentValues];
  }

  private metadataText(value: unknown, maximum: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const sanitized = redactedString(value, this.redactionValues()).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    return sanitized ? sanitized.slice(0, maximum) : undefined;
  }

  private discoverySnapshot(
    state: PersonalSourceDiscovery["state"],
    health: PersonalSourceDiscovery["health"],
    latencyMs?: number,
  ): PersonalSourceDiscovery {
    const tools = new Map<string, PersonalSourceDiscoveryTool>();
    for (const name of this.toolGrants.keys()) {
      const safeName = this.metadataText(name, 200) ?? "[invalid]";
      tools.set(name, { id: safeName, name: safeName, allowed: true, advertised: false });
    }
    for (const [name, advertised] of this.advertisedTools) {
      const safeName = this.metadataText(name, 200) ?? "[invalid]";
      const description = this.metadataText(advertised.description, 500);
      tools.set(name, {
        id: safeName,
        name: safeName,
        ...(description ? { description } : {}),
        allowed: this.toolGrants.has(name),
        advertised: true,
      });
    }

    const resources = new Map<string, PersonalSourceDiscoveryResource>();
    for (const uri of this.resourceGrants.keys()) {
      const safeUri = this.metadataText(uri, 2_000) ?? "[invalid]";
      resources.set(uri, { id: safeUri, href: safeUri, allowed: true, advertised: false });
    }
    for (const [uri, advertised] of this.advertisedResources) {
      const safeUri = this.metadataText(uri, 2_000) ?? "[invalid]";
      const name = this.metadataText(advertised.name, 200);
      const description = this.metadataText(advertised.description, 500);
      const mime = this.metadataText(advertised.mimeType, 200);
      resources.set(uri, {
        id: safeUri,
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        href: safeUri,
        ...(mime ? { mime } : {}),
        allowed: this.resourceGrants.has(uri),
        advertised: true,
      });
    }

    const orderedTools = [...tools.values()].sort((left, right) => Number(right.allowed) - Number(left.allowed) || left.id.localeCompare(right.id));
    const orderedResources = [...resources.values()].sort((left, right) => Number(right.allowed) - Number(left.allowed) || left.id.localeCompare(right.id));
    return {
      sourceId: this.metadataText(this.config.id, 200) ?? "[invalid]",
      state,
      health,
      ...(latencyMs === undefined ? {} : { latencyMs }),
      calendars: [],
      tools: orderedTools.slice(0, PERSONAL_SOURCE_DISCOVERY_LIMITS.tools),
      resources: orderedResources.slice(0, PERSONAL_SOURCE_DISCOVERY_LIMITS.resources),
      truncated: {
        calendars: false,
        tools: orderedTools.length > PERSONAL_SOURCE_DISCOVERY_LIMITS.tools,
        resources: orderedResources.length > PERSONAL_SOURCE_DISCOVERY_LIMITS.resources,
      },
    };
  }

  private idleState(): PersonalMcpClientState {
    return this.config.transport.kind === "stdio" ? "awaiting_start" : "disconnected";
  }

  private requestOptions(signal: AbortSignal): McpRequestOptions {
    return { signal, timeout: this.timeoutMs, maxTotalTimeout: this.timeoutMs };
  }

  private async withTimeout<T>(
    label: string,
    parentSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T> | T,
  ): Promise<T> {
    if (parentSignal?.aborted) throw new Error(`${label} aborted`);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    parentSignal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error(timedOut ? `${label} timed out` : `${label} aborted`)), { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), aborted]);
    } catch (error) {
      throw new Error(redactedPersonalError(error, this.redactionValues()));
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    }
  }
}

export interface McpStdioStartActionExecutorOptions {
  client: ManagedPersonalMcpClient;
  kind: string;
  impact: string;
}

export function createMcpStdioStartActionExecutor(
  options: McpStdioStartActionExecutorOptions,
): PersonalActionExecutor {
  if (!options.kind || !options.impact) throw new Error("MCP stdio start action kind and impact are required");
  const transport = options.client.config.transport;
  if (transport.kind !== "stdio") throw new Error("MCP start action requires a stdio transport");
  const configuredEnvNames = [...new Set([
    ...Object.keys(transport.env ?? {}),
    ...Object.keys(transport.secretEnv ?? {}),
  ])].sort();
  const preview = {
    type: "shell",
    operation: "mcp_stdio_start",
    command: transport.command,
    cwd: transport.cwd ?? process.cwd(),
    configuredEnvNames,
    impact: options.impact,
  };
  const fingerprint = createHash("sha256").update(jsonText({
    command: transport.command,
    args: transport.args ?? [],
    cwd: preview.cwd,
    env: transport.env ?? {},
    secretEnv: transport.secretEnv ?? {},
  })).digest("hex");
  const assertEmptyPayload = (payload: Record<string, unknown>): void => {
    if (Object.keys(payload).length) throw new Error("MCP stdio start action does not accept payload fields");
  };
  return {
    kind: options.kind,
    risk: "consequential",
    fingerprint: `stdio-start-v1:${fingerprint}`,
    preview(payload) {
      assertEmptyPayload(payload);
      return { ...structuredClone(preview), state: options.client.state };
    },
    async execute(payload, context) {
      assertEmptyPayload(payload);
      await options.client[STDIO_START_AUTHORITY](context.signal, context.markDispatched);
      return { transport: "stdio", state: options.client.state };
    },
  };
}

export interface McpToolContextSourceOptions<T extends Record<string, unknown>> {
  client: ManagedPersonalMcpClient;
  descriptor: ContextSourceDescriptor;
  toolName: string;
  buildArguments(request: PersonalContextQuery): Record<string, unknown>;
  mapResult(result: unknown, request: PersonalContextQuery, runtime: ContextSourceRuntime): ContextCandidate<T>[];
  cacheTtlMs?: number;
  timeoutMs?: number;
  staleIfErrorMs?: number;
}

export function createMcpToolContextSource<T extends Record<string, unknown>>(
  options: McpToolContextSourceOptions<T>,
): ContextSource<T> {
  if (options.client.toolRisk(options.toolName) !== "read") throw new Error("MCP context source tool must have Jarvis read risk");
  return {
    descriptor: jsonClone(options.descriptor),
    cacheTtlMs: options.cacheTtlMs,
    timeoutMs: options.timeoutMs,
    staleIfErrorMs: options.staleIfErrorMs,
    async query(request, runtime) {
      await options.client.connect(runtime.signal);
      const result = await options.client.callTool(options.toolName, options.buildArguments(request), { signal: runtime.signal });
      return jsonClone(options.mapResult(result, request, runtime));
    },
  };
}

export interface McpResourceContextSourceOptions<T extends Record<string, unknown>> {
  client: ManagedPersonalMcpClient;
  descriptor: ContextSourceDescriptor;
  resourceUri(request: PersonalContextQuery): string;
  mapResult(result: unknown, request: PersonalContextQuery, runtime: ContextSourceRuntime): ContextCandidate<T>[];
  cacheTtlMs?: number;
  timeoutMs?: number;
  staleIfErrorMs?: number;
}

export function createMcpResourceContextSource<T extends Record<string, unknown>>(
  options: McpResourceContextSourceOptions<T>,
): ContextSource<T> {
  return {
    descriptor: jsonClone(options.descriptor),
    cacheTtlMs: options.cacheTtlMs,
    timeoutMs: options.timeoutMs,
    staleIfErrorMs: options.staleIfErrorMs,
    async query(request, runtime) {
      const uri = options.resourceUri(request);
      await options.client.connect(runtime.signal);
      const result = await options.client.readResource(uri, { signal: runtime.signal });
      return jsonClone(options.mapResult(result, request, runtime));
    },
  };
}

export interface McpToolActionExecutorOptions {
  client: ManagedPersonalMcpClient;
  kind: string;
  toolName: string;
  impact: string;
  /** Tool input field that receives Jarvis's stable action idempotency key, when declared by its schema. */
  idempotencyArgument?: string;
}

export function createMcpToolActionExecutor(options: McpToolActionExecutorOptions): PersonalActionExecutor {
  if (!options.kind || !options.impact) throw new Error("MCP action kind and impact are required");
  const risk = options.client.toolRisk(options.toolName);
  return {
    kind: options.kind,
    risk,
    preview(payload) {
      const args = options.client.prepareToolArguments(options.toolName, payload, { requireExact: true });
      return { tool: options.toolName, arguments: args, impact: options.impact };
    },
    async execute(payload, context) {
      const withIdempotency = context.idempotencyKey && options.idempotencyArgument
        ? { ...payload, [options.idempotencyArgument]: context.idempotencyKey }
        : payload;
      const args = options.client.prepareToolArguments(options.toolName, withIdempotency, { requireExact: true });
      await options.client.connect(context.signal);
      context.markDispatched?.();
      const result = await options.client.callTool(options.toolName, args, {
        approvedRisk: risk,
        signal: context.signal,
        requireExactArguments: true,
      });
      return { tool: options.toolName, result };
    },
  };
}
