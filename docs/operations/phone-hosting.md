# Phone hosting — Cyrene + Robin

Cyrene (`bot-ai`) and Robin (`music-py`) run on one Android phone. Cyrene also
hosts the only local model: a fine-tuned **Piper** voice. Everything else is
hosted (Groq chat, Render bots, Neon, Drive).

## Why the phone

- Cyrene needs a local TTS model; Render free has 0.1 CPU / 512 MB.
- Robin streams voice audio; 0.1 CPU and Render's outbound limits make it a
  marginal fit, so the phone is the first choice. Benchmark it on Render only if
  the phone cannot hold both.

## Termux setup

```sh
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git ffmpeg python clang make
termux-wake-lock                       # keeps the CPU awake with the screen off
# Disable battery optimisation for Termux in Android settings.
```

Install the repo and build:

```sh
git clone https://github.com/xyanncat/Ei-point && cd Ei-point
corepack enable && corepack prepare pnpm@9.12.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @ei-point/flow build
pnpm --filter @ei-point/bot-ai build
```

Run both identities under `tmux` (or termux-services) so a dropped SSH/session
does not stop them. Put the values from
[`infra/phone/cyrene.env.example`](../infra/phone/cyrene.env.example) in an
untracked `cyrene.env` on the device:

```sh
set -a; . ./cyrene.env; set +a
# Cyrene (bot-ai) — TTS is the Piper bridge on this same device.
node apps/bots/ai/dist/index.js
# Robin
BOT_KEY=robin BOT_TOKEN='…' GUILD_ALLOWLIST='id1,id2' \
  MUSIC_HEALTH_PORT=3105 python apps/bots/music-py/src/main.py
```

Keep the phone charging, on Wi-Fi, and out of aggressive battery optimisation.
A phone that throttles will drop voice frames before it drops the gateway.

## Piper bridge contract

The bot's `local` TTS provider posts:

```http
POST /v1/audio/speech
Content-Type: application/json

{ "text": "…", "voice": "default", "format": "wav" }
```

and expects raw **WAV** bytes with `Content-Type: audio/wav`. A small HTTP
wrapper around the fine-tuned Piper model is enough; it is maintained outside
this repository.

### Wiring

The bot and the bridge run on the **same self-hosted device**, so `TTS_URL`
stays on loopback:

```sh
TTS_PROVIDER=local
TTS_URL=http://127.0.0.1:3120/v1/audio/speech
```

Verified deployment (2026-11-09): Redmi 10 Prime, Android 13, arm64, Termux
0.118.3, Node 26.12.1, ffmpeg 9.0.2. The bot was built on-device with `tsc`
(`pnpm install --filter @ei-point/bot-ai... --ignore-scripts`), the persona was
copied with a verified SHA-256, and the smoke run stops at the expected missing
`BOT_TOKEN`/`GUILD_ALLOWLIST` check. Termux has no `/usr/bin/env`, so invoke
pnpm as `node "$PREFIX/lib/node_modules/pnpm/bin/pnpm.cjs"`. The boot script
must export `HOME`, `PREFIX`, `PATH` and `LD_LIBRARY_PATH` before
`termux-wake-lock` because Termux:Boot starts with a minimal environment.

The Render API is not part of this path — it never proxies speech. If the
bridge ever moves to a **different** device, point `TTS_URL` at that device's
LAN address (for example `http://192.168.1.50:3120/v1/audio/speech`), open TCP
3120 only on the local network, and leave `TTS_PROVIDER=local` unchanged.
Bot health stays independent of the bridge: `/health/live` remains green if the
bridge dies, and `/speak` answers with an honest unavailable message.

Constraints:

- 500 characters per request (`/speak` cap), 8 MiB audio bound.
- One synthesis at a time is fine; the bot already has a bounded queue.
- `TTS_TOTAL_DEADLINE_SECONDS` (default 90) includes queue wait.
- If the bridge is down, users get an honest "voice service unavailable" answer;
  chat still works.

## Robin benchmark (before relying on it)

Run one voice session and record: CPU per stream, RSS, dropped frames, and
whether a second concurrent stream is possible. If it stutters on the phone,
use a second phone or a paid Render instance with at least **1.2 CPU / 512 MB**;
Render free's 0.1 CPU is not sufficient for two streams (see the benchmark
below). Cyrene and Robin must stay on separate phones/workspaces, because one
Render workspace allows one always-on service.

The source-side baseline and the sizing method are in
[2026-11-09-robin-pool-capacity-benchmark](../audits/2026-11-09-robin-pool-capacity-benchmark.md).
Run `bench/robin_capacity/runner.py` on the phone before freezing the pool or
instance allocation; the development-host result is not a phone result.

## Backups and logs

The phone is not a backup target. Neon is dumped nightly to Drive by GitHub
Actions; media masters and logs go to `drive:ei-point/media` and
`drive:ei-point/exports` (rclone). Never keep the only copy of anything on the
phone.
