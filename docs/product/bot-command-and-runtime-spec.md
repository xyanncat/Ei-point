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
- `/timeout` and `/timeout remove`
- `/warn` and `/warn remove`
- `/purge`
- `/temp ban`, `/temp restriction`, `/temp role`, `/temp mute`
- `/security` and the remaining security/moderation operations approved in the feature map

All Kafka moderation/security operations require either guild ownership or the guild Administrator permission, including subcommands, buttons, and other callbacks. Temporary actions need durable expiry records, retry-safe enforcement, and visible failure/reconciliation state. Do not claim expiry worked until Discord confirms the external effect.

## Cyrene — chat, search, and voice

Required slash commands:

- `/speak <text>` creates a voice file for text up to 500 characters and sends the audio file in the command's text channel; it does not join voice.
- `/tts` joins the invoker's voice channel and reads new text-chat messages associated with that voice channel aloud. It runs for that voice session and leaves when no human members remain. A separate `/leave` command leaves immediately.
- `/search` performs the agreed search operation (provider/source is still to be specified).

The chat assistant has no `/ask`, `/persona`, `/reset`, `/usage`, `/model`, or `/tts-voice` command. It responds to a direct mention of Cyrene in an allowed text channel. Reply in character using the supplied Cyrene memory files; persist only the conversation data intended by the current retention policy.

### Local model candidates

- Text-to-speech: Qwen3-TTS 12Hz 0.6B Base, conditioned on the supplied reference audio and its matching transcript. The provided calibration line is: “Ah, there you are! Hehe, were you looking for me? Oh, don't look so surprised. I'm simply happy you're here. You know, even the smallest moments can become precious memories. So, shall we make another one together?”
- Translation: Tencent Hy-MT2 1.8B.
- Load model weights from a pinned local model directory/volume; never download model weights during a command or silently switch to a metered provider. Expose readiness, load time, inference time, memory, CPU, and queue metrics.
- Model inference is subject to bounded concurrency, queue depth, request timeout, and overload responses even when there is no external provider API rate limit.
- TTS text cap is 500 characters. Split or reject longer messages from `/tts` using a documented policy; do not let an unbounded backlog form.
- Keep Qwen voice-cloning reference audio, transcript, model/license notices, and deployment provenance together. Do not represent generated audio as official game dialogue or a specific actor's original recording.

## Robin — music only

Required commands: `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/shuffle`, `/loop`, `/volume`, and `/disconnect`.

Remove `/search`, `/nowplaying`, `/seek`, `/autoplay`, `/claimmaster`, and `/masters` as separate slash commands. Any required queue selection or DJ authorization can be part of the listed commands' interaction flow, but must not create additional public commands unless the owner approves a spec change.

## Cipher — services and payments

Required commands:

- `/orders` for service order creation/list/status flows, with the exact subcommand structure to follow the existing secure order model.
- `/referral link`, `/referral redeem`, and `/referral status`.
- `/payment` for the configured payment options/status flow.

Payment methods:

- UPI: generate a QR for the server-authoritative amount and payee. A QR or submitted proof is not payment confirmation.
- Razorpay: support card and wallet checkout using Razorpay's hosted/official checkout flow, server-side order creation, signature verification, webhook verification, idempotent settlement, and reconciliation. Start in sandbox/test mode; never make a real charge during development or verification.

Order and referral reads/writes must be scoped to the requesting buyer and guild, with staff-only settlement and one authoritative transactional fulfillment service.

## SilverWolf — games and economy

Required commands: `/rank`, `/cards`, `/inventory`, `/balance`, `/packs`, `/open`, `/buy`, `/sell`, `/market`, and `/trade`.

No separate `/play`, `/deck`, `/hand`, `/score`, `/cardinfo`, `/cardstats`, `/trades`, `/unlist`, or `/cardadmin` command is in the requested surface. Keep internal operations only if needed by the specified flows and do not expose extra slash commands without approval.

## Himiko — announcements, community, and levels

Required commands:

- `/announcement` and `/embed`
- welcome and leave setup commands
- `/leaderboard` and level-up configuration/status commands as needed for the specified feature

Functions: deliver welcome/leave messages; award experience from text participation and eligible voice-channel participation; issue level-up announcements; display the leaderboard. XP awards require cooldowns and anti-farming rules and must ignore bots. Voice XP must exclude AFK/empty channels and avoid awarding for self-deafened members; persist progress transactionally.

## VPS and local model capacity

The checked-in benchmark describes a 10-vCPU, approximately 63-GiB RAM VPS, with no AVX/AVX2/AES-NI/SSE4.2, and records a previous aggregate Ei Point allocation of 5 CPU cores and 24 GiB. The newer project envelope is 8 CPU cores and 40 GiB, leaving host reserve. Re-measure the current VPS before deployment; do not treat old measurements as live state.

The project owner proposes keeping the VPS running except for a planned monthly restart. Model services should start at boot and preload pinned local weights, so ordinary requests use a warm process. A cold service restart includes model load time; no reliable duration is promised until measured on this CPU-only target with the actual model files and selected runtime. Compare boot/load time, time-to-first-audio, real-time factor for 500 characters, translation latency, peak RSS, and concurrent bot latency. Reject a model/runtime combination that violates the service budgets or starves Discord/API workloads.

Local inference removes third-party inference API quotas from these two features; it does not remove local CPU/memory contention, software/runtime failures, queue limits, or the need for timeouts and overload handling.

## API-key requirement count

The supplied `EI_POINT_COMPLETION_BUILD_PLAN.md` names **zero specific third-party API keys** as required configuration. It refers to external credentials generally, without listing a provider or key count. The existing `.env.example` has three optional provider-key slots (`AI_PROVIDER_PRIMARY_KEY`, `AI_PROVIDER_FALLBACK_KEY`, and `TTS_PROVIDER_KEY`); those are current implementation configuration, not key requirements stated in the supplied plan. The plan separately calls for Discord bot tokens and deployment secrets, which are not API-key requirements. Local Qwen TTS and Hy-MT2 translation should not need a metered inference-provider key.

## Implementation gates

| Area | Required evidence before marking complete |
|---|---|
| Commands | Registered command JSON matches this list exactly for every bot; removed commands are absent; permission tests cover every Kafka root/subcommand/callback. |
| Common embeds | Every bot's command, error, mention, and event reply is an embed with the configured image; non-Kafka output is public except user/order data that must be private. |
| Cyrene chat | Mention-only trigger, supplied persona context, guild/user isolation, bounded history, and no old chat slash commands. |
| Cyrene TTS | Target-VPS CPU-only benchmark, 500-character cap, model preloaded at service start, warm/cold timings, error handling, channel attachment, and idle-member departure. |
| Translation | Hy-MT2 1.8B target-VPS CPU-only benchmark and language/quality acceptance for the actual supported use cases. |
| Kafka | Real disposable-guild tests for each sanction, temporary expiry, permission denial, partial Discord failure, retry, and audit record. |
| Payments | Razorpay sandbox card/wallet checkout plus signature/webhook/idempotency tests; UPI QR amount/payee validation; never claim a payment from a client redirect alone. |
| Levels | Text and voice XP cooldown/farming tests, empty/AFK/deaf exclusions, level-up delivery, and leaderboard consistency. |
| Release | Build and startup with pinned local models on the benchmark VPS, with CPU/RAM budgets recalculated against the 8-core/40-GiB project cap. |

## Implementation status snapshot

This table reflects repository work in progress. A slash command appearing in source does not count as accepted until its handler and the evidence above are complete.

| Area | Status | Current evidence or remaining work |
|---|---|---|
| Shared `/botinfo`, `/ping`, `/about` | Partial | Registered in the six bot command arrays; identity-specific details, owner mention, and runtime behavior still need per-bot acceptance. |
| Common embed replies | Partial | Shared TypeScript interaction wrapper is in place; outbound event messages and Robin's direct response paths still need conversion and verification. |
| Kafka permissions | Partial | Administrator default command permissions and owner-or-Administrator interaction gate are in place; authorization tests and every callback path remain open. |
| Cyrene `/tts` session | Partial | Reads new messages from the joined voice channel's text chat, caps each message at 500 characters, bounds the queue, and leaves after humans exit; it still uses the configured HTTP TTS endpoint rather than the required pinned local Qwen service. |
| Cyrene `/speak` and `/search` | Partial | The command surface is registered; local audio model/service and an approved search provider have not passed acceptance. |
| Robin | Partial | Requested common commands are added and disallowed slash commands are removed from sync; several older direct responses still bypass embed formatting. |
| Cipher | Partial | `/orders` and `/payment` plus one-time transactional referral redemption are implemented. `/orders list` lists the service catalog rather than the caller's order history; Razorpay card/wallet checkout, webhook verification, and sandbox acceptance remain open. |
| SilverWolf | Partial | Requested game/economy commands are now the registered allowlist; integration tests and common reply/event formatting remain open. |
| Himiko | Not complete | Announcements/embed exist; welcome/leave setup and text/voice XP/leaderboard functions still live elsewhere or are missing from Himiko. |
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
| `/timeout` | Apply a bounded member timeout and record expiry metadata. |
| `/timeout remove` | Remove an active timeout. |
| `/warn` | Add a warning case for a member. |
| `/warn remove` | Remove or void a warning case with an audit reason. |
| `/purge` | Bulk-delete eligible recent messages and report the confirmed count. |
| `/temp ban` | Ban a user until a durable expiry is reached. |
| `/temp restriction` | Apply a configured temporary channel/role restriction and expiry. |
| `/temp role` | Assign a role until a durable expiry is reached. |
| `/temp mute` | Apply a mute restriction until a durable expiry is reached. |
| `/security` | Inspect security posture, lockdown, trust, whitelist, snapshots, and incidents. |

All Kafka rows above are owner-or-Administrator only. Temporary actions need retries and reconciliation; do not treat a queued expiry as a completed Discord action.

### Cyrene

| Command or trigger | Function |
|---|---|
| Direct mention | Continue a private per-user/per-guild conversation in character. |
| `/speak <text>` | Generate one audio file (maximum 500 characters) and attach it to the command response. |
| `/tts` | Join the caller's voice channel and speak new messages from that voice channel's text chat. |
| `/leave` | End the active Cyrene voice session immediately. |
| `/search` | Search the agreed source and summarize/link results. |

### Robin

| Command | Function |
|---|---|
| `/play` | Resolve a track and add it to the guild queue. |
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
| `/orders` | Create an order, check the caller's order, or list the caller's orders. |
| `/referral link` | Create or display the caller's referral link. |
| `/referral redeem` | Redeem a valid referral code with one-time transactional rules. |
| `/referral status` | Show the caller's referral progress and rewards. |
| `/payment` | Display UPI QR/payment instructions or start/status-check Razorpay hosted checkout. |

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
| Welcome setup | Choose the welcome channel and message template. |
| Leave setup | Choose the leave channel and message template. |
| Text message | Award XP to eligible human members subject to cooldown and anti-farming rules. |
| Voice membership | Award XP only to eligible, non-AFK, non-self-deafened participants in non-empty voice channels. |
| Level-up event | Send a level notification to the configured channel. |
| `/leaderboard` | Display the top members by XP. |
