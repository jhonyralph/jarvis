import test from "node:test";
import assert from "node:assert/strict";
import ICAL from "ical.js";
import type { PersonalActionExecutor } from "./personal-actions.js";
import { actionRequiresConfirmation } from "./personal-actions.js";
import {
  CalDavActionError,
  createCalDavActionExecutors,
  type CalDavActionExecutorOptions,
} from "./caldav-actions.js";

const ENDPOINT = "https://calendar.example.test/dav/";
const CALENDAR = "https://calendar.example.test/calendars/alice/work/";
const SECRET_REF = "secret://calendar/alice";
const PASSWORD = "never-print-this-password";
const NOW = Date.parse("2026-08-01T10:00:00.000Z");
const START = Date.parse("2026-08-01T12:00:00.000Z");
const END = Date.parse("2026-08-01T13:30:00.000Z");

const OLD_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:event-1@example.test",
  "DTSTART:20260801T120000Z",
  "DTEND:20260801T130000Z",
  "SUMMARY:Old title",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const basePayload = () => ({
  calendarHref: CALENDAR,
  uid: "event-1@example.test",
  title: "Planejamento, revisão; café com a equipe e acompanhamento detalhado do trabalho",
  startAt: START,
  endAt: END,
  timeZone: "America/Sao_Paulo",
  location: "Sala 1, prédio A; térreo",
  description: "Linha 1\nLinha 2, com ponto; e barra \\",
  remindersMinutes: [30, 5],
});

function fixture(
  fetcher: typeof fetch,
  overrides: Partial<CalDavActionExecutorOptions> = {},
) {
  const secretCalls: Array<{ secretRef: string; principalId: string; sourceId: string }> = [];
  const options: CalDavActionExecutorOptions = {
    endpoint: ENDPOINT,
    calendars: [{ href: CALENDAR, label: "Trabalho" }],
    secretRef: SECRET_REF,
    sourceId: "caldav-work",
    fetch: fetcher,
    now: () => NOW,
    timeoutMs: 500,
    resolveSecret: async (secretRef, context) => {
      secretCalls.push({ secretRef, principalId: context.principalId, sourceId: context.sourceId });
      return { kind: "basic", username: "alice", password: PASSWORD };
    },
    ...overrides,
  };
  return { bundle: createCalDavActionExecutors(options), secretCalls };
}

function execute(
  executor: PersonalActionExecutor,
  payload: Record<string, unknown>,
  principalId = "alice",
  signal: AbortSignal = new AbortController().signal,
): Promise<Record<string, unknown>> {
  return executor.execute(payload, { principalId, signal });
}

function headers(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

function expectCalDavError(code: string, status?: number) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof CalDavActionError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    assert.doesNotMatch(error.message, /never-print|secret:\/\//i);
    return true;
  };
}

test("factory rejects unsafe endpoints, credentials in URLs, and cross-origin calendars", () => {
  const noFetch = (async () => { throw new Error("must not fetch"); }) as typeof fetch;
  const options = {
    calendars: [CALENDAR],
    secretRef: SECRET_REF,
    resolveSecret: async () => ({ kind: "bearer" as const, token: "x" }),
    fetch: noFetch,
  };
  assert.throws(() => createCalDavActionExecutors({ ...options, endpoint: "http://calendar.example.test/dav/" }), /HTTPS or loopback/);
  assert.throws(() => createCalDavActionExecutors({ ...options, endpoint: "https://alice:password@calendar.example.test/dav/" }), /credentials/);
  assert.throws(() => createCalDavActionExecutors({ ...options, endpoint: `${ENDPOINT}?token=secret` }), /query parameters/);
  assert.throws(() => createCalDavActionExecutors({ ...options, endpoint: ENDPOINT, calendars: ["https://evil.example.test/calendar/"] }), /configured origin/);
  assert.doesNotThrow(() => createCalDavActionExecutors({ ...options, endpoint: "http://127.0.0.1:5232/", calendars: ["/alice/work/"] }));
});

test("previews are complete, classify risks, and reject malformed or secret-bearing payloads before I/O", () => {
  let fetches = 0;
  const { bundle, secretCalls } = fixture((async () => { fetches++; throw new Error("must not fetch"); }) as typeof fetch);
  const preview = bundle.create.preview(basePayload());
  assert.equal(bundle.create.risk, "external_reversible");
  assert.equal(bundle.update.risk, "external_reversible");
  assert.equal(bundle.delete.risk, "consequential");
  assert.equal(actionRequiresConfirmation(bundle.delete.risk), true);
  assert.deepEqual(preview.calendar, { href: CALENDAR, label: "Trabalho" });
  assert.equal(preview.title, basePayload().title);
  assert.equal(preview.startAt, START);
  assert.equal(preview.endAt, END);
  assert.equal(preview.timeZone, "America/Sao_Paulo");
  assert.equal(preview.location, basePayload().location);
  assert.deepEqual(preview.remindersMinutes, [5, 30]);
  assert.match(String(preview.eventHref), /^https:\/\/calendar\.example\.test\/calendars\/alice\/work\/jarvis-[a-f0-9]{40}\.ics$/);

  assert.throws(() => bundle.create.preview({ ...basePayload(), token: "secret" }), /unsupported fields/);
  assert.throws(() => bundle.create.preview({ ...basePayload(), eventHref: `${CALENDAR}custom.ics` }), /unsupported fields/);
  assert.throws(() => bundle.create.preview({ ...basePayload(), endAt: START }), /range/);
  assert.throws(() => bundle.create.preview({ ...basePayload(), timeZone: "Mars/Olympus" }), /not supported/);
  assert.throws(() => bundle.create.preview({ ...basePayload(), remindersMinutes: [5, 5] }), /duplicate/);
  assert.throws(() => bundle.update.preview({ ...basePayload() }), /strong quoted ETag/);
  assert.throws(() => bundle.update.preview({ ...basePayload(), expectedEtag: "*" }), /strong quoted ETag/);
  assert.throws(() => bundle.update.preview({ ...basePayload(), expectedEtag: '"v1"injected"' }), /strong quoted ETag/);
  assert.equal(fetches, 0);
  assert.equal(secretCalls.length, 0);
});

test("create derives the same semantic UID when equivalent events arrive without source-specific ids", () => {
  const { bundle } = fixture((async () => { throw new Error("must not fetch"); }) as typeof fetch);
  const { uid: _uid, ...withoutUid } = basePayload();
  const first = bundle.create.preview(withoutUid);
  const equivalent = bundle.create.preview({ ...withoutUid, title: `  ${withoutUid.title.toUpperCase()}  ` });
  const differentTime = bundle.create.preview({ ...withoutUid, startAt: START + 60_000, endAt: END + 60_000 });

  assert.match(String(first.uid), /^jarvis-semantic-[a-f0-9]{64}@local$/);
  assert.equal(equivalent.uid, first.uid);
  assert.equal(equivalent.eventHref, first.eventHref);
  assert.notEqual(differentTime.uid, first.uid);
});

test("create uses deterministic If-None-Match, resolves only secretRef, and emits folded escaped ICS", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const { bundle, secretCalls } = fixture((async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(null, { status: 201, headers: { ETag: '"created-v1"' } });
  }) as typeof fetch);

  const result = await execute(bundle.create, basePayload());
  assert.match(requestUrl, /\/work\/jarvis-[a-f0-9]{40}\.ics$/);
  assert.equal(requestInit?.method, "PUT");
  assert.equal(requestInit?.redirect, "manual");
  assert.equal(headers(requestInit).get("if-none-match"), "*");
  assert.equal(headers(requestInit).get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(headers(requestInit).get("authorization"), `Basic ${Buffer.from(`alice:${PASSWORD}`).toString("base64")}`);
  assert.deepEqual(secretCalls, [{ secretRef: SECRET_REF, principalId: "alice", sourceId: "caldav-work" }]);

  const ics = String(requestInit?.body);
  const unfolded = ics.replaceAll("\r\n ", "");
  assert.match(unfolded, /DTSTART:20260801T120000Z/);
  assert.match(unfolded, /DTEND:20260801T133000Z/);
  assert.match(unfolded, /X-WR-TIMEZONE:America\/Sao_Paulo/);
  assert.match(unfolded, /X-JARVIS-TIMEZONE:America\/Sao_Paulo/);
  assert.match(unfolded, /SUMMARY:Planejamento\\, revisão\\; café/);
  assert.match(unfolded, /LOCATION:Sala 1\\, prédio A\\; térreo/);
  assert.match(unfolded, /DESCRIPTION:Linha 1\\nLinha 2\\, com ponto\\; e barra \\\\/);
  assert.match(unfolded, /TRIGGER:-PT5M/);
  assert.match(unfolded, /TRIGGER:-PT30M/);
  assert.doesNotMatch(ics, /never-print|secret:\/\//i);
  assert.doesNotMatch(ics, /(?<!\r)\n/);
  for (const line of ics.split("\r\n").filter(Boolean)) assert.ok(Buffer.byteLength(line, "utf8") <= 75, `overlong ICS line: ${line}`);
  const parsedCalendar = new ICAL.Component(ICAL.parse(ics));
  const parsedEvent = parsedCalendar.getFirstSubcomponent("vevent")!;
  assert.equal(parsedEvent.getFirstPropertyValue("uid"), basePayload().uid);
  assert.equal(parsedEvent.getFirstPropertyValue("summary"), basePayload().title);
  assert.equal(parsedEvent.getAllSubcomponents("valarm").length, 2);

  assert.equal(result.operation, "create");
  assert.equal(result.etag, '"created-v1"');
  assert.equal((result.undo as Record<string, unknown>).available, true);
  assert.equal((result.undo as Record<string, unknown>).durable, false);
  const publicJson = JSON.stringify(result);
  assert.doesNotMatch(publicJson, /BEGIN:VCALENDAR|never-print|secret:\/\//i);
});

test("create exposes a deterministic duplicate error for 412 and does not mask the server status", async () => {
  const { bundle } = fixture((async () => new Response("server body contains private data", { status: 412 })) as typeof fetch);
  await assert.rejects(() => execute(bundle.create, basePayload()), expectCalDavError("CALDAV_DUPLICATE", 412));
});

test("create does not misreport a generic 409 collection conflict as a duplicate", async () => {
  const { bundle } = fixture((async () => new Response(null, { status: 409 })) as typeof fetch);
  await assert.rejects(() => execute(bundle.create, basePayload()), expectCalDavError("CALDAV_HTTP_ERROR", 409));
});

test("manual redirect responses are rejected without following their target", async () => {
  let calls = 0;
  const { bundle } = fixture((async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: "https://evil.example.test/capture" } });
  }) as typeof fetch);
  await assert.rejects(() => execute(bundle.create, basePayload()), expectCalDavError("CALDAV_REDIRECT_BLOCKED", 302));
  assert.equal(calls, 1);
});

test("update captures private prior state, enforces If-Match, and can undo only for the same principal", async () => {
  const requests: Array<{ method: string; headers: Headers; body?: string }> = [];
  const responses = [
    new Response(OLD_ICS, { status: 200, headers: { ETag: '"v1"' } }),
    new Response(null, { status: 204, headers: { ETag: '"v2"' } }),
    new Response(null, { status: 204, headers: { ETag: '"v3"' } }),
  ];
  const { bundle } = fixture((async (_input, init) => {
    requests.push({ method: String(init?.method), headers: headers(init), ...(init?.body ? { body: String(init.body) } : {}) });
    return responses.shift()!;
  }) as typeof fetch);
  const payload = { ...basePayload(), eventHref: `${CALENDAR}custom-event.ics`, expectedEtag: '"v1"', title: "New title" };
  const result = await execute(bundle.update, payload);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].headers.get("if-match"), '"v1"');
  assert.equal(requests[1].method, "PUT");
  assert.equal(requests[1].headers.get("if-match"), '"v1"');
  assert.match(requests[1].body!, /SUMMARY:New title/);
  assert.doesNotMatch(JSON.stringify(result), /Old title|BEGIN:VCALENDAR/);
  const token = String((result.undo as Record<string, unknown>).token);

  await assert.rejects(() => execute(bundle.undo, { undoToken: token }, "bob"), expectCalDavError("CALDAV_UNDO_UNAVAILABLE"));
  const undone = await execute(bundle.undo, { undoToken: token }, "alice");
  assert.equal(requests[2].method, "PUT");
  assert.equal(requests[2].headers.get("if-match"), '"v2"');
  assert.equal(requests[2].body, OLD_ICS);
  assert.equal(undone.restoredOperation, "update");
  assert.doesNotMatch(JSON.stringify(undone), /Old title|BEGIN:VCALENDAR/);
  await assert.rejects(() => execute(bundle.undo, { undoToken: token }), expectCalDavError("CALDAV_UNDO_UNAVAILABLE"));
});

test("update preserves 412 as a concurrent-preview failure", async () => {
  let call = 0;
  const { bundle } = fixture((async () => {
    call++;
    return call === 1
      ? new Response(OLD_ICS, { status: 200, headers: { ETag: '"v1"' } })
      : new Response("changed concurrently", { status: 412 });
  }) as typeof fetch);
  await assert.rejects(
    () => execute(bundle.update, { ...basePayload(), expectedEtag: '"v1"' }),
    expectCalDavError("CALDAV_PRECONDITION_FAILED", 412),
  );
  assert.equal(call, 2);
});

test("update rejects a captured resource whose UID differs from the approved preview", async () => {
  let calls = 0;
  const mismatched = OLD_ICS.replace("event-1@example.test", "other-event@example.test");
  const { bundle } = fixture((async () => {
    calls++;
    return new Response(mismatched, { status: 200, headers: { ETag: '"v1"' } });
  }) as typeof fetch);
  await assert.rejects(
    () => execute(bundle.update, { ...basePayload(), expectedEtag: '"v1"' }),
    expectCalDavError("CALDAV_INVALID_RESPONSE"),
  );
  assert.equal(calls, 1);
});

test("an abort during capture prevents the following mutating request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const { bundle } = fixture((async () => {
    calls++;
    const stream = new ReadableStream<Uint8Array>({
      start(body) {
        body.enqueue(new TextEncoder().encode(OLD_ICS));
        body.close();
        queueMicrotask(() => controller.abort(new Error("cancel after capture")));
      },
    });
    return new Response(stream, { status: 200, headers: { ETag: '"v1"' } });
  }) as typeof fetch);
  await assert.rejects(
    () => execute(bundle.update, { ...basePayload(), expectedEtag: '"v1"' }, "alice", controller.signal),
    expectCalDavError("CALDAV_ABORTED"),
  );
  assert.equal(calls, 1);
});

test("delete is consequential, captures privately, deletes conditionally, and restores with If-None-Match", async () => {
  const requests: Array<{ method: string; headers: Headers; body?: string }> = [];
  const responses = [
    new Response(OLD_ICS, { status: 200, headers: { ETag: '"v1"' } }),
    new Response(null, { status: 204 }),
    new Response(null, { status: 201, headers: { ETag: '"restored"' } }),
  ];
  const { bundle } = fixture((async (_input, init) => {
    requests.push({ method: String(init?.method), headers: headers(init), ...(init?.body ? { body: String(init.body) } : {}) });
    return responses.shift()!;
  }) as typeof fetch);
  const payload = { ...basePayload(), expectedEtag: '"v1"' };
  const preview = bundle.delete.preview(payload);
  assert.equal(preview.consequence, "calendar_event_will_be_deleted");
  assert.equal(preview.title, basePayload().title);
  assert.equal(preview.timeZone, "America/Sao_Paulo");
  assert.deepEqual(preview.remindersMinutes, [5, 30]);

  const result = await execute(bundle.delete, payload);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[1].method, "DELETE");
  assert.equal(requests[1].headers.get("if-match"), '"v1"');
  assert.doesNotMatch(JSON.stringify(result), /Old title|BEGIN:VCALENDAR/);
  const token = String((result.undo as Record<string, unknown>).token);
  const restored = await execute(bundle.undo, { undoToken: token });
  assert.equal(requests[2].method, "PUT");
  assert.equal(requests[2].headers.get("if-none-match"), "*");
  assert.equal(requests[2].body, OLD_ICS);
  assert.equal(restored.restoredOperation, "delete");
});

test("payload event URLs cannot escape, nest under, or switch away from the configured calendar", () => {
  let fetches = 0;
  const { bundle, secretCalls } = fixture((async () => { fetches++; throw new Error("must not fetch"); }) as typeof fetch);
  const common = { ...basePayload(), expectedEtag: '"v1"' };
  const invalid = [
    "https://evil.example.test/calendars/alice/work/event.ics",
    "https://calendar.example.test/calendars/alice/work/../private.ics",
    "https://calendar.example.test/calendars/alice/work/%2e%2e%2fprivate.ics",
    "https://calendar.example.test/calendars/alice/work/%252e%252e%252fprivate.ics",
    "https://calendar.example.test/calendars/alice/work/nested/event.ics",
    "https://calendar.example.test/calendars/alice/work/event.ics?token=secret",
  ];
  for (const eventHref of invalid) assert.throws(() => bundle.update.preview({ ...common, eventHref }), /CalDAV/);
  assert.throws(() => bundle.update.preview({ ...common, calendarHref: "https://calendar.example.test/calendars/alice/private/" }), /explicitly configured/);
  assert.equal(fetches, 0);
  assert.equal(secretCalls.length, 0);
});

test("oversized captured responses fail before mutation and never enter a public error", async () => {
  let calls = 0;
  const largePrivateIcs = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n${"X".repeat(2_000)}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const { bundle } = fixture((async () => {
    calls++;
    return new Response(largePrivateIcs, { status: 200, headers: { ETag: '"v1"' } });
  }) as typeof fetch, { maxResponseBytes: 1_024 });
  await assert.rejects(
    () => execute(bundle.update, { ...basePayload(), expectedEtag: '"v1"' }),
    expectCalDavError("CALDAV_RESPONSE_TOO_LARGE"),
  );
  assert.equal(calls, 1);
});

test("capture larger than the restore request limit never advertises undo", async () => {
  let calls = 0;
  const largeButReadable = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-1@example.test\r\nDESCRIPTION:${"X".repeat(1_300)}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const { bundle } = fixture((async () => {
    calls++;
    return calls === 1
      ? new Response(largeButReadable, { status: 200, headers: { ETag: '"v1"' } })
      : new Response(null, { status: 204, headers: { ETag: '"v2"' } });
  }) as typeof fetch, { maxRequestBytes: 1_024, maxResponseBytes: 2_048 });
  const result = await execute(bundle.update, { ...basePayload(), expectedEtag: '"v1"' });
  assert.deepEqual(result.undo, {
    available: false,
    durable: false,
    reason: "captured_event_exceeds_restore_limit",
  });
  assert.equal(calls, 2);
});

test("oversized serialized requests fail before resolving a secret or reaching the network", async () => {
  let fetches = 0;
  const { bundle, secretCalls } = fixture((async () => {
    fetches++;
    return new Response(null, { status: 201 });
  }) as typeof fetch, { maxRequestBytes: 1_024 });
  await assert.rejects(
    () => execute(bundle.create, { ...basePayload(), description: "X".repeat(2_000) }),
    /request size limit/,
  );
  assert.equal(fetches, 0);
  assert.equal(secretCalls.length, 0);
});

test("timeout and caller cancellation abort work with distinct sanitized errors", async () => {
  const neverFetch = (async () => { throw new Error("must not fetch"); }) as typeof fetch;
  const timeoutBundle = createCalDavActionExecutors({
    endpoint: ENDPOINT,
    calendars: [CALENDAR],
    secretRef: SECRET_REF,
    fetch: neverFetch,
    timeoutMs: 100,
    resolveSecret: async (_ref, context) => new Promise((_, reject) => {
      context.signal.addEventListener("abort", () => reject(new Error(`leaked ${PASSWORD}`)), { once: true });
    }),
  });
  await assert.rejects(() => execute(timeoutBundle.create, basePayload()), expectCalDavError("CALDAV_TIMEOUT"));

  const cancelledBundle = createCalDavActionExecutors({
    endpoint: ENDPOINT,
    calendars: [CALENDAR],
    secretRef: SECRET_REF,
    timeoutMs: 2_000,
    resolveSecret: async () => ({ kind: "bearer", token: "private-token" }),
    fetch: ((_, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("private-token")), { once: true });
    })) as typeof fetch,
  });
  const controller = new AbortController();
  const running = execute(cancelledBundle.create, basePayload(), "alice", controller.signal);
  setImmediate(() => controller.abort(new Error("user cancelled")));
  await assert.rejects(() => running, expectCalDavError("CALDAV_ABORTED"));
});

test("secret resolver failures and malformed credentials are sanitized and stop before fetch", async () => {
  let fetches = 0;
  const fetcher = (async () => { fetches++; return new Response(null, { status: 201 }); }) as typeof fetch;
  const leaking = createCalDavActionExecutors({
    endpoint: ENDPOINT,
    calendars: [CALENDAR],
    secretRef: SECRET_REF,
    fetch: fetcher,
    resolveSecret: async () => { throw new Error(`provider leaked ${PASSWORD}`); },
  });
  await assert.rejects(() => execute(leaking.create, basePayload()), expectCalDavError("CALDAV_SECRET_RESOLUTION_FAILED"));

  const malformed = createCalDavActionExecutors({
    endpoint: ENDPOINT,
    calendars: [CALENDAR],
    secretRef: SECRET_REF,
    fetch: fetcher,
    resolveSecret: async () => ({ kind: "bearer", token: "bad\r\nInjected: true" }),
  });
  await assert.rejects(() => execute(malformed.create, basePayload()), expectCalDavError("CALDAV_SECRET_RESOLUTION_FAILED"));
  assert.equal(fetches, 0);
});

test("unsupported safe capture is reported honestly instead of promising durable undo", async () => {
  let calls = 0;
  const { bundle } = fixture((async () => {
    calls++;
    return calls === 1
      ? new Response(null, { status: 405 })
      : new Response(null, { status: 204, headers: { ETag: '"v2"' } });
  }) as typeof fetch);
  const result = await execute(bundle.update, { ...basePayload(), expectedEtag: '"v1"' });
  assert.deepEqual(result.undo, {
    available: false,
    durable: false,
    reason: "server_does_not_support_safe_capture",
  });
  assert.equal(calls, 2);
});
