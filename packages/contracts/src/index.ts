// Contract-first schemas (§10 Phase 2). OpenAPI + events grow here; bots/API import types from this package.
export const BOT_KEYS = ["security", "moderation", "community", "ai", "music", "commerce"] as const;
export type BotKey = (typeof BOT_KEYS)[number];

export interface HealthReport {
  service: string;
  liveness: "ok" | "degraded" | "down" | "unknown";
  gateway: "ok" | "degraded" | "down" | "unknown";
  dbReady: boolean;
  provider: "ok" | "degraded" | "down" | "unknown";
  latencyMs: number | null;
}

export interface OutboxEvent<T = unknown> {
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: T;
  correlationId: string;
}

// Phase 4 — dashboard foundation contracts (§6). Server owns all values; browser never
// chooses amounts, discounts or guild access.
export type ServiceState = "ok" | "degraded" | "down" | "unknown";

export interface ServiceCard {
  botKey: BotKey;
  state: ServiceState;
  gateway: ServiceState;
  dbReady: boolean;
  latencyMs: number | null;
  updatedAt: string;
}

export interface GuildInfo {
  guildId: string;
  name: string;
  approved: boolean;
}

export type DataState = "loading" | "empty" | "failed" | "stale" | "saving" | "confirmed" | "ready";

export interface ErrorEnvelope {
  error: string;
  code: string;
  correlationId: string;
  retryable: boolean;
}

export interface SessionClaims {
  discordUserId: string;
  expiresAt: number; // epoch ms
}

// Phase 7 — public order verification. Only safe-to-publish fields;
// the lookup key is the token hash, never buyer identity.
export interface OrderVerification {
  skuName: string;
  amountMinor: number;
  status: "pending" | "claimed" | "settled" | "rejected" | "expired";
}
