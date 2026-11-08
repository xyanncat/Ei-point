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
| `TRANSLATION_PROVIDER` | unset, empty or `local` | `hy-mt2` **in** the runtime |
| `TRANSLATION_PROVIDER` | `google` | `hy-mt2` **out** |

That single rule drives:

- **deploy** (`scripts/deploy.sh`): the model services are pulled and started
  only while their provider is local. A hosted provider passes
  `--allow-missing-tts` / `--allow-missing-hy-mt2` to the release manifest and
  skips the model `up` step.
- **release manifest** (`scripts/release-manifest.mjs`): a manifest without the
  model images validates from the environment alone, and the model client URLs
  are wired only when their image is in the release.
- **roster and health** (`scripts/release-roster.mjs`,
  `scripts/health-fleet.mjs`): the model health target disappears with the
  release.
- **resource budget** (`scripts/check-resource-budget.mjs`): the rendered stack
  is filtered to the release roster, so the budget reflects what actually runs.
  The approved local baseline is 28.5 GiB / 14 592 shares; with both models
  hosted it is **20.5 GiB / 8 448 shares** (arithmetic, not measured RAM).
- **Compose** (`infra/docker/compose.yml`): `bot-ai` no longer hard-depends on
  `tts`/`hy-mt2`; deploy starts the models before the bots when they are local.

## Preconditions (phase 2 gate)

Do not flip the providers until the hosted path has passed a live check:

1. `TTS_PROVIDER=openrouter` with `OPENROUTER_API_KEY` synthesizes speech for a
   Japanese and an English sample; the voice sounds acceptable to the owner.
2. `AI_PROVIDER_PRIMARY` (Groq, `openai/gpt-oss-20b`) answers a persona prompt
   with correct usage fields and no chain-of-thought leakage.
3. `TRANSLATION_PROVIDER=google` (or `local`) translates the owner's important
   languages correctly.
4. A forced `429` produces the honest "busy" response, not a local fallback.

## Cutover

```sh
# 1. In the deployment environment file (/srv/ei-point/.env):
TTS_PROVIDER=openrouter
OPENROUTER_API_KEY=<key>
TRANSLATION_PROVIDER=google
GOOGLE_TRANSLATE_API_KEY=<key>
# Leave TTS_URL / HY_MT2_URL / *_MODEL_PATH alone: they are unused while the
# providers are hosted, and the release drops the services either way.

# 2. Build a release manifest WITHOUT the tts and hy-mt2 images
#    (the normal CI release flow does this; the model images are simply not
#    produced for that release).

# 3. Deploy from the backup-verified release:
BACKUP_SNAPSHOT=<verified snapshot> bash scripts/deploy.sh <release.json>

# 4. Verify the model services are gone and everything else is ready:
docker compose --project-name ei-point ps --format '{{.Service}}'
node scripts/health-fleet.mjs <release.json>   # no hy-mt2 target
docker stats --no-stream                        # no tts/hy-mt2 rows
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
