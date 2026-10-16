#!/usr/bin/env node
// Minimal migration runner (Phase 2): applies infra/postgres/migrations/*.sql in
// order via DATABASE_URL. Forward-only + backward-compatible rule (§12).
// The advisory lock serializes concurrent runners (api/workers deploys) for the
// whole run — including the ledger bootstrap — so a fresh database is never
// double-created by racing runners.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATION_LOCK_KEY = 727201;

/**
 * Apply every pending migration to `url` and return which files were applied or
 * skipped. `dir` overrides the migration directory (tests); `upTo` stops at a
 * prior snapshot to exercise upgrade paths.
 */
export async function runMigrations(url = process.env.DATABASE_URL, { dir, upTo, silent = true } = {}) {
  const migrationDir = dir ?? join(dirname(fileURLToPath(import.meta.url)), "migrations");
  if (url == null || url === "") throw new Error("DATABASE_URL is required to run migrations");
  const files = readdirSync(migrationDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !upTo || f <= upTo);
  const pgModule = await import("pg");
  const Client = (pgModule.default ?? pgModule).Client;
  const client = new Client({ connectionString: url });
  await client.connect();
  const log = silent ? () => {} : (message) => console.log(message);
  const applied = [];
  const skipped = [];
  await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ops`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ops.schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    for (const f of files) {
      const done = await client.query(`SELECT 1 FROM ops.schema_migrations WHERE name=$1`, [f]);
      if (done.rowCount > 0) {
        skipped.push(f);
        log(`skip ${f}`);
        continue;
      }
      log(`apply ${f}`);
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(join(migrationDir, f), "utf8"));
        await client.query(`INSERT INTO ops.schema_migrations (name) VALUES ($1)`, [f]);
        await client.query("COMMIT");
        applied.push(f);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    log("migrations ok");
    return { applied, skipped };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`).catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.DATABASE_URL == null) {
    console.error("DATABASE_URL is not set (see .env.example)");
    process.exit(1);
  }
  await import("pg").catch(() => {
    console.error("npm i pg to run migrations locally");
    process.exit(1);
  });
  await runMigrations(process.env.DATABASE_URL, { silent: false });
}
