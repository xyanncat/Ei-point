# Phase 6: community and economy

Scope from the build plan: welcomes, XP, cards, packs, inventories, market, trades, concurrent operations and transaction rollback. These features are implemented in the community bot and PostgreSQL services. This document is a local implementation handoff; it does not certify a VPS launch or complete feature parity with the missing archived bots.

## Setup

1. Use the repository's pinned Node 24.8.0 and pnpm 9.12.0. Run `pnpm install --frozen-lockfile` and `pnpm build`.
2. Back up the database before applying migrations. Set `DATABASE_URL` for the migration operator and run `pnpm migrate`. Migration `004_community_economy.sql` extends the existing tables; the bot refuses to start without it. Use a restricted application database role for the bot, with access to its community/games tables, approved guilds, outbox and service status.
3. Approve only the intended test/main guilds in `access.guilds`. Set `GUILD_ALLOWLIST` to their comma-separated Discord IDs in the Compose environment. For direct local startup use `GUILD_ALLOWLIST`, `BOT_TOKEN`, and `DATABASE_URL`.
4. Enable the **Server Members Intent** in the Discord developer portal. Grant View Channels, Send Messages and application command access in the intended channels. Message Content Intent is not required for XP. Keep tokens outside source control.
5. On a Linux build/staging machine, build the community image using `docker compose --env-file .env -f infra/docker/compose.yml build bot-community` and validate it against staging. Publish that image and set its immutable reference in `infra/docker/compose.prod.yml` before starting it on the VPS with both Compose files and `up -d --no-build bot-community`. The overlay still has release placeholders; resolve them before use. Keep builds off the live VPS hot path. For local development use `pnpm --filter @ei-point/bot-community dev`. Commands register only in approved, allowlisted guilds present at startup; restart after adding another approved guild.

Do not copy development fixtures into production. The existing catalog asset folder is empty, so production starts without invented cards or packs. Catalog definitions are shared; ownership, balances, XP, listings and trades are isolated by guild.

## Discord controls

Manage Server permission is required for `/setwelcome`, `/setleave`, `/testwelcome`, `/xp` and `/setlevelchannel`. Templates support `{user}`, `{guild}` and `{count}`. XP defaults to 15 per eligible message with a 60-second member cooldown. Bots and webhooks receive no XP. `/rank` and `/leaderboard` show persisted progression.

Members use `/cards`, `/inventory`, `/balance`, `/packs`, `/open`, `/sell`, `/market`, `/buy`, `/unlist`, `/trades`, and `/trade offer|accept|cancel`. Pages contain ten items. Trade card lists are comma-separated instance UUIDs. Only the recipient can accept; either participant can cancel. Pending offers expire automatically. Cards reserved by a listing or offered trade cannot be sold or promised again. Requested recipient cards are checked at acceptance, rather than reserved without consent.

Only the guild owner can use `/cardadmin define|pack|credit|issue`. Example JSON for the define command (replace the checksum with the SHA-256 of the actual artwork):

```json
{"cardId":"example-card","name":"Example","rarity":"common","artworkRef":"","checksum":"0000000000000000000000000000000000000000000000000000000000000000","maxSupply":100}
```

Example pack JSON after importing the card:

```json
{"packId":"starter","name":"Starter","price":"100","size":1,"adminOnly":false,"items":[{"cardId":"example-card","weight":1}]}
```

These are documentation examples, not seeded data. Artwork references currently accept empty values or HTTPS URLs; the bot presents textual catalog/inventory records, not image card rendering. To keep artwork on the VPS, use its own HTTPS artwork endpoint once that endpoint and the asset import have been validated. The checksum is stored metadata, not proof that a remote image was downloaded or verified. Supply caps and serial numbers are enforced during minting. Pack prices come from the database, never from a purchaser. Pack draws use cryptographic randomness and remaining supply. Premium/admin-only packs require the guild owner. No payment entitlement is inferred.

## Persistence and reliability

- A five-connection pool, three-second lock/connect timeouts and five-second statement timeout bound database work. Transactions use one checked-out connection. Guild advisory locks serialize community/economy work; database locks also protect global card supply across guilds. This favors consistency for the private two-guild workload and needs VPS load measurement before raising concurrency.
- Integer currency is represented by PostgreSQL BIGINT and checked integer inputs. Balances and inventory transfers are committed together. Ledger entries and durable interaction receipts make repeated interaction IDs idempotent; conflicting reuse is rejected. A failure after commit but before Discord's reply can leave the outcome uncertain, so inspect balance/inventory before issuing a new operation.
- Joins, leaves and level-ups enqueue messages in the database. The delivery loop leases one at a time, retries with backoff, and records sanitized failures. Five failed attempts leave an unpublished row for operator investigation. Delivery is at least once across crashes; Discord nonces reduce duplicate sends but do not provide an unlimited exactly-once guarantee.
- XP message deduplication is retained for seven days. Operation receipts and the monetary ledger are retained; establish an archival policy with backups before pruning. Pending trades are reconciled every minute. Runtime bot state is reconstructable from the VPS database.
- Twenty concurrent commands and 32 concurrent XP tasks are admission limits. Optional XP work is shed when saturated. This is bounded operation, not a guarantee that every message earns XP during overload. Commands acknowledge before database queries.
- `/health/live` on port 3103 checks process responsiveness; `/health/ready` requires gateway and database readiness. Compose keeps this port private and applies the existing 0.75 CPU/3 GiB community budget, a read-only root filesystem and dropped capabilities. Health checks alone do not replace the Phase 9 watchdog.

## Verification and launch gates

`pnpm test:phase6` builds the bot/services and runs 18 integration tests against a disposable real PostgreSQL 17 instance. The test database is separate from `DATABASE_URL`; no production data or Discord token is needed. Tests cover concurrent XP, concurrent purchases, receipt replay/conflicts, injected final-write rollback, reservations, concurrent trade acceptance, insufficient funds, expiry, supply exhaustion, premium/guild authorization, notification persistence/retry and acknowledgement/permission ordering. Existing module tests additionally cover rendering, level curves and the legacy purchase helper's debit failure.

Before enabling production:

1. Build the Linux Docker image and run migrations twice on a restored staging database; confirm permissions and retained data. Check health, restart recovery and notification retries with real Discord channels.
2. In the test guild exercise every command, role denial, guild denial, two competing buyers, duplicate delivery and a full offered/requested-card trade. Import the actual audited catalog/assets and verify supply, pack configuration and artwork availability.
3. Run the build plan's two-guild workload, acknowledgement latency gates and 72-hour soak on the measured VPS. Monitor CPU, RSS, PostgreSQL connections, lock waits, outbox delay and disk growth under the full fleet.
4. Prove backup/restore including ledger, operation receipts, inventory, pending reservations and XP. Review unpublished outbox rows with attempts >=5; correct the destination/permissions, then deliberately reset attempts and next_attempt_at to retry. Do not delete economic records to clear an error.

Docker/VPS and real Discord tests remain outstanding from this Windows session. Dashboard configuration screens, image card rendering, source-specific archived commands, and fleet launch are not part of the verified Phase 6 implementation here.
