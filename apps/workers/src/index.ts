import { SUPPORTED_LEASE_SQL, scheduleCommerceExpiry, runCommerceExpiry, recoverExhaustedJobs, publishWorkerHeartbeat } from "./jobs.js";
// Phase 3: job recovery worker — LISTEN + periodic reconciliation (§5).
// SQL maintenance leases only supported kinds; unknown jobs remain visible for operator action.
import { Client } from "pg";
import { nextBackoffMs } from "@ei-point/flow";
import {
  installRejectionHandler,
  onShutdown,
  consumeEmbedJob,
  registeredBotToken,
  sendDashboardEmbed,
  type ControlQuery,
} from "@ei-point/flow";

installRejectionHandler();

const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL == null) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const OWNER = `worker-${process.pid}`;
const LEASE_SEC = 120;
const BATCH = 10;
const POLL_MS = 5000;

const client = new Client({
  connectionString: DATABASE_URL,
  application_name: OWNER,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  idle_in_transaction_session_timeout: 15000,
});
// A dropped LISTEN connection must not become an uncaught exception: exit and let the
// supervisor (compose restart policy / systemd) bring up a fresh connection + LISTEN.
client.on("error", (err) => {
  console.error("pg client error — exiting for supervisor restart", err);
  process.exit(1);
});
await client.connect();
await client.query("LISTEN ei_jobs");
client.on("notification", () => {
  void pump().catch((err) => console.error("pump failed", err));
});

let pumping = false;
let stopping = false;
let activePump: Promise<void> | null = null;
async function pumpEmbeds(): Promise<void> {
  const query: ControlQuery = async (sql, params) =>
    (await client.query(sql, params)).rows;
  const bots = await query(
    "SELECT bot_key,application_id FROM config.bots ORDER BY bot_key",
  );
  // An expired send lease is ambiguous after a crash. Surface it for staff; never duplicate blindly.
  await query(
    "UPDATE ops.jobs SET status='failed',last_error='delivery-unconfirmed',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE kind='dashboard.embed' AND status='leased' AND lease_expires_at<now()",
  );
  for (const bot of bots) {
    const token = registeredBotToken(String(bot.bot_key), process.env);
    if (!token) continue;
    await consumeEmbedJob({
      query,
      botKey: String(bot.bot_key),
      token,
      transaction: async (work) => {
        await query("BEGIN");
        try {
          const result = await work(query);
          await query("COMMIT");
          return result;
        } catch (error) {
          await query("ROLLBACK").catch(() => {});
          throw error;
        }
      },
      send: (payload, currentToken) =>
        sendDashboardEmbed(payload, currentToken, String(bot.application_id)),
    });
  }
}
async function pump(): Promise<void> {
  if (pumping || stopping) return;
  pumping = true;
  const run: Promise<void> = (async () => {
    try {
      try {
        await pumpEmbeds();
      } catch (embedErr) {
        console.error("pumpEmbeds error:", embedErr);
      }
      const query = async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows;
      await scheduleCommerceExpiry(query);
      await recoverExhaustedJobs(query);
      const leased = await client.query(SUPPORTED_LEASE_SQL, [
        OWNER,
        LEASE_SEC,
        BATCH,
      ]);
      for (const job of leased.rows) {
        try {
          await runCommerceExpiry(query, job.job_id, OWNER);
        } catch (err) {
          const attempts = (job as { attempts: number }).attempts;
          // nextBackoffMs returns ms; retry interval is seconds — round up, never shorten.
          try {
            await client.query(`UPDATE ops.jobs SET status=CASE WHEN attempts>=max_attempts THEN 'dead' ELSE 'failed' END,
              next_run_at=now()+($2 || ' seconds')::interval,last_error=$3,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
              WHERE job_id=$1 AND kind='commerce.expire' AND lease_owner=$4 AND status='leased'`, [
              (job as { job_id: string }).job_id,
              Math.ceil(nextBackoffMs(attempts) / 1000),
              err instanceof Error ? err.message : String(err),
              OWNER,
            ]);
          } catch (failErr) {
            // Never let one job's bookkeeping failure starve the rest of the batch.
            console.error("Job retry bookkeeping failed", {
              job: (job as { job_id: string }).job_id,
              failErr,
            });
          }
        }
      }
      await publishWorkerHeartbeat(query);
      // Reconcile missed NOTIFYs: pump again if work remains due (same supported-kind predicate as the lease).
      const pending = await client.query(
        `SELECT 1 FROM ops.jobs WHERE kind = 'commerce.expire' AND attempts<max_attempts AND status IN ('pending','leased','failed') AND next_run_at <= now() AND (lease_expires_at IS NULL OR lease_expires_at < now()) LIMIT 1`,
      );
      if ((pending.rowCount ?? 0) > 0) {
        setTimeout(
          () => void pump().catch((err) => console.error("repump failed", err)),
          1000,
        ).unref();
      }
    } finally {
      pumping = false;
    }
  })();
  activePump = run;
  try {
    await run;
  } finally {
    if (activePump === run) activePump = null;
  }
}

const timer = setInterval(
  () => void pump().catch((err) => console.error("poll pump failed", err)),
  POLL_MS,
);
onShutdown(["SIGTERM", "SIGINT"], async () => {
  // Stop scheduling new work, then let the active batch finish before closing the client
  // (shutdown.ts enforces a 15 s hard stop if the drain hangs).
  stopping = true;
  clearInterval(timer);
  if (activePump != null)
    await activePump.catch((err) => console.error("final pump failed", err));
  await client.end();
});
console.log("workers listening (Phase 3 recovery loop)");
await pump();
