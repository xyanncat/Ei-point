import Fastify from "fastify";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import pg from "pg";
import type {
  DashboardOverview,
  GuildInfo,
  ServiceCard,
  ServiceState,
} from "@ei-point/contracts";
import { signSession, verifySession } from "./session.js";
import { issueCsrfToken, verifyCsrfToken } from "./csrf.js";
import { buildAuthorizeUrl, exchangeCode, verifyOAuthState } from "./oauth.js";
import { encryptToken, decryptToken } from "./token-vault.js";
import openapi from "./openapi.json" with { type: "json" };
import { registerCommerceRoutes, maintainCommerce } from "./commerce-routes.js";
import { registerControlRoutes } from "./control-routes.js";
import { channelPermissions, canSendEmbed } from "./channel-permissions.js";
import { registeredBotToken } from "@ei-point/flow";

type Query = (
  sql: string,
  params?: unknown[],
) => Promise<Record<string, any>[]>;
export interface AppOptions {
  env?: Record<string, string | undefined>;
  query?: Query;
  transaction?: <T>(work: (query: Query) => Promise<T>) => Promise<T>;
  fetchFn?: typeof fetch;
  decryptToken?: typeof decryptToken;
  logger?: boolean;
}
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function cookies(header?: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    try {
      result[part.slice(0, i).trim()] = decodeURIComponent(
        part.slice(i + 1).trim(),
      );
    } catch {}
  }
  return result;
}
const STATES = new Set(["ok", "down", "degraded", "unknown"]);
const state = (s: unknown): ServiceState =>
  STATES.has(String(s)) ? (s as ServiceState) : "unknown";
const snowflake = (id: unknown): id is string =>
  typeof id === "string" && /^\d{17,20}$/.test(id);
export function createApp(options: AppOptions = {}) {
  const env = options.env ?? process.env,
    fetchFn = options.fetchFn ?? fetch;
  const secret = env.SESSION_SECRET ?? "",
    csrfSecret = env.CSRF_SECRET ?? secret;
  const secure = env.COOKIE_SECURE !== "false" || env.NODE_ENV === "production";
  const cookieAttrs = `HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/;`;
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "req.headers.x-csrf-token",
          ],
          serializers: {
            req: (req) => ({
              method: req.method,
              url: String(req.url).split("?")[0] ?? "",
              id: req.id,
              hostname: req.hostname,
              remoteAddress: req.ip,
              remotePort: req.socket.remotePort ?? 0,
            }),
          },
        }
      : false,
    bodyLimit: 65536,
  });
  const pool = options.query
    ? null
    : new pg.Pool({
        connectionString: env.DATABASE_URL,
        max: 10,
        connectionTimeoutMillis: 3000,
        statement_timeout: 5000,
        idleTimeoutMillis: 30000,
      });
  pool?.on("error", () => app.log.error("database connection interrupted"));
  app.addHook("onClose", async () => {
    await pool?.end();
  });
  const query: Query =
    options.query ??
    (async (sql, params = []) => {
      if (!env.DATABASE_URL) throw Error("database missing");
      return (await pool!.query(sql, params)).rows;
    });
  const configured = () => secret.length >= 32 && csrfSecret.length >= 32;
  const transaction = options.transaction ?? (async <T>(work: (query: Query) => Promise<T>): Promise<T> => {
    if (!pool) return work(query); // Injected query is used only by isolated tests.
    const client = await pool.connect();
    try { await client.query("BEGIN"); const value = await work(async (sql,params=[]) => (await client.query(sql,params)).rows); await client.query("COMMIT"); return value; }
    catch (err) { await client.query("ROLLBACK"); throw err; }
    finally { client.release(); }
  });
  const error = (code: string, message: string, retryable = false) => ({
    code,
    error: message,
    retryable,
    correlationId: randomUUID(),
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError)
      return reply
        .code(err.status)
        .send(error(err.code, err.message, err.status >= 500));
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500)
      return reply.code(err.statusCode).send(error("request-denied", err.message));
    req.log.error(
      { category: "request-failed", requestId: req.id },
      "Request failed",
    );
    return reply
      .code(503)
      .send(
        error(
          "service-unavailable",
          "This view is unavailable. Retry shortly.",
          true,
        ),
      );
  });
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (
      !["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ||
      !req.url.startsWith("/api/")
    )
      return;
    const path = req.url.split("?")[0] ?? "";
    if ((req.method === "POST" && ["/api/payments/upi-qr", "/api/payments/claim"].includes(path)) || path.startsWith("/api/internal/")) return;
    const raw = cookies(req.headers.cookie).ei_session ?? "",
      token = req.headers["x-csrf-token"];
    if (
      !configured() ||
      !verifySession(raw, secret) ||
      typeof token !== "string" ||
      !verifyCsrfToken(token, raw, csrfSecret)
    )
      throw new HttpError(
        403,
        "csrf-invalid",
        "Your session check failed. Reload before trying again.",
      );
  });
  async function session(header?: string) {
    if (!configured())
      throw new HttpError(
        401,
        "auth-required",
        "Sign in with Discord to continue.",
      );
    const claims = verifySession(cookies(header).ei_session ?? "", secret);
    if (!claims?.sessionId || !/^[\da-f-]{36}$/i.test(claims.sessionId))
      throw new HttpError(
        401,
        "auth-required",
        "Sign in with Discord to continue.",
      );
    const row = (
      await query(
        `SELECT session_id,discord_user_id,display_name,encrypted_token,expires_at FROM access.sessions WHERE session_id=$1 AND discord_user_id=$2 AND revoked=false AND expires_at>now()`,
        [claims.sessionId, claims.discordUserId],
      )
    )[0];
    if (!row?.encrypted_token)
      throw new HttpError(
        401,
        "session-expired",
        "Your session ended. Sign in again.",
      );
    return row;
  }
  async function discord(
    path: string,
    token: string,
    signal: AbortSignal = AbortSignal.timeout(8000),
  ): Promise<any> {
    const res = await fetchFn(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (res.status === 401)
      throw new HttpError(
        401,
        "session-expired",
        "Your Discord session ended. Sign in again.",
      );
    if (!res.ok)
      throw new HttpError(
        503,
        "permissions-unavailable",
        "Discord permissions are unavailable. Retry shortly.",
      );
    return res.json();
  }
  async function authorizedGuilds(
    s: Record<string, any>,
  ): Promise<GuildInfo[]> {
    const deadline = AbortSignal.timeout(12000);
    const token = (options.decryptToken ?? decryptToken)(
      s.encrypted_token,
      secret,
    );
    const guildRows = await query(
      "SELECT guild_id,name,owner_id,approved FROM access.guilds WHERE approved=true ORDER BY name",
    );
    if (guildRows.length === 0) return [];
    const memberships: Record<string, any>[] = [];
    for (let page = 0; page < 5; page++) {
      const after = memberships.at(-1)?.id;
      const batch = await discord(
        `/users/@me/guilds?limit=200${after ? `&after=${after}` : ""}`,
        token,
        deadline,
      );
      if (!Array.isArray(batch)) throw Error("invalid-permissions");
      memberships.push(...batch);
      if (batch.length < 200) break;
      if (page === 4)
        throw new HttpError(
          503,
          "permissions-unavailable",
          "The server list could not be fully checked. Retry shortly.",
        );
    }
    const roles = await query(
      "SELECT guild_id,role_id,scope FROM access.staff_roles",
    );
    const result: GuildInfo[] = [];
    for (const g of guildRows) {
      const membership = memberships.find((m) => m.id === g.guild_id);
      if (!membership) continue;
      let scopes: string[] = [];
      const permissions = /^\d{1,30}$/.test(String(membership.permissions))
        ? BigInt(membership.permissions)
        : 0n;
      if (
        membership.owner === true ||
        (permissions & 8n) !== 0n ||
        (permissions & 32n) !== 0n
      )
        scopes = ["*"];
      else {
        const grants = roles.filter((r) => r.guild_id === g.guild_id);
        if (grants.length) {
          const member = await discord(
            `/users/@me/guilds/${g.guild_id}/member`,
            token,
            deadline,
          );
          if (!Array.isArray(member.roles)) throw Error("invalid-permissions");
          const held = new Set(member.roles);
          scopes = [
            ...new Set(
              grants
                .filter((r) => held.has(r.role_id))
                .map((r) => String(r.scope)),
            ),
          ];
          if (scopes.length) scopes = [...new Set(["overview", ...scopes])];
        }
      }
      if (scopes.length)
        result.push({
          guildId: g.guild_id,
          name: g.name,
          approved: true,
          scopes,
        });
    }
    return result;
  }
  async function scoped(header: string | undefined, id: unknown) {
    const s = await session(header);
    if (!snowflake(id))
      throw new HttpError(
        400,
        "guild-required",
        "Choose a server to continue.",
      );
    const g = (await authorizedGuilds(s)).find((g) => g.guildId === id);
    if (!g)
      throw new HttpError(
        403,
        "guild-denied",
        "You do not have access to this server.",
      );
    return g;
  }
  async function services(guildId: string) {
    const registry = await query(
      "SELECT bot_key,modules,guild_ids FROM config.bots WHERE $1=ANY(guild_ids) ORDER BY bot_key",
      [guildId],
    );
    const rows = await query(
      "SELECT service,liveness,gateway,db_ready,provider,latency_ms,updated_at FROM ops.service_status",
    );
    const cards: ServiceCard[] = registry.map((bot) => {
      const r = rows.find(
        (r) => r.service === `bot-${bot.bot_key}` || r.service === bot.bot_key,
      );
      const stamp = r ? new Date(r.updated_at).getTime() : 0;
      const stale =
        !Number.isFinite(stamp) ||
        Date.now() - stamp > 60000 ||
        stamp > Date.now() + 5000;
      return {
        botKey: bot.bot_key,
        modules: bot.modules ?? [],
        stale,
        state: stale ? "unknown" : state(r?.liveness),
        gateway: stale ? "unknown" : state(r?.gateway),
        dbReady: !stale && r?.db_ready === true,
        provider: stale ? "unknown" : state(r?.provider),
        latencyMs: r?.latency_ms ?? null,
        updatedAt: Number.isFinite(stamp)
          ? new Date(stamp).toISOString()
          : new Date(0).toISOString(),
      };
    });
    return { cards, stale: cards.some((c) => c.stale) };
  }
  app.get("/healthz", async () => ({ ok: true, service: "api" }));
  app.get("/api/openapi.json", async () => openapi);
  app.get("/readyz", async (_req, reply) => {
    try {
      await query("SELECT 1");
      return { dbReady: true, status: "ok" };
    } catch {
      return reply.code(503).send({ dbReady: false, status: "degraded" });
    }
  });
  app.get("/api/auth/login", async (_req, reply) => {
    if (
      !configured() ||
      !env.DISCORD_CLIENT_ID ||
      !env.DISCORD_CLIENT_SECRET ||
      !env.OAUTH_REDIRECT_URL
    )
      throw new HttpError(
        503,
        "auth-not-configured",
        "Discord sign-in has not been configured.",
      );
    const { url, state } = buildAuthorizeUrl({
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      redirectUrl: env.OAUTH_REDIRECT_URL,
      stateSecret: csrfSecret,
    });
    return reply
      .header(
        "Set-Cookie",
        `ei_oauth_state=${state}; ${cookieAttrs} Max-Age=300`,
      )
      .redirect(url);
  });
  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/api/auth/callback",
    async (req, reply) => {
      const { code, state } = req.query,
        bound = cookies(req.headers.cookie).ei_oauth_state;
      reply.header("Set-Cookie", `ei_oauth_state=; ${cookieAttrs} Max-Age=0`);
      if (
        !configured() ||
        !code ||
        code.length > 4096 ||
        !state ||
        !bound ||
        !verifyOAuthState(state, csrfSecret) ||
        !verifyOAuthState(bound, csrfSecret) ||
        state.length !== bound.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(bound)) ||
        !env.DISCORD_CLIENT_ID ||
        !env.DISCORD_CLIENT_SECRET ||
        !env.OAUTH_REDIRECT_URL
      )
        throw new HttpError(
          401,
          "oauth-invalid",
          "Sign-in expired or came from another browser. Start again.",
        );
      const tokens = await exchangeCode(
        {
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
          redirectUrl: env.OAUTH_REDIRECT_URL,
          stateSecret: csrfSecret,
        },
        code,
        fetchFn,
      );
      const profile = await discord("/users/@me", tokens.accessToken);
      if (!snowflake(profile.id)) throw Error("profile-invalid");
      const id = randomUUID(),
        ttl = Math.min(tokens.expiresIn * 1000, 8 * 3600000);
      await query("DELETE FROM access.sessions WHERE expires_at<now()");
      await query(
        `INSERT INTO access.sessions(session_id,discord_user_id,expires_at,display_name,encrypted_token) VALUES($1,$2,$3,$4,$5)`,
        [
          id,
          profile.id,
          new Date(Date.now() + ttl),
          String(
            profile.global_name ?? profile.username ?? "Discord member",
          ).slice(0, 100),
          encryptToken(tokens.accessToken, secret),
        ],
      );
      const signed = signSession(
        { discordUserId: profile.id, sessionId: id },
        secret,
        ttl,
      );
      return reply
        .header("Set-Cookie", [
          `ei_oauth_state=; ${cookieAttrs} Max-Age=0`,
          `ei_session=${signed}; ${cookieAttrs} Max-Age=${Math.floor(ttl / 1000)}`,
        ])
        .redirect("/dashboard");
    },
  );
  app.get("/api/auth/me", async (req) => {
    const s = await session(req.headers.cookie);
    return {
      user: { id: s.discord_user_id, name: s.display_name },
      isAdmin: (env.DASHBOARD_ADMIN_IDS ?? "").split(",").map(id=>id.trim()).includes(s.discord_user_id),
      expiresAt: new Date(s.expires_at).toISOString(),
    };
  });
  app.get("/api/auth/csrf", async (req) => {
    await session(req.headers.cookie);
    return {
      csrfToken: issueCsrfToken(
        cookies(req.headers.cookie).ei_session!,
        csrfSecret,
      ),
    };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const s = await session(req.headers.cookie);
    await query(
      "UPDATE access.sessions SET revoked=true,encrypted_token=NULL WHERE session_id=$1",
      [s.session_id],
    );
    return reply
      .header("Set-Cookie", `ei_session=; ${cookieAttrs} Max-Age=0`)
      .send({ ok: true });
  });
  app.get("/api/guilds", async (req) => ({
    guilds: await authorizedGuilds(await session(req.headers.cookie)),
  }));
  app.get<{ Querystring: { guildId?: string } }>(
    "/api/services",
    async (req) => {
      const g = await scoped(req.headers.cookie, req.query.guildId);
      return services(g.guildId);
    },
  );
  app.get<{ Querystring: { guildId?: string } }>(
    "/api/overview",
    async (req) => {
      const g = await scoped(req.headers.cookie, req.query.guildId),
        data = await services(g.guildId);
      const canSecurity =
        g.scopes?.includes("*") || g.scopes?.includes("security");
      const incidents = canSecurity
        ? await query(
            "SELECT incident_id,kind,severity,created_at FROM security.incidents WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 8",
            [g.guildId],
          )
        : [];
      const actions = await query(
        "SELECT id,key,version,changed_at FROM config.settings_history WHERE scope=$1 ORDER BY changed_at DESC LIMIT 8",
        [`guild:${g.guildId}`],
      );
      const result: DashboardOverview = {
        guild: g,
        ...data,
        fetchedAt: new Date().toISOString(),
        incidents: incidents.map((r) => ({
          id: String(r.incident_id),
          kind: r.kind,
          severity: r.severity,
          createdAt: new Date(r.created_at).toISOString(),
        })),
        actions: actions.map((r) => ({
          id: String(r.id),
          key: r.key,
          version: r.version,
          changedAt: new Date(r.changed_at).toISOString(),
        })),
      };
      return result;
    },
  );
  app.get("/api/catalog", async () => ({
    items: (
      await query(
        "SELECT sku,name,price_minor,currency FROM commerce.catalog WHERE active=true ORDER BY price_minor",
      )
    ).map((r) => ({
      sku: r.sku,
      name: r.name,
      priceMinor: Number(r.price_minor),
      currency: r.currency,
    })),
  }));
  app.get<{ Querystring: { token?: string } }>(
    "/api/orders/verify",
    async (req, reply) => {
      const token = req.query.token;
      if (!token || token.length < 16 || token.length > 200)
        return reply
          .code(400)
          .send(error("bad-token", "Verification link is invalid."));
      const rows = await query(
        "SELECT o.status,o.amount_minor,c.name AS sku_name FROM commerce.orders o JOIN commerce.catalog c ON c.sku=o.sku WHERE o.order_token_hash=$1",
        [createHash("sha256").update(token).digest("hex")],
      );
      if (!rows[0])
        return reply
          .code(404)
          .send(error("order-unknown", "No order matches this link."));
      return {
        skuName: rows[0].sku_name,
        amountMinor: Number(rows[0].amount_minor),
        status: rows[0].status,
      };
    },
  );
  if(pool){
    let maintaining=false;
    const timer=setInterval(()=>{if(maintaining)return;maintaining=true;void maintainCommerce(query).catch(()=>app.log.error("commerce maintenance failed")).finally(()=>{maintaining=false;});},60000);
    timer.unref();app.addHook("onClose",async()=>{clearInterval(timer);});
  }
  const administrator = async (req: {headers:{cookie?:string|undefined}}) => {
    const s = await session(req.headers.cookie);
    if (!(env.DASHBOARD_ADMIN_IDS ?? "").split(",").map(id=>id.trim()).filter(snowflake).includes(s.discord_user_id))
      throw new HttpError(403,"admin-required","This action requires a configured Ei point administrator.");
    return {userId:String(s.discord_user_id)};
  };
  registerCommerceRoutes(app,{env,query,transaction,authorize:async(req,guildId) => {
    const s=await session(req.headers.cookie),g=await scoped(req.headers.cookie,guildId);
    if(!g.scopes?.some(scope=>scope==="*"||scope==="commerce"||scope==="commerce-settle")) throw new HttpError(403,"scope-denied","Your role cannot manage orders for this server.");
    return {userId:String(s.discord_user_id),isAdmin:g.scopes.includes("*")||g.scopes.includes("commerce-settle")};
  }});
  registerControlRoutes(app,{env,query,transaction,authorizeChannel:async(req,guildId,channelId,botKey)=>{
    const s=await session(req.headers.cookie);
    const token=registeredBotToken(botKey,env);
    if(!token)throw new HttpError(503,"bot-unconfigured","This bot has no configured Discord token.");
    const get=async(path:string)=>{const r=await fetchFn(`https://discord.com/api/v10${path}`,{headers:{Authorization:`Bot ${token}`},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new HttpError(503,"permissions-unavailable","Discord channel permissions could not be verified.");return r.json() as Promise<any>;};
    const channel=await get(`/channels/${channelId}`);
    if(channel.guild_id!==guildId||![0,5].includes(channel.type))throw new HttpError(403,"channel-denied","Choose a text channel in this server.");
    const [guild,roles,actor,identity]=await Promise.all([get(`/guilds/${guildId}`),get(`/guilds/${guildId}/roles`),get(`/guilds/${guildId}/members/${s.discord_user_id}`),get("/users/@me")]);
    const registered=(await query("SELECT application_id FROM config.bots WHERE bot_key=$1",[botKey]))[0];
    if(!registered||String(registered.application_id)!==String(identity.id))throw new HttpError(503,"bot-identity-mismatch","The configured token does not match this bot identity.");
    const bot=await get(`/guilds/${guildId}/members/${identity.id}`);
    for(const [member,id] of [[actor,s.discord_user_id],[bot,identity.id]] as const){if(!canSendEmbed(channelPermissions(guildId,member,roles,channel.permission_overwrites??[],id,guild.owner_id)))throw new HttpError(403,"channel-denied","Both you and the bot need permission to send embeds in this channel.");}
  },authorize:async(req,guildId,scope,module) => {
    if(scope==="admin") return administrator(req);
    const s=await session(req.headers.cookie),g=await scoped(req.headers.cookie,guildId);
    if((scope==="operate" || module) && !g.scopes?.some(value=>value==="*"||(module && value===module))) throw new HttpError(403,"scope-denied","Your role cannot access these server controls.");
    return {userId:String(s.discord_user_id)};
  }});
  return app;
}
