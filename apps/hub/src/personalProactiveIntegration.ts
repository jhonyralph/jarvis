import type { ContextPurpose, ContextSuggestion } from "@jarvis/protocol";
import { isDue, scheduleLabel, type Routine } from "@jarvis/core";
import type { PersonalAssistantService } from "./personalAssistant.js";
import type { PushCenter } from "./push.js";
import {
  PersonalProactiveScheduler,
  type PersonalProactiveCandidate,
  type PersonalProactiveDeliveryTarget,
  type PersonalProactiveNotification,
  type PersonalProactiveTarget,
} from "./personalProactiveScheduler.js";

export interface PersonalProactiveIntegrationOptions {
  assistant: PersonalAssistantService;
  push: PushCenter;
  listDevices: () => ReadonlyArray<{ id: string; userId: string }>;
  listRoutines?: (target: PersonalProactiveDeliveryTarget) => readonly Routine[];
  includeLocalDevice?: boolean;
  sendInApp?: (notification: PersonalProactiveNotification, target: PersonalProactiveDeliveryTarget) => boolean;
  intervalMs?: number;
  now?: () => number;
  onError?: (error: unknown, context: Record<string, unknown>) => void;
}

const PURPOSES: ContextPurpose[] = ["calendar", "events", "weather"];
const HOUR_MS = 60 * 60_000;
const ROUTINE_NOTICE_MINUTES = 30;

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function proactiveText(locale: string, values: [string, string, string]): string {
  return locale === "pt" ? values[0] : locale === "es" ? values[2] : values[1];
}

function sourceExpiry(sources: ContextSuggestion["sources"], resultExpiries: Map<string, number>, fallback: number): number {
  const values = sources.map((source) => resultExpiries.get(source.sourceId)).filter((value): value is number => Number.isFinite(value));
  return values.length ? Math.min(...values, fallback) : fallback;
}

function calendarCandidates(
  results: Array<{ items: ContextSuggestion["candidate"][]; sourceId: string; expiresAt: number }>,
  request: { at: number; locale: string },
): PersonalProactiveCandidate[] {
  const expiries = new Map(results.map((result) => [result.sourceId, result.expiresAt]));
  return results.flatMap((result) => result.items).flatMap((candidate) => {
    if (candidate.kind !== "calendar_event" && candidate.kind !== "calendar_availability") return [];
    const data = objectValue(candidate.data), startAt = finiteTime(data?.startAt), endAt = finiteTime(data?.endAt);
    if (!startAt || !endAt || endAt <= request.at || startAt > request.at + 2 * HOUR_MS || data?.availability === "free") return [];
    const startsInMinutes = Math.max(0, Math.round((startAt - request.at) / 60_000));
    const hasDetails = candidate.kind === "calendar_event" && candidate.title && candidate.title.toLowerCase() !== "busy";
    const title = hasDetails ? candidate.title : proactiveText(request.locale, ["Compromisso em breve", "Upcoming calendar commitment", "Compromiso próximo"]);
    const reason = startsInMinutes > 0
      ? proactiveText(request.locale, [`Começa em ${startsInMinutes} min`, `Starts in ${startsInMinutes} min`, `Empieza en ${startsInMinutes} min`])
      : proactiveText(request.locale, ["Está acontecendo agora", "Happening now", "Está ocurriendo ahora"]);
    const expiresAt = Math.min(endAt, startAt > request.at ? startAt : request.at + 30 * 60_000, sourceExpiry(candidate.sources, expiries, request.at + 2 * HOUR_MS));
    if (expiresAt <= request.at) return [];
    const suggestion: ContextSuggestion = {
      id: `proactive:calendar:${candidate.id}:${startAt}`,
      kind: "calendar_reminder",
      candidate: { ...structuredClone(candidate), title },
      score: startsInMinutes <= 30 ? 0.92 : startsInMinutes <= 60 ? 0.84 : 0.76,
      reasons: [reason],
      caveats: candidate.sources.some((source) => source.freshness === "stale" || source.freshness === "unknown")
        ? [proactiveText(request.locale, ["A agenda pode estar desatualizada", "Calendar data may be stale", "La agenda puede estar desactualizada"])]
        : [],
      sources: structuredClone(candidate.sources),
      actions: [],
    };
    return [{ suggestion, validUntil: expiresAt, dedupeKey: `calendar:${candidate.id}:${startAt}` }];
  });
}

function weatherCandidates(
  results: Array<{ items: ContextSuggestion["candidate"][]; sourceId: string; expiresAt: number }>,
  request: { at: number; locale: string },
): PersonalProactiveCandidate[] {
  const expiries = new Map(results.map((result) => [result.sourceId, result.expiresAt]));
  const output: PersonalProactiveCandidate[] = [];
  for (const candidate of results.flatMap((result) => result.items)) {
    const data = objectValue(candidate.data), current = objectValue(data?.current);
    if (candidate.kind === "weather_alert" && data?.officialAlert === true) {
      const expiresAt = finiteTime(data.expiresAt) || sourceExpiry(candidate.sources, expiries, request.at + 6 * HOUR_MS);
      if (expiresAt <= request.at) continue;
      const severity = String(data.severity || "unknown").toLowerCase();
      const score = severity === "extreme" ? 0.99 : severity === "severe" ? 0.96 : severity === "moderate" ? 0.9 : severity === "minor" ? 0.82 : 0.8;
      const severityLabel = String(data.severity || "").trim();
      const area = String(data.areaDescription || "").trim();
      const reason = proactiveText(request.locale, [
        `Alerta oficial${severityLabel ? ` · severidade ${severityLabel}` : ""}${area ? ` · ${area}` : ""}`,
        `Official alert${severityLabel ? ` · severity ${severityLabel}` : ""}${area ? ` · ${area}` : ""}`,
        `Alerta oficial${severityLabel ? ` · severidad ${severityLabel}` : ""}${area ? ` · ${area}` : ""}`,
      ]);
      const suggestion: ContextSuggestion = {
        id: `proactive:weather-alert:${candidate.id}`,
        kind: "weather_alert",
        candidate: structuredClone(candidate),
        score,
        reasons: [reason],
        caveats: candidate.sources.some((source) => source.freshness === "stale" || source.freshness === "unknown")
          ? [proactiveText(request.locale, ["A fonte oficial pode estar desatualizada", "The official source may be stale", "La fuente oficial puede estar desactualizada"])]
          : [],
        sources: structuredClone(candidate.sources),
        actions: [],
      };
      output.push({ suggestion, validUntil: expiresAt, dedupeKey: `weather-alert:${String(data.identifier || candidate.id)}` });
      continue;
    }
    if (candidate.kind !== "weather_forecast") continue;
    const hourly = Array.isArray(data?.hourly) ? data.hourly.map(objectValue).filter((row): row is Record<string, unknown> => !!row) : [];
    const samples = [current, ...hourly].filter((row): row is Record<string, unknown> => {
      const validAt = finiteTime(row?.validAt);
      return !!validAt && validAt >= request.at - HOUR_MS && validAt <= request.at + 6 * HOUR_MS;
    });
    let selected: { sample: Record<string, unknown>; condition: "storm" | "rain" | "wind" | "heat" | "cold"; score: number } | undefined;
    for (const sample of samples) {
      const code = Number(sample.weatherCode), probability = Number(sample.precipitationProbabilityPercent), rain = Math.max(Number(sample.rainMm) || 0, Number(sample.precipitationMm) || 0);
      const wind = Number(sample.windSpeedKmh), apparent = Number(sample.apparentTemperatureC), temperature = Number.isFinite(apparent) ? apparent : Number(sample.temperatureC);
      const option = Number.isFinite(code) && code >= 95 ? { sample, condition: "storm" as const, score: 0.96 }
        : (Number.isFinite(probability) && probability >= 70) || rain >= 5 ? { sample, condition: "rain" as const, score: 0.9 }
        : Number.isFinite(wind) && wind >= 50 ? { sample, condition: "wind" as const, score: 0.88 }
        : Number.isFinite(temperature) && temperature >= 35 ? { sample, condition: "heat" as const, score: 0.86 }
        : Number.isFinite(temperature) && temperature <= 5 ? { sample, condition: "cold" as const, score: 0.86 }
        : undefined;
      if (option && (!selected || option.score > selected.score)) selected = option;
    }
    if (!selected) continue;
    const copy = {
      storm: [["Risco de tempestade", "Storm risk", "Riesgo de tormenta"], ["A previsão indica tempestade nas próximas horas", "The forecast indicates a storm in the next hours", "El pronóstico indica tormenta en las próximas horas"]],
      rain: [["Chuva forte prevista", "Heavy rain forecast", "Lluvia intensa prevista"], ["Pode chover forte nas próximas horas", "Heavy rain is possible in the next hours", "Puede llover fuerte en las próximas horas"]],
      wind: [["Vento forte previsto", "Strong wind forecast", "Viento fuerte previsto"], ["A previsão indica vento forte nas próximas horas", "Strong wind is forecast for the next hours", "Se prevé viento fuerte en las próximas horas"]],
      heat: [["Calor intenso previsto", "Extreme heat forecast", "Calor intenso previsto"], ["A sensação térmica pode ficar muito alta", "Apparent temperature may become very high", "La sensación térmica puede ser muy alta"]],
      cold: [["Frio intenso previsto", "Very cold weather forecast", "Frío intenso previsto"], ["A sensação térmica pode ficar muito baixa", "Apparent temperature may become very low", "La sensación térmica puede ser muy baja"]],
    }[selected.condition] as [[string, string, string], [string, string, string]];
    const validAt = finiteTime(selected.sample.validAt) || request.at;
    const expiresAt = Math.min(validAt + 2 * HOUR_MS, sourceExpiry(candidate.sources, expiries, request.at + 6 * HOUR_MS));
    if (expiresAt <= request.at) continue;
    const suggestion: ContextSuggestion = {
      id: `proactive:weather:${candidate.id}:${selected.condition}:${validAt}`,
      kind: "weather_risk_estimate",
      candidate: {
        ...structuredClone(candidate),
        id: `${candidate.id}:${selected.condition}:${validAt}`,
        title: proactiveText(request.locale, copy[0]),
        data: { ...structuredClone(candidate.data), advisoryType: "derived_forecast_risk", officialAlert: false },
      },
      score: selected.score,
      reasons: [proactiveText(request.locale, copy[1])],
      caveats: [
        proactiveText(request.locale, ["Estimativa derivada da previsão; não é um alerta oficial", "Estimate derived from forecast data; this is not an official alert", "Estimación derivada del pronóstico; no es una alerta oficial"]),
        ...(candidate.sources.some((source) => source.freshness === "stale" || source.freshness === "unknown")
          ? [proactiveText(request.locale, ["A previsão pode estar desatualizada", "Forecast data may be stale", "El pronóstico puede estar desactualizado"])]
          : []),
      ],
      sources: structuredClone(candidate.sources),
      actions: [],
    };
    output.push({ suggestion, validUntil: expiresAt, dedupeKey: `weather:${selected.condition}:${new Date(validAt).toISOString().slice(0, 13)}` });
  }
  return output;
}

function finiteTime(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function routineCandidates(routines: readonly Routine[], request: { at: number; locale: string }): PersonalProactiveCandidate[] {
  const output: PersonalProactiveCandidate[] = [];
  for (const routine of routines.slice(0, 100)) {
    if (!routine?.enabled || !routine.id || !routine.name) continue;
    let scheduledAt: number | undefined;
    for (let minute = 0; minute <= ROUTINE_NOTICE_MINUTES; minute += 1) {
      const candidateAt = request.at + minute * 60_000;
      if (isDue(routine, new Date(candidateAt))) { scheduledAt = candidateAt; break; }
    }
    if (scheduledAt === undefined) continue;
    const startsIn = Math.max(0, Math.round((scheduledAt - request.at) / 60_000));
    const title = proactiveText(request.locale, [
      `Rotina próxima: ${routine.name}`,
      `Upcoming routine: ${routine.name}`,
      `Rutina próxima: ${routine.name}`,
    ]);
    const reason = startsIn === 0
      ? proactiveText(request.locale, ["Agendada para agora", "Scheduled for now", "Programada para ahora"])
      : proactiveText(request.locale, [`Agendada para daqui a ${startsIn} min`, `Scheduled in ${startsIn} min`, `Programada dentro de ${startsIn} min`]);
    output.push({
      suggestion: {
        id: `proactive:routine:${routine.id}:${scheduledAt}`,
        kind: "routine_reminder",
        candidate: {
          id: routine.id,
          kind: "routine",
          title,
          data: { routineId: routine.id, scheduledAt, schedule: scheduleLabel(routine) },
          sources: [{ sourceId: "jarvis-routines", observedAt: request.at, freshness: "live", attribution: "Jarvis" }],
        },
        score: startsIn <= 5 ? 0.88 : 0.8,
        reasons: [reason],
        caveats: [],
        sources: [{ sourceId: "jarvis-routines", observedAt: request.at, freshness: "live", attribution: "Jarvis" }],
        actions: [],
      },
      validFrom: request.at,
      validUntil: scheduledAt + 5 * 60_000,
      dedupeKey: `routine:${routine.id}:${scheduledAt}`,
    });
  }
  return output;
}

function suggestionExpiry(suggestion: ContextSuggestion, resultExpiries: Map<string, number>, now: number): number {
  const data = suggestion.candidate?.data as Record<string, unknown> | undefined;
  const endAt = finiteTime(data?.endAt);
  const startAt = finiteTime(data?.startAt);
  const sourced = suggestion.sources.map((source) => resultExpiries.get(source.sourceId)).filter((value): value is number => value !== undefined);
  const candidates = [endAt, startAt ? startAt + 6 * 60 * 60_000 : undefined, sourced.length ? Math.min(...sourced) : undefined, now + 6 * 60 * 60_000]
    .filter((value): value is number => value !== undefined && value > now);
  return candidates.length ? Math.min(...candidates) : now + 5 * 60_000;
}

function candidateDedupeKey(suggestion: ContextSuggestion): string {
  const data = suggestion.candidate?.data as Record<string, unknown> | undefined;
  const occurrence = finiteTime(data?.startAt);
  return `${suggestion.kind}:${suggestion.candidate.id}:${occurrence || "current"}`.slice(0, 256);
}

export function createPersonalProactiveScheduler(options: PersonalProactiveIntegrationOptions): PersonalProactiveScheduler {
  const now = options.now || Date.now;
  return new PersonalProactiveScheduler({
    now,
    intervalMs: options.intervalMs,
    listTargets: () => {
      const identities = options.listDevices().map((device) => ({ principalId: device.userId, deviceId: device.id }));
      if (options.includeLocalDevice) identities.push({ principalId: "local", deviceId: "local" });
      const seen = new Set<string>();
      const targets: PersonalProactiveTarget[] = [];
      for (const identity of identities) {
        const key = `${identity.principalId}\u0000${identity.deviceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const state = options.assistant.store.get(identity.principalId);
        const profile = state.deviceProfiles.find((row) => row.deviceId === identity.deviceId);
        if (!profile) continue;
        targets.push({
          ...identity,
          generation: options.assistant.store.generation(identity.principalId),
          settings: profile.notifications ? { ...structuredClone(state.settings), notifications: structuredClone(profile.notifications) } : state.settings,
          proactiveEnabled: profile.proactiveEnabled,
          disabledKinds: profile.disabledProactiveKinds,
          locale: profile.locale,
          timeZone: profile.timeZone,
        });
      }
      return targets;
    },
    query: async (request, signal) => {
      if (!options.assistant.store.isGenerationCurrent(request.principalId, request.generation)) throw new Error("personal context generation changed");
      const state = options.assistant.store.get(request.principalId);
      const profile = state.deviceProfiles.find((row) => row.deviceId === request.deviceId);
      const disabledKinds = new Set(profile?.disabledProactiveKinds || []);
      const feedback = state.notifications.filter((row) => row.deviceId === request.deviceId && row.at >= request.at - 30 * 86_400_000);
      const transition = state.observations.filter((row) => row.kind === "geofence_transition" && row.expiresAt > request.at && row.value.deviceId === request.deviceId)
        .sort((left, right) => right.observedAt - left.observedAt)[0];
      const activeFavorite = transition?.value.transition === "enter" && typeof transition.value.favoriteId === "string"
        ? state.favorites.find((row) => row.id === transition.value.favoriteId)
        : undefined;
      const output: PersonalProactiveCandidate[] = [];
      const appendCandidate = (candidate: PersonalProactiveCandidate): void => {
        const suggestion = candidate.suggestion;
        if (disabledKinds.has(suggestion.kind)) return;
        const negativeFeedback = feedback.filter((row) => row.kind === suggestion.kind && (row.outcome === "dismissed" || row.outcome === "ignored"));
        const penalty = negativeFeedback.reduce((sum, row) => sum + (row.outcome === "dismissed" ? 0.2 : 0.1), 0);
        const adjusted = penalty ? { ...structuredClone(suggestion), score: suggestion.score * Math.max(0.4, 1 - penalty) } : suggestion;
        output.push({ ...candidate, suggestion: adjusted });
      };
      for (const candidate of routineCandidates(options.listRoutines?.({ principalId: request.principalId, deviceId: request.deviceId, generation: request.generation }) || [], request)) appendCandidate(candidate);
      for (const purpose of PURPOSES) {
        if (signal.aborted) break;
        const favorite = (activeFavorite?.purposes.includes(purpose) ? activeFavorite : undefined)
          || state.favorites.find((row) => row.purposes.includes(purpose));
        let response;
        try {
          response = await options.assistant.queryContext(`proactive:${request.deviceId}:${purpose}:${request.at}`, {
            purpose,
            locale: request.locale,
            limit: 5,
            ...(favorite && (purpose === "events" || purpose === "weather") ? { filters: { favoriteId: favorite.id } } : {}),
            ...(purpose === "calendar" ? { startAt: request.at, endAt: request.at + 24 * 60 * 60_000 } : {}),
          }, { principalId: request.principalId, deviceId: request.deviceId, owner: false }, signal);
          if (!options.assistant.store.isGenerationCurrent(request.principalId, request.generation)) throw new Error("personal context generation changed");
        } catch (error) {
          if (signal.aborted) break;
          options.onError?.(error, { phase: "query_purpose", purpose, principalId: request.principalId, deviceId: request.deviceId });
          continue;
        }
        const expiries = new Map(response.results.map((result) => [result.sourceId, result.expiresAt]));
        const contextual = purpose === "calendar"
          ? calendarCandidates(response.results, request)
          : purpose === "weather"
            ? weatherCandidates(response.results, request)
            : response.suggestions.flatMap((suggestion) => {
              const data = objectValue(suggestion.candidate?.data), startAt = finiteTime(data?.startAt);
              const stateValue = String(data?.state || data?.status || "").toLowerCase();
              if (!startAt || startAt <= request.at || startAt > request.at + 72 * HOUR_MS || ["cancelled", "canceled", "expired"].includes(stateValue)) return [];
              return [{
                suggestion,
                validUntil: Math.min(startAt, suggestionExpiry(suggestion, expiries, request.at)),
                dedupeKey: candidateDedupeKey(suggestion),
              }];
            });
        for (const candidate of contextual) appendCandidate(candidate);
      }
      return output;
    },
    readDeliveries: (target) => options.assistant.store.get(target.principalId).notifications.flatMap((row) => {
      if (row.deviceId !== target.deviceId || !row.dedupeKey || !row.dedupeUntil || !["pending", "shown", "opened", "ignored", "dismissed", "acted"].includes(row.outcome)) return [];
      return [{
        id: row.id,
        principalId: row.principalId,
        deviceId: row.deviceId,
        generation: target.generation,
        suggestionId: row.suggestionId,
        dedupeKey: row.dedupeKey,
        deliveredAt: row.at,
        dedupeUntil: row.dedupeUntil,
        state: row.outcome === "pending" ? "pending" as const : "delivered" as const,
      }];
    }),
    recordDelivery: (record) => {
      options.assistant.store.recordNotification(record.principalId, {
        id: record.id,
        principalId: record.principalId,
        deviceId: record.deviceId,
        suggestionId: record.suggestionId,
        kind: record.kind,
        title: record.title,
        body: record.body,
        deepLink: record.deepLink,
        expiresAt: record.expiresAt,
        channel: "push",
        outcome: record.state === "pending" ? "pending" : record.state === "failed" ? "delivery_failed" : "shown",
        reason: record.state === "pending" ? "proactive_outbox" : record.state === "failed" ? "proactive_delivery_failed" : "proactive",
        dedupeKey: record.dedupeKey,
        dedupeUntil: record.dedupeUntil,
        at: record.deliveredAt,
      }, record.generation);
    },
    send: async (notification, target, signal) => {
      if (signalAborted(signal)) return false;
      if (!options.assistant.store.isGenerationCurrent(target.principalId, target.generation)) return false;
      const state = options.assistant.store.get(target.principalId);
      const profile = state.deviceProfiles.find((row) => row.deviceId === target.deviceId);
      if (!state.settings.enabled || state.settings.paused || profile?.proactiveEnabled !== true || profile.disabledProactiveKinds?.includes(notification.kind)) return false;
      const inApp = options.sendInApp?.(notification, target) === true;
      if (!options.assistant.store.isGenerationCurrent(target.principalId, target.generation)) return false;
      const pushed = await options.push.notifyPersonal(notification.title, notification.body, notification.tag, notification.deepLink, target);
      return inApp || pushed;
    },
    deepLinkFor: (_target, suggestion, notificationId) => {
      const query = new URLSearchParams({ suggestion: suggestion.id, notification: notificationId });
      return `/#personal-assistant?${query}`;
    },
    onError: (error, context) => options.onError?.(error, context as unknown as Record<string, unknown>),
  });
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
