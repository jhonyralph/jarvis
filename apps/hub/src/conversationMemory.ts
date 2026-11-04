import type { PersonalPreference } from "@jarvis/protocol";

/** Only user-confirmed decisions about the selected task enter conversation. Source text is data. */
export function conversationMemories(preferences: PersonalPreference[], scope: { runnerId: string; sessionId: string } | undefined, now = Date.now()): Array<{ kind: string; value: string; source: string }> {
  if (!scope) return [];
  const prefix = `${scope.runnerId}/${scope.sessionId}/`;
  return preferences.filter((p) => p.kind === "explicit" && p.decision !== "rejected" && (!p.expiresAt || p.expiresAt > now)
    && ["conversation.decision", "conversation.responsibility"].includes(p.key))
    .flatMap((p) => { const source = p.evidence.find((e) => e.sourceId?.startsWith(prefix))?.sourceId;
      return source ? [{ kind: p.key, value: p.value, source }] : []; });
}
