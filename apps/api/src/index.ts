import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { BOT_KEYS, type ErrorEnvelope, type GuildInfo, type ServiceCard } from "@ei-royality/contracts";
import { signSession, verifySession } from "./session.js";
import { issueCsrfToken, verifyCsrfToken } from "./csrf.js";
import { buildAuthorizeUrl, exchangeCode, verifyOAuthState, type OAuthConfig } from "./oauth.js";

// Phase 4: dashboard foundation — OAuth, sessions, CSRF, guild navigation, service overview.
// Feature-specific forms land in Phases 5–8. All errors use ErrorEnvelope; never fake auth.
const app = Fastify({ logger: true });

function envelope(code: string, error: string, retryable: boolean): ErrorEnvelope {
  return { error, code, correlationId: randomUUID(), retryable };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // Malformed cookie value — ignore the pair rather than 500ing the request.
    }
  }
  return out;
}

function requireSecrets(): { session: string; state: string } | null {
  const session = process.env.SESSION_SECRET;
  const state = process.env.CSRF_SECRET ?? process.env.SESSION_SECRET;
  if (session == null || session.length < 32 || state == null || state.length < 32) return null;
  return { session, state };
}

function oauthConfig(): OAuthConfig | null {
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, OAUTH_REDIRECT_URL, CSRF_SECRET, SESSION_SECRET } = process.env;
  const secret = CSRF_SECRET ?? SESSION_SECRET;
  if (
    DISCORD_CLIENT_ID == null ||
    DISCORD_CLIENT_SECRET == null ||
    OAUTH_REDIRECT_URL == null ||
    secret == null ||
    secret.length < 32
  ) {
    return null;
  }
  return {
    clientId: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    redirectUrl: OAUTH_REDIRECT_URL,
    stateSecret: secret,
  };
}

async function queryDb<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const url = process.env.DATABASE_URL;
  if (url == null) throw new Error("DATABASE_URL missing");
  const { Client } = await import("pg");
  const db = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await db.connect();
    const res = await db.query(sql, params as unknown[]);
    return res.rows as T[];
  } finally {
    await db.end().catch(() => {});
  }
}

app.get("/healthz", async () => ({ ok: true, service: "api" }));

app.get("/readyz", async () => {
  const url = process.env.DATABASE_URL;
  if (url == null) return { dbReady: false, status: "init", note: "DATABASE_URL missing" };
  try {
    const { Client } = await import("pg");
    const db = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await db.connect();
      await db.query("SELECT 1");
    } finally {
      await db.end().catch(() => {});
    }
    return { dbReady: true, status: "ok" };
  } catch (err) {
    return { dbReady: false, status: "degraded", note: err instanceof Error ? err.message : String(err) };
  }
});

// --- Auth: Discord OAuth → signed session cookie. Fail closed without secrets. ---
app.get("/api/auth/login", async (_req, reply) => {
  const cfg = oauthConfig();
  if (cfg == null) {
    return reply.code(503).send(envelope("auth-not-configured", "Login is not configured yet.", false));
  }
  const { url } = buildAuthorizeUrl(cfg);
  return reply.redirect(url);
});

app.get<{ Querystring: { code?: string; state?: string } }>("/api/auth/callback", async (req, reply) => {
  const cfg = oauthConfig();
  const secrets = requireSecrets();
  const { code, state } = req.query;
  if (cfg == null || secrets == null || code == null || state == null || !verifyOAuthState(state, secrets.state)) {
    return reply.code(401).send(envelope("oauth-invalid", "Login failed — please try again.", true));
  }
  try {
    const tokens = await exchangeCode(cfg, code);
    // Phase 4: session binds the Discord user after a /users/@me lookup (Phase 5+ enriches guilds).
    // The access token itself is never stored in the cookie — only the signed user id.
    const me = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `${tokens.tokenType} ${tokens.accessToken}` },
    });
    if (!me.ok) throw new Error(`profile-fetch:${me.status}`);
    const profile = (await me.json()) as { id: string };
    if (typeof profile.id !== "string") throw new Error("profile-bad-payload");
    const cookie = signSession({ discordUserId: profile.id }, secrets.session);
    return reply
      .header("Set-Cookie", `ei_session=${encodeURIComponent(cookie)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`)
      .redirect("/");
  } catch (err) {
    req.log.error(err);
    return reply.code(502).send(envelope("oauth-failed", "Login provider failed — please retry.", true));
  }
});

app.post("/api/auth/logout", async (_req, reply) => {
  return reply
    .header("Set-Cookie", "ei_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0")
    .send({ ok: true });
});

// --- CSRF gate: all mutating API routes (except OAuth handoff) need a session-bound token. ---
app.addHook("onRequest", async (req, reply) => {
  const method = req.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
  if (req.url.startsWith("/api/auth/")) return; // OAuth state machine covers these
  const secrets = requireSecrets();
  const session = verifySession(parseCookies(req.headers.cookie)["ei_session"] ?? "", secrets?.session ?? "");
  const csrf = req.headers["x-csrf-token"];
  if (
    session == null ||
    typeof csrf !== "string" ||
    secrets == null ||
    !verifyCsrfToken(csrf, parseCookies(req.headers.cookie)["ei_session"] ?? "", secrets.state)
  ) {
    return reply.code(403).send(envelope("csrf-invalid", "Session or CSRF check failed.", false));
  }
});

app.get("/api/auth/csrf", async (req, reply) => {
  const secrets = requireSecrets();
  const raw = parseCookies(req.headers.cookie)["ei_session"] ?? "";
  const session = verifySession(raw, secrets?.session ?? "");
  if (session == null || secrets == null) {
    return reply.code(401).send(envelope("auth-required", "Login required.", false));
  }
  return { csrfToken: issueCsrfToken(raw, secrets.state) };
});

// --- Service overview: six bot cards from ops.service_status (§6 Overview). ---
app.get("/api/services", async (req, reply) => {
  try {
    const rows = await queryDb<{
      service: string;
      liveness: ServiceCard["state"];
      gateway: ServiceCard["state"];
      db_ready: boolean;
      latency_ms: number | null;
      updated_at: Date;
    }>(`SELECT service, liveness, gateway, db_ready, latency_ms, updated_at FROM ops.service_status`);
    const byService = new Map(rows.map((r) => [r.service, r]));
    const cards: ServiceCard[] = BOT_KEYS.map((botKey) => {
      const r = byService.get(botKey === "community" ? "bot-community" : `bot-${botKey}`) ?? byService.get(botKey);
      return {
        botKey,
        state: r?.liveness ?? "unknown",
        gateway: r?.gateway ?? "unknown",
        dbReady: r?.db_ready ?? false,
        latencyMs: r?.latency_ms ?? null,
        updatedAt: r != null ? new Date(r.updated_at).toISOString() : new Date(0).toISOString(),
      };
    });
    return { cards, stale: rows.length === 0 };
  } catch (err) {
    req.log.error(err);
    return reply.code(503).send(envelope("db-unavailable", "Service state unavailable.", true));
  }
});

// --- Guild navigation: approved guilds for the signed-in user (§6 persistent nav). ---
app.get("/api/guilds", async (req, reply) => {
  const secrets = requireSecrets();
  const session = verifySession(parseCookies(req.headers.cookie)["ei_session"] ?? "", secrets?.session ?? "");
  if (session == null) {
    return reply.code(401).send(envelope("auth-required", "Login required.", false));
  }
  try {
    const rows = await queryDb<{ guild_id: string; name: string; approved: boolean }>(
      `SELECT guild_id, name, approved FROM access.guilds WHERE approved = TRUE ORDER BY name`,
    );
    const guilds: GuildInfo[] = rows.map((r) => ({ guildId: r.guild_id, name: r.name, approved: r.approved }));
    return { guilds };
  } catch (err) {
    req.log.error(err);
    return reply.code(503).send(envelope("db-unavailable", "Guild list unavailable.", true));
  }
});

const port = Number(process.env.API_PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
