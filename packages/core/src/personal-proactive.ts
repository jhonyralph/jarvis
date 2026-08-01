import type { ContextSuggestion, PersonalAssistantSettings, PersonalNotificationRecord } from "@jarvis/protocol";
import { isQuietTime } from "./personal-context.js";

export interface ProactiveDecision { allowed: boolean; reason?: "disabled" | "paused" | "quiet_hours" | "low_score" | "daily_limit" | "cooldown" | "duplicate"; }

export function evaluateProactiveSuggestion(input: {
  settings: PersonalAssistantSettings;
  suggestion: ContextSuggestion;
  notifications: PersonalNotificationRecord[];
  now?: number;
}): ProactiveDecision {
  const now = input.now ?? Date.now(), policy = input.settings.notifications;
  if (!input.settings.enabled) return { allowed: false, reason: "disabled" };
  if (input.settings.paused) return { allowed: false, reason: "paused" };
  if (input.suggestion.score < policy.minScore) return { allowed: false, reason: "low_score" };
  if (isQuietTime(new Date(now), policy.quietStart, policy.quietEnd)) return { allowed: false, reason: "quiet_hours" };
  const shown = input.notifications.filter((row) => ["pending", "shown", "opened", "ignored", "dismissed", "acted"].includes(row.outcome));
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  if (shown.filter((row) => row.at >= dayStart.getTime()).length >= policy.maxPerDay) return { allowed: false, reason: "daily_limit" };
  if (shown.some((row) => row.suggestionId === input.suggestion.id)) return { allowed: false, reason: "duplicate" };
  const last = shown.sort((a, b) => b.at - a.at)[0];
  if (last && now - last.at < policy.cooldownMinutes * 60_000) return { allowed: false, reason: "cooldown" };
  return { allowed: true };
}
