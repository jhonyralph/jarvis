import XCTest
@testable import JarvisContext

final class JarvisContextModelsTests: XCTestCase {
    func testTransitionIdentityIsDeterministicAndPlatformNeutral() {
        let first = jarvisTransitionIdentity(geofenceId: "home", transition: "enter", occurredAt: 1_720_000_000_000)
        let replay = jarvisTransitionIdentity(geofenceId: "home", transition: "enter", occurredAt: 1_720_000_000_000)
        let changed = jarvisTransitionIdentity(geofenceId: "home", transition: "exit", occurredAt: 1_720_000_000_000)

        XCTAssertEqual(first, replay)
        XCTAssertEqual(first, "ctx-2936b547eb9f3c02e02668068896b63a")
        XCTAssertTrue(first.range(of: "^ctx-[0-9a-f]{32}$", options: .regularExpression) != nil)
        XCTAssertNotEqual(first, changed)
    }

    func testLegacyTransitionIdsAreCanonicalizedAndDeduplicated() {
        let canonical = canonicalizeTransitions([
            JarvisTransitionEnvelope(
                id: "legacy-a",
                geofenceId: "home",
                transition: "enter",
                occurredAt: 123_456,
                recordedAt: 123_500
            ),
            JarvisTransitionEnvelope(
                id: "legacy-b",
                geofenceId: "home",
                transition: "enter",
                occurredAt: 123_456,
                recordedAt: 123_900
            )
        ])

        XCTAssertEqual(canonical.count, 1)
        XCTAssertEqual(canonical[0].id, jarvisTransitionIdentity(
            geofenceId: "home",
            transition: "enter",
            occurredAt: 123_456
        ))
        XCTAssertEqual(canonical[0].recordedAt, 123_500)
    }

    func testPlatformIdentityChangesWithScopeAndConfigurationGeneration() {
        let scope = JarvisContextScope(principalId: "alice", deviceId: "phone", generation: 7)
        let first = jarvisPlatformGeofenceIdentity(
            scope: scope,
            configurationGeneration: 11,
            geofenceId: "home"
        )

        XCTAssertEqual(first, jarvisPlatformGeofenceIdentity(
            scope: scope,
            configurationGeneration: 11,
            geofenceId: "home"
        ))
        XCTAssertEqual(first, "jctx-a4bacda6edb9126036a676a041bd17d0")
        XCTAssertTrue(first.range(of: "^jctx-[0-9a-f]{32}$", options: .regularExpression) != nil)
        XCTAssertNotEqual(first, jarvisPlatformGeofenceIdentity(
            scope: JarvisContextScope(principalId: "alice", deviceId: "phone", generation: 8),
            configurationGeneration: 11,
            geofenceId: "home"
        ))
        XCTAssertNotEqual(first, jarvisPlatformGeofenceIdentity(
            scope: scope,
            configurationGeneration: 12,
            geofenceId: "home"
        ))
    }

    func testLeaseRetriesWithoutDeletionThenRedeliversAfterExpiry() {
        let scope = JarvisContextScope(principalId: "alice", deviceId: "phone", generation: 7)
        let queued = [JarvisTransitionEnvelope(
            id: "ctx-a",
            geofenceId: "home",
            transition: "enter",
            occurredAt: 100,
            recordedAt: 101
        )]
        let first = leaseTransitionBatch(
            transitions: queued,
            scope: scope,
            requestId: "request-1",
            newLeaseId: "lease-a",
            now: 1_000,
            leaseDurationMs: 5_000,
            limit: 10
        )
        XCTAssertTrue(first.changed)
        XCTAssertEqual(first.result.leaseId, "lease-a")
        XCTAssertEqual(first.result.transitions[0].deliveryAttempt, 1)
        XCTAssertEqual(first.transitions.count, 1)

        let retry = leaseTransitionBatch(
            transitions: first.transitions,
            scope: scope,
            requestId: "request-1",
            newLeaseId: "lease-unused",
            now: 2_000,
            leaseDurationMs: 5_000,
            limit: 10
        )
        XCTAssertFalse(retry.changed)
        XCTAssertEqual(retry.result.leaseId, "lease-a")

        let redelivery = leaseTransitionBatch(
            transitions: first.transitions,
            scope: scope,
            requestId: "request-2",
            newLeaseId: "lease-b",
            now: 6_001,
            leaseDurationMs: 5_000,
            limit: 10
        )
        XCTAssertEqual(redelivery.result.leaseId, "lease-b")
        XCTAssertEqual(redelivery.result.transitions[0].deliveryAttempt, 2)
    }

    func testAckIsPartialIdempotentAndCannotCrossLease() {
        let leased = [
            JarvisTransitionEnvelope(
                id: "ctx-a", geofenceId: "home", transition: "enter", occurredAt: 100,
                recordedAt: 101, leaseId: "lease-a"
            ),
            JarvisTransitionEnvelope(
                id: "ctx-b", geofenceId: "home", transition: "exit", occurredAt: 200,
                recordedAt: 201, leaseId: "lease-b"
            )
        ]
        let first = acknowledgeTransitionBatch(
            transitions: leased,
            acknowledgements: [],
            leaseId: "lease-a",
            transitionIds: ["ctx-a", "ctx-b"],
            now: 2_000
        )
        XCTAssertEqual(first.acknowledgedIds, ["ctx-a"])
        XCTAssertEqual(first.rejectedIds, ["ctx-b"])
        XCTAssertEqual(first.transitions.map(\.id), ["ctx-b"])

        let retry = acknowledgeTransitionBatch(
            transitions: first.transitions,
            acknowledgements: first.acknowledgements,
            leaseId: "lease-a",
            transitionIds: ["ctx-a"],
            now: 3_000
        )
        XCTAssertFalse(retry.changed)
        XCTAssertEqual(retry.acknowledgedIds, ["ctx-a"])
        XCTAssertEqual(retry.alreadyAcknowledgedIds, ["ctx-a"])
    }

    func testConfigurationGenerationRemainsJavaScriptSafe() {
        XCTAssertEqual(nextJarvisConfigurationGeneration(jarvisContextMaximumSafeInteger), 1)
        XCTAssertEqual(nextJarvisConfigurationGeneration(7), 8)
    }

    func testMixedMergedIntervalIsNotAllDay() {
        let merged = mergeBusyIntervals([
            JarvisBusyInterval(startAt: 100, endAt: 300, allDay: true),
            JarvisBusyInterval(startAt: 200, endAt: 400, allDay: false)
        ])

        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].startAt, 100)
        XCTAssertEqual(merged[0].endAt, 400)
        XCTAssertFalse(merged[0].allDay)
    }

    func testTouchingAllDayIntervalsRemainAllDay() {
        let merged = mergeBusyIntervals([
            JarvisBusyInterval(startAt: 100, endAt: 200, allDay: true),
            JarvisBusyInterval(startAt: 200, endAt: 300, allDay: true),
            JarvisBusyInterval(startAt: 250, endAt: 400, allDay: true)
        ])

        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].startAt, 100)
        XCTAssertEqual(merged[0].endAt, 400)
        XCTAssertTrue(merged[0].allDay)
    }
}
