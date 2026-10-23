import test from "node:test";
import assert from "node:assert/strict";
import {
  communityConfigurationPatch,
  applyCommunityConfiguration,
  consumeEmbedJob,
  isControlEnabled,
} from "./controls.js";
import { DEFAULT_MASTER_IDS } from "@ei-point/contracts";
import type { SqlPool } from "./database.js";
test("community configuration maps every supported field and preserves unsupported settings as pending", () => {
  assert.deepEqual(
    communityConfigurationPatch("community", {
      welcome_channel: "123456789012345678",
      leave_channel: "",
      level_channel: "",
      welcome_message: "Hello {user} to {server} #{membercount}",
      leave_message: "",
    }),
    {
      welcomeChannelId: "123456789012345678",
      leaveChannelId: null,
      levelChannelId: null,
      welcomeTemplate: "Hello {user} to {guild} #{count}",
      leaveTemplate: "{user} left {guild}.",
    },
  );
  assert.equal(
    communityConfigurationPatch("security", { enabled: true }),
    null,
  );
  assert.equal(
    communityConfigurationPatch("welcome", {
      welcome_channel: "",
      leave_channel: "",
      welcome_message: "{unsupported}",
      leave_message: "",
    }),
    null,
  );
  assert.equal(
    communityConfigurationPatch("leveling", { level_channel: "bad" }),
    null,
  );
});
test("runtime installation and applied acknowledgement occur in the same transaction; unsupported module stays saved", async () => {
  const sqls: string[] = [];
  let released = false;
  const client = {
    release: () => {
      released = true;
    },
    query: async (sql: string) => {
      sqls.push(sql);
      if (sql.includes("approved FROM"))
        return { rows: [{ approved: true }], rowCount: 1 };
      if (sql.includes("g.approved"))
        return { rows: [{ approved: true, enabled: true }], rowCount: 1 };
      if (sql.includes("SELECT modules"))
        return { rows: [{ modules: ["community", "security"] }], rowCount: 1 };
      if (sql.includes("DISTINCT ON"))
        return {
          rows: [
            {
              key: "community",
              version: 4,
              value: {
                welcome_channel: "",
                leave_channel: "",
                level_channel: "",
                welcome_message: "hello",
                leave_message: "goodbye",
              },
            },
            { key: "security", version: 1, value: { enabled: true } },
          ],
          rowCount: 2,
        };
      return { rows: [], rowCount: 1 };
    },
  };
  const pool: SqlPool = { query: client.query, connect: async () => client };
  assert.equal(
    await applyCommunityConfiguration(pool, "123456789012345678", "identity"),
    1,
  );
  assert.equal(sqls[0], "BEGIN");
  assert.equal(sqls.at(-1), "COMMIT");
  assert.equal(
    sqls.filter((s) => s.startsWith("UPDATE config.settings")).length,
    1,
  );
  assert.ok(
    sqls.findIndex((s) =>
      s.startsWith("INSERT INTO community.welcome_templates"),
    ) < sqls.findIndex((s) => s.startsWith("UPDATE config.settings")),
  );
  assert.equal(released, true);
});
test("failed runtime installation rolls back and never acknowledges configuration", async () => {
  const sqls: string[] = [];
  const client = {
    release: () => {},
    query: async (sql: string) => {
      sqls.push(sql);
      if (sql.includes("approved FROM"))
        return { rows: [{ approved: true }], rowCount: 1 };
      if (sql.includes("g.approved"))
        return { rows: [{ approved: true, enabled: true }], rowCount: 1 };
      if (sql.includes("SELECT modules"))
        return { rows: [{ modules: ["leveling"] }], rowCount: 1 };
      if (sql.includes("DISTINCT ON"))
        return {
          rows: [{ key: "leveling", version: 2, value: { level_channel: "" } }],
          rowCount: 1,
        };
      if (sql.startsWith("INSERT INTO community"))
        throw Error("db-write-failed");
      return { rows: [], rowCount: 1 };
    },
  };
  await assert.rejects(() =>
    applyCommunityConfiguration(
      { query: client.query, connect: async () => client },
      "123456789012345678",
      "identity",
    ),
  );
  assert.equal(sqls.at(-1), "ROLLBACK");
  assert.ok(!sqls.some((s) => s.startsWith("UPDATE config.settings")));
});
test("the master identity is not bound by a server's role list", async () => {
  const row = {
    approved: true,
    bot_key: "kafka",
    server_paused: false,
    enabled: true,
    paused: false,
    command_enabled: true,
    role_ids: ["145000000000000001"],
  };
  const query = async () => [row];
  // A member without the required role is refused…
  assert.equal(
    await isControlEnabled(query, "guild", "kafka", "ban", ["999999999999999999"]),
    false,
  );
  // …the master is not, whatever roles the server handed out.
  assert.equal(
    await isControlEnabled(query, "guild", "kafka", "ban", [], DEFAULT_MASTER_IDS[0]),
    true,
  );
});

test("a paused bot stays paused even for the master", async () => {
  const query = async () => [
    {
      approved: true,
      bot_key: "kafka",
      server_paused: false,
      enabled: true,
      paused: true,
      command_enabled: true,
      role_ids: [],
    },
  ];
  assert.equal(
    await isControlEnabled(query, "guild", "kafka", "ban", [], DEFAULT_MASTER_IDS[0]),
    false,
  );
});

test("paused embed job is deferred with no send and never completes", async () => {  const writes: string[] = [];
  let sent = false;
  const query = async (sql: string) => {
    writes.push(sql);
    if (sql.includes("SELECT job_id"))
      return [
        {
          job_id: "job",
          payload: { guild_id: "123456789012345678", bot_id: "identity" },
        },
      ];
    if (sql.includes("g.approved"))
      return [{ approved: true, enabled: true, paused: true }];
    return [];
  };
  assert.equal(
    await consumeEmbedJob({
      query,
      transaction: async (f) => f(query),
      token: "explicit",
      botKey: "identity",
      send: async () => {
        sent = true;
      },
    }),
    "deferred",
  );
  assert.equal(sent, false);
  assert.ok(writes.some((s) => s.includes("status='pending'")));
  assert.ok(!writes.some((s) => s.includes("status='done'")));
});
