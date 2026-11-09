# Neon free Postgres — the live database

The free-tier architecture runs the live database on **Neon** and uses Google
Drive only for backups and media. Render's free Postgres is not an option: it
expires **30 days after creation** (1 GB, no backups, 14-day grace).

## Why Drive cannot be the live database

Google Drive is object storage with no file locking and high-latency API calls.
Concurrent writers (four Render bots + the API + the phone) have no way to
serialise transactions, so a database file or SQLite database kept on Drive
would corrupt. Drive is the right place for dumps, media masters and exports.

## Provisioning

1. Create a Neon project in the region closest to the bots. The free plan
   includes **100 CU-hours per project per month**, ~1 GB storage, 5 GB egress,
   a 6-hour restore window, and **scale-to-zero after ~5 minutes of inactivity**.
2. Copy the **pooled** connection string (host contains `-pooler`) and use it
   as `DATABASE_URL` **with `?sslmode=require`**.
3. Use the direct (non-pooled) string as `MIGRATION_DATABASE_URL` for
   migrations, which need session-level behaviour.
4. Run migrations once (Render one-off job or a local shell):

   ```sh
   DATABASE_URL="$MIGRATION_DATABASE_URL" node infra/postgres/run-migrations.mjs
   ```

## The CU-hour rule (why the code polls slowly)

Compute is billed at **0.25 CU** while awake. A database kept awake 24/7 uses
`730 h × 0.25 CU ≈ 182 CU-hours` — over the 100 CU-hour allowance, so Neon
suspends compute mid-month. Sleep is not optional.

The application therefore:

- **never writes a periodic heartbeat** to `ops.service_status` (the old 5 s
  writes kept the database permanently awake);
- uses **`/health/live`** for Render health checks (`/health/ready` performs an
  on-demand `SELECT 1` only when something asks for readiness);
- runs background pumps fast (5 s) only for two minutes after Discord activity,
  then backs off to **15 minutes** (`BOT_ACTIVE_POLL_SECONDS` /
  `BOT_IDLE_POLL_SECONDS`);
- polls the job worker every **15 minutes** (`WORKER_POLL_SECONDS`) and runs
  commerce maintenance every **15 minutes** (`COMMERCE_MAINTENANCE_SECONDS`);
- skips voice-XP database reads entirely when nobody is in a voice channel.

With that pattern the database wakes for roughly five minutes per burst of
activity, which keeps typical usage well inside 100 CU-hours. If the bots are
busy all day, either accept the suspend or buy extra CU-hours — do not
"fix" it with a fast poll.

## Connections

Keep pools small: bots use `max: 5`, the worker pool `max: 2`, the API its
existing limit. Use the pooled endpoint so bursts from Render cold starts do
not exhaust direct connections.

## Backups

Nightly encrypted dumps go to Google Drive (see
[drive-backups](drive-backups.md)). Neon's 6-hour restore window is a safety
net, not a backup: it disappears if the project is deleted.
