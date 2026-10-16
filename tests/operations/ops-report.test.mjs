import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import EmbeddedPostgres from "../helpers/embedded-postgres.mjs";
import { runMigrations } from "../../infra/postgres/run-migrations.mjs";
import { runReport, queueLagSection, deliveryFailuresSection, heartbeatSection, backupFreshnessSection, restoreAgeSection } from "../../scripts/ops-report.mjs";

const execute = promisify(execFile);
const repo = fileURLToPath(new URL("../../", import.meta.url));
let server;
let url;
let pool;

/** Create a verified backup snapshot directory (real bundle manifest + artifacts + restore record). */
async function snapshot(root, name = "20260101T000000Z") {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  for (const artifact of ["postgres.dump", "roles.sql", "artwork.tar.gz"]) await writeFile(join(directory, artifact), `fixture ${artifact}`);
  await execute(process.execPath, [join(repo, "infra/backup/bundle.mjs"), "create", directory, "ei_point"]);
  // §9C: a completed logical restore drill persists this record beside its snapshot.
  await writeFile(join(directory, "restore-verified.json"), JSON.stringify({ version: 1, verifiedAt: new Date().toISOString(), database: "ei_point", elapsedSeconds: 42, snapshot: name }) + "\n");
  return directory;
}

before(async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  server = new EmbeddedPostgres({
    databaseDir: await mkdtemp(join(tmpdir(), "ei-ops-report-")),
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
  const base = `postgresql://postgres:isolated-test-only@127.0.0.1:${port}`;
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query("CREATE DATABASE ei_point");
  await admin.end();
  url = `${base}/ei_point`;
  await runMigrations(url);
  pool = new pg.Pool({ connectionString: url });
});

after(async () => {
  await pool?.end();
  await server?.stop();
});

test("a fresh deployment reports every operator surface clear", async () => {
  const root = await mkdtemp(join(tmpdir(), "ei-ops-backup-"));
  await snapshot(root);
  // A live deployment has reported heartbeats; zero rows is a breach, not "fresh".
  await pool.query("INSERT INTO ops.service_status (service,liveness,gateway,db_ready) VALUES ('bot-music','ok','ok',true),('workers','ok','ok',true)");
  const query = async (sql) => (await pool.query(sql)).rows;
  const report = await runReport(query, { backupRoot: root });
  assert.deepEqual(report.sections.map((entry) => [entry.id, entry.status]), [
    ["queue-lag", "ok"],
    ["delivery-failures", "ok"],
    ["service-heartbeats", "ok"],
    ["backup-freshness", "ok"],
    ["restore-age", "ok"],
  ]);
  assert.equal(report.exitCode, 0);
  await pool.query("DELETE FROM ops.service_status");
});

test("an aged durable queue and dead jobs breach queue lag", async () => {
  await pool.query("INSERT INTO ops.jobs (kind,payload,idempotency_key,status,created_at) VALUES ('probe','{}'::jsonb,'aged-1','pending',now()-interval '2 hours')");
  const query = async (sql) => (await pool.query(sql)).rows;
  const aged = await queueLagSection(query);
  assert.equal(aged.status, "breach");
  assert.match(aged.detail, /oldest 7[12]\d+s/);
  await pool.query("UPDATE ops.jobs SET status='dead' WHERE idempotency_key='aged-1'");
  const dead = await queueLagSection(query);
  assert.equal(dead.status, "breach");
  assert.match(dead.detail, /1 dead/);
  await pool.query("DELETE FROM ops.jobs");
});

test("unpublished outbox events breach only when delivery is actually late", async () => {
  const query = async (sql) => (await pool.query(sql)).rows;
  assert.equal((await deliveryFailuresSection(query)).status, "ok");
  await pool.query("INSERT INTO ops.outbox (aggregate,aggregate_id,type,payload,correlation_id,created_at) VALUES ('probe','1','tested','{}'::jsonb,'c-1',now()-interval '20 minutes')");
  const breach = await deliveryFailuresSection(query);
  assert.equal(breach.status, "breach");
  assert.match(breach.detail, /oldest 12\d\d?s/);
  await pool.query("UPDATE ops.outbox SET published=TRUE");
  assert.equal((await deliveryFailuresSection(query)).status, "ok");
  await pool.query("DELETE FROM ops.outbox");
});

test("stale or degraded heartbeats are surfaced per service", async () => {
  const query = async (sql) => (await pool.query(sql)).rows;
  const empty = await heartbeatSection(query);
  assert.equal(empty.status, "breach", "zero heartbeat rows must read as no-data, not healthy");
  assert.match(empty.detail, /no service heartbeats recorded/);
  await pool.query("INSERT INTO ops.service_status (service,liveness,gateway,db_ready) VALUES ('bot-music','ok','ok',true),('bot-ai','ok','ok',true)");
  const fresh = await heartbeatSection(query);
  assert.equal(fresh.status, "ok");
  await pool.query("UPDATE ops.service_status SET liveness='down', updated_at=now()-interval '10 minutes' WHERE service='bot-ai'");
  const degraded = await heartbeatSection(query);
  assert.equal(degraded.status, "breach");
  assert.match(degraded.detail, /bot-ai/);
  await pool.query("DELETE FROM ops.service_status");
});

test("backup freshness surfaces age, corruption and missing roots as breaches", async () => {
  const root = await mkdtemp(join(tmpdir(), "ei-ops-fresh-"));
  const directory = await snapshot(root);
  assert.equal((await backupFreshnessSection(root, 24)).status, "ok");
  // Age it past the maximum.
  const manifestPath = join(directory, "backup.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.createdAt = new Date(Date.now() - 48 * 3_600_000).toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const aged = await backupFreshnessSection(root, 24);
  assert.equal(aged.status, "breach");
  assert.match(aged.detail, /older than maximum|age/i);
  // Restore a current timestamp, then corrupt an artifact so the integrity check runs.
  manifest.createdAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(join(directory, "postgres.dump"), "tampered");
  const corrupt = await backupFreshnessSection(root, 24);
  assert.equal(corrupt.status, "breach");
  assert.match(corrupt.detail, /integrity/i);
  // Missing root.
  const missing = await backupFreshnessSection(join(root, "not-there"), 24);
  assert.equal(missing.status, "breach");
  assert.match(missing.detail, /missing|no completed snapshot/);
});

test("restore age surfaces the verified drill record and breaches on missing or stale proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "ei-ops-restore-"));
  const directory = await snapshot(root);
  await rm(join(directory, "restore-verified.json"));
  const missing = await restoreAgeSection(root);
  assert.equal(missing.status, "breach");
  assert.match(missing.detail, /no verified restore drill on record/);
  await writeFile(join(directory, "restore-verified.json"), JSON.stringify({ version: 1, verifiedAt: new Date().toISOString(), database: "ei_point", elapsedSeconds: 42, snapshot: "20260101T000000Z" }) + "\n");
  const fresh = await restoreAgeSection(root);
  assert.equal(fresh.status, "ok");
  assert.match(fresh.detail, /latest verified restore of 20260101T000000Z/);
  const record = JSON.parse(await readFile(join(directory, "restore-verified.json"), "utf8"));
  record.verifiedAt = new Date(Date.now() - 45 * 86_400_000).toISOString();
  await writeFile(join(directory, "restore-verified.json"), JSON.stringify(record) + "\n");
  const stale = await restoreAgeSection(root, 30);
  assert.equal(stale.status, "breach");
  assert.match(stale.detail, /old \(max 30d\)/);
});

test("the CLI reports breaches and exits non-zero for the operator", async () => {  const root = await mkdtemp(join(tmpdir(), "ei-ops-cli-"));
  await snapshot(root);
  await pool.query("INSERT INTO ops.jobs (kind,payload,idempotency_key,status,created_at) VALUES ('probe','{}'::jsonb,'cli-1','pending',now()-interval '3 hours')");
  const run = await execute(process.execPath, [join(repo, "scripts/ops-report.mjs"), "--backup-root", root, "--json"], {
    env: { ...process.env, DATABASE_URL: url },
  }).then(
    (result) => ({ code: 0, stdout: result.stdout }),
    (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
  );
  assert.equal(run.code, 1, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.exitCode, 1);
  assert.ok(report.sections.some((entry) => entry.id === "queue-lag" && entry.status === "breach"), run.stdout);
  assert.ok(report.sections.some((entry) => entry.id === "backup-freshness" && entry.status === "ok"), run.stdout);
  await pool.query("DELETE FROM ops.jobs");
});

test("a database connection failure exits 2 as misconfiguration, not a breach", async () => {
  const run = await execute(process.execPath, [join(repo, "scripts/ops-report.mjs"), "--json"], {
    env: { ...process.env, DATABASE_URL: "postgresql://postgres:isolated-test-only@127.0.0.1:1/ei_point" },
  }).then(
    (result) => ({ code: 0, stdout: result.stdout }),
    (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
  );
  assert.equal(run.code, 2, run.stderr ?? run.stdout);
  assert.match(run.stderr ?? "", /connection failed/i);
});
