// Shared interaction lifecycle (§5): ack → authorize → deadline → exactly-once reply → telemetry.
import { INTERACTION_DEADLINE_MS, type FailureCategory, type TelemetryFields } from "./index.js";
import { isGuildApproved } from "./auth.js";
import { newCorrelationId } from "./jobs.js";

export interface LifecycleDeps<TReply = string> {
  botKey: string;
  guildId: string | null;
  allowlist: string[];
  /** Defer within 3 s when work may be slow; resolves when the ack is sent. */
  defer: () => Promise<void>;
  /** Runs after the optional authorizer. A denial value is replied without starting work. */
  authorize?: () => Promise<TReply | undefined>;
  /** The real work. Rejects on failure. Receives an abort signal at deadline. */
  run: (signal: AbortSignal) => Promise<TReply>;
  /** Exactly-once sink (reply or follow-up). Second call is blocked by this lifecycle. */
  reply: (message: TReply) => Promise<void>;
  /** Response payload used for authorization, acknowledgement, timeout and work failures. */
  failureReply: (category: FailureCategory) => TReply;
  onTelemetry: (t: TelemetryFields) => void;
  ackTimeoutMs?: number;
  deadlineMs?: number;
}

export async function handleInteraction<TReply = string>(deps: LifecycleDeps<TReply>): Promise<void> {
  const correlationId = newCorrelationId();
  const started = Date.now();
  let replied = false;
  const replyOnce = async (message: TReply): Promise<void> => {
    if (replied) throw new Error("double-reply blocked");
    replied = true;
    await deps.reply(message);
  };
  const done = (failureCategory?: FailureCategory): void => {
    try {
      deps.onTelemetry({
        correlationId,
        botKey: deps.botKey,
        latencyMs: Date.now() - started,
        ...(failureCategory !== undefined ? { failureCategory } : {}),
      });
    } catch {
      // Telemetry must not break acknowledgement, authorization or the result path.
    }
  };

  // Step 2 first: never side-effect for unauthorized guilds.
  if (!isGuildApproved(deps.guildId, deps.allowlist)) {
    await replyOnce(deps.failureReply("auth"));
    done("auth");
    return;
  }

  // Step 1: acknowledge fast or fail clearly (Discord requires ≤3 s).
  const ackTimeout = deps.ackTimeoutMs ?? INTERACTION_DEADLINE_MS;
  try {
    await withTimeout(deps.defer(), ackTimeout);
  } catch {
    try {
      await replyOnce(deps.failureReply("timeout"));
    } catch {
      // interaction already expired or dead; surface via telemetry
    }
    done("timeout");
    return;
  }

  // Steps 3–4: deadline + cancellation, exactly one result.
  const controller = new AbortController();
  let deadline: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => { controller.abort(); reject(new Error("work-deadline")); }, deps.deadlineMs ?? 60000);
  });
  try {
    const denied = await Promise.race([
      Promise.resolve().then(() => deps.authorize?.()),
      expired,
    ]);
    if (denied !== undefined) {
      await replyOnce(denied);
      done("permissions");
      return;
    }
    const result = await Promise.race([Promise.resolve().then(() => deps.run(controller.signal)), expired]);
    await replyOnce(result);
    done();
  } catch (err) {
    const aborted = controller.signal.aborted;
    try {
      await replyOnce(deps.failureReply(aborted ? "timeout" : classifyFailure(err)));
    } catch {
      // replyOnce throwing means a double-reply bug; surface via telemetry only.
    }
    done(aborted ? "timeout" : classifyFailure(err));
  } finally {
    clearTimeout(deadline);
  }
}

function classifyFailure(err: unknown): FailureCategory {
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/rate.?limit/i.test(message)) return "rate-limit";
  if (/ECONN|57P01|database.*unavailable/i.test(message)) return "db-unavailable";
  return "unknown";
}

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("ack-timeout")), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout]);
}
