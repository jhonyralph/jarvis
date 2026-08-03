import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  PERSONAL_CONTEXT_SCHEMA_VERSION,
  type ContextObservation,
  type ContextSourceStatus,
  type FavoritePlace,
  type PersonalActionPlan,
  type PersonalAssistantSettings,
  type PersonalConsent,
  type PersonalContextExport,
  type PersonalContextState,
  type PersonalDeviceProfile,
  type PersonalDataCategory,
  type PersonalNotificationRecord,
  type PersonalPreference,
  type PersonalSourceConnection,
  type PersonalVehicleProfile,
  toPersonalSourceView,
} from "@jarvis/protocol";
import { emptyPersonalContextState } from "./personal-context.js";
import { normalizeGeoPoint } from "./personal-context.js";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persist.js";

type PersonalEvent = {
  schemaVersion: typeof PERSONAL_CONTEXT_SCHEMA_VERSION;
  eventId: string;
  principalId: string;
  seq: number;
  at: number;
} & (
  | { kind: "checkpoint"; state: PersonalContextState }
  | { kind: "settings"; settings: PersonalAssistantSettings }
  | { kind: "device_profile_put"; profile: PersonalDeviceProfile }
  | { kind: "vehicle_profile_put"; profile: PersonalVehicleProfile }
  | { kind: "vehicle_profile_delete"; profileId: string }
  | { kind: "consent_put"; consent: PersonalConsent }
  | { kind: "consent_revoke"; consentId: string }
  | { kind: "favorite_put"; favorite: FavoritePlace }
  | { kind: "favorite_delete"; favoriteId: string }
  | { kind: "preference_put"; preference: PersonalPreference }
  | { kind: "preferences_used"; preferenceIds: string[]; usedAt: number }
  | { kind: "preference_delete"; preferenceId: string }
  | { kind: "observation_put"; observation: ContextObservation }
  | { kind: "observation_delete"; observationId: string }
  | { kind: "action_put"; action: PersonalActionPlan }
  | { kind: "source_put"; source: PersonalSourceConnection }
  | { kind: "source_delete"; sourceId: string }
  | { kind: "source_status"; status: ContextSourceStatus }
  | { kind: "notification"; notification: PersonalNotificationRecord }
);

export interface PersonalContextStoreOptions {
  root?: string;
  now?: () => number;
  snapshotEvery?: number;
}

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
function secureDirectory(path: string): void {
  try { mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }); chmodSync(path, PRIVATE_DIRECTORY_MODE); } catch { /* best effort on platforms without POSIX modes */ }
}
function secureFile(path: string): void {
  try { if (existsSync(path)) chmodSync(path, PRIVATE_FILE_MODE); } catch { /* best effort on platforms without POSIX modes */ }
}

function clone<T>(value: T): T { return structuredClone(value); }
function principalKey(principalId: string): string { return createHash("sha256").update(principalId).digest("hex"); }
function requirePrincipal(principalId: string): void {
  if (!principalId || principalId.length > 512 || /[\u0000-\u001f]/.test(principalId)) throw new Error("invalid principal id");
}
function replaceById<T extends { id: string }>(rows: T[], value: T): void {
  const index = rows.findIndex((row) => row.id === value.id);
  if (index >= 0) rows[index] = value; else rows.push(value);
}

const ACTION_TRANSITIONS: Record<PersonalActionPlan["state"], PersonalActionPlan["state"][]> = {
  pending: ["pending", "approved", "running", "cancelled", "expired"],
  approved: ["approved", "running", "cancelled", "expired"],
  running: ["running", "succeeded", "failed", "cancelled", "uncertain"],
  succeeded: ["succeeded"], failed: ["failed"], cancelled: ["cancelled"], expired: ["expired"], uncertain: ["uncertain"],
};

function sanitizeObservation(state: PersonalContextState, observation: ContextObservation): ContextObservation {
  const row = clone(observation);
  if (row.kind !== "device_location" && row.sourceId !== "device-location") return row;
  const preciseAllowed = state.settings.retention.keepRawLocation && state.settings.locationPrecision === "precise";
  const precision = preciseAllowed ? "precise" : "approximate";
  const value = row.value as Record<string, unknown>;
  if (typeof value.lat === "number" && typeof value.lng === "number") Object.assign(value, normalizeGeoPoint({ lat: value.lat, lng: value.lng, accuracyM: typeof value.accuracyM === "number" ? value.accuracyM : undefined }, precision));
  const point = value.point as Record<string, unknown> | undefined;
  if (point && typeof point.lat === "number" && typeof point.lng === "number") value.point = normalizeGeoPoint({ lat: point.lat, lng: point.lng, accuracyM: typeof point.accuracyM === "number" ? point.accuracyM : undefined }, precision);
  return row;
}

function applyEvent(state: PersonalContextState, event: PersonalEvent): PersonalContextState {
  if (event.principalId !== state.principalId || event.seq !== state.revision + 1) throw new Error("invalid personal context event sequence");
  if (event.kind === "checkpoint") {
    if (event.state.principalId !== event.principalId) throw new Error("checkpoint principal mismatch");
    state = { ...clone(event.state), sources: clone(event.state.sources || []), deviceProfiles: clone(event.state.deviceProfiles || []), vehicleProfiles: clone(event.state.vehicleProfiles || []) };
  } else if (event.kind === "settings") state.settings = clone(event.settings);
  else if (event.kind === "device_profile_put") {
    const index = state.deviceProfiles.findIndex((row) => row.deviceId === event.profile.deviceId);
    if (index >= 0) state.deviceProfiles[index] = clone(event.profile); else state.deviceProfiles.push(clone(event.profile));
  }
  else if (event.kind === "vehicle_profile_put") {
    if (event.profile.isDefault) state.vehicleProfiles.forEach((row) => { row.isDefault = false; });
    replaceById(state.vehicleProfiles, clone(event.profile));
    if (!state.vehicleProfiles.some((row) => row.isDefault)) state.vehicleProfiles[0]!.isDefault = true;
  }
  else if (event.kind === "vehicle_profile_delete") {
    state.vehicleProfiles = state.vehicleProfiles.filter((row) => row.id !== event.profileId);
    if (state.vehicleProfiles.length && !state.vehicleProfiles.some((row) => row.isDefault)) state.vehicleProfiles[0]!.isDefault = true;
  }
  else if (event.kind === "consent_put") replaceById(state.consents, clone(event.consent));
  else if (event.kind === "consent_revoke") {
    const row = state.consents.find((item) => item.id === event.consentId);
    if (row) {
      if (!row.revokedAt) row.revokedAt = event.at;
      state.observations = state.observations.filter((item) => item.sourceId !== row.sourceId);
      state.preferences = state.preferences.filter((item) => item.kind === "explicit" || !item.evidence.some((evidence) => evidence.sourceId === row.sourceId));
      state.notifications = state.notifications.filter((item) => item.reason !== `source:${row.sourceId}`);
    }
  } else if (event.kind === "favorite_put") replaceById(state.favorites, clone(event.favorite));
  else if (event.kind === "favorite_delete") {
    state.favorites = state.favorites.filter((row) => row.id !== event.favoriteId);
    state.observations = state.observations.filter((row) => row.kind !== "geofence_transition" || row.value.favoriteId !== event.favoriteId);
    state.preferences = state.preferences.filter((row) => row.kind === "explicit" || !row.evidence.some((evidence) => evidence.id.startsWith(`favorite:${event.favoriteId}:`)));
  }
  else if (event.kind === "preference_put") replaceById(state.preferences, clone(event.preference));
  else if (event.kind === "preferences_used") {
    const selected = new Set(event.preferenceIds);
    for (const preference of state.preferences) {
      if (selected.has(preference.id)) preference.lastUsedAt = Math.max(preference.lastUsedAt || 0, event.usedAt);
    }
  }
  else if (event.kind === "preference_delete") state.preferences = state.preferences.filter((row) => row.id !== event.preferenceId);
  else if (event.kind === "observation_put") replaceById(state.observations, clone(event.observation));
  else if (event.kind === "observation_delete") state.observations = state.observations.filter((row) => row.id !== event.observationId);
  else if (event.kind === "action_put") {
    const existing = state.actions.find((row) => row.id === event.action.id);
    const sameKey = state.actions.find((row) => row.idempotencyKey === event.action.idempotencyKey && row.kind === event.action.kind && row.id !== event.action.id);
    if (sameKey) throw new Error("duplicate personal action idempotency key");
    if (existing) {
      if (existing.principalId !== event.action.principalId || existing.kind !== event.action.kind || existing.risk !== event.action.risk
        || existing.idempotencyKey !== event.action.idempotencyKey || existing.executorFingerprint !== event.action.executorFingerprint
        || existing.sourceId !== event.action.sourceId || existing.authorizationConsentId !== event.action.authorizationConsentId
        || existing.authorizationPurpose !== event.action.authorizationPurpose || existing.authorizationDeviceId !== event.action.authorizationDeviceId
        || JSON.stringify(existing.payload) !== JSON.stringify(event.action.payload)) throw new Error("personal action immutable fields changed");
      if (!ACTION_TRANSITIONS[existing.state].includes(event.action.state)) throw new Error(`invalid personal action transition: ${existing.state} -> ${event.action.state}`);
    }
    replaceById(state.actions, clone(event.action));
  }
  else if (event.kind === "source_put") replaceById(state.sources, clone(event.source));
  else if (event.kind === "source_delete") {
    state.sources = state.sources.filter((row) => row.id !== event.sourceId);
    state.settings.pausedSourceIds = state.settings.pausedSourceIds?.filter((sourceId) => sourceId !== event.sourceId) || [];
    state.sourceStatuses = state.sourceStatuses.filter((row) => row.descriptor.id !== event.sourceId);
    state.observations = state.observations.filter((row) => row.sourceId !== event.sourceId);
    state.preferences = state.preferences.filter((row) => row.kind === "explicit" || !row.evidence.some((evidence) => evidence.sourceId === event.sourceId));
  }
  else if (event.kind === "source_status") {
    const index = state.sourceStatuses.findIndex((row) => row.descriptor.id === event.status.descriptor.id);
    if (index >= 0) state.sourceStatuses[index] = clone(event.status); else state.sourceStatuses.push(clone(event.status));
  } else if (event.kind === "notification") replaceById(state.notifications, clone(event.notification));
  state.revision = event.seq;
  state.updatedAt = event.at;
  return state;
}

function validStoredState(value: unknown, principalId: string): value is PersonalContextState {
  const row = value as Partial<PersonalContextState> | null;
  return !!row && row.schemaVersion === PERSONAL_CONTEXT_SCHEMA_VERSION && row.principalId === principalId
    && Number.isSafeInteger(row.revision) && Array.isArray(row.consents) && Array.isArray(row.favorites)
    && (row.deviceProfiles === undefined || Array.isArray(row.deviceProfiles))
    && (row.vehicleProfiles === undefined || Array.isArray(row.vehicleProfiles))
    && Array.isArray(row.preferences) && Array.isArray(row.observations) && Array.isArray(row.actions)
    && (row.sources === undefined || Array.isArray(row.sources)) && Array.isArray(row.sourceStatuses) && Array.isArray(row.notifications) && !!row.settings;
}

export class PersonalContextStore {
  private readonly root: string;
  private readonly now: () => number;
  private readonly snapshotEvery: number;
  private readonly states = new Map<string, PersonalContextState>();
  private readonly generations = new Map<string, number>();

  constructor(options: PersonalContextStoreOptions = {}) {
    this.root = options.root || join(process.env.JARVIS_HOME || homedir(), ".jarvis", "personal");
    this.now = options.now || Date.now;
    this.snapshotEvery = Math.max(1, options.snapshotEvery || 20);
    secureDirectory(this.root);
  }

  private dir(principalId: string): string { return join(this.root, principalKey(principalId)); }
  private snapshotPath(principalId: string): string { return join(this.dir(principalId), "snapshot.json"); }
  private journalPath(principalId: string): string { return join(this.dir(principalId), "journal.jsonl"); }
  private tombstonePath(principalId: string): string { return join(this.root, `.erased-${principalKey(principalId)}.json`); }

  private load(principalId: string): PersonalContextState {
    requirePrincipal(principalId);
    secureDirectory(this.root);
    if (existsSync(this.dir(principalId))) {
      secureDirectory(this.dir(principalId));
      for (const path of [this.snapshotPath(principalId), `${this.snapshotPath(principalId)}.bak`, this.journalPath(principalId), `${this.journalPath(principalId)}.bak`]) secureFile(path);
    }
    secureFile(this.tombstonePath(principalId));
    if (existsSync(this.tombstonePath(principalId))) {
      this.states.delete(principalId);
      try { rmSync(this.dir(principalId), { recursive: true, force: true }); } catch { /* tombstone remains authoritative */ }
      const erased = emptyPersonalContextState(principalId, this.now());
      this.states.set(principalId, erased);
      return erased;
    }
    const cached = this.states.get(principalId);
    if (cached) return cached;
    const fallback = emptyPersonalContextState(principalId, this.now());
    const raw = readJson<unknown>(this.snapshotPath(principalId), undefined);
    let state = validStoredState(raw, principalId) ? { ...clone(raw), settings: { ...clone(raw.settings), pausedSourceIds: clone(raw.settings.pausedSourceIds || []) }, sources: clone(raw.sources || []), deviceProfiles: clone(raw.deviceProfiles || []), vehicleProfiles: clone(raw.vehicleProfiles || []) } : fallback;
    try {
      const lines = readFileSync(this.journalPath(principalId), "utf8").split(/\r?\n/);
      const firstLine = lines.find((line) => line.trim());
      if (firstLine) {
        try {
          const first = JSON.parse(firstLine) as PersonalEvent;
          // A checkpoint starts a new compacted generation. It is authoritative even when a crash
          // left a higher-revision snapshot from the previous generation on disk.
          if (first.kind === "checkpoint" && first.seq === 1 && first.principalId === principalId) state = fallback;
        } catch { /* incomplete first line is handled by replay below */ }
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: PersonalEvent;
        try { event = JSON.parse(line) as PersonalEvent; } catch { break; }
        if (event.schemaVersion !== PERSONAL_CONTEXT_SCHEMA_VERSION || event.principalId !== principalId) continue;
        if (event.seq <= state.revision) continue;
        if (event.seq !== state.revision + 1) break;
        try { state = applyEvent(state, event); } catch { break; }
      }
    } catch { /* first use */ }
    this.states.set(principalId, state);
    return state;
  }

  get(principalId: string): PersonalContextState { return clone(this.load(principalId)); }

  generation(principalId: string): number {
    requirePrincipal(principalId);
    let generation = this.generations.get(principalId);
    if (generation === undefined) {
      generation = existsSync(this.tombstonePath(principalId)) ? 1 : 0;
      this.generations.set(principalId, generation);
    }
    return generation;
  }

  isGenerationCurrent(principalId: string, generation: number): boolean {
    return Number.isSafeInteger(generation) && generation >= 0 && this.generation(principalId) === generation;
  }

  private append(
    principalId: string,
    payload: Omit<PersonalEvent, "schemaVersion" | "eventId" | "principalId" | "seq" | "at">,
    options: { expectedGeneration?: number; allowRevive?: boolean } = {},
  ): PersonalContextState {
    if (options.expectedGeneration !== undefined && !this.isGenerationCurrent(principalId, options.expectedGeneration)) {
      throw new Error("personal context generation changed");
    }
    const current = this.load(principalId);
    const tombstone = this.tombstonePath(principalId);
    if (existsSync(tombstone)) {
      if (!options.allowRevive) throw new Error("personal context was erased and must be explicitly enabled before new data is stored");
      // Delete any interrupted old generation before allowing a fresh post-erasure generation.
      rmSync(this.dir(principalId), { recursive: true, force: true });
      rmSync(tombstone, { force: true });
    }
    const event = {
      schemaVersion: PERSONAL_CONTEXT_SCHEMA_VERSION,
      eventId: randomUUID(),
      principalId,
      seq: current.revision + 1,
      at: this.now(),
      ...payload,
    } as PersonalEvent;
    const candidate = applyEvent(clone(current), event);
    secureDirectory(this.dir(principalId));
    const fd = openSync(this.journalPath(principalId), "a", PRIVATE_FILE_MODE);
    try { appendFileSync(fd, JSON.stringify(event) + "\n", "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
    secureFile(this.journalPath(principalId));
    this.states.set(principalId, candidate);
    if (candidate.revision % this.snapshotEvery === 0) {
      writeJsonAtomic(this.snapshotPath(principalId), candidate, { pretty: true });
      secureFile(this.snapshotPath(principalId)); secureFile(`${this.snapshotPath(principalId)}.bak`);
    }
    return clone(candidate);
  }

  updateSettings(principalId: string, patch: Partial<Omit<PersonalAssistantSettings, "schemaVersion" | "principalId" | "updatedAt">>): PersonalContextState {
    const current = this.load(principalId).settings;
    const at = this.now();
    const settings: PersonalAssistantSettings = {
      ...clone(current), ...clone(patch),
      pausedSourceIds: [...new Set((patch.pausedSourceIds || current.pausedSourceIds || []).map(String))].slice(0, 100),
      retention: { ...current.retention, ...(patch.retention || {}) },
      notifications: { ...current.notifications, ...(patch.notifications || {}) },
      schemaVersion: PERSONAL_CONTEXT_SCHEMA_VERSION, principalId, updatedAt: at,
    };
    return this.append(principalId, { kind: "settings", settings } as Omit<PersonalEvent, "schemaVersion" | "eventId" | "principalId" | "seq" | "at">, { allowRevive: true });
  }

  putDeviceProfile(principalId: string, profile: PersonalDeviceProfile): PersonalContextState {
    if (!profile.deviceId || profile.deviceId.length > 512 || /[\u0000-\u001f\u007f]/.test(profile.deviceId)) throw new Error("invalid device id");
    return this.append(principalId, { kind: "device_profile_put", profile: clone(profile) } as never);
  }

  putVehicleProfile(principalId: string, profile: PersonalVehicleProfile): PersonalContextState {
    if (profile.principalId !== principalId) throw new Error("vehicle profile principal mismatch");
    return this.append(principalId, { kind: "vehicle_profile_put", profile: clone(profile) } as never);
  }

  deleteVehicleProfile(principalId: string, profileId: string): PersonalContextState {
    return this.compact(principalId, this.append(principalId, { kind: "vehicle_profile_delete", profileId } as never));
  }

  putConsent(principalId: string, consent: PersonalConsent): PersonalContextState {
    if (consent.principalId !== principalId) throw new Error("consent principal mismatch");
    return this.append(principalId, { kind: "consent_put", consent: clone(consent) } as never);
  }
  revokeConsent(principalId: string, consentId: string): PersonalContextState {
    return this.compact(principalId, this.append(principalId, { kind: "consent_revoke", consentId } as never));
  }
  putFavorite(principalId: string, favorite: FavoritePlace): PersonalContextState {
    if (favorite.principalId !== principalId) throw new Error("favorite principal mismatch");
    return this.append(principalId, { kind: "favorite_put", favorite: clone(favorite) } as never);
  }
  deleteFavorite(principalId: string, favoriteId: string): PersonalContextState {
    return this.compact(principalId, this.append(principalId, { kind: "favorite_delete", favoriteId } as never));
  }
  putPreference(principalId: string, preference: PersonalPreference): PersonalContextState {
    if (preference.principalId !== principalId) throw new Error("preference principal mismatch");
    return this.append(principalId, { kind: "preference_put", preference: clone(preference) } as never);
  }
  markPreferencesUsed(principalId: string, preferenceIds: readonly string[], usedAt = this.now()): PersonalContextState {
    const ids = [...new Set(preferenceIds)].filter((id) => typeof id === "string" && id.length > 0 && id.length <= 200).slice(0, 100);
    if (!ids.length || !Number.isSafeInteger(usedAt) || usedAt < 0) return this.get(principalId);
    const state = this.load(principalId), selected = new Set(ids);
    const changed = state.preferences.some((preference) => selected.has(preference.id) && (preference.lastUsedAt || 0) < usedAt);
    if (!changed) return clone(state);
    return this.append(principalId, { kind: "preferences_used", preferenceIds: ids, usedAt } as never);
  }
  deletePreference(principalId: string, preferenceId: string): PersonalContextState {
    return this.compact(principalId, this.append(principalId, { kind: "preference_delete", preferenceId } as never));
  }
  putObservation(principalId: string, observation: ContextObservation): PersonalContextState {
    if (observation.principalId !== principalId) throw new Error("observation principal mismatch");
    return this.append(principalId, { kind: "observation_put", observation: sanitizeObservation(this.load(principalId), observation) } as never);
  }
  deleteObservation(principalId: string, observationId: string): PersonalContextState {
    const state = this.load(principalId);
    if (!state.observations.some((row) => row.id === observationId)) return clone(state);
    return this.compact(principalId, this.append(principalId, { kind: "observation_delete", observationId } as never));
  }
  putAction(principalId: string, action: PersonalActionPlan): PersonalContextState {
    if (action.principalId !== principalId) throw new Error("action principal mismatch");
    return this.append(principalId, { kind: "action_put", action: clone(action) } as never);
  }
  putSource(principalId: string, source: PersonalSourceConnection): PersonalContextState {
    if (source.principalId !== principalId) throw new Error("source principal mismatch");
    return this.append(principalId, { kind: "source_put", source: clone(source) } as never);
  }
  deleteSource(principalId: string, sourceId: string): PersonalContextState {
    return this.compact(principalId, this.append(principalId, { kind: "source_delete", sourceId } as never));
  }
  putSourceStatus(principalId: string, status: ContextSourceStatus): PersonalContextState {
    return this.append(principalId, { kind: "source_status", status: clone(status) } as never);
  }
  recordNotification(principalId: string, notification: PersonalNotificationRecord, expectedGeneration?: number): PersonalContextState {
    if (notification.principalId !== principalId) throw new Error("notification principal mismatch");
    return this.append(principalId, { kind: "notification", notification: clone(notification) } as never, { expectedGeneration });
  }

  eraseCategory(principalId: string, category: PersonalDataCategory): PersonalContextState {
    const state = clone(this.load(principalId));
    if (category === "observations") {
      state.observations = [];
      state.preferences = state.preferences.filter((row) => row.kind === "explicit");
    }
    else if (category === "preferences") state.preferences = [];
    else if (category === "favorites") {
      state.favorites = [];
      state.observations = state.observations.filter((row) => row.kind !== "geofence_transition");
    } else if (category === "vehicle_profiles") state.vehicleProfiles = [];
    else if (category === "actions") state.actions = [];
    else if (category === "notifications") state.notifications = [];
    else if (category === "sources") {
      const sourceIds = new Set(state.sources.map((row) => row.id));
      state.sources = [];
      state.sourceStatuses = [];
      state.observations = state.observations.filter((row) => ["device-location", "device-calendar"].includes(row.sourceId));
      state.preferences = state.preferences.filter((row) => row.kind === "explicit" || !row.evidence.some((evidence) => evidence.sourceId && (sourceIds.has(evidence.sourceId) || !["device-location", "device-calendar"].includes(evidence.sourceId))));
    } else if (category === "consents") {
      state.consents = [];
      state.observations = [];
      state.preferences = state.preferences.filter((row) => row.kind === "explicit");
    } else if (category === "device_profiles") {
      const deviceIds = new Set(state.deviceProfiles.map((row) => row.deviceId));
      state.deviceProfiles = [];
      state.consents = state.consents.filter((row) => !row.deviceId || !deviceIds.has(row.deviceId));
      state.observations = state.observations.filter((row) => typeof row.value.deviceId !== "string" || !deviceIds.has(row.value.deviceId));
      state.notifications = state.notifications.filter((row) => !row.deviceId || !deviceIds.has(row.deviceId));
    }
    else throw new Error("unsupported personal data category");
    return this.compact(principalId, state);
  }

  prune(principalId: string, now = this.now()): PersonalContextState {
    const state = this.load(principalId);
    const observationCutoff = now - state.settings.retention.observationsDays * 86_400_000;
    const decisionCutoff = now - state.settings.retention.decisionsDays * 86_400_000;
    const inferredCutoff = now - state.settings.retention.inferredPreferencesDays * 86_400_000;
    const next = clone(state);
    next.observations = next.observations.filter((row) => row.expiresAt > now && row.observedAt >= observationCutoff);
    next.actions = next.actions.filter((row) => row.createdAt >= decisionCutoff || row.state === "pending" || row.state === "running");
    next.notifications = next.notifications.filter((row) => row.at >= decisionCutoff);
    next.preferences = next.preferences.filter((row) => row.kind === "explicit" || ((!row.expiresAt || row.expiresAt > now) && row.updatedAt >= inferredCutoff));
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    return changed ? this.compact(principalId, next) : clone(state);
  }

  private compact(principalId: string, input?: PersonalContextState): PersonalContextState {
    const state = clone(input || this.load(principalId));
    state.revision = 1;
    const at = this.now();
    state.updatedAt = at;
    state.settings.updatedAt = Math.min(state.settings.updatedAt, at);
    const event: PersonalEvent = { schemaVersion: PERSONAL_CONTEXT_SCHEMA_VERSION, eventId: randomUUID(), principalId, seq: 1, at, kind: "checkpoint", state: clone(state) };
    writeTextAtomic(this.journalPath(principalId), JSON.stringify(event) + "\n", { backup: false });
    secureDirectory(this.dir(principalId)); secureFile(this.journalPath(principalId));
    for (const suffix of [".bak", ".tmp"]) try { rmSync(this.journalPath(principalId) + suffix, { force: true }); } catch { /* best effort */ }
    writeJsonAtomic(this.snapshotPath(principalId), state, { pretty: true, backup: false });
    secureFile(this.snapshotPath(principalId));
    for (const suffix of [".bak", ".tmp"]) try { rmSync(this.snapshotPath(principalId) + suffix, { force: true }); } catch { /* best effort */ }
    this.states.set(principalId, state);
    return clone(state);
  }

  export(principalId: string): PersonalContextExport {
    const state = this.load(principalId);
    return {
      schemaVersion: PERSONAL_CONTEXT_SCHEMA_VERSION,
      exportedAt: this.now(),
      settings: clone(state.settings), consents: clone(state.consents), favorites: clone(state.favorites),
      deviceProfiles: clone(state.deviceProfiles),
      vehicleProfiles: clone(state.vehicleProfiles),
      preferences: clone(state.preferences), observations: clone(state.observations),
      sources: state.sources.map((source) => toPersonalSourceView(clone(source))),
      sourceStatuses: clone(state.sourceStatuses),
      notifications: clone(state.notifications),
      actions: state.actions.map(({ payload: _payload, confirmationChallenge: _challenge, ...action }) => clone(action)),
    };
  }

  erase(principalId: string): boolean {
    requirePrincipal(principalId);
    secureDirectory(this.root);
    const dir = this.dir(principalId), existed = existsSync(dir);
    const nextGeneration = this.generation(principalId) + 1;
    writeJsonAtomic(this.tombstonePath(principalId), { schemaVersion: PERSONAL_CONTEXT_SCHEMA_VERSION, erasedAt: this.now() }, { pretty: false, backup: false });
    secureFile(this.tombstonePath(principalId));
    this.generations.set(principalId, nextGeneration);
    this.states.delete(principalId);
    rmSync(dir, { recursive: true, force: true });
    return existed;
  }

  principalCount(): number {
    try { return readdirSync(this.root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length; }
    catch { return 0; }
  }
}
