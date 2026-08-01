import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONAL_INTENT_HIGH_PRECISION_THRESHOLD,
  classifyPersonalIntent,
  isHighPrecisionPersonalIntent,
  resolvePersonalIntentTimeWindow,
  routePersonalIntent,
  type PersonalIntentLocale,
  type PersonalIntentName,
} from "./personal-intent.js";

interface RoutingExample {
  text: string;
  intent: PersonalIntentName;
  locale: PersonalIntentLocale;
  category?: string;
}

function assertRoute(example: RoutingExample): void {
  const match = routePersonalIntent(example.text);
  assert.ok(match, `expected a route for: ${example.text}`);
  assert.equal(match.intent, example.intent);
  assert.equal(match.locale, example.locale);
  assert.ok(match.confidence >= PERSONAL_INTENT_HIGH_PRECISION_THRESHOLD, `${example.text}: ${match.confidence}`);
  assert.ok(match.evidence.length > 0);
  assert.equal(new Set(match.evidence.map((item) => item.rule)).size, match.evidence.length);
  assert.ok(match.evidence.every((item) => item.weight > 0 && item.weight <= 1));
  if (example.category) assert.equal(match.slots.category, example.category);
}

test("routes all personal intents in pt-BR with high precision", () => {
  const examples: RoutingExample[] = [
    { text: "Encontre uma farmácia perto de mim em um raio de 2 km.", intent: "nearby", locale: "pt-BR", category: "pharmacy" },
    { text: "Quanto tempo leva para chegar ao aeroporto hoje?", intent: "mobility", locale: "pt-BR" },
    { text: "Tenho algum compromisso na minha agenda amanhã às 09:30?", intent: "calendar", locale: "pt-BR", category: "availability" },
    { text: "Quais eventos de música acontecem em BH neste fim de semana?", intent: "events", locale: "pt-BR", category: "music" },
    { text: "Vai chover em Belo Horizonte amanhã de manhã?", intent: "weather", locale: "pt-BR", category: "weather" },
    { text: "Ligue a luz da sala às 19h.", intent: "automation", locale: "pt-BR", category: "light" },
    { text: "Onde encontro uma estação de recarga CCS perto de mim?", intent: "ev", locale: "pt-BR", category: "charging_station" },
  ];
  examples.forEach(assertRoute);
});

test("routes all personal intents in English with high precision", () => {
  const examples: RoutingExample[] = [
    { text: "Find a vegan bakery near me within 3 miles.", intent: "nearby", locale: "en", category: "bakery" },
    { text: "How long does it take to get to the airport today?", intent: "mobility", locale: "en" },
    { text: "Do I have a meeting on my calendar tomorrow at 9:30 am?", intent: "calendar", locale: "en", category: "availability" },
    { text: "What music events are happening in Austin this weekend?", intent: "events", locale: "en", category: "music" },
    { text: "Will it rain in London tomorrow morning?", intent: "weather", locale: "en", category: "weather" },
    { text: "Turn on the kitchen lights at 7 pm.", intent: "automation", locale: "en", category: "light" },
    { text: "Where is an EV charger with CCS near me?", intent: "ev", locale: "en", category: "charging_station" },
  ];
  examples.forEach(assertRoute);
});

test("routes all personal intents in Spanish with high precision", () => {
  const examples: RoutingExample[] = [
    { text: "Encuentra una farmacia cerca de mí en un radio de 2 km.", intent: "nearby", locale: "es", category: "pharmacy" },
    { text: "¿Cuánto tiempo tarda en llegar al aeropuerto hoy?", intent: "mobility", locale: "es" },
    { text: "¿Tengo una cita en mi agenda mañana a las 09:30?", intent: "calendar", locale: "es", category: "availability" },
    { text: "¿Qué eventos de música hay en Madrid este fin de semana?", intent: "events", locale: "es", category: "music" },
    { text: "¿Va a llover en Madrid mañana por la mañana?", intent: "weather", locale: "es", category: "weather" },
    { text: "Enciende las luces de la sala a las 19:00.", intent: "automation", locale: "es", category: "light" },
    { text: "¿Dónde hay un punto de carga CCS cerca de mí?", intent: "ev", locale: "es", category: "charging_station" },
  ];
  examples.forEach(assertRoute);
});

test("extracts explicit query, category, radius and duration without resolving them probabilistically", () => {
  const nearby = routePersonalIntent("Encontre uma padaria vegana perto de mim em um raio de 2,5 km e em até 15 minutos.");
  assert.ok(nearby);
  assert.equal(nearby.intent, "nearby");
  assert.deepEqual(nearby.slots, {
    category: "bakery",
    query: "padaria vegana",
    radiusMeters: 2_500,
    radiusText: "em um raio de 2,5 km",
    durationMinutes: 15,
    durationText: "em até 15 minutos",
    restrictions: ["vegan"],
  });

  const imperial = routePersonalIntent("Find a cafe near me within 3 miles.");
  assert.ok(imperial);
  assert.equal(imperial.slots.radiusMeters, 4_828);
  assert.equal(imperial.slots.radiusText, "within 3 miles");
});

test("extracts open-now and explicit place restrictions in pt, en and es", () => {
  const pt = routePersonalIntent("Encontre restaurante aberto agora, vegano e acessível perto de mim.");
  assert.equal(pt?.slots.requireOpen, true);
  assert.deepEqual(pt?.slots.restrictions, ["vegan", "wheelchair"]);
  const en = routePersonalIntent("Find an open gluten-free cafe near me now.");
  assert.equal(en?.slots.requireOpen, true);
  assert.deepEqual(en?.slots.restrictions, ["gluten_free"]);
  const es = routePersonalIntent("Busca un restaurante halal abierto cerca de mí ahora.");
  assert.equal(es?.slots.requireOpen, true);
  assert.deepEqual(es?.slots.restrictions, ["halal"]);
});

test("extracts literal date/time text and explicit durations", () => {
  const calendar = routePersonalIntent("Agende uma reunião amanhã às 14h por 1,5 horas.");
  assert.ok(calendar);
  assert.equal(calendar.intent, "calendar");
  assert.equal(calendar.slots.dateText, "amanhã");
  assert.equal(calendar.slots.timeText, "às 14h");
  assert.equal(calendar.slots.durationMinutes, 90);
  assert.equal(calendar.slots.durationText, "por 1,5 horas");

  const mobility = routePersonalIntent("Rota para o aeroporto em até 25 minutos.");
  assert.ok(mobility);
  assert.equal(mobility.intent, "mobility");
  assert.equal(mobility.slots.query, "o aeroporto");
  assert.equal(mobility.slots.durationMinutes, 25);

  const numericDate = routePersonalIntent("Tenho compromisso em 01/08/2026 às 08:00?");
  assert.ok(numericDate);
  assert.equal(numericDate.intent, "calendar");
  assert.equal(numericDate.slots.dateText, "01/08/2026");
});

test("resolves date and time slots to bounded timezone-aware windows", () => {
  const saoPaulo = resolvePersonalIntentTimeWindow({ dateText: "amanhã", timeText: "às 20h30" }, { now: Date.parse("2026-08-01T15:00:00Z"), timeZone: "America/Sao_Paulo" });
  assert.deepEqual(saoPaulo, { startAt: Date.parse("2026-08-02T23:30:00Z"), endAt: Date.parse("2026-08-03T00:30:00Z"), timeZone: "America/Sao_Paulo" });
  const dst = resolvePersonalIntentTimeWindow({ dateText: "tomorrow", timeText: "at 9 am" }, { now: Date.parse("2025-03-08T15:00:00Z"), timeZone: "America/New_York" });
  assert.equal(dst?.startAt, Date.parse("2025-03-09T13:00:00Z"));
  const fullDay = resolvePersonalIntentTimeWindow({ dateText: "2026-08-05" }, { now: Date.parse("2026-08-01T15:00:00Z"), timeZone: "UTC" });
  assert.equal(fullDay?.endAt! - fullDay?.startAt!, 86_400_000);
  assert.throws(() => resolvePersonalIntentTimeWindow({ dateText: "today" }, { timeZone: "Mars/Olympus" }), /time zone|timezone/i);
});

test("accepts concise but unambiguous personal requests", () => {
  const customNearby = routePersonalIntent("Onde tem um veterinário perto de mim?");
  assert.ok(customNearby);
  assert.equal(customNearby.intent, "nearby");
  assert.equal(customNearby.slots.query, "veterinário");
  assert.equal(customNearby.slots.category, undefined);

  assert.equal(routePersonalIntent("Onde tem farmácia?")?.intent, "nearby");
  assert.equal(routePersonalIntent("Agende uma reunião amanhã.")?.intent, "calendar");
  assert.equal(routePersonalIntent("Eventos BH sábado")?.intent, "events");
  assert.equal(routePersonalIntent("Vai chover?")?.intent, "weather");
  assert.equal(routePersonalIntent("Turn off the lights.")?.intent, "automation");
  assert.equal(routePersonalIntent("CCS perto de mim")?.intent, "ev");
});

test("uses the most specific personal domain when signals overlap", () => {
  assert.equal(routePersonalIntent("Onde há um carregador CCS perto de mim?")?.intent, "ev");
  assert.equal(routePersonalIntent("Quais eventos tenho na minha agenda amanhã?")?.intent, "calendar");
  assert.equal(routePersonalIntent("Ligue o carregador do carro na garagem.")?.intent, "automation");
  assert.equal(routePersonalIntent("Vai chover e quais eventos existem hoje?"), null);
});

test("masks fenced and inline code before classification", () => {
  const codeOnly = [
    "```ts\nconst weather = { nearby: true, calendar: true };\n```",
    "~~~python\nevents = ['weather', 'mobility']\n~~~",
    "Use `weather` as the value of `event.category`.",
  ];
  for (const text of codeOnly) assert.equal(routePersonalIntent(text), null, text);

  const mixed = routePersonalIntent("Exemplo técnico:\n```ts\nconst weather = false;\n```\nAgora me diga: vai chover amanhã?");
  assert.ok(mixed);
  assert.equal(mixed.intent, "weather");
});

test("rejects multilingual edit, test and review requests about code", () => {
  const codingRequests = [
    "Revise o código do roteador de eventos e teste weather.ts.",
    "Implemente uma função para encontrar restaurantes perto de mim.",
    "Please edit the calendar event handler and test the nearby search API.",
    "Write a TypeScript function that finds EV chargers near me.",
    "Test src/weather against the forecast for tomorrow.",
    "Fix the weather widget for tomorrow.",
    "Revisa el código de automatización y prueba el endpoint de clima.",
    "Implementa un componente para mostrar eventos cerca de mí.",
  ];
  for (const text of codingRequests) {
    assert.equal(classifyPersonalIntent(text), null, text);
    assert.equal(routePersonalIntent(text), null, text);
  }
});

test("does not confuse natural personal review/test commands with code work", () => {
  assert.equal(routePersonalIntent("Revise minha agenda de amanhã.")?.intent, "calendar");
  assert.equal(routePersonalIntent("Teste a automação da sala.")?.intent, "automation");
  assert.equal(routePersonalIntent("Review my calendar for tomorrow.")?.intent, "calendar");
  assert.equal(routePersonalIntent("Prueba la automatización de la sala.")?.intent, "automation");
});

test("rejects weak, declarative and technical lookalikes", () => {
  const negatives = [
    "O tempo de execução do teste caiu.",
    "The event loop is busy.",
    "La automatización de pruebas del repositorio falló.",
    "Meu calendário é azul.",
    "I like restaurants near me.",
    "Eu gosto de restaurantes perto de mim.",
    "Tenemos un evento interno ya confirmado.",
    "CCS is a charging connector.",
    "Weather module",
    "Hoje foi um dia longo.",
  ];
  for (const text of negatives) assert.equal(routePersonalIntent(text), null, text);
});

test("exposes sub-threshold classification and a configurable high-precision gate", () => {
  const weak = classifyPersonalIntent("restaurante?");
  assert.ok(weak);
  assert.equal(weak.intent, "nearby");
  assert.ok(weak.confidence < PERSONAL_INTENT_HIGH_PRECISION_THRESHOLD);
  assert.equal(routePersonalIntent("restaurante?"), null);
  assert.equal(routePersonalIntent("restaurante?", { threshold: weak.confidence })?.intent, "nearby");
  assert.equal(isHighPrecisionPersonalIntent(weak), false);
  assert.equal(isHighPrecisionPersonalIntent(weak, weak.confidence), true);

  assert.throws(() => routePersonalIntent("weather tomorrow", { threshold: -0.1 }), /between 0 and 1/);
  assert.throws(() => isHighPrecisionPersonalIntent(weak, Number.NaN), /between 0 and 1/);
  assert.throws(() => isHighPrecisionPersonalIntent(null, 2), /between 0 and 1/);
});

test("supports an explicit locale without changing deterministic routing", () => {
  const automatic = routePersonalIntent("Weather tomorrow in Madrid?");
  const overridden = routePersonalIntent("Weather tomorrow in Madrid?", { locale: "es" });
  assert.ok(automatic && overridden);
  assert.equal(automatic.intent, "weather");
  assert.equal(automatic.locale, "en");
  assert.equal(overridden.intent, automatic.intent);
  assert.equal(overridden.confidence, automatic.confidence);
  assert.equal(overridden.locale, "es");
  assert.deepEqual(overridden.evidence, automatic.evidence);
  assert.deepEqual(overridden.slots, automatic.slots);

  assert.equal(routePersonalIntent("Que eventos hay en Madrid este fin de semana")?.locale, "es");
});

test("extracts favorite references without treating current-location pronouns as aliases", () => {
  assert.equal(routePersonalIntent("Encontre restaurantes perto do clube.")?.slots.reference, "clube");
  assert.equal(routePersonalIntent("Find cafes near my office.")?.slots.reference, "office");
  assert.equal(routePersonalIntent("Busca farmacias cerca de mi casa.")?.slots.reference, "casa");
  assert.equal(routePersonalIntent("Encontre restaurantes perto de mim.")?.slots.reference, undefined);
});

test("is deterministic and bounds hostile input", () => {
  const text = "Quais eventos de música em BH neste fim de semana?";
  assert.deepEqual(classifyPersonalIntent(text), classifyPersonalIntent(text));
  assert.equal(classifyPersonalIntent(""), null);
  assert.equal(classifyPersonalIntent("   \n\t"), null);
  assert.equal(classifyPersonalIntent("x".repeat(20_001)), null);
});
