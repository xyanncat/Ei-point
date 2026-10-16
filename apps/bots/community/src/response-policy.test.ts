import test from "node:test";
import assert from "node:assert/strict";
import { responsePolicy } from "@ei-point/flow";
import { commandDefinitions } from "./commands.js";

/** Server configuration and catalog administration reply privately; member commands reply publicly. */
const PRIVATE = new Set(["setwelcome", "setleave", "testwelcome", "xp", "setlevelchannel", "cardadmin"]);
const PUBLIC = [
  "balance",
  "buy",
  "cardinfo",
  "cards",
  "cardstats",
  "deck",
  "hand",
  "inventory",
  "leaderboard",
  "market",
  "open",
  "packs",
  "play",
  "rank",
  "score",
  "sell",
  "trade",
  "trades",
];

test("every registered SilverWolf command declares its reply visibility", () => {
  const names = commandDefinitions.map((command) => command.name);
  assert.deepEqual(
    names.filter((name) => !PRIVATE.has(name)).sort(),
    [...PUBLIC].sort(),
    "registering a SilverWolf command requires declaring its reply visibility policy",
  );
  assert.equal(names.filter((name) => PRIVATE.has(name)).length, PRIVATE.size);
  for (const name of names) {
    assert.equal(responsePolicy("silverwolf", name).visibility, PRIVATE.has(name) ? "private" : "public", name);
  }
});
