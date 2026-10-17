# Ei Point audit + benchmark — 765 / 1,000

**Date:** 2026-10-17 (Asia/Riyadh). **Re-scored revision:** `82cf98e` on `feat/completion-plan`, plus this audit round's remediation commit (phantom dependency pin, qwen gate wiring, strict-coverage promotion). **Supersedes:** the 2026-10-15 audit at 615/1,000 (revision `9864875`). Reference: [EI_POINT_COMPLETION_BUILD_PLAN.md](EI_POINT_COMPLETION_BUILD_PLAN.md) §14 rules; original findings `docs/audits/2026-10-15-project-audit-1000.md` (A01–A20).

Scores are engineering judgments against requirements and observed fresh evidence, not a percentage of code written. Every number below was produced by a command run during this audit (see the benchmark table) or by an observed GitHub Actions run on this branch.

## Scoring method (unchanged rubric)

Each of the ten phases receives 100 points: required behavior/coverage 30, correctness and access/data integrity 25, failure/recovery behavior 20, operational acceptance 15 (up to 5 executable preparation, up to 10 observed acceptance in the required environment), reproducible evidence/documentation 10. Phase 1 uses its actual coverage gate (now the **release-mode** gate) as its acceptance environment. Partial credit reflects working subsets; an unresolved required behavior or an integrity/recovery blocker keeps a phase incomplete regardless of score.

## Scores

| Phase | Coverage /30 | Correctness /25 | Recovery /20 | Operations /15 | Evidence /10 | Score /100 | Was |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1. Inventory and feature mapping | 24 | 20 | 12 | 8 | 9 | **73** | 52 |
| 2. Foundation, builds and local database | 27 | 23 | 18 | 10 | 9 | **87** | 70 |
| 3. Shared runtime and dispatch | 24 | 20 | 16 | 5 | 9 | **74** | 62 |
| 4. Dashboard and public website | 28 | 23 | 17 | 5 | 8 | **81** | 70 |
| 5. Security and moderation | 27 | 22 | 17 | 4 | 9 | **79** | 63 |
| 6. Community, cards and economy | 27 | 21 | 17 | 5 | 8 | **78** | 74 |
| 7. Commerce, referrals and membership | 28 | 23 | 17 | 5 | 9 | **82** | 59 |
| 8. AI, persistent memory, music and voice | 27 | 22 | 16 | 4 | 9 | **78** | 61 |
| 9. Deployment operations and recovery | 28 | 23 | 16 | 5 | 9 | **81** | 64 |
| 10. Staging and launch qualification | 17 | 12 | 9 | 5 | 9 | **52** | 40 |
| **Total** | **257 /300** | **209 /250** | **155 /200** | **56 /150** | **88 /100** | **765 /1,000** | 615 |

**1,000 still requires every required acceptance gate** — the remaining 235 points are concentrated in live-environment acceptance (VPS, Discord, models, payment, load/soak), not in local code.

## Why each phase moved

1. **Inventory (52→73).** The behavior map is fully reconciled: 179 rows — **86 `verified`, 93 `replaced` (approved decisions), zero `decision-required`** — and the strict release-mode gate passes (`check-feature-coverage.mjs --mode release`, exit 0, fresh). Per the rubric the release-mode gate *is* this phase's acceptance environment, so observed acceptance credit is earned. Held below full: human tracing of dynamic/component behavior remains bounded by the recorded references, and the archived source snapshot is historical.
2. **Foundation (70→87).** Envelope re-baselined to the owner's 9-CPU ceiling (RAM/disk uncapped, single-project host; `2e3f7d0`), aggregate enforcement wired into deploy with over-budget rejection (`check-resource-budget.mjs`, 8/8 tests). §2B complete: aggregate verifier with separate results and **blocked ≠ passed** (exit 0/1/2), CI on pinned `.nvmrc` Node + frozen lockfile, migration runner hardened (advisory lock before ledger bootstrap; fresh DB, upgrade-from-partial, rolled-back-failure, concurrent-runner serialization all proven on real PostgreSQL, 5/5). **Observed acceptance:** the GitHub Actions `verify` job passed 5× on `feat/completion-plan` (2m38s–3m50s), including on Linux the new `pnpm build`, `pnpm lint` and openapi-sync steps. Held below full: the new `images` job failed on its first run (see B01 — fixed this round, re-verification pending), and live cgroup membership is a VPS item.
3. **Runtime (62→74).** Lifecycle semantics repaired and machine-tested: defer/authorization/one-edit-reply, late-commit fencing, timed-out work keeping capacity, duplicate-interaction refusal, flood bounding, shutdown drain (`tests/runtime/dispatch.test.mjs` 9/9). Per-identity/operation visibility policy with router assertions (A08). Held: Kafka, AI and the Python music bot still run their own dispatch paths instead of the shared lifecycle.
4. **Website (70→81).** A13 checkout resume is owner/session-bound; A14 read vs settlement scope split with a reader/staff/admin/anonymous matrix; A15 verification goes through a token-authenticated internal lookup with a five-second deadline and per-client throttling; A16 buyer-scoped order history with autocompleting create. Browser suite expanded to 16 scenarios (verification states, guild-switch race, sign-in gate, CSRF, overflow, reduced motion) and runs in the aggregate gate. Held: live staging OAuth return, real multi-client throttling and ingress acceptance remain VPS/10B items.
5. **Protection (63→79).** A05 expiry acknowledges only confirmed absence; A06 generation-owned sanctions with supersede/advisory-lock serialization; A07 leased, backoff-scheduled, dead-lettered expiry pump (all with reproduced-failure tests, plus the `48bd3cc` fix pass). Held: Kafka/moderation/music not on shared dispatch; live disposable-guild recovery unobserved.
6. **Economy (74→78).** A11 closed: cancellation reachable through owner-scoped `/sell`, idempotent on repeats; dead `/unlist` removed. Held: live delivery, legacy catalog reconciliation breadth.
7. **Commerce (59→82).** 7B pivot: hosted Razorpay page + staff-verified payment reference; API-key/webhook machinery deleted (`a224385`). 7C: whole-row referral credit with settlement-month attribution (boundary-tested), reward reservation/redemption/pay-once SQL, durable staff notifications (enabled/disabled/misconfigured), membership revoke/expiry/permission-loss, buyer-scoped history with a working claim handoff. Review rounds fixed a backout regression (exact-set tests). Held: live payment acceptance and staff Discord approval are deployment items.
8. **AI/voice (61→78).** A09 hard inference supervision with degraded readiness and bounded recovery; A17 `/search` answers through the AI conversation contract (persona, budget, honest unavailable states — DB-tested); A18 every Robin reply routed through the embed/image helper, machine-enforced (no raw interaction send outside `respond()`), FFmpeg reconnect/failure routing tested; voice join/leave/disabled/overflow/no-transcription contracts tested. Qwen suite 16/16 (one transient in ten runs — B03). Held: real model execution on the no-AVX host, voice intelligibility, live Discord audio.
9. **Operations (64→81).** A03 roster-safe manifests (13/13); A19 durable-asset inventory machine-checked and wired into restic with fail-closed behavior (a review round caught and fixed a pgbackrest regression with exact-set tests); restore drills persist a dated record and `ops-report` surfaces backup freshness, **restore age**, queue lag, delivery failures and heartbeats (zero rows = breach, not healthy); watchdog/deploy/rollback/lock behaviors tested; evidence bundles retained per release. Held: measured off-host/PITR drills, cold reboot, DNS/credential loss, model-startup failure on the VPS.
10. **Staging/launch (40→52).** 10A complete locally: aggregate verifier + retained evidence bundles (revision, dirty state derived from observed tree state, toolchain, timestamps, per-gate exits, sanitized log hashes) + mandatory openapi-sync gate; recorded npm audit triaged to a real fix (`@playwright/test` 1.64.1, GHSA-7mvr-c777-76hp); 10B bullet 1 complete (`docs/operations/load-profile.md` — explicit peaks recorded before testing, hard limits cited from code); strict release coverage now a mandatory green gate. Held: the phase's core is live — no peak/2×-peak load runs, failure-injection campaign, 72-hour soak, staging cutover or rollback drill on the target VPS, and no authorized cutover.

## Fresh benchmark — commands, exits, counts (2026-10-17)

Aggregate evidence bundle: `docs/audits/releases/20261017T000749Z-82cf98e3-dirty` (verifier exit 0; 1,266 s wall). Linux CI observed: `verify` workflow on `feat/completion-plan` — 5 completed successes (latest passing run includes build+lint+openapi-sync), 1 failure isolated to the `images` job (B01).

| Check | Fresh result |
|---|---|
| Root `pnpm test` (contracts/flow/−r packages, phase6 22/22, phase4 18/18, combined final group **100/100**) | exit 0 |
| `pnpm typecheck` / `pnpm build` / `pnpm lint` | exit 0 locally; build+lint also green on Linux CI |
| Browser acceptance (`pnpm test:browser`, Edge/Playwright 1.64.1) | **16/16**, exit 0 |
| Python music suite (`apps/bots/music-py`) | **28/28**, exit 0 (now a mandatory verifier gate + CI step) |
| Python qwen TTS suite (`apps/services/qwen-tts`) | **16/16**, exit 0 (one transient failure in 10 runs — B03; now a mandatory verifier gate + CI step) |
| `node --test tests/feature-coverage.test.mjs` | exit 0 |
| `node scripts/check-feature-coverage.mjs --mode structural` | PASS — 179 rows valid |
| `node scripts/check-feature-coverage.mjs --mode release` (now mandatory) | **PASS** — 86 verified + 93 approved replacements |
| `node scripts/inventory-archives.mjs --self-test` | 8 checks, exit 0 |
| `node scripts/check-resource-budget.mjs` | exit 0 — runtime 7.45 CPU / 32.5 GiB; concurrent 7.95 / 33.75 under the **9-CPU** ceiling (owner envelope 2026-10-16) |
| `pnpm audit --prod --json` | clean, 198 production dependencies (post playwright upgrade) |
| Operations suites | migrations 5/5, verify-project 8/8, ops-report 8/8, backup 9/9, durable-assets 8/8, resource-budget 8/8 |
| Bot/module suites (this branch) | api 71/71, bot-commerce 12/12, module-commerce 17/17, bot-ai 19/19 |
| pip-audit / container+OS scan | recorded **blocked** — scanner absent locally; pip-audit installs in CI; no container scanner configured yet |
| All tracked shell entrypoints (`bash -n`) | pass (backup scripts, restore drill, restic) |
| GitHub Actions `verify` (Linux) | observed 5× success; `images` job failure fixed this round, re-run pending |

## A01–A20 remediation status

| ID | Status | Evidence |
|---|---|---|
| A01 coverage gate | **Fixed** | 179 rows: 86 verified, 93 approved replacements; release-mode gate exit 0 (promoted to mandatory this round) |
| A02 resource envelope | **Fixed (owner re-baseline)** | 9-CPU ceiling, checker enforced, slice `CPUQuota=900%`, RAM/disk uncapped by owner decision; live cgroup membership = VPS item |
| A03 empty-roster crash | Fixed | Roster-safe manifests, 13/13 (earlier session) |
| A04 dispatch gaps | Partial | Fencing/admission fixed + tested; Kafka/AI/music adoption open |
| A05 expiry false-restore | Fixed | Reproduced-then-fixed with tests |
| A06 stale ban removal | Fixed | Generation ownership + advisory-lock serialization |
| A07 starvation/no backoff | Fixed | Leases, `next_attempt_at`, dead-letter (5A) |
| A08 reply visibility | Fixed | Identity/operation policy + router tests |
| A09 stuck-inference ready | Fixed | Hard deadline degrades readiness, bounded recovery (8A) |
| A10 GGUF manifest binding | Fixed | start-model.sh requires exactly the served file (8B) |
| A11 unreachable cancel | Fixed | Owner-scoped `/sell` cancel, dead handler removed (6A) |
| A12 Razorpay absent | **Fixed (pivot)** | Hosted page + staff-verified reference; API-key machinery deleted (7B) |
| A13 checkout memory-only | Fixed | Session-bound resume, owner-bound claims |
| A14 read/mutation scopes | Fixed | Reader vs settlement matrix |
| A15 SSR throttle/deadline | Fixed | Internal token lookup, 5 s deadline, per-client throttling |
| A16 orders/claim gaps | Fixed | Buyer-scoped history + working claim |
| A17 `/search` placeholder | Fixed | AI-model answers under the conversation contract (owner decision) |
| A18 raw Robin replies | Fixed | All paths via embed helper, machine-enforced; review rounds hardened it |
| A19 persona/reference recovery | **Fixed locally** | Machine-checked inventory wired into restic, fail-closed; measured off-host/PITR drills = VPS |
| A20 no CI/aggregate | Fixed | Verifier + workflow + retained evidence bundles |

## Security audit (applied skills: owasp-top-10, security-hardening, secrets-management, container-security, supply-chain-security; live pentest/load skills deferred — no running deployment)

- **A01 Access control:** reader/staff/admin/anonymous matrix tested end-to-end through real session wiring; membership revoke returns 403 `admin-required` for non-admins; checkout resume and claims are owner-bound; bots hard-lock to exactly two approved guilds and leave unapproved guilds. No IDOR path found in reviewed routes.
- **A02 Cryptographic failures:** no plaintext secrets in the repo (fresh pattern scan found only redaction-test fixtures); backups are encrypted off-host (restic) with 0600/0700 host permissions; session cookies and TLS terminate at the operator's ingress (deployment phase).
- **A03 Injection:** all SQL is parameterized (`$1` constants); music stream URLs pass `is_safe_url` (private/loopback/link-local/metadata ranges blocked, `test_is_safe_url_ssrf_protection`); TTS/translation inputs are bounded and secret-pattern-rejected; verifier spawns use argument arrays (shell only for `.cmd` shims, with an availability probe).
- **A04 Insecure design:** money paths are transactional (advisory locks, `FOR UPDATE`, whole-row credit, pay-once SQL); checkout rate-limited per client bucket (30/min); referer rewards cannot double-settle (idempotent settlement).
- **A05 Misconfiguration:** all diagnostics bind loopback only; DB/diagnostics ports never published; non-root users (uid 10001), `cap_drop: [ALL]`, `no-new-privileges`, read-only filesystems where possible in compose. Held: TLS/security headers are ingress-level and unverified until deployment.
- **A06 Vulnerable components:** `pnpm audit --prod` clean; one high advisory (playwright GHSA-7mvr-c777-76hp) triaged as CI-reachable and **fixed** by upgrade with the browser gate re-run; Python deps pinned (and this audit fixed one phantom pin, B01).
- **A07 Identification/authentication:** Discord OAuth sessions with expiry/revocation; CSRF gate on payment writes; client-typed buyer IDs refused.
- **A08 Data integrity:** immutable release manifests; per-file SHA-256 model manifests verified at service start; backup bundles hash-bound with traversal/size checks (`verifyBackup`); CI uses a frozen lockfile.
- **A09 Logging/monitoring:** `ops.diagnostic_events` with credential redaction; operator report surfaces breaches with exit codes; secrets never logged (asserted by tests).
- **A10 SSRF:** music URL allowlist; verification lookup is internal-only, token-authenticated, deadline-bounded, with edge-address forwarding so throttling stays per client.
- **Secrets management:** all credentials live only in the VPS `.env` (gitignored); the repo's `.env.example` documents keys; rotation remains declined by owner; secret scanning is the pattern scan + review rounds (no automated pre-commit hook yet — noted).
- **Container/supply chain:** base images pinned (`python:3.12-slim-bookworm`, `postgres:17.5`, `nginx:1.27.3-alpine`, `alpine:3.20`); `pnpm-lock.yaml` frozen in CI; model weights reprovisioned only from pinned revisions with verified checksums; SBOM generation and container scanning remain open (recorded blocked).

## Findings from this audit round

| ID | Priority | Finding | Disposition |
|---|---|---|---|
| B01 | P1 | `yt-dlp==2025.10.5` does not exist on PyPI — caught by the first real Linux `images` build (`ERROR: No matching distribution`); the pin had never been resolvable anywhere | **Fixed this round**: pinned `2025.10.22`; images job re-run pending on next push |
| B02 | P2 | §14 requires the qwen-tts suite separately, but it was absent from the verifier and CI; first gate wiring also ran it from the wrong cwd | **Fixed this round**: mandatory `python-qwen` gate with per-gate cwd support + CI step |
| B03 | P2 | One transient qwen-tts suite failure observed (1-in-10 runs), unreproduced since; timing-sensitive supervision tests are the likely class | Open — CI now runs the suite on every push; watch for recurrence |
| B04 | — | Strict release coverage was assumed still red (my reviewer's and my own stale assumption from the 2026-10-15 numbers) | Resolved: map fully reconciled; gate promoted to **mandatory** and green |
| B05 | P2 | Review follow-ups: end-to-end restic argument-composition test (assert the exact backup path set through a successful `restic snapshots` mock); generate CI steps from `gatePlan` to end gate-list drift | Open — recorded for the next work package |

## Deferred to deployment (not claimable locally)

Live model execution and voice intelligibility on the no-AVX host; live Discord audio/command/visibility acceptance; owner-manual real payment + staff verification; `COMMERCE_STAFF_CHANNEL_ID` live delivery; OAuth staging return; peak and 2×-peak load, failure-injection campaign and 72-hour soak within the 9-CPU envelope; measured off-host/PITR restore drills (proposed RPO 15 min DB / 6 h unique / 24 h off-host, RTO 2 h — targets only); cold reboot/DNS/credential/model-startup drills; live cgroup membership; images-job green confirmation; authorized cutover (10C).

## Limitations

No production cutover, no merge to `main`, and no live-environment result is claimed. Docker, Strix/Burp, and the models are unavailable on this workstation: image builds are validated only by the CI `images` job, security tooling beyond `npm audit` is recorded blocked, and all bot/provider behavior is contract-tested with fakes at the boundaries the tests define. Scores re-measure the same five dimensions from fresh evidence only; repeated runs are not counted twice.
