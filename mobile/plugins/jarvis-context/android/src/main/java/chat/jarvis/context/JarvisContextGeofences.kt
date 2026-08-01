package chat.jarvis.context

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit

internal object JarvisContextGeofences {
    fun googlePlayServicesAvailable(context: Context): Boolean =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

    @Suppress("DEPRECATION")
    fun backgroundBuildEnabled(context: Context): Boolean {
        val requested = runCatching {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
                .requestedPermissions
        }.getOrNull() ?: return false
        return requested.contains(BACKGROUND_LOCATION_PERMISSION)
    }

    fun foregroundPermissionGranted(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun finePermissionGranted(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun backgroundPermissionGranted(context: Context): Boolean {
        if (!backgroundBuildEnabled(context)) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return foregroundPermissionGranted(context)
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun pendingIntent(context: Context): PendingIntent {
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
        return PendingIntent.getBroadcast(
            context,
            8241,
            Intent(context, JarvisContextGeofenceReceiver::class.java),
            flags,
        )
    }

    @SuppressLint("MissingPermission")
    fun registerBlocking(context: Context, snapshot: JarvisGeofenceSnapshot) {
        if (snapshot.geofences.isEmpty()) return
        if (!finePermissionGranted(context) || !backgroundPermissionGranted(context)) {
            throw SecurityException("Precise and background location permissions are required")
        }
        val platformGeofences = snapshot.geofences.map { managed ->
            var transitions = 0
            if (managed.notifyOnEntry) transitions = transitions or Geofence.GEOFENCE_TRANSITION_ENTER
            if (managed.notifyOnExit) transitions = transitions or Geofence.GEOFENCE_TRANSITION_EXIT
            Geofence.Builder()
                .setRequestId(jarvisPlatformGeofenceIdentity(snapshot.scope, snapshot.generation, managed.id))
                .setCircularRegion(managed.latitude, managed.longitude, managed.radiusM)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(transitions)
                .build()
        }
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(0)
            .addGeofences(platformGeofences)
            .build()
        Tasks.await(
            LocationServices.getGeofencingClient(context).addGeofences(request, pendingIntent(context)),
            GEOFENCE_OPERATION_TIMEOUT_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    fun removeAllBlocking(context: Context) {
        Tasks.await(
            LocationServices.getGeofencingClient(context).removeGeofences(pendingIntent(context)),
            GEOFENCE_OPERATION_TIMEOUT_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    fun removeBlocking(context: Context, ids: List<String>) {
        if (ids.isEmpty()) return
        Tasks.await(
            LocationServices.getGeofencingClient(context).removeGeofences(ids),
            GEOFENCE_OPERATION_TIMEOUT_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    private const val BACKGROUND_LOCATION_PERMISSION = "android.permission.ACCESS_BACKGROUND_LOCATION"
    private const val GEOFENCE_OPERATION_TIMEOUT_SECONDS = 30L
}
