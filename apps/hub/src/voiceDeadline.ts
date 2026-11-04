/** Bounded waits with timer cleanup. onTimeout must cancel the underlying operation. */
export async function voiceDeadline<T>(work: Promise<T>, ms: number, message: string, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try { onTimeout(); }
        catch (cause) { reject(new Error(message, { cause })); return; }
        reject(new Error(message));
      }, Math.max(1, ms));
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
