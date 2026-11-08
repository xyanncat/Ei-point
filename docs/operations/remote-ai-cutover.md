# Remote AI cutover: removing local models from the normal runtime

Phase 3 of `project assets/cred/redesign infrastructure.md`. The goal is that no
local model process runs or downloads in normal production while all six
identities and voice playback stay intact. Until the operator sets a hosted
provider, every default keeps today's behaviour.

## What the code now derives from configuration

One rule decides everything — `localModelServices()` in `scripts/lib/operations.mjs`:

| Variable | Value | Local model service |
|---|---|---|
| `TTS_PROVIDER` | unset, empty or `local` | `tts` **in** the runtime |
| `TTS_PROVIDER` | `google`, `openai`, `openrouter` | `tts` **out** |

Translation has no local model service at all any more (Hy-MT2 was removed on
2026-11-09): it uses the configured chat provider by default
(`TRANSLATION_PROVIDER` unset/`chat`) or Google Cloud Translation
(`TRANSLATION_PROVIDER=google`).

That single rule drives:

- **deploy** (`scripts/deploy.sh`): the TTS service is pulled and started only
  while its provider is local. A hosted TTS provider passes `--allow-missing-tts`
  to the release manifest and skips the model `up` step.
- **release manifest** (`scripts/release-manifest.mjs`): a manifest without the
  TTS image validates from the environment alone, and the TTS client URL is
  wired only when its image is in the release.
- **roster and health** (`scripts/release-roster.mjs`,
  `scripts/health-fleet.mjs`): no model health target remains; translation is
  hosted and TTS readiness is covered by its Compose healthcheck.
- **resource budget** (`scripts/check-resource-budget.mjs`): the rendered stack
  is filtered to the release roster, so the budget reflects what actually runs.
  The approved local baseline is 24.5 GiB / 12 544 shares; with TTS hosted it
  is **20.5 GiB / 8 448 shares** (arithmetic, not measured RAM).
- **Compose** (`infra/docker/compose.yml`): `bot-ai` no longer hard-depends on
  `tts`; deploy starts it before the bots when it is local.

## Preconditions (phase 2 gate)

Do not flip the providers until the hosted path has passed a live check:

1. `TTS_PROVIDER=openrouter` with `OPENROUTER_API_KEY` synthesizes speech for a
   Japanese and an English sample; the voice sounds acceptable to the owner.
2. `AI_PROVIDER_PRIMARY` (Groq, `openai/gpt-oss-20b`) answers a persona prompt
   with correct usage fields and no chain-of-thought leakage.
3. Translation: the default chat provider translates the owner's important
   languages correctly (`TRANSLATION_PROVIDER` unset or `chat`), or Google
   Translation is configured explicitly.
4. A forced `429` produces the honest "busy" response, not a local fallback.

## Cutover

```sh
# 1. In the deployment environment file (/srv/ei-point/.env):
TTS_PROVIDER=openrouter
OPENROUTER_API_KEY=<key>
# Translation needs no local service; leave TRANSLATION_PROVIDER unset to use
# the chat provider, or set it to google with GOOGLE_TRANSLATE_API_KEY.
# Leave TTS_URL / POCKET_* alone: unused while TTS is hosted, and the release
# drops the service either way.

# 2. Build a release manifest WITHOUT the tts image
#    (the normal CI release flow does this; the model image is simply not
#    produced for that release).

# 3. Deploy from the backup-verified release:
BACKUP_SNAPSHOT=<verified snapshot> bash scripts/deploy.sh <release.json>

# 4. Verify the TTS service is gone and everything else is ready:
docker compose --project-name ei-point ps --format '{{.Service}}'
node scripts/health-fleet.mjs <release.json>
docker stats --no-stream
```

Then run the live Discord acceptance: `/speak` (hosted voice), `/translate`
(configured provider), a mention reply on Groq, and one voice-channel session.

## Rollback

Rolling back is a provider change plus the previous release:

```sh
# restore the previous deployment environment (local providers)
bash scripts/rollback.sh <previous-or-current release.json>
```

`rollback.sh` already starts the model services only when the previous manifest
contains their images, so a release that predates this cutover brings the local
models back. Never restore the database automatically.

## Resource envelope

The host-size decision (§12) is still open. The checker reads
`RESOURCE_CPU_CEILING` (default 9) and `RESOURCE_MEMORY_CEILING_GIB` (default
uncapped) from the environment, and it fails closed when the configured CPU
ceiling disagrees with `infra/systemd/ei-point.slice` — change the slice unit
and the variable together, never one alone.

## What is still operator-owned

- Live provider acceptance and the listening/translation-quality decision.
- The production release manifest that omits the model images.
- The VPS deploy, the recorded revision/image IDs/health, and the rollback drill.
- The 72-hour soak and the measured resource baseline (phases 0 and 6).
