import test from "node:test";
import assert from "node:assert/strict";
import type { ContextCandidate } from "@jarvis/protocol";
import { applyExplicitCandidateFilters, applyRouteMatrixToCandidates, applyVehicleProfileToCandidates, composeMultiContextCandidates, haversineMeters, inferPreferences, localizeContextRankingDiagnostics, localizeContextSourceUnavailable, normalizeContextRankingLocale, rankContextCandidates, rankContextCandidatesDetailed, type ContextRankingDiagnosticCode } from "./personal-ranking.js";

test("ranking removes hard failures, deduplicates providers and explains the result", () => {
  const now = 1_000_000;
  const ranked = rankContextCandidates({ now, origin: { lat: -19.92, lng: -43.94 }, candidates: [
    { id: "a", kind: "restaurant", title: "Sushi A", point: { lat: -19.921, lng: -43.94 }, data: { cuisine: "sushi" }, scoreParts: { open: 1 }, sources: [{ sourceId: "osm", observedAt: now, freshness: "fresh" }] },
    { id: "b", kind: "restaurant", title: "Sushi A", point: { lat: -19.9211, lng: -43.94 }, data: {}, sources: [{ sourceId: "other", observedAt: now, freshness: "fresh" }] },
    { id: "c", kind: "restaurant", title: "Closed", data: {}, hardFailures: ["closed"], sources: [] },
  ], preferences: [{ id: "p", principalId: "u", kind: "explicit", key: "cuisine", value: "sushi", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: 1, updatedAt: 1 }] });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].sources.length, 2);
  assert.ok(ranked[0].reasons.some((reason) => /preferência/.test(reason)));
  assert.ok(ranked[0].reasons.some((reason) => /m$/.test(reason)));
});

test("haversine returns realistic local distance", () => {
  const meters = haversineMeters({ lat: -19.92, lng: -43.94 }, { lat: -19.93, lng: -43.94 });
  assert.ok(meters > 1_000 && meters < 1_200);
});

test("inference needs repeated evidence and decays with time", () => {
  const day = 86_400_000, now = 100 * day;
  const signals = [1, 2, 3].map((n) => ({ id: `e${n}`, principalId: "u", key: "cuisine", value: "sushi", polarity: "prefer" as const, at: now - n * day, summary: "escolheu sushi" }));
  assert.equal(inferPreferences(signals.slice(0, 2), now).length, 0);
  const inferred = inferPreferences(signals, now);
  assert.equal(inferred.length, 1);
  assert.equal(inferred[0].evidence.length, 3);
  assert.ok(inferred[0].confidence > inferPreferences(signals, now + 180 * day)[0].confidence);
});

test("vehicle profile removes known incompatible chargers and scores compatible power without assuming live availability", () => {
  const profile = { id: "car", principalId: "u", label: "Car", connectorTypeIds: [25], maxAcceptedPowerKw: 100, rangeKm: 50, minimumPreferredPowerKw: 50, preferredOperators: ["Preferred"], isDefault: true, createdAt: 1, updatedAt: 1 };
  const candidates = applyVehicleProfileToCandidates([
    { id: "compatible", kind: "ev_charger", title: "A", point: { lat: 0, lng: 0.1 }, data: { operator: "Preferred Network", availability: { status: "unknown" }, connections: [{ connectorTypeId: 25, powerKw: 150 }, { connectorTypeId: 2, powerKw: 50 }] }, sources: [] },
    { id: "wrong", kind: "ev_charger", title: "B", data: { connections: [{ connectorTypeId: 2, powerKw: 100 }] }, sources: [] },
  ], profile, { lat: 0, lng: 0 });
  const first = candidates[0] as typeof candidates[0] & { data: { connections: Array<{ connectorTypeId: number }>; vehicleCompatibility: { effectivePowerKw: number; status: string } } };
  assert.deepEqual(first.data.connections.map((row) => row.connectorTypeId), [25]);
  assert.equal(first.data.vehicleCompatibility.effectivePowerKw, 100);
  assert.equal(first.data.vehicleCompatibility.status, "compatible");
  assert.deepEqual(first.data.availability, { status: "unknown" });
  assert.deepEqual(candidates[1].hardFailures, ["incompatible_vehicle_connector"]);
  assert.deepEqual(rankContextCandidates({ candidates }).map((row) => row.candidate.id), ["compatible"]);
});

test("multi-context composition enriches an outdoor event with calendar and weather instead of ranking support records", () => {
  const at = Date.UTC(2026, 7, 2, 18);
  const input: ContextCandidate[] = [
    { id: "event", kind: "event", title: "Show ao ar livre", data: { startAt: at, endAt: at + 2 * 3_600_000, categories: ["music"] }, sources: [{ sourceId: "events", observedAt: at - 1_000, freshness: "fresh" as const }] },
    { id: "busy", kind: "calendar_availability", title: "Busy", data: { availability: "busy", startAt: at + 1_000, endAt: at + 3_600_000, complete: true }, sources: [{ sourceId: "calendar", observedAt: at - 1_000, freshness: "fresh" as const }] },
    { id: "forecast", kind: "weather_forecast", title: "Weather", data: { current: {}, hourly: [{ validAt: at, precipitationProbabilityPercent: 90, precipitationMm: 8, rainMm: 8, temperatureC: 20 }] }, sources: [{ sourceId: "weather", observedAt: at - 1_000, freshness: "fresh" as const }] },
  ];
  const composed = composeMultiContextCandidates({ candidates: input, purpose: "events" });
  assert.equal(composed.length, 1);
  const data = composed[0].data as Record<string, unknown>;
  assert.deepEqual((data.context as Record<string, Record<string, unknown>>).calendar.status, "busy");
  assert.deepEqual((data.context as Record<string, Record<string, unknown>>).weather.suitability, "poor");
  assert.deepEqual(composed[0].sources.map((row) => row.sourceId), ["events", "calendar", "weather"]);
  const ranked = rankContextCandidates({ candidates: composed, now: at });
  assert.ok(ranked[0].caveats.some((row) => /agenda/.test(row)));
  assert.ok(ranked[0].caveats.some((row) => /clima/.test(row)));
  const requiredFree = composeMultiContextCandidates({ candidates: input, purpose: "events", requireCalendarFree: true });
  assert.deepEqual(rankContextCandidates({ candidates: requiredFree }), []);
});

test("route matrix enriches matching places and applies only known duration failures", () => {
  const candidates: ContextCandidate[] = [
    { id: "near", kind: "place", title: "Near", point: { lat: 1, lng: 2 }, data: { straightLineDistanceM: 100 }, sources: [{ sourceId: "osm", observedAt: 1, freshness: "fresh" }] },
    { id: "far", kind: "place", title: "Far", point: { lat: 1.1, lng: 2.1 }, data: { straightLineDistanceM: 200 }, sources: [{ sourceId: "osm", observedAt: 1, freshness: "fresh" }] },
    { id: "matrix", kind: "route_matrix", title: "Matrix", data: { mode: "car", cells: [
      { target: { lat: 1, lng: 2 }, reachable: true, distanceM: 1_500, durationSeconds: 600 },
      { target: { lat: 1.1, lng: 2.1 }, reachable: true, distanceM: 10_000, durationSeconds: 2_000 },
    ] }, sources: [{ sourceId: "valhalla-matrix", observedAt: 1, freshness: "fresh" }] },
  ];
  const enriched = applyRouteMatrixToCandidates(candidates, { maxDurationMinutes: 15 });
  assert.equal(enriched.length, 2);
  assert.equal((enriched[0].data as Record<string, unknown>).durationSeconds, 600);
  assert.equal((enriched[0].data as Record<string, unknown>).straightLineDistanceM, 100);
  assert.equal(enriched[0].sources.length, 2);
  assert.deepEqual(enriched[1].hardFailures, ["route_duration_exceeded"]);
  assert.deepEqual(rankContextCandidates({ candidates: enriched }).map((row) => row.candidate.id), ["near"]);
});

test("explicit opening and accessibility constraints reject only known mismatches", () => {
  const at = Date.UTC(2026, 7, 1, 12);
  const filtered = applyExplicitCandidateFilters<unknown>([
    { id: "open", kind: "place", title: "Open vegan", data: { openingHours: "24/7", tags: { "diet:vegan": "yes" } }, sources: [] },
    { id: "closed", kind: "place", title: "Closed", data: { openingHours: "Mo-Fr 09:00-18:00", tags: { "diet:vegan": "yes" } }, sources: [] },
    { id: "mismatch", kind: "place", title: "Not vegan", data: { openingHours: "24/7", tags: { "diet:vegan": "no" } }, sources: [] },
    { id: "unknown", kind: "place", title: "Unknown", data: { tags: {} }, sources: [] },
  ], { openAt: at, timeZone: "UTC", restrictions: ["vegan"] });
  assert.deepEqual(filtered[1].hardFailures, ["known_closed_at_requested_time"]);
  assert.deepEqual(filtered[2].hardFailures, ["explicit_restriction_mismatch"]);
  const ranked = rankContextCandidates({ candidates: filtered, now: at });
  assert.deepEqual(ranked.map((row) => row.candidate.id), ["open", "unknown"]);
  assert.ok(ranked[0].reasons.some((reason) => /Aberto/.test(reason)));
  assert.ok(ranked[1].caveats.some((reason) => /horário/.test(reason)));
  assert.ok(ranked[1].caveats.some((reason) => /restrições/.test(reason)));
});

test("opening hours use the destination timezone and fail to unknown for a distant destination without one", () => {
  const at = Date.UTC(2026, 7, 3, 12);
  const filtered = applyExplicitCandidateFilters<unknown>([
    { id: "zoned", kind: "place", title: "Zoned", point: { lat: 34.05, lng: -118.24 }, data: { openingHours: "Mo 11:00-13:00", timeZone: "America/Los_Angeles" }, sources: [] },
    { id: "distant", kind: "place", title: "Distant", point: { lat: 40.71, lng: -74 }, data: { openingHours: "Mo 11:00-13:00" }, sources: [] },
  ], { openAt: at, timeZone: "UTC", origin: { lat: 51.5, lng: -0.1 } });
  assert.deepEqual(filtered[0].hardFailures, ["known_closed_at_requested_time"]);
  const distantContext = ((filtered[1].data as Record<string, unknown>).filterContext as Record<string, unknown>);
  assert.equal(distantContext.openStatus, "unknown");
  assert.equal(distantContext.openTimeZoneBasis, "unavailable");
  assert.equal(filtered[1].hardFailures, undefined);
});

test("explicit avoid and require preferences are hard constraints with discard diagnostics", () => {
  const now = 1_000;
  const candidates: ContextCandidate[] = [
    { id: "sushi", kind: "restaurant", title: "Sushi vegan", data: { cuisine: "sushi", diet: "vegan" }, sources: [] },
    { id: "burger", kind: "restaurant", title: "Vegan burger", data: { cuisine: "burger", diet: "vegan" }, sources: [] },
    { id: "pizza", kind: "restaurant", title: "Pizza", data: { cuisine: "pizza" }, sources: [] },
  ];
  const preferences = [
    { id: "avoid-sushi", principalId: "u", kind: "explicit" as const, key: "cuisine", value: "sushi", polarity: "avoid" as const, confidence: 1, evidence: [], purposes: ["nearby" as const], createdAt: now, updatedAt: now },
    { id: "require-vegan", principalId: "u", kind: "explicit" as const, key: "diet", value: "vegan", polarity: "require" as const, confidence: 1, evidence: [], purposes: ["nearby" as const], createdAt: now, updatedAt: now },
  ];
  const result = rankContextCandidatesDetailed({ candidates, preferences, purpose: "nearby", now });
  assert.deepEqual(result.suggestions.map((row) => row.candidate.id), ["burger"]);
  assert.ok(result.diagnostics.find((row) => row.candidateId === "sushi")?.reasons.includes("explicit_preference_avoid:avoid-sushi"));
  assert.ok(result.diagnostics.find((row) => row.candidateId === "pizza")?.reasons.includes("explicit_preference_require:require-vegan"));
  assert.deepEqual(result.usedPreferenceIds, ["avoid-sushi", "require-vegan"]);
});

test("inferred preference influence decays at ranking time and rejected inference is ignored", () => {
  const day = 86_400_000, now = 200 * day;
  const candidates: ContextCandidate[] = [
    { id: "sushi", kind: "restaurant", title: "Sushi", data: { cuisine: "sushi" }, sources: [{ sourceId: "x", observedAt: now, freshness: "fresh" }] },
    { id: "burger", kind: "restaurant", title: "Burger", data: { cuisine: "burger" }, sources: [{ sourceId: "x", observedAt: now, freshness: "fresh" }] },
  ];
  const preference = { id: "inferred", principalId: "u", kind: "inferred" as const, key: "cuisine", value: "sushi", polarity: "prefer" as const, confidence: 1, evidence: [], purposes: ["nearby" as const], createdAt: now, updatedAt: now };
  const fresh = rankContextCandidates({ candidates, preferences: [preference], purpose: "nearby", now });
  const old = rankContextCandidates({ candidates, preferences: [preference], purpose: "nearby", now: now + 180 * day });
  const freshGap = fresh.find((row) => row.candidate.id === "sushi")!.score - fresh.find((row) => row.candidate.id === "burger")!.score;
  const oldGap = old.find((row) => row.candidate.id === "sushi")!.score - old.find((row) => row.candidate.id === "burger")!.score;
  assert.ok(freshGap > oldGap && oldGap > 0);
  assert.deepEqual(rankContextCandidates({ candidates, preferences: [{ ...preference, decision: "rejected" }], purpose: "nearby", now }).map((row) => row.candidate.id).sort(), ["burger", "sushi"]);
});

function rankingCopy(locale: string) {
  const now = 1_000;
  const preferred = rankContextCandidates({
    locale, now, purpose: "nearby", origin: { lat: 0, lng: 0 },
    candidates: [{
      id: "preferred", kind: "place", title: "Preferred", point: { lat: 0, lng: 0.001 }, data: { category: "cafe" }, scoreParts: { fit: 1 },
      sources: [{ sourceId: "places", observedAt: now, freshness: "fresh" }],
    }],
    preferences: [{ id: "prefer", principalId: "u", kind: "explicit", key: "category", value: "cafe", polarity: "prefer", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: now, updatedAt: now }],
  })[0];
  const contextual = rankContextCandidates({ locale, now, candidates: [{
    id: "contextual", kind: "place", title: "Contextual",
    data: {
      filterContext: { openStatus: "open" },
      context: { calendar: { status: "free" } },
      vehicleCompatibility: { status: "compatible" },
      route: { status: "ready" }, durationSeconds: 600,
    },
    sources: [],
  }] })[0];
  const conflict = rankContextCandidates({
    locale, now, purpose: "nearby",
    candidates: [{ id: "conflict", kind: "place", title: "Conflict", data: { category: "cafe" }, sources: [] }],
    preferences: [{ id: "avoid", principalId: "u", kind: "inferred", key: "category", value: "cafe", polarity: "avoid", confidence: 1, evidence: [], purposes: ["nearby"], createdAt: now, updatedAt: now }],
  })[0];
  const kilometers = rankContextCandidates({
    locale, now, origin: { lat: 0, lng: 0 },
    candidates: [{ id: "far", kind: "place", title: "Far", point: { lat: 0, lng: 0.02 }, data: {}, sources: [] }],
  })[0];
  const caveats = rankContextCandidates({ locale, now, candidates: [{
    id: "uncertain", kind: "place", title: "Uncertain",
    data: {
      filterContext: { openStatus: "unknown", restrictions: { vegan: "unknown" } },
      context: { calendar: { status: "busy" }, weather: { appliesToCandidate: true, suitability: "poor" } },
      vehicleCompatibility: { status: "unknown", withinNominalRange: false },
      route: { status: "unreachable" },
    },
    sources: [{ sourceId: "places", observedAt: now, freshness: "stale" }],
  }] })[0].caveats;
  const mixedWeather = rankContextCandidates({ locale, now, candidates: [{
    id: "mixed", kind: "place", title: "Mixed", data: { context: { weather: { appliesToCandidate: true, suitability: "mixed" } } },
    sources: [{ sourceId: "weather", observedAt: now, freshness: "fresh" }],
  }] })[0].caveats;
  const missingSource = rankContextCandidates({ locale, now, candidates: [
    { id: "missing", kind: "place", title: "Missing", data: {}, sources: [] },
  ] })[0].caveats;
  return {
    primaryReasons: preferred.reasons,
    contextualReasons: contextual.reasons,
    conflictReason: conflict.reasons,
    kilometerReason: kilometers.reasons,
    caveats,
    mixedWeather,
    missingSource,
  };
}

const localizedRankingCopy = {
  "pt-BR": {
    primaryReasons: ["Combina com a preferência category", "Fica a 111 m", "Fontes recentes", "Atende bem ao contexto informado"],
    contextualReasons: ["Aberto no horário solicitado", "Não conflita com a agenda consultada", "Conector compatível com o veículo selecionado", "Deslocamento estimado em 10 min"],
    conflictReason: ["Conflita com a preferência category"],
    kilometerReason: ["Fica a 2.2 km"],
    caveats: [
      "O horário de funcionamento não pôde ser confirmado",
      "Uma ou mais restrições informadas não puderam ser confirmadas",
      "Há conflito com a agenda consultada",
      "O clima previsto pode prejudicar esta opção",
      "A compatibilidade do conector não pôde ser confirmada",
      "Fica além da autonomia nominal informada",
      "A rota não pôde ser calculada; apenas a distância em linha reta está disponível",
      "Há dados desatualizados ou sem horário confirmado",
    ],
    mixedWeather: ["A previsão do tempo ainda é incerta para esta opção"],
    missingSource: ["A origem deste resultado não foi informada"],
  },
  en: {
    primaryReasons: ["Matches the category preference", "It is 111 m away", "Recent sources", "Matches the provided context well"],
    contextualReasons: ["Open at the requested time", "Does not conflict with the checked calendar", "Connector is compatible with the selected vehicle", "Estimated travel time is 10 min"],
    conflictReason: ["Conflicts with the category preference"],
    kilometerReason: ["It is 2.2 km away"],
    caveats: [
      "Opening hours could not be confirmed",
      "One or more requested restrictions could not be confirmed",
      "Conflicts with the checked calendar",
      "The forecast weather may affect this option",
      "Connector compatibility could not be confirmed",
      "It is beyond the stated nominal range",
      "The route could not be calculated; only straight-line distance is available",
      "Some data is stale or has no confirmed timestamp",
    ],
    mixedWeather: ["The weather forecast is still uncertain for this option"],
    missingSource: ["No source was provided for this result"],
  },
  es: {
    primaryReasons: ["Coincide con la preferencia category", "Está a 111 m", "Fuentes recientes", "Se ajusta bien al contexto indicado"],
    contextualReasons: ["Abierto a la hora solicitada", "No entra en conflicto con el calendario consultado", "El conector es compatible con el vehículo seleccionado", "Tiempo de desplazamiento estimado: 10 min"],
    conflictReason: ["Entra en conflicto con la preferencia category"],
    kilometerReason: ["Está a 2.2 km"],
    caveats: [
      "No se pudo confirmar el horario de apertura",
      "No se pudieron confirmar una o más restricciones indicadas",
      "Hay un conflicto con el calendario consultado",
      "El clima previsto puede perjudicar esta opción",
      "No se pudo confirmar la compatibilidad del conector",
      "Está fuera de la autonomía nominal indicada",
      "No se pudo calcular la ruta; solo está disponible la distancia en línea recta",
      "Hay datos desactualizados o sin hora confirmada",
    ],
    mixedWeather: ["El pronóstico del tiempo aún es incierto para esta opción"],
    missingSource: ["No se indicó la fuente de este resultado"],
  },
} as const;

for (const locale of ["pt-BR", "en", "es"] as const) {
  test(`ranking renders every reason and caveat in ${locale}`, () => {
    assert.deepEqual(rankingCopy(locale), localizedRankingCopy[locale]);
  });
}

test("ranking locale normalization accepts regional tags and preserves the Portuguese fallback", () => {
  assert.equal(normalizeContextRankingLocale("pt_PT"), "pt-BR");
  assert.equal(normalizeContextRankingLocale("en-US"), "en");
  assert.equal(normalizeContextRankingLocale("es-419"), "es");
  assert.equal(normalizeContextRankingLocale("fr-FR"), "pt-BR");
  assert.equal(normalizeContextRankingLocale(), "pt-BR");
});

test("locale changes explanation copy without changing deterministic ranking or diagnostic codes", () => {
  const input = {
    now: 1_000,
    origin: { lat: 0, lng: 0 },
    limit: 1,
    candidates: [
      { id: "near", kind: "place", title: "Near", point: { lat: 0, lng: 0.001 }, data: {}, sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" as const }] },
      { id: "far", kind: "place", title: "Far", point: { lat: 0, lng: 0.02 }, data: {}, sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" as const }] },
      { id: "closed", kind: "place", title: "Closed", data: {}, hardFailures: ["known_closed_at_requested_time"], sources: [{ sourceId: "places", observedAt: 1_000, freshness: "fresh" as const }] },
    ],
  };
  const ranked = (["pt-BR", "en", "es"] as const).map((locale) => rankContextCandidatesDetailed({ ...structuredClone(input), locale }));
  const stableProjection = (result: typeof ranked[number]) => ({
    suggestions: result.suggestions.map((suggestion) => ({ id: suggestion.id, candidateId: suggestion.candidate.id, score: suggestion.score })),
    diagnostics: result.diagnostics,
    usedPreferenceIds: result.usedPreferenceIds,
  });
  assert.deepEqual(stableProjection(ranked[1]), stableProjection(ranked[0]));
  assert.deepEqual(stableProjection(ranked[2]), stableProjection(ranked[0]));
  assert.notDeepEqual(ranked[1].suggestions[0].reasons, ranked[0].suggestions[0].reasons);
  assert.notDeepEqual(ranked[2].suggestions[0].reasons, ranked[0].suggestions[0].reasons);
});

const diagnosticCodes: ContextRankingDiagnosticCode[] = [
  "semantic_duplicate_of:kept",
  "explicit_preference_avoid:avoid",
  "explicit_preference_require:require",
  "incompatible_vehicle_connector",
  "route_duration_exceeded",
  "known_closed_at_requested_time",
  "explicit_restriction_mismatch",
  "calendar_conflict",
  "rank_limit",
];

const localizedDiagnosticReasons = {
  "pt-BR": [
    "Duplicado semântico de kept",
    "Conflita com a preferência explícita avoid",
    "Não atende à preferência explícita obrigatória require",
    "Conector incompatível com o veículo selecionado",
    "Excede o tempo máximo de deslocamento",
    "Fechado no horário solicitado",
    "Não atende a uma restrição explícita",
    "Conflita com a agenda consultada",
    "Fora do limite de resultados",
    "Descartado por um filtro obrigatório",
  ],
  en: [
    "Semantic duplicate of kept",
    "Conflicts with explicit preference avoid",
    "Does not satisfy required explicit preference require",
    "Connector is incompatible with the selected vehicle",
    "Exceeds the maximum travel time",
    "Closed at the requested time",
    "Does not satisfy an explicit restriction",
    "Conflicts with the checked calendar",
    "Outside the result limit",
    "Discarded by a required filter",
  ],
  es: [
    "Duplicado semántico de kept",
    "Entra en conflicto con la preferencia explícita avoid",
    "No cumple la preferencia explícita obligatoria require",
    "El conector es incompatible con el vehículo seleccionado",
    "Supera el tiempo máximo de desplazamiento",
    "Cerrado a la hora solicitada",
    "No cumple una restricción explícita",
    "Entra en conflicto con el calendario consultado",
    "Fuera del límite de resultados",
    "Descartado por un filtro obligatorio",
  ],
} as const;

for (const locale of ["pt-BR", "en", "es"] as const) {
  test(`discard diagnostics retain codes and render every explanation in ${locale}`, () => {
    const reasons = [...diagnosticCodes, "provider_specific_failure"];
    const localized = localizeContextRankingDiagnostics([
      { candidateId: "candidate", kind: "place", status: "discarded", reasons },
    ], locale)[0];
    assert.deepEqual(localized.reasonCodes, reasons);
    assert.deepEqual(localized.reasons, localizedDiagnosticReasons[locale]);
  });
}

test("missing-source diagnostics render in every supported locale without exposing provider errors", () => {
  assert.equal(localizeContextSourceUnavailable("calendar", "pt-BR"), "Os dados da fonte calendar não estão disponíveis");
  assert.equal(localizeContextSourceUnavailable("calendar", "en-US"), "Data from source calendar is unavailable");
  assert.equal(localizeContextSourceUnavailable("calendar", "es-MX"), "Los datos de la fuente calendar no están disponibles");
});
