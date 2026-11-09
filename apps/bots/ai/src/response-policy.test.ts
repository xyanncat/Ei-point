import test from "node:test";
import assert from "node:assert/strict";
import { responsePolicy } from "@ei-point/flow";
import { ttsCommandDefinitions } from "./tts.js";

const EXPECTED = ["leave", "search", "speak", "tts"];

test("every registered Cyrene command replies publicly", () => {
  const names = [...ttsCommandDefinitions]
    .map((command) => command.name)
    .sort();
  assert.deepEqual(
    names,
    EXPECTED,
    "registering a Cyrene command requires declaring its reply visibility policy",
  );
  for (const name of names) {
    assert.equal(responsePolicy("cyrene", name).visibility, "public", name);
  }
});

test("common commands reply publicly on Cyrene too", () => {
  for (const name of ["botinfo", "ping", "about"]) {
    assert.equal(responsePolicy("cyrene", name).visibility, "public", name);
  }
});
