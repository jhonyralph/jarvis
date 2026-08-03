import { calendarWallTimeToEpoch } from "./calendar-context.js";

export const PERSONAL_INTENT_NAMES = [
  "nearby",
  "mobility",
  "calendar",
  "events",
  "weather",
  "automation",
  "ev",
] as const;

export type PersonalIntentName = (typeof PERSONAL_INTENT_NAMES)[number];
export type PersonalIntentLocale = "pt-BR" | "en" | "es";

export const PERSONAL_INTENT_HIGH_PRECISION_THRESHOLD = 0.82;

export interface PersonalIntentSlots {
  query?: string;
  category?: string;
  dateText?: string;
  timeText?: string;
  radiusMeters?: number;
  radiusText?: string;
  durationMinutes?: number;
  durationText?: string;
  reference?: string;
  requireOpen?: boolean;
  restrictions?: string[];
}

export interface PersonalIntentEvidence {
  rule: string;
  weight: number;
}

export interface PersonalIntentMatch {
  intent: PersonalIntentName;
  locale: PersonalIntentLocale;
  confidence: number;
  evidence: PersonalIntentEvidence[];
  slots: PersonalIntentSlots;
}

export interface PersonalIntentRouterOptions {
  locale?: PersonalIntentLocale | "auto";
  threshold?: number;
}

export interface PersonalIntentTimeWindowOptions {
  now?: number;
  timeZone: string;
}

export interface PersonalIntentTimeWindow {
  startAt: number;
  endAt: number;
  timeZone: string;
}

interface FoldedText {
  folded: string;
  original: string;
  starts: number[];
  ends: number[];
}

interface Candidate {
  intent: PersonalIntentName;
  score: number;
  evidence: PersonalIntentEvidence[];
  slots: PersonalIntentSlots;
  qualified: boolean;
  specificity: number;
}

interface Signal {
  matched: boolean;
  text?: string;
}

const REQUEST_CUE = /\b(?:onde|qual|quais|procure|procurar|busque|buscar|encontre|encontrar|mostre|mostrar|indique|indicar|sugira|sugerir|recomende|recomendar|preciso|quero|tem|ha|existe|existem|como|quando|me\s+diga|me\s+mostre|where|what|which|find|search|show|suggest|recommend|need|want|is\s+there|are\s+there|how|when|tell\s+me|donde|que|cual|cuales|busca|buscar|encuentra|encontrar|muestra|mostrar|sugiere|sugerir|recomienda|recomendar|necesito|quiero|hay|existe|existen|como|cuando|dime)\b/;
const PERSONAL_CUE = /\b(?:meu|minha|meus|minhas|mim|comigo|my|mine|me|mi|mis|conmigo)\b/;
const PREFERENCE_STATEMENT = /\b(?:eu\s+gosto|gosto\s+de|prefiro|i\s+like|i\s+prefer|me\s+gusta|prefiero)\b/;

const CODE_ACTION = /\b(?:editar?|edite|editando|implementar?|implemente|codificar?|corrigir|corrija|depurar|debugar|refatorar?|refatore|revisar?|revise|testar?|teste|rodar|execute\s+os?\s+testes?|criar?|crie|escrever?|escreva|edit|implement|code|fix|debug|refactor|review|test|run\s+tests?|create|write|editar|edita|implementar|implementa|codificar|corregir|corrige|depurar|refactorizar|refactoriza|revisar|revisa|probar|prueba|crear|crea|escribir|escribe)\b/;
const CODE_OBJECT = /\b(?:codigo|code|arquivo|file|ficheiro|clase|classe|class|funcao|function|metodo|method|componente|component|modulo|module|pacote|package|biblioteca|library|api|endpoint|handler|listener|controller|service|schema|interface|type|tela|screen|pagina|page|card|botao|button|view|form|modal|widget|plugin|adapter|router|roteador|integracao|integration|teste\s+unitario|unit\s+test|prueba\s+unitaria|pull\s+request|commit|branch|repo|repositorio|repository|script|query\s+sql|migration|migracao|migracion|typescript|javascript|python|java|kotlin|swift|react|angular|vue|node(?:\.js)?|css|html)\b/;
const HARD_CODE_CONTEXT = /(?:\b(?:stack\s*trace|event\s+loop|event\s+listener|test\s+suite|build\s+pipeline|source\s+map|merge\s+request|npm|pnpm|yarn|git|docker|playwright|vitest|jest|pytest)\b|\b[A-Za-z]:\\[^\s"']+|(?:^|[\s"'(])(?:\.{1,2}[\\/]|src[\\/]|packages?[\\/]|apps?[\\/]|tests?[\\/])[^\s"']+|\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|java|kt|swift|go|rs|cs|cpp|h|css|scss|html|json|ya?ml|toml|sql|sh|ps1)\b)/;

const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
  /\b(?:depois\s+de\s+amanha|day\s+after\s+tomorrow|pasado\s+manana)\b/,
  /\b(?:hoje|amanha|today|tomorrow|hoy|manana)\b/,
  /\b(?:neste|nesta|nesse|nessa|proximo|proxima|este|esta|this|next|este|esta|proximo|proxima)\s+(?:fim\s+de\s+semana|weekend|fin\s+de\s+semana|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/,
  /\b(?:segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes)\b/,
  /\b(?:daqui\s+a|em|in|dentro\s+de|en)\s+\d+\s+dias?\b/,
];

const TIME_PATTERNS = [
  /\b(?:as|at|a\s+las)\s+\d{1,2}(?::\d{2}|h(?:\d{2})?)?(?:\s*(?:am|pm))?\b/,
  /\b\d{1,2}(?::\d{2}|h(?:\d{2}))(?:\s*(?:am|pm))?\b/,
  /\b\d{1,2}\s*(?:am|pm)\b/,
  /\b(?:de\s+manha|pela\s+manha|a\s+tarde|a\s+noite|in\s+the\s+morning|in\s+the\s+afternoon|in\s+the\s+evening|at\s+night|por\s+la\s+manana|por\s+la\s+tarde|por\s+la\s+noche)\b/,
  /\b(?:morning|afternoon|evening|tonight)\b/,
];

const CATEGORY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["restaurant", /\b(?:restaurante|restaurantes|restaurant|restaurants)\b/],
  ["cafe", /\b(?:cafe|cafes|coffee\s+shop|coffee\s+shops|cafeteria|cafeterias)\b/],
  ["bakery", /\b(?:padaria|padarias|bakery|bakeries|panaderia|panaderias)\b/],
  ["pharmacy", /\b(?:farmacia|farmacias|pharmacy|pharmacies)\b/],
  ["supermarket", /\b(?:supermercado|supermercados|supermarket|supermarkets|mercado|mercados|grocery\s+store|grocery\s+stores)\b/],
  ["hospital", /\b(?:hospital|hospitais|hospitals|clinica|clinicas|clinic|clinics)\b/],
  ["parking", /\b(?:estacionamento|estacionamentos|parking|aparcamiento|aparcamientos)\b/],
  ["hotel", /\b(?:hotel|hoteis|hotels|hostel|hostels)\b/],
  ["gym", /\b(?:academia|academias|gym|gyms|gimnasio|gimnasios)\b/],
  ["bar", /\b(?:bar|bares|bars|pub|pubs)\b/],
  ["gas_station", /\b(?:posto\s+de\s+combustivel|gas\s+station|gas\s+stations|petrol\s+station|petrol\s+stations|gasolinera|gasolineras)\b/],
  ["bank", /\b(?:banco|bancos|bank|banks|cajero|cajeros|caixa\s+eletronico|atm|atms)\b/],
];

const EVENT_CATEGORY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["music", /\b(?:musica|music|musical|show|shows|concerto|concertos|concert|concerts|festival\s+de\s+musica|music\s+festival|festival\s+musical)\b/],
  ["theater", /\b(?:teatro|teatros|theater|theatre|obra\s+de\s+teatro)\b/],
  ["exhibition", /\b(?:exposicao|exposicoes|exhibition|exhibitions|exposicion|exposiciones|mostra|mostras)\b/],
  ["cinema", /\b(?:cinema|filme|filmes|movie|movies|cine|pelicula|peliculas)\b/],
  ["sports", /\b(?:esporte|esportes|sport|sports|deporte|deportes|jogo|jogos|game|games|partido|partidos)\b/],
  ["food", /\b(?:gastronomia|gastronomico|food|comida|culinaria|culinario)\b/],
  ["conference", /\b(?:conferencia|conferencias|conference|conferences|congreso|congress|meetup|meetups)\b/],
];

function maskCode(text: string): string {
  const blank = (value: string) => " ".repeat(value.length);
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, blank)
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, blank)
    .replace(/`[^`\r\n]*`/g, blank);
}

function foldText(original: string): FoldedText {
  const masked = maskCode(original);
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < masked.length;) {
    const codePoint = masked.codePointAt(index)!;
    const raw = String.fromCodePoint(codePoint);
    const normalized = raw.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US");
    for (let offset = 0; offset < normalized.length; offset++) {
      folded += normalized[offset];
      starts.push(index);
      ends.push(index + raw.length);
    }
    index += raw.length;
  }
  return { folded, original, starts, ends };
}

function localDateParts(timestamp: number, timeZone: string): { year: number; month: number; day: number } {
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function shiftDate(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function localWeekday(date: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12)).getUTCDay();
}

function dateFromIntent(text: string | undefined, today: { year: number; month: number; day: number }): { start: typeof today; days: number } {
  if (!text) return { start: today, days: 1 };
  const folded = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(folded);
  if (iso) return { start: { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }, days: 1 };
  const numeric = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(folded);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : today.year; if (year < 100) year += 2_000;
    let start = { year, month: Number(numeric[2]), day: Number(numeric[1]) };
    if (!numeric[3] && Date.UTC(start.year, start.month - 1, start.day) < Date.UTC(today.year, today.month - 1, today.day)) start = { ...start, year: start.year + 1 };
    return { start, days: 1 };
  }
  const inDays = /\b(?:daqui\s+a|em|in|dentro\s+de|en)\s+(\d+)\s+dias?\b/.exec(folded);
  if (inDays) return { start: shiftDate(today, Math.min(3_660, Number(inDays[1]))), days: 1 };
  if (/depois\s+de\s+amanha|day\s+after\s+tomorrow|pasado\s+manana/.test(folded)) return { start: shiftDate(today, 2), days: 1 };
  if (/\b(?:amanha|tomorrow|manana)\b/.test(folded)) return { start: shiftDate(today, 1), days: 1 };
  if (/\b(?:hoje|today|hoy)\b/.test(folded)) return { start: today, days: 1 };
  const weekdays: Array<[number, RegExp]> = [
    [0, /\b(?:domingo|sunday)\b/], [1, /\b(?:segunda(?:-feira)?|monday|lunes)\b/], [2, /\b(?:terca(?:-feira)?|tuesday|martes)\b/],
    [3, /\b(?:quarta(?:-feira)?|wednesday|miercoles)\b/], [4, /\b(?:quinta(?:-feira)?|thursday|jueves)\b/], [5, /\b(?:sexta(?:-feira)?|friday|viernes)\b/],
    [6, /\b(?:sabado|saturday)\b/],
  ];
  if (/fim\s+de\s+semana|weekend|fin\s+de\s+semana/.test(folded)) {
    let offset = (6 - localWeekday(today) + 7) % 7;
    if (/\b(?:proximo|proxima|next)\b/.test(folded) && offset === 0) offset = 7;
    if (localWeekday(today) === 0 && !/\b(?:proximo|proxima|next)\b/.test(folded)) return { start: today, days: 1 };
    return { start: shiftDate(today, offset), days: 2 };
  }
  const named = weekdays.find(([, pattern]) => pattern.test(folded));
  if (named) {
    let offset = (named[0] - localWeekday(today) + 7) % 7;
    if (/\b(?:proximo|proxima|next)\b/.test(folded) && offset === 0) offset = 7;
    return { start: shiftDate(today, offset), days: 1 };
  }
  return { start: today, days: 1 };
}

function timeFromIntent(text: string | undefined): { hour: number; minute: number; durationMinutes: number } | undefined {
  if (!text) return undefined;
  const folded = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/manha|morning|manana/.test(folded)) return { hour: 6, minute: 0, durationMinutes: 6 * 60 };
  if (/tarde|afternoon/.test(folded)) return { hour: 12, minute: 0, durationMinutes: 6 * 60 };
  if (/noite|evening|tonight|noche|night/.test(folded)) return { hour: 18, minute: 0, durationMinutes: 6 * 60 };
  const match = /\b(\d{1,2})(?::|h)?(\d{2})?\s*(am|pm)?\b/.exec(folded);
  if (!match) return undefined;
  let hour = Number(match[1]), minute = Number(match[2] || 0);
  if (match[3] === "pm" && hour < 12) hour += 12;
  if (match[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute, durationMinutes: 60 };
}

export function resolvePersonalIntentTimeWindow(
  slots: Pick<PersonalIntentSlots, "dateText" | "timeText">,
  options: PersonalIntentTimeWindowOptions,
): PersonalIntentTimeWindow | undefined {
  if (!slots.dateText && !slots.timeText) return undefined;
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now)) throw new Error("personal intent clock is invalid");
  const today = localDateParts(now, options.timeZone), date = dateFromIntent(slots.dateText, today), time = timeFromIntent(slots.timeText);
  const startParts = { ...date.start, hour: time?.hour || 0, minute: time?.minute || 0, second: 0 };
  const startAt = calendarWallTimeToEpoch(startParts, options.timeZone);
  const endAt = time
    ? startAt + time.durationMinutes * 60_000
    : calendarWallTimeToEpoch({ ...shiftDate(date.start, date.days), hour: 0, minute: 0, second: 0 }, options.timeZone);
  if (endAt <= startAt) throw new Error("personal intent time window is invalid");
  return { startAt, endAt, timeZone: options.timeZone };
}

function originalMatch(view: FoldedText, match: RegExpExecArray): string | undefined {
  if (!match[0].length) return undefined;
  const start = view.starts[match.index];
  const end = view.ends[match.index + match[0].length - 1];
  if (start === undefined || end === undefined) return undefined;
  const value = view.original.slice(start, end).trim();
  return value || undefined;
}

function matchSignal(view: FoldedText, pattern: RegExp): Signal {
  const match = pattern.exec(view.folded);
  return match ? { matched: true, text: originalMatch(view, match) } : { matched: false };
}

function addEvidence(candidate: Candidate, rule: string, weight: number, matched: boolean): void {
  if (!matched || candidate.evidence.some((item) => item.rule === rule)) return;
  candidate.score += weight;
  candidate.evidence.push({ rule, weight });
}

function questionOrRequest(view: FoldedText): { request: boolean; question: boolean } {
  return {
    request: REQUEST_CUE.test(view.folded),
    question: view.original.includes("?"),
  };
}

function firstPattern(view: FoldedText, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const signal = matchSignal(view, pattern);
    if (signal.matched) return signal.text;
  }
  return undefined;
}

function numericValue(value: string): number | undefined {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractRadius(view: FoldedText): Pick<PersonalIntentSlots, "radiusMeters" | "radiusText"> {
  const pattern = /\b(?:num\s+raio\s+de|em\s+um\s+raio\s+de|dentro\s+de|a\s+menos\s+de|ate|within|under|less\s+than|up\s+to|en\s+un\s+radio\s+de|dentro\s+de|a\s+menos\s+de|hasta)\s+(\d+(?:[.,]\d+)?)\s*(km|quilometros?|kilometers?|kilometres?|m|metros?|meters?|metres?|mi|miles?|milhas?)\b/;
  const match = pattern.exec(view.folded);
  if (!match) return {};
  const amount = numericValue(match[1]);
  if (!amount) return {};
  const unit = match[2];
  const meters = /^(?:km|quilomet|kilomet)/.test(unit) ? amount * 1_000 : /^(?:mi|mile|milha)/.test(unit) ? amount * 1_609.344 : amount;
  if (!Number.isFinite(meters) || meters > 1_000_000) return {};
  return { radiusMeters: Math.round(meters), radiusText: originalMatch(view, match) };
}

function extractDuration(view: FoldedText): Pick<PersonalIntentSlots, "durationMinutes" | "durationText"> {
  const pattern = /\b(?:por|durante|em\s+ate|no\s+maximo|a\s+menos\s+de|menos\s+de|ate|within|for|under|less\s+than|up\s+to|durante|en\s+menos\s+de|menos\s+de|hasta)\s+(\d+(?:[.,]\d+)?)\s*(minutos?|mins?|minutes?|horas?|hours?|hrs?)\b/;
  const match = pattern.exec(view.folded);
  if (!match) return {};
  const amount = numericValue(match[1]);
  if (!amount) return {};
  const minutes = /^(?:hora|hour|hr)/.test(match[2]) ? amount * 60 : amount;
  if (!Number.isFinite(minutes) || minutes > 10_080) return {};
  return { durationMinutes: Math.round(minutes), durationText: originalMatch(view, match) };
}

function extractPlaceConstraints(view: FoldedText): Pick<PersonalIntentSlots, "requireOpen" | "restrictions"> {
  const requireOpen = /\b(?:abert[oa]s?|funcionando|open|opened|abiert[oa]s?)\b/.test(view.folded) || /\b(?:agora|now|ahora)\b/.test(view.folded);
  const patterns: ReadonlyArray<readonly [string, RegExp]> = [
    ["vegan", /\b(?:vegano|vegana|veganos|veganas|vegan)\b/],
    ["vegetarian", /\b(?:vegetariano|vegetariana|vegetarianos|vegetarianas|vegetarian)\b/],
    ["wheelchair", /\b(?:acessivel|cadeirante|cadeira\s+de\s+rodas|wheelchair\s+accessible|accessible|accesible|silla\s+de\s+ruedas)\b/],
    ["gluten_free", /\b(?:sem\s+gluten|gluten[ -]?free|sin\s+gluten)\b/],
    ["halal", /\bhalal\b/],
    ["kosher", /\b(?:kosher|casher)\b/],
  ];
  const restrictions = patterns.filter(([, pattern]) => pattern.test(view.folded)).map(([name]) => name);
  return { ...(requireOpen ? { requireOpen: true } : {}), ...(restrictions.length ? { restrictions } : {}) };
}

function categoryOf(view: FoldedText, patterns = CATEGORY_PATTERNS): { category?: string; text?: string } {
  for (const [category, pattern] of patterns) {
    const signal = matchSignal(view, pattern);
    if (signal.matched) return { category, text: signal.text };
  }
  return {};
}

function cleanQuery(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/^[\s,;:.-]+|[\s,;:?.!-]+$/g, "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 120) : undefined;
}

function capturedText(view: FoldedText, pattern: RegExp, group = 1): string | undefined {
  const match = pattern.exec(view.folded);
  if (!match?.[group]) return undefined;
  const groupOffset = match[0].indexOf(match[group]);
  const synthetic = Object.assign([match[group]], { index: match.index + groupOffset }) as RegExpExecArray;
  return cleanQuery(originalMatch(view, synthetic));
}

function extractNearbyQuery(view: FoldedText, categoryText?: string): string | undefined {
  return capturedText(view, /\b(?:procure|busque|encontre|mostre|indique|sugira|recomende|find|search\s+for|show|suggest|recommend|busca|encuentra|muestra|sugiere|recomienda)\s+(?:umas|uma|uns|um|some|an|a|unas|una|unos|un)?\s*([^?.!,]+?)(?=\s+(?:perto|proximo|proxima|ao\s+meu\s+redor|near|nearby|around|close|cerca|a\s+mi\s+alrededor|num\s+raio|em\s+um\s+raio|within|en\s+un\s+radio|hoje|amanha|today|tomorrow|hoy|manana)\b|[?.!,]|$)/)
    || capturedText(view, /\b(?:onde\s+(?:tem|ha|encontro)|where\s+(?:is|are|can\s+i\s+find)|donde\s+(?:hay|encuentro))\s+(?:umas|uma|uns|um|some|an|a|unas|una|unos|un)?\s*([^?.!,]+?)(?=\s+(?:perto|proximo|proxima|near|nearby|around|close|cerca|a\s+mi\s+alrededor|num\s+raio|em\s+um\s+raio|within|en\s+un\s+radio|hoje|amanha|today|tomorrow|hoy|manana)\b|[?.!,]|$)/)
    || cleanQuery(categoryText);
}

function extractFavoriteReference(view: FoldedText): string | undefined {
  const value = capturedText(view, /\b(?:perto|proximo|proxima)\s+(?:de|da|do)?\s*(?:(?:minha|meu)\s+)?([^?.!,]+?)(?=\s+(?:num\s+raio|em\s+um\s+raio|dentro\s+de|a\s+menos|ate|hoje|amanha)\b|[?.!,]|$)/)
    || capturedText(view, /\b(?:near|close\s+to|around)\s+(?:my\s+)?([^?.!,]+?)(?=\s+(?:within|under|less\s+than|today|tomorrow)\b|[?.!,]|$)/)
    || capturedText(view, /\b(?:cerca\s+de|proximo|proxima)\s+(?:mi\s+)?([^?.!,]+?)(?=\s+(?:en\s+un\s+radio|dentro\s+de|a\s+menos|hasta|hoy|manana)\b|[?.!,]|$)/);
  if (!value || /^(?:mim|aqui|me|here|mi|aqui)$/i.test(value)) return undefined;
  return value;
}

function extractDestination(view: FoldedText): string | undefined {
  return capturedText(view, /\bcuanto\s+tiempo(?:\s+tarda)?\s+en\s+llegar\s+(?:a|al)\s+([^?.!,]+?)(?=\s+(?:hoy|manana|a\s+las|en\s+menos)\b|[?.!,]|$)/)
    || capturedText(view, /\b(?:rota|trajeto|direcoes|caminho|route|directions|ruta|como\s+(?:eu\s+)?(?:chego|vou)|how\s+(?:do\s+i|can\s+i)\s+get|como\s+(?:llego|voy)|quanto\s+tempo(?:\s+leva|\s+demora)?|how\s+long(?:\s+does\s+it\s+take)?|cuanto\s+tiempo(?:\s+tarda)?)\s+(?:para|ate|to|a|al|hacia)\s+(?:(?:chegar\s+(?:ao?|na?|em)|get\s+to|llegar\s+(?:a|al))\s+)?([^?.!,]+?)(?=\s+(?:hoje|amanha|today|tomorrow|hoy|manana|as|at|a\s+las|em\s+ate|within|en\s+menos)\b|[?.!,]|$)/);
}

function extractLocationQuery(view: FoldedText): string | undefined {
  return capturedText(view, /\b(?:em|para|in|for|en)\s+((?!\d+\b)[^?.!,]+?)(?=\s+(?:hoje|amanha|today|tomorrow|hoy|manana|neste|this|este|as|at|a\s+las|de\s+manha|in\s+the|por\s+la)\b|[?.!,]|$)/);
}

function baseSlots(view: FoldedText): PersonalIntentSlots {
  return {
    dateText: firstPattern(view, DATE_PATTERNS),
    timeText: firstPattern(view, TIME_PATTERNS),
    ...extractRadius(view),
    ...extractDuration(view),
    ...extractPlaceConstraints(view),
  };
}

function candidate(intent: PersonalIntentName, slots: PersonalIntentSlots): Candidate {
  return { intent, score: 0, evidence: [], slots: { ...slots }, qualified: false, specificity: 0 };
}

function classifyNearby(view: FoldedText, slots: PersonalIntentSlots): Candidate {
  const result = candidate("nearby", slots);
  const reference = extractFavoriteReference(view);
  const proximity = !!reference || matchSignal(view, /\b(?:perto\s+de\s+(?:mim|casa|aqui|meu\s+trabalho)|proximo\s+(?:de\s+)?(?:mim|aqui|da\s+minha\s+casa|do\s+meu\s+trabalho)|proxima\s+(?:de\s+)?(?:mim|aqui|da\s+minha\s+casa|do\s+meu\s+trabalho)|ao\s+meu\s+redor|na\s+minha\s+regiao|near\s+me|nearby|around\s+me|close\s+to\s+me|in\s+my\s+area|cerca\s+de\s+mi|a\s+mi\s+alrededor|en\s+mi\s+zona|cerca\s+de\s+casa)\b/).matched;
  const locationDiscovery = matchSignal(view, /\b(?:onde\s+(?:tem|ha|fica|encontro)|where\s+(?:is|are|can\s+i\s+find)|donde\s+(?:hay|esta|encuentro))\b/).matched;
  const category = categoryOf(view);
  const { request, question } = questionOrRequest(view);
  const terse = !!category.text && new RegExp(`^\\s*(?:${category.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i").test(view.original);
  const preference = PREFERENCE_STATEMENT.test(view.folded);
  result.slots.category = category.category;
  result.slots.query = extractNearbyQuery(view, category.text);
  result.slots.reference = reference;
  addEvidence(result, "nearby.proximity", 0.58, proximity);
  addEvidence(result, "nearby.category", 0.24, !!category.category);
  addEvidence(result, "nearby.discovery", 0.38, locationDiscovery);
  addEvidence(result, "nearby.discovered-category", 0.12, locationDiscovery && !!category.category);
  addEvidence(result, "request.cue", 0.12, request);
  addEvidence(result, "request.question", 0.04, question);
  addEvidence(result, "nearby.terse-query", 0.08, terse);
  addEvidence(result, "slot.radius", 0.08, result.slots.radiusMeters !== undefined);
  addEvidence(result, "slot.duration", 0.06, result.slots.durationMinutes !== undefined);
  addEvidence(result, "slot.open", 0.05, result.slots.requireOpen === true);
  addEvidence(result, "slot.restrictions", 0.05, !!result.slots.restrictions?.length);
  if (category.category && request && !proximity) addEvidence(result, "nearby.requested-category", 0.46, true);
  if (!category.category && proximity && request && result.slots.query) addEvidence(result, "nearby.requested-query", 0.12, true);
  result.qualified = !preference && (
    (proximity && (!!category.category ? request || question || terse || locationDiscovery : request && !!result.slots.query))
    || (!!category.category && (request || question || terse || locationDiscovery))
  );
  result.specificity = proximity ? 2 : 1;
  return result;
}

function classifyMobility(view: FoldedText, slots: PersonalIntentSlots): Candidate {
  const result = candidate("mobility", slots);
  const strong = matchSignal(view, /\b(?:como\s+(?:eu\s+)?(?:chego|vou)\s+(?:para|ate)|rota\s+(?:para|ate)|trajeto\s+(?:para|ate)|direcoes\s+(?:para|ate)|caminho\s+(?:para|ate)|quanto\s+tempo(?:\s+leva|\s+demora)?\s+(?:para|ate)|tempo\s+de\s+(?:viagem|deslocamento)|desvio\s+(?:para|ate)|how\s+(?:do\s+i|can\s+i)\s+get\s+to|route\s+to|directions\s+to|travel\s+time\s+to|how\s+long(?:\s+does\s+it\s+take)?\s+to\s+get\s+to|como\s+(?:llego|voy)\s+(?:a|al|hacia)|ruta\s+(?:a|al|hacia)|indicaciones\s+(?:a|al|hacia)|cuanto\s+tiempo(?:\s+tarda)?\s+(?:en\s+llegar\s+)?(?:a|al|hasta)|tiempo\s+de\s+viaje|desvio\s+(?:a|al|hacia))\b/).matched;
  const transport = matchSignal(view, /\b(?:de\s+carro|a\s+pe|transporte\s+publico|onibus|metro|bicicleta|driving|walking|public\s+transit|bus|subway|cycling|en\s+coche|a\s+pie|transporte\s+publico|autobus|bicicleta)\b/).matched;
  const { request, question } = questionOrRequest(view);
  result.slots.query = extractDestination(view);
  addEvidence(result, "mobility.route-or-duration", 0.74, strong);
  addEvidence(result, "mobility.transport-mode", 0.10, transport);
  addEvidence(result, "mobility.destination", 0.10, !!result.slots.query);
  addEvidence(result, "request.cue", 0.08, request);
  addEvidence(result, "request.question", 0.04, question);
  addEvidence(result, "slot.duration", 0.05, result.slots.durationMinutes !== undefined);
  result.qualified = strong;
  result.specificity = 3;
  return result;
}

function classifyCalendar(view: FoldedText, slots: PersonalIntentSlots): Candidate {
  const result = candidate("calendar", slots);
  const strong = matchSignal(view, /\b(?:tenho\s+(?:algum\s+)?(?:compromisso|reuniao|consulta)|horario\s+livre|estou\s+livre|minha\s+disponibilidade|what(?:'s|\s+is)\s+on\s+my\s+calendar|do\s+i\s+have\s+(?:an?\s+)?(?:appointment|meeting)|am\s+i\s+(?:free|available)|free\s+time|tengo\s+(?:alguna?\s+)?(?:cita|reunion|compromiso)|estoy\s+libre|mi\s+disponibilidad)\b/).matched;
  const owned = matchSignal(view, /\b(?:minha\s+agenda|meu\s+calendario|my\s+(?:calendar|schedule)|mi\s+(?:agenda|calendario))\b/).matched;
  const ownedEvent = matchSignal(view, /\b(?:(?:eventos?|compromissos?)\b[^?.!]{0,50}\b(?:minha\s+agenda|meu\s+calendario)|(?:events?|appointments?)\b[^?.!]{0,50}\bmy\s+(?:calendar|schedule)|(?:eventos?|citas?|compromisos?)\b[^?.!]{0,50}\bmi\s+(?:agenda|calendario))\b/).matched;
  const noun = matchSignal(view, /\b(?:agenda|calendario|compromisso|compromissos|reuniao|reunioes|consulta|consultas|calendar|schedule|appointment|appointments|meeting|meetings|agenda|calendario|cita|citas|reunion|reuniones|compromiso|compromisos)\b/);
  const action = matchSignal(view, /\b(?:adicione|adicionar|marque|marcar|agende|agendar|remarque|remarcar|cancele|cancelar|consulte|consultar|verifique|verificar|revise|revisar|add|schedule|reschedule|cancel|check|review|anade|agrega|programa|reprograma|cancela|consulta|verifica|revisa)\b/).matched;
  const { request, question } = questionOrRequest(view);
  const personal = PERSONAL_CUE.test(view.folded);
  const terse = !!noun.text && new RegExp(`^\\s*(?:${noun.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i").test(view.original);
  result.slots.category = action ? "calendar_action" : "availability";
  result.slots.query = cleanQuery(noun.text);
  addEvidence(result, "calendar.personal-schedule", 0.62, strong);
  addEvidence(result, "calendar.owned", 0.28, owned);
  addEvidence(result, "calendar.owned-event", 0.64, ownedEvent);
  addEvidence(result, "calendar.noun", 0.30, noun.matched);
  addEvidence(result, "calendar.action", 0.38, action);
  addEvidence(result, "calendar.action-noun", 0.20, action && noun.matched);
  addEvidence(result, "context.personal", 0.12, personal);
  addEvidence(result, "request.cue", 0.10, request);
  addEvidence(result, "request.question", 0.04, question);
  addEvidence(result, "calendar.terse-query", 0.25, terse && !!slots.dateText);
  addEvidence(result, "slot.date", 0.08, !!slots.dateText);
  addEvidence(result, "slot.time", 0.06, !!slots.timeText);
  result.qualified = strong || ownedEvent || (noun.matched && (action || request || question || (terse && !!slots.dateText) || (owned && !!slots.dateText)) && (personal || action || !!slots.dateText));
  result.specificity = ownedEvent ? 5 : strong ? 4 : 2;
  return result;
}

function classifyEvents(view: FoldedText, slots: PersonalIntentSlots): Candidate {
  const result = candidate("events", slots);
  const noun = matchSignal(view, /\b(?:evento|eventos|festival|festivais|show|shows|concerto|concertos|exposicao|exposicoes|event|events|festival|festivals|concert|concerts|exhibition|exhibitions|evento|eventos|festival|festivales|concierto|conciertos|exposicion|exposiciones)\b/);
  const discovery = matchSignal(view, /\b(?:quais\s+eventos|eventos\s+(?:acontecendo|em|perto)|o\s+que\s+esta\s+acontecendo|find\s+events|what\s+events|events\s+(?:happening|near|in)|what(?:'s|\s+is)\s+happening|que\s+eventos|eventos\s+(?:en|cerca)|que\s+esta\s+pasando)\b/).matched;
  const { request, question } = questionOrRequest(view);
  const category = categoryOf(view, EVENT_CATEGORY_PATTERNS);
  const terse = noun.matched && /^\s*(?:eventos?|events?|festiv(?:al|ais|als|ales))\b/i.test(view.folded);
  result.slots.category = category.category || "event";
  result.slots.query = cleanQuery(category.text) || extractLocationQuery(view) || cleanQuery(noun.text);
  addEvidence(result, "events.noun", 0.50, noun.matched);
  addEvidence(result, "events.discovery", 0.30, discovery);
  addEvidence(result, "events.category", 0.08, !!category.category);
  addEvidence(result, "events.terse-query", 0.24, terse);
  addEvidence(result, "request.cue", 0.10, request);
  addEvidence(result, "request.question", 0.04, question);
  addEvidence(result, "slot.date", 0.08, !!slots.dateText);
  addEvidence(result, "events.location", 0.08, !!extractLocationQuery(view));
  result.qualified = noun.matched && (discovery || request || question || (terse && (!!slots.dateText || !!extractLocationQuery(view))));
  result.specificity = discovery ? 3 : 2;
  return result;
}

function classifyWeather(view: FoldedText, slots: PersonalIntentSlots): Candidate {
  const result = candidate("weather", slots);
  const strong = matchSignal(view, /\b(?:vai\s+chover|previsao\s+do\s+tempo|como\s+esta\s+o\s+tempo|qual\s+(?:e\s+)?o\s+clima|weather\s+forecast|what(?:'s|\s+is)\s+the\s+weather|will\s+it\s+(?:rain|snow)|is\s+it\s+going\s+to\s+(?:rain|snow)|pronostico\s+del\s+tiempo|como\s+esta\s+el\s+tiempo|va\s+a\s+llover|que\s+clima)\b/).matched;
  const noun = matchSignal(view, /\b(?:clima|chuva|chove|chover|temperatura|vento|weather|rain|raining|snow|snowing|temperature|forecast|clima|lluvia|llueve|llover|temperatura|viento|pronostico)\b/);
  const { request, question } = questionOrRequest(view);
  const terse = noun.matched && /^\s*(?:clima|chuva|temperatura|weather|rain|temperature|forecast|lluvia|pronostico)\b/.test(view.folded);
  result.slots.category = "weather";
  result.slots.query = extractLocationQuery(view) || cleanQuery(noun.text);
  addEvidence(result, "weather.explicit-question", 0.82, strong);
  addEvidence(result, "weather.noun", 0.50, noun.matched && !strong);
  addEvidence(result, "weather.terse-query", 0.24, terse);
  addEvidence(result, "request.cue", 0.10, request);
  addEvidence(result, "request.question", 0.04, question);
  addEvidence(result, "slot.date", 0.08, !!slots.dateText);
  addEvidence(result, "slot.time", 0.05, !!slots.timeText);
  addEvidence(result, "weather.location", 0.08, !!extractLocationQuery(view));
  result.qualified = strong || (noun.matched && (request || question || terse) && (!!slots.dateText || !!extractLocationQuery(view) || terse));
  result.specificity = strong ? 3 : 2;
  return result;
}

function classifyAutomation(view: FoldedText, slots: PersonalIntentSlots): Candidate {
  const result = candidate("automation", slots);
  const explicit = matchSignal(view, /\b(?:minha(?:s)?\s+automacoes?|automacao\s+(?:da|de|do|na|no)|home\s+assistant|my\s+automations?|automation\s+(?:for|in|at)|mis?\s+automatizaciones?|automatizacion\s+(?:de|del|en)|cena\s+(?:da|de|do)|my\s+scene|mi\s+escena)\b/).matched;
  const command = matchSignal(view, /\b(?:(?:ligue|acenda|desligue|apague|abra|feche|trave|destrave|ative|desative|ajuste|aumente|diminua|turn\s+on|turn\s+off|switch\s+on|switch\s+off|open|close|lock|unlock|activate|deactivate|set|raise|lower|enciende|prende|apaga|abre|cierra|bloquea|desbloquea|activa|desactiva|ajusta|sube|baja)\b[^?.!]{0,80}\b(?:luz|luzes|lampada|lampadas|ar\s+condicionado|termostato|porta|portas|fechadura|tomada|persiana|cortina|tv|televisao|som|lights?|lamps?|air\s+conditioner|thermostat|doors?|locks?|outlets?|blinds?|curtains?|television|speaker|luces?|lamparas?|aire\s+acondicionado|termostato|puertas?|cerraduras?|enchufes?|persianas?|cortinas?|televisor)|(?:luz|luzes|lampada|lampadas|ar\s+condicionado|termostato|porta|portas|fechadura|tomada|persiana|cortina|tv|televisao|som|lights?|lamps?|air\s+conditioner|thermostat|doors?|locks?|outlets?|blinds?|curtains?|television|speaker|luces?|lamparas?|aire\s+acondicionado|termostato|puertas?|cerraduras?|enchufes?|persianas?|cortinas?|televisor)\b[^?.!]{0,80}\b(?:ligue|acenda|desligue|apague|abra|feche|trave|destrave|ative|desative|ajuste|turn\s+on|turn\s+off|switch\s+on|switch\s+off|open|close|lock|unlock|activate|deactivate|set|enciende|prende|apaga|abre|cierra|bloquea|desbloquea|activa|desactiva|ajusta))\b/).matched;
  const evChargerCommand = matchSignal(view, /\b(?:(?:ligue|desligue|ative|desative|turn\s+on|turn\s+off|activate|deactivate|enciende|apaga|activa|desactiva)\b[^?.!]{0,80}\b(?:carregador\s+(?:do|de)\s+carro|ev\s+charger|cargador\s+(?:del|de)\s+coche)|(?:carregador\s+(?:do|de)\s+carro|ev\s+charger|cargador\s+(?:del|de)\s+coche)\b[^?.!]{0,80}\b(?:ligue|desligue|ative|desative|turn\s+on|turn\s+off|activate|deactivate|enciende|apaga|activa|desactiva))\b/).matched;
  const automationAction = matchSignal(view, /\b(?:execute|executar|rode|rodar|ative|ativar|desative|desativar|teste|testar|run|start|activate|deactivate|test|execute|ejecuta|inicia|activa|desactiva|prueba|probar)\s+(?:a\s+|the\s+|la\s+)?(?:automacao|automation|automatizacion|cena|scene|escena)\b/).matched;
  const list = matchSignal(view, /\b(?:liste|mostre|quais\s+sao|list|show|what\s+are|enumera|muestra|cuales\s+son)\s+(?:as\s+|my\s+|the\s+|mis\s+|las\s+)?(?:automacoes|automations|automatizaciones|cenas|scenes|escenas)\b/).matched;
  const device = categoryOf(view, [
    ["light", /\b(?:luz|luzes|lampada|lampadas|light|lights|lamp|lamps|luz|luces|lampara|lamparas)\b/],
    ["climate", /\b(?:ar\s+condicionado|termostato|air\s+conditioner|thermostat|aire\s+acondicionado|termostato)\b/],
    ["lock", /\b(?:fechadura|fechaduras|lock|locks|cerradura|cerraduras)\b/],
    ["cover", /\b(?:persiana|persianas|cortina|cortinas|blind|blinds|curtain|curtains)\b/],
    ["media", /\b(?:tv|televisao|som|television|speaker|televisor|altavoz)\b/],
    ["outlet", /\b(?:tomada|tomadas|outlet|outlets|enchufe|enchufes)\b/],
  ]);
  const { request, question } = questionOrRequest(view);
  result.slots.category = evChargerCommand ? "ev_charger" : device.category || "automation";
  result.slots.query = cleanQuery(device.text) || (explicit ? "automation" : undefined);
  addEvidence(result, "automation.device-command", 0.84, command);
  addEvidence(result, "automation.ev-charger-command", 0.84, evChargerCommand);
  addEvidence(result, "automation.named-action", 0.84, automationAction);
  addEvidence(result, "automation.explicit", 0.56, explicit);
  addEvidence(result, "automation.list", 0.36, list);
  addEvidence(result, "context.personal", 0.10, PERSONAL_CUE.test(view.folded));
  addEvidence(result, "request.cue", 0.10, request);
  addEvidence(result, "request.question", 0.04, question);
  addEvidence(result, "slot.time", 0.05, !!slots.timeText);
  result.qualified = command || evChargerCommand || automationAction || list || (explicit && (request || question || PERSONAL_CUE.test(view.folded)));
  result.specificity = command || evChargerCommand || automationAction ? 5 : 3;
  return result;
}

function classifyEv(view: FoldedText, slots: PersonalIntentSlots): Candidate {
  const result = candidate("ev", slots);
  const strong = matchSignal(view, /\b(?:estacao\s+de\s+recarga|ponto\s+de\s+recarga|carregador\s+(?:de|para)\s+(?:carro|veiculo)\s+eletrico|carregar\s+(?:o\s+|meu\s+)?(?:carro|veiculo)\s+eletrico|carregar\s+meu\s+carro|ev\s+charger|electric\s+(?:vehicle|car)\s+charger|charging\s+station|charge\s+my\s+(?:ev|electric\s+car)|cargar\s+mi\s+(?:coche|auto|vehiculo)\s+electrico|cargador\s+(?:de|para)\s+(?:coche|auto|vehiculo)\s+electrico|punto\s+de\s+carga|estacion\s+de\s+carga)\b/).matched;
  const connector = matchSignal(view, /\b(?:ccs(?:1|2)?|chademo|type\s*2|tipo\s*2|nacs|j1772|mennekes|supercharger)\b/);
  const proximity = matchSignal(view, /\b(?:perto\s+de\s+mim|proximo\s+de\s+mim|proxima\s+de\s+mim|near\s+me|nearby|cerca\s+de\s+mi|a\s+mi\s+alrededor)\b/).matched;
  const { request, question } = questionOrRequest(view);
  result.slots.category = "charging_station";
  result.slots.query = cleanQuery(connector.text) || (strong ? "electric vehicle charging" : undefined);
  addEvidence(result, "ev.charging", 0.66, strong);
  addEvidence(result, "ev.connector", 0.58, connector.matched);
  addEvidence(result, "ev.proximity", 0.16, proximity);
  addEvidence(result, "ev.connector-proximity", 0.10, connector.matched && proximity);
  addEvidence(result, "request.cue", 0.12, request);
  addEvidence(result, "request.question", 0.04, question);
  addEvidence(result, "slot.radius", 0.08, slots.radiusMeters !== undefined);
  result.qualified = strong ? request || question || proximity || /^\s*(?:estacao|ponto|ev\s+charger|charging\s+station|cargador|punto|estacion)\b/.test(view.folded) : connector.matched && (request || question || proximity);
  result.specificity = 6;
  return result;
}

function codeRequest(view: FoldedText): boolean {
  const text = view.folded;
  if (HARD_CODE_CONTEXT.test(text)) return true;
  const pathWithSeparator = /(?:^|[\s"'(])([^\s"']+[\\/][^\s"']+)/.exec(text)?.[1];
  const numericDate = pathWithSeparator && /^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/.test(pathWithSeparator);
  return CODE_ACTION.test(text) && (CODE_OBJECT.test(text) || (!!pathWithSeparator && !numericDate));
}

function detectLocale(view: FoldedText, requested?: PersonalIntentLocale | "auto"): PersonalIntentLocale {
  if (requested && requested !== "auto") return requested;
  const scores: Record<PersonalIntentLocale, number> = { "pt-BR": 0, en: 0, es: 0 };
  const rules: ReadonlyArray<readonly [PersonalIntentLocale, RegExp]> = [
    ["pt-BR", /\b(?:perto|amanha|hoje|minha|meu|quais|onde|chover|ligue|desligue|carro|compromisso|reuniao)\b/],
    ["en", /\b(?:near|tomorrow|today|my|what|which|where|find|weather|rain|turn|route|calendar|meeting|event|events|music|happening|this|weekend|charging)\b/],
    ["es", /\b(?:cerca|manana|hoy|donde|cuales|hay|llover|enciende|apaga|coche|cita|reunion|carga)\b/],
  ];
  for (const [locale, pattern] of rules) {
    const matches = view.folded.match(new RegExp(pattern.source, "g"));
    scores[locale] += matches?.length || 0;
  }
  if (/[ãõç]/i.test(view.original)) scores["pt-BR"] += 2;
  if (/[ñ¿¡]/i.test(view.original)) scores.es += 2;
  return (Object.entries(scores) as Array<[PersonalIntentLocale, number]>).sort((a, b) => b[1] - a[1] || (["pt-BR", "en", "es"].indexOf(a[0]) - ["pt-BR", "en", "es"].indexOf(b[0])))[0][0];
}

function normalizedConfidence(score: number): number {
  return Math.round(Math.min(0.99, Math.max(0, score)) * 1_000) / 1_000;
}

function isSpecificOverlap(winner: Candidate, runnerUp: Candidate): boolean {
  const pair = new Set([winner.intent, runnerUp.intent]);
  const expected = (left: PersonalIntentName, right: PersonalIntentName) => pair.has(left) && pair.has(right);
  return winner.specificity > runnerUp.specificity && (
    expected("ev", "nearby")
    || expected("automation", "ev")
    || expected("calendar", "events")
    || expected("mobility", "nearby")
  );
}

function validateThreshold(threshold: number): number {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError("personal intent threshold must be between 0 and 1");
  return threshold;
}

/**
 * Returns the strongest plausible personal intent, including sub-threshold candidates.
 * Code-only spans and explicit software-engineering requests are excluded before scoring.
 */
export function classifyPersonalIntent(text: string, options: Omit<PersonalIntentRouterOptions, "threshold"> = {}): PersonalIntentMatch | null {
  if (typeof text !== "string" || !text.trim() || text.length > 20_000) return null;
  const view = foldText(text);
  if (!view.folded.trim() || codeRequest(view)) return null;
  const slots = baseSlots(view);
  const candidates = [
    classifyNearby(view, slots),
    classifyMobility(view, slots),
    classifyCalendar(view, slots),
    classifyEvents(view, slots),
    classifyWeather(view, slots),
    classifyAutomation(view, slots),
    classifyEv(view, slots),
  ].filter((item) => item.qualified);
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.score - left.score || right.specificity - left.specificity || PERSONAL_INTENT_NAMES.indexOf(left.intent) - PERSONAL_INTENT_NAMES.indexOf(right.intent));
  let winner = candidates[0];
  for (const item of candidates.slice(1)) {
    if (item.score >= PERSONAL_INTENT_HIGH_PRECISION_THRESHOLD && isSpecificOverlap(item, winner)) winner = item;
  }
  const ambiguousCompetitor = candidates.find((item) => item !== winner && Math.abs(winner.score - item.score) < 0.08 && !isSpecificOverlap(winner, item));
  const confidenceScore = ambiguousCompetitor
    ? Math.min(winner.score, PERSONAL_INTENT_HIGH_PRECISION_THRESHOLD - 0.01)
    : winner.score;
  return {
    intent: winner.intent,
    locale: detectLocale(view, options.locale),
    confidence: normalizedConfidence(confidenceScore),
    evidence: winner.evidence,
    slots: Object.fromEntries(Object.entries(winner.slots).filter(([, value]) => value !== undefined)) as PersonalIntentSlots,
  };
}

export function isHighPrecisionPersonalIntent(
  match: PersonalIntentMatch | null | undefined,
  threshold = PERSONAL_INTENT_HIGH_PRECISION_THRESHOLD,
): match is PersonalIntentMatch {
  const minimum = validateThreshold(threshold);
  return !!match && match.confidence >= minimum;
}

/** Returns only intents safe for automatic personal-context routing. */
export function routePersonalIntent(text: string, options: PersonalIntentRouterOptions = {}): PersonalIntentMatch | null {
  const threshold = validateThreshold(options.threshold ?? PERSONAL_INTENT_HIGH_PRECISION_THRESHOLD);
  const match = classifyPersonalIntent(text, { locale: options.locale });
  return isHighPrecisionPersonalIntent(match, threshold) ? match : null;
}
