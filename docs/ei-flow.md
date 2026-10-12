# Ei-Flow — Ei-Point's custom runtime architecture

Ei-Flow is the shared runtime every Ei-Point service is built on: one interaction
lifecycle, one authorization model, one jobs/outbox backbone, one telemetry and
shutdown contract. Bots own identities and modules; Ei-Flow owns how work flows.
Code lives in `packages/flow/` (`@ei-point/flow`).

## The five stages (§5)

1. **Acknowledge** immediately when database or provider work may be slow
   (`INTERACTION_DEADLINE_MS = 2500`, under Discord's 3 s limit).
2. **Authorize** before side effects: guild allowlist + staff scopes (`auth.ts`).
3. **Deadline + cancel**: every slow path runs under a timeout with an
   `AbortSignal`; provider/router budgets are 2 concurrent, 20 queued, 60 s.
4. **Exactly one reply**: `replyOnce` throws on double-reply instead of letting
   Discord raise; every path ends in one result or one actionable error.
5. **Telemetry**: correlation ID, latency, and failure category per interaction.

## Modules

| File | Owns |
|---|---|
| `lifecycle.ts` | `handleInteraction`, `withTimeout`, `replyOnce` |
| `auth.ts` | Guild allowlist + scope checks |
| `jobs.ts` | Leased job table, exp backoff + jitter, idempotency keys |
| `outbox.ts` | Transactional outbox (`ON CONFLICT DO NOTHING`) |
| `database.ts` | Pooled tx with statement/lock timeouts |
| `controls.ts` | Registry-driven bot controls + `isControlEnabled` |
| `embed-delivery.ts` | Verified dashboard-embed REST delivery |
| `shutdown.ts` | Graceful drain with hard-stop timeout |

## Rules for bot builders

- Never `deferReply` ad-hoc: route through `handleInteraction`.
- Never bypass the registry: read `config.bots` + `BOT_KEY`, no hard-coded lists.
- Never claim success on failed writes: unsafe mutations fail clearly when
  PostgreSQL is down; cache failures never grant access.
- Workers `LISTEN` on `ei_jobs`/`ei_outbox` plus reconcile on a timer; generic
  jobs must reach `done` via `COMPLETE_SQL`, never stall at `failed`.
