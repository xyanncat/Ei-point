export type JobQuery = (sql: string, params?: unknown[]) => Promise<Record<string, any>[]>;
export const SUPPORTED_LEASE_SQL = `
  UPDATE ops.jobs SET status='leased',lease_owner=$1,
    lease_expires_at=now()+($2 || ' seconds')::interval,attempts=attempts+1,updated_at=now()
  WHERE job_id IN (
    SELECT job_id FROM ops.jobs WHERE kind = 'commerce.expire'
    AND status IN ('pending','leased','failed') AND attempts < max_attempts
    AND next_run_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<now())
    ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT $3
  ) RETURNING job_id,kind,attempts,max_attempts`;
export async function scheduleCommerceExpiry(query: JobQuery): Promise<void> {
  await query(`INSERT INTO ops.jobs(kind,payload,idempotency_key)
    VALUES('commerce.expire','{}'::jsonb,'commerce.expire:' || to_char(date_trunc('minute', now()) AT TIME ZONE 'UTC','YYYY-MM-DDTHH24:MI'))
    ON CONFLICT (idempotency_key) DO NOTHING`);
}
/** The query must use one dedicated connection. The lease row lock fences stale workers; mutation and completion commit together. All effects are idempotent SQL. */
export async function runCommerceExpiry(query: JobQuery, jobId: string, owner: string): Promise<boolean> {
  await query("BEGIN");
  try {
    const leased = await query(`SELECT job_id FROM ops.jobs WHERE job_id=$1 AND kind='commerce.expire'
      AND status='leased' AND lease_owner=$2 AND lease_expires_at>now() FOR UPDATE`,[jobId,owner]);
    if (!leased.length) { await query("ROLLBACK"); return false; }
    await query("UPDATE commerce.orders SET status='expired' WHERE status='pending' AND expires_at<now()");
    await query("UPDATE commerce.rewards SET status='expired' WHERE status='reserved' AND cycle<to_char(now() AT TIME ZONE 'UTC','YYYY-MM')");
    await query("DELETE FROM commerce.checkout_rate_limits WHERE window_started_at<now()-interval '1 day'");
    await query("UPDATE ops.jobs SET status='done',lease_owner=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=now() WHERE job_id=$1 AND lease_owner=$2",[jobId,owner]);
    await query("COMMIT");
    return true;
  } catch (error) {
    await query("ROLLBACK").catch(() => {});
    throw error;
  }
}
export async function recoverExhaustedJobs(query: JobQuery): Promise<void> {
  await query(`UPDATE ops.jobs SET status='dead',lease_owner=NULL,lease_expires_at=NULL,
    last_error='retry-budget-exhausted',updated_at=now() WHERE kind='commerce.expire'
    AND status IN ('pending','leased','failed') AND attempts>=max_attempts
    AND (lease_expires_at IS NULL OR lease_expires_at<now())`);
}
export async function publishWorkerHeartbeat(query: JobQuery): Promise<void> {
  await query(`INSERT INTO ops.service_status(service,liveness,gateway,db_ready,latency_ms)
    VALUES('workers','ok','not-needed',true,NULL) ON CONFLICT(service) DO UPDATE
    SET liveness='ok',gateway='not-needed',db_ready=true,updated_at=now()`);
}
