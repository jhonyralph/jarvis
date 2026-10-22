/**
 * Áudio de voz guardado no Hub antes de transcrever (VOZ-00, fase F3 — RN-G1..G4).
 *
 * Cada fala vira dois arquivos em ~/.jarvis/voice-audio: `<id>.audio` (bytes como chegaram) e
 * `<id>.json` (status e o que é preciso para reprocessar). Se a transcrição falha ou estoura o tempo,
 * o áudio continua aqui e pode ser reprocessado sem o usuário repetir. O que apagar e quando é
 * decidido pela regra pura `planAudioCleanup` (core), a partir da política do dono.
 *
 * Arquivos pequenos (dezenas a centenas de KB) e gravados uma vez por fala: E/S síncrona aqui não
 * pesa no event loop do jeito que as leituras de GB dos incidentes INC-02/03 pesavam.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planAudioCleanup, type AudioRetention, type StoredAudioInfo, type StoredAudioStatus } from "@jarvis/core";

const ID_RX = /^[A-Za-z0-9_-]{6,64}$/;
const EXT_RX = /^[a-z0-9]{1,5}$/i;

export interface StoredVoiceMeta {
  id: string;
  ext: string;
  at: number;
  status: StoredAudioStatus;
  bytes: number;
  sessionId: string;
  runnerId: string;
  /** Dono do turno: só ele pode pedir para reprocessar. */
  principal: string;
  /** Opções do envio original (falar a resposta, modelo...), para reprocessar igual. */
  opts: Record<string, unknown>;
  error?: string;
}

export class VoiceAudioStore {
  constructor(private readonly dir: string) {}

  private paths(id: string): { audio: string; meta: string } {
    return { audio: join(this.dir, `${id}.audio`), meta: join(this.dir, `${id}.json`) };
  }

  /** Guarda o áudio ANTES de qualquer processamento. Id inválido não é guardado (devolve false). */
  save(meta: Omit<StoredVoiceMeta, "status" | "bytes" | "at"> & { at?: number }, audio: Buffer): boolean {
    if (!ID_RX.test(meta.id)) return false;
    try {
      mkdirSync(this.dir, { recursive: true });
      const p = this.paths(meta.id);
      writeFileSync(p.audio, audio);
      const full: StoredVoiceMeta = { ...meta, ext: EXT_RX.test(meta.ext) ? meta.ext : "webm", at: meta.at ?? Date.now(), status: "pending", bytes: audio.length };
      writeFileSync(p.meta, JSON.stringify(full));
      return true;
    } catch { return false; }
  }

  get(id: unknown): StoredVoiceMeta | undefined {
    if (typeof id !== "string" || !ID_RX.test(id)) return undefined;
    try { return JSON.parse(readFileSync(this.paths(id).meta, "utf8")) as StoredVoiceMeta; } catch { return undefined; }
  }

  /** Bytes do áudio guardado, se ainda existir. */
  audio(id: string): Buffer | undefined {
    if (!ID_RX.test(id)) return undefined;
    try { return readFileSync(this.paths(id).audio); } catch { return undefined; }
  }

  mark(id: string, status: StoredAudioStatus, error?: string): void {
    const meta = this.get(id); if (!meta) return;
    try { writeFileSync(this.paths(id).meta, JSON.stringify({ ...meta, status, ...(error ? { error } : {}) })); } catch { /* best effort */ }
  }

  remove(id: string): void {
    if (!ID_RX.test(id)) return;
    const p = this.paths(id);
    for (const f of [p.audio, p.meta]) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
  }

  list(): StoredAudioInfo[] {
    let names: string[] = [];
    try { names = readdirSync(this.dir).filter((n) => n.endsWith(".json")); } catch { return []; }
    const out: StoredAudioInfo[] = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      const meta = this.get(id);
      if (meta) { out.push({ id, bytes: meta.bytes, at: meta.at, status: meta.status }); continue; }
      // Metadado ilegível: conta o áudio solto como falha antiga para a retenção limpar.
      try { const st = statSync(join(this.dir, `${id}.audio`)); out.push({ id, bytes: st.size, at: st.mtimeMs, status: "failed" }); } catch { this.remove(id); }
    }
    // Áudio sem metadado (o processo caiu entre as duas gravações).
    try {
      for (const name of readdirSync(this.dir)) {
        if (!name.endsWith(".audio")) continue;
        const id = name.slice(0, -6);
        if (existsSync(join(this.dir, `${id}.json`))) continue;
        try { const st = statSync(join(this.dir, name)); out.push({ id, bytes: st.size, at: st.mtimeMs, status: "failed" }); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return out;
  }

  /** Aplica a política: apaga o que a regra mandar. Devolve quantos foram apagados. */
  sweep(policy: AudioRetention, now = Date.now()): number {
    const ids = planAudioCleanup(this.list(), policy, now);
    for (const id of ids) this.remove(id);
    return ids.length;
  }
}
