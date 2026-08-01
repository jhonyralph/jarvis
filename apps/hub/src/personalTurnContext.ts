import type { ContextPurpose } from "@jarvis/protocol";
import { routePersonalIntent, type PersonalIntentMatch } from "@jarvis/core";
import type { PersonalAssistantActor, PersonalAssistantService, PersonalContextQueryResponse } from "./personalAssistant.js";

export interface PreparedPersonalTurnContext {
  intent: PersonalIntentMatch;
  purpose: ContextPurpose;
  contextPrefix: string;
  response: PersonalContextQueryResponse;
}

export interface PreparePersonalTurnContextInput {
  assistant: Pick<PersonalAssistantService, "contextForTurn">;
  text: string;
  actor: PersonalAssistantActor;
  allowed: boolean;
  signal?: AbortSignal;
  onError?: (error: unknown) => void;
}

const PURPOSE_BY_INTENT: Record<PersonalIntentMatch["intent"], ContextPurpose> = {
  nearby: "nearby",
  mobility: "mobility",
  calendar: "calendar",
  events: "events",
  weather: "weather",
  automation: "automation",
  ev: "nearby",
};

export async function preparePersonalTurnContext(input: PreparePersonalTurnContextInput): Promise<PreparedPersonalTurnContext | undefined> {
  if (!input.allowed) return undefined;
  const intent = routePersonalIntent(input.text);
  if (!intent) return undefined;
  const purpose = PURPOSE_BY_INTENT[intent.intent];
  const filters = Object.fromEntries(Object.entries({
    category: intent.slots.category,
    radiusM: intent.slots.radiusMeters,
    radiusKm: intent.slots.radiusMeters === undefined ? undefined : intent.slots.radiusMeters / 1_000,
    maxDurationMinutes: intent.slots.durationMinutes,
    reference: intent.slots.reference,
    dateText: intent.slots.dateText,
    timeText: intent.slots.timeText,
    requireOpen: intent.slots.requireOpen,
    restrictions: intent.slots.restrictions,
  }).filter((entry): entry is [string, string | number | boolean | string[]] => entry[1] !== undefined));
  try {
    const prepared = await input.assistant.contextForTurn({
      purpose,
      text: (intent.slots.query || input.text).slice(0, 500),
      locale: intent.locale,
      limit: 8,
      ...(Object.keys(filters).length ? { filters } : {}),
    }, input.actor, input.signal);
    if (!prepared.response.results.length && !prepared.response.errors.length && !prepared.response.suggestions.length) return undefined;
    if (prepared.agentText.length > 32_768) throw new Error("personal turn context exceeds the runner envelope");
    return { intent, purpose, contextPrefix: prepared.agentText, response: prepared.response };
  } catch (error) {
    input.onError?.(error);
    return undefined;
  }
}
