import assert from "node:assert/strict";
import test from "node:test";
import { eligibleVoiceXpUsers, voiceXpEventKey } from "./voice-xp.js";

test("voice XP requires a non-AFK channel with at least two human members", () => {
  const eligible = eligibleVoiceXpUsers([
    { userId: "11111111111111111", channelId: "voice", isBot: false, isAfk: false, selfDeaf: false, serverDeaf: false },
    { userId: "22222222222222222", channelId: "voice", isBot: false, isAfk: false, selfDeaf: false, serverDeaf: false },
    { userId: "33333333333333333", channelId: "solo", isBot: false, isAfk: false, selfDeaf: false, serverDeaf: false },
  ]);
  assert.deepEqual(eligible, ["11111111111111111", "22222222222222222"]);
});

test("voice XP excludes bots, AFK members, and deafened members", () => {
  const eligible = eligibleVoiceXpUsers([
    { userId: "11111111111111111", channelId: "voice", isBot: false, isAfk: false, selfDeaf: false, serverDeaf: false },
    { userId: "22222222222222222", channelId: "voice", isBot: false, isAfk: false, selfDeaf: true, serverDeaf: false },
    { userId: "33333333333333333", channelId: "afk", isBot: false, isAfk: true, selfDeaf: false, serverDeaf: false },
    { userId: "44444444444444444", channelId: "bot", isBot: true, isAfk: false, selfDeaf: false, serverDeaf: false },
  ]);
  assert.deepEqual(eligible, []);
});

test("voice XP event keys are stable within a bucket and distinct across members and buckets", () => {
  const first = voiceXpEventKey("11111111111111111", 301_000, 300);
  assert.equal(voiceXpEventKey("11111111111111111", 599_999, 300), first);
  assert.notEqual(voiceXpEventKey("22222222222222222", 301_000, 300), first);
  assert.notEqual(voiceXpEventKey("11111111111111111", 600_000, 300), first);
  assert.throws(() => voiceXpEventKey("short", 301_000, 300), /invalid-voice-xp-user/);
});
