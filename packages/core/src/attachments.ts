import { extname } from "node:path";

export interface TurnAttachment { name: string; content: string; image?: boolean; }
export interface BuiltAttachments {
  agentText: string;
  showText: string;
  images?: string[];
  files?: Array<{ name: string; content?: string }>;
}

export interface AttachmentBuildOptions {
  persistMax?: number;
  /** Persist an image and return the path the agent can read. */
  saveImage(name: string, bytes: Buffer): string | undefined;
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
  const parts: string[] = [], imagePaths: string[] = [], images: string[] = [];
  const files: Array<{ name: string; content?: string }> = [];
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
    parts.push(`--- arquivo anexado: ${name} ---\n${attachment.content}`);
    files.push({ name, content: attachment.content.length <= persistMax ? attachment.content : undefined });
  }
  if (imagePaths.length) parts.push(`Imagens anexadas — use a ferramenta de leitura para vê-las:\n${imagePaths.join("\n")}`);
  return {
    agentText: parts.length ? `${parts.join("\n\n")}\n\n${text}` : text,
    showText: text,
    images: images.length ? images : undefined,
    files: files.length ? files : undefined,
  };
}
