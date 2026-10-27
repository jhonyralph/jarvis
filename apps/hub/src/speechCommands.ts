/**
 * Comandos de voz da fila de fala (VOZ-01 UC-25, UC-26, DEC-09): "espere", "me dá 7 minutos",
 * "próxima", "encerrar a voz", "ligar a voz" e o sim/não de "posso trazer outras sessões?".
 *
 * Determinístico de propósito, sem IA: o comando precisa valer na hora, sem custo, e só quando a
 * fala INTEIRA é o comando. "Espere, antes de mudar o login, confere o teste" é uma instrução para a
 * sessão, não um pedido de tempo — por isso cada padrão casa a frase toda (curta), nunca um pedaço.
 */

export type SpeechCommandIntent =
  | { kind: "wait"; minutes?: number }
  | { kind: "next" }
  | { kind: "off" }
  | { kind: "on" }
  | { kind: "bring"; yes: boolean };

const NUMBERS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(ok |ei |hey )?jarvis /, "")
    .trim();
}

// Só o pedido EXPLÍCITO desliga a voz até "ligar a voz": "silêncio" ou "para de falar" soltos são
// mais provavelmente "cala esta fala" (barge-in) do que "não fale mais nada hoje".
const OFF = /^(encerra(r)?|desliga(r)?|para(r)?|fecha(r)?) (a )?voz$|^(chega de voz|modo silencioso)$/;
const ON = /^(liga(r)?|religa(r)?|ativa(r)?|reativa(r)?) (a )?voz$|^(volta a falar|pode voltar a falar)$/;
// "A próxima", "seguinte" e "pula" ficaram de fora: são respostas plausíveis à pergunta da própria
// sessão ("a primeira ou a próxima?", "pulo o teste?").
const NEXT = /^(proxima|pass(a|e|ar) (para|pra) (a )?proxima|pode passar)( por favor)?$/;
const WAIT = /^(espera|espere|aguarda|aguarde|calma)( (ai|um pouco|um pouquinho|um momento|um minuto|um minutinho|mais um pouco|so um pouco))?( por favor)?$|^me d(a|e) (mais )?(um )?(tempo|tempinho|minuto|minutinho)( para pensar| pra pensar)?( por favor)?$/;
const WAIT_MIN = /^(espera|espere|aguarda|aguarde|me d(a|e)) (mais )?([0-9]{1,3}|[a-z]+) minutos?( para pensar| pra pensar)?( por favor)?$/;
const YES = /^(sim|pode|pode sim|pode trazer|traz|traga|claro|manda|ok|beleza|isso|sim pode|pode sim traga)( por favor)?$/;
const NO = /^(nao|melhor nao|nao precisa|nao traga|nao traz|agora nao|nao obrigado)( por favor)?$/;

/** `expectingBring` = a fila acabou de perguntar "posso trazer outras sessões enquanto isso?". */
export function parseSpeechCommand(text: string, opts: { expectingBring?: boolean } = {}): SpeechCommandIntent | null {
  const t = normalize(text);
  if (!t || t.split(" ").length > 9) return null;
  if (opts.expectingBring) {
    if (YES.test(t)) return { kind: "bring", yes: true };
    if (NO.test(t)) return { kind: "bring", yes: false };
  }
  if (OFF.test(t)) return { kind: "off" };
  if (ON.test(t)) return { kind: "on" };
  if (NEXT.test(t)) return { kind: "next" };
  const m = WAIT_MIN.exec(t);
  if (m) {
    const raw = m[4];
    const minutes = /^[0-9]+$/.test(raw) ? Number(raw) : NUMBERS[raw];
    if (minutes && minutes > 0 && minutes <= 180) return { kind: "wait", minutes };
  }
  if (WAIT.test(t)) return { kind: "wait" };
  return null;
}
