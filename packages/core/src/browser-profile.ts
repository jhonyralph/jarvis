/** Windows Chromium can probe the account with an EMPTY password on a fresh profile. Each
 * launch then counts as a failed Windows logon; test suites can lock the Hub's service account.
 * Seed the browser's cache conservatively: a password is required. This suppresses the probe,
 * never bypasses authentication and never changes Windows policy or the user's Chrome profile.
 * See CheckBlankPasswordWithPrefs in Chromium's password_manager_util_win.cc and crbug/541310282.
 */
import { readFile, open, rename, rm } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Call only for a Jarvis-owned profile directory AFTER its previous browser has stopped. */
export async function prepareBrowserProfile(dir: string, os = platform()): Promise<void> {
  if (os !== "win32") return;
  const file = join(dir, "Local State");
  let state: unknown;
  try { state = JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Não foi possível preparar o perfil Chromium sem provocar logon inválido: ${file}`, { cause: error });
    }
    state = {};
  }
  if (!isRecord(state) || (state.password_manager !== undefined && !isRecord(state.password_manager))) {
    throw new Error(`Local State inválido; perfil preservado: ${file}`);
  }
  // Chromium time = microseconds since 1601, serialized as a STRING (an int64 pref). Refresh
  // before each launch rather than pinning a far-future timestamp. A minute covers rounding/skew
  // in NetUserGetInfo's seconds-based password age. false means reauthentication stays REQUIRED.
  const checkedAt = ((BigInt(Date.now()) + 11_644_473_600_000n + 60_000n) * 1_000n).toString();
  state.password_manager = { ...(state.password_manager as Record<string, unknown> | undefined),
    os_password_blank: false, os_password_last_changed: checkedAt };
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tmp, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(tmp, file);
  } finally { await rm(tmp, { force: true }).catch(() => {}); }
}
