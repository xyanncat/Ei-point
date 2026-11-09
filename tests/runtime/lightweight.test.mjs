// Free-tier invariants (Render 750 h / Neon 100 CU-hours). These are structural
// guards: a reintroduced 5-second database heartbeat silently keeps a
// scale-to-zero database awake and exhausts the free allowance mid-month.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/gu, "\n");
const activeBots = ["ai", "commerce", "community", "himiko", "kafka"];

test("active bots write no periodic service-status heartbeat", () => {
  for (const bot of activeBots) {
    const source = read(`apps/bots/${bot}/src/index.ts`);
    assert.doesNotMatch(source, /service_status/u, `${bot} must not keep a 5s DB heartbeat`);
    assert.doesNotMatch(source, /setInterval\(\(\) => void updateStatus\(\), 5000\)/u, bot);
  }
});

test("every active bot exposes a process-only liveness probe and honours Render's PORT", () => {
  for (const bot of activeBots) {
    const source = read(`apps/bots/${bot}/src/index.ts`);
    assert.match(source, /\/health\/live/u, `${bot} needs /health/live`);
    assert.match(source, /process\.env\.PORT/u, `${bot} must bind Render's PORT`);
    // Readiness is a live, on-demand check rather than a stale flag.
    assert.match(source, /\/health\/ready[\s\S]{0,700}?SELECT 1/u, `${bot} must probe readiness on demand`);
  }
});

test("the job worker polls slowly through a pool and does not rely on LISTEN", () => {
  const source = read("apps/workers/src/index.ts");
  assert.match(source, /WORKER_POLL_SECONDS \?\? 900/u);
  assert.doesNotMatch(source, /LISTEN ei_jobs/u, "Neon scale-to-zero drops LISTEN sessions");
  assert.match(source, /new Pool\(/u);
  assert.match(source, /max: 2/u);
});

test("commerce maintenance is slow by default", () => {
  const source = read("apps/api/src/app.ts");
  assert.match(source, /COMMERCE_MAINTENANCE_SECONDS\s*\?\?\s*900/u);
});

test("nightly Drive backups exist, are encrypted, and never auto-initialise", () => {
  const workflow = read(".github/workflows/neon-drive-backup.yml");
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /restic backup/u);
  assert.match(workflow, /restic init/u);
  assert.match(workflow, /init=true/u);
  assert.match(workflow, /rclone/u);
  assert.match(workflow, /pg_dump/u);
  assert.match(workflow, /RCLONE_CONFIG_B64/u);
  assert.match(workflow, /secret/u);
});
