import Foundation

enum JarvisContextStoreError: LocalizedError {
    case legacyCleanupFailed
    case legacyStateUnreadable
    case unsupportedVersion
    case scopeMismatch
    case staleConfiguration
    case eraseFailed

    var errorDescription: String? {
        switch self {
        case .legacyCleanupFailed: return "Legacy Jarvis context state could not be cleared"
        case .legacyStateUnreadable: return "Legacy Jarvis context state is unreadable"
        case .unsupportedVersion: return "Jarvis context state has an unsupported version"
        case .scopeMismatch: return "Native context state belongs to a different authorization scope"
        case .staleConfiguration: return "Native context callback belongs to a stale configuration"
        case .eraseFailed: return "Jarvis context local storage could not be erased"
        }
    }
}

final class JarvisContextStore {
    private let queue = DispatchQueue(label: "chat.jarvis.context.store")
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let fileManager: FileManager
    private let legacyDefaults: UserDefaults
    private let directoryURL: URL
    private let stateURL: URL
    private var state = State()
    private var initializationError: Error?

    init(
        fileManager: FileManager = .default,
        legacyDefaults: UserDefaults = .standard,
        baseDirectoryURL: URL? = nil
    ) {
        self.fileManager = fileManager
        self.legacyDefaults = legacyDefaults
        let base = baseDirectoryURL ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        self.directoryURL = base.appendingPathComponent("JarvisContext", isDirectory: true)
        self.stateURL = directoryURL.appendingPathComponent("context-state-v2.json", isDirectory: false)

        do {
            try prepareProtectedDirectory()
            if fileManager.fileExists(atPath: stateURL.path) {
                state = try decoder.decode(State.self, from: Data(contentsOf: stateURL))
                guard [State.legacyVersion, State.currentVersion].contains(state.version) else {
                    throw JarvisContextStoreError.unsupportedVersion
                }
                try protectAndExclude(stateURL)
                try clearLegacyStateIfPresent()
            } else {
                try migrateLegacyStateIfPresent()
            }
        } catch {
            initializationError = error
        }
    }

    func snapshot() throws -> JarvisGeofenceSnapshot {
        try queue.sync {
            try ensureAvailable()
            return state.snapshot
        }
    }

    func snapshotForCaller(expectedScope: JarvisContextScope?) throws -> JarvisGeofenceSnapshot {
        try queue.sync {
            try ensureAvailable()
            try requireCallerScope(expectedScope)
            return state.snapshot
        }
    }

    func geofences() throws -> [JarvisManagedGeofence] {
        try snapshot().geofences
    }

    func generation() throws -> Int64 {
        try snapshot().generation
    }

    func significantChangesEnabled() throws -> Bool {
        try snapshot().significantChanges
    }

    func prepareGeofenceReplacement(
        _ geofences: [JarvisManagedGeofence],
        significantChanges: Bool,
        requestedScope: JarvisContextScope?
    ) throws -> JarvisGeofenceReplacement {
        try queue.sync {
            try ensureAvailable()
            let desiredScope = try mutationScope(requestedScope)
            return JarvisGeofenceReplacement(
                previous: state.snapshot,
                desired: JarvisGeofenceSnapshot(
                    generation: nextJarvisConfigurationGeneration(state.generation),
                    scope: desiredScope,
                    geofences: geofences,
                    significantChanges: !geofences.isEmpty && significantChanges
                )
            )
        }
    }

    @discardableResult
    func commitGeofenceReplacement(_ replacement: JarvisGeofenceReplacement) throws -> JarvisGeofenceSnapshot {
        try queue.sync {
            try ensureAvailable()
            guard state.generation == replacement.previous.generation,
                  state.scope == replacement.previous.scope else {
                throw JarvisContextStoreError.staleConfiguration
            }
            var next = state
            let scopeChanged = state.scope != replacement.desired.scope
            next.generation = replacement.desired.generation
            next.scope = replacement.desired.scope
            next.geofences = replacement.desired.geofences
            next.significantChanges = replacement.desired.significantChanges
            if scopeChanged {
                // Legacy unscoped delivery state cannot be attributed to a newly authenticated principal.
                next.transitions = []
                next.seenTransitionIds = []
                next.acknowledgements = []
            }
            try persist(next)
            return next.snapshot
        }
    }

    func replaceGeofences(
        _ geofences: [JarvisManagedGeofence],
        significantChanges: Bool,
        requestedScope: JarvisContextScope? = nil
    ) throws {
        let replacement = try prepareGeofenceReplacement(
            geofences,
            significantChanges: significantChanges,
            requestedScope: requestedScope
        )
        try commitGeofenceReplacement(replacement)
    }

    func removeGeofences(
        ids: Set<String>,
        requestedScope: JarvisContextScope? = nil
    ) throws -> JarvisGeofenceReplacement {
        try queue.sync {
            try ensureAvailable()
            let desiredScope = try mutationScope(requestedScope)
            let remaining = state.geofences.filter { !ids.contains($0.id) }
            if remaining == state.geofences && desiredScope == state.scope {
                return JarvisGeofenceReplacement(previous: state.snapshot, desired: state.snapshot)
            }
            let previous = state.snapshot
            var next = state
            let scopeChanged = state.scope != desiredScope
            next.generation = nextJarvisConfigurationGeneration(state.generation)
            next.scope = desiredScope
            next.geofences = remaining
            if remaining.isEmpty { next.significantChanges = false }
            if scopeChanged {
                next.transitions = []
                next.seenTransitionIds = []
                next.acknowledgements = []
            }
            try persist(next)
            return JarvisGeofenceReplacement(previous: previous, desired: next.snapshot)
        }
    }

    func enqueueTransition(
        geofenceId: String,
        transition: String,
        occurredAt: Int64,
        expectedGeneration: Int64? = nil,
        expectedScope: JarvisContextScope? = nil
    ) throws -> (pending: Int, inserted: Bool, retryRequired: Bool) {
        try queue.sync {
            try ensureAvailable()
            if let expectedGeneration,
               (state.generation != expectedGeneration || state.scope != expectedScope ||
                !state.geofences.contains(where: { $0.id == geofenceId })) {
                throw JarvisContextStoreError.staleConfiguration
            }
            let identity = jarvisTransitionIdentity(
                geofenceId: geofenceId,
                transition: transition,
                occurredAt: occurredAt
            )
            if state.seenTransitionIds.contains(identity) ||
                state.transitions.contains(where: { $0.id == identity }) ||
                state.acknowledgements.contains(where: { $0.transitionId == identity }) {
                return (state.transitions.count, false, false)
            }
            var next = state
            // CoreLocation does not provide a durable retry callback, so every accepted event is persisted.
            next.transitions.append(JarvisTransitionEnvelope(
                id: identity,
                geofenceId: geofenceId,
                transition: transition,
                occurredAt: occurredAt,
                recordedAt: Int64(Date().timeIntervalSince1970 * 1000)
            ))
            next.seenTransitionIds.append(identity)
            if next.seenTransitionIds.count > jarvisContextMaximumSeenTransitions {
                next.seenTransitionIds.removeFirst(next.seenTransitionIds.count - jarvisContextMaximumSeenTransitions)
            }
            try persist(next)
            return (next.transitions.count, true, false)
        }
    }

    func pendingTransitions() throws -> Int {
        try queue.sync {
            try ensureAvailable()
            return state.transitions.count
        }
    }

    func transitionAvailability(now: Int64) throws -> (available: Int, nextLeaseExpiryAt: Int64?) {
        try queue.sync {
            try ensureAvailable()
            return transitionAvailability(transitions: state.transitions, now: now)
        }
    }

    func leaseTransitions(
        expectedScope: JarvisContextScope?,
        requestId: String,
        leaseId: String,
        limit: Int,
        leaseDurationMs: Int64,
        now: Int64
    ) throws -> JarvisTransitionLeaseResult {
        try queue.sync {
            try ensureAvailable()
            try requireCallerScope(expectedScope)
            let mutation = leaseTransitionBatch(
                transitions: state.transitions,
                scope: state.scope,
                requestId: requestId,
                newLeaseId: leaseId,
                now: now,
                leaseDurationMs: leaseDurationMs,
                limit: limit
            )
            if mutation.changed {
                var next = state
                next.transitions = mutation.transitions
                try persist(next)
            }
            return mutation.result
        }
    }

    func acknowledgeTransitions(
        expectedScope: JarvisContextScope,
        leaseId: String,
        transitionIds: [String],
        now: Int64
    ) throws -> JarvisTransitionAckResult {
        try queue.sync {
            try ensureAvailable()
            try requireCallerScope(expectedScope)
            let mutation = acknowledgeTransitionBatch(
                transitions: state.transitions,
                acknowledgements: state.acknowledgements,
                leaseId: leaseId,
                transitionIds: transitionIds,
                now: now
            )
            if mutation.changed {
                var next = state
                next.transitions = mutation.transitions
                next.acknowledgements = mutation.acknowledgements
                try persist(next)
            }
            let availability = transitionAvailability(transitions: mutation.transitions, now: now)
            return JarvisTransitionAckResult(
                scope: expectedScope,
                leaseId: leaseId,
                acknowledgedIds: mutation.acknowledgedIds,
                alreadyAcknowledgedIds: mutation.alreadyAcknowledgedIds,
                rejectedIds: mutation.rejectedIds,
                pending: mutation.transitions.count,
                available: availability.available,
                nextLeaseExpiryAt: availability.nextLeaseExpiryAt
            )
        }
    }

    /** Erasure remains available even when protected state is corrupt or platform permission is gone. */
    func eraseAll(expectedScope: JarvisContextScope) throws -> Bool {
        try queue.sync {
            let legacyPresent = LegacyKeys.all.contains { legacyDefaults.object(forKey: $0) != nil }
            let hadLocalState = fileManager.fileExists(atPath: directoryURL.path) || legacyPresent
            if initializationError == nil, state.scope != nil, state.scope != expectedScope {
                throw JarvisContextStoreError.scopeMismatch
            }

            var cleanupError: Error?
            if fileManager.fileExists(atPath: directoryURL.path) {
                do {
                    try fileManager.removeItem(at: directoryURL)
                } catch {
                    cleanupError = error
                }
            }
            do {
                try clearLegacyStateIfPresent()
            } catch {
                if cleanupError == nil { cleanupError = error }
            }
            guard !fileManager.fileExists(atPath: directoryURL.path),
                   LegacyKeys.all.allSatisfy({ legacyDefaults.object(forKey: $0) == nil }) else {
                // If deletion is unavailable, an empty scoped tombstone still prevents launch rearm.
                var tombstone = State()
                tombstone.scope = expectedScope
                try? persist(tombstone)
                throw cleanupError ?? JarvisContextStoreError.eraseFailed
            }
            state = State()
            initializationError = nil
            return hadLocalState
        }
    }

    private func requireCallerScope(_ expectedScope: JarvisContextScope?) throws {
        if state.scope != expectedScope { throw JarvisContextStoreError.scopeMismatch }
    }

    private func mutationScope(_ requestedScope: JarvisContextScope?) throws -> JarvisContextScope? {
        if state.scope != nil && state.scope != requestedScope { throw JarvisContextStoreError.scopeMismatch }
        guard let requestedScope else { return nil }
        return requestedScope
    }

    private func prepareProtectedDirectory() throws {
        try fileManager.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        try protectAndExclude(directoryURL)
    }

    private func protectAndExclude(_ url: URL) throws {
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        var protectedURL = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try protectedURL.setResourceValues(values)
    }

    private func migrateLegacyStateIfPresent() throws {
        let geofenceData = legacyDefaults.data(forKey: LegacyKeys.geofences)
        let transitionData = legacyDefaults.data(forKey: LegacyKeys.transitions)
        let significantValue = legacyDefaults.object(forKey: LegacyKeys.significantChanges)
        guard geofenceData != nil || transitionData != nil || significantValue != nil else { return }

        let geofences = try decodeLegacy([JarvisManagedGeofence].self, data: geofenceData)
        let transitions = canonicalizeTransitions(
            try decodeLegacy([JarvisTransitionEnvelope].self, data: transitionData)
        )
        var migrated = State()
        migrated.geofences = geofences
        migrated.transitions = transitions
        migrated.seenTransitionIds = Array(transitions.map(\.id).suffix(jarvisContextMaximumSeenTransitions))
        migrated.significantChanges = !geofences.isEmpty && (significantValue as? Bool == true)
        try persist(migrated)

        try clearLegacyStateIfPresent()
    }

    private func clearLegacyStateIfPresent() throws {
        guard LegacyKeys.all.contains(where: { legacyDefaults.object(forKey: $0) != nil }) else { return }
        legacyDefaults.removeObject(forKey: LegacyKeys.geofences)
        legacyDefaults.removeObject(forKey: LegacyKeys.significantChanges)
        legacyDefaults.removeObject(forKey: LegacyKeys.transitions)
        _ = legacyDefaults.synchronize()
        guard LegacyKeys.all.allSatisfy({ legacyDefaults.object(forKey: $0) == nil }) else {
            throw JarvisContextStoreError.legacyCleanupFailed
        }
    }

    private func decodeLegacy<T: Decodable>(_ type: T.Type, data: Data?) throws -> T where T: RangeReplaceableCollection {
        guard let data else { return T() }
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw JarvisContextStoreError.legacyStateUnreadable
        }
    }

    private func persist(_ next: State) throws {
        try prepareProtectedDirectory()
        var persisted = next
        persisted.version = State.currentVersion
        let data = try encoder.encode(persisted)
        let temporaryURL = directoryURL.appendingPathComponent(
            ".context-state-\(UUID().uuidString).tmp",
            isDirectory: false
        )
        defer { try? fileManager.removeItem(at: temporaryURL) }
        try data.write(to: temporaryURL, options: [.completeFileProtectionUntilFirstUserAuthentication])
        try protectAndExclude(temporaryURL)
        if fileManager.fileExists(atPath: stateURL.path) {
            _ = try fileManager.replaceItemAt(
                stateURL,
                withItemAt: temporaryURL,
                backupItemName: nil,
                options: [.usingNewMetadataOnly]
            )
        } else {
            try fileManager.moveItem(at: temporaryURL, to: stateURL)
        }
        state = persisted
    }

    private func ensureAvailable() throws {
        if let initializationError { throw initializationError }
    }

    private struct State: Codable {
        static let legacyVersion = 2
        static let currentVersion = 3
        var version = currentVersion
        var generation: Int64 = 0
        var scope: JarvisContextScope? = nil
        var geofences: [JarvisManagedGeofence] = []
        var significantChanges = false
        var transitions: [JarvisTransitionEnvelope] = []
        var seenTransitionIds: [String] = []
        var acknowledgements: [JarvisTransitionAcknowledgement] = []

        var snapshot: JarvisGeofenceSnapshot {
            JarvisGeofenceSnapshot(
                generation: generation,
                scope: scope,
                geofences: geofences,
                significantChanges: significantChanges
            )
        }

        private enum CodingKeys: String, CodingKey {
            case version, generation, scope, geofences, significantChanges
            case transitions, seenTransitionIds, acknowledgements
        }

        init() {}

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            version = try values.decodeIfPresent(Int.self, forKey: .version) ?? Self.legacyVersion
            generation = min(
                jarvisContextMaximumSafeInteger,
                max(0, try values.decodeIfPresent(Int64.self, forKey: .generation) ?? 0)
            )
            scope = try values.decodeIfPresent(JarvisContextScope.self, forKey: .scope)
            if let scope, !isValidJarvisContextScope(scope) {
                throw DecodingError.dataCorruptedError(
                    forKey: .scope,
                    in: values,
                    debugDescription: "Invalid Jarvis context scope"
                )
            }
            geofences = try values.decodeIfPresent([JarvisManagedGeofence].self, forKey: .geofences) ?? []
            significantChanges = try values.decodeIfPresent(Bool.self, forKey: .significantChanges) ?? false
            let decoded = try values.decodeIfPresent([JarvisTransitionEnvelope].self, forKey: .transitions) ?? []
            transitions = canonicalizeTransitions(decoded)
            let seen = try values.decodeIfPresent([String].self, forKey: .seenTransitionIds) ?? []
            seenTransitionIds = Array((seen + transitions.map(\.id)).uniqued().suffix(jarvisContextMaximumSeenTransitions))
            let acknowledged = try values.decodeIfPresent(
                [JarvisTransitionAcknowledgement].self,
                forKey: .acknowledgements
            ) ?? []
            acknowledgements = Array(acknowledged.uniquedBy { "\($0.leaseId)\u{0}\($0.transitionId)" }
                .suffix(jarvisContextMaximumAcknowledgements))
        }
    }

    private enum LegacyKeys {
        static let geofences = "jarvis_context_geofences_v1"
        static let significantChanges = "jarvis_context_significant_changes_v1"
        static let transitions = "jarvis_context_transitions_v1"
        static let all = [geofences, significantChanges, transitions]
    }
}

private extension Array where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}

private extension Array {
    func uniquedBy<Key: Hashable>(_ key: (Element) -> Key) -> [Element] {
        var seen = Set<Key>()
        return filter { seen.insert(key($0)).inserted }
    }
}
