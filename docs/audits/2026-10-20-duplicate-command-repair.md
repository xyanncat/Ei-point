# Duplicate Discord commands — diagnosis and repair

Date: 2026-10-20 (owner local). VPS clock during work: **2026-10-19T22:48–22:53Z**.
Status: **backend reconciled and live-verified; Discord UI confirmation pending owner check.**
Model services, PostgreSQL, the web stack and the benchmark report were not touched.

## Skills read

The five defaults (`verification-before-completion`, `systematic-debugging`, `deep-research`,
`ponytail`, `discord-bots`) plus `code-review`, `api-security`, `error-handling` for this task;
`release-management`, `docker-best-practices` and `runbooks` were read earlier in the same
session. No unavailable skill was claimed.

## Root cause

Five Node bots registered the **same command definitions in both scopes**:
`Routes.applicationGuildCommands(...)` inside the ready loop and
`Routes.applicationCommands(...)` for the global copy. Kafka and Himiko also re-registered
guild commands on `GuildCreate`. Discord therefore exposed two menu entries per command in the
dev guild. Robin was already correct: `bot.tree.sync()` registers globally and
`clear_commands(guild=...)` / `sync(guild=...)` clears guild copies.

The initial inventory marked every guild copy as a *mismatch* only because Discord reports
scope-only metadata differently (`dm_permission: null`, `integration_types: null` on guild
copies vs `true` / `[0,1]` globally). Those fields are now excluded from equivalence (kept in
snapshots); after normalization the duplicates were exact.

## Live inventory and plan (dry run)

Before: dev guild `1444582621417046071`; main guild `848841415940898827` → **not installed**
(HTTP 403, skipped, never mutated). Command-permission API returned **ok with no overrides**;
`default_member_permissions` matched on both scopes; **zero mismatched** commands after
normalization and **zero guild-only** commands.

| Bot | Global | Guild before | Redundant | Deleted | Guild after | Global ID changes |
|---|---:|---:|---:|---:|---:|---:|
| Cipher | 6 | 6 | 6 | 6 | 0 | 0 |
| Cyrene | 13 | 13 | 13 | 13 | 0 | 0 |
| Himiko | 11 | 11 | 11 | 11 | 0 | 0 |
| Kafka | 13 | 13 | 13 | 13 | 0 | 0 |
| Robin | 7 | 0 | 0 | 0 | 0 | 0 |
| Silver Wolf | 13 | 13 | 13 | 13 | 0 | 0 |
| **Total** | **63** | **56** | **56** | **56** | **0** | **0** |

Commands are slash + context types as registered; the same `/ping` on different bots is
intentional and was never grouped across applications. No bulk overwrite with `[]` was used.

## Durable source fix

- Removed every guild-scope command write from the five active Node bots (ready loops and
  `GuildCreate` handlers); global registration remains the single source of truth. Guild
  leave/approval logic and runtime authorization checks are unchanged.
- Added `scripts/reconcile-command-registrations.mjs` — dry-run by default, identity-guarded
  via the bot registry, snapshots definitions/permissions to
  `/root/command-snapshots/<timestamp>/` (0700), and `--apply` deletes **only** exact
  redundant guild IDs with 429/Retry-After handling. It treats 403/404 guild listings as
  “not installed”, never mutates unknown entries, and a second run plans no changes.
- Robin was left untouched (global-only already).
- Legacy `security`/`moderation` bots (disabled profiles, not running) still contain
  guild-only registration code; they are outside the active fleet and were not modified.

## Verification

- `node --test tests/operations/command-registration.test.mjs`: **7/7 pass** (exact duplicates,
  option/permission drift kept, context-menu/guild-only preserved, permission-override
  blocking, idempotent second pass, scope metadata equivalence, source policy guard).
- Builds: `bot-ai`, `bot-kafka`, `bot-commerce`, `bot-community`, `bot-himiko` → exit 0.
- Deployed revision **`b89e157`**; only the five bot images were rebuilt and recreated.
  Recreate was gated on `ai.voice_leases = 0`; Robin, models, PostgreSQL, web, api, nginx and
  workers were not restarted.
- Live REST after: each bot has its global set intact (6/13/11/13/7/13), **0 guild commands**,
  0 redundant, 0 mismatched, 0 guild-only; **0 global ID changes** across all six bots.
- Components V2 path in the running image still serializes a container (`type 17`) with a
  `File` component (`attachment://…`) and flags `32768`.
- Health: 13/13 containers healthy; model restarts 0; five bot restarts 0; 0 active voice
  leases; no error/failed lines in the five bots’ recent logs.

## Snapshots, permissions and rollback

- Before/apply snapshots: `/root/command-snapshots/2026-10-19T22-48-30-124Z` and
  `…/2026-10-19T22-52-41-209Z` (sanitized definitions, IDs, permissions; no tokens).
- No command-permission overrides existed to migrate; global `default_member_permissions`,
  NSFW flags and options are preserved. Recreating a deleted command would mint a new ID, but
  the deleted guild copies were redundant duplicates of the retained globals.
- Rollback of the source would re-introduce guild copies (not desirable); application rollback
  is unnecessary for registration data. Snapshots allow inspection, not ID-preserving restore.

## Pending

- **Discord UI**: the owner should refresh/reopen the client and confirm one entry per command
  per bot; REST is authoritative but UI caching is possible. This is the only acceptance item
  not observable by the agent.
- Main-guild registration remains not installed; legacy disabled bots unchanged.

## Per-bot status

| Bot | Status |
|---|---|
| Kafka | fixed, backend live-verified; UI check pending |
| Cyrene | fixed, backend live-verified; UI check pending |
| Robin | already correct (global-only); UI check pending |
| Cipher | fixed, backend live-verified; UI check pending |
| Silver Wolf | fixed, backend live-verified; UI check pending |
| Himiko | fixed, backend live-verified; UI check pending |

Official reference: https://docs.discord.com/developers/docs/interactions/slash-commands
(global vs guild command scope, bulk overwrite semantics).
