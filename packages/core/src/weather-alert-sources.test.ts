import test from "node:test";
import assert from "node:assert/strict";
import { createCapWeatherAlertSource } from "./weather-alert-sources.js";

const now = Date.parse("2026-08-01T12:00:00Z");
const cap = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>alert-123</identifier><sender>alerts@example.gov</sender><sent>2026-08-01T11:55:00Z</sent>
  <status>Actual</status><msgType>Alert</msgType><scope>Public</scope>
  <info><language>pt-BR</language><category>Met</category><event>Chuva intensa</event><urgency>Immediate</urgency><severity>Severe</severity><certainty>Likely</certainty>
    <effective>2026-08-01T11:55:00Z</effective><onset>2026-08-01T12:10:00Z</onset><expires>2026-08-01T15:00:00Z</expires>
    <senderName>Autoridade meteorológica</senderName><headline>Alerta de chuva intensa</headline><description>Risco de alagamentos.</description><instruction>Evite áreas inundadas.</instruction>
    <web>https://alerts.example.gov/123</web><area><areaDesc>Belo Horizonte</areaDesc><circle>-19.92,-43.94 50</circle></area>
  </info>
</alert>`;

function source() {
  return createCapWeatherAlertSource({ url: "https://alerts.example.gov/cap.xml", sourceId: "official-weather", label: "Alertas oficiais", attribution: "Autoridade meteorológica", authority: "alerts@example.gov", certification: "audited" });
}

function runtime(body = cap) {
  return { now: () => now, signal: new AbortController().signal, fetch: async () => new Response(body, { status: 200, headers: { "content-type": "application/cap+xml" } }) };
}

test("CAP adapter preserves official facts, area, provenance and a bounded geometry", async () => {
  const rows = await source().query({ principalId: "alice", purpose: "weather", point: { lat: -19.92, lng: -43.94 }, locale: "pt-BR", filters: { region: "Belo Horizonte" } }, runtime());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "weather_alert");
  assert.equal(rows[0].data.officialAlert, true);
  assert.equal(rows[0].data.severity, "Severe");
  assert.equal(rows[0].data.authority, "alerts@example.gov");
  assert.deepEqual(rows[0].point, { lat: -19.92, lng: -43.94 });
  assert.deepEqual(rows[0].sources[0], { sourceId: "official-weather", recordId: "alert-123", observedAt: Date.parse("2026-08-01T11:55:00Z"), freshness: "live", attribution: "Autoridade meteorológica", url: "https://alerts.example.gov/123" });
});

test("CAP adapter excludes expired, non-public, test and geographically unrelated alerts", async () => {
  const expired = cap.replace("2026-08-01T15:00:00Z", "2026-08-01T11:59:00Z");
  assert.equal((await source().query({ principalId: "alice", purpose: "weather" }, runtime(expired))).length, 0);
  assert.equal((await source().query({ principalId: "alice", purpose: "weather" }, runtime(cap.replace("<status>Actual</status>", "<status>Test</status>")))).length, 0);
  assert.equal((await source().query({ principalId: "alice", purpose: "weather", point: { lat: 40, lng: -70 } }, runtime())).length, 0);
});

test("CAP adapter rejects XML entities, untrusted authority profiles and oversized responses", async () => {
  await assert.rejects(() => source().query({ principalId: "alice", purpose: "weather" }, runtime(`<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]>${cap}`)), /declarations/);
  assert.throws(() => createCapWeatherAlertSource({ url: "https://alerts.example/cap", sourceId: "x", label: "x", attribution: "x", authority: "x", certification: "uncertified" as never }), /authority profile/);
  const tiny = createCapWeatherAlertSource({ url: "https://alerts.example/cap", sourceId: "x", label: "x", attribution: "x", authority: "x", certification: "audited", maxResponseBytes: 1_024 });
  await assert.rejects(() => tiny.query({ principalId: "alice", purpose: "weather" }, runtime("x".repeat(1_025))), /size limit/);
});
