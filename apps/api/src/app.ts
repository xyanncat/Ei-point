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
import { Roles, resolvePreview, type Role } from "./roles.js";

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
// Sign-in return targets must stay local: one leading slash, no scheme-relative
// "//", no backslashes, bounded length. Applied at login and again at callback.
const localReturn = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 300 &&
  value.startsWith("/") &&
  !value.startsWith("//") &&
  !value.includes("\\") &&
  !/[\r\n]/.test(value)
    ? value
    : null;
export function createApp(options: AppOptions = {}) {
  const env = options.env ?? process.env,
    fetchFn = options.fetchFn ?? fetch;
  const secret = env.SESSION_SECRET ?? "",
    csrfSecret = env.CSRF_SECRET ?? secret;
  const secure = env.COOKIE_SECURE !== "false" || env.NODE_ENV === "production";
  const cookieAttrs = `HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/;`;
  const app = Fastify({
    trustProxy: env.TRUSTED_PROXY_CIDRS?.split(',').map(value=>value.trim()).filter(Boolean) ?? false,
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
  const roles = new Roles(env);
  // Effective role for this request. The dashboard sends x-ei-preview-role
  // when the master walks a lower segment; resolvePreview admits it only for
  // the master and only downwards, so every other identity is unaffected.
  const previewFor = (
    headers: Record<string, string | string[] | undefined>,
    id: string,
  ): Role | null =>
    resolvePreview(
      roles.role(id),
      Array.isArray(headers["x-ei-preview-role"])
        ? headers["x-ei-preview-role"][0]
        : headers["x-ei-preview-role"],
    );
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
    // Fastify 5.12+ types the handler error as unknown: narrow before use.
    const statusCode =
      typeof err === "object" && err !== null && "statusCode" in err &&
      typeof err.statusCode === "number" ? err.statusCode : undefined;
    const message = err instanceof Error ? err.message : "Request failed";
    if (statusCode && statusCode >= 400 && statusCode < 500)
      return reply.code(statusCode).send(error("request-denied", message));
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
    if (path.startsWith("/api/internal/")) return;
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
    preview: Role | null,
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
    // The master identity is not filtered by Discord membership. It exists to
    // fix a misbehaving bot in any server, so it sees every approved server
    // with full scope — unless it is previewing a lower segment.
    if (!preview && roles.isMaster(String(s.discord_user_id)))
      return guildRows.map((g) => ({
        guildId: g.guild_id,
        name: g.name,
        approved: true,
        icon: null,
        scopes: ["*"],
      }));
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
    const staffRoles = await query(
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
        const grants = staffRoles.filter((r) => r.guild_id === g.guild_id);
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
          icon: typeof membership.icon === "string" ? membership.icon : null,
          scopes,
        });
    }
    return result;
  }
  async function scoped(headers: Record<string, string | string[] | undefined>, id: unknown) {
    const cookie = headers.cookie;
    const s = await session(Array.isArray(cookie) ? cookie[0] : cookie);
    if (!snowflake(id))
      throw new HttpError(
        400,
        "guild-required",
        "Choose a server to continue.",
      );
    const preview = previewFor(headers, String(s.discord_user_id));
    const g = (await authorizedGuilds(s, preview)).find((g) => g.guildId === id);
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
  app.get<{ Querystring: { returnTo?: string } }>("/api/auth/login", async (req, reply) => {
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
    const target = localReturn(req.query.returnTo);
    const stateCookie = `ei_oauth_state=${state}; ${cookieAttrs} Max-Age=300`;
    return reply
      .header(
        "Set-Cookie",
        target
          ? [stateCookie, `ei_oauth_return=${encodeURIComponent(target)}; ${cookieAttrs} Max-Age=300`]
          : stateCookie,
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
      const target =
        localReturn(cookies(req.headers.cookie).ei_oauth_return) ?? "/dashboard";
      return reply
        .header("Set-Cookie", [
          `ei_oauth_state=; ${cookieAttrs} Max-Age=0`,
          `ei_oauth_return=; ${cookieAttrs} Max-Age=0`,
          `ei_session=${signed}; ${cookieAttrs} Max-Age=${Math.floor(ttl / 1000)}`,
        ])
        .redirect(target);
    },
  );
  app.get("/api/auth/me", async (req) => {
    const s = await session(req.headers.cookie);
    const id = String(s.discord_user_id);
    const real = roles.role(id);
    const preview = previewFor(req.headers, id);
    const role = preview ?? real;
    return {
      user: { id, name: s.display_name },
      role,
      isAdmin: role === "admin" || role === "master",
      isMaster: role === "master",
      realRole: real,
      preview,
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
  app.get("/api/guilds", async (req) => {
    const s = await session(req.headers.cookie);
    return {
      guilds: await authorizedGuilds(
        s,
        previewFor(req.headers, String(s.discord_user_id)),
      ),
    };
  });
  app.get<{ Querystring: { guildId?: string } }>(
    "/api/services",
    async (req) => {
      const g = await scoped(req.headers, req.query.guildId);
      return services(g.guildId);
    },
  );
  app.get<{ Querystring: { guildId?: string } }>(
    "/api/overview",
    async (req) => {
      const g = await scoped(req.headers, req.query.guildId),
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
        "SELECT sku,name,price_minor,currency,game,category,duration,description,membership_days FROM commerce.catalog WHERE active=true ORDER BY price_minor",
      )
    ).map((r) => ({
      sku: r.sku,
      name: r.name,
      priceMinor: Number(r.price_minor),
      currency: r.currency,
      game: r.game ?? null,
      category: r.category ?? null,
      duration: r.duration ?? null,
      description: r.description ?? null,
      membershipDays: r.membership_days === null || r.membership_days === undefined ? null : Number(r.membership_days),
    })),
  }));
  // Purchase logs. A customer sees their own orders; the operator and the
  // master see every order on the platform.
  app.get("/api/account/orders", async (req) => {
    const s = await session(req.headers.cookie);
    const id = String(s.discord_user_id);
    const preview = previewFor(req.headers, id);
    const elevated = preview ? preview === "admin" : roles.isAdmin(id);
    const rows = await query(
      `SELECT o.public_id AS "orderId", o.buyer_id AS "buyerId", o.sku,
              o.service_name AS "serviceName", o.amount_minor AS "amountMinor",
              o.method, o.status, o.created_at AS "createdAt", o.expires_at AS "expiresAt",
              g.name AS "guildName", g.guild_id AS "guildId"
       FROM commerce.orders o LEFT JOIN access.guilds g ON g.guild_id=o.guild_id
       WHERE ($2::boolean OR o.buyer_id=$1)
       ORDER BY o.created_at DESC LIMIT 200`,
      [id, elevated],
    );
    return {
      orders: rows.map((r) => ({
        orderId: String(r.orderId),
        buyerId: String(r.buyerId),
        sku: r.sku,
        serviceName: r.serviceName ?? r.sku,
        amountMinor: Number(r.amountMinor),
        method: r.method ?? null,
        status: r.status,
        createdAt: new Date(r.createdAt).toISOString(),
        expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
        guildId: r.guildId ?? null,
        guildName: r.guildName ?? null,
      })),
      scope: elevated ? "all" : "own",
    };
  });
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
  const administrator = async (req: {headers:{cookie?:string|undefined} & Record<string, string | string[] | undefined>}) => {
    const s = await session(req.headers.cookie);
    const id = String(s.discord_user_id);
    const preview = previewFor(req.headers, id);
    // A master previewing as admin keeps admin access; previewing as a user
    // drops it, exactly like the segment under test. Master-only guards use
    // master() and never consult the preview.
    if (preview ? preview !== "admin" : !roles.isAdmin(id))
      throw new HttpError(403,"admin-required","This action requires a configured Ei point administrator.");
    return {userId:id};
  };
  const master = async (req: {headers:{cookie?:string|undefined}}) => {
    const s = await session(req.headers.cookie);
    if (!roles.isMaster(String(s.discord_user_id)))
      throw new HttpError(403,"master-required","This action requires the Ei point master account.");
    return {userId:String(s.discord_user_id)};
  };
  registerCommerceRoutes(app,{env,query,transaction,session:async(req) => {
    try{const s=await session(req.headers.cookie);return {discordUserId:String(s.discord_user_id)};}
    catch(e){if(e instanceof HttpError)return null;throw e;}
  },authorize:async(req,guildId) => {
    const s=await session(req.headers.cookie),g=await scoped(req.headers,guildId);
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
    if(scope==="master") return master(req);
    if(scope==="admin") return administrator(req);
    const s=await session(req.headers.cookie),g=await scoped(req.headers,guildId);
    if((scope==="operate" || module) && !g.scopes?.some(value=>value==="*"||(module && value===module))) throw new HttpError(403,"scope-denied","Your role cannot access these server controls.");
    return {userId:String(s.discord_user_id)};
  }});
  return app;
}
