/**
 * Decide o que o guarda do event loop faz depois de uma trava longa.
 *
 * O guarda mede o atraso no tique SEGUINTE à trava — ou seja, quando ele decide, o Hub JÁ voltou a
 * responder. Até 2026-10-26 ele encerrava o Hub nesse momento: um Hub recuperado ganhava um boot inteiro
 * (15 a 229 s) e perdia os turnos em andamento. Em 26/10, 3 das 6 quedas foram só isso (travas de
 * 48, 62 e 66 s, já resolvidas; o watchdog externo só mata depois de ~120 s sem resposta).
 *
 * Agora: trava longa isolada = "recovered" (registra; o stall forensics já gravou ONDE travou). Só
 * quando as travas longas se REPETEM dentro da janela o Hub é reiniciado ("exit") — aí o estado está
 * degradado e um processo novo vale o boot. `repeat = 1` reproduz o comportamento antigo.
 */
export type LoopStallVerdict = "ignore" | "recovered" | "exit";

export interface LoopStallPolicyOptions {
  /** atraso a partir do qual a trava conta como longa (ms) */
  limitMs: number;
  /** quantas travas longas dentro da janela reiniciam o Hub */
  repeat: number;
  /** janela da contagem (ms) */
  windowMs: number;
}

export class LoopStallPolicy {
  private readonly stalls: number[] = [];

  constructor(readonly opts: LoopStallPolicyOptions) {}

  /** Uma medição de atraso do event loop; devolve o veredito e quantas travas longas há na janela. */
  record(now: number, lagMs: number): { verdict: LoopStallVerdict; recent: number } {
    if (lagMs < this.opts.limitMs) return { verdict: "ignore", recent: this.prune(now) };
    this.stalls.push(now);
    const recent = this.prune(now);
    return { verdict: recent >= Math.max(1, this.opts.repeat) ? "exit" : "recovered", recent };
  }

  private prune(now: number): number {
    while (this.stalls.length && now - this.stalls[0] > this.opts.windowMs) this.stalls.shift();
    return this.stalls.length;
  }
}
