# Jarvis Context Capacitor plugin

Local Capacitor 8 bridge for foreground location, minimized calendar availability, geofences, and
a durable transition lease/ACK queue. Capacitor discovers `JarvisContextPlugin` from the package metadata on
Android and iOS; no Activity or bridge-controller registration is allowed.

## Privacy and storage invariants

- Foreground location is one-shot and is never persisted by the plugin.
- Calendar output contains merged busy intervals only. Titles, identifiers, participants, notes,
  URLs, and event locations never cross the bridge.
- Transition records contain only a geofence id, enter/exit, timestamps, delivery metadata, and a
  deterministic `ctx-...` identity. Raw coordinates are never queued. Legacy transition IDs are
  canonicalized and deduplicated during migration so replay cannot bypass the seen ledger.
- Android stores geofence coordinates and transitions in an atomic file under `noBackupFilesDir`.
  WorkManager overflow jobs use only a one-way scope fingerprint, never raw principal/device ids.
  The transformer also excludes the legacy `jarvis_context.xml` preferences from both pre-Android
  12 backup and Android 12+ cloud/device transfer rules.
- iOS stores the state under Application Support with
  `completeUntilFirstUserAuthentication` protection and excludes the directory from backup. It
  commits through a protected, excluded temporary file and atomic same-directory replacement, then
  migrates and clears the former `UserDefaults` keys once. `PrivacyInfo.xcprivacy` declares the
  approved `CA92.1` reason for that migration and is packaged by SwiftPM and CocoaPods.

## Authorization scope and erasure

Security-sensitive calls use this scope:

```ts
interface JarvisContextScope {
  principalId: string;
  deviceId: string;
  generation: number;
}
```

`generation` is a non-negative JavaScript safe integer owned by the Hub/UI. Keep it stable for one
authorization grant and increase it before a later re-grant. It is an opaque epoch, not a secret;
never use or hash an auth token into it. `configureGeofences` and `removeGeofences` accept an optional
`scope` only to support migration from older shells. New callers must always send it. A scoped state
cannot be read or mutated through a different or omitted scope (`CONTEXT_SCOPE_MISMATCH`); omission
continues to work only while the persisted state is still unscoped. Adopting the first scope drops
ambiguous unscoped transitions, leases, replay markers, and ACKs rather than attributing legacy data
to the authenticated principal. Native platform registration IDs also include the scope and an
internal configuration generation, so a delayed callback from an earlier grant/configuration is
ignored.

Revocation calls the permission-independent operation below with the scope being revoked:

```ts
await JarvisContext.eraseAll({
  scope: { principalId: "user-1", deviceId: "phone-1", generation: 12 },
});
// {
//   scope: { principalId: "user-1", deviceId: "phone-1", generation: 12 },
//   erased: true,
//   hadLocalState: true,
//   platformCleanup: "confirmed" | "requested" | "unavailable"
// }
```

The native side deletes local state first, including geofences, transitions, leases, and the ACK
ledger. Android then cancels transition/rearm WorkManager jobs and removes Play Services geofences;
iOS cancels an in-flight Jarvis region replacement, removes the protected Application Support
directory, and asks CoreLocation to stop every Jarvis region and significant-change monitor. None of
those steps checks current location permission. Repeating the call is safe. Readable state bound to a
different scope is not erased, which protects a new login from a delayed revoke; corrupt state is
still deleted because privacy erasure must remain available. If filesystem deletion cannot be
confirmed, native monitoring is still stopped and an empty scoped anti-rearm tombstone is attempted,
then the call rejects with `CONTEXT_ERASE_FAILED` instead of reporting success.

## Durable transition delivery

`leaseTransitions` is a durable non-destructive peek. The same `requestId` returns the same active
lease until expiry. An expired event becomes available for another request, retains its stable
`ctx-...` id, and increments `deliveryAttempt`.

```ts
const batch = await JarvisContext.leaseTransitions({
  scope: { principalId: "user-1", deviceId: "phone-1", generation: 12 },
  requestId: "upload-018f...", // unique within this scope
  limit: 100,                 // 1..500, default 100
  leaseDurationMs: 60_000,    // 5s..15min, default 60s
});
// {
//   scope,
//   leaseId?: "lease-...", leasedAt?: 1720000000000, expiresAt?: 1720000060000,
//   transitions: [{
//     id: "ctx-...", geofenceId: "home", transition: "enter",
//     occurredAt: 1720000000000, recordedAt: 1720000000100,
//     source: "android" | "ios", deliveryAttempt: 1
//   }],
//   pending: 1, available: 0, nextLeaseExpiryAt?: 1720000060000
// }
```

Only ACK transition IDs after the Hub has durably accepted them. Partial ACK is supported. Repeating
the same ACK returns the IDs in both `acknowledgedIds` and `alreadyAcknowledgedIds`; an unknown ID or
an ID re-leased under another lease appears in `rejectedIds` and is not removed.

```ts
await JarvisContext.ackTransitions({
  scope: batch.scope,
  leaseId: batch.leaseId!,
  transitionIds: batch.transitions.map((event) => event.id),
});
// { scope, leaseId, acknowledgedIds, alreadyAcknowledgedIds, rejectedIds,
//   pending, available, nextLeaseExpiryAt? }
```

The Hub must use `(scope.principalId, scope.deviceId, scope.generation, transition.id)` as its
idempotency key because a successful upload whose ACK is lost will be delivered again after lease
expiry. Native queues never evict an unacknowledged event: Android durably retries overflow callbacks
through WorkManager, while iOS retains every accepted CoreLocation callback in protected storage.
`drainTransitions` remains as a compatibility alias, but it now leases without deleting and returns
lease metadata plus the legacy `remaining` field. It cannot complete delivery without a later scoped
ACK and must not be used by new code.

## Geofence behavior

- `configureGeofences({ geofences: [] })` and `removeGeofences` erase local state even when Google
  Play Services or location permission is unavailable. Android then reconciles platform state by
  best effort and ignores callbacks for locally removed ids.
- Android configure/remove/erase/rearm operations share one serialized coordinator and a persisted
  generation. `GEOFENCE_NOT_AVAILABLE`, reboot, and package replacement enqueue the same rearm
  worker, so an older snapshot cannot be registered after a newer configuration or revoke.
- Android 11+ opens the app's system settings for the explicit background-location upgrade. The
  caller must re-check permissions when the app resumes.
- iOS `monitorSignificantChanges` is explicit and defaults to `false`. Continuous background mode
  is not added unless the transformer receives `--ios-background-mode`.
- iOS replacement resolves only after every `didStartMonitoring` callback. A failure or 30-second
  timeout starts a confirmed rollback to the prior set; rollback failure returns
  `GEOFENCE_ROLLBACK_FAILED` and stops Jarvis-managed monitoring before reconciliation.

CoreLocation limits each app to 20 monitored regions, shared by all `CLLocationManager` instances
and frameworks inside that app, and exposes no transaction primitive. The plugin therefore provides
atomic **persisted state and confirmed rollback**, but there can be a short monitoring gap while the
old regions are stopped and the new set is confirmed. Non-Jarvis regions in the host app consume the
same per-app budget.

## Generated-project transform

Run after `cap sync`:

```sh
node mobile/apply-context-native.mjs android
node mobile/apply-context-native.mjs ios
node mobile/apply-context-native.mjs generated
node mobile/apply-context-native.mjs all
```

`generated` transforms every platform tree that exists; `all` requires both and stages no write if
either preflight fails. Add `--ios-background-mode` only for a reviewed use case that genuinely
requires the iOS location background mode.

Android variants are intentional:

- `store`: removes `ACCESS_BACKGROUND_LOCATION`, boot permission, and boot rearm.
- `sideload`: adds background location and boot/package-replacement rearm.

The transformer parses manifest elements and attributes independently of quote style or self-closing
versus paired tags, extends existing backup resources, removes old manual plugin links, and verifies
that Capacitor generated exactly one native plugin link.

## Validation

```sh
node --test mobile/apply-context-native.test.mjs
cd mobile/android
./gradlew :jarvis-context:testDebugUnitTest :jarvis-context:lintDebug
./gradlew :app:assembleStoreDebug :app:assembleSideloadDebug
```

iOS source tests live in `ios/Tests/JarvisContextTests` and must run with Xcode/macOS. Validate both
SwiftPM and CocoaPods archives. The Apple build dispatcher lints `PrivacyInfo.xcprivacy`, reruns
`pod install` after the transform when needed, and rejects an archive that does not contain the
JarvisContext privacy manifest.
