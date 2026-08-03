package chat.jarvis.context

import android.Manifest
import android.app.ActivityManager
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONArray
import org.json.JSONObject
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.round

@CapacitorPlugin(
    name = "JarvisContext",
    permissions = [
        Permission(
            strings = [Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION],
            alias = "location",
        ),
        Permission(strings = [Manifest.permission.READ_CALENDAR], alias = "calendar"),
        Permission(strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION], alias = "backgroundLocation"),
    ],
)
class JarvisContextPlugin : Plugin() {
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var store: JarvisContextStore
    private var transitionReceiver: BroadcastReceiver? = null

    override fun load() {
        store = JarvisContextStore(context)
        transitionReceiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context?, intent: Intent?) {
                val storedPending = runCatching { store.pendingTransitions() }.getOrDefault(0)
                val pending = intent?.getIntExtra("pending", storedPending) ?: storedPending
                val availability = runCatching {
                    store.transitionAvailability(System.currentTimeMillis())
                }.getOrDefault(0 to null)
                val event = JSObject()
                    .put("pending", pending)
                    .put("available", intent?.getIntExtra("available", availability.first) ?: availability.first)
                val nextExpiry = if (intent?.hasExtra("nextLeaseExpiryAt") == true) {
                    intent.getLongExtra("nextLeaseExpiryAt", 0L).takeIf { it > 0L }
                } else {
                    availability.second
                }
                nextExpiry?.let { event.put("nextLeaseExpiryAt", it) }
                notifyListeners("transitionAvailable", event, true)
            }
        }
        ContextCompat.registerReceiver(
            context,
            transitionReceiver!!,
            IntentFilter(JARVIS_CONTEXT_ACTION_TRANSITIONS_AVAILABLE),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        if (runCatching { store.geofences().isNotEmpty() }.getOrDefault(false) &&
            JarvisContextGeofences.backgroundBuildEnabled(context)
        ) {
            JarvisContextRearmScheduler.enqueue(context)
        }
    }

    override fun handleOnDestroy() {
        transitionReceiver?.let { receiver -> runCatching { context.unregisterReceiver(receiver) } }
        transitionReceiver = null
        ioExecutor.shutdown()
    }

    @PluginMethod
    fun isSupported(call: PluginCall) {
        call.resolve(capabilities())
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(permissionStatus())
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val wantsBackground = call.getBoolean("backgroundLocation", false) == true
        val aliases = mutableListOf<String>()
        if ((call.getBoolean("location", false) == true || wantsBackground) && !foregroundLocationGranted()) {
            aliases.add("location")
        }
        if (call.getBoolean("calendar", false) == true && !calendarGranted()) aliases.add("calendar")
        if (aliases.isNotEmpty()) {
            requestPermissionForAliases(aliases.toTypedArray(), call, "foregroundPermissionsCallback")
            return
        }
        requestBackgroundIfNeeded(call)
    }

    @PermissionCallback
    private fun foregroundPermissionsCallback(call: PluginCall) {
        requestBackgroundIfNeeded(call)
    }

    @PermissionCallback
    private fun backgroundPermissionCallback(call: PluginCall) {
        call.resolve(permissionStatus())
    }

    private fun requestBackgroundIfNeeded(call: PluginCall) {
        if (call.getBoolean("backgroundLocation", false) != true) {
            call.resolve(permissionStatus())
            return
        }
        if (!JarvisContextGeofences.backgroundBuildEnabled(context) || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(permissionStatus())
            return
        }
        if (!JarvisContextGeofences.finePermissionGranted(context)) {
            call.resolve(permissionStatus())
            return
        }
        if (JarvisContextGeofences.backgroundPermissionGranted(context)) {
            call.resolve(permissionStatus())
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:${context.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { context.startActivity(intent) }
                .onSuccess {
                    call.resolve(
                        permissionStatus()
                            .put("settingsOpened", true)
                            .put("settingsReason", "backgroundLocation"),
                    )
                }
                .onFailure { error ->
                    call.reject(
                        "Could not open app settings for background location",
                        "SETTINGS_OPEN_FAILED",
                        error as? Exception ?: IllegalStateException("Could not open app settings", error),
                    )
                }
            return
        }
        requestPermissionForAlias("backgroundLocation", call, "backgroundPermissionCallback")
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun getCurrentLocation(call: PluginCall) {
        if (!appIsForeground()) {
            call.reject("Foreground location requires a visible app", "APP_NOT_FOREGROUND")
            return
        }
        if (!foregroundLocationGranted()) {
            call.reject("Foreground location permission is required", "LOCATION_PERMISSION_REQUIRED")
            return
        }
        if (!JarvisContextGeofences.googlePlayServicesAvailable(context)) {
            call.reject("Google Play services location is unavailable", "LOCATION_UNAVAILABLE")
            return
        }

        val requestedPrecision = call.getString("precision", "approximate")
        if (requestedPrecision !in setOf("approximate", "precise")) {
            call.reject("precision must be approximate or precise", "INVALID_OPTIONS")
            return
        }
        val maximumAgeMs = optionLong(call, "maximumAgeMs", 10_000L).coerceIn(0L, 300_000L)
        val timeoutMs = optionLong(call, "timeoutMs", 15_000L).coerceIn(1_000L, 60_000L)
        val ttlMs = optionLong(call, "ttlMs", 60_000L).coerceIn(1_000L, 900_000L)
        val precise = requestedPrecision == "precise" && JarvisContextGeofences.finePermissionGranted(context)
        val priority = if (precise) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
        val cancellation = CancellationTokenSource()
        val completed = AtomicBoolean(false)
        val timeout = Runnable {
            if (completed.compareAndSet(false, true)) {
                cancellation.cancel()
                call.reject("Timed out waiting for a foreground location", "LOCATION_TIMEOUT")
            }
        }
        mainHandler.postDelayed(timeout, timeoutMs)
        val locationTask = try {
            LocationServices.getFusedLocationProviderClient(context)
                .getCurrentLocation(priority, cancellation.token)
        } catch (error: SecurityException) {
            completed.set(true)
            mainHandler.removeCallbacks(timeout)
            call.reject("Foreground location permission was revoked", "LOCATION_PERMISSION_REQUIRED", error)
            return
        }
        locationTask
            .addOnSuccessListener { location ->
                if (!completed.compareAndSet(false, true)) return@addOnSuccessListener
                mainHandler.removeCallbacks(timeout)
                if (location == null) {
                    call.reject("No foreground location is currently available", "LOCATION_UNAVAILABLE")
                    return@addOnSuccessListener
                }
                if (!appIsForeground()) {
                    call.reject("The app left the foreground before location completed", "APP_NOT_FOREGROUND")
                    return@addOnSuccessListener
                }
                val now = System.currentTimeMillis()
                val observedAt = location.time.takeIf { it > 0L }?.coerceAtMost(now) ?: now
                if (now - observedAt > maximumAgeMs || observedAt + ttlMs <= now) {
                    call.reject("The available foreground location is stale", "LOCATION_STALE")
                    return@addOnSuccessListener
                }
                val digits = if (precise) 6 else 2
                val accuracy = if (precise) location.accuracy.toDouble() else max(1_000.0, location.accuracy.toDouble())
                val point = JSObject()
                    .put("lat", rounded(location.latitude, digits))
                    .put("lng", rounded(location.longitude, digits))
                    .put("accuracyM", accuracy)
                call.resolve(
                    JSObject()
                        .put("observedAt", observedAt)
                        .put("expiresAt", observedAt + ttlMs)
                        .put("point", point)
                        .put("precision", if (precise) "precise" else "approximate")
                        .put("source", "android"),
                )
            }
            .addOnFailureListener { error ->
                if (!completed.compareAndSet(false, true)) return@addOnFailureListener
                mainHandler.removeCallbacks(timeout)
                call.reject(error.message ?: "Foreground location failed", "LOCATION_FAILED", error)
            }
    }

    @PluginMethod
    fun getBusyIntervals(call: PluginCall) {
        if (!calendarGranted()) {
            call.reject("Read-only calendar permission is required", "CALENDAR_PERMISSION_REQUIRED")
            return
        }
        val startAt = optionLong(call, "startAt", 0L)
        val endAt = optionLong(call, "endAt", 0L)
        if (startAt <= 0L || endAt <= startAt || endAt - startAt > MAX_BUSY_RANGE_MS) {
            call.reject("Calendar range must be positive and no longer than 366 days", "INVALID_RANGE")
            return
        }
        val maxIntervals = optionLong(call, "maxIntervals", 500L).coerceIn(1L, 1_000L).toInt()
        val ttlMs = optionLong(call, "ttlMs", 300_000L).coerceIn(1_000L, 3_600_000L)
        ioExecutor.execute {
            runCatching { readBusyIntervals(startAt, endAt, maxIntervals) }
                .onSuccess { result ->
                    resolveOnMain(call, busyIntervalsResult(result.first, result.second, startAt, endAt, ttlMs))
                }
                .onFailure { error ->
                    rejectOnMain(call, error.message ?: "Calendar read failed", "CALENDAR_READ_FAILED", error)
                }
        }
    }

    @PluginMethod
    fun configureGeofences(call: PluginCall) {
        val configured = runCatching { parseGeofences(call.getArray("geofences")) }
            .getOrElse { error ->
                call.reject(error.message ?: "Invalid geofence configuration", "INVALID_GEOFENCES")
                return
            }
        val scope = runCatching { parseOptionalScope(call) }.getOrElse { error ->
            call.reject(error.message ?: "Invalid context scope", "INVALID_SCOPE")
            return
        }
        JarvisContextGeofenceCoordinator.replace(context, configured, scope) { result ->
            result.onSuccess { snapshot ->
                resolveOnMain(call, geofenceListResult(snapshot))
            }.onFailure { error ->
                val operation = error as? JarvisContextOperationException
                rejectOnMain(
                    call,
                    error.message ?: "Geofence configuration failed",
                    operation?.code ?: errorCode(error, "GEOFENCE_CONFIGURATION_FAILED"),
                    error,
                )
            }
        }
    }

    @PluginMethod
    fun removeGeofences(call: PluginCall) {
        val ids = runCatching { parseGeofenceIds(call.getArray("ids")) }
            .getOrElse { error ->
                call.reject(error.message ?: "Invalid geofence ids", "INVALID_GEOFENCES")
                return
        }
        val scope = runCatching { parseOptionalScope(call) }.getOrElse { error ->
            call.reject(error.message ?: "Invalid context scope", "INVALID_SCOPE")
            return
        }
        if (ids.isEmpty()) {
            runCatching { store.snapshotForCaller(scope) }
                .onSuccess { call.resolve(geofenceListResult(it)) }
                .onFailure { error ->
                    call.reject(
                        error.message ?: "Geofence state is unavailable",
                        errorCode(error, "GEOFENCE_STATE_FAILED"),
                        error as? Exception ?: IllegalStateException("Geofence state is unavailable", error),
                    )
                }
            return
        }
        JarvisContextGeofenceCoordinator.remove(context, ids.toSet(), scope) { result ->
            result.onSuccess { snapshot ->
                resolveOnMain(call, geofenceListResult(snapshot))
            }.onFailure { error ->
                rejectOnMain(
                    call,
                    error.message ?: "Geofence removal failed",
                    errorCode(error, "GEOFENCE_REMOVAL_FAILED"),
                    error,
                )
            }
        }
    }

    @PluginMethod
    fun listGeofences(call: PluginCall) {
        val scope = runCatching { parseOptionalScope(call) }.getOrElse { error ->
            call.reject(error.message ?: "Invalid context scope", "INVALID_SCOPE")
            return
        }
        runCatching { store.snapshotForCaller(scope) }
            .onSuccess { call.resolve(geofenceListResult(it)) }
            .onFailure { error ->
                call.reject(
                    error.message ?: "Geofence state is unavailable",
                    errorCode(error, "GEOFENCE_STATE_FAILED"),
                    error as? Exception ?: IllegalStateException("Geofence state is unavailable", error),
                )
            }
    }

    @PluginMethod
    fun leaseTransitions(call: PluginCall) {
        val scope = runCatching { parseRequiredScope(call) }.getOrElse { error ->
            call.reject(error.message ?: "Invalid context scope", "INVALID_SCOPE")
            return
        }
        val requestId = runCatching { parseRequestId(call.getString("requestId")) }.getOrElse { error ->
            call.reject(error.message ?: "Invalid lease request id", "INVALID_OPTIONS")
            return
        }
        val limit = optionLong(call, "limit", 100L).coerceIn(1L, 500L).toInt()
        val leaseDurationMs = optionLong(call, "leaseDurationMs", DEFAULT_LEASE_DURATION_MS)
            .coerceIn(MIN_LEASE_DURATION_MS, MAX_LEASE_DURATION_MS)
        val now = System.currentTimeMillis()
        val result = runCatching {
            store.leaseTransitions(
                expectedScope = scope,
                requestId = requestId,
                leaseId = newLeaseId(),
                limit = limit,
                leaseDurationMs = leaseDurationMs,
                now = now,
            )
        }.getOrElse { error ->
            call.reject(
                error.message ?: "Transition lease failed",
                errorCode(error, "TRANSITION_LEASE_FAILED"),
                error as? Exception ?: IllegalStateException("Transition lease failed", error),
            )
            return
        }
        call.resolve(transitionLeaseResult(result, legacy = false))
    }

    @PluginMethod
    fun ackTransitions(call: PluginCall) {
        val scope = runCatching { parseRequiredScope(call) }.getOrElse { error ->
            call.reject(error.message ?: "Invalid context scope", "INVALID_SCOPE")
            return
        }
        val leaseId = call.getString("leaseId")?.trim().orEmpty()
        if (!LEASE_ID.matches(leaseId)) {
            call.reject("leaseId is invalid", "INVALID_OPTIONS")
            return
        }
        val transitionIds = runCatching { parseTransitionIds(call.getArray("transitionIds")) }
            .getOrElse { error ->
                call.reject(error.message ?: "transitionIds is invalid", "INVALID_OPTIONS")
                return
            }
        val result = runCatching {
            store.acknowledgeTransitions(scope, leaseId, transitionIds, System.currentTimeMillis())
        }.getOrElse { error ->
            call.reject(
                error.message ?: "Transition ACK failed",
                errorCode(error, "TRANSITION_ACK_FAILED"),
                error as? Exception ?: IllegalStateException("Transition ACK failed", error),
            )
            return
        }
        call.resolve(transitionAckResult(result))
    }

    @PluginMethod
    fun eraseAll(call: PluginCall) {
        val scope = runCatching { parseRequiredScope(call) }.getOrElse { error ->
            call.reject(error.message ?: "Invalid context scope", "INVALID_SCOPE")
            return
        }
        JarvisContextGeofenceCoordinator.eraseAll(context, scope) { result ->
            result.onSuccess { erased ->
                val output = JSObject()
                    .put("scope", scopeResult(erased.scope))
                    .put("erased", true)
                    .put("hadLocalState", erased.hadLocalState)
                    .put("platformCleanup", erased.platformCleanup)
                resolveOnMain(call, output)
            }.onFailure { error ->
                rejectOnMain(
                    call,
                    error.message ?: "Native context erasure failed",
                    errorCode(error, "CONTEXT_ERASE_FAILED"),
                    error,
                )
            }
        }
    }

    /** Non-destructive compatibility path for clients that have not adopted explicit ACK yet. */
    @PluginMethod
    fun drainTransitions(call: PluginCall) {
        val requestId = runCatching {
            call.getString("requestId")?.let(::parseRequestId) ?: "legacy-${UUID.randomUUID()}"
        }.getOrElse { error ->
            call.reject(error.message ?: "Invalid lease request id", "INVALID_OPTIONS")
            return
        }
        val limit = optionLong(call, "limit", 100L).coerceIn(1L, 500L).toInt()
        val leaseDurationMs = optionLong(call, "leaseDurationMs", DEFAULT_LEASE_DURATION_MS)
            .coerceIn(MIN_LEASE_DURATION_MS, MAX_LEASE_DURATION_MS)
        val result = runCatching {
            store.leaseTransitions(
                expectedScope = null,
                requestId = requestId,
                leaseId = newLeaseId(),
                limit = limit,
                leaseDurationMs = leaseDurationMs,
                now = System.currentTimeMillis(),
            )
        }.getOrElse { error ->
            call.reject(
                error.message ?: "Transition lease failed",
                errorCode(error, "TRANSITION_LEASE_FAILED"),
                error as? Exception ?: IllegalStateException("Transition lease failed", error),
            )
            return
        }
        call.resolve(transitionLeaseResult(result, legacy = true))
    }

    private fun capabilities(): JSObject {
        val playServices = JarvisContextGeofences.googlePlayServicesAvailable(context)
        val backgroundBuild = JarvisContextGeofences.backgroundBuildEnabled(context)
        return JSObject()
            .put("available", true)
            .put("platform", "android")
            .put("foregroundLocation", playServices)
            .put("busyIntervals", true)
            .put("geofences", playServices && backgroundBuild)
            .put("backgroundLocation", backgroundBuild)
            .put("significantLocationChanges", false)
            .put("maxGeofences", JARVIS_CONTEXT_MAX_GEOFENCES)
    }

    private fun permissionStatus(): JSObject {
        val fine = JarvisContextGeofences.finePermissionGranted(context)
        val coarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val location = if (fine || coarse) "granted" else getPermissionState("location").toString()
        val calendar = if (calendarGranted()) "granted" else getPermissionState("calendar").toString()
        val background = when {
            !JarvisContextGeofences.backgroundBuildEnabled(context) -> "unavailable"
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && (fine || coarse) -> "granted"
            JarvisContextGeofences.backgroundPermissionGranted(context) -> "granted"
            else -> getPermissionState("backgroundLocation").toString()
        }
        return JSObject()
            .put("location", location)
            .put("locationAccuracy", if (fine) "precise" else if (coarse) "approximate" else "unknown")
            .put("calendar", calendar)
            .put("backgroundLocation", background)
            .put("capabilities", capabilities())
    }

    private fun readBusyIntervals(
        startAt: Long,
        endAt: Long,
        maxIntervals: Int,
    ): Pair<List<JarvisBusyInterval>, Boolean> {
        val builder = CalendarContract.Instances.CONTENT_URI.buildUpon()
        ContentUris.appendId(builder, startAt)
        ContentUris.appendId(builder, endAt)
        val projection = arrayOf(
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.AVAILABILITY,
            CalendarContract.Instances.STATUS,
            CalendarContract.Instances.SELF_ATTENDEE_STATUS,
        )
        val raw = mutableListOf<JarvisBusyInterval>()
        var truncated = false
        var rowsRead = 0
        context.contentResolver.query(
            builder.build(),
            projection,
            "${CalendarContract.Instances.END} > ? AND ${CalendarContract.Instances.BEGIN} < ? " +
                "AND ${CalendarContract.Instances.VISIBLE} = 1",
            arrayOf(startAt.toString(), endAt.toString()),
            "${CalendarContract.Instances.BEGIN} ASC",
        )?.use { cursor ->
            val beginIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.BEGIN)
            val endIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.END)
            val allDayIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.ALL_DAY)
            val availabilityIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.AVAILABILITY)
            val statusIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.STATUS)
            val attendeeStatusIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.SELF_ATTENDEE_STATUS)
            while (cursor.moveToNext()) {
                if (rowsRead >= MAX_CALENDAR_ROWS) {
                    truncated = true
                    break
                }
                rowsRead += 1
                if (!cursor.isNull(availabilityIndex) &&
                    cursor.getInt(availabilityIndex) == CalendarContract.Events.AVAILABILITY_FREE
                ) continue
                if (!cursor.isNull(statusIndex) &&
                    cursor.getInt(statusIndex) == CalendarContract.Events.STATUS_CANCELED
                ) continue
                if (!cursor.isNull(attendeeStatusIndex) &&
                    cursor.getInt(attendeeStatusIndex) == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED
                ) continue
                val begin = max(startAt, cursor.getLong(beginIndex))
                val end = minOf(endAt, cursor.getLong(endIndex))
                if (end > begin) raw.add(JarvisBusyInterval(begin, end, cursor.getInt(allDayIndex) != 0))
            }
        }
        val merged = mergeBusyIntervals(raw)
        if (merged.size > maxIntervals) truncated = true
        return merged.take(maxIntervals) to truncated
    }

    private fun busyIntervalsResult(
        intervals: List<JarvisBusyInterval>,
        truncated: Boolean,
        startAt: Long,
        endAt: Long,
        ttlMs: Long,
    ): JSObject {
        val observedAt = System.currentTimeMillis()
        val output = JSArray()
        intervals.forEach { interval ->
            output.put(
                JSObject()
                    .put("startAt", interval.startAt)
                    .put("endAt", interval.endAt)
                    .put("allDay", interval.allDay),
            )
        }
        return JSObject()
            .put("observedAt", observedAt)
            .put("expiresAt", observedAt + ttlMs)
            .put("rangeStartAt", startAt)
            .put("rangeEndAt", endAt)
            .put("timeZone", TimeZone.getDefault().id)
            .put("intervals", output)
            .put("truncated", truncated)
            .put("source", "android")
    }

    private fun parseRequiredScope(call: PluginCall): JarvisContextScope =
        parseScope(requireNotNull(call.getObject("scope")) { "scope is required" })

    private fun parseOptionalScope(call: PluginCall): JarvisContextScope? =
        call.getObject("scope")?.let(::parseScope)

    private fun parseScope(data: JSObject): JarvisContextScope {
        val principalId = data.opt("principalId") as? String
            ?: throw IllegalArgumentException("scope.principalId must be a string")
        val deviceId = data.opt("deviceId") as? String
            ?: throw IllegalArgumentException("scope.deviceId must be a string")
        val generationValue = (data.opt("generation") as? Number)?.toDouble() ?: Double.NaN
        require(isValidJarvisContextIdentifier(principalId)) { "scope.principalId is invalid" }
        require(isValidJarvisContextIdentifier(deviceId)) { "scope.deviceId is invalid" }
        require(generationValue.isFinite() && generationValue >= 0.0 &&
            generationValue <= JARVIS_CONTEXT_MAX_SAFE_INTEGER.toDouble() && generationValue % 1.0 == 0.0
        ) { "scope.generation must be a non-negative safe integer" }
        return JarvisContextScope(principalId, deviceId, generationValue.toLong())
    }

    private fun parseRequestId(value: String?): String {
        val requestId = value ?: throw IllegalArgumentException("requestId is required")
        require(isValidJarvisContextIdentifier(requestId)) { "requestId is invalid" }
        return requestId
    }

    private fun parseGeofences(data: JSArray?): List<JarvisManagedGeofence> {
        requireNotNull(data) { "geofences must be an array" }
        require(data.length() <= JARVIS_CONTEXT_MAX_GEOFENCES) {
            "At most $JARVIS_CONTEXT_MAX_GEOFENCES geofences can be configured"
        }
        val ids = mutableSetOf<String>()
        return buildList {
            for (index in 0 until data.length()) {
                val item = data.optJSONObject(index) ?: throw IllegalArgumentException("geofences[$index] must be an object")
                val id = item.optString("id").trim()
                require(GEOFENCE_ID.matches(id)) { "geofences[$index].id is invalid" }
                require(ids.add(id)) { "Duplicate geofence id: $id" }
                val point = item.optJSONObject("point")
                    ?: throw IllegalArgumentException("geofences[$index].point is required")
                val latitude = point.optDouble("lat", Double.NaN)
                val longitude = point.optDouble("lng", Double.NaN)
                val radius = item.optDouble("radiusM", Double.NaN)
                require(latitude.isFinite() && latitude in -90.0..90.0) { "geofences[$index].point.lat is invalid" }
                require(longitude.isFinite() && longitude in -180.0..180.0) { "geofences[$index].point.lng is invalid" }
                require(radius.isFinite() && radius in 100.0..100_000.0) { "geofences[$index].radiusM must be 100..100000" }
                val transitionData = item.optJSONArray("transitions")
                val transitions = if (transitionData == null) {
                    setOf("enter", "exit")
                } else {
                    buildSet {
                        for (transitionIndex in 0 until transitionData.length()) {
                            add(transitionData.optString(transitionIndex))
                        }
                    }
                }
                require(transitions.isNotEmpty() && transitions.all { it in setOf("enter", "exit") }) {
                    "geofences[$index].transitions must contain enter and/or exit"
                }
                add(
                    JarvisManagedGeofence(
                        id = id,
                        latitude = rounded(latitude, 6),
                        longitude = rounded(longitude, 6),
                        radiusM = radius.toFloat(),
                        notifyOnEntry = transitions.contains("enter"),
                        notifyOnExit = transitions.contains("exit"),
                    ),
                )
            }
        }
    }

    private fun parseGeofenceIds(data: JSArray?): List<String> {
        requireNotNull(data) { "ids must be an array" }
        require(data.length() <= JARVIS_CONTEXT_MAX_GEOFENCES) { "Too many geofence ids" }
        return buildList {
            for (index in 0 until data.length()) {
                val id = data.optString(index).trim()
                require(GEOFENCE_ID.matches(id)) { "ids[$index] is invalid" }
                if (!contains(id)) add(id)
            }
        }
    }

    private fun parseTransitionIds(data: JSArray?): List<String> {
        requireNotNull(data) { "transitionIds must be an array" }
        require(data.length() in 1..500) { "transitionIds must contain 1..500 ids" }
        return buildList {
            for (index in 0 until data.length()) {
                val id = data.optString(index)
                require(TRANSITION_ID.matches(id)) { "transitionIds[$index] is invalid" }
                if (!contains(id)) add(id)
            }
        }
    }

    private fun geofenceListResult(snapshot: JarvisGeofenceSnapshot): JSObject {
        val geofences = snapshot.geofences
        val output = JSArray()
        geofences.forEach { geofence ->
            val transitions = JSArray()
            if (geofence.notifyOnEntry) transitions.put("enter")
            if (geofence.notifyOnExit) transitions.put("exit")
            output.put(
                JSObject()
                    .put("id", geofence.id)
                    .put("point", JSObject().put("lat", geofence.latitude).put("lng", geofence.longitude))
                    .put("radiusM", geofence.radiusM.toDouble())
                    .put("transitions", transitions),
            )
        }
        val enabled = JarvisContextGeofences.backgroundBuildEnabled(context) &&
            JarvisContextGeofences.finePermissionGranted(context) &&
            JarvisContextGeofences.backgroundPermissionGranted(context)
        val result = JSObject()
            .put("geofences", output)
            .put("backgroundEnabled", enabled)
            .put("monitorSignificantChanges", false)
            .put("maxGeofences", JARVIS_CONTEXT_MAX_GEOFENCES)
            .put("configurationGeneration", snapshot.generation)
        snapshot.scope?.let { result.put("scope", scopeResult(it)) }
        return result
    }

    private fun transitionLeaseResult(result: JarvisTransitionLeaseResult, legacy: Boolean): JSObject {
        val output = JSObject()
            .put("transitions", transitionResults(result.transitions))
            .put("pending", result.pending)
            .put("available", result.available)
        if (legacy) output.put("remaining", result.available)
        result.scope?.let { output.put("scope", scopeResult(it)) }
        result.leaseId?.let { output.put("leaseId", it) }
        result.leasedAt?.let { output.put("leasedAt", it) }
        result.expiresAt?.let { output.put("expiresAt", it) }
        result.nextLeaseExpiryAt?.let { output.put("nextLeaseExpiryAt", it) }
        return output
    }

    private fun transitionAckResult(result: JarvisTransitionAckResult): JSObject {
        val output = JSObject()
            .put("scope", scopeResult(result.scope))
            .put("leaseId", result.leaseId)
            .put("acknowledgedIds", JSArray(result.acknowledgedIds))
            .put("alreadyAcknowledgedIds", JSArray(result.alreadyAcknowledgedIds))
            .put("rejectedIds", JSArray(result.rejectedIds))
            .put("pending", result.pending)
            .put("available", result.available)
        result.nextLeaseExpiryAt?.let { output.put("nextLeaseExpiryAt", it) }
        return output
    }

    private fun transitionResults(transitions: List<JarvisTransitionEnvelope>): JSArray = JSArray().also { output ->
        transitions.forEach { transition ->
            output.put(
                JSObject()
                    .put("id", transition.id)
                    .put("geofenceId", transition.geofenceId)
                    .put("transition", transition.transition)
                    .put("occurredAt", transition.occurredAt)
                    .put("recordedAt", transition.recordedAt)
                    .put("source", "android")
                    .put("deliveryAttempt", transition.deliveryAttempt),
            )
        }
    }

    private fun scopeResult(scope: JarvisContextScope): JSObject = JSObject()
        .put("principalId", scope.principalId)
        .put("deviceId", scope.deviceId)
        .put("generation", scope.generation)

    private fun newLeaseId(): String = "lease-${UUID.randomUUID()}"

    private fun errorCode(error: Throwable, fallback: String): String = when (error) {
        is JarvisContextScopeMismatchException -> "CONTEXT_SCOPE_MISMATCH"
        is JarvisStaleContextException -> "CONTEXT_GENERATION_STALE"
        else -> fallback
    }

    private fun appIsForeground(): Boolean {
        val currentActivity = activity ?: return false
        if (currentActivity.isFinishing || currentActivity.isDestroyed) return false
        val process = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(process)
        return process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
            process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
    }

    private fun foregroundLocationGranted(): Boolean = JarvisContextGeofences.foregroundPermissionGranted(context)

    private fun calendarGranted(): Boolean = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.READ_CALENDAR,
    ) == PackageManager.PERMISSION_GRANTED

    private fun optionLong(call: PluginCall, name: String, defaultValue: Long): Long {
        val value = call.data.optDouble(name, defaultValue.toDouble())
        return if (value.isFinite()) value.toLong() else defaultValue
    }

    private fun rounded(value: Double, digits: Int): Double {
        val scale = 10.0.pow(digits)
        return round(value * scale) / scale
    }

    private fun resolveOnMain(call: PluginCall, result: JSObject) {
        mainHandler.post { call.resolve(result) }
    }

    private fun rejectOnMain(call: PluginCall, message: String, code: String, error: Throwable) {
        mainHandler.post {
            call.reject(message, code, error as? Exception ?: IllegalStateException(message, error))
        }
    }

    private companion object {
        const val MAX_BUSY_RANGE_MS = 366L * 24L * 60L * 60L * 1000L
        const val MAX_CALENDAR_ROWS = 10_000
        const val DEFAULT_LEASE_DURATION_MS = 60_000L
        const val MIN_LEASE_DURATION_MS = 5_000L
        const val MAX_LEASE_DURATION_MS = 15L * 60L * 1000L
        val GEOFENCE_ID = Regex("^[A-Za-z0-9._:-]{1,128}$")
        val TRANSITION_ID = Regex("^ctx-[0-9a-f]{32}$")
        val LEASE_ID = Regex("^lease-[0-9a-fA-F-]{36}$")
    }
}
