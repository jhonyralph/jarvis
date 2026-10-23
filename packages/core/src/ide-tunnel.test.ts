import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import {
  IDE_TUNNEL_KIND, TunnelMux, TunnelOp, bridgeTunnelStream, compressibleResponse, decodeTunnelFrame, encodeTunnelFrame,
  isTunnelFrame, parseOpenHead, parseResponseHead, serializeRequestHead, type TunnelStream,
} from "./ide-tunnel.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Par opener (Hub) ↔ acceptor (runner) ligado por uma "rede" assíncrona em memória, com contadores. */
function pair(opts: { window?: number; chunk?: number; maxStreams?: number; headTimeoutMs?: number; idleMs?: number; onStream?: (s: TunnelStream) => void; backlog?: () => number } = {}) {
  const wire = { toAcceptor: [] as Buffer[], toOpener: [] as Buffer[], dataToOpener: 0, dataToAcceptor: 0, windowsToAcceptor: 0, resets: [] as string[] };
  let acceptor!: TunnelMux;
  const opener = new TunnelMux({
    role: "opener", window: opts.window, chunk: opts.chunk, maxStreams: opts.maxStreams, headTimeoutMs: opts.headTimeoutMs, idleMs: opts.idleMs,
    send: (f) => { const d = decodeTunnelFrame(f)!; if (d.op === TunnelOp.DATA) wire.dataToAcceptor += d.payload.length; if (d.op === TunnelOp.WINDOW) wire.windowsToAcceptor++; if (d.op === TunnelOp.RESET) wire.resets.push("o:" + d.payload.toString()); setImmediate(() => acceptor.onFrame(f)); },
  });
  acceptor = new TunnelMux({
    role: "acceptor", window: opts.window, chunk: opts.chunk, maxStreams: opts.maxStreams, idleMs: opts.idleMs, backlog: opts.backlog,
    send: (f) => { const d = decodeTunnelFrame(f)!; if (d.op === TunnelOp.DATA) wire.dataToOpener += d.payload.length; if (d.op === TunnelOp.RESET) wire.resets.push("a:" + d.payload.toString()); setImmediate(() => opener.onFrame(f)); },
    onStream: (s) => opts.onStream?.(s),
  });
  return { opener, acceptor, wire };
}

async function listen(server: Server | ReturnType<typeof createNetServer>): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as AddressInfo).port;
}

function collect(s: TunnelStream): Promise<Buffer> {
  return new Promise((resolve, reject) => { const parts: Buffer[] = []; s.on("data", (c) => parts.push(c)); s.on("end", () => resolve(Buffer.concat(parts))); s.on("close", () => resolve(Buffer.concat(parts))); s.on("error", reject); s.resume(); });
}

test("codec: ida e volta, kind 0x54 e rejeição de outros binários", () => {
  const f = encodeTunnelFrame(TunnelOp.DATA, 0xdeadbeef, Buffer.from("abc"));
  assert.equal(f[0], IDE_TUNNEL_KIND);
  assert.equal(isTunnelFrame(f), true);
  const d = decodeTunnelFrame(f)!;
  assert.equal(d.op, TunnelOp.DATA); assert.equal(d.streamId, 0xdeadbeef); assert.equal(d.payload.toString(), "abc");
  const browserFrame = Buffer.from([0x42, 1, 1, 60, 0, 0, 0, 1]);
  assert.equal(isTunnelFrame(browserFrame), false);
  assert.equal(decodeTunnelFrame(browserFrame), null);
  const badVersion = Buffer.from(f); badVersion[1] = 9;
  assert.equal(decodeTunnelFrame(badVersion), null);
  const badOp = Buffer.from(f); badOp[2] = 77;
  assert.equal(decodeTunnelFrame(badOp), null);
  assert.equal(decodeTunnelFrame(Buffer.from([0x54, 1])), null);
});

test("OPEN vindo da rede é validado (injeção de cabeçalho, método, caminho)", () => {
  const ok = { mode: "http", method: "GET", path: "/x?y=1", headers: ["Host", "hub:4577", "Cookie", "a=b"], win: 1024 };
  const parse = (o: unknown) => parseOpenHead(Buffer.from(JSON.stringify(o)));
  assert.deepEqual(parse(ok), ok);
  assert.ok("error" in parse({ ...ok, headers: ["X-A", "1\r\nX-Injetado: 1"] }));
  assert.ok("error" in parse({ ...ok, headers: ["X A", "1"] }));
  assert.ok("error" in parse({ ...ok, headers: ["Host"] }));
  assert.ok("error" in parse({ ...ok, method: "GET /evil" }));
  assert.ok("error" in parse({ ...ok, path: "x" }));
  assert.ok("error" in parse({ ...ok, path: "/a b" }));
  assert.ok("error" in parse({ ...ok, mode: "tcp" }));
  assert.ok("error" in parseOpenHead(Buffer.from("{nope")));
  assert.equal(parseResponseHead(Buffer.from(JSON.stringify({ status: 99, headers: [] }))), null);
  assert.equal(parseResponseHead(Buffer.from(JSON.stringify({ status: 200, headers: ["A", "b\nc"] }))), null);
  assert.deepEqual(parseResponseHead(Buffer.from(JSON.stringify({ status: 204, headers: ["A", "b"] }))), { status: 204, statusMessage: undefined, headers: ["A", "b"] });
  assert.equal(serializeRequestHead({ method: "GET", path: "/p", headers: ["Host", "h", "Upgrade", "websocket"] }).toString(), "GET /p HTTP/1.1\r\nHost: h\r\nUpgrade: websocket\r\n\r\n");
  assert.equal(compressibleResponse({ "content-type": "application/javascript" }), true);
  assert.equal(compressibleResponse({ "content-type": "text/css", "content-encoding": "gzip" }), false);
  assert.equal(compressibleResponse({ "content-type": "image/png" }), false);
});

test("HTTP pelo túnel até um servidor local: Host original preservado, corpo de 3 MB íntegro nos dois sentidos", async () => {
  const server = createHttpServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      const body = Buffer.concat(parts);
      res.writeHead(201, "Criado", { "x-host": String(req.headers.host), "x-hosts": String(req.rawHeaders.filter((h, i) => i % 2 === 0 && h.toLowerCase() === "host").length), "content-type": "application/octet-stream" });
      res.end(body.length ? body : Buffer.from("vazio"));
    });
  });
  const port = await listen(server);
  const { opener } = pair({ window: 64 * 1024, chunk: 16 * 1024, onStream: (s) => bridgeTunnelStream(s, port) });
  try {
    const big = randomBytes(3 * 1024 * 1024 + 7);
    const s = opener.open({ mode: "http", method: "POST", path: "/echo", headers: ["Host", "meu-hub.ts.net:443", "Content-Length", String(big.length)] })!;
    const head = new Promise<any>((r) => s.once("response", r));
    s.end(big);
    const [h, body] = await Promise.all([head, collect(s)]);
    assert.equal(h.status, 201);
    assert.equal(h.statusMessage, "Criado");
    const hv = (k: string) => h.headers[h.headers.findIndex((x: string, i: number) => i % 2 === 0 && x.toLowerCase() === k) + 1];
    assert.equal(hv("x-host"), "meu-hub.ts.net:443", "o Host do navegador chega intacto (o code-server compara com o Origin)");
    assert.equal(hv("x-hosts"), "1", "sem Host duplicado");
    assert.equal(sha(body), sha(big));
    await sleep(20);
    assert.equal(opener.size, 0, "stream some do mapa no fim limpo");
  } finally { server.close(); opener.destroyAll("fim"); }
});

test("controle de fluxo: consumidor parado segura o produtor na janela; retomado, chega tudo", async () => {
  const total = 1024 * 1024;
  const payload = randomBytes(total);
  const server = createHttpServer((_req, res) => { res.writeHead(200, { "content-length": String(total) }); res.end(payload); });
  const port = await listen(server);
  const window = 32 * 1024;
  const { opener, wire } = pair({ window, chunk: 8 * 1024, onStream: (s) => bridgeTunnelStream(s, port) });
  try {
    const s = opener.open({ mode: "http", method: "GET", path: "/", headers: ["Host", "x"] })!;
    s.end();
    await new Promise((r) => s.once("response", r));
    s.pause(); // ninguém lê
    await sleep(300);
    assert.ok(wire.dataToOpener <= window, `com o consumidor parado o runner mandou ${wire.dataToOpener} bytes (janela ${window})`);
    assert.ok(wire.dataToOpener > 0);
    const body = await collect(s); // retoma
    assert.equal(sha(body), sha(payload));
    assert.equal(wire.dataToOpener, total);
  } finally { server.close(); opener.destroyAll("fim"); }
});

test("um stream pesado parado não trava outro stream na mesma conexão", async () => {
  const big = randomBytes(2 * 1024 * 1024);
  const server = createHttpServer((req, res) => { if (req.url === "/big") { res.end(big); return; } res.end("rápido"); });
  const port = await listen(server);
  const { opener } = pair({ window: 32 * 1024, onStream: (s) => bridgeTunnelStream(s, port) });
  try {
    const heavy = opener.open({ mode: "http", method: "GET", path: "/big", headers: ["Host", "x"] })!;
    heavy.end(); await new Promise((r) => heavy.once("response", r)); heavy.pause();
    const t0 = Date.now();
    const light = opener.open({ mode: "http", method: "GET", path: "/small", headers: ["Host", "x"] })!;
    light.end();
    const body = await collect(light);
    assert.equal(body.toString(), "rápido");
    assert.ok(Date.now() - t0 < 2000);
    heavy.destroy();
    await sleep(30);
    assert.equal(opener.size, 0);
  } finally { server.close(); opener.destroyAll("fim"); }
});

test("link entupido (bufferedAmount) segura DATA mas não os frames de controle; desentupido, segue", async () => {
  let backlog = 10 * 1024 * 1024;
  const server = createHttpServer((_req, res) => res.end(Buffer.alloc(200 * 1024, 7)));
  const port = await listen(server);
  const { opener, wire } = pair({ backlog: () => backlog, onStream: (s) => bridgeTunnelStream(s, port) });
  try {
    const s = opener.open({ mode: "http", method: "GET", path: "/", headers: ["Host", "x"] })!;
    s.end();
    await new Promise((r) => s.once("response", r)); // RESPONSE (controle) passa com o link cheio
    await sleep(150);
    assert.equal(wire.dataToOpener, 0, "nenhum DATA enquanto o link está acima do teto");
    backlog = 0;
    const body = await collect(s);
    assert.equal(body.length, 200 * 1024);
    assert.ok(opener.stats().bytesIn >= 200 * 1024);
  } finally { server.close(); opener.destroyAll("fim"); }
});

test("upgrade (WebSocket): bytes crus nos dois sentidos, inclusive a resposta 101", async () => {
  const seen: string[] = [];
  const raw = createNetServer((sock) => {
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      if (!seen.length && buf.includes("\r\n\r\n")) {
        const [head, rest] = buf.split("\r\n\r\n");
        seen.push(head);
        sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
        if (rest) sock.write("eco:" + rest);
        buf = "";
      } else if (seen.length) { sock.write("eco:" + buf); buf = ""; }
    });
  });
  const port = await listen(raw);
  const { opener } = pair({ onStream: (s) => bridgeTunnelStream(s, port) });
  try {
    const s = opener.open({ mode: "upgrade", method: "GET", path: "/stable-x?reconnectionToken=1", headers: ["Host", "hub:4577", "Origin", "http://hub:4577", "Upgrade", "websocket", "Connection", "Upgrade"] })!;
    let got = "";
    s.on("data", (d) => { got += d.toString("latin1"); });
    s.write("primeiro");
    for (let i = 0; i < 50 && !got.includes("eco:primeiro"); i++) await sleep(20);
    s.write("segundo");
    for (let i = 0; i < 50 && !got.includes("eco:segundo"); i++) await sleep(20);
    assert.match(got, /^HTTP\/1\.1 101 Switching Protocols/);
    assert.ok(got.includes("eco:primeiro") && got.includes("eco:segundo"), got);
    assert.match(seen[0], /^GET \/stable-x\?reconnectionToken=1 HTTP\/1\.1\r\nHost: hub:4577\r\nOrigin: http:\/\/hub:4577/);
    s.destroy();
  } finally { raw.close(); opener.destroyAll("fim"); }
});

test("janela violada derruba o stream com RESET; limite de streams nos dois lados", async () => {
  // acceptor que nunca liga a lugar nenhum: só para inspecionar
  let accepted: TunnelStream | null = null;
  const { opener, acceptor, wire } = pair({ window: 4096, maxStreams: 2, onStream: (s) => { accepted = s; } });
  const s1 = opener.open({ mode: "http", method: "GET", path: "/", headers: [] })!;
  await sleep(20);
  assert.ok(accepted);
  // o acceptor manda além do crédito que o opener concedeu (4096)
  const errP = new Promise<Error>((r) => s1.once("error", r));
  acceptor.onFrame(Buffer.alloc(0)); // ruído ignorado
  opener.onFrame(encodeTunnelFrame(TunnelOp.DATA, s1.id, Buffer.alloc(5000)));
  assert.match(String((await errP).message), /janela/);
  await sleep(20);
  assert.ok(wire.resets.some((r) => r.startsWith("o:") && /janela/.test(r)));
  const a = opener.open({ mode: "http", method: "GET", path: "/", headers: [] });
  const b = opener.open({ mode: "http", method: "GET", path: "/", headers: [] });
  const c = opener.open({ mode: "http", method: "GET", path: "/", headers: [] });
  assert.ok(a && b);
  assert.equal(c, null, "o opener não passa do teto");
  // acceptor recusando OPEN além do teto (um Hub que não respeita)
  const forged = encodeTunnelFrame(TunnelOp.OPEN, 999, Buffer.from(JSON.stringify({ mode: "http", method: "GET", path: "/", headers: [], win: 1 })));
  acceptor.onFrame(forged);
  await sleep(20);
  assert.ok(wire.resets.some((r) => /limite de streams/.test(r)));
  opener.destroyAll("fim"); acceptor.destroyAll("fim");
});

test("sem resposta da máquina: timeout de cabeçalho; queda do link derruba tudo", async () => {
  const { opener, acceptor } = pair({ headTimeoutMs: 200, onStream: () => { /* nunca responde */ } });
  const keepAlive = setInterval(() => { /* os timers do mux são unref: segura o loop do teste */ }, 50);
  const s = opener.open({ mode: "http", method: "GET", path: "/", headers: [] })!;
  const err = await new Promise<Error>((r) => s.once("error", r));
  clearInterval(keepAlive);
  assert.match(err.message, /não respondeu/);
  const s2 = opener.open({ mode: "upgrade", method: "GET", path: "/", headers: [] })!;
  const closed = new Promise<void>((r) => s2.once("close", () => r()));
  opener.destroyAll("máquina offline");
  await closed;
  assert.equal(opener.size, 0);
  assert.equal(opener.open({ mode: "http", method: "GET", path: "/", headers: [] }), null, "mux fechado não abre mais");
  acceptor.destroyAll("fim");
});

test("servidor local recusando conexão vira RESET com motivo (o Hub responde 502)", async () => {
  const dead = createNetServer(); const port = await listen(dead); await new Promise<void>((r) => dead.close(() => r()));
  const { opener } = pair({ onStream: (s) => bridgeTunnelStream(s, port) });
  const s = opener.open({ mode: "http", method: "GET", path: "/", headers: ["Host", "x"] })!;
  s.end();
  const err = await new Promise<Error>((r) => s.once("error", r));
  assert.match(err.message, /ECONNREFUSED/);
  opener.destroyAll("fim");
});

test("stream http ocioso é encerrado", async () => {
  const hang = createHttpServer(() => { /* nunca responde */ });
  const port = await listen(hang);
  const { opener, acceptor } = pair({ idleMs: 250, headTimeoutMs: 10_000, onStream: (s) => bridgeTunnelStream(s, port) });
  try {
    const s = opener.open({ mode: "http", method: "GET", path: "/", headers: ["Host", "x"] })!;
    s.end();
    const err = await new Promise<Error>((r) => s.once("error", r));
    assert.match(err.message, /ocioso/);
  } finally { hang.closeAllConnections?.(); hang.close(); opener.destroyAll("fim"); acceptor.destroyAll("fim"); }
});

test("http.request com cabeçalhos em array + setHost:false não duplica Host (premissa do bridge)", async () => {
  const server = createHttpServer((req, res) => res.end(JSON.stringify(req.rawHeaders)));
  const port = await listen(server);
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const r = httpRequest({ host: "127.0.0.1", port, path: "/", method: "GET", headers: ["Host", "outro:1", "X-A", "1", "X-A", "2"] as any, setHost: false }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(b)); });
      r.on("error", reject); r.end();
    });
    const raw: string[] = JSON.parse(body);
    assert.deepEqual(raw.filter((_h, i) => i % 2 === 0 && raw[i].toLowerCase() === "host").length, 1);
    assert.equal(raw[raw.findIndex((h) => h.toLowerCase() === "host") + 1], "outro:1");
    assert.equal(raw.filter((h) => h === "X-A").length, 2, "duplicatas preservadas");
  } finally { server.close(); }
});
