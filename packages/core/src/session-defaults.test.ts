import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSessionDefaults, isWithin } from "./session-defaults.js";

test("session defaults merge global then every matching project root, deep overriding shallow", () => {
  const doc = {
    global: { agent: "claude-code", permissionMode: "bypass" as const, effort: "high" },
    projects: [
      { projectRoot: "/home/u/work", model: "sonnet" },
      { projectRoot: "/home/u/work/jarvis", permissionMode: "plan" as const },
    ],
  };
  // deep cwd matches both roots: model falls through from the shallow one, plan wins from the deep one
  assert.deepEqual(resolveSessionDefaults(doc, "/home/u/work/jarvis/packages"), { agent: "claude-code", effort: "high", model: "sonnet", permissionMode: "plan" });
  // a sibling under the shallow root only: keeps global permission
  assert.deepEqual(resolveSessionDefaults(doc, "/home/u/work/other"), { agent: "claude-code", effort: "high", model: "sonnet", permissionMode: "bypass" });
  // unrelated cwd → global only
  assert.deepEqual(resolveSessionDefaults(doc, "/tmp/x"), { agent: "claude-code", effort: "high", permissionMode: "bypass" });
  assert.deepEqual(resolveSessionDefaults(undefined, "/tmp/x"), {});
});

test("isWithin is path-segment aware and slash-agnostic", () => {
  assert.ok(isWithin("/a/b/c", "/a/b"));
  assert.ok(isWithin("C:\\a\\b", "C:/a"));
  assert.ok(isWithin("/a/b", "/a/b"));
  assert.ok(!isWithin("/a/bc", "/a/b"), "a sibling sharing a string prefix must not match");
  assert.ok(!isWithin("/a", "/a/b"));
});
