import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ContextCandidate, PersonalContextQuery } from "@jarvis/protocol";
import type { ContextSource, ContextSourceRuntime } from "./context-sources.js";
import {
  OpenEventFederator,
  DEFAULT_PBH_EVENT_ENDPOINT,
  MAPAS_CULTURAIS_PARSER_VERSION,
  PBH_EVENT_PARSER_VERSION,
  createIcsEventSource,
  createJsonLdEventSource,
  createMapasCulturaisSource,
  createPbhEventSource,
  createRssAtomEventSource,
  deduplicateOpenEvents,
  mapMapasCulturaisEventState,
  mapPbhEventState,
  parseJsonLdEvents,
  parseMapasCulturaisEvents,
  parsePbhEvents,
  parseRssAtomEvents,
  type OpenEventData,
} from "./open-event-sources.js";

const NOW = Date.parse("2025-10-01T12:00:00Z");
const EVENT_START = Date.parse("2025-10-18T23:00:00Z");

test("open event source descriptors declare license, retention, and review metadata", () => {
  const upstream = [
    createMapasCulturaisSource({ endpoint: "https://events.example.test/api" }),
    createPbhEventSource(),
    createRssAtomEventSource({ url: "https://events.example.test/feed.xml" }),
    createIcsEventSource({ url: "https://events.example.test/feed.ics" }),
    createJsonLdEventSource({ url: "https://events.example.test/events" }),
  ];
  const sources: ContextSource<OpenEventData>[] = [
    ...upstream,
    new OpenEventFederator({ sources: upstream }),
  ];

  for (const source of sources) {
    assert.ok(source.descriptor.license, `${source.descriptor.id} license`);
    assert.ok(source.descriptor.retentionPolicy, `${source.descriptor.id} retention`);
    assert.equal(source.descriptor.lastReviewedAt, "2026-08-01", `${source.descriptor.id} review date`);
  }
});

const PBH_FIXTURE = JSON.parse(readFileSync(
  new URL("./fixtures/events/mapas-cultural-bh-v1.json", import.meta.url),
  "utf8",
)) as {
  fixtureVersion: number;
  parserVersion: number;
  sanitization: { freeTextReplaced: boolean; publicSchemaPreserved: boolean };
  payload: unknown;
};

const MAPAS_FIXTURE = [
  {
    id: 101,
    name: "Festival de Musica",
    status: 1,
    shortDescription: "Programacao oficial",
    singleUrl: "https://cultura.example.test/evento/101",
    updateTimestamp: "2025-10-01T09:00:00-03:00",
    terms: { linguagem: ["Musica"], categoria: ["Festival"] },
    occurrences: [{
      id: 501,
      rule: { startsOn: "2025-10-18", startsAt: "20:00", duration: 120 },
      space: { name: "Praca Central", address: "Rua A, 10", region: "Centro", location: { coordinates: [-43.94, -19.92] } },
    }],
  },
  {
    id: 102,
    name: "Evento cancelado",
    status: "cancelled",
    occurrences: [{ id: 502, rule: { startsOn: "2025-10-18", startsAt: "20:00" } }],
  },
  {
    id: 103,
    name: "Evento expirado",
    terms: { linguagem: ["Musica"], categoria: ["Festival"] },
    occurrences: [{ id: 503, rule: { startsOn: "2025-09-01", startsAt: "20:00" } }],
  },
  {
    id: 104,
    name: "Cinema em outro bairro",
    terms: { linguagem: ["Cinema"], categoria: ["Mostra"] },
    occurrences: [{ id: 504, rule: { startsOn: "2025-10-18", startsAt: "20:00" }, space: { name: "Sala Norte", region: "Pampulha" } }],
  },
];

const RSS_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0" xmlns:ev="urn:example:event" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#">
  <channel>
    <title>Agenda</title>
    <item>
      <guid>rss-1</guid>
      <title>Festival de Musica</title>
      <link>https://agenda.example.test/festival</link>
      <ev:startdate>2025-10-18T20:02:00-03:00</ev:startdate>
      <ev:enddate>2025-10-18T22:30:00-03:00</ev:enddate>
      <ev:location>Praca Central</ev:location>
      <category>Festival</category>
      <description><![CDATA[<strong>Programacao</strong> aberta]]></description>
      <pubDate>Wed, 01 Oct 2025 13:00:00 GMT</pubDate>
      <geo:lat>-19.92</geo:lat><geo:long>-43.94</geo:long>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:ev="urn:example:event">
  <title>Agenda Atom</title>
  <entry>
    <id>atom-1</id>
    <title>Feira de Domingo</title>
    <link rel="alternate" href="https://agenda.example.test/feira"/>
    <ev:startdate>2025-10-19</ev:startdate>
    <ev:location>Mercado</ev:location>
    <category term="Feira"/>
    <updated>2025-10-01T10:00:00-03:00</updated>
  </entry>
</feed>`;

const ICS_EVENT_FIXTURE = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:ics-festival\r
DTSTART;TZID=America/Sao_Paulo:20251018T200000\r
DTEND;TZID=America/Sao_Paulo:20251018T220000\r
RRULE:FREQ=DAILY;COUNT=2\r
SUMMARY:Festival ICS\r
LOCATION:Praca Central\r
URL:https://agenda.example.test/ics-festival\r
STATUS:CONFIRMED\r
END:VEVENT\r
END:VCALENDAR\r
`;

const ICS_STATE_FIXTURE = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:ics-confirmed\r
DTSTART;TZID=America/Sao_Paulo:20251018T200000\r
DTEND;TZID=America/Sao_Paulo:20251018T210000\r
SUMMARY:Confirmado\r
STATUS:CONFIRMED\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:ics-cancelled\r
DTSTART;TZID=America/Sao_Paulo:20251019T180000\r
DTEND;TZID=America/Sao_Paulo:20251019T190000\r
SUMMARY:Cancelado\r
STATUS:CANCELLED\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:ics-tentative\r
DTSTART;TZID=America/Sao_Paulo:20251019T200000\r
DTEND;TZID=America/Sao_Paulo:20251019T210000\r
SUMMARY:Tentativo\r
STATUS:TENTATIVE\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:ics-no-status\r
DTSTART;TZID=America/Sao_Paulo:20251020T200000\r
DTEND;TZID=America/Sao_Paulo:20251020T210000\r
DTSTAMP:20251001T120000Z\r
SUMMARY:Atualizado sem status\r
END:VEVENT\r
END:VCALENDAR\r
`;

const JSON_LD_HTML_FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "MusicEvent",
      "@id": "jsonld-1",
      "name": "Festival de Musica",
      "startDate": "2025-10-18T20:00:00-03:00",
      "endDate": "2025-10-18T22:00:00-03:00",
      "eventStatus": "https://schema.org/EventScheduled",
      "dateModified": "2025-10-02T10:00:00-03:00",
      "url": "https://portal.example.test/festival",
      "keywords": ["Festival", "Musica"],
      "location": {
        "@type": "Place",
        "name": "Praca Central",
        "address": { "streetAddress": "Rua A, 10", "addressLocality": "Belo Horizonte", "addressRegion": "MG" },
        "geo": { "latitude": -19.92, "longitude": -43.94 }
      }
    },
    {
      "@type": "Event",
      "@id": "jsonld-cancelled",
      "name": "Cancelado",
      "startDate": "2025-10-18T20:00:00-03:00",
      "eventStatus": "https://schema.org/EventCancelled"
    }
  ]
}
</script></head><body><br></body></html>`;

function runtime(fetcher: typeof fetch, now = NOW): ContextSourceRuntime {
  return { fetch: fetcher, now: () => now, signal: new AbortController().signal };
}

function eventRequest(overrides: Partial<PersonalContextQuery> = {}): PersonalContextQuery {
  return {
    principalId: "owner",
    purpose: "events",
    startAt: Date.parse("2025-10-18T00:00:00Z"),
    endAt: Date.parse("2025-10-21T00:00:00Z"),
    ...overrides,
  };
}

const parserOptions = (sourceId: string, sourceUrl: string, observedAt = NOW) => ({
  sourceId, sourceUrl, observedAt, attribution: `Attribution ${sourceId}`, defaultTimeZone: "America/Sao_Paulo",
});

test("Mapas Culturais source filters official records and revalidates with ETag/Last-Modified", async () => {
  const calls: Array<{ url: string; etag: string | null; modified: string | null }> = [];
  let requestCount = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), etag: headers.get("if-none-match"), modified: headers.get("if-modified-since") });
    requestCount++;
    if (requestCount === 2) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(MAPAS_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json", etag: '"fixture-v1"', "last-modified": "Wed, 01 Oct 2025 12:00:00 GMT" },
    });
  };
  const source = createMapasCulturaisSource({
    endpoint: "https://mapas.example.test/api/event/find",
    sourceId: "mapas-bh",
    label: "Mapa Cultural BH",
    attribution: "Fundacao Municipal de Cultura",
    sourcePageUrl: "https://mapas.example.test/eventos/",
    defaultTimeZone: "America/Sao_Paulo",
    query: { project: "EQ(7)" },
  });
  const request = eventRequest({ filters: { language: "Musica", category: "Festival", region: "Centro" } });
  const first = await source.query(request, runtime(fakeFetch));
  const second = await source.query(request, runtime(fakeFetch, NOW + 1_000));
  assert.equal(first.length, 1);
  assert.deepEqual(second.map((candidate) => candidate.id), first.map((candidate) => candidate.id));
  assert.equal(first[0].title, "Festival de Musica");
  assert.equal(first[0].data.state, "confirmed");
  assert.equal(first[0].data.sourceState, "1");
  assert.equal(first[0].data.timeZone, "America/Sao_Paulo");
  assert.equal(first[0].data.endAt, Date.parse("2025-10-19T01:00:00Z"));
  assert.equal(first[0].data.locationName, "Praca Central");
  assert.deepEqual(first[0].point, { lat: -19.92, lng: -43.94 });
  assert.equal(first[0].sources[0].attribution, "Fundacao Municipal de Cultura");
  assert.equal(first[0].sources[0].url, "https://cultura.example.test/evento/101");
  assert.match(calls[0].url, /api\/event\/find/);
  assert.match(decodeURIComponent(calls[0].url), /@select=/);
  assert.match(decodeURIComponent(calls[0].url), /project=EQ\(7\)/);
  assert.equal(calls[1].etag, '"fixture-v1"');
  assert.equal(calls[1].modified, "Wed, 01 Oct 2025 12:00:00 GMT");
});

test("Mapas Culturais and PBH states are explicit and fail closed", () => {
  assert.equal(mapMapasCulturaisEventState(1), "confirmed");
  assert.equal(mapMapasCulturaisEventState(0), "draft");
  assert.equal(mapMapasCulturaisEventState(-9), "cancelled");
  assert.equal(mapMapasCulturaisEventState("adiado"), "postponed");
  assert.equal(mapMapasCulturaisEventState("not confirmed"), "draft");
  assert.equal(mapMapasCulturaisEventState("novo-estado"), "unknown");
  assert.equal(mapPbhEventState("LICENCIADO"), "confirmed");
  assert.equal(mapPbhEventState("EM ANALISE"), "draft");
  assert.equal(mapPbhEventState("RESERVA NAO CONFIRMADA"), "cancelled");
  assert.equal(mapPbhEventState("NAO AUTORIZADO"), "cancelled");

  const record = (id: number, status: unknown, startsOn: string) => ({
    id, name: `Evento ${id}`, status,
    occurrences: [{ id: id * 10, status, rule: { startsOn, startsAt: "20:00" } }],
  });
  const events = parseMapasCulturaisEvents([
    record(1, 1, "2025-10-18"),
    record(2, 0, "data-invalida"),
    record(3, "cancelado", "data-invalida"),
    record(4, "adiado", "2025-10-19"),
    record(5, "estado-futuro", "2025-10-20"),
  ], parserOptions("mapas-states", "https://mapas.example.test/eventos"));
  assert.deepEqual(events.map((event) => event.data.state), ["confirmed", "postponed", "unknown"]);
  assert.equal(events.at(-1)?.data.sourceState, "estado-futuro");
  assert.equal(events.some((event) => event.data.state === "confirmed" && event.data.sourceState === "estado-futuro"), false);
});

test("PBH parser v1 consumes a sanitized public fixture and the free source keeps endpoint limits", async () => {
  assert.equal(PBH_FIXTURE.fixtureVersion, 1);
  assert.equal(PBH_FIXTURE.parserVersion, PBH_EVENT_PARSER_VERSION);
  assert.deepEqual(PBH_FIXTURE.sanitization, { freeTextReplaced: true, publicSchemaPreserved: true });
  assert.equal(PBH_EVENT_PARSER_VERSION, MAPAS_CULTURAIS_PARSER_VERSION);
  assert.equal(DEFAULT_PBH_EVENT_ENDPOINT, "https://mapaculturalbh.pbh.gov.br/api/event/find");

  const parsed = parsePbhEvents(PBH_FIXTURE.payload, parserOptions(
    "pbh-fixture",
    "https://mapaculturalbh.pbh.gov.br/eventos/",
  ), PBH_FIXTURE.parserVersion);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].data.state, "confirmed");
  assert.equal(parsed[0].data.timeZone, "America/Sao_Paulo");
  assert.equal(parsed[0].data.startAt, Date.parse("2016-04-09T22:00:00Z"));
  assert.equal(parsed[0].data.endAt, Date.parse("2016-04-09T23:30:00Z"));
  assert.equal(parsed[0].data.updatedAt, Date.parse("2025-05-19T18:30:45Z"));
  assert.equal(parsed[0].sources[0].url, "https://mapaculturalbh.pbh.gov.br/evento/1/");
  assert.throws(() => parsePbhEvents(PBH_FIXTURE.payload, parserOptions("pbh", DEFAULT_PBH_EVENT_ENDPOINT), 2), /unsupported PBH event parser version/);

  let requestedUrl = "";
  let requestedUserAgent: string | null = null;
  const source = createPbhEventSource({
    endpoint: "https://pbh.example.test/public/events",
    sourcePageUrl: "https://pbh.example.test/events",
    apiLimit: 5_000,
  });
  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedUserAgent = new Headers(init?.headers).get("user-agent");
    return new Response(JSON.stringify(PBH_FIXTURE.payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  const events = await source.query(eventRequest({
    startAt: Date.parse("2016-04-09T00:00:00Z"),
    endAt: Date.parse("2016-04-11T00:00:00Z"),
  }), runtime(fakeFetch));
  assert.equal(events.length, 1);
  assert.equal(events[0].data.timeZone, "America/Sao_Paulo");
  assert.equal(events[0].sources[0].attribution, "Mapa Cultural BH / Prefeitura de Belo Horizonte");
  assert.equal(new URL(requestedUrl).searchParams.get("@limit"), "1000");
  assert.match(requestedUserAgent || "", /^Mozilla\/5\.0 .* Chrome\/137\.0 Safari\/537\.36$/);
  assert.equal(source.descriptor.costClass, "free");
});

test("Mapas parser rejects contract drift instead of fabricating dates", () => {
  assert.throws(() => parseMapasCulturaisEvents({ unexpected: true }, parserOptions("mapas", "https://mapas.example.test/")), /invalid Mapas Culturais response/);
  assert.throws(() => parseMapasCulturaisEvents([{ id: 1, name: "Broken", occurrences: [{ rule: { startsOn: "not-a-date" } }] }], parserOptions("mapas", "https://mapas.example.test/")), /invalid event start date/);
  assert.throws(() => parseMapasCulturaisEvents([{ id: 1, name: "Impossible", startDate: "2025-02-30" }], parserOptions("mapas", "https://mapas.example.test/")), /invalid event start date/);
  assert.throws(() => createMapasCulturaisSource({ endpoint: "https://mapas.example.test/api/event/find", apiLimit: 0 }), /API limit is invalid/);
});

test("HTTP event sources stop reading streamed bodies at the configured limit", async () => {
  assert.throws(() => createMapasCulturaisSource({
    endpoint: "https://mapas.example.test/api/event/find",
    maxResponseBytes: Number.POSITIVE_INFINITY,
  }), /response limit is invalid/);
  const source = createMapasCulturaisSource({
    endpoint: "https://mapas.example.test/api/event/find",
    maxResponseBytes: 1_024,
  });
  const oversizedFetch: typeof fetch = async () => new Response("x".repeat(2_048), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(() => source.query(eventRequest(), runtime(oversizedFetch)), /response exceeds size limit/);
});

test("structured RSS and Atom parsers preserve links, markup text, all-day semantics, and provenance", () => {
  const rss = parseRssAtomEvents(RSS_FIXTURE, parserOptions("rss", "https://agenda.example.test/feed.xml"));
  assert.equal(rss.length, 1);
  assert.equal(rss[0].data.startAt, Date.parse("2025-10-18T23:02:00Z"));
  assert.equal(rss[0].data.description, "Programacao aberta");
  assert.equal(rss[0].data.state, "unknown");
  assert.equal(rss[0].data.timeZone, "America/Sao_Paulo");
  assert.deepEqual(rss[0].point, { lat: -19.92, lng: -43.94 });
  assert.equal(rss[0].sources[0].url, "https://agenda.example.test/festival");

  const atom = parseRssAtomEvents(ATOM_FIXTURE, parserOptions("atom", "https://agenda.example.test/atom.xml"));
  assert.equal(atom.length, 1);
  assert.equal(atom[0].data.allDay, true);
  assert.equal(atom[0].data.endAt! - atom[0].data.startAt, 24 * 60 * 60 * 1_000);
  assert.equal(atom[0].data.locationName, "Mercado");
  assert.equal(atom[0].data.state, "unknown");
  assert.equal(atom[0].data.categories?.includes("Feira"), true);
  assert.throws(() => parseRssAtomEvents("<rss><channel><item></channel>", parserOptions("bad", "https://bad.example.test/")), /invalid RSS\/Atom XML/);
});

test("RSS and Atom state/date handling is fail-safe", () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><guid>1</guid><title>Confirmado</title><status>confirmed</status><startDate>2025-10-18T20:00:00-03:00</startDate></item>
    <item><guid>2</guid><title>Rascunho</title><status>draft</status><startDate>data-invalida</startDate></item>
    <item><guid>3</guid><title>Cancelado</title><status>cancelled</status><startDate>data-invalida</startDate></item>
    <item><guid>4</guid><title>Adiado</title><status>postponed</status><startDate>2025-10-19T20:00:00-03:00</startDate></item>
    <item><guid>5</guid><title>Desconhecido</title><status><code>future</code></status><startDate>2025-10-20T20:00:00-03:00</startDate></item>
  </channel></rss>`;
  const events = parseRssAtomEvents(rss, parserOptions("rss-states", "https://agenda.example.test/feed.xml"));
  assert.deepEqual(events.map((event) => event.data.state), ["confirmed", "postponed", "unknown"]);
  assert.equal(events.at(-1)?.data.sourceState, undefined);

  const badRssDate = `<?xml version="1.0"?><rss version="2.0"><channel><item>
    <title>Data ruim</title><status>future</status><startDate>31/31/2025</startDate>
  </item></channel></rss>`;
  assert.throws(() => parseRssAtomEvents(badRssDate, parserOptions("rss-bad", "https://agenda.example.test/feed.xml")), /invalid event start date/);

  const badAtomDate = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <title>Data ruim</title><status>confirmed</status><startDate>2025-02-30</startDate>
  </entry></feed>`;
  assert.throws(() => parseRssAtomEvents(badAtomDate, parserOptions("atom-bad", "https://agenda.example.test/atom.xml")), /invalid event start date/);
});

test("ICS open-event source expands recurrence in a bounded request window", async () => {
  const source = createIcsEventSource({
    url: "https://agenda.example.test/events.ics",
    sourceId: "ics",
    attribution: "Agenda ICS",
    defaultTimeZone: "America/Sao_Paulo",
  });
  const fakeFetch: typeof fetch = async () => new Response(ICS_EVENT_FIXTURE, { status: 200, headers: { "content-type": "text/calendar" } });
  const events = await source.query(eventRequest(), runtime(fakeFetch));
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((candidate) => new Date(candidate.data.startAt).toISOString()), [
    "2025-10-18T23:00:00.000Z", "2025-10-19T23:00:00.000Z",
  ]);
  assert.equal(events.every((candidate) => candidate.data.state === "confirmed"), true);
  assert.equal(events.every((candidate) => candidate.data.timeZone === "America/Sao_Paulo"), true);
  assert.equal(events.every((candidate) => candidate.sources[0].attribution === "Agenda ICS"), true);
});

test("ICS excludes cancelled events and never infers confirmation from DTSTAMP", async () => {
  const source = createIcsEventSource({
    url: "https://agenda.example.test/states.ics",
    sourceId: "ics-states",
    attribution: "Agenda ICS",
    defaultTimeZone: "America/Sao_Paulo",
  });
  const fakeFetch: typeof fetch = async () => new Response(ICS_STATE_FIXTURE, { status: 200, headers: { "content-type": "text/calendar" } });
  const events = await source.query(eventRequest(), runtime(fakeFetch));
  assert.deepEqual(events.map((event) => event.title), ["Confirmado", "Tentativo", "Atualizado sem status"]);
  assert.deepEqual(events.map((event) => event.data.state), ["confirmed", "unknown", "unknown"]);
  assert.equal(events[1].data.sourceState, "TENTATIVE");
  assert.equal(events[2].data.updatedAt, Date.parse("2025-10-01T12:00:00Z"));
  assert.equal(events[2].data.state, "unknown");

  const malformed = ICS_STATE_FIXTURE.replace("20251018T200000", "not-a-date");
  const malformedSource = createIcsEventSource({ url: "https://agenda.example.test/malformed.ics" });
  const malformedFetch: typeof fetch = async () => new Response(malformed, { status: 200, headers: { "content-type": "text/calendar" } });
  await assert.rejects(() => malformedSource.query(eventRequest(), runtime(malformedFetch)), /invalid ICS/);
});

test("JSON-LD parser reads isolated HTML scripts and excludes cancelled events", () => {
  const events = parseJsonLdEvents(JSON_LD_HTML_FIXTURE, "text/html", parserOptions("jsonld", "https://portal.example.test/eventos"));
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Festival de Musica");
  assert.equal(events[0].data.state, "confirmed");
  assert.equal(events[0].data.timeZone, "America/Sao_Paulo");
  assert.equal(events[0].data.address, "Rua A, 10, Belo Horizonte, MG");
  assert.deepEqual(events[0].point, { lat: -19.92, lng: -43.94 });
  assert.equal(events[0].sources[0].recordId, "jsonld-1");
  assert.throws(() => parseJsonLdEvents('<html><script type="application/ld+json">{"@type":</script></html>', "text/html", parserOptions("bad", "https://portal.example.test/")), /invalid JSON-LD script/);
});

test("JSON-LD lifecycle states and malformed dates fail safely", () => {
  const document = JSON.stringify([
    { "@type": "Event", "@id": "1", name: "Confirmado", eventStatus: "https://schema.org/EventScheduled", startDate: "2025-10-18T20:00:00-03:00" },
    { "@type": "Event", "@id": "2", name: "Cancelado", eventStatus: "https://schema.org/EventCancelled", startDate: "data-invalida" },
    { "@type": "Event", "@id": "3", name: "Rascunho", eventStatus: "draft", startDate: "data-invalida" },
    { "@type": "Event", "@id": "4", name: "Adiado", eventStatus: "https://schema.org/EventPostponed", startDate: "2025-10-19T20:00:00-03:00" },
    { "@type": "Event", "@id": "5", name: "Estado novo", eventStatus: { code: "EventFuture" }, startDate: "2025-10-20T19:00:00-03:00" },
    { "@type": "Event", "@id": "6", name: "Atualizado sem status", startDate: "2025-10-20T20:00:00-03:00", dateModified: "2025-10-01T10:00:00-03:00" },
  ]);
  const events = parseJsonLdEvents(document, "application/ld+json", parserOptions("jsonld-states", "https://portal.example.test/eventos"));
  assert.deepEqual(events.map((event) => event.data.state), ["confirmed", "postponed", "unknown", "unknown"]);
  assert.equal(events.at(-1)?.data.updatedAt, Date.parse("2025-10-01T13:00:00Z"));
  assert.equal(events.at(-1)?.data.state, "unknown");

  const badStart = JSON.stringify({ "@type": "Event", name: "Data ruim", eventStatus: "future", startDate: "2025-02-30" });
  assert.throws(() => parseJsonLdEvents(badStart, "application/ld+json", parserOptions("jsonld-bad", "https://portal.example.test/")), /invalid event start date/);
  const badRange = JSON.stringify({
    "@type": "Event", name: "Intervalo ruim", eventStatus: "https://schema.org/EventScheduled",
    startDate: "2025-10-20T20:00:00-03:00", endDate: "2025-10-20T19:00:00-03:00",
  });
  assert.throws(() => parseJsonLdEvents(badRange, "application/ld+json", parserOptions("jsonld-range", "https://portal.example.test/")), /event endAt is invalid/);
});

function candidate(
  sourceId: string,
  recordId: string,
  overrides: Omit<Partial<ContextCandidate<OpenEventData>>, "data"> & { data?: Partial<OpenEventData> } = {},
): ContextCandidate<OpenEventData> {
  const { data: dataOverrides, ...candidateOverrides } = overrides;
  const url = `https://${sourceId}.example.test/${recordId}`;
  return {
    id: `${sourceId}-${recordId}`,
    kind: "open_event",
    title: "Festival de Musica",
    data: {
      recordId,
      startAt: EVENT_START,
      endAt: EVENT_START + 2 * 60 * 60 * 1_000,
      allDay: false,
      state: "confirmed",
      url,
      locationName: "Praca Central",
      ...dataOverrides,
      timeZone: dataOverrides?.timeZone || "America/Sao_Paulo",
    },
    sources: [{ sourceId, recordId, observedAt: NOW, freshness: "fresh", attribution: sourceId, url }],
    ...candidateOverrides,
  };
}

test("deduplication is deterministic, preserves conflicts, and does not merge different venues or same-source IDs", () => {
  const mapas = candidate("mapas", "101", { title: "Festival de Musica", data: { updatedAt: NOW } });
  const rss = candidate("rss", "rss-1", {
    title: "Festival de Musica",
    data: {
      startAt: EVENT_START + 2 * 60 * 1_000,
      endAt: EVENT_START + 2.5 * 60 * 60 * 1_000,
      timeZone: "UTC",
      updatedAt: NOW + 1_000,
    },
  });
  const otherVenue = candidate("jsonld", "other", { data: { locationName: "Outro Teatro", updatedAt: NOW + 2_000 } });
  const sameSourceDifferentId = candidate("mapas", "102");
  const forward = deduplicateOpenEvents([mapas, rss, otherVenue, sameSourceDifferentId]);
  const reverse = deduplicateOpenEvents([sameSourceDifferentId, otherVenue, rss, mapas]);
  assert.deepEqual(reverse, forward);
  assert.equal(forward.length, 3);
  const merged = forward.find((item) => item.sources.length === 2)!;
  assert.equal(merged.data.preferredSourceId, "rss");
  assert.deepEqual(merged.sources.map((source) => source.sourceId), ["mapas", "rss"]);
  assert.equal(merged.data.variants?.length, 2);
  assert.equal(merged.data.conflicts?.some((conflict) => conflict.field === "startAt" && conflict.values.length === 2), true);
  assert.equal(merged.data.conflicts?.some((conflict) => conflict.field === "timeZone" && conflict.values.length === 2), true);
  assert.deepEqual(merged.data.variants?.map((item) => item.timeZone), ["America/Sao_Paulo", "UTC"]);
  assert.equal(forward.some((item) => item.data.locationName === "Outro Teatro"), true);
  assert.equal(forward.filter((item) => item.sources[0].sourceId === "mapas").length >= 1, true);

  const recurringOne = candidate("ics", "recurring-uid");
  const recurringTwo = candidate("ics", "recurring-uid", { data: { startAt: EVENT_START + 24 * 60 * 60 * 1_000, endAt: EVENT_START + 26 * 60 * 60 * 1_000 } });
  assert.equal(deduplicateOpenEvents([recurringOne, recurringTwo]).length, 2, "recurring occurrences sharing one UID stay distinct");

  const recurringMirrorOne = candidate("mirror", "mirror-uid");
  const recurringMirrorTwo = candidate("mirror", "mirror-uid", {
    data: { startAt: EVENT_START + 24 * 60 * 60 * 1_000, endAt: EVENT_START + 26 * 60 * 60 * 1_000 },
  });
  const federatedRecurrences = deduplicateOpenEvents([recurringOne, recurringMirrorOne, recurringTwo, recurringMirrorTwo]);
  assert.equal(federatedRecurrences.length, 2);
  assert.equal(new Set(federatedRecurrences.map((event) => event.id)).size, 2, "federated recurrence IDs include the occurrence");
  assert.throws(() => deduplicateOpenEvents([mapas, rss], Number.NaN), /tolerance is invalid/);
});

function stubSource(id: string, run: ContextSource<OpenEventData>["query"]): ContextSource<OpenEventData> {
  return {
    descriptor: { id, label: id, purposes: ["events"], costClass: "free", transport: "http", certification: "first_party" },
    query: run,
  };
}

test("federator returns deterministic partial results when a network/parser source fails", async () => {
  const failures: string[] = [];
  const good = stubSource("good", async () => [candidate("good", "1")]);
  const offline = stubSource("offline", async () => { throw new Error("event source network request failed"); });
  const federator = new OpenEventFederator({ sources: [offline, good], onPartialFailure: (failure) => failures.push(failure.sourceId) });
  const result = await federator.query(eventRequest(), runtime(fetch));
  assert.equal(result.length, 1);
  assert.equal(result[0].sources[0].sourceId, "good");
  assert.deepEqual(federator.lastFailures(), [{ sourceId: "offline", message: "event source network request failed" }]);
  assert.deepEqual(failures, ["offline"]);

  const invalid = stubSource("invalid", async () => [{ ...candidate("invalid", "1"), sources: [] }]);
  const withContractFailure = new OpenEventFederator({ sources: [invalid, good] });
  assert.equal((await withContractFailure.query(eventRequest(), runtime(fetch))).length, 1);
  assert.deepEqual(withContractFailure.lastFailures(), [{ sourceId: "invalid", message: "event source returned a candidate without provenance" }]);

  const allFailed = new OpenEventFederator({ sources: [offline, stubSource("malformed", async () => { throw new Error("invalid JSON-LD script"); })] });
  await assert.rejects(() => allFailed.query(eventRequest(), runtime(fetch)), /all open event sources failed/);
});
