/**
 * Retenção do áudio de voz (VOZ-00, fase F3).
 *
 * RN-G2: guardar serve para UMA coisa — não perder fala quando a transcrição ou a conexão falham.
 * Não é arquivo nem histórico. Por isso o padrão apaga o áudio assim que a transcrição sai ("só até
 * dar certo"): no uso normal o espaço ocupado fica perto de zero e só as falhas permanecem.
 *
 * RN-G4: modo, prazo e espaço são configuráveis, no Hub e no aparelho. Esta é a regra pura que
 * decide o que apagar — o Hub e o aparelho só listam o que têm e apagam o que ela mandar.
 */

export type AudioRetentionMode = "until_done" | "days" | "off";

export interface AudioRetention {
  /** só até dar certo · guardar por N dias · não guardar. */
  mode: AudioRetentionMode;
  /** Prazo das falas que falharam (e de tudo, no modo "days"). */
  days: number;
  /** Teto de espaço no Hub, em MB. */
  maxMb: number;
  /** Teto de espaço no aparelho, em MB. */
  deviceMb: number;
  /** RN-G5: taxa de gravação, em bits por segundo. */
  bitrate: number;
}

export const DEFAULT_AUDIO_RETENTION: AudioRetention = { mode: "until_done", days: 7, maxMb: 200, deviceMb: 50, bitrate: 32_000 };

const clampNum = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function normalizeAudioRetention(raw: unknown): AudioRetention {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_AUDIO_RETENTION;
  return {
    mode: r.mode === "days" || r.mode === "off" ? r.mode : "until_done",
    days: Math.round(clampNum(r.days, 1, 90, d.days)),
    maxMb: Math.round(clampNum(r.maxMb, 10, 10_000, d.maxMb)),
    deviceMb: Math.round(clampNum(r.deviceMb, 5, 2_000, d.deviceMb)),
    // 16 kbit/s já é inteligível para fala em Opus; acima de 128 kbit/s só gasta espaço e envio.
    bitrate: Math.round(clampNum(r.bitrate, 16_000, 128_000, d.bitrate)),
  };
}

/** `pending` = salvo e ainda não transcrito; `failed` = a transcrição falhou; `done` = transcrito. */
export type StoredAudioStatus = "pending" | "failed" | "done";

export interface StoredAudioInfo { id: string; bytes: number; at: number; status: StoredAudioStatus }

/** Um pendente mais velho que isto ficou para trás (o processo caiu no meio) e conta como falha. */
export const STALE_PENDING_MS = 60 * 60_000;

/** Ids a apagar, dado o que está guardado, a política e o relógio. Nunca apaga o que está em
 *  processamento recente (pendente com menos de uma hora) — a não ser no modo "não guardar". */
export function planAudioCleanup(items: StoredAudioInfo[], policy: AudioRetention, now: number, capMb = policy.maxMb): string[] {
  if (policy.mode === "off") return items.map((i) => i.id);
  const maxAge = policy.days * 24 * 60 * 60_000;
  const doomed = new Set<string>();
  for (const it of items) {
    const age = now - it.at;
    if (policy.mode === "until_done" && it.status === "done") doomed.add(it.id);
    else if (age > maxAge) doomed.add(it.id);
  }
  // Teto de espaço: apaga primeiro o que já deu certo, depois o mais velho. Pendente recente fica.
  const budget = capMb * 1024 * 1024;
  let total = items.filter((i) => !doomed.has(i.id)).reduce((sum, i) => sum + i.bytes, 0);
  if (total > budget) {
    const order = items
      .filter((i) => !doomed.has(i.id) && !(i.status === "pending" && now - i.at < STALE_PENDING_MS))
      .sort((a, b) => (a.status === "done" ? 0 : 1) - (b.status === "done" ? 0 : 1) || a.at - b.at);
    for (const it of order) {
      if (total <= budget) break;
      doomed.add(it.id); total -= it.bytes;
    }
  }
  return items.filter((i) => doomed.has(i.id)).map((i) => i.id);
}
