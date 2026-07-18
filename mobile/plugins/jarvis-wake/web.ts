import { WebPlugin } from "@capacitor/core";
import type { JarvisWakePlugin } from "./definitions";

/**
 * Browser / no-native fallback. A plain web context can't run a background mic listener, so this is a
 * deliberate no-op that reports `supported: false`. The Jarvis client bridge checks isSupported()/the
 * plugin presence and simply doesn't offer background wake-word when this stub is what's loaded — so
 * the app degrades cleanly to foreground (tap-the-mic) voice. The real work is the native impl.
 */
export class JarvisWakeWeb extends WebPlugin implements JarvisWakePlugin {
  async isSupported(): Promise<{ supported: boolean }> {
    return { supported: false };
  }
  async start(): Promise<void> {
    /* no-op on web */
  }
  async stop(): Promise<void> {
    /* no-op on web */
  }
}
