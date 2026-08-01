import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CalDavReadOnlySource,
  createCalDavReadOnlySource,
  createDeviceCalendarSource,
  normalizeDeviceCalendarBusyFree,
  parseIcsCalendar,
  type DeviceCalendarInterval,
} from "./calendar-context.js";
import type { ContextSourceRuntime } from "./context-sources.js";

const DST_ICS_FIXTURE = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Jarvis tests//EN\r
BEGIN:VEVENT\r
UID:daily-private\r
DTSTART;TZID=America/New_York:20250308T090000\r
DTEND;TZID=America/New_York:20250308T100000\r
RRULE:FREQ=DAILY;COUNT=3\r
SUMMARY:Private therapy appointment\r
DESCRIPTION:Private notes\r
LOCATION:Private clinic\r
ATTENDEE:mailto:private@example.test\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:all-day-private\r
DTSTART;VALUE=DATE:20250309\r
DTEND;VALUE=DATE:20250310\r
SUMMARY:Private all-day event\r
END:VEVENT\r
END:VCALENDAR\r
`;

const CALDAV_ICS_FIXTURE = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:caldav-private\r
DTSTART:20250308T150000Z\r
DTEND:20250308T160000Z\r
SUMMARY:Secret CalDAV title\r
LOCATION:Secret CalDAV location\r
END:VEVENT\r
END:VCALENDAR\r
`;

function runtime(fetcher: typeof fetch, now = Date.parse("2025-03-01T00:00:00Z")): ContextSourceRuntime {
  return { fetch: fetcher, now: () => now, signal: new AbortController().signal };
}

test("calendar source descriptors declare license, retention, and review metadata", () => {
  const sources = [
    createDeviceCalendarSource({ read: async () => [] }),
    createCalDavReadOnlySource({
      endpoint: "https://calendar.example.test/",
      secretRef: "CALDAV_OWNER",
      resolveSecret: async () => ({ kind: "bearer", token: "secret" }),
    }),
  ];
  for (const source of sources) {
    assert.ok(source.descriptor.license, `${source.descriptor.id} license`);
    assert.ok(source.descriptor.retentionPolicy, `${source.descriptor.id} retention`);
    assert.equal(source.descriptor.lastReviewedAt, "2026-08-01", `${source.descriptor.id} review date`);
  }
});

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function temporaryCacheFile(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-caldav-cache-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "cache.json");
}

function propfindFixture(
  calendars = ["/cal/"],
  options: { includeSyncToken?: boolean; etag?: string } = {},
): string {
  return `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${calendars.map((href, index) => `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:displayname>Calendar ${index + 1}</D:displayname><D:resourcetype><C:calendar/></D:resourcetype>${options.includeSyncToken === false ? "" : `<D:sync-token>token-${index + 1}</D:sync-token>`}${options.etag ? `<D:getetag>${escapeXml(options.etag)}</D:getetag>` : ""}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`).join("")}</D:multistatus>`;
}

function reportFixture(ics = CALDAV_ICS_FIXTURE, token: string | null = "token-next"): string {
  return `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/cal/event.ics</D:href><D:propstat><D:prop><D:getetag>&quot;v1&quot;</D:getetag><C:calendar-data>${escapeXml(ics)}</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>${token ? `<D:sync-token>${escapeXml(token)}</D:sync-token>` : ""}</D:multistatus>`;
}

function calendarEventFixture(
  uid: string,
  title: string | undefined,
  start = "20250308T150000Z",
  end = "20250308T160000Z",
): string {
  return `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:${uid}\r
DTSTART:${start}\r
DTEND:${end}\r
${title === undefined ? "" : `SUMMARY:${title}\r\n`}END:VEVENT\r
END:VCALENDAR\r
`;
}

function multiResourceReportFixture(
  resources: Array<{ href: string; etag: string; ics: string }>,
  token: string | null = "token-next",
): string {
  return `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${resources.map((resource) => `<D:response><D:href>${escapeXml(resource.href)}</D:href><D:propstat><D:prop><D:getetag>${escapeXml(resource.etag)}</D:getetag><C:calendar-data>${escapeXml(resource.ics)}</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`).join("")}${token ? `<D:sync-token>${escapeXml(token)}</D:sync-token>` : ""}</D:multistatus>`;
}

test("device calendar normalization merges overlaps and never copies private fields", async () => {
  const intervals: DeviceCalendarInterval[] = [
    { id: "one", startAt: 100, endAt: 300, title: "Private dentist", location: "Home address", attendees: ["person@example.test"] },
    { id: "two", startAt: 250, endAt: 400, description: "Private description" },
    { id: "three", startAt: 400, endAt: 450, availability: "tentative" },
    { id: "cancelled", startAt: 500, endAt: 600, status: "cancelled", title: "Cancelled secret" },
    { id: "transparent", startAt: 700, endAt: 800, transparency: "transparent", title: "Free secret" },
  ];
  const normalized = normalizeDeviceCalendarBusyFree(intervals, { startAt: 0, endAt: 1_000 });
  assert.deepEqual(normalized.busy, [{ availability: "busy", startAt: 100, endAt: 450, allDay: false }]);
  assert.deepEqual(normalized.free, [
    { availability: "free", startAt: 0, endAt: 100, allDay: false },
    { availability: "free", startAt: 450, endAt: 1_000, allDay: false },
  ]);
  assert.doesNotMatch(JSON.stringify(normalized), /dentist|address|person@|description|secret/i);

  const source = createDeviceCalendarSource({ read: async () => intervals });
  const candidates = await source.query(
    { principalId: "owner", purpose: "calendar", startAt: 0, endAt: 1_000 },
    runtime(fetch),
  );
  assert.equal(candidates.some((candidate) => candidate.data.availability === "free"), true);
  assert.doesNotMatch(JSON.stringify(candidates), /dentist|address|person@|description|secret/i);
});

test("an incomplete device snapshot never claims free time and access is validated at runtime", async () => {
  const source = createDeviceCalendarSource({
    read: async () => ({ intervals: [{ startAt: 100, endAt: 200, title: "Still private" }], complete: false, observedAt: 50 }),
  });
  const candidates = await source.query({ principalId: "owner", purpose: "calendar", startAt: 0, endAt: 1_000 }, runtime(fetch));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].data.availability, "busy");
  assert.equal("complete" in candidates[0].data && candidates[0].data.complete, false);
  assert.equal(candidates[0].sources[0].observedAt, 50);
  assert.doesNotMatch(JSON.stringify(candidates), /Still private/);

  const invalidAccess = createDeviceCalendarSource({
    read: async () => [{ startAt: 100, endAt: 200, title: "Must not leak" }],
    resolveAccess: async () => "invalid" as "details",
  });
  await assert.rejects(() => invalidAccess.query({ principalId: "owner", purpose: "calendar", startAt: 0, endAt: 1_000 }, runtime(fetch)), /access level is invalid/);
});

test("ICS recurrence honors IANA DST and all-day boundaries while busy/free stays redacted", () => {
  const options = {
    sourceId: "calendar",
    observedAt: 1,
    startAt: Date.parse("2025-03-08T00:00:00Z"),
    endAt: Date.parse("2025-03-11T00:00:00Z"),
    defaultTimeZone: "America/New_York",
  };
  const busyOnly = parseIcsCalendar(DST_ICS_FIXTURE, options);
  const timed = busyOnly.filter((item) => !item.allDay);
  const allDay = busyOnly.find((item) => item.allDay)!;
  assert.deepEqual(timed.map((item) => new Date(item.startAt).toISOString()), [
    "2025-03-08T14:00:00.000Z",
    "2025-03-09T13:00:00.000Z",
    "2025-03-10T13:00:00.000Z",
  ]);
  assert.equal(allDay.endAt - allDay.startAt, 23 * 60 * 60 * 1_000, "all-day follows local midnight across DST");
  assert.doesNotMatch(JSON.stringify(busyOnly), /therapy|notes|clinic|private@example/i);
  assert.equal(busyOnly.every((item) => item.source.recordId === undefined && item.source.url === undefined), true);

  const detailed = parseIcsCalendar(DST_ICS_FIXTURE, { ...options, access: "details" });
  assert.equal(detailed.some((item) => item.title === "Private therapy appointment"), true);
  assert.equal(detailed.some((item) => item.attendees?.includes("mailto:private@example.test")), true);
});

test("ICS rejects malformed input and enforces window and expansion output limits", () => {
  const base = { sourceId: "calendar", observedAt: 1, startAt: 0, endAt: 10_000 };
  assert.throws(() => parseIcsCalendar("not a calendar", base), /invalid ICS calendar/);
  assert.throws(() => parseIcsCalendar(DST_ICS_FIXTURE, { ...base, endAt: 367 * 24 * 60 * 60 * 1_000 }), /366 days/);
  assert.throws(() => parseIcsCalendar(DST_ICS_FIXTURE, {
    sourceId: "calendar",
    observedAt: 1,
    startAt: Date.parse("2025-03-08T00:00:00Z"),
    endAt: Date.parse("2025-03-11T00:00:00Z"),
    maxOccurrences: 2,
  }), /occurrence limit/);
});

test("CalDAV discovers with PROPFIND, reports a bounded window, uses sync-token, and redacts details", async () => {
  const calls: Array<{ url: string; method: string; body: string; authorization: string | null }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const method = init?.method || "GET", body = String(init?.body || "");
    calls.push({ url: String(input), method, body, authorization: new Headers(init?.headers).get("authorization") });
    if (method === "PROPFIND") return new Response(propfindFixture(), { status: 207 });
    if (body.includes("sync-collection")) {
      return new Response('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:sync-token>token-final</D:sync-token></D:multistatus>', { status: 207 });
    }
    return new Response(reportFixture(), { status: 207 });
  };
  let resolutions = 0;
  const source = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_OWNER",
    resolveSecret: async () => { resolutions++; return { kind: "basic", username: "owner", password: "p@ssword" }; },
  });
  const request = {
    principalId: "owner", purpose: "calendar" as const,
    startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z"),
  };
  const first = await source.query(request, runtime(fakeFetch));
  const second = await source.query(request, runtime(fakeFetch));
  assert.equal(resolutions, 2, "credentials are resolved per query and never retained by the adapter");
  assert.equal(first.some((candidate) => candidate.data.availability === "busy"), true);
  assert.equal(second.some((candidate) => candidate.data.availability === "busy"), true);
  assert.doesNotMatch(JSON.stringify(first), /Secret CalDAV/i);
  assert.equal(calls.every((call) => !call.url.includes("owner") && !call.url.includes("p@ssword")), true);
  assert.equal(calls.every((call) => call.authorization?.startsWith("Basic ")), true);
  const initialReport = calls.find((call) => call.method === "REPORT" && call.body.includes("calendar-query"))!;
  assert.match(initialReport.body, /time-range start="20250308T000000Z" end="20250309T000000Z"/);
  assert.doesNotMatch(initialReport.body, /SUMMARY|DESCRIPTION|LOCATION|ATTENDEE/);
  assert.equal(calls.some((call) => call.body.includes("sync-collection") && call.body.includes("token-next")), true);

  const detailsSource = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_OWNER",
    resolveSecret: async () => ({ kind: "basic", username: "owner", password: "p@ssword" }),
    resolveAccess: () => "details",
  });
  const details = await detailsSource.query(request, runtime(fakeFetch));
  const event = details.find((candidate) => candidate.kind === "calendar_event");
  assert.ok(event);
  const eventData = event?.data as unknown as Record<string, unknown>;
  assert.equal(eventData.calendarHref, "https://calendar.example.test/cal/");
  assert.equal(eventData.eventHref, "https://calendar.example.test/cal/event.ics");
  assert.equal(eventData.etag, '"v1"');
  assert.equal(eventData.uid, "caldav-private");
});

test("CalDAV discovery follows current-user-principal and calendar-home-set on the same origin", async () => {
  const calls: Array<{ url: string; depth: string | null }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, depth: new Headers(init?.headers).get("depth") });
    if (url.endsWith("/root/")) {
      return new Response('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/root/</D:href><D:propstat><D:prop><D:current-user-principal><D:href>/principals/owner/</D:href></D:current-user-principal></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>', { status: 207 });
    }
    if (url.endsWith("/principals/owner/")) {
      return new Response('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/principals/owner/</D:href><D:propstat><D:prop><C:calendar-home-set><D:href>/homes/owner/</D:href></C:calendar-home-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>', { status: 207 });
    }
    return new Response(propfindFixture(["/homes/owner/main/"]), { status: 207 });
  };
  const source = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_OWNER",
    resolveSecret: async () => ({ kind: "bearer", token: "secret" }),
  });
  const calendars = await source.discoverCalendars("owner", runtime(fakeFetch));
  assert.deepEqual(calendars.map((calendar) => calendar.href), ["https://calendar.example.test/homes/owner/main/"]);
  assert.deepEqual(calls, [
    { url: "https://calendar.example.test/root/", depth: "1" },
    { url: "https://calendar.example.test/principals/owner/", depth: "0" },
    { url: "https://calendar.example.test/homes/owner/", depth: "1" },
  ]);
});

test("CalDAV keeps successful calendars on partial network failure and never derives free time from an incomplete set", async () => {
  const failures: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const method = init?.method || "GET", url = String(input);
    if (method === "PROPFIND") return new Response(propfindFixture(["/a/", "/b/"]), { status: 207 });
    if (url.endsWith("/b/")) throw new Error("network leaked https://calendar.example.test/b/");
    return new Response(reportFixture().replaceAll("/cal/event.ics", "/a/event.ics"), { status: 207 });
  };
  const source = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/root/",
    calendarHrefs: ["/a/", "/b/"],
    secretRef: "CALDAV_OWNER",
    resolveSecret: async () => ({ kind: "bearer", token: "top-secret-token" }),
    onPartialFailure: (failure) => failures.push(failure.message),
  });
  const candidates = await source.query({
    principalId: "owner", purpose: "calendar",
    startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z"),
  }, runtime(fakeFetch));
  assert.equal(candidates.some((candidate) => candidate.data.availability === "busy"), true);
  assert.equal(candidates.some((candidate) => candidate.data.availability === "free"), false);
  assert.equal(candidates.every((candidate) => "complete" in candidate.data && candidate.data.complete === false), true);
  assert.deepEqual(failures, ["CalDAV calendar query failed"]);
});

test("CalDAV incremental resources are isolated by principal", async () => {
  const reportBodies = new Map<string, string[]>();
  const fakeFetch: typeof fetch = async (_input, init) => {
    const method = init?.method || "GET";
    if (method === "PROPFIND") return new Response(propfindFixture(), { status: 207 });
    const authorization = new Headers(init?.headers).get("authorization") || "";
    const body = String(init?.body || "");
    reportBodies.set(authorization, [...(reportBodies.get(authorization) || []), body]);
    const hour = authorization.endsWith("principal-one") ? "150000" : "170000";
    const ics = CALDAV_ICS_FIXTURE.replace("150000", hour).replace("160000", hour === "150000" ? "160000" : "180000");
    return new Response(reportFixture(ics, `token-${hour}`), { status: 207 });
  };
  const source = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_BY_PRINCIPAL",
    resolveSecret: async (_ref, context) => ({ kind: "bearer", token: context.principalId }),
  });
  const base = { purpose: "calendar" as const, startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z") };
  const one = await source.query({ ...base, principalId: "principal-one" }, runtime(fakeFetch));
  const two = await source.query({ ...base, principalId: "principal-two" }, runtime(fakeFetch));
  const busyOne = one.find((candidate) => candidate.data.availability === "busy")!;
  const busyTwo = two.find((candidate) => candidate.data.availability === "busy")!;
  assert.equal(busyOne.data.startAt, Date.parse("2025-03-08T15:00:00Z"));
  assert.equal(busyTwo.data.startAt, Date.parse("2025-03-08T17:00:00Z"));
  assert.equal([...reportBodies.values()].every((bodies) => bodies[0].includes("calendar-query") && !bodies[0].includes("sync-collection")), true);
});

test("CalDAV durable cache resumes sync after restart without persisting private details", async (t) => {
  const cacheFile = temporaryCacheFile(t);
  const reportBodies: string[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const method = init?.method || "GET", body = String(init?.body || "");
    if (method === "PROPFIND") return new Response(propfindFixture(), { status: 207 });
    reportBodies.push(body);
    if (body.includes("sync-collection")) {
      return new Response('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:sync-token>token-final</D:sync-token></D:multistatus>', { status: 207 });
    }
    return new Response(reportFixture(), { status: 207, headers: { ETag: '"collection-v1"' } });
  };
  const options = {
    sourceId: "private-work-calendar",
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_PRIVATE",
    cacheFile,
    cacheMaxAgeMs: 60_000,
    resolveSecret: async () => ({ kind: "basic" as const, username: "private-owner", password: "durable-password" }),
  };
  const request = {
    principalId: "principal-private", purpose: "calendar" as const,
    startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z"),
  };
  const first = await new CalDavReadOnlySource(options).query(request, runtime(fakeFetch));
  assert.equal(first.some((candidate) => candidate.data.availability === "busy"), true);
  const persisted = readFileSync(cacheFile, "utf8");
  assert.match(persisted, /token-next/);
  assert.doesNotMatch(persisted, /Secret CalDAV|private-owner|durable-password|principal-private|calendar\.example|caldav-private|event\.ics/i);
  assert.equal(existsSync(`${cacheFile}.tmp`), false, "atomic temp file is not left behind");
  if (process.platform !== "win32") {
    assert.equal(statSync(cacheFile).mode & 0o777, 0o600);
    assert.equal(statSync(join(cacheFile, "..")).mode & 0o777, 0o700);
  }

  await new CalDavReadOnlySource(options).query({ ...request, principalId: "another-principal" }, runtime(fakeFetch));
  const afterRestart = await new CalDavReadOnlySource(options).query(request, runtime(fakeFetch));
  assert.equal(afterRestart.some((candidate) => candidate.data.availability === "busy"), true);
  assert.equal(reportBodies.length, 3);
  assert.match(reportBodies[0], /calendar-query/);
  assert.match(reportBodies[1], /calendar-query/, "another principal cannot reuse the first principal's state");
  assert.match(reportBodies[2], /sync-collection/);
  assert.match(reportBodies[2], /token-next/);
});

test("CalDAV erase and dispose remove durable state by principal and source", async (t) => {
  const cacheFile = temporaryCacheFile(t);
  const reportBodies = new Map<string, string[]>();
  const fakeFetch: typeof fetch = async (_input, init) => {
    if ((init?.method || "GET") === "PROPFIND") return new Response(propfindFixture(), { status: 207 });
    const authorization = new Headers(init?.headers).get("authorization") || "";
    const body = String(init?.body || "");
    reportBodies.set(authorization, [...(reportBodies.get(authorization) || []), body]);
    if (body.includes("sync-collection")) {
      return new Response('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:sync-token>token-final</D:sync-token></D:multistatus>', { status: 207 });
    }
    return new Response(reportFixture(), { status: 207 });
  };
  const options = {
    sourceId: "work-source",
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_BY_PRINCIPAL",
    cacheFile,
    resolveSecret: async (_ref: string, context: { principalId: string }) => ({ kind: "bearer" as const, token: context.principalId }),
  };
  const request = {
    purpose: "calendar" as const,
    startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z"),
  };
  const source = createCalDavReadOnlySource(options);
  await source.query({ ...request, principalId: "principal-one" }, runtime(fakeFetch));
  await source.query({ ...request, principalId: "principal-two" }, runtime(fakeFetch));
  const collections = () => (JSON.parse(readFileSync(cacheFile, "utf8")) as { collections: unknown[] }).collections;
  assert.equal(collections().length, 2);
  assert.doesNotMatch(readFileSync(cacheFile, "utf8"), /principal-one|principal-two|work-source|calendar\.example/i);

  source.eraseCachedData("principal-one");
  assert.equal(collections().length, 1);
  const restarted = createCalDavReadOnlySource(options);
  await restarted.query({ ...request, principalId: "principal-two" }, runtime(fakeFetch));
  await restarted.query({ ...request, principalId: "principal-one" }, runtime(fakeFetch));
  assert.match(reportBodies.get("Bearer principal-two")?.at(-1) || "", /sync-collection/);
  assert.match(reportBodies.get("Bearer principal-one")?.at(-1) || "", /calendar-query/);

  restarted.dispose("principal-one");
  assert.equal(collections().length, 1, "principal disposal preserves other principals on the source");
  await assert.rejects(
    () => restarted.query({ ...request, principalId: "principal-one" }, runtime(fakeFetch)),
    /source is disposed/,
  );
  restarted.dispose();
  assert.equal(collections().length, 0);
  await assert.rejects(
    () => restarted.query({ ...request, principalId: "principal-two" }, runtime(fakeFetch)),
    /source is disposed/,
  );
});

test("CalDAV disposal prevents an in-flight query from repopulating erased cache", async (t) => {
  const cacheFile = temporaryCacheFile(t);
  let releaseReport!: () => void, markReportStarted!: () => void;
  const reportGate = new Promise<void>((resolve) => { releaseReport = resolve; });
  const reportStarted = new Promise<void>((resolve) => { markReportStarted = resolve; });
  const fakeFetch: typeof fetch = async (_input, init) => {
    if ((init?.method || "GET") === "PROPFIND") return new Response(propfindFixture(), { status: 207 });
    markReportStarted();
    await reportGate;
    return new Response(reportFixture(), { status: 207 });
  };
  const source = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_OWNER",
    cacheFile,
    resolveSecret: async () => ({ kind: "bearer", token: "secret" }),
  });
  const operation = source.query({
    principalId: "owner", purpose: "calendar",
    startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z"),
  }, runtime(fakeFetch));
  await reportStarted;
  source.dispose("owner");
  releaseReport();
  await assert.rejects(operation, /all selected CalDAV calendars failed/);
  assert.equal((JSON.parse(readFileSync(cacheFile, "utf8")) as { collections: unknown[] }).collections.length, 0);
});

test("CalDAV uses collection ETag and reuses durable data on 304 when sync-token is unavailable", async (t) => {
  const cacheFile = temporaryCacheFile(t);
  const reports: Array<{ body: string; ifNoneMatch: string | null }> = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const method = init?.method || "GET", headers = new Headers(init?.headers);
    if (method === "PROPFIND") {
      return new Response(propfindFixture(["/cal/"], { includeSyncToken: false, etag: '"collection-v1"' }), { status: 207 });
    }
    reports.push({ body: String(init?.body || ""), ifNoneMatch: headers.get("if-none-match") });
    if (reports.length === 2) return new Response(null, { status: 304, headers: { ETag: '"collection-v1"' } });
    return new Response(reportFixture(CALDAV_ICS_FIXTURE, null), { status: 207, headers: { ETag: '"collection-v1"' } });
  };
  const options = {
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_OWNER",
    cacheFile,
    resolveSecret: async () => ({ kind: "bearer" as const, token: "private-token" }),
  };
  const request = {
    principalId: "owner", purpose: "calendar" as const,
    startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z"),
  };
  await new CalDavReadOnlySource(options).query(request, runtime(fakeFetch));
  const result = await new CalDavReadOnlySource(options).query(request, runtime(fakeFetch));
  assert.equal(result.some((candidate) => candidate.data.availability === "busy"), true);
  assert.equal(reports.length, 2);
  assert.match(reports[1].body, /calendar-query/);
  assert.doesNotMatch(reports[1].body, /sync-collection/);
  assert.equal(reports[1].ifNoneMatch, '"collection-v1"');
});

test("CalDAV discards an invalid sync-token, falls back conditionally, and adopts the replacement token", async () => {
  const reportCalls: Array<{ body: string; ifNoneMatch: string | null }> = [];
  let fullReports = 0;
  const changedIcs = CALDAV_ICS_FIXTURE.replace("150000", "170000").replace("160000", "180000");
  const fakeFetch: typeof fetch = async (_input, init) => {
    const method = init?.method || "GET", body = String(init?.body || ""), headers = new Headers(init?.headers);
    if (method === "PROPFIND") return new Response(propfindFixture(), { status: 207 });
    reportCalls.push({ body, ifNoneMatch: headers.get("if-none-match") });
    if (body.includes("sync-collection") && body.includes("token-old")) return new Response(null, { status: 409 });
    if (body.includes("sync-collection") && body.includes("token-new")) {
      return new Response('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:sync-token>token-final</D:sync-token></D:multistatus>', { status: 207 });
    }
    fullReports++;
    return fullReports === 1
      ? new Response(reportFixture(CALDAV_ICS_FIXTURE, "token-old"), { status: 207, headers: { ETag: '"collection-old"' } })
      : new Response(reportFixture(changedIcs, "token-new"), { status: 207, headers: { ETag: '"collection-new"' } });
  };
  const source = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_OWNER",
    resolveSecret: async () => ({ kind: "bearer", token: "secret" }),
  });
  const request = {
    principalId: "owner", purpose: "calendar" as const,
    startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z"),
  };
  await source.query(request, runtime(fakeFetch));
  const afterFallback = await source.query(request, runtime(fakeFetch));
  const afterReplacementSync = await source.query(request, runtime(fakeFetch));
  assert.equal(afterFallback.find((candidate) => candidate.data.availability === "busy")?.data.startAt, Date.parse("2025-03-08T17:00:00Z"));
  assert.equal(afterReplacementSync.find((candidate) => candidate.data.availability === "busy")?.data.startAt, Date.parse("2025-03-08T17:00:00Z"));
  assert.equal(fullReports, 2);
  const fallback = reportCalls.find((call) => call.body.includes("calendar-query") && call.ifNoneMatch !== null)!;
  assert.equal(fallback.ifNoneMatch, '"collection-old"');
  assert.equal(reportCalls.some((call) => call.body.includes("sync-collection") && call.body.includes("token-new")), true);
  assert.equal(reportCalls.filter((call) => call.body.includes("token-old")).length, 1, "the rejected token is not retried");
});

test("CalDAV ignores corrupt and expired durable cache and enforces resource and byte limits", async (t) => {
  const cacheFile = temporaryCacheFile(t);
  writeFileSync(cacheFile, '{"version":1,"collections":[');
  const reportBodies: string[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const method = init?.method || "GET", body = String(init?.body || "");
    if (method === "PROPFIND") return new Response(propfindFixture(), { status: 207 });
    reportBodies.push(body);
    return new Response(reportFixture(), { status: 207 });
  };
  const request = {
    principalId: "owner", purpose: "calendar" as const,
    startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z"),
  };
  const options = {
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_OWNER",
    cacheFile,
    cacheMaxAgeMs: 10,
    resolveSecret: async () => ({ kind: "bearer" as const, token: "secret" }),
  };
  await new CalDavReadOnlySource(options).query(request, runtime(fakeFetch, 1_000));
  const recovered = JSON.parse(readFileSync(cacheFile, "utf8")) as { collections: unknown[] };
  assert.equal(recovered.collections.length, 1, "the corrupt cache is replaced by a usable snapshot");
  await new CalDavReadOnlySource(options).query(request, runtime(fakeFetch, 1_011));
  assert.equal(reportBodies.every((body) => body.includes("calendar-query") && !body.includes("sync-collection")), true);

  const tinyCacheFile = temporaryCacheFile(t);
  await new CalDavReadOnlySource({ ...options, cacheFile: tinyCacheFile, cacheMaxAgeMs: 60_000, maxCacheBytes: 256 })
    .query(request, runtime(fakeFetch, 2_000));
  const bounded = JSON.parse(readFileSync(tinyCacheFile, "utf8")) as { collections: unknown[] };
  assert.equal(bounded.collections.length, 0, "an oversized collection is omitted instead of overflowing the cache");
  assert.ok(statSync(tinyCacheFile).size <= 256);
  assert.equal(existsSync(`${tinyCacheFile}.tmp`), false);

  const limitedFetch: typeof fetch = async (_input, init) => {
    if ((init?.method || "GET") === "PROPFIND") return new Response(propfindFixture(), { status: 207 });
    return new Response(multiResourceReportFixture([
      { href: "/cal/a.ics", etag: '"a"', ics: calendarEventFixture("a", "First") },
      { href: "/cal/b.ics", etag: '"b"', ics: calendarEventFixture("b", "Second", "20250308T170000Z", "20250308T180000Z") },
    ]), { status: 207 });
  };
  const limited = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_OWNER",
    maxCachedResources: 1,
    resolveSecret: async () => ({ kind: "bearer", token: "secret" }),
  });
  await assert.rejects(() => limited.query(request, runtime(limitedFetch)), /all selected CalDAV calendars failed/);
});

test("CalDAV semantic deduplication is calendar-scoped and fail-safe", async (t) => {
  const cacheFile = temporaryCacheFile(t);
  const fakeFetch: typeof fetch = async (input, init) => {
    if ((init?.method || "GET") === "PROPFIND") return new Response(propfindFixture(["/cal/", "/other/"]), { status: 207 });
    if (String(input).endsWith("/other/")) {
      return new Response(multiResourceReportFixture([
        { href: "/other/a.ics", etag: '"other-a"', ics: calendarEventFixture("same-uid", "Reuniao de equipe") },
      ]), { status: 207 });
    }
    return new Response(multiResourceReportFixture([
      { href: "/cal/a.ics", etag: '"a"', ics: calendarEventFixture("event-a", "Reunião de Equipe") },
      { href: "/cal/b.ics", etag: '"b"', ics: calendarEventFixture("event-b", "  reuniao---de equipe  ") },
      { href: "/cal/no-title.ics", etag: '"c"', ics: calendarEventFixture("event-c", undefined) },
      { href: "/cal/later-end.ics", etag: '"d"', ics: calendarEventFixture("event-d", "Reuniao de equipe", "20250308T150000Z", "20250308T163000Z") },
    ]), { status: 207 });
  };
  const source = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/root/",
    secretRef: "CALDAV_OWNER",
    cacheFile,
    resolveSecret: async () => ({ kind: "bearer", token: "secret" }),
    resolveAccess: () => "details",
  });
  const events = await source.query({
    principalId: "owner", purpose: "calendar",
    startAt: Date.parse("2025-03-08T00:00:00Z"), endAt: Date.parse("2025-03-09T00:00:00Z"),
  }, runtime(fakeFetch));
  assert.equal(events.length, 4, "one safe same-calendar duplicate is collapsed");
  assert.equal(new Set(events.map((event) => event.id)).size, events.length, "unsafe matches retain distinct IDs");
  const exactInterval = events.filter((event) => event.data.startAt === Date.parse("2025-03-08T15:00:00Z")
    && event.data.endAt === Date.parse("2025-03-08T16:00:00Z"));
  assert.equal(exactInterval.length, 3, "missing title and another calendar do not collapse");
  assert.deepEqual(new Set(exactInterval.filter((event) => event.title !== "Busy").map((event) => (event.data as { calendarHref?: string }).calendarHref)), new Set([
    "https://calendar.example.test/cal/",
    "https://calendar.example.test/other/",
  ]));
  assert.doesNotMatch(readFileSync(cacheFile, "utf8"), /reuni|equipe|event-[a-d]|same-uid|cal\/|other\//i);
});

test("CalDAV rejects URL credentials and redacts secret resolver failures", async () => {
  const base = {
    secretRef: "CALDAV_OWNER",
    resolveSecret: async () => ({ kind: "bearer" as const, token: "token" }),
  };
  assert.throws(() => new CalDavReadOnlySource({ ...base, endpoint: "https://user:password@calendar.example.test/" }), /secret resolver/);
  assert.throws(() => new CalDavReadOnlySource({ ...base, endpoint: "https://calendar.example.test/?access_token=secret" }), /query parameters/);
  assert.throws(() => new CalDavReadOnlySource({
    ...base,
    endpoint: "https://calendar.example.test/",
    calendarHrefs: ["/calendar/?access_token=secret"],
  }), /query parameters/);
  const source = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/",
    secretRef: "CALDAV_OWNER",
    resolveSecret: async () => { throw new Error("leaked-secret-value"); },
  });
  await assert.rejects(() => source.query({ principalId: "owner", purpose: "calendar", startAt: 0, endAt: 1_000 }, runtime(fetch)), (error: Error) => {
    assert.equal(error.message, "CalDAV credential resolution failed");
    assert.doesNotMatch(error.message, /leaked-secret-value/);
    return true;
  });

  const oversized = new CalDavReadOnlySource({
    endpoint: "https://calendar.example.test/",
    secretRef: "CALDAV_OWNER",
    maxResponseBytes: 1_024,
    resolveSecret: async () => ({ kind: "bearer", token: "token" }),
  });
  const oversizedFetch: typeof fetch = async () => new Response("x".repeat(2_048), { status: 207 });
  await assert.rejects(() => oversized.query({ principalId: "owner", purpose: "calendar", startAt: 0, endAt: 1_000 }, runtime(oversizedFetch)), /response exceeds size limit/);
});
