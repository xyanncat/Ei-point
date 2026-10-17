# VPS release and recovery procedure

These procedures require Linux, Docker Compose, Bash, Node.js, Python 3, GNU timeout and flock. Backup prerequisites and timer configuration are in [the backup guide](../infra/backup/README.md). Local mocked tests do not certify this procedure on the VPS. Use a staging/test guild first; production cutover remains an operator action.

## Prepare the release

Build every application image and the custom PostgreSQL image from this checkout on Linux. Publish them and record their actual repository digests. The PostgreSQL image must come from `infra/backup/Dockerfile`, because a plain upstream image lacks the configured pgBackRest executable. Do not use sample or invented digests.

Create a root-readable release JSON with `id`, `images` and optional `bots`. `images` maps every selected Compose service to its published `repository@sha256:<64 hexadecimal characters>` reference. Required foundation services are `postgres`, `nginx`, `api`, `web`, `workers`, `tts-qwen`, and `hy-mt2`. Include each selected bot service as well. Omitting `bots` selects the six currently implemented identities:

| Compose service | Registry key | Readiness port |
|---|---|---:|
| tts-qwen | local Qwen TTS runtime | 3120 |
| hy-mt2 | local Hy-MT2 translation runtime | 3121 |
| bot-kafka | kafka | 3108 |
| bot-himiko | himiko | 3107 |
| bot-community | silverwolf | 3103 |
| bot-ai | cyrene | 3104 |
| bot-music | robin | 3105 |
| bot-commerce | cipher | 3106 |

An explicit `bots` array contains objects with `service`, `botKey` and `port`. This permits a different number of bots; adding an identity still requires an implemented Compose service, its application/token/health wiring and an approved database registry assignment. A manifest does not create those capabilities. Retired services are stopped within the `ei-point` Compose project. The old overlapping security/moderation processes must remain stopped.

Validate and generate the override before performing Docker operations:

```sh
node scripts/release-manifest.mjs /secure/release.json /secure/release.compose.json
```

Set `ENV_FILE` explicitly. Use separate administrative `MIGRATION_DATABASE_URL` and least-privilege `DATABASE_URL`, both pointing to `ei_point` on the same server. The application username must be `ei_point_app`; its URL-encoded password must contain at least 24 characters and no placeholder. The migration service runs schema migrations and provisions application-role credentials/grants. Administrative credentials belong only to this one-shot service and PostgreSQL bootstrap.

Configure OAuth, approved registry identities/guilds, tokens, payment destinations and provider URLs/keys/models. AI primary URL/key/model are required for direct-mention chat; a fallback needs its URL/model and may use a key. Cyrene TTS and translation require the pinned local Qwen/Hy-MT2 weights, reference audio and persona memory described in the [Qwen TTS](operations/qwen-tts.md) and [Hy-MT2 translation](operations/hy-mt2.md) guides; model services start offline. Set the real UPI payee and payment origin before exposing checkout. Configure public TLS and ingress separately; nginx binds loopback port 8080 in this Compose setup. Set the trusted proxy IP/subnet consistently if changing the default network.

## First provisioning and later releases

The guarded deploy script requires an existing verified logical backup bundle no older than 24 hours by default (`DEPLOY_BACKUP_MAX_AGE_HOURS` can set an operator-approved bound). For a fresh empty installation, first generate the override, validate Compose configuration, pull the immutable images and start PostgreSQL using `--project-name ei-point --env-file "$ENV_FILE" -f infra/docker/compose.yml -f /secure/release.compose.json`. Create and check the pgBackRest stanza before running the maintenance `migrate` service with that same Compose configuration. Before the first backup, create the stopped edge proxy container with `create --no-build nginx` using the same Compose arguments; this initializes the project-labelled artwork volume without exposing the application. Create the initial physical/logical backup with `ENV_FILE="$ENV_FILE" bash infra/backup/local-backup.sh`, and select its published timestamp directory. Do not bypass the backup requirement with fabricated artifacts.

For subsequent releases:

```sh
ENV_FILE=/srv/ei-point/.env BACKUP_SNAPSHOT=/srv/backups/<published-timestamp> \
  bash scripts/deploy.sh /secure/release.json
```

Use the actual backup root configured in the environment; the path above is illustrative. Deployment requires disk usage below 85%, immutable images, a hash-verified backup within the configured age, pgBackRest stanza creation/check, migration success, container readiness, HTTP readiness and fresh identity-scoped database heartbeats. Each local model service can take up to 15 minutes to become healthy during deployment; this is a configured ceiling, not a promised or measured duration. Set `RELEASE_HEALTH_ATTEMPTS` only to shorten the later fleet readiness loop for an environment whose health timings are known. The selected bundle's age does not prove that an independent off-host copy is current. Current/previous manifest pointers advance only after health succeeds. Schema migration and process replacement can interrupt service; there is no zero-downtime guarantee. Do not run incompatible old application code across destructive schema changes; use expand/contract migrations and review compatibility before release.

On failure, inspect the cause and select a known compatible previous manifest:

```sh
ENV_FILE=/srv/ei-point/.env bash scripts/rollback.sh /srv/ei-point/.releases/previous.json
```

Rollback changes application images and selected bots, preserving database contents and volumes. It does not reverse migrations or restore PostgreSQL/nginx images. Never automatically restore an old database over new financial writes. A database recovery requires a separate incident decision and measured recovery procedure.

## Acceptance still required

Before production cutover, verify clean Linux image builds and Compose startup on the benchmark VPS, live OAuth and role revocation, each selected bot's permissions/control guards, actual moderation/lockdown/restoration effects in a disposable guild, configured provider failures and voice playback/restart behavior, payment reconciliation without duplicate fulfillment, and resource/load/soak behavior. Measure local logical restore, physical WAL/PITR and off-host restore with real artifacts. Validate backup age, free space and alert delivery. Timer presence and mock test success do not establish RPO/RTO.
