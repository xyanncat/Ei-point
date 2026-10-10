import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { drawPack, drawRarity, executeBuy, tradeTransition, withTransaction } from "./index.js";

// Seeded RNG: cycles through a fixed sequence — deterministic draws.
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]! as number;
}

describe("packs", () => {
  it("draws deterministically from injected RNG", () => {
    assert.equal(drawRarity(seeded([0])), "common"); // roll 0 -> first bucket
    assert.equal(drawRarity(seeded([0.999])), "mythic"); // top of range
    assert.deepEqual(drawPack(seeded([0, 0.999]), 2), ["common", "mythic"]);
    assert.deepEqual(drawPack(seeded([0]), 0), []);
  });

  it("rarity buckets partition the unit interval", () => {
    // boundaries: common [0,.70) rare [.70,.90) epic [.90,.97) legendary [.97,.995) mythic [.995,1)
    assert.equal(drawRarity(seeded([0.699])), "common");
    assert.equal(drawRarity(seeded([0.7])), "rare");
    assert.equal(drawRarity(seeded([0.9])), "epic");
    assert.equal(drawRarity(seeded([0.97])), "legendary");
    assert.equal(drawRarity(seeded([0.995])), "mythic");
  });
});

describe("trades", () => {
  it("accepts/cancels pending, rejects terminal states", () => {
    assert.equal(tradeTransition("pending", "accept"), "done");
    assert.equal(tradeTransition("pending", "cancel"), "cancelled");
    assert.equal(tradeTransition("done", "cancel"), null);
    assert.equal(tradeTransition("cancelled", "accept"), null);
  });
});

describe("concurrent double-buy", () => {
  // Faithful lock model: a second locker's SELECT blocks until the first
  // transaction ends (like Postgres FOR UPDATE), then sees current state.
  function sharedDb() {
    let status = "open";
    let owner = "s";
    const balances = new Map<string, number>([["b1", 500], ["b2", 500], ["s", 0]]);
    let locked = false;
    let waiter: (() => void) | null = null;
    const log: string[] = [];

    async function lock(): Promise<void> {
      if (!locked) {
        locked = true;
        return;
      }
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
    function unlock(): void {
      locked = false;
      const w = waiter;
      waiter = null;
      if (w != null) w();
    }

    return {
      log,
      state: () => ({ status, owner, balances: new Map(balances) }),
      db: {
        query: async (sql: string, _p: unknown[]) => {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
            log.push(sql);
            if (sql !== "BEGIN") unlock();
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("FROM games.listings")) {
            await lock();
            return {
              rows: [{ guild_id: "g", seller_id: "s", instance_id: "i", price_minor: 100, status }],
              rowCount: 1,
            };
          }
          if (sql.includes("FROM games.balances")) {
            const buyer = String(_p[1]);
            return { rows: [{ amount_minor: balances.get(buyer) ?? 0 }], rowCount: 1 };
          }
          if (sql.includes("card_instances")) {
            if (owner === _p[2]) {
              owner = String(_p[1]);
              return { rows: [], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("games.balances SET")) {
            balances.set(String(_p[1]), (balances.get(String(_p[1])) ?? 0) + Number(_p[2]));
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("SET status = 'sold'")) {
            if (status !== "open") return { rows: [], rowCount: 0 };
            status = "sold";
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      },
    };
  }

  it("exactly one of two concurrent buyers wins; funds conserved", async () => {
    const { db, state } = sharedDb();
    const [r1, r2] = await Promise.all([
      withTransaction(db, (tx) => executeBuy(tx, { listingId: "l", buyerId: "b1" })),
      withTransaction(db, (tx) => executeBuy(tx, { listingId: "l", buyerId: "b2" })),
    ]);
    const wins = [r1, r2].filter((r) => r.ok);
    const losses = [r1, r2].filter((r) => !r.ok);
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);
    assert.deepEqual(losses[0], { ok: false, reason: "listing-unavailable" });
    const s = state();
    assert.equal(s.status, "sold");
    assert.ok(s.owner === "b1" || s.owner === "b2");
    const total = (s.balances.get("b1") ?? 0) + (s.balances.get("b2") ?? 0) + (s.balances.get("s") ?? 0);
    assert.equal(total, 1000); // no money created or destroyed
  });

  it("rolls back on mid-transaction failure", async () => {
    const { db, log } = sharedDb();
    await assert.rejects(
      withTransaction(db, async (tx) => {
        await tx.query("SELECT 1", []);
        throw new Error("boom mid-buy");
      }),
      /boom mid-buy/,
    );
    assert.deepEqual(log, ["BEGIN", "ROLLBACK"]);
  });
});
describe("market buy", () => {
  interface Row {
    rows: Array<Record<string, unknown>>;
    rowCount: number;
  }
  function fake(scenario: "ok" | "sold" | "poor" | "self" | "moved"): {
    db: { query: (sql: string, params: unknown[]) => Promise<Row> };
    calls: string[];
  } {
    const calls: string[] = [];
    const listing =
      scenario === "sold"
        ? { guild_id: "g", seller_id: "s", instance_id: "i", price_minor: 100, status: "sold" }
        : { guild_id: "g", seller_id: scenario === "self" ? "b" : "s", instance_id: "i", price_minor: 100, status: "open" };
    const db = {
      query: async (sql: string, _params: unknown[]): Promise<Row> => {
        calls.push(sql.split("\n")[1]?.trim() ?? sql.slice(0, 24));
        if (sql.includes("FROM games.listings")) return { rows: [listing], rowCount: 1 };
        if (sql.includes("FROM games.balances")) {
          return { rows: [{ amount_minor: scenario === "poor" ? 10 : 500 }], rowCount: 1 };
        }
        if (sql.includes("card_instances")) {
          const ok = scenario !== "moved";
          return { rows: [], rowCount: ok ? 1 : 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    return { db, calls };
  }

  it("completes a valid buy with locked reads", async () => {
    const { db, calls } = fake("ok");
    const res = await executeBuy(db, { listingId: "l", buyerId: "b" });
    assert.deepEqual(res, { ok: true });
    assert.ok(calls.some((c) => c.includes("FOR UPDATE")), "reads must lock rows");
  });

  it("rejects sold listings, self-buys, poor funds, failed moves", async () => {
    assert.deepEqual((await executeBuy(fake("sold").db, { listingId: "l", buyerId: "b" })).ok, false);
    assert.deepEqual(await executeBuy(fake("self").db, { listingId: "l", buyerId: "b" }), {
      ok: false,
      reason: "self-buy",
    });
    assert.deepEqual(await executeBuy(fake("poor").db, { listingId: "l", buyerId: "b" }), {
      ok: false,
      reason: "insufficient-funds",
    });
    assert.deepEqual(await executeBuy(fake("moved").db, { listingId: "l", buyerId: "b" }), {
      ok: false,
      reason: "transfer-failed",
    });
  });
});
