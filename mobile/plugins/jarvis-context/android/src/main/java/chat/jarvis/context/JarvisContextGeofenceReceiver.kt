package chat.jarvis.context

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent
import java.util.concurrent.Executors

class JarvisContextGeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null) return
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            if (event.errorCode == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) {
                JarvisContextRearmScheduler.enqueue(context, replace = true)
            }
            return
        }
        val transition = when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "enter"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "exit"
            else -> return
        }
        val occurredAt = System.currentTimeMillis()
        val triggering = event.triggeringGeofences.orEmpty()
        if (triggering.isEmpty()) return
        val pendingResult = goAsync()
        EXECUTOR.execute {
            try {
                val applicationContext = context.applicationContext
                val store = JarvisContextStore(applicationContext)
                val snapshot = store.snapshot()
                val configuredByPlatformId = snapshot.geofences.associateBy { geofence ->
                    jarvisPlatformGeofenceIdentity(snapshot.scope, snapshot.generation, geofence.id)
                }
                var pending = store.pendingTransitions()
                var changed = false
                triggering.forEach { geofence ->
                    val configured = configuredByPlatformId[geofence.requestId]
                    if (configured == null ||
                        !JarvisContextTransitionUploader.isValidInput(configured.id, transition, occurredAt)
                    ) {
                        return@forEach
                    }
                    runCatching {
                        store.enqueueTransition(
                            configured.id,
                            transition,
                            occurredAt,
                            snapshot.generation,
                            snapshot.scope,
                        )
                    }.onSuccess { result ->
                        pending = result.pending
                        if (result.inserted) {
                            changed = true
                        }
                        if (result.inserted || result.retryRequired) {
                            JarvisContextTransitionUploader.enqueue(
                                applicationContext,
                                snapshot,
                                configured.id,
                                transition,
                                occurredAt,
                            )
                        }
                    }
                }
                if (changed) {
                    val (available, nextExpiry) = store.transitionAvailability(System.currentTimeMillis())
                    applicationContext.sendBroadcast(
                        Intent(JARVIS_CONTEXT_ACTION_TRANSITIONS_AVAILABLE)
                            .setPackage(applicationContext.packageName)
                            .putExtra("pending", pending)
                            .putExtra("available", available)
                            .also { output -> nextExpiry?.let { output.putExtra("nextLeaseExpiryAt", it) } },
                    )
                }
            } finally {
                pendingResult.finish()
            }
        }
    }

    private companion object {
        val EXECUTOR = Executors.newSingleThreadExecutor()
    }
}
