import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const res = join(here, "android", "app", "src", "main", "res");
const densities = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))]);
}

function png(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, row + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hex(s) {
  const n = parseInt(s.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function blend(data, i, rgb, alpha) {
  alpha = Math.max(0, Math.min(1, alpha));
  if (alpha <= 0) return;
  const da = data[i + 3] / 255;
  const oa = alpha + da * (1 - alpha);
  data[i] = oa ? Math.round((rgb[0] * alpha + data[i] * da * (1 - alpha)) / oa) : 0;
  data[i + 1] = oa ? Math.round((rgb[1] * alpha + data[i + 1] * da * (1 - alpha)) / oa) : 0;
  data[i + 2] = oa ? Math.round((rgb[2] * alpha + data[i + 2] * da * (1 - alpha)) / oa) : 0;
  data[i + 3] = Math.round(oa * 255);
}

function cover(v) {
  return Math.max(0, Math.min(1, v));
}

function createCanvas(size, background, roundMask) {
  const data = new Uint8Array(size * size * 4);
  if (!background) return data;
  const bg0 = hex("#152232"), bg1 = hex("#0b0d10");
  const cx = size * 0.5, cy = size * 0.42, max = size * 0.7;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (roundMask) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const a = cover(size / 2 - d + 0.5);
      if (!a) continue;
      const c = mix(bg0, bg1, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / max);
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = Math.round(255 * a);
    } else {
      const c = mix(bg0, bg1, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / max);
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return data;
}

function drawCircle(data, size, cx, cy, radius, rgb, alpha) {
  const x0 = Math.max(0, Math.floor(cx - radius - 2)), x1 = Math.min(size - 1, Math.ceil(cx + radius + 2));
  const y0 = Math.max(0, Math.floor(cy - radius - 2)), y1 = Math.min(size - 1, Math.ceil(cy + radius + 2));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const a = cover(radius - d + 0.75) * alpha;
    blend(data, (y * size + x) * 4, rgb, a);
  }
}

function drawRadialCore(data, size, cx, cy, radius) {
  const c0 = hex("#dbeafe"), c1 = hex("#60a5fa"), c2 = hex("#2563eb");
  const x0 = Math.max(0, Math.floor(cx - radius - 2)), x1 = Math.min(size - 1, Math.ceil(cx + radius + 2));
  const y0 = Math.max(0, Math.floor(cy - radius - 2)), y1 = Math.min(size - 1, Math.ceil(cy + radius + 2));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const a = cover(radius - d + 0.75);
    if (!a) continue;
    const t = d / radius;
    const c = t < 0.45 ? mix(c0, c1, t / 0.45) : mix(c1, c2, (t - 0.45) / 0.55);
    blend(data, (y * size + x) * 4, c, a);
  }
}

function inArc(angle, start, end) {
  angle = (angle + 360) % 360;
  start = (start + 360) % 360;
  end = (end + 360) % 360;
  return start <= end ? angle >= start && angle <= end : angle >= start || angle <= end;
}

function drawStrokeCircle(data, size, cx, cy, radius, width, rgb, alpha, start = 0, end = 360) {
  const r = radius + width / 2 + 2;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (end !== 360 && !inArc(Math.atan2(dy, dx) * 180 / Math.PI, start, end)) continue;
    const d = Math.hypot(dx, dy);
    const a = cover(width / 2 - Math.abs(d - radius) + 0.75) * alpha;
    blend(data, (y * size + x) * 4, rgb, a);
  }
}

function drawIcon(size, opts = {}) {
  const data = createCanvas(size, opts.background !== false, !!opts.round);
  const s = size / 512;
  const cx = size / 2, cy = size / 2;
  drawStrokeCircle(data, size, cx, cy, 150 * s, 34 * s, hex("#2563eb"), 0.16);
  drawCircle(data, size, cx, cy, 74 * s, hex("#60a5fa"), 0.12);
  drawStrokeCircle(data, size, cx, cy, 150 * s, 6 * s, hex("#1d4ed8"), 0.5);
  drawStrokeCircle(data, size, cx, cy, 128 * s, 14 * s, hex("#60a5fa"), 0.92, -90, -30);
  drawStrokeCircle(data, size, cx, cy, 128 * s, 14 * s, hex("#60a5fa"), 0.92, 30, 90);
  drawStrokeCircle(data, size, cx, cy, 128 * s, 14 * s, hex("#60a5fa"), 0.92, 150, 210);
  drawStrokeCircle(data, size, cx, cy, 92 * s, 8 * s, hex("#3b82f6"), 0.86);
  drawCircle(data, size, cx, cy, 66 * s, hex("#2563eb"), 0.20);
  drawRadialCore(data, size, cx, cy, 46 * s);
  drawStrokeCircle(data, size, cx, cy, 46 * s, 3 * s, hex("#eff6ff"), 0.90);
  return data;
}

for (const [density, scale] of densities) {
  const dir = join(res, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  const legacy = Math.round(48 * scale);
  const foreground = Math.round(108 * scale);
  writeFileSync(join(dir, "ic_launcher.png"), png(legacy, legacy, drawIcon(legacy)));
  writeFileSync(join(dir, "ic_launcher_round.png"), png(legacy, legacy, drawIcon(legacy, { round: true })));
  writeFileSync(join(dir, "ic_launcher_foreground.png"), png(foreground, foreground, drawIcon(foreground, { background: false })));
}

const valuesDir = join(res, "values");
mkdirSync(valuesDir, { recursive: true });
writeFileSync(
  join(valuesDir, "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B0D10</color>\n</resources>\n`,
);

console.log("[android-icons] generated Jarvis launcher icons");
