// Phase 3: job recovery worker — LISTEN + periodic reconciliation (§5).
// Leases + bounded retries + backoff/jitter + dead-letter via ops.jobs; handlers land per-phase.
import { Client } from "pg";
import { LEASE_SQL, COMPLETE_SQL, FAIL_SQL, nextBackoffMs } from "@ei-royality/runtime";
import { onShutdown } from "@ei-royality/runtime";

const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL == null) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const OWNER = `worker-${process.pid}`;
const LEASE_SEC = 120;
const BATCH = 10;
const POLL_MS = 5000;

const client = new Client({ connectionString: DATABASE_URL, application_name: OWNER });
await client.connect();
await client.query("LISTEN ei_jobs");
client.on("notification", () => {
  void pump().catch((err) => console.error("pump failed", err));
});

let pumping = false;
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    const leased = await client.query(LEASE_SQL, [OWNER, LEASE_SEC, BATCH]);
    for (const job of leased.rows) {
      try {
        // Phase 3: no domain handlers yet — park as failed with backoff so drills can observe recovery.
        throw new Error(`no-handler:${String((job as { kind: string }).kind)}`);
      } catch (err) {
        const attempts = (job as { attempts: number }).attempts;
        await client.query(FAIL_SQL, [
          (job as { job_id: string }).job_id,
          nextBackoffMs(attempts),
          err instanceof Error ? err.message : String(err),
        ]);
      }
    }
    // Reconcile missed NOTIFYs: pump again if work remains due.
    const pending = await client.query(
      `SELECT 1 FROM ops.jobs WHERE status IN ('pending','failed') AND next_run_at <= now() LIMIT 1`,
    );
    if ((pending.rowCount ?? 0) > 0) setTimeout(() => void pump(), 1000).unref();
  } finally {
    pumping = false;
  }
}

const timer = setInterval(() => void pump(), POLL_MS);
onShutdown(["SIGTERM", "SIGINT"], async () => {
  clearInterval(timer);
  await client.end();
});
console.log("workers listening (Phase 3 recovery loop)");
await pump();
