# Legacy Behavior Decisions (Section 1A)

Status: Approved 2026-10-16 (section 1A of the completion plan, owner-authorised).
Authority: this record interprets the owner's product spec (`docs/product/bot-command-and-runtime-spec.md`,
2026-10-15) against the three hashed legacy archives. `docs/audits/legacy-behavior-map.json` rows marked
`replaced` point here as `approved: docs/product/legacy-decisions.md`.

Every row in the map ends `verified` (behavior preserved and traced to a current handler plus acceptance
tests) or `replaced` (behavior/interface deliberately superseded — recorded below). No row was cleared by a
bulk status change; each group below was reconciled by reading the legacy handler and the current
implementation side by side.

Row references use `archive :: sourcePath :: symbol@line` (the map's `id` embeds the same values).

## Evidence policy for verified rows (section K)

Verified rows name the current implementation path and the closest acceptance tests in their
`decisionReason`. Where the tests exercise the surrounding mechanism (dispatch, persistence, module
boundary) rather than the exact event wiring, the note says so explicitly. Event-wiring rows with no direct
unit test (for example gateway lifecycle callbacks) were traced through the current source and are scoped
to that trace in the note.

---

## A. Ei Paradise — Cipher command surface

### A1. `paymentqr` → replaced by the order/checkout flow

Rows: `Ei Paradise.zip :: Ei Paradise/bots/cipher/src/commands/paymentqr.js :: paymentqr@42`

Legacy `/paymentqr` conjured an in-chat UPI payment QR for a service. The approved surface replaces this
with the authenticated order flow: `/orders create` builds the UPI payload (`buildUpiPayload` in
`packages/modules/commerce`) and the dashboard checkout renders the scannable QR/resume page from the same
order. The standalone QR command is retired.

Evidence: `apps/bots/commerce/src/commands.test.ts` "Discord checkout fails closed before database access
when payee is missing or invalid"; `tests/phase4/commerce.test.mjs` "real PG authoritative checkout, token
claim, concurrent settlement and monthly referral persist exactly once".

### A2. `GET /api/diagnostics` → replaced by heartbeats, readiness and the dashboard overview

Rows: `Ei Paradise.zip :: Ei Paradise/bots/cipher/src/index.js :: GET /api/diagnostics@510`

Legacy exposed gateway state, guild membership and the last command-registration result on a bot-local
endpoint. The replacement is the fleet observability contract: per-bot `/health/live` + `/health/ready`,
the `ops.service_status` heartbeat, and the dashboard overview (which now carries registration/guild
state). The bot-local diagnostics endpoint is retired.

Evidence: `apps/api/src/dashboard.test.ts` "stale heartbeat never appears healthy, and database errors
contain no secrets"; `tests/operations/watchdog.test.mjs` "watchdog scopes canonical fleet, bounds
restarts, reports missing/no-health services, honors grace and consumes disk hold".

### A3. `GET /api/referrals/validate/:code` → replaced by authenticated referral flows

Rows: `Ei Paradise.zip :: Ei Paradise/bots/cipher/src/index.js :: GET /api/referrals/validate/:code@702`

Legacy let any caller check a referral code's validity. Referral codes are now validated and consumed only
inside authenticated Discord flows (`/referral redeem`, `/orders create`), so code validity is never
exposed to anonymous probes.

Evidence: `apps/bots/commerce/src/commands.test.ts` "a redeemed referral is attached to one order and
consumed in the same transaction".

### A4. Legacy `api.test.js` stream scaffolding → replaced by the current commerce suites

Rows: `Ei Paradise.zip :: Ei Paradise/bots/cipher/test/api.test.js :: data@79`, `end@80`, `error@91`,
`data@124`, `end@125`, `error@140`

These rows are the legacy test file's hand-rolled HTTP stream callbacks, not runtime behaviors. The
suite is retired; equivalent (stronger) coverage lives in the current API tests against the real routes.

Evidence: `apps/api/src/commerce-routes.test.ts` (11 tests incl. "public creation requires exact allowed
Origin before database access"); `tests/phase4/commerce.test.mjs`.

### A5. Gateway diagnostics listeners → replaced by fleet supervision

Rows:

- `Ei Paradise.zip :: Ei Paradise/bots/cipher/src/index.js :: error@134`, `shardError@138`,
  `disconnect@142`, `close@148`
- `Ei Paradise.zip :: Ei Paradise/bots/hu-tao/src/index.js :: error@253`, `shardError@257`,
  `disconnect@261`
- `EI-point.zip :: EI-point/packages/shared/src/bot.ts :: Error@1003`
- `EI-point.zip :: EI-point/packages/shared/src/errors.ts :: unhandledRejection@111`,
  `uncaughtException@112`, `warning@113`
- `EI-point.zip :: EI-point/packages/shared/src/health.ts :: error@180`, `error@185`
- `EI-point.zip :: EI-point/packages/shared/src/server-lock.ts :: GuildDelete@110`

Legacy logged per-process gateway/channel/health-server errors and crashed the process on unhandled
rejections/exceptions. The current runtime replaces the layer: gateway reconnection is handled by
discord.js, each bot bootstrap keeps console error and rejection logging, readiness is probed by health
endpoints, and restarts are bounded by the fleet watchdog. No sharding is used (one shard per identity).
The legacy `uncaughtException`/`warning` fatal-exit policy and guild-removal bookkeeping are retired —
guild membership drift is surfaced by the watchdog's fleet checks instead.

Evidence: `tests/operations/watchdog.test.mjs` "watchdog scopes canonical fleet, bounds restarts, reports
missing/no-health services, honors grace and consumes disk hold"; `tests/runtime/dispatch.test.mjs`
"shutdown_during_work_refuses_new_work_and_bounds_drain".

## B. Ei Paradise — Hu Tao

### B1. `userinfo` → replaced by Discord-native profiles

Rows: `Ei Paradise.zip :: Ei Paradise/bots/hu-tao/src/commands/userinfo.js :: userinfo@6`

The approved shared surface is exactly `/botinfo`, `/ping`, `/about` (asserted by
`packages/modules/bot-ui/src/index.test.ts` "common command list contains the three shared commands").
Member detail is provided by Discord's native profile UI; the command is retired.

Evidence: `packages/modules/bot-ui/src/index.test.ts`.

### B2. `guildMemberUpdate` bot screening → replaced by the welcome pipeline

Rows: `Ei Paradise.zip :: Ei Paradise/bots/hu-tao/src/index.js :: guildMemberUpdate@266`

Legacy screened pending bot arrivals (pending → activated announcements). The current product does not
announce bot arrivals: member events flow through Himiko's durable welcome/leave delivery only.

Evidence: `tests/phase6/database.test.mjs` "welcome and leave templates persist and deduplicate durable
notifications"; `apps/bots/himiko/src/delivery.test.ts` "announcement requires durable intent before
sending and never replays a duplicate".

Note: the legacy bot-arrival announcement and embed→plaintext degradation facets of `guildMemberAdd` are
not carried; the human welcome behavior is preserved (verified row).

## C. EI-point — Cyrene chat surface

### C1. `/ask`, `/cyrene`, `/model`, `/reset` → replaced by mention chat, dashboard AI config, bounded memory

Rows:

- `EI-point.zip :: EI-point/bots/cyrene/src/commands/ask.ts :: ask@5`
- `EI-point.zip :: EI-point/bots/cyrene/src/commands/cyrene.ts :: cyrene@5`
- `EI-point.zip :: EI-point/bots/cyrene/src/commands/model.ts :: model@17`
- `EI-point.zip :: EI-point/bots/cyrene/src/commands/reset.ts :: reset@9`

The approved surface invokes chat by tagging Cyrene (mention handler in `apps/bots/ai/src/index.ts`); the
orphaned `/ask`-family definitions in `apps/bots/ai/src/commands.ts` are intentionally unregistered.
Provider/model selection moved to the dashboard AI module fields (`cyreneModel`, `assistantModel`) in the
control contract. Conversation memory is bounded by caps and persisted summaries in
`@ei-point/module-ai`; there is no user-facing reset.

Evidence: `packages/modules/ai/src/index.test.ts` "uses primary, falls back on failure", "returns
persisted summary and bounds extractive memory"; `tests/ai/database.test.mjs` "concurrent requests reserve
budget before providers and only one fits"; `apps/api/src/control-routes.test.ts` "community
configuration maps every supported field and preserves unsupported settings as pending".

### C2. Niko-Robin `/search` → replaced by the gated Cyrene `/search`

Rows: `EI-point.zip :: EI-point/bots/niko-robin/src/commands/search.ts :: search@5`

The legacy AI search assistant (provider-backed answers) is retired. The approved surface keeps a Cyrene
`/search` command; per the owner decision of 2026-10-16 the AI model answers the question directly (no
external/web search source is wired), sharing the mention conversation memory, daily token budget and
provider router.

Evidence: `apps/bots/ai/src/tts.test.ts` "replies with the search answer and passes the query through
unchanged" and "asks for a question instead of calling the AI for an empty query";
`tests/ai/database.test.mjs` "Cyrene /search answers through the AI conversation contract, not a stub" and
"Cyrene /search reports an honest unavailable state and records nothing".

## D. EI-point — SilverWolf game surface

The approved surface is `/rank`, `/cards`, `/inventory`, `/balance`, `/packs`, `/open`, `/buy`, `/sell`,
`/market`, `/trade` (enforced by the allowlist in `apps/bots/community/src/index.ts`). The following
legacy commands are retired from the public surface; the game engine and data model remain internal where
needed by the approved flows and migrations.

### D1. `cardadmin` (+`issue`, `revoke`) → internal-only operations

Rows: `EI-point.zip :: EI-point/bots/luffy/src/commands/cardadmin.ts :: cardadmin@25`, `issue@29`,
`revoke@48`

Card administration stays reachable only through permitted internal paths (defined but unregistered; the
runtime still enforces its command permissions).

Evidence: `tests/runtime/dispatch.test.mjs` "community settings and card administration require their
command permissions before work"; `tests/phase6/database.test.mjs` "finite supply issuance under
concurrency never duplicates serials".

### D2. `cardinfo`, `cardstats`, `trades` → folded into `/cards` and `/trade`

Rows: `EI-point.zip :: EI-point/bots/luffy/src/commands/cardinfo.ts :: cardinfo@14`;
`.../cardstats.ts :: cardstats@16`; `.../trades.ts :: trades@9`

Instance inspection is preserved through `/cards`; pending offers are handled through `/trade
accept|cancel` (the separate list command is retired).

Evidence: `tests/phase6/database.test.mjs` "card inspection stays within the guild and the legacy
five-card game persists concurrent rounds"; "concurrent trade acceptance settles once with atomic card and
currency exchange".

### D3. `deck`, `hand`, `play`, `score` → five-card game commands retired

Rows: `EI-point.zip :: EI-point/bots/luffy/src/commands/deck.ts :: deck@6`; `.../hand.ts :: hand@6`;
`.../play.ts :: play@6`; `.../score.ts :: score@5`

The casino five-card draw surface is retired. The engine and persisted rounds remain for safe persistence
and migration (the legacy game state must keep loading).

Evidence: `packages/modules/games/src/index.test.ts` "creates a unique 52-card deck and deals two
five-card hands", "evaluates a wheel straight flush and resolves tiebreakers";
`tests/phase6/database.test.mjs` "card inspection stays within the guild and the legacy five-card game
persists concurrent rounds".

## E. EI-point — Sanji logging

### E1. `logconfig`, `setlogchannel` → replaced by dashboard logging configuration

Rows: `EI-point.zip :: EI-point/bots/sanji/src/commands/logconfig.ts :: logconfig@17`;
`.../setlogchannel.ts :: setlogchannel@8`

The logging module's channel and six category toggles are dashboard-managed fields
(`log_channel`, `events.*` in `apps/api/src/control-routes.ts` MODULE_FIELDS). The logging streams
themselves are fixed and validated.

Evidence: `apps/api/src/control-routes.test.ts` "community configuration maps every supported field and
preserves unsupported settings as pending"; `packages/modules/logging/src/index.test.ts` "accepts only
known streams".

### E2. `message`, `other` log lookups → replaced by durable outbox events and `/cases`

Rows: `EI-point.zip :: EI-point/bots/sanji/src/commands/message.ts :: message@11`, `logs@16`;
`.../other.ts :: other@11`, `logs@16`

Interactive log queries are retired. Audit events are recorded durably (redacted) to `ops.outbox` by the
Kafka gateway; moderation history is queried through `/cases`.

Evidence: `packages/modules/logging/src/index.test.ts` "builds outbox-shaped events with redacted
detail"; `tests/phase6/database.test.mjs` "outbox delivery persists success and does not redeliver
completed notifications".

## F. EI-point — Shanks moderation

### F1. `automode`, AutoMod execution mirroring → replaced by dashboard AutoMod fields

Rows: `EI-point.zip :: EI-point/bots/shanks/src/commands/automode.ts :: automode@8`, `log@12`;
`.../shanks/src/index.ts :: AutoModerationActionExecution@28`

AutoMod logging channel/warnings are moderation-module dashboard fields (`automod_log_channel`,
`automod_warnings`); Discord runs AutoMod natively and the bot consumer/mirror command is retired.

Evidence: `apps/api/src/control-routes.test.ts` "community configuration maps every supported field and
preserves unsupported settings as pending".

### F2. `modrole` → replaced by the command-permission model

Rows: `EI-point.zip :: EI-point/bots/shanks/src/commands/modrole.ts :: modrole@7`

Role gating is derived from Discord permissions plus dashboard-configured per-command role lists, enforced
in the runtime admission path (`@ei-point/flow` controls). A per-guild modrole write command is retired.

Evidence: `tests/controls/database.test.mjs` "actual runtime honors guild pause, bot disable and command
roles"; `tests/runtime/dispatch.test.mjs` "paused or role-restricted command never reaches side effects".

### F3. `purge members`, `purge bots` → retired variants of message purge

Rows: `EI-point.zip :: EI-point/bots/shanks/src/commands/purge.ts :: members@30`, `bots@40`

`/purge` keeps the bulk message-delete behavior (root and `messages` rows are verified). Removing members
by role and the bots-only filter are retired; member removal is per-member through `/kick`.

Evidence: `packages/modules/moderation/src/index.test.ts` "plans bulk within limits".

## G. EI-point — Zoro security

### G1. `antinuke enable|disable` → always-on enforcement + dashboard security config

Rows: `EI-point.zip :: EI-point/bots/zoro/src/commands/antinuke.ts :: antinuke@8`, `enable@13`,
`disable@25`

Antinuke runs always-on in the Kafka gateway guard; posture is surfaced by `/security status` and the
module's thresholds/modes are dashboard security fields (`enabled`, `alert_channel`, thresholds,
`punishment`, `trustMode`, ...). The enable/disable commands are retired.

Evidence: `packages/modules/security/src/index.test.ts` "flags threshold joins inside the window", "bands
map to the right actions"; `apps/api/src/control-routes.test.ts`.

### G2. `scan` → replaced by the `/security status` posture readout

Rows: `EI-point.zip :: EI-point/bots/zoro/src/commands/scan.ts :: scan@14`

The deep progress-driven scan is retired; operators read current posture from `/security status`
(lockdown state, whitelist, incidents). Dangerous-role/webhook deep-dive facets are not carried and are
covered by the dashboard security configuration fields.

Evidence: `apps/bots/security/src/commands.test.ts`.

### G3. `slm status|test` → replaced by dashboard classifier config

Rows: `EI-point.zip :: EI-point/bots/zoro/src/commands/slm.ts :: slm@12`, `status@15`, `test@17`

SLM classifier controls are dashboard-managed fields (`automodSlm`, `slmThreshold`); no slash control
exists.

Evidence: `apps/api/src/control-routes.test.ts`.

### G4. `threat config`, `threat` root → replaced by dashboard threshold fields

Rows: `EI-point.zip :: EI-point/bots/zoro/src/commands/threat.ts :: threat@9`, `config@12`

Thresholds, windows, punishment and trust mode are dashboard security fields
(`banThreshold`, `channelThreshold`, `roleThreshold`, `windowSeconds`, `punishment`, `trustMode`).
`/security trust` and `/security lockdown` remain for per-user/state operations (verified rows).

Evidence: `packages/modules/security/src/index.test.ts` "bands map to the right actions";
`apps/api/src/control-routes.test.ts`.

### G5. `zoro preset|enable|disable` → replaced by dashboard security config

Rows: `EI-point.zip :: EI-point/bots/zoro/src/commands/zoro.ts :: zoro@59` (root), `preset@64`,
`enable@79`, `disable@80`

Named presets are replaced by individual dashboard fields; module enablement is the dashboard `enabled`
field. The root command's status view is served by `/security status` (verified rows).

Evidence: `apps/api/src/control-routes.test.ts`.

## H. EI-point — Shared runtime

### H1. `bot.ts ClientReady` warmers → replaced by per-dispatch control reads

Rows: `EI-point.zip :: EI-point/packages/shared/src/bot.ts :: ClientReady@990`

The startup latency warmers (control-state cache priming, command-module preload) were tied to the retired
shared runtime. The current runtime reads control state per dispatch with admission gating and bounded
work; no startup warmer exists.

Evidence: `tests/runtime/dispatch.test.mjs` "paused or role-restricted command never reaches side
effects"; `packages/flow/src/controls.test.ts` "community configuration maps every supported field and
preserves unsupported settings as pending".

### H2. Universal `help`, `serverinfo`, `userinfo` → retired from the shared surface

Rows: `EI-point.zip :: EI-point/packages/shared/src/universal/help.ts :: help@5`;
`.../serverinfo.ts :: serverinfo@5`; `.../userinfo.ts :: userinfo@5`

The shared surface is exactly `/botinfo`, `/ping`, `/about`. Discovery and server/member detail are
Discord-native; the three commands are retired.

Evidence: `packages/modules/bot-ui/src/index.test.ts` "common command list contains the three shared
commands".

## I. EI-point — Scripts

### I1. `run-bot.mjs`, `run-dashboard.mjs`, `restore-drill.mjs` → replaced by current tooling

Rows: `EI-point.zip :: EI-point/scripts/run-bot.mjs :: data@168`, `data@169`, `exit@171`, `SIGINT@175`,
`SIGTERM@176`, `exit@177`; `EI-point.zip :: EI-point/scripts/run-dashboard.mjs :: exit@20`, `SIGINT@21`,
`SIGTERM@22`; `EI-point.zip :: EI-point/scripts/restore-drill.mjs :: error@80`, `data@89`, `end@98`,
`error@99`

The dev launcher signal/lifecycle marshalling is retired: bots and services are started by the workspace
or compose (`package.json`), and shutdown/exit handling lives in the bot bootstraps. The restore drill is
replaced by `scripts/restore-drill.sh` with `scripts/verify-backup.mjs` verification.

Evidence: `tests/operations/deploy.test.mjs` "deploy uses immutable images, stops overlapping handlers,
gates readiness and rollback preserves data"; `tests/operations/release.test.mjs` "backup verification
requires real nonempty artifacts and detects corruption or traversal".

## J. swish — Robin (music)

The approved surface is `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/shuffle`, `/loop`,
`/volume`, `/disconnect` (plus `/ping`, `/botinfo`, `/about`). Startup removes `/search`, `/nowplaying`,
`/seek`, `/autoplay`, `/claimmaster`, `/masters` from the published tree
(`apps/bots/music-py/src/main.py`, `bot.tree.remove_command` loop).

### J1. `nowplaying`, `seek`, `autoplay`, `claimmaster`, `masters`, `remove` → retired commands

Rows: `swish.zip :: swish/bot/cogs/music.py :: nowplaying@438`; `seek@503`; `autoplay@521`;
`claimmaster@533`; `masters@591`; `remove@602`; `addmaster@564`; `removemaster@577`

These commands are removed from the synced tree (the six spec-listed removals plus the retired queue
edit and master-management commands, which never reach the published surface). Queue state and gated
playback remain fully functional; DJ/Master role gating still reads the `music.permissions` table
(`check_dj_permission` in `main.py`) but assignment is an internal/ops operation.

Evidence: `apps/bots/music-py/src/main.py` (sync removal loop); `apps/bots/music-py/tests/test_queue_state.py`
"test_add_remove", "test_snapshot_round_trip"; `apps/bots/music-py/tests/test_music_service.py`
"test_queue_advancement_modes".

### J2. Search selection view + timeout → retired with `/search`

Rows: `swish.zip :: swish/bot/cogs/music.py :: timeout@59`

The interactive search picker and its expiry view are unreachable after the `/search` removal; the view
code is retained but never published.

Evidence: `apps/bots/music-py/tests/test_runtime_boundary.py`; `apps/bots/music-py/src/main.py`.

### J3. `on_error` (tree error handler) → replaced by admission gate + per-command guards

Rows: `swish.zip :: swish/bot/app.py :: error@30`

The legacy central `CommandTree.on_error` friendly-error handler is retired. The current bot gates every
interaction through `bot.tree.interaction_check` (`global_interaction_check` in `main.py`) and command
handlers respond with explicit bounded messages; unhandled exceptions surface through the client's
default error path.

Evidence: `apps/bots/music-py/src/main.py`; `apps/bots/music-py/tests/test_runtime_boundary.py`.

### J4. `voice_state_update` recovery → replaced by durable queue snapshots + lazy restore

Rows: `swish.zip :: swish/bot/app.py :: voice_state_update@207`

The event-driven recovery (keep queue on unexpected disconnect, notify, reconnect on next `/play`) is
replaced by restart-safe SQL queue snapshots and lazy restore when a guild player is created. The
interrupted-connection notification facet is not carried.

Evidence: `apps/bots/music-py/tests/test_runtime_boundary.py`
"test_sql_snapshot_roundtrip_retains_later_track"; `apps/bots/music-py/tests/test_queue_state.py`
"test_restore_clamps_bad_data".

---

## Unchanged surfaces (verified rows, evidence in the map)

For completeness, the reconciliation preserved these legacy behaviors as-is (mapped with exact test
names in each row's evidence note):

- Cipher/Hu Tao/shared command surface: `/botinfo`, `/ping`, `/about`; `/embed`; `/referral` (+link,
  status, redeem); `/orders` and `/payment` routes (`POST /api/payments/upi-qr`, `claim`,
  `GET /api/payments/status/:orderId`, `GET /` liveness → `/healthz`).
- Gateway lifecycle: `ready`/`ClientReady` (identity verification, command registration, guild
  reconciliation), `guildCreate` (leave unapproved), `interactionCreate`/`InteractionCreate` (admission,
  claims, response policy), shared `SIGTERM`/`SIGINT` bounded drain.
- Himiko: `/setwelcome`, `/setleave`, `/testwelcome` (+welcome/leave), `/xp`, `/setlevelchannel`,
  `/leaderboard`, `/rank`, welcome/leave member events, text + voice XP (XP pump over voice states),
  `/announcement`, `/embed`.
- SilverWolf: `/cards`, `/inventory`, `/rank`, `/balance`, `/packs` (legacy `/market` catalog), `/open`,
  `/buy`, `/sell` (+cancel), `/trade` (+offer/accept/cancel), `/market`.
- Kafka: `/ban`, `/unban`, `/warn` (+add/remove), `/timeout` (legacy `/mute`, `/unmute`), `/purge`
  (+messages), `/cases`, `/note`, `/kick`, `/temp`; `/security lockdown|trust|whitelist|snapshot|incidents`
  (legacy `/lockdown`, `/threat user|lockdown`, `/whitelist`, `/snapshot`, `/security log`, `/zoro status`).
- Robin: play/pause/resume/skip/stop/queue/shuffle/loop/volume/disconnect, `ready`, durable queues.
