import Foundation
import XCTest
@testable import JarvisContext

final class JarvisContextStoreTests: XCTestCase {
    private var baseURL: URL!
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUpWithError() throws {
        try super.setUpWithError()
        suiteName = "chat.jarvis.context.tests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        baseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("JarvisContextTests-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        if let baseURL { try? FileManager.default.removeItem(at: baseURL) }
        if let suiteName { defaults?.removePersistentDomain(forName: suiteName) }
        defaults = nil
        suiteName = nil
        baseURL = nil
        try super.tearDownWithError()
    }

    func testMigrationClearsLegacyDefaultsAndProtectsState() throws {
        let geofences = [JarvisManagedGeofence(
            id: "home",
            latitude: -19.92,
            longitude: -43.94,
            radiusM: 150,
            notifyOnEntry: true,
            notifyOnExit: true
        )]
        defaults.set(try JSONEncoder().encode(geofences), forKey: "jarvis_context_geofences_v1")
        defaults.set(true, forKey: "jarvis_context_significant_changes_v1")

        let store = makeStore()
        XCTAssertEqual(try store.geofences(), geofences)
        XCTAssertTrue(try store.significantChangesEnabled())
        XCTAssertNil(defaults.object(forKey: "jarvis_context_geofences_v1"))
        XCTAssertNil(defaults.object(forKey: "jarvis_context_significant_changes_v1"))

        let stateURL = baseURL
            .appendingPathComponent("JarvisContext", isDirectory: true)
            .appendingPathComponent("context-state-v2.json", isDirectory: false)
        XCTAssertTrue(try stateURL.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        let attributes = try FileManager.default.attributesOfItem(atPath: stateURL.path)
        XCTAssertEqual(
            attributes[.protectionKey] as? FileProtectionType,
            FileProtectionType.completeUntilFirstUserAuthentication
        )
    }

    func testExistingProtectedStateStillCleansInterruptedLegacyResidue() throws {
        let initial = makeStore()
        try initial.replaceGeofences([], significantChanges: false)
        defaults.set(Data("[]".utf8), forKey: "jarvis_context_transitions_v1")

        _ = makeStore()

        XCTAssertNil(defaults.object(forKey: "jarvis_context_transitions_v1"))
    }

    func testLegacyTransitionMigrationCanonicalizesReplayIdentity() throws {
        let legacy = JarvisTransitionEnvelope(
            id: "legacy-random-id",
            geofenceId: "home",
            transition: "enter",
            occurredAt: 123_456,
            recordedAt: 123_500
        )
        defaults.set(
            try JSONEncoder().encode([legacy]),
            forKey: "jarvis_context_transitions_v1"
        )

        let store = makeStore()
        let leased = try store.leaseTransitions(
            expectedScope: nil,
            requestId: "request-1",
            leaseId: "lease-00000000-0000-0000-0000-000000000001",
            limit: 10,
            leaseDurationMs: 60_000,
            now: 1_000
        )
        XCTAssertEqual(leased.transitions.count, 1)
        XCTAssertEqual(leased.transitions[0].id, jarvisTransitionIdentity(
            geofenceId: "home",
            transition: "enter",
            occurredAt: 123_456
        ))
    }

    func testScopeAdoptionDropsAmbiguousUnscopedDeliveryState() throws {
        let store = makeStore()
        try store.replaceGeofences([], significantChanges: false)
        _ = try store.enqueueTransition(geofenceId: "home", transition: "enter", occurredAt: 123_456)
        _ = try store.leaseTransitions(
            expectedScope: nil,
            requestId: "legacy-request",
            leaseId: "lease-00000000-0000-0000-0000-000000000001",
            limit: 10,
            leaseDurationMs: 60_000,
            now: 1_000
        )

        let scope = JarvisContextScope(principalId: "alice", deviceId: "phone", generation: 7)
        try store.replaceGeofences([], significantChanges: false, requestedScope: scope)
        let scoped = try store.leaseTransitions(
            expectedScope: scope,
            requestId: "scoped-request",
            leaseId: "lease-00000000-0000-0000-0000-000000000002",
            limit: 10,
            leaseDurationMs: 60_000,
            now: 2_000
        )
        XCTAssertTrue(scoped.transitions.isEmpty)
        XCTAssertEqual(scoped.pending, 0)

        let replay = try store.enqueueTransition(
            geofenceId: "home",
            transition: "enter",
            occurredAt: 123_456
        )
        XCTAssertTrue(replay.inserted)
        XCTAssertEqual(replay.pending, 1)
    }

    func testAcknowledgedTransitionCannotBeReinsertedByReplay() throws {
        let store = makeStore()
        let scope = JarvisContextScope(principalId: "alice", deviceId: "phone", generation: 7)
        try store.replaceGeofences([], significantChanges: false, requestedScope: scope)
        let first = try store.enqueueTransition(geofenceId: "home", transition: "enter", occurredAt: 123_456)
        XCTAssertTrue(first.inserted)
        XCTAssertEqual(first.pending, 1)
        let leased = try store.leaseTransitions(
            expectedScope: scope,
            requestId: "request-1",
            leaseId: "lease-00000000-0000-0000-0000-000000000001",
            limit: 10,
            leaseDurationMs: 60_000,
            now: 1_000
        )
        let acknowledged = try store.acknowledgeTransitions(
            expectedScope: scope,
            leaseId: try XCTUnwrap(leased.leaseId),
            transitionIds: leased.transitions.map(\.id),
            now: 2_000
        )
        XCTAssertEqual(acknowledged.pending, 0)

        let replay = try store.enqueueTransition(geofenceId: "home", transition: "enter", occurredAt: 123_456)
        XCTAssertFalse(replay.inserted)
        XCTAssertEqual(replay.pending, 0)
    }

    func testLeaseSurvivesStoreReloadAndAckRetryIsIdempotent() throws {
        let scope = JarvisContextScope(principalId: "alice", deviceId: "phone", generation: 7)
        let store = makeStore()
        try store.replaceGeofences([], significantChanges: false, requestedScope: scope)
        XCTAssertThrowsError(try store.snapshotForCaller(expectedScope: nil))
        _ = try store.enqueueTransition(geofenceId: "home", transition: "enter", occurredAt: 123_456)
        let first = try store.leaseTransitions(
            expectedScope: scope,
            requestId: "request-1",
            leaseId: "lease-00000000-0000-0000-0000-000000000001",
            limit: 10,
            leaseDurationMs: 60_000,
            now: 1_000
        )

        let reloaded = makeStore()
        let retry = try reloaded.leaseTransitions(
            expectedScope: scope,
            requestId: "request-1",
            leaseId: "lease-unused",
            limit: 10,
            leaseDurationMs: 60_000,
            now: 2_000
        )
        XCTAssertEqual(retry.leaseId, first.leaseId)
        XCTAssertEqual(retry.transitions.map(\.id), first.transitions.map(\.id))

        let ack = try reloaded.acknowledgeTransitions(
            expectedScope: scope,
            leaseId: try XCTUnwrap(first.leaseId),
            transitionIds: first.transitions.map(\.id),
            now: 3_000
        )
        let ackRetry = try reloaded.acknowledgeTransitions(
            expectedScope: scope,
            leaseId: try XCTUnwrap(first.leaseId),
            transitionIds: first.transitions.map(\.id),
            now: 4_000
        )
        XCTAssertEqual(ack.acknowledgedIds, ackRetry.acknowledgedIds)
        XCTAssertEqual(ackRetry.alreadyAcknowledgedIds, ack.acknowledgedIds)
    }

    func testEraseAllIsScopedAndRemovesProtectedDirectory() throws {
        let scope = JarvisContextScope(principalId: "alice", deviceId: "phone", generation: 7)
        let store = makeStore()
        try store.replaceGeofences([], significantChanges: false, requestedScope: scope)
        XCTAssertThrowsError(try store.eraseAll(expectedScope: scopeWithGeneration(8))) { error in
            guard let storeError = error as? JarvisContextStoreError,
                  case .scopeMismatch = storeError else {
                return XCTFail("Expected scopeMismatch, received \(error)")
            }
        }

        XCTAssertTrue(try store.eraseAll(expectedScope: scope))
        XCTAssertFalse(FileManager.default.fileExists(atPath: baseURL
            .appendingPathComponent("JarvisContext", isDirectory: true).path))
        XCTAssertFalse(try store.eraseAll(expectedScope: scope))
    }

    private func scopeWithGeneration(_ generation: Int64) -> JarvisContextScope {
        JarvisContextScope(principalId: "alice", deviceId: "phone", generation: generation)
    }

    private func makeStore() -> JarvisContextStore {
        JarvisContextStore(
            fileManager: .default,
            legacyDefaults: defaults,
            baseDirectoryURL: baseURL
        )
    }
}
