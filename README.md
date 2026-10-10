# Ei Royality — Monorepo Root

> Phase 2 — Foundation. See `project assets/cred/EI_ROYALITY_VPS_BUILD_PLAN.md` and `project assets/cred/VPS_BENCHMARK.md`.

## Layout

```text
apps/
  dashboard/       Next.js dashboard + public website
  api/             Fastify API + auth/session routes
  bots/            six bot applications (security, moderation, community, ai, music-py, commerce)
  workers/         jobs, outbox, backup, maintenance workers
packages/
  runtime/         interaction lifecycle, authorization, queues, logging
  modules/        security, moderation, games, ai, music, commerce (feature logic, no bot client)
  contracts/       OpenAPI types, event schemas, config schemas
infra/
  postgres/        migrations, roles, indexes, backup config
  docker/          compose files, healthchecks, DNS
  systemd/         slice, watchdog, backup timers
  nginx/           routing, security headers
docs/
  feature-matrix.md  Phase 1 inventory (template until source projects provided)
  operations.md
  recovery-drills.md
```

## Toolchain pins

- Node.js 24 LTS (` .nvmrc` → `24.8.0`), discord.js 14, TypeScript 5.6
- Python 3.12, discord.py 2.5, yt-dlp + FFmpeg 7 (music service only)
- Next.js 14, Fastify 5, PostgreSQL 17, Nginx 1.27
- Docker Engine 29.9.0 + Compose 5.6.0 (per benchmark — verify on VPS before prod)
- Lockfiles + pinned patch versions + image digests for releases (see `infra/docker/`)

## Local demo (no credentials, no database)

```bash
node apps/api/demo/demo-server.mjs        # fixture API on :3001 (leave running)
cd apps/dashboard && npm install --no-save next@14.2.18 react@18.3.1 react-dom@18.3.1
NEXT_PUBLIC_API_BASE=http://127.0.0.1:3001 npx next dev -p 3000
```

Then open <http://localhost:3000> (overview with six demo bot cards) and
<http://localhost:3000/verify?token=demo> (order verification).
`apps/api/demo/demo-server.mjs` is fixture-only and never deployed.

## Quick start (dev)

```bash
cp .env.example .env
# edit .env — never commit secrets
docker compose -f infra/docker/compose.yml up --build postgres nginx
pnpm install
pnpm dev
```

## Production

Production starts only prebuilt, tested images — never `build` on the hot path.
See `docs/operations.md` and `infra/docker/compose.prod.yml`.
