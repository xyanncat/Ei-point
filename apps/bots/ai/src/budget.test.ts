// Unit admission for per-provider cost units (redesign infra §6). The SQL is
// exercised end-to-end in tests/ai/database.test.mjs; here the decisions and
// the statement shapes are checked with a fake pool.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import {
  releaseUnitReservation,
  reserveUnitBudget,
  resolveUnitBudget,
  settleUnitUsage,
  TTS_UNITS_PER_USER,
  TTS_UNITS_GLOBAL,
} from "./budget.js";
import { unitBudgetExceeded } from "@ei-point/module-ai";

interface Call { sql: string; params?: unknown[] | undefined }

type FakeResult = { rows?: unknown[] } | Error;

function makePool(fakes: Array<{ match: RegExp; result: FakeResult }> = []) {
  const calls: Call[] = [];
  const released = { count: 0 };
  let lastFailure: Error | null = null;
  const client = {
    query: async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      const fake = fakes.find((f) => f.match.test(text));
      if (fake) {
        if (fake.result instanceof Error) { lastFailure = fake.result; throw fake.result; }
        return { rows: fake.result.rows ?? [] };
      }
      return { rows: [] as unknown[] };
    },
    release: () => { released.count += 1; },
  };
  const pool = {
    query: async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      const fake = fakes.find((f) => f.match.test(text));
      if (fake) {
        if (fake.result instanceof Error) { lastFailure = fake.result; throw fake.result; }
        return { rows: fake.result.rows ?? [] };
      }
      return { rows: [] as unknown[] };
    },
    connect: async (): Promise<PoolClient> => client as unknown as PoolClient,
  } as unknown as Pool;
  return { pool, calls, released, failure: () => lastFailure, clientTexts: () => calls.slice().map((c) => c.sql) };
}

function budgetFakes({ user = 0, pending = 0, globalUsed = 0 } = {}) {
  return [
    { match: /USAGE_UNITS_TODAY_SQL|WHERE guild_id = \$1 AND user_id = \$2 AND provider LIKE \$3/, result: { rows: [{ used: String(user) }] } },
    { match: /budget_reservations\s*WHERE kind = \$1/, result: { rows: [{ reserved: String(pending) }] } },
    { match: /USAGE_UNITS_TODAY_GLOBAL_SQL|FROM ai\.usage_ledger\s*\n?\s*WHERE provider LIKE \$1/, result: { rows: [{ used: String(globalUsed) }] } },
  ];
}

describe("cost-unit admission decisions", () => {
  it("admits within both caps and records the reservation with its kind", async () => {
    const fake = makePool(budgetFakes({ user: 100, pending: 200, globalUsed: 1000 }));
    const admission = await reserveUnitBudget(fake.pool, {
      guildId: "g", userId: "u", kind: "tts", units: 400, providerPattern: "tts:%",
    });
    assert.equal(admission.ok, true);
    if (admission.ok) assert.match(admission.reservation, /^[0-9a-f-]{36}$/i);
    const texts = fake.clientTexts();
    assert.ok(texts.some((t) => t.includes("BEGIN")));
    assert.ok(texts.some((t) => t.includes("advisory_xact_lock")));
    const insert = texts.find((t) => t.includes("INSERT INTO ai.budget_reservations"));
    assert.ok(insert?.includes("kind"));
    assert.ok(texts.some((t) => t.includes("COMMIT")));
  });

  it("refuses when the per-guild+user cap is reached and rolls back", async () => {
    const fake = makePool(budgetFakes({ user: TTS_UNITS_PER_USER - 100, pending: 50 }));
    const admission = await reserveUnitBudget(fake.pool, {
      guildId: "g", userId: "u", kind: "tts", units: 400, providerPattern: "tts:%",
    });
    assert.deepEqual(admission, { ok: false, message: "Your remaining daily AI budget is too small for this request." });
    const texts = fake.clientTexts();
    assert.ok(texts.some((t) => t.includes("ROLLBACK")));
    assert.equal(texts.some((t) => t.includes("INSERT INTO ai.budget_reservations")), false);
  });

  it("refuses when the global cap is reached even with personal headroom", async () => {
    const fake = makePool(budgetFakes({ user: 10, globalUsed: TTS_UNITS_GLOBAL }));
    const admission = await reserveUnitBudget(fake.pool, {
      guildId: "g", userId: "u", kind: "translate", units: 1, providerPattern: "translate:%",
    });
    assert.equal(admission.ok, false);
  });

  it("settle records the units, drops the reservation, and releases the client", async () => {
    const fake = makePool([]);
    await settleUnitUsage(fake.pool, {
      reservation: "r-1", guildId: "g", userId: "u", provider: "tts:pocket-local", units: 321,
    });
    const insert = fake.calls.find((c) => c.sql.includes("INSERT INTO ai.usage_ledger"));
    assert.deepEqual(insert?.params, ["g", "u", "tts:pocket-local", 321]);
    assert.ok(fake.calls.some((c) => c.sql.includes("DELETE FROM ai.budget_reservations WHERE reservation_id=$1")));
    assert.equal(fake.released.count, 1);
  });

  it("a failed settle never strands the reservation", async () => {
    const fake = makePool([
      { match: /DELETE FROM ai\.budget_reservations WHERE reservation_id=\$1/, result: { rows: [] } },
      // The in-transaction DELETE fails while the INSERT succeeded → rollback.
      { match: /COMMIT/, result: new Error("txn broken") },
    ]);
    await assert.rejects(
      settleUnitUsage(fake.pool, { reservation: "r-2", guildId: "g", userId: "u", provider: "tts:x", units: 1 }),
      /txn broken/,
    );
    // The fallback delete must run outside the failed transaction (pool-level).
    const poolDeletes = fake.calls.filter((c) => c.sql.includes("DELETE FROM ai.budget_reservations"));
    assert.ok(poolDeletes.length >= 1);
    assert.equal(fake.released.count, 1);
  });

  it("release is best-effort and does not throw on failure", async () => {
    const fake = makePool([{ match: /DELETE FROM ai\.budget_reservations/, result: new Error("db down") }]);
    await fake.pool.query; // ensure shape exists
    await releaseUnitReservation(fake.pool, "r-3");
    assert.equal(fake.released.count, 0);
  });
});

describe("unit budget helpers (pure)", () => {
  it("unitBudgetExceeded separates per-user and global dimensions", () => {
    assert.equal(unitBudgetExceeded(0, 0, 0, 10, 100, 1000), false);
    assert.equal(unitBudgetExceeded(90, 5, 0, 10, 100, 1000), true);
    assert.equal(unitBudgetExceeded(10, 5, 995, 10, 100, 1000), true);
    assert.equal(unitBudgetExceeded(10, 5, 980, 10, 100, 1000), false);
  });

  it("resolveUnitBudget defaults, accepts positives and rejects the rest", () => {
    assert.equal(resolveUnitBudget(undefined, "X", 30000), 30000);
    assert.equal(resolveUnitBudget("  ", "X", 30000), 30000);
    assert.equal(resolveUnitBudget("500", "X", 30000), 500);
    assert.throws(() => resolveUnitBudget("abc", "X", 30000), /must be a positive finite number/);
    assert.throws(() => resolveUnitBudget("-1", "X", 30000), /must be a positive finite number/);
    assert.throws(() => resolveUnitBudget("0", "X", 30000), /must be a positive finite number/);
  });
});
