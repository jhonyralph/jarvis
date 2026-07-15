/**
 * Client <-> Hub protocol (legacy sketch).
 *
 * NOTE: the as-built Client<->Hub protocol is currently defined inline in the Hub
 * (apps/hub) and is richer than this sketch. The Runner<->Hub contract has moved to
 * ./runner.ts (the real, implemented one). These Client types are kept for reference.
 */
import type { AgentSession, AgentMessage } from "./adapters.js";
import type { RunnerToHub, HubToRunner } from "./runner.js";

// --- Client  ->  Hub ---
export type ClientToHub =
  | { t: "hello"; client: "mobile" | "desktop"; clientId: string }
  | { t: "start-session"; runnerId: string; agent: string; cwd: string }
  | { t: "send"; sessionId: string; text: string }
  /** push-to-talk audio chunk (base64 wav/pcm) to be transcribed by the Hub */
  | { t: "voice"; sessionId: string; audio: string }
  /** subscribe to a session; audio=true => also receive spoken (TTS) output */
  | { t: "listen"; sessionId: string; audio: boolean }
  | { t: "unlisten"; sessionId: string };

// --- Hub  ->  Client ---
export type HubToClient =
  | { t: "session"; session: AgentSession }
  | { t: "message"; message: AgentMessage }
  /** STT result for a voice chunk the client sent */
  | { t: "transcript"; sessionId: string; text: string }
  /** spoken response, broadcast to listeners subscribed with audio=true */
  | { t: "tts"; sessionId: string; audio: string; final?: boolean }
  | { t: "error"; message: string };

// Runner<->Hub types now live in ./runner.ts (the real contract).

export type AnyMessage =
  | ClientToHub
  | HubToClient
  | RunnerToHub
  | HubToRunner;
