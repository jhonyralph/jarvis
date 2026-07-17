/**
 * Read a project file for the "view before you run it" viewer — shared by the Hub
 * (machine 0) and Runners. Resolves relative paths against the session cwd, caps
 * size, and refuses binary. Access is not restricted beyond that: anyone who can
 * drive an agent on this machine can already read its files.
 */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, basename } from "node:path";
import { homedir } from "node:os";

export interface FileContent {
  path: string;
  name: string;
  content?: string;
  size?: number;
  truncated?: boolean;
  error?: string;
  image?: boolean; // content é base64 da imagem (não texto) — o viewer renderiza <img>
  mime?: string;
}

const MAX = 512 * 1024; // 512KB (texto)
const IMG_MAX = 8 * 1024 * 1024; // 8MB (imagem; base64 infla ~33%, cabe no cap de payload do hub)
const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon", avif: "image/avif",
};

export function readProjectFile(p: string, cwd?: string): FileContent {
  let abs = p;
  try {
    abs = isAbsolute(p) ? p : join(cwd || homedir(), p);
    const st = statSync(abs);
    if (!st.isFile()) return { path: abs, name: basename(abs), error: "não é um arquivo" };
    // Imagem: NÃO recusar como "binário" — devolve base64 pra exibir no viewer/modal.
    const mime = IMG_MIME[(basename(abs).split(".").pop() || "").toLowerCase()];
    if (mime) {
      if (st.size > IMG_MAX) return { path: abs, name: basename(abs), error: "imagem grande demais para exibir (>8MB)" };
      return { path: abs, name: basename(abs), image: true, mime, content: readFileSync(abs).toString("base64"), size: st.size };
    }
    const buf = readFileSync(abs);
    const slice = buf.subarray(0, Math.min(buf.length, MAX));
    if (slice.includes(0)) return { path: abs, name: basename(abs), error: "arquivo binário (não dá para exibir)" };
    return { path: abs, name: basename(abs), content: slice.toString("utf8"), size: st.size, truncated: st.size > MAX };
  } catch (e: any) {
    return { path: abs, name: basename(abs || p), error: String(e?.message ?? e).slice(0, 200) };
  }
}
