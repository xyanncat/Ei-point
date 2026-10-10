// Phase 2 stub: job lease loop against ops.jobs (§5). Full outbox + backoff + jitter in Phase 3.
const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL == null) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
console.log("workers init: waiting for Phase 3 job implementation");

setInterval(() => {
  // heartbeat; Phase 3 replaces with LISTEN + reconciliation
}, 30000);
