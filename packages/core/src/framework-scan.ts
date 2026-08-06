/**
 * Security scanner for Framework Jarvis content. Framework files are a supply-chain surface: they are
 * published to every machine and expanded into prompts across every AI, and the planned native-export
 * slice would let a malicious `!`command`` execute in a native Claude Code/Codex session. This is a
 * static, dependency-free triage over the well-known attack vectors (Datadog Security Labs / CSA):
 * dynamic-context execution, broad shell grants, credential reads, exfiltration, opaque blobs and
 * prompt-injection. It is pure text analysis.
 *
 * HONESTY: static scanning REDUCES risk, it does not guarantee safety — obfuscated/cloaked payloads
 * evade scanners. Treat findings as a review aid + defense-in-depth, never a clean bill of health.
 * `blocked` is true when any HIGH finding exists; the caller may still apply with an explicit override.
 */
import type { FrameworkFile } from "./framework.js";

export type ScanSeverity = "high" | "medium" | "low";

export interface ScanFinding {
  path: string;
  /** 1-based line in the file, or 0 when file-level. */
  line: number;
  severity: ScanSeverity;
  /** stable kebab-case rule id (for tests/telemetry). */
  rule: string;
  message: string;
  /** the offending text, trimmed and capped so the UI/logs never echo a huge blob. */
  snippet: string;
}

export interface ScanReport {
  findings: ScanFinding[];
  counts: Record<ScanSeverity, number>;
  /** true when at least one HIGH finding exists — the default import gate. */
  blocked: boolean;
}

const MAX_SNIPPET = 160;
/** cap findings per (file,rule) so a pathological file can't produce thousands of rows. */
const MAX_PER_RULE = 25;

function snip(s: string): string {
  const t = String(s).trim().replace(/\s+/g, " ");
  return t.length > MAX_SNIPPET ? t.slice(0, MAX_SNIPPET) + "…" : t;
}

// Acesso REAL a credencial: arquivo de chave/segredo, ou comando que IMPRIME um token. HIGH.
const SECRET_FILE = /(\.ssh\/|\bid_rsa\b|\bid_ed25519\b|\.aws\/(credentials|config)|\.netrc\b|\.npmrc\b|\/etc\/passwd|\.pem\b|\bgh\s+auth\s+token\b)/i;
// Só o NOME de uma variável de segredo (GITHUB_TOKEN, *_API_KEY…). Comuníssimo em documentação/CI —
// citar o nome NÃO é ler o segredo. MEDIUM (aparece pra revisão, não bloqueia sozinho).
const SECRET_NAME = /\b(GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|ANTHROPIC_API_KEY|OPENAI_API_KEY|NPM_TOKEN|SLACK_TOKEN)\b/;
const ENV_DUMP = /\b(printenv|process\.env|os\.environ|getenv)\b|Env:\s*|\$Env:/i;
const PIPE_TO_SHELL = /\b(curl|wget|iwr|invoke-webrequest|fetch)\b[^\n|]*\|\s*(sudo\s+)?(bash|sh|zsh|python3?|node|pwsh|powershell)\b/i;
const NET_TOOL = /\b(curl|wget|nc|ncat|telnet|scp|rsync|invoke-webrequest|iwr)\b/i;
// Primitivas de execução. NÃO usa /i e exige o parêntese COLADO (`exec(`, `Function(`, `eval(`) — antes,
// `(eval|exec|Function)\s*\(` com /i casava "function (", "no eval (", "exec (" em PROSA/tabelas comuns
// de docs, gerando falso-positivo em quase todo markdown. `Function` é case-sensitive (o construtor JS).
const CODE_EXEC = /\b(child_process|subprocess|os\.system|execSync|spawnSync|runInThisContext)\b|\b(eval|exec|atob)\(|\bFunction\(/;
const BROAD_SHELL = /allowed-tools\s*:\s*(.+)$/i;
// Curinga = grant IRRESTRITO (Bash(*), Shell(*), ou um `*` solto na lista) → HIGH.
const BROAD_SHELL_WILDCARD = /\b(Bash|Shell|Sh|Execute|Exec)\s*\(\s*\*\s*\)|(^|[,[\s(])\*([,\])\s]|$)/i;
// Declarar uma ferramenta de shell ESCOPADA (ex.: "Read, Bash, Write") é normal numa skill de dev → MEDIUM.
const BROAD_SHELL_VALUE = /(^|[,[\s])(Bash|Shell|Sh|Execute)([,\]\s]|$)/i;
const BASE64_BLOB = /[A-Za-z0-9+/]{200,}={0,2}/;
const URL = /\bhttps?:\/\/[^\s)'"`<>]+/gi;
const IP_HOST = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}/i;
const SHORTENER = /^https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|ow\.ly|buff\.ly|rebrand\.ly|cutt\.ly)\b/i;
const DYN_EXEC = /!`([^`]+)`/g;
const DYN_RISKY = /\b(curl|wget|nc|bash|sh|zsh|python3?|node|eval|base64|printenv|env|cat|find|grep|scp|ssh|rm|chmod|chown|powershell|pwsh|iwr|invoke-webrequest|sudo|dd|mkfifo)\b/i;
const INJECTION = /\b(ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+(instructions|prompts|rules)|disregard\s+(the\s+)?(above|previous|system|prior)|do\s+not\s+(tell|inform|reveal|mention)\s+(to\s+)?the\s+(user|owner|human)|exfiltrat)/i;

export function scanFramework(files: FrameworkFile[]): ScanReport {
  const findings: ScanFinding[] = [];
  for (const f of files) {
    const perRule: Record<string, number> = {};
    const seenUrl = new Set<string>();
    const push = (line: number, severity: ScanSeverity, rule: string, message: string, snippet: string): void => {
      perRule[rule] = (perRule[rule] || 0) + 1;
      if (perRule[rule] > MAX_PER_RULE) return;
      findings.push({ path: f.path, line, severity, rule, message, snippet: snip(snippet) });
    };
    const lines = String(f.content ?? "").split(/\r?\n/);
    let inFrontmatter = false, sawFmOpen = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;
      // Track the leading `---`…`---` frontmatter block so allowed-tools is only read there.
      if (line.trim() === "---") { if (!sawFmOpen) { sawFmOpen = true; inFrontmatter = true; } else if (inFrontmatter) inFrontmatter = false; }

      // Dynamic-context execution: `!`cmd`` runs before the model sees it.
      let dm: RegExpExecArray | null;
      DYN_EXEC.lastIndex = 0;
      while ((dm = DYN_EXEC.exec(line))) {
        const inner = dm[1];
        const risky = DYN_RISKY.test(inner) || SECRET_FILE.test(inner);
        push(ln, risky ? "high" : "medium", "dynamic-context-exec",
          "execução de contexto dinâmico `!`comando`` roda antes do modelo avaliar — vetor de vazamento de credenciais.", dm[0]);
      }

      if (inFrontmatter) {
        const bs = BROAD_SHELL.exec(line);
        if (bs && BROAD_SHELL_WILDCARD.test(bs[1])) {
          push(ln, "high", "broad-shell-grant", "grant de shell CURINGA em allowed-tools (ex.: Bash(*)) pré-aprova execução irrestrita.", line);
        } else if (bs && BROAD_SHELL_VALUE.test(bs[1])) {
          push(ln, "medium", "shell-grant", "allowed-tools declara shell (ex.: Bash) — escopado é normal em skill de dev; revise a origem do pacote.", line);
        }
      }

      if (PIPE_TO_SHELL.test(line)) {
        push(ln, "high", "pipe-to-shell", "download conectado direto a um shell (curl|wget … | bash) executa código remoto.", line);
      } else if (NET_TOOL.test(line)) {
        push(ln, "medium", "network-tool", "ferramenta de rede (curl/wget/nc…) pode buscar payload ou exfiltrar dados.", line);
      }
      if (SECRET_FILE.test(line)) {
        push(ln, "high", "credential-access", "acesso a arquivo de credencial (chave SSH, .pem, .aws/credentials) ou comando que imprime segredo.", line);
      } else if (SECRET_NAME.test(line)) {
        push(ln, "medium", "credential-name", "menção ao NOME de uma variável de segredo (ex.: GITHUB_TOKEN) — comum em documentação; não é leitura do segredo.", line);
      }
      if (ENV_DUMP.test(line)) {
        push(ln, "medium", "env-access", "leitura de variáveis de ambiente — pode enumerar segredos.", line);
      }
      if (CODE_EXEC.test(line)) {
        push(ln, "medium", "code-exec", "primitiva de execução de código no corpo — vira TEXTO de prompt (não é executada pelo Jarvis); revise se o pacote é confiável.", line);
      }
      if (BASE64_BLOB.test(line)) {
        push(ln, "medium", "opaque-blob", "blob longo tipo base64 — pode ocultar payload; revise manualmente.", line);
      }
      if (INJECTION.test(line)) {
        push(ln, "medium", "prompt-injection", "linguagem de prompt-injection (ignorar instruções, ocultar do usuário, exfiltrar).", line);
      }
      let um: RegExpExecArray | null;
      URL.lastIndex = 0;
      while ((um = URL.exec(line))) {
        const url = um[0];
        if (seenUrl.has(url)) continue;
        seenUrl.add(url);
        const sev: ScanSeverity = IP_HOST.test(url) || SHORTENER.test(url) ? "medium" : "low";
        push(ln, sev, "external-url",
          sev === "medium" ? "URL externa suspeita (IP literal ou encurtador) — possível estágio de payload." : "URL externa referenciada — verifique a origem antes de confiar.", url);
      }
    }
  }
  const counts: Record<ScanSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const fnd of findings) counts[fnd.severity]++;
  // Deterministic order: severity desc, then path, then line.
  const rank: Record<ScanSeverity, number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.path.localeCompare(b.path) || a.line - b.line);
  return { findings, counts, blocked: counts.high > 0 };
}
