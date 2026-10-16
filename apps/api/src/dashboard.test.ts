import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { signSession } from "./session.js";
import { buildAuthorizeUrl } from "./oauth.js";

const user = "111111111111111111",
  guild = "222222222222222222";
const secret = "test-only-secret-with-at-least-32-characters";
const env = {
  SESSION_SECRET: secret,
  CSRF_SECRET: secret,
  DISCORD_CLIENT_ID: "client",
  DISCORD_CLIENT_SECRET: "private",
  OAUTH_REDIRECT_URL: "https://example.test/api/auth/callback",
};
const sessionId = "12345678-1234-4234-8234-123456789012";
const cookie = () =>
  `ei_session=${signSession({ discordUserId: user, sessionId }, secret)}`;
function fixture(
  options: {
    owner?: boolean;
    roles?: string[];
    stale?: boolean;
    revoked?: boolean;
    failDb?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const app = createApp({
    env,
    query: async (sql: string) => {
      calls.push(sql);
      if (options.failDb) throw Error("postgresql://secret:password@private");
      if (sql.includes("FROM access.sessions"))
        return options.revoked
          ? []
          : [
              {
                session_id: sessionId,
                discord_user_id: user,
                display_name: "Test user",
                encrypted_token: "token",
                expires_at: new Date(Date.now() + 3600000),
              },
            ];
      if (sql.includes("FROM access.guilds"))
        return [
          {
            guild_id: guild,
            name: "Test guild",
            owner_id: user,
            approved: true,
          },
        ];
      if (sql.includes("FROM access.staff_roles"))
        return [
          {
            guild_id: guild,
            role_id: "333333333333333333",
            scope: "moderation",
          },
        ];
      if (sql.includes("FROM config.bots"))
        return [
          {
            bot_key: "community",
            modules: ["community", "games"],
            guild_ids: [guild],
          },
        ];
      if (sql.includes("FROM ops.service_status"))
        return [
          {
            service: "bot-community",
            liveness: "ok",
            gateway: "ok",
            db_ready: true,
            provider: "unknown",
            latency_ms: 180,
            updated_at: new Date(Date.now() - (options.stale ? 120000 : 0)),
          },
        ];
      if (sql.includes("FROM security.incidents")) return [];
      if (sql.includes("FROM config.settings_history")) return [];
      return [];
    },
    decryptToken: () => "access",
    fetchFn: (async (url: string | URL | Request) => {
      if (String(url).includes("/member"))
        return Response.json({ roles: options.roles ?? [] });
      return Response.json([
        { id: guild, owner: options.owner ?? true, permissions: "0" },
      ]);
    }) as typeof fetch,
  });
  return { app, calls };
}
test("private dashboard endpoints reject anonymous requests before database work", async () => {
  const { app, calls } = fixture();
  for (const url of [
    "/api/auth/me",
    "/api/guilds",
    `/api/services?guildId=${guild}`,
    `/api/overview?guildId=${guild}`,
  ])
    assert.equal((await app.inject({ url })).statusCode, 401);
  assert.equal(calls.length, 0);
  await app.close();
});
test("owner sees only authorized guilds and a registry-driven scoped overview", async () => {
  const { app } = fixture();
  const headers = { cookie: cookie() };
  const list = await app.inject({ url: "/api/guilds", headers });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().guilds[0].scopes, ["*"]);
  const overview = await app.inject({
    url: `/api/overview?guildId=${guild}`,
    headers,
  });
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json().cards.length, 1);
  assert.equal(overview.json().cards[0].botKey, "community");
  assert.deepEqual(overview.json().incidents, []);
  await app.close();
});
test("ordinary member is denied; matching staff role receives its own scopes only", async () => {
  const denied = fixture({ owner: false });
  assert.deepEqual(
    (
      await denied.app.inject({
        url: "/api/guilds",
        headers: { cookie: cookie() },
      })
    ).json().guilds,
    [],
  );
  assert.equal(
    (
      await denied.app.inject({
        url: `/api/services?guildId=${guild}`,
        headers: { cookie: cookie() },
      })
    ).statusCode,
    403,
  );
  await denied.app.close();
  const staff = fixture({ owner: false, roles: ["333333333333333333"] });
  const result = await staff.app.inject({
    url: "/api/guilds",
    headers: { cookie: cookie() },
  });
  assert.deepEqual(result.json().guilds[0].scopes, ["overview", "moderation"]);
  await staff.app.close();
});
test("revoked session and unapproved guild cannot read data", async () => {
  const revoked = fixture({ revoked: true });
  assert.equal(
    (
      await revoked.app.inject({
        url: "/api/guilds",
        headers: { cookie: cookie() },
      })
    ).statusCode,
    401,
  );
  await revoked.app.close();
  const { app } = fixture();
  assert.equal(
    (
      await app.inject({
        url: "/api/services?guildId=999999999999999999",
        headers: { cookie: cookie() },
      })
    ).statusCode,
    403,
  );
  await app.close();
});
test("stale heartbeat never appears healthy, and database errors contain no secrets", async () => {
  const stale = fixture({ stale: true });
  const result = await stale.app.inject({
    url: `/api/services?guildId=${guild}`,
    headers: { cookie: cookie() },
  });
  assert.equal(result.json().cards[0].stale, true);
  assert.equal(result.json().cards[0].state, "unknown");
  await stale.app.close();
  const bad = fixture({ failDb: true });
  const failure = await bad.app.inject({
    url: "/api/guilds",
    headers: { cookie: cookie() },
  });
  assert.equal(failure.statusCode, 503);
  assert.ok(!failure.body.includes("password"));
  assert.ok(failure.json().correlationId);
  await bad.app.close();
});
test("OAuth callback requires the same-browser state cookie before any provider call", async () => {
  const { app } = fixture();
  const { state } = buildAuthorizeUrl({
    clientId: "client",
    clientSecret: "private",
    redirectUrl: env.OAUTH_REDIRECT_URL,
    stateSecret: secret,
  });
  assert.equal(
    (await app.inject({ url: `/api/auth/callback?code=abc&state=${state}` }))
      .statusCode,
    401,
  );
  const login = await app.inject({ url: "/api/auth/login" });
  assert.equal(login.statusCode, 302);
  assert.match(
    String(login.headers["set-cookie"]),
    /ei_oauth_state=.*HttpOnly.*Secure/,
  );
  await app.close();
});
test("sign-in returns to the local page it started from and rejects off-site targets", async () => {
  const { app } = fixture();
  const local = await app.inject({ url: "/api/auth/login?returnTo=%2Fservices%3Fref%3DABC234" });
  assert.equal(local.statusCode, 302);
  assert.match(String(local.headers["set-cookie"]), /ei_oauth_return=%2Fservices%3Fref%3DABC234/);
  for (const target of ["https%3A%2F%2Fevil.example%2Fsteal", "%2F%2Fevil.example%2Fsteal", "%2Fservices%5C..%2F%2Fevil"]) {
    const res = await app.inject({ url: `/api/auth/login?returnTo=${target}` });
    assert.equal(res.statusCode, 302);
    assert.ok(!String(res.headers["set-cookie"]).includes("evil"), target);
  }
  await app.close();
});
test("OAuth callback mirrors the validated return target and never an off-site one", async () => {
  const response = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const app = createApp({
    env,
    query: async () => [],
    fetchFn: (async (input: any) =>
      String(input).includes("/oauth2/token")
        ? response({ access_token: "access", token_type: "Bearer", expires_in: 3600 })
        : response({ id: user, username: "Test" })) as typeof fetch,
  });
  const start = async (returnTo: string) => {
    const { state } = buildAuthorizeUrl({
      clientId: "client",
      clientSecret: "private",
      redirectUrl: env.OAUTH_REDIRECT_URL,
      stateSecret: secret,
    });
    return app.inject({
      url: `/api/auth/callback?code=abc&state=${state}`,
      headers: { cookie: `ei_oauth_state=${state}; ei_oauth_return=${encodeURIComponent(returnTo)}` },
    });
  };
  assert.equal((await start("/services?ref=ABC234")).headers.location, "/services?ref=ABC234");
  assert.equal((await start("https://evil.example/steal")).headers.location, "/dashboard");
  assert.equal((await start("//evil.example/steal")).headers.location, "/dashboard");
  await app.close();
});
test("logout requires CSRF and revokes the server-side session", async () => {
  const { app, calls } = fixture();
  const headers = { cookie: cookie() };
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/auth/logout", headers }))
      .statusCode,
    403,
  );
  const csrf = (await app.inject({ url: "/api/auth/csrf", headers })).json()
    .csrfToken;
  const out = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { ...headers, "x-csrf-token": csrf },
  });
  assert.equal(out.statusCode, 200);
  assert.ok(calls.some((sql) => sql.includes("revoked=true")));
  await app.close();
});
test("published dashboard contract lists cookie authentication and scoped guild parameters", async () => {
  const { app } = fixture();
  const res = await app.inject({ url: "/api/openapi.json" });
  assert.equal(res.statusCode, 200);
  const document = res.json();
  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.components.securitySchemes.session.name, "ei_session");
  assert.equal(
    document.paths["/api/overview"].get.parameters[0].name,
    "guildId",
  );
  await app.close();
});
test("Discord permission failure never falls back to local owner metadata", async () => {
  const app = createApp({
    env,
    query: async (sql) =>
      sql.includes("FROM access.sessions")
        ? [
            {
              session_id: sessionId,
              discord_user_id: user,
              display_name: "Test",
              encrypted_token: "token",
              expires_at: new Date(Date.now() + 10000),
            },
          ]
        : sql.includes("FROM access.guilds")
          ? [{ guild_id: guild, name: "Test", owner_id: user, approved: true }]
          : [],
    decryptToken: () => "access",
    fetchFn: (async () =>
      new Response("rate limited", { status: 429 })) as typeof fetch,
  });
  assert.equal(
    (await app.inject({ url: "/api/guilds", headers: { cookie: cookie() } }))
      .statusCode,
    503,
  );
  await app.close();
});
