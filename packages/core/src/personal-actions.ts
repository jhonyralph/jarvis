import { createHash, randomUUID } from "node:crypto";
import type { ContextPurpose, PersonalActionPlan, PersonalActionRisk, PersonalActionView, PersonalContextState } from "@jarvis/protocol";

export interface PersonalActionAuthorization {
  sourceId: string;
  purposes: ContextPurpose[];
  fields?: string[];
}

export interface PersonalActionAuthorizationGrant {
  consentId: string;
  purpose: ContextPurpose;
  deviceId?: string;
}

export interface PersonalActionExecutor {
  kind: string;
  risk: PersonalActionRisk;
  fingerprint?: string;
  authorization?: PersonalActionAuthorization;
  preview(payload: Record<string, unknown>): Record<string, unknown>;
  execute(payload: Record<string, unknown>, context: {
    principalId: string;
    deviceId?: string;
    signal: AbortSignal;
    planId?: string;
    idempotencyKey?: string;
    authorization?: PersonalActionAuthorizationGrant;
    /** Call immediately before the first request that may create an external effect. */
    markDispatched?: () => void;
  }): Promise<Record<string, unknown>>;
  cancel?(payload: Record<string, unknown>): Promise<void> | void;
}

export class PersonalActionOutcomeUncertainError extends Error {
  override readonly name = "PersonalActionOutcomeUncertainError";
}

export interface PersonalActionStore {
  get(principalId: string): PersonalContextState;
  putAction(principalId: string, action: PersonalActionPlan): PersonalContextState;
}

export interface PersonalActionManagerOptions {
  now?: () => number;
  planTtlMs?: number;
  handoffAckTimeoutMs?: number;
  autoExecuteLocalReversible?: boolean;
  authorizeExecutor?: (input: {
    principalId: string;
    deviceId?: string;
    executor: PersonalActionExecutor;
    existing?: PersonalActionAuthorizationGrant;
  }) => PersonalActionAuthorizationGrant | undefined;
}

export function actionRequiresConfirmation(risk: PersonalActionRisk, autoExecuteLocalReversible = false): boolean {
  return risk === "consequential" || risk === "external_reversible" || (risk === "local_reversible" && !autoExecuteLocalReversible);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function approvalDigest(plan: Pick<PersonalActionPlan, "principalId" | "idempotencyKey" | "kind" | "risk" | "executorFingerprint" | "sourceId" | "authorizationConsentId" | "authorizationPurpose" | "authorizationDeviceId" | "preview" | "payload" | "createdAt" | "expiresAt">): string {
  const content = {
    principalId: plan.principalId, idempotencyKey: plan.idempotencyKey, kind: plan.kind, risk: plan.risk,
    executorFingerprint: plan.executorFingerprint, sourceId: plan.sourceId, authorizationConsentId: plan.authorizationConsentId,
    authorizationPurpose: plan.authorizationPurpose, authorizationDeviceId: plan.authorizationDeviceId,
    preview: plan.preview, payload: plan.payload, createdAt: plan.createdAt, expiresAt: plan.expiresAt,
  };
  return createHash("sha256").update(canonical(content)).digest("hex");
}

export function publicActionPlan(plan: PersonalActionPlan): PersonalActionView {
  const { payload: _payload, ...view } = structuredClone(plan);
  return view;
}

export class PersonalActionManager {
  private readonly executors = new Map<string, PersonalActionExecutor>();
  private readonly active = new Map<string, Promise<PersonalActionPlan>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly dispatchedPlans = new Set<string>();
  private readonly principalGenerations = new Map<string, number>();
  private readonly principalsBeingErased = new Set<string>();
  private readonly handoffTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private readonly planTtlMs: number;
  private readonly handoffAckTimeoutMs: number;
  private readonly autoExecuteLocal: boolean;
  private readonly authorizeExecutor?: PersonalActionManagerOptions["authorizeExecutor"];

  constructor(private readonly store: PersonalActionStore, options: PersonalActionManagerOptions = {}) {
    this.now = options.now || Date.now;
    this.planTtlMs = Math.max(10_000, options.planTtlMs || 10 * 60_000);
    this.handoffAckTimeoutMs = Math.max(100, options.handoffAckTimeoutMs || 60_000);
    this.autoExecuteLocal = options.autoExecuteLocalReversible || false;
    this.authorizeExecutor = options.authorizeExecutor;
  }

  private executorKey(kind: string, principalId?: string): string { return `${principalId || "*"}\u0000${kind}`; }
  private principalGeneration(principalId: string): number { return this.principalGenerations.get(principalId) || 0; }
  private assertPrincipalAvailable(principalId: string): void {
    if (this.principalsBeingErased.has(principalId)) throw new Error("personal data erasure is in progress");
  }
  private executorFor(kind: string, principalId: string): PersonalActionExecutor | undefined {
    return this.executors.get(this.executorKey(kind, principalId)) || this.executors.get(this.executorKey(kind));
  }
  private executorFingerprint(executor: PersonalActionExecutor): string {
    return createHash("sha256").update(canonical({
      kind: executor.kind,
      risk: executor.risk,
      version: executor.fingerprint || "v1",
      authorization: executor.authorization,
    })).digest("hex");
  }
  private authorizationFor(
    principalId: string,
    executor: PersonalActionExecutor,
    deviceId?: string,
    existing?: PersonalActionAuthorizationGrant,
  ): PersonalActionAuthorizationGrant | undefined {
    if (!executor.authorization) return undefined;
    if (!this.authorizeExecutor) throw new Error("action authorization verifier is unavailable");
    const grant = this.authorizeExecutor({ principalId, deviceId, executor, existing });
    if (!grant || !grant.consentId || !executor.authorization.purposes.includes(grant.purpose)) throw new Error("action authorization is unavailable");
    if (existing && (grant.consentId !== existing.consentId || grant.purpose !== existing.purpose || grant.deviceId !== existing.deviceId)) {
      throw new Error("action authorization changed after preview");
    }
    return grant;
  }

  register(executor: PersonalActionExecutor, principalId?: string): void {
    const key = this.executorKey(executor.kind, principalId);
    if (!executor.kind || this.executors.has(key)) throw new Error(`duplicate action executor: ${executor.kind}`);
    this.executors.set(key, executor);
  }
  remove(kind: string, principalId?: string): boolean { return this.executors.delete(this.executorKey(kind, principalId)); }

  preview(principalId: string, kind: string, payload: Record<string, unknown>, idempotencyKey: string = randomUUID(), deviceId?: string): PersonalActionPlan {
    this.assertPrincipalAvailable(principalId);
    const executor = this.executorFor(kind, principalId); if (!executor) throw new Error(`unknown action: ${kind}`);
    const matches = this.store.get(principalId).actions.filter((action) => action.idempotencyKey === idempotencyKey && action.kind === kind)
      .map((action) => this.reconcileInterrupted(principalId, action));
    const existing = [...matches].sort((left, right) => right.createdAt - left.createdAt)[0];
    if (existing) return structuredClone(existing);
    const authorization = this.authorizationFor(principalId, executor, deviceId);
    const requiresConfirmation = actionRequiresConfirmation(executor.risk, this.autoExecuteLocal);
    const plan: PersonalActionPlan = {
      id: randomUUID(), principalId, idempotencyKey, kind, risk: executor.risk,
      executorFingerprint: this.executorFingerprint(executor),
      ...(executor.authorization ? { sourceId: executor.authorization.sourceId } : {}),
      ...(authorization ? {
        authorizationConsentId: authorization.consentId,
        authorizationPurpose: authorization.purpose,
        authorizationDeviceId: authorization.deviceId,
      } : {}),
      preview: structuredClone(executor.preview(payload)), payload: structuredClone(payload), createdAt: this.now(),
      expiresAt: this.now() + this.planTtlMs, state: "pending", requiresConfirmation,
      confirmationChallenge: requiresConfirmation ? randomUUID() : undefined,
    };
    plan.approvalDigest = approvalDigest(plan);
    this.store.putAction(principalId, plan); return structuredClone(plan);
  }

  approve(principalId: string, planId: string, challenge: string, deviceId?: string): PersonalActionPlan {
    this.assertPrincipalAvailable(principalId);
    const plan = this.find(principalId, planId);
    if (plan.state === "approved") return plan;
    if (plan.state !== "pending") throw new Error(`action cannot be approved from ${plan.state}`);
    if (plan.expiresAt <= this.now()) return this.expire(principalId, plan);
    if (!plan.approvalDigest || plan.approvalDigest !== approvalDigest(plan)) throw new Error("action content changed after preview");
    if (!plan.requiresConfirmation || !plan.confirmationChallenge || plan.confirmationChallenge !== challenge) throw new Error("invalid action confirmation challenge");
    plan.state = "approved"; plan.approvedAt = this.now(); plan.approvedByDeviceId = deviceId; plan.confirmationChallenge = undefined;
    this.store.putAction(principalId, plan); return structuredClone(plan);
  }

  async execute(principalId: string, planId: string, deviceId?: string): Promise<PersonalActionPlan> {
    this.assertPrincipalAvailable(principalId);
    const initial = this.find(principalId, planId);
    if (["succeeded", "failed", "cancelled", "expired", "uncertain"].includes(initial.state)) return initial;
    if (initial.state === "running" && initial.awaitingClientAck) return initial;
    const idempotent = this.store.get(principalId).actions.find((action) => action.kind === initial.kind && action.idempotencyKey === initial.idempotencyKey && action.state === "succeeded");
    if (idempotent) return structuredClone(idempotent);
    const activeKey = `${principalId}\u0000${initial.idempotencyKey}`, active = this.active.get(activeKey); if (active) return active;
    const generation = this.principalGeneration(principalId);
    const operation = this.executeOnce(principalId, initial, generation, deviceId).finally(() => this.active.delete(activeKey));
    this.active.set(activeKey, operation); return operation;
  }

  private async executeOnce(principalId: string, plan: PersonalActionPlan, generation: number, deviceId?: string): Promise<PersonalActionPlan> {
    if (plan.expiresAt <= this.now()) return this.expire(principalId, plan);
    if (!plan.approvalDigest || plan.approvalDigest !== approvalDigest(plan)) throw new Error("action content changed after approval");
    if (plan.requiresConfirmation && plan.state !== "approved") throw new Error("action confirmation required");
    if (!plan.requiresConfirmation && plan.state !== "pending" && plan.state !== "approved") {
      if (plan.state === "succeeded") return plan;
      throw new Error(`action cannot execute from ${plan.state}`);
    }
    const executor = this.executorFor(plan.kind, principalId);
    if (!executor || executor.risk !== plan.risk || !plan.executorFingerprint || this.executorFingerprint(executor) !== plan.executorFingerprint) {
      return this.invalidatePlan(principalId, plan, "action executor changed after preview; create a new preview");
    }
    let authorization: PersonalActionAuthorizationGrant | undefined;
    try {
      authorization = this.authorizationFor(principalId, executor, deviceId, plan.authorizationConsentId && plan.authorizationPurpose ? {
        consentId: plan.authorizationConsentId,
        purpose: plan.authorizationPurpose,
        deviceId: plan.authorizationDeviceId,
      } : undefined);
    } catch (error) {
      return this.invalidatePlan(principalId, plan, String((error as Error)?.message || error));
    }
    const controller = new AbortController(); this.controllers.set(plan.id, controller);
    plan.state = "running"; this.store.putAction(principalId, plan);
    try {
      const result = await executor.execute(structuredClone(plan.payload), {
        principalId,
        deviceId,
        signal: controller.signal,
        planId: plan.id,
        idempotencyKey: plan.idempotencyKey,
        authorization,
        markDispatched: () => {
          if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new Error("action was cancelled before dispatch");
          this.dispatchedPlans.add(plan.id);
        },
      });
      if (generation !== this.principalGeneration(principalId)) return this.cancelledWithoutWrite(plan);
      const current = this.find(principalId, plan.id);
      if (current.state === "uncertain") {
        plan = current;
      } else if (controller.signal.aborted || current.state === "cancelled") {
        plan = current;
        if (this.dispatchedPlans.has(plan.id)) {
          plan.state = "uncertain";
          plan.error = "action was cancelled after dispatch; reconcile the external system before retrying";
        } else plan.state = "cancelled";
        plan.completedAt ||= this.now();
      } else if (result.requiresClientAck === true && typeof result.handoff === "string") {
        plan.result = structuredClone(result);
        plan.state = "running";
        plan.awaitingClientAck = true;
        plan.executionDeviceId = deviceId;
        plan.clientAckExpiresAt = Math.min(plan.expiresAt, this.now() + this.handoffAckTimeoutMs);
        plan.completedAt = undefined;
        plan.error = undefined;
      } else {
        plan.result = result; plan.state = "succeeded"; plan.completedAt = this.now(); plan.error = undefined;
      }
    } catch (error) {
      if (generation !== this.principalGeneration(principalId)) return this.cancelledWithoutWrite(plan);
      plan.state = this.dispatchedPlans.has(plan.id) || error instanceof PersonalActionOutcomeUncertainError
        ? "uncertain"
        : controller.signal.aborted ? "cancelled" : "failed";
      plan.completedAt = this.now();
      plan.error = String((error as Error)?.message || error).slice(0, 1_000);
    } finally { this.controllers.delete(plan.id); this.dispatchedPlans.delete(plan.id); }
    if (generation !== this.principalGeneration(principalId)) return this.cancelledWithoutWrite(plan);
    this.store.putAction(principalId, plan);
    if (plan.awaitingClientAck) this.scheduleHandoffTimeout(principalId, plan);
    return structuredClone(plan);
  }

  completeClientHandoff(principalId: string, planId: string, success: boolean, deviceId?: string, error?: string): PersonalActionPlan {
    this.assertPrincipalAvailable(principalId);
    const plan = this.find(principalId, planId);
    if (["succeeded", "failed", "cancelled", "expired", "uncertain"].includes(plan.state)) return plan;
    if (plan.state !== "running" || plan.awaitingClientAck !== true) throw new Error("action is not awaiting a client handoff result");
    if (plan.executionDeviceId && plan.executionDeviceId !== deviceId) throw new Error("action handoff must be acknowledged by the initiating device");
    plan.state = success ? "succeeded" : "failed";
    plan.awaitingClientAck = false;
    this.clearHandoffTimeout(plan.id);
    plan.completedAt = this.now();
    plan.error = success ? undefined : String(error || "client could not open the handoff").slice(0, 1_000);
    this.store.putAction(principalId, plan);
    return structuredClone(plan);
  }

  async cancel(principalId: string, planId: string): Promise<PersonalActionPlan> {
    const plan = this.find(principalId, planId);
    if (["succeeded", "failed", "cancelled", "expired", "uncertain"].includes(plan.state)) return plan;
    this.controllers.get(plan.id)?.abort(new Error("cancelled by user"));
    let cancellationError: unknown;
    const executor = this.executorFor(plan.kind, principalId);
    try { if (executor?.cancel) await executor.cancel(structuredClone(plan.payload)); }
    catch (error) { cancellationError = error; }
    if (this.dispatchedPlans.has(plan.id) || plan.awaitingClientAck) {
      plan.state = "uncertain";
      plan.error = "action was cancelled after dispatch; reconcile the external system before retrying";
    } else plan.state = "cancelled";
    plan.awaitingClientAck = false;
    this.clearHandoffTimeout(plan.id);
    plan.completedAt = this.now(); this.store.putAction(principalId, plan);
    if (cancellationError) throw cancellationError;
    return structuredClone(plan);
  }

  async beginPrincipalErasure(principalId: string): Promise<void> {
    if (this.principalsBeingErased.has(principalId)) throw new Error("personal data erasure is already in progress");
    this.principalsBeingErased.add(principalId);
    this.principalGenerations.set(principalId, this.principalGeneration(principalId) + 1);
    const plans = this.store.get(principalId).actions.filter((action) => ["pending", "approved", "running"].includes(action.state));
    const results = await Promise.allSettled(plans.map((plan) => this.cancel(principalId, plan.id)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) {
      this.endPrincipalErasure(principalId);
      throw failed.reason;
    }
  }

  endPrincipalErasure(principalId: string): void { this.principalsBeingErased.delete(principalId); }

  reconcile(principalId: string): PersonalActionPlan[] {
    return this.store.get(principalId).actions.map((action) => this.reconcileInterrupted(principalId, action));
  }

  async cancelKinds(principalId: string, kinds: readonly string[]): Promise<void> {
    const selected = new Set(kinds);
    if (!selected.size) return;
    const plans = this.store.get(principalId).actions.filter((action) => selected.has(action.kind) && ["pending", "approved", "running"].includes(action.state));
    const results = await Promise.allSettled(plans.map((plan) => this.cancel(principalId, plan.id)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  async cancelAuthorizations(principalId: string, consentIds: readonly string[]): Promise<void> {
    const selected = new Set(consentIds);
    if (!selected.size) return;
    const plans = this.store.get(principalId).actions.filter((action) => action.authorizationConsentId && selected.has(action.authorizationConsentId)
      && ["pending", "approved", "running"].includes(action.state));
    const results = await Promise.allSettled(plans.map((plan) => this.cancel(principalId, plan.id)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  private cancelledWithoutWrite(plan: PersonalActionPlan): PersonalActionPlan {
    const cancelled = structuredClone(plan);
    cancelled.state = "cancelled";
    cancelled.completedAt ||= this.now();
    cancelled.result = undefined;
    cancelled.error = undefined;
    return cancelled;
  }

  private expire(principalId: string, plan: PersonalActionPlan): PersonalActionPlan {
    this.clearHandoffTimeout(plan.id);
    plan.state = "expired"; plan.awaitingClientAck = false; plan.completedAt = this.now(); this.store.putAction(principalId, plan); return structuredClone(plan);
  }
  private invalidatePlan(principalId: string, plan: PersonalActionPlan, error: string): PersonalActionPlan {
    this.clearHandoffTimeout(plan.id);
    plan.state = "expired";
    plan.awaitingClientAck = false;
    plan.completedAt = this.now();
    plan.error = error.slice(0, 1_000);
    plan.result = undefined;
    this.store.putAction(principalId, plan);
    return structuredClone(plan);
  }
  private reconcileInterrupted(principalId: string, input: PersonalActionPlan): PersonalActionPlan {
    const plan = structuredClone(input);
    if ((plan.state === "pending" || plan.state === "approved") && plan.expiresAt <= this.now()) {
      return this.expire(principalId, plan);
    }
    if (plan.state !== "running" || this.controllers.has(plan.id)) return plan;
    if (plan.awaitingClientAck) {
      const deadline = plan.clientAckExpiresAt ?? Math.min(plan.expiresAt, this.now() + this.handoffAckTimeoutMs);
      if (plan.clientAckExpiresAt === undefined) {
        plan.clientAckExpiresAt = deadline;
        this.store.putAction(principalId, plan);
      }
      if (deadline > this.now()) {
        this.scheduleHandoffTimeout(principalId, plan);
        return structuredClone(plan);
      }
      this.clearHandoffTimeout(plan.id);
      plan.awaitingClientAck = false;
      plan.state = "uncertain";
      plan.completedAt ||= this.now();
      plan.error = "client handoff acknowledgement timed out; verify whether the destination opened before retrying";
      this.store.putAction(principalId, plan);
      return structuredClone(plan);
    }
    plan.state = "uncertain";
    plan.completedAt ||= this.now();
    plan.result = undefined;
    plan.error = "execution outcome is uncertain after an interrupted process; reconcile the external system before creating a new action";
    this.store.putAction(principalId, plan);
    return structuredClone(plan);
  }
  private clearHandoffTimeout(planId: string): void {
    const timer = this.handoffTimers.get(planId);
    if (timer) clearTimeout(timer);
    this.handoffTimers.delete(planId);
  }
  private scheduleHandoffTimeout(principalId: string, plan: PersonalActionPlan): void {
    if (!plan.awaitingClientAck || plan.clientAckExpiresAt === undefined || this.handoffTimers.has(plan.id)) return;
    const delay = Math.max(0, plan.clientAckExpiresAt - this.now());
    const timer = setTimeout(() => {
      this.handoffTimers.delete(plan.id);
      try {
        const current = this.store.get(principalId).actions.find((action) => action.id === plan.id);
        if (current) this.reconcileInterrupted(principalId, current);
      } catch {
        // Reconciliation is also performed on the next state read.
      }
    }, delay);
    timer.unref?.();
    this.handoffTimers.set(plan.id, timer);
  }
  private find(principalId: string, planId: string): PersonalActionPlan {
    const plan = this.store.get(principalId).actions.find((action) => action.id === planId);
    if (!plan) throw new Error("action plan not found");
    if (plan.principalId !== principalId) throw new Error("action principal mismatch");
    return this.reconcileInterrupted(principalId, plan);
  }
}

export function createNavigationActionExecutor(): PersonalActionExecutor {
  return {
    kind: "navigation.open", risk: "local_reversible",
    preview(payload) {
      const url = validatedNavigationUrl(payload.url);
      return { title: String(payload.title || "Abrir rota"), url: url.toString() };
    },
    async execute(payload) { return { handoff: validatedNavigationUrl(payload.url).toString(), requiresClientAck: true }; },
  };
}

function validatedNavigationUrl(value: unknown): URL {
  const url = new URL(String(value || ""));
  if (!new Set(["https:", "geo:"]).has(url.protocol)) throw new Error("unsupported navigation URL");
  return url;
}
