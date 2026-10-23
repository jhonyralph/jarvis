import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  QualityController, browserCandidates, browserDisabledByEnv, browserInputCommands, buildChromeArgs, cdpModifiers, decodeBrowserFrame,
  encodeBrowserFrame, headfulUserAgent, keyEventsFor, matchesProfileCmdline, normalizeNavUrl, parseCdpMessage, peekBrowserFramePageId,
  resolveBrowserExecutable, userDataDirsInCmdline,
} from "./browser.js";

// ------------------------------------------------------------------------------ descoberta
test("descoberta: JARVIS_BROWSER=0 desliga mesmo com Chrome instalado", () => {
  for (const v of ["0", "off", "false", "NO"]) assert.equal(browserDisabledByEnv({ JARVIS_BROWSER: v }), true, v);
  for (const v of [undefined, "", "1", "on"]) assert.equal(browserDisabledByEnv({ JARVIS_BROWSER: v }), false, String(v));
  const r = resolveBrowserExecutable({ env: { JARVIS_BROWSER: "0" }, platform: "win32", exists: () => true });
  assert.equal(r.path, null); assert.equal(r.disabled, true);
});

test("descoberta: JARVIS_BROWSER_PATH manda; apontando para nada, NÃO cai em silêncio para outro", () => {
  assert.deepEqual(resolveBrowserExecutable({ env: { JARVIS_BROWSER_PATH: "/opt/x/chrome" }, platform: "linux", exists: (p) => p === "/opt/x/chrome" }), { path: "/opt/x/chrome", source: "env" });
  const r = resolveBrowserExecutable({ env: { JARVIS_BROWSER_PATH: "/nao/existe" }, platform: "linux", exists: (p) => p !== "/nao/existe" });
  assert.equal(r.path, null); assert.match(r.reason || "", /JARVIS_BROWSER_PATH/);
});

test("descoberta: ordem Chrome → Edge → Chromium → Playwright, por SO", () => {
  const env = { ProgramFiles: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", LOCALAPPDATA: "C:\\L" };
  const win = browserCandidates({ env, platform: "win32", home: "C:\\U", listDir: () => ["chromium-1100", "chromium_headless_shell-1200", "chromium-1234", "ffmpeg-1"] });
  const sources = win.map((c) => c.source);
  assert.deepEqual([...new Set(sources)], ["chrome", "edge", "chromium", "playwright"]);
  assert.equal(win[0].path, join("C:\\PF", "Google", "Chrome", "Application", "chrome.exe"));
  const pw = win.filter((c) => c.source === "playwright").map((c) => c.path);
  assert.ok(pw[0].includes("chromium-1234") && pw[0].endsWith("chrome.exe"), "Playwright mais novo primeiro, sem o headless_shell");
  assert.ok(!pw.some((p) => p.includes("headless_shell")));
  // Só Edge instalado → Edge.
  const edge = join("C:\\PF86", "Microsoft", "Edge", "Application", "msedge.exe");
  assert.deepEqual(resolveBrowserExecutable({ env, platform: "win32", home: "C:\\U", exists: (p) => p === edge, listDir: () => [] }), { path: edge, source: "edge" });
  const mac = browserCandidates({ env: {}, platform: "darwin", home: "/Users/u", listDir: () => [] });
  assert.equal(mac[0].path, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const lin = browserCandidates({ env: {}, platform: "linux", home: "/home/u", listDir: () => { throw new Error("sem pasta"); } });
  assert.equal(lin[0].path, "/usr/bin/google-chrome");
  assert.ok(lin.some((c) => c.path === "/usr/bin/chromium"));
  assert.equal(resolveBrowserExecutable({ env: {}, platform: "linux", home: "/h", exists: () => false, listDir: () => [] }).path, null);
});

test("argumentos: headless, CDP só em loopback, perfil dedicado, sem sandbox só como root", () => {
  const a = buildChromeArgs({ userDataDir: "/h/.jarvis/browser/owner", width: 1280, height: 800 });
  assert.ok(a.includes("--headless=new"));
  assert.ok(a.includes("--remote-debugging-port=0"));
  assert.ok(a.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(a.includes("--user-data-dir=/h/.jarvis/browser/owner"));
  assert.ok(a.includes("--window-size=1280,800"));
  assert.ok(!a.includes("--no-sandbox"));
  assert.equal(a[a.length - 1], "about:blank");
  assert.ok(buildChromeArgs({ userDataDir: "/x", isRoot: true }).includes("--no-sandbox"));
  assert.ok(buildChromeArgs({ userDataDir: "/x", width: 99999, height: -5 }).includes("--window-size=3840,240"), "grampeia tamanho");
  assert.equal(headfulUserAgent("Mozilla/5.0 HeadlessChrome/141.0.0.0 Safari/537.36"), "Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36");
});

// ------------------------------------------------------------------------- órfãos (casamento)
test("órfãos: casa o --user-data-dir EXATO (com e sem aspas, barras e caixa no Windows)", () => {
  const dir = "C:\\Users\\Jo\\.jarvis\\browser\\owner";
  assert.equal(matchesProfileCmdline(`"C:\\PF\\chrome.exe" --headless=new --user-data-dir=C:\\Users\\Jo\\.jarvis\\browser\\owner --no-first-run`, dir, "win32"), true);
  assert.equal(matchesProfileCmdline(`chrome.exe --type=renderer --user-data-dir="c:/users/jo/.jarvis/browser/owner/" --x`, dir, "win32"), true, "filho do Chrome, aspas e barra final");
  assert.equal(matchesProfileCmdline(`chrome.exe --user-data-dir=C:\\Users\\Jo\\.jarvis\\browser\\owner2`, dir, "win32"), false, "owner2 não é owner");
  assert.equal(matchesProfileCmdline(`chrome.exe --user-data-dir=C:\\Users\\Jo\\.jarvis\\browser\\agent`, dir, "win32"), false, "outro perfil");
  assert.equal(matchesProfileCmdline(`"C:\\PF\\chrome.exe" --flag-switches-begin`, dir, "win32"), false, "o Chrome do dia a dia (sem --user-data-dir) nunca é vítima");
  assert.equal(matchesProfileCmdline("", dir, "win32"), false);
  assert.equal(matchesProfileCmdline(`/usr/bin/chrome --user-data-dir=/home/u/.jarvis/browser/owner`, "/home/u/.jarvis/browser/owner", "linux"), true);
  assert.equal(matchesProfileCmdline(`/usr/bin/chrome --user-data-dir=/home/u/.jarvis/browser/OWNER`, "/home/u/.jarvis/browser/owner", "linux"), false, "posix diferencia caixa");
  assert.deepEqual(userDataDirsInCmdline(`a --user-data-dir="x y" b --user-data-dir=z`), ["x y", "z"]);
});

// ------------------------------------------------------------------------------- frame binário
test("frame: codifica e decodifica o cabeçalho; o JPEG vai cru e intacto", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pageId = "667A517B49E4ED69899DE78CB07AA142";
  const t0 = 1760900000123.5;
  const buf = encodeBrowserFrame({ pageId, seq: 42, t0, width: 1280, height: 800, quality: 55 }, jpeg);
  assert.equal(buf[0], 0x42); assert.equal(buf[1], 1);
  assert.equal(buf.length, 20 + pageId.length + jpeg.length);
  assert.equal(peekBrowserFramePageId(buf), pageId);
  const d = decodeBrowserFrame(buf)!;
  assert.deepEqual(d.header, { pageId, quality: 55, seq: 42, t0, width: 1280, height: 800 });
  assert.deepEqual([...d.jpeg], [...jpeg]);
});

test("frame: lixo e cabeçalho truncado não viram frame (o Hub descarta)", () => {
  assert.equal(peekBrowserFramePageId(Buffer.from("{\"t\":\"ping\"}")), null);
  assert.equal(peekBrowserFramePageId(Buffer.alloc(5)), null);
  const ok = encodeBrowserFrame({ pageId: "abc", seq: 1, t0: 0, width: 1, height: 1, quality: 50 }, Buffer.alloc(0));
  assert.equal(peekBrowserFramePageId(ok.subarray(0, 21)), null, "pageId cortado");
  const wrongVersion = Buffer.from(ok); wrongVersion[1] = 9;
  assert.equal(peekBrowserFramePageId(wrongVersion), null);
  assert.throws(() => encodeBrowserFrame({ pageId: "", seq: 0, t0: 0, width: 0, height: 0, quality: 0 }, Buffer.alloc(0)));
  assert.throws(() => encodeBrowserFrame({ pageId: "x".repeat(65), seq: 0, t0: 0, width: 0, height: 0, quality: 0 }, Buffer.alloc(0)));
  const clamped = decodeBrowserFrame(encodeBrowserFrame({ pageId: "p", seq: -1, t0: NaN, width: 99999, height: -3, quality: 300 }, Buffer.alloc(0)))!;
  assert.deepEqual({ ...clamped.header }, { pageId: "p", quality: 100, seq: 0, t0: 0, width: 65535, height: 0 });
});

// ---------------------------------------------------------------------------- parse do CDP
test("CDP: frame do screencast sai pelo caminho rápido — base64 fatiado, sem JSON.parse do JPEG", () => {
  const b64 = Buffer.alloc(6000, 7).toString("base64");
  const raw = Buffer.from(JSON.stringify({ method: "Page.screencastFrame", params: { data: b64, metadata: { deviceWidth: 1280, deviceHeight: 800 }, sessionId: 3 }, sessionId: "S1" }));
  const m = parseCdpMessage(raw)!;
  assert.equal(m.method, "Page.screencastFrame");
  assert.equal(m.sessionId, "S1");
  assert.equal(m.params.sessionId, 3);
  assert.equal(m.params.metadata.deviceWidth, 1280);
  assert.equal(m.params.data, "", "o base64 não foi materializado como string");
  assert.equal(m.frameData!.toString("latin1"), b64);
  // Ordem de chaves diferente continua funcionando (cai no parse completo se preciso).
  const other = Buffer.from(JSON.stringify({ sessionId: "S2", params: { sessionId: 4, metadata: {}, data: b64 }, method: "Page.screencastFrame" }));
  const m2 = parseCdpMessage(other)!;
  assert.equal(m2.method, "Page.screencastFrame"); assert.equal(m2.sessionId, "S2");
  assert.ok(m2.frameData?.toString("latin1") === b64 || m2.params.data === b64);
});

test("CDP: respostas e eventos comuns; lixo vira null", () => {
  assert.deepEqual(parseCdpMessage(Buffer.from("{\"id\":7,\"result\":{\"a\":1}}")), { id: 7, result: { a: 1 } });
  assert.deepEqual(parseCdpMessage("{\"method\":\"Target.targetCreated\",\"params\":{}}"), { method: "Target.targetCreated", params: {} });
  assert.equal(parseCdpMessage(Buffer.from("não é json")), null);
  assert.equal(parseCdpMessage(Buffer.from("5")), null);
});

// ------------------------------------------------------------------------------------ input
test("teclas: imprimível vira keyDown COM texto; com Ctrl vira atalho sem texto; especiais mapeadas", () => {
  const [a] = keyEventsFor({ type: "down", key: "a", code: "KeyA" });
  assert.equal(a.method, "Input.dispatchKeyEvent");
  assert.deepEqual(a.params, { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 0, text: "a", unmodifiedText: "a" });
  const [ctrlA] = keyEventsFor({ type: "down", key: "a", code: "KeyA", modifiers: cdpModifiers({ ctrl: true }) });
  assert.equal(ctrlA.params.type, "rawKeyDown"); assert.equal(ctrlA.params.modifiers, 2); assert.equal(ctrlA.params.text, undefined);
  const [shiftA] = keyEventsFor({ type: "down", key: "A", code: "KeyA", modifiers: cdpModifiers({ shift: true }) });
  assert.equal(shiftA.params.text, "A", "Shift não é atalho: continua digitando");
  const [enter] = keyEventsFor({ type: "down", key: "Enter" });
  assert.equal(enter.params.text, "\r", "Enter com \\r dispara o submit do form");
  assert.equal(enter.params.windowsVirtualKeyCode, 13);
  const [bs] = keyEventsFor({ type: "down", key: "Backspace" });
  assert.equal(bs.params.type, "rawKeyDown"); assert.equal(bs.params.windowsVirtualKeyCode, 8);
  const [left] = keyEventsFor({ type: "down", key: "ArrowLeft" });
  assert.equal(left.params.code, "ArrowLeft"); assert.equal(left.params.windowsVirtualKeyCode, 37);
  const [f5] = keyEventsFor({ type: "down", key: "F5" });
  assert.equal(f5.params.windowsVirtualKeyCode, 116);
  const [up] = keyEventsFor({ type: "up", key: "a", code: "KeyA" });
  assert.equal(up.params.type, "keyUp"); assert.equal(up.params.text, undefined);
  const [dot] = keyEventsFor({ type: "down", key: ".", code: "Period" });
  assert.equal(dot.params.windowsVirtualKeyCode, 190);
  const [cedilha] = keyEventsFor({ type: "down", key: "ç", code: "Semicolon" });
  assert.equal(cedilha.params.text, "ç");
  for (const k of ["Unidentified", "Dead", "Process", ""]) assert.deepEqual(keyEventsFor({ type: "down", key: k }), [], k);
  assert.deepEqual(keyEventsFor({ type: "down", key: "constructor" }), [], "nome de propriedade de objeto não é tecla especial");
});

test("mouse/roda/texto: tipos do CDP, botões e valores grampeados", () => {
  const [down] = browserInputCommands({ kind: "mouse", type: "down", x: 10.5, y: 20, button: "left", clickCount: 2 });
  assert.deepEqual(down.params, { type: "mousePressed", x: 10.5, y: 20, button: "left", buttons: 1, clickCount: 2, modifiers: 0 });
  const [move] = browserInputCommands({ kind: "mouse", type: "move", x: 1, y: 2 });
  assert.equal(move.params.type, "mouseMoved"); assert.equal(move.params.button, "none"); assert.equal(move.params.clickCount, 0);
  const [right] = browserInputCommands({ kind: "mouse", type: "down", x: 1, y: 2, button: "right" });
  assert.equal(right.params.buttons, 2);
  const [wheel] = browserInputCommands({ kind: "wheel", x: 5, y: 6, dx: 0, dy: 1e9 });
  assert.equal(wheel.params.type, "mouseWheel"); assert.equal(wheel.params.deltaY, 10000);
  const [nan] = browserInputCommands({ kind: "mouse", type: "move", x: NaN, y: Infinity } as any);
  assert.equal(nan.params.x, 0); assert.equal(nan.params.y, 0);
  assert.deepEqual(browserInputCommands({ kind: "text", text: "olá" }), [{ method: "Input.insertText", params: { text: "olá" } }]);
  assert.deepEqual(browserInputCommands({ kind: "text", text: "" }), []);
  assert.deepEqual(browserInputCommands({ kind: "mouse", type: "drag" } as any), []);
  assert.deepEqual(browserInputCommands({ kind: "evil" } as any), []);
});

test("URL: esquema padrão https, http para rede local, busca para texto solto, javascript: recusado", () => {
  assert.equal(normalizeNavUrl("example.com"), "https://example.com");
  assert.equal(normalizeNavUrl("  https://a.b/c?d=1 "), "https://a.b/c?d=1");
  assert.equal(normalizeNavUrl("http://x.y"), "http://x.y");
  assert.equal(normalizeNavUrl("localhost:3000/app"), "http://localhost:3000/app");
  assert.equal(normalizeNavUrl("192.168.0.10:8080"), "http://192.168.0.10:8080");
  assert.equal(normalizeNavUrl("127.0.0.1"), "http://127.0.0.1");
  assert.equal(normalizeNavUrl("about:blank"), "about:blank");
  assert.equal(normalizeNavUrl("como fazer pão"), "https://www.google.com/search?q=como%20fazer%20p%C3%A3o");
  assert.equal(normalizeNavUrl("jarvis"), "https://www.google.com/search?q=jarvis");
  assert.equal(normalizeNavUrl("javascript:alert(1)"), null);
  assert.equal(normalizeNavUrl("JavaScript:alert(1)"), null);
  assert.equal(normalizeNavUrl("ftp://x.y/z"), null);
  assert.equal(normalizeNavUrl(""), null);
  assert.equal(normalizeNavUrl(undefined), null);
});

// -------------------------------------------------------------------- qualidade adaptativa
test("qualidade: cai quando o crédito esgota, sobe devagar quando a rede volta, piso e teto", () => {
  const q = new QualityController({ max: 60, min: 30, downStep: 15, upStep: 5, recoverAfter: 3 });
  assert.equal(q.quality, 60);
  q.record(10, 10); assert.equal(q.evaluate(), 45, "50% descartado → desce");
  q.record(10, 10); assert.equal(q.evaluate(), 30);
  q.record(10, 10); assert.equal(q.evaluate(), null, "piso");
  assert.equal(q.quality, 30);
  q.record(15, 0); assert.equal(q.evaluate(), null);
  q.record(15, 0); assert.equal(q.evaluate(), null);
  q.record(15, 0); assert.equal(q.evaluate(), 35, "3 janelas limpas → sobe um passo");
  q.record(1, 0); assert.equal(q.evaluate(), null, "janela quase vazia (página parada) não conta");
  q.record(15, 0); q.evaluate(); q.record(15, 0); q.evaluate();
  q.record(15, 0); assert.equal(q.evaluate(), 40);
  q.record(15, 2); assert.equal(q.evaluate(), null, "~12% de descarte: segura, não sobe nem desce");
  for (let i = 0; i < 40; i++) { q.record(15, 0); q.evaluate(); }
  assert.equal(q.quality, 60, "teto");
});
