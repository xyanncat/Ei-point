import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canModerate, DUE_EXPIRY_SQL, planPurge, reconcileTemporaryEffect, requiredScope, validateTimeout } from "./index.js";

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

describe("temporary moderation expiry", () => {
  it("leases temporary role and restriction cases only after their recorded expiry", () => {
    assert.match(DUE_EXPIRY_SQL, /kind IN \('ban', 'timeout', 'temp_role', 'temp_restriction'\)/);
    assert.match(DUE_EXPIRY_SQL, /expires_at <= now\(\)/);
  });

  it("does not acknowledge a Discord failure and records conflicts without retrying them", async () => {
    let finished = "";
    assert.equal(await reconcileTemporaryEffect("temp_role", async () => { throw new Error("Discord unavailable"); }, async () => { finished = "wrong"; }), false);
    assert.equal(finished, "");
    assert.equal(await reconcileTemporaryEffect("temp_restriction", async () => "conflict", async (outcome) => { finished = outcome; }), true);
    assert.equal(finished, "conflict");
    assert.equal(await reconcileTemporaryEffect("warn", async () => "restored", async () => { finished = "wrong"; }), false);
  });
});
