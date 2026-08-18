/**
 * Cofre de conexões (C1) + resolução com regra de ouro (C2).
 *
 * Uma CONEXÃO é uma conta em um provedor: rótulo, config não-sensível, secretRef (o NOME da env var
 * — nunca o valor) e a IDENTIDADE VERIFICADA na última checagem. N contas do mesmo provedor
 * convivem como conexões distintas; o vínculo por pasta decide qual vale em cada projeto.
 *
 * Regra de ouro (C2): operação de tarefa NUNCA usa "conexão padrão". Ou o projeto tem vínculo
 * apontando para uma conexão permitida e com segredo presente, ou a operação é recusada com um
 * motivo acionável — o board errado deixa de ser um desfecho possível.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "./persist.js";
import { taskProviderSpec, type TaskIdentity } from "./task-providers.js";
import type { ProjectTaskBinding } from "./task-link.js";

export interface TaskConnection {
  id: string;
  provider: string;
  /** rótulo humano ("GitHub pessoal", "Linear ACME") — nunca é a fonte da verdade de identidade. */
  label: string;
  /** config não-sensível do provedor (baseUrl, email, org…). */
  config: Record<string, string>;
  /** NOME da env var com o segredo (e o segundo, quando o provedor exige dois). */
  secretRef: string;
  secretRef2?: string;
  identity?: TaskIdentity;
  lastVerifiedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

const clean = (v: unknown, cap = 200): string => String(v ?? "").trim().slice(0, cap);
const slug = (v: unknown): string => clean(v, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, "");
/** rótulo → pedaço de id legível: "GitHub ACME" vira "github-acme", nunca "githubacme". */
const labelSlug = (v: unknown): string => clean(v, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
const JARVIS_HOME = process.env.JARVIS_HOME || homedir();

interface VaultFile { version: 1; connections: Record<string, TaskConnection> }

export class TaskConnectionStore {
  private readonly file: string;
  private readonly now: () => number;
  private data: VaultFile = { version: 1, connections: {} };

  constructor(opts: { dir?: string; now?: () => number } = {}) {
    const dir = opts.dir || join(JARVIS_HOME, ".jarvis", "hub");
    this.file = join(dir, "task-connections.json");
    this.now = opts.now || (() => Date.now());
    mkdirSync(dir, { recursive: true });
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, "utf8"));
        if (raw?.version === 1 && raw.connections && typeof raw.connections === "object") this.data = { version: 1, connections: raw.connections };
      } catch { /* cofre ilegível: recomeça vazio; segredos nunca estiveram aqui */ }
    }
  }

  private persist(): void { writeJsonAtomic(this.file, this.data, { pretty: true }); }

  list(): TaskConnection[] {
    return Object.values(this.data.connections).map((c) => ({ ...c, config: { ...c.config } })).sort((a, b) => a.label.localeCompare(b.label));
  }

  get(id: string): TaskConnection | undefined {
    const c = this.data.connections[clean(id, 80)];
    return c ? { ...c, config: { ...c.config } } : undefined;
  }

  /** Cria/atualiza. O id nasce do provedor+rótulo (estável para a UI); segredo NUNCA entra aqui. */
  save(input: { id?: string; provider: string; label: string; config?: Record<string, string>; secretRef: string; secretRef2?: string }): TaskConnection {
    const provider = slug(input.provider);
    const spec = taskProviderSpec(provider);
    if (!spec) throw new Error(`provedor desconhecido: ${input.provider}`);
    const label = clean(input.label, 80);
    if (!label) throw new Error("a conexão precisa de um rótulo");
    const secretRef = clean(input.secretRef, 120);
    if (!secretRef) throw new Error("informe o NOME da env var do segredo (secretRef)");
    if (/[=\s]/.test(secretRef)) throw new Error("secretRef é o NOME da variável, não o valor");
    const secretRef2 = clean(input.secretRef2, 120) || undefined;
    if (spec.secrets.some((s) => s.key === "secretRef2") && !secretRef2) throw new Error(`${spec.label} exige dois segredos (${spec.secrets.map((s) => s.label).join(" + ")})`);
    const config: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = clean(input.config?.[f.key], 300);
      if (v) config[f.key] = v;
      else if (f.required) throw new Error(`${spec.label}: campo obrigatório "${f.label}"`);
    }
    const id = clean(input.id, 80) || `${provider}:${labelSlug(label) || "conta"}`;
    const prev = this.data.connections[id];
    const at = this.now();
    const row: TaskConnection = {
      id, provider, label, config, secretRef, secretRef2,
      // identidade verificada não sobrevive a troca de credencial/config — seria mentir a conta.
      identity: prev && prev.secretRef === secretRef && prev.secretRef2 === secretRef2 && JSON.stringify(prev.config) === JSON.stringify(config) ? prev.identity : undefined,
      lastVerifiedAt: prev && prev.secretRef === secretRef ? prev.lastVerifiedAt : undefined,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
    };
    if (!row.identity) delete row.lastVerifiedAt;
    this.data.connections[id] = row;
    this.persist();
    return this.get(id)!;
  }

  /** Grava o resultado de uma verificação de identidade (sucesso OU falha — a falha fica visível). */
  recordVerification(id: string, result: { identity?: TaskIdentity; error?: string }): TaskConnection | undefined {
    const c = this.data.connections[clean(id, 80)];
    if (!c) return undefined;
    if (result.identity) { c.identity = result.identity; c.lastVerifiedAt = this.now(); delete c.lastError; }
    else c.lastError = clean(result.error, 300) || "verificação falhou";
    c.updatedAt = this.now();
    this.persist();
    return this.get(id);
  }

  remove(id: string): boolean {
    const key = clean(id, 80);
    if (!this.data.connections[key]) return false;
    delete this.data.connections[key];
    this.persist();
    return true;
  }
}

/* ── o que pode sair para o cliente (F) ───────────────────────────────────────────────────────── */

export interface PublicTaskConnection extends Omit<TaskConnection, "config"> {
  config: Record<string, string>;
  /** o segredo referido existe no ambiente do Hub? (booleano — nunca o valor) */
  envOk: boolean;
}

/**
 * Conexão → o que o navegador pode ver. `secretRef` é NOME de variável e continua indo (é o que
 * permite a UI dizer "cole o segredo de X"); VALOR nunca vai.
 *
 * A varredura defensiva do `config` existe porque o contrato "config é não-sensível" é uma promessa
 * de quem preencheu o formulário, não uma garantia: um token colado no campo errado viraria payload
 * para todo cliente conectado. Qualquer valor de config idêntico a um segredo do ambiente é redigido
 * — e o teste desta fatia é exatamente esse ("nenhum segredo sai no payload").
 */
export function publicTaskConnections(connections: TaskConnection[], env: Record<string, string | undefined>): PublicTaskConnection[] {
  return connections.map((c) => {
    const secrets = [env[c.secretRef], c.secretRef2 ? env[c.secretRef2] : undefined].filter((v): v is string => !!v && v.length >= 4);
    const config: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.config || {})) config[k] = secrets.some((s) => v === s || v.includes(s)) ? "[REDIGIDO]" : v;
    return { ...c, config, envOk: !!env[c.secretRef] && (!c.secretRef2 || !!env[c.secretRef2]) };
  });
}

/* ── resolução com regra de ouro ──────────────────────────────────────────────────────────────── */

export interface TaskConnectionRefusal {
  code: "NO_BINDING" | "NO_CONNECTION" | "CONNECTION_MISSING" | "NOT_ALLOWED" | "SECRET_MISSING" | "NOT_VERIFIED";
  message: string;
}

export interface ResolvedTaskConnection {
  connection: TaskConnection;
  secret: string;
  secret2?: string;
}

/**
 * Resolve a conexão de um projeto para USO (leitura ou escrita). Nunca cai em padrão global:
 * cada recusa devolve um código + mensagem acionável, que a UI transforma em "vincule aqui".
 * `requireVerified` (escrita) exige identidade verificada — criar tarefa como conta desconhecida
 * é exatamente o acidente que este cofre existe para impedir.
 */
export function resolveTaskConnection(input: {
  binding?: Pick<ProjectTaskBinding, "connectionId" | "allowed"> | null;
  store: Pick<TaskConnectionStore, "get">;
  env: Record<string, string | undefined>;
  requireVerified?: boolean;
}): ResolvedTaskConnection | { refusal: TaskConnectionRefusal } {
  const binding = input.binding || undefined;
  if (!binding) return { refusal: { code: "NO_BINDING", message: "este projeto não tem fonte de tarefas vinculada — vincule uma conexão primeiro" } };
  const id = clean(binding.connectionId, 80);
  if (!id) return { refusal: { code: "NO_CONNECTION", message: "o projeto tem fonte definida mas nenhuma CONEXÃO vinculada — escolha a conta" } };
  if (Array.isArray(binding.allowed) && binding.allowed.length && !binding.allowed.includes(id)) {
    return { refusal: { code: "NOT_ALLOWED", message: "a conexão vinculada não está na lista de permitidas deste projeto" } };
  }
  const connection = input.store.get(id);
  if (!connection) return { refusal: { code: "CONNECTION_MISSING", message: `a conexão vinculada (${id}) não existe mais no cofre` } };
  const secret = input.env[connection.secretRef];
  if (!secret) return { refusal: { code: "SECRET_MISSING", message: `a env var ${connection.secretRef} não está presente no ambiente do Hub` } };
  let secret2: string | undefined;
  if (connection.secretRef2) {
    secret2 = input.env[connection.secretRef2];
    if (!secret2) return { refusal: { code: "SECRET_MISSING", message: `a env var ${connection.secretRef2} não está presente no ambiente do Hub` } };
  }
  if (input.requireVerified && !connection.identity) {
    return { refusal: { code: "NOT_VERIFIED", message: `a conexão "${connection.label}" nunca teve a identidade verificada — verifique antes de escrever` } };
  }
  return { connection, secret, secret2 };
}

/** Divergência barata remote×conexão (GitHub/GitLab): pega board/conta errada ANTES da escrita. */
export function remoteMismatchWarning(remoteUrl: string | undefined, connection: TaskConnection): string | undefined {
  const raw = clean(remoteUrl, 300);
  if (!raw || (connection.provider !== "github" && connection.provider !== "gitlab")) return undefined;
  const m = /(?:github|gitlab)[^/:]*[/:]([^/]+)\//i.exec(raw);
  const remoteOrg = m ? m[1].toLowerCase() : "";
  const expected = (connection.config.org || "").toLowerCase();
  if (!remoteOrg || !expected) return undefined;
  if (remoteOrg !== expected) return `o remote deste repositório é de "${remoteOrg}", mas a conexão "${connection.label}" espera a organização "${connection.config.org}"`;
  return undefined;
}
