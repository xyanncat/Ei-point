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
