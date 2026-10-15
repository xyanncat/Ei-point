import { handleInteraction } from "./lifecycle.js";
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
  run: (signal: AbortSignal) => Promise<TReply>;
  failureReply: (category: FailureCategory) => TReply;
  onTelemetry: (fields: TelemetryFields) => void;
  ephemeral?: boolean;
  deadlineMs?: number;
}): Promise<void> {
  const ephemeral = deps.ephemeral ?? true;
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
    ...(deps.deadlineMs !== undefined ? { deadlineMs: deps.deadlineMs } : {}),
  });
}
