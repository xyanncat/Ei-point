// Shared HTTP discipline for external AI providers (redesign infrastructure §6):
// bounded response bodies, one bounded retry on overload, and a tiny failure
// gate so an outage does not cost every caller a full timeout. Local model
// adapters keep their own queue/health semantics and do not use this file.

/**
 * Read a response body to completion but never past `limit` bytes. Cancelling
 * the reader frees the socket immediately, so a hostile or broken backend
 * cannot hold memory while streaming megabytes.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  limit: number,
  tooLargeError: string,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(tooLargeError);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * One retry, bounded backoff, only for retryable statuses (429/5xx). The
 * caller's AbortSignal still owns the total deadline; sleeping is abortable.
 * Provider errors that are not retryable are returned to the caller as-is.
 */
export async function fetchWithBoundedRetry(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  options: { retryDelayMs?: number } = {},
): Promise<Response> {
  const retryDelayMs = options.retryDelayMs ?? 750;
  let response = await fetchFn(url, init);
  if (response.status !== 429 && response.status < 500) return response;
  await response.body?.cancel().catch(() => {});
  // Sleeping is abortable; an already-aborted signal makes the retry fetch
  // itself reject immediately, so no stale work survives the deadline.
  await abortableDelay(retryDelayMs, init.signal);
  response = await fetchFn(url, init);
  return response;
}

function abortableDelay(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("provider-deadline"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Minimal outage gate: after `threshold` consecutive failures, calls fail fast
 * for `cooldownMs` instead of buying every user a timeout. One success closes
 * it again. Deliberately tiny — this is a courtesy, not a dependency.
 */
export function createFailureGate(options: { threshold?: number; cooldownMs?: number; now?: () => number } = {}) {
  const threshold = options.threshold ?? 5;
  const cooldownMs = options.cooldownMs ?? 30_000;
  const now = options.now ?? Date.now;
  let failures = 0;
  let openUntil = 0;
  return {
    allow(): boolean {
      return now() >= openUntil;
    },
    ok(): void {
      failures = 0;
      openUntil = 0;
    },
    fail(): void {
      failures += 1;
      if (failures >= threshold) {
        openUntil = now() + cooldownMs;
        failures = 0;
      }
    },
  };
}