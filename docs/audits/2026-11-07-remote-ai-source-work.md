# Remote AI + media redesign — source-complete audit note

**Date:** 2026-11-07. **Branch:** `main` (also synced to `feat/completion-plan`). **Base revision:** `7208077`.
**Plan:** `project assets/cred/redesign infrastructure.md` (phases 1–2 source side, phase 3 partial).
**Supersedes:** nothing; extends the 2026-10-17 audit record. Related: ops suites (`tests/operations/*`) unchanged.

## What this session deployed

**Nothing was deployed.** This checkout is a Windows workstation with no Docker, no VPS access and no Google billing
project reachable. Per the plan's operator-gate section, every deployment, provisioning and acceptance step stays with
the account owners. There is no deployed revision, image ID or health status to record for this round beyond
**source-complete, verified by tests in the table below**.

## What changed (source only)

1. **Media delivery out of the app container (phase 1).** `apps/dashboard/components/media.ts` is now the single
   manifest for posters/film/audio with `NEXT_PUBLIC_MEDIA_BASE_URL` / `MEDIA_BASE_PATH` knobs (unset = today's
   same-origin `/media/...`). Still mode (reduced motion or data saver) attaches no `<source>`/no audio `src` at all,
   so the browser makes zero media requests; a film load error falls back to the poster instead of a black frame.
2. **Remote AI providers as first-class adapters (phase 2).** Local models stay the default; selecting a provider is
   configuration only: `TTS_PROVIDER=google|openai` (`GOOGLE_TTS_API_KEY`, `TTS_PROVIDER_URL/KEY`),
   `TRANSLATION_PROVIDER=google` (`GOOGLE_TRANSLATE_API_KEY`), neither requires a code change or a model image.
   Unconfigured/unknown providers fail closed with typed errors; no silent local fallback. Every remote response is
   size-bounded (8 MiB audio / 64 KiB translation), 429/5xx get one abortable retry, and a tiny per-provider failure
   gate stops hammering an outage.
3. **Deadlines cover queue wait (§6).** TTS/translation/chat now derive each caller's remaining budget from its
   enqueue time; a caller that already spent its budget gets a fast typed failure, and its freed slot is passed to the
   next waiter. The chat router's budget is shared across primary+fallback instead of a fresh `deadlineMs/2` per
   attempt (which could total ≈3× the stated window when queued).
4. **Compose/.env hygiene.** Dead `TTS_PROVIDER_NAME` removed; the real provider variables are wired to bot-ai;
   `.env.example` gained the missing `GOOGLE_TTS_API_KEY=` line; docs describe exactly one auth path.
5. **PostgreSQL daily character budgets for speech + translation (§6, second pass).** Chat already reserved tokens
   atomically (`ai.budget_reservations` + advisory locks); speech and translation had *no* accounting at all. Now both
   reserve characters under the same lock key before spending, settle what was actually spoken/translated, release on
   failure, and refuse across per-guild+user and global daily ceilings (`TTS_DAILY_BUDGET_CHARS[_GLOBAL]`,
   `TRANSLATION_DAILY_BUDGET_CHARS[_GLOBAL]`; defaults 30k/300k and 25k/250k chars). Cost units stay scoped per
   capability: `ai.usage_ledger.units` (new column) against `provider = tts:…/translate:…` prefixes, and
   `ai.budget_reservations.kind` (`chat|tts|translate`) keeps voice holds from crowding chat tokens. Voice-chat
   messages reserve the whole message at admission (never cut off mid-play; unused tail refunds on settle) and
   `/usage` now shows voice + translation character totals. Migration: `infra/postgres/migrations/021_ai_cost_units.sql`.
   **Committed as `874c302` and pushed to `origin/main` + `origin/feat/completion-plan` (verified via `git ls-remote`).**
6. **Hosted free-tier providers: Groq chat + OpenRouter speech (operator direction, 2026-11-07).** Chat runs on
   Groq's `openai/gpt-oss-20b`; speech runs on OpenRouter's `fish-audio/s2.1-pro-free:free`, rotating to
   `heygen/heygen-voice-1-turbo:free` and `hexgrad/kokoro-82m` when a model is rate limited. The adapter targets
   OpenRouter's dedicated OpenAI-compatible `/api/v1/audio/speech` endpoint (raw audio bytes). A 429 cools one model
   and rotates; a non-rate-limit rejection is never rotated, so a bad voice fails loudly instead of silently changing
   voice. **Voice cloning is implemented behind `TTS_PROVIDER_REFERENCE_AUDIO_PATH` and is off by default** — unset,
   no private reference audio leaves the host. Groq reasoning models get a larger completion ceiling and one retry
   with `max_completion_tokens`; chain-of-thought is never returned as the reply.
7. **Off-host backups on Google Drive.** `RESTIC_REPOSITORY` now accepts `rclone:*` (restic's supported path to
   Drive — restic has no native Drive backend). The script requires the `rclone` binary and an explicit
   `RCLONE_CONFIG`, and fails closed without them. restic encrypts and deduplicates before upload, so the 5 TB Drive
   account holds ciphertext only; native `gs:`/`s3:`/`b2:`/`azure:`/`sftp:`/`rest:` remain supported.
   **Committed as `e4579bf` and pushed to `origin/main` + `origin/feat/completion-plan` (verified via `git ls-remote`).**
8. **Phase 3 runtime cutover — local TTS becomes optional (round 3; the Hy-MT2 half was superseded by item 9).** One
   rule, `localModelServices()` in `scripts/lib/operations.mjs`, maps `TTS_PROVIDER` to whether `tts` belongs to the
   runtime. It drives the release manifest (a manifest without the TTS image validates from the environment alone, and
   the TTS client URL is wired only when the image is present), the deploy script (TTS is pulled and started only
   while local), the roster and fleet health check, and the resource budget (the rendered stack is filtered to the
   release roster, so a hosted release is checked at **20.5 GiB / 8 448 shares** instead of the local
   24.5 GiB / 12 544 shares — arithmetic, not measured RAM). `bot-ai` no longer hard-depends on `tts` in Compose;
   deploy still starts it before the bots when it is local. The resource checker also reads
   `RESOURCE_CPU_CEILING` / `RESOURCE_MEMORY_CEILING_GIB` and fails closed when the CPU ceiling disagrees with
   `infra/systemd/ei-point.slice`, so the §12 host decision is a configuration change, not a code change.
   Runbook: `docs/operations/remote-ai-cutover.md`.
9. **Hy-MT2 removed (2026-11-09).** Translation no longer runs a local model. The `hy-mt2` Compose service, its
   Dockerfile/start script, model-preparation script and requirements, operations guide and model-integrity test are
   deleted; the bot-ai environment, translation network, release roster, resource budget, durable-asset inventory and
   docs no longer reference it. `/translate` now uses the configured OpenAI-compatible chat provider by default
   (`TRANSLATION_PROVIDER` unset/`chat`; the URL/key/model already configured for Groq) with the Google Cloud
   Translation adapter still available as `google`; `local` is accepted only as a legacy alias. Pre-removal release
   manifests that still carry the `hy-mt2` image remain valid so `rollback.sh` can restore the old translation
   runtime — the removed service is an optional legacy key, never required by a new release.
   **Committed as `d56a42f` and pushed to `origin/main` + `origin/feat/completion-plan` (verified via `git ls-remote`).**
10. **Free-tier pivot, P0a: translation removed entirely; MIT licence (2026-11-09).** Per the owner's new architecture
    (no VPS, Render free bots, phone-hosted Piper TTS, Vercel web, Neon data, Drive storage), translation is gone:
    the `/translate` command, queue/adapters/tests, Google language map, translation budget caps and usage row,
    env vars and every current doc reference are deleted. The `ai.budget_reservations.kind` DB constraint keeps the
    historical `'translate'` value so old rows remain valid; no new translation rows are written. The repository now
    carries the MIT licence (`LICENSE`, "Ei Point contributors"). Deferred to the next phases: Pocket TTS removal
    (P0b), the Neon/Drive data layer (P1), Render/Vercel runtime artifacts and VPS-layer retirement (P2–P3).
    **Committed as `e72046f` and pushed to `origin/main` + `origin/feat/completion-plan` (verified via `git ls-remote`).**
11. **P1 — Neon data layer and Drive backups (2026-11-09).** The live database moves to Neon free Postgres; Drive is
    the durable store only (no locking, so it cannot host the database). Every 5-second `ops.service_status`
    heartbeat is removed from the five active bots — those writes kept a scale-to-zero database permanently awake
    and would exhaust the 100 CU-hour allowance. `/health/live` (process only) is the Render probe; `/health/ready`
    now performs an on-demand `SELECT 1`; every bot honours Render's `PORT`. Background pumps are adaptive (5 s only
    for two minutes after Discord activity, then a 15-minute floor) for commerce notifications, himiko's community
    pump, community maintenance and kafka maintenance; himiko's voice-XP loop skips the database entirely when no
    one is in voice; the worker poll default is 15 minutes and uses a pool instead of a `LISTEN` client (Neon drops
    idle sessions); API commerce maintenance is 15 minutes. A nightly GitHub Actions workflow dumps Neon and pushes
    an encrypted restic snapshot to Drive (`rclone:drive:ei-point/backups`, 7 daily / 4 weekly, manual one-time
    init). Docs: `docs/operations/neon.md`, `docs/operations/drive-backups.md`; env knobs in `.env.example`.
    Verification: new `tests/runtime/lightweight.test.mjs` 5/5 (no heartbeat, liveness/PORT, slow worker, backup
    workflow), ops 31/31, feature coverage 179 rows, full suite 118/118 with the resource budget unchanged
    (`12 544 shares / 24.5 GiB`).
    **Committed as `4c5156c` and pushed to `origin/main` + `origin/feat/completion-plan` (verified via `git ls-remote`).**
12. **P2 — Render/Vercel runtime (2026-11-09).** The API now honours Render's `PORT`; the API image also builds and
    ships the worker and a combined `infra/render/start-api.sh`, because one free workspace allows exactly one
    always-on service (API + worker share it; `dockerCommand` in the blueprint). Render Blueprints for the four
    Render bots (`bot-kafka`, `bot-himiko`, `bot-community`, `bot-commerce`) and the API use `plan: free`, the
    process-only `/health/live` (`/healthz` for the API), 384 MB Node heap, and the adaptive pacing variables.
    `music-py` honours `PORT` for a Render/phone benchmark. A manual `migrate-database` workflow runs migrations
    against `MIGRATION_DATABASE_URL` (Render free has no shell). New docs: `docs/operations/render-vercel.md` and
    `docs/operations/phone-hosting.md` (Termux, wake lock, Piper bridge contract, Robin benchmark). Verification:
    lightweight invariants 6/6, Render YAML parses, typecheck clean; full suite below.
    **Committed as `4d90fa3` and pushed to `origin/main` + `origin/feat/completion-plan` (verified via `git ls-remote`).**
13. **P3 — VPS layer retired; Pocket runtime removed (2026-11-09).** Deleted: `infra/docker` (Compose + prod overlay),
    `infra/nginx`, `infra/systemd`, the entire host backup layer (`infra/backup`: pgBackRest, restic host scripts,
    durable-assets inventory, drills), the capacity benchmark, fifteen VPS-only scripts (deploy, rollback, release
    manifest/roster, health-fleet, resource budget, backup verification, ops report, watchdog helpers, model
    provisioning/diagnostics), five VPS-only tests, and six obsolete runbooks. The Pocket TTS service directory and
    every `POCKET_TTS_*` / reference-clip variable are gone; the local TTS adapter now reports `local-tts` and keeps
    the `{text,voice,format}` → WAV contract for the phone's Piper bridge. CI still builds every Render image (no
    Compose), and the legacy feature map was remapped (29 rows) so all **179 rows** still resolve. Root test chain
    drops the backup/resource-budget steps. Verification: feature coverage structural 179, kept operations tests
    21/21, bot-ai 50/50, `-r typecheck` clean; full suite **58/58** (final gate) with zero failures.
    **Committed as `53522fa` and pushed to `origin/main` + `origin/feat/completion-plan` (verified via `git ls-remote`).**
14. **OpenRouter TTS removed (2026-11-09, owner decision).** The OpenRouter speech adapter, model rotation, voice/
    instructions/reference-cloning options and their tests and env vars are deleted. TTS now runs on the local
    Piper bridge (default, `TTS_PROVIDER=local` → `{text,voice,format}` WAV on the phone) or the Google /
    OpenAI-compatible adapters. Chat remains on Groq; translation is already removed. A deployment that still sets
    `TTS_PROVIDER=openrouter` fails closed with `TTS_UNCONFIGURED` rather than silently using another provider.
    Verification: bot-ai typecheck clean and 41/41 tests (the 9 OpenRouter tests removed); full suite **58/58**.
    **Committed as `80e182c` and pushed to `origin/main` + `origin/feat/completion-plan` (verified via `git ls-remote`).**
15. **Phone TTS wiring made explicit (2026-11-09).** Cyrene and the Piper bridge share the self-hosted device, so the
    bot connects over loopback (`TTS_PROVIDER=local` → `http://127.0.0.1:3120/v1/audio/speech`); the Render API never
    proxies speech. Added `infra/phone/cyrene.env.example` (untracked-secret template: bot token, Neon URL, Groq,
    TTS, persona path, pacing) and a phone-hosting "Wiring" section covering the move to a second device (LAN
    address + TCP 3120). The old compose hostname fixture was replaced with loopback, and a regression test asserts
    the default local endpoint and `{text,voice,format}` body; the structural guard also checks the phone template.
    **Committed as `6c262c2` and pushed to `origin/main` + `origin/feat/completion-plan` (verified via `git ls-remote`); full suite 59/59.**
16. **Persona environment variable mismatch fixed (2026-11-09, found while deploying to the phone).** The bot reads
    `CYRENE_PERSONA_MEMORY_PATH`, but `.env.example`, the phone template and the README used
    `CYRENE_PERSONA_MEMORY_FILE`, so a phone deployment would silently fall back to `.models/…` and fail at startup.
    The phone template now points at the Termux home
    (`/data/data/com.termux/files/home/cyrene/Cyrene_Chat_Roleplay_Memory.md`), the other files use `_PATH`, and the
    structural test forbids the stale `_FILE` name.
17. **Phone deployment executed and verified (2026-11-09).** Redmi 10 Prime (Android 13, arm64, 6 GB RAM, Termux
    0.118.3) over authorized ADB. Installed ffmpeg 9.0.2, bootstrapped pnpm 9.12 through Termux's Node (Android has
    no `/usr/bin/env`), cloned the repo, and built the bot graph on-device with `tsc` (95 packages, build order
    contracts → flow → modules → bot). Copied the private persona to `~/cyrene/` with a matching SHA-256
    (`ac17ed4d…`), wrote a Termux:Boot service with explicit `HOME`/`PREFIX`/`PATH`/`LD_LIBRARY_PATH`, and
    whitelisted `com.termux` from battery optimization. Smoke run loads every module and stops exactly at the missing
    `BOT_TOKEN`/`GUILD_ALLOWLIST` check. **No secrets were written to the device**; the bot awaits the operator's
    Discord token, Neon URL, Groq key, guild IDs, and the Piper bridge on `127.0.0.1:3120`.

## Verified locally (fresh runs on this revision)

| Check | Result |
|---|---|
| `corepack pnpm --filter @ei-point/bot-ai test` | 42 passed / 0 failed (includes new provider-selection suite) |
| `corepack pnpm --filter @ei-point/module-tts test` | 19 passed / 0 failed |
| `corepack pnpm --filter @ei-point/module-ai test` | 13 passed / 0 failed (includes queue-wait regression) |
| `node --test tests/operations/release.test.mjs tests/operations/resource-budget.test.mjs` | 21 passed / 0 failed |
| `node scripts/check-feature-coverage.mjs` | structural exit 0; 179 rows |
| `corepack pnpm -r typecheck` for bot-ai/module-tts/module-ai + dashboard | clean |

Second pass (character budgets) — fresh runs:

| Check | Result |
|---|---|
| `corepack pnpm --filter @ei-point/bot-ai test` | 54 passed / 0 failed (adds budget admission + command-level suites) |
| `corepack pnpm --filter @ei-point/module-ai test` | 13 passed / 0 failed |
| `node --test tests/ai/database.test.mjs` (embedded Postgres, applies all migrations incl. 021) | 10 passed / 0 failed |
| `node --test tests/operations/*.test.mjs` + `node scripts/check-resource-budget.mjs` | 63 passed / 0 failed; budget ok (unchanged arithmetic) |

Third pass (hosted providers + Drive backup) — fresh runs:

| Check | Result |
|---|---|
| `corepack pnpm --filter @ei-point/bot-ai test` | 63 passed / 0 failed (9 new OpenRouter speech tests) |
| `corepack pnpm --filter @ei-point/module-ai test` | 17 passed / 0 failed (4 new Groq reasoning-model tests) |
| `node --test infra/backup/durable-assets.test.mjs` | 9 passed / 0 failed (rclone/Drive path asserted) |
| `corepack pnpm --filter @ei-point/bot-ai typecheck` + `--filter @ei-point/module-ai build` | clean |
| `corepack pnpm test` (full repo chain: every package suite, phase 4/phase 6 gates, controls DB, AI/workers/operations/runtime/moderation/backup suites, resource budget) | passed end to end — final gate: 113 passed / 0 failed; `Resource budget ok (pool mode)` |
| `bash -n infra/backup/restic-backup.sh` + live run with `RESTIC_REPOSITORY=rclone:drive:…` | syntax ok; fails closed with `rclone is required for an rclone: repository` (binary absent); `gs:` still accepted by the allowlist |

Fourth pass (phase 3 runtime cutover) — fresh runs:

| Check | Result |
|---|---|
| `node --test tests/operations/*.test.mjs` | 71 passed / 0 failed (provider-aware roster/manifest/health, roster-filtered budget, remote deploy with mocked Docker, slice-quota coherence) |
| `bash -n scripts/deploy.sh` | syntax ok |
| `node scripts/check-resource-budget.mjs` | ok at 9 CPU / 28.5 GiB; `RESOURCE_CPU_CEILING=8` correctly fails against the unchanged `CPUQuota=900%` slice |

Fifth pass (Hy-MT2 removal) — fresh runs:

| Check | Result |
|---|---|
| `corepack pnpm --filter @ei-point/bot-ai typecheck` + `test` | clean; 65 passed / 0 failed (translation-via-chat tests, legacy provider fail-closed) |
| `node --test tests/operations/release.test.mjs tests/operations/resource-budget.test.mjs` | 30 passed / 0 failed (roster without Hy-MT2, legacy manifest accepted, 24.5 GiB local / 20.5 GiB hosted) |
| `node --test tests/operations/deploy.test.mjs` | 1 passed / 0 failed (local and hosted deploys, legacy rollback) |
| `node --test infra/backup/durable-assets.test.mjs` | 9 passed / 0 failed (single reprovisionable Pocket asset) |
| `node scripts/check-feature-coverage.mjs` | structural exit 0; 179 rows still map to existing targets and tests |
| full `corepack pnpm test` chain | passed end to end — final gate 113 passed / 0 failed; `Resource budget ok (pool mode): 12544 shares / 24.5 GiB; concurrent 25.75 GiB` |

Sixth pass (P0a translation removal + MIT) — fresh runs:

| Check | Result |
|---|---|
| `corepack pnpm --filter @ei-point/bot-ai typecheck` + `test` | clean; 50 passed / 0 failed |
| ops release/budget/deploy | 31 passed / 0 failed |
| durable-assets | 9 passed / 0 failed |
| `node scripts/check-feature-coverage.mjs` | structural exit 0; 179 rows |
| full `corepack pnpm test` chain | passed end to end — final gate 113 passed / 0 failed; `Resource budget ok (pool mode): 12544 shares / 24.5 GiB` |

Seventh pass (P1 Neon/Drive) — fresh runs:

| Check | Result |
|---|---|
| `corepack pnpm -r typecheck` | all packages and apps clean |
| `node --test tests/runtime/lightweight.test.mjs` | 5 passed / 0 failed (no heartbeat, `/health/live` + `PORT`, slow worker pool, slow commerce maintenance, backup workflow) |
| `node --test tests/operations/*.test.mjs` | 31 passed / 0 failed |
| `node scripts/check-feature-coverage.mjs` | structural exit 0; 179 rows |
| full `corepack pnpm test` chain | passed end to end — final gate 118 passed / 0 failed; `Resource budget ok (pool mode): 12544 shares / 24.5 GiB` |

Eighth pass (P2 Render/Vercel) — fresh runs:

| Check | Result |
|---|---|
| `node --test tests/runtime/lightweight.test.mjs` | 6 passed / 0 failed (adds Render template + API PORT invariants) |
| `python -c "yaml.safe_load(...)"` over `infra/render/*.yaml` | all templates parse |
| `corepack pnpm -r typecheck` | clean |
| full `corepack pnpm test` chain | passed end to end — final gate 119 passed / 0 failed; `Resource budget ok (pool mode)` |

Ninth pass (P3 VPS retirement) — fresh runs:

| Check | Result |
|---|---|
| `node scripts/check-feature-coverage.mjs` | structural exit 0; 179 rows after remapping |
| `node --test tests/operations/*.test.mjs tests/runtime/*.test.mjs` | 38 passed / 0 failed |
| `corepack pnpm --filter @ei-point/bot-ai test` | 50 passed / 0 failed |
| `corepack pnpm -r typecheck` | exit 0 |
| full `corepack pnpm test` chain | passed end to end — final gate 58 passed / 0 failed |

## Explicitly deferred (operator gates, per plan phases 0/3/4/6)

- Google billing/project provisioning and API enablement (`texttospeech.googleapis.com`,
  `translation.googleapis.com`); learner/quota verification.
- Release roster, manifest, validator and health-check changes are in place: `hy-mt2` is removed entirely, and `tts`
  stays optional while a hosted TTS provider is configured. The live provider acceptance still gates the production
  cutover.
- 9-CPU pool arithmetic in `check-resource-budget.mjs` and the 8 GiB envelope — pending the §12 host-size decisions
  before provisioning (treated as targets, not measured results).
- VPS checkout sync at `/opt/ei-point`, rebuild/redeploy of affected services, and the live Discord acceptance pass —
  none executable from this checkout.
- §6's optional private TTL cache for repeated identical speech/translation: `ttsCacheKey()` is computed but nothing
  stores results yet. Deferred as low-value for the current per-guild traffic; revisit if provider bills spike.

Operator steps this round (source is ready; the checkout cannot perform them):

1. **Groq chat** — create a key, then set `AI_PROVIDER_PRIMARY=https://api.groq.com/openai/v1/chat/completions`,
   `AI_PROVIDER_PRIMARY_MODEL=openai/gpt-oss-20b`, `AI_PROVIDER_PRIMARY_KEY=<key>`. A free OpenRouter chat model as
   `AI_PROVIDER_FALLBACK` keeps the existing primary→fallback router useful.
2. **OpenRouter speech** — set `TTS_PROVIDER=openrouter`, `OPENROUTER_API_KEY=<key>` and (optionally) the rotation
   list `TTS_PROVIDER_MODELS`. Leave `TTS_PROVIDER_REFERENCE_AUDIO_PATH` empty unless voice cloning is wanted; if it
   is set, mount that file read-only into the bot-ai container.
3. **Google Drive off-host backups** — on the backup host run `rclone config` (remote `drive`, dedicated account),
   set `RESTIC_REPOSITORY=rclone:drive:eipoint-backup` and `RCLONE_CONFIG`, then `restic init` and `restic snapshots`
   before enabling the timer.
4. **GCS media** — create the bucket, upload the film/audio/posters, set `NEXT_PUBLIC_MEDIA_BASE_URL`, verify the
   URLs, and only then exclude the originals from the Docker context (phase-1 close-out).

## Secrets

Commits for this work were scanned for secret-shaped strings; only placeholder variables (empty defaults, fake test
keys inside unit tests) exist. No `.env`, tokens, model weights or private reference audio were committed; the
persona/reference-audio files in `project assets/cred/` remain local-only working copies outside these commits.
