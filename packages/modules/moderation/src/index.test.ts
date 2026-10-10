import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canModerate, planPurge, requiredScope, validateTimeout } from "./index.js";

describe("moderation permissions", () => {
  it("denies without the exact scope", () => {
    assert.equal(canModerate([], "ban"), false);
    assert.equal(canModerate(["moderation-warn"], "ban"), false);
  });

  it("allows with the exact scope or admin", () => {
    assert.equal(canModerate(["moderation-ban"], "ban"), true);
    assert.equal(canModerate(["moderation-ban"], "unban"), true);
    assert.equal(canModerate(["moderation-admin"], "purge"), true);
    assert.equal(requiredScope("timeout"), "moderation-timeout");
  });
});

describe("timeout bounds", () => {
  it("accepts up to 28 days, rejects beyond", () => {
    assert.equal(validateTimeout(60_000), true);
    assert.equal(validateTimeout(28 * 24 * 60 * 60 * 1000), true);
    assert.equal(validateTimeout(29 * 24 * 60 * 60 * 1000), false);
    assert.equal(validateTimeout(0), false);
    assert.equal(validateTimeout(-5), false);
  });
});

describe("purge planner", () => {
  const DAY = 24 * 60 * 60 * 1000;
  it("plans bulk within limits", () => {
    assert.equal(planPurge(50, DAY).mode, "bulk");
  });

  it("rejects bad counts, degrades old messages to manual", () => {
    assert.equal(planPurge(0, DAY).mode, "rejected");
    assert.equal(planPurge(101, DAY).mode, "rejected");
    assert.equal(planPurge(50, 15 * DAY).mode, "manual");
  });
});
