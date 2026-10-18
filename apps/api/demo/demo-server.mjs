// Local DEMO server — never deployed. Serves fixture data so the dashboard can
// be previewed without Discord credentials or Postgres. Reads answer typical
// API shapes; mutations answer 409 read-only so the UI stays honest.
// Run: node apps/api/demo/demo-server.mjs  (PORT env, default 3001)
import http from "node:http";

const PORT = Number(process.env.PORT ?? 3001);
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

const BOT_CARDS = [
  { botKey: "kafka", modules: ["security", "moderation", "logging"], state: "ok", gateway: "ok", dbReady: true },
  { botKey: "cyrene", modules: ["ai"], state: "ok", gateway: "ok", dbReady: true },
  { botKey: "robin", modules: ["music"], state: "degraded", gateway: "degraded", dbReady: true },
  { botKey: "cipher", modules: ["commerce"], state: "ok", gateway: "ok", dbReady: true },
  { botKey: "silverwolf", modules: ["games", "community"], state: "ok", gateway: "ok", dbReady: true },
  { botKey: "himiko", modules: ["welcome", "leveling", "announcements"], state: "ok", gateway: "ok", dbReady: true, stale: true },
];

const GUILDS = [
  { guildId: "111111111111111111", name: "Paradise test server", approved: true, scopes: ["*"] },
  { guildId: "222222222222222222", name: "Royality staging", approved: true, scopes: ["*"] },
];

const MODULE_FIELDS = {
  welcome: [
    { key: "message", label: "Welcome message", type: "textarea", default: "Welcome to the server, {user}!", help: "Placeholders: {user}, {server}." },
    { key: "channel_id", label: "Welcome channel ID", type: "text", default: "" },
    { key: "enabled", label: "Welcomes enabled", type: "boolean", default: true },
  ],
  leveling: [
    { key: "rate", label: "XP per message", type: "number", default: 15, min: 1, max: 100 },
    { key: "enabled", label: "Leveling enabled", type: "boolean", default: true },
  ],
  security: [
    { key: "raid_lock", label: "Raid lockdown arms automatically", type: "boolean", default: false },
    { key: "threshold", label: "Join threshold per minute", type: "number", default: 10, min: 3, max: 100 },
  ],
  music: [{ key: "default_volume", label: "Default volume (%)", type: "number", default: 100, min: 0, max: 150 }],
  community: [{ key: "announce_channel", label: "Announcement channel ID", type: "text", default: "" }],
  games: [{ key: "drop_rate", label: "Card drop rate (%)", type: "number", default: 8, min: 0, max: 100 }],
  ai: [{ key: "daily_tokens", label: "Daily token budget", type: "number", default: 50000, min: 1000, max: 1000000 }],
  commerce: [{ key: "review_channel", label: "Payment review channel ID", type: "text", default: "" }],
};
const defaultFields = [
  { key: "enabled", label: "Module enabled", type: "boolean", default: true },
  { key: "channel_id", label: "Channel ID", type: "text", default: "" },
];
const fieldsFor = (module) => MODULE_FIELDS[module] ?? defaultFields;
const valueFor = (module) => Object.fromEntries(fieldsFor(module).map((field) => [field.key, field.default]));
const configurationFor = (module) => ({
  version: 3,
  value: valueFor(module),
  applied_at: ago(30),
  updated_at: ago(35),
  changed_at: ago(35),
});

const SETTINGS = {
  notifications_enabled: true,
  server_paused: false,
  notification_preferences: { security: true, moderation: true, fleet: true, orders: true },
};
const BOT_STATE = BOT_CARDS.map((card) => ({ bot_key: card.botKey, modules: card.modules, enabled: true, paused: false }));
const PERMISSIONS = [
  { bot_key: "kafka", command: "ban", role_ids: ["145000000000000001"], enabled: true },
  { bot_key: "robin", command: "play", role_ids: [], enabled: true },
  { bot_key: "cipher", command: "orders", role_ids: ["145000000000000002"], enabled: true },
];
const JOBS = [
  { job_id: "demo-job-2", kind: "embed", status: "queued" },
  { job_id: "demo-job-1", kind: "embed", status: "delivered" },
];
const ORDERS = [
  {
    orderId: "RP-DEMO01",
    buyerId: "111111111111111111",
    serviceName: "All-Games Account Management Membership",
    amountMinor: 70000,
    method: "upi",
    status: "claimed",
    createdAt: ago(180),
    proofRef: "demo-proof-reference",
    timeline: [
      { at: ago(180), label: "Created" },
      { at: ago(150), label: "Payment submitted" },
      { at: ago(40), label: "Claimed for review" },
    ],
  },
  {
    orderId: "RP-DEMO02",
    buyerId: "222222222222222222",
    serviceName: "Genshin Character Story Quests",
    amountMinor: 25000,
    method: "usdt",
    status: "pending",
    createdAt: ago(60),
    proofRef: null,
  },
];
const ADMIN_GUILDS = GUILDS.map((guild) => ({ guild_id: guild.guildId, name: guild.name, approved: true }));
const STAFF_SCOPES = [
  { guild_id: "111111111111111111", role_id: "145000000000000003", scope: "moderation" },
  { guild_id: "111111111111111111", role_id: "145000000000000004", scope: "commerce-settle" },
];
const SECRETS = [
  { name: "RAZORPAY_PAYMENT_PAGE", masked: "••••••••s3fa", updated_at: ago(1200) },
  { name: "USDT_TRC20_ADDRESS", masked: "••••••••9xQ2", updated_at: ago(2400) },
];
const ACCOUNTS = [
  {
    id: "acc-1",
    provider: "postgres",
    account_name: "Primary database",
    secret_ref: "PG_PRIMARY",
    endpoint: "",
    region: "local",
    enabled: true,
    metadata: { note: "demo metadata" },
  },
];

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";
  const guild = path.match(/^\/api\/guilds\/([^/]+)(\/.*)?$/);

  // Mutations in the selected-server or admin namespaces are read-only here.
  if (method !== "GET" && (guild || path.startsWith("/api/admin/"))) {
    return json(res, 409, {
      error: "Changes are disabled in the demo preview.",
      code: "demo-readonly",
      correlationId: "demo",
    });
  }

  if (path === "/healthz") return json(res, 200, { ok: true, service: "api-demo" });
  if (path === "/readyz") return json(res, 200, { dbReady: true, status: "ok", demo: true });
  if (path === "/api/auth/me")
    return json(res, 200, {
      demo: true,
      isAdmin: true,
      user: { id: "111111111111111111", name: "Demo staff" },
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
  if (path === "/api/auth/csrf") return json(res, 200, { csrfToken: "demo" });
  if (path === "/api/auth/logout") return json(res, 200, { ok: true });
  if (path === "/api/auth/login") {
    res.writeHead(302, { Location: "/" });
    return res.end();
  }
  if (path === "/api/guilds") return json(res, 200, { guilds: GUILDS });

  if (path === "/api/overview") {
    const guildId = url.searchParams.get("guildId");
    if (!GUILDS.some((entry) => entry.guildId === guildId))
      return json(res, 403, { error: "Unknown demo server.", code: "guild-denied", correlationId: "demo" });
    const selected = GUILDS.find((entry) => entry.guildId === guildId);
    return json(res, 200, {
      demo: true,
      guild: { guildId, name: selected.name, approved: true, scopes: selected.scopes },
      fetchedAt: new Date().toISOString(),
      stale: false,
      cards: BOT_CARDS.map((card, index) => ({
        ...card,
        provider: "unknown",
        latencyMs: card.state === "degraded" ? null : 120 + index * 15,
        updatedAt: card.stale ? ago(2) : ago(0),
      })),
      incidents: [
        { id: "demo-incident-1", kind: "raid-threshold", severity: "high", createdAt: ago(10) },
        { id: "demo-incident-2", kind: "message-flood", severity: "medium", createdAt: ago(55) },
      ],
      actions: [
        { id: "demo-action-1", key: "welcome-message", version: 2, changedAt: ago(2) },
        { id: "demo-action-2", key: "leveling-rate", version: 5, changedAt: ago(95) },
        { id: "demo-action-3", key: "music-default-volume", version: 1, changedAt: ago(240) },
      ],
    });
  }
  if (path === "/api/services")
    return json(res, 200, {
      stale: false,
      cards: BOT_CARDS.map((card, i) => ({ ...card, latencyMs: 120 + i * 15, updatedAt: new Date().toISOString() })),
    });
  if (path === "/api/catalog")
    return json(res, 200, {
      items: [
        { sku: "membership", name: "Royality Membership", priceMinor: 49900, currency: "INR" },
        { sku: "tournament", name: "Tournament Entry", priceMinor: 9900, currency: "INR" },
        { sku: "card-pack", name: "Mythic Card Pack", priceMinor: 19900, currency: "INR" },
      ],
    });
  if (path === "/api/orders/verify") {
    if (["demo", "demo-verification-token"].includes(url.searchParams.get("token") ?? "")) {
      return json(res, 200, { skuName: "Demo Membership", amountMinor: 49900, status: "settled" });
    }
    return json(res, 404, { error: "No order matches this link.", code: "order-unknown", correlationId: "demo", retryable: false });
  }
  if (path.startsWith("/api/payments/status/")) {
    const orderId = decodeURIComponent(path.replace("/api/payments/status/", ""));
    if (orderId.startsWith("RP-")) {
      return json(res, 200, {
        orderId,
        status: "confirmed",
        serviceName: "Demo Membership",
        amount: "499.00",
        currency: "INR",
        createdAt: ago(60),
        confirmedAt: new Date().toISOString(),
      });
    }
    return json(res, 404, { error: "Order not found in demo.", code: "order-not-found", correlationId: "demo", retryable: false });
  }
  if (path.startsWith("/api/admin/")) {
    if (path === "/api/admin/guilds") return json(res, 200, { guilds: ADMIN_GUILDS });
    if (path === "/api/admin/staff-scopes") return json(res, 200, { scopes: STAFF_SCOPES });
    if (path === "/api/admin/secrets") return json(res, 200, { secrets: SECRETS });
    if (path === "/api/admin/accounts") return json(res, 200, { accounts: ACCOUNTS });
  }

  if (guild) {
    const tail = guild[2] ?? "";
    if (tail === "/settings") return json(res, 200, { settings: SETTINGS });
    if (tail === "/bot-state") return json(res, 200, { bots: BOT_STATE });
    if (tail === "/command-permissions") return json(res, 200, { permissions: PERMISSIONS });
    if (tail === "/embeds") return json(res, 200, { jobs: JOBS });
    if (tail === "/commerce/orders") return json(res, 200, { orders: ORDERS });
    const config = tail.match(/^\/configuration\/([^/]+)(\/history)?$/);
    if (config) {
      const module = decodeURIComponent(config[1]);
      if (config[2]) {
        return json(res, 200, {
          history: [
            configurationFor(module),
            { ...configurationFor(module), version: 2, applied_at: ago(120), updated_at: ago(125), changed_at: ago(125) },
          ],
        });
      }
      return json(res, 200, { configuration: configurationFor(module), fields: fieldsFor(module) });
    }
  }

  return json(res, 404, { error: "Not available in the demo preview.", code: "demo-unavailable", correlationId: "demo" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`demo api on http://localhost:${PORT}`));
