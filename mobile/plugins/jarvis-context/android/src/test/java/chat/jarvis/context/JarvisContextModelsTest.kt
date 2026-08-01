package chat.jarvis.context

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class JarvisContextModelsTest {
    @Test
    fun transitionIdentityIsDeterministicAndPlatformNeutral() {
        val first = jarvisTransitionIdentity("home", "enter", 1_720_000_000_000)
        val replay = jarvisTransitionIdentity("home", "enter", 1_720_000_000_000)
        val different = jarvisTransitionIdentity("home", "exit", 1_720_000_000_000)

        assertEquals(first, replay)
        assertEquals("ctx-2936b547eb9f3c02e02668068896b63a", first)
        assertTrue(first.matches(Regex("^ctx-[0-9a-f]{32}$")))
        assertNotEquals(first, different)
    }

    @Test
    fun legacyTransitionIdsAreCanonicalizedAndDeduplicated() {
        val canonical = canonicalizeTransitions(
            listOf(
                JarvisTransitionEnvelope("legacy-a", "home", "enter", 123_456, 123_500),
                JarvisTransitionEnvelope("legacy-b", "home", "enter", 123_456, 123_900),
            ),
        )

        assertEquals(1, canonical.size)
        assertEquals(jarvisTransitionIdentity("home", "enter", 123_456), canonical.single().id)
        assertEquals(123_500, canonical.single().recordedAt)
    }

    @Test
    fun platformRegistrationIdentityChangesWithAuthorizationAndConfigurationGeneration() {
        val scope = JarvisContextScope("alice", "phone", 7)
        val first = jarvisPlatformGeofenceIdentity(scope, 11, "home")

        assertEquals("scope-f7e6250bf478250eb52cf7a8b74b355f", jarvisContextScopeIdentity(scope))
        assertEquals(first, jarvisPlatformGeofenceIdentity(scope, 11, "home"))
        assertEquals("jctx-a4bacda6edb9126036a676a041bd17d0", first)
        assertTrue(first.matches(Regex("^jctx-[0-9a-f]{32}$")))
        assertNotEquals(first, jarvisPlatformGeofenceIdentity(scope.copy(generation = 8), 11, "home"))
        assertNotEquals(first, jarvisPlatformGeofenceIdentity(scope, 12, "home"))
    }

    @Test
    fun leaseIsNonDestructiveIdempotentUntilExpiryAndThenRedelivered() {
        val scope = JarvisContextScope("alice", "phone", 7)
        val queued = listOf(JarvisTransitionEnvelope("ctx-a", "home", "enter", 100, 101))
        val first = leaseTransitionBatch(queued, scope, "request-1", "lease-a", 1_000, 5_000, 10)

        assertTrue(first.changed)
        assertEquals(1, first.transitions.size)
        assertEquals("lease-a", first.result.leaseId)
        assertEquals(1, first.result.transitions.single().deliveryAttempt)
        assertEquals(0, first.result.available)

        val retry = leaseTransitionBatch(first.transitions, scope, "request-1", "lease-unused", 2_000, 5_000, 10)
        assertFalse(retry.changed)
        assertEquals("lease-a", retry.result.leaseId)
        assertEquals(1, retry.result.transitions.single().deliveryAttempt)

        val redelivery = leaseTransitionBatch(first.transitions, scope, "request-2", "lease-b", 6_001, 5_000, 10)
        assertTrue(redelivery.changed)
        assertEquals("lease-b", redelivery.result.leaseId)
        assertEquals(2, redelivery.result.transitions.single().deliveryAttempt)
    }

    @Test
    fun acknowledgementIsPartialIdempotentAndCannotCrossLeases() {
        val leased = listOf(
            JarvisTransitionEnvelope("ctx-a", "home", "enter", 100, 101, leaseId = "lease-a"),
            JarvisTransitionEnvelope("ctx-b", "home", "exit", 200, 201, leaseId = "lease-b"),
        )
        val first = acknowledgeTransitionBatch(leased, emptyList(), "lease-a", listOf("ctx-a", "ctx-b"), 2_000)

        assertEquals(listOf("ctx-a"), first.acknowledgedIds)
        assertEquals(listOf("ctx-b"), first.rejectedIds)
        assertEquals(listOf("ctx-b"), first.transitions.map { it.id })

        val retry = acknowledgeTransitionBatch(
            first.transitions,
            first.acknowledgements,
            "lease-a",
            listOf("ctx-a"),
            3_000,
        )
        assertFalse(retry.changed)
        assertEquals(listOf("ctx-a"), retry.acknowledgedIds)
        assertEquals(listOf("ctx-a"), retry.alreadyAcknowledgedIds)
    }

    @Test
    fun configurationGenerationRemainsJavaScriptSafe() {
        assertEquals(1, nextJarvisConfigurationGeneration(JARVIS_CONTEXT_MAX_SAFE_INTEGER))
        assertEquals(8, nextJarvisConfigurationGeneration(7))
    }

    @Test
    fun mergedIntervalIsAllDayOnlyWhenEveryContributorIsAllDay() {
        val merged = mergeBusyIntervals(
            listOf(
                JarvisBusyInterval(100, 300, true),
                JarvisBusyInterval(200, 400, false),
            ),
        )

        assertEquals(1, merged.size)
        assertEquals(100, merged.single().startAt)
        assertEquals(400, merged.single().endAt)
        assertFalse(merged.single().allDay)
    }

    @Test
    fun separateAllDayIntervalsRetainTheirClassification() {
        val merged = mergeBusyIntervals(
            listOf(
                JarvisBusyInterval(100, 200, true),
                JarvisBusyInterval(300, 400, true),
            ),
        )

        assertEquals(2, merged.size)
        assertTrue(merged.all { it.allDay })
    }

    @Test
    fun touchingAllDayIntervalsRemainAllDay() {
        val merged = mergeBusyIntervals(
            listOf(
                JarvisBusyInterval(100, 200, true),
                JarvisBusyInterval(200, 300, true),
                JarvisBusyInterval(250, 400, true),
            ),
        )

        assertEquals(listOf(JarvisBusyInterval(100, 400, true)), merged)
    }
}
