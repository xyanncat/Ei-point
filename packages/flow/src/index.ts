import { z } from "zod";

// Validated config — fail fast at boot, never with half-loaded secrets (§10 Phase 2).
// Cache failure never grants access or confirms a mutation (§4).

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(10).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  TEST_GUILD_ID: z.string().regex(/^\d+$/).optional(),
  AI_DEADLINE_MS: z.coerce.number().default(60000),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  botKey: string;
  guildAllowlist: string[];
};

export function loadConfig(botKey: string): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`invalid config: ${parsed.error.message}`);
  }
  return {
    ...parsed.data,
    botKey,
    guildAllowlist: (process.env.GUILD_ALLOWLIST ?? "").split(",").filter(Boolean),
  };
}

// Interaction lifecycle (§5): ack → authorize → deadline → exactly-once reply → telemetry.
export const INTERACTION_DEADLINE_MS = 2500; // initial ack must beat Discord's 3 s limit
export type FailureCategory =
  | "auth" | "permissions" | "rate-limit" | "timeout" | "provider"
  | "db-unavailable" | "queue-full" | "stale-component" | "unknown";

export interface TelemetryFields {
  correlationId: string;
  botKey: string;
  latencyMs: number;
  failureCategory?: FailureCategory;
}

export * from "./auth.js";
export * from "./jobs.js";
export * from "./lifecycle.js";
export * from "./discord-dispatch.js";
export * from "./outbox.js";
export * from "./shutdown.js";
export * from "./database.js";
export * from "./community-outbox.js";
export * from "./controls.js";
export * from "./embed-delivery.js";
