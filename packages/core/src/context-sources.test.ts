import test from "node:test";
import assert from "node:assert/strict";
import type {
  ContextCandidate,
  ContextFreshness,
  ContextSourceRef,
  PersonalContextQuery,
} from "@jarvis/protocol";
import { ContextSourceRegistry, type ContextSource } from "./context-sources.js";

const request: PersonalContextQuery = { principalId: "u", purpose: "nearby", text: "cafe" };

function sourceRef(
  sourceId = "places",
  freshness: ContextFreshness = "fresh",
  recordId = "record",
  observedAt = 1,
): ContextSourceRef {
  return { sourceId, recordId, observedAt, freshness };
}

function candidate(
  title: string,
  id = title,
  sources: ContextSourceRef[] = [sourceRef()],
): ContextCandidate<Record<string, unknown>> {
  return { id, kind: "place", title, data: {}, sources };
}

function contextSource(run: ContextSource["query"], id = "places"): ContextSource {
  return {
    descriptor: {
      id,
      label: id,
      purposes: ["nearby"],
      costClass: "free",
      transport: "http",
      certification: "first_party",
    },
    cacheTtlMs: 100,
    staleIfErrorMs: 1_000,
    timeoutMs: 5_000,
    query: run,
  };
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortableWait(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("ContextSourceRegistry accepts legacy descriptors and validates retention review metadata", () => {
  const registry = new ContextSourceRegistry();
  const legacy = contextSource(async () => [candidate("Legacy")], "legacy");
  const current = contextSource(async () => [candidate("Current", "current", [sourceRef("current")])], "current");
  current.descriptor.retentionPolicy = "Raw responses are not persisted; derived records expire after 15m";
  current.descriptor.lastReviewedAt = "2026-08-01";
  registry.register(legacy);
  registry.register(current);

  const descriptors = new Map(registry.descriptors().map((descriptor) => [descriptor.id, descriptor]));
  assert.equal(descriptors.get("legacy")?.retentionPolicy, undefined);
  assert.equal(descriptors.get("current")?.lastReviewedAt, "2026-08-01");
  assert.match(descriptors.get("current")?.retentionPolicy || "", /not persisted/);

  const invalidDate = contextSource(async () => [candidate("Invalid")], "invalid-date");
  invalidDate.descriptor.lastReviewedAt = "2026-02-30";
  assert.throws(() => registry.register(invalidDate), /invalid review date/);

  const invalidRetention = contextSource(async () => [candidate("Invalid")], "invalid-retention");
  invalidRetention.descriptor.retentionPolicy = "\n";
  assert.throws(() => registry.register(invalidRetention), /invalid retention policy/);
});

test("ContextSourceRegistry retries bounded transient read failures and resets health on recovery", async () => {
  let calls = 0;
  const registry = new ContextSourceRegistry();
  const source = contextSource(async () => {
    calls++;
    if (calls < 3) throw new Error("temporary network failure");
    return [candidate("Recovered")];
  });
  source.retry = { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 };
  registry.register(source);

  const result = await registry.query("places", request);
  assert.equal(result.items[0].title, "Recovered");
  assert.equal(calls, 3);
  assert.equal(registry.statuses()[0].state, "ready");
  assert.equal(registry.statuses()[0].failures, 0);
});

test("ContextSourceRegistry does not retry non-transient HTTP failures or retry-disabled reads", async () => {
  let clientErrorCalls = 0;
  const registry = new ContextSourceRegistry();
  const clientError = contextSource(async () => {
    clientErrorCalls++;
    throw new Error("request failed with HTTP 400");
  });
  clientError.retry = { maxAttempts: 5, initialDelayMs: 0, maxDelayMs: 0, shouldRetry: () => true };
  registry.register(clientError);
  await assert.rejects(() => registry.query("places", request), /HTTP 400/);
  assert.equal(clientErrorCalls, 1);

  let nonRepeatableCalls = 0;
  const nonRepeatable = contextSource(async () => {
    nonRepeatableCalls++;
    throw new Error("temporary failure");
  }, "non-repeatable");
  nonRepeatable.retry = false;
  registry.register(nonRepeatable);
  await assert.rejects(() => registry.query("non-repeatable", request), /temporary failure/);
  assert.equal(nonRepeatableCalls, 1);

  let parserCalls = 0;
  const parserFailure = contextSource(async () => {
    parserCalls++;
    throw new Error("invalid provider JSON");
  }, "parser-failure");
  parserFailure.retry = { maxAttempts: 5, initialDelayMs: 0, maxDelayMs: 0 };
  registry.register(parserFailure);
  await assert.rejects(() => registry.query("parser-failure", request), /invalid provider JSON/);
  assert.equal(parserCalls, 1);
});

test("ContextSourceRegistry applies one timeout budget across every retry and backoff", async () => {
  let calls = 0;
  const registry = new ContextSourceRegistry();
  const source = contextSource(async () => {
    calls++;
    throw new Error("temporary failure");
  });
  source.timeoutMs = 100;
  source.retry = { maxAttempts: 5, initialDelayMs: 80, maxDelayMs: 80 };
  registry.register(source);

  await assert.rejects(() => registry.query("places", request), /context source timeout/);
  assert.ok(calls >= 1 && calls < 5, `expected timeout before all attempts, got ${calls}`);
  assert.equal(registry.statuses()[0].failures, 1);
});

test("ContextSourceRegistry timeout rejects an abort-ignoring source and quarantines its late result", async () => {
  const started = deferred();
  const release = deferred();
  let calls = 0;
  let querySignal!: AbortSignal;
  const registry = new ContextSourceRegistry();
  const source = contextSource(async (_query, runtime) => {
    calls++;
    querySignal = runtime.signal;
    if (calls === 1) {
      started.resolve();
      await release.promise;
      return [candidate("Late")];
    }
    return [candidate("Recovered")];
  });
  source.timeoutMs = 100;
  source.retry = false;
  registry.register(source);

  const pending = registry.query("places", request);
  let safetyTimer: ReturnType<typeof setTimeout> | undefined;
  const safetyTimeout = new Promise<never>((_resolve, reject) => {
    safetyTimer = setTimeout(() => reject(new Error("timeout was not enforced")), 500);
  });
  await started.promise;
  try { await assert.rejects(Promise.race([pending, safetyTimeout]), /context source timeout/); }
  finally { if (safetyTimer) clearTimeout(safetyTimer); }
  assert.equal(querySignal.aborted, true);
  assert.equal(registry.statuses()[0].failures, 1);

  release.resolve();
  await nextTurn();
  const recovered = await registry.query("places", request);
  assert.equal(recovered.fromCache, false);
  assert.equal(recovered.items[0].title, "Recovered");
  assert.equal(calls, 2);
});

test("ContextSourceRegistry opens the circuit only after a retried operation is exhausted", async () => {
  let calls = 0;
  const registry = new ContextSourceRegistry({ failureThreshold: 1, circuitCooldownMs: 1_000 });
  const source = contextSource(async () => {
    calls++;
    throw new Error("offline");
  });
  source.retry = { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 };
  registry.register(source);

  await assert.rejects(() => registry.query("places", request), /offline/);
  assert.equal(calls, 3);
  assert.equal(registry.statuses()[0].failures, 1);
  assert.equal(registry.statuses()[0].state, "offline");
  await assert.rejects(() => registry.query("places", request), /context source unavailable/);
  assert.equal(calls, 3);
});

test("ContextSourceRegistry caches by principal and request", async () => {
  let now = 10;
  let calls = 0;
  const registry = new ContextSourceRegistry({ now: () => now });
  registry.register(contextSource(async () => {
    calls++;
    return [candidate("Cafe", "1")];
  }));

  assert.equal((await registry.query("places", request)).fromCache, false);
  now = 20;
  assert.equal((await registry.query("places", request)).fromCache, true);
  assert.equal(calls, 1);
  assert.equal((await registry.query("places", { ...request, principalId: "other" })).fromCache, false);
  assert.equal(calls, 2);
});

test("ContextSourceRegistry quantizes cache coordinates by accuracy without crossing principals", async () => {
  let calls = 0;
  const registry = new ContextSourceRegistry({ now: () => 10 });
  registry.register(contextSource(async () => {
    calls++;
    return [candidate(`Call ${calls}`, String(calls))];
  }));

  const precise = { lat: 0, lng: 0, accuracyM: 5 };
  const preciseJitter = { lat: 0.00001, lng: 0.00001, accuracyM: 8 };
  assert.equal((await registry.query("places", { ...request, point: precise })).fromCache, false);
  assert.equal((await registry.query("places", { ...request, point: preciseJitter })).fromCache, true);
  assert.equal(calls, 1);

  assert.equal((await registry.query("places", { ...request, principalId: "other", point: preciseJitter })).fromCache, false);
  assert.equal(calls, 2);

  assert.equal((await registry.query("places", { ...request, point: { ...precise, lat: 0.001 } })).fromCache, false);
  assert.equal(calls, 3);

  const approximate = { lat: 0, lng: 0, accuracyM: 1_000 };
  const approximateJitter = { lat: 0.001, lng: 0.001, accuracyM: 900 };
  assert.equal((await registry.query("places", { ...request, point: approximate })).fromCache, false);
  assert.equal((await registry.query("places", { ...request, point: approximateJitter })).fromCache, true);
  assert.equal(calls, 4);
});

test("structured cache identities cannot collide across delimiter-bearing principals and sources", async () => {
  let firstCalls = 0;
  let secondCalls = 0;
  const registry = new ContextSourceRegistry({ now: () => 10 });
  registry.register(contextSource(async () => {
    firstCalls++;
    return [candidate("First", "first", [sourceRef("b:c")])];
  }, "b:c"));
  registry.register(contextSource(async () => {
    secondCalls++;
    return [candidate("Second", "second", [sourceRef("c")])];
  }, "c"));

  const first = await registry.query("b:c", { ...request, principalId: "a" });
  const second = await registry.query("c", { ...request, principalId: "a:b" });
  assert.equal(first.items[0].title, "First");
  assert.equal(second.items[0].title, "Second");
  assert.equal(second.fromCache, false);

  registry.invalidate("a", "b:c");
  assert.equal((await registry.query("c", { ...request, principalId: "a:b" })).fromCache, true);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
});

test("ContextSourceRegistry serves bounded stale data with every provenance ref downgraded", async () => {
  let now = 10;
  let fail = false;
  const registry = new ContextSourceRegistry({ now: () => now, failureThreshold: 1, circuitCooldownMs: 1_000 });
  registry.register(contextSource(async () => {
    if (fail) throw new Error("offline");
    return [
      candidate("Cafe", "1", [
        sourceRef("places", "live", "live"),
        sourceRef("places", "unknown", "unknown"),
      ]),
      candidate("Bakery", "2", [sourceRef("places", "fresh", "fresh")]),
    ];
  }));

  await registry.query("places", request);
  fail = true;
  now = 200;
  const stale = await registry.query("places", request);
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.items.flatMap((item) => item.sources).every((ref) => ref.freshness === "stale"), true);
  assert.match(stale.warning || "", /offline/);

  now = 300;
  const circuitStale = await registry.query("places", request);
  assert.equal(circuitStale.warning, "source circuit is open");
  assert.equal(circuitStale.items.flatMap((item) => item.sources).every((ref) => ref.freshness === "stale"), true);
  assert.equal(registry.statuses()[0].state, "offline");
});

test("ContextSourceRegistry rejects unsupported purposes and reports partial federation failures", async () => {
  const registry = new ContextSourceRegistry();
  registry.register(contextSource(async () => { throw new Error("bad feed"); }));
  await assert.rejects(() => registry.query("places", { ...request, purpose: "events" }), /does not support/);
  const result = await registry.queryPurpose(request);
  assert.equal(result.results.length, 0);
  assert.equal(result.errors[0].sourceId, "places");
});

test("ContextSourceRegistry isolates private adapters and health by principal", async () => {
  const registry = new ContextSourceRegistry();
  registry.register(contextSource(async () => [candidate("Global", "global")]));
  registry.register(contextSource(async () => [candidate("Alice", "alice")]), "alice");

  assert.equal((await registry.query("places", { ...request, principalId: "alice" })).items[0].title, "Alice");
  assert.equal((await registry.query("places", { ...request, principalId: "bob" })).items[0].title, "Global");
  assert.equal(registry.descriptors(undefined, "alice").length, 1);
  assert.equal(registry.statuses("alice").length, 1);
  assert.equal(registry.statuses("bob").length, 1);

  registry.remove("places", "alice");
  assert.equal((await registry.query("places", { ...request, principalId: "alice", text: "other" })).items[0].title, "Global");
});

test("ContextSourceRegistry coalesces identical requests and bounds unrelated concurrency", async () => {
  let calls = 0;
  let active = 0;
  let maximum = 0;
  const releases: Array<() => void> = [];
  const registry = new ContextSourceRegistry({ maxConcurrency: 2 });
  registry.register(contextSource(async (query) => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return [candidate(String(query.text), String(query.text))];
  }));

  const duplicateA = registry.query("places", request);
  const duplicateB = registry.query("places", request);
  const otherA = registry.query("places", { ...request, text: "park" });
  const otherB = registry.query("places", { ...request, text: "market" });
  await nextTurn();
  assert.equal(calls, 2);
  assert.equal(maximum, 2);
  releases.splice(0).forEach((release) => release());
  await nextTurn();
  releases.splice(0).forEach((release) => release());

  const [a, b, c, d] = await Promise.all([duplicateA, duplicateB, otherA, otherB]);
  assert.equal(calls, 3);
  assert.equal(a.items[0].title, b.items[0].title);
  assert.equal(c.items[0].title, "park");
  assert.equal(d.items[0].title, "market");
});

test("cancelling one external waiter does not abort a shared query needed by another waiter", async () => {
  const started = deferred();
  const release = deferred();
  const caller = new AbortController();
  let querySignal!: AbortSignal;
  let calls = 0;
  const registry = new ContextSourceRegistry();
  const source = contextSource(async (_query, runtime) => {
    calls++;
    querySignal = runtime.signal;
    started.resolve();
    await release.promise;
    return [candidate("Shared")];
  });
  source.retry = false;
  registry.register(source);

  const cancelledWaiter = registry.query("places", request, { signal: caller.signal });
  const remainingWaiter = registry.query("places", request);
  const cancelled = assert.rejects(cancelledWaiter, /caller cancelled/);
  await started.promise;
  caller.abort(new Error("caller cancelled"));
  await cancelled;

  assert.equal(querySignal.aborted, false);
  assert.equal(calls, 1);
  release.resolve();
  assert.equal((await remainingWaiter).items[0].title, "Shared");
  assert.equal(calls, 1);
});

test("cancelling the last external waiter aborts active I/O and does not degrade source health", async () => {
  const started = deferred();
  const caller = new AbortController();
  let querySignal!: AbortSignal;
  const registry = new ContextSourceRegistry();
  const source = contextSource(async (_query, runtime) => {
    querySignal = runtime.signal;
    started.resolve();
    return abortableWait(runtime.signal);
  });
  source.retry = false;
  registry.register(source);

  const pending = registry.query("places", request, { signal: caller.signal });
  const cancelled = assert.rejects(pending, /stop waiting/);
  await started.promise;
  caller.abort(new Error("stop waiting"));

  await cancelled;
  assert.equal(querySignal.aborted, true);
  assert.equal(registry.statuses()[0].state, "ready");
  assert.equal(registry.statuses()[0].failures, 0);
});

test("external cancellation removes queued work without aborting the active query or leaking capacity", async () => {
  const activeStarted = deferred();
  const releaseActive = deferred();
  const caller = new AbortController();
  let calls = 0;
  let activeSignal!: AbortSignal;
  const registry = new ContextSourceRegistry({ maxConcurrency: 1 });
  const source = contextSource(async (query, runtime) => {
    calls++;
    if (query.text === "cafe") {
      activeSignal = runtime.signal;
      activeStarted.resolve();
      await releaseActive.promise;
    }
    return [candidate(String(query.text), String(query.text))];
  });
  source.retry = false;
  registry.register(source);

  const active = registry.query("places", request);
  const queued = registry.query("places", { ...request, text: "park" }, { signal: caller.signal });
  const cancelled = assert.rejects(queued, /cancel queued/);
  await activeStarted.promise;
  await nextTurn();
  assert.equal(calls, 1);

  caller.abort(new Error("cancel queued"));
  await cancelled;
  assert.equal(activeSignal.aborted, false);
  releaseActive.resolve();
  await active;

  const recovered = await registry.query("places", { ...request, text: "market" });
  assert.equal(recovered.items[0].title, "market");
  assert.equal(calls, 2);
});

test("external cancellation interrupts retry backoff before another attempt", async () => {
  const attempted = deferred();
  const caller = new AbortController();
  let calls = 0;
  const registry = new ContextSourceRegistry();
  const source = contextSource(async () => {
    calls++;
    attempted.resolve();
    throw new Error("temporary network failure");
  });
  source.retry = { maxAttempts: 5, initialDelayMs: 5_000, maxDelayMs: 5_000 };
  registry.register(source);

  const pending = registry.query("places", request, { signal: caller.signal });
  const cancelled = assert.rejects(pending, /cancel retry/);
  await attempted.promise;
  caller.abort(new Error("cancel retry"));

  await cancelled;
  assert.equal(calls, 1);
  assert.equal(registry.statuses()[0].state, "ready");
});

test("queryPurpose propagates external cancellation to every active source", async () => {
  const allStarted = deferred();
  const caller = new AbortController();
  const signals: AbortSignal[] = [];
  const registry = new ContextSourceRegistry({ maxConcurrency: 2 });
  for (const sourceId of ["places", "venues"]) {
    const source = contextSource(async (_query, runtime) => {
      signals.push(runtime.signal);
      if (signals.length === 2) allStarted.resolve();
      return abortableWait(runtime.signal);
    }, sourceId);
    source.retry = false;
    registry.register(source);
  }

  const pending = registry.queryPurpose(request, { signal: caller.signal });
  const cancelled = assert.rejects(pending, /cancel purpose/);
  await allStarted.promise;
  caller.abort(new Error("cancel purpose"));

  await cancelled;
  assert.equal(signals.length, 2);
  assert.equal(signals.every((signal) => signal.aborted), true);
  assert.equal(registry.statuses().every((status) => status.state === "ready"), true);
});

test("removing a principal-scoped source does not evict another principal cache", async () => {
  let bobCalls = 0;
  const registry = new ContextSourceRegistry();
  registry.register(contextSource(async (query) => {
    if (query.principalId === "bob") bobCalls++;
    return [candidate(query.principalId, query.principalId)];
  }));
  registry.register(contextSource(async () => [candidate("Alice", "alice")]), "alice");
  await registry.query("places", { ...request, principalId: "bob" });
  registry.remove("places", "alice");
  assert.equal((await registry.query("places", { ...request, principalId: "bob" })).fromCache, true);
  assert.equal(bobCalls, 1);
});

test("invalidate aborts active external I/O immediately", async () => {
  const started = deferred();
  let signal!: AbortSignal;
  const registry = new ContextSourceRegistry();
  registry.register(contextSource(async (_query, runtime) => {
    signal = runtime.signal;
    started.resolve();
    return abortableWait(runtime.signal);
  }), "u");

  const pending = registry.query("places", request);
  const rejected = assert.rejects(pending, /invalidated/);
  await started.promise;
  registry.invalidate("u", "places");
  assert.equal(signal.aborted, true);
  await rejected;
  assert.equal(registry.statuses("u")[0].state, "ready");
});

test("invalidate aborts every forced external query even though forced work is not singleflight", async () => {
  const bothStarted = deferred();
  const signals: AbortSignal[] = [];
  const registry = new ContextSourceRegistry();
  registry.register(contextSource(async (_query, runtime) => {
    signals.push(runtime.signal);
    if (signals.length === 2) bothStarted.resolve();
    return abortableWait(runtime.signal);
  }), "u");

  const first = registry.query("places", request, { force: true });
  const second = registry.query("places", request, { force: true });
  const outcomes = Promise.allSettled([first, second]);
  await bothStarted.promise;
  registry.invalidate("u", "places");

  assert.equal(signals.length, 2);
  assert.equal(signals.every((signal) => signal.aborted), true);
  assert.equal((await outcomes).every((result) => result.status === "rejected" && /invalidated/.test(String(result.reason))), true);
});

test("removing a source aborts its active external I/O immediately", async () => {
  const started = deferred();
  let signal!: AbortSignal;
  const registry = new ContextSourceRegistry();
  registry.register(contextSource(async (_query, runtime) => {
    signal = runtime.signal;
    started.resolve();
    return abortableWait(runtime.signal);
  }), "u");

  const pending = registry.query("places", request);
  const rejected = assert.rejects(pending, /removed/);
  await started.promise;
  assert.equal(registry.remove("places", "u"), true);
  assert.equal(signal.aborted, true);
  await rejected;
  await assert.rejects(() => registry.query("places", request), /unknown context source/);
});

test("invalidating a principal prevents an abort-ignoring source from repopulating cache or health", async () => {
  const release = deferred();
  let calls = 0;
  const statuses: string[] = [];
  const registry = new ContextSourceRegistry({ onStatus: (_principalId, status) => statuses.push(status.state) });
  registry.register(contextSource(async () => {
    calls++;
    if (calls === 1) await release.promise;
    return [candidate(String(calls), String(calls))];
  }), "u");

  const late = registry.query("places", request);
  const rejected = assert.rejects(late, /invalidated/);
  await nextTurn();
  registry.invalidate("u", "places");
  release.resolve();
  await rejected;
  assert.deepEqual(statuses, []);
  assert.equal((await registry.query("places", request)).items[0].title, "2");
  assert.deepEqual(statuses, ["ready"]);
});

test("invalidating queued work cancels it without leaking semaphore capacity", async () => {
  const started = deferred();
  let calls = 0;
  const registry = new ContextSourceRegistry({ maxConcurrency: 1 });
  registry.register(contextSource(async (query, runtime) => {
    calls++;
    if (query.principalId === "u") {
      started.resolve();
      return abortableWait(runtime.signal);
    }
    return [candidate(query.principalId, query.principalId)];
  }));

  const active = registry.query("places", request);
  const queued = registry.query("places", { ...request, text: "park" });
  const outcomes = Promise.allSettled([active, queued]);
  await started.promise;
  await nextTurn();
  assert.equal(calls, 1);

  registry.invalidate("u", "places");
  const settled = await outcomes;
  assert.equal(settled.every((result) => result.status === "rejected" && /invalidated/.test(String(result.reason))), true);
  assert.equal(calls, 1);

  const recovered = await registry.query("places", { ...request, principalId: "other" });
  assert.equal(recovered.items[0].title, "other");
  assert.equal(calls, 2);
});

test("source-scoped invalidation leaves unrelated active I/O running", async () => {
  const placesStarted = deferred();
  const venuesStarted = deferred();
  const releaseVenues = deferred();
  let placesSignal!: AbortSignal;
  let venuesSignal!: AbortSignal;
  const registry = new ContextSourceRegistry({ maxConcurrency: 2 });
  registry.register(contextSource(async (_query, runtime) => {
    placesSignal = runtime.signal;
    placesStarted.resolve();
    return abortableWait(runtime.signal);
  }, "places"));
  registry.register(contextSource(async (_query, runtime) => {
    venuesSignal = runtime.signal;
    venuesStarted.resolve();
    await releaseVenues.promise;
    return [candidate("Venue", "venue", [sourceRef("venues")])];
  }, "venues"));

  const places = registry.query("places", request);
  const placesRejected = assert.rejects(places, /invalidated/);
  const venues = registry.query("venues", request);
  await Promise.all([placesStarted.promise, venuesStarted.promise]);
  registry.invalidate("u", "places");
  assert.equal(placesSignal.aborted, true);
  assert.equal(venuesSignal.aborted, false);
  releaseVenues.resolve();
  await placesRejected;
  assert.equal((await venues).items[0].title, "Venue");
});

test("principal-scoped invalidation leaves another principal's active I/O running", async () => {
  const ownerStarted = deferred();
  const otherStarted = deferred();
  const releaseOther = deferred();
  let ownerSignal!: AbortSignal;
  let otherSignal!: AbortSignal;
  const registry = new ContextSourceRegistry({ maxConcurrency: 2 });
  registry.register(contextSource(async (query, runtime) => {
    if (query.principalId === "u") {
      ownerSignal = runtime.signal;
      ownerStarted.resolve();
      return abortableWait(runtime.signal);
    }
    otherSignal = runtime.signal;
    otherStarted.resolve();
    await releaseOther.promise;
    return [candidate("Other", "other")];
  }));

  const owner = registry.query("places", request);
  const ownerRejected = assert.rejects(owner, /invalidated/);
  const other = registry.query("places", { ...request, principalId: "other" });
  await Promise.all([ownerStarted.promise, otherStarted.promise]);
  registry.invalidate("u");
  assert.equal(ownerSignal.aborted, true);
  assert.equal(otherSignal.aborted, false);
  releaseOther.resolve();
  await ownerRejected;
  assert.equal((await other).items[0].title, "Other");
});

test("ContextSourceRegistry centrally rejects malformed candidate provenance", async (t) => {
  const valid = candidate("Cafe", "1");
  const cases: Array<{ name: string; value: unknown }> = [
    { name: "non-array result", value: { ...valid } },
    { name: "sparse result array", value: new Array(1) },
    { name: "non-object candidate", value: [null] },
    { name: "unknown candidate field", value: [{ ...valid, leaked: true }] },
    { name: "non-object data", value: [{ ...valid, data: [] }] },
    { name: "invalid point structure", value: [{ ...valid, point: [] }] },
    { name: "non-array sources", value: [{ ...valid, sources: {} }] },
    { name: "empty sources", value: [{ ...valid, sources: [] }] },
    { name: "sparse sources array", value: [{ ...valid, sources: new Array(1) }] },
    { name: "unknown source field", value: [{ ...valid, sources: [{ ...sourceRef(), leaked: true }] }] },
    { name: "empty sourceId", value: [{ ...valid, sources: [{ ...sourceRef(), sourceId: " " }] }] },
    { name: "wrong sourceId", value: [{ ...valid, sources: [sourceRef("other")] }] },
    { name: "non-finite observedAt", value: [{ ...valid, sources: [{ ...sourceRef(), observedAt: Number.POSITIVE_INFINITY }] }] },
    { name: "fractional observedAt", value: [{ ...valid, sources: [{ ...sourceRef(), observedAt: 1.5 }] }] },
    { name: "invalid freshness", value: [{ ...valid, sources: [{ ...sourceRef(), freshness: "recent" }] }] },
  ];

  for (const invalid of cases) {
    await t.test(invalid.name, async () => {
      const registry = new ContextSourceRegistry();
      registry.register(contextSource(async () => invalid.value as never));
      await assert.rejects(() => registry.query("places", request), /invalid context source result/);
      assert.equal(registry.statuses()[0].state, "degraded");
    });
  }
});

test("malformed refreshes are never cached and can only fall back to prior valid stale data", async () => {
  let now = 10;
  let calls = 0;
  const registry = new ContextSourceRegistry({ now: () => now });
  registry.register(contextSource(async () => {
    calls++;
    if (calls === 1) return [candidate("Valid", "valid")];
    if (calls === 2) return [{ ...candidate("Invalid", "invalid"), sources: [] }];
    return [candidate("Recovered", "recovered")];
  }));

  await registry.query("places", request);
  now = 200;
  const stale = await registry.query("places", request);
  assert.equal(stale.items[0].title, "Valid");
  assert.equal(stale.items[0].sources[0].freshness, "stale");
  assert.match(stale.warning || "", /invalid context source result/);

  registry.invalidate("u", "places");
  const recovered = await registry.query("places", request);
  assert.equal(recovered.fromCache, false);
  assert.equal(recovered.items[0].title, "Recovered");
  assert.equal(calls, 3);
});

test("first-party builtin aggregators may preserve validated upstream provenance", async () => {
  const registry = new ContextSourceRegistry();
  const federator = contextSource(async () => [candidate("Federated", "federated", [
    sourceRef("feed-a", "fresh", "a"),
    sourceRef("feed-b", "fresh", "b"),
  ])]);
  federator.descriptor.id = "federator";
  federator.descriptor.transport = "builtin";
  registry.register(federator);

  const result = await registry.query("federator", request);
  assert.deepEqual(result.items[0].sources.map((ref) => ref.sourceId), ["feed-a", "feed-b"]);
});
