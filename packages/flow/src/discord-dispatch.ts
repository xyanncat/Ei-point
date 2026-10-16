import { handleInteraction, type WorkContext } from "./lifecycle.js";
import { newCorrelationId } from "./jobs.js";
import type { InteractionClaims, WorkGate } from "./capacity.js";
import type { FailureCategory, TelemetryFields } from "./index.js";

export interface InteractionPort<TReply> {
  guildId: string | null;
  deferred: boolean;
  replied: boolean;
  deferReply: (options: { ephemeral: boolean }) => Promise<unknown>;
  reply: (response: TReply & { ephemeral: boolean }) => Promise<unknown>;
  editReply: (response: TReply) => Promise<unknown>;
}

/** Shared Discord transport adapter for approval, authorization, deadlines and exactly-once responses. */
export async function dispatchGuildCommand<TReply>(deps: {
  botKey: string;
  allowlist: string[];
  interaction: InteractionPort<TReply>;
  authorize: () => Promise<TReply | undefined>;
  run: (ctx: WorkContext) => Promise<TReply | undefined>;
  failureReply: (category: FailureCategory) => TReply;
  onTelemetry: (fields: TelemetryFields) => void;
  /** Bounded real-work admission; slots are reserved until the real work settles. */
  gate?: WorkGate;
  /** Duplicate-delivery fence. Requires operationId. */
  claims?: InteractionClaims;
  /** Stable id for this interaction (Discord interaction id). */
  operationId?: string;
  ephemeral?: boolean;
  deadlineMs?: number;
}): Promise<void> {
  const ephemeral = deps.ephemeral ?? true;
  const started = Date.now();
  const report = (failureCategory: FailureCategory): void => {
    try {
      deps.onTelemetry({
        correlationId: deps.operationId ?? newCorrelationId(),
        botKey: deps.botKey,
        latencyMs: Date.now() - started,
        failureCategory,
      });
    } catch {
      // Telemetry must not break refusals.
    }
  };
  const refuse = async (category: FailureCategory): Promise<void> => {
    try {
      if (deps.interaction.deferred || deps.interaction.replied) {
        await deps.interaction.editReply(deps.failureReply(category));
      } else {
        await deps.interaction.reply({ ...deps.failureReply(category), ephemeral });
      }
    } finally {
      report(category);
    }
  };

  if (deps.gate?.isClosed()) {
    await refuse("shutting-down");
    return;
  }
  let release: (() => void) | undefined;
  if (deps.gate) {
    release = deps.gate.tryAcquire();
    if (!release) {
      await refuse("queue-full");
      return;
    }
  }
  // Claim after admission: a busy refusal must not burn the interaction id,
  // so Discord's retry can still be admitted once capacity frees.
  if (deps.claims && deps.operationId && !deps.claims.claim(deps.operationId)) {
    release?.();
    await refuse("duplicate");
    return;
  }

  return handleInteraction({
    botKey: deps.botKey,
    guildId: deps.interaction.guildId,
    allowlist: deps.allowlist,
    defer: () => deps.interaction.deferReply({ ephemeral }).then(() => {}),
    authorize: deps.authorize,
    run: deps.run,
    reply: async (response) => {
      if (deps.interaction.deferred || deps.interaction.replied) {
        await deps.interaction.editReply(response);
      } else {
        await deps.interaction.reply({ ...response, ephemeral });
      }
    },
    failureReply: deps.failureReply,
    onTelemetry: deps.onTelemetry,
    ...(deps.operationId !== undefined ? { operationId: deps.operationId } : {}),
    ...(release !== undefined ? { releaseCapacity: release } : {}),
    ...(deps.deadlineMs !== undefined ? { deadlineMs: deps.deadlineMs } : {}),
  });
}
