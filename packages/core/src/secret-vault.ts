/**
 * Cofre LOCAL de segredos: cola o token na configuração e pronto — sem caçar arquivo .env.
 *
 * A decisão de desenho: o `secretRef` (nome de env var) continua sendo o ÚNICO contrato de quem
 * consome segredo (conexões de tarefa, fontes pessoais…). O cofre só muda de onde o valor vem:
 * o Hub carrega este arquivo para `process.env` no boot e a UI grava aqui na hora — a env var
 * "existe" imediatamente, sem restart. Ambiente EXPLÍCITO sempre vence o cofre: quem define a
 * variável de verdade (serviço, shell, .env próprio) não é atropelado pelo arquivo.
 *
 * Postura de segurança, dita sem eufemismo: o valor fica em texto plano em
 * `~/.jarvis/hub/secrets.json` (fora de qualquer repositório), com chmod 0600 best-effort — a
 * mesma prática do gh (`hosts.yml`), aws e npm CLIs. Keychain do SO continua no plano como
 * evolução (C5). `names()`/`has()` nunca expõem valores; a leitura existe só para injetar no env.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "./persist.js";

const JARVIS_HOME = process.env.JARVIS_HOME || homedir();
const NAME_RE = /^[A-Z][A-Z0-9_]{2,80}$/;
const VALUE_CAP = 4_000;

/** Nome de env var derivado de um id legível ("github:github-acme" → JARVIS_SECRET_GITHUB_GITHUB_ACME). */
export function secretNameFor(id: string, suffix = ""): string {
  const base = String(id ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "SEGREDO";
  return `JARVIS_SECRET_${base}${suffix ? `_${suffix}` : ""}`;
}

interface VaultFile { version: 1; secrets: Record<string, { value: string; updatedAt: number }> }

export class SecretVault {
  private readonly file: string;
  private readonly now: () => number;
  private data: VaultFile = { version: 1, secrets: {} };

  constructor(opts: { dir?: string; now?: () => number } = {}) {
    const dir = opts.dir || join(JARVIS_HOME, ".jarvis", "hub");
    this.file = join(dir, "secrets.json");
    this.now = opts.now || (() => Date.now());
    mkdirSync(dir, { recursive: true });
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, "utf8"));
        if (raw?.version === 1 && raw.secrets && typeof raw.secrets === "object") this.data = { version: 1, secrets: raw.secrets };
      } catch { /* cofre ilegível: recomeça vazio — re-colar é barato, vazar não seria */ }
    }
  }

  private persist(): void {
    writeJsonAtomic(this.file, this.data, { pretty: true });
    try { chmodSync(this.file, 0o600); } catch { /* Windows: ACL do perfil do usuário já restringe */ }
  }

  names(): string[] { return Object.keys(this.data.secrets).sort(); }
  has(name: string): boolean { return Object.prototype.hasOwnProperty.call(this.data.secrets, String(name || "")); }

  set(name: string, value: string): void {
    const key = String(name || "").trim();
    if (!NAME_RE.test(key)) throw new Error("nome inválido: use MAIÚSCULAS, dígitos e _ (3–80 caracteres, começa com letra)");
    const v = String(value ?? "");
    if (!v.trim()) throw new Error("o segredo não pode ser vazio");
    if (v.length > VALUE_CAP) throw new Error(`segredo grande demais (máx. ${VALUE_CAP} caracteres)`);
    if (/[\r\n]/.test(v)) throw new Error("o segredo não pode ter quebra de linha");
    this.data.secrets[key] = { value: v, updatedAt: this.now() };
    this.persist();
  }

  remove(name: string): boolean {
    const key = String(name || "");
    if (!this.has(key)) return false;
    delete this.data.secrets[key];
    this.persist();
    return true;
  }

  /**
   * Injeta no env do processo os segredos que ainda NÃO existem lá. Ambiente explícito vence o
   * cofre — e `set()` de um nome já injetado por esta carga ATUALIZA o env na hora (rotação sem
   * restart), porque o dono daquele valor é o cofre.
   */
  loadIntoEnv(env: NodeJS.ProcessEnv): { loaded: string[]; skipped: string[] } {
    const loaded: string[] = [], skipped: string[] = [];
    for (const [name, row] of Object.entries(this.data.secrets)) {
      if (env[name] !== undefined && env[name] !== "") skipped.push(name);
      else { env[name] = row.value; loaded.push(name); }
    }
    return { loaded: loaded.sort(), skipped: skipped.sort() };
  }
}
