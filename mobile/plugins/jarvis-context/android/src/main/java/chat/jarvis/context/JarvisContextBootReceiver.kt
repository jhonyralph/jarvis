package chat.jarvis.context

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.ExistingWorkPolicy
import androidx.work.BackoffPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

internal object JarvisContextRearmScheduler {
    private const val REARM_WORK = "jarvis-context-rearm"

    fun enqueue(context: Context, replace: Boolean = false) {
        val request = OneTimeWorkRequest.Builder(JarvisContextRearmWorker::class.java)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            REARM_WORK,
            if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun cancelBlocking(context: Context): Boolean = runCatching {
        WorkManager.getInstance(context.applicationContext)
            .cancelUniqueWork(REARM_WORK)
            .result
            .get(30, TimeUnit.SECONDS)
        true
    }.getOrDefault(false)
}

class JarvisContextBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        JarvisContextRearmScheduler.enqueue(context, replace = true)
    }
}

class JarvisContextRearmWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : Worker(appContext, parameters) {
    override fun doWork(): Result = when (JarvisContextGeofenceCoordinator.reconcileBlocking(applicationContext)) {
        JarvisReconcileResult.SUCCESS -> Result.success()
        JarvisReconcileResult.RETRY -> Result.retry()
    }
}
