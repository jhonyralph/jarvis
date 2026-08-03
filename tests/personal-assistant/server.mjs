import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const webRoot = resolve(repositoryRoot, "apps/hub/web");
const host = "127.0.0.1";
const port = Number(process.env.JARVIS_PERSONAL_UI_PORT || 43917);

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid JARVIS_PERSONAL_UI_PORT: ${process.env.JARVIS_PERSONAL_UI_PORT}`);
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"],
]);

const mapStyle = JSON.stringify({
  version: 8,
  name: "Jarvis deterministic Playwright map",
  sources: {
    "fixture-basemap": {
      type: "geojson",
      attribution: "© OpenStreetMap contributors · deterministic offline fixture",
      data: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { kind: "land" }, geometry: { type: "Polygon", coordinates: [[[-43.98, -19.96], [-43.89, -19.96], [-43.89, -19.88], [-43.98, -19.88], [-43.98, -19.96]]] } },
          { type: "Feature", properties: { kind: "park" }, geometry: { type: "Polygon", coordinates: [[[-43.944, -19.931], [-43.929, -19.931], [-43.929, -19.916], [-43.944, -19.916], [-43.944, -19.931]]] } },
          { type: "Feature", properties: { kind: "road" }, geometry: { type: "LineString", coordinates: [[-43.965, -19.945], [-43.946, -19.934], [-43.924, -19.916], [-43.902, -19.900]] } },
          { type: "Feature", properties: { kind: "road" }, geometry: { type: "LineString", coordinates: [[-43.970, -19.900], [-43.950, -19.914], [-43.930, -19.928], [-43.910, -19.944]] } },
        ],
      },
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#10151d" },
    },
    { id: "fixture-land", type: "fill", source: "fixture-basemap", filter: ["==", ["get", "kind"], "land"], paint: { "fill-color": "#1b2530" } },
    { id: "fixture-park", type: "fill", source: "fixture-basemap", filter: ["==", ["get", "kind"], "park"], paint: { "fill-color": "#234833", "fill-outline-color": "#3f6b50" } },
    { id: "fixture-road", type: "line", source: "fixture-basemap", filter: ["==", ["get", "kind"], "road"], paint: { "line-color": "#98a3ae", "line-width": 3 } },
  ],
});

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": contentType,
  });
  response.end(body);
}

const server = createServer((request, response) => {
  const method = request.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    send(response, 405, "Method not allowed", "text/plain; charset=utf-8");
    return;
  }

  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (url.pathname === "/context/maps/style.json") {
    if (method === "HEAD") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(mapStyle),
        "content-type": "application/json; charset=utf-8",
      });
      response.end();
    } else {
      send(response, 200, mapStyle, "application/json; charset=utf-8");
    }
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    send(response, 400, "Bad path", "text/plain; charset=utf-8");
    return;
  }

  const filePath = resolve(webRoot, `.${pathname}`);
  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${sep}`)) {
    send(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  const stat = statSync(filePath);
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": stat.size,
    "content-type": contentTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream",
  });
  if (method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  process.stdout.write(`Jarvis personal UI fixture server: http://${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
