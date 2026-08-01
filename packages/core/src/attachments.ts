import { extname } from "node:path";

export interface TurnAttachment {
  name: string;
  content: string;
  image?: boolean;
  binary?: boolean;
  mime?: string;
  size?: number;
}
export interface BuiltAttachments {
  agentText: string;
  showText: string;
  images?: string[];
  files?: Array<{ name: string; content?: string; path?: string; size?: number; binary?: boolean; mime?: string }>;
}

export interface AttachmentBuildOptions {
  persistMax?: number;
  inlineMax?: number;
  /** Persist an image and return the path the agent can read. */
  saveImage(name: string, bytes: Buffer): string | undefined;
  /** Persist a non-image file and return the path the agent can read. */
  saveFile?(name: string, bytes: Buffer): string | undefined;
  /** Return what the chat client can render. Hub uses /pasted; remote runners use a data URL. */
  previewImage?(name: string, bytes: Buffer, savedPath: string): string | undefined;
}

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml",
};

export function imageDataUrl(name: string, bytes: Buffer): string {
  const mime = MIME[extname(name).toLowerCase()] || "application/octet-stream";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export function buildTurnAttachments(attachments: TurnAttachment[], text: string, options: AttachmentBuildOptions): BuiltAttachments {
  if (!attachments.length) return { agentText: text, showText: text };
  const persistMax = options.persistMax ?? 256 * 1024;
  const inlineMax = options.inlineMax ?? 64 * 1024;
  const parts: string[] = [], imagePaths: string[] = [], images: string[] = [];
  const files: Array<{ name: string; content?: string; path?: string; size?: number; binary?: boolean; mime?: string }> = [];
  for (const attachment of attachments) {
    const name = String(attachment.name || (attachment.image ? "image" : "file"));
    if (attachment.image) {
      try {
        const bytes = Buffer.from(attachment.content, "base64");
        const saved = options.saveImage(name, bytes);
        if (!saved) continue;
        imagePaths.push(saved);
        const preview = options.previewImage?.(name, bytes, saved);
        if (preview) images.push(preview);
      } catch { /* invalid image attachment: omit without breaking the text turn */ }
      continue;
    }
    if (attachment.binary) {
      try {
        const bytes = Buffer.from(attachment.content, "base64");
        const saved = options.saveFile?.(name, bytes);
        if (saved) {
          parts.push([
            `--- arquivo anexado: ${name} ---`,
            `Salvo em: ${saved}`,
            `Tipo: ${attachment.mime || "application/octet-stream"} - tamanho: ${bytes.length} bytes`,
            "Use ferramentas de leitura/terminal para extrair ou analisar este arquivo; nao ha conteudo binario inline no prompt.",
          ].join("\n"));
          files.push({ name, path: saved, size: bytes.length, binary: true, mime: attachment.mime });
        } else {
          parts.push(`--- arquivo anexado: ${name} ---\nArquivo binario recebido (${bytes.length} bytes), mas este ambiente nao persistiu o anexo.`);
          files.push({ name, size: bytes.length, binary: true, mime: attachment.mime });
        }
      } catch {
        parts.push(`--- arquivo anexado: ${name} ---\nArquivo binario invalido; nao foi possivel decodificar o anexo.`);
        files.push({ name, binary: true, mime: attachment.mime });
      }
      continue;
    }
    const content = String(attachment.content ?? "");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > inlineMax && options.saveFile) {
      const saved = options.saveFile(name, Buffer.from(content, "utf8"));
      if (saved) {
        parts.push([
          `--- arquivo anexado: ${name} ---`,
          `Salvo em: ${saved}`,
          `Texto grande (${bytes} bytes). Leia o arquivo sob demanda em vez de carregar tudo no prompt.`,
        ].join("\n"));
        files.push({ name, path: saved, size: bytes, content: bytes <= persistMax ? content : undefined });
        continue;
      }
    }
    parts.push(`--- arquivo anexado: ${name} ---\n${content}`);
    files.push({ name, content: bytes <= persistMax ? content : undefined, size: bytes });
  }
  if (imagePaths.length) parts.push(`Imagens anexadas - use a ferramenta de leitura para ve-las:\n${imagePaths.join("\n")}`);
  return {
    agentText: parts.length ? `${parts.join("\n\n")}\n\n${text}` : text,
    showText: text,
    images: images.length ? images : undefined,
    files: files.length ? files : undefined,
  };
}
