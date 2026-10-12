import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { encryptToken, decryptToken } from "./token-vault.js";

export type ControlQuery = (
  sql: string,
  params?: unknown[],
) => Promise<Record<string, any>[]>;
export interface ControlDependencies {
  query: ControlQuery;
  transaction: <T>(work: (query: ControlQuery) => Promise<T>) => Promise<T>;
  authorize: (
    request: FastifyRequest,
    guildId: string | undefined,
    scope: "read" | "operate" | "admin",
    moduleId?: string,
  ) => Promise<{ userId: string }>;
  env: Record<string, string | undefined>;
  // Must verify current channel belongs to guild and actor + bot can send embeds.
  authorizeChannel?: (
    request: FastifyRequest,
    guildId: string,
    channelId: string,
    botKey: string,
  ) => Promise<void>;
}
type Field = {
  key: string;
  label: string;
  type: "text" | "textarea" | "boolean" | "number" | "select";
  default: string | boolean | number;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
};
const field = (
  key: string,
  type: Field["type"],
  value: Field["default"],
  extra: Partial<Field> = {},
): Field => ({
  key,
  label: key.replaceAll("_", " "),
  type,
  default: value,
  ...extra,
});
const channel = (key: string) => field(key, "text", "");
const welcome = [
  channel("welcome_channel"),
  channel("leave_channel"),
  field("welcome_message", "textarea", ""),
  field("leave_message", "textarea", ""),
];
export const MODULE_FIELDS: Record<string, Field[]> = {
  moderation: [
    channel("automod_log_channel"),
    field("automod_warnings", "boolean", true),
  ],
  logging: [
    channel("log_channel"),
    ...["messages", "members", "channels", "roles", "voice", "moderation"].map(
      (x) => field(`events.${x}`, "boolean", true),
    ),
  ],
  security: [
    field("enabled", "boolean", false),
    channel("alert_channel"),
    field("mode", "select", "revert", {
      options: ["revert", "revertOnly", "notify"].map((value) => ({
        value,
        label: value,
      })),
    }),
    field("banThreshold", "number", 3, { min: 2, max: 50 }),
    field("channelThreshold", "number", 2, { min: 1, max: 50 }),
    field("roleThreshold", "number", 3, { min: 1, max: 50 }),
    field("windowSeconds", "number", 60, { min: 10, max: 3600 }),
    field("punishment", "select", "ban", {
      options: ["ban", "kick", "stripRoles", "none"].map((value) => ({
        value,
        label: value,
      })),
    }),
    ...["protectWebhooks", "automodSlm", "snapshotOnChange", "trustMode"].map(
      (x) => field(x, "boolean", true),
    ),
    field("slmThreshold", "number", 0.75, { min: 0, max: 1, step: 0.05 }),
    field("lockdownOnRaid", "boolean", false),
  ],
  welcome,
  leveling: [channel("level_channel")],
  community: [...welcome, channel("level_channel")],
  games: [],
  search: [field("ephemeral", "boolean", false)],
  ai: [
    field("cyreneModel", "text", ""),
    field("assistantModel", "text", ""),
    field("ephemeral", "boolean", true),
  ],
  music: [],
  commerce: [],
};
class ControlError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
  ) {
    super(code);
  }
}
const fail = (status: number, code: string): never => {
  throw new ControlError(status, code);
};
const object = (value: any): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fail(400, "invalid-object");
const id = (value: any): string =>
  typeof value === "string" && /^\d{17,20}$/.test(value)
    ? value
    : fail(400, "invalid-discord-id");
const text = (value: any, max: number, required = false): string => {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    return fail(400, "invalid-text");
  return value.trim();
};
const url = (value: any): string => {
  const s = text(value, 2048);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol))
      return fail(400, "invalid-url");
    return u.toString();
  } catch {
    return fail(400, "invalid-url");
  }
};
function validateConfig(moduleId: string, value: any) {
  const schema = MODULE_FIELDS[moduleId];
  if (!schema) fail(404, "unsupported-module");
  const incoming = object(value),
    clean: Record<string, any> = {};
  for (const f of schema!) {
    const v = incoming[f.key];
    if (v === undefined) fail(400, `missing-setting:${f.key}`);
    if (f.type === "boolean") {
      if (typeof v !== "boolean") fail(400, `invalid-setting:${f.key}`);
      clean[f.key] = v;
    } else if (f.type === "number") {
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < f.min! ||
        v > f.max!
      )
        fail(400, `invalid-setting:${f.key}`);
      clean[f.key] = f.step && f.step < 1 ? v : Math.trunc(v);
    } else if (f.type === "select") {
      if (!f.options?.some((o) => o.value === v))
        fail(400, `invalid-setting:${f.key}`);
      clean[f.key] = v;
    } else {
      clean[f.key] = text(
        v,
        moduleId === "welcome" || f.key.endsWith("_message") ? 500 : 4000,
      );
      if (/_channel$/.test(f.key) && clean[f.key]) id(clean[f.key]);
      if (
        f.key.endsWith("Model") &&
        clean[f.key] &&
        !/^[A-Za-z0-9._:/-]{1,100}$/.test(clean[f.key])
      )
        fail(400, "invalid-model");
    }
  }
  return clean;
}
export function validateEmbed(value: any) {
  const b = object(value),
    fields = (b.fields ?? []) as any[],
    buttons = (b.buttons ?? []) as any[];
  if (
    !Array.isArray(fields) ||
    fields.length > 25 ||
    !Array.isArray(buttons) ||
    buttons.length > 5
  )
    fail(400, "invalid-embed-fields");
  const author = b.author === undefined ? {} : object(b.author);
  const clean = {
    bot_id: text(b.bot_id, 80, true),
    channel_id: id(b.channel_id),
    title: text(b.title, 256),
    description: text(b.description, 4096),
    footer: text(b.footer, 2048),
    color: b.color === undefined ? "#5865F2" : text(b.color, 7),
    url: url(b.url),
    thumbnail: url(b.thumbnail),
    image: url(b.image),
    author: {
      name: text(author.name, 256),
      url: url(author.url),
      iconUrl: url(author.iconUrl),
    },
    fields: fields.map((f) => {
      object(f);
      return {
        name: text(f.name, 256, true),
        value: text(f.value, 1024, true),
        inline: f.inline === true,
      };
    }),
    buttons: buttons.map((b) => {
      object(b);
      const target = url(b.url);
      if (!target) fail(400, "invalid-button-url");
      return { label: text(b.label, 80, true), url: target };
    }),
  };
  if (!/^#[0-9a-f]{6}$/i.test(clean.color)) fail(400, "invalid-color");
  const count =
    clean.title.length +
    clean.description.length +
    clean.footer.length +
    clean.author.name.length +
    clean.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  if (count > 6000) fail(400, "embed-too-long");
  if (!count && !clean.image && !clean.thumbnail) fail(400, "empty-embed");
  return clean;
}

export function registerControlRoutes(
  app: FastifyInstance,
  deps: ControlDependencies,
) {
  const { query: q, transaction: tx, authorize, env } = deps;
  const audit = async (
    q: ControlQuery,
    user: string,
    action: string,
    guild: string | undefined,
    target: string,
  ) => {
    await q(
      "INSERT INTO access.control_audit(actor_id,action,guild_id,target) VALUES($1,$2,$3,$4)",
      [user, action, guild ?? null, target],
    );
  };
  const event = async (
    q: ControlQuery,
    guild: string,
    type: string,
    payload: any,
  ) => {
    await q(
      "INSERT INTO ops.outbox(aggregate,aggregate_id,type,payload,correlation_id) VALUES($1,$2,$3,$4,$5)",
      ["guild", guild, type, JSON.stringify(payload), randomUUID()],
    );
  };
  // Errors contain no database details or secret values. CSRF is enforced by the host app hook.
  const route = (
    method: any,
    path: string,
    scope: "read" | "operate" | "admin",
    handler: (r: any, user: string, guild: string | undefined) => Promise<any>,
  ) =>
    app.route({
      method,
      url: path,
      handler: async (r, reply) => {
        try {
          const p = r.params as any;
          const guild = p?.guildId === undefined ? undefined : id(p.guildId);
          const actor = await authorize(
            r,
            guild,
            scope,
            p?.moduleId ?? (path.endsWith("/logs") ? "security" : undefined),
          );
          reply.header("Cache-Control", "no-store");
          const result = await handler(r, actor.userId, guild);
          if (method === "POST" && path.endsWith("/embeds")) reply.code(202);
          return result;
        } catch (e: any) {
          if (e.statusCode)
            return reply
              .code(e.statusCode)
              .send({ code: e.code ?? "access-denied", error: e.message });
          throw e;
        }
      },
    });
  const bot = async (guild: string, key: string) => {
    const rows = await q(
      "SELECT bot_key,application_id,modules FROM config.bots WHERE bot_key=$1 AND $2=ANY(guild_ids)",
      [key, guild],
    );
    if (!rows[0]) fail(404, "unregistered-bot");
    return rows[0]!;
  };
  const module = async (guild: string, key: string) => {
    const rows = await q(
      "SELECT bot_key FROM config.bots WHERE $1=ANY(modules) AND $2=ANY(guild_ids)",
      [key, guild],
    );
    if (!rows[0] || !MODULE_FIELDS[key]) fail(404, "unregistered-module");
  };
  const current = async (q: ControlQuery, guild: string, key: string) =>
    (
      await q(
        "SELECT version,value,applied_at,updated_at,updated_by FROM config.settings WHERE scope=$1 AND key=$2 ORDER BY version DESC LIMIT 1",
        [`guild:${guild}`, key],
      )
    )[0];
  route(
    "GET",
    "/api/guilds/:guildId/configuration/:moduleId",
    "read",
    async (r, _u, g) => {
      const m = text(r.params.moduleId, 80, true);
      await module(g!, m);
      return {
        configuration: (await current(q, g!, m)) ?? {
          version: 0,
          value: Object.fromEntries(
            MODULE_FIELDS[m]!.map((f) => [f.key, f.default]),
          ),
          applied_at: null,
        },
        fields: MODULE_FIELDS[m],
      };
    },
  );
  route(
    "GET",
    "/api/guilds/:guildId/configuration/:moduleId/history",
    "read",
    async (r, _u, g) => {
      const m = text(r.params.moduleId, 80, true);
      await module(g!, m);
      return {
        history: await q(
          "SELECT h.version,h.value,h.changed_by,h.changed_at,s.applied_at FROM config.settings_history h LEFT JOIN config.settings s ON s.scope=h.scope AND s.key=h.key AND s.version=h.version WHERE h.scope=$1 AND h.key=$2 ORDER BY h.version DESC LIMIT 100",
          [`guild:${g}`, m],
        ),
      };
    },
  );
  route(
    "PUT",
    "/api/guilds/:guildId/configuration/:moduleId",
    "operate",
    async (r, u, g) => {
      const m = text(r.params.moduleId, 80, true);
      await module(g!, m);
      const b = object(r.body),
        value = validateConfig(m, b.config);
      if (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 0)
        fail(400, "expected-version-required");
      return tx(async (q) => {
        await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `config:${g}:${m}`,
        ]);
        const before = await current(q, g!, m);
        if ((before?.version ?? 0) !== b.expectedVersion)
          fail(409, "version-conflict");
        const version = b.expectedVersion + 1;
        const rows = await q(
          "INSERT INTO config.settings(scope,key,version,value,updated_by) VALUES($1,$2,$3,$4,$5) RETURNING version,value,applied_at,updated_at",
          [`guild:${g}`, m, version, JSON.stringify(value), u],
        );
        await q(
          "INSERT INTO config.settings_history(scope,key,version,value,changed_by) VALUES($1,$2,$3,$4,$5)",
          [`guild:${g}`, m, version, JSON.stringify(value), u],
        );
        await event(q, g!, "configuration.saved", { module: m, version });
        await audit(q, u, "configuration.save", g, m);
        return { configuration: rows[0], status: "saved" };
      });
    },
  );
  route("GET", "/api/guilds/:guildId/bot-state", "read", async (_r, _u, g) => ({
    bots: await q(
      "SELECT b.bot_key,b.modules,COALESCE(s.enabled,true) enabled,COALESCE(s.paused,false) paused FROM config.bots b LEFT JOIN config.bot_states s ON s.bot_key=b.bot_key AND s.guild_id=$1 WHERE $1=ANY(b.guild_ids)",
      [g],
    ),
    server_paused:
      (
        await q(
          "SELECT server_paused FROM config.guild_controls WHERE guild_id=$1",
          [g],
        )
      )[0]?.server_paused ?? false,
  }));
  route(
    "PATCH",
    "/api/guilds/:guildId/bot-state",
    "operate",
    async (r, u, g) => {
      const b = object(r.body);
      await bot(g!, text(b.bot_key, 80, true));
      if (typeof b.enabled !== "boolean" || typeof b.paused !== "boolean")
        fail(400, "invalid-bot-state");
      return tx(async (q) => {
        const rows = await q(
          "INSERT INTO config.bot_states(guild_id,bot_key,enabled,paused,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(guild_id,bot_key) DO UPDATE SET enabled=$3,paused=$4,updated_by=$5,updated_at=now() RETURNING *",
          [g, b.bot_key, b.enabled, b.paused, u],
        );
        await event(q, g!, "bot-state.saved", {
          bot_key: b.bot_key,
          enabled: b.enabled,
          paused: b.paused,
        });
        await audit(q, u, "bot-state.save", g, b.bot_key);
        return { state: rows[0], status: "saved" };
      });
    },
  );
  route("GET", "/api/guilds/:guildId/settings", "read", async (_r, _u, g) => ({
    settings: {
      guild_id: g,
      notifications_enabled: true,
      server_paused: false,
      notification_preferences: {},
      ...(
        await q("SELECT * FROM config.guild_controls WHERE guild_id=$1", [g])
      )[0],
      theme: "kafka",
    },
  }));
  route(
    "PATCH",
    "/api/guilds/:guildId/settings",
    "operate",
    async (r, u, g) => {
      const b = object(r.body);
      if (b.theme !== undefined && b.theme !== "kafka")
        fail(400, "theme-fixed");
      for (const k of ["notifications_enabled", "server_paused"])
        if (b[k] !== undefined && typeof b[k] !== "boolean")
          fail(400, "invalid-settings");
      if (b.notification_preferences !== undefined) {
        const prefs = object(b.notification_preferences);
        if (
          Object.keys(prefs).length > 30 ||
          Object.values(prefs).some((v) => typeof v !== "boolean")
        )
          fail(400, "invalid-notification-preferences");
      }
      return tx(async (q) => {
        const rows = await q(
          "INSERT INTO config.guild_controls(guild_id,notifications_enabled,server_paused,notification_preferences,updated_by) VALUES($1,COALESCE($2,true),COALESCE($3,false),COALESCE($4::jsonb,'{}'::jsonb),$5) ON CONFLICT(guild_id) DO UPDATE SET notifications_enabled=COALESCE($2,config.guild_controls.notifications_enabled),server_paused=COALESCE($3,config.guild_controls.server_paused),notification_preferences=COALESCE($4::jsonb,config.guild_controls.notification_preferences),updated_by=$5,updated_at=now() RETURNING *",
          [
            g,
            b.notifications_enabled ?? null,
            b.server_paused ?? null,
            b.notification_preferences === undefined
              ? null
              : JSON.stringify(b.notification_preferences),
            u,
          ],
        );
        await event(q, g!, "guild-settings.saved", { guild_id: g });
        await audit(q, u, "guild-settings.save", g, g!);
        return { settings: { ...rows[0], theme: "kafka" }, status: "saved" };
      });
    },
  );
  route(
    "GET",
    "/api/guilds/:guildId/command-permissions",
    "read",
    async (_r, _u, g) => ({
      permissions: await q(
        "SELECT * FROM config.command_permissions WHERE guild_id=$1 ORDER BY bot_key,command",
        [g],
      ),
    }),
  );
  route(
    "PUT",
    "/api/guilds/:guildId/command-permissions",
    "operate",
    async (r, u, g) => {
      const b = object(r.body);
      await bot(g!, text(b.bot_key, 80, true));
      if (
        typeof b.command !== "string" ||
        !/^\/?[a-z][a-z0-9_-]{0,31}$/.test(b.command) ||
        !Array.isArray(b.role_ids) ||
        b.role_ids.length > 100 ||
        typeof b.enabled !== "boolean"
      )
        fail(400, "invalid-command-permissions");
      const roles = [...new Set(b.role_ids.map(id))];
      return tx(async (q) => {
        const rows = await q(
          "INSERT INTO config.command_permissions(guild_id,bot_key,command,role_ids,enabled,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(guild_id,bot_key,command) DO UPDATE SET role_ids=$4,enabled=$5,updated_by=$6,updated_at=now() RETURNING *",
          [g, b.bot_key, b.command.replace(/^\//, ""), roles, b.enabled, u],
        );
        await audit(q, u, "command-permissions.save", g, b.command);
        return { permission: rows[0], status: "saved" };
      });
    },
  );
  route("GET", "/api/guilds/:guildId/logs", "read", async (_r, _u, g) => ({
    logs: await q(
      "SELECT id,actor_id,action,target,created_at FROM access.control_audit WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 100",
      [g],
    ),
    incidents: await q(
      "SELECT * FROM security.incidents WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 100",
      [g],
    ),
  }));
  route("GET", "/api/guilds/:guildId/embeds", "read", async (_r, _u, g) => ({
    jobs: await q(
      "SELECT job_id,status,attempts,created_at,updated_at,payload->>'channel_id' channel_id FROM ops.jobs WHERE kind='dashboard.embed' AND payload->>'guild_id'=$1 ORDER BY created_at DESC LIMIT 100",
      [g],
    ),
  }));
  route("POST", "/api/guilds/:guildId/embeds", "operate", async (r, u, g) => {
    const b = validateEmbed(r.body);
    await bot(g!, b.bot_id);
    if (!deps.authorizeChannel) fail(503, "channel-permissions-unavailable");
    await deps.authorizeChannel!(r, g!, b.channel_id, b.bot_id);
    const result = await tx(async (q) => {
      await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `embed:${g}:${b.bot_id}`,
      ]);
      const states = await q(
        "SELECT s.enabled,s.paused,c.server_paused FROM config.bots b LEFT JOIN config.bot_states s ON s.bot_key=b.bot_key AND s.guild_id=$1 LEFT JOIN config.guild_controls c ON c.guild_id=$1 WHERE b.bot_key=$2",
        [g, b.bot_id],
      );
      if (!states[0]) fail(404, "unregistered-bot");
      if (
        states[0]?.enabled === false ||
        states[0]?.paused ||
        states[0]?.server_paused
      )
        fail(409, "bot-or-guild-paused");
      const job = randomUUID();
      await q(
        "INSERT INTO ops.jobs(job_id,kind,payload,idempotency_key) VALUES($1,$2,$3,$4)",
        [
          job,
          "dashboard.embed",
          JSON.stringify({ ...b, guild_id: g, requested_by: u }),
          `embed:${job}`,
        ],
      );
      await event(q, g!, "embed.queued", { job_id: job });
      await audit(q, u, "embed.queue", g, b.channel_id);
      return { queued: true, status: "pending", job_id: job };
    });
    return result;
  });
  route("GET", "/api/admin/guilds", "admin", async () => ({
    guilds: await q("SELECT * FROM access.guilds ORDER BY name"),
  }));
  route("PUT", "/api/admin/guilds", "admin", async (r, u) => {
    const b = object(r.body),
      guild = id(b.guild_id),
      owner = id(b.owner_id),
      name = text(b.name, 200, true);
    if (typeof b.approved !== "boolean") fail(400, "invalid-approved");
    return tx(async (q) => {
      const rows = await q(
        "INSERT INTO access.guilds(guild_id,name,owner_id,approved) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id) DO UPDATE SET name=$2,owner_id=$3,approved=$4,updated_at=now() RETURNING *",
        [guild, name, owner, b.approved],
      );
      await audit(q, u, "guild.save", guild, guild);
      return { guild: rows[0] };
    });
  });
  route("DELETE", "/api/admin/guilds/:guildId", "admin", async (_r, u, g) =>
    tx(async (q) => {
      await audit(q, u, "guild.delete", g, g!);
      await q("DELETE FROM access.guilds WHERE guild_id=$1", [g]);
      return { ok: true };
    }),
  );
  route("GET", "/api/admin/staff-scopes", "admin", async () => ({
    scopes: await q(
      "SELECT * FROM access.staff_roles ORDER BY guild_id,role_id,scope",
    ),
  }));
  const accountBody = (value: any) => {
    const b = object(value);
    if (!["postgres", "redis", "mongodb"].includes(b.provider))
      fail(400, "invalid-provider");
    const name = text(b.account_name, 80, true),
      ref = text(b.secret_ref, 100, true);
    if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(ref))
      fail(400, "invalid-secret-reference");
    const endpoint = text(b.endpoint ?? "", 2048),
      region = text(b.region ?? "", 100);
    if (endpoint) {
      try {
        const parsed = new URL(endpoint);
        if (parsed.username || parsed.password)
          fail(400, "credentials-must-use-vault");
        if (
          ![
            "http:",
            "https:",
            "postgres:",
            "postgresql:",
            "redis:",
            "rediss:",
            "mongodb:",
            "mongodb+srv:",
          ].includes(parsed.protocol)
        )
          fail(400, "invalid-endpoint");
      } catch (e) {
        if (e instanceof ControlError) throw e;
        fail(400, "invalid-endpoint");
      }
    }
    const metadata = object(b.metadata ?? {});
    if (
      JSON.stringify(metadata).length > 8192 ||
      /"(?:password|token|secret|api_key|credential)"\s*:/i.test(
        JSON.stringify(metadata),
      )
    )
      fail(400, "invalid-account-metadata");
    if (b.enabled !== undefined && typeof b.enabled !== "boolean")
      fail(400, "invalid-enabled");
    return {
      provider: b.provider,
      name,
      ref,
      endpoint,
      region,
      enabled: b.enabled ?? true,
      metadata,
    };
  };
  const saveAccount = async (body: any, u: string, accountId?: string) => {
    const b = accountBody(body);
    return tx(async (q) => {
      let rows;
      if (accountId)
        rows = await q(
          "UPDATE config.infra_accounts SET provider=$2,account_name=$3,region=$4,secret_ref=$5,endpoint=$6,enabled=$7,metadata=$8,updated_at=now() WHERE id=$1 RETURNING *",
          [
            accountId,
            b.provider,
            b.name,
            b.region,
            b.ref,
            b.endpoint,
            b.enabled,
            JSON.stringify(b.metadata),
          ],
        );
      else
        rows = await q(
          "INSERT INTO config.infra_accounts(provider,account_name,region,secret_ref,endpoint,enabled,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            b.provider,
            b.name,
            b.region,
            b.ref,
            b.endpoint,
            b.enabled,
            JSON.stringify(b.metadata),
          ],
        );
      if (!rows[0]) fail(404, "account-not-found");
      await audit(
        q,
        u,
        accountId ? "account.update" : "account.create",
        undefined,
        String(rows[0]!.id),
      );
      return { account: rows[0] };
    });
  };
  const uuid = (value: any) => {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      fail(400, "invalid-account-id");
    return value;
  };
  route("GET", "/api/admin/accounts", "admin", async () => ({
    accounts: await q(
      "SELECT * FROM config.infra_accounts ORDER BY provider,account_name",
    ),
  }));
  route("POST", "/api/admin/accounts", "admin", async (r, u) =>
    saveAccount(r.body, u),
  );
  route("PATCH", "/api/admin/accounts/:accountId", "admin", async (r, u) =>
    saveAccount(r.body, u, uuid(r.params.accountId)),
  );
  route("DELETE", "/api/admin/accounts/:accountId", "admin", async (r, u) => {
    const account = uuid(r.params.accountId);
    return tx(async (q) => {
      await q("DELETE FROM config.infra_accounts WHERE id=$1", [account]);
      await audit(q, u, "account.delete", undefined, account);
      return { ok: true };
    });
  });
  for (const method of ["PUT", "DELETE"])
    route(method, "/api/admin/staff-scopes", "admin", async (r, u) => {
      const b = object(r.body),
        guild = id(b.guild_id),
        role = id(b.role_id),
        scope = text(b.scope, 80, true);
      if (!/^[a-z][a-z0-9:-]{0,79}$/.test(scope)) fail(400, "invalid-scope");
      return tx(async (q) => {
        if (method === "PUT")
          await q(
            "INSERT INTO access.staff_roles(guild_id,role_id,scope) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [guild, role, scope],
          );
        else
          await q(
            "DELETE FROM access.staff_roles WHERE guild_id=$1 AND role_id=$2 AND scope=$3",
            [guild, role, scope],
          );
        await audit(
          q,
          u,
          `staff-scope.${method.toLowerCase()}`,
          guild,
          `${role}:${scope}`,
        );
        return { ok: true };
      });
    });
  const vaultKey = () => {
    const key = env.VAULT_SECRET ?? env.SESSION_SECRET;
    if (!key || key.length < 32) fail(503, "vault-unavailable");
    return key!;
  };
  const secretName = (r: any) => {
    const name = text(r.params.name, 100, true);
    if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(name)) fail(400, "invalid-secret-name");
    return name;
  };
  route("GET", "/api/admin/secrets", "admin", async () => ({
    secrets: (
      await q("SELECT name,updated_at FROM access.secret_vault ORDER BY name")
    ).map((s) => ({ ...s, masked: "••••••••" })),
  }));
  route("PUT", "/api/admin/secrets/:name", "admin", async (r, u) => {
    const name = secretName(r),
      value = text(object(r.body).value, 16000, true),
      encrypted = encryptToken(value, vaultKey());
    return tx(async (q) => {
      await q(
        "INSERT INTO access.secret_vault(name,encrypted_value,updated_by) VALUES($1,$2,$3) ON CONFLICT(name) DO UPDATE SET encrypted_value=$2,updated_by=$3,updated_at=now()",
        [name, encrypted, u],
      );
      await audit(q, u, "secret.save", undefined, name);
      return { ok: true, name, masked: "••••••••" };
    });
  });
  route("DELETE", "/api/admin/secrets/:name", "admin", async (r, u) => {
    const name = secretName(r);
    return tx(async (q) => {
      await q("DELETE FROM access.secret_vault WHERE name=$1", [name]);
      await audit(q, u, "secret.delete", undefined, name);
      return { ok: true };
    });
  });
  route("POST", "/api/admin/secrets/:name/reveal", "admin", async (r, u) => {
    const name = secretName(r);
    if (object(r.body).confirmation !== true)
      fail(400, "confirmation-required");
    return tx(async (q) => {
      const s = (
        await q(
          "SELECT encrypted_value FROM access.secret_vault WHERE name=$1",
          [name],
        )
      )[0];
      if (!s) fail(404, "secret-not-found");
      const value = decryptToken(s!.encrypted_value, vaultKey());
      await audit(q, u, "secret.reveal", undefined, name);
      return { name, value };
    });
  });
  // Internal routes never authenticate with an OAuth cookie; missing service token fails closed.
  const internal = (
    path: string,
    handler: (r: any) => Promise<any>,
    method: "GET" | "POST" = "GET",
  ) =>
    app.route({
      method,
      url: path,
      handler: async (r, reply) => {
        reply.header("Cache-Control", "no-store");
        const expected = env.INTERNAL_SERVICE_TOKEN ?? "",
          raw = r.headers.authorization ?? "",
          supplied = raw.startsWith("Bearer ") ? raw.slice(7) : "";
        if (
          expected.length < 32 ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
        )
          return reply.code(401).send({ error: "service-auth-required" });
        try {
          return await handler(r);
        } catch (e: any) {
          if (e.statusCode)
            return reply.code(e.statusCode).send({ error: e.code });
          throw e;
        }
      },
    });
  internal("/api/internal/accounts", async () => ({
    accounts: await q(
      "SELECT * FROM config.infra_accounts ORDER BY provider,account_name",
    ),
  }));
  internal(
    "/api/internal/accounts",
    async (r) => saveAccount(r.body, "internal-service"),
    "POST",
  );
  internal("/api/internal/bots", async () => ({
    bots: await q(
      "SELECT bot_key,application_id,modules,guild_ids FROM config.bots ORDER BY bot_key",
    ),
  }));
  internal("/api/internal/config", async (r) => {
    const b = r.query ?? {},
      guild = id(b.guild_id),
      key = text(b.module_id, 80, true);
    await module(guild, key);
    return {
      configuration: (await current(q, guild, key)) ?? null,
      controls:
        (
          await q("SELECT * FROM config.guild_controls WHERE guild_id=$1", [
            guild,
          ])
        )[0] ?? null,
      bot_states: await q("SELECT * FROM config.bot_states WHERE guild_id=$1", [
        guild,
      ]),
      command_permissions: await q(
        "SELECT * FROM config.command_permissions WHERE guild_id=$1",
        [guild],
      ),
    };
  });
  internal("/api/internal/secret/:name", async (r) => {
    const name = secretName(r);
    return tx(async (q) => {
      const s = (
        await q(
          "SELECT encrypted_value FROM access.secret_vault WHERE name=$1",
          [name],
        )
      )[0];
      if (!s) fail(404, "secret-not-found");
      await audit(q, "internal-service", "secret.read", undefined, name);
      return { name, value: decryptToken(s!.encrypted_value, vaultKey()) };
    });
  });
  internal(
    "/api/internal/config",
    async (r) => {
      const b = object(r.body),
        guild = id(b.guild_id),
        key = text(b.module_id, 80, true);
      await module(guild, key);
      if (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 0)
        fail(400, "expected-version-required");
      const value = validateConfig(key, b.config);
      return tx(async (q) => {
        await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `config:${guild}:${key}`,
        ]);
        const before = await current(q, guild, key);
        if ((before?.version ?? 0) !== b.expectedVersion)
          fail(409, "version-conflict");
        const version = b.expectedVersion + 1;
        const rows = await q(
          "INSERT INTO config.settings(scope,key,version,value,updated_by) VALUES($1,$2,$3,$4,$5) RETURNING version,value,applied_at,updated_at",
          [
            `guild:${guild}`,
            key,
            version,
            JSON.stringify(value),
            "internal-service",
          ],
        );
        await q(
          "INSERT INTO config.settings_history(scope,key,version,value,changed_by) VALUES($1,$2,$3,$4,$5)",
          [
            `guild:${guild}`,
            key,
            version,
            JSON.stringify(value),
            "internal-service",
          ],
        );
        await audit(q, "internal-service", "configuration.sync", guild, key);
        await event(q, guild, "configuration.saved", { module: key, version });
        return { configuration: rows[0], status: "saved" };
      });
    },
    "POST",
  );
  internal(
    "/api/internal/config/applied",
    async (r) => {
      const b = object(r.body),
        guild = id(b.guild_id),
        key = text(b.module_id, 80, true);
      await module(guild, key);
      if (!Number.isSafeInteger(b.version) || b.version < 1)
        fail(400, "invalid-version");
      return tx(async (q) => {
        const rows = await q(
          "UPDATE config.settings SET applied_at=now() WHERE scope=$1 AND key=$2 AND version=$3 RETURNING version,applied_at",
          [`guild:${guild}`, key, b.version],
        );
        if (!rows[0]) fail(404, "configuration-not-found");
        await audit(
          q,
          "internal-service",
          "configuration.applied",
          guild,
          `${key}:${b.version}`,
        );
        return { configuration: rows[0], status: "applied" };
      });
    },
    "POST",
  );
}
