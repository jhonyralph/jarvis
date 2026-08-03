package chat.jarvis.context

import android.content.Context
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

internal class JarvisContextOperationException(
    val code: String,
    message: String,
    cause: Throwable? = null,
) : IllegalStateException(message, cause)

internal enum class JarvisReconcileResult {
    SUCCESS,
    RETRY,
}

/** Serializes every mutation, revoke, and rearm against one process-wide executor. */
internal object JarvisContextGeofenceCoordinator {
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "jarvis-context-geofences").apply { isDaemon = true }
    }

    fun replace(
        context: Context,
        configured: List<JarvisManagedGeofence>,
        scope: JarvisContextScope?,
        completion: (Result<JarvisGeofenceSnapshot>) -> Unit,
    ) {
        val applicationContext = context.applicationContext
        executor.execute {
            completion(runCatching { replaceBlocking(applicationContext, configured, scope) })
        }
    }

    fun remove(
        context: Context,
        ids: Set<String>,
        scope: JarvisContextScope?,
        completion: (Result<JarvisGeofenceSnapshot>) -> Unit,
    ) {
        val applicationContext = context.applicationContext
        executor.execute {
            completion(runCatching { removeBlocking(applicationContext, ids, scope) })
        }
    }

    fun eraseAll(
        context: Context,
        scope: JarvisContextScope,
        completion: (Result<JarvisEraseAllResult>) -> Unit,
    ) {
        val applicationContext = context.applicationContext
        executor.execute {
            completion(runCatching { eraseAllBlocking(applicationContext, scope) })
        }
    }

    fun reconcileBlocking(context: Context): JarvisReconcileResult = runCatching {
        executor.submit<JarvisReconcileResult> { reconcileSerialized(context.applicationContext) }
            .get(RECONCILE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    }.getOrDefault(JarvisReconcileResult.RETRY)

    private fun replaceBlocking(
        context: Context,
        configured: List<JarvisManagedGeofence>,
        scope: JarvisContextScope?,
    ): JarvisGeofenceSnapshot {
        val store = JarvisContextStore(context)
        val replacement = store.prepareGeofenceReplacement(configured, scope)

        // Empty replacement is local-first and must not depend on Play Services or permissions.
        if (configured.isEmpty()) {
            val erased = store.commitGeofenceReplacement(replacement)
            if (!removeAllBestEffort(context)) JarvisContextRearmScheduler.enqueue(context)
            return erased
        }

        requireRegistrationAvailable(context)
        return try {
            JarvisContextGeofences.removeAllBlocking(context)
            JarvisContextGeofences.registerBlocking(context, replacement.desired)
            store.commitGeofenceReplacement(replacement)
        } catch (error: Throwable) {
            val rollback = rollbackPlatform(context, replacement.previous)
            val code = if (rollback) "GEOFENCE_CONFIGURATION_FAILED" else "GEOFENCE_ROLLBACK_FAILED"
            throw JarvisContextOperationException(
                code,
                if (rollback) "Geofence configuration failed and the previous set was restored" else
                    "Geofence configuration failed and platform rollback could not be confirmed",
                error,
            )
        }
    }

    private fun removeBlocking(
        context: Context,
        ids: Set<String>,
        scope: JarvisContextScope?,
    ): JarvisGeofenceSnapshot {
        val store = JarvisContextStore(context)
        val replacement = store.removeGeofences(ids, scope)
        if (replacement.previous == replacement.desired) return replacement.desired

        // Registration IDs include the configuration generation, so reconcile the complete set.
        val reconciled = reconcilePlatformBestEffort(context, replacement.desired)
        if (!reconciled) JarvisContextRearmScheduler.enqueue(context)
        return replacement.desired
    }

    private fun eraseAllBlocking(context: Context, scope: JarvisContextScope): JarvisEraseAllResult {
        // Erasure must not parse or migrate potentially corrupt legacy state before deleting it.
        val store = JarvisContextStore(context, migrateLegacy = false)
        // Privacy erasure wins first. Every delayed worker sees an empty store even if cancellation lags.
        val localErasure = runCatching { store.eraseAll(scope) }
        localErasure.exceptionOrNull()?.let { error ->
            if (error is JarvisContextScopeMismatchException) throw error
        }
        JarvisContextTransitionUploader.cancelAllBlocking(context)
        JarvisContextRearmScheduler.cancelBlocking(context)
        val platformRemoved = removeAllBestEffort(context)
        // Close the enqueue-after-cancel race without scheduling any cleanup/rearm work.
        JarvisContextTransitionUploader.cancelAllBlocking(context)
        JarvisContextRearmScheduler.cancelBlocking(context)
        val hadLocalState = localErasure.getOrThrow()
        return JarvisEraseAllResult(
            scope = scope,
            hadLocalState = hadLocalState,
            platformCleanup = if (platformRemoved) "confirmed" else "unavailable",
        )
    }

    private fun reconcileSerialized(context: Context): JarvisReconcileResult {
        repeat(MAX_RECONCILE_PASSES) {
            val store = JarvisContextStore(context)
            val desired = store.snapshot()
            if (!JarvisContextGeofences.googlePlayServicesAvailable(context)) {
                return JarvisReconcileResult.RETRY
            }

            if (desired.geofences.isEmpty()) {
                return if (runCatching { JarvisContextGeofences.removeAllBlocking(context) }.isSuccess) {
                    JarvisReconcileResult.SUCCESS
                } else {
                    JarvisReconcileResult.RETRY
                }
            }

            if (!registrationPermissionsAvailable(context)) {
                // Permission revocation makes the desired set inactive; remove stale platform state best effort.
                runCatching { JarvisContextGeofences.removeAllBlocking(context) }
                return JarvisReconcileResult.SUCCESS
            }

            val reconciled = runCatching {
                JarvisContextGeofences.removeAllBlocking(context)
                JarvisContextGeofences.registerBlocking(context, desired)
            }.isSuccess
            if (!reconciled) return JarvisReconcileResult.RETRY
            if (store.snapshot().generation == desired.generation && store.snapshot().scope == desired.scope) {
                return JarvisReconcileResult.SUCCESS
            }
        }
        return JarvisReconcileResult.RETRY
    }

    private fun requireRegistrationAvailable(context: Context) {
        when {
            !JarvisContextGeofences.backgroundBuildEnabled(context) -> throw JarvisContextOperationException(
                "BACKGROUND_UNAVAILABLE",
                "Background geofences are unavailable in this build",
            )
            !JarvisContextGeofences.finePermissionGranted(context) -> throw JarvisContextOperationException(
                "LOCATION_PERMISSION_REQUIRED",
                "Precise foreground location is required for geofences",
            )
            !JarvisContextGeofences.backgroundPermissionGranted(context) -> throw JarvisContextOperationException(
                "BACKGROUND_PERMISSION_REQUIRED",
                "Background location permission is required for geofences",
            )
            !JarvisContextGeofences.googlePlayServicesAvailable(context) -> throw JarvisContextOperationException(
                "GEOFENCING_UNAVAILABLE",
                "Google Play services geofencing is unavailable",
            )
        }
    }

    private fun registrationPermissionsAvailable(context: Context): Boolean =
        JarvisContextGeofences.backgroundBuildEnabled(context) &&
            JarvisContextGeofences.finePermissionGranted(context) &&
            JarvisContextGeofences.backgroundPermissionGranted(context)

    private fun rollbackPlatform(context: Context, previous: JarvisGeofenceSnapshot): Boolean {
        if (!JarvisContextGeofences.googlePlayServicesAvailable(context)) return false
        return runCatching {
            JarvisContextGeofences.removeAllBlocking(context)
            if (previous.geofences.isNotEmpty()) {
                requireRegistrationAvailable(context)
                JarvisContextGeofences.registerBlocking(context, previous)
            }
        }.isSuccess
    }

    private fun reconcilePlatformBestEffort(context: Context, desired: JarvisGeofenceSnapshot): Boolean {
        if (!JarvisContextGeofences.googlePlayServicesAvailable(context)) return false
        return runCatching {
            JarvisContextGeofences.removeAllBlocking(context)
            if (desired.geofences.isNotEmpty() && registrationPermissionsAvailable(context)) {
                JarvisContextGeofences.registerBlocking(context, desired)
            }
        }.isSuccess
    }

    private fun removeAllBestEffort(context: Context): Boolean {
        if (!JarvisContextGeofences.googlePlayServicesAvailable(context)) return false
        return runCatching { JarvisContextGeofences.removeAllBlocking(context) }.isSuccess
    }

    private const val MAX_RECONCILE_PASSES = 3
    private const val RECONCILE_TIMEOUT_SECONDS = 90L
}
