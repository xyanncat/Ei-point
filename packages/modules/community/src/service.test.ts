import assert from "node:assert/strict";
import test from "node:test";
import { CommunityService, DEFAULT_SETTINGS } from "./service.js";
import type { SqlPool } from "@ei-point/flow";

function mockPool(options: { settings?: Record<string, unknown>; seen?: boolean; cooldownAllows?: boolean } = {}) {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, ...(values ? { values } : {}) });
        if (sql.includes("SELECT approved FROM access.guilds")) return { rows: [{ approved: true }], rowCount: 1 };
        if (sql.includes("SELECT template FROM community.welcome_templates"))
          return { rows: [{ template: options.settings ?? {} }], rowCount: 1 };
        if (sql.includes("INSERT INTO community.xp_events"))
          return { rows: [], rowCount: options.seen === false ? 0 : 1 };
        if (sql.includes("SELECT xp,level,last_awarded_at,last_voice_awarded_at FROM community.xp"))
          return { rows: [{ xp: "90", level: 0, last_awarded_at: null, last_voice_awarded_at: null }], rowCount: 1 };
        if (sql.includes("UPDATE community.xp SET xp=xp+$3"))
          return { rows: options.cooldownAllows === false ? [] : [{ xp: String(90 + Number(values?.[2])) }], rowCount: options.cooldownAllows === false ? 0 : 1 };
        return { rows: [], rowCount: 1 };
      },
      release: () => {},
    }),
    query: async () => ({ rows: [], rowCount: 0 }),
  };
  return { pool: pool as unknown as SqlPool, statements };
}

test("voice XP is opt-in by default and has a bounded award interval", async () => {
  assert.equal(DEFAULT_SETTINGS.voiceXpEnabled, false);
  assert.equal(DEFAULT_SETTINGS.voiceXpAmount, 5);
  assert.equal(DEFAULT_SETTINGS.voiceIntervalSeconds, 300);
  const { pool, statements } = mockPool();
  const result = await new CommunityService(pool).awardXp({
    guildId: "11111111111111111",
    userId: "22222222222222222",
    messageId: "voice:300:22222222222222222:1",
    source: "voice",
  });
  assert.equal(result.awarded, false);
  assert.equal(statements.some(({ sql }) => sql.includes("UPDATE community.xp SET xp=xp+$3")), false);
});

test("voice XP uses its amount and its per-source cooldown", async () => {
  const { pool, statements } = mockPool({ settings: { voiceXpEnabled: true, voiceXpAmount: 7, cooldownSeconds: 90, voiceIntervalSeconds: 300 } });
  const result = await new CommunityService(pool).awardXp({
    guildId: "11111111111111111",
    userId: "22222222222222222",
    messageId: "voice:300:22222222222222222:1",
    source: "voice",
  });
  assert.deepEqual(result, { awarded: true, duplicate: false, xp: "97", level: 0 });
  const update = statements.find(({ sql }) => sql.includes("UPDATE community.xp SET xp=xp+$3"));
  assert.match(update?.sql ?? "", /last_voice_awarded_at=now\(\)/);
  assert.deepEqual(update?.values?.slice(2), [7, 300]);
});

test("text XP uses its amount and its per-source cooldown", async () => {
  const { pool, statements } = mockPool({ settings: { xpEnabled: true, xpPerMessage: 18, cooldownSeconds: 120 } });
  const result = await new CommunityService(pool).awardXp({
    guildId: "11111111111111111",
    userId: "22222222222222222",
    messageId: "33333333333333333",
    source: "message",
  });
  assert.equal(result.awarded, true);
  const update = statements.find(({ sql }) => sql.includes("UPDATE community.xp SET xp=xp+$3"));
  assert.match(update?.sql ?? "", /last_awarded_at=now\(\)/);
  assert.deepEqual(update?.values?.slice(2), [18, 120]);
});

test("voice XP respects per-member cooldown and ignores an already-seen interval", async () => {
  const denied = mockPool({ settings: { voiceXpEnabled: true }, cooldownAllows: false });
  const deniedResult = await new CommunityService(denied.pool).awardXp({
    guildId: "11111111111111111",
    userId: "22222222222222222",
    messageId: "voice:300:22222222222222222:1",
    source: "voice",
  });
  assert.equal(deniedResult.awarded, false);

  const duplicate = mockPool({ settings: { voiceXpEnabled: true }, seen: false });
  const duplicateResult = await new CommunityService(duplicate.pool).awardXp({
    guildId: "11111111111111111",
    userId: "22222222222222222",
    messageId: "voice:300:22222222222222222:1",
    source: "voice",
  });
  assert.equal(duplicateResult.awarded, false);
  assert.equal(duplicateResult.duplicate, true);
  assert.equal(duplicate.statements.some(({ sql }) => sql.includes("UPDATE community.xp SET xp=xp+$3")), false);
});
