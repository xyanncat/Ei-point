# Archive function restoration and VPS rollout

The approved Kafka frontend and heroes remain fixed. The archive's website functions are ported into the current application; identities come from `config.bots`, not a fixed legacy bot count. Persistence uses the VPS PostgreSQL database.

## Restored flows

- Original 19 service definitions, game/search filters, membership checkout, and a validated future card drop zone.
- Public payment options/catalog, UPI or explicitly quoted USDT checkout, local QR generation, Discord buyer ID and referral capture, UTR/TRON proof claims, and RP order status. Staff review uses guild scopes and CSRF-protected settlement/rejection. Settlement activates membership and referral credit atomically. Duplicate proofs and concurrent settlement cannot credit twice.
- Configuration editors with optimistic version checks and history; saved and runtime-applied states are distinct.
- Guild pause, identity enabled/paused flags, command roles, notification preferences, scoped logs, and embed composition/preview/queued delivery.
- Global administrator guild approvals, staff scopes, encrypted secret CRUD/reveal, and infrastructure account metadata linked to vaulted credentials.
- Internal bearer-authenticated registry/config/account reads, versioned config writes, and separate applied-version acknowledgements.

## Operator setup

1. Back up the existing VPS database, then run the normal migration command including migrations 006 and 007. Migration 006 adds missing archive catalog items without replacing existing prices.
2. Validate `project assets/services` and `project assets/Cards` with `node scripts/build-project-assets.mjs`. Optional database import is `node scripts/import-project-assets.mjs --apply` with the intended DATABASE_URL; run its default dry run first. It preserves existing definitions and creates no owned cards or balances.
3. Configure exact HTTPS `DASHBOARD_ORIGIN` and `PAYMENT_ORIGIN`, the approved `COMMERCE_GUILD_ID`, explicit administrator IDs, distinct strong session/vault/internal secrets, OAuth credentials and callback URL.
4. Configure UPI VPA/name and/or the TRC-20 address plus an explicit `INR_PER_USDT` quote. USDT's fee is separately configurable; no live exchange-rate fetch is implied. Blank destinations disable payment methods. Referral reward defaults to zero until an operator specifies an amount in minor INR units.
5. Register each actual Discord identity and assigned guild/modules in `config.bots`. Its token environment variable is `DISCORD_<UPPERCASE_SANITIZED_BOT_KEY>_BOT_TOKEN`. Worker-only custom identities can use the explicit EMBED_WORKER_BOT_KEY/EMBED_WORKER_BOT_TOKEN pair. Keep the registered application ID equal to the real bot user ID.
6. Start API, dashboard, community runtime and workers using the existing VPS Compose budgets. Use a test guild first. Confirm scope denial, configuration applied state, pause/role restrictions, and a deliberately authorized test embed before production rollout.

## Practical limits

No real payment or Discord message was sent during implementation. Browser checkout/control tests use labeled mocked responses; payment and control transaction tests use disposable real PostgreSQL databases. The local preview API remains a demonstration fixture, so newly restored endpoints require the real API and migrated database to operate.

Staff payment notifications are not configured; proofs appear in the dashboard review queue. Staff must verify the external transfer before settlement. Embed failures after a possible send are marked delivery-unconfirmed and are not blindly retried; staff must investigate to prevent duplicates.

Community runtime consumes supported welcome/leave/leveling configuration and notification preferences. Configuration for security, moderation, AI and music can be saved, but must remain pending until its real runtime installs it. Combining identities does not itself implement those later-phase bot handlers. The wider module inventory and remaining gaps are recorded in `legacy-web-parity.md` and `feature-matrix.md`.

Cards currently contain no definitions or artwork. The gallery reports this accurately; the import pipeline is ready for future drops.
