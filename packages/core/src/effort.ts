/**
 * Nível de esforço SIMPLIFICADO para o usuário (médio / alto / máximo), mapeado para a escala REAL de
 * cada IA no momento de executar — porque cada provedor nomeia o esforço de um jeito (low/medium/high,
 * minimal…max, etc.). O usuário escolhe a intenção; aqui a traduzimos para o valor concreto do agente.
 */

export type EffortLevel = "medium" | "high" | "max";
export const EFFORT_LEVELS: EffortLevel[] = ["medium", "high", "max"];

/** Ranking canônico dos vocabulários de esforço conhecidos (menor → maior). */
const EFFORT_RANK: Record<string, number> = {
  minimal: 0, none: 0,
  low: 1, standard: 1,
  medium: 2, balanced: 2, default: 2,
  high: 3, hard: 3,
  xhigh: 4, "extra-high": 4, veryhigh: 4,
  max: 5, maximum: 5, ultra: 5, ultracode: 5, ultrathink: 5,
};

/** Normaliza uma entrada arbitrária (pt/en) para um dos três níveis; default = "medium". */
export function normalizeEffortLevel(value: unknown): EffortLevel {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "max" || s === "maximo" || s === "máximo" || s === "maximum") return "max";
  if (s === "high" || s === "alto") return "high";
  return "medium";
}

/**
 * Resolve o nível escolhido para o esforço concreto de UM agente, dada a lista de esforços que o modelo
 * dele expõe. `máximo` → o maior disponível; `alto`/`médio` → o mais próximo do alvo (empate → o maior).
 * Sem lista de esforços → cai no default do modelo (ou undefined, deixando o agente decidir).
 */
export function resolveEffortLevel(level: EffortLevel, efforts: string[] | undefined, defaultEffort?: string): string | undefined {
  const list = (efforts || []).filter(Boolean);
  if (!list.length) return defaultEffort || undefined;
  const target = level === "max" ? 5 : level === "high" ? 3 : 2;
  const ranked = list
    .map((e) => ({ e, r: EFFORT_RANK[String(e).toLowerCase()] }))
    .filter((x): x is { e: string; r: number } => typeof x.r === "number");
  if (ranked.length) {
    if (level === "max") return ranked.reduce((a, b) => (b.r >= a.r ? b : a)).e;          // maior disponível
    ranked.sort((a, b) => Math.abs(a.r - target) - Math.abs(b.r - target) || b.r - a.r);  // mais próximo; empate → maior
    return ranked[0].e;
  }
  // Vocabulário desconhecido → assume a lista ordenada do menor para o maior esforço e usa posição relativa.
  if (level === "max") return list[list.length - 1];
  return list[Math.round((list.length - 1) * (level === "high" ? 0.75 : 0.4))];
}
