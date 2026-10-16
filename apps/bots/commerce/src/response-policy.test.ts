import test from "node:test";
import assert from "node:assert/strict";
import { responsePolicy } from "@ei-point/flow";
import { commerceCommandDefinitions } from "./commands.js";

const EXPECTED = { orders: "private", payment: "private", referral: "private" } as const;

test("payment, order and referral detail replies stay private on Cipher", () => {
  const names = commerceCommandDefinitions.map((command) => command.name).sort();
  assert.deepEqual(
    names,
    Object.keys(EXPECTED).sort(),
    "registering a Cipher command requires declaring its reply visibility policy",
  );
  for (const name of names) {
    assert.equal(responsePolicy("cipher", name).visibility, EXPECTED[name as keyof typeof EXPECTED], name);
  }
});
