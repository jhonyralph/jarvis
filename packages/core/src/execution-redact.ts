/** Best-effort secret scrubbing for the secondary execution journal/UI.
 * The canonical chat/transcript remains provider-owned; this prevents common credentials from
 * being duplicated into the global work graph, diagnostics and tool details. */
const RULES: RegExp[] = [
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:sk|gh[pousr]|github_pat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\b((?:[A-Z][A-Z0-9_]*_)?(?:TOKEN|API_KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?)\s*[:=]\s*)['"]?[^\s'";,]{6,}['"]?/gi,
  /(https?:\/\/[^\s/:@]+:)[^\s/@]+(@)/gi,
];

export function redactExecutionText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let out = value;
  out = out.replace(RULES[0], "$1[REDACTED]");
  out = out.replace(RULES[1], "[REDACTED_TOKEN]");
  out = out.replace(RULES[2], "[REDACTED_AWS_KEY]");
  out = out.replace(RULES[3], "[REDACTED_PRIVATE_KEY]");
  out = out.replace(RULES[4], "$1[REDACTED]");
  out = out.replace(RULES[5], "$1[REDACTED]$2");
  return out;
}
