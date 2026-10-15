import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canModerate, CLAIM_DUE_EXPIRY_SQL, expiryBackoffSeconds, planPurge, reconcileTemporaryEffect, requiredScope, sanctionLookupOutcome, temporaryRoleCleanupPlan, validateTimeout } from "./index.js";

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
  it("claims due cases with an unexpired lease and next-attempt fairness window", () => {
    assert.match(CLAIM_DUE_EXPIRY_SQL, /kind IN \('ban', 'timeout', 'temp_role', 'temp_restriction'\)/);
    assert.match(CLAIM_DUE_EXPIRY_SQL, /expires_at <= now\(\)/);
    assert.match(CLAIM_DUE_EXPIRY_SQL, /next_attempt_at <= now\(\)/);
    assert.match(CLAIM_DUE_EXPIRY_SQL, /lease_until IS NULL OR lease_until < now\(\)/);
    assert.match(CLAIM_DUE_EXPIRY_SQL, /FOR UPDATE SKIP LOCKED/);
  });

  it("bounds backoff growth and keeps it positive", () => {
    assert.equal(expiryBackoffSeconds(0), 5);
    assert.equal(expiryBackoffSeconds(1), 10);
    assert.equal(expiryBackoffSeconds(2), 20);
    assert.equal(expiryBackoffSeconds(99), 300);
  });

  it("classifies only authoritative Discord absence as closable", () => {
    for (const code of [10003, 10007, 10011, 10013]) assert.equal(sanctionLookupOutcome({ code }), "absent");
    assert.equal(sanctionLookupOutcome({ code: 500 }), "retry");
    assert.equal(sanctionLookupOutcome(new Error("network") as { code?: number }), "retry");
    assert.equal(sanctionLookupOutcome(undefined), "retry");
    assert.equal(sanctionLookupOutcome(null), "retry");
  });

  it("removes the granted role only when role, member and grant still exist", () => {
    assert.equal(temporaryRoleCleanupPlan({ roleExists: true, memberExists: true, memberHasRole: true }), "remove-role");
    assert.equal(temporaryRoleCleanupPlan({ roleExists: false, memberExists: true, memberHasRole: true }), "nothing");
    assert.equal(temporaryRoleCleanupPlan({ roleExists: true, memberExists: false, memberHasRole: true }), "nothing");
    assert.equal(temporaryRoleCleanupPlan({ roleExists: true, memberExists: true, memberHasRole: false }), "nothing");
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
