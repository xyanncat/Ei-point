# Live bot repair — 2026-10-20

Status: **deployed and live-verified for infrastructure, identity, registration, model
services and V2 payloads. Audible voice playback and the Discord UI checks require the
owner's client and remain pending.** No check below is inferred from a running container.

## Inputs reviewed

- `EI_POINT_VPS_REPAIR_AGENT_PROMPT.md` (read in full).
- `EI_POINT_BOT_REPAIR.patch` (base `9864875`) — already ported on this branch (see below).
- `EI_POINT_COMPLETION_BUILD_PLAN.md`, `docs/product/bot-command-and-runtime-spec.md`,
  `docs/feature-matrix.md`, `docs/phase-gates.md`, `docs/operations-release.md`,
  `docs/audits/2026-10-15-*`, `docs/audits/2026-10-20-bot-runtime-repair.md`.
- Deployed source, compose labels, container images, migrations and service configuration.

## Skills

Loaded and read through this environment's skill registry: `verification-before-completion`,
`systematic-debugging`, `deep-research`, `ponytail`, `discord-bots`, plus
`docker-best-practices` and `release-management` for the deployment package. The remaining
task-specific names exist in this environment but were not mechanically loaded; equivalent
workflows were used. No unavailable skill was claimed.

## Patch reconciliation

The handoff patch targets `9864875` in a different checkout and conflicts with the newer work
on `feat/completion-plan` (`@discordjs/voice` 0.19.2, per-identity artwork, global command
registration, no-colour instruction). It was ported deliberately (commits `7b94f22`,
`931d871`, `00bc773`):

- Shared Components V2 converter for all interaction replies (text, media, files, action rows,
  mention policy, ephemeral flags, idempotent wrapping, no accent colour).
- Dashboard delivery and Himiko announcements/community sends converted to V2 with identity,
  guild and nonce checks preserved.
- Cyrene voice: permission checks (View Channel/Connect/Speak), Stage-channel rejection,
  connection/player error listeners, underlying-error logging, failed-start lease cleanup,
  one-shot playback no longer tears down an active reading session, distinct failure reasons.
- Persona enforced at the documented **16 KiB** bound with behavioural-section priority
  (measured 16,383 / 16,384 bytes) — the local 24 KiB variant was retired.
- Robin uses `discord.py[voice]` 2.7.1 (DAVE) with LayoutView containers and its search
  callback preserved.
- Global command copies registered for all five Node bots (Supports Commands badge).
- Resource pooling: hard CPU quotas removed, weighted CFS shares, TTS threads 8.

## Deployment executed (2026-10-20)

- Checkpoint branch created at the pre-deploy revision (`vps-checkpoint-*`); previous images
  remain on the host for rollback.
- Deployment root `/opt/ei-point`; compose project `ei-point`; deployed revision **`c87d3da`**
  (Cyrene later rebuilt from **`baefbf5`** for the voice-chat chunking fix).
- Build + up completed with `docker compose -f infra/docker/compose.yml --env-file .env`.
- Image IDs (short):
  api `6c13bf775d1a`, workers `03fb38201dcc`, bot-ai `e38909cbfd07`, bot-kafka `29a2f3003339`,
  bot-commerce `65fee926aa2a`, bot-community `8751a976e05b`, bot-himiko `93d58cea6a44`,
  bot-music `901785626e7c`.

### Incident found and fixed during deployment

`nginx` exited with `host not found in upstream "api:3001"` and then failed to start with
`Address already in use`: the dynamic `workers` container had taken the statically reserved
trusted-proxy IP `172.29.10.2`. Fixed in `c87d3da` by reserving `172.29.10.250` for the proxy
(compose + `.env`), recreating `api` and `nginx`. nginx then started healthy and
`http://127.0.0.1:8080/` returned **200**.

## Live verification evidence

| Check | Command / probe | Result |
|---|---|---|
| Deployed revision | `git log --oneline -1` | `c87d3da` |
| Service health | `docker compose ps` | 13/13 healthy (api, web, workers, nginx, postgres, hy-mt2, tts-qwen, six bots) |
| Public dashboard | `curl -w '%{http_code}' https://shipped-learners-scotland-garbage.trycloudflare.com/` | **200**; browser title `Ei point — Command Center`, hero renders |
| Bots logged in | container logs | Kafka, Cyrene, Cipher, Silver Wolf (command registration), Himiko, Robin logged in |
| Global commands (badge) | Discord API per app | Kafka 13, Cyrene 13, Robin 7, Cipher 6, Silver Wolf 13, Himiko 11 |
| Guild commands | Discord API (dev guild) | Kafka 13, Cyrene 13, Robin 0 (global by design), Cipher 6, Silver Wolf 13, Himiko 11 |
| DAVE voice stack | package metadata in image | `@discordjs/voice 0.19.2`, `@snazzah/davey ^0.1.9`; Robin `discord.py 2.7.1` |
| TTS model | timed `/v1/audio/speech` in container | HTTP 200, 122,924 bytes, **14.44 s** (was 46.39 s before pooling/threads) |
| Translation model | real Hy-MT2 request from bot container | HTTP 200, 10.8 s, output `Bonjour, bienvenue à Ei Point.` |
| V2 payload | deployed `createVoiceCard` + `toEiComponentPayload` serialization | Container `type 17` + TextDisplay + MediaGallery (`embed-blur.png`) + File `attachment://cyrene.wav`, flags `32768` |
| Runtime errors | `docker logs --since 6m` per bot | none |
| Controlled restart | `docker restart ei-point-bot-ai-1` | healthy in 20 s, `bot-ai ready as Ei | Cyrene#8519 across 1 guilds` |

## Per-bot status

| Bot | Deployed | Live-verified | Pending (owner/Discord UI) |
|---|---|---|---|
| Kafka | yes | login, 13 global + 13 guild commands, V2 shared path, no errors | moderation dry-runs in a disposable guild (real sanctions are out of scope) |
| Cyrene | yes | login, 13 + 13 commands, DAVE stack, TTS 200/14.44 s, translation 200/10.8 s, V2 card JSON | `/tts` audible reading + `/leave`, `/speak` V2 card rendering in Discord |
| Robin | yes | login, 7 global commands, discord.py 2.7.1 (DAVE) | search/select, playback, queue/controls in a voice channel |
| Cipher | yes | login, 6 + 6 commands, shared V2 path | order/payment flows need sandbox; no live charges |
| Silver Wolf | yes | login, 13 + 13 commands, shared V2 path | card/economy flows in the test guild |
| Himiko | yes | login, 11 + 11 commands, shared V2 path | announcement/welcome/XP delivery in the test guild |

The Supports Commands badge is granted by Discord asynchronously once global commands are
registered; all six now qualify. It cannot be forced from the application.

## Voice-chat latency (`/tts`)

Measured on the live host (8 threads, no CPU quota): **9.35 s** for “Hello there.”,
**32.04 s** for 109 characters (≈4.9 s fixed + 0.25 s/char). The previous pump synthesized the
whole message before playback, so the listener waited for the entire message.

Fixed in `baefbf5`: speech is split at sentence boundaries (`splitSpeechChunks`, 140-char
bound, first sentence emitted alone) and the next chunk is synthesized **while** the current
one plays. Live verification: the deployed splitter returned
`["Hey everyone, how are you doing today?", "I hope you are all …"]`; the first chunk
synthesized in **14.11 s** and playback starts at that point instead of after the full message
(previously up to ~2.5 minutes at the 500-character cap). Remaining limit: synthesis itself is
CPU-bound on the no-AVX host; 1–2 s would require a GPU or a lighter engine.

## Remaining gates (honest)

- `/tts` audible playback and `/speak` V2 rendering require the owner's Discord client.
- `/search` remains correctly unavailable until an approved source is configured.
- Kafka sanction/expiry effects require a disposable guild; no destructive test was run.
- Razorpay sandbox, backup restores, load/soak and 72-hour observation remain open.
- TTS remains CPU-bound on the no-AVX host (14.4 s for a short sentence); 1–2 s requires a GPU
  or a lighter engine.

## Rollback

- Deploy-time checkpoint branch on the VPS plus the previous image IDs on the host.
- Application rollback: check out the checkpoint revision and rebuild/up the affected services.
- No migrations were added by this repair; database contents and volumes were preserved.
