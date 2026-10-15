// Moderation module: cases, sanctions, expiry, purge planning, permission checks
// (§2 moderation bot, §4 moderation.*). Pure logic + SQL; no discord.js here.

export type CaseKind = "warn" | "warn_remove" | "kick" | "ban" | "unban" | "timeout" | "timeout_remove" | "temp_role" | "temp_restriction" | "purge" | "note";

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
  warn_remove: "moderation-warn",
  kick: "moderation-kick",
  ban: "moderation-ban",
  unban: "moderation-ban",
  timeout: "moderation-timeout",
  timeout_remove: "moderation-timeout",
  temp_role: "moderation-role",
  temp_restriction: "moderation-restriction",
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
  SELECT case_id, kind, execution_status, reason, expires_at, moderator_id, created_at
  FROM moderation.cases
  WHERE guild_id = $1 AND user_id = $2
  ORDER BY created_at DESC LIMIT $3`;

export const DUE_EXPIRY_SQL = `
  SELECT case_id, guild_id, user_id, kind, metadata, attempt_count FROM moderation.cases
  WHERE execution_status = 'applied' AND expires_at IS NOT NULL AND expires_at <= now()
    AND kind IN ('ban', 'timeout', 'temp_role', 'temp_restriction')
    AND superseded_by IS NULL
    AND next_attempt_at <= now()
    AND (lease_until IS NULL OR lease_until < now())
  ORDER BY next_attempt_at, expires_at LIMIT $1`;

/** Claim due expiry work with a bounded lease and fairness window (A07). */
export const CLAIM_DUE_EXPIRY_SQL = `
  WITH due AS (
    SELECT case_id FROM moderation.cases
    WHERE execution_status = 'applied' AND expires_at IS NOT NULL AND expires_at <= now()
      AND kind IN ('ban', 'timeout', 'temp_role', 'temp_restriction')
      AND superseded_by IS NULL
      AND next_attempt_at <= now()
      AND (lease_until IS NULL OR lease_until < now())
    ORDER BY next_attempt_at, expires_at LIMIT $1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE moderation.cases c SET lease_owner = $2, lease_until = now() + interval '45 seconds'
  FROM due WHERE c.case_id = due.case_id
  RETURNING c.case_id, c.guild_id, c.user_id, c.kind, c.metadata, c.attempt_count`;

/** Bounded exponential backoff, seconds: 5, 10, 20, ... capped at 300. */
export function expiryBackoffSeconds(attemptCount: number): number {
  const bounded = Math.min(Math.max(0, Math.trunc(attemptCount)), 10);
  return Math.min(300, 5 * 2 ** bounded);
}

/** A failed cleanup retries later with bounded backoff; the attempt is charged. */
export const RETRY_EXPIRY_SQL = `
  UPDATE moderation.cases
  SET attempt_count = attempt_count + 1,
      next_attempt_at = now() + make_interval(secs => $2),
      lease_owner = NULL, lease_until = NULL,
      last_error_code = $3
  WHERE case_id = $1 AND lease_owner = $4`;

/** The owning case releases its lease on success, conflict or supersession. */
export const CLEAR_EXPIRY_SQL = `
  UPDATE moderation.cases
  SET execution_status = $2, expires_at = NULL, lease_owner = NULL, lease_until = NULL
  WHERE case_id = $1 AND execution_status = 'applied'`;

/** New equal-kind sanctions supersede older applied cases (A06): expiry must not undo a newer action.
 *  For temp_role/temp_restriction the metadata target ($5/$6) scopes the comparison to the same role/channel. */
export const SUPERSEDE_OLDER_SQL = `
  UPDATE moderation.cases SET superseded_by = $4, lease_owner = NULL, lease_until = NULL
  WHERE guild_id = $1 AND user_id = $2 AND kind = $3 AND case_id <> $4
    AND execution_status = 'applied' AND superseded_by IS NULL
    AND ($5::text IS NULL OR metadata->>$5 IS NOT DISTINCT FROM $6)`;

/** Release a lease without changing durability (used when work is no longer owned). */
export const RELEASE_EXPIRY_SQL = `
  UPDATE moderation.cases SET lease_owner = NULL, lease_until = NULL
  WHERE case_id = $1`;

export type TemporaryExpiryOutcome = "restored" | "conflict";

/** Run one temporary Discord cleanup and durably acknowledge its outcome. */
export async function reconcileTemporaryEffect(
  kind: string,
  effect: () => Promise<TemporaryExpiryOutcome>,
  finish: (outcome: TemporaryExpiryOutcome) => Promise<void>,
): Promise<boolean> {
  if (kind !== "temp_role" && kind !== "temp_restriction") return false;
  let outcome: TemporaryExpiryOutcome;
  try { outcome = await effect(); }
  catch { return false; }
  await finish(outcome);
  return true;
}

/** An unconfirmed Discord failure must not consume the expiry retry. Discord 10026 means already unbanned. */
export async function reconcileExpiry(
  kind: string, unban: () => Promise<void>, clear: () => Promise<void>,
): Promise<boolean> {
  if (kind !== "ban" && kind !== "timeout") return false;
  if (kind === "ban") {
    try { await unban(); }
    catch (error) { if ((error as { code?: number })?.code !== 10026) return false; }
  }
  await clear();
  return true;
}
