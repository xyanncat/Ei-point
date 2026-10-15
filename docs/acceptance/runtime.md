# Runtime lifecycle acceptance evidence

**Status:** Partial; Phase 3 remains open.
**Recorded:** 2026-10-15
**Toolchain:** Node.js 24.8.0, pnpm 9.12.0.

## Implemented and locally verified

`packages/flow/src/discord-dispatch.ts` now adapts Discord command interactions to the shared lifecycle. Guild allowlist checks happen before acknowledgement. The dispatcher defers, performs the supplied authorization check, bounds both authorization and command work, emits correlation/latency telemetry, and sends one result. Its ephemeral setting can be configured per dispatcher.

Himiko, community and commerce use this adapter. Their authorization stages check server/bot/command controls before command work. Community also checks Manage Server and guild-owner requirements before applying stored settings. Commerce checks settlement scope before entering order/settlement logic. Himiko preserves rich embed previews and durable announcement intent keyed by the Discord interaction ID; uncertain external sends remain non-replayable.

Evidence from the current checkout:

- `pnpm typecheck` passed across the 20 configured workspace projects.
- `pnpm test` completed under the pinned toolchain; package suites, Phase 6, Phase 4, database controls, operations, backup and runtime tests passed. The final operations/runtime batch reported 30/30 passing.
- `packages/flow` lifecycle tests: 16/16 passed, including non-cooperative authorization/work timeouts, denial before mutation, rich replies and telemetry failure isolation.
- Commerce command tests: 4/4 passed, including settlement permission scopes.
- `tests/runtime/dispatch.test.mjs`: 4/4 passed, covering ephemeral rejection, defer/authorize/run/reply ordering, paused-control denial and community command permissions.
- `git diff --check` passed; Git reported line-ending conversion warnings for existing modified files.

## Remaining Phase 3 acceptance

Kafka, AI, moderation/security and music still use separate dispatcher paths and need adoption plus per-dispatcher tests. This local evidence does not cover component callbacks, voice interactions, live Discord reconnect/shutdown, process termination around external effects, or stale-worker fencing in staging. Do not mark the Phase 3 exit criteria complete until all selected dispatchers and the required staging cases have evidence.
