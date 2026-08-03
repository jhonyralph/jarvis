import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "apps", "hub", "web", "vendor", "context");
const files = [
  ["node_modules/maplibre-gl/dist/maplibre-gl.mjs", "maplibre-gl.mjs"],
  ["node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", "maplibre-gl-shared.mjs"],
  ["node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "maplibre-gl-worker.mjs"],
  ["node_modules/maplibre-gl/dist/maplibre-gl.css", "maplibre-gl.css"],
  ["node_modules/pmtiles/dist/pmtiles.js", "pmtiles.js"],
];

await mkdir(target, { recursive: true });
for (const [source, name] of files) await copyFile(join(root, source), join(target, name));
console.log(`Context map vendor assets copied to ${target}`);
