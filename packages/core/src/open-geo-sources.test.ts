import test from "node:test";
import assert from "node:assert/strict";
import type { PersonalContextQuery } from "@jarvis/protocol";
import type { ContextSource, ContextSourceRuntime } from "./context-sources.js";
import {
  createNominatimSource,
  createOpenChargeMapSource,
  createOpenMeteoSource,
  createOverpassNearbySource,
  createValhallaMatrixSource,
  createValhallaSource,
} from "./open-geo-sources.js";

const NOW = Date.UTC(2026, 7, 1, 12, 0, 0);
const ORIGIN = { lat: -19.92, lng: -43.94 };

test("open geo source descriptors declare license, retention, and review metadata", () => {
  const sources = [
    createNominatimSource(),
    createValhallaSource(),
    createValhallaMatrixSource(),
    createOverpassNearbySource(),
    createOpenChargeMapSource(),
    createOpenMeteoSource(),
  ];
  for (const source of sources) {
    assert.ok(source.descriptor.license, `${source.descriptor.id} license`);
    assert.ok(source.descriptor.retentionPolicy, `${source.descriptor.id} retention`);
    assert.equal(source.descriptor.lastReviewedAt, "2026-08-01", `${source.descriptor.id} review date`);
  }
});

interface CapturedRequest {
  url: URL;
  init?: RequestInit;
}

function jsonFetch(payload: unknown, capture?: CapturedRequest[], status = 200): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    capture?.push({ url: new URL(input instanceof Request ? input.url : String(input)), init });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function invalidJsonFetch(): typeof fetch {
  return (async () => new Response("{not-json", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;
}

function runtime(fetcher: typeof fetch, signal = new AbortController().signal): ContextSourceRuntime {
  return { fetch: fetcher, now: () => NOW, signal };
}

const NOMINATIM_PLACE = {
  place_id: 123,
  licence: "Data by OpenStreetMap contributors, ODbL 1.0",
  osm_type: "node",
  osm_id: 456,
  lat: "-19.921",
  lon: "-43.941",
  display_name: "Cafe Central, Belo Horizonte, Brasil",
  category: "amenity",
  type: "cafe",
  importance: 0.72,
  boundingbox: ["-19.922", "-19.920", "-43.942", "-43.940"],
  address: { city: "Belo Horizonte", country_code: "br" },
  extratags: { opening_hours: "Mo-Fr 08:00-18:00" },
  namedetails: { name: "Cafe Central" },
};

const VALHALLA_ROUTE = {
  trip: {
    status: 0,
    status_message: "Found route between points",
    units: "kilometers",
    summary: { length: 12.5, time: 900 },
    legs: [{
      summary: { length: 12.5, time: 900 },
      shape: "encoded-polyline",
      maneuvers: [{
        type: 1,
        instruction: "Head north",
        verbal_transition_alert_instruction: "Head north",
        length: 0.4,
        time: 45,
      }],
    }],
  },
};

const VALHALLA_MATRIX = {
  algorithm: "costmatrix",
  units: "kilometers",
  sources_to_targets: [[
    { from_index: 0, to_index: 0, distance: 12.5, time: 900 },
    { from_index: 0, to_index: 1, distance: null, time: null },
  ]],
};

const OVERPASS_RESPONSE = {
  version: 0.6,
  osm3s: {
    timestamp_osm_base: new Date(NOW - 60 * 60_000).toISOString(),
    copyright: "OpenStreetMap contributors",
  },
  elements: [
    {
      type: "node",
      id: 11,
      lat: -19.921,
      lon: -43.941,
      tags: { name: "Cafe Um", amenity: "restaurant", opening_hours: "Mo-Su 11:00-23:00" },
    },
    {
      type: "way",
      id: 12,
      center: { lat: -19.922, lon: -43.942 },
      tags: { name: "Cafe Dois", amenity: "restaurant" },
    },
    {
      type: "node",
      id: 13,
      lat: -20.5,
      lon: -43.94,
      tags: { name: "Outside radius", amenity: "restaurant" },
    },
  ],
};

const OCM_RESPONSE = [
  {
    ID: 101,
    AddressInfo: {
      Title: "Carga Centro",
      AddressLine1: "Rua A, 10",
      Town: "Belo Horizonte",
      StateOrProvince: "MG",
      Postcode: "30000-000",
      Country: { Title: "Brazil" },
      Latitude: -19.921,
      Longitude: -43.941,
    },
    DataProvider: {
      Title: "OpenStreetMap",
      License: "ODbL",
      WebsiteURL: "https://www.openstreetmap.org/",
    },
    OperatorInfo: { Title: "Operador A" },
    StatusType: { ID: 50, Title: "Operational", IsOperational: true },
    DateLastStatusUpdate: new Date(NOW - 2 * 24 * 60 * 60_000).toISOString(),
    DateLastVerified: new Date(NOW - 3 * 24 * 60 * 60_000).toISOString(),
    NumberOfPoints: 2,
    UsageCost: "R$ 2/kWh",
    Connections: [
      {
        ID: 1001,
        ConnectionTypeID: 25,
        ConnectionType: { ID: 25, Title: "Type 2" },
        Quantity: 2,
        PowerKW: 50,
        Voltage: 400,
        Amps: 125,
        StatusType: { Title: "Operational" },
      },
      {
        ID: 1002,
        ConnectionTypeID: 2,
        ConnectionType: { ID: 2, Title: "CHAdeMO" },
        Quantity: 1,
        PowerKW: 22,
      },
    ],
  },
  {
    ID: 102,
    AddressInfo: { Title: "Carga Incompativel", Latitude: -19.922, Longitude: -43.942 },
    DataProvider: { Title: "Provider B", License: "CC BY" },
    StatusType: { ID: 50, Title: "Operational", IsOperational: true },
    Connections: [{ ID: 2001, ConnectionTypeID: 2, ConnectionType: { ID: 2, Title: "CHAdeMO" }, PowerKW: 100 }],
  },
];

const OPEN_METEO_RESPONSE = {
  latitude: -19.9,
  longitude: -43.9,
  elevation: 852,
  timezone: "America/Sao_Paulo",
  utc_offset_seconds: -10_800,
  current_units: {
    time: "unixtime",
    interval: "seconds",
    temperature_2m: "C",
    apparent_temperature: "C",
    precipitation: "mm",
    rain: "mm",
    weather_code: "wmo code",
    wind_speed_10m: "km/h",
  },
  current: {
    time: NOW / 1_000,
    interval: 900,
    temperature_2m: 24.5,
    apparent_temperature: 25.1,
    precipitation: 0.2,
    rain: 0.2,
    weather_code: 61,
    wind_speed_10m: 12,
  },
  hourly_units: {
    time: "unixtime",
    temperature_2m: "C",
    apparent_temperature: "C",
    precipitation_probability: "%",
    precipitation: "mm",
    rain: "mm",
    weather_code: "wmo code",
    wind_speed_10m: "km/h",
  },
  hourly: {
    time: [NOW / 1_000, NOW / 1_000 + 3_600, NOW / 1_000 + 7_200],
    temperature_2m: [24.5, 25, 24],
    apparent_temperature: [25.1, 25.6, 24.4],
    precipitation_probability: [60, 40, 10],
    precipitation: [0.2, 0.1, 0],
    rain: [0.2, 0.1, 0],
    weather_code: [61, 51, 2],
    wind_speed_10m: [12, 10, 8],
  },
};

test("Nominatim maps forward and reverse geocoding with bounded URL parameters", async () => {
  const captured: CapturedRequest[] = [];
  const source = createNominatimSource({
    endpoint: "https://geo.example.test/nominatim/",
    userAgent: "Jarvis tests",
  });
  const forward = await source.query({
    principalId: "owner",
    purpose: "nearby",
    text: "Cafe Central",
    locale: "pt-BR",
    limit: 5,
    filters: {
      countryCodes: ["BR"],
      layer: "poi",
      endpoint: "http://169.254.169.254/latest/meta-data",
    },
  }, runtime(jsonFetch([NOMINATIM_PLACE], captured)));

  assert.equal(captured[0].url.origin, "https://geo.example.test");
  assert.equal(captured[0].url.pathname, "/nominatim/search");
  assert.equal(captured[0].url.searchParams.get("q"), "Cafe Central");
  assert.equal(captured[0].url.searchParams.get("limit"), "5");
  assert.equal(captured[0].url.searchParams.get("countrycodes"), "br");
  assert.equal(captured[0].url.searchParams.get("accept-language"), "pt-BR");
  assert.equal(new Headers(captured[0].init?.headers).get("User-Agent"), "Jarvis tests");
  assert.deepEqual(forward[0].point, { lat: -19.921, lng: -43.941 });
  assert.equal(forward[0].id, "nominatim:node/456");
  assert.equal(forward[0].data.category, "amenity");
  assert.equal(forward[0].data.address?.city, "Belo Horizonte");
  assert.equal(forward[0].scoreParts?.match, 0.72);
  assert.match(forward[0].sources[0].attribution || "", /OpenStreetMap/);

  captured.length = 0;
  const reverse = await source.query({ principalId: "owner", purpose: "mobility", point: ORIGIN }, runtime(jsonFetch(NOMINATIM_PLACE, captured)));
  assert.equal(captured[0].url.pathname, "/nominatim/reverse");
  assert.equal(captured[0].url.searchParams.get("lat"), String(ORIGIN.lat));
  assert.equal(captured[0].url.searchParams.get("lon"), String(ORIGIN.lng));
  assert.equal(reverse[0].title, "Cafe Central");
});

test("Valhalla maps route distance separately from straight-line distance", async () => {
  const captured: CapturedRequest[] = [];
  const source = createValhallaSource({ endpoint: "http://routing.example.test/api/", clientId: "jarvis-tests" });
  const result = await source.query({
    principalId: "owner",
    purpose: "mobility",
    point: ORIGIN,
    locale: "pt-BR",
    filters: {
      destinationLat: -19.82,
      destinationLng: -43.9,
      mode: "walk",
      endpoint: "http://169.254.169.254/latest/meta-data",
    },
  }, runtime(jsonFetch(VALHALLA_ROUTE, captured)));

  assert.equal(captured[0].url.toString(), "http://routing.example.test/api/route");
  assert.equal(captured[0].init?.method, "POST");
  assert.equal(new Headers(captured[0].init?.headers).get("X-Client-Id"), "jarvis-tests");
  const body = JSON.parse(String(captured[0].init?.body));
  assert.equal(body.costing, "pedestrian");
  assert.equal(body.directions_options.units, "kilometers");
  assert.equal(body.directions_options.language, "pt-BR");
  assert.deepEqual(body.locations[1], { lat: -19.82, lon: -43.9 });
  assert.equal(result[0].data.routedDistanceM, 12_500);
  assert.equal(result[0].data.durationSeconds, 900);
  assert.ok(result[0].data.straightLineDistanceM > 0);
  assert.notEqual(result[0].data.straightLineDistanceM, result[0].data.routedDistanceM);
  assert.equal(result[0].data.legs[0].encodedPolyline, "encoded-polyline");
  assert.equal(result[0].data.legs[0].maneuvers[0].distanceM, 400);
});

test("Valhalla maps a bounded one-to-many time-distance matrix", async () => {
  const captured: CapturedRequest[] = [];
  const source = createValhallaMatrixSource({ endpoint: "http://routing.example.test/api/" });
  const result = await source.query({
    principalId: "owner",
    purpose: "mobility",
    point: ORIGIN,
    limit: 2,
    filters: {
      destinationPoints: ["-19.82,-43.9", "-19.72,-43.8"],
      mode: "bike",
      endpoint: "http://169.254.169.254/latest/meta-data",
    },
  }, runtime(jsonFetch(VALHALLA_MATRIX, captured)));

  assert.equal(captured[0].url.toString(), "http://routing.example.test/api/sources_to_targets");
  const body = JSON.parse(String(captured[0].init?.body));
  assert.equal(body.costing, "bicycle");
  assert.equal(body.units, "kilometers");
  assert.equal(body.verbose, true);
  assert.deepEqual(body.targets[1], { lat: -19.72, lon: -43.8 });
  assert.equal(result[0].data.algorithm, "costmatrix");
  assert.equal(result[0].data.cells[0].distanceM, 12_500);
  assert.equal(result[0].data.cells[0].durationSeconds, 900);
  assert.equal(result[0].data.cells[0].reachable, true);
  assert.equal(result[0].data.cells[1].distanceM, null);
  assert.equal(result[0].data.cells[1].reachable, false);
  assert.equal(result[0].sources[0].freshness, "fresh");
});

test("Overpass builds an escaped bounded query and maps node and way centers", async () => {
  const captured: CapturedRequest[] = [];
  const source = createOverpassNearbySource({ endpoint: "https://overpass.example.test/api/interpreter" });
  const result = await source.query({
    principalId: "owner",
    purpose: "nearby",
    point: ORIGIN,
    limit: 10,
    filters: {
      category: "restaurant",
      name: 'Cafe "];node(0,0,0,0);out;',
      radiusM: 1_000,
      endpoint: "http://169.254.169.254/latest/meta-data",
    },
  }, runtime(jsonFetch(OVERPASS_RESPONSE, captured)));

  assert.equal(captured[0].url.toString(), "https://overpass.example.test/api/interpreter");
  assert.equal(captured[0].init?.method, "POST");
  const query = new URLSearchParams(String(captured[0].init?.body)).get("data") || "";
  assert.match(query, /^\[out:json\]\[timeout:20\];nwr\(around:1000,-19\.92,-43\.94\)/);
  assert.match(query, /\["amenity"="restaurant"\]/);
  assert.equal(query.includes('Cafe "];node('), false);
  assert.ok(query.includes('\\"'));
  assert.ok(query.includes('\\('));
  assert.equal((query.match(/out center/g) || []).length, 1);
  assert.equal(result.length, 2);
  assert.equal(result[0].data.openingHours, "Mo-Su 11:00-23:00");
  assert.equal(result[1].data.osmType, "way");
  assert.deepEqual(result[1].point, { lat: -19.922, lng: -43.942 });
  assert.equal(result[0].sources[0].freshness, "fresh");
  assert.match(result[0].sources[0].url || "", /openstreetmap\.org\/node\/11$/);
});

test("Open Charge Map requests only open data and never invents live availability", async () => {
  const captured: CapturedRequest[] = [];
  const source = createOpenChargeMapSource({
    endpoint: "https://ocm.example.test/v3/poi/",
    apiKey: "secret-test-key",
    userAgent: "Jarvis tests",
  });
  const result = await source.query({
    principalId: "owner",
    purpose: "nearby",
    point: ORIGIN,
    limit: 5,
    filters: {
      radiusKm: 5,
      connectorTypeIds: ["25"],
      minimumPowerKw: 40,
      endpoint: "http://169.254.169.254/latest/meta-data",
    },
  }, runtime(jsonFetch(OCM_RESPONSE, captured)));

  assert.equal(captured[0].url.origin, "https://ocm.example.test");
  assert.equal(captured[0].url.searchParams.get("opendata"), "true");
  assert.equal(captured[0].url.searchParams.get("connectiontypeid"), "25");
  assert.equal(captured[0].url.searchParams.get("maxresults"), "5");
  assert.equal(captured[0].url.searchParams.has("key"), false);
  assert.equal(new Headers(captured[0].init?.headers).get("X-API-Key"), "secret-test-key");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "ocm:101");
  assert.equal(result[0].data.connections.length, 1);
  assert.equal(result[0].data.connections[0].connectorTypeId, 25);
  assert.equal(result[0].data.operationalStatus.title, "Operational");
  assert.equal(result[0].data.operationalStatus.freshness, "stale");
  assert.deepEqual(result[0].data.availability, { status: "unknown", freshness: "unknown" });
  assert.equal(result[0].sources[0].freshness, "stale");
  assert.notEqual(result[0].sources[0].freshness, "live");
  assert.match(result[0].sources[0].attribution || "", /OpenStreetMap via Open Charge Map/);
});

test("Open Charge Map reports unknown source freshness when status time is absent", async () => {
  const fixture = [{
    ...OCM_RESPONSE[0],
    DateLastStatusUpdate: undefined,
    Connections: [OCM_RESPONSE[0].Connections[0]],
  }];
  const source = createOpenChargeMapSource();
  const result = await source.query({ principalId: "owner", purpose: "nearby", point: ORIGIN }, runtime(jsonFetch(fixture)));
  assert.equal(result[0].data.operationalStatus.freshness, "unknown");
  assert.equal(result[0].sources[0].freshness, "unknown");
  assert.equal(result[0].sources[0].observedAt, NOW);
  assert.equal(result[0].data.availability.status, "unknown");
});

test("Open-Meteo rounds coordinates, bounds hours, and maps current and hourly facts", async () => {
  const captured: CapturedRequest[] = [];
  const source = createOpenMeteoSource({ endpoint: "https://weather.example.test/v1/forecast", coordinatePrecision: 3 });
  const result = await source.query({
    principalId: "owner",
    purpose: "weather",
    point: { lat: -19.923456, lng: -43.945678 },
    limit: 2,
    filters: { endpoint: "http://169.254.169.254/latest/meta-data" },
  }, runtime(jsonFetch(OPEN_METEO_RESPONSE, captured)));

  assert.equal(captured[0].url.origin, "https://weather.example.test");
  assert.equal(captured[0].url.searchParams.get("latitude"), "-19.923");
  assert.equal(captured[0].url.searchParams.get("longitude"), "-43.946");
  assert.equal(captured[0].url.searchParams.get("forecast_hours"), "2");
  assert.match(captured[0].url.searchParams.get("current") || "", /temperature_2m/);
  assert.match(captured[0].url.searchParams.get("hourly") || "", /precipitation_probability/);
  assert.equal(result[0].data.current.validAt, NOW);
  assert.equal(result[0].data.current.temperatureC, 24.5);
  assert.equal(result[0].data.hourly.length, 2);
  assert.equal(result[0].data.hourly[0].precipitationProbabilityPercent, 60);
  assert.equal(result[0].sources[0].attribution, "Weather data by Open-Meteo.com");
  assert.equal(result[0].sources[0].freshness, "fresh");
});

test("Open-Meteo applies an explicit time window to the URL and mapped series", async () => {
  const captured: CapturedRequest[] = [];
  const source = createOpenMeteoSource({ endpoint: "https://weather.example.test/v1/forecast" });
  const result = await source.query({
    principalId: "owner",
    purpose: "events",
    point: ORIGIN,
    startAt: NOW + 3_600_000,
    endAt: NOW + 7_200_000,
    limit: 10,
  }, runtime(jsonFetch(OPEN_METEO_RESPONSE, captured)));
  assert.equal(captured[0].url.searchParams.has("forecast_hours"), false);
  assert.equal(captured[0].url.searchParams.get("start_date"), "2026-08-01");
  assert.equal(captured[0].url.searchParams.get("end_date"), "2026-08-01");
  assert.deepEqual(result[0].data.hourly.map((item) => item.validAt), [NOW + 3_600_000, NOW + 7_200_000]);
});

test("all adapters reject malformed provider responses", async () => {
  const cases: Array<{ name: string; source: ContextSource<unknown>; request: PersonalContextQuery; payload: unknown }> = [
    {
      name: "Nominatim",
      source: createNominatimSource(),
      request: { principalId: "owner", purpose: "nearby", text: "cafe" },
      payload: { unexpected: true },
    },
    {
      name: "Valhalla",
      source: createValhallaSource(),
      request: { principalId: "owner", purpose: "mobility", point: ORIGIN, filters: { destinationLat: -19.8, destinationLng: -43.9 } },
      payload: { trip: { units: "kilometers", summary: {}, legs: [] } },
    },
    {
      name: "Valhalla matrix",
      source: createValhallaMatrixSource(),
      request: { principalId: "owner", purpose: "mobility", point: ORIGIN, filters: { destinationLat: -19.8, destinationLng: -43.9 } },
      payload: { units: "kilometers", sources_to_targets: [] },
    },
    {
      name: "Overpass",
      source: createOverpassNearbySource(),
      request: { principalId: "owner", purpose: "nearby", point: ORIGIN, filters: { category: "cafe" } },
      payload: { elements: [{ type: "way", id: 1, tags: { name: "No center" } }] },
    },
    {
      name: "Open Charge Map",
      source: createOpenChargeMapSource(),
      request: { principalId: "owner", purpose: "nearby", point: ORIGIN },
      payload: [{ ID: 1, AddressInfo: null }],
    },
    {
      name: "Open-Meteo",
      source: createOpenMeteoSource(),
      request: { principalId: "owner", purpose: "weather", point: ORIGIN },
      payload: { latitude: -19.9, longitude: -43.9 },
    },
  ];
  for (const item of cases) {
    await assert.rejects(item.source.query(item.request, runtime(jsonFetch(item.payload))), (error) => error instanceof Error, item.name);
  }
});

test("Open-Meteo rejects mismatched hourly fixture arrays", async () => {
  const malformed = {
    ...OPEN_METEO_RESPONSE,
    hourly: { ...OPEN_METEO_RESPONSE.hourly, rain: [0.2] },
  };
  const source = createOpenMeteoSource();
  await assert.rejects(
    source.query({ principalId: "owner", purpose: "weather", point: ORIGIN }, runtime(jsonFetch(malformed))),
    /rain length does not match/,
  );
});

test("provider parsers reject semantically impossible numeric facts", async () => {
  const badCharger = [{
    ...OCM_RESPONSE[0],
    Connections: [{ ...OCM_RESPONSE[0].Connections[0], PowerKW: -1 }],
  }];
  await assert.rejects(
    createOpenChargeMapSource().query(
      { principalId: "owner", purpose: "nearby", point: ORIGIN },
      runtime(jsonFetch(badCharger)),
    ),
    /negative electrical value/,
  );

  const badWeather = {
    ...OPEN_METEO_RESPONSE,
    hourly: { ...OPEN_METEO_RESPONSE.hourly, precipitation_probability: [101, 40, 10] },
  };
  await assert.rejects(
    createOpenMeteoSource().query(
      { principalId: "owner", purpose: "weather", point: ORIGIN },
      runtime(jsonFetch(badWeather)),
    ),
    /outside its valid range/,
  );
});

test("provider responses cannot exceed local item and forecast limits", async () => {
  const nominatim = createNominatimSource();
  const places = [NOMINATIM_PLACE, { ...NOMINATIM_PLACE, place_id: 124, osm_id: 457 }];
  const geocoded = await nominatim.query(
    { principalId: "owner", purpose: "nearby", text: "cafe", limit: 1 },
    runtime(jsonFetch(places)),
  );
  assert.equal(geocoded.length, 1);

  const oversizedWeather = {
    ...OPEN_METEO_RESPONSE,
    hourly: { ...OPEN_METEO_RESPONSE.hourly, time: Array.from({ length: 385 }, (_, index) => NOW / 1_000 + index * 3_600) },
  };
  await assert.rejects(
    createOpenMeteoSource().query(
      { principalId: "owner", purpose: "weather", point: ORIGIN },
      runtime(jsonFetch(oversizedWeather)),
    ),
    /384-hour limit/,
  );
});

test("shared HTTP handling rejects invalid JSON and propagates HTTP status", async () => {
  const source = createNominatimSource();
  const request = { principalId: "owner", purpose: "nearby" as const, text: "cafe" };
  await assert.rejects(source.query(request, runtime(invalidJsonFetch())), /response is not valid JSON/);
  await assert.rejects(source.query(request, runtime(jsonFetch({ error: true }, undefined, 503))), /HTTP 503/);
});

test("adapters reject invalid coordinates and request limits before fetch", async () => {
  let calls = 0;
  const neverFetch = (async () => {
    calls += 1;
    throw new Error("fetch should not run");
  }) as typeof fetch;
  const cases: Array<{ source: ContextSource<unknown>; request: PersonalContextQuery; pattern: RegExp }> = [
    {
      source: createNominatimSource(),
      request: { principalId: "owner", purpose: "nearby", text: "cafe", point: { lat: 91, lng: 0 } },
      pattern: /latitude/,
    },
    {
      source: createValhallaSource(),
      request: { principalId: "owner", purpose: "mobility", point: ORIGIN, limit: 2, filters: { destinationLat: -19.8, destinationLng: -43.9 } },
      pattern: /limit/,
    },
    {
      source: createValhallaMatrixSource(),
      request: {
        principalId: "owner",
        purpose: "mobility",
        point: ORIGIN,
        limit: 1,
        filters: { destinationPoints: ["-19.8,-43.9", "-19.7,-43.8"] },
      },
      pattern: /destinationPoints/,
    },
    {
      source: createOverpassNearbySource(),
      request: { principalId: "owner", purpose: "nearby", point: ORIGIN, limit: 101, filters: { category: "cafe" } },
      pattern: /limit/,
    },
    {
      source: createOpenChargeMapSource(),
      request: { principalId: "owner", purpose: "nearby", point: ORIGIN, filters: { radiusKm: 201 } },
      pattern: /radiusKm/,
    },
    {
      source: createOpenMeteoSource(),
      request: { principalId: "owner", purpose: "weather", point: ORIGIN, limit: 385 },
      pattern: /limit/,
    },
    {
      source: createOpenMeteoSource(),
      request: { principalId: "owner", purpose: "weather", point: ORIGIN, startAt: NOW, endAt: NOW + 17 * 24 * 60 * 60_000 },
      pattern: /16 days/,
    },
    {
      source: createOpenMeteoSource(),
      request: { principalId: "owner", purpose: "weather", point: ORIGIN, startAt: NOW + 20 * 24 * 60 * 60_000, endAt: NOW + 21 * 24 * 60 * 60_000 },
      pattern: /forecast horizon/,
    },
  ];
  for (const item of cases) await assert.rejects(item.source.query(item.request, runtime(neverFetch)), item.pattern);
  assert.equal(calls, 0);
});

test("pre-aborted and in-flight requests propagate abort without fallback data", async () => {
  const source = createNominatimSource();
  const request = { principalId: "owner", purpose: "nearby" as const, text: "cafe" };
  const before = new AbortController();
  const beforeReason = new Error("cancelled before fetch");
  before.abort(beforeReason);
  let calls = 0;
  const countingFetch = (async () => {
    calls += 1;
    return new Response("[]");
  }) as typeof fetch;
  await assert.rejects(source.query(request, runtime(countingFetch, before.signal)), (error) => error === beforeReason);
  assert.equal(calls, 0);

  const during = new AbortController();
  const duringReason = new Error("cancelled in flight");
  let receivedSignal: AbortSignal | null = null;
  const pendingFetch = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    receivedSignal = init?.signal as AbortSignal;
    receivedSignal.addEventListener("abort", () => reject(receivedSignal?.reason), { once: true });
  })) as typeof fetch;
  const pending = source.query(request, runtime(pendingFetch, during.signal));
  during.abort(duringReason);
  await assert.rejects(pending, (error) => error === duringReason);
  assert.equal(receivedSignal, during.signal);
});

test("configured endpoints reject non-HTTP URLs and embedded credentials", () => {
  assert.throws(() => createNominatimSource({ endpoint: "file:///tmp/nominatim" }), /protocol/);
  assert.throws(() => createOpenMeteoSource({ endpoint: "https://user:secret@example.test/forecast" }), /credentials/);
  assert.throws(() => createOpenChargeMapSource({ endpoint: "https://example.test/poi?target=http://127.0.0.1" }), /query parameters/);
});
