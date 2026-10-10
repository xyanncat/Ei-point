import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildUpiPayload,
  cycleFor,
  executeClaim,
  executeSettle,
  hashToken,
  isRewardExpired,
  newOrderToken,
  newReferralCode,
  orderTransition,
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
    const p = buildUpiPayload({ payeeVpa: "shop@upi", payeeName: "Ei Royality", amountMinor: 19900, note: "order-1" });
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
      await executeClaim(fake("pending").db, { orderId: "o", proofRef: "p", idempotencyKey: "k" }),
      { ok: true },
    );
    assert.deepEqual(await executeClaim(fake("claimed").db, { orderId: "o", proofRef: "p", idempotencyKey: "k2" }), {
      ok: false,
      reason: "already-claimed",
    });
    assert.deepEqual(await executeClaim(fake("rejected").db, { orderId: "o", proofRef: "p", idempotencyKey: "k3" }), {
      ok: false,
      reason: "not-pending",
    });
    assert.deepEqual(await executeClaim(fake(null).db, { orderId: "o", proofRef: "p", idempotencyKey: "k4" }), {
      ok: false,
      reason: "not-pending",
    });
  });

  it("settles a claimed order once; rejects duplicates and wrong states", async () => {
    assert.deepEqual(
      await executeSettle(fake("claimed").db, { orderId: "o", settledBy: "s", idempotencyKey: "k" }),
      { ok: true },
    );
    assert.deepEqual(await executeSettle(fake("settled").db, { orderId: "o", settledBy: "s", idempotencyKey: "k2" }), {
      ok: false,
      reason: "already-settled",
    });
    assert.deepEqual(await executeSettle(fake("pending").db, { orderId: "o", settledBy: "s", idempotencyKey: "k3" }), {
      ok: false,
      reason: "not-claimable",
    });
    // Lost update race: mark affects 0 rows -> already-settled, never double-paid.
    assert.deepEqual(
      await executeSettle(fake("claimed", false).db, { orderId: "o", settledBy: "s", idempotencyKey: "k4" }),
      { ok: false, reason: "already-settled" },
    );
  });
});
