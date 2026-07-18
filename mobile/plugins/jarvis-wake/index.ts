import { registerPlugin } from "@capacitor/core";
import type { JarvisWakePlugin } from "./definitions";

/**
 * Register the plugin. On a platform with the native impl built, Capacitor routes to it; otherwise it
 * lazy-loads the web no-op stub. The client bridge reads it as window.Capacitor.Plugins.JarvisWake.
 */
export const JarvisWake = registerPlugin<JarvisWakePlugin>("JarvisWake", {
  web: () => import("./web").then((m) => new m.JarvisWakeWeb()),
});

export * from "./definitions";
