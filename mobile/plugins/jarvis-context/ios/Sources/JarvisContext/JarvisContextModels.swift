import CryptoKit
import Foundation

let jarvisContextMaximumGeofences = 20
let jarvisContextMaximumSeenTransitions = 4000
let jarvisContextMaximumAcknowledgements = 4000
let jarvisContextMaximumSafeInteger: Int64 = 9_007_199_254_740_991
let jarvisContextRegionPrefix = "jarvis.context."

struct JarvisContextScope: Codable, Equatable {
    let principalId: String
    let deviceId: String
    let generation: Int64
}

func isValidJarvisContextIdentifier(_ value: String) -> Bool {
    !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.count <= 200 &&
        !value.unicodeScalars.contains { $0.value <= 31 || $0.value == 127 }
}

func isValidJarvisContextScope(_ scope: JarvisContextScope) -> Bool {
    isValidJarvisContextIdentifier(scope.principalId) &&
        isValidJarvisContextIdentifier(scope.deviceId) &&
        (0...jarvisContextMaximumSafeInteger).contains(scope.generation)
}

struct JarvisManagedGeofence: Codable, Equatable {
    let id: String
    let latitude: Double
    let longitude: Double
    let radiusM: Double
    let notifyOnEntry: Bool
    let notifyOnExit: Bool
}

struct JarvisTransitionEnvelope: Codable, Equatable {
    let id: String
    let geofenceId: String
    let transition: String
    let occurredAt: Int64
    let recordedAt: Int64
    var leaseId: String?
    var leaseRequestId: String?
    var leasedAt: Int64?
    var leaseExpiresAt: Int64?
    var deliveryAttempt: Int

    init(
        id: String,
        geofenceId: String,
        transition: String,
        occurredAt: Int64,
        recordedAt: Int64,
        leaseId: String? = nil,
        leaseRequestId: String? = nil,
        leasedAt: Int64? = nil,
        leaseExpiresAt: Int64? = nil,
        deliveryAttempt: Int = 0
    ) {
        self.id = id
        self.geofenceId = geofenceId
        self.transition = transition
        self.occurredAt = occurredAt
        self.recordedAt = recordedAt
        self.leaseId = leaseId
        self.leaseRequestId = leaseRequestId
        self.leasedAt = leasedAt
        self.leaseExpiresAt = leaseExpiresAt
        self.deliveryAttempt = max(0, deliveryAttempt)
    }

    private enum CodingKeys: String, CodingKey {
        case id, geofenceId, transition, occurredAt, recordedAt
        case leaseId, leaseRequestId, leasedAt, leaseExpiresAt, deliveryAttempt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        geofenceId = try values.decode(String.self, forKey: .geofenceId)
        transition = try values.decode(String.self, forKey: .transition)
        occurredAt = try values.decode(Int64.self, forKey: .occurredAt)
        recordedAt = try values.decode(Int64.self, forKey: .recordedAt)
        leaseId = try values.decodeIfPresent(String.self, forKey: .leaseId)
        leaseRequestId = try values.decodeIfPresent(String.self, forKey: .leaseRequestId)
        leasedAt = try values.decodeIfPresent(Int64.self, forKey: .leasedAt)
        leaseExpiresAt = try values.decodeIfPresent(Int64.self, forKey: .leaseExpiresAt)
        deliveryAttempt = max(0, try values.decodeIfPresent(Int.self, forKey: .deliveryAttempt) ?? 0)
    }
}

struct JarvisTransitionAcknowledgement: Codable, Equatable {
    let leaseId: String
    let transitionId: String
    let acknowledgedAt: Int64
}

struct JarvisGeofenceSnapshot: Equatable {
    let generation: Int64
    let scope: JarvisContextScope?
    let geofences: [JarvisManagedGeofence]
    let significantChanges: Bool
}

struct JarvisGeofenceReplacement {
    let previous: JarvisGeofenceSnapshot
    let desired: JarvisGeofenceSnapshot
}

struct JarvisTransitionLeaseResult {
    let scope: JarvisContextScope?
    let leaseId: String?
    let leasedAt: Int64?
    let expiresAt: Int64?
    let transitions: [JarvisTransitionEnvelope]
    let pending: Int
    let available: Int
    let nextLeaseExpiryAt: Int64?
}

struct JarvisTransitionAckResult {
    let scope: JarvisContextScope
    let leaseId: String
    let acknowledgedIds: [String]
    let alreadyAcknowledgedIds: [String]
    let rejectedIds: [String]
    let pending: Int
    let available: Int
    let nextLeaseExpiryAt: Int64?
}

struct JarvisLeaseMutation {
    let transitions: [JarvisTransitionEnvelope]
    let result: JarvisTransitionLeaseResult
    let changed: Bool
}

struct JarvisAckMutation {
    let transitions: [JarvisTransitionEnvelope]
    let acknowledgements: [JarvisTransitionAcknowledgement]
    let acknowledgedIds: [String]
    let alreadyAcknowledgedIds: [String]
    let rejectedIds: [String]
    let changed: Bool
}

struct JarvisBusyInterval {
    let startAt: Int64
    let endAt: Int64
    let allDay: Bool
}

func jarvisTransitionIdentity(geofenceId: String, transition: String, occurredAt: Int64) -> String {
    jarvisDigestIdentity(prefix: "ctx-", payload: "\(geofenceId)\u{0}\(transition)\u{0}\(occurredAt)")
}

func jarvisPlatformGeofenceIdentity(
    scope: JarvisContextScope?,
    configurationGeneration: Int64,
    geofenceId: String
) -> String {
    let payload = [
        scope?.principalId ?? "",
        scope?.deviceId ?? "",
        scope.map { String($0.generation) } ?? "",
        String(configurationGeneration),
        geofenceId
    ].joined(separator: "\u{0}")
    return jarvisDigestIdentity(prefix: "jctx-", payload: payload)
}

private func jarvisDigestIdentity(prefix: String, payload: String) -> String {
    let digest = SHA256.hash(data: Data(payload.utf8))
    return prefix + digest.prefix(16).map { String(format: "%02x", $0) }.joined()
}

func canonicalizeTransitions(_ transitions: [JarvisTransitionEnvelope]) -> [JarvisTransitionEnvelope] {
    var identities = Set<String>()
    return transitions.compactMap { transition in
        let identity = jarvisTransitionIdentity(
            geofenceId: transition.geofenceId,
            transition: transition.transition,
            occurredAt: transition.occurredAt
        )
        guard identities.insert(identity).inserted else { return nil }
        var canonical = transition
        canonical = JarvisTransitionEnvelope(
            id: identity,
            geofenceId: transition.geofenceId,
            transition: transition.transition,
            occurredAt: transition.occurredAt,
            recordedAt: transition.recordedAt,
            leaseId: transition.leaseId,
            leaseRequestId: transition.leaseRequestId,
            leasedAt: transition.leasedAt,
            leaseExpiresAt: transition.leaseExpiresAt,
            deliveryAttempt: transition.deliveryAttempt
        )
        return canonical
    }
}

func leaseTransitionBatch(
    transitions: [JarvisTransitionEnvelope],
    scope: JarvisContextScope?,
    requestId: String,
    newLeaseId: String,
    now: Int64,
    leaseDurationMs: Int64,
    limit: Int
) -> JarvisLeaseMutation {
    let activeRetry = transitions.filter {
        $0.leaseRequestId == requestId && $0.leaseId != nil && ($0.leaseExpiresAt ?? Int64.min) > now
    }
    if let leaseId = activeRetry.first?.leaseId {
        let consistent = activeRetry.filter { $0.leaseId == leaseId }
        return JarvisLeaseMutation(
            transitions: transitions,
            result: jarvisLeaseResult(scope: scope, leased: consistent, allTransitions: transitions, now: now),
            changed: false
        )
    }

    let selectedIds = Set(transitions
        .filter { ($0.leaseExpiresAt ?? Int64.min) <= now }
        .prefix(max(0, limit))
        .map(\.id))
    guard !selectedIds.isEmpty else {
        return JarvisLeaseMutation(
            transitions: transitions,
            result: jarvisLeaseResult(scope: scope, leased: [], allTransitions: transitions, now: now),
            changed: false
        )
    }

    let expiresAt = now > Int64.max - leaseDurationMs ? Int64.max : now + leaseDurationMs
    let updated = transitions.map { transition -> JarvisTransitionEnvelope in
        guard selectedIds.contains(transition.id) else { return transition }
        var leased = transition
        leased.leaseId = newLeaseId
        leased.leaseRequestId = requestId
        leased.leasedAt = now
        leased.leaseExpiresAt = expiresAt
        if leased.deliveryAttempt < Int.max { leased.deliveryAttempt += 1 }
        return leased
    }
    return JarvisLeaseMutation(
        transitions: updated,
        result: jarvisLeaseResult(
            scope: scope,
            leased: updated.filter { selectedIds.contains($0.id) },
            allTransitions: updated,
            now: now
        ),
        changed: true
    )
}

func acknowledgeTransitionBatch(
    transitions: [JarvisTransitionEnvelope],
    acknowledgements: [JarvisTransitionAcknowledgement],
    leaseId: String,
    transitionIds: [String],
    now: Int64
) -> JarvisAckMutation {
    var requested: [String] = []
    var requestedSet = Set<String>()
    for transitionId in transitionIds where requestedSet.insert(transitionId).inserted {
        requested.append(transitionId)
    }
    let existing = Set(acknowledgements.filter { $0.leaseId == leaseId }.map(\.transitionId))
    let byId = Dictionary(uniqueKeysWithValues: transitions.map { ($0.id, $0) })
    var acknowledged: [String] = []
    var alreadyAcknowledged: [String] = []
    var rejected: [String] = []
    var newlyAcknowledged = Set<String>()

    for transitionId in requested {
        if existing.contains(transitionId) {
            acknowledged.append(transitionId)
            alreadyAcknowledged.append(transitionId)
        } else if byId[transitionId]?.leaseId == leaseId {
            acknowledged.append(transitionId)
            newlyAcknowledged.insert(transitionId)
        } else {
            rejected.append(transitionId)
        }
    }

    guard !newlyAcknowledged.isEmpty else {
        return JarvisAckMutation(
            transitions: transitions,
            acknowledgements: acknowledgements,
            acknowledgedIds: acknowledged,
            alreadyAcknowledgedIds: alreadyAcknowledged,
            rejectedIds: rejected,
            changed: false
        )
    }
    let additions = newlyAcknowledged.map {
        JarvisTransitionAcknowledgement(leaseId: leaseId, transitionId: $0, acknowledgedAt: now)
    }
    return JarvisAckMutation(
        transitions: transitions.filter { !newlyAcknowledged.contains($0.id) },
        acknowledgements: Array((acknowledgements + additions).suffix(jarvisContextMaximumAcknowledgements)),
        acknowledgedIds: acknowledged,
        alreadyAcknowledgedIds: alreadyAcknowledged,
        rejectedIds: rejected,
        changed: true
    )
}

func transitionAvailability(
    transitions: [JarvisTransitionEnvelope],
    now: Int64
) -> (available: Int, nextLeaseExpiryAt: Int64?) {
    let available = transitions.filter { ($0.leaseExpiresAt ?? Int64.min) <= now }.count
    let nextExpiry = transitions.compactMap(\.leaseExpiresAt).filter { $0 > now }.min()
    return (available, nextExpiry)
}

private func jarvisLeaseResult(
    scope: JarvisContextScope?,
    leased: [JarvisTransitionEnvelope],
    allTransitions: [JarvisTransitionEnvelope],
    now: Int64
) -> JarvisTransitionLeaseResult {
    let availability = transitionAvailability(transitions: allTransitions, now: now)
    return JarvisTransitionLeaseResult(
        scope: scope,
        leaseId: leased.first?.leaseId,
        leasedAt: leased.first?.leasedAt,
        expiresAt: leased.first?.leaseExpiresAt,
        transitions: leased,
        pending: allTransitions.count,
        available: availability.available,
        nextLeaseExpiryAt: availability.nextLeaseExpiryAt
    )
}

func nextJarvisConfigurationGeneration(_ current: Int64) -> Int64 {
    (current < 0 || current >= jarvisContextMaximumSafeInteger) ? 1 : current + 1
}

func mergeBusyIntervals(_ intervals: [JarvisBusyInterval]) -> [JarvisBusyInterval] {
    var merged: [JarvisBusyInterval] = []
    for interval in intervals.sorted(by: { $0.startAt < $1.startAt }) {
        if let previous = merged.last, interval.startAt <= previous.endAt {
            merged[merged.count - 1] = JarvisBusyInterval(
                startAt: previous.startAt,
                endAt: max(previous.endAt, interval.endAt),
                allDay: previous.allDay && interval.allDay
            )
        } else {
            merged.append(interval)
        }
    }
    return merged
}
