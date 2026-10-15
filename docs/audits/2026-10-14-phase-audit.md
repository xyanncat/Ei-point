# Ei Point — project audit by build phase

Audit date: 2026-10-14, Asia/Riyadh. Checkout: `E:\github\Ei Point`, HEAD `4958410`.

**Overall phase readiness: 43/100 (equal-weight average 42.7). Release decision: hold production cutover.** This is an engineering assessment, not a statistical reliability measurement or a percentage of lines completed. Existing phase-gate checkmarks overstate operational completion in several areas.

## Scope and method

Compared the ten phases and mandatory acceptance tests in `project assets/cred/EI_POINT_VPS_BUILD_PLAN.md` against source code, migrations, dependency manifests, current build/test results, infrastructure scripts, and archive inventories. Read the benchmark, including its newer post-reinstall section. Used verification-before-completion, systematic-debugging and deep-research; independent read-only reviews covered runtime/protection/economy, web/commerce, and AI/music/operations. Parent verified key paths and ran fresh checks.

Scores use **implementation/correctness /50 + verification /30 + phase acceptance evidence /20**. Passing tests earn verification credit only for the behavior exercised. Plans, comments and helper functions do not establish working Discord effects, disaster recovery or production readiness. Phase 1 can earn acceptance credit from source traceability; deployment-dependent phases receive no current live acceptance credit without evidence for this release. Historical target-VPS test results in the benchmark are acknowledged, but do not prove current images, real Discord/voice behavior, restore targets or launch acceptance.

No production deployment, real payment, provider request, Discord message, destructive recovery or application fix was performed. Test databases were disposable local PostgreSQL instances. Docker and Bash were unavailable in this Windows shell, so container builds, Compose execution, shell execution, Linux validation and live VPS measurement were not performed. Existing ignored browser scripts exercised mocked APIs, not production authorization or financial transfers. This is a repository-wide engineering audit, not an exhaustive penetration test or a proof of complete absence of vulnerabilities.

## Phase scores

| Phase | Implementation /50 | Verification /30 | Acceptance /20 | Score /100 | Assessment |
|---|---:|---:|---:|---:|---|
| 1 Feature/failure inventory | 28 | 14 | 12 | **54** | Useful inventory, but completeness claim lacks granular source/test traceability |
| 2 Foundation | 32 | 16 | 0 | **48** | Local monorepo works; fresh API image build prerequisites and release setup incomplete |
| 3 Reliable runtime | 27 | 14 | 0 | **41** | Shared helpers tested, but deadlines and general job execution are incomplete |
| 4 Dashboard foundation | 42 | 23 | 0 | **65** | Strong local OAuth/UI foundation; status mapping, dependency and live acceptance gaps |
| 5 Protection modules | 23 | 8 | 0 | **31** | Substantial code exists, but operational lockdown/recovery and authorization gaps remain |
| 6 Community/economy | 44 | 24 | 0 | **68** | Strongest transaction and runtime evidence; real Discord/load/crash gates remain |
| 7 Commerce/website | 32 | 19 | 0 | **51** | Website API is stronger than Discord commerce; divergent financial paths block completion |
| 8 AI/music/TTS | 25 | 10 | 0 | **35** | Provider failure handling and media/runtime prerequisites block intended behavior |
| 9 Operations | 19 | 3 | 0 | **22** | Scripts exist, but restore certification, backup integration and readiness gates are unsafe |
| 10 Staging/launch | 10 | 2 | 0 | **12** | Fleet/profile wiring and measured launch acceptance are incomplete |

No phase is certified production-complete by this audit. The scores are deliberately stricter than prior conversational status summaries.

## Fresh verification

| Check | Result | Limits |
|---|---|---|
| `pnpm test` | Exit 0; **124 Node tests** across reported suite totals | Includes real PG transactions; lacks several bot dispatcher and failure-boundary checks described below |
| `pnpm typecheck` | Exit 0 | Does not verify clean Docker dependency build order or Discord/media behavior |
| `pnpm build` | Exit 0, including Next.js 14.2.35 production build | Existing workspace dependencies/build outputs; not a clean Linux image build |
| `python -m unittest discover -s apps/bots/music-py/tests -v` | Exit 0; **12 tests** | Queue/service model tests, not real voice or SQL snapshot restart tests |
| `node tmp/workspace-controls-qa.cjs` | Exit 0 | Mocked config CSRF/version persistence and admin CRUD; desktop/mobile |
| `node tmp/checkout-qa.cjs` | Exit 0 | Mocked UPI/USDT create/claim/status, local PNG QR, input constraints, focus/mobile |
| `node tmp/commerce-guild-qa.cjs` | Exit 0 | Late response cannot overwrite current browser guild; does not validate Discord bot order scoping |
| `node tmp/audit-2026-10-14/reproduce.mjs` | Exit 0, both defect assertions reproduced | Injected commerce pool and isolated lifecycle; no external effects |
| `pnpm audit --prod --json` | Exit 1; **44 advisories: 2 critical, 15 high, 21 moderate, 6 low** | Package matches, not 44 proven exploitable application vulnerabilities |

Raw output and reproduction harness: `tmp/audit-2026-10-14/` (ignored local evidence; not a permanent versioned CI artifact). Local Node was 24.21.0 rather than pinned 24.8.0; pnpm 9.12.0 emitted engine warnings. No tests failed in the completed suite.

## Findings by phase

### Phase 1 — inventory

**P2: the COMPLETE label is not supported by an exhaustive acceptance matrix.** `docs/feature-matrix.md:5` claims all three archives are fully inventoried, but its 54 grouped rows do not link every original command/subcommand/component to a source location and an executable acceptance test. A read-only ZIP scan found 30 source files in Ei Paradise, 287 in EI-point and 22 in swish, excluding dependencies/caches. Original command builders contain names such as hand/deck/score/capture that are not individually accounted for by the current matrix. This scan is supporting evidence, not itself a full semantic inventory. `docs/legacy-web-source-inventory.json` is a valuable hashed website inventory, not a complete bot inventory.

To close: record source file/symbol, retained behavior, new handler and concrete test for each item; explicitly mark intentionally omitted behavior and operator decisions. Update old contradictory records, including Phase 6's statement that archive sources/services are absent despite the 19 service definitions now present.

### Phase 2 — foundation

**P1: clean API Docker build omits a required workspace build.** `apps/api/Dockerfile:5` builds contracts and API, but not `@ei-point/flow`; `apps/api/src/app.ts` and the control consumer import that package. Its exports require `packages/flow/dist`, excluded by `.dockerignore` and not tracked. The successful root workspace build hides this prerequisite. Static clean-image blocker; Docker execution was unavailable, so the resulting container/compiler failure was not directly reproduced.

Compose has resource/network boundaries and explicit DNS; migrations have a ledger and advisory lock. However, `infra/postgres/roles.sql` is an operator-applied step rather than a mounted bootstrap step; a fresh deployment must create/password/grant the application login before applications connect. The production overlay still contains `REPLACE_ME` images. A clean release build/start proof on the benchmark CPU remains required.

### Phase 3 — reliable runtime

**P1: deadline is cooperative rather than enforced.** `packages/flow/src/lifecycle.ts:62` starts an abort timer and then directly awaits work. A callback that ignores its signal stays pending beyond deadline. The isolated reproduction used a five-millisecond deadline and observed pending work after fifty milliseconds. Existing timeout tests cover only cooperative rejection. Production bots implement separate dispatchers rather than consistently using this lifecycle.

**P2: generic durable jobs cannot succeed.** `apps/workers/src/index.ts:103` throws `no-handler` for every non-dashboard-embed job. Leasing/retry bookkeeping is not domain job execution. Community has its own working notification consumer, but the general outbox/runtime is incomplete.

**P1: control enforcement differs by bot.** Community consumes approved registry state, pause/enable flags and command roles. Kafka, Himiko and commerce do not consistently apply these checks; environment allowlisting alone does not enforce an administrator's later pause or approval revocation. See phases 5 and 7.

### Phase 4 — dashboard

Strengths: encrypted PostgreSQL sessions, expiring same-browser OAuth state, CSRF, current Discord membership checks, scoped guild access, responsive Kafka UI and explicit pending/runtime-applied configuration states. Fresh browser configuration/admin flows passed against mocks.

**P2: Cipher health cannot match its registry identity.** `apps/bots/commerce/src/index.ts:150` writes status as `bot-commerce`; `apps/api/src/app.ts:350` resolves the registered `cipher` identity as `bot-cipher` or `cipher`. A running bot can remain unknown in the dashboard.

**P1 release issue: dependency advisories require triage and patching.** The current production dependency audit reports the severity totals above. Next.js 14.2.35 matches two critical advisories. One is conditional on Windows-hosted servers; the other concerns AVIF image optimization. Debian is not affected by the Windows-specific condition, and the audit did not demonstrate reachable AVIF exploitation. Do not equate dependency presence with a proven exploit, but do not certify release without assessing and resolving the matches. Vendor sources are below.

To close: patch/triage dependency matches, test current identities' real heartbeat/status mapping, live OAuth/role revocation and Linux standalone images. Browser mocks do not establish these properties.

### Phase 5 — protection

**P1: ordinary members can read internal moderation notes.** `apps/bots/moderation/src/commands.ts:237` handles `/cases` without the staff check used by note creation at line 263. Case output includes reasons from staff-only notes. Kafka imports the same dispatcher.

**P1: lockdown is reported without Discord enforcement.** `apps/bots/security/src/commands.ts:148` writes database state and reports ENGAGED; Kafka's raid path at `apps/bots/kafka/src/index.ts:116` also records state. No consumer was found applying the corresponding channel permissions/verification settings. A database flag is not an operational lockdown.

**P1: external moderation effects precede durable audit recording.** `apps/bots/moderation/src/commands.ts:164` bans before inserting the case; analogous order exists for timeout, unban and purge. A database failure after Discord succeeds leaves a real sanction without its durable case; generic safe-failure responses become misleading. Idempotency keys use time/randomness rather than the stable interaction key at line 119.

**P2: recovery/trust/expiry remain incomplete.** Security snapshots at `apps/bots/security/src/commands.ts:247` capture IDs/names without full channel overwrites/types or role permissions; restore is a planner, not an executor. `UPSERT_TRUST_SQL` has no runtime scoring consumer. Kafka expiry handling at `apps/bots/kafka/src/index.ts:410` clears expiry after swallowing unban errors, preventing a later retry.

### Phase 6 — community/economy

This is the strongest implemented phase. The real-PG suite tests competing buyers, receipt idempotency, two-party trade concurrency, finite issuance and rollback. Community applies registry authorization and control guards; supported config installs and acknowledgements are transactional. Fresh suite: 18 Phase 6 tests plus 4 controls tests passed.

Remaining acceptance: actual artwork/catalog drops (current generated card count is zero), full archived-command mapping, real Discord permissions/delivery, service-kill mid-write/restart tests, measured two-guild latency and complete-fleet voice/load coexistence. Transaction rollback injection is valuable but is not a process-kill recovery drill.

### Phase 7 — commerce/website

**P1: Discord commerce order access is not scoped to the target order.** `apps/bots/commerce/src/commands.ts:159` reads status by UUID alone, disclosing buyer/order fields to ordinary callers. Claim at line 187 and settlement at line 226 pass only UUID to helpers; `packages/modules/commerce/src/index.ts:89` locks by UUID without target guild/buyer validation. Staff privilege in one guild does not authorize another guild's order. The status disclosure was reproduced using an injected pool returning another buyer/guild's order. Claims/settlements were confirmed by tracing the absent guards, not by mutating production records.

**P1: bot and website fulfillment disagree.** Bot creation at `commands.ts:119` omits membership snapshot fields; bot settlement changes settlement/order state but does not apply the website API's memberships, referral credits and confirmed claim transition. A paid membership can be settled through Discord without activation. Consolidate onto one authoritative transactional commerce service.

**P1: commerce ignores dashboard pause and registry identity checks.** `apps/bots/commerce/src/index.ts:85` uses the environment allowlist; readiness is enabled unconditionally at line 204. It does not enforce database guild approval, per-bot pause or command-role settings before side effects.

**P2: referrals break across website navigation.** Bot link at `commands.ts:267` uses `/referrals?code=...`; checkout at `apps/dashboard/components/checkout.tsx:9` reads `ref` on the checkout page. The static referrals page does not capture/forward the code, losing attribution when following the advertised link.

**P2: public rate limiting uses proxy IP.** `apps/api/src/commerce-routes.ts:35` hashes `req.ip`, but Fastify construction does not establish a trusted proxy boundary. Behind nginx visitors share the proxy's 30/minute bucket. Configure narrowly trusted proxies rather than trusting arbitrary forwarded headers.

**P2: lost create response is not recoverable.** `commerce-routes.ts:58` returns a conflict for an identical idempotent retry; the raw order token existed only in the lost response. Checkout retains the retry key. Test committed creation with a dropped response and provide secure recovery semantics.

Strengths: API-owned prices, hashed tokens, exact Origin checks, proof uniqueness, row-locked settlement and real-PG membership/referral tests. These do not cover the separate Discord dispatcher paths.

### Phase 8 — AI/music/TTS

**P1: deployed AI is not wired to providers and masks failures.** Compose's AI environment at `infra/docker/compose.yml:192` omits the provider URL/key variables read by `apps/bots/ai/src/index.ts:157`. The adapter at lines 133–153 also converts provider HTTP/network failures into simulated successful replies; the router only falls back on thrown errors. Simulated output can be recorded as real usage. This violates the explicit provider-failure behavior required by the plan.

**P1: voice dependencies/intents are incomplete.** `apps/bots/music-py/requirements.txt:1` installs plain discord.py without its voice dependency PyNaCl. AI gateway intents at `apps/bots/ai/src/index.ts:174` omit GuildVoiceStates. Its runtime Docker image has no FFmpeg installation and package manifest has no Opus encoder dependency for arbitrary MP3 playback. Type checks and queue tests do not prove audible playback.

**P1: SQL queue snapshots lose current track index.** `apps/bots/music-py/src/main.py:169` persists queue and milliseconds without `queue.position`; restoration at line 223 likewise omits it. `queue_state.py:103` defaults to index zero. Reboot on a later track can replay the first track using the later track's offset. Pure in-memory round-trip tests miss this boundary.

**P2: memory, budget and media limits remain incomplete.** AI thread SQL returns thread_id while caller expects summary; no summary generation exists. Usage check then provider call then usage insert lacks concurrent budget reservation. Music metadata resolution has no enforced outer deadline, `download=False` does not implement the described bounded media cache, and persisted playback offset advances during pauses. Shared two-voice-session limit across AI TTS and music needs end-to-end proof.

### Phase 9 — operations

**P1: restore drill can certify a backup it never restored.** `scripts/restore-drill.sh:32` applies migrations to an empty database and later copies source service definitions. It reads neither DB backup/WAL nor restic artwork, and does not compare restored data checksums. Nevertheless line 64 records a full restore PASS with RPO <=5m. It also lacks a bounded readiness wait, SQL ON_ERROR_STOP, and enforced RTO threshold. Do not use its output as recovery evidence.

**P1: five-minute DB recovery is not wired.** `infra/docker/compose.yml:8` explicitly leaves WAL archiving disabled. There is no configured archive command or installed/mounted pgBackRest integration. Local logical dumps every six hours provide a different, weaker recovery tier. PostgreSQL's documented continuous recovery requires base backups and a continuous archived WAL sequence, not schema recreation or pg_dump alone.

**P1: deployment health and rollback are misleading.** `scripts/health-fleet.sh:34` checks liveness, not readiness; it can accept bots without gateway/DB availability. The DB section prints records without freshness enforcement. `scripts/deploy.sh:39` uses base Compose without the production overlay, build instruction or cutover profile. Line 53's down/up advice does not select a prior release and introduces downtime. The production overlay still has placeholder images and omits consolidated Kafka/Himiko.

**P2: watchdog and backup storage mismatches.** Watchdog container matching lacks a project label and can select another project's similarly named service. It omits cutover bots and skips missing ones. Its low-disk marker has no consumer. Off-host restic paths do not match Compose's named artwork volume/default local config location; no installed timer/bridge is evidenced. Current docs/recovery-drills.md records no actual drills.

### Phase 10 — staging/launch

**P1: overlapping Kafka identities in the default deployment.** `infra/docker/compose.yml:122` and line 146 start separate security/moderation processes with the same Kafka token. Both replace the guild command set, so the last registration wins; two gateways may also handle the same identity. Consolidated Kafka and Himiko are behind the cutover profile, whose enablement does not itself stop the legacy pair. The deploy script does not perform this handover.

No inspected evidence proves current release image compatibility on qemu64, twenty concurrent interactions with two voice sessions, required acknowledgement percentiles, 72-hour soak, real backup restoration or verified main-guild cutover. The newer benchmark documents successful VPS tests and improved network measurements; those are useful historical evidence, not substitutes for these launch gates.

## Recommended repair order and acceptance

1. Fix order-level guild/buyer authorization and share website/bot settlement semantics. Add ordinary-member, cross-guild staff and Discord-membership fulfillment tests against real PG.
2. Close moderation note disclosure; enforce registry approval, application identity, pause and command roles consistently across all bots.
3. Triage production dependency advisories and upgrade affected packages; rebuild and regression-test the resulting supported framework/runtime combination.
4. Make release images reproducible, choose one Kafka process, include Himiko deliberately and use real pinned release references. Verify clean Docker builds rather than warmed local outputs.
5. Implement actual protection effects/recovery, durable moderation intent/audit handling and bounded lifecycle/job execution with non-cooperative failure tests.
6. Wire real AI failures/fallback and media prerequisites; test the SQL music snapshot boundary, budgets, voice limits and audible TTS/music on the target CPU.
7. Replace simulated restore certification with actual isolated backup+WAL/files restore and measured integrity/RPO/RTO. Wire readiness-aware health, bounded project-scoped watchdog and real rollback.
8. Only then run two-guild load, fault injection and 72-hour staging soak; re-score using captured evidence before cutover.

## Primary reference checks

- Build scope: [EI_POINT_VPS_BUILD_PLAN.md](../../project%20assets/cred/EI_POINT_VPS_BUILD_PLAN.md), phase definitions and mandatory acceptance tests.
- Hardware/history: [VPS_BENCHMARK.md](../../project%20assets/cred/VPS_BENCHMARK.md), including the newer post-reinstall measurements and recorded VPS tests.
- PostgreSQL requirements: [PostgreSQL 17 continuous archiving](https://www.postgresql.org/docs/17/continuous-archiving.html). Requires archive_mode, archive_command/library and usable backup/WAL sequence.
- Deployment semantics: [Docker Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/). Running containers are not necessarily ready; service_healthy needs an appropriate health check.
- Conditional framework risks: [Next.js Windows-hosted RCE advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [Next.js AVIF optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4). Vendor conditions must be checked against actual deployment; exploits were not attempted.
