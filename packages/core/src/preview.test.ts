import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSs,
  parseLsof,
  parseNetstat,
  parseAdvertisedUrls,
  rankEntries,
  isPathUnder,
  detectPreviewCandidates,
  KNOWN_DEV_PORTS,
  type DetectDeps,
} from "./preview.js";

test("parseSs extracts port + pid from ss -ltnpH", () => {
  const out = [
    "LISTEN 0      511    127.0.0.1:5173      0.0.0.0:*    users:((\"node\",pid=1234,fd=20))",
    "LISTEN 0      4096   0.0.0.0:22          0.0.0.0:*    users:((\"sshd\",pid=700,fd=3))",
  ].join("\n");
  assert.deepEqual(parseSs(out), [
    { port: 5173, pid: 1234 },
    { port: 22, pid: 700 },
  ]);
});

test("parseSs drops a header row and malformed lines", () => {
  const out = "State  Recv-Q Send-Q Local Address:Port\ngarbage line\nLISTEN 0 511 [::1]:3000 [::]:* users:((\"node\",pid=9,fd=1))";
  assert.deepEqual(parseSs(out), [{ port: 3000, pid: 9 }]);
});

test("parseLsof reads listening sockets", () => {
  const out = [
    "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
    "node     4242 me     23u  IPv4  0t0      TCP 127.0.0.1:5174 (LISTEN)",
    "node     4242 me     24u  IPv6  0t0      TCP [::1]:5174 (LISTEN)",
  ].join("\n");
  assert.deepEqual(parseLsof(out), [{ port: 5174, pid: 4242 }]);
});

test("parseNetstat reads Windows LISTENING rows with trailing pid", () => {
  const out = [
    "Active Connections",
    "  Proto  Local Address    Foreign Address   State       PID",
    "  TCP    127.0.0.1:5173   0.0.0.0:0         LISTENING   1234",
    "  TCP    0.0.0.0:135      0.0.0.0:0         LISTENING   900",
    "  TCP    127.0.0.1:5500   127.0.0.1:9       ESTABLISHED 42",
  ].join("\r\n");
  assert.deepEqual(parseNetstat(out), [
    { port: 5173, pid: 1234 },
    { port: 135, pid: 900 },
  ]);
});

test("parseAdvertisedUrls finds localhost dev URLs and strips trailing slash", () => {
  const text = "  VITE ready\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://127.0.0.1:5173/\n";
  const urls = parseAdvertisedUrls(text);
  assert.ok(urls.includes("http://localhost:5173"));
  assert.ok(urls.includes("http://127.0.0.1:5173"));
});

test("rankEntries puts known dev ports first, then ascending", () => {
  const ranked = rankEntries([
    { port: 22, pid: 1 },
    { port: 8080, pid: 2 },
    { port: 5173, pid: 3 },
  ]);
  assert.deepEqual(ranked.map((e) => e.port), [5173, 8080, 22]);
  assert.ok(KNOWN_DEV_PORTS.has(5173));
});

test("isPathUnder is separator-agnostic and rejects siblings", () => {
  assert.ok(isPathUnder("/home/me/app/src", "/home/me/app"));
  assert.ok(isPathUnder("C:\\Users\\me\\app", "C:/Users/me/app")); // same path, mixed separators
  assert.ok(!isPathUnder("/home/me/app-two", "/home/me/app")); // sibling prefix must not match
  assert.ok(!isPathUnder("/home/me", ""));
});

test("detectPreviewCandidates keeps cwd-owned and known-dev-port entries, drops unrelated", async () => {
  const cwd = "/home/me/app";
  const exec: DetectDeps["exec"] = async (cmd, args) => {
    if (cmd === "ss") {
      return [
        "LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:((\"node\",pid=100,fd=20))", // owned by cwd → keep
        "LISTEN 0 511 127.0.0.1:6000 0.0.0.0:* users:((\"other\",pid=200,fd=20))", // unrelated cwd, non-dev port → drop
        "LISTEN 0 511 127.0.0.1:8080 0.0.0.0:* users:((\"x\",pid=300,fd=20))", // unknown owner but dev port → keep
      ].join("\n");
    }
    if (cmd === "readlink") {
      if (args[0] === "/proc/100/cwd") return "/home/me/app/packages/web\n";
      if (args[0] === "/proc/200/cwd") return "/tmp/unrelated\n";
      if (args[0] === "/proc/300/cwd") return ""; // unknown
    }
    return "";
  };
  const candidates = await detectPreviewCandidates(cwd, { platform: "linux", exec, now: () => 42 });
  assert.deepEqual(
    candidates.map((c) => c.port),
    [5173, 8080],
  );
  assert.equal(candidates[0]?.url, "http://127.0.0.1:5173");
  assert.equal(candidates[0]?.source, "port-scan");
  assert.equal(candidates[0]?.detectedAt, 42);
});

test("detectPreviewCandidates returns [] when scanning fails", async () => {
  const candidates = await detectPreviewCandidates("/x", {
    platform: "linux",
    exec: async () => { throw new Error("boom"); },
    now: () => 1,
  });
  assert.deepEqual(candidates, []);
});
