package chat.jarvis.context

import android.annotation.SuppressLint
import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

internal class JarvisContextScopeMismatchException : IllegalStateException(
    "Native context state belongs to a different principal, device, or authorization generation",
)

internal class JarvisStaleContextException : IllegalStateException(
    "Native context callback belongs to a stale configuration generation",
)

/**
 * Sensitive context state lives under noBackupFilesDir. The legacy SharedPreferences migration is
 * deliberately one-way and clears the backed-up source only after the atomic destination write.
 */
internal class JarvisContextStore(context: Context, migrateLegacy: Boolean = true) {
    private val applicationContext = context.applicationContext
    private val stateFile = File(applicationContext.noBackupFilesDir, STATE_FILE)
    private val atomicFile = AtomicFile(stateFile)
    private var migrationError: Throwable? = null

    init {
        if (migrateLegacy) synchronized(LOCK) {
            migrationError = runCatching { migrateLegacyState() }.exceptionOrNull()
        }
    }

    fun snapshot(): JarvisGeofenceSnapshot = synchronized(LOCK) { readState().snapshot() }

    fun snapshotForCaller(expectedScope: JarvisContextScope?): JarvisGeofenceSnapshot = synchronized(LOCK) {
        val state = readState()
        requireCallerScope(state, expectedScope)
        state.snapshot()
    }

    fun geofences(): List<JarvisManagedGeofence> = snapshot().geofences

    fun prepareGeofenceReplacement(
        geofences: List<JarvisManagedGeofence>,
        requestedScope: JarvisContextScope?,
    ): JarvisGeofenceReplacement = synchronized(LOCK) {
        val current = readState()
        val desiredScope = mutationScope(current, requestedScope)
        JarvisGeofenceReplacement(
            previous = current.snapshot(),
            desired = JarvisGeofenceSnapshot(
                generation = nextJarvisConfigurationGeneration(current.generation),
                geofences = geofences,
                scope = desiredScope,
            ),
        )
    }

    fun commitGeofenceReplacement(replacement: JarvisGeofenceReplacement): JarvisGeofenceSnapshot =
        synchronized(LOCK) {
            val current = readState()
            if (current.generation != replacement.previous.generation ||
                current.scope != replacement.previous.scope
            ) {
                throw JarvisStaleContextException()
            }
            val desired = replacement.desired
            val scopeChanged = current.scope != desired.scope
            val next = current.copy(
                generation = desired.generation,
                geofences = desired.geofences,
                scope = desired.scope,
                // Legacy unscoped delivery state cannot be attributed to a newly authenticated principal.
                transitions = if (scopeChanged) emptyList() else current.transitions,
                seenTransitionIds = if (scopeChanged) emptyList() else current.seenTransitionIds,
                acknowledgements = if (scopeChanged) emptyList() else current.acknowledgements,
            )
            writeState(next)
            next.snapshot()
        }

    fun removeGeofences(
        ids: Set<String>,
        requestedScope: JarvisContextScope?,
    ): JarvisGeofenceReplacement = synchronized(LOCK) {
        val current = readState()
        val desiredScope = mutationScope(current, requestedScope)
        val remaining = current.geofences.filterNot { ids.contains(it.id) }
        if (remaining == current.geofences && desiredScope == current.scope) {
            return@synchronized JarvisGeofenceReplacement(current.snapshot(), current.snapshot())
        }
        val replacement = JarvisGeofenceReplacement(
            previous = current.snapshot(),
            desired = JarvisGeofenceSnapshot(
                generation = nextJarvisConfigurationGeneration(current.generation),
                geofences = remaining,
                scope = desiredScope,
            ),
        )
        val scopeChanged = current.scope != desiredScope
        val next = current.copy(
            generation = replacement.desired.generation,
            geofences = remaining,
            scope = desiredScope,
            transitions = if (scopeChanged) emptyList() else current.transitions,
            seenTransitionIds = if (scopeChanged) emptyList() else current.seenTransitionIds,
            acknowledgements = if (scopeChanged) emptyList() else current.acknowledgements,
        )
        writeState(next)
        replacement
    }

    fun enqueueTransition(
        geofenceId: String,
        transition: String,
        occurredAt: Long,
        expectedGeneration: Long,
        expectedScope: JarvisContextScope?,
    ): JarvisEnqueueResult = synchronized(LOCK) {
        val current = readState()
        if (current.generation != expectedGeneration || current.scope != expectedScope ||
            current.geofences.none { it.id == geofenceId }
        ) {
            throw JarvisStaleContextException()
        }
        val identity = jarvisTransitionIdentity(geofenceId, transition, occurredAt)
        if (current.seenTransitionIds.contains(identity)) {
            return@synchronized JarvisEnqueueResult(current.transitions.size, false)
        }
        if (current.transitions.size >= JARVIS_CONTEXT_MAX_TRANSITIONS) {
            // Never evict an event that the Hub has not acknowledged.
            return@synchronized JarvisEnqueueResult(current.transitions.size, false, retryRequired = true)
        }
        val transitions = current.transitions + JarvisTransitionEnvelope(
            id = identity,
            geofenceId = geofenceId,
            transition = transition,
            occurredAt = occurredAt,
            recordedAt = System.currentTimeMillis(),
        )
        val seen = (current.seenTransitionIds + identity).takeLast(JARVIS_CONTEXT_MAX_SEEN_TRANSITIONS)
        writeState(current.copy(transitions = transitions, seenTransitionIds = seen))
        JarvisEnqueueResult(transitions.size, true)
    }

    fun pendingTransitions(): Int = synchronized(LOCK) { readState().transitions.size }

    fun transitionAvailability(now: Long): Pair<Int, Long?> = synchronized(LOCK) {
        transitionAvailability(readState().transitions, now)
    }

    fun leaseTransitions(
        expectedScope: JarvisContextScope?,
        requestId: String,
        leaseId: String,
        limit: Int,
        leaseDurationMs: Long,
        now: Long,
    ): JarvisTransitionLeaseResult = synchronized(LOCK) {
        val current = readState()
        requireCallerScope(current, expectedScope)
        val mutation = leaseTransitionBatch(
            transitions = current.transitions,
            scope = current.scope,
            requestId = requestId,
            newLeaseId = leaseId,
            now = now,
            leaseDurationMs = leaseDurationMs,
            limit = limit,
        )
        if (mutation.changed) writeState(current.copy(transitions = mutation.transitions))
        mutation.result
    }

    fun acknowledgeTransitions(
        expectedScope: JarvisContextScope,
        leaseId: String,
        transitionIds: List<String>,
        now: Long,
    ): JarvisTransitionAckResult = synchronized(LOCK) {
        val current = readState()
        requireCallerScope(current, expectedScope)
        val mutation = acknowledgeTransitionBatch(
            transitions = current.transitions,
            acknowledgements = current.acknowledgements,
            leaseId = leaseId,
            transitionIds = transitionIds,
            now = now,
        )
        if (mutation.changed) {
            writeState(current.copy(
                transitions = mutation.transitions,
                acknowledgements = mutation.acknowledgements,
            ))
        }
        val (available, nextExpiry) = transitionAvailability(mutation.transitions, now)
        JarvisTransitionAckResult(
            scope = expectedScope,
            leaseId = leaseId,
            acknowledgedIds = mutation.acknowledgedIds,
            alreadyAcknowledgedIds = mutation.alreadyAcknowledgedIds,
            rejectedIds = mutation.rejectedIds,
            pending = mutation.transitions.size,
            available = available,
            nextLeaseExpiryAt = nextExpiry,
        )
    }

    /**
     * Deletes the atomic state (including leases), legacy preferences, and any interrupted backup.
     * Corrupt state is still erasable; readable state owned by another scope is the sole mismatch.
     */
    fun eraseAll(expectedScope: JarvisContextScope): Boolean = synchronized(LOCK) {
        val legacy = applicationContext.getSharedPreferences(LEGACY_PREFERENCES, Context.MODE_PRIVATE)
        val hadLocalState = atomicStateExists() || legacy.all.isNotEmpty() ||
            LEGACY_STATE_FILES.any { File(applicationContext.noBackupFilesDir, it).exists() }
        if (atomicStateExists()) {
            runCatching { readState() }.getOrNull()?.let { state ->
                if (state.scope != null && state.scope != expectedScope) throw JarvisContextScopeMismatchException()
            }
        }

        val failures = mutableListOf<Throwable>()
        runCatching { atomicFile.delete() }.onFailure { failures.add(it) }
        LEGACY_STATE_FILES.forEach { name ->
            val file = File(applicationContext.noBackupFilesDir, name)
            runCatching {
                check(!file.exists() || file.delete()) { "Failed to delete $name" }
            }.onFailure { failures.add(it) }
        }
        runCatching {
            if (legacy.all.isNotEmpty()) clearLegacyPreferences(legacy)
        }.onFailure { failures.add(it) }
        // Always attempt file deletion even when SharedPreferences.commit() failed.
        runCatching { applicationContext.deleteSharedPreferences(LEGACY_PREFERENCES) }
            .onFailure { failures.add(it) }

        val legacyRemaining = runCatching { legacy.all.isNotEmpty() }.getOrElse { error ->
            failures.add(error)
            true
        }
        if (atomicStateExists() || legacyRemaining ||
            LEGACY_STATE_FILES.any { File(applicationContext.noBackupFilesDir, it).exists() }
        ) {
            // If deletion is unavailable, an empty scoped tombstone still prevents boot rearm/data delivery.
            runCatching { writeState(State(scope = expectedScope)) }.onFailure { failures.add(it) }
            throw IllegalStateException("Failed to erase Jarvis context local storage", failures.firstOrNull())
        }
        hadLocalState
    }

    private fun requireCallerScope(state: State, expectedScope: JarvisContextScope?) {
        if (state.scope != expectedScope) throw JarvisContextScopeMismatchException()
    }

    private fun mutationScope(state: State, requestedScope: JarvisContextScope?): JarvisContextScope? {
        if (state.scope != null && state.scope != requestedScope) throw JarvisContextScopeMismatchException()
        if (requestedScope == null) return null
        return requestedScope
    }

    private fun readState(): State {
        migrationError?.let { error ->
            val legacy = applicationContext.getSharedPreferences(LEGACY_PREFERENCES, Context.MODE_PRIVATE)
            if (legacy.all.isNotEmpty()) {
                throw IllegalStateException("Legacy Jarvis context state is unreadable; refusing to overwrite it", error)
            }
            // A successful erase or later migration removed the residue; this long-lived instance can recover.
            migrationError = null
        }
        if (!atomicStateExists()) return State()
        return runCatching {
            val root = atomicFile.openRead().use { input -> JSONObject(input.readBytes().toString(Charsets.UTF_8)) }
            val version = root.optInt("version", LEGACY_STATE_VERSION)
            require(version in setOf(LEGACY_STATE_VERSION, STATE_VERSION)) { "Unsupported Jarvis context state" }
            val transitions = decodeTransitions(root.optJSONArray("transitions"))
            val seen = (decodeStrings(root.optJSONArray("seenTransitionIds")) + transitions.map { it.id })
                .distinct()
            State(
                generation = root.optLong("generation", 0L).coerceIn(0L, JARVIS_CONTEXT_MAX_SAFE_INTEGER),
                scope = decodeScope(root.optJSONObject("scope")),
                geofences = decodeGeofences(root.optJSONArray("geofences")),
                transitions = transitions,
                seenTransitionIds = seen.takeLast(JARVIS_CONTEXT_MAX_SEEN_TRANSITIONS),
                acknowledgements = decodeAcknowledgements(root.optJSONArray("acknowledgements"))
                    .takeLast(JARVIS_CONTEXT_MAX_ACKNOWLEDGEMENTS),
            )
        }.getOrElse { error ->
            throw IllegalStateException("Jarvis context state is unreadable; refusing to overwrite it", error)
        }
    }

    private fun writeState(state: State) {
        val root = JSONObject()
            .put("version", STATE_VERSION)
            .put("generation", state.generation)
            .put("geofences", encodeGeofences(state.geofences))
            .put("transitions", encodeTransitions(state.transitions))
            .put("seenTransitionIds", JSONArray(state.seenTransitionIds))
            .put("acknowledgements", encodeAcknowledgements(state.acknowledgements))
        state.scope?.let { root.put("scope", encodeScope(it)) }
        stateFile.parentFile?.mkdirs()
        val output = atomicFile.startWrite()
        try {
            output.write(root.toString().toByteArray(Charsets.UTF_8))
            output.flush()
            atomicFile.finishWrite(output)
        } catch (error: Throwable) {
            atomicFile.failWrite(output)
            throw IllegalStateException("Failed to persist Jarvis context state", error)
        }
    }

    private fun migrateLegacyState() {
        val legacy = applicationContext.getSharedPreferences(LEGACY_PREFERENCES, Context.MODE_PRIVATE)
        val legacyGeofences = legacy.getString(LEGACY_KEY_GEOFENCES, null)
        val legacyTransitions = legacy.getString(LEGACY_KEY_TRANSITIONS, null)
        if (!atomicStateExists() && (!legacyGeofences.isNullOrBlank() || !legacyTransitions.isNullOrBlank())) {
            val transitions = decodeTransitions(legacyTransitions?.let(::JSONArray))
            writeState(
                State(
                    geofences = decodeGeofences(legacyGeofences?.let(::JSONArray)),
                    transitions = transitions,
                    seenTransitionIds = transitions.map { it.id },
                ),
            )
        }
        if (legacy.all.isNotEmpty()) clearLegacyPreferences(legacy)
        applicationContext.deleteSharedPreferences(LEGACY_PREFERENCES)
    }

    @SuppressLint("ApplySharedPref")
    private fun clearLegacyPreferences(preferences: android.content.SharedPreferences) {
        check(preferences.edit().clear().commit()) { "Failed to clear legacy Jarvis context preferences" }
    }

    private fun encodeScope(scope: JarvisContextScope): JSONObject = JSONObject()
        .put("principalId", scope.principalId)
        .put("deviceId", scope.deviceId)
        .put("generation", scope.generation)

    private fun decodeScope(data: JSONObject?): JarvisContextScope? {
        if (data == null) return null
        val scope = JarvisContextScope(
            principalId = data.getString("principalId"),
            deviceId = data.getString("deviceId"),
            generation = data.getLong("generation"),
        )
        require(isValidJarvisContextScope(scope)) { "Invalid Jarvis context scope" }
        return scope
    }

    private fun encodeGeofences(geofences: List<JarvisManagedGeofence>): JSONArray = JSONArray().also { data ->
        geofences.forEach { geofence ->
            data.put(
                JSONObject()
                    .put("id", geofence.id)
                    .put("latitude", geofence.latitude)
                    .put("longitude", geofence.longitude)
                    .put("radiusM", geofence.radiusM.toDouble())
                    .put("notifyOnEntry", geofence.notifyOnEntry)
                    .put("notifyOnExit", geofence.notifyOnExit),
            )
        }
    }

    private fun encodeTransitions(transitions: List<JarvisTransitionEnvelope>): JSONArray = JSONArray().also { data ->
        transitions.forEach { transition ->
            val item = JSONObject()
                .put("id", transition.id)
                .put("geofenceId", transition.geofenceId)
                .put("transition", transition.transition)
                .put("occurredAt", transition.occurredAt)
                .put("recordedAt", transition.recordedAt)
                .put("deliveryAttempt", transition.deliveryAttempt)
            transition.leaseId?.let { item.put("leaseId", it) }
            transition.leaseRequestId?.let { item.put("leaseRequestId", it) }
            transition.leasedAt?.let { item.put("leasedAt", it) }
            transition.leaseExpiresAt?.let { item.put("leaseExpiresAt", it) }
            data.put(item)
        }
    }

    private fun encodeAcknowledgements(
        acknowledgements: List<JarvisTransitionAcknowledgement>,
    ): JSONArray = JSONArray().also { data ->
        acknowledgements.forEach { acknowledgement ->
            data.put(JSONObject()
                .put("leaseId", acknowledgement.leaseId)
                .put("transitionId", acknowledgement.transitionId)
                .put("acknowledgedAt", acknowledgement.acknowledgedAt))
        }
    }

    private fun decodeGeofences(data: JSONArray?): List<JarvisManagedGeofence> {
        if (data == null) return emptyList()
        return buildList {
            for (index in 0 until data.length()) {
                val item = data.getJSONObject(index)
                add(
                    JarvisManagedGeofence(
                        id = item.getString("id"),
                        latitude = item.getDouble("latitude"),
                        longitude = item.getDouble("longitude"),
                        radiusM = item.getDouble("radiusM").toFloat(),
                        notifyOnEntry = item.optBoolean("notifyOnEntry", true),
                        notifyOnExit = item.optBoolean("notifyOnExit", true),
                    ),
                )
            }
        }
    }

    private fun decodeTransitions(data: JSONArray?): List<JarvisTransitionEnvelope> {
        if (data == null) return emptyList()
        return canonicalizeTransitions(buildList {
            for (index in 0 until data.length()) {
                val item = data.getJSONObject(index)
                add(
                    JarvisTransitionEnvelope(
                        id = item.getString("id"),
                        geofenceId = item.getString("geofenceId"),
                        transition = item.getString("transition"),
                        occurredAt = item.getLong("occurredAt"),
                        recordedAt = item.getLong("recordedAt"),
                        leaseId = item.optString("leaseId").takeIf { it.isNotEmpty() },
                        leaseRequestId = item.optString("leaseRequestId").takeIf { it.isNotEmpty() },
                        leasedAt = item.optLongOrNull("leasedAt"),
                        leaseExpiresAt = item.optLongOrNull("leaseExpiresAt"),
                        deliveryAttempt = item.optInt("deliveryAttempt", 0).coerceAtLeast(0),
                    ),
                )
            }
        })
    }

    private fun decodeAcknowledgements(data: JSONArray?): List<JarvisTransitionAcknowledgement> {
        if (data == null) return emptyList()
        return buildList {
            for (index in 0 until data.length()) {
                val item = data.getJSONObject(index)
                add(JarvisTransitionAcknowledgement(
                    leaseId = item.getString("leaseId"),
                    transitionId = item.getString("transitionId"),
                    acknowledgedAt = item.getLong("acknowledgedAt"),
                ))
            }
        }.distinctBy { it.leaseId to it.transitionId }
    }

    private fun decodeStrings(data: JSONArray?): List<String> {
        if (data == null) return emptyList()
        return buildList {
            for (index in 0 until data.length()) add(data.getString(index))
        }.distinct()
    }

    private fun JSONObject.optLongOrNull(name: String): Long? =
        if (has(name) && !isNull(name)) getLong(name) else null

    private fun atomicStateExists(): Boolean =
        stateFile.exists() || File("${stateFile.path}.bak").exists()

    private data class State(
        val generation: Long = 0L,
        val scope: JarvisContextScope? = null,
        val geofences: List<JarvisManagedGeofence> = emptyList(),
        val transitions: List<JarvisTransitionEnvelope> = emptyList(),
        val seenTransitionIds: List<String> = emptyList(),
        val acknowledgements: List<JarvisTransitionAcknowledgement> = emptyList(),
    ) {
        fun snapshot() = JarvisGeofenceSnapshot(generation, geofences, scope)
    }

    private companion object {
        const val LEGACY_STATE_VERSION = 2
        const val STATE_VERSION = 3
        const val STATE_FILE = "jarvis_context_state_v2.json"
        val LEGACY_STATE_FILES = listOf("jarvis_context_state_v1.json")
        const val LEGACY_PREFERENCES = "jarvis_context"
        const val LEGACY_KEY_GEOFENCES = "geofences_v1"
        const val LEGACY_KEY_TRANSITIONS = "transitions_v1"
        val LOCK = Any()
    }
}
