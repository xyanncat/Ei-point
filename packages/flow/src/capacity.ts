// Real-work admission and duplicate-interaction fencing (§5, A04).
//
// Capacity lasts until the real work settles, not until its deadline: work that
// ignores cancellation keeps its slot, so measured concurrency stays honest and
// a new request cannot start while the old outcome is still unknown.
export interface WorkGate {
  readonly limit: number;
  isClosed(): boolean;
  /** Takes one slot; undefined when full or closed. The release is idempotent. */
  tryAcquire(): (() => void) | undefined;
  inFlight(): number;
  /** Refuse new work and wait, bounded, until in-flight work settles. */
  close(): void;
  drain(timeoutMs: number): Promise<boolean>;
}

export function createWorkGate(limit: number): WorkGate {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("work gate limit must be a positive integer");
  let inFlight = 0;
  let closed = false;
  let drained: (() => void) | undefined;
  return {
    limit,
    isClosed: () => closed,
    tryAcquire() {
      if (closed || inFlight >= limit) return undefined;
      inFlight++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight--;
        if (inFlight === 0 && drained) {
          const notify = drained;
          drained = undefined;
          notify();
        }
      };
    },
    inFlight: () => inFlight,
    close() {
      closed = true;
    },
    drain(timeoutMs) {
      if (inFlight === 0) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          drained = undefined;
          resolve(false);
        }, timeoutMs);
        timer.unref?.();
        drained = () => {
          clearTimeout(timer);
          resolve(true);
        };
      });
    },
  };
}

// Duplicate gateway deliveries (Discord re-sends unacknowledged interactions)
// carry the same interaction id. Each id may claim once within the token
// lifetime; a replay after that window is beyond Discord's retry horizon.
export interface InteractionClaims {
  /** true when the operation id was not seen within the TTL. */
  claim(operationId: string): boolean;
  size(): number;
}

export function createInteractionClaims(options: { ttlMs?: number; maxEntries?: number } = {}): InteractionClaims {
  const ttlMs = options.ttlMs ?? 15 * 60_000;
  const maxEntries = options.maxEntries ?? 10_000;
  const seen = new Map<string, number>();
  const sweep = (now: number): void => {
    // Insertion order equals timestamp order: claims are never re-stamped.
    for (const [id, claimedAt] of seen) {
      if (now - claimedAt > ttlMs) seen.delete(id);
      else break;
    }
  };
  return {
    claim(operationId) {
      const now = Date.now();
      sweep(now);
      if (seen.has(operationId)) return false;
      seen.set(operationId, now);
      while (seen.size > maxEntries) {
        const oldest = seen.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
      return true;
    },
    size: () => seen.size,
  };
}
