import test from "node:test";
import assert from "node:assert/strict";
import { responsePolicy } from "./response-policy.js";

test("kafka replies stay private for every operation", () => {
  for (const operation of ["ban", "warn", "lockdown", "cases", ""]) {
    assert.deepEqual(responsePolicy("kafka", operation), { visibility: "private", imageKey: "kafka" });
  }
});

test("unknown identities fail private", () => {
  assert.equal(responsePolicy("mystery", "rank").visibility, "private");
  assert.equal(responsePolicy("", "").visibility, "private");
});

test("normal operations on public identities reply publicly", () => {
  assert.equal(responsePolicy("himiko", "announcement").visibility, "public");
  assert.equal(responsePolicy("himiko", "embed").visibility, "public");
  assert.equal(responsePolicy("himiko", "leaderboard").visibility, "public");
  assert.equal(responsePolicy("silverwolf", "rank").visibility, "public");
  assert.equal(responsePolicy("silverwolf", "market").visibility, "public");
  assert.equal(responsePolicy("silverwolf", "balance").visibility, "public");
  assert.equal(responsePolicy("cyrene", "speak").visibility, "public");
  assert.equal(responsePolicy("cyrene", "translate").visibility, "public");
  assert.equal(responsePolicy("robin", "play").visibility, "public");
});

test("sensitive operations reply privately", () => {
  for (const operation of ["setwelcome", "setleave", "testwelcome", "xp", "setlevelchannel"]) {
    assert.equal(responsePolicy("himiko", operation).visibility, "private");
    assert.equal(responsePolicy("silverwolf", operation).visibility, "private");
  }
  assert.equal(responsePolicy("silverwolf", "cardadmin").visibility, "private");
  for (const operation of ["orders", "payment", "referral"]) {
    assert.equal(responsePolicy("cipher", operation).visibility, "private");
  }
});

test("policy keys are normalized and image keys stay identity-scoped", () => {
  assert.deepEqual(responsePolicy("  Himiko ", "XP"), { visibility: "private", imageKey: "himiko" });
  assert.deepEqual(responsePolicy("SilverWolf", "rank"), { visibility: "public", imageKey: "silverwolf" });
});
