import type { PluginListenerHandle } from "@capacitor/core";

export type JarvisContextPlatform = "android" | "ios" | "web";
export type JarvisPermissionState =
  | "prompt"
  | "prompt-with-rationale"
  | "granted"
  | "denied"
  | "limited"
  | "unavailable";
export type JarvisLocationAccuracy = "precise" | "approximate" | "unknown";
export type JarvisGeofenceTransition = "enter" | "exit";
export type JarvisPlatformCleanup = "confirmed" | "requested" | "unavailable";

/**
 * Identifies one native-context authorization epoch.
 *
 * `generation` is a caller-owned, monotonically increasing safe integer. Keep it stable while a
 * grant is active and advance it before re-enabling context after revoke. It is an identifier, not
 * a credential, and must never contain or derive from an auth token.
 */
export interface JarvisContextScope {
  principalId: string;
  deviceId: string;
  generation: number;
}

export interface JarvisContextCapabilities {
  available: boolean;
  platform: JarvisContextPlatform;
  foregroundLocation: boolean;
  busyIntervals: boolean;
  geofences: boolean;
  backgroundLocation: boolean;
  significantLocationChanges: boolean;
  maxGeofences: number;
}

export interface JarvisContextPermissionStatus {
  location: JarvisPermissionState;
  locationAccuracy: JarvisLocationAccuracy;
  calendar: JarvisPermissionState;
  backgroundLocation: JarvisPermissionState;
  capabilities: JarvisContextCapabilities;
  /** Android 11+: true when the explicit request opened system app settings. */
  settingsOpened?: boolean;
  settingsReason?: "backgroundLocation";
}

export interface RequestContextPermissionsOptions {
  /** Requests foreground/when-in-use location only. */
  location?: boolean;
  /** Requests read access to calendars. */
  calendar?: boolean;
  /** Explicitly activates the platform background-location permission flow. */
  backgroundLocation?: boolean;
}

export interface ForegroundLocationOptions {
  precision?: "approximate" | "precise";
  maximumAgeMs?: number;
  timeoutMs?: number;
  ttlMs?: number;
}

export interface JarvisGeoPoint {
  lat: number;
  lng: number;
  accuracyM?: number;
}

/** Matches the device-location envelope accepted by the Hub protocol. */
export interface ForegroundLocationEnvelope {
  observedAt: number;
  expiresAt: number;
  point: JarvisGeoPoint;
  precision: JarvisLocationAccuracy;
  source: "android" | "ios";
}

export interface BusyIntervalsOptions {
  startAt: number;
  endAt: number;
  maxIntervals?: number;
  ttlMs?: number;
}

export interface BusyInterval {
  startAt: number;
  endAt: number;
  allDay: boolean;
}

export interface BusyIntervalsEnvelope {
  observedAt: number;
  expiresAt: number;
  rangeStartAt: number;
  rangeEndAt: number;
  timeZone: string;
  intervals: BusyInterval[];
  truncated: boolean;
  source: "android" | "ios";
}

export interface JarvisGeofence {
  id: string;
  point: JarvisGeoPoint;
  radiusM: number;
  transitions?: JarvisGeofenceTransition[];
}

export interface ConfigureGeofencesOptions {
  /** Replaces the complete set; iOS resolves only after CoreLocation confirms every region. */
  geofences: JarvisGeofence[];
  /** iOS only, explicit opt-in; defaults to false. Coordinates are never queued or returned. */
  monitorSignificantChanges?: boolean;
  /** Binds native state and callbacks to the active principal/device authorization epoch. */
  scope?: JarvisContextScope;
}

export interface RemoveGeofencesOptions {
  ids: string[];
  /** When supplied, mutation fails rather than touching state owned by another authorization epoch. */
  scope?: JarvisContextScope;
}

export interface ListGeofencesOptions {
  /** When supplied, reading fails rather than exposing state owned by another authorization epoch. */
  scope?: JarvisContextScope;
}

export interface GeofenceListResult {
  geofences: JarvisGeofence[];
  backgroundEnabled: boolean;
  monitorSignificantChanges: boolean;
  maxGeofences: number;
  /** Present after scoped state has been adopted. */
  scope?: JarvisContextScope;
  /** Native configuration epoch used to reject stale platform callbacks and rearm work. */
  configurationGeneration?: number;
}

export interface DrainTransitionsOptions {
  limit?: number;
  /** Optional retry key. Supplying the same key before expiry returns the same active lease. */
  requestId?: string;
  leaseDurationMs?: number;
}

/** A durable, traceable envelope with no raw coordinates. */
export interface GeofenceTransitionEnvelope {
  /** Stable within its enclosing authorization scope; Hub idempotency keys must include that scope. */
  id: string;
  geofenceId: string;
  transition: JarvisGeofenceTransition;
  occurredAt: number;
  recordedAt: number;
  source: "android" | "ios";
}

export interface LeasedGeofenceTransitionEnvelope extends GeofenceTransitionEnvelope {
  /** Increments whenever an expired event is leased again. */
  deliveryAttempt: number;
}

export interface DrainTransitionsResult {
  transitions: LeasedGeofenceTransitionEnvelope[];
  remaining: number;
  /** Legacy calls can be unscoped during migration. New code must use `leaseTransitions`. */
  scope?: JarvisContextScope;
  leaseId?: string;
  leasedAt?: number;
  expiresAt?: number;
  pending: number;
  available: number;
  nextLeaseExpiryAt?: number;
}

export interface LeaseTransitionsOptions {
  scope: JarvisContextScope;
  /** Idempotency key for one lease attempt, unique within the scope. */
  requestId: string;
  limit?: number;
  leaseDurationMs?: number;
}

/** A durable, non-destructive peek. Events remain stored until `ackTransitions` succeeds. */
export interface TransitionLeaseResult {
  scope: JarvisContextScope;
  leaseId?: string;
  leasedAt?: number;
  expiresAt?: number;
  transitions: LeasedGeofenceTransitionEnvelope[];
  /** Total unacknowledged events, including events held by other active leases. */
  pending: number;
  /** Events immediately eligible for another lease after this call. */
  available: number;
  nextLeaseExpiryAt?: number;
}

export interface AckTransitionsOptions {
  scope: JarvisContextScope;
  leaseId: string;
  /** ACK only IDs durably accepted by the Hub; partial ACK is supported. */
  transitionIds: string[];
}

export interface AckTransitionsResult {
  scope: JarvisContextScope;
  leaseId: string;
  /** Includes IDs acknowledged by this call and by an identical earlier retry. */
  acknowledgedIds: string[];
  alreadyAcknowledgedIds: string[];
  /** Unknown IDs or IDs currently owned by a different lease. */
  rejectedIds: string[];
  pending: number;
  available: number;
  nextLeaseExpiryAt?: number;
}

export interface EraseAllOptions {
  scope: JarvisContextScope;
}

export interface EraseAllResult {
  scope: JarvisContextScope;
  erased: true;
  hadLocalState: boolean;
  /** Android can confirm Play Services removal; CoreLocation removal is asynchronous on iOS. */
  platformCleanup: JarvisPlatformCleanup;
}

export interface TransitionAvailableEvent {
  pending: number;
  available?: number;
  nextLeaseExpiryAt?: number;
}

export interface JarvisContextPlugin {
  isSupported(): Promise<JarvisContextCapabilities>;
  checkPermissions(): Promise<JarvisContextPermissionStatus>;
  requestPermissions(options?: RequestContextPermissionsOptions): Promise<JarvisContextPermissionStatus>;
  getCurrentLocation(options?: ForegroundLocationOptions): Promise<ForegroundLocationEnvelope>;
  getBusyIntervals(options: BusyIntervalsOptions): Promise<BusyIntervalsEnvelope>;
  configureGeofences(options: ConfigureGeofencesOptions): Promise<GeofenceListResult>;
  removeGeofences(options: RemoveGeofencesOptions): Promise<GeofenceListResult>;
  listGeofences(options?: ListGeofencesOptions): Promise<GeofenceListResult>;
  leaseTransitions(options: LeaseTransitionsOptions): Promise<TransitionLeaseResult>;
  ackTransitions(options: AckTransitionsOptions): Promise<AckTransitionsResult>;
  eraseAll(options: EraseAllOptions): Promise<EraseAllResult>;
  /** @deprecated Non-destructive compatibility alias. Use `leaseTransitions` plus `ackTransitions`. */
  drainTransitions(options?: DrainTransitionsOptions): Promise<DrainTransitionsResult>;
  addListener(
    eventName: "transitionAvailable",
    listenerFunc: (event: TransitionAvailableEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
