import type { PluginListenerHandle } from "@capacitor/core";

/**
 * Custom Capacitor plugin contract: an on-device, always-on "Hey Jarvis" wake-word detector that runs
 * in the BACKGROUND (screen locked / app minimized) — something a browser PWA fundamentally cannot do.
 *
 * This file is the TS CONTRACT + (see web.ts) a browser no-op. Android has a native implementation
 * in the app shell; iOS still needs a native audio-background implementation.
 */
export interface JarvisWakePlugin {
  /** True only where a native wake engine is built and configured for this platform. */
  isSupported(): Promise<{ supported: boolean; running?: boolean; reason?: string; error?: string }>;
  /** Runtime diagnostics for settings screens / support. */
  status(): Promise<{ supported: boolean; running: boolean; keyword?: string; phrase?: string; engine?: string; reason?: string; error?: string }>;
  /** Start always-on background listening. Requires mic permission + the platform background-audio /
   *  foreground-service setup (README). Safe to call repeatedly. */
  start(options?: { keyword?: string }): Promise<void>;
  /** Stop listening and release the mic. */
  stop(): Promise<void>;
  /** Fired when the wake word is detected — the JS side then starts a normal Jarvis voice capture. */
  addListener(
    eventName: "wake",
    listenerFunc: (data: { at: number }) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  removeAllListeners(): Promise<void>;
}
