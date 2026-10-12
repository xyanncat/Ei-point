import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { createApp } from "../../apps/api/dist/app.js";

let server, pool;
before(
  async () => {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    server = new EmbeddedPostgres({
      databaseDir: await mkdtemp(join(tmpdir(), "ei-phase4-")),
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
test("real PostgreSQL OAuth session persists encrypted credentials, scopes registry and revokes logout", async () => {
  const guild = "100000000000000001",
    user = "200000000000000001",
    secret = "isolated-test-secret-at-least-32-characters";
  await pool.query(
    "INSERT INTO access.guilds(guild_id,name,owner_id,approved) VALUES($1,'Test guild',$2,true)",
    [guild, user],
  );
  await pool.query(
    "INSERT INTO config.bots(bot_key,application_id,modules,guild_ids) VALUES('community','300000000000000001',ARRAY['community','games'],$1)",
    [[guild]],
  );
  const env = {
    SESSION_SECRET: secret,
    CSRF_SECRET: secret,
    DISCORD_CLIENT_ID: "test",
    DISCORD_CLIENT_SECRET: "private",
    OAUTH_REDIRECT_URL: "https://example.test/api/auth/callback",
  };
  const app = createApp({
    env,
    query: async (sql, args) => (await pool.query(sql, args)).rows,
    fetchFn: async (url) => {
      if (String(url).includes("/oauth2/token"))
        return Response.json({
          access_token: "private-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      if (String(url).includes("/users/@me/guilds"))
        return Response.json([{ id: guild, owner: true, permissions: "0" }]);
      return Response.json({ id: user, username: "Test owner" });
    },
  });
  try {
    const login = await app.inject({ url: "/api/auth/login" });
    const state = new URL(login.headers.location).searchParams.get("state");
    const stateCookie = login.headers["set-cookie"].split(";")[0];
    const callback = await app.inject({
      url: `/api/auth/callback?code=test-code&state=${encodeURIComponent(state)}`,
      headers: { cookie: stateCookie },
    });
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "/dashboard");
    const sessionCookie = callback.headers["set-cookie"]
      .find((c) => c.startsWith("ei_session="))
      .split(";")[0];
    assert.ok(!sessionCookie.includes("private-access-token"));
    const stored = (
      await pool.query("SELECT encrypted_token FROM access.sessions")
    ).rows[0].encrypted_token;
    assert.ok(!stored.includes("private-access-token"));
    const headers = { cookie: sessionCookie };
    const overview = await app.inject({
      url: `/api/overview?guildId=${guild}`,
      headers,
    });
    assert.equal(overview.statusCode, 200);
    assert.equal(overview.json().cards[0].botKey, "community");
    assert.equal(overview.json().cards[0].state, "unknown");
    assert.equal(overview.json().stale, true);
    await pool.query(
      "UPDATE access.guilds SET approved=false WHERE guild_id=$1",
      [guild],
    );
    assert.equal(
      (await app.inject({ url: `/api/overview?guildId=${guild}`, headers }))
        .statusCode,
      403,
    );
    const csrf = (await app.inject({ url: "/api/auth/csrf", headers })).json()
      .csrfToken;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { ...headers, "x-csrf-token": csrf },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await pool.query("SELECT revoked,encrypted_token FROM access.sessions"))
        .rows[0].revoked,
      true,
    );
    assert.equal(
      (await pool.query("SELECT encrypted_token FROM access.sessions")).rows[0]
        .encrypted_token,
      null,
    );
    assert.equal(
      (await app.inject({ url: "/api/auth/me", headers })).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});
