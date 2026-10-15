import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import EmbeddedPostgres from "../helpers/embedded-postgres.mjs";
import { scheduleCommerceExpiry, SUPPORTED_LEASE_SQL, runCommerceExpiry, recoverExhaustedJobs, publishWorkerHeartbeat } from "../../apps/workers/dist/jobs.js";
let server, pool;
before(
  async () => {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    server = new EmbeddedPostgres({
      databaseDir: await mkdtemp(join(tmpdir(), "ei-workers-")),
      port,
      user: "postgres",
      password: "isolated-test-only",
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    pool = new pg.Pool({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password: "isolated-test-only",
      database: "postgres",
      max: 5,
    });
    const dir = new URL("../../infra/postgres/migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(await readFile(new URL(name, dir), "utf8"));
  },
  { timeout: 120000 },
);
after(async () => {
  await pool?.end();
  await server?.stop();
});

beforeEach(async () => {
  await pool.query("TRUNCATE ops.jobs,ops.service_status,commerce.orders,commerce.rewards,commerce.checkout_rate_limits CASCADE");
  await pool.query("INSERT INTO commerce.catalog(sku,name,price_minor) VALUES('worker-fixture','Fixture',100) ON CONFLICT DO NOTHING");
});
const query = async (sql,args) => (await pool.query(sql,args)).rows;
async function fixtureOrder(status,age,key) {
  return (await pool.query(`INSERT INTO commerce.orders(guild_id,buyer_id,sku,amount_minor,status,order_token_hash,idempotency_key,expires_at)
    VALUES('guild','buyer','worker-fixture',100,$1,$2,$2,now()+$3*interval '1 day') RETURNING order_id`,[status,key,age])).rows[0].order_id;
}
async function lease() { await scheduleCommerceExpiry(query); return (await pool.query(SUPPORTED_LEASE_SQL,['worker-a',120,10])).rows; }
async function run(job,owner='worker-a',inject=false) {
  const db=await pool.connect();
  try { return await runCommerceExpiry(async(sql,args)=>{ if(inject && sql.includes('UPDATE commerce.rewards')) throw new Error('injected rollback'); return (await db.query(sql,args)).rows; },job.job_id,owner); }
  finally { db.release(); }
}
test('only supported jobs lease; commerce cleanup and completion are durable and idempotent',async()=>{
  const expired=await fixtureOrder('pending',-1,'old'); await fixtureOrder('pending',1,'fresh'); await fixtureOrder('claimed',-1,'claimed');
  await pool.query(`INSERT INTO commerce.rewards(guild_id,user_id,cycle,amount_minor,status,idempotency_key)
    VALUES('guild','u','2000-01',10,'reserved','old-reward'),('guild','u','2000-01',10,'paid','paid-reward')`);
  await pool.query("INSERT INTO commerce.checkout_rate_limits(bucket,window_started_at) VALUES('old',now()-interval '2 days'),('fresh',now())");
  await pool.query(`INSERT INTO ops.jobs(kind,payload,idempotency_key) VALUES('unknown','{}','unknown'),('dashboard.embed','{}','embed'),('moderation.intent','{}','intent')`);
  await scheduleCommerceExpiry(query); await scheduleCommerceExpiry(query);
  assert.equal((await pool.query("SELECT count(*)::int n FROM ops.jobs WHERE kind='commerce.expire'")).rows[0].n,1);
  const jobs=await lease(); assert.equal(jobs.length,1); assert.equal(jobs[0].kind,'commerce.expire');
  assert.equal(await run(jobs[0]),true); assert.equal(await run(jobs[0]),false);
  const orders=(await pool.query("SELECT idempotency_key,status FROM commerce.orders ORDER BY idempotency_key")).rows;
  assert.deepEqual(orders,[{idempotency_key:'claimed',status:'claimed'},{idempotency_key:'fresh',status:'pending'},{idempotency_key:'old',status:'expired'}]);
  assert.equal((await pool.query("SELECT status FROM commerce.rewards WHERE idempotency_key='old-reward'")).rows[0].status,'expired');
  assert.equal((await pool.query("SELECT status FROM commerce.rewards WHERE idempotency_key='paid-reward'")).rows[0].status,'paid');
  assert.deepEqual((await pool.query('SELECT bucket FROM commerce.checkout_rate_limits')).rows,[{bucket:'fresh'}]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM ops.jobs WHERE kind<>'commerce.expire' AND status='pending' AND attempts=0")).rows[0].n,3);
  assert.equal((await pool.query("SELECT status FROM ops.jobs WHERE job_id=$1",[jobs[0].job_id])).rows[0].status,'done');
});
test('handler failure rolls back commerce changes and stale lease owner cannot execute',async()=>{
  const id=await fixtureOrder('pending',-1,'rollback'); const [job]=await lease();
  await assert.rejects(run(job,'worker-a',true),/injected rollback/);
  assert.equal((await pool.query('SELECT status FROM commerce.orders WHERE order_id=$1',[id])).rows[0].status,'pending');
  assert.equal((await pool.query('SELECT status FROM ops.jobs WHERE job_id=$1',[job.job_id])).rows[0].status,'leased');
  assert.equal(await run(job,'stale-worker'),false);
  assert.equal(await run(job),true);
});
test('expired exhausted supported leases are dead-lettered while unknown jobs remain untouched; heartbeat is fresh',async()=>{
  await pool.query(`INSERT INTO ops.jobs(kind,payload,idempotency_key,status,attempts,max_attempts,lease_expires_at)
    VALUES('commerce.expire','{}','supported','leased',5,5,now()-interval '1 second'),('unknown','{}','unknown','leased',5,5,now()-interval '1 second')`);
  await recoverExhaustedJobs(query);
  assert.deepEqual((await pool.query('SELECT kind,status FROM ops.jobs ORDER BY kind')).rows,[{kind:'commerce.expire',status:'dead'},{kind:'unknown',status:'leased'}]);
  await publishWorkerHeartbeat(query);
  const heartbeat=(await pool.query("SELECT service,liveness,gateway,db_ready,updated_at>now()-interval '5 seconds' fresh FROM ops.service_status")).rows[0];
  assert.deepEqual(heartbeat,{service:'workers',liveness:'ok',gateway:'not-needed',db_ready:true,fresh:true});
});
