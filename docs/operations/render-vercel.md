# Render + Vercel deployment (free tier)

The VPS is gone. Production runs on four Render free workspaces (one always-on
bot each), one Render workspace for the API, Vercel for the website, Neon for
the database and a phone for Cyrene + Robin.

## Why one service per Render workspace

A free workspace gets **750 instance hours/month** and a 31-day month has 744
hours. One always-on service consumes the whole allowance; a second service in
the same workspace exhausts it and **suspends every free service there**. The
same workspace also sleeps a service after 15 minutes without inbound traffic —
Discord gateway WebSocket messages count as activity since February 2026, so a
connected bot stays awake without a pinger.

| Account | Service | Blueprint | Health path |
|---|---|---|---|
| 1 | Kafka (security/moderation) | `infra/render/bot-kafka.yaml` | `/health/live` |
| 2 | Himeko (community) | `infra/render/bot-himiko.yaml` | `/health/live` |
| 3 | SilverWolf (cards/economy) | `infra/render/bot-community.yaml` | `/health/live` |
| 4 | Cipher (commerce) | `infra/render/bot-commerce.yaml` | `/health/live` |
| 5 | API **+ job worker** | `infra/render/api.yaml` | `/healthz` |
| Phone | Cyrene + Piper, Robin | [phone-hosting](phone-hosting.md) | local |
| Vercel | Next.js website | dashboard | — |

## Render setup

1. Create a workspace per bot (use the dedicated account for that identity).
2. **New → Blueprint**, connect this repository, set the Blueprint path to the
   file above.
3. Fill the `sync: false` variables from `.env.example`; `DATABASE_URL` is the
   Neon **pooled** URL with `?sslmode=require`.
4. Deploy. The bot binds `$PORT`, registers slash commands and connects its
   gateway. Render health-checks `/health/live` (no database query).

API service specifics:

- `dockerCommand: sh /app/start-api.sh` starts the job worker in the background
  and the Fastify API in the foreground (one free service runs both).
- `healthCheckPath: /healthz` is process-only; `/readyz` is the database check.
- Run migrations with the **migrate-database** GitHub Action (Render free has no
  shell): it executes `infra/postgres/run-migrations.mjs` against
  `MIGRATION_DATABASE_URL`.
- Set `NODE_OPTIONS=--max-old-space-size=384` so Node stays inside 512 MB.

## Vercel setup

1. Import the repository, set **Root Directory** to `apps/dashboard`.
2. Install command: `cd ../.. && corepack pnpm install --frozen-lockfile`
   Build command: `cd ../.. && corepack pnpm --filter @ei-point/dashboard build`
3. Environment variables:
   - `API_INTERNAL_URL=https://<api-service>.onrender.com` — the existing
     `/api/:path*` rewrite proxies to it.
   - `SESSION_SECRET`, `CSRF_SECRET`, `VAULT_SECRET`, `DISCORD_CLIENT_ID`,
     `DISCORD_CLIENT_SECRET`, `OAUTH_REDIRECT_URL`, `DASHBOARD_ORIGIN`
   - `NEXT_PUBLIC_MEDIA_BASE_URL` (see the media phase)
4. `COOKIE_SECURE=true`; the dashboard is HTTPS on Vercel.

## Free-tier expectations

- **Cold starts**: Render free services sleep only if traffic stops for 15
  minutes. A connected Discord bot keeps itself awake; the API sleeps when the
  site is idle and takes ~30–60 s to wake on the first dashboard request.
- **Memory**: 512 MB per service. Four bots are text-only; Cyrene's voice and
  Robin run on the phone.
- **Database**: Neon free scales to zero; see [neon](neon.md). The API and bots
  use the pooled endpoint.
- **Deploys**: Render redeploys on push (or manual); roll back with Render's
  "Deploy previous version". There is no release-manifest layer any more.

## Verification checklist

- [ ] Each bot's Render log shows a ready tag and no repeated DB errors.
- [ ] `/health/live` returns 200 on every service; `/healthz` on the API.
- [ ] The dashboard loads and `/api/healthz` through the Vercel rewrite works.
- [ ] Slash commands registered once, not duplicated across restarts.
- [ ] Neon usage stays under 100 CU-hours for the first month.
