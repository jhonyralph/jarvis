// Gera os ícones da BANDEJA com o EMBLEMA do Jarvis (arc-reactor: anéis azuis + núcleo) e um pequeno
// PONTO DE STATUS no canto (verde/amarelo/vermelho), no lugar do antigo círculo colorido chapado — que
// aparecia como "uma bola verde" sem identidade da marca. Reescreve desktop/src/control/tray-icons.js
// com os 3 PNGs (ok/warn/down) em base64.
//
// Puro Node (zlib) — SEM render do Electron e SEM dependência de imagem (mesma razão do tray-icons.js
// original: o Electron não renderiza offscreen de forma confiável em todo host, então o ícone é um PNG
// pronto e embutido). Uso:  node scripts/make-tray-icons.mjs   (dentro de desktop/)

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_JS = join(HERE, "..", "src", "control", "tray-icons.js");
const S = 32; // resolução base; tray.js reduz para 16

// CRC32 (tabela padrão) — evita depender de zlib.crc32 (varia por versão do Node).
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }

function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const t = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function makeIcon(statusRGB) {
  const buf = Buffer.alloc(S * S * 4); // transparente
  const cx = S / 2 - 0.5, cy = S / 2 - 0.5;
  const put = (x, y, [r, g, b], a) => {
    if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
    const i = (y * S + x) * 4, na = Math.min(1, a), ba = buf[i + 3] / 255, oa = na + ba * (1 - na);
    if (oa <= 0) return;
    buf[i]     = Math.round((r * na + buf[i]     * ba * (1 - na)) / oa);
    buf[i + 1] = Math.round((g * na + buf[i + 1] * ba * (1 - na)) / oa);
    buf[i + 2] = Math.round((b * na + buf[i + 2] * ba * (1 - na)) / oa);
    buf[i + 3] = Math.round(oa * 255);
  };
  const ring = (R, T, col, op = 1) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const a = (1 - Math.max(0, Math.abs(Math.hypot(x - cx, y - cy) - R) - T / 2)) * op; if (a > 0) put(x, y, col, a); } };
  const disc = (X, Y, R, col, op = 1) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const a = Math.max(0, Math.min(1, R - Math.hypot(x - X, y - Y) + 0.5)) * op; if (a > 0) put(x, y, col, a); } };
  // emblema (arc-reactor) — paleta do icon.svg
  ring(13, 2.4, [59, 130, 246], 0.95); // anel externo  #3b82f6
  ring(9, 1.8, [96, 165, 250], 0.9);   // anel médio    #60a5fa
  disc(cx, cy, 4.6, [147, 197, 253]);  // núcleo        #93c5fd
  disc(cx, cy, 2.2, [235, 244, 255]);  // brilho central
  // ponto de status no canto inferior direito, com halo escuro + borda branca p/ contraste em qualquer barra
  const bx = S - 8, by = S - 8;
  disc(bx, by, 6.2, [11, 13, 16]);     // halo
  disc(bx, by, 5.4, [255, 255, 255]);  // borda branca
  disc(bx, by, 4.2, statusRGB);        // cor do status
  return encodePng(buf, S, S).toString("base64");
}

const PNG = { ok: makeIcon([34, 197, 94]), warn: makeIcon([245, 158, 11]), down: makeIcon([239, 68, 68]) };

const js = `// Tray icons: EMBLEMA (arc-reactor) do Jarvis + um ponto de status (verde/amarelo/vermelho) no canto.
// Antes era um círculo colorido chapado ("bola verde", sem marca). PNGs 32x32 RGBA embutidos como data
// URL — sem render em runtime (o Electron não renderiza offscreen de forma confiável em todo host).
// NÃO edite à mão: gere com \`node scripts/make-tray-icons.mjs\` (desktop/), puro zlib.

const PNG = {
  ok: ${JSON.stringify(PNG.ok)},
  warn: ${JSON.stringify(PNG.warn)},
  down: ${JSON.stringify(PNG.down)},
};

/** PNG data URL for a status level ("ok"|"warn"|"down"). */
function dataUrl(level) {
  return "data:image/png;base64," + (PNG[level] || PNG.down);
}

module.exports = { dataUrl, PNG };
`;
writeFileSync(OUT_JS, js);
console.log("tray-icons.js atualizado:", Object.fromEntries(Object.entries(PNG).map(([k, v]) => [k, v.length + " b64"])));
