import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildUpiPayload,
  cycleFor,
  executeClaim,
  executeReject,
  executeSettle,
  fulfillOrder,
  hashToken,
  isRewardExpired,
  newOrderToken,
  newReferralCode,
  orderTransition,
  rewardCreditFor,
  validAmountMinor,
  validateUsdtAddress,
} from "./index.js";

describe("money + tokens", () => {
  it("accepts positive integer minor units only", () => {
    assert.equal(validAmountMinor(100), true);
    assert.equal(validAmountMinor(0), false);
    assert.equal(validAmountMinor(-5), false);
    assert.equal(validAmountMinor(10.5), false);
  });

  it("token hashes round-trip without storing the token", () => {
    const { token, hash } = newOrderToken();
    assert.equal(hashToken(token), hash);
    assert.ok(!hash.includes(token.slice(0, 8)));
  });
});

describe("upi payload", () => {
  it("builds a valid upi://pay string", () => {
    const p = buildUpiPayload({ payeeVpa: "shop@upi", payeeName: "Ei Point", amountMinor: 19900, note: "order-1" });
    assert.ok(p?.startsWith("upi://pay?"));
    assert.ok(p?.includes("pa=shop%40upi"));
    assert.ok(p?.includes("am=199.00"));
    assert.ok(p?.includes("cu=INR"));
  });

  it("rejects bad vpa, amounts, empty fields", () => {
    const base = { payeeVpa: "shop@upi", payeeName: "Ei", amountMinor: 100, note: "n" };
    assert.equal(buildUpiPayload({ ...base, payeeVpa: "not-a-vpa" }), null);
    assert.equal(buildUpiPayload({ ...base, amountMinor: 0 }), null);
    assert.equal(buildUpiPayload({ ...base, payeeName: "" }), null);
  });
});

describe("usdt addresses", () => {
  it("accepts tron and erc20, rejects garbage", () => {
    assert.equal(validateUsdtAddress("T123456789ABCDEFGHJKLMNPQRSTUVWXab"), "tron");
    assert.equal(validateUsdtAddress("0x" + "ab".repeat(20)), "erc20");
    assert.equal(validateUsdtAddress("nope"), null);
    assert.equal(validateUsdtAddress("0x123"), null);
  });
});

describe("order state machine", () => {
  it("allows legal transitions only", () => {
    assert.equal(orderTransition("pending", "claimed"), true);
    assert.equal(orderTransition("claimed", "settled"), true);
    assert.equal(orderTransition("pending", "settled"), false);
    assert.equal(orderTransition("settled", "claimed"), false);
    assert.equal(orderTransition("rejected", "claimed"), false);
  });
});

describe("referral cycles", () => {
  it("formats YYYY-MM and expires across month boundary", () => {
    assert.equal(cycleFor(new Date(Date.UTC(2026, 0, 15))), "2026-01");
    assert.equal(cycleFor(new Date(Date.UTC(2026, 11, 31))), "2026-12");
    assert.equal(isRewardExpired("2026-12", "2027-01", "reserved"), true); // year boundary
    assert.equal(isRewardExpired("2027-01", "2027-01", "reserved"), false);
    assert.equal(isRewardExpired("2026-12", "2027-01", "paid"), false);
    assert.ok(/^EI-[0-9A-F]{8}$/.test(newReferralCode("ei!")));
  });
});

describe("claims + settlement", () => {
  interface Row {
    rows: Array<Record<string, unknown>>;
    rowCount: number;
  }
  function fake(status: string | null, markOk = true): {
    db: { query: (sql: string, params: unknown[]) => Promise<Row> };
  } {
    return {
      db: {
        query: async (sql: string, _p: unknown[]): Promise<Row> => {
          if (sql.includes("FOR UPDATE")) {
            return status == null ? { rows: [], rowCount: 0 } : { rows: [{ status }], rowCount: 1 };
          }
          return { rows: [], rowCount: markOk ? 1 : 0 };
        },
      },
    };
  }

  it("claims a pending order once; rejects the rest", async () => {
    assert.deepEqual(
      await executeClaim(fake("pending").db, { orderId: "o", guildId:"guild", buyerId:"buyer", proofRef: "123456789012", idempotencyKey: "k" }),
      { ok: true },
    );
    assert.deepEqual(await executeClaim(fake("claimed").db, { orderId: "o", guildId:"guild", buyerId:"buyer", proofRef: "123456789012", idempotencyKey: "k2" }), {
      ok: false,
      reason: "already-claimed",
    });
    assert.deepEqual(await executeClaim(fake("rejected").db, { orderId: "o", guildId:"guild", buyerId:"buyer", proofRef: "123456789012", idempotencyKey: "k3" }), {
      ok: false,
      reason: "not-pending",
    });
    assert.deepEqual(await executeClaim(fake(null).db, { orderId: "o", guildId:"guild", buyerId:"buyer", proofRef: "123456789012", idempotencyKey: "k4" }), {
      ok: false,
      reason: "not-pending",
    });
  });

  it("settles a claimed order once; rejects duplicates and wrong states", async () => {
    assert.deepEqual(
      await executeSettle(fake("claimed").db, { orderId: "o", guildId:"guild", settledBy: "s", idempotencyKey: "k" }),
      { ok: true },
    );
    assert.deepEqual(await executeSettle(fake("settled").db, { orderId: "o", guildId:"guild", settledBy: "s", idempotencyKey: "k2" }), {
      ok: false,
      reason: "already-settled",
    });
    assert.deepEqual(await executeSettle(fake("pending").db, { orderId: "o", guildId:"guild", settledBy: "s", idempotencyKey: "k3" }), {
      ok: false,
      reason: "not-claimable",
    });
    // Lost update race: mark affects 0 rows -> already-settled, never double-paid.
    assert.deepEqual(
      await executeSettle(fake("claimed", false).db, { orderId: "o", guildId:"guild", settledBy: "s", idempotencyKey: "k4" }),
      { ok: false, reason: "already-settled" },
    );
  });

  it("rejects a pending or claimed order once; terminal states refuse", async () => {
    assert.deepEqual(await executeReject(fake("pending").db, { orderId: "o", guildId: "guild" }), { ok: true });
    assert.deepEqual(await executeReject(fake("claimed").db, { orderId: "o", guildId: "guild" }), { ok: true });
    assert.deepEqual(await executeReject(fake("rejected").db, { orderId: "o", guildId: "guild" }), { ok: false, reason: "already-rejected" });
    assert.deepEqual(await executeReject(fake("settled").db, { orderId: "o", guildId: "guild" }), { ok: false, reason: "not-rejectable" });
    assert.deepEqual(await executeReject(fake(null).db, { orderId: "o", guildId: "guild" }), { ok: false, reason: "not-rejectable" });
    // Lost update race: the guarded update affects 0 rows -> already-rejected, never a second transition.
    assert.deepEqual(await executeReject(fake("claimed", false).db, { orderId: "o", guildId: "guild" }), { ok: false, reason: "already-rejected" });
  });
});

describe("claim validation boundary",()=>{
 it("rejects expired orders and malformed payment proof before any write",async()=>{
  for(const [proof,expires,reason] of [["wrong",new Date(Date.now()+10000),"invalid-proof"],["123456789012",new Date(0),"expired"]] as const){let calls=0;const db={query:async()=>{calls++;return {rows:[{status:"pending",method:"upi",expires_at:expires}],rowCount:1};}};assert.deepEqual(await executeClaim(db,{orderId:"o",guildId:"g",buyerId:"b",proofRef:proof,idempotencyKey:"key"}),{ok:false,reason});assert.equal(calls,1);}
 });
});

describe("razorpay hosted-page claims", () => {
  const pending = { status: "pending", method: "razorpay", expires_at: new Date(Date.now() + 10_000) };

  it("accepts a payment id or a 12-digit UTR and stores the reference for staff review", async () => {
    const claims: string[] = [];
    const db = {
      query: async (sql: string, p: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }> => {
        if (sql.includes("FOR UPDATE")) return { rows: [pending], rowCount: 1 };
        if (sql.includes("INSERT INTO commerce.claims")) {
          claims.push(String(p[1]));
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    assert.deepEqual(await executeClaim(db, { orderId: "o", guildId: "g", buyerId: "b", proofRef: "pay_QAZFRESH1ABC", idempotencyKey: "rzp-1" }), { ok: true });
    assert.deepEqual(await executeClaim(db, { orderId: "o", guildId: "g", buyerId: "b", proofRef: "123456789012", idempotencyKey: "rzp-2" }), { ok: true });
    assert.deepEqual(claims, ["razorpay:pay_QAZFRESH1ABC", "razorpay:123456789012"]);
  });

  it("rejects a too-short reference before any write", async () => {
    let calls = 0;
    const db = {
      query: async (): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }> => {
        calls++;
        return { rows: [pending], rowCount: 1 };
      },
    };
    assert.deepEqual(await executeClaim(db, { orderId: "o", guildId: "g", buyerId: "b", proofRef: "abc", idempotencyKey: "rzp-3" }), { ok: false, reason: "invalid-proof" });
    assert.equal(calls, 1);
  });
});

describe("settlement-month referral attribution", () => {
  const q = (calls: Array<{ sql: string; params: unknown[] | undefined }>) =>
    async (sql: string, params?: unknown[]): Promise<Array<Record<string, any>>> => {
      calls.push({ sql, params });
      return sql.includes("UPDATE commerce.referrals") ? [{ referrer_id: "referrer-1" }] : [];
    };

  it("consumes the code's own row across the month boundary and credits the settlement cycle", async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    await fulfillOrder(
      q(calls),
      { guild_id: "g1", buyer_id: "b1", membership_days: 0, referral_code: "ABC234", order_id: "o1" },
      5000,
      new Date(Date.UTC(2026, 1, 1, 12, 0, 0)),
    );
    const consume = calls.find((c) => c.sql.includes("UPDATE commerce.referrals"))!;
    assert.deepEqual(consume.params, ["ABC234", "g1"]);
    const reward = calls.find((c) => c.sql.includes("INSERT INTO commerce.rewards"))!;
    assert.equal(reward.params![2], "2026-02");
    assert.equal(reward.params![4], "checkout:o1");
    assert.ok(calls.some((c) => c.sql.includes("UPDATE commerce.rewards SET status='paid'") && c.params?.[0] === "o1"));
  });

  it("attributes the exact month boundary to the settlement instant", async () => {
    const cycleAt = async (now: Date) => {
      const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
      await fulfillOrder(
        q(calls),
        { guild_id: "g1", buyer_id: "b1", membership_days: 0, referral_code: "C", order_id: "o" },
        1,
        now,
      );
      return calls.find((c) => c.sql.includes("INSERT INTO commerce.rewards"))!.params![2];
    };
    assert.equal(await cycleAt(new Date(Date.UTC(2026, 0, 31, 23, 59, 59))), "2026-01");
    assert.equal(await cycleAt(new Date(Date.UTC(2026, 1, 1, 0, 0, 0))), "2026-02");
  });

  it("skips the reward row when the code no longer resolves", async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    await fulfillOrder(async (sql, params) => { calls.push({ sql, params }); return []; }, { guild_id: "g1", buyer_id: "b1", membership_days: 0, referral_code: "GONE", order_id: "o2" }, 5000);
    assert.equal(calls.some((c) => c.sql.includes("INSERT INTO commerce.rewards")), false);
  });
});

describe("reward credit application", () => {
  it("applies whole reserved rewards oldest-first while keeping the order floor", () => {
    const rows = [
      { reward_id: "r1", amount_minor: "2000" },
      { reward_id: "r2", amount_minor: "3000" },
      { reward_id: "r3", amount_minor: "100000" },
    ];
    assert.deepEqual(rewardCreditFor(rows, 10000), { appliedMinor: 5000, rewardIds: ["r1", "r2"] });
    assert.deepEqual(rewardCreditFor([{ reward_id: "r1", amount_minor: "9900" }], 10000), { appliedMinor: 9900, rewardIds: ["r1"] });
    assert.deepEqual(rewardCreditFor([{ reward_id: "r1", amount_minor: "9901" }], 10000), { appliedMinor: 0, rewardIds: [] });
    assert.deepEqual(rewardCreditFor([{ reward_id: "r1", amount_minor: "5000" }], 5000), { appliedMinor: 0, rewardIds: [] });
    assert.deepEqual(rewardCreditFor([{ reward_id: "r1", amount_minor: "garbage" }], 10000), { appliedMinor: 0, rewardIds: [] });
  });
});
