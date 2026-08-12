/**
 * POR QUE a fila de uma sessão não saiu.
 *
 * O caminho de despacho do Hub tem oito saídas antecipadas (atualização em andamento, despacho em
 * voo, turno anterior rodando, máquina offline, conflito de dono, reserva negada, autorização
 * mudada, entrega falha) e TODAS retornavam em silêncio deixando a fila intacta. De fora, "o Hub
 * tentou e desistiu" era indistinguível de "ninguém tentou" — foi por isso que uma fila encalhada
 * sobreviveu dias e várias investigações sem que ninguém conseguisse dizer o motivo.
 *
 * Este registro guarda o motivo corrente por sessão. Duas decisões que importam:
 *   - enquanto o motivo for o MESMO, `since` não se move: é isso que responde "parada há quanto
 *     tempo" em vez de "reavaliada há 15 segundos";
 *   - `note` devolve `changed`, para o chamador só transmitir quando o motivo mudar — a rede de
 *     segurança reavalia a cada 15s e não pode virar enxurrada de frames.
 *
 * Estado volátil de propósito: descreve o AGORA. Se sumir num restart, a próxima tentativa recalcula.
 */

export interface QueueBlock {
  /** identificador estável do motivo (para telemetria e para a UI decidir o texto). */
  code: string;
  /** frase pronta para leitura humana. */
  reason: string;
  /** desde quando a fila está parada POR ESTE motivo. */
  since: number;
  /** quantas vezes o despacho foi tentado e barrado por este mesmo motivo. */
  attempts: number;
}

export class QueueBlockRegistry {
  private readonly blocks = new Map<string, QueueBlock>();

  /** Registra (ou renova) o motivo. `changed` é true quando o motivo é novo ou diferente do anterior. */
  note(key: string, code: string, reason: string, now: number): { block: QueueBlock; changed: boolean } {
    const prev = this.blocks.get(key);
    const same = prev?.code === code;
    const block: QueueBlock = {
      code, reason,
      since: same ? prev!.since : now,
      attempts: (same ? prev!.attempts : 0) + 1,
    };
    this.blocks.set(key, block);
    return { block, changed: !same };
  }

  /** Some com o motivo (despachou, ou a fila esvaziou). true quando havia algo para limpar. */
  clear(key: string): boolean {
    return this.blocks.delete(key);
  }

  get(key: string): QueueBlock | undefined {
    const b = this.blocks.get(key);
    return b ? { ...b } : undefined;
  }

  has(key: string): boolean { return this.blocks.has(key); }
  get size(): number { return this.blocks.size; }
}
