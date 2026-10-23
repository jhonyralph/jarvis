import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODE_SERVER_VERSION, IdeManager, codeServerArgs, codeServerAsset, codeServerAssetKey, codeServerEnv, codeServerFolderParam,
  downloadVerified, ideDisabledByEnv, ideReapVictims, matchesIdeCmdline, pinnedCodeServerAssets, systemTar, type CodeServerAsset,
} from "./ide.js";
import { writeFakeCodeServer } from "./fixtures/fake-code-server.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; } };
function rmrf(p: string) { for (let i = 0; i < 20; i++) { try { rmSync(p, { recursive: true, force: true }); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); } } }
function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => { const r = httpRequest({ host: "127.0.0.1", port, path }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode || 0, body: b })); }); r.on("error", reject); r.end(); });
}

test("build por SO/arquitetura e hashes FIXADOS no código", () => {
  assert.equal(CODE_SERVER_VERSION, "4.141.0");
  assert.equal(codeServerAssetKey("win32", "x64"), "windows-amd64");
  assert.equal(codeServerAssetKey("win32", "arm64"), null, "o code-server não publica Windows ARM");
  assert.equal(codeServerAssetKey("darwin", "arm64"), "macos-arm64");
  assert.equal(codeServerAssetKey("darwin", "x64"), "macos-amd64");
  assert.equal(codeServerAssetKey("linux", "x64"), "linux-amd64");
  assert.equal(codeServerAssetKey("linux", "arm64"), "linux-arm64");
  assert.equal(codeServerAssetKey("linux", "ia32"), null);
  assert.equal(codeServerAssetKey("freebsd", "x64"), null);
  const win = codeServerAsset("win32", "x64")!;
  assert.equal(win.name, "code-server-4.141.0-windows-amd64.tar.gz");
  assert.equal(win.url, "https://github.com/coder/code-server/releases/download/v4.141.0/code-server-4.141.0-windows-amd64.tar.gz");
  // valores da API do GitHub em 2026-10-19 (campo `digest`): mudar aqui é decisão consciente
  assert.equal(win.sha256, "8dc8beabdaa29218dc23b2aafaa67d9a777fb27006e32778153b16b1be58769b");
  assert.equal(win.size, 218_475_701);
  const all = pinnedCodeServerAssets();
  assert.equal(all.length, 5);
  for (const a of all) { assert.match(a.sha256, /^[0-9a-f]{64}$/); assert.ok(a.size > 200e6 && a.size < 260e6, a.key); assert.ok(a.url.startsWith("https://github.com/coder/code-server/releases/download/v4.141.0/")); }
  assert.equal(new Set(all.map((a) => a.sha256)).size, 5);
});

test("kill switch JARVIS_IDE=0 e argumentos do code-server (só loopback)", () => {
  assert.equal(ideDisabledByEnv({}), false, "padrão: disponível");
  for (const v of ["0", "off", "false", "NO"]) assert.equal(ideDisabledByEnv({ JARVIS_IDE: v }), true, v);
  assert.equal(ideDisabledByEnv({ JARVIS_IDE: "1" }), false);
  const args = codeServerArgs("/opt/cs", { port: 4321, userDataDir: "/d/u", extensionsDir: "/d/e" });
  assert.deepEqual(args.slice(0, 3), ["/opt/cs", "--bind-addr", "127.0.0.1:4321"]);
  for (const f of ["--auth", "none", "--disable-telemetry", "--disable-update-check", "--disable-workspace-trust", "--user-data-dir", "/d/u", "--extensions-dir", "/d/e"]) assert.ok(args.includes(f), f);
  assert.ok(!args.join(" ").includes("0.0.0.0"));
  const env = codeServerEnv({ PATH: "p", NODE_OPTIONS: "--import tsx", VSCODE_IPC_HOOK_CLI: "x", HOME: "/h", USERPROFILE: "C:\\u" });
  assert.deepEqual(env, { PATH: "p", HOME: "/h", USERPROFILE: "C:\\u" }, "HOME/USERPROFILE ficam (git/ssh do terminal); NODE_OPTIONS/VSCODE_* saem");
});

test("pasta no formato do code-server: URI /c:/… no Windows (F0 §13.2)", () => {
  assert.equal(codeServerFolderParam("C:\\Users\\Jonathan\\proj", "win32"), "/c:/Users/Jonathan/proj");
  assert.equal(codeServerFolderParam("D:/dados/x y", "win32"), "/d:/dados/x y");
  assert.equal(codeServerFolderParam("C:\\", "win32"), "/c:/");
  assert.equal(codeServerFolderParam("c:", "win32"), "/c:/");
  assert.equal(codeServerFolderParam("\\\\srv\\share\\p", "win32"), "//srv/share/p");
  assert.equal(codeServerFolderParam("/home/j/proj", "linux"), "/home/j/proj");
  assert.equal(codeServerFolderParam("/Users/j/proj", "darwin"), "/Users/j/proj");
  assert.equal(codeServerFolderParam("  ", "win32"), "");
});

test("recolhimento de órfão: só a instância certa (principal + filhos órfãos), nunca outra instância", () => {
  const inst = "C:\\Users\\J\\.jarvis\\ide\\code-server-4.141.0", data = "C:\\Users\\J\\.jarvis\\ide\\user-data";
  const main = `${inst}\\lib\\node.exe ${inst} --bind-addr 127.0.0.1:5000 --auth none --user-data-dir ${data} --extensions-dir x`;
  assert.equal(matchesIdeCmdline(main, inst.toLowerCase().replace(/\\/g, "/"), data, "win32"), true, "Windows: sem diferença de caixa/barra");
  assert.equal(matchesIdeCmdline(main, inst, "C:\\outra\\user-data", "win32"), false);
  const rows = [
    { pid: 10, ppid: 1, cmdline: "node hub.js" },
    { pid: 20, ppid: 10, cmdline: main },                                            // principal nosso
    { pid: 21, ppid: 20, cmdline: `${inst}\\lib\\node.exe ${inst}\\out\\node\\entry` }, // filho dele
    { pid: 22, ppid: 21, cmdline: `${inst}\\lib\\node.exe --type=ptyHost` },          // neto
    { pid: 30, ppid: 999, cmdline: `${inst}\\lib\\node.exe ${inst}\\out\\node\\entry` }, // órfão (pai morto)
    { pid: 40, ppid: 10, cmdline: `${inst}\\lib\\node.exe ${inst} --user-data-dir C:\\outra --bind-addr 127.0.0.1:6000` }, // outra instância
    { pid: 41, ppid: 40, cmdline: `${inst}\\lib\\node.exe ${inst}\\out\\node\\entry` }, // filho VIVO da outra
    { pid: 50, ppid: 10, cmdline: "notepad C:\\Users\\J\\.jarvis\\ide\\user-data\\x.txt" }, // não é o binário
  ];
  assert.deepEqual(ideReapVictims(rows, inst, data, "win32").sort(), [20, 21, 22, 30]);
  assert.deepEqual(ideReapVictims(rows, inst, data, "win32", [20]).sort(), [30], "o filho vivo do processo atual nunca entra");
  const posix = [{ pid: 7, ppid: 1, cmdline: "/h/.jarvis/ide/cs/lib/node /h/.jarvis/ide/cs/out/node/entry" }];
  assert.deepEqual(ideReapVictims(posix, "/h/.jarvis/ide/cs", "/h/.jarvis/ide/user-data", "linux"), [7], "POSIX: adotado pelo init = órfão");
});

test("download: segue redirecionamento, confere tamanho e SHA-256 e apaga o que não confere", async () => {
  const payload = Buffer.alloc(300_000, 9);
  const server = createServer((req, res) => {
    if (req.url === "/r") { res.writeHead(302, { location: "/f" }); res.end(); return; }
    if (req.url === "/f") { res.writeHead(200, { "content-length": String(payload.length) }); res.end(payload); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  const dir = mkdtempSync(join(tmpdir(), "jarvis-ide-dl-"));
  try {
    const dest = join(dir, "a.tgz");
    const seen: number[] = [];
    await downloadVerified(`http://127.0.0.1:${port}/r`, dest, { size: payload.length, sha256: sha(payload), onProgress: (p) => seen.push(p.received) });
    assert.equal(readFileSync(dest).length, payload.length);
    assert.equal(seen.at(-1), payload.length);
    await assert.rejects(downloadVerified(`http://127.0.0.1:${port}/f`, join(dir, "b.tgz"), { size: payload.length, sha256: "0".repeat(64) }), /SHA-256 não confere/);
    assert.equal(existsSync(join(dir, "b.tgz")), false, "arquivo adulterado é apagado");
    await assert.rejects(downloadVerified(`http://127.0.0.1:${port}/f`, join(dir, "c.tgz"), { size: payload.length + 10, sha256: sha(payload) }), /incompleto/);
    await assert.rejects(downloadVerified(`http://127.0.0.1:${port}/f`, join(dir, "d.tgz"), { size: 1000, sha256: sha(payload) }), /maior que o esperado/);
    await assert.rejects(downloadVerified(`http://127.0.0.1:${port}/nada`, join(dir, "e.tgz"), { size: 1, sha256: "0".repeat(64) }), /HTTP 404/);
    await assert.rejects(downloadVerified("http://example.com/x", join(dir, "f.tgz"), { size: 1, sha256: "0".repeat(64) }), /só por https/);
  } finally { server.close(); rmrf(dir); }
});

/** Empacota o code-server falso como o release (pasta de topo dentro do .tar.gz) e devolve o "asset". */
function fakeRelease(work: string): { archive: string; asset: CodeServerAsset } {
  const top = "code-server-0.0.0-fake-test";
  writeFakeCodeServer(join(work, "src", top));
  const archive = join(work, "fake.tar.gz");
  execFileSync(systemTar(), ["-czf", archive, "-C", join(work, "src"), top], { windowsHide: true });
  const bytes = readFileSync(archive);
  return { archive, asset: { key: "test", name: "fake.tar.gz", size: bytes.length, sha256: sha(bytes), url: "https://invalid.example/fake.tar.gz", version: "0.0.0-fake" } };
}

test("IdeManager: instala (hash conferido + tar + rename atômico), sobe em loopback, para sem deixar processo", { timeout: 120_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), "jarvis-ide-mgr-"));
  const states: string[] = [];
  let mgr: IdeManager | null = null;
  try {
    const { archive, asset } = fakeRelease(work);
    mgr = new IdeManager({
      rootDir: join(work, "root"), asset, idleMs: 0, startTimeoutMs: 20_000,
      download: async (_a, dest, onProgress) => { copyFileSync(archive, dest); onProgress({ received: asset.size, total: asset.size }); },
      onState: (s) => states.push(s.status + (s.progress ? ":" + s.progress.phase : "")),
    });
    assert.equal(mgr.available, true);
    assert.equal(mgr.state().status, "not_installed");
    assert.equal(mgr.state().sizeBytes, asset.size);
    await assert.rejects(mgr.ensureRunning(), /não está instalado/);
    await mgr.install();
    assert.equal(mgr.installed, true);
    assert.ok(existsSync(join(mgr.installDir, ".jarvis-install.json")));
    assert.deepEqual(readdirSync(join(work, "root")).filter((n) => n.startsWith(".")), [], "nada de .download/.staging sobrando");
    assert.ok(states.includes("installing:download") || states.includes("installing:extract"), states.join(","));
    assert.equal(mgr.state().status, "stopped");
    const port = await mgr.ensureRunning();
    assert.equal(mgr.state().status, "running");
    assert.equal(await mgr.ensureRunning(), port, "segunda chamada reaproveita");
    const echo = JSON.parse((await get(port, "/echo-headers")).body);
    const childPid = echo.childPid as number;
    assert.ok(pidAlive(childPid));
    const pid = mgr.pid!;
    assert.ok(existsSync(mgr.pidfile));
    await mgr.stop("teste");
    assert.equal(mgr.state().status, "stopped");
    await sleep(300);
    assert.equal(pidAlive(pid), false, "principal morto");
    assert.equal(pidAlive(childPid), false, "árvore inteira morta (filho também)");
    assert.equal(existsSync(mgr.pidfile), false);
  } finally { mgr?.stopSync(); rmrf(work); }
});

test("IdeManager: SHA-256 errado é recusado sem instalar nada", { timeout: 60_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), "jarvis-ide-bad-"));
  try {
    const { archive, asset } = fakeRelease(work);
    const mgr = new IdeManager({ rootDir: join(work, "root"), asset: { ...asset, sha256: "f".repeat(64) }, download: async (_a, dest) => { copyFileSync(archive, dest); } });
    await assert.rejects(mgr.install(), /SHA-256 não confere/);
    assert.equal(mgr.installed, false);
    assert.equal(mgr.state().status, "error");
    assert.match(mgr.state().reason || "", /SHA-256/);
    assert.equal(existsSync(mgr.installDir), false);
    assert.deepEqual(readdirSync(join(work, "root")).filter((n) => n.startsWith(".")), []);
  } finally { rmrf(work); }
});

test("IdeManager: desliga sozinho sem cliente; cliente aberto segura; código JARVIS_IDE=0 = indisponível", { timeout: 120_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), "jarvis-ide-idle-"));
  const bin = join(work, "cs");
  writeFakeCodeServer(bin);
  let mgr: IdeManager | null = null;
  try {
    const off = new IdeManager({ rootDir: join(work, "off"), binDir: bin, env: { JARVIS_IDE: "0" } });
    assert.equal(off.available, false);
    assert.equal(off.state().status, "unavailable");
    assert.match(off.state().reason || "", /JARVIS_IDE=0/);
    mgr = new IdeManager({ rootDir: join(work, "root"), binDir: bin, idleMs: 600, startTimeoutMs: 20_000 });
    assert.equal(mgr.installed, true, "JARVIS_IDE_CODE_SERVER: instalação externa conta como instalada");
    assert.equal(mgr.state().external, true);
    await mgr.ensureRunning();
    mgr.retain();
    await sleep(1500);
    assert.equal(mgr.state().status, "running", "com cliente aberto não desliga");
    mgr.release();
    for (let i = 0; i < 40 && mgr.state().status === "running"; i++) await sleep(100);
    assert.equal(mgr.state().status, "stopped");
    assert.match(mgr.state().reason || "", /ocioso/);
  } finally { mgr?.stopSync(); rmrf(work); }
});

test("IdeManager: recolhe code-server órfão (principal morto à força deixa o filho) e recusa pasta em uso por outro host vivo", { timeout: 120_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), "jarvis-ide-orphan-"));
  const bin = join(work, "cs");
  writeFakeCodeServer(bin);
  const root = join(work, "root");
  mkdirSync(root, { recursive: true });
  const mgr = new IdeManager({ rootDir: root, binDir: bin, idleMs: 0, startTimeoutMs: 20_000 });
  const spawned: number[] = [];
  try {
    // um "host anterior" sobe o code-server desta pasta e morre sem levar a árvore
    const port = 20000 + Math.floor(Math.random() * 20000);
    const node = join(bin, "lib", process.platform === "win32" ? "node.exe" : "node");
    const orphanMain = spawn(node, codeServerArgs(bin, { port, userDataDir: mgr.userDataDir, extensionsDir: mgr.extensionsDir }), { stdio: "ignore", windowsHide: true, detached: process.platform !== "win32" });
    spawned.push(orphanMain.pid!);
    let childPid = 0;
    for (let i = 0; i < 100 && !childPid; i++) { try { childPid = JSON.parse((await get(port, "/echo-headers")).body).childPid; } catch { await sleep(100); } }
    assert.ok(childPid > 0);
    spawned.push(childPid);
    // pidfile apontando um host que já morreu
    writeFileSync(mgr.pidfile, JSON.stringify({ pid: orphanMain.pid, host: 999_999_99, port }));
    process.kill(orphanMain.pid!); // só o principal (sem árvore): o filho vira órfão
    await sleep(500);
    assert.ok(pidAlive(childPid), "o filho sobreviveu ao pai (o cenário real do watchdog)");
    const reaped = await mgr.reapOrphans();
    assert.ok(reaped.includes(childPid), `recolhidos: ${reaped.join(",")}`);
    await sleep(300);
    assert.equal(pidAlive(childPid), false);
    // outro host VIVO com code-server vivo nesta pasta: não sobe um segundo (dados compartilhados)
    const other = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
    spawned.push(other.pid!);
    writeFileSync(mgr.pidfile, JSON.stringify({ pid: other.pid, host: other.pid, port: 1 }));
    await assert.rejects(mgr.ensureRunning(), /outro processo do Jarvis/);
    assert.deepEqual(await mgr.reapOrphans(), [], "pidfile de host vivo: não mexe");
  } finally {
    for (const p of spawned) { try { process.kill(p); } catch { /* já morreu */ } }
    mgr.stopSync(); rmrf(work);
  }
});
