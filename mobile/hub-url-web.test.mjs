// Contract for the mobile launcher's URL field: a wrong value must not silently fail into a blank
// WebView. Mirrors desktop/src/shared/hub-url.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHubUrlWeb as n } from "./hub-url-web.mjs";

test("strips path/query/trailing slash to the origin", () => {
  for (const v of ["https://jarvis.ts.net", "https://jarvis.ts.net/", "https://jarvis.ts.net/x?y=1"])
    assert.equal(n(v).url, "https://jarvis.ts.net");
});
test("missing scheme assumes https (the most common typo)", () => {
  assert.equal(n("jarvis.ts.net").url, "https://jarvis.ts.net");
  assert.equal(n("192.168.0.10:4577").url, "https://192.168.0.10:4577");
});
test("ws/wss (the runner address) is corrected to http/https for the window", () => {
  assert.equal(n("ws://jarvis.ts.net").url, "http://jarvis.ts.net");
  assert.equal(n("wss://jarvis.ts.net").url, "https://jarvis.ts.net");
});
test("keeps an explicit http (LAN/tailnet plain-text Hub)", () => {
  assert.equal(n("http://192.168.0.10:4577").url, "http://192.168.0.10:4577");
});
test("empty / malformed → a friendly error, never a blank redirect", () => {
  assert.ok(n("").error);
  assert.ok(n("   ").error);
  assert.ok(n("http://").error, "no host is an error");
});
