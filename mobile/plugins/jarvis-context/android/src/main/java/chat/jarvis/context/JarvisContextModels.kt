package chat.jarvis.context

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

internal const val JARVIS_CONTEXT_MAX_GEOFENCES = 20
internal const val JARVIS_CONTEXT_MAX_TRANSITIONS = 1000
internal const val JARVIS_CONTEXT_MAX_SEEN_TRANSITIONS = 4000
internal const val JARVIS_CONTEXT_MAX_ACKNOWLEDGEMENTS = 4000
internal const val JARVIS_CONTEXT_MAX_SAFE_INTEGER = 9_007_199_254_740_991L
internal const val JARVIS_CONTEXT_ACTION_TRANSITIONS_AVAILABLE =
    "chat.jarvis.context.TRANSITIONS_AVAILABLE"

internal data class JarvisContextScope(
    val principalId: String,
    val deviceId: String,
    val generation: Long,
)

internal fun isValidJarvisContextIdentifier(value: String): Boolean =
    value.isNotBlank() && value.length <= 200 && value.none { character ->
        character.code in 0..31 || character.code == 127
    }

internal fun isValidJarvisContextScope(scope: JarvisContextScope): Boolean =
    isValidJarvisContextIdentifier(scope.principalId) &&
        isValidJarvisContextIdentifier(scope.deviceId) &&
        scope.generation in 0..JARVIS_CONTEXT_MAX_SAFE_INTEGER

internal data class JarvisManagedGeofence(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val radiusM: Float,
    val notifyOnEntry: Boolean,
    val notifyOnExit: Boolean,
)

internal data class JarvisTransitionEnvelope(
    val id: String,
    val geofenceId: String,
    val transition: String,
    val occurredAt: Long,
    val recordedAt: Long,
    val leaseId: String? = null,
    val leaseRequestId: String? = null,
    val leasedAt: Long? = null,
    val leaseExpiresAt: Long? = null,
    val deliveryAttempt: Int = 0,
)

internal data class JarvisTransitionAcknowledgement(
    val leaseId: String,
    val transitionId: String,
    val acknowledgedAt: Long,
)

internal data class JarvisGeofenceSnapshot(
    val generation: Long,
    val geofences: List<JarvisManagedGeofence>,
    val scope: JarvisContextScope?,
)

internal data class JarvisGeofenceReplacement(
    val previous: JarvisGeofenceSnapshot,
    val desired: JarvisGeofenceSnapshot,
)

internal data class JarvisEnqueueResult(
    val pending: Int,
    val inserted: Boolean,
    /** Queue saturation keeps existing unacknowledged events and asks WorkManager to retry this one. */
    val retryRequired: Boolean = false,
)

internal data class JarvisTransitionLeaseResult(
    val scope: JarvisContextScope?,
    val leaseId: String?,
    val leasedAt: Long?,
    val expiresAt: Long?,
    val transitions: List<JarvisTransitionEnvelope>,
    val pending: Int,
    val available: Int,
    val nextLeaseExpiryAt: Long?,
)

internal data class JarvisTransitionAckResult(
    val scope: JarvisContextScope,
    val leaseId: String,
    val acknowledgedIds: List<String>,
    val alreadyAcknowledgedIds: List<String>,
    val rejectedIds: List<String>,
    val pending: Int,
    val available: Int,
    val nextLeaseExpiryAt: Long?,
)

internal data class JarvisEraseAllResult(
    val scope: JarvisContextScope,
    val hadLocalState: Boolean,
    val platformCleanup: String,
)

internal data class JarvisLeaseMutation(
    val transitions: List<JarvisTransitionEnvelope>,
    val result: JarvisTransitionLeaseResult,
    val changed: Boolean,
)

internal data class JarvisAckMutation(
    val transitions: List<JarvisTransitionEnvelope>,
    val acknowledgements: List<JarvisTransitionAcknowledgement>,
    val acknowledgedIds: List<String>,
    val alreadyAcknowledgedIds: List<String>,
    val rejectedIds: List<String>,
    val changed: Boolean,
)

internal data class JarvisBusyInterval(
    val startAt: Long,
    val endAt: Long,
    val allDay: Boolean,
)

internal fun jarvisTransitionIdentity(geofenceId: String, transition: String, occurredAt: Long): String =
    digestIdentity("ctx-", "$geofenceId\u0000$transition\u0000$occurredAt")

internal fun jarvisContextScopeIdentity(scope: JarvisContextScope?): String = digestIdentity(
    "scope-",
    listOf(
        scope?.principalId.orEmpty(),
        scope?.deviceId.orEmpty(),
        scope?.generation?.toString().orEmpty(),
    ).joinToString("\u0000"),
)

internal fun jarvisPlatformGeofenceIdentity(
    scope: JarvisContextScope?,
    configurationGeneration: Long,
    geofenceId: String,
): String = digestIdentity(
    "jctx-",
    listOf(
        scope?.principalId.orEmpty(),
        scope?.deviceId.orEmpty(),
        scope?.generation?.toString().orEmpty(),
        configurationGeneration.toString(),
        geofenceId,
    ).joinToString("\u0000"),
)

private fun digestIdentity(prefix: String, payload: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
        .digest(payload.toByteArray(StandardCharsets.UTF_8))
    return prefix + digest.take(16).joinToString("") { byte -> "%02x".format(byte) }
}

internal fun canonicalizeTransitions(
    transitions: List<JarvisTransitionEnvelope>,
): List<JarvisTransitionEnvelope> = buildList {
    val identities = mutableSetOf<String>()
    transitions.forEach { transition ->
        val identity = jarvisTransitionIdentity(
            transition.geofenceId,
            transition.transition,
            transition.occurredAt,
        )
        if (identities.add(identity)) add(transition.copy(id = identity))
    }
}

internal fun leaseTransitionBatch(
    transitions: List<JarvisTransitionEnvelope>,
    scope: JarvisContextScope?,
    requestId: String,
    newLeaseId: String,
    now: Long,
    leaseDurationMs: Long,
    limit: Int,
): JarvisLeaseMutation {
    val activeRetry = transitions.filter {
        it.leaseRequestId == requestId &&
            it.leaseId != null &&
            (it.leaseExpiresAt ?: Long.MIN_VALUE) > now
    }
    if (activeRetry.isNotEmpty()) {
        val leaseId = activeRetry.first().leaseId
        val consistent = activeRetry.filter { it.leaseId == leaseId }
        return JarvisLeaseMutation(
            transitions = transitions,
            result = leaseResult(scope, consistent, transitions, now),
            changed = false,
        )
    }

    val selectedIds = transitions.asSequence()
        .filter { (it.leaseExpiresAt ?: Long.MIN_VALUE) <= now }
        .take(limit)
        .mapTo(linkedSetOf()) { it.id }
    if (selectedIds.isEmpty()) {
        return JarvisLeaseMutation(
            transitions = transitions,
            result = leaseResult(scope, emptyList(), transitions, now),
            changed = false,
        )
    }

    val expiresAt = if (Long.MAX_VALUE - now < leaseDurationMs) Long.MAX_VALUE else now + leaseDurationMs
    val updated = transitions.map { transition ->
        if (!selectedIds.contains(transition.id)) transition else transition.copy(
            leaseId = newLeaseId,
            leaseRequestId = requestId,
            leasedAt = now,
            leaseExpiresAt = expiresAt,
            deliveryAttempt = if (transition.deliveryAttempt == Int.MAX_VALUE) Int.MAX_VALUE else
                transition.deliveryAttempt + 1,
        )
    }
    val leased = updated.filter { selectedIds.contains(it.id) }
    return JarvisLeaseMutation(
        transitions = updated,
        result = leaseResult(scope, leased, updated, now),
        changed = true,
    )
}

internal fun acknowledgeTransitionBatch(
    transitions: List<JarvisTransitionEnvelope>,
    acknowledgements: List<JarvisTransitionAcknowledgement>,
    leaseId: String,
    transitionIds: List<String>,
    now: Long,
): JarvisAckMutation {
    val requested = transitionIds.distinct()
    val existing = acknowledgements.asSequence()
        .filter { it.leaseId == leaseId }
        .mapTo(mutableSetOf()) { it.transitionId }
    val byId = transitions.associateBy { it.id }
    val acknowledged = mutableListOf<String>()
    val alreadyAcknowledged = mutableListOf<String>()
    val rejected = mutableListOf<String>()
    val newlyAcknowledged = mutableSetOf<String>()

    requested.forEach { transitionId ->
        when {
            existing.contains(transitionId) -> {
                acknowledged.add(transitionId)
                alreadyAcknowledged.add(transitionId)
            }
            byId[transitionId]?.leaseId == leaseId -> {
                acknowledged.add(transitionId)
                newlyAcknowledged.add(transitionId)
            }
            else -> rejected.add(transitionId)
        }
    }

    if (newlyAcknowledged.isEmpty()) {
        return JarvisAckMutation(
            transitions,
            acknowledgements,
            acknowledged,
            alreadyAcknowledged,
            rejected,
            false,
        )
    }
    val nextAcknowledgements = (acknowledgements + newlyAcknowledged.map { transitionId ->
        JarvisTransitionAcknowledgement(leaseId, transitionId, now)
    }).takeLast(JARVIS_CONTEXT_MAX_ACKNOWLEDGEMENTS)
    return JarvisAckMutation(
        transitions = transitions.filterNot { newlyAcknowledged.contains(it.id) },
        acknowledgements = nextAcknowledgements,
        acknowledgedIds = acknowledged,
        alreadyAcknowledgedIds = alreadyAcknowledged,
        rejectedIds = rejected,
        changed = true,
    )
}

internal fun transitionAvailability(
    transitions: List<JarvisTransitionEnvelope>,
    now: Long,
): Pair<Int, Long?> {
    val available = transitions.count { (it.leaseExpiresAt ?: Long.MIN_VALUE) <= now }
    val nextExpiry = transitions.asSequence()
        .mapNotNull { it.leaseExpiresAt }
        .filter { it > now }
        .minOrNull()
    return available to nextExpiry
}

private fun leaseResult(
    scope: JarvisContextScope?,
    leased: List<JarvisTransitionEnvelope>,
    allTransitions: List<JarvisTransitionEnvelope>,
    now: Long,
): JarvisTransitionLeaseResult {
    val (available, nextExpiry) = transitionAvailability(allTransitions, now)
    return JarvisTransitionLeaseResult(
        scope = scope,
        leaseId = leased.firstOrNull()?.leaseId,
        leasedAt = leased.firstOrNull()?.leasedAt,
        expiresAt = leased.firstOrNull()?.leaseExpiresAt,
        transitions = leased,
        pending = allTransitions.size,
        available = available,
        nextLeaseExpiryAt = nextExpiry,
    )
}

internal fun nextJarvisConfigurationGeneration(current: Long): Long =
    if (current < 0L || current >= JARVIS_CONTEXT_MAX_SAFE_INTEGER) 1L else current + 1L

internal fun mergeBusyIntervals(intervals: List<JarvisBusyInterval>): List<JarvisBusyInterval> {
    val merged = mutableListOf<JarvisBusyInterval>()
    intervals.sortedBy { it.startAt }.forEach { interval ->
        val previous = merged.lastOrNull()
        if (previous != null && interval.startAt <= previous.endAt) {
            merged[merged.lastIndex] = JarvisBusyInterval(
                startAt = previous.startAt,
                endAt = maxOf(previous.endAt, interval.endAt),
                // A merged block is all-day only when every contributing event is all-day.
                allDay = previous.allDay && interval.allDay,
            )
        } else {
            merged.add(interval)
        }
    }
    return merged
}
