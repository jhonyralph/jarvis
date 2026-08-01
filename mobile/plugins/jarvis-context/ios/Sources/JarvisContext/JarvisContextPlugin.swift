import Capacitor
import CoreLocation
import EventKit
import Foundation
import UIKit

@objc(JarvisContextPlugin)
public class JarvisContextPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "JarvisContextPlugin"
    public let jsName = "JarvisContext"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBusyIntervals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureGeofences", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeGeofences", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listGeofences", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "leaseTransitions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ackTransitions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "eraseAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainTransitions", returnType: CAPPluginReturnPromise)
    ]

    private let eventStore = EKEventStore()
    private let contextStore = JarvisContextStore()
    private let calendarQueue = DispatchQueue(label: "chat.jarvis.context.calendar", qos: .userInitiated)
    private lazy var locationManager: CLLocationManager = {
        let manager = CLLocationManager()
        manager.delegate = self
        manager.activityType = .other
        manager.pausesLocationUpdatesAutomatically = true
        return manager
    }()

    private var permissionRequestInFlight = false
    private var permissionTarget: PermissionTarget?
    private var permissionCompletion: (() -> Void)?
    private var permissionTimeout: DispatchWorkItem?
    private var locationCall: CAPPluginCall?
    private var locationRequest: ForegroundRequest?
    private var locationTimeout: DispatchWorkItem?
    private var regionOperation: RegionOperation?

    override public func load() {
        _ = locationManager
        DispatchQueue.main.async { [weak self] in self?.reconcileLocationMonitoring() }
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.isSupported(call) }
            return
        }
        call.resolve(capabilities())
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.checkPermissions(call) }
            return
        }
        call.resolve(permissionStatus())
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.requestPermissions(call) }
            return
        }
        guard !permissionRequestInFlight else {
            call.reject("A permission request is already active", "PERMISSION_REQUEST_ACTIVE")
            return
        }
        permissionRequestInFlight = true
        requestCalendarIfNeeded(call) { [weak self] error in
            guard let self else { return }
            if let error {
                self.permissionRequestInFlight = false
                call.reject(error.localizedDescription, "CALENDAR_PERMISSION_FAILED", error)
                return
            }
            self.requestLocationPermissionIfNeeded(call) {
                self.permissionRequestInFlight = false
                call.resolve(self.permissionStatus())
            }
        }
    }

    @objc func getCurrentLocation(_ call: CAPPluginCall) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.getCurrentLocation(call) }
            return
        }
        guard UIApplication.shared.applicationState == .active else {
            call.reject("Foreground location requires a visible app", "APP_NOT_FOREGROUND")
            return
        }
        guard locationAuthorizationGranted else {
            call.reject("When In Use location permission is required", "LOCATION_PERMISSION_REQUIRED")
            return
        }
        guard locationCall == nil else {
            call.reject("A foreground location request is already active", "LOCATION_REQUEST_ACTIVE")
            return
        }
        let requestedPrecision = call.getString("precision") ?? "approximate"
        guard requestedPrecision == "approximate" || requestedPrecision == "precise" else {
            call.reject("precision must be approximate or precise", "INVALID_OPTIONS")
            return
        }
        guard
            let maximumAgeMs = boundedMilliseconds(call.getDouble("maximumAgeMs"), defaultValue: 10_000, minimum: 0, maximum: 300_000),
            let timeoutMs = boundedMilliseconds(call.getDouble("timeoutMs"), defaultValue: 15_000, minimum: 1_000, maximum: 60_000),
            let ttlMs = boundedMilliseconds(call.getDouble("ttlMs"), defaultValue: 60_000, minimum: 1_000, maximum: 900_000)
        else {
            call.reject("Location timing options must be finite numbers", "INVALID_OPTIONS")
            return
        }

        let precise = requestedPrecision == "precise" && locationManager.accuracyAuthorization == .fullAccuracy
        locationManager.desiredAccuracy = precise ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters
        locationCall = call
        locationRequest = ForegroundRequest(
            precise: precise,
            maximumAgeMs: maximumAgeMs,
            ttlMs: ttlMs
        )
        let timeout = DispatchWorkItem { [weak self, weak call] in
            guard let self, let call, self.locationCall === call else { return }
            self.clearLocationRequest()
            call.reject("Timed out waiting for a foreground location", "LOCATION_TIMEOUT")
        }
        locationTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(timeoutMs)), execute: timeout)
        locationManager.requestLocation()
    }

    @objc func getBusyIntervals(_ call: CAPPluginCall) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.getBusyIntervals(call) }
            return
        }
        guard calendarPermissionState == "granted" else {
            call.reject("Full calendar read access is required", "CALENDAR_PERMISSION_REQUIRED")
            return
        }
        guard
            let startValue = call.getDouble("startAt"), startValue.isFinite,
            let endValue = call.getDouble("endAt"), endValue.isFinite,
            let startAt = timestampMilliseconds(startValue),
            let endAt = timestampMilliseconds(endValue)
        else {
            call.reject("startAt and endAt are required", "INVALID_RANGE")
            return
        }
        guard startAt > 0, endAt > startAt, endAt - startAt <= Constants.maximumBusyRangeMs else {
            call.reject("Calendar range must be positive and no longer than 366 days", "INVALID_RANGE")
            return
        }
        guard
            let maxIntervalsValue = boundedMilliseconds(call.getDouble("maxIntervals"), defaultValue: 500, minimum: 1, maximum: 1_000),
            let ttlMs = boundedMilliseconds(call.getDouble("ttlMs"), defaultValue: 300_000, minimum: 1_000, maximum: 3_600_000)
        else {
            call.reject("Calendar options must be finite numbers", "INVALID_OPTIONS")
            return
        }
        calendarQueue.async { [weak self] in
            guard let self else { return }
            let result = self.readBusyIntervals(startAt: startAt, endAt: endAt, limit: Int(maxIntervalsValue))
            DispatchQueue.main.async {
                call.resolve(self.busyIntervalsResult(
                    intervals: result.intervals,
                    truncated: result.truncated,
                    startAt: startAt,
                    endAt: endAt,
                    ttlMs: ttlMs
                ))
            }
        }
    }

    @objc func configureGeofences(_ call: CAPPluginCall) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.configureGeofences(call) }
            return
        }
        let configured: [JarvisManagedGeofence]
        let scope: JarvisContextScope?
        do {
            configured = try parseGeofences(call)
            scope = try parseOptionalScope(call)
        } catch {
            call.reject(
                error.localizedDescription,
                contextErrorCode(error, fallback: "INVALID_GEOFENCES"),
                error
            )
            return
        }
        guard regionOperation == nil else {
            call.reject("A geofence replacement is already active", "GEOFENCE_OPERATION_ACTIVE")
            return
        }
        let significantChanges = call.getBool("monitorSignificantChanges") ?? false

        if configured.isEmpty {
            do {
                let replacement = try contextStore.prepareGeofenceReplacement(
                    [],
                    significantChanges: false,
                    requestedScope: scope
                )
                let snapshot = try contextStore.commitGeofenceReplacement(replacement)
                stopManagedRegions()
                locationManager.stopMonitoringSignificantLocationChanges()
                call.resolve(geofenceListResult(snapshot))
            } catch {
                call.reject(
                    "Could not erase the local geofence state",
                    contextErrorCode(error, fallback: "GEOFENCE_STATE_FAILED"),
                    error
                )
            }
            return
        }

        if !configured.isEmpty {
            guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
                call.reject("Region monitoring is unavailable on this device", "GEOFENCING_UNAVAILABLE")
                return
            }
            guard locationManager.authorizationStatus == .authorizedAlways else {
                call.reject("Always location permission is required for background geofences", "BACKGROUND_PERMISSION_REQUIRED")
                return
            }
            if significantChanges && !CLLocationManager.significantLocationChangeMonitoringAvailable() {
                call.reject("Significant location changes are unavailable on this device", "SIGNIFICANT_LOCATION_UNAVAILABLE")
                return
            }
            let externalRegions = locationManager.monitoredRegions.filter {
                !$0.identifier.hasPrefix(jarvisContextRegionPrefix)
            }.count
            guard externalRegions + configured.count <= jarvisContextMaximumGeofences else {
                call.reject("The iOS 20-region limit would be exceeded", "GEOFENCE_LIMIT_EXCEEDED")
                return
            }
        }
        do {
            let replacement = try contextStore.prepareGeofenceReplacement(
                configured,
                significantChanges: significantChanges,
                requestedScope: scope
            )
            let operation = RegionOperation(
                call: call,
                replacement: replacement
            )
            regionOperation = operation
            beginRegionPhase(operation, phase: .applying, snapshot: replacement.desired)
        } catch {
            call.reject(
                "Could not read the protected geofence state",
                contextErrorCode(error, fallback: "GEOFENCE_STATE_FAILED"),
                error
            )
        }
    }

    @objc func removeGeofences(_ call: CAPPluginCall) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.removeGeofences(call) }
            return
        }
        guard regionOperation == nil else {
            call.reject("A geofence replacement is already active", "GEOFENCE_OPERATION_ACTIVE")
            return
        }
        guard let ids = call.getArray("ids", String.self) else {
            call.reject("ids must be an array", "INVALID_GEOFENCES")
            return
        }
        do {
            let scope = try parseOptionalScope(call)
            let uniqueIds = try validateGeofenceIds(ids)
            // Persist the local erasure first; platform removal is best effort and cannot restore it.
            let replacement = try contextStore.removeGeofences(
                ids: Set(uniqueIds),
                requestedScope: scope
            )
            stopManagedRegions()
            reconcileLocationMonitoring()
            call.resolve(geofenceListResult(replacement.desired))
        } catch {
            let fallback = error is JarvisContextError ? "INVALID_GEOFENCES" : "GEOFENCE_STATE_FAILED"
            let code = contextErrorCode(error, fallback: fallback)
            call.reject(error.localizedDescription, code, error)
        }
    }

    @objc func listGeofences(_ call: CAPPluginCall) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.listGeofences(call) }
            return
        }
        do {
            let scope = try parseOptionalScope(call)
            call.resolve(geofenceListResult(try contextStore.snapshotForCaller(expectedScope: scope)))
        } catch {
            call.reject(
                "Could not read the protected geofence state",
                contextErrorCode(error, fallback: "GEOFENCE_STATE_FAILED"),
                error
            )
        }
    }

    @objc func leaseTransitions(_ call: CAPPluginCall) {
        do {
            let scope = try parseRequiredScope(call)
            let requestId = try parseRequestId(call.getString("requestId"))
            guard
                let limit = boundedMilliseconds(call.getDouble("limit"), defaultValue: 100, minimum: 1, maximum: 500),
                let leaseDuration = boundedMilliseconds(
                    call.getDouble("leaseDurationMs"),
                    defaultValue: Constants.defaultLeaseDurationMs,
                    minimum: Constants.minimumLeaseDurationMs,
                    maximum: Constants.maximumLeaseDurationMs
                )
            else { throw JarvisContextError.invalid("Lease options must be finite numbers") }
            let result = try contextStore.leaseTransitions(
                expectedScope: scope,
                requestId: requestId,
                leaseId: newLeaseId(),
                limit: Int(limit),
                leaseDurationMs: leaseDuration,
                now: currentMilliseconds()
            )
            call.resolve(transitionLeaseResult(result, legacy: false))
        } catch {
            call.reject(
                error.localizedDescription,
                contextErrorCode(error, fallback: error is JarvisContextError ? "INVALID_OPTIONS" : "TRANSITION_LEASE_FAILED"),
                error
            )
        }
    }

    @objc func ackTransitions(_ call: CAPPluginCall) {
        do {
            let scope = try parseRequiredScope(call)
            guard let leaseId = call.getString("leaseId"), isValidLeaseId(leaseId) else {
                throw JarvisContextError.invalid("leaseId is invalid")
            }
            guard let ids = call.getArray("transitionIds", String.self), ids.count >= 1, ids.count <= 500,
                  ids.allSatisfy(isValidTransitionId) else {
                throw JarvisContextError.invalid("transitionIds must contain 1..500 valid transition ids")
            }
            let result = try contextStore.acknowledgeTransitions(
                expectedScope: scope,
                leaseId: leaseId,
                transitionIds: ids,
                now: currentMilliseconds()
            )
            call.resolve(transitionAckResult(result))
        } catch {
            call.reject(
                error.localizedDescription,
                contextErrorCode(error, fallback: error is JarvisContextError ? "INVALID_OPTIONS" : "TRANSITION_ACK_FAILED"),
                error
            )
        }
    }

    @objc func eraseAll(_ call: CAPPluginCall) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.eraseAll(call) }
            return
        }
        do {
            let scope = try parseRequiredScope(call)
            let localErasure: Result<Bool, Error>
            do {
                localErasure = .success(try contextStore.eraseAll(expectedScope: scope))
            } catch {
                if let storeError = error as? JarvisContextStoreError,
                   case .scopeMismatch = storeError {
                    throw error
                }
                localErasure = .failure(error)
            }
            if let operation = regionOperation {
                operation.timeout?.cancel()
                operation.timeout = nil
                regionOperation = nil
                operation.call.reject(
                    "Geofence replacement was cancelled by native context erasure",
                    "CONTEXT_ERASED"
                )
            }
            // CoreLocation cleanup still runs if one local backend could not be deleted.
            stopManagedRegions()
            locationManager.stopMonitoringSignificantLocationChanges()
            let hadLocalState = try localErasure.get()
            call.resolve([
                "scope": scopeResult(scope),
                "erased": true,
                "hadLocalState": hadLocalState,
                "platformCleanup": "requested"
            ])
        } catch {
            call.reject(
                error.localizedDescription,
                contextErrorCode(error, fallback: error is JarvisContextError ? "INVALID_SCOPE" : "CONTEXT_ERASE_FAILED"),
                error
            )
        }
    }

    /** Non-destructive compatibility path for clients that have not adopted explicit ACK yet. */
    @objc func drainTransitions(_ call: CAPPluginCall) {
        do {
            let requestId: String
            if let requested = call.getString("requestId") {
                requestId = try parseRequestId(requested)
            } else {
                requestId = "legacy-\(UUID().uuidString)"
            }
            guard
                let limit = boundedMilliseconds(call.getDouble("limit"), defaultValue: 100, minimum: 1, maximum: 500),
                let leaseDuration = boundedMilliseconds(
                    call.getDouble("leaseDurationMs"),
                    defaultValue: Constants.defaultLeaseDurationMs,
                    minimum: Constants.minimumLeaseDurationMs,
                    maximum: Constants.maximumLeaseDurationMs
                )
            else { throw JarvisContextError.invalid("Lease options must be finite numbers") }
            let result = try contextStore.leaseTransitions(
                expectedScope: nil,
                requestId: requestId,
                leaseId: newLeaseId(),
                limit: Int(limit),
                leaseDurationMs: leaseDuration,
                now: currentMilliseconds()
            )
            call.resolve(transitionLeaseResult(result, legacy: true))
        } catch {
            call.reject(
                "Could not lease the protected transition queue",
                contextErrorCode(error, fallback: error is JarvisContextError ? "INVALID_OPTIONS" : "TRANSITION_LEASE_FAILED"),
                error
            )
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        reconcileLocationMonitoring()
        guard permissionCompletion != nil, let target = permissionTarget else { return }
        switch target {
        case .whenInUse:
            if manager.authorizationStatus != .notDetermined { finishPermissionWait() }
        case .always:
            if manager.authorizationStatus != .notDetermined {
                finishPermissionWait()
            }
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let call = locationCall, let request = locationRequest {
            guard UIApplication.shared.applicationState == .active else {
                clearLocationRequest()
                call.reject("The app left the foreground before location completed", "APP_NOT_FOREGROUND")
                return
            }
            guard let location = locations.max(by: { $0.timestamp < $1.timestamp }) else {
                clearLocationRequest()
                call.reject("No foreground location is currently available", "LOCATION_UNAVAILABLE")
                return
            }
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            let observedAt = min(now, Int64(location.timestamp.timeIntervalSince1970 * 1000))
            guard now - observedAt <= request.maximumAgeMs, observedAt + request.ttlMs > now else {
                clearLocationRequest()
                call.reject("The available foreground location is stale", "LOCATION_STALE")
                return
            }
            guard location.horizontalAccuracy.isFinite, location.horizontalAccuracy >= 0,
                  CLLocationCoordinate2DIsValid(location.coordinate) else {
                clearLocationRequest()
                call.reject("Foreground location accuracy is invalid", "LOCATION_UNAVAILABLE")
                return
            }
            let digits = request.precise ? 6 : 2
            let accuracy = request.precise ? location.horizontalAccuracy : max(1_000, location.horizontalAccuracy)
            let result: JSObject = [
                "observedAt": observedAt,
                "expiresAt": observedAt + request.ttlMs,
                "point": [
                    "lat": rounded(location.coordinate.latitude, digits: digits),
                    "lng": rounded(location.coordinate.longitude, digits: digits),
                    "accuracyM": accuracy
                ],
                "precision": request.precise ? "precise" : "approximate",
                "source": "ios"
            ]
            clearLocationRequest()
            call.resolve(result)
        }
        if (try? contextStore.significantChangesEnabled()) == true { reconcileLocationMonitoring() }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard let call = locationCall else { return }
        clearLocationRequest()
        call.reject(error.localizedDescription, "LOCATION_FAILED", error)
    }

    public func locationManager(_ manager: CLLocationManager, didStartMonitoringFor region: CLRegion) {
        guard let operation = regionOperation,
              let expected = operation.pending[region.identifier],
              regionMatches(region, geofence: expected)
        else { return }
        operation.pending.removeValue(forKey: region.identifier)
        if operation.pending.isEmpty { completeRegionPhase(operation) }
    }

    public func locationManager(
        _ manager: CLLocationManager,
        monitoringDidFailFor region: CLRegion?,
        withError error: Error
    ) {
        guard let operation = regionOperation else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                self?.reconcileLocationMonitoring()
            }
            return
        }
        if let region {
            guard let expected = operation.pending[region.identifier],
                  regionMatches(region, geofence: expected)
            else { return }
        }
        if operation.phase == .applying {
            beginRegionRollback(operation, failure: error)
        } else {
            finishRegionOperation(
                operation,
                code: "GEOFENCE_ROLLBACK_FAILED",
                message: "Geofence replacement failed and CoreLocation could not restore the previous set",
                error: error
            )
        }
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        recordTransition(region: region, transition: "enter")
    }

    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        recordTransition(region: region, transition: "exit")
    }

    private func requestCalendarIfNeeded(_ call: CAPPluginCall, completion: @escaping (Error?) -> Void) {
        guard call.getBool("calendar") == true, calendarPermissionState != "granted" else {
            completion(nil)
            return
        }
        if #available(iOS 17.0, *) {
            eventStore.requestFullAccessToEvents { _, error in
                DispatchQueue.main.async { completion(error) }
            }
        } else {
            eventStore.requestAccess(to: .event) { _, error in
                DispatchQueue.main.async { completion(error) }
            }
        }
    }

    private func requestLocationPermissionIfNeeded(_ call: CAPPluginCall, completion: @escaping () -> Void) {
        let wantsBackground = call.getBool("backgroundLocation") == true
        let wantsLocation = call.getBool("location") == true || wantsBackground
        guard wantsLocation else {
            completion()
            return
        }
        guard CLLocationManager.locationServicesEnabled() else {
            completion()
            return
        }
        switch locationManager.authorizationStatus {
        case .notDetermined:
            // The first explicit request is always When In Use, even if background was requested.
            beginPermissionWait(target: .whenInUse, completion: completion)
            locationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse where wantsBackground:
            beginPermissionWait(target: .always, completion: completion)
            locationManager.requestAlwaysAuthorization()
        default:
            completion()
        }
    }

    private func beginPermissionWait(target: PermissionTarget, completion: @escaping () -> Void) {
        permissionTarget = target
        permissionCompletion = completion
        let timeout = DispatchWorkItem { [weak self] in self?.finishPermissionWait() }
        permissionTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
    }

    private func finishPermissionWait() {
        permissionTimeout?.cancel()
        permissionTimeout = nil
        permissionTarget = nil
        let completion = permissionCompletion
        permissionCompletion = nil
        completion?()
    }

    private func clearLocationRequest() {
        locationTimeout?.cancel()
        locationTimeout = nil
        locationCall = nil
        locationRequest = nil
    }

    private func capabilities() -> JSObject {
        let regions = CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self)
        return [
            "available": true,
            "platform": "ios",
            "foregroundLocation": true,
            "busyIntervals": true,
            "geofences": regions,
            "backgroundLocation": regions,
            "significantLocationChanges": CLLocationManager.significantLocationChangeMonitoringAvailable(),
            "maxGeofences": jarvisContextMaximumGeofences
        ]
    }

    private func permissionStatus() -> JSObject {
        let status = locationManager.authorizationStatus
        let location: String
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: location = "granted"
        case .notDetermined: location = "prompt"
        case .denied, .restricted: location = "denied"
        @unknown default: location = "prompt"
        }
        let accuracy: String
        if status == .authorizedAlways || status == .authorizedWhenInUse {
            accuracy = locationManager.accuracyAuthorization == .fullAccuracy ? "precise" : "approximate"
        } else {
            accuracy = "unknown"
        }
        let background: String
        if !CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) {
            background = "unavailable"
        } else {
            switch status {
            case .authorizedAlways: background = "granted"
            case .notDetermined, .authorizedWhenInUse: background = "prompt"
            case .denied, .restricted: background = "denied"
            @unknown default: background = "prompt"
            }
        }
        return [
            "location": location,
            "locationAccuracy": accuracy,
            "calendar": calendarPermissionState,
            "backgroundLocation": background,
            "capabilities": capabilities()
        ]
    }

    private var calendarPermissionState: String {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *), status == .fullAccess { return "granted" }
        if status == .authorized { return "granted" }
        if #available(iOS 17.0, *), status == .writeOnly { return "limited" }
        if status == .notDetermined { return "prompt" }
        return "denied"
    }

    private var locationAuthorizationGranted: Bool {
        locationManager.authorizationStatus == .authorizedWhenInUse ||
            locationManager.authorizationStatus == .authorizedAlways
    }

    private func readBusyIntervals(startAt: Int64, endAt: Int64, limit: Int) -> (intervals: [JarvisBusyInterval], truncated: Bool) {
        let start = Date(timeIntervalSince1970: Double(startAt) / 1000)
        let end = Date(timeIntervalSince1970: Double(endAt) / 1000)
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
        var truncated = false
        var raw: [JarvisBusyInterval] = []
        var rowsRead = 0
        for event in eventStore.events(matching: predicate).sorted(by: { $0.startDate < $1.startDate }) {
            if rowsRead >= Constants.maximumCalendarRows {
                truncated = true
                break
            }
            rowsRead += 1
            if event.status == .canceled || event.availability == .free { continue }
            let intervalStart = max(startAt, Int64(event.startDate.timeIntervalSince1970 * 1000))
            let intervalEnd = min(endAt, Int64(event.endDate.timeIntervalSince1970 * 1000))
            if intervalEnd > intervalStart {
                raw.append(JarvisBusyInterval(startAt: intervalStart, endAt: intervalEnd, allDay: event.isAllDay))
            }
        }
        let merged = mergeBusyIntervals(raw)
        if merged.count > limit { truncated = true }
        return (Array(merged.prefix(limit)), truncated)
    }

    private func busyIntervalsResult(
        intervals: [JarvisBusyInterval],
        truncated: Bool,
        startAt: Int64,
        endAt: Int64,
        ttlMs: Int64
    ) -> JSObject {
        let observedAt = Int64(Date().timeIntervalSince1970 * 1000)
        return [
            "observedAt": observedAt,
            "expiresAt": observedAt + ttlMs,
            "rangeStartAt": startAt,
            "rangeEndAt": endAt,
            "timeZone": TimeZone.current.identifier,
            "intervals": intervals.map { interval in
                [
                    "startAt": interval.startAt,
                    "endAt": interval.endAt,
                    "allDay": interval.allDay
                ] as JSObject
            },
            "truncated": truncated,
            "source": "ios"
        ]
    }

    private func parseRequiredScope(_ call: CAPPluginCall) throws -> JarvisContextScope {
        guard let data = call.getObject("scope") else {
            throw JarvisContextError.invalidScope("scope is required")
        }
        return try parseScope(data)
    }

    private func parseOptionalScope(_ call: CAPPluginCall) throws -> JarvisContextScope? {
        guard let data = call.getObject("scope") else { return nil }
        return try parseScope(data)
    }

    private func parseScope(_ data: JSObject) throws -> JarvisContextScope {
        guard
            let principalId = data["principalId"] as? String, isValidJarvisContextIdentifier(principalId),
            let deviceId = data["deviceId"] as? String, isValidJarvisContextIdentifier(deviceId),
            let generationValue = number(data["generation"]), generationValue.isFinite,
            generationValue >= 0, generationValue <= Double(jarvisContextMaximumSafeInteger),
            generationValue.rounded(.towardZero) == generationValue
        else {
            throw JarvisContextError.invalidScope(
                "scope requires valid principalId/deviceId and a non-negative safe-integer generation"
            )
        }
        return JarvisContextScope(
            principalId: principalId,
            deviceId: deviceId,
            generation: Int64(generationValue)
        )
    }

    private func parseRequestId(_ value: String?) throws -> String {
        guard let value, isValidJarvisContextIdentifier(value) else {
            throw JarvisContextError.invalid("requestId is invalid")
        }
        return value
    }

    private func parseGeofences(_ call: CAPPluginCall) throws -> [JarvisManagedGeofence] {
        guard call.options["geofences"] != nil, let rows = call.getArray("geofences", JSObject.self) else {
            throw JarvisContextError.invalid("geofences must be an array")
        }
        guard rows.count <= jarvisContextMaximumGeofences else {
            throw JarvisContextError.invalid("At most 20 geofences can be configured")
        }
        var ids = Set<String>()
        return try rows.enumerated().map { index, row in
            guard let id = row["id"] as? String, isValidGeofenceId(id), ids.insert(id).inserted else {
                throw JarvisContextError.invalid("geofences[\(index)].id is invalid or duplicated")
            }
            guard
                let point = row["point"] as? JSObject,
                let latitude = number(point["lat"]), latitude.isFinite, (-90...90).contains(latitude),
                let longitude = number(point["lng"]), longitude.isFinite, (-180...180).contains(longitude),
                let requestedRadius = number(row["radiusM"]), requestedRadius.isFinite,
                (100...100_000).contains(requestedRadius)
            else {
                throw JarvisContextError.invalid("geofences[\(index)] has an invalid point or radius")
            }
            let transitions: [String]
            if row["transitions"] == nil {
                transitions = ["enter", "exit"]
            } else if let configuredTransitions = row["transitions"] as? [String] {
                transitions = configuredTransitions
            } else {
                throw JarvisContextError.invalid("geofences[\(index)].transitions must be an array of strings")
            }
            let transitionSet = Set(transitions)
            guard !transitionSet.isEmpty, transitionSet.isSubset(of: ["enter", "exit"]) else {
                throw JarvisContextError.invalid("geofences[\(index)].transitions must contain enter and/or exit")
            }
            let platformMaximum = locationManager.maximumRegionMonitoringDistance
            let radius = platformMaximum > 0 ? min(requestedRadius, platformMaximum) : requestedRadius
            return JarvisManagedGeofence(
                id: id,
                latitude: rounded(latitude, digits: 6),
                longitude: rounded(longitude, digits: 6),
                radiusM: radius,
                notifyOnEntry: transitionSet.contains("enter"),
                notifyOnExit: transitionSet.contains("exit")
            )
        }
    }

    private func validateGeofenceIds(_ ids: [String]) throws -> [String] {
        guard ids.count <= jarvisContextMaximumGeofences else {
            throw JarvisContextError.invalid("Too many geofence ids")
        }
        var seen = Set<String>()
        return try ids.compactMap { id in
            guard isValidGeofenceId(id) else { throw JarvisContextError.invalid("Invalid geofence id") }
            return seen.insert(id).inserted ? id : nil
        }
    }

    private func geofenceListResult(_ snapshot: JarvisGeofenceSnapshot) -> JSObject {
        let geofences = snapshot.geofences
        let enabled = locationManager.authorizationStatus == .authorizedAlways && !geofences.isEmpty
        var result: JSObject = [
            "geofences": geofences.map { geofence in
                var transitions: [String] = []
                if geofence.notifyOnEntry { transitions.append("enter") }
                if geofence.notifyOnExit { transitions.append("exit") }
                return [
                    "id": geofence.id,
                    "point": ["lat": geofence.latitude, "lng": geofence.longitude],
                    "radiusM": geofence.radiusM,
                    "transitions": transitions
                ] as JSObject
            },
            "backgroundEnabled": enabled,
            "monitorSignificantChanges": !geofences.isEmpty && snapshot.significantChanges,
            "maxGeofences": jarvisContextMaximumGeofences,
            "configurationGeneration": snapshot.generation
        ]
        if let scope = snapshot.scope { result["scope"] = scopeResult(scope) }
        return result
    }

    private func transitionLeaseResult(_ result: JarvisTransitionLeaseResult, legacy: Bool) -> JSObject {
        var output: JSObject = [
            "transitions": result.transitions.map(transitionResult),
            "pending": result.pending,
            "available": result.available
        ]
        if legacy { output["remaining"] = result.available }
        if let scope = result.scope { output["scope"] = scopeResult(scope) }
        if let leaseId = result.leaseId { output["leaseId"] = leaseId }
        if let leasedAt = result.leasedAt { output["leasedAt"] = leasedAt }
        if let expiresAt = result.expiresAt { output["expiresAt"] = expiresAt }
        if let nextExpiry = result.nextLeaseExpiryAt { output["nextLeaseExpiryAt"] = nextExpiry }
        return output
    }

    private func transitionAckResult(_ result: JarvisTransitionAckResult) -> JSObject {
        var output: JSObject = [
            "scope": scopeResult(result.scope),
            "leaseId": result.leaseId,
            "acknowledgedIds": result.acknowledgedIds,
            "alreadyAcknowledgedIds": result.alreadyAcknowledgedIds,
            "rejectedIds": result.rejectedIds,
            "pending": result.pending,
            "available": result.available
        ]
        if let nextExpiry = result.nextLeaseExpiryAt { output["nextLeaseExpiryAt"] = nextExpiry }
        return output
    }

    private func transitionResult(_ transition: JarvisTransitionEnvelope) -> JSObject {
        [
            "id": transition.id,
            "geofenceId": transition.geofenceId,
            "transition": transition.transition,
            "occurredAt": transition.occurredAt,
            "recordedAt": transition.recordedAt,
            "source": "ios",
            "deliveryAttempt": transition.deliveryAttempt
        ]
    }

    private func scopeResult(_ scope: JarvisContextScope) -> JSObject {
        [
            "principalId": scope.principalId,
            "deviceId": scope.deviceId,
            "generation": scope.generation
        ]
    }

    private func currentMilliseconds() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func newLeaseId() -> String { "lease-\(UUID().uuidString)" }

    private func isValidLeaseId(_ id: String) -> Bool {
        id.range(of: "^lease-[0-9A-Fa-f-]{36}$", options: .regularExpression) != nil
    }

    private func isValidTransitionId(_ id: String) -> Bool {
        id.range(of: "^ctx-[0-9a-f]{32}$", options: .regularExpression) != nil
    }

    private func contextErrorCode(_ error: Error, fallback: String) -> String {
        if let contextError = error as? JarvisContextError {
            switch contextError {
            case .invalidScope: return "INVALID_SCOPE"
            case .invalid: return fallback
            }
        }
        if let storeError = error as? JarvisContextStoreError {
            switch storeError {
            case .scopeMismatch: return "CONTEXT_SCOPE_MISMATCH"
            case .staleConfiguration: return "CONTEXT_GENERATION_STALE"
            default: return fallback
            }
        }
        return fallback
    }

    private func reconcileLocationMonitoring() {
        guard regionOperation == nil else { return }
        let snapshot: JarvisGeofenceSnapshot
        do {
            snapshot = try contextStore.snapshot()
        } catch {
            // Fail closed if protected state cannot be read.
            stopManagedRegions()
            locationManager.stopMonitoringSignificantLocationChanges()
            return
        }
        guard locationManager.authorizationStatus == .authorizedAlways, !snapshot.geofences.isEmpty else {
            stopManagedRegions()
            locationManager.stopMonitoringSignificantLocationChanges()
            return
        }
        let expected = platformGeofences(snapshot)
        let monitored = locationManager.monitoredRegions
        var matchingIds = Set<String>()
        for region in monitored where region.identifier.hasPrefix(jarvisContextRegionPrefix) {
            if let geofence = expected[region.identifier], regionMatches(region, geofence: geofence) {
                matchingIds.insert(region.identifier)
            } else {
                locationManager.stopMonitoring(for: region)
            }
        }
        for (identifier, geofence) in expected where !matchingIds.contains(identifier) {
            locationManager.startMonitoring(for: makeRegion(geofence, snapshot: snapshot))
        }
        if snapshot.significantChanges && CLLocationManager.significantLocationChangeMonitoringAvailable() {
            locationManager.startMonitoringSignificantLocationChanges()
        } else {
            locationManager.stopMonitoringSignificantLocationChanges()
        }
    }

    private func stopManagedRegions() {
        locationManager.monitoredRegions
            .filter { $0.identifier.hasPrefix(jarvisContextRegionPrefix) }
            .forEach { locationManager.stopMonitoring(for: $0) }
    }

    private func beginRegionPhase(
        _ operation: RegionOperation,
        phase: RegionOperation.Phase,
        snapshot: JarvisGeofenceSnapshot
    ) {
        guard regionOperation === operation else { return }
        operation.timeout?.cancel()
        operation.phase = phase
        operation.pending = platformGeofences(snapshot)
        stopManagedRegions()
        locationManager.stopMonitoringSignificantLocationChanges()
        guard !snapshot.geofences.isEmpty else {
            completeRegionPhase(operation)
            return
        }
        for geofence in snapshot.geofences {
            locationManager.startMonitoring(for: makeRegion(geofence, snapshot: snapshot))
        }
        let timeout = DispatchWorkItem { [weak self, weak operation] in
            guard let self, let operation, self.regionOperation === operation else { return }
            let error = NSError(
                domain: "chat.jarvis.context",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "CoreLocation did not confirm region monitoring in time"]
            )
            if operation.phase == .applying {
                self.beginRegionRollback(operation, failure: error)
            } else {
                self.finishRegionOperation(
                    operation,
                    code: "GEOFENCE_ROLLBACK_FAILED",
                    message: "CoreLocation did not confirm restoration of the previous geofence set",
                    error: error
                )
            }
        }
        operation.timeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + Constants.regionOperationTimeoutSeconds, execute: timeout)
    }

    private func completeRegionPhase(_ operation: RegionOperation) {
        guard regionOperation === operation else { return }
        operation.timeout?.cancel()
        operation.timeout = nil
        if operation.phase == .applying {
            do {
                let snapshot = try contextStore.commitGeofenceReplacement(operation.replacement)
                if snapshot.significantChanges && CLLocationManager.significantLocationChangeMonitoringAvailable() {
                    locationManager.startMonitoringSignificantLocationChanges()
                }
                regionOperation = nil
                operation.call.resolve(geofenceListResult(snapshot))
            } catch {
                beginRegionRollback(operation, failure: error)
            }
        } else {
            if operation.previous.significantChanges && CLLocationManager.significantLocationChangeMonitoringAvailable() {
                locationManager.startMonitoringSignificantLocationChanges()
            }
            finishRegionOperation(
                operation,
                code: "GEOFENCE_CONFIGURATION_FAILED",
                message: "Geofence replacement failed and the previous set was restored",
                error: operation.failure ?? NSError(domain: "chat.jarvis.context", code: 2, userInfo: nil)
            )
        }
    }

    private func beginRegionRollback(_ operation: RegionOperation, failure: Error) {
        guard regionOperation === operation else { return }
        operation.failure = operation.failure ?? failure
        guard locationManager.authorizationStatus == .authorizedAlways || operation.previous.geofences.isEmpty else {
            finishRegionOperation(
                operation,
                code: "GEOFENCE_ROLLBACK_FAILED",
                message: "Geofence replacement failed after Always permission was revoked",
                error: failure
            )
            return
        }
        beginRegionPhase(operation, phase: .rollingBack, snapshot: operation.previous)
    }

    private func finishRegionOperation(
        _ operation: RegionOperation,
        code: String,
        message: String,
        error: Error
    ) {
        guard regionOperation === operation else { return }
        operation.timeout?.cancel()
        operation.timeout = nil
        regionOperation = nil
        if code == "GEOFENCE_ROLLBACK_FAILED" {
            stopManagedRegions()
            locationManager.stopMonitoringSignificantLocationChanges()
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                self?.reconcileLocationMonitoring()
            }
        }
        operation.call.reject(message, code, error)
    }

    private func platformGeofences(_ snapshot: JarvisGeofenceSnapshot) -> [String: JarvisManagedGeofence] {
        Dictionary(uniqueKeysWithValues: snapshot.geofences.map { geofence in
            (
                jarvisContextRegionPrefix + jarvisPlatformGeofenceIdentity(
                    scope: snapshot.scope,
                    configurationGeneration: snapshot.generation,
                    geofenceId: geofence.id
                ),
                geofence
            )
        })
    }

    private func makeRegion(
        _ geofence: JarvisManagedGeofence,
        snapshot: JarvisGeofenceSnapshot
    ) -> CLCircularRegion {
        let region = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: geofence.latitude, longitude: geofence.longitude),
            radius: geofence.radiusM,
            identifier: jarvisContextRegionPrefix + jarvisPlatformGeofenceIdentity(
                scope: snapshot.scope,
                configurationGeneration: snapshot.generation,
                geofenceId: geofence.id
            )
        )
        region.notifyOnEntry = geofence.notifyOnEntry
        region.notifyOnExit = geofence.notifyOnExit
        return region
    }

    private func regionMatches(_ region: CLRegion, geofence: JarvisManagedGeofence) -> Bool {
        guard let circular = region as? CLCircularRegion else { return false }
        return abs(circular.center.latitude - geofence.latitude) < 0.000_001 &&
            abs(circular.center.longitude - geofence.longitude) < 0.000_001 &&
            abs(circular.radius - geofence.radiusM) < 0.5 &&
            circular.notifyOnEntry == geofence.notifyOnEntry &&
            circular.notifyOnExit == geofence.notifyOnExit
    }

    private func recordTransition(region: CLRegion, transition: String) {
        guard region.identifier.hasPrefix(jarvisContextRegionPrefix) else { return }
        do {
            let snapshot = try contextStore.snapshot()
            guard let geofence = platformGeofences(snapshot)[region.identifier] else { return }
            let result = try contextStore.enqueueTransition(
                geofenceId: geofence.id,
                transition: transition,
                occurredAt: currentMilliseconds(),
                expectedGeneration: snapshot.generation,
                expectedScope: snapshot.scope
            )
            if result.inserted {
                let availability = try contextStore.transitionAvailability(now: currentMilliseconds())
                var event: JSObject = [
                    "pending": result.pending,
                    "available": availability.available
                ]
                if let nextExpiry = availability.nextLeaseExpiryAt {
                    event["nextLeaseExpiryAt"] = nextExpiry
                }
                notifyListeners("transitionAvailable", data: event, retainUntilConsumed: true)
            }
        } catch {
            // Protected storage failures are fail-closed; coordinates are never placed in fallback storage.
        }
    }

    private func boundedMilliseconds(
        _ value: Double?,
        defaultValue: Int64,
        minimum: Int64,
        maximum: Int64
    ) -> Int64? {
        let candidate = value ?? Double(defaultValue)
        guard candidate.isFinite else { return nil }
        let bounded = min(max(candidate, Double(minimum)), Double(maximum))
        return Int64(bounded)
    }

    private func timestampMilliseconds(_ value: Double) -> Int64? {
        guard value.isFinite, value >= 0, value <= Double(Constants.maximumTimestampMs) else { return nil }
        return Int64(value)
    }

    private func number(_ value: Any?) -> Double? {
        if value is Bool { return nil }
        if let number = value as? NSNumber { return number.doubleValue }
        if let number = value as? Double { return number }
        if let number = value as? Int { return Double(number) }
        return nil
    }

    private func rounded(_ value: Double, digits: Int) -> Double {
        let scale = pow(10, Double(digits))
        return (value * scale).rounded() / scale
    }

    private func isValidGeofenceId(_ id: String) -> Bool {
        id.range(of: "^[A-Za-z0-9._:-]{1,128}$", options: .regularExpression) != nil
    }

    private enum PermissionTarget {
        case whenInUse
        case always
    }

    private struct ForegroundRequest {
        let precise: Bool
        let maximumAgeMs: Int64
        let ttlMs: Int64
    }

    private final class RegionOperation {
        enum Phase: Equatable {
            case applying
            case rollingBack
        }

        let call: CAPPluginCall
        let replacement: JarvisGeofenceReplacement
        var previous: JarvisGeofenceSnapshot { replacement.previous }
        var desired: JarvisGeofenceSnapshot { replacement.desired }
        var phase: Phase = .applying
        var pending: [String: JarvisManagedGeofence] = [:]
        var failure: Error?
        var timeout: DispatchWorkItem?

        init(
            call: CAPPluginCall,
            replacement: JarvisGeofenceReplacement
        ) {
            self.call = call
            self.replacement = replacement
        }
    }

    private enum Constants {
        static let maximumBusyRangeMs: Int64 = 366 * 24 * 60 * 60 * 1000
        static let maximumCalendarRows = 10_000
        static let maximumTimestampMs: Int64 = 8_640_000_000_000_000
        static let regionOperationTimeoutSeconds: Double = 30
        static let defaultLeaseDurationMs: Int64 = 60_000
        static let minimumLeaseDurationMs: Int64 = 5_000
        static let maximumLeaseDurationMs: Int64 = 15 * 60 * 1000
    }
}

private enum JarvisContextError: LocalizedError {
    case invalid(String)
    case invalidScope(String)

    var errorDescription: String? {
        switch self {
        case .invalid(let message): return message
        case .invalidScope(let message): return message
        }
    }
}
