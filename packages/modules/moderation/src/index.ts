// Moderation module: cases, sanctions, expiry, purge planning, permission checks
// (§2 moderation bot, §4 moderation.*). Pure logic + SQL; no discord.js here.

export type CaseKind = "warn" | "ban" | "unban" | "timeout" | "purge" | "note";

export interface NewCase {
  guildId: string;
  userId: string;
  kind: CaseKind;
  reason: string;
  expiresAt: string | null; // ISO timestamp or null
  moderatorId: string;
  idempotencyKey: string;
}

// Staff scopes (see access.staff_roles). Least privilege: each action names its scope.
const ACTION_SCOPES: Record<CaseKind, string> = {
  warn: "moderation-warn",
  ban: "moderation-ban",
  unban: "moderation-ban",
  timeout: "moderation-timeout",
  purge: "moderation-purge",
  note: "moderation-note",
};

export function canModerate(grantedScopes: string[], kind: CaseKind): boolean {
  return grantedScopes.includes(ACTION_SCOPES[kind]) || grantedScopes.includes("moderation-admin");
}

export function requiredScope(kind: CaseKind): string {
  return ACTION_SCOPES[kind];
}

// Discord caps timeouts at 28 days.
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export function validateTimeout(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs > 0 && durationMs <= MAX_TIMEOUT_MS;
}

// Purge planner: Discord bulk-delete handles 2–100 messages younger than 14 days.
export interface PurgePlan {
  mode: "bulk" | "manual" | "rejected";
  reason: string;
}

export function planPurge(count: number, oldestAgeMs: number): PurgePlan {
  if (!Number.isInteger(count) || count < 1) return { mode: "rejected", reason: "count must be ≥ 1" };
  if (count > 100) return { mode: "rejected", reason: "count must be ≤ 100 per run — split into batches" };
  if (oldestAgeMs >= 14 * 24 * 60 * 60 * 1000) {
    return { mode: "manual", reason: "messages ≥ 14 days old need single deletes" };
  }
  return { mode: "bulk", reason: "bulk delete within limits" };
}

export const CREATE_CASE_SQL = `
  INSERT INTO moderation.cases (guild_id, user_id, kind, reason, expires_at, moderator_id, idempotency_key)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING case_id`;

export const LIST_CASES_SQL = `
  SELECT case_id, kind, reason, expires_at, moderator_id, created_at
  FROM moderation.cases
  WHERE guild_id = $1 AND user_id = $2
  ORDER BY created_at DESC LIMIT $3`;

export const DUE_EXPIRY_SQL = `
  SELECT case_id, guild_id, user_id, kind FROM moderation.cases
  WHERE expires_at IS NOT NULL AND expires_at <= now()
  ORDER BY expires_at LIMIT $1`;
