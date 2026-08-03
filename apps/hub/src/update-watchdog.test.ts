/** Update watchdog: only awaiting_restart + offline-past-window + not-yet-flagged is "stalled". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { updateStalled } from "./update-watchdog.js";

const STALL = 5 * 60_000;
const T0 = 1_000_000;

test("offline in awaiting_restart past the window is stalled", () => {
  assert.equal(updateStalled({ state: "awaiting_restart", awaitingSince: T0 }, { online: false, now: T0 + STALL + 1, stallMs: STALL }), true);
});

test("still inside the restart window is NOT stalled", () => {
  assert.equal(updateStalled({ state: "awaiting_restart", awaitingSince: T0 }, { online: false, now: T0 + STALL - 1, stallMs: STALL }), false);
});

test("an ONLINE machine is never stalled (self-heals via re-delivery)", () => {
  assert.equal(updateStalled({ state: "awaiting_restart", awaitingSince: T0 }, { online: true, now: T0 + STALL * 10, stallMs: STALL }), false);
});

test("already-flagged does not re-fire (alert exactly once)", () => {
  assert.equal(updateStalled({ state: "awaiting_restart", awaitingSince: T0, stalled: true }, { online: false, now: T0 + STALL * 10, stallMs: STALL }), false);
});

test("other states are never stalled by this check", () => {
  for (const state of ["queued", "sent", "blocked"] as const) {
    assert.equal(updateStalled({ state, awaitingSince: T0 }, { online: false, now: T0 + STALL * 10, stallMs: STALL }), false, state);
  }
});

test("falls back to lastAttemptAt / requestedAt when awaitingSince is absent", () => {
  assert.equal(updateStalled({ state: "awaiting_restart", lastAttemptAt: T0 }, { online: false, now: T0 + STALL + 1, stallMs: STALL }), true);
  assert.equal(updateStalled({ state: "awaiting_restart", requestedAt: T0 }, { online: false, now: T0 + STALL + 1, stallMs: STALL }), true);
});
