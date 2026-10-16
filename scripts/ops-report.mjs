#!/usr/bin/env node
// Operator surface (§9C): backup freshness/restore age, durable queue lag,
// delivery (outbox) failures and service heartbeats in one report for
// authorized operators. Model-service health stays with the watchdog and
// health-fleet probes (they have no database route by design).
//
//   DATABASE_URL=... node scripts/ops-report.mjs [--backup-root DIR] [--max-backup-age-hours N] [--json]
//
// Exit codes: 0 all clear, 1 at least one breach, 2 misconfigured.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { verifyBackup } from "./lib/operations.mjs";

export const THRESHOLDS = {
  queueLagSeconds: 600,
  deadJobs: 0,
  outboxLagSeconds: 300,
  heartbeatStaleSeconds: 90,
};

function section(id, status, detail) {
  return { id, status, detail };
}

export async function queueLagSection(query) {
  const jobs = await query(
    "SELECT count(*)::int AS n, coalesce(extract(epoch from (now()-min(created_at))),0)::float AS oldest_seconds FROM ops.jobs WHERE status IN ('pending','leased')",
  );
  const dead = await query("SELECT count(*)::int AS n FROM ops.jobs WHERE status='dead'");
  const { n, oldest_seconds: oldest } = jobs[0] ?? { n: 0, oldest_seconds: 0 };
  const deadCount = dead[0]?.n ?? 0;
  const breach = oldest > THRESHOLDS.queueLagSeconds || deadCount > THRESHOLDS.deadJobs;
  return section(
    "queue-lag",
    breach ? "breach" : "ok",
    `${n} pending/leased (oldest ${Math.round(oldest)}s, threshold ${THRESHOLDS.queueLagSeconds}s); ${deadCount} dead`,
  );
}

export async function deliveryFailuresSection(query) {
  const rows = await query(
    "SELECT count(*)::int AS n, coalesce(extract(epoch from (now()-min(created_at))),0)::float AS oldest_seconds FROM ops.outbox WHERE published = FALSE",
  );
  const { n, oldest_seconds: oldest } = rows[0] ?? { n: 0, oldest_seconds: 0 };
  const breach = n > 0 && oldest > THRESHOLDS.outboxLagSeconds;
  return section(
    "delivery-failures",
    breach ? "breach" : "ok",
    `${n} unpublished outbox events (oldest ${Math.round(oldest)}s, threshold ${THRESHOLDS.outboxLagSeconds}s)`,
  );
}

export async function heartbeatSection(query) {
  const rows = await query(
    `SELECT service, liveness, gateway, db_ready, updated_at > now() - interval '${THRESHOLDS.heartbeatStaleSeconds} seconds' AS fresh FROM ops.service_status`,
  );
  const degraded = rows.filter((row) => !(row.fresh && row.liveness === "ok" && row.gateway === "ok" && row.db_ready));
  if (degraded.length) {
    return section("service-heartbeats", "breach", `stale/unready: ${degraded.map((row) => row.service).join(", ")}`);
  }
  return section("service-heartbeats", "ok", `${rows.length} service heartbeat(s) fresh`);
}

export async function backupFreshnessSection(root, maxAgeHours = 24) {
  if (!root) return section("backup-freshness", "breach", "backup root is not configured");
  let entries;
  try {
    entries = (await readdir(root)).filter((name) => /^\d{8}T\d{6}Z$/u.test(name)).sort();
  } catch {
    return section("backup-freshness", "breach", `backup root is missing: ${root}`);
  }
  const latest = entries.at(-1);
  if (!latest) return section("backup-freshness", "breach", `no completed snapshot under ${root}`);
  try {
    const manifest = await verifyBackup(join(root, latest), { maxAgeMs: maxAgeHours * 3_600_000 });
    const ageHours = Math.max(0, (Date.now() - Date.parse(manifest.createdAt)) / 3_600_000);
    return section("backup-freshness", "ok", `latest ${latest} is ${ageHours.toFixed(1)}h old (max ${maxAgeHours}h), integrity verified`);
  } catch (error) {
    return section("backup-freshness", "breach", `latest ${latest}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Aggregate the operator report. `query` is a bound sql->rows function. */
export async function runReport(query, { backupRoot, maxBackupAgeHours = 24 } = {}) {
  const sections = [
    await queueLagSection(query),
    await deliveryFailuresSection(query),
    await heartbeatSection(query),
    await backupFreshnessSection(backupRoot, maxBackupAgeHours),
  ];
  const breaches = sections.filter((entry) => entry.status === "breach");
  return { sections, breaches, exitCode: breaches.length ? 1 : 0 };
}

function valueFor(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (see .env.example)");
    process.exitCode = 2;
    return;
  }
  const backupRoot = valueFor(args, "--backup-root") ?? "/srv/backups";
  const maxAgeHours = Number(valueFor(args, "--max-backup-age-hours") ?? 24);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    console.error("--max-backup-age-hours must be a positive number");
    process.exitCode = 2;
    return;
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (error) {
    console.error(`Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  try {
    const query = async (sql) => (await client.query(sql)).rows;
    const report = await runReport(query, { backupRoot, maxBackupAgeHours: maxAgeHours });
    if (json) {
      console.log(JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
    } else {
      for (const entry of report.sections) console.log(`${entry.status.toUpperCase().padEnd(6)} ${entry.id}: ${entry.detail}`);
      console.log(report.breaches.length ? `\n${report.breaches.length} breach(es) require operator action` : "\nAll operator surfaces clear");
    }
    process.exitCode = report.exitCode;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("ops-report.mjs")) await main();
