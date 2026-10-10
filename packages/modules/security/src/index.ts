// Security module: antinuke, raid detection, trust scoring, whitelist, lockdown,
// incidents, snapshots + restore plans (§2 security bot, §4 security.*).
// Pure logic + SQL. Takes a minimal db handle so tests inject a fake; no discord.js here.

import { createHash } from "node:crypto";

// --- Raid detection: N joins inside windowMs => raid. ---
export function detectRaid(joinAtMs: number[], threshold = 8, windowMs = 60_000): boolean {
  if (joinAtMs.length < threshold) return false;
  const sorted = [...joinAtMs].sort((a, b) => a - b);
  for (let i = 0; i + threshold - 1 < sorted.length; i++) {
    if (sorted[i + threshold - 1]! - sorted[i]! <= windowMs) return true;
  }
  return false;
}

// --- Trust scoring: 0–100. Violations decay by age; whitelisted users pin to 100. ---
export interface Violation {
  weight: number; // 1 minor … 10 severe
  atMs: number;
}

export function trustScore(violations: Violation[], nowMs = Date.now(), whitelisted = false): number {
  if (whitelisted) return 100;
  const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
  let penalty = 0;
  for (const v of violations) {
    const age = Math.max(0, nowMs - v.atMs);
    penalty += v.weight * 10 * Math.pow(0.5, age / HALF_LIFE_MS);
  }
  return Math.max(0, Math.round(100 - penalty));
}

export type TrustBand = "trusted" | "watch" | "restrict" | "quarantine";

export function trustBand(score: number): TrustBand {
  if (score >= 80) return "trusted";
  if (score >= 50) return "watch";
  if (score >= 20) return "restrict";
  return "quarantine";
}

// --- Antinuke: per-actor action counting inside a window. ---
export type GuardedAction = "ban" | "kick" | "channel_delete" | "role_delete" | "webhook_create";

const ACTION_LIMITS: Record<GuardedAction, number> = {
  ban: 3,
  kick: 5,
  channel_delete: 3,
  role_delete: 2,
  webhook_create: 3,
};

export type AntinukeVerdict = "allow" | "flag" | "quarantine";

export function evaluateAction(action: GuardedAction, recentCount: number, whitelisted = false): AntinukeVerdict {
  if (whitelisted) return "allow";
  const limit = ACTION_LIMITS[action];
  if (recentCount >= limit * 2) return "quarantine";
  if (recentCount >= limit) return "flag";
  return "allow";
}

// --- Lockdown state machine: off -> on -> off. Writes go through SQL below. ---
export type LockdownState = { active: boolean; reason: string | null };

// --- Snapshots: checksum-guarded guild state for restore drills (§9, §11). ---
export function snapshotChecksum(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function verifySnapshot(payload: unknown, checksum: string): boolean {
  const actual = Buffer.from(snapshotChecksum(payload), "hex");
  const expected = Buffer.from(checksum, "hex");
  return actual.length === expected.length && actual.equals(expected);
}

export interface RestoreStep {
  kind: "channel" | "role" | "permission" | "setting";
  targetId: string;
  action: "recreate" | "reapply" | "remove";
  detail: string;
}

// Pure diff: desired (snapshot) vs current guild state -> ordered restore plan.
export function planRestore(
  snapshot: Record<string, { name: string; kind: RestoreStep["kind"] }>,
  currentIds: Set<string>,
): RestoreStep[] {
  const steps: RestoreStep[] = [];
  for (const [id, item] of Object.entries(snapshot)) {
    if (!currentIds.has(id)) {
      steps.push({
        kind: item.kind,
        targetId: id,
        action: "recreate",
        detail: `${item.kind} ${item.name} missing — recreate from snapshot`,
      });
    }
  }
  return steps;
}

// --- SQL (tables in infra/postgres/migrations/002_domain.sql). ---
export const RECORD_INCIDENT_SQL = `
  INSERT INTO security.incidents (guild_id, kind, actor_id, severity, detail, idempotency_key)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (idempotency_key) DO NOTHING`;

export const UPSERT_TRUST_SQL = `
  INSERT INTO security.trust_state (guild_id, user_id, score, updated_at)
  VALUES ($1, $2, $3, now())
  ON CONFLICT (guild_id, user_id) DO UPDATE SET score = EXCLUDED.score, updated_at = now()`;

export const WHITELIST_ADD_SQL = `
  INSERT INTO security.whitelist (guild_id, user_id, reason, added_by)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (guild_id, user_id) DO NOTHING`;

export const WHITELIST_CHECK_SQL = `
  SELECT 1 FROM security.whitelist WHERE guild_id = $1 AND user_id = $2`;

export const SET_LOCKDOWN_SQL = `
  INSERT INTO security.lockdown_state (guild_id, active, reason, updated_by, updated_at)
  VALUES ($1, TRUE, $2, $3, now())
  ON CONFLICT (guild_id) DO UPDATE SET active = TRUE, reason = EXCLUDED.reason,
    updated_by = EXCLUDED.updated_by, updated_at = now()`;

export const CLEAR_LOCKDOWN_SQL = `
  UPDATE security.lockdown_state SET active = FALSE, updated_at = now() WHERE guild_id = $1`;

export const SAVE_SNAPSHOT_SQL = `
  INSERT INTO security.snapshots (guild_id, payload, checksum, created_by)
  VALUES ($1, $2, $3, $4)`;
