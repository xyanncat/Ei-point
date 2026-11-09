# Operations (free tier)

There is no VPS, Compose stack, nginx or systemd unit any more. Production is:

| Concern | Documentation |
|---|---|
| Deployment (Render bots, API, Vercel) | [render-vercel](operations/render-vercel.md) |
| Database (Neon live, 100 CU-hours, sleep rules) | [neon](operations/neon.md) |
| Backups and restore (encrypted restic on Drive) | [drive-backups](operations/drive-backups.md) |
| Cyrene + Robin on the phone (Termux, Piper bridge) | [phone-hosting](operations/phone-hosting.md) |
| Current phase gates | [phase-gates](phase-gates.md) |

## Health

- **Bots**: `/health/live` is process-only and is what Render checks;
  `/health/ready` performs an on-demand database query.
- **API**: `/healthz` is process-only; `/readyz` checks the database.
- Render restarts a crashed service; the bots are long-running gateway clients,
  so no uptime pinger is needed (WebSocket traffic keeps the service awake).

## Free-tier limits to watch

- **Render**: 512 MB / 0.1 CPU per service, 750 instance-hours per workspace
  per month, one always-on service per workspace.
- **Neon**: 100 CU-hours/project/month, scale-to-zero after ~5 minutes. The code
  sleeps by design (see `docs/operations/neon.md`); do not add fast polling.
- **Vercel**: 100 GB bandwidth/month, 60 s function timeout.
- **GitHub Actions**: free for public repositories; used for backups and
  migrations.
- **Drive**: roughly 4 TB usable; ciphertext only for restic backups.

## Incidents

1. **Bot offline** — Render logs; verify the token, gateway intents and guild
   allowlist; redeploy if the service crashed.
2. **API slow on first request** — expected cold start after idle; subsequent
   requests are fast.
3. **Database suspended mid-month** — the project exceeded 100 CU-hours; check
   for a reintroduced fast poll, then upgrade or wait for the next billing
   period. Data is not deleted.
4. **Backup failed** — inspect the `neon-drive-backup` run; verify the three
   secrets and that the rclone token still works. A failed backup never
   initialises a repository automatically.
5. **Media 404s** — check `NEXT_PUBLIC_MEDIA_BASE_URL` and the Drive/GCS origin.
