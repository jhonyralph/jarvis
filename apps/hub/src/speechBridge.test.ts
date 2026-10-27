import test from "node:test";
import assert from "node:assert/strict";
import { SpeechBridge, type SpeechSocket } from "./speechBridge.js";

/** Aparelho falso: guarda os quadros que recebeu. */
class Device implements SpeechSocket {
  readonly OPEN = 1;
  readyState = 1;
  frames: Record<string, unknown>[] = [];
  constructor(readonly name: string) {}
  tts(): Record<string, unknown>[] { return this.frames.filter((f) => f.t === "tts"); }
  last(t: string): Record<string, unknown> | undefined { return [...this.frames].reverse().find((f) => f.t === t); }
}

function wav(ms: number): string {
  const sr = 8_000, data = Buffer.alloc(Math.round((sr * 2 * ms) / 1000));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8, "ascii");
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36, "ascii"); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]).toString("base64");
}

function setup(wake: Device[] = []) {
  const said: string[] = [];
  const messages: string[] = [];
  const bridge = new SpeechBridge<Device>({
    send: (ws, frame) => { ws.frames.push(frame); },
    synthesize: async (text) => { said.push(text); return Buffer.from(wav(500), "base64"); },
    wakeClients: () => wake,
    postMessage: (_r, _s, text) => { messages.push(text); },
    sessionTitle: (_r, sid) => (sid === "s1" ? "Relatório" : ""),
    log: () => {},
  }, { localId: "local", windowMaxMs: 60_000 });
  return { bridge, said, messages };
}
const tick = () => new Promise((r) => setImmediate(r));

test("o aparelho onde o dono falou é o único que fala — sem a duplicação app + listener", () => {
  const listener = new Device("pc");
  const phone = new Device("phone");
  const { bridge } = setup([listener]);
  bridge.markCapable(phone);
  bridge.heard(phone, "local", "s1", "como está o relatório?", false);
  bridge.enqueue("local", "s1", { audio: wav(300), text: "Está pronto." }, [phone, listener]);
  assert.equal(phone.tts().length, 1);
  assert.equal(listener.tts().length, 0, "o listener não toca a mesma fala");
  assert.ok(phone.tts()[0].qid, "fala da fila leva qid para o aparelho avisar que terminou");
  bridge.dispose();
});

test("duas sessões respondendo juntas: a segunda só chega depois da janela da primeira fechar", () => {
  const phone = new Device("phone");
  const { bridge } = setup();
  bridge.markCapable(phone);
  bridge.useDevice(phone);
  bridge.enqueue("local", "s1", { audio: wav(300), text: "s1 pronta" }, []);
  bridge.enqueue("local", "s2", { audio: wav(300), text: "s2 pronta" }, []);
  assert.deepEqual(phone.tts().map((f) => f.text), ["s1 pronta"]);
  bridge.played(String(phone.tts()[0].qid));
  assert.deepEqual(phone.last("voice_window"), { t: "voice_window", runnerId: "local", sessionId: "s1" });
  bridge.windowClosed("local", "s1");
  assert.deepEqual(phone.tts().map((f) => f.text), ["s1 pronta", "s2 pronta"]);
  bridge.dispose();
});

test("sem aparelho de saída, a fala vai para quem vê a sessão (comportamento antigo)", () => {
  const viewer = new Device("viewer");
  const { bridge } = setup();
  bridge.enqueue("runner-2", "sx", { audio: wav(300), text: "oi" }, [viewer]);
  assert.equal(viewer.tts()[0].runnerId, "runner-2");
  assert.equal(viewer.tts()[0].sessionId, "sx");
  bridge.dispose();
});

test("aparelho de saída desconectado: cai para quem vê a sessão", () => {
  const phone = new Device("phone");
  const viewer = new Device("viewer");
  const { bridge } = setup();
  bridge.useDevice(phone);
  phone.readyState = 3;
  bridge.enqueue("local", "s1", { audio: wav(300), text: "oi" }, [viewer]);
  assert.equal(viewer.tts().length, 1);
  bridge.dispose();
});

test("\"Hey Jarvis\" logo depois de uma sessão falar responde a ela, não à voice", () => {
  const listener = new Device("pc");
  const { bridge } = setup([listener]);
  bridge.useDevice(listener);
  bridge.enqueue("local", "s1", { audio: wav(300), text: "terminei o relatório" }, []);
  bridge.played(String(listener.tts()[0].qid));
  // o listener não tem janela: a vez de s1 segue por um tempo curto
  const r = bridge.heard(listener, "local", "voice", "então manda por e-mail", true);
  assert.deepEqual(r, { handled: false, target: { runnerId: "local", sessionId: "s1" } });
  bridge.dispose();
});

test("o dono perguntou à voice: a resposta dela toca antes de outra sessão que chegou no meio", () => {
  const listener = new Device("pc");
  const { bridge } = setup([listener]);
  bridge.heard(listener, "local", "voice", "Jarvis, como está?", true);
  bridge.enqueue("local", "s1", { audio: wav(300), text: "terminei o relatório" }, []);
  assert.equal(listener.tts().length, 0, "s1 espera a resposta da voice");
  bridge.enqueue("local", "voice", { audio: wav(300), text: "tudo certo" }, []);
  assert.deepEqual(listener.tts().map((f) => f.text), ["tudo certo"]);
  bridge.dispose();
});

test("\"espere\" pergunta se pode trazer as outras; \"sim\" libera as outras sessões", async () => {
  const phone = new Device("phone");
  const { bridge, said, messages } = setup();
  bridge.markCapable(phone);
  bridge.useDevice(phone);
  bridge.enqueue("local", "s1", { audio: wav(300), text: "qual opção?" }, []);
  bridge.played(String(phone.tts()[0].qid));
  bridge.enqueue("local", "s2", { audio: wav(300), text: "s2 pronta" }, []);
  assert.equal(bridge.heard(phone, "local", "s1", "espere um pouco", false).handled, true);
  await tick();
  assert.match(said.at(-1) || "", /espero 2 minutos\. Posso trazer/);
  assert.match(messages.at(-1) || "", /Posso trazer/, "a pergunta também aparece como texto");
  const pergunta = phone.tts().at(-1)!;
  assert.match(String(pergunta.text), /Posso trazer/);
  bridge.played(String(pergunta.qid));
  assert.equal(bridge.heard(phone, "local", "s1", "sim, pode", false).handled, true);
  assert.equal(phone.tts().at(-1)!.text, "s2 pronta");
  bridge.dispose();
});

test("\"encerrar a voz\" para tudo, avisa sem reabrir o microfone e nada mais fala até religar", async () => {
  const phone = new Device("phone");
  const { bridge } = setup();
  bridge.markCapable(phone);
  bridge.useDevice(phone);
  bridge.enqueue("local", "s1", { audio: wav(300), text: "um" }, []);
  bridge.enqueue("local", "s2", { audio: wav(300), text: "dois" }, []);
  assert.equal(bridge.heard(phone, "local", "s1", "encerrar a voz", false).handled, true);
  assert.deepEqual(phone.last("tts_stop"), { t: "tts_stop", off: true });
  await tick();
  const aviso = phone.tts().at(-1)!;
  assert.equal(aviso.text, "Voz encerrada.");
  assert.equal(aviso.closing, true, "fechamento: o app não volta a escutar sozinho");
  const before = phone.tts().length;
  bridge.enqueue("local", "s3", { audio: wav(300), text: "três" }, []);
  assert.equal(phone.tts().length, before, "voz desligada não fala");
  assert.ok(bridge.isOff());
  bridge.heard(phone, "local", "s1", "ligar a voz", false);
  await tick();
  assert.equal(phone.tts().at(-1)!.text, "Voz ligada.");
  bridge.dispose();
});

test("falar por cima no app (refino) para a voz no aparelho", () => {
  const phone = new Device("phone");
  const { bridge } = setup();
  bridge.useDevice(phone);
  bridge.enqueue("local", "s1", { audio: wav(300), text: "falando" }, []);
  bridge.bargeIn(phone);
  assert.deepEqual(phone.last("tts_stop"), { t: "tts_stop" });
  bridge.dispose();
});
