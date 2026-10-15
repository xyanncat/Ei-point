import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';
import EmbeddedPostgres from '../helpers/embedded-postgres.mjs';
import { CLAIM_DUE_EXPIRY_SQL, RETRY_EXPIRY_SQL, CLEAR_EXPIRY_SQL, SUPERSEDE_OLDER_SQL, expiryBackoffSeconds } from '../../packages/modules/moderation/dist/index.js';

let server, pool;
const guild = '300000000000000001', actor = '300000000000000002', subject = '300000000000000003';
const lease = 'test-worker';
const insertCase = (kind, expiresAt, idempotency) =>
  pool.query(
    `INSERT INTO moderation.cases(guild_id,user_id,kind,reason,expires_at,moderator_id,idempotency_key,execution_status,metadata)
     VALUES($1,$2,$3,'test', $4,$5,$6,'applied','{}') RETURNING case_id`,
    [guild, subject, kind, expiresAt, actor, idempotency],
  );
before(async () => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const databaseDir = await mkdtemp(join(tmpdir(), 'ei-moderation-'));
  server = new EmbeddedPostgres({ databaseDir, port, user: 'postgres', password: 'isolated-test-only', persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'isolated-test-only', database: 'postgres', max: 5 });
  const dir = new URL('../../infra/postgres/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(name, dir), 'utf8'));
}, { timeout: 120000 });
after(async () => { await pool?.end(); await server?.stop(); });
beforeEach(async () => {
  await pool.query('TRUNCATE moderation.cases');
});
test('ten persistent failures do not starve a healthy later case', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  for (let i = 0; i < 10; i++) await insertCase('ban', past, `fail-${i}`);
  const claimedFailures = await pool.query(CLAIM_DUE_EXPIRY_SQL, [10, lease]);
  assert.equal(claimedFailures.rowCount, 10);
  for (const row of claimedFailures.rows) {
    await pool.query(RETRY_EXPIRY_SQL, [row.case_id, expiryBackoffSeconds(10), 'discord-unconfirmed', lease]);
  }
  const healthy = await insertCase('ban', past, 'healthy');
  const claimed = await pool.query(CLAIM_DUE_EXPIRY_SQL, [10, lease]);
  assert.equal(claimed.rowCount, 1);
  assert.equal(String(claimed.rows[0].case_id), String(healthy.rows[0].case_id));
});
test('a leased case is not claimed again until the lease expires', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  await insertCase('temp_role', past, 'leased');
  const first = await pool.query(CLAIM_DUE_EXPIRY_SQL, [10, lease]);
  assert.equal(first.rowCount, 1);
  const second = await pool.query(CLAIM_DUE_EXPIRY_SQL, [10, 'other-worker']);
  assert.equal(second.rowCount, 0);
});
test('a newer ban supersedes the older temp ban so its expiry cannot remove the newer ban', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const older = await insertCase('ban', past, 'old-temp-ban');
  const newer = await insertCase('ban', null, 'new-permanent-ban');
  await pool.query(SUPERSEDE_OLDER_SQL, [guild, subject, 'ban', newer.rows[0].case_id, null, null]);
  const superseded = await pool.query('SELECT superseded_by FROM moderation.cases WHERE case_id=$1', [older.rows[0].case_id]);
  assert.equal(String(superseded.rows[0].superseded_by), String(newer.rows[0].case_id));
  const claimed = await pool.query(CLAIM_DUE_EXPIRY_SQL, [10, lease]);
  assert.equal(claimed.rowCount, 0);
});
test('temp-role supersession is scoped to the same role while other roles stay active', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  await pool.query(
    `INSERT INTO moderation.cases(guild_id,user_id,kind,reason,expires_at,moderator_id,idempotency_key,execution_status,metadata)
     VALUES($1,$2,'temp_role','test',$3,$4,'role-a','applied','{"roleId":"111"} '),
            ($1,$2,'temp_role','test',$3,$4,'role-b','applied','{"roleId":"222"} ')`,
    [guild, subject, past, actor],
  );
  const newer = await insertCase('temp_role', past, 'role-a-new');
  await pool.query(`UPDATE moderation.cases SET metadata='{"roleId":"111"}' WHERE idempotency_key='role-a-new'`);
  await pool.query(SUPERSEDE_OLDER_SQL, [guild, subject, 'temp_role', newer.rows[0].case_id, 'roleId', '111']);
  const rows = await pool.query(`SELECT idempotency_key, superseded_by FROM moderation.cases ORDER BY idempotency_key`);
  const byKey = Object.fromEntries(rows.rows.map(r => [r.idempotency_key, r.superseded_by]));
  assert.equal(String(byKey['role-a']), String(newer.rows[0].case_id));
  assert.equal(byKey['role-b'], null);
});
test('clearing a case releases the lease and stops further claims', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const row = await insertCase('timeout', past, 'clear-me');
  await pool.query(CLAIM_DUE_EXPIRY_SQL, [10, lease]);
  await pool.query(CLEAR_EXPIRY_SQL, [row.rows[0].case_id, 'expired']);
  const claimed = await pool.query(CLAIM_DUE_EXPIRY_SQL, [10, lease]);
  assert.equal(claimed.rowCount, 0);
  const after = await pool.query('SELECT execution_status, expires_at, lease_owner FROM moderation.cases WHERE case_id=$1', [row.rows[0].case_id]);
  assert.deepEqual(after.rows[0], { execution_status: 'expired', expires_at: null, lease_owner: null });
});
