// Per-provider cost units admitted through PostgreSQL (redesign infra §6).
// Same discipline as the chat token budget in commands.ts: reserve atomically
// under an advisory lock before spending, settle actual usage or release the
// reservation afterward. Units are characters for speech; per-guild+user and
// global daily caps are enforced provider-independently so an in-process queue
// is not the only limit when several entry points call.
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  PENDING_UNITS_SQL,
  RECORD_UNITS_USAGE_SQL,
  USAGE_UNITS_TODAY_GLOBAL_SQL,
  USAGE_UNITS_TODAY_SQL,
  unitBudgetExceeded,
} from "@ei-point/module-ai";

/** Generous defaults catch abuse without touching ordinary customers. */
export function resolveUnitBudget(raw: string | undefined, variable: string, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${variable} must be a positive finite number.`);
  }
  return Math.round(value);
}

export const TTS_UNITS_PER_USER = resolveUnitBudget(process.env.TTS_DAILY_BUDGET_CHARS, "TTS_DAILY_BUDGET_CHARS", 30_000);
export const TTS_UNITS_GLOBAL = resolveUnitBudget(process.env.TTS_DAILY_BUDGET_CHARS_GLOBAL, "TTS_DAILY_BUDGET_CHARS_GLOBAL", 300_000);

export type BudgetKind = "tts";

export interface UnitAdmissionOptions {
  guildId: string;
  userId: string;
  kind: BudgetKind;
  /** Characters to reserve, already validated before admitting. */
  units: number;
  /** Capability prefix match, e.g. `tts:%`. */
  providerPattern: string;
}

export type UnitAdmission = { ok: true; reservation: string } | { ok: false; message: string };

const BUDGET_EXCEEDED_MESSAGE = "Your remaining daily AI budget is too small for this request.";

export async function reserveUnitBudget(pool: Pool, opts: UnitAdmissionOptions): Promise<UnitAdmission> {
  if (!Number.isInteger(opts.units) || opts.units < 0) return { ok: false, message: BUDGET_EXCEEDED_MESSAGE };
  const reservation = randomUUID();
  const caps = [TTS_UNITS_PER_USER, TTS_UNITS_GLOBAL];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The same lock key chat uses: one admission decision at a time per
    // guild+user, no double-count race between concurrent capabilities.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`ai-budget:${opts.guildId}:${opts.userId}`]);
    const used = await client.query<{ used: string }>(USAGE_UNITS_TODAY_SQL, [opts.guildId, opts.userId, opts.providerPattern]);
    const pending = await client.query<{ reserved: string }>(PENDING_UNITS_SQL, [opts.kind, opts.guildId, opts.userId]);
    const globalUsed = await client.query<{ used: string }>(USAGE_UNITS_TODAY_GLOBAL_SQL, [opts.providerPattern]);
    const ok = !unitBudgetExceeded(
      Number(used.rows[0]?.used ?? 0),
      Number(pending.rows[0]?.reserved ?? 0),
      Number(globalUsed.rows[0]?.used ?? 0),
      opts.units,
      caps[0]!,
      caps[1]!,
    );
    if (!ok) {
      await client.query("ROLLBACK");
      return { ok: false, message: BUDGET_EXCEEDED_MESSAGE };
    }
    await client.query(
      "INSERT INTO ai.budget_reservations (reservation_id,guild_id,user_id,tokens,expires_at,kind) VALUES($1,$2,$3,$4,date_trunc('day',now())+interval '1 day',$5)",
      [reservation, opts.guildId, opts.userId, opts.units, opts.kind],
    );
    await client.query("COMMIT");
    return { ok: true, reservation };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Record what a provider actually charged for, then drop the reservation. */
export async function settleUnitUsage(
  pool: Pool,
  opts: { reservation: string; guildId: string; userId: string; provider: string; units: number },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(RECORD_UNITS_USAGE_SQL, [opts.guildId, opts.userId, opts.provider, Math.max(0, opts.units)]);
    await client.query("DELETE FROM ai.budget_reservations WHERE reservation_id=$1", [opts.reservation]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // Never strand the reservation: an unreleased one eats the caller's
    // budget until end of day. Accounting loss is preferable to phantom debt.
    await pool.query("DELETE FROM ai.budget_reservations WHERE reservation_id=$1", [opts.reservation]).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Nothing was spent (or the session died mid-message): release the hold. */
export async function releaseUnitReservation(pool: Pool, reservation: string): Promise<void> {
  try {
    await pool.query("DELETE FROM ai.budget_reservations WHERE reservation_id=$1", [reservation]);
  } catch {
    // The reservation expires at end of day; a release failure is not fatal.
  }
}
