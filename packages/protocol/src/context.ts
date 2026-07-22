import type { SessionContinuity } from "./agent.js";

export const CONTEXT_MANIFEST_SCHEMA_VERSION = 1 as const;

export interface ContextActor {
  userId?: string;
  deviceId?: string;
  source: "user" | "queue" | "routine" | "system";
}

export interface ContextInstructionFile {
  path: string;
  size: number;
  sha256: string;
  scope: "cwd" | "ancestor" | "global";
  /** Providers discover instruction files themselves; Jarvis can only prove candidacy. */
  providerLoad: "candidate";
}

export interface ContextManifest {
  schemaVersion: typeof CONTEXT_MANIFEST_SCHEMA_VERSION;
  turnId: string;
  sessionId: string;
  runnerId: string;
  agent: string;
  cwd: string;
  createdAt: number;
  actor?: ContextActor;
  continuity: {
    kind: SessionContinuity;
    nativeSessionId?: string;
    historyMessages: number;
    historyChars: number;
  };
  prompt: {
    userChars: number;
    agentChars: number;
    agentSha256: string;
    transformed: boolean;
    attachments: Array<{ name: string; kind: "image" | "file"; bytes?: number }>;
  };
  /** Normal chat turns never receive semantic-memory text implicitly. */
  semanticMemory: {
    injected: boolean;
    entryIds: string[];
  };
  instructionFiles: ContextInstructionFile[];
}
