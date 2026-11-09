# Phase gates — free-tier architecture (2026-11-09)

The VPS architecture was retired when host access was lost. This ledger tracks
the replacement: Render free bots, Vercel web, Neon data, Drive storage, and a
phone for Cyrene + Piper (and Robin by benchmark).

Status vocabulary: **done** (verified in this repo), **operator** (needs an
account/host/phone), **pending** (source work remains).

| Phase | Work | Status | Exit gate |
|---|---|---|---|
| P0a | Remove translation system entirely; MIT licence | **done** | No translation code, tests, docs or env remain; suite green |
| P1 | Neon live DB, remove 5 s heartbeats, adaptive pacing, nightly Drive backup | **done** | No periodic DB write under 5 min; backup workflow exists and never auto-initialises |
| P2 | Render blueprints, API `PORT`, worker-in-API service, Vercel + phone docs | **done** | Every active service has `/health/live` or `/healthz`; blueprints parse |
| P3 | Retire the VPS layer (Compose, systemd, release manifests, pgBackRest/restic host scripts, bench) | **done** | No VPS-only script, unit or doc remains; CI builds the Render images instead |
| P4 | Drive layout for media masters/logs; compressed film derivatives; Vercel bandwidth budget | **pending** | Media URLs verified before originals leave the image |
| P5 | Lightweight + soak: cold-start budgets, memory, 72-hour qualification | **operator** | Measured on the real free-tier deployment |

## Operator gates (cannot be executed from this checkout)

- Create the Neon project, run migrations, record the pooled/direct URLs.
- Create four Render workspaces + blueprints; one always-on service each.
- Create the API Render service and the Vercel project with `API_INTERNAL_URL`.
- Provision rclone/Drive secrets and run the backup workflow once with `init=true`.
- Prepare the phone (Termux, wake lock), the Piper bridge and the Robin benchmark.
- Record the first month of Neon CU-hours and Render instance hours.

## Explicit non-goals

- The live database never runs on Google Drive (no locking).
- One Render free workspace never runs two always-on services (750 h cap).
- Static export of the authenticated dashboard is not part of this phase.
