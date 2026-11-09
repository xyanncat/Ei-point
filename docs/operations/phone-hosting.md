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
does not stop them:

```sh
export DATABASE_URL='postgresql://…neon.tech/ei_point?sslmode=require'
export AI_PROVIDER_PRIMARY='https://api.groq.com/openai/v1/chat/completions'
export AI_PROVIDER_PRIMARY_MODEL='openai/gpt-oss-20b'
export AI_PROVIDER_PRIMARY_KEY='…'
# Cyrene
BOT_KEY=cyrene BOT_TOKEN='…' GUILD_ALLOWLIST='id1,id2' EI_POINT_OWNER_ID='…' \
  TTS_PROVIDER=local TTS_URL='http://127.0.0.1:3120/v1/audio/speech' \
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
this repository. Constraints:

- 500 characters per request (`/speak` cap), 8 MiB audio bound.
- One synthesis at a time is fine; the bot already has a bounded queue.
- `TTS_TOTAL_DEADLINE_SECONDS` (default 90) includes queue wait.
- If the bridge is down, users get an honest "voice service unavailable" answer;
  chat still works.

## Robin benchmark (before relying on it)

Run one voice session and record: CPU per stream, RSS, dropped frames, and
whether a second concurrent stream is possible. If it stutters on the phone,
deploy Robin to a Render free workspace instead — but then Cyrene and Robin must
stay on separate phones/workspaces, because one Render workspace allows one
always-on service.

## Backups and logs

The phone is not a backup target. Neon is dumped nightly to Drive by GitHub
Actions; media masters and logs go to `drive:ei-point/media` and
`drive:ei-point/exports` (rclone). Never keep the only copy of anything on the
phone.
