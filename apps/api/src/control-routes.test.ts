import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  registerControlRoutes,
  validateEmbed,
  type ControlDependencies,
  type ControlQuery,
} from "./control-routes.js";
import { consumeEmbedJob, isControlEnabled } from "./control-consumer.js";
const guild = "123456789012345678";
function fixture(overrides: Partial<ControlDependencies> = {}) {
  const app = Fastify();
  const statements: { sql: string; params: unknown[] | undefined }[] = [];
  const query: ControlQuery = async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes("FROM config.bots"))
      return [{ bot_key: "configured-identity", modules: ["moderation"] }];
    return [];
  };
  registerControlRoutes(app, {
    query,
    transaction: async (work) => work(overrides.query ?? query),
    authorize: async () => ({ userId: "staff" }),
    env: { SESSION_SECRET: "x".repeat(32) },
    ...overrides,
  });
  return { app, statements };
}
test("authorization denial occurs before reading configuration or secrets", async () => {
  const { app, statements } = fixture({
    authorize: async () => {
      throw Object.assign(new Error("denied"), { statusCode: 403 });
    },
  });
  const r = await app.inject(`/api/guilds/${guild}/configuration/moderation`);
  assert.equal(r.statusCode, 403);
  assert.equal(statements.length, 0);
  await app.close();
});
test("host CSRF hook prevents mutation; control routes do not bypass it", async () => {
  const app = Fastify();
  let writes = 0;
  app.addHook("preHandler", async (r, reply) => {
    if (r.method === "PUT" && r.headers["x-csrf-token"] !== "trusted")
      return reply.code(403).send({ error: "csrf" });
  });
  registerControlRoutes(app, {
    query: async () => {
      writes++;
      return [];
    },
    transaction: async (f) => f(async () => []),
    authorize: async () => ({ userId: "staff" }),
    env: {},
  });
  const r = await app.inject({
    method: "PUT",
    url: "/api/admin/secrets/KEY",
    payload: { value: "sensitive" },
  });
  assert.equal(r.statusCode, 403);
  assert.equal(writes, 0);
  await app.close();
});
test("module-specific authorization scope is forwarded", async () => {
  let module: string | undefined;
  const { app } = fixture({
    authorize: async (_r, _g, _s, m) => {
      module = m;
      return { userId: "staff" };
    },
  });
  await app.inject(`/api/guilds/${guild}/configuration/moderation`);
  assert.equal(module, "moderation");
  await app.close();
});
test("optimistic concurrent edits produce one saved version and one conflict", async () => {
  let version = 0;
  let release: () => void = () => {};
  let gate = Promise.resolve();
  const writes: string[] = [];
  const query: ControlQuery = async (sql, params) => {
    if (sql.includes("FROM config.bots")) return [{ bot_key: "one" }];
    if (sql.startsWith("SELECT version")) return version ? [{ version }] : [];
    if (sql.startsWith("INSERT INTO config.settings(")) {
      version = Number(params![2]);
      writes.push(sql);
      return [
        { version, value: JSON.parse(String(params![3])), applied_at: null },
      ];
    }
    writes.push(sql);
    return [];
  };
  const { app } = fixture({
    query,
    transaction: async (work) => {
      const before = gate;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const done = release;
      await before;
      try {
        return await work(query);
      } finally {
        done();
      }
    },
  });
  const request = {
    method: "PUT" as const,
    url: `/api/guilds/${guild}/configuration/moderation`,
    payload: {
      expectedVersion: 0,
      config: { automod_log_channel: "", automod_warnings: true },
    },
  };
  const results = await Promise.all([app.inject(request), app.inject(request)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const saved = results.find((r) => r.statusCode === 200)!.json();
  assert.equal(saved.status, "saved");
  assert.equal(saved.configuration.applied_at, null);
  assert.equal(
    writes.filter((s) => s.startsWith("INSERT INTO config.settings(")).length,
    1,
  );
  assert.ok(writes.some((s) => s.includes("settings_history")));
  assert.ok(writes.some((s) => s.includes("ops.outbox")));
  await app.close();
});
test("secret listing never queries or returns encrypted values", async () => {
  const sqls: string[] = [];
  const { app } = fixture({
    query: async (sql) => {
      sqls.push(sql);
      return [{ name: "BOT_TOKEN", updated_at: "today" }];
    },
  });
  const r = await app.inject("/api/admin/secrets");
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().secrets, [
    { name: "BOT_TOKEN", updated_at: "today", masked: "••••••••" },
  ]);
  assert.ok(sqls.every((s) => !s.includes("encrypted_value")));
  await app.close();
});
test("secret creation persists ciphertext and audits only secret name", async () => {
  const { app, statements } = fixture();
  const r = await app.inject({
    method: "PUT",
    url: "/api/admin/secrets/BOT_TOKEN",
    payload: { value: "private-token" },
  });
  assert.equal(r.statusCode, 200);
  const insert = statements.find((s) =>
    s.sql.includes("INSERT INTO access.secret_vault"),
  )!;
  assert.notEqual(insert.params![1], "private-token");
  assert.ok(!JSON.stringify(r.json()).includes("private-token"));
  const audit = statements.find((s) => s.sql.includes("control_audit"))!;
  assert.ok(!JSON.stringify(audit.params).includes("private-token"));
  await app.close();
});
test("internal routes reject OAuth-only requests and missing service token", async () => {
  const { app, statements } = fixture();
  const r = await app.inject({
    url: "/api/internal/accounts",
    headers: { cookie: "session=valid" },
  });
  assert.equal(r.statusCode, 401);
  assert.equal(statements.length, 0);
  await app.close();
});
test("embed rejects non-http URLs, invalid fields, oversized aggregate content", () => {
  const base = {
    bot_id: "configured-identity",
    channel_id: guild,
    title: "hello",
  };
  assert.throws(() => validateEmbed({ ...base, image: "file:///private" }));
  assert.throws(() =>
    validateEmbed({ ...base, fields: [{ name: "name", value: "" }] }),
  );
  assert.throws(() =>
    validateEmbed({
      ...base,
      description: "x".repeat(4096),
      footer: "x".repeat(2048),
    }),
  );
  assert.equal(validateEmbed(base).title, "hello");
});
test("embed delivery queues a durable job with pending status and never claims sent", async () => {
  const { app, statements } = fixture({ authorizeChannel: async () => {} });
  const r = await app.inject({
    method: "POST",
    url: `/api/guilds/${guild}/embeds`,
    payload: {
      bot_id: "configured-identity",
      channel_id: guild,
      title: "hello",
    },
  });
  assert.equal(r.statusCode, 202);
  assert.equal(r.json().status, "pending");
  assert.equal(r.json().queued, true);
  assert.ok(statements.some((s) => s.sql.includes("INSERT INTO ops.jobs")));
  assert.ok(statements.some((s) => s.sql.includes("INSERT INTO ops.outbox")));
  await app.close();
});
test("embed fails closed when channel permission verifier is unavailable", async () => {
  const { app, statements } = fixture();
  const r = await app.inject({
    method: "POST",
    url: `/api/guilds/${guild}/embeds`,
    payload: {
      bot_id: "configured-identity",
      channel_id: guild,
      title: "hello",
    },
  });
  assert.equal(r.statusCode, 503);
  assert.ok(!statements.some((s) => s.sql.includes("INSERT INTO ops.jobs")));
  await app.close();
});
test("worker never leases or sends without explicit token; paused state denies commands", async () => {
  let called = false;
  const q: ControlQuery = async () => {
    called = true;
    return [];
  };
  assert.equal(
    await consumeEmbedJob({
      query: q,
      transaction: async (f) => f(q),
      send: async () => {
        called = true;
      },
    }),
    "disabled",
  );
  assert.equal(called, false);
  assert.equal(
    await isControlEnabled(
      async () => [
        { approved: true, enabled: true, paused: true, server_paused: false },
      ],
      guild,
      "one",
    ),
    false,
  );
  assert.equal(
    await isControlEnabled(
      async () => [
        {
          approved: true,
          enabled: true,
          paused: false,
          server_paused: false,
          role_ids: ["admin"],
        },
      ],
      guild,
      "one",
      "ban",
      ["member"],
    ),
    false,
  );
});

test("infrastructure account rejects plaintext credentials and removed provider", async () => {
  const { app, statements } = fixture();
  for (const body of [
    {
      provider: "supabase",
      account_name: "legacy",
      secret_ref: "ACCOUNT_TOKEN",
    },
    {
      provider: "postgres",
      account_name: "local",
      secret_ref: "ACCOUNT_TOKEN",
      endpoint: "postgres://user:password@localhost/db",
    },
    {
      provider: "postgres",
      account_name: "local",
      secret_ref: "ACCOUNT_TOKEN",
      metadata: { password: "private" },
    },
  ]) {
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/accounts",
      payload: body,
    });
    assert.equal(r.statusCode, 400);
  }
  assert.ok(!statements.some((s) => s.sql.startsWith("INSERT")));
  await app.close();
});

test("runtime service config acknowledgement cannot be invoked through OAuth", async () => {
  const { app, statements } = fixture({
    env: { INTERNAL_SERVICE_TOKEN: "service-token".repeat(4) },
  });
  const r = await app.inject({
    method: "POST",
    url: "/api/internal/config/applied",
    headers: { cookie: "session=valid" },
    payload: { guild_id: guild, module_id: "moderation", version: 1 },
  });
  assert.equal(r.statusCode, 401);
  assert.equal(statements.length, 0);
  await app.close();
});

test("runtime service acknowledgement updates only an existing exact version", async () => {
  const token = "service-token".repeat(4),
    sqls: { sql: string; params?: unknown[] | undefined }[] = [];
  const { app } = fixture({
    env: { INTERNAL_SERVICE_TOKEN: token },
    query: async (sql, params) => {
      sqls.push({ sql, params });
      if (sql.includes("FROM config.bots")) return [{ bot_key: "one" }];
      if (sql.startsWith("UPDATE config.settings"))
        return [{ version: 3, applied_at: "now" }];
      return [];
    },
  });
  const r = await app.inject({
    method: "POST",
    url: "/api/internal/config/applied",
    headers: { authorization: `Bearer ${token}` },
    payload: { guild_id: guild, module_id: "moderation", version: 3 },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().status, "applied");
  assert.deepEqual(
    sqls.find((s) => s.sql.startsWith("UPDATE config.settings"))!.params,
    [`guild:${guild}`, "moderation", 3],
  );
  assert.ok(sqls.some((s) => s.sql.includes("control_audit")));
  await app.close();
});

test("approving a third guild is refused while two are approved", async () => {
  const seen: string[] = [];
  const { app } = fixture({
    query: async (sql) => {
      seen.push(sql);
      if (sql.includes("COUNT")) return [{ n: 2 }];
      if (sql.startsWith("INSERT INTO access.guilds"))
        return [{ guild_id: "333333333333333333" }];
      return [];
    },
  });
  const r = await app.inject({
    method: "PUT",
    url: "/api/admin/guilds",
    payload: {
      guild_id: "333333333333333333",
      owner_id: "444444444444444444",
      name: "Third",
      approved: true,
    },
  });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().code, "guild-locked");
  assert.ok(seen.some((s) => s.includes("pg_advisory_xact_lock")));
  await app.close();
});

test("re-saving an approved guild does not trip the two-guild lock", async () => {
  const { app } = fixture({
    query: async (sql) => {
      if (sql.includes("COUNT")) return [{ n: 1 }];
      if (sql.startsWith("INSERT INTO access.guilds"))
        return [{ guild_id: "111111111111111111" }];
      return [];
    },
  });
  const r = await app.inject({
    method: "PUT",
    url: "/api/admin/guilds",
    payload: {
      guild_id: "111111111111111111",
      owner_id: "444444444444444444",
      name: "First",
      approved: true,
    },
  });
  assert.equal(r.statusCode, 200);
  await app.close();
});
