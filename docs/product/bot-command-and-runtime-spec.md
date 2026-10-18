# Bot command and runtime specification

This is the requested product behavior supplied by the project owner on 2026-10-15. It supersedes the older command catalog as the target specification. Items below describe requirements, not completed implementation; implementation and acceptance status must be updated from code and live evidence.

## Shared behavior

- Every bot registers `/botinfo`, `/ping`, and `/about`.
- `/about` describes Ei Point and Ei-Flow and mentions the configured project owner.
- Every bot response is a Discord embed and includes the configured Ei Point image. This covers success, errors, command replies, and bot-generated replies. Keep private data out of public errors.
- Kafka moderation/security commands are restricted to the guild owner or a guild administrator. Its commands should not be publicly discoverable to ordinary members where Discord's command permission model permits that.
- Commands on Cyrene, Robin, Cipher, SilverWolf, and Himiko remain publicly discoverable and their normal replies are public. Sensitive payment/order details still require caller ownership/staff authorization.
- The embed image URL and owner Discord ID must be configurable; never hard-code a private owner ID or an expiring local file path.

## Kafka — security and moderation

Required commands:

- `/kick`, `/ban`, `/unban`
- `/timeout apply` and `/timeout remove`
- `/warn add` and `/warn remove`
- `/purge`
- `/temp ban`, `/temp restriction`, `/temp role`, `/temp mute`
- `/security` and the remaining security/moderation operations approved in the feature map

All Kafka moderation/security operations require either guild ownership or the guild Administrator permission, including subcommands, buttons, and other callbacks. Temporary actions need durable expiry records, retry-safe enforcement, and visible failure/reconciliation state. Do not claim expiry worked until Discord confirms the external effect.

## Cyrene — chat, search, and voice

Required slash commands:

- `/speak <text>` creates a voice file for text up to 500 characters and sends the audio file in the command's text channel; it does not join voice.
- `/tts` joins the invoker's voice channel and reads new text-chat messages associated with that voice channel aloud. It runs for that voice session and leaves when no human members remain. A separate `/leave` command leaves immediately.
- `/search <query>` asks Cyrene's AI model to answer the question; no external/web search provider is wired (owner decision 2026-10-16). Answers share the mention conversation memory, the daily token budget and the provider router, and unavailable/queue/budget states are answered honestly.
- `/translate <text> <target_language> [source_language]` translates up to 500 characters with the local Hy-MT2 model. Source language is optional and auto-detected when omitted. Translation text is not added to Cyrene's conversation history.

The chat assistant has no `/ask`, `/persona`, `/reset`, `/usage`, `/model`, or `/tts-voice` command. It responds to a direct mention of Cyrene in an allowed text channel. Reply in character using the supplied Cyrene memory files; persist only the conversation data intended by the current retention policy.

### Local model candidates

- Text-to-speech: Qwen3-TTS 12Hz 0.6B Base, conditioned on the supplied reference audio and its matching transcript. The provided calibration line is: “Ah, there you are! Hehe, were you looking for me? Oh, don't look so surprised. I'm simply happy you're here. You know, even the smallest moments can become precious memories. So, shall we make another one together?”
- Translation: Tencent Hy-MT2 1.8B.
- Load model weights from a pinned local model directory/volume; never download model weights during a command or silently switch to a metered provider. Expose readiness, load time, inference time, memory, CPU, and queue metrics. Qwen TTS and Hy-MT2 translation use independent, local-only services.
- Model inference is subject to bounded concurrency, queue depth, request timeout, and overload responses even when there is no external provider API rate limit.
- TTS text cap is 500 characters. Split or reject longer messages from `/tts` using a documented policy; do not let an unbounded backlog form.
- Keep Qwen voice-cloning reference audio, transcript, model/license notices, and deployment provenance together. Do not represent generated audio as official game dialogue or a specific actor's original recording.

## Robin — music only

Required commands: `/play`, `/queue`, `/stop`, and `/disconnect` (plus the shared `/ping`, `/botinfo`, `/about`).

Remove `/search`, `/nowplaying`, `/seek`, `/autoplay`, `/claimmaster`, and `/masters` as separate slash commands. `/pause`, `/resume`, `/skip`, `/shuffle`, `/loop` and `/volume` are removed from public sync as well (owner decision 2026-10-18) — their controls live on the live music panel's buttons. Any required queue selection or DJ authorization can be part of the listed commands' interaction flow, but must not create additional public commands unless the owner approves a spec change.
- Queue lifecycle (owner decision 2026-10-18): the queue is live-session state. Leaving voice — `/disconnect`, `/stop`, a kick or a lost channel — clears the queue, loop mode, autoplay and the panel; nothing is restored across restarts (the old `music.queue_snapshots` persistence is no longer written or read).
- Live music panel (owner request 2026-10-18): one panel message per music session, posted on the first `/play`, rendered as a single components-v2 container (accent colour + character artwork + text + six DJ/Master-gated buttons *inside* the panel) with stable `robin_panel:*` component ids and a persistent view registration; the panel refreshes on every session state change and closes when the session ends.
- Character themes (owner request 2026-10-18): every bot's replies use the palette and emblem taken from its own artwork in `project assets/bots/<Bot>/embed.png` — Kafka `#E0202F` 🕷️, Cyrene `#CE86E0` 🌸, Robin `#9078D8` 🕊️, Cipher `#2E5FD0` 🐱, Silver Wolf `#9152E0` 🐺, Himiko `#B0304C` 🌹 (the footer carries the emblem and character name).

## Cipher — services and payments

Required commands:

- `/orders` for service order creation/list/status flows, with the exact subcommand structure to follow the existing secure order model: buyer subcommands `list` (the caller's guild-scoped history, paginated), `create` (SKU autocomplete from the active catalog), `status`, and `claim`; staff subcommands `review`, `settle`, and `reject` behind settlement scope or Manage Server.
- `/referral link`, `/referral redeem`, and `/referral status`.
- `/payment` for the configured payment options/status flow.

Payment methods:

- UPI: generate a QR for the server-authoritative amount and payee. A QR or submitted proof is not payment confirmation.
- Razorpay: buyers pay through the owner's hosted payment page (configured with `RAZORPAY_PAYMENT_PAGE`, e.g. `https://razorpay.me/@subrodluffy`). Checkout shows the page link and QR, and the buyer submits the Razorpay payment ID (or UTR) as the reference for staff verification. No API keys, webhooks or automated capture are used (owner decision, 2026-10-16); a client callback or redirect is never payment confirmation.

Order and referral reads/writes must be scoped to the requesting buyer and guild, with staff-only settlement and one authoritative transactional fulfillment service.

## SilverWolf — games and economy

Required commands: `/rank`, `/cards`, `/inventory`, `/balance`, `/packs`, `/open`, `/buy`, `/sell`, `/market`, and `/trade`.

No separate `/play`, `/deck`, `/hand`, `/score`, `/cardinfo`, `/cardstats`, `/trades`, `/unlist`, or `/cardadmin` command is in the requested surface. Keep internal operations only if needed by the specified flows and do not expose extra slash commands without approval.

## Himiko — announcements, community, and levels

Required commands:

- `/announcement` and `/embed`
- `/setwelcome`, `/setleave`, `/testwelcome`, `/xp`, and `/setlevelchannel`
- `/leaderboard`

Functions: deliver welcome/leave messages; award experience from text participation and eligible voice-channel participation; issue level-up announcements; display the leaderboard. XP awards require cooldowns and anti-farming rules and must ignore bots. Voice XP must exclude AFK/empty channels and avoid awarding for self/server-deafened members; persist progress transactionally. Voice XP is opt-in per guild and requires at least two human members present so a user sitting alone cannot farm it. SilverWolf keeps the documented `/rank` readout, but does not award XP or own community events.

## VPS and local model capacity

The checked-in benchmark describes a 10-vCPU, approximately 63-GiB RAM VPS, with no AVX/AVX2/AES-NI/SSE4.2, and records a previous aggregate Ei Point allocation of 5 CPU cores and 24 GiB. The current project envelope (owner decision 2026-10-16) is 9 CPU cores of 10; RAM and disk are uncapped because Ei Point is the only project on the host. Re-measure the current VPS before deployment; do not treat old measurements as live state.

The project owner proposes keeping the VPS running except for a planned monthly restart. Model services should start at boot and preload pinned local weights, so ordinary requests use a warm process. A cold service restart includes model load time; no reliable duration is promised until measured on this CPU-only target with the actual model files and selected runtime. Compare boot/load time, time-to-first-audio, real-time factor for 500 characters, translation latency, peak RSS, and concurrent bot latency. Reject a model/runtime combination that violates the service budgets or starves Discord/API workloads.

Local inference removes third-party inference API quotas from these two features; it does not remove local CPU/memory contention, software/runtime failures, queue limits, or the need for timeouts and overload handling.

## API-key requirement count

The supplied `EI_POINT_COMPLETION_BUILD_PLAN.md` names **zero specific third-party API keys** as required configuration. It refers to external credentials generally, without listing a provider or key count. The current `.env.example` has two optional provider-key slots (`AI_PROVIDER_PRIMARY_KEY` and `AI_PROVIDER_FALLBACK_KEY`); those are implementation configuration, not key requirements stated in the supplied plan. The plan separately calls for Discord bot tokens and deployment secrets, which are not API-key requirements. Local Qwen TTS and Hy-MT2 translation do not need a metered inference-provider key.

## Implementation gates

| Area | Required evidence before marking complete |
|---|---|
| Commands | Registered command JSON matches this list exactly for every bot; removed commands are absent; permission tests cover every Kafka root/subcommand/callback. |
| Common embeds | Every bot's command, error, mention, and event reply is an embed with the configured image; non-Kafka output is public except user/order data that must be private. |
| Cyrene chat | Mention-only trigger, supplied persona context, guild/user isolation, bounded history, and no old chat slash commands. |
| Cyrene TTS | Target-VPS CPU-only benchmark, 500-character cap, model preloaded at service start, warm/cold timings, error handling, channel attachment, and idle-member departure. |
| Translation | Hy-MT2 1.8B target-VPS CPU-only benchmark and language/quality acceptance for the actual supported use cases. |
| Kafka | Real disposable-guild tests for each sanction, temporary expiry, permission denial, partial Discord failure, retry, and audit record. |
| Payments | Razorpay hosted payment page (no API keys): server-priced order returns the page link/QR, reference claim plus staff verification uphold the never-confirm-from-a-client rule; UPI QR amount/payee validation; USDT quote/address validation. |
| Levels | Text and voice XP cooldown/farming tests, empty/AFK/deaf exclusions, level-up delivery, and leaderboard consistency. |
| Release | Build and startup with pinned local models on the benchmark VPS, with CPU/RAM budgets recalculated against the 9-CPU project ceiling (RAM/disk uncapped on the single-project host; owner decision 2026-10-16). |

## Implementation status snapshot

This table reflects repository work in progress. A slash command appearing in source does not count as accepted until its handler and the evidence above are complete.

Legacy-behavior traceability (section 1A, 2026-10-16): all 179 declarations detected in the three source archives carry a reviewed disposition in `docs/audits/legacy-behavior-map.json` — 86 retained with a traced handler and named tests, 93 deliberately replaced with the approved decision recorded in [legacy-decisions.md](legacy-decisions.md). Verify with `node scripts/check-feature-coverage.mjs --mode release` (exit 0).

| Area | Status | Current evidence or remaining work |
|---|---|---|
| Shared `/botinfo`, `/ping`, `/about` | Partial | Registered in the six bot command arrays; identity-specific details, owner mention, and runtime behavior still need per-bot acceptance. |
| Common embed replies | Partial | Shared TypeScript replies now resolve visibility from the identity and operation (Himiko, SilverWolf, Cyrene, Cipher and Robin reply publicly except server configuration, card administration and payment/order/referral detail; Kafka and unknown identities stay private; failures before acknowledgement stay private) and resolve per-identity images (`EI_POINT_EMBED_IMAGE_<IDENTITY>` falling back to `EI_POINT_EMBED_IMAGE_URL`); router tests assert every registered command on Himiko, SilverWolf, Cipher and Cyrene. Robin's Python replies now route every success, error, empty and search-picker callback path through the same embed/image helper (`embed_reply_helper`/`respond`, per-identity `EI_POINT_EMBED_IMAGE_ROBIN`), enforced by `apps/bots/music-py/tests/test_response_embeds.py`. Live test-guild visibility checks and outbound event messages remain open. |
| Kafka permissions | Partial | Administrator default command permissions, owner-or-Administrator interaction gate, `/kick`, warning/timeout removals, and all four `/temp` actions are implemented. Disposable-guild effect/recovery tests, other security callbacks, and live authorization checks remain open. |
| Cyrene `/tts` session | Partial | Reads new messages from the joined voice channel's text chat, caps each message at 500 characters, bounds the queue, and leaves after humans exit. A private, offline-only local Qwen service with preloaded reference conditioning, pinned model manifest verification, bounded WAV cache/queue, health checks and metrics is implemented; model provisioning, target-VPS CPU benchmark and audible Discord acceptance remain open. |
| Cyrene `/speak` and `/search` | Partial | `/speak` now uses the local Qwen service and attaches WAV output. `/search` answers through the AI provider router with the Cyrene persona, conversation memory and daily budget — no web search source (owner decision 2026-10-16). Model provisioning and live Discord acceptance remain open. |
| Cyrene `/translate` | Partial | Registered `/translate` uses the local Hy-MT2 OpenAI-compatible endpoint with optional source-language detection, a 500-character limit, one inference slot, bounded queue and timeout. Pinned weight provisioning, target-VPS CPU/memory/latency and language-quality acceptance remain open. |
| Robin | Partial | Requested common commands are added and disallowed slash commands are removed from sync (pause/resume/skip/shuffle/loop/volume now live on the panel's buttons). Every reply path (success, error, empty) routes through the configured embed/image helper with the character theme taken from Robin's own artwork; the approved-root surface, FFmpeg reconnect/failure handling, session-scoped queue clearing, the live music panel and bounded cache are covered by `apps/bots/music-py/tests/test_response_embeds.py`, `test_ffmpeg_playback.py`, `test_session_scope.py` and `test_music_panel.py`. Audible Discord playback remains open. |
| Cipher | Partial | `/orders` (buyer `list`/`create`/`status`/`claim` plus staff `review`/`settle`/`reject`), `/payment`, and one-time transactional referral redemption are implemented; Discord staff approval and the dashboard queue settle or reject the same orders through one transactional module. `/orders list` pages the caller's guild-scoped history and `create` autocompletes active SKUs. Earned referral rewards auto-apply to INR checkouts as whole-row credit (reserved on the order, paid on settlement, released or expired on rejection/expiry); a fresh claim enqueues a durable notification that Cipher delivers to the configured staff channel. Razorpay now settles through the owner's hosted payment page with a staff-verified payment reference (API-key checkout was superseded by the owner decision of 2026-10-16); live acceptance on the deployment (real payment + staff verification) remains open. |
| Web commerce access | Partial | Guild order review splits read from settlement: the commerce reader scope lists orders with buyer ID and payment proof omitted, settlement scope or owners see the proof fields and can settle/reject, and anonymous or wrong-scope requests fail closed before database work (reader/staff/admin/anonymous matrix through the real session wiring). Web checkout requires a signed-in Discord session: typed buyer IDs are refused, order resume and claim are owner-bound, and payment writes carry the CSRF gate; OAuth sign-in returns to the validated local page it started from. Order verification renders through the token-authenticated internal lookup (externally blocked at the edge), forwards the edge visitor address so throttling stays per client, applies a five-second deadline, and shows a distinct recoverable unavailable state. Open: live multi-client throttling evidence on the deployed edge — local browser acceptance now runs through `pnpm test:browser` (`tests/browser/`). |
| Browser acceptance suite | Complete (local) | `pnpm test:browser` builds the dashboard, starts the demo API on the baked default port and drives Edge (channel msedge) through three Playwright specs: public routes desktop/mobile with brand/artwork loading plus pause controls and reduced motion; commerce checkout (options, QR, referral transfer/clear, UTR/TXID validation, claim, awaiting/confirmed, Escape/focus) and the guild-switch race; workspace configuration/admin controls with CSRF, version and desktop/mobile overflow; and API-backed dashboard states (search, modal, guild switch, stale notice, sign-in gate, empty access, workspace unavailable) and verification empty/short/unknown/valid states. Live staging OAuth return and multi-client throttling remain Phase 10. |
| SilverWolf | Partial | Requested game/economy commands are now the registered allowlist; integration tests and common reply/event formatting remain open. |
| Himiko | Partial | Welcome/leave setup, text XP, opt-in voice XP, level-up outbox delivery, and leaderboard are registered under Himiko; Discord intent configuration, live guild delivery, and acceptance evidence remain open. |
| VPS model qualification | Not started | No pinned local weights have been benchmarked on the target VPS. |

## Command-by-command function map

This is the requested operator-facing inventory. Root commands with subcommands are shown as separate actions for clarity; the registered Discord command should still use a root command with the stated subcommand.

### Commands shared by every bot

| Command | Function |
|---|---|
| `/botinfo` | Show bot name, purpose, current server count, and uptime. |
| `/ping` | Show Discord gateway latency. |
| `/about` | Explain Ei Point and Ei-Flow and mention the configured owner. |

### Kafka

| Command | Function |
|---|---|
| `/kick` | Remove a guild member and write an audit case. |
| `/ban` | Ban a member/user and record the reason and audit case. |
| `/unban` | Remove a guild ban and record the action. |
| `/timeout apply` | Apply a bounded member timeout and record expiry metadata. |
| `/timeout remove` | Remove an active timeout. |
| `/warn add` | Add a warning case for a member. |
| `/warn remove` | Remove or void a warning case with an audit reason. |
| `/purge` | Bulk-delete eligible recent messages and report the confirmed count. |
| `/temp ban` | Temporarily ban a user and unban through durable expiry reconciliation. |
| `/temp restriction` | Deny message/thread posting temporarily, recording the original channel overwrite bits for restoration. |
| `/temp role` | Grant a manageable, non-administrator role until durable expiry cleanup. |
| `/temp mute` | Apply a Discord timeout for up to 28 days. |
| `/security` | Inspect security posture, lockdown, trust, whitelist, snapshots, and incidents. |

All Kafka rows above are owner-or-Administrator only. Temporary actions need retries and reconciliation; do not treat a queued expiry as a completed Discord action.

### Cyrene

| Command or trigger | Function |
|---|---|
| Direct mention | Continue a private per-user/per-guild conversation in character. |
| `/speak <text>` | Generate one audio file (maximum 500 characters) and attach it to the command response. |
| `/tts` | Join the caller's voice channel and speak new messages from that voice channel's text chat. |
| `/leave` | End the active Cyrene voice session immediately. |
| `/search <query>` | Ask Cyrene's AI model to answer the question; bounded by the 300-character query limit, the provider deadline and the daily token budget. |
| `/translate <text> <target_language> [source_language]` | Translate up to 500 characters with local Hy-MT2. The source language is optional and auto-detected when omitted. |

### Robin

| Command | Function |
|---|---|
| `/play` | Require a link of the song or playlist. A song link enqueues one track; a playlist link enqueues its tracks bounded by `PLAYLIST_MAX_TRACKS` (default 50, 1–100 validated at startup), each resolved lazily at playback. |
| `/pause` | Pause current playback. |
| `/resume` | Resume paused playback. |
| `/skip` | Skip the current track and start the next eligible track. |
| `/stop` | Stop playback and clear the current queue. |
| `/queue` | Show the current and upcoming queue. |
| `/shuffle` | Randomize queued tracks. |
| `/loop` | Choose no loop, current-track loop, or queue loop. |
| `/volume` | Set guild playback volume within the allowed range. |
| `/disconnect` | Leave the voice channel and release its voice-session lease. |

### Cipher

| Command | Function |
|---|---|
| `/orders` | Buyer: `list` (caller's paginated history), `create` (autocompleted SKUs), `status`, `claim` (proof). Staff: `review` (claimed queue with proof), `settle`, `reject`. |
| `/referral link` | Create or display the caller's referral link. |
| `/referral redeem` | Redeem a valid referral code with one-time transactional rules. |
| `/referral status` | Show the caller's referral progress and rewards. |
| `/payment` | Display the configured payment methods (UPI quote, Razorpay hosted page, USDT wallet) and checkout guidance. |

### SilverWolf

| Command | Function |
|---|---|
| `/rank` | Show the caller's or selected member's XP, level, and rank. |
| `/cards` | Browse the card catalog. |
| `/inventory` | Show the caller's cards. |
| `/balance` | Show the caller's berry balance. |
| `/packs` | List available card packs. |
| `/open` | Buy/open a pack using its server-defined price and supply. |
| `/buy` | Buy a valid marketplace listing. |
| `/sell` | List an owned card for sale. |
| `/market` | Browse open marketplace listings. |
| `/trade` | Offer, accept, or cancel a card/berry trade. |

### Himiko

| Command or event | Function |
|---|---|
| `/announcement` | Publish a configured announcement embed to a selected channel. |
| `/embed` | Preview an embed before posting. |
| `/setwelcome` | Choose the welcome channel and message template. |
| `/setleave` | Choose the leave channel and message template. |
| `/testwelcome` | Preview the current welcome or leave template. |
| `/xp` | Configure text XP, its per-source cooldown, and opt-in voice XP amount/interval. |
| `/setlevelchannel` | Choose the level-up notification destination. |
| Text message | Award XP to eligible human members subject to cooldown and anti-farming rules. |
| Voice membership | Award XP once per configured interval when at least two humans share a non-AFK channel; exclude bots and self/server-deafened members. |
| Level-up event | Send a level notification to the configured channel. |
| `/leaderboard` | Display the top members by XP. |
