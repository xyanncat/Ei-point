import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateBudgetReservationTokens } from "./commands.js";

describe("AI budget reservation estimate", () => {
  it("reserves conversation bytes, bounded persona estimate, per-message overhead and output", () => {
    const conversation = [{ role: "user" as const, content: "hello" }];
    assert.equal(estimateBudgetReservationTokens(conversation, "x".repeat(1000)), 5 + 500 + 2 * 16 + 1000);
  });

  it("keeps the byte-based reservation when there is no separate persona", () => {
    const conversation = [{ role: "user" as const, content: "hello" }];
    assert.equal(estimateBudgetReservationTokens(conversation), 5 + 16 + 1000);
  });
});
