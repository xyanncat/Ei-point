# Google Drive backups (Neon + media)

Google Drive is the durable store: ~4 TB usable, reached through `rclone`, with
restic encrypting every byte before upload. Drive holds ciphertext only.

## Layout

```
drive:
└── ei-point/
    ├── backups/          restic repository (encrypted, deduplicated)
    ├── media/            posters, soundtrack, compressed film derivatives
    └── exports/          manual exports and restore-drill artifacts
```

## Workflow (free)

`.github/workflows/neon-drive-backup.yml` runs daily at 03:17 UTC:

1. installs restic + rclone, writes the rclone configuration from a secret;
2. dumps Neon with `pg_dump` (Postgres 17 container, custom format);
3. initialises the restic repository **only** when dispatched with `init=true`;
4. backs up the dump and applies retention (`7 daily`, `4 weekly`, prune);
5. runs `restic check`.

GitHub Actions is free for public repositories (MIT), so no Render service or
750-hour allowance is consumed.

## Secrets

| Secret | Value |
|---|---|
| `NEON_DATABASE_URL` | Neon **direct** connection string with `sslmode=require` |
| `RESTIC_PASSWORD` | long random passphrase (store a copy outside GitHub) |
| `RCLONE_CONFIG_B64` | `base64 -w0 rclone.conf` for the dedicated Drive account |

Create the rclone remote once on a trusted machine:

```sh
rclone config          # name: drive, type: drive, scope: drive
base64 -w0 ~/.config/rclone/rclone.conf
```

Use a **dedicated Google account** for backups (not a personal login). The
restic password is the only key to the repository: losing it loses the data.

## First run

Actions → **neon-drive-backup** → Run workflow → set `init: true`. Later runs
leave `init` false and fail loudly if the repository is missing.

## Restore

```sh
export RCLONE_CONFIG=/path/to/rclone.conf
export RESTIC_REPOSITORY=rclone:drive:ei-point/backups
export RESTIC_PASSWORD='…'
restic restore latest --target /srv/restore
pg_restore --clean --if-exists --no-owner \
  --dbname "postgresql://…/ei_point?sslmode=require" /srv/restore/dump/ei-point.dump
```

Then run the migrations check and the bot/API smoke tests. Record the elapsed
time in the audit note; a backup is unproven until a restore succeeds.

## What is not on Drive

- **The live database** (Neon), auth sessions, orders and AI memory.
- **Website media served to browsers** — Vercel (100 GB/month) or a future
  Drive-backed gateway; Drive is not a CDN.
