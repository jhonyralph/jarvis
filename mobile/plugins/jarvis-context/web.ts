import { WebPlugin } from "@capacitor/core";
import type {
  AckTransitionsOptions,
  AckTransitionsResult,
  BusyIntervalsEnvelope,
  BusyIntervalsOptions,
  ConfigureGeofencesOptions,
  DrainTransitionsOptions,
  DrainTransitionsResult,
  EraseAllOptions,
  EraseAllResult,
  ForegroundLocationEnvelope,
  ForegroundLocationOptions,
  GeofenceListResult,
  JarvisContextCapabilities,
  JarvisContextPermissionStatus,
  JarvisContextPlugin,
  LeaseTransitionsOptions,
  ListGeofencesOptions,
  RemoveGeofencesOptions,
  RequestContextPermissionsOptions,
  TransitionLeaseResult,
} from "./definitions";

const WEB_CAPABILITIES: JarvisContextCapabilities = {
  available: false,
  platform: "web",
  foregroundLocation: false,
  busyIntervals: false,
  geofences: false,
  backgroundLocation: false,
  significantLocationChanges: false,
  maxGeofences: 0,
};

const WEB_PERMISSIONS: JarvisContextPermissionStatus = {
  location: "unavailable",
  locationAccuracy: "unknown",
  calendar: "unavailable",
  backgroundLocation: "unavailable",
  capabilities: WEB_CAPABILITIES,
};

export class JarvisContextWeb extends WebPlugin implements JarvisContextPlugin {
  async isSupported(): Promise<JarvisContextCapabilities> {
    return { ...WEB_CAPABILITIES };
  }

  async checkPermissions(): Promise<JarvisContextPermissionStatus> {
    return { ...WEB_PERMISSIONS, capabilities: { ...WEB_CAPABILITIES } };
  }

  async requestPermissions(
    _options: RequestContextPermissionsOptions = {},
  ): Promise<JarvisContextPermissionStatus> {
    return this.checkPermissions();
  }

  async getCurrentLocation(_options: ForegroundLocationOptions = {}): Promise<ForegroundLocationEnvelope> {
    throw this.unavailable("JarvisContext foreground location is available only in a native shell");
  }

  async getBusyIntervals(_options: BusyIntervalsOptions): Promise<BusyIntervalsEnvelope> {
    throw this.unavailable("Device calendar busy intervals are available only in a native shell");
  }

  async configureGeofences(_options: ConfigureGeofencesOptions): Promise<GeofenceListResult> {
    throw this.unavailable("Geofences are available only in a native shell");
  }

  async removeGeofences(_options: RemoveGeofencesOptions): Promise<GeofenceListResult> {
    throw this.unavailable("Geofences are available only in a native shell");
  }

  async listGeofences(_options: ListGeofencesOptions = {}): Promise<GeofenceListResult> {
    throw this.unavailable("Geofences are available only in a native shell");
  }

  async leaseTransitions(_options: LeaseTransitionsOptions): Promise<TransitionLeaseResult> {
    throw this.unavailable("Geofence transitions are available only in a native shell");
  }

  async ackTransitions(_options: AckTransitionsOptions): Promise<AckTransitionsResult> {
    throw this.unavailable("Geofence transitions are available only in a native shell");
  }

  async eraseAll(_options: EraseAllOptions): Promise<EraseAllResult> {
    throw this.unavailable("Native context erasure is available only in a native shell");
  }

  async drainTransitions(_options: DrainTransitionsOptions = {}): Promise<DrainTransitionsResult> {
    throw this.unavailable("Geofence transitions are available only in a native shell");
  }
}
