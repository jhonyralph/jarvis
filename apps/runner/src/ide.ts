/**
 * BRW-IDE-00 F4 — lado do RUNNER do VS Code da máquina: ciclo de vida (`ide_*`) e a ponta do túnel.
 *
 * O Hub já decidiu que é o dono (owner-only é do Hub, como no browser e no terminal); aqui só se executa.
 * Cada stream que o Hub abre no túnel vira uma conexão com o code-server em 127.0.0.1 — HTTP refeito
 * (o `Host` original vai junto) ou TCP cru para WebSocket. Um stream conta como cliente do code-server
 * enquanto está aberto: é isso que impede o desligamento por ociosidade com uma aba aberta.
 *
 * Separado do `index.ts` para o e2e do Hub poder usar a MESMA ponta do túnel com um code-server falso.
 */
import { Agent } from "node:http";
import { TunnelMux, bridgeTunnelStream, type IdeManager, type TunnelStream } from "@jarvis/core";
import type { IdeStateInfo } from "@jarvis/protocol";

/** O que este módulo usa do `IdeManager` (o e2e injeta um falso). */
export type RunnerIdeManager = Pick<IdeManager, "available" | "installed" | "state" | "install" | "cancelInstall" | "ensureRunning" | "stop" | "retain" | "release">;

export interface RunnerIdeDeps {
  manager: RunnerIdeManager;
  sendJson(obj: { t: "ide_state"; reqId?: string; state: IdeStateInfo }): void;
  sendBinary(frame: Buffer, compress: boolean): void;
  /** bytes parados no WebSocket com o Hub (ws.bufferedAmount) */
  backlog(): number;
  /** máquina drenando para atualização: não começa download novo */
  draining?: () => boolean;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export function createRunnerIde(d: RunnerIdeDeps) {
  const agent = new Agent({ keepAlive: true, maxSockets: 64 });
  let mux: TunnelMux | null = null;
  const log = (event: string, data?: Record<string, unknown>) => { try { d.log?.(event, data); } catch { /* ignore */ } };

  function reply(reqId: string | undefined, extra?: Partial<IdeStateInfo>): void {
    d.sendJson({ t: "ide_state", ...(reqId ? { reqId } : {}), state: { ...d.manager.state(), ...(extra || {}) } });
  }

  /** Mensagem JSON `ide_*` do Hub. */
  async function handleMessage(m: any): Promise<void> {
    const reqId = typeof m?.reqId === "string" ? m.reqId : undefined;
    try {
      switch (m?.t) {
        case "ide_status": reply(reqId); return;
        case "ide_install":
          if (d.draining?.()) { reply(reqId, { reason: "máquina drenando para atualização — tente de novo depois que ela reconectar" }); return; }
          d.manager.install().catch(() => { /* o estado com o motivo sai pelo onState */ });
          reply(reqId);
          return;
        case "ide_open":
          await d.manager.ensureRunning();
          reply(reqId);
          return;
        case "ide_stop":
          d.manager.cancelInstall();
          await d.manager.stop("pedido do dono");
          reply(reqId);
          return;
      }
    } catch (e: any) {
      reply(reqId, { reason: String(e?.message ?? e).slice(0, 400) });
    }
  }

  async function onStream(stream: TunnelStream): Promise<void> {
    const m = d.manager;
    if (!m.available) { stream.destroy(new Error("VS Code desligado nesta máquina")); return; }
    if (!m.installed) {
      if (stream.head.mode === "http") {
        const body = Buffer.from("O VS Code não está instalado nesta máquina. Instale pelo Jarvis.", "utf8");
        stream.respond({ status: 503, headers: ["Content-Type", "text/plain; charset=utf-8", "Content-Length", String(body.length), "Cache-Control", "no-store"] });
        stream.end(body);
        stream.resume(); // descarta o corpo do pedido (não há)
      } else stream.destroy(new Error("VS Code não instalado"));
      return;
    }
    m.retain();
    let released = false;
    stream.once("close", () => { if (!released) { released = true; m.release(); } });
    try {
      // aba reaberta depois do desligamento por ociosidade: sobe de novo (o cookie já provou o dono)
      const port = await m.ensureRunning();
      if (stream.destroyed) return;
      bridgeTunnelStream(stream, port, { agent });
    } catch (e: any) {
      stream.destroy(new Error(String(e?.message ?? e).slice(0, 200)));
    }
  }

  /** Conexão nova com o Hub: túnel novo (streams de uma conexão nunca sobrevivem a ela). */
  function onConnect(): void {
    if (mux) mux.destroyAll("reconexão");
    mux = new TunnelMux({
      role: "acceptor",
      send: (frame, compress) => d.sendBinary(frame, compress),
      backlog: () => d.backlog(),
      onStream: (s) => { void onStream(s); },
      log,
    });
  }
  function onDisconnect(): void { if (mux) { mux.destroyAll("Hub desconectado"); mux = null; } }
  /** Frame binário `kind 0x54` do Hub. */
  function onFrame(buf: Buffer): void { mux?.onFrame(buf); }
  function shutdown(): void { onDisconnect(); agent.destroy(); }
  function stats() { return mux ? mux.stats(true) : null; }

  return { handleMessage, onConnect, onDisconnect, onFrame, shutdown, stats };
}
