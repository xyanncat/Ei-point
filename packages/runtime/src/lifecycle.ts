// Shared interaction lifecycle (§5): ack → authorize → deadline → exactly-once reply → telemetry.
import { INTERACTION_DEADLINE_MS, type FailureCategory, type TelemetryFields } from "./index.js";
import { isGuildApproved } from "./auth.js";
import { newCorrelationId } from "./jobs.js";

export interface LifecycleDeps {
  botKey: string;
  guildId: string | null;
  allowlist: string[];
  /** Defer within 3 s when work may be slow; resolves when the ack is sent. */
  defer: () => Promise<void>;
  /** The real work. Rejects on failure. Receives an abort signal at deadline. */
  run: (signal: AbortSignal) => Promise<string>;
  /** Exactly-once sink (reply or follow-up). Second call must throw or be ignored by caller guard. */
  reply: (message: string) => Promise<void>;
  onTelemetry: (t: TelemetryFields) => void;
  ackTimeoutMs?: number;
  deadlineMs?: number;
}

export async function handleInteraction(deps: LifecycleDeps): Promise<void> {
  const correlationId = newCorrelationId();
  const started = Date.now();
  let replied = false;
  const replyOnce = async (message: string): Promise<void> => {
    if (replied) throw new Error("double-reply blocked");
    replied = true;
    await deps.reply(message);
  };
  const done = (failureCategory?: FailureCategory): void => {
    deps.onTelemetry({
      correlationId,
      botKey: deps.botKey,
      latencyMs: Date.now() - started,
      ...(failureCategory !== undefined ? { failureCategory } : {}),
    });
  };

  // Step 2 first: never side-effect for unauthorized guilds.
  if (!isGuildApproved(deps.guildId, deps.allowlist)) {
    await replyOnce("This server is not approved for Ei Royality.");
    done("auth");
    return;
  }

  // Step 1: acknowledge fast or fail clearly (Discord requires ≤3 s).
  const ackTimeout = deps.ackTimeoutMs ?? INTERACTION_DEADLINE_MS;
  try {
    await withTimeout(deps.defer(), ackTimeout);
  } catch {
    await replyOnce("Service is starting — please retry in a moment.");
    done("timeout");
    return;
  }

  // Steps 3–4: deadline + cancellation, exactly one result.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), deps.deadlineMs ?? 60000);
  try {
    const result = await deps.run(controller.signal);
    await replyOnce(result);
    done();
  } catch (err) {
    const aborted = controller.signal.aborted;
    try {
      await replyOnce(
        aborted
          ? "Request timed out — safe to retry; no duplicate charge or card move was made."
          : "Something failed safely — nothing was applied. Please retry.",
      );
    } catch {
      // replyOnce throwing means a double-reply bug; surface via telemetry only.
    }
    const msg = err instanceof Error ? err.message : String(err);
    done(aborted ? "timeout" : (/rate.?limit/i.test(msg) ? "rate-limit" : "unknown"));
  } finally {
    clearTimeout(deadline);
  }
}

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("ack-timeout")), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout]);
}
