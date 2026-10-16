# Expected load profile (§10B) — explicit numbers recorded before testing

These numbers are **recorded before testing** as §10B requires. They are
proposed targets and design limits, not measured results: the peak and
twice-peak load runs, failure injection and the 72-hour soak execute on the
deployment VPS inside the 9-CPU project envelope (owner decision 2026-10-16;
RAM/disk uncapped). Member-count assumptions need owner confirmation.

## Hard design limits (from code, not assumptions)

| Limit | Value | Source |
|---|---|---|
| Guilds | exactly 2 (main + dev), locked in code | two-guild allowlist check in every bot |
| Simultaneous music voice sessions | 2 | `MAX_VOICE_SESSIONS` (`apps/bots/music-py/src/main.py`) + fleet voice lease |
| Simultaneous Cyrene TTS voice sessions | 2 | `TTS_MAX_SESSIONS` + `ai.voice_leases` fleet cap |
| AI chat concurrency / queue / deadline | 2 / 20 / 60 s | `packages/modules/ai` (`AI_CONCURRENT`, `AI_QUEUE_MAX`, `AI_DEADLINE_MS`) |
| AI daily budget | 25,000 tokens/user/day (default) | `AI_DAILY_BUDGET_TOKENS` |
| TTS synthesis concurrency / queue / deadline | 2 / 10 / 90 s | `packages/modules/tts` |
| Translation concurrency / queue / deadline | 1 slot / 8 / 60 s | Hy-MT2 service + bot queue |
| Text input caps | 500 chars (speak/translate/voice-chat), 300 (search query) | module validators |
| Checkout rate limit | 30 requests/min per client bucket (1-minute window) | `commerce.checkout_rate_limits` |
| Per-user cooldowns | 5 s (AI mentions, voice-chat reading) | bot runtime |
| Music cache | 10 GiB bounded, disposable, excluded from backups | `AudioCache` defaults |
| Resource envelope | 9 CPU ceiling; runtime allocation 7.45 CPU / 32.5 GiB; concurrent 7.95 / 33.75 | `scripts/check-resource-budget.mjs` |

## Expected peaks to test (proposed; owner confirmation pending)

| Dimension | Expected peak | 2× burst |
|---|---|---|
| Concurrent online members (both guilds) | 300 | 600 |
| Slash-command interactions, fleet-wide | 120/min | 240/min |
| Music sessions | 2 (at cap) | 2 (cap holds; excess refused honestly) |
| Cyrene TTS voice sessions | 2 (at cap) | 2 (cap holds) |
| `/speak` requests | 4/min | 8/min |
| `/translate` requests | 6/min | 12/min (queue 8 absorbs; excess gets the honest retry message) |
| AI mentions + `/search` | 20/min fleet-wide | 40/min (per-user daily budget still caps individuals) |
| Web checkouts | 2/min sustained | 4/min (per-IP 30/min bucket far above) |
| Payment-proof claims | 1/min | 2/min |

## Storage growth targets (proposed)

- Artwork/uploads: ≤ 500 MiB/month.
- PostgreSQL (data + indexes): ≤ 2 GiB/month; WAL archive follows the 14-day window.
- Music cache: bounded at 10 GiB (disposable, excluded from backups).
- Logs: ≤ 5 GiB/month, rotated, not snapshotted.
- Backups: bounded by retention (28 local snapshots; restic 24 h/7 d/4 w).

## Operation deadlines to measure against (§10B p50/p95/p99)

| Operation | Deadline budget |
|---|---|
| Slash-command acknowledgement (defer) | < 1.5 s p95; always inside the 3 s Discord window |
| Non-inference command completion | < 2 s p95 |
| AI chat + `/search` completion | < 60 s (router deadline; over → honest unreachable message) |
| `/speak` synthesis + file post | < 90 s (TTS deadline) |
| `/translate` completion | < 60 s |
| Checkout API (quote/resume/claim) | < 500 ms p95 server-side |
| Music track start after `/play` | < 30 s p95 (yt-dlp resolution bound: 30 s) |

During the runs, record acknowledgement/completion p50/p95/p99, queue age, RSS,
event-loop lag, inference timings, DB locks, disk/bandwidth and errors — then
exercise database restart, gateway reconnect, lost provider response, worker
crash, and disk pressure/backup failure, requiring no duplicate settlements,
no lost durable jobs and no unbounded retries (§10B).
