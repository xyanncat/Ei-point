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
  if (url.pathname === '/api/auth/me') return json(res,200,{demo:true,user:{id:'111111111111111111',name:'Demo staff'},expiresAt:new Date(Date.now()+3600000).toISOString()});
  if (url.pathname === '/api/auth/logout') return json(res,200,{ok:true});
  if (url.pathname === '/api/overview') {
    const guildId=url.searchParams.get('guildId');
    if (!['111111111111111111','222222222222222222'].includes(guildId)) return json(res,403,{error:'Unknown demo server.',code:'guild-denied',correlationId:'demo'});
    return json(res,200,{demo:true,guild:{guildId,name:guildId==='111111111111111111'?'Paradise test server':'Royality staging',approved:true,scopes:['*']},fetchedAt:new Date().toISOString(),stale:true,
      cards:BOTS.map((botKey,i)=>({botKey,modules:[botKey],state:i===4?'degraded':'ok',gateway:i===4?'degraded':'ok',dbReady:i!==5,provider:'unknown',stale:i===5,latencyMs:120+i*15,updatedAt:new Date(Date.now()-(i===5?120000:3000)).toISOString()})),
      incidents:[{id:'demo-incident',kind:'raid-threshold',severity:'high',createdAt:new Date(Date.now()-600000).toISOString()}],actions:[{id:'demo-action',key:'welcome-message',version:2,changedAt:new Date(Date.now()-120000).toISOString()}]});
  }
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
        { guildId: "111111111111111111", name: "Paradise test server", approved: true, scopes:['*'] },
        { guildId: "222222222222222222", name: "Royality staging", approved: true, scopes:['*'] },
      ],
    });
  }
  if (url.pathname === "/api/orders/verify") {
    if (url.searchParams.get("token") === "demo" || url.searchParams.get("token")?.length >= 16) {
      return json(res, 200, { skuName: "Demo Membership", amountMinor: 49900, status: "settled" });
    }
    return json(res, 404, { error: "No order matches this link.", code: "order-unknown", correlationId: "demo", retryable: false });
  }
  if (url.pathname.startsWith("/api/payments/status/")) {
    let orderId = "";
    try {
      orderId = decodeURIComponent(url.pathname.replace("/api/payments/status/", ""));
    } catch {
      return json(res, 404, { error: "Order not found in demo.", code: "order-not-found", correlationId: "demo", retryable: false });
    }
    if (orderId === "RP-DEMO01" || orderId.startsWith("RP-")) {
      return json(res, 200, {
        orderId,
        status: "confirmed",
        serviceName: "Demo Membership",
        amount: "499.00",
        currency: "INR",
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        confirmedAt: new Date().toISOString(),
      });
    }
    return json(res, 404, { error: "Order not found in demo.", code: "order-not-found", correlationId: "demo", retryable: false });
  }
  if (url.pathname === "/api/auth/csrf") return json(res, 200, { csrfToken: "demo" });
  if (url.pathname === "/api/auth/login") {
    res.writeHead(302, { Location: "/" });
    return res.end();
  }
  return json(res, 404, { error: "Not found in demo.", code: "not-found", correlationId: "demo", retryable: false });
});

server.listen(PORT, "127.0.0.1", () => console.log(`demo api on http://localhost:${PORT}`));
