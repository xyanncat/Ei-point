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
8. **Phase 3 runtime cutover — local models become optional (this round).** One rule, `localModelServices()` in
   `scripts/lib/operations.mjs`, maps `TTS_PROVIDER`/`TRANSLATION_PROVIDER` to whether `tts`/`hy-mt2` belong to the
   runtime. It drives the release manifest (a manifest without the model images now validates from the environment
   alone, and the model client URLs are wired only when the image is present), the deploy script (models are pulled
   and started only while local), the roster and fleet health check (the `hy-mt2` probe disappears with the release),
   and the resource budget (the rendered stack is filtered to the release roster, so a hosted release is checked at
   **20.5 GiB / 8 448 shares** instead of the local 28.5 GiB / 14 592 shares — arithmetic, not measured RAM).
   `bot-ai` no longer hard-depends on `tts`/`hy-mt2` in Compose; deploy still starts models before bots when they are
   local. The resource checker also reads `RESOURCE_CPU_CEILING` / `RESOURCE_MEMORY_CEILING_GIB` from the environment
   and fails closed when the CPU ceiling disagrees with `infra/systemd/ei-point.slice`, so the §12 host decision is a
   configuration change, not a code change. Runbook: `docs/operations/remote-ai-cutover.md`.

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

## Explicitly deferred (operator gates, per plan phases 0/3/4/6)

- Google billing/project provisioning and API enablement (`texttospeech.googleapis.com`,
  `translation.googleapis.com`); learner/quota verification.
- Release roster, manifest, validator and health-check changes that remove `tts`/`hy-mt2` from the normal production
  path — only after remote adapters pass a live/staging check (phase 3 gate). Until then the roster stays as-is and
  every default keeps today's behaviour.
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
