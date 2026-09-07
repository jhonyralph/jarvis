// Endereço do Hub escolhido DENTRO do app, e a regra única de precedência.
//
// Por que existe: o shell é um cliente fino cujo único parâmetro é para onde apontar, e até aqui
// esse parâmetro só podia ser dado POR FORA (env `JARVIS_APP_HUB_URL`, gravada pelo instalador).
// Numa máquina onde ninguém rodou o instalador com `-HubUrl` — o caso normal de uma máquina que só
// roda runner — o app abria apontando para um Hub inexistente em 127.0.0.1:4577 e não havia UMA
// tela para corrigir isso: era preciso sair do app, achar o repo e rodar PowerShell. Agora a
// própria janela edita o endereço.
//
// Nada aqui requer `electron`: o diretório e o acesso a disco entram por parâmetro, então a
// precedência é testável em node puro.

const FILE_NAME = "hub-config.json";

/** Caminho do arquivo de config dentro do userData do Electron (`app.getPath("userData")`). */
function hubConfigPath(dir, join) {
  return (join || require("node:path").join)(dir, FILE_NAME);
}

/**
 * Lê o endereço salvo pelo usuário no app. Nunca lança: arquivo ausente/corrompido é o caso normal
 * (primeira execução) e vira `undefined`, não um app que não abre.
 * @returns {string | undefined}
 */
function readSavedHubUrl(dir, { readFile, join } = {}) {
  try {
    const file = hubConfigPath(dir, join);
    const text = readFile ? readFile(file) : require("node:fs").readFileSync(file, "utf8");
    const parsed = JSON.parse(String(text));
    const value = typeof parsed?.hubUrl === "string" ? parsed.hubUrl.trim() : "";
    return value || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Grava (ou limpa, com `undefined`/"") o endereço escolhido no app. Devolve true em sucesso.
 * Escreve o objeto inteiro — o arquivo é só deste shell, não há outra chave para preservar.
 */
function writeSavedHubUrl(dir, hubUrl, { writeFile, mkdir, join } = {}) {
  try {
    const value = typeof hubUrl === "string" ? hubUrl.trim() : "";
    const file = hubConfigPath(dir, join);
    (mkdir || ((d) => require("node:fs").mkdirSync(d, { recursive: true })))(dir);
    const body = JSON.stringify(value ? { hubUrl: value } : {}, null, 2) + "\n";
    (writeFile || ((f, b) => require("node:fs").writeFileSync(f, b)))(file, body);
    return true;
  } catch {
    return false;
  }
}

/** Rótulo humano de cada origem — aparece na janela e no log, para o endereço nunca ser um mistério. */
const SOURCE_LABELS = {
  app: "configurado no app",
  env: "JARVIS_APP_HUB_URL",
  runner: "runner desta máquina (~/.jarvis/runner.env)",
  fallback: "padrão",
};

/**
 * Precedência: **o que o usuário salvou no app** > env > Hub do runner desta máquina > loopback.
 *
 * O valor salvo no app vem primeiro de propósito: é a ação mais explícita e mais recente que
 * alguém pode tomar, e é a única disponível para quem só tem a janela na frente. Para não virar
 * mistério quando uma env também existe, `candidates` devolve TODAS as origens detectadas e a
 * janela mostra qual está valendo — além do botão que limpa a escolha local e devolve a precedência
 * para o sistema.
 *
 * `normalize` é o `normalizeHubUrl` do módulo vizinho (injetado para manter este arquivo sem ciclo).
 */
function resolveHubTarget({ saved, env, runner, normalize }) {
  const raw = [
    { source: "app", value: saved },
    { source: "env", value: env },
    { source: "runner", value: runner },
  ].map((c) => ({ ...c, value: typeof c.value === "string" ? c.value.trim() : "" }));

  const evaluated = raw
    .filter((c) => c.value)
    .map((c) => ({ ...c, label: SOURCE_LABELS[c.source], ...normalize(c.value) }));

  // Um valor MALFORMADO não pode consumir a vez: se o que foi salvo no app está quebrado e existe
  // uma env válida, cair no loopback seria perder a única configuração boa da máquina. Pega a
  // primeira origem que normaliza de verdade e guarda os avisos das que foram puladas.
  const chosen = evaluated.find((c) => !c.usedFallback);
  const skipped = evaluated.filter((c) => c.usedFallback && c.warning).map((c) => `${c.label}: ${c.warning}`);
  const fallbackUrl = normalize("").url;
  const source = chosen ? chosen.source : "fallback";
  return {
    url: chosen ? chosen.url : fallbackUrl,
    source,
    sourceLabel: SOURCE_LABELS[source],
    usedFallback: !chosen,
    warning: skipped.length ? skipped.join(" · ") : undefined,
    candidates: evaluated.map(({ source: s, value, label, url, usedFallback }) => ({ source: s, value, label, url, invalid: usedFallback })),
  };
}

module.exports = { hubConfigPath, readSavedHubUrl, writeSavedHubUrl, resolveHubTarget, SOURCE_LABELS, FILE_NAME };
