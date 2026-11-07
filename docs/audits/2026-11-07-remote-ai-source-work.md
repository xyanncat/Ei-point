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

## Verified locally (fresh runs on this revision)

| Check | Result |
|---|---|
| `corepack pnpm --filter @ei-point/bot-ai test` | 42 passed / 0 failed (includes new provider-selection suite) |
| `corepack pnpm --filter @ei-point/module-tts test` | 19 passed / 0 failed |
| `corepack pnpm --filter @ei-point/module-ai test` | 13 passed / 0 failed (includes queue-wait regression) |
| `node --test tests/operations/release.test.mjs tests/operations/resource-budget.test.mjs` | 21 passed / 0 failed |
| `node scripts/check-feature-coverage.mjs` | structural exit 0; 179 rows |
| `corepack pnpm -r typecheck` for bot-ai/module-tts/module-ai + dashboard | clean |

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

## Secrets

Commits for this work were scanned for secret-shaped strings; only placeholder variables (empty defaults, fake test
keys inside unit tests) exist. No `.env`, tokens, model weights or private reference audio were committed; the
persona/reference-audio files in `project assets/cred/` remain local-only working copies outside these commits.
