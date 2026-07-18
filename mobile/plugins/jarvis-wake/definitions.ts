import type { PluginListenerHandle } from "@capacitor/core";

/**
 * Custom Capacitor plugin contract: an on-device, always-on "Jey Jarvis" wake-word detector that runs
 * in the BACKGROUND (screen locked / app minimized) — something a browser PWA fundamentally cannot do.
 *
 * This file is the TS CONTRACT + (see web.ts) a browser no-op. The real detector is native
 * (Android/iOS) and is NOT included — writing it blind would be dishonest. See README.md for the
 * native implementation spec (engine choice, background-audio/foreground-service, entitlements).
 */
export interface JarvisWakePlugin {
  /** True only where a native wake engine is actually built for this platform. The web stub returns false. */
  isSupported(): Promise<{ supported: boolean }>;
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
