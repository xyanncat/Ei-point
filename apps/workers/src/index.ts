// Phase 3: job recovery worker — LISTEN + periodic reconciliation (§5).
// Leases + bounded retries + backoff/jitter + dead-letter via ops.jobs; handlers land per-phase.
import { Client } from "pg";
import { LEASE_SQL, FAIL_SQL, nextBackoffMs } from "@ei-royality/runtime";
import { installRejectionHandler, onShutdown } from "@ei-royality/runtime";

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

const client = new Client({ connectionString: DATABASE_URL, application_name: OWNER });
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
async function pump(): Promise<void> {
  if (pumping || stopping) return;
  pumping = true;
  const run: Promise<void> = (async () => {
    const leased = await client.query(LEASE_SQL, [OWNER, LEASE_SEC, BATCH]);
    for (const job of leased.rows) {
      try {
        // Phase 3: no domain handlers yet — park as failed with backoff so drills can observe recovery.
        throw new Error(`no-handler:${String((job as { kind: string }).kind)}`);
      } catch (err) {
        const attempts = (job as { attempts: number }).attempts;
        // nextBackoffMs returns ms; FAIL_SQL interval is seconds — round up, never shorten.
        try {
          await client.query(FAIL_SQL, [
            (job as { job_id: string }).job_id,
            Math.ceil(nextBackoffMs(attempts) / 1000),
            err instanceof Error ? err.message : String(err),
          ]);
        } catch (failErr) {
          // Never let one job's bookkeeping failure starve the rest of the batch.
          console.error("FAIL_SQL failed", { job: (job as { job_id: string }).job_id, failErr });
        }
      }
    }
    // Reconcile missed NOTIFYs: pump again if work remains due (same predicate as LEASE_SQL).
    const pending = await client.query(
      `SELECT 1 FROM ops.jobs WHERE status IN ('pending','leased','failed') AND next_run_at <= now() AND (lease_expires_at IS NULL OR lease_expires_at < now()) LIMIT 1`,
    );
    if ((pending.rowCount ?? 0) > 0) {
      setTimeout(() => void pump().catch((err) => console.error("repump failed", err)), 1000).unref();
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

const timer = setInterval(() => void pump().catch((err) => console.error("poll pump failed", err)), POLL_MS);
onShutdown(["SIGTERM", "SIGINT"], async () => {
  // Stop scheduling new work, then let the active batch finish before closing the client
  // (shutdown.ts enforces a 15 s hard stop if the drain hangs).
  stopping = true;
  clearInterval(timer);
  if (activePump != null) await activePump.catch((err) => console.error("final pump failed", err));
  await client.end();
});
console.log("workers listening (Phase 3 recovery loop)");
await pump();
