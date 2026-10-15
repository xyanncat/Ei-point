import { it } from "node:test";
import assert from "node:assert/strict";
import { reconcileExpiry } from "./index.js";
it("failed unban retains expiry for a later retry", async () => {
  let cleared = false;
  assert.equal(await reconcileExpiry("ban", async () => { throw new Error("Discord permission/network error"); }, async () => { cleared = true; }), false);
  assert.equal(cleared,false);
});
it("already unbanned expires successfully but unsupported case kinds stay pending", async () => {
  let cleared = 0;
  assert.equal(await reconcileExpiry("ban", async () => { throw { code: 10026 }; }, async () => { cleared++; }),true);
  assert.equal(await reconcileExpiry("note", async () => {}, async () => { cleared++; }),false);
  assert.equal(cleared,1);
});
it("clear database failures are surfaced and can be retried", async () => {
  await assert.rejects(reconcileExpiry("timeout", async () => {}, async () => { throw new Error("DB unavailable"); }), /DB unavailable/);
});
