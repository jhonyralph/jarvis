/**
 * Normalized WebSocket protocol between Clients, the Hub, and Runners.
 * All three speak these messages; the Hub is the router and source of truth.
 */
import type { AgentSession, AgentMessage } from "./adapters.js";

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

// --- Runner  ->  Hub ---
export type RunnerToHub =
  | { t: "register"; runnerId: string; host: string; agents: string[] }
  | { t: "session"; session: AgentSession }
  | { t: "output"; message: AgentMessage };

// --- Hub  ->  Runner ---
export type HubToRunner =
  | { t: "start"; sessionId: string; agent: string; cwd: string }
  | { t: "send"; sessionId: string; text: string }
  | { t: "stop"; sessionId: string };

export type AnyMessage =
  | ClientToHub
  | HubToClient
  | RunnerToHub
  | HubToRunner;
