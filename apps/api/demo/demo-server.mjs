// Local DEMO server — never deployed. Serves fixture data so the dashboard can be
// previewed without Discord credentials or Postgres. Production uses src/index.ts.
// Run: node apps/api/demo/demo-server.mjs  (PORT env, default 3001)
import http from "node:http";

const PORT = Number(process.env.PORT ?? 3001);
const BOTS = ["security", "moderation", "community", "ai", "music", "commerce"];

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz") return json(res, 200, { ok: true, service: "api-demo" });
  if (url.pathname === "/readyz") return json(res, 200, { dbReady: true, status: "ok", demo: true });
  if (url.pathname === "/api/services") {
    return json(res, 200, {
      stale: false,
      cards: BOTS.map((botKey, i) => ({
        botKey,
        state: "ok",
        gateway: "ok",
        dbReady: true,
        latencyMs: 120 + i * 15,
        updatedAt: new Date().toISOString(),
      })),
    });
  }
  if (url.pathname === "/api/catalog") {
    return json(res, 200, {
      items: [
        { sku: "membership", name: "Royality Membership", priceMinor: 49900, currency: "INR" },
        { sku: "tournament", name: "Tournament Entry", priceMinor: 9900, currency: "INR" },
        { sku: "card-pack", name: "Mythic Card Pack", priceMinor: 19900, currency: "INR" },
      ],
    });
  }
  if (url.pathname === "/api/guilds") {
    return json(res, 200, {
      guilds: [
        { guildId: "111", name: "Demo Paradise (test guild)", approved: true },
        { guildId: "222", name: "Demo Stage", approved: true },
      ],
    });
  }
  if (url.pathname === "/api/orders/verify") {
    if (url.searchParams.get("token") === "demo") {
      return json(res, 200, { skuName: "Demo Membership", amountMinor: 49900, status: "settled" });
    }
    return json(res, 404, { error: "No order matches this link.", code: "order-unknown", correlationId: "demo", retryable: false });
  }
  if (url.pathname === "/api/auth/csrf") return json(res, 200, { csrfToken: "demo" });
  if (url.pathname === "/api/auth/login") {
    res.writeHead(302, { Location: "/" });
    return res.end();
  }
  return json(res, 404, { error: "Not found in demo.", code: "not-found", correlationId: "demo", retryable: false });
});

server.listen(PORT, "127.0.0.1", () => console.log(`demo api on http://localhost:${PORT}`));
