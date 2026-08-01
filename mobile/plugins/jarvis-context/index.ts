import { Capacitor, registerPlugin } from "@capacitor/core";
import type { JarvisContextPlugin } from "./definitions";

export const JarvisContext = registerPlugin<JarvisContextPlugin>("JarvisContext", {
  web: () => import("./web").then((module) => new module.JarvisContextWeb()),
});

export function isJarvisContextNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("JarvisContext");
}

export * from "./definitions";
