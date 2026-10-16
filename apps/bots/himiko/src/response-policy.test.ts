import test from "node:test";
import assert from "node:assert/strict";
import { responsePolicy } from "@ei-point/flow";
import { himikoCommandDefinitions } from "./commands.js";
import { COMMUNITY_ADMIN_COMMANDS, communityCommandDefinitions } from "./community-commands.js";

const EXPECTED: Record<string, "public" | "private"> = {
  announcement: "public",
  embed: "public",
  leaderboard: "public",
  setwelcome: "private",
  setleave: "private",
  testwelcome: "private",
  xp: "private",
  setlevelchannel: "private",
};

test("every registered Himiko command declares its reply visibility", () => {
  const names = [...himikoCommandDefinitions, ...communityCommandDefinitions].map((command) => command.name);
  assert.deepEqual(
    [...names].sort(),
    Object.keys(EXPECTED).sort(),
    "registering a Himiko command requires declaring its reply visibility policy",
  );
  for (const name of names) {
    assert.equal(responsePolicy("himiko", name).visibility, EXPECTED[name], name);
  }
});

test("community administration stays private on Himiko", () => {
  for (const name of COMMUNITY_ADMIN_COMMANDS) {
    assert.equal(responsePolicy("himiko", name).visibility, "private", name);
  }
});
