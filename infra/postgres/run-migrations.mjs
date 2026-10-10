#!/usr/bin/env node
// Minimal migration runner (Phase 2): applies infra/postgres/migrations/*.sql in order via DATABASE_URL.
// Replaced by a proper migrator in Phase 3; keeps forward-only + backward-compatible rule (§12).
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
if (process.env.DATABASE_URL == null) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}
const { Client } = await import("pg").catch(() => {
  console.error("npm i pg to run migrations locally");
  process.exit(1);
});
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
// ops schema must exist before the ledger (fresh DBs have no schemas yet).
await client.query(`CREATE SCHEMA IF NOT EXISTS ops`);
await client.query(`CREATE TABLE IF NOT EXISTS ops.schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
for (const f of files) {
  const done = await client.query(`SELECT 1 FROM ops.schema_migrations WHERE name=$1`, [f]);
  if (done.rowCount > 0) {
    console.log(`skip ${f}`);
    continue;
  }
  console.log(`apply ${f}`);
  await client.query("BEGIN");
  try {
    await client.query(readFileSync(join(dir, f), "utf8"));
    await client.query(`INSERT INTO ops.schema_migrations (name) VALUES ($1)`, [f]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
await client.end();
console.log("migrations ok");
