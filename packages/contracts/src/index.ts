// Contract-first schemas (§10 Phase 2). OpenAPI + events grow here; bots/API import types from this package.
export type { paths as DashboardApiPaths, components as DashboardApiSchemas } from './dashboard-api.js';
export const BOT_KEYS = ["kafka", "cyrene", "robin", "cipher", "silverwolf", "himiko"] as const;
export type BotKey = (typeof BOT_KEYS)[number];

// Legacy module keys (pre-rename) mapped to the new identities.
// kafka = security+moderation+logging, cyrene = ai+search+tts,
// robin = music, cipher = commerce, silverwolf = games,
// himiko = embed, announce, welcome, community, leveling.
export const BOT_MODULES: Record<BotKey, string[]> = {
  kafka: ["security", "moderation", "logging"],
  cyrene: ["ai", "search", "tts"],
  robin: ["music"],
  cipher: ["commerce"],
  silverwolf: ["games"],
  himiko: ["embed", "announce", "welcome", "community", "leveling"],
};

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
  botKey: string;
  modules?: string[];
  stale?: boolean;
  provider?: ServiceState;
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
  /** Discord CDN icon hash, when Discord shares one. */
  icon?: string | null;
  scopes?: string[];
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
  sessionId?: string;
  expiresAt: number; // epoch ms
}

export interface DashboardOverview {
  guild: GuildInfo;
  cards: ServiceCard[];
  stale: boolean;
  fetchedAt: string;
  incidents: { id: string; kind: string; severity: string; createdAt: string }[];
  actions: { id: string; key: string; version: number; changedAt: string }[];
}

// Phase 7 — public order verification. Only safe-to-publish fields;
// the lookup key is the token hash, never buyer identity.
export interface OrderVerification {
  skuName: string;
  amountMinor: number;
  status: "pending" | "claimed" | "settled" | "rejected" | "expired";
}

// Website catalog: server-owned prices. Browser displays; never sets.
export interface CatalogItem {
  sku: string;
  name: string;
  priceMinor: number;
  currency: string;
  game?: string | null;
  category?: string | null;
  duration?: string | null;
  description?: string | null;
  membershipDays?: number | null;
}

// The role ladder. Master outranks admin; admin outranks user.
export type Role = "user" | "admin" | "master";

// The founding identities. DASHBOARD_ADMIN_IDS / DASHBOARD_MASTER_IDS override
// them at runtime; the defaults keep a fresh install working.
export const DEFAULT_ADMIN_IDS = ["733513636269785120"] as const;
export const DEFAULT_MASTER_IDS = ["1479589523426902208"] as const;

const snowflake = (value: string) => /^\d{17,20}$/.test(value);

/** Parse a comma-separated ID list, falling back when it holds nothing valid. */
export function roleIdsFromEnv(
  raw: string | undefined,
  fallback: readonly string[],
): string[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(snowflake);
  return parsed.length ? parsed : fallback.filter(snowflake);
}

/** True when the identity is the master. A master is never bound by roles. */
export function isMasterId(
  discordUserId: string | undefined | null,
  raw?: string,
): boolean {
  if (!discordUserId) return false;
  return roleIdsFromEnv(raw, DEFAULT_MASTER_IDS).includes(discordUserId);
}
