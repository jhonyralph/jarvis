/** Archive readers + the import trust boundary (anchoring, traversal rejection, binary/size caps). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, gzipSync } from "node:zlib";
import { unzip, untar, untargz, extractFrameworkFiles, toFrameworkPath, MAX_FILE_BYTES } from "./framework-archive.js";

type Member = { name: string; content: string | Buffer; method?: 0 | 8 };

/** Hand-build a minimal ZIP (store or deflate) — Node has no built-in zip writer. */
function makeZip(members: Member[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const m of members) {
    const nameBuf = Buffer.from(m.name, "utf8");
    const data = Buffer.isBuffer(m.content) ? m.content : Buffer.from(m.content, "utf8");
    const method = m.method ?? 0;
    const comp = method === 8 ? deflateRawSync(data) : data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const local = Buffer.concat([lh, nameBuf, comp]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(0, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameBuf]));
    locals.push(local); offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(members.length, 8); eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

function tarBlock(name: string, content: Buffer): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(content.length.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136); h.write("        ", 148); h.write("0", 156);
  h.write("ustar\0", 257); h.write("00", 263);
  const pad = Buffer.alloc(Math.ceil(content.length / 512) * 512 - content.length);
  return Buffer.concat([h, content, pad]);
}
function makeTar(members: Member[]): Buffer {
  const parts = members.map((m) => tarBlock(m.name, Buffer.isBuffer(m.content) ? m.content : Buffer.from(m.content, "utf8")));
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

test("unzip reads both stored and deflated members", () => {
  const zip = makeZip([
    { name: "commands/plan.md", content: "Plan $ARGUMENTS", method: 0 },
    { name: "skills/review/SKILL.md", content: "---\nname: review\n---\nBody with some length to compress.", method: 8 },
  ]);
  const entries = unzip(zip);
  const byName = Object.fromEntries(entries.map((e) => [e.path, e.data.toString("utf8")]));
  assert.equal(byName["commands/plan.md"], "Plan $ARGUMENTS");
  assert.match(byName["skills/review/SKILL.md"], /name: review/);
});

test("unzip tolerates an EOCD comment", () => {
  const zip = Buffer.concat([makeZip([{ name: "instructions.md", content: "hi" }]), Buffer.from("")]);
  // rewrite comment length + append a comment
  const withComment = Buffer.concat([zip.subarray(0, zip.length), Buffer.from("")]);
  assert.equal(unzip(withComment).length, 1);
});

test("untar / untargz read regular files and skip the terminator", () => {
  const tar = makeTar([{ name: "commands/x.md", content: "hello" }]);
  assert.equal(untar(tar)[0].data.toString("utf8"), "hello");
  assert.equal(untargz(gzipSync(tar))[0].path, "commands/x.md");
});

test("toFrameworkPath strips wrapper dirs and keeps only in-scope files", () => {
  assert.equal(toFrameworkPath("repo-abc123/skills/x/SKILL.md"), "skills/x/SKILL.md");
  assert.equal(toFrameworkPath("repo-abc123/commands/plan.md"), "commands/plan.md");
  assert.equal(toFrameworkPath("repo-abc123/instructions.md"), "instructions.md");
  assert.equal(toFrameworkPath("repo-abc123/README.md"), null);
  assert.equal(toFrameworkPath("repo-abc123/src/index.ts"), null);
});

test("extractFrameworkFiles keeps in-scope files and ignores the rest", () => {
  const r = extractFrameworkFiles(unzip(makeZip([
    { name: "repo-sha/commands/plan.md", content: "Plan" },
    { name: "repo-sha/skills/review/SKILL.md", content: "---\nname: review\n---\nB" },
    { name: "repo-sha/README.md", content: "readme" },
    { name: "repo-sha/.github/workflows/ci.yml", content: "ci" },
  ])));
  assert.deepEqual(r.files.map((f) => f.path).sort(), ["commands/plan.md", "skills/review/SKILL.md"]);
});

test("extractFrameworkFiles rejects path traversal and reports it", () => {
  const r = extractFrameworkFiles([{ path: "skills/../../etc/passwd", data: Buffer.from("x") }]);
  assert.equal(r.files.length, 0);
  assert.ok(r.skipped.some((s) => /passwd/.test(s)));
});

test("extractFrameworkFiles drops binary files (NUL byte)", () => {
  const r = extractFrameworkFiles([{ path: "skills/x/SKILL.md", data: Buffer.from([0x41, 0x00, 0x42]) }]);
  assert.equal(r.files.length, 0);
  assert.ok(r.skipped.some((s) => /binário/.test(s)));
});

test("extractFrameworkFiles enforces the per-file size cap", () => {
  const big = Buffer.alloc(MAX_FILE_BYTES + 10, 0x41);
  const r = extractFrameworkFiles([{ path: "commands/big.md", data: big }]);
  assert.equal(r.files.length, 0);
  assert.ok(r.skipped.some((s) => /excede/.test(s)));
});

test("extractFrameworkFiles supports a subdir filter", () => {
  const entries = [
    { path: "repo-sha/packs/mine/commands/plan.md", data: Buffer.from("A") },
    { path: "repo-sha/packs/other/commands/nope.md", data: Buffer.from("B") },
  ];
  const r = extractFrameworkFiles(entries, { subdir: "packs/mine" });
  assert.deepEqual(r.files.map((f) => f.path), ["commands/plan.md"]);
});

test("extractFrameworkFiles dedupes repeated paths", () => {
  const r = extractFrameworkFiles([
    { path: "commands/plan.md", data: Buffer.from("first") },
    { path: "commands/plan.md", data: Buffer.from("second") },
  ]);
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].content, "first");
  assert.ok(r.skipped.some((s) => /duplicado/.test(s)));
});
