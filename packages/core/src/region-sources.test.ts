import test from "node:test";
import assert from "node:assert/strict";
import { REGION_EVENT_SOURCES, matchRegionEventSource } from "./region-sources.js";

test("matches a known city entry case-insensitively via city/town/municipality", () => {
  const entry = REGION_EVENT_SOURCES.find((row) => row.id === "region:mapas-culturais-bh")!;
  assert.equal(matchRegionEventSource({ countryCode: "BR", city: "Belo Horizonte" })?.id, entry.id);
  assert.equal(matchRegionEventSource({ countryCode: "br", town: "belo horizonte" })?.id, entry.id);
  assert.equal(matchRegionEventSource({ countryCode: "BR", municipality: "BELO HORIZONTE" })?.id, entry.id);
});

test("does not match a different city in the same country, a different country, or a missing country", () => {
  assert.equal(matchRegionEventSource({ countryCode: "BR", city: "São Paulo" }), undefined);
  assert.equal(matchRegionEventSource({ countryCode: "PT", city: "Belo Horizonte" }), undefined);
  assert.equal(matchRegionEventSource({ city: "Belo Horizonte" }), undefined);
  assert.equal(matchRegionEventSource({}), undefined);
});

test("every registry entry has a real endpoint, timezone and non-empty attribution", () => {
  for (const entry of REGION_EVENT_SOURCES) {
    assert.match(entry.endpoint, /^https:\/\//);
    assert.match(entry.countryCode, /^[a-z]{2}$/);
    assert.ok(entry.timeZone.length > 0);
    assert.ok(entry.attribution.length > 0);
  }
});
