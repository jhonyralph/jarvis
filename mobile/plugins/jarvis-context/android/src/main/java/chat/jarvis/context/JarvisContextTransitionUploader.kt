package chat.jarvis.context

import android.content.Context
import android.content.Intent
import androidx.work.BackoffPolicy
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Durable handoff to the authenticated web uploader. WorkManager input deliberately contains only
 * ownership/configuration identifiers plus a geofence id, transition, and occurrence time.
 */
internal object JarvisContextTransitionUploader {
    private const val KEY_GEOFENCE_ID = "geofenceId"
    private const val KEY_TRANSITION = "transition"
    private const val KEY_OCCURRED_AT = "occurredAt"
    private const val KEY_CONFIGURATION_GENERATION = "configurationGeneration"
    private const val KEY_SCOPE_IDENTITY = "scopeIdentity"
    private const val TRANSITION_WORK_TAG = "jarvis-context-transition"

    data class Input(
        val geofenceId: String,
        val transition: String,
        val occurredAt: Long,
        val configurationGeneration: Long,
        val scopeIdentity: String,
    )

    fun enqueue(
        context: Context,
        snapshot: JarvisGeofenceSnapshot,
        geofenceId: String,
        transition: String,
        occurredAt: Long,
    ) {
        if (!isValidInput(geofenceId, transition, occurredAt) || snapshot.generation <= 0L) return
        val builder = Data.Builder()
            .putString(KEY_GEOFENCE_ID, geofenceId)
            .putString(KEY_TRANSITION, transition)
            .putLong(KEY_OCCURRED_AT, occurredAt)
            .putLong(KEY_CONFIGURATION_GENERATION, snapshot.generation)
            .putString(KEY_SCOPE_IDENTITY, jarvisContextScopeIdentity(snapshot.scope))
        val request = OneTimeWorkRequest.Builder(JarvisContextTransitionUploadWorker::class.java)
            .setInputData(builder.build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(TRANSITION_WORK_TAG)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "jarvis-context-transition-${workIdentity(snapshot, geofenceId, transition, occurredAt)}",
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun readInput(input: Data): Input? {
        val geofenceId = input.getString(KEY_GEOFENCE_ID)?.trim().orEmpty()
        val transition = input.getString(KEY_TRANSITION)?.trim().orEmpty()
        val occurredAt = input.getLong(KEY_OCCURRED_AT, 0L)
        val configurationGeneration = input.getLong(KEY_CONFIGURATION_GENERATION, 0L)
        if (!isValidInput(geofenceId, transition, occurredAt) || configurationGeneration <= 0L) return null
        val scopeIdentity = input.getString(KEY_SCOPE_IDENTITY).orEmpty()
        if (!SCOPE_IDENTITY.matches(scopeIdentity)) return null
        return Input(geofenceId, transition, occurredAt, configurationGeneration, scopeIdentity)
    }

    fun isValidInput(geofenceId: String, transition: String, occurredAt: Long): Boolean =
        GEOFENCE_ID.matches(geofenceId) && transition in setOf("enter", "exit") && occurredAt > 0L

    fun cancelAllBlocking(context: Context): Boolean = runCatching {
        WorkManager.getInstance(context.applicationContext)
            .cancelAllWorkByTag(TRANSITION_WORK_TAG)
            .result
            .get(30, TimeUnit.SECONDS)
        true
    }.getOrDefault(false)

    private fun workIdentity(
        snapshot: JarvisGeofenceSnapshot,
        geofenceId: String,
        transition: String,
        occurredAt: Long,
    ): String = jarvisTransitionIdentity(
        jarvisPlatformGeofenceIdentity(snapshot.scope, snapshot.generation, geofenceId),
        transition,
        occurredAt,
    ).removePrefix("ctx-")

    private val GEOFENCE_ID = Regex("^[A-Za-z0-9._:-]{1,128}$")
    private val SCOPE_IDENTITY = Regex("^scope-[0-9a-f]{32}$")
}

class JarvisContextTransitionUploadWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : Worker(appContext, parameters) {
    override fun doWork(): Result {
        val input = JarvisContextTransitionUploader.readInput(inputData) ?: return Result.failure()
        return runCatching {
            val store = JarvisContextStore(applicationContext)
            val snapshot = store.snapshot()
            if (snapshot.generation != input.configurationGeneration ||
                jarvisContextScopeIdentity(snapshot.scope) != input.scopeIdentity
            ) {
                return Result.success()
            }
            val enqueue = store.enqueueTransition(
                geofenceId = input.geofenceId,
                transition = input.transition,
                occurredAt = input.occurredAt,
                expectedGeneration = input.configurationGeneration,
                expectedScope = snapshot.scope,
            )
            if (enqueue.retryRequired) return Result.retry()
            if (!enqueue.inserted && enqueue.pending == 0) return Result.success()
            val (available, nextExpiry) = store.transitionAvailability(System.currentTimeMillis())
            applicationContext.sendBroadcast(
                Intent(JARVIS_CONTEXT_ACTION_TRANSITIONS_AVAILABLE)
                    .setPackage(applicationContext.packageName)
                    .putExtra("pending", enqueue.pending)
                    .putExtra("available", available)
                    .also { intent -> nextExpiry?.let { intent.putExtra("nextLeaseExpiryAt", it) } },
            )
        }.fold(
            onSuccess = { Result.success() },
            onFailure = { error ->
                if (error is JarvisStaleContextException || error is JarvisContextScopeMismatchException) {
                    Result.success()
                } else {
                    Result.retry()
                }
            },
        )
    }
}
