/** O `instructions.md` do framework passa a valer num turno — descontando o que a IA já lê sozinha,
 *  senão o mesmo texto iria duas vezes no mesmo prompt. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingInstructions, buildInstructionsSteering } from "./framework-instructions.js";

const CLAUDE_NATIVO = "# CLAUDE.md — Global behavior instructions\n\nResponda em português.\nNunca commite sem autorização explícita do usuário.";
const AGENTS_NATIVO = "# AGENTS.md — Global behavior instructions (Codex)\n\nEvidência antes de concluir: nada de 'testei' sem ter rodado.";
// Como `collectNativeFrameworkFiles` monta o arquivo: cabeçalho de fonte + conteudo, separados por ---
const FRAMEWORK = `# Claude (CLAUDE.md)\n\n${CLAUDE_NATIVO}\n\n---\n\n# AGENTS.md\n\n${AGENTS_NATIVO}\n`;

test("desconta o que a IA já carrega nativamente e injeta só o resto", () => {
  // O Claude Code já lê o ~/.claude/CLAUDE.md sozinho: repetir seria custo dobrado pelo mesmo texto.
  const out = pendingInstructions(FRAMEWORK, [CLAUDE_NATIVO]);
  assert.ok(!out.includes("Responda em português"), "o que é nativo NÃO vai de novo");
  assert.ok(out.includes("Evidência antes de concluir"), "o que a IA não veria de outro jeito, vai");
});

test("seção esvaziada pelo desconto some INTEIRA — cabeçalho órfão é ruído", () => {
  // Regressão encontrada em produção: com o bloco do Claude descontado e o do Codex sobrando, o
  // turno recebia "# Claude (CLAUDE.md)" seguido de "---" e nada mais. A guarda antiga só pegava o
  // caso em que TUDO era nativo; a mistura passava.
  const out = pendingInstructions(FRAMEWORK, [CLAUDE_NATIVO]);
  assert.equal(out.includes("# Claude (CLAUDE.md)"), false, "cabeçalho sem corpo não entra no prompt");
  assert.ok(out.startsWith("# AGENTS.md"), `devia começar na seção que sobrou, veio: ${JSON.stringify(out.slice(0, 60))}`);
  assert.equal(/^\s*---/.test(out), false, "separador solto no início não separa nada");
  assert.equal(/---\s*$/.test(out), false, "nem no fim");
  assert.ok(out.includes("Evidência antes de concluir"), "o conteúdo que sobrou continua inteiro");
});

test("nada de nativo → vai o arquivo inteiro (é o caso das outras máquinas e IAs)", () => {
  const out = pendingInstructions(FRAMEWORK, []);
  assert.ok(out.includes("Responda em português"));
  assert.ok(out.includes("Evidência antes de concluir"));
});

test("tudo já é nativo → não injeta NADA (nem a moldura de cabeçalhos)", () => {
  assert.equal(pendingInstructions(FRAMEWORK, [CLAUDE_NATIVO, AGENTS_NATIVO]), "",
    "sobrando só '# Claude (CLAUDE.md)' e '---', não há o que dizer");
  assert.equal(pendingInstructions("", ["x".repeat(50)]), "");
  assert.equal(pendingInstructions("   \n\n  "), "");
});

test("descontar TODOS os arquivos da máquina zera a injeção na máquina de origem", () => {
  // O instructions.md costuma ser um snapshot dos proprios arquivos nativos ("importar desta
  // maquina" o semeia assim). Descontando so o da IA da vez, o AGENTS.md do Codex — espelho
  // declarado do CLAUDE.md — vazava para dentro do Claude, ~1.7k tokens em TODO turno.
  assert.equal(pendingInstructions(FRAMEWORK, [CLAUDE_NATIVO, AGENTS_NATIVO]), "",
    "na máquina que gerou o arquivo, nada de novo resta para dizer");
  // Já em outra máquina, que não tem esses arquivos, o conteúdo vai inteiro — é o ponto de existir.
  const outra = pendingInstructions(FRAMEWORK, []);
  assert.ok(outra.includes("Responda em português") && outra.includes("Evidência antes de concluir"));
});

test("trecho nativo curto demais não é usado para casar (evita corte por coincidência)", () => {
  const fw = "Regra importante que deve continuar valendo no turno inteiro.";
  assert.equal(pendingInstructions(fw, ["ok"]), fw, "um 'ok' solto não pode recortar o texto");
});

test("remove TODAS as ocorrências do bloco nativo, não só a primeira", () => {
  const bloco = "Nunca commitar sem autorizacao explicita do usuario final.";
  const out = pendingInstructions(`A\n\n${bloco}\n\nB\n\n${bloco}\n\nFim do documento aqui.`, [bloco]);
  assert.equal(out.includes(bloco), false);
  assert.ok(out.includes("Fim do documento aqui."));
});

test("o bloco nativo é tratado como TEXTO, não como regex", () => {
  // markdown tem (), [], *, . — se isto virasse regex, ou explodia ou casava errado
  const bloco = "Use `git diff` (sempre) e [nunca] force-push * em main. Ponto final.";
  const out = pendingInstructions(`Antes.\n\n${bloco}\n\nDepois.`, [bloco]);
  assert.equal(out.includes(bloco), false);
  assert.ok(out.includes("Antes.") && out.includes("Depois."));
});

test("o prompt diz de ONDE a regra veio — não pode parecer texto do usuário", () => {
  const steer = buildInstructionsSteering("Responda em português.");
  assert.match(steer, /Framework Jarvis/);
  assert.match(steer, /todo turno/);
  assert.ok(steer.includes("Responda em português."));
  assert.equal(buildInstructionsSteering("   "), "", "sem conteúdo, sem cabeçalho");
});
