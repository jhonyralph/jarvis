/**
 * Medição contínua da máquina — CAP-01 fase F1 (docs/specs/CAP-01-capacidade-adaptativa.md, R2/R13).
 *
 * Só MEDE e REGISTRA: nada aqui decide se um turno começa. A F3 vai admitir trabalho pela folga; antes
 * disso precisamos dos números reais desta máquina no dia a dia (R1: nada fixo).
 *
 * O que se mede, a cada `sampleMs` (padrão 5 s), fora do caminho de qualquer pedido:
 *  - memória física disponível e total;
 *  - memória COMPROMETIDA usada e o limite — é ela que esgota primeiro e derruba tudo no Windows
 *    (INC-01, vite órfãos), mesmo com memória física sobrando;
 *  - CPU da máquina (pelos contadores do próprio Node: barato e síncrono-trivial);
 *  - atraso do event loop do Hub (`monitorEventLoopDelay`, que mede sem custo por amostra).
 *
 * A cada `summaryMs` (padrão 60 s) sai um resumo (mín./média/máx.) para o log — uma linha por minuto,
 * não 12. A folga calculada aqui (R5, com a reserva do dono D1) é só número no log por enquanto.
 *
 * Memória comprometida no Windows: o Node não tem API e os contadores (`typeperf`) têm nome traduzido
 * no Windows em português. Um PowerShell fica aberto e chama `GlobalMemoryStatusEx` (kernel32) a cada
 * pedido no stdin — microssegundos por amostra. Se o Hub morre, o stdin fecha e ele sai sozinho.
 * No Linux vem de /proc/meminfo; nos demais sistemas só a memória física.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

const MB = 1024 * 1024;

export interface MemoryReading {
  totalPhysMb: number;
  availPhysMb: number;
  /** Limite de memória comprometida (física + arquivo de paginação). Ausente onde não dá para medir. */
  commitLimitMb?: number;
  commitUsedMb?: number;
}

export interface MachineSample extends MemoryReading {
  t: number;
  /** CPU da máquina inteira desde a amostra anterior, 0–100. */
  cpuPct?: number;
}

export interface Headroom {
  /** Folga de memória física descontada a reserva do dono. Pode ser negativa. */
  physMb: number;
  /** Idem para a memória comprometida (ausente onde não é medida). */
  commitMb?: number;
  /** O menor dos dois — o que a F3 vai comparar com o custo de um turno. */
  mb: number;
}

/** R5 + D1: folga = disponível − reserva do dono (padrão 20% do TOTAL de cada tipo de memória). */
export function headroom(m: MemoryReading, reservePct = 20): Headroom {
  const r = Math.min(Math.max(reservePct, 0), 90) / 100;
  const physMb = Math.round(m.availPhysMb - m.totalPhysMb * r);
  const commitMb = m.commitLimitMb != null && m.commitUsedMb != null
    ? Math.round(m.commitLimitMb - m.commitUsedMb - m.commitLimitMb * r) : undefined;
  return { physMb, commitMb, mb: commitMb == null ? physMb : Math.min(physMb, commitMb) };
}

export interface CapacitySummary {
  /** Janela do resumo. */
  from: number;
  to: number;
  samples: number;
  totalPhysMb?: number;
  availPhysMbMin?: number;
  availPhysMbAvg?: number;
  commitLimitMb?: number;
  commitUsedMbMax?: number;
  commitUsedMbAvg?: number;
  cpuPctAvg?: number;
  cpuPctMax?: number;
  /** Atraso do event loop do Hub na janela (ms). */
  loopLagP99Ms?: number;
  loopLagMaxMs?: number;
  /** Menor folga vista na janela (R5, já sem a reserva do dono). */
  headroomMbMin?: number;
  reservePct: number;
  /** Amostras em que a leitura de memória falhou (provedor fora do ar). */
  failures: number;
}

const avg = (v: number[]) => v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : undefined;
const min = (v: number[]) => v.length ? Math.min(...v) : undefined;
const max = (v: number[]) => v.length ? Math.max(...v) : undefined;

/** Resume uma janela de amostras. Puro — o teste e o relatório usam o mesmo cálculo. */
export function summarize(samples: MachineSample[], opts: { from: number; to: number; reservePct: number; failures?: number; lag?: { p99Ms?: number; maxMs?: number } }): CapacitySummary {
  const phys = samples.map((s) => s.availPhysMb);
  const commit = samples.flatMap((s) => s.commitUsedMb == null ? [] : [s.commitUsedMb]);
  const cpu = samples.flatMap((s) => s.cpuPct == null ? [] : [s.cpuPct]);
  const last = samples.at(-1);
  return {
    from: opts.from, to: opts.to, samples: samples.length,
    totalPhysMb: last?.totalPhysMb, availPhysMbMin: min(phys), availPhysMbAvg: avg(phys),
    commitLimitMb: last?.commitLimitMb, commitUsedMbMax: max(commit), commitUsedMbAvg: avg(commit),
    cpuPctAvg: avg(cpu), cpuPctMax: max(cpu),
    loopLagP99Ms: opts.lag?.p99Ms, loopLagMaxMs: opts.lag?.maxMs,
    headroomMbMin: min(samples.map((s) => headroom(s, opts.reservePct).mb)),
    reservePct: opts.reservePct, failures: opts.failures ?? 0,
  };
}

/** CPU da máquina entre duas leituras de `os.cpus()` (soma de todos os núcleos). */
export function cpuPercent(prev: ReturnType<typeof cpus>, next: ReturnType<typeof cpus>): number | undefined {
  let idle = 0, total = 0;
  for (let i = 0; i < Math.min(prev.length, next.length); i++) {
    const a = prev[i].times, b = next[i].times;
    const ta = a.user + a.nice + a.sys + a.idle + a.irq, tb = b.user + b.nice + b.sys + b.idle + b.irq;
    total += tb - ta; idle += b.idle - a.idle;
  }
  if (total <= 0) return undefined;
  return Math.round(Math.min(100, Math.max(0, (1 - idle / total) * 100)));
}

/** /proc/meminfo → leitura (Linux). Exportado para teste. */
export function parseMeminfo(text: string): MemoryReading | null {
  const kb = (key: string) => { const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m").exec(text); return m ? Number(m[1]) / 1024 : undefined; };
  const total = kb("MemTotal"), avail = kb("MemAvailable"), limit = kb("CommitLimit"), used = kb("Committed_AS");
  if (total == null || avail == null) return null;
  return { totalPhysMb: Math.round(total), availPhysMb: Math.round(avail),
    commitLimitMb: limit == null ? undefined : Math.round(limit), commitUsedMb: used == null ? undefined : Math.round(used) };
}

/** Linha do PowerShell (`GlobalMemoryStatusEx`, em bytes) → leitura. Exportado para teste. */
export function parseWindowsMemLine(line: string): MemoryReading | null {
  try {
    const o = JSON.parse(line) as Record<string, number>;
    if (![o.totalPhys, o.availPhys, o.commitLimit, o.commitAvail].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    return { totalPhysMb: Math.round(o.totalPhys / MB), availPhysMb: Math.round(o.availPhys / MB),
      commitLimitMb: Math.round(o.commitLimit / MB), commitUsedMb: Math.round((o.commitLimit - o.commitAvail) / MB) };
  } catch { return null; }
}

// ullTotalPageFile/ullAvailPageFile do GlobalMemoryStatusEx são o limite e o disponível de memória
// comprometida (não o arquivo de paginação em si) — os mesmos números de CommitLimit/CommittedBytes.
const WINDOWS_PROBE = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JarvisMem {
  [StructLayout(LayoutKind.Sequential)]
  public struct MEMORYSTATUSEX {
    public uint dwLength; public uint dwMemoryLoad;
    public ulong ullTotalPhys; public ulong ullAvailPhys;
    public ulong ullTotalPageFile; public ulong ullAvailPageFile;
    public ulong ullTotalVirtual; public ulong ullAvailVirtual; public ulong ullAvailExtendedVirtual;
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);
  public static string Sample() {
    var m = new MEMORYSTATUSEX(); m.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
    if (!GlobalMemoryStatusEx(ref m)) return "{}";
    return "{\\"totalPhys\\":" + m.ullTotalPhys + ",\\"availPhys\\":" + m.ullAvailPhys + ",\\"commitLimit\\":" + m.ullTotalPageFile + ",\\"commitAvail\\":" + m.ullAvailPageFile + "}";
  }
}
"@
while ($null -ne ($line = [Console]::In.ReadLine())) { [Console]::Out.WriteLine([JarvisMem]::Sample()); [Console]::Out.Flush() }
`;

/**
 * Sonda do Windows: um PowerShell de vida longa; cada `read()` escreve uma linha no stdin e espera a
 * resposta. Morreu ou travou → a leitura cai para a memória física do Node e a sonda renasce na
 * próxima, com espera crescente (não fica relançando PowerShell em laço).
 */
export class WindowsMemoryProbe {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private waiting: Array<(line: string | null) => void> = [];
  private nextSpawnAt = 0;
  private failures = 0;
  constructor(private readonly opts: { timeoutMs?: number; spawnImpl?: typeof spawn } = {}) {}

  private start(): ChildProcessWithoutNullStreams | null {
    if (this.child) return this.child;
    if (Date.now() < this.nextSpawnAt) return null;
    try {
      const child = (this.opts.spawnImpl ?? spawn)("powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(WINDOWS_PROBE, "utf16le").toString("base64")],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d: string) => {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
          if (line.startsWith("{")) this.waiting.shift()?.(line);
        }
      });
      child.stderr.resume();
      const gone = () => { if (this.child === child) this.fail(); };
      child.on("exit", gone); child.on("error", gone);
      child.stdin.on("error", () => { /* fechado: o "exit" trata */ });
      this.child = child;
      return child;
    } catch { this.fail(); return null; }
  }

  private fail(): void {
    const child = this.child;
    this.child = null; this.buf = "";
    for (const w of this.waiting.splice(0)) w(null);
    try { child?.kill(); } catch { /* já saiu */ }
    this.failures++;
    this.nextSpawnAt = Date.now() + Math.min(10 * 60_000, 5_000 * 2 ** Math.min(this.failures, 7));
  }

  read(): Promise<MemoryReading | null> {
    const child = this.start();
    if (!child) return Promise.resolve(null);
    return new Promise((resolve) => {
      // A 1ª leitura compila o tipo (Add-Type): pode levar alguns segundos com antivírus.
      const timer = setTimeout(() => { const i = this.waiting.indexOf(done); if (i >= 0) this.waiting.splice(i, 1); this.fail(); resolve(null); }, this.opts.timeoutMs ?? 30_000);
      const done = (line: string | null) => {
        clearTimeout(timer);
        const r = line ? parseWindowsMemLine(line) : null;
        if (r) this.failures = 0;
        resolve(r);
      };
      this.waiting.push(done);
      try { child.stdin.write("x\n"); } catch { this.fail(); }
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    for (const w of this.waiting.splice(0)) w(null);
    try { child?.stdin.end(); } catch { /* ignore */ }
    try { child?.kill(); } catch { /* ignore */ }
  }
}

/** Provedor de memória da plataforma atual, sempre assíncrono (R2: medir não pode travar o Hub). */
export function platformMemoryReader(): { read: () => Promise<MemoryReading | null>; stop: () => void } {
  const fallback = (): MemoryReading => ({ totalPhysMb: Math.round(totalmem() / MB), availPhysMb: Math.round(freemem() / MB) });
  if (process.platform === "win32") {
    const probe = new WindowsMemoryProbe();
    return { read: async () => (await probe.read()) ?? null, stop: () => probe.stop() };
  }
  if (process.platform === "linux") {
    return { read: async () => { try { return parseMeminfo(await readFile("/proc/meminfo", "utf8")) ?? fallback(); } catch { return fallback(); } }, stop: () => {} };
  }
  return { read: async () => fallback(), stop: () => {} };
}

export interface MachineSamplerOptions {
  sampleMs?: number;
  summaryMs?: number;
  reservePct?: number;
  onSummary: (s: CapacitySummary) => void;
  /** Injetáveis para teste. */
  memory?: { read: () => Promise<MemoryReading | null>; stop: () => void };
  cpuTimes?: () => ReturnType<typeof cpus>;
  now?: () => number;
  /** false desliga a medição do event loop (teste). */
  loopLag?: boolean;
}

/** Junta tudo: amostra periódica + resumo periódico. `stop()` encerra o PowerShell e os timers. */
export class MachineSampler {
  private readonly window: MachineSample[] = [];
  private failures = 0;
  private windowFrom: number;
  private prevCpu: ReturnType<typeof cpus> | null = null;
  private timers: NodeJS.Timeout[] = [];
  private busy = false;
  private latestSample: MachineSample | null = null;
  private readonly memory: { read: () => Promise<MemoryReading | null>; stop: () => void };
  private readonly lag: ReturnType<typeof monitorEventLoopDelay> | null;
  private readonly now: () => number;

  constructor(private readonly opts: MachineSamplerOptions) {
    this.now = opts.now ?? Date.now;
    this.windowFrom = this.now();
    this.memory = opts.memory ?? platformMemoryReader();
    this.lag = opts.loopLag === false ? null : monitorEventLoopDelay({ resolution: 20 });
  }

  start(): this {
    this.lag?.enable();
    const sampleMs = Math.max(1_000, this.opts.sampleMs ?? 5_000), summaryMs = Math.max(sampleMs, this.opts.summaryMs ?? 60_000);
    const a = setInterval(() => { void this.sample(); }, sampleMs), b = setInterval(() => this.flush(), summaryMs);
    a.unref?.(); b.unref?.();
    this.timers.push(a, b);
    void this.sample();
    return this;
  }

  /** Uma amostra. Exposto para teste; a medição em andamento não se sobrepõe a si mesma. */
  async sample(): Promise<MachineSample | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const mem = await this.memory.read().catch(() => null);
      const times = (this.opts.cpuTimes ?? cpus)();
      const cpuPct = this.prevCpu ? cpuPercent(this.prevCpu, times) : undefined;
      this.prevCpu = times;
      if (!mem) { this.failures++; return null; }
      const s: MachineSample = { t: this.now(), ...mem, cpuPct };
      this.window.push(s);
      this.latestSample = s;
      return s;
    } finally { this.busy = false; }
  }

  /** Fecha a janela e entrega o resumo (sem amostras e sem falhas, não registra nada). */
  flush(): CapacitySummary | null {
    const to = this.now();
    const ns = 1e6;
    const lag = this.lag && this.lag.count > 0 ? { p99Ms: Math.round(this.lag.percentile(99) / ns), maxMs: Math.round(this.lag.max / ns) } : undefined;
    const samples = this.window.splice(0), failures = this.failures;
    this.failures = 0;
    this.lag?.reset();
    const from = this.windowFrom; this.windowFrom = to;
    if (!samples.length && !failures) return null;
    const summary = summarize(samples, { from, to, reservePct: this.opts.reservePct ?? 20, failures, lag });
    try { this.opts.onSummary(summary); } catch { /* registrar nunca derruba quem mede */ }
    return summary;
  }

  latest(): MachineSample | null { return this.latestSample; }

  stop(): void {
    for (const t of this.timers.splice(0)) clearInterval(t);
    this.lag?.disable();
    this.memory.stop();
  }
}
