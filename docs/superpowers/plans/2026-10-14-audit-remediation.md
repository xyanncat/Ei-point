# Audit Remediation Implementation Plan

> **For agentic workers:** Use systematic-debugging, test-driven-development and verification-before-completion. Independent areas are delegated with explicit file ownership; the parent integrates and verifies the complete workspace.

**Goal:** Correct the repository defects recorded in the 2026-10-14 phase audit without changing the Kafka visual design or claiming unperformed VPS acceptance.

**Architecture:** Reuse authoritative transactional services for financial effects; fail closed on missing identity/configuration; persist external-action intent before dispatch. Make deployment/recovery tools operate on explicit release and backup artifacts with bounded checks. Keep real operational acceptance separate from local test evidence.

**Tech stack:** TypeScript/Fastify/Next.js/PostgreSQL, Python/discord.py, Docker Compose, Bash and Node operational validation.

- [x] Commerce: add failing authorization/fulfillment/retry tests; bind orders to guild/buyer, share settlement, preserve referral navigation and recover idempotent creation; verify PostgreSQL transactions and dispatcher regression tests.
- [x] Protection/runtime: reproduce note disclosure/deadline behavior; enforce module/identity/control checks; implement durable Discord action and recovery behavior; verify failure/retry boundaries with injected Discord and real database tests. Supported restoration scope and remaining dispatcher adoption are recorded in the repair ledger.
- [x] AI/music: reproduce provider false-success and snapshot boundary defects; wire failures/fallback, real voice prerequisites, budget/memory/queue limits and registry guards; verify isolated TS/Python tests.
- [x] Operations: replace simulated restore with artifact-based restore and integrity checks; enforce scoped readiness/deploy/rollback/watchdog behavior and explicit backup configuration; run real Bash syntax and mocked-command tests.
- [x] Dependencies/foundation: fix clean API build ordering and production profile; update vulnerable dependencies to patched supported versions, retain framework compatibility; verify frozen lockfile, advisory scan, typecheck and production build.
- [x] Inventory: generate traceable archive command candidates, remove unsupported completion claims, preserve audit history and add a phase-by-phase repair ledger. Full semantic parity is deliberately not claimed.
- [x] Integration: reviewed delegated changes and passed full Node/PG tests (188), Python tests (20), typecheck, production build, dependency scan, shell checks and all three rebuilt-site browser regressions. Remaining scope and live acceptance are recorded in `docs/audits/2026-10-15-remediation.md`.
- [ ] Complete legacy source-to-handler-to-test semantic mapping, including declarations without exact-name candidates.
- [ ] Complete universal production-dispatcher lifecycle adoption and broader supported snapshot channel/managed-role recovery where required by the retained feature contract.
- [ ] Execute clean Linux image/startup, real Discord/provider/payment/voice, measured restore/PITR/off-host recovery, load and soak acceptance on the benchmark VPS. No coding-task test substitutes for these gates.

No real messages, payments, production DB migrations, releases or restores are authorized by this coding task. Local disposable databases and mocked external adapters are used for verification. No automatic phase-completion score increases without new evidence.
