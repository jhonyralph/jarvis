import { existsSync, statSync } from "node:fs";
import { hostname, platform } from "node:os";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import type { TerminalInfo } from "@jarvis/protocol";

export interface TerminalOpenInput {
  cwd?: string;
  shell?: string;
  title?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalManagerOptions {
  defaultCwd: string;
  max?: number;
  onOutput: (terminal: TerminalInfo, data: string) => void;
  onExit: (terminal: TerminalInfo, exitCode?: number, signal?: number) => void;
}

interface ManagedTerminal {
  info: TerminalInfo;
  proc: pty.IPty;
}

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
};

function validCwd(candidate: unknown, fallback: string): string {
  const cwd = typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback;
  try { if (existsSync(cwd) && statSync(cwd).isDirectory()) return cwd; } catch { /* invalid */ }
  return fallback;
}

function defaultShell(): { shell: string; args: string[] } {
  if (platform() === "win32") return { shell: process.env.JARVIS_TERMINAL_SHELL || "powershell.exe", args: ["-NoLogo"] };
  const shell = process.env.JARVIS_TERMINAL_SHELL || process.env.SHELL || "bash";
  return { shell, args: [] };
}

function safeTitle(input: TerminalOpenInput, cwd: string, shell: string): string {
  const raw = typeof input.title === "string" ? input.title.trim() : "";
  const title = raw || `${basename(cwd) || hostname()} · ${basename(shell) || shell}`;
  return title.slice(0, 80);
}

export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();
  private readonly max: number;

  constructor(private readonly opts: TerminalManagerOptions) {
    this.max = Math.max(1, opts.max || 4);
  }

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((t) => ({ ...t.info })).sort((a, b) => a.createdAt - b.createdAt);
  }

  open(input: TerminalOpenInput = {}): TerminalInfo {
    if (this.terminals.size >= this.max) throw new Error(`limite de ${this.max} terminais ativos atingido nesta máquina`);
    const def = defaultShell();
    const cwd = validCwd(input.cwd, this.opts.defaultCwd);
    const shell = typeof input.shell === "string" && input.shell.trim() ? input.shell.trim() : def.shell;
    const args = shell === def.shell ? def.args : [];
    const cols = clamp(input.cols, 100, 20, 300);
    const rows = clamp(input.rows, 30, 8, 120);
    const now = Date.now();
    const info: TerminalInfo = { id: randomUUID(), title: safeTitle(input, cwd, shell), cwd, shell, cols, rows, createdAt: now, updatedAt: now };
    const proc = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });
    const managed: ManagedTerminal = { info, proc };
    this.terminals.set(info.id, managed);
    proc.onData((data) => {
      info.updatedAt = Date.now();
      this.opts.onOutput({ ...info }, data);
    });
    proc.onExit(({ exitCode, signal }) => {
      if (this.terminals.get(info.id)?.proc === proc) this.terminals.delete(info.id);
      info.updatedAt = Date.now();
      this.opts.onExit({ ...info }, exitCode, signal);
    });
    return { ...info };
  }

  input(id: string, data: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    terminal.info.updatedAt = Date.now();
    terminal.proc.write(data);
    return true;
  }

  resize(id: string, cols: unknown, rows: unknown): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    terminal.info.cols = clamp(cols, terminal.info.cols, 20, 300);
    terminal.info.rows = clamp(rows, terminal.info.rows, 8, 120);
    terminal.info.updatedAt = Date.now();
    terminal.proc.resize(terminal.info.cols, terminal.info.rows);
    return true;
  }

  close(id: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    try { terminal.proc.kill(); } catch { /* exit event handles cleanup when available */ }
    this.terminals.delete(id);
    return true;
  }

  closeAll(): void {
    for (const id of [...this.terminals.keys()]) this.close(id);
  }
}
