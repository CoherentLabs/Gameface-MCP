/**
 * Races a promise against a fixed deadline so a stuck CDP round-trip (e.g. the
 * connected page's JS thread is blocked by whatever bug we're trying to
 * diagnose) surfaces as a rejection instead of hanging the caller forever.
 *
 * This does not - and cannot - cancel the underlying CDP command; if the
 * target page's thread is truly wedged, the abandoned command just resolves
 * (or never does) after this has already returned. That's fine: the goal is
 * only to make sure the MCP client never hangs, not to interrupt remote JS
 * execution, which CDP has no reliable way to do short of killing the process.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
