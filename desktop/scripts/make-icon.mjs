// Gera desktop/build/icon.png (1024x1024) a partir de apps/hub/web/icon.svg.
//
// Por que assim: o electron-builder precisa de PNG/ICO/ICNS (não aceita SVG), e o repo não tem
// nenhum bitmap nem dependência de conversão de imagem. Em vez de adicionar sharp/imagemagick só
// para isso, renderizamos com o Electron que JÁ está instalado aqui — offscreen, sem abrir janela.
// A mesma arte do PWA vira o ícone do app nativo, então o Jarvis fica reconhecível no menu Iniciar,
// no Launchpad e no menu de aplicativos do Linux.
//
// Uso: npm run icon    (dentro de desktop/)

import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SVG = join(HERE, "..", "..", "apps", "hub", "web", "icon.svg");
const OUT_DIR = join(HERE, "..", "build");
const OUT = join(OUT_DIR, "icon.png");
const SIZE = 1024;

app.disableHardwareAcceleration(); // determinístico e funciona em máquina sem GPU/monitor (CI)

await app.whenReady();

const svg = readFileSync(SVG, "utf8");
// O SVG é embutido como data URI num HTML de fundo transparente e tamanho exato — evita depender
// de caminho de arquivo/permissão e mantém o render previsível.
const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>
${svg.replace(/<svg([^>]*)width="[^"]*"([^>]*)height="[^"]*"/, `<svg$1width="${SIZE}"$2height="${SIZE}"`)}`;

const win = new BrowserWindow({
  width: SIZE, height: SIZE, show: false, frame: false, transparent: true,
  webPreferences: { offscreen: true, sandbox: true },
});
await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
// Um tick após o load: o SVG tem gradientes, e capturar cedo demais pega um frame vazio.
await new Promise((r) => setTimeout(r, 400));

const image = await win.capturePage();
const png = image.toPNG();
if (png.length < 1000) { console.error("render saiu vazio — abortando"); app.exit(1); }

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, png);
console.log(`icone gerado: ${OUT} (${image.getSize().width}x${image.getSize().height}, ${png.length} bytes)`);
app.exit(0);
