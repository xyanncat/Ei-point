import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { signSession } from "./session.js";

const user = "111111111111111111",
  guild = "222222222222222222",
  role = "333333333333333333";
const secret = "test-only-secret-with-at-least-32-characters";
const env = { SESSION_SECRET: secret, CSRF_SECRET: secret };
const sessionId = "12345678-1234-4234-8234-123456789012";
const cookie = `ei_session=${signSession({ discordUserId: user, sessionId }, secret)}`;
const order = {
  public_id: "RP-ABC123",
  buyer_id: "444444444444444444",
  sku: "membership",
  service_name: "Membership",
  amount_minor: 70000,
  method: "upi",
  status: "claimed",
  created_at: new Date(),
  expires_at: new Date(Date.now() + 600000),
  proof_ref: "upi:UTR-9",
};
function fixture(kind: "reader" | "staff" | "admin") {
  const owner = kind === "admin";
  const calls: string[] = [];
  const app = createApp({
    env,
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FROM access.sessions"))
        return [
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
            owner_id: owner ? user : guild,
            approved: true,
          },
        ];
      if (sql.includes("FROM access.staff_roles"))
        return owner
          ? []
          : [
              {
                guild_id: guild,
                role_id: role,
                scope: kind === "staff" ? "commerce-settle" : "commerce",
              },
            ];
      if (sql.includes("commerce.orders"))
        return [
          {
            orderId: order.public_id,
            buyerId: order.buyer_id,
            sku: order.sku,
            serviceName: order.service_name,
            amountMinor: order.amount_minor,
            method: order.method,
            status: order.status,
            createdAt: order.created_at,
            expiresAt: order.expires_at,
            proofRef: order.proof_ref,
          },
        ];
      return [];
    },
    decryptToken: () => "access",
    fetchFn: (async (url: string | URL | Request) => {
      if (String(url).includes("/member"))
        return Response.json({ roles: owner ? [] : [role] });
      return Response.json([{ id: guild, owner, permissions: "0" }]);
    }) as typeof fetch,
  });
  return { app, calls };
}
test("anonymous commerce reads fail closed before any database work", async () => {
  const { app, calls } = fixture("reader");
  const res = await app.inject({
    url: `/api/guilds/${guild}/commerce/orders`,
  });
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
  await app.close();
});
test("commerce readers see minimized orders while staff and owners see buyer and proof", async () => {
  for (const [kind, privileged] of [
    ["reader", false],
    ["staff", true],
    ["admin", true],
  ] as const) {
    const { app } = fixture(kind);
    const res = await app.inject({
      url: `/api/guilds/${guild}/commerce/orders`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200, kind);
    const view = res.json().orders[0];
    assert.equal(view.orderId, "RP-ABC123");
    assert.equal("buyerId" in view, privileged, kind);
    assert.equal("proofRef" in view, privileged, kind);
    if (privileged) {
      assert.equal(view.buyerId, order.buyer_id);
      assert.equal(view.proofRef, order.proof_ref);
    }
    await app.close();
  }
});
