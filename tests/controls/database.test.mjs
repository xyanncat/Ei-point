import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import {
  applyCommunityConfiguration,
  isControlEnabled,
  consumeEmbedJob,
  transaction,
} from "../../packages/flow/dist/index.js";
import { deliverMessages } from "../../apps/bots/community/dist/delivery.js";
import { CommunityService } from "../../packages/modules/community/dist/index.js";
let server, pool;
const guild = "100000000000000001",
  identity = "custom-crew";
before(
  async () => {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    server = new EmbeddedPostgres({
      databaseDir: await mkdtemp(join(tmpdir(), "ei-controls-")),
      port,
      user: "postgres",
      password: "isolated-test-only",
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    pool = new pg.Pool({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password: "isolated-test-only",
      database: "postgres",
      max: 5,
    });
    const dir = new URL("../../infra/postgres/migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(await readFile(new URL(name, dir), "utf8"));
  },
  { timeout: 120000 },
);
after(async () => {
  await pool?.end();
  await server?.stop();
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE access.guilds,config.bots,config.settings,config.settings_history,community.welcome_templates,ops.jobs,ops.outbox CASCADE",
  );
  await pool.query(
    "INSERT INTO access.guilds(guild_id,name,owner_id,approved) VALUES($1,'Fixture','200000000000000001',true)",
    [guild],
  );
  await pool.query(
    "INSERT INTO config.bots(bot_key,application_id,modules,guild_ids) VALUES($1,'300000000000000001',ARRAY['community','security','leveling'],ARRAY[$2])",
    [identity, guild],
  );
});
const query = async (sql, params) => (await pool.query(sql, params)).rows;
test("actual runtime honors guild pause, bot disable and command roles", async () => {
  assert.equal(await isControlEnabled(query, guild, identity), true);
  await pool.query(
    "INSERT INTO config.guild_controls(guild_id,server_paused,updated_by) VALUES($1,true,'staff')",
    [guild],
  );
  assert.equal(await isControlEnabled(query, guild, identity), false);
  await pool.query("UPDATE config.guild_controls SET server_paused=false");
  await pool.query(
    "INSERT INTO config.bot_states(guild_id,bot_key,enabled,updated_by) VALUES($1,$2,false,'staff')",
    [guild, identity],
  );
  assert.equal(await isControlEnabled(query, guild, identity), false);
  await pool.query("UPDATE config.bot_states SET enabled=true");
  await pool.query(
    "INSERT INTO config.command_permissions(guild_id,bot_key,command,role_ids,updated_by) VALUES($1,$2,'rank',ARRAY['400000000000000001'],'staff')",
    [guild, identity],
  );
  assert.equal(
    await isControlEnabled(query, guild, identity, "rank", []),
    false,
  );
  assert.equal(
    await isControlEnabled(query, guild, identity, "rank", [
      "400000000000000001",
    ]),
    true,
  );
});
test("consumed community fields persist and only supported exact version gets applied timestamp", async () => {
  const config = {
    welcome_channel: "500000000000000001",
    leave_channel: "",
    level_channel: "",
    welcome_message: "Welcome {username} {user} to {server}",
    leave_message: "",
  };
  await pool.query(
    "INSERT INTO config.settings(scope,key,version,value,updated_by) VALUES($1,'community',1,$2,'staff'),($1,'security',1,'{\"enabled\":true}','staff')",
    [`guild:${guild}`, JSON.stringify(config)],
  );
  assert.equal(await applyCommunityConfiguration(pool, guild, identity), 1);
  const installed = (
    await pool.query(
      "SELECT template FROM community.welcome_templates WHERE guild_id=$1",
      [guild],
    )
  ).rows[0].template;
  assert.equal(installed.welcomeChannelId, config.welcome_channel);
  assert.equal(
    installed.welcomeTemplate,
    "Welcome {username} {user} to {guild}",
  );
  await new CommunityService(pool).memberEvent({
    guildId: guild,
    userId: "200000000000000001",
    userName: "traveler",
    guildName: "Fixture",
    memberCount: 2,
    event: "join",
    key: "test-welcome",
  });
  assert.equal(
    (
      await pool.query(
        "SELECT payload->>'content' content FROM ops.outbox WHERE type='community.message'",
      )
    ).rows[0].content,
    "Welcome traveler <@200000000000000001> to Fixture",
  );
  const states = (
    await pool.query("SELECT key,applied_at FROM config.settings ORDER BY key")
  ).rows;
  assert.ok(states.find((r) => r.key === "community").applied_at);
  assert.equal(states.find((r) => r.key === "security").applied_at, null);
  assert.equal(await applyCommunityConfiguration(pool, guild, identity), 0);
});
test("paused durable embed stays pending with no send", async () => {
  await pool.query(
    "INSERT INTO config.guild_controls(guild_id,server_paused,updated_by) VALUES($1,true,'staff')",
    [guild],
  );
  await pool.query(
    "INSERT INTO ops.jobs(kind,payload,idempotency_key) VALUES('dashboard.embed',$1,'test-job')",
    [JSON.stringify({ guild_id: guild, bot_id: identity })],
  );
  let sent = false;
  assert.equal(
    await consumeEmbedJob({
      query,
      transaction: (work) =>
        transaction(pool, (db) =>
          work(async (sql, params) => (await db.query(sql, params)).rows),
        ),
      token: "never-sent",
      botKey: identity,
      send: async () => {
        sent = true;
      },
    }),
    "deferred",
  );
  assert.equal(sent, false);
  assert.equal(
    (await pool.query("SELECT status FROM ops.jobs")).rows[0].status,
    "pending",
  );
});
test("disabled guild notifications prevent leasing community outbox events", async () => {
  await pool.query(
    "INSERT INTO config.guild_controls(guild_id,notifications_enabled,updated_by) VALUES($1,false,'staff')",
    [guild],
  );
  await pool.query(
    "INSERT INTO ops.outbox(aggregate,aggregate_id,type,payload,correlation_id) VALUES('community',$1,'community.message',$2,'fixture')",
    [
      guild,
      JSON.stringify({
        guildId: guild,
        channelId: "500000000000000001",
        content: "hello",
        category: "welcome",
      }),
    ],
  );
  let sent = false;
  assert.equal(
    await deliverMessages(
      pool,
      [guild],
      async () => {
        sent = true;
      },
      identity,
    ),
    0,
  );
  assert.equal(sent, false);
  assert.equal(
    (await pool.query("SELECT attempts,published FROM ops.outbox")).rows[0]
      .attempts,
    0,
  );
  await pool.query(
    "UPDATE config.guild_controls SET notifications_enabled=true,notification_preferences='{\"welcome\":false}'::jsonb",
  );
  assert.equal(
    await deliverMessages(
      pool,
      [guild],
      async () => {
        sent = true;
      },
      identity,
    ),
    0,
  );
  assert.equal(sent, false);
});
