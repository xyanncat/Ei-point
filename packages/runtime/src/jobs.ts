import { randomUUID } from "node:crypto";
import type { FailureCategory } from "./index.js";

export function newCorrelationId(): string {
  return randomUUID();
}

// Bounded retries with exponential backoff + jitter (§5).
export function nextBackoffMs(attempt: number, baseMs = 1000, maxMs = 60000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

export interface JobRow {
  job_id: string;
  kind: string;
  payload: unknown;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
}

export const LEASE_SQL = `
  UPDATE ops.jobs
  SET status = 'leased', lease_owner = $1, lease_expires_at = now() + ($2 || ' seconds')::interval,
      attempts = attempts + 1, updated_at = now()
  WHERE job_id IN (
    SELECT job_id FROM ops.jobs
    WHERE status IN ('pending', 'leased')
      AND next_run_at <= now()
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
    ORDER BY next_run_at
    FOR UPDATE SKIP LOCKED
    LIMIT $3
  )
  RETURNING job_id, kind, payload, idempotency_key, attempts, max_attempts`;

export const COMPLETE_SQL = `UPDATE ops.jobs SET status = 'done', updated_at = now() WHERE job_id = $1`;
export const FAIL_SQL = `
  UPDATE ops.jobs
  SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'failed' END,
      next_run_at = now() + ($2 || ' seconds')::interval,
      last_error = $3, updated_at = now()
  WHERE job_id = $1`;

export function failureOf(err: unknown): FailureCategory {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|deadline/i.test(msg)) return "timeout";
  if (/rate.?limit|429/i.test(msg)) return "rate-limit";
  if (/postgres|database|connect/i.test(msg)) return "db-unavailable";
  if (/queue.?full/i.test(msg)) return "queue-full";
  return "unknown";
}
