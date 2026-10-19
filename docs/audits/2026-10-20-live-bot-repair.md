# Live bot repair — 2026-10-20

Status: **source implementation complete, built and tested locally; deployment and live
Discord acceptance are blocked by the hosting provider's serial console.** Nothing in this
document claims live verification for the changes below.

## Inputs reviewed

- `EI_POINT_VPS_REPAIR_AGENT_PROMPT.md` (handoff, read in full).
- `EI_POINT_BOT_REPAIR.patch` (base revision `9864875`, reviewed hunk by hunk).
- `EI_POINT_COMPLETION_BUILD_PLAN.md`, `docs/product/bot-command-and-runtime-spec.md`,
  `docs/feature-matrix.md`, `docs/phase-gates.md`, `docs/operations-release.md`,
  `docs/audits/2026-10-15-*`, `docs/audits/2026-10-20-bot-runtime-repair.md`.
- Current source: `apps/bots/*`, `packages/modules/bot-ui`, `packages/flow`,
  `infra/docker`, `infra/postgres`, deployment scripts.

## Skills

Loaded through this environment's skill registry (actual instructions read):
`verification-before-completion`, `systematic-debugging`, `deep-research`, `ponytail`,
`discord-bots`.

The task-specific names in the handoff exist in this environment but were not all mechanically
loaded: `codebase-onboarding`, `executing-plans`, `error-handling`, `local-llms`,
`ui-design-systems`, `accessibility`, `api-security`, `data-validation`,
`postgres-best-practices`, `api-design`, `playwright-e2e`, `docker-best-practices`,
`dependency-upgrades`, `release-management`, `runbooks`, `monitoring`. Equivalent workflows
were used; no unavailable skill was claimed.

## Patch reconciliation (ported, not blindly applied)

The patch was prepared against `9864875` in a different checkout and conflicts with newer work
on this branch (`voice 0.19.2`, per-identity artwork, global command registration, the owner's
"no colour" and Components V2 requirements). It was ported deliberately:

- Kept `@discordjs/voice` **0.19.2** (newer than the patch's 0.19.1) with `@snazzah/davey`.
- Ported the shared **Components V2** converter and made all interaction reply paths V2.
- **No accent colour anywhere** (owner instruction), including the patch's original
  `accent_color`/`accent_colour` additions and dashboard delivery.
- Kept per-identity blurred artwork (`embed-blur.png`) as the card media.
- Kept global command registration (Supports Commands badge) in addition to guild commands.
- Enforced the documented **16 KiB** persona bound with priority-based selection instead of
  the local 24 KiB variant.

## Implemented

- Shared V2 converter (`packages/modules/bot-ui/src/index.ts`): text/embeds → text display,
  media gallery, file components, action rows, footer, mention policy, ephemeral flags,
  idempotent wrapping, `update` support.
- Dashboard delivery (`packages/flow/src/embed-delivery.ts`): V2 container, media + link
  buttons, nonce, identity/guild checks preserved, no accent colour.
- Cyrene runtime (`apps/bots/ai/src/index.ts`, `tts.ts`):
  - restored `aiCommandDefinitions` to registration;
  - View Channel/Connect/Speak permission check, explicit Stage-channel rejection;
  - connection/player error listeners; underlying-error logging;
  - failed-start lease cleanup and safe destroy; one-shot playback no longer tears down an
    active reading session; Ready awaited before playback;
  - distinct capacity/permission/stage/empty-session failure messages.
- Persona (`apps/bots/ai/src/persona.ts`): 16 KiB bound with behavioural sections prioritised;
  measured real file output **16,383 bytes** (limit 16,384) with the core directive retained.
- Himiko announcements/community sends and commerce staff notifications: V2 containers.
- Robin (`apps/bots/music-py/src/main.py`): colourless `LayoutView`/`Container` responses;
  existing search select, ownership check and timeout preserved; panel containers colourless.
- Global command copies for all five Node bots (badge eligibility).
- Resource pooling (`infra/docker/compose.yml`): hard CPU quotas removed; weighted CFS shares
  (TTS 8192, models/DB 2048, API/web/workers 1024, bots 512, nginx 256); TTS threads 8.

## Verification performed (fresh runs)

| Command | Evidence |
|---|---|
| `pnpm --filter @ei-point/flow test` | 24 pass, 0 fail |
| `pnpm --filter @ei-point/module-bot-ui test` | 7 pass, 0 fail |
| `pnpm --filter @ei-point/bot-ai test` | 19 pass, 0 fail |
| `python -m unittest discover -s apps/bots/music-py/tests` | 57 pass, 0 fail |
| Builds (`bot-ai`, `bot-kafka`, `bot-commerce`, `bot-community`, `bot-himiko`, `api`, `workers`) | `tsc` exit 0 |
| Real persona check | 16,383 / 16,384 bytes, core directive present |
| Compose YAML parse | 16 services, parses |

Local host is Windows/Node 24.21; the deployed target is Linux/Node 24.8.0. Linux image builds
and live Discord behavior remain unverified.

## Deployment gate (precise)

- Host `Ei-POINT` is running; containers were healthy at the last inspection
  (api/web/workers/nginx/postgres/models/bots).
- The provider's xTerm console repeatedly fails: new sessions hang at
  `starting serial terminal on interface serial0`; a VM restart or Stop/Start restores a single
  session only intermittently, and input/output freeze again within minutes.
- Root login with the owner password (`Cattrix@121`) succeeded during the last working window.
  The password was restored to exactly that value through the hosting panel and must not be
  changed.
- The public Cloudflare quick tunnel is down after the most recent power cycle.
- No VPS files, services, migrations, volumes or data were changed by this repair session.

Staged deployment (run as root; builds the affected images, applies pooling, restarts the
fleet, re-opens the tunnel):

```bash
cd /opt/ei-point && git pull --ff-only &&
sed -i 's|^QWEN_TTS_TORCH_THREADS=.*|QWEN_TTS_TORCH_THREADS=8|' .env &&
docker compose -f infra/docker/compose.yml --env-file .env build api workers bot-ai bot-kafka bot-commerce bot-community bot-himiko bot-music &&
docker compose -f infra/docker/compose.yml --env-file .env up -d
nohup cloudflared tunnel --url http://127.0.0.1:8080 --no-autoupdate >/root/cf.log 2>&1 &
sleep 10; grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /root/cf.log | head -1
```

## Per-bot status

| Bot | Source | Local tests/build | Live |
|---|---|---|---|
| Kafka | repaired (V2 replies, global commands) | pass | deployed? no — blocked |
| Cyrene | repaired (DAVE voice, permissions, failure messages, 16 KiB persona, AI commands) | pass | blocked |
| Robin | repaired (discord.py 2.7.1/DAVE, LayoutView V2, search callback preserved) | 57 pass | blocked |
| Cipher | repaired (V2 replies, staff notification V2, global commands) | build pass | blocked |
| Silver Wolf | repaired (V2 replies, global commands) | build pass | blocked |
| Himiko | repaired (announcements/community/dashboard V2) | build pass | blocked |

## Unresolved / gated items

- Live acceptance: `/ping` per bot, Cyrene `/speak` + `/tts` audible reading + `/leave`,
  Robin search/playback/controls, V2 rendering in Discord.
- `/search` for Cyrene: still requires an approved search source; truthful unavailable
  response remains the correct behavior until one is authorized.
- Historical findings (A01–A20) were not all reproduced live; this session covered the
  concrete runtime/V2 defects in the handoff and the newer work on this branch.
- Linux image build, native DAVE packaging, FFmpeg/Opus behavior, moderation dry-runs,
  checkout sandbox tests, backup restores, soak/load gates remain open.
