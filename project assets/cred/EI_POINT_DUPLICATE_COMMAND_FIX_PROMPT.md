# Ei Point: fix duplicate Discord commands after the model benchmark

Paste everything after the divider into the VPS coding agent's queue AFTER the production-safe model benchmark task.

---

@verification-before-completion @systematic-debugging @deep-research @ponytail @discord-bots

My live Ei Point bots now show duplicate copies of commands in Discord after the recent repairs. Diagnose and fix the actual registration problem across the whole configured fleet, remove only verified redundant registrations, deploy the durable fix, and verify the command menu and handlers. Execute this task only after the preceding model benchmark has finished and produced its report; never overlap a registration/deployment change with that benchmark.

This is authorization to repair command registration and reconcile the affected Discord application-command records. It is not authorization to remove intended features, delete bot applications, revoke installations, expose private commands, rotate credentials, or interrupt active voice sessions. Preserve the benchmark report and its measurements. Do not change model/runtime/CPU settings as part of this command fix.

## Skills

Read the actual available skill instructions. Resolve @mentions through this agent's skill registry; names alone are not installation or registration. If unavailable, state that fact and use an equivalent workflow without pretending a skill ran.

| Task | Skills |
|---|---|
| Discover actual duplicate entries, identities and registrars | @systematic-debugging @discord-bots |
| Verify scope/permission/update/delete semantics for installed libraries | @deep-research @discord-bots |
| Implement the smallest durable reconciliation fix | @ponytail @discord-bots @error-handling |
| Review identity, authorization, retained commands and rollback | @code-review @api-security |
| Build and deploy affected services safely | @release-management @docker-best-practices @runbooks |
| Test registrations, handlers, visibility and final result | @verification-before-completion @discord-bots |

The five default skills on the first line apply throughout. Apply additional skills only where relevant. Do not delegate to other agents unless separately authorized.

## 1. Establish the real cause before deleting anything

- Verify the current checkout/revision, deployed images, Compose project, application IDs and registered bot roster. A previous deployment used /opt/ei-point and project ei-point; verify them rather than assuming. Read applicable AGENTS.md and current product/command specifications.
- The earlier reviewed Node code registered both Routes.applicationGuildCommands(...) and Routes.applicationCommands(...) with the same command definitions. The earlier audit explicitly describes global command copies for all five Node bots. Inspect the current version: these are leads, not proof of the current UI cause.
- Inspect every registration writer: startup/ClientReady, reconnect, GuildCreate, deployment/register scripts, worker jobs, old containers/processes, and legacy services. For Robin inspect tree.sync(), copy_global_to(), clear_commands(), setup_hook/on_ready and guild decorators. A Python bot may already register globally only; do not modify it merely to make all bots identical.
- Fetch actual global and guild command lists for each verified application using its authorized credentials, and only guilds within the project's approved scope. Record command IDs, application ID, guild/scope, command type, name, description, options/subcommands, default_member_permissions, NSFW, contexts/integration types and other relevant metadata. Never print credentials or full environment/configuration dumps.
- Group duplicates by application ID + command type + name, with scope recorded separately. The same /ping on different bots is legitimate. User/message context-menu commands and slash commands can share a name legitimately. Subcommands are not duplicate root commands. Do not merge unrelated apps or command types.
- Verify whether the user is seeing actual global/guild copies, old renamed commands, two different bot applications with similar names, guild-installed versus user-installed entries, or client caching. If authoritative REST lists are already correct, do not churn/delete registrations to fix a client display issue.
- Build a per-application before table and a precise proposed keep/remove/update set. Trace every retained command to a working runtime handler. Do not register names that the deployed bot cannot handle.

Use official Discord and installed discord.js/discord.py documentation for uncertain API behavior. Do not assume global/guild overlap always produces duplicate UI entries or that a Supports Commands badge proves correctness. Reference: https://docs.discord.com/developers/docs/interactions/slash-commands

## 2. Choose a single intended registration policy

Default recommendation for this existing fleet: keep production commands globally registered and remove exact redundant guild copies, provided the global definitions are correct, supported by the running handlers, and preserve the intended permission/visibility contract. Keep genuinely guild-specific commands in their appropriate scope without redundant equivalent global copies. Do not assume every guild-specific command can safely become global.

The purpose is one intended menu entry per application/type/name in the affected context, not globally unique command names across the entire fleet.

Before choosing a scope, compare both versions' options, defaults, availability, contexts and permission restrictions. Preserve approved guild allowlists, owner/role checks, moderation/commerce restrictions, DM restrictions and application installation policy. A global command must still enforce server/role authorization in the runtime; registration scope is not authorization. Do not enable user installation or DM contexts just to remove duplicates. Keep all approved root commands, subcommands, autocomplete, context menus, localizations and handlers.

Custom guild command-permission overrides may be tied to command IDs. Do not silently discard them by deleting/recreating registrations. Preserve existing global command IDs wherever possible; inspect/reconcile override behavior before removing the guild copy. If necessary permission metadata cannot be accessed or migrated safely, leave that command untouched, name the exact blocker, and continue with independent unambiguous duplicates. Do not request broader credentials or permissions as a shortcut.

## 3. Implement durable, repeat-safe registration

- Fix the source of duplicate writes before or together with live cleanup so a reconnect, startup, old process or deployment does not recreate them.
- Reuse existing definitions/helpers and deployment mechanisms. Prefer one authoritative registrar per application and registration policy. If the project already has an explicit command deploy step, use it. If startup registration is retained for a justified reason, make all startup/GuildCreate/reconnect paths obey the same scope policy and avoid unnecessary writes.
- A dry run must show per-application scopes, expected command definitions, actual records and a bounded change plan without writing to Discord.
- Reconciliation must preserve the desired command set and target only the verified application/guild/scope. Detect identity mismatch and refuse mutation. Never remove an unknown entry solely because it was omitted from a partial command list.
- Prefer targeted deletion of verified redundant command IDs. Use bulk replacement only when the complete desired set for every affected command type is known and preserved. Never run bulk overwrite with [] as a generic reset. Discord bulk overwrite can remove other command types, not only slash commands.
- Save owner-private, sanitized snapshots of the relevant command definitions and permission metadata before changes, plus the code/release checkpoint. Document recovery limitations: recreating a deleted command may produce a new ID, so a JSON snapshot alone does not guarantee restoration of ID-bound permission overrides.
- Register/verify the retained correct definition before removing its redundant copy. Honor Discord rate limits and Retry-After through supported clients; process bots sequentially and do not run delete/recreate loops or mass clear-and-resync scripts.
- Audit duplicate runtime processes separately. Do not restart/kill an unknown process merely because two copies exist; identify its owner, token/application identity and impact before a safe correction.

## 4. Focused verification and safe rollout

Add meaningful regression checks using the existing framework and a fake REST transport where appropriate:

1. Expected commands/options/permissions remain present for each application and intended scope.
2. Reconciliation removes only exact known redundant registrations, preserving unrelated names/types/guild-specific commands.
3. Identity mismatch, a partial inventory, unavailable permission information or uncertain ownership prevents destructive cleanup.
4. The same application/type/name is not inadvertently emitted to both scopes by startup/deploy/GuildCreate paths. A second reconciliation produces no unnecessary changes.
5. Required global/server-only contexts, default permissions, allowlists and runtime role/owner checks remain effective.
6. Node and Python registration paths preserve their complete approved command surfaces.

Run relevant tests/typechecks/builds with the project's pinned tools. Inspect the actual final diff; do not treat passing mocks as proof of the live menu. Apply the targeted registration reconciliation without restarting bots if the existing process/definition permits it. If durable source deployment is required, use the existing rollback-safe workflow and affect only necessary services. Do not restart a bot with an active voice/music session; postpone that service until an idle window, keeping its status explicit. Do not rebuild/restart model services, PostgreSQL, or the whole fleet for a registration-only fix.

## 5. Live acceptance after reconciliation

- Fetch the actual global/guild command lists again and compare them with the saved before state and intended set. Verify no unintended commands disappeared and no duplicate registration is recreated by a known registrar.
- Check representative safe commands such as /ping and /botinfo per affected application and a non-destructive handler path. Do not perform real bans, payments, purchases, trades or voice join/leave actions as a command-registration test.
- Verify the Discord picker shows the intended single entry for each bot/context. If UI access is unavailable, request one precise owner check after backend verification; mark UI acceptance pending. Do not claim the UI is fixed from REST results alone. A client refresh/reopen may be needed after authoritative registrations are correct; do not repeatedly mutate Discord just to work around caching or promise an exact propagation delay.
- Confirm Components V2 responses still work and permissions are unchanged. Recheck existing service health, restart counts and any voice-session continuity.
- Do not force a restart to prove persistence while a session is active. Cover restart/reconnect registration behavior through tests and verify the next safe real lifecycle event; report any live check not performed.

## Final deliverables

Write docs/audits/<actual-date>-duplicate-command-repair.md with:

- Actual root cause and which bots/guilds/scopes were affected.
- Per-bot before/after counts by command type and scope, specific retained/deleted/updated records, and preserved special permissions.
- Changed source files and fresh test/build results.
- Deployed revision/images or explicit pending deployment status; no inference from a local checkout.
- Live REST results, Discord UI result/pending owner check, current health/session observations, rollback details and remaining blockers.
- Skills actually loaded and official sources used.

Finish with a concise per-bot status: fixed and live-verified / backend reconciled but UI verification pending / source ready but waiting for an idle deployment window / blocked with a precise reason. Do not claim every bot is fixed while one remains unverified. Leave the project running, do not touch model tuning, and do not overwrite the preceding benchmark report.
