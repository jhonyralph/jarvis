/**
 * End-to-end: a porta do wake local não pode ser "o IP é 127.0.0.1".
 *
 * O Hub roda atrás de `tailscale serve` / proxy reverso, que disca 127.0.0.1 em nome de qualquer par
 * remoto — e uma página web aberta na máquina do Hub também alcança `ws://127.0.0.1:4577`, porque
 * WebSocket não passa por CORS. Enquanto as três mensagens do wake (`wake_hello`, `wake_event` e o
 * `send` para a sessão de voz) valiam só pelo IP de origem, qualquer um dos dois injetava texto numa
 * sessão onde `!comando` executa um shell — sem login nenhum. Isto prova a correção pelo fio real:
 * sem o segredo local, o Hub trata a mensagem como qualquer outra e responde `unauth`; com ele, o
 * listener desta máquina continua funcionando como antes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";

const pExecFile = promisify(execFile);

async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise<ReturnType<typeof createServer>>((res, rej) => {
    const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => res(s));
  })));
  const ports = servers.map((s) => { const a = s.address(); return typeof a === "object" && a ? a.port : 0; });
  await Promise.all(servers.map((s) => new Promise<void>((res) => s.close(() => res()))));
  return ports;
}
async function stop(pid?: number): Promise<void> { if (!pid) return; try { if (process.platform === "win32") await pExecFile("taskkill", ["/pid", String(pid), "/T", "/F"]); else process.kill(-pid, "SIGTERM"); } catch { /* já morreu */ } }
async function waitHealth(port: number): Promise<void> {
  const end = Date.now() + 45_000;
  while (Date.now() < end) { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return; } catch { /* subindo */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Hub não ficou saudável");
}
/** Abre um socket, manda UMA mensagem e devolve o primeiro frame — que é a resposta do portão. */
async function askOnce(url: string, message: unknown, timeout = 10_000): Promise<any> {
  const ws = new WebSocket(url);
  try {
    await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
    return await new Promise<any>((res, rej) => {
      const timer = setTimeout(() => rej(new Error("nenhum frame chegou a tempo")), timeout);
      ws.on("message", (raw) => { let m: any; try { m = JSON.parse(raw.toString()); } catch { return; } clearTimeout(timer); res(m); });
      ws.on("close", () => { clearTimeout(timer); rej(new Error("socket fechado sem resposta")); });
      ws.send(JSON.stringify(message));
    });
  } finally { try { ws.close(); } catch { /* ignore */ } }
}

test("wake_hello sem o segredo local cai no portão de auth; com ele, passa", { timeout: 90_000 }, async () => {
  const root = resolve(import.meta.dirname, "../../..");
  const home = mkdtempSync(join(tmpdir(), "jarvis-wake-auth-"));
  const [port, adminPort] = await freePorts(2);
  let hubPid: number | undefined;
  try {
    const hub = spawn(process.execPath, ["--import", "tsx", "apps/hub/src/index.ts"], {
      cwd: root, detached: process.platform !== "win32", stdio: "ignore",
      // AUTH ligado de propósito: é exatamente a instalação real que o bypass furava.
      env: { ...process.env, JARVIS_PORT: String(port), JARVIS_ADMIN_PORT: String(adminPort), JARVIS_HOME: home, JARVIS_AUTH: "on", JARVIS_AGENT: "mock", JARVIS_ENABLE_MOCK: "1" },
    });
    hubPid = hub.pid;
    await waitHealth(port);

    // Este teste conecta de 127.0.0.1 — o cenário mais favorável ao atacante (é o que o proxy e a
    // página web produzem). Sem o segredo, ainda assim é tratado como desconhecido.
    const semToken = await askOnce(`ws://127.0.0.1:${port}/`, { t: "wake_hello" });
    assert.equal(semToken.t, "unauth", `esperava o portão de auth, veio ${JSON.stringify(semToken)}`);

    const injecao = await askOnce(`ws://127.0.0.1:${port}/`, { t: "send", sessionId: "voice", speak: true, text: "!echo invasao" });
    assert.equal(injecao.t, "unauth", `injeção na sessão de voz não pode ser aceita sem login: ${JSON.stringify(injecao)}`);

    // O listener desta máquina lê o segredo do disco (só um processo local consegue) e segue vivo.
    const token = readFileSync(join(home, ".jarvis", "wake-token"), "utf8").trim();
    assert.ok(token.length >= 32, "o Hub grava um segredo de alta entropia por boot");
    const comToken = await askOnce(`ws://127.0.0.1:${port}/`, { t: "wake_hello", wakeToken: token });
    assert.equal(comToken.t, "wake_state", `com o segredo local o wake continua funcionando, veio ${JSON.stringify(comToken)}`);

    // Um segredo ERRADO do mesmo tamanho não passa (a comparação é por valor, não por formato).
    const errado = await askOnce(`ws://127.0.0.1:${port}/`, { t: "wake_hello", wakeToken: "f".repeat(token.length) });
    assert.equal(errado.t, "unauth");
  } finally {
    await stop(hubPid);
    try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
