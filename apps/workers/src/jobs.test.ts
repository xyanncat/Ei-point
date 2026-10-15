import { it } from "node:test";
import assert from "node:assert/strict";
import { runCommerceExpiry, scheduleCommerceExpiry, SUPPORTED_LEASE_SQL, type JobQuery } from "./jobs.js";
it("generic leases only commerce expiry, excluding every unknown and bot-owned kind", () => {
  assert.match(SUPPORTED_LEASE_SQL, /kind = 'commerce.expire'/);
  assert.match(SUPPORTED_LEASE_SQL, /FOR UPDATE SKIP LOCKED/);
  assert.match(SUPPORTED_LEASE_SQL, /attempts < max_attempts/);
});
it("minute scheduling is database-clock based and idempotent", async () => {
  let sql = "";
  await scheduleCommerceExpiry(async text => { sql = text; return []; });
  assert.match(sql, /date_trunc\('minute', now\(\)\)/); assert.match(sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
});
it("commerce effects and completion share a transaction and stale lease cannot execute", async () => {
  const trace: string[] = [];
  const query: JobQuery = async sql => { trace.push(sql); return sql.includes("SELECT job_id") ? [{ job_id: "job" }] : []; };
  await runCommerceExpiry(query,"job","worker");
  assert.equal(trace[0],"BEGIN"); assert.match(trace[1]!,/lease_owner=\$2/); assert.match(trace[2]!,/commerce.orders/);
  assert.match(trace[3]!,/commerce.rewards/); assert.match(trace[4]!,/checkout_rate_limits/); assert.match(trace[5]!,/status='done'/); assert.equal(trace[6],"COMMIT");
  const stale: string[] = [];
  assert.equal(await runCommerceExpiry(async sql => { stale.push(sql); return []; },"job","old-worker"),false);
  assert.deepEqual(stale.length,3); assert.equal(stale[2],"ROLLBACK");
});
it("failure rolls back all expiry effects without marking the job done", async () => {
  const trace: string[] = [];
  await assert.rejects(runCommerceExpiry(async sql => {
    trace.push(sql); if(sql.includes("commerce.rewards")) throw new Error("injected failure");
    return sql.includes("SELECT job_id") ? [{ job_id: "job" }] : [];
  },"job","worker"),/injected failure/);
  assert.equal(trace.at(-1),"ROLLBACK"); assert.equal(trace.some(sql => sql.includes("status='done'")),false);
});
