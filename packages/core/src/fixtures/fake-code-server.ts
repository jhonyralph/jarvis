/**
 * Um "code-server" FALSO para testes do BRW-IDE-00 F4 — mesma forma no disco que o de verdade
 * (`lib/node[.exe]`, `package.json`, `out/node/entry.js`) e o mesmo jeito de subir (`node <pasta>
 * --bind-addr 127.0.0.1:<porta> … --user-data-dir …`), sem baixar 218 MB.
 *
 * O servidor falso responde `/healthz`, ecoa cabeçalhos/caminho, gera e ecoa corpos grandes, responde
 * `…/serviceWorker.js` e fala um WebSocket mínimo de eco (texto e binário). Como o de verdade, ele
 * cria um processo FILHO sem `--user-data-dir` na linha de comando (para testar o recolhimento de órfão).
 * O filho é `detached` de propósito: é o pior caso (no Windows, filho comum do Node morre junto com o
 * pai pelo job object do libuv; um que escapa do job — como o auxiliar do Chrome da F1 — não).
 */
import { copyFileSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENTRY = String.raw`
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");
const i = process.argv.indexOf("--bind-addr");
const [host, port] = process.argv[i + 1].split(":");
// detached: fora do job do Windows (que mataria o filho junto com o pai) e fora do grupo POSIX — o
// pior caso, como o auxiliar do Chrome que escapou na F1.
const child = spawn(process.execPath, [path.join(__dirname, "child.js")], { stdio: "ignore", windowsHide: true, detached: true });
child.unref();
const pump = (res, n) => { const chunk = Buffer.alloc(65536); let sent = 0; const go = () => { while (sent < n) { const m = Math.min(chunk.length, n - sent); for (let k = 0; k < m; k++) chunk[k] = (sent + k) % 251; sent += m; if (!res.write(chunk.subarray(0, m))) { res.once("drain", go); return; } } res.end(); }; go(); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/healthz") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"status":"alive"}'); return; }
  if (url.pathname === "/echo-headers") { res.writeHead(200, { "content-type": "application/json", "set-cookie": ["a=1; Path=/", "b=2; Path=/"] }); res.end(JSON.stringify({ url: req.url, rawHeaders: req.rawHeaders, childPid: child.pid })); return; }
  if (url.pathname === "/big") { const n = Number(url.searchParams.get("n") || 1048576); res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(n) }); pump(res, n); return; }
  if (url.pathname === "/echo" && req.method === "POST") { res.writeHead(200, { "content-type": "application/octet-stream" }); req.pipe(res); return; }
  if (url.pathname === "/go-root") { res.writeHead(302, { location: "/login?x=1" }); res.end(); return; }
  if (url.pathname.endsWith("/serviceWorker.js")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end("self.addEventListener('fetch',()=>{});"); return; }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); res.end("fake-code-server " + req.method + " " + req.url);
});
server.on("upgrade", (req, sock) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) { sock.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { sock.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15; let len = buf[1] & 127; let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = (buf[1] & 128) !== 0; const mask = masked ? buf.subarray(off, off + 4) : null; if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len)); buf = buf.subarray(off + len);
      if (mask) for (let k = 0; k < payload.length; k++) payload[k] ^= mask[k & 3];
      if (op === 8) { sock.end(Buffer.from([0x88, 0])); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      let hdr;
      if (payload.length < 126) hdr = Buffer.from([0x80 | op, payload.length]);
      else if (payload.length < 65536) { hdr = Buffer.alloc(4); hdr[0] = 0x80 | op; hdr[1] = 126; hdr.writeUInt16BE(payload.length, 2); }
      else { hdr = Buffer.alloc(10); hdr[0] = 0x80 | op; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(payload.length), 2); }
      sock.write(Buffer.concat([hdr, payload]));
    }
  });
  sock.on("error", () => {});
});
server.listen(Number(port), host);
`;

const CHILD = `setInterval(() => {}, 60000);\n`;

/** Monta um code-server falso em `dir` (o `node` é um hardlink do Node atual; cópia se não der). */
export function writeFakeCodeServer(dir: string, platform: string = process.platform): void {
  mkdirSync(join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "out", "node"), { recursive: true });
  const node = join(dir, "lib", platform === "win32" ? "node.exe" : "node");
  try { linkSync(process.execPath, node); } catch { copyFileSync(process.execPath, node); }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "code-server", version: "0.0.0-fake", main: "out/node/entry.js" }));
  writeFileSync(join(dir, "out", "node", "entry.js"), ENTRY);
  writeFileSync(join(dir, "out", "node", "child.js"), CHILD);
}
