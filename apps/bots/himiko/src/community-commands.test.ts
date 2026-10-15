import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMUNITY_ADMIN_COMMANDS,
  communityCommandDefinitions,
  respondToCommunityCommand,
} from "./community-commands.js";
import type { CommunityService } from "@ei-point/module-community";

test("Himiko registers community setup, XP, and leaderboard commands", () => {
  assert.deepEqual(communityCommandDefinitions.map((command) => command.name), [
    "setwelcome",
    "setleave",
    "testwelcome",
    "xp",
    "setlevelchannel",
    "leaderboard",
  ]);
  assert.deepEqual([...COMMUNITY_ADMIN_COMMANDS], ["setwelcome", "setleave", "testwelcome", "xp", "setlevelchannel"]);
});

test("the XP command forwards text and voice settings to the community service", async () => {
  let saved: unknown;
  const service = {
    configure: async (_guildId: string, patch: unknown) => { saved = patch; },
  } as unknown as CommunityService;
  const response = await respondToCommunityCommand({
    name: "xp",
    guildId: "11111111111111111",
    userId: "22222222222222222",
    username: "member",
    guildName: "test guild",
    memberCount: 2,
    options: { enabled: true, amount: 18, cooldown: 90, voice_enabled: true, voice_amount: 6, voice_interval: 300 },
  }, service);
  assert.equal(response, "Text and voice XP settings saved.");
  assert.deepEqual(saved, {
    xpEnabled: true,
    xpPerMessage: 18,
    cooldownSeconds: 90,
    voiceXpEnabled: true,
    voiceXpAmount: 6,
    voiceIntervalSeconds: 300,
  });
});

test("the leaderboard formats ranked member mentions", async () => {
  const service = {
    leaderboard: async () => [
      { userId: "11111111111111111", xp: "600", level: 2 },
      { userId: "22222222222222222", xp: "250", level: 1 },
    ],
  } as unknown as CommunityService;
  const response = await respondToCommunityCommand({
    name: "leaderboard",
    guildId: "33333333333333333",
    userId: "44444444444444444",
    username: "member",
    guildName: "test guild",
    memberCount: 2,
    options: {},
  }, service);
  assert.equal(response, "**1.** <@11111111111111111> · Level 2 · 600 XP\n**2.** <@22222222222222222> · Level 1 · 250 XP");
});
