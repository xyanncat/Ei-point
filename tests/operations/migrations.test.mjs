import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import EmbeddedPostgres from "../helpers/embedded-postgres.mjs";

const execute = promisify(execFile);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const runnerUrl = new URL("../../infra/postgres/run-migrations.mjs", import.meta.url).href;
const migrationsDir = fileURLToPath(new URL("../../infra/postgres/migrations/", import.meta.url));

let server;
let base; // postgresql://postgres:...@127.0.0.1:PORT

async function createDatabase(name) {
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  return `${base}/${name}`;
}

/** Apply migrations through the real runner in a child process (forward-only contract). */
async function migrate(url, { dir, upTo, env = {} } = {}) {
  const script = `import {runMigrations} from ${JSON.stringify(runnerUrl)};
try { const r = await runMigrations(process.env.DB_URL, { dir: process.env.MIG_DIR || undefined, upTo: process.env.UP_TO || undefined, silent: false });
  console.log('RESULT ' + JSON.stringify(r)); }
catch (e) { console.error('MIGRATION_ERROR ' + e.message); process.exit(3); }`;
  try {
    const { stdout, stderr } = await execute(process.execPath, ["--input-type=module", "-e", script], {
      cwd: repo,
      timeout: 120_000,
      env: { ...process.env, DB_URL: url, MIG_DIR: dir ?? "", UP_TO: upTo ?? "", ...env },
    });
    const match = /RESULT (\{.*\})/.exec(stdout);
    return { code: 0, stdout, stderr, result: match ? JSON.parse(match[1]) : null };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: `${error.stderr ?? ""}${error.message ?? ""}` };
  }
}

async function count(url, sql) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

before(async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  server = new EmbeddedPostgres({
    databaseDir: await mkdtemp(join(tmpdir(), "ei-migrate-")),
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
  base = `postgresql://postgres:isolated-test-only@127.0.0.1:${port}`;
});

after(async () => {
  await server?.stop();
});

test("a fresh database applies every migration once and records the ledger", async () => {
  const url = await createDatabase("fresh");
  const first = await migrate(url);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /migrations ok/);
  assert.match(first.stdout, /apply 001_core\.sql/);
  const files = (await count(url, "SELECT name FROM ops.schema_migrations ORDER BY name")).map((row) => row.name);
  assert.ok(files.length >= 18, `expected the full set, got ${files.length}`);
  assert.ok(files.includes("019_reward_redemption.sql"));
  // Real objects exist: commerce is created by a later migration.
  assert.ok((await count(url, "SELECT to_regclass('commerce.orders') AS o"))[0].o);
});

test("re-running is idempotent: everything skips, nothing reapplies", async () => {
  const url = `${base}/fresh`;
  const again = await migrate(url);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(again.result.applied, [], "no migration should reapply");
  assert.ok(again.result.skipped.length >= 18);
});

test("an upgrade from a prior snapshot applies only the newer migrations", async () => {
  const url = await createDatabase("upgrade");
  const partial = await migrate(url, { upTo: "015_himiko_community_ownership.sql" });
  assert.equal(partial.code, 0, partial.stderr);
  assert.ok(partial.result.applied.some((name) => name === "015_himiko_community_ownership.sql"));
  assert.ok(!partial.result.applied.includes("019_reward_redemption.sql"));
  assert.equal(
    (await count(url, "SELECT 1 FROM information_schema.columns WHERE table_schema='commerce' AND table_name='orders' AND column_name='credit_applied_minor'")).length,
    0,
    "the credit column migration must not be applied yet",
  );

  const upgrade = await migrate(url);
  assert.equal(upgrade.code, 0, upgrade.stderr);
  assert.deepEqual(
    upgrade.result.applied,
    ["016_community_voice_xp_cooldown.sql", "017_sanction_ownership.sql", "018_razorpay.sql", "019_reward_redemption.sql"],
  );
  // The upgraded schema now carries the 019 column the app expects.
  assert.equal(
    (await count(url, "SELECT 1 FROM information_schema.columns WHERE table_schema='commerce' AND table_name='orders' AND column_name='credit_applied_minor'")).length,
    1,
  );
});

test("a failed migration is rolled back, not recorded, and retries cleanly", async () => {
  const url = await createDatabase("failure");
  const dir = await mkdtemp(join(tmpdir(), "ei-migrate-fixture-"));
  await writeFile(join(dir, "001_ok.sql"), "CREATE SCHEMA IF NOT EXISTS scratch; CREATE TABLE scratch.t(id int PRIMARY KEY);");
  await writeFile(join(dir, "002_bad.sql"), "CREATE TABLE scratch.broken (id int PRIMARY KEY OOPS;");
  const failed = await migrate(url, { dir });
  assert.notEqual(failed.code, 0, "an invalid migration must fail the run");
  assert.match(failed.stderr, /MIGRATION_ERROR/);
  const afterFailure = (await count(url, "SELECT name FROM ops.schema_migrations ORDER BY name")).map((row) => row.name);
  assert.deepEqual(afterFailure, ["001_ok.sql"], "the failed migration must not be recorded");
  assert.equal((await count(url, "SELECT to_regclass('scratch.broken') AS t"))[0].t, null, "the failed migration must roll back");

  // Forward-only recovery: fix the pending file and re-run; 001 is skipped.
  await writeFile(join(dir, "002_bad.sql"), "CREATE TABLE scratch.fixed (id int PRIMARY KEY);");
  const retry = await migrate(url, { dir });
  assert.equal(retry.code, 0, retry.stderr);
  assert.deepEqual(retry.result.applied, ["002_bad.sql"]);
  assert.deepEqual(retry.result.skipped, ["001_ok.sql"]);
});

test("concurrent runners serialize on the advisory lock without duplicate application", async () => {
  const url = await createDatabase("locked");
  const [a, b] = await Promise.all([migrate(url), migrate(url)]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const applied = [...(a.result?.applied ?? []), ...(b.result?.applied ?? [])];
  const unique = new Set(applied);
  assert.equal(applied.length, unique.size, "a migration must never be applied twice across runners");
  assert.ok(unique.size >= 18, "the lock holder applied the full set");
  assert.equal((await count(url, "SELECT count(*)::int AS n FROM ops.schema_migrations"))[0].n, unique.size);
});
