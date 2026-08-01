import test from "node:test";
import assert from "node:assert/strict";
import { PersonalActionManager, PersonalActionOutcomeUncertainError, createNavigationActionExecutor } from "./personal-actions.js";
import { PersonalContextStore } from "./personal-store.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = () => {
  let now = 100; const store = new PersonalContextStore({ root: mkdtempSync(join(tmpdir(), "jarvis-actions-")), now: () => ++now });
  const manager = new PersonalActionManager(store, { now: () => ++now, planTtlMs: 10_000 });
  return { store, manager, setNow: (value: number) => { now = value; } };
};

test("external actions require a matching one-time confirmation before execution", async () => {
  const { manager } = fixture(); let calls = 0;
  manager.register({ kind: "calendar.create", risk: "external_reversible", preview: (payload) => ({ title: payload.title }), execute: async () => ({ eventId: String(++calls) }) });
  const plan = manager.preview("u", "calendar.create", { title: "Dinner" }, "same-request");
  assert.equal(plan.requiresConfirmation, true);
  await assert.rejects(() => manager.execute("u", plan.id), /confirmation required/);
  assert.throws(() => manager.approve("u", plan.id, "wrong"), /invalid action confirmation/);
  manager.approve("u", plan.id, plan.confirmationChallenge!, "phone");
  const done = await manager.execute("u", plan.id);
  assert.equal(done.state, "succeeded"); assert.equal(calls, 1);
  assert.equal((await manager.execute("u", plan.id)).result?.eventId, "1"); assert.equal(calls, 1);
});

test("read actions execute without confirmation and concurrent retries are idempotent", async () => {
  const { manager } = fixture(); let calls = 0, release!: () => void;
  manager.register({ kind: "source.refresh", risk: "read", preview: () => ({}), execute: async () => { calls++; await new Promise<void>((resolve) => { release = resolve; }); return { ok: true }; } });
  const plan = manager.preview("u", "source.refresh", {}, "refresh-1");
  const a = manager.execute("u", plan.id), b = manager.execute("u", plan.id); release();
  assert.equal((await a).state, "succeeded"); assert.equal((await b).state, "succeeded"); assert.equal(calls, 1);
});

test("expired plans fail closed and navigation validates schemes", async () => {
  const { manager, setNow } = fixture(); manager.register(createNavigationActionExecutor());
  assert.throws(() => manager.preview("u", "navigation.open", { url: "javascript:alert(1)" }), /unsupported/);
  const plan = manager.preview("u", "navigation.open", { url: "https://maps.example/route" });
  setNow(99_999);
  assert.equal((await manager.execute("u", plan.id)).state, "expired");
});

test("state reconciliation expires pending and approved plans without requiring another execution attempt", () => {
  const { manager, setNow } = fixture();
  manager.register({ kind: "calendar.create", risk: "external_reversible", preview: () => ({}), execute: async () => ({}) });
  const pending = manager.preview("u", "calendar.create", {}, "pending-expiry");
  const approved = manager.preview("u", "calendar.create", {}, "approved-expiry");
  manager.approve("u", approved.id, approved.confirmationChallenge!);
  setNow(Math.max(pending.expiresAt, approved.expiresAt) + 1);

  const states = new Map(manager.reconcile("u").map((plan) => [plan.id, plan.state]));
  assert.equal(states.get(pending.id), "expired");
  assert.equal(states.get(approved.id), "expired");
});

test("navigation succeeds only after the initiating client acknowledges the handoff", async () => {
  const { manager, store } = fixture();
  manager.register(createNavigationActionExecutor());
  const plan = manager.preview("u", "navigation.open", { url: "geo:-19.9,-43.9", title: "Destino" }, "route-1", "phone");
  manager.approve("u", plan.id, plan.confirmationChallenge!, "phone");

  const awaiting = await manager.execute("u", plan.id, "phone");
  assert.equal(awaiting.state, "running");
  assert.equal(awaiting.awaitingClientAck, true);
  assert.equal(awaiting.executionDeviceId, "phone");
  assert.equal(awaiting.result?.handoff, "geo:-19.9,-43.9");
  assert.equal((await manager.execute("u", plan.id, "phone")).state, "running");
  assert.throws(() => manager.completeClientHandoff("u", plan.id, true, "tablet"), /initiating device/);

  const recovered = new PersonalActionManager(store, { now: () => 500 });
  const completed = recovered.completeClientHandoff("u", plan.id, true, "phone");
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.awaitingClientAck, false);
  assert.ok(completed.completedAt);
  assert.equal(recovered.completeClientHandoff("u", plan.id, false, "phone", "late failure").state, "succeeded");
});

test("an unacknowledged client handoff times out and cannot remain running or be completed late", async () => {
  const { manager, setNow } = fixture();
  manager.register(createNavigationActionExecutor());
  const plan = manager.preview("u", "navigation.open", { url: "https://maps.example/route" }, "route-timeout", "phone");
  manager.approve("u", plan.id, plan.confirmationChallenge!, "phone");
  const awaiting = await manager.execute("u", plan.id, "phone");
  assert.ok(awaiting.clientAckExpiresAt);

  setNow(awaiting.clientAckExpiresAt! + 1);
  const reconciled = manager.reconcile("u").find((action) => action.id === plan.id);
  assert.equal(reconciled?.state, "uncertain");
  assert.equal(reconciled?.awaitingClientAck, false);
  assert.match(reconciled?.error || "", /timed out/);
  assert.equal(manager.completeClientHandoff("u", plan.id, true, "phone").state, "uncertain");
});

test("a legacy persisted handoff receives a durable acknowledgement deadline after restart", () => {
  const { store, manager } = fixture();
  manager.register(createNavigationActionExecutor());
  const plan = manager.preview("u", "navigation.open", { url: "geo:1,2" }, "legacy-handoff", "phone");
  manager.approve("u", plan.id, plan.confirmationChallenge!, "phone");
  store.putAction("u", { ...store.get("u").actions[0], state: "running", awaitingClientAck: true, executionDeviceId: "phone" });

  const recovered = new PersonalActionManager(store, { now: () => 1_000, handoffAckTimeoutMs: 5_000 });
  const reconciled = recovered.reconcile("u")[0];
  assert.equal(reconciled.state, "running");
  assert.equal(reconciled.clientAckExpiresAt, 6_000);
  assert.equal(store.get("u").actions[0].clientAckExpiresAt, 6_000);
});

test("a rejected or cancelled client handoff cannot be reported as successful", async () => {
  const { manager } = fixture();
  manager.register(createNavigationActionExecutor());
  const rejected = manager.preview("u", "navigation.open", { url: "https://maps.example/route" }, "route-rejected");
  manager.approve("u", rejected.id, rejected.confirmationChallenge!);
  await manager.execute("u", rejected.id, "phone");
  const failed = manager.completeClientHandoff("u", rejected.id, false, "phone", "popup blocked");
  assert.equal(failed.state, "failed");
  assert.match(failed.error || "", /popup blocked/);

  const cancelled = manager.preview("u", "navigation.open", { url: "geo:1,2" }, "route-cancelled");
  manager.approve("u", cancelled.id, cancelled.confirmationChallenge!);
  await manager.execute("u", cancelled.id, "phone");
  assert.equal((await manager.cancel("u", cancelled.id)).state, "uncertain");
});

test("approval is bound to immutable preview and payload", () => {
  const { manager, store } = fixture();
  manager.register({ kind: "calendar.create", risk: "external_reversible", preview: (payload) => ({ title: payload.title }), execute: async () => ({}) });
  const plan = manager.preview("u", "calendar.create", { title: "Original" });
  assert.throws(() => store.putAction("u", { ...plan, payload: { title: "Changed" } }), /immutable fields changed/);
});

test("private executors and in-flight idempotency are isolated by principal", async () => {
  const { manager } = fixture(); const releases = new Map<string, () => void>();
  manager.register({ kind: "home.toggle", risk: "read", preview: () => ({ owner: "alice" }), execute: async (_payload, context) => { await new Promise<void>((resolve) => releases.set(context.principalId, resolve)); return { owner: "alice" }; } }, "alice");
  manager.register({ kind: "home.toggle", risk: "read", preview: () => ({ owner: "bob" }), execute: async (_payload, context) => { await new Promise<void>((resolve) => releases.set(context.principalId, resolve)); return { owner: "bob" }; } }, "bob");
  const alice = manager.preview("alice", "home.toggle", {}, "same-key"), bob = manager.preview("bob", "home.toggle", {}, "same-key");
  assert.equal(alice.preview.owner, "alice"); assert.equal(bob.preview.owner, "bob");
  const a = manager.execute("alice", alice.id), b = manager.execute("bob", bob.id);
  await new Promise((resolve) => setImmediate(resolve)); releases.get("alice")!(); releases.get("bob")!();
  assert.equal((await a).result?.owner, "alice"); assert.equal((await b).result?.owner, "bob");
});

test("a late executor result cannot overwrite a user cancellation", async () => {
  const { manager } = fixture(); let release!: () => void;
  manager.register({
    kind: "slow.read", risk: "read", preview: () => ({}),
    execute: async () => { await new Promise<void>((resolve) => { release = resolve; }); return { leakedSuccess: true }; },
  });
  const plan = manager.preview("u", "slow.read", {}, "slow-1");
  const running = manager.execute("u", plan.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await manager.cancel("u", plan.id)).state, "cancelled");
  release();
  const completed = await running;
  assert.equal(completed.state, "cancelled");
  assert.equal(completed.result, undefined);
});

test("principal erasure prevents a late executor from recreating erased action data", async () => {
  const { manager, store } = fixture(); let release!: () => void;
  manager.register({
    kind: "stubborn.read", risk: "read", preview: () => ({}),
    execute: async () => { await new Promise<void>((resolve) => { release = resolve; }); return { late: true }; },
  });
  const plan = manager.preview("u", "stubborn.read", {}, "erase-race");
  const running = manager.execute("u", plan.id);
  await new Promise((resolve) => setImmediate(resolve));

  await manager.beginPrincipalErasure("u");
  assert.throws(() => manager.preview("u", "stubborn.read", {}), /erasure is in progress/);
  store.erase("u");
  manager.endPrincipalErasure("u");
  release();

  assert.equal((await running).state, "cancelled");
  assert.deepEqual(store.get("u").actions, []);
});

test("an unsuccessful action is never repeated under the same idempotency key", async () => {
  const { manager } = fixture(); let attempts = 0;
  manager.register({ kind: "retry.read", risk: "read", preview: () => ({}), execute: async () => {
    attempts++;
    if (attempts === 1) throw new Error("temporary");
    return { ok: true };
  } });
  const first = manager.preview("u", "retry.read", {}, "stable-key");
  assert.equal((await manager.execute("u", first.id)).state, "failed");
  const retry = manager.preview("u", "retry.read", {}, "stable-key");
  assert.equal(retry.id, first.id);
  assert.equal((await manager.execute("u", retry.id)).state, "failed");
  assert.equal(attempts, 1);
  const reviewed = manager.preview("u", "retry.read", {}, "new-reviewed-key");
  assert.notEqual(reviewed.id, first.id);
  assert.equal((await manager.execute("u", reviewed.id)).state, "succeeded");
});

test("a running action recovered without its process is marked uncertain and never replayed", async () => {
  const { store, manager } = fixture(); let calls = 0;
  const executor = { kind: "external.write", risk: "external_reversible" as const, preview: () => ({}), execute: async () => ({ call: ++calls }) };
  manager.register(executor);
  const plan = manager.preview("u", executor.kind, {}, "crash-key");
  manager.approve("u", plan.id, plan.confirmationChallenge!);
  store.putAction("u", { ...store.get("u").actions[0], state: "running" });

  const recovered = new PersonalActionManager(store);
  recovered.register(executor);
  const result = await recovered.execute("u", plan.id);
  assert.equal(result.state, "uncertain");
  assert.match(result.error || "", /reconcile/);
  assert.equal(calls, 0);
  assert.equal(recovered.preview("u", executor.kind, {}, "crash-key").id, plan.id);
});

test("an executor can report a sent but unverifiable effect as uncertain and it is never replayed", async () => {
  const { manager } = fixture(); let calls = 0;
  manager.register({
    kind: "external.uncertain", risk: "read", preview: () => ({}),
    execute: async () => { calls++; throw new PersonalActionOutcomeUncertainError("effect sent; verification unavailable"); },
  });
  const plan = manager.preview("u", "external.uncertain", {}, "uncertain-key");
  const result = await manager.execute("u", plan.id);
  assert.equal(result.state, "uncertain");
  assert.match(result.error || "", /verification unavailable/);
  assert.equal((await manager.execute("u", plan.id)).state, "uncertain");
  assert.equal(calls, 1);
});

test("ordinary failures and cancellation become uncertain only after the effect dispatch boundary", async () => {
  const { manager } = fixture();
  manager.register({
    kind: "external.after-dispatch", risk: "read", preview: () => ({}),
    execute: async (_payload, context) => { context.markDispatched?.(); throw new Error("connection dropped"); },
  });
  const failedAfterDispatch = manager.preview("u", "external.after-dispatch", {}, "sent-key");
  assert.equal((await manager.execute("u", failedAfterDispatch.id)).state, "uncertain");

  let release!: () => void;
  manager.register({
    kind: "external.cancel-after-dispatch", risk: "read", preview: () => ({}),
    execute: async (_payload, context) => {
      context.markDispatched?.();
      await new Promise<void>((resolve) => { release = resolve; });
      return { externalEffect: true };
    },
  });
  const cancellation = manager.preview("u", "external.cancel-after-dispatch", {}, "cancel-sent-key");
  const running = manager.execute("u", cancellation.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await manager.cancel("u", cancellation.id)).state, "uncertain");
  release();
  assert.equal((await running).state, "uncertain");
});

test("executor version and authorization are revalidated immediately before effects", async () => {
  const { store } = fixture(); let allowed = true, calls = 0;
  const manager = new PersonalActionManager(store, {
    authorizeExecutor: ({ existing }) => {
      if (!allowed) throw new Error("revoked");
      return existing || { consentId: "grant", purpose: "automation" };
    },
  });
  const executor = (fingerprint: string) => ({
    kind: "source.write", risk: "external_reversible" as const, fingerprint,
    authorization: { sourceId: "source", purposes: ["automation" as const], fields: ["actions"] },
    preview: () => ({}), execute: async (_payload: Record<string, unknown>, context: { idempotencyKey?: string }) => { calls++; return { token: context.idempotencyKey }; },
  });
  manager.register(executor("v1"));
  const changed = manager.preview("u", "source.write", {}, "version-key");
  manager.approve("u", changed.id, changed.confirmationChallenge!);
  manager.remove("source.write"); manager.register(executor("v2"));
  assert.equal((await manager.execute("u", changed.id)).state, "expired");
  assert.equal(calls, 0);

  const revoked = manager.preview("u", "source.write", {}, "consent-key");
  manager.approve("u", revoked.id, revoked.confirmationChallenge!);
  allowed = false;
  const result = await manager.execute("u", revoked.id);
  assert.equal(result.state, "expired");
  assert.match(result.error || "", /revoked/);
  assert.equal(calls, 0);
});
