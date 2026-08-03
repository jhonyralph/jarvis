import type {
  ContextCandidate,
  ContextFreshness,
  ContextPurpose,
  ContextSourceDescriptor,
  ContextSourceResult,
  ContextSourceStatus,
  GeoPoint,
  PersonalContextQuery,
} from "@jarvis/protocol";

export interface ContextSourceRuntime {
  fetch: typeof fetch;
  now: () => number;
  signal: AbortSignal;
}

export interface ContextSourceRetryPolicy {
  /** Total attempts, including the initial call. Bounded to five by the registry. */
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, failedAttempt: number) => boolean;
}

export interface ContextSource<T = Record<string, unknown>> {
  descriptor: ContextSourceDescriptor;
  cacheTtlMs?: number;
  timeoutMs?: number;
  staleIfErrorMs?: number;
  retry?: false | ContextSourceRetryPolicy;
  /** Read-only context lookup. Mutations belong to PersonalActionExecutor and are never retried here. */
  query(request: PersonalContextQuery, runtime: ContextSourceRuntime): Promise<Array<ContextCandidate<T>>>;
}

export interface ContextSourceQueryOptions {
  force?: boolean;
  signal?: AbortSignal;
}

export interface ContextSourceRegistryOptions {
  fetch?: typeof fetch;
  now?: () => number;
  failureThreshold?: number;
  circuitCooldownMs?: number;
  maxConcurrency?: number;
  onStatus?: (principalId: string, status: ContextSourceStatus) => void;
}

interface CacheEntry {
  principalId: string;
  sourceId: string;
  sourceKey: string;
  result: ContextSourceResult;
  staleUntil: number;
}

interface HealthEntry {
  failures: number;
  openedAt?: number;
  status: ContextSourceStatus;
}

interface RegisteredSource {
  source: ContextSource<unknown>;
  principalId?: string;
  preservesUpstreamProvenance: boolean;
  retryPolicy: ResolvedRetryPolicy;
}

interface InFlightEntry {
  principalId: string;
  sourceId: string;
  sourceKey: string;
  operation: Promise<ContextSourceResult>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
}

interface TrackedQuery {
  principalId: string;
  sourceId: string;
  sourceKey: string;
  controller: AbortController;
}

interface QueryWaiter {
  signal: AbortSignal;
  grant: () => void;
  cancel: () => void;
}

interface ResolvedRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: ContextSourceRetryPolicy["shouldRetry"];
}

type RegistryAbortKind = "cancelled" | "invalidated" | "removed" | "timeout";

class ContextSourceAbortError extends Error {
  constructor(readonly kind: RegistryAbortKind, message: string) {
    super(message);
    this.name = "ContextSourceAbortError";
  }
}

class ContextSourceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextSourceContractError";
  }
}

const VALID_FRESHNESS = new Set<ContextFreshness>(["live", "fresh", "stale", "unknown"]);
const SOURCE_ID = /^[^\u0000-\u001f\u007f]{1,200}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const CANDIDATE_KEYS = new Set(["id", "kind", "title", "data", "point", "hardFailures", "scoreParts", "sources"]);
const SOURCE_REF_KEYS = new Set(["sourceId", "recordId", "observedAt", "freshness", "attribution", "url"]);
const POINT_KEYS = new Set(["lat", "lng", "accuracyM"]);
const METERS_PER_LATITUDE_DEGREE = 111_320;
const MIN_CACHE_CELL_METERS = 25;
const MAX_ACCURACY_METERS = 10_000_000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_INITIAL_DELAY_MS = 100;
const DEFAULT_RETRY_MAX_DELAY_MS = 1_000;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 30_000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODE = /^(?:EAI_AGAIN|ECONNABORTED|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETDOWN|ENETUNREACH|EPIPE|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_SOCKET)$/i;
const TRANSIENT_ERROR_MESSAGE = /\b(?:connection|fetch failed|network|offline|socket|temporary|temporarily|timeout|timed out|transient|unavailable)\b|could not be read/i;
const ISO_FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function objectValue(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validSourceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && SOURCE_ID.test(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedOptionalText(value: unknown, maximum: number): boolean {
  return typeof value === "string" && value.length <= maximum && !CONTROL_CHARACTER.test(value);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("context source query aborted");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function waitWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => void,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    onAbort();
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onSignalAbort);
      complete();
    };
    const onSignalAbort = () => finish(() => {
      onAbort();
      reject(abortError(signal));
    });
    signal.addEventListener("abort", onSignalAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function retryInteger(sourceId: string, name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid context source retry ${name}: ${sourceId}`);
  }
  return value;
}

function resolveRetryPolicy(sourceId: string, input: ContextSource["retry"]): ResolvedRetryPolicy {
  if (input === false) return { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 };
  const maxAttempts = retryInteger(
    sourceId,
    "maxAttempts",
    input?.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS,
    1,
    MAX_RETRY_ATTEMPTS,
  );
  const initialDelayMs = retryInteger(
    sourceId,
    "initialDelayMs",
    input?.initialDelayMs ?? DEFAULT_RETRY_INITIAL_DELAY_MS,
    0,
    MAX_RETRY_DELAY_MS,
  );
  const maxDelayMs = retryInteger(
    sourceId,
    "maxDelayMs",
    input?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
    0,
    MAX_RETRY_DELAY_MS,
  );
  if (maxDelayMs < initialDelayMs) throw new Error(`invalid context source retry delay range: ${sourceId}`);
  if (input?.shouldRetry !== undefined && typeof input.shouldRetry !== "function") {
    throw new Error(`invalid context source retry predicate: ${sourceId}`);
  }
  return { maxAttempts, initialDelayMs, maxDelayMs, ...(input?.shouldRetry ? { shouldRetry: input.shouldRetry } : {}) };
}

function errorHttpStatus(error: unknown): number | undefined {
  if (objectValue(error)) {
    const status = error.status;
    if (Number.isSafeInteger(status) && Number(status) >= 100 && Number(status) <= 599) return Number(status);
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /\bHTTP\s+(\d{3})\b/i.exec(message);
  return match ? Number(match[1]) : undefined;
}

function retryProhibited(error: unknown): boolean {
  if (error instanceof ContextSourceAbortError || error instanceof ContextSourceContractError) return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  const status = errorHttpStatus(error);
  return status !== undefined && !RETRYABLE_HTTP_STATUSES.has(status);
}

function retryableQueryError(error: unknown): boolean {
  if (retryProhibited(error)) return false;
  const status = errorHttpStatus(error);
  if (status !== undefined) return RETRYABLE_HTTP_STATUSES.has(status);
  if (error instanceof Error && error.name === "TimeoutError") return true;
  const code = objectValue(error) && typeof error.code === "string" ? error.code : "";
  if (TRANSIENT_ERROR_CODE.test(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_ERROR_MESSAGE.test(message);
}

function retryDelay(policy: ResolvedRetryPolicy, failedAttempt: number): number {
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * (2 ** Math.max(0, failedAttempt - 1)));
}

function validIsoFullDate(value: string): boolean {
  if (!ISO_FULL_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateDescriptorMetadata(descriptor: ContextSourceDescriptor): void {
  if (descriptor.retentionPolicy !== undefined
    && (!boundedOptionalText(descriptor.retentionPolicy, 1_000) || !descriptor.retentionPolicy.trim())) {
    throw new Error(`context source has invalid retention policy: ${descriptor.id}`);
  }
  if (descriptor.lastReviewedAt !== undefined
    && (typeof descriptor.lastReviewedAt !== "string" || !validIsoFullDate(descriptor.lastReviewedAt))) {
    throw new Error(`context source has invalid review date: ${descriptor.id}`);
  }
}

function accuracyBucket(accuracyM: number | undefined): number {
  if (accuracyM !== undefined && (!Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > MAX_ACCURACY_METERS)) {
    throw new Error("invalid context query point accuracy");
  }
  const target = Math.max(MIN_CACHE_CELL_METERS, accuracyM ?? MIN_CACHE_CELL_METERS);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const factor of [1, 2.5, 5, 10]) {
    const bucket = magnitude * factor;
    if (bucket >= target) return bucket;
  }
  return target;
}

/**
 * Cache keys use geographic cells instead of raw coordinates. The smallest cell is 25 m;
 * reported accuracy rounds up through 1/2.5/5 x 10^n buckets, so privacy-normalized points
 * (normally accuracyM >= 1,000) use kilometer-scale cells and GPS/accuracy jitter shares cache.
 */
function locationCacheCell(point: GeoPoint): { cellM: number; latCell: number; lngCell: number } {
  if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90
    || !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) {
    throw new Error("invalid context query point");
  }
  const cellM = accuracyBucket(point.accuracyM);
  const latCell = Math.round((point.lat + 90) * METERS_PER_LATITUDE_DEGREE / cellM);
  const cellLatitude = latCell * cellM / METERS_PER_LATITUDE_DEGREE - 90;
  const longitudeScale = METERS_PER_LATITUDE_DEGREE * Math.max(0.01, Math.abs(Math.cos(cellLatitude * Math.PI / 180)));
  const lngCell = Math.round((point.lng + 180) * longitudeScale / cellM);
  return { cellM, latCell, lngCell };
}

function cacheKey(sourceId: string, sourceKey: string, request: PersonalContextQuery): string {
  const normalized = {
    purpose: request.purpose,
    deviceId: request.deviceId,
    point: request.point ? locationCacheCell(request.point) : undefined,
    text: request.text,
    locale: request.locale,
    startAt: request.startAt,
    endAt: request.endAt,
    limit: request.limit,
    filters: request.filters,
  };
  return JSON.stringify([request.principalId, sourceId, sourceKey, normalized]);
}

function invalidResult(sourceId: string, detail: string): never {
  throw new ContextSourceContractError(`invalid context source result from ${sourceId}: ${detail}`);
}

function validatePoint(sourceId: string, candidateIndex: number, point: unknown): void {
  if (!objectValue(point) || !onlyKeys(point, POINT_KEYS)
    || !Number.isFinite(point.lat) || Number(point.lat) < -90 || Number(point.lat) > 90
    || !Number.isFinite(point.lng) || Number(point.lng) < -180 || Number(point.lng) > 180
    || (point.accuracyM !== undefined && (!Number.isFinite(point.accuracyM)
      || Number(point.accuracyM) < 0 || Number(point.accuracyM) > MAX_ACCURACY_METERS))) {
    invalidResult(sourceId, `candidate ${candidateIndex} has an invalid point`);
  }
}

function validateSourceRef(
  sourceId: string,
  preservesUpstreamProvenance: boolean,
  candidateIndex: number,
  refIndex: number,
  value: unknown,
): void {
  if (!objectValue(value)) invalidResult(sourceId, `candidate ${candidateIndex} source ${refIndex} is not an object`);
  if (!onlyKeys(value, SOURCE_REF_KEYS)) invalidResult(sourceId, `candidate ${candidateIndex} source ${refIndex} has unknown fields`);
  if (!validSourceId(value.sourceId)) invalidResult(sourceId, `candidate ${candidateIndex} source ${refIndex} has an invalid sourceId`);

  // First-party builtin aggregators may preserve upstream IDs; external/device adapters must attest their own ID.
  if (!preservesUpstreamProvenance && value.sourceId !== sourceId) {
    invalidResult(sourceId, `candidate ${candidateIndex} source ${refIndex} has the wrong sourceId`);
  }
  if (!Number.isSafeInteger(value.observedAt) || Number(value.observedAt) < 0) {
    invalidResult(sourceId, `candidate ${candidateIndex} source ${refIndex} has an invalid observedAt`);
  }
  if (!VALID_FRESHNESS.has(value.freshness as ContextFreshness)) {
    invalidResult(sourceId, `candidate ${candidateIndex} source ${refIndex} has an invalid freshness`);
  }
  if (value.recordId !== undefined && !validSourceId(value.recordId)) {
    invalidResult(sourceId, `candidate ${candidateIndex} source ${refIndex} has an invalid recordId`);
  }
  if (value.attribution !== undefined && !boundedOptionalText(value.attribution, 500)) {
    invalidResult(sourceId, `candidate ${candidateIndex} source ${refIndex} has an invalid attribution`);
  }
  if (value.url !== undefined && !boundedOptionalText(value.url, 2_000)) {
    invalidResult(sourceId, `candidate ${candidateIndex} source ${refIndex} has an invalid url`);
  }
}

function validateCandidates(
  sourceId: string,
  preservesUpstreamProvenance: boolean,
  value: unknown,
): asserts value is ContextCandidate<Record<string, unknown>>[] {
  if (!Array.isArray(value)) invalidResult(sourceId, "result is not an array");
  for (const [candidateIndex, candidate] of value.entries()) {
    if (!objectValue(candidate)) invalidResult(sourceId, `candidate ${candidateIndex} is not an object`);
    if (!onlyKeys(candidate, CANDIDATE_KEYS)) invalidResult(sourceId, `candidate ${candidateIndex} has unknown fields`);
    if (typeof candidate.id !== "string" || !candidate.id.trim()) invalidResult(sourceId, `candidate ${candidateIndex} has an invalid id`);
    if (typeof candidate.kind !== "string" || !candidate.kind.trim()) invalidResult(sourceId, `candidate ${candidateIndex} has an invalid kind`);
    if (typeof candidate.title !== "string" || !candidate.title.trim()) invalidResult(sourceId, `candidate ${candidateIndex} has an invalid title`);
    if (!objectValue(candidate.data)) invalidResult(sourceId, `candidate ${candidateIndex} has invalid data`);
    if (!Array.isArray(candidate.sources) || !candidate.sources.length) {
      invalidResult(sourceId, `candidate ${candidateIndex} has no provenance sources`);
    }
    for (const [refIndex, ref] of candidate.sources.entries()) {
      validateSourceRef(sourceId, preservesUpstreamProvenance, candidateIndex, refIndex, ref);
    }
    if (candidate.point !== undefined) validatePoint(sourceId, candidateIndex, candidate.point);
    if (candidate.hardFailures !== undefined
      && (!Array.isArray(candidate.hardFailures) || [...candidate.hardFailures].some((failure) => typeof failure !== "string"))) {
      invalidResult(sourceId, `candidate ${candidateIndex} has invalid hardFailures`);
    }
    if (candidate.scoreParts !== undefined
      && (!objectValue(candidate.scoreParts) || Object.values(candidate.scoreParts).some((score) => !Number.isFinite(score)))) {
      invalidResult(sourceId, `candidate ${candidateIndex} has invalid scoreParts`);
    }
  }
}

function staleResult<T extends Record<string, unknown>>(cached: CacheEntry, warning: string): ContextSourceResult<T> {
  const result = structuredClone(cached.result) as ContextSourceResult<T>;
  result.freshness = "stale";
  result.fromCache = true;
  result.warning = warning;
  for (const candidate of result.items) {
    for (const ref of candidate.sources) ref.freshness = "stale";
  }
  return result;
}

export class ContextSourceRegistry {
  private readonly sources = new Map<string, RegisteredSource>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightEntry>();
  private readonly health = new Map<string, HealthEntry>();
  private readonly trackedQueries = new Map<string, Set<TrackedQuery>>();
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly failureThreshold: number;
  private readonly circuitCooldownMs: number;
  private readonly maxConcurrency: number;
  private activeQueries = 0;
  private readonly queryWaiters: QueryWaiter[] = [];
  private readonly onStatus?: ContextSourceRegistryOptions["onStatus"];

  constructor(options: ContextSourceRegistryOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.circuitCooldownMs = Math.max(1_000, options.circuitCooldownMs ?? 60_000);
    this.maxConcurrency = Math.max(1, Math.min(64, options.maxConcurrency ?? 4));
    this.onStatus = options.onStatus;
  }

  private sourceKey(sourceId: string, principalId?: string): string {
    return JSON.stringify([principalId ?? null, sourceId]);
  }

  private trackedQueryKey(principalId: string, sourceId: string): string {
    return JSON.stringify([principalId, sourceId]);
  }

  private sourceFor(sourceId: string, principalId: string): {
    key: string;
    source: ContextSource<unknown>;
    preservesUpstreamProvenance: boolean;
    retryPolicy: ResolvedRetryPolicy;
  } | undefined {
    const scopedKey = this.sourceKey(sourceId, principalId);
    const scoped = this.sources.get(scopedKey);
    if (scoped) return {
      key: scopedKey,
      source: scoped.source,
      preservesUpstreamProvenance: scoped.preservesUpstreamProvenance,
      retryPolicy: scoped.retryPolicy,
    };
    const globalKey = this.sourceKey(sourceId);
    const global = this.sources.get(globalKey);
    return global ? {
      key: globalKey,
      source: global.source,
      preservesUpstreamProvenance: global.preservesUpstreamProvenance,
      retryPolicy: global.retryPolicy,
    } : undefined;
  }

  register(source: ContextSource<unknown>, principalId?: string): void {
    const id = source.descriptor.id;
    const key = this.sourceKey(id, principalId);
    if (!validSourceId(id) || this.sources.has(key)) throw new Error(`duplicate context source: ${id}`);
    if (!Array.isArray(source.descriptor.purposes) || !source.descriptor.purposes.length) {
      throw new Error(`context source has no purpose: ${id}`);
    }
    validateDescriptorMetadata(source.descriptor);
    const preservesUpstreamProvenance = source.descriptor.transport === "builtin"
      && source.descriptor.certification === "first_party";
    this.sources.set(key, {
      source,
      principalId,
      preservesUpstreamProvenance,
      retryPolicy: resolveRetryPolicy(id, source.retry),
    });
    this.setStatus(key, "", source, { state: "ready", failures: 0, checkedAt: this.now() });
  }

  remove(sourceId: string, principalId?: string): boolean {
    const key = this.sourceKey(sourceId, principalId);
    if (!this.sources.has(key)) return false;
    this.abortTrackedQueries(
      (query) => query.sourceKey === key,
      new ContextSourceAbortError("removed", `context source removed: ${sourceId}`),
    );
    this.sources.delete(key);
    this.health.delete(key);
    for (const [cacheEntryKey, entry] of this.cache) {
      if (entry.sourceKey === key) this.cache.delete(cacheEntryKey);
    }
    for (const [inFlightKey, entry] of this.inFlight) {
      if (entry.sourceKey === key) this.inFlight.delete(inFlightKey);
    }
    return true;
  }

  invalidate(principalId: string, sourceId?: string): number {
    this.abortTrackedQueries(
      (query) => query.principalId === principalId && (!sourceId || query.sourceId === sourceId),
      new ContextSourceAbortError("invalidated", "context source query was invalidated"),
    );
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (entry.principalId === principalId && (!sourceId || entry.sourceId === sourceId)) {
        this.cache.delete(key);
        removed++;
      }
    }
    for (const [key, entry] of this.inFlight) {
      if (entry.principalId === principalId && (!sourceId || entry.sourceId === sourceId)) this.inFlight.delete(key);
    }
    return removed;
  }

  descriptors(purpose?: ContextPurpose, principalId?: string): ContextSourceDescriptor[] {
    const selected = new Map<string, ContextSourceDescriptor>();
    for (const record of this.sources.values()) {
      if (record.principalId && record.principalId !== principalId) continue;
      const descriptor = record.source.descriptor;
      if (purpose && !descriptor.purposes.includes(purpose)) continue;
      if (!selected.has(descriptor.id) || record.principalId === principalId) {
        selected.set(descriptor.id, structuredClone(descriptor));
      }
    }
    return [...selected.values()];
  }

  statuses(principalId?: string): ContextSourceStatus[] {
    const selected = new Map<string, ContextSourceStatus>();
    for (const [key, entry] of this.health) {
      const record = this.sources.get(key);
      if (!record || (record.principalId && record.principalId !== principalId)) continue;
      if (!selected.has(entry.status.descriptor.id) || record.principalId === principalId) {
        selected.set(entry.status.descriptor.id, structuredClone(entry.status));
      }
    }
    return [...selected.values()];
  }

  private setStatus(
    key: string,
    principalId: string,
    source: ContextSource<unknown>,
    patch: Pick<ContextSourceStatus, "state" | "failures" | "checkedAt"> & Partial<ContextSourceStatus>,
  ): void {
    const status: ContextSourceStatus = { descriptor: structuredClone(source.descriptor), ...patch };
    const current = this.health.get(key);
    this.health.set(key, { failures: status.failures, openedAt: current?.openedAt, status });
    if (principalId) this.onStatus?.(principalId, structuredClone(status));
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sourceId: string,
    request: PersonalContextQuery,
    options: ContextSourceQueryOptions = {},
  ): Promise<ContextSourceResult<T>> {
    throwIfAborted(options.signal);
    const selected = this.sourceFor(sourceId, request.principalId);
    const source = selected?.source;
    if (!source || !selected) throw new Error(`unknown context source: ${sourceId}`);
    if (!source.descriptor.purposes.includes(request.purpose)) {
      throw new Error(`source ${sourceId} does not support ${request.purpose}`);
    }
    const now = this.now();
    const key = cacheKey(sourceId, selected.key, request);
    const cached = this.cache.get(key);
    if (!options.force && cached && cached.result.expiresAt > now) {
      return { ...structuredClone(cached.result), fromCache: true } as ContextSourceResult<T>;
    }
    const health = this.health.get(selected.key);
    if (health?.openedAt && now - health.openedAt < this.circuitCooldownMs) {
      if (cached && cached.staleUntil > now) return staleResult<T>(cached, "source circuit is open");
      throw new Error(`context source unavailable: ${sourceId}`);
    }

    if (!options.force) {
      const existing = this.inFlight.get(key);
      if (existing) {
        return structuredClone(await this.waitForInFlight(existing, key, options.signal)) as ContextSourceResult<T>;
      }
    }
    const controller = new AbortController();
    const operation = this.querySource<T>(
      selected.key,
      sourceId,
      request,
      source,
      selected.preservesUpstreamProvenance,
      selected.retryPolicy,
      key,
      cached,
      health,
      controller,
    );
    if (!options.force) {
      const entry: InFlightEntry = {
        principalId: request.principalId,
        sourceId,
        sourceKey: selected.key,
        operation: operation as Promise<ContextSourceResult>,
        controller,
        waiters: 0,
        settled: false,
      };
      this.inFlight.set(key, entry);
      void operation.then(
        () => this.finishInFlight(key, entry),
        () => this.finishInFlight(key, entry),
      );
      return structuredClone(await this.waitForInFlight(entry, key, options.signal)) as ContextSourceResult<T>;
    }
    return await waitWithSignal(operation, options.signal, () => {
      if (!controller.signal.aborted) {
        controller.abort(new ContextSourceAbortError("cancelled", "context source query was cancelled"));
      }
    });
  }

  private finishInFlight(key: string, entry: InFlightEntry): void {
    entry.settled = true;
    if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
  }

  private async waitForInFlight(
    entry: InFlightEntry,
    key: string,
    signal: AbortSignal | undefined,
  ): Promise<ContextSourceResult> {
    entry.waiters++;
    let cancelled = false;
    try {
      return await waitWithSignal(entry.operation, signal, () => { cancelled = true; });
    } finally {
      entry.waiters--;
      if (cancelled && !entry.settled && entry.waiters === 0) {
        if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
        if (!entry.controller.signal.aborted) {
          entry.controller.abort(new ContextSourceAbortError("cancelled", "context source query has no active waiters"));
        }
      }
    }
  }

  private async querySource<T extends Record<string, unknown>>(
    sourceKey: string,
    sourceId: string,
    request: PersonalContextQuery,
    source: ContextSource<unknown>,
    preservesUpstreamProvenance: boolean,
    retryPolicy: ResolvedRetryPolicy,
    key: string,
    cached: CacheEntry | undefined,
    health: HealthEntry | undefined,
    controller: AbortController,
  ): Promise<ContextSourceResult<T>> {
    const tracked: TrackedQuery = { principalId: request.principalId, sourceId, sourceKey, controller };
    this.trackQuery(tracked);
    let acquired = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let started = this.now();
    try {
      await this.acquireQuerySlot(controller.signal);
      acquired = true;
      throwIfAborted(controller.signal);
      started = this.now();
      timeout = setTimeout(
        () => controller.abort(new ContextSourceAbortError("timeout", "context source timeout")),
        Math.max(100, source.timeoutMs ?? 10_000),
      );
      let items!: ContextCandidate<Record<string, unknown>>[];
      for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
        try {
          const attemptOperation = source.query(request, {
            fetch: this.fetcher,
            now: this.now,
            signal: controller.signal,
          });
          const attemptItems: unknown = await waitWithSignal(attemptOperation, controller.signal, () => {});
          throwIfAborted(controller.signal);
          validateCandidates(sourceId, preservesUpstreamProvenance, attemptItems);
          items = attemptItems;
          break;
        } catch (error) {
          throwIfAborted(controller.signal);
          let retryable = retryableQueryError(error);
          if (retryPolicy.shouldRetry) {
            try { retryable = !retryProhibited(error) && retryPolicy.shouldRetry(error, attempt); }
            catch { retryable = false; }
          }
          if (attempt >= retryPolicy.maxAttempts || !retryable) throw error;
          await abortableDelay(retryDelay(retryPolicy, attempt), controller.signal);
        }
      }
      const clonedItems = structuredClone(items) as ContextSourceResult<T>["items"];
      const fetchedAt = this.now();
      const ttl = Math.max(0, source.cacheTtlMs ?? 300_000);
      const result: ContextSourceResult<T> = {
        sourceId,
        items: clonedItems,
        fetchedAt,
        expiresAt: fetchedAt + ttl,
        freshness: "fresh",
        fromCache: false,
      };
      this.cache.set(key, {
        principalId: request.principalId,
        sourceId,
        sourceKey,
        result: structuredClone(result),
        staleUntil: result.expiresAt + Math.max(0, source.staleIfErrorMs ?? 3_600_000),
      });
      this.health.set(sourceKey, {
        failures: 0,
        status: {
          descriptor: structuredClone(source.descriptor),
          state: "ready",
          checkedAt: fetchedAt,
          lastSuccessAt: fetchedAt,
          latencyMs: Math.max(0, fetchedAt - started),
          failures: 0,
        },
      });
      this.onStatus?.(request.principalId, structuredClone(this.health.get(sourceKey)!.status));
      return result;
    } catch (error) {
      const failure = controller.signal.aborted && controller.signal.reason instanceof ContextSourceAbortError
        ? controller.signal.reason
        : error;
      if (failure instanceof ContextSourceAbortError && failure.kind !== "timeout") throw failure;

      const latestHealth = this.health.get(sourceKey) || health;
      const failures = (latestHealth?.failures || 0) + 1;
      const checkedAt = this.now();
      const message = String((failure as Error)?.message || failure).slice(0, 500);
      const entry: HealthEntry = {
        failures,
        openedAt: failures >= this.failureThreshold ? checkedAt : undefined,
        status: {
          descriptor: structuredClone(source.descriptor),
          state: failures >= this.failureThreshold ? "offline" : "degraded",
          checkedAt,
          lastSuccessAt: latestHealth?.status.lastSuccessAt,
          failures,
          message,
        },
      };
      this.health.set(sourceKey, entry);
      this.onStatus?.(request.principalId, structuredClone(entry.status));
      if (cached && cached.staleUntil > checkedAt) return staleResult<T>(cached, message);
      throw failure;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (acquired) this.releaseQuerySlot();
      this.untrackQuery(tracked);
    }
  }

  private trackQuery(query: TrackedQuery): void {
    const key = this.trackedQueryKey(query.principalId, query.sourceId);
    const queries = this.trackedQueries.get(key) || new Set<TrackedQuery>();
    queries.add(query);
    this.trackedQueries.set(key, queries);
  }

  private untrackQuery(query: TrackedQuery): void {
    const key = this.trackedQueryKey(query.principalId, query.sourceId);
    const queries = this.trackedQueries.get(key);
    if (!queries) return;
    queries.delete(query);
    if (!queries.size) this.trackedQueries.delete(key);
  }

  private abortTrackedQueries(predicate: (query: TrackedQuery) => boolean, reason: ContextSourceAbortError): void {
    for (const queries of this.trackedQueries.values()) {
      for (const query of queries) {
        if (predicate(query) && !query.controller.signal.aborted) query.controller.abort(reason);
      }
    }
  }

  private async acquireQuerySlot(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (this.activeQueries < this.maxConcurrency) {
      this.activeQueries++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let waiter: QueryWaiter;
      const cancel = () => {
        const index = this.queryWaiters.indexOf(waiter);
        if (index >= 0) this.queryWaiters.splice(index, 1);
        signal.removeEventListener("abort", cancel);
        reject(abortError(signal));
      };
      waiter = {
        signal,
        cancel,
        grant: () => {
          signal.removeEventListener("abort", cancel);
          resolve();
        },
      };
      signal.addEventListener("abort", cancel, { once: true });
      this.queryWaiters.push(waiter);
    });
  }

  private releaseQuerySlot(): void {
    while (this.queryWaiters.length) {
      const next = this.queryWaiters.shift()!;
      if (next.signal.aborted) {
        next.cancel();
        continue;
      }
      next.grant();
      return;
    }
    this.activeQueries--;
  }

  async queryPurpose(
    request: PersonalContextQuery,
    options: ContextSourceQueryOptions = {},
  ): Promise<{ results: ContextSourceResult[]; errors: Array<{ sourceId: string; error: string }> }> {
    throwIfAborted(options.signal);
    const sources = this.descriptors(request.purpose, request.principalId);
    const settled = await Promise.allSettled(sources.map((source) => this.query(source.id, request, options)));
    throwIfAborted(options.signal);
    const results: ContextSourceResult[] = [];
    const errors: Array<{ sourceId: string; error: string }> = [];
    settled.forEach((item, index) => {
      if (item.status === "fulfilled") results.push(item.value);
      else errors.push({ sourceId: sources[index].id, error: String((item.reason as Error)?.message || item.reason) });
    });
    return { results, errors };
  }
}
